from __future__ import annotations

import base64
import hmac
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool


ROOT = Path(__file__).resolve().parents[1]
ANALYSIS_SCRIPT = ROOT / "analisis_preliminar.py"
COMPANION_SCRIPT = ROOT / "complemento.py"
STORAGE_BUCKET = os.getenv("TRAINING_STORAGE_BUCKET", "training-artifacts")
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
TRAINING_LOCK = threading.Lock()
logger = logging.getLogger("training-service")

REQUIRED_COLUMNS = {
    "periodo", "estado_periodo", "via_salida", "modalidad", "tiene_registro_asistencia",
    "dias_asistidos_d28", "dias_con_clase_d28", "pct_inasistencia_d28",
    "max_pct_inasistencia_asig_d28", "max_pct_inasist_sobre_total_d28",
    "dia_primera_asistencia", "n_asignaturas_matriculadas", "puntaje_admision",
    "edad_anios", "sexo", "jornada", "estado_laboral", "nivel_socioeconomico",
    "ingreso_per_capita_hogar", "tipo_colegio", "primera_generacion_superior",
    "bono_desarrollo_humano", "zona_residencia", "estado_civil",
    "pct_inasistencia_final", "irreversible_inasistencia_d28",
}
REQUIRED_PERIODS = {"2023-2", "2024-1", "2024-2", "2025-1", "2025-2"}
ALLOWED_ARTIFACTS = {
    "resultados_preliminares.xlsx",
    "resumen.json",
    "fig1_casos_por_periodo.png",
    "fig2_curvas_PR_validacion.png",
    "fig3_comparacion_modelos.png",
    "fig4_shap_importancia.png",
    "fig5_subgrupos_FNR.png",
}

app = FastAPI(title="Servicio de análisis de alertas", version="1.0.0")
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS", "https://alertas-academicas-web.jhonathanespol.workers.dev"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def _config(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=503, detail=f"Falta configurar {name} en el servicio de entrenamiento")
    return value


def _supabase_key() -> str:
    return os.getenv("SUPABASE_SECRET_KEY", "").strip() or _config("SUPABASE_SERVICE_ROLE_KEY")


def _supabase_headers() -> dict[str, str]:
    key = _supabase_key()
    headers = {"apikey": key, "Content-Type": "application/json", "Accept": "application/json"}
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _db_request(method: str, path: str, *, params: dict[str, str] | None = None, body: Any = None) -> Any:
    url = f"{_config('SUPABASE_URL').rstrip('/')}/rest/v1/{path}"
    headers = _supabase_headers()
    if method.upper() == "POST":
        headers["Prefer"] = "return=representation"
    response = requests.request(method, url, params=params, json=body, headers=headers, timeout=30)
    if response.status_code >= 400:
        logger.error("Supabase request failed: method=%s path=%s status=%s", method, path, response.status_code)
        raise RuntimeError(f"Supabase respondió HTTP {response.status_code}")
    if not response.content:
        return None
    return response.json()


def _verify_token(token: str) -> dict[str, Any]:
    try:
        secret = _config("JWT_SECRET")
        head, payload, signature = token.split(".")
        signing_input = f"{head}.{payload}"
        expected = base64.urlsafe_b64encode(
            hmac.digest(secret.encode(), signing_input.encode(), "sha256")
        ).rstrip(b"=").decode()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("firma inválida")
        decoded = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        claims = json.loads(decoded)
        if int(claims["exp"]) <= int(time.time()) or not claims.get("sub"):
            raise ValueError("sesión vencida")
        return claims
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="La sesión no es válida o venció") from exc


