"""
ETL 2 - Lee los 'RegistroNotas-*.xls' (promoción final por asignatura). Solo se usa para
construir el DESENLACE (nunca como predictor: las notas parciales son posteriores al día 28).

Uso:  python -m ml.etl_notas
"""
import re
import sys
from concurrent.futures import ProcessPoolExecutor

import pandas as pd
import xlrd

from ml.config import ASISTENCIAS, CACHE
from ml.etl_asistencia import _num

RE_ARCHIVO = re.compile(r"^RegistroNotas-(?P<carrera>.+)-(?P<num>\d{3})-(?P<paralelo>[^_]+)_(?P<jornada>.+)\.xls$")


def leer_archivo(args):
    periodo, ruta = args
    m = RE_ARCHIVO.match(ruta.name)
    if not m:
        return None
    try:
        sh = xlrd.open_workbook(str(ruta)).sheet_by_index(0)
    except Exception:  # noqa: BLE001
        return None
    fila_enc = None
    for r in range(min(sh.nrows, 30)):
        vals = [str(v).strip() for v in sh.row_values(r)]
        if "CEDULA" in vals and "PROMOCION" in vals:
            fila_enc = r
            break
    if fila_enc is None:
        return None
    enc = [str(v).strip() for v in sh.row_values(fila_enc)]
    c_ced, c_asist, c_nf, c_prom = enc.index("CEDULA"), enc.index("ASIST"), enc.index("NF"), enc.index("PROMOCION")
    filas = []
    for r in range(fila_enc + 1, sh.nrows):
        row = sh.row_values(r)
        ced = str(int(row[c_ced])) if isinstance(row[c_ced], float) else str(row[c_ced]).strip()
        if not re.fullmatch(r"[0-9A-Za-z]{5,15}", ced) or _num(row[1]) is None:
            continue
        ced = ced.zfill(10) if ced.isdigit() else ced
        filas.append((periodo, f"{m.group('carrera')}-{m.group('num')}", m.group("paralelo"), m.group("jornada").upper(),
                      ced, _num(str(row[c_asist]).replace("%", "")), _num(row[c_nf]), str(row[c_prom]).strip()))
    return pd.DataFrame(filas, columns=["periodo", "asignatura_cod", "paralelo", "jornada", "cedula",
                                        "asist_pct_notas", "nota_final", "promocion"])


def main():
    tareas = []
    for carpeta in sorted(ASISTENCIAS.iterdir()):
        if carpeta.is_dir():
            tareas += [(carpeta.name, f) for f in sorted(carpeta.glob("RegistroNotas-*.xls"))]
    print(f"Archivos de notas: {len(tareas)}", flush=True)
    with ProcessPoolExecutor() as ex:
        partes = [d for d in ex.map(leer_archivo, tareas, chunksize=40) if d is not None and len(d)]
    notas = pd.concat(partes, ignore_index=True)
    notas.to_pickle(CACHE / "notas_finales.pkl")
    print(f"Filas: {len(notas):,} | archivos ok: {len(partes)}")
    print(notas.groupby(["periodo", "promocion"]).size().unstack(fill_value=0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
