from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.database import rest
from app.routes.auth import current_user

router = APIRouter()


class AlertCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(default="", max_length=5000)
    severity: str = "media"
    assigned_to: str | None = None


class AlertUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    severity: str | None = None
    status: str | None = None


@router.get("")
async def list_alerts(request: Request, _: dict = Depends(current_user)):
    return await rest(request, "alerts", query={"select": "*", "order": "created_at.desc"})


@router.post("", status_code=201)
async def create_alert(payload: AlertCreate, request: Request, actor: dict = Depends(current_user)):
    if payload.severity not in {"baja", "media", "alta", "critica"}:
        raise HTTPException(status_code=422, detail="Severidad no válida")
    body = payload.model_dump()
    body["created_by"] = actor["id"]
    rows = await rest(request, "alerts", method="POST", body=body, prefer="return=representation")
    return rows[0]


@router.patch("/{alert_id}")
async def update_alert(alert_id: str, payload: AlertUpdate, request: Request, _: dict = Depends(current_user)):
    patch = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "severity" in patch and patch["severity"] not in {"baja", "media", "alta", "critica"}:
        raise HTTPException(status_code=422, detail="Severidad no válida")
    if "status" in patch and patch["status"] not in {"activa", "resuelta", "archivada"}:
        raise HTTPException(status_code=422, detail="Estado no válido")
    rows = await rest(request, "alerts", method="PATCH", query={"id": f"eq.{alert_id}", "select": "*"}, body=patch, prefer="return=representation")
    if not rows:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    return rows[0]


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(alert_id: str, request: Request, _: dict = Depends(current_user)):
    rows = await rest(request, "alerts", method="DELETE", query={"id": f"eq.{alert_id}"}, prefer="return=representation")
    if not rows:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