async def require_admin(request: Request) -> dict[str, Any]:
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Inicie sesión como administrador")
    claims = _verify_token(authorization[7:].strip())
    try:
        rows = await run_in_threadpool(
            _db_request,
            "GET",
            "users",
            params={
                "select": "id,username,role,is_active",
                "id": f"eq.{claims['sub']}",
                "limit": "1",
            },
        )
    except Exception as exc:
        logger.exception("Could not validate training service user")
        raise HTTPException(status_code=503, detail="No se pudo validar el acceso con Supabase") from exc
    if not rows or not rows[0].get("is_active") or rows[0].get("role") != "administrador":
        raise HTTPException(status_code=403, detail="Solo un administrador activo puede gestionar entrenamientos")
    return rows[0]


def _run_path(run_id: str) -> str:
    return f"training_runs?id=eq.{run_id}"


def _update_run(run_id: str, **fields: Any) -> None:
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    _db_request("PATCH", _run_path(run_id), body=fields)


def _validate_dataset(path: Path) -> dict[str, Any]:
    try:
        frame = pd.read_excel(path, sheet_name=0)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="No se pudo leer la primera hoja del Excel") from exc
    missing = sorted(REQUIRED_COLUMNS - set(map(str, frame.columns)))
    if missing:
        raise HTTPException(status_code=422, detail="Faltan columnas requeridas: " + ", ".join(missing))
    periods = set(frame["periodo"].dropna().astype(str).str.strip())
    missing_periods = sorted(REQUIRED_PERIODS - periods)
    if missing_periods:
        raise HTTPException(status_code=422, detail="Faltan periodos requeridos: " + ", ".join(missing_periods))
    closed = frame[(frame["estado_periodo"] == "CERRADO") & (frame["modalidad"] == "PRESENCIAL")]
    group = closed[(closed["via_salida"] != "RETIRO_VOLUNTARIO") & (closed["tiene_registro_asistencia"] == "SI")]
    labels = (group["via_salida"] == "REPRUEBA_INASISTENCIAS").astype(int)
    train = labels[group["periodo"].astype(str).isin({"2023-2", "2024-1", "2024-2", "2025-1"})]
    validation = labels[group["periodo"].astype(str) == "2025-2"]
    if train.nunique() < 2 or train.value_counts().min() < 5 or validation.nunique() < 2:
        raise HTTPException(
            status_code=422,
            detail="Los periodos de entrenamiento/validación no tienen suficientes casos de ambas clases para el análisis."
        )
    return {
        "rows": int(len(frame)),
        "columns": int(len(frame.columns)),
        "included_students": int(len(group)),
        "training_students": int(len(train)),
        "validation_students": int(len(validation)),
        "periods": sorted(REQUIRED_PERIODS),
    }


def _replace_companion_paths(source: str, input_path: Path, output_dir: Path) -> str:
    replacement = f"PATH={str(input_path)!r}; OUT={str(output_dir)!r}"
    adapted, count = re.subn(
        r'(?m)^PATH="/mnt/user-data/uploads/dataset_desercion_primer_nivel__1_\.xlsx"; OUT="/home/claude/analisis/out"$',
        replacement,
        source,
        count=1,
    )
    if count != 1:
        raise RuntimeError("No se reconocieron las rutas fijadas de complemento.py; se dejó intacto el archivo original")
    return adapted


def _upload_artifact(run_id: str, name: str, path: Path) -> None:
    key = _supabase_key()
    headers = {"apikey": key, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if name.endswith(".xlsx") else "application/json" if name.endswith(".json") else "image/png", "x-upsert": "true"}
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    url = f"{_config('SUPABASE_URL').rstrip('/')}/storage/v1/object/{STORAGE_BUCKET}/{run_id}/{name}"
    response = requests.post(url, data=path.read_bytes(), headers=headers, timeout=120)
    if response.status_code >= 400:
        logger.error("Artifact upload failed: run=%s file=%s status=%s", run_id, name, response.status_code)
        raise RuntimeError(f"No se pudo guardar el artefacto {name} en Supabase Storage")


