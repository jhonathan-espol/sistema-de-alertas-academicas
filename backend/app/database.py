"""Cliente pequeño de la Data API de Supabase (PostgREST)."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlencode

from fastapi import HTTPException, Request


def _env_value(request: Request, name: str) -> str:
    bindings = request.scope.get("env")
    value = getattr(bindings, name, None) if bindings is not None else None
    if value is None and isinstance(bindings, dict):
        value = bindings.get(name)
    value = value or os.getenv(name)
    if not value:
        raise HTTPException(status_code=503, detail=f"Falta configurar el secreto {name} en Cloudflare")
    return str(value)


async def rest(
    request: Request,
    table: str,
    *,
    method: str = "GET",
    query: dict[str, str] | None = None,
    body: Any = None,
    prefer: str | None = None,
) -> Any:
    """Llama a PostgREST; la clave de servicio solo vive en el backend."""
    base_url = _env_value(request, "SUPABASE_URL").rstrip("/")
    try:
        key = _env_value(request, "SUPABASE_SECRET_KEY")
    except HTTPException:
        key = _env_value(request, "SUPABASE_SERVICE_ROLE_KEY")
    url = f"{base_url}/rest/v1/{table}"
    if query:
        url += "?" + urlencode(query)
    headers = {
        "apikey": key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    # Las claves secret sb_secret_ autentican mediante apikey. Las antiguas
    # service_role son JWT y también deben ir en Authorization para activar RLS bypass.
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    if prefer:
        headers["Prefer"] = prefer
    if request.scope.get("env") is not None:
        try:
            from js import Object, fetch
            from pyodide.ffi import to_js

            init: dict[str, Any] = {"method": method, "headers": headers}
            if body is not None:
                init["body"] = json.dumps(body)
            response = await fetch(url, to_js(init, dict_converter=Object.fromEntries))
            text = await response.text()
            status = int(response.status)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="No fue posible consultar Supabase") from exc
    else:
        # Permite ejecutar FastAPI fuera de Workers para mantenimiento.
        from urllib.request import Request as URLRequest, urlopen
        from urllib.error import HTTPError, URLError

        payload = json.dumps(body).encode() if body is not None else None
        outbound = URLRequest(url, data=payload, headers=headers, method=method)
        try:
            with urlopen(outbound, timeout=15) as result:
                text, status = result.read().decode(), result.status
        except HTTPError as exc:
            text, status = exc.read().decode(), exc.code
        except URLError as exc:
            raise HTTPException(status_code=502, detail="No fue posible consultar Supabase") from exc
    if status >= 400:
        try:
            detail = json.loads(text).get("message", "Error de base de datos")
        except (ValueError, AttributeError):
            detail = "Error de base de datos"
        raise HTTPException(status_code=409 if status == 409 else 502, detail=detail)
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None
