import logging
import traceback

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from auth import create_token, decode_token, verify_password
from database import rest

router = APIRouter()
bearer = HTTPBearer(auto_error=False)
logger = logging.getLogger("sistema-alertas.auth")


class LoginPayload(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)


def public_user(user: dict) -> dict:
    return {key: user.get(key) for key in ("id", "username", "email", "role", "is_active", "created_at")}


async def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Inicie sesión para continuar")
    claims = decode_token(credentials.credentials, request)
    if not claims:
        raise HTTPException(status_code=401, detail="La sesión venció; vuelva a iniciar sesión")
    rows = await rest(request, "users", query={"select": "id,username,email,role,is_active,created_at", "id": f"eq.{claims['sub']}", "limit": "1"})
    if not rows or not rows[0]["is_active"]:
        raise HTTPException(status_code=401, detail="La cuenta está inactiva o ya no existe")
    return rows[0]


async def administrator(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "administrador":
        raise HTTPException(status_code=403, detail="Se requiere el rol Administrador")
    return user


@router.post("/login")
async def login(payload: LoginPayload, request: Request):
    stage = "normalizar usuario"
    try:
        username = payload.username.strip().lower()
        if username == "admin":
            username = "administrador"
        stage = "consultar usuario en Supabase"
        rows = await rest(request, "users", query={"select": "id,username,email,password_hash,role,is_active,created_at", "username": f"ilike.{username}", "limit": "1"})
        user = rows[0] if rows else None
        stage = "verificar contraseña"
        if not user or not user["is_active"] or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")
        stage = "crear token de sesión"
        token = create_token(user, request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        # Never log the request body: it contains the user's password.
        logger.error(
            "Unhandled exception while processing login at %s (%s): %s\n%s",
            stage,
            type(exc).__name__,
            exc,
            traceback.format_exc(),
        )
        raise HTTPException(status_code=500, detail="Error interno al iniciar sesión. Revise los logs del Worker.") from exc
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)
