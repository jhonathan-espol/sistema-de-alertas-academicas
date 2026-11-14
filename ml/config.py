"""Configuración común del pipeline de datos y modelos."""
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
# Carpeta con los reportes crudos de SIGA y ATENEA (NO se versiona: contiene datos personales).
REPORTES = Path(os.environ.get("REPORTES_DIR", RAIZ.parent / "REPORTES SIGA & ATENEA"))
ASISTENCIAS = REPORTES / "ASISTENCIAS Y NOTAS"
CACHE = RAIZ / "ml" / "cache"          # tablas intermedias (no se versionan)
SALIDAS = RAIZ / "ml" / "salidas"      # dataset, métricas, figuras, modelo (no se versionan)
for _d in (CACHE, SALIDAS):
    _d.mkdir(parents=True, exist_ok=True)

SEED = 42
DIA_CORTE = 28                 # ventana de predicción: días 1 a 28 desde el inicio de clases
LIMITE_INASISTENCIA = 30.0     # % de inasistencia que causa la reprobación de una asignatura
RECALL_OBJETIVO = 0.70         # punto de operación declarado antes de evaluar
B_BOOT = 2000

PERIODOS_CERRADOS = ["2023-2P", "2024-1P", "2024-2P", "2025-1P", "2025-2P", "2026-1P"]
PERIODO_EN_CURSO = "2026-2P"
PERIODO_PRUEBA = "2026-1P"     # cohorte cerrada más reciente: prueba retrospectiva final
