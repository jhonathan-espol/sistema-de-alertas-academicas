import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from app.auth import hash_password
from app.database import rest
from app.routes.auth import administrator, public_user

router = APIRouter()
USERNAME = re.compile(r"^[\w.@-]{3,100}$", re.UNICODE)


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    role: str = "invitado"


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    role: str | None = None
    is_active: bool | None = None


class PasswordChange(BaseModel):
    password: str = Field(min_length=10, max_length=128)


@router.get("")
async def list_users(request: Request, _: dict = Depends(administrator)):
    rows = await rest(request, "users", query={"select": "id,username,email,role,is_active,created_at", "order": "created_at.asc"})
    return [public_user(row) for row in rows]


@router.post("", status_code=201)
async def create_user(payload: UserCreate, request: Request, _: dict = Depends(administrator)):
    username = payload.username.strip().lower()
    if not USERNAME.fullmatch(username):
        raise HTTPException(status_code=422, detail="El usuario solo puede incluir letras, números, punto, @, guion y guion bajo")
    if payload.role not in {"administrador", "invitado"}:
        raise HTTPException(status_code=422, detail="Rol no válido")
    rows = await rest(request, "users", method="POST", body={"username": username, "email": str(payload.email).lower(), "password_hash": hash_password(payload.password), "role": payload.role}, prefer="return=representation")
    return public_user(rows[0])


@router.patch("/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, request: Request, actor: dict = Depends(administrator)):
    patch = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="No hay cambios para guardar")
    if "role" in patch and patch["role"] not in {"administrador", "invitado"}:
        raise HTTPException(status_code=422, detail="Rol no válido")
    if user_id == actor["id"] and (patch.get("role") == "invitado" or patch.get("is_active") is False):
        raise HTTPException(status_code=400, detail="No puede desactivar ni quitar su propio rol de administrador")
    if patch.get("role") == "invitado" or patch.get("is_active") is False:
        target = await rest(request, "users", query={"select": "id,role,is_active", "id": f"eq.{user_id}", "limit": "1"})
        if target and target[0]["role"] == "administrador" and target[0]["is_active"]:
            admins = await rest(request, "users", query={"select": "id", "role": "eq.administrador", "is_active": "eq.true"})
            if len(admins) <= 1:
                raise HTTPException(status_code=400, detail="Debe quedar al menos un administrador activo")
    rows = await rest(request, "users", method="PATCH", query={"id": f"eq.{user_id}", "select": "id,username,email,role,is_active,created_at"}, body=patch, prefer="return=representation")
    if not rows:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return public_user(rows[0])


@router.post("/{user_id}/change-password")
async def change_password(user_id: str, payload: PasswordChange, request: Request, _: dict = Depends(administrator)):
    rows = await rest(request, "users", method="PATCH", query={"id": f"eq.{user_id}", "select": "id"}, body={"password_hash": hash_password(payload.password), "updated_at": datetime.now(timezone.utc).isoformat()}, prefer="return=representation")
    if not rows:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"message": "Contraseña actualizada"}


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str, request: Request, actor: dict = Depends(administrator)):
    if user_id == actor["id"]:
        raise HTTPException(status_code=400, detail="No puede eliminar su propia cuenta")
    target = await rest(request, "users", query={"select": "id,role,is_active", "id": f"eq.{user_id}", "limit": "1"})
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if target[0]["role"] == "administrador" and target[0]["is_active"]:
        admins = await rest(request, "users", query={"select": "id", "role": "eq.administrador", "is_active": "eq.true"})
        if len(admins) <= 1:
            raise HTTPException(status_code=400, detail="Debe quedar al menos un administrador activo")
    await rest(request, "users", method="DELETE", query={"id": f"eq.{user_id}"}, prefer="return=minimal")
