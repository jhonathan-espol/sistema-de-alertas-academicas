"""
Ejecuta el pipeline completo, en orden:
  1. ETL de asistencia (SIGA)          5. Entrenamiento y evaluación
  2. ETL de notas finales (SIGA)       6. Puntuación de cohortes (alertas)
  3. Construcción del dataset d28      7. Carga a PostgreSQL (DATABASE_URL)
  4. Dataset único de entrenamiento

Uso:
    python -m ml.pipeline              # todo
    python -m ml.pipeline --sin-etl    # reutiliza la caché de los reportes ya leídos
    python -m ml.pipeline --sin-bd     # no carga a la base de datos
"""
import subprocess
import sys
import time

PASOS = [("ml.etl_asistencia", "etl"), ("ml.etl_notas", "etl"), ("ml.construir_dataset", None),
         ("ml.dataset_entrenamiento", None), ("ml.entrenar", None), ("ml.puntuar", None), ("ml.cargar_bd", "bd")]


def main():
    omitir = {"etl" if "--sin-etl" in sys.argv else None, "bd" if "--sin-bd" in sys.argv else None}
    for modulo, grupo in PASOS:
        if grupo in omitir and grupo is not None:
            print(f"--- {modulo}: omitido")
            continue
        t = time.time()
        print(f"\n=== {modulo} ===", flush=True)
        if subprocess.run([sys.executable, "-m", modulo]).returncode != 0:
            print(f"El paso {modulo} falló. Se detiene el pipeline.")
            return 1
        print(f"--- {modulo}: {time.time() - t:.0f} s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