def execute_run(run_id: str, input_path_text: str, file_name: str) -> None:
    temp_root = Path(input_path_text).parent
    input_path = Path(input_path_text)
    output_dir = temp_root / "output"
    output_dir.mkdir(exist_ok=True)
    try:
        with TRAINING_LOCK:
            _update_run(
                run_id,
                status="running",
                progress=5,
                stage="Preparando análisis",
                started_at=datetime.now(timezone.utc).isoformat(),
                error=None,
            )
            if not ANALYSIS_SCRIPT.is_file() or not COMPANION_SCRIPT.is_file():
                raise RuntimeError("No se encontraron los dos scripts de análisis en el repositorio")

            _update_run(run_id, progress=10, stage="Análisis principal: modelos, validación y gráficos")
            primary = subprocess.run(
                [os.getenv("PYTHON_EXECUTABLE", "python"), str(ANALYSIS_SCRIPT), str(input_path), str(output_dir)],
                cwd=temp_root,
                capture_output=True,
                text=True,
                timeout=90 * 60,
                check=False,
            )
            if primary.returncode:
                logger.error("Primary analysis failed for run %s: %s", run_id, (primary.stderr or primary.stdout)[-5000:])
                raise RuntimeError("Falló el análisis principal. Revisa los logs del servicio de entrenamiento.")

            _update_run(run_id, progress=75, stage="Comprobaciones complementarias")
            adapted_companion = _replace_companion_paths(
                COMPANION_SCRIPT.read_text(encoding="utf-8"), input_path, output_dir
            )
            companion_path = temp_root / "complemento_runtime.py"
            companion_path.write_text(adapted_companion, encoding="utf-8")
            companion = subprocess.run(
                [os.getenv("PYTHON_EXECUTABLE", "python"), str(companion_path)],
                cwd=temp_root,
                capture_output=True,
                text=True,
                timeout=60 * 60,
                check=False,
            )
            if companion.returncode:
                logger.error("Complementary analysis failed for run %s: %s", run_id, (companion.stderr or companion.stdout)[-5000:])
                raise RuntimeError("Fallaron las comprobaciones complementarias. Revisa los logs del servicio.")

            _update_run(run_id, progress=90, stage="Guardando resultados en Supabase Storage")
            artifacts = sorted(name for name in ALLOWED_ARTIFACTS if (output_dir / name).is_file())
            if "resultados_preliminares.xlsx" not in artifacts or "resumen.json" not in artifacts:
                raise RuntimeError("El análisis terminó sin generar el Excel y el resumen esperados")
            for name in artifacts:
                _upload_artifact(run_id, name, output_dir / name)
            summary = json.loads((output_dir / "resumen.json").read_text(encoding="utf-8"))
            summary["dataset_rows"] = _run_dataset_rows(run_id)
            validation = pd.read_excel(output_dir / "resultados_preliminares.xlsx", sheet_name="3_validacion_2025-2")
            best_name = f"{summary['mejor'][0]} [{summary['mejor'][1]}]"
            best_row = validation.loc[validation["modelo"] == best_name]
            if not best_row.empty:
                summary["best_metrics"] = {
                    metric: float(best_row.iloc[0][metric])
                    for metric in ("AUC_PR", "AUC_ROC", "Recall", "Precision", "F1", "Tasa_alerta")
                }
            _update_run(
                run_id,
                status="completed",
                progress=100,
                stage="Completado",
                result_summary=summary,
                artifacts=artifacts,
                error=None,
                finished_at=datetime.now(timezone.utc).isoformat(),
            )
    except Exception as exc:
        logger.exception("Training run failed: run=%s", run_id)
        try:
            _update_run(
                run_id,
                status="failed",
                progress=100,
                stage="Falló",
                error=str(exc)[:1000],
                finished_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception:
            logger.exception("Could not save failed run status: run=%s", run_id)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def _run_dataset_rows(run_id: str) -> int:
    rows = _db_request("GET", _run_path(run_id), params={"select": "dataset_rows", "limit": "1"})
    return int(rows[0]["dataset_rows"]) if rows else 0


def _public_run(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: row.get(key)
        for key in (
            "id", "dataset_name", "dataset_rows", "dataset_bytes", "status", "progress", "stage",
            "result_summary", "artifacts", "error", "created_at", "started_at", "finished_at", "updated_at",
        )
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "academic-training"}


@app.get("/api/training/runs")
async def list_runs(_: dict[str, Any] = Depends(require_admin)):
    try:
        rows = await run_in_threadpool(
            _db_request,
            "GET",
            "training_runs",
            params={"select": "*", "order": "created_at.desc", "limit": "20"},
        )
        return [_public_run(row) for row in rows]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Could not list training runs")
        raise HTTPException(status_code=503, detail="No se pudo cargar el historial de análisis") from exc


@app.get("/api/training/runs/{run_id}")
async def get_run(run_id: str, _: dict[str, Any] = Depends(require_admin)):
    try:
        rows = await run_in_threadpool(
            _db_request,
            "GET",
            _run_path(run_id),
            params={"select": "*", "limit": "1"},
        )
    except Exception as exc:
        logger.exception("Could not load training run")
        raise HTTPException(status_code=503, detail="No se pudo consultar el análisis") from exc
    if not rows:
        raise HTTPException(status_code=404, detail="Análisis no encontrado")
    return _public_run(rows[0])


@app.post("/api/training/runs", status_code=202)
async def create_run(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    actor: dict[str, Any] = Depends(require_admin),
):
    filename = Path(file.filename or "dataset.xlsx").name
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=415, detail="Carga un archivo Excel .xlsx")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="El archivo supera el límite de 25 MB")
    if not content:
        raise HTTPException(status_code=400, detail="El archivo está vacío")

    run_id = str(uuid.uuid4())
    temp_root = Path(tempfile.mkdtemp(prefix=f"alertas-{run_id[:8]}-"))
    input_path = temp_root / "dataset.xlsx"
    input_path.write_bytes(content)
    try:
        validation = await run_in_threadpool(_validate_dataset, input_path)
        row = {
            "id": run_id,
            "created_by": actor["id"],
            "dataset_name": filename[:255],
            "dataset_rows": validation["rows"],
            "dataset_bytes": len(content),
            "status": "queued",
            "progress": 0,
            "stage": "En cola",
            "validation_summary": validation,
        }
        created = await run_in_threadpool(
            _db_request,
            "POST",
            "training_runs",
            body=row,
        )
        if not created:
            raise RuntimeError("Supabase no devolvió la ejecución creada")
    except HTTPException:
        shutil.rmtree(temp_root, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_root, ignore_errors=True)
        logger.exception("Could not queue training run")
        raise HTTPException(status_code=503, detail="No se pudo guardar el análisis en Supabase") from exc

    background_tasks.add_task(execute_run, run_id, str(input_path), filename)
    return _public_run(created[0])


@app.get("/api/training/runs/{run_id}/files/{name}")
async def get_artifact(run_id: str, name: str, _: dict[str, Any] = Depends(require_admin)):
    if name not in ALLOWED_ARTIFACTS:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    try:
        rows = await run_in_threadpool(
            _db_request,
            "GET",
            _run_path(run_id),
            params={"select": "status,artifacts", "limit": "1"},
        )
        if not rows or rows[0].get("status") != "completed" or name not in (rows[0].get("artifacts") or []):
            raise HTTPException(status_code=404, detail="Archivo no encontrado")
        key = _supabase_key()
        headers = {"apikey": key}
        if not key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {key}"
        url = f"{_config('SUPABASE_URL').rstrip('/')}/storage/v1/object/{STORAGE_BUCKET}/{run_id}/{name}"
        response = await run_in_threadpool(requests.get, url, headers=headers, timeout=60)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="No se pudo descargar el resultado almacenado")
        content_type = "image/png" if name.endswith(".png") else "application/json" if name.endswith(".json") else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return Response(
            content=response.content,
            media_type=content_type,
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Could not download training artifact")
        raise HTTPException(status_code=503, detail="No se pudo descargar el resultado") from exc

