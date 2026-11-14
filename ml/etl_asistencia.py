"""
ETL 1 - Lee todos los 'RegistroAsistencia-*.xls' de SIGA y genera una tabla larga:
una fila por estudiante x asignatura x clase, con la fecha real de cada clase.

Uso:  python -m ml.etl_asistencia
"""
import re
import sys
import unicodedata
from concurrent.futures import ProcessPoolExecutor

import pandas as pd
import xlrd

from ml.config import ASISTENCIAS, CACHE

MESES = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
         "jul": 7, "ago": 8, "sep": 9, "set": 9, "oct": 10, "nov": 11, "dic": 12}
RE_FECHA = re.compile(r"^\s*\w+\s*-\s*(\d{1,2})\s*-\s*([a-zA-Z]{3})", re.UNICODE)
RE_ARCHIVO = re.compile(r"^RegistroAsistencia-(?P<carrera>.+)-(?P<num>\d{3})-(?P<paralelo>[^_]+)_(?P<jornada>.+)\.xls$")


def _norm(s):
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().strip()


def _anio(periodo, mes):
    """El reporte no trae el año. '-1P' cae completo en el año del periodo;
    '-2P' empieza en el segundo semestre y termina a inicios del año siguiente."""
    anio, parte = int(periodo[:4]), periodo[5]
    if parte == "2" and mes <= 6:
        return anio + 1
    return anio


def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def leer_archivo(args):
    periodo, ruta = args
    nombre = ruta.name
    m = RE_ARCHIVO.match(nombre)
    if not m:
        return None, f"nombre no reconocido: {periodo}/{nombre}"
    try:
        sh = xlrd.open_workbook(str(ruta)).sheet_by_index(0)
    except Exception as e:  # noqa: BLE001
        return None, f"no se pudo abrir {periodo}/{nombre}: {e!r}"

    fila_enc = None
    for r in range(min(sh.nrows, 30)):
        if any(str(v).strip() == "Nro. Clase" for v in sh.row_values(r)):
            fila_enc = r
            break
    if fila_enc is None:
        return None, f"sin encabezado: {periodo}/{nombre}"

    carrera_nombre = asignatura = nivel = ""
    for r in range(fila_enc):
        vals = [str(v).strip() for v in sh.row_values(r) if str(v).strip()]
        if not vals:
            continue
        if vals[0] == "NIVEL:" and len(vals) > 1:
            nivel = vals[1]
        elif r == 3:
            carrera_nombre = vals[0]
        elif r == 4:
            asignatura = vals[0]

    enc, fechas_fila = sh.row_values(fila_enc), sh.row_values(fila_enc + 1)
    col_ced = next(c for c, v in enumerate(enc) if str(v).strip() == "CEDULA")
    col_est = next(c for c, v in enumerate(enc) if str(v).strip() == "ESTUDIANTE")
    col_asist = next(c for c, v in enumerate(enc) if str(v).strip() == "ASIST")
    col_estado = next(c for c, v in enumerate(enc) if str(v).strip() == "Nro. Clase")

    clases = []  # (col, nro, fecha)
    for c in range(col_estado + 1, sh.ncols):
        mf = RE_FECHA.match(_norm(fechas_fila[c]))
        nro = _num(enc[c])
        if not mf or nro is None:
            continue
        mes = MESES.get(mf.group(2).lower())
        if not mes:
            continue
        try:
            fecha = pd.Timestamp(year=_anio(periodo, mes), month=mes, day=int(mf.group(1)))
        except ValueError:
            continue
        clases.append((c, int(nro), fecha))

    filas = []
    for r in range(fila_enc + 2, sh.nrows):
        row = sh.row_values(r)
        ced = str(row[col_ced]).strip()
        if isinstance(row[col_ced], float):
            ced = str(int(row[col_ced]))
        if not re.fullmatch(r"[0-9A-Za-z]{5,15}", ced) or _num(row[1]) is None:
            continue
        ced = ced.zfill(10) if ced.isdigit() else ced
        asist_final = _num(row[col_asist])
        estado = str(row[col_estado]).strip()
        nombre_est = str(row[col_est]).strip()
        for c, nro, fecha in clases:
            h = _num(row[c])
            filas.append((ced, nombre_est, asist_final, estado, nro, fecha, h))
    if not filas:
        return None, f"sin estudiantes o sin clases: {periodo}/{nombre}"

    df = pd.DataFrame(filas, columns=["cedula", "estudiante", "asist_pct_reporte", "estado_reporte",
                                      "nro_clase", "fecha", "horas_asistidas"])
    df["periodo"] = periodo
    df["carrera_sigla"] = m.group("carrera")
    df["carrera_nombre"] = carrera_nombre
    df["asignatura_cod"] = f"{m.group('carrera')}-{m.group('num')}"
    df["asignatura"] = asignatura
    df["nivel_num"] = int(m.group("num")[0])
    df["nivel"] = nivel
    df["paralelo"] = m.group("paralelo")
    df["jornada"] = m.group("jornada").upper()
    df["archivo"] = nombre
    return df, None


def main():
    tareas = []
    for carpeta in sorted(ASISTENCIAS.iterdir()):
        if carpeta.is_dir():
            tareas += [(carpeta.name, f) for f in sorted(carpeta.glob("RegistroAsistencia-*.xls"))]
    print(f"Archivos de asistencia: {len(tareas)}", flush=True)
    partes, errores = [], []
    with ProcessPoolExecutor() as ex:
        for i, (df, err) in enumerate(ex.map(leer_archivo, tareas, chunksize=40)):
            if err:
                errores.append(err)
            else:
                partes.append(df)
            if (i + 1) % 500 == 0:
                print(f"  {i + 1}/{len(tareas)}", flush=True)
    larga = pd.concat(partes, ignore_index=True)

    # Horas programadas de cada clase = máximo de horas registradas en esa clase (columna).
    clave = ["periodo", "archivo", "nro_clase"]
    larga["horas_clase"] = larga.groupby(clave)["horas_asistidas"].transform("max")
    larga["horas_asistidas"] = larga["horas_asistidas"].fillna(0.0)
    # Clase sin ninguna asistencia registrada en todo el curso: no se dictó o no se registró.
    larga["clase_valida"] = larga["horas_clase"].fillna(0) > 0

    larga.to_pickle(CACHE / "asistencia_larga.pkl")
    pd.Series(errores, dtype=str).to_csv(CACHE / "asistencia_errores.csv", index=False, header=["error"])
    print(f"Filas: {len(larga):,} | archivos ok: {len(partes)} | con error: {len(errores)}")
    for e in errores[:15]:
        print("  ERR", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
