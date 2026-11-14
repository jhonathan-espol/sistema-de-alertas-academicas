"""
Dataset único de entrenamiento: una fila por estudiante y periodo, con todos los predictores de los tres
modelos (Regresión Logística, Random Forest y XGBoost), la variable objetivo y la partición temporal.

Reúne en un solo archivo lo que antes estaba repartido entre los reportes de SIGA (asistencia, notas,
matrículas), ATENEA (actividades), CAC (admisión) y la ficha socioeconómica.

 - Alcance: primer nivel, modalidad PRESENCIAL, periodos cerrados, grupo de predicción (activos al día 28).
 - Los predictores usan solo información de los días 1 a 28; ya vienen codificados como números.
 - Los datos faltantes se conservan vacíos: la imputación ocurre dentro de cada modelo, en cada pliegue
   de la validación cruzada, para no filtrar información de la prueba al entrenamiento.
 - Sin cédulas ni nombres (id_estudiante es un seudónimo).

Salidas en ml/salidas:
    dataset_entrenamiento.csv    archivo que lee ml.entrenar
    dataset_entrenamiento.xlsx   la misma tabla (hoja "datos") más el diccionario de variables

Uso:  python -m ml.dataset_entrenamiento
"""
import sys

import pandas as pd

from ml.config import PERIODO_PRUEBA, SALIDAS
from ml.variables import ASISTENCIA, ATENEA, CONJUNTOS, CONTEXTO, ETIQUETAS, codificar

RUTA = SALIDAS / "dataset_entrenamiento.csv"
OBJETIVO = "y_reprueba_inasistencias"
FECHAS = ["fecha_inicio_clases", "fecha_corte_d28"]

IDENT = {
    "id_estudiante": "Seudónimo del estudiante (no es la cédula)",
    "periodo": "Periodo académico de la cohorte",
    "particion": "ENTRENAMIENTO (periodos anteriores) o PRUEBA (cohorte cerrada más reciente)",
    "carrera": "Carrera",
    "paralelo": "Paralelo",
    "jornada": "Jornada",
    "fecha_inicio_clases": "Día 1: primera clase registrada del grupo del estudiante",
    "fecha_corte_d28": "Fecha en que se cumple el día 28 con control de asistencia",
    "dias_sin_control_asistencia": "Días excluidos del conteo por un tramo sin control de asistencia",
    "tiene_datos_atenea": "El periodo tiene datos de la plataforma virtual (requisito del conjunto C)",
}
AUXILIARES = {
    "nivel_socioeconomico": "Quintil de ingreso per cápita del hogar (solo para el análisis de equidad)",
    "prop_asig_reprobadas_inasistencias": "Proporción de asignaturas reprobadas por inasistencias al cierre (análisis de sensibilidad)",
    "via_salida": "Desenlace del periodo al cierre (descriptivo)",
    "continua_periodo_siguiente": "1 si se matricula en el periodo siguiente (descriptivo)",
}


def leer():
    """Lee el dataset de entrenamiento tal como lo usa ml.entrenar."""
    d = pd.read_csv(RUTA, encoding="utf-8-sig", parse_dates=FECHAS, float_precision="round_trip")
    return d.rename(columns={OBJETIVO: "y", "carrera": "carrera_nombre", "fecha_corte_d28": "fecha_corte"})


def _fuente(c):
    if c in ASISTENCIA:
        return "SIGA: registros de asistencia"
    if c in ATENEA:
        return "ATENEA: actividades académicas"
    if c == "puntaje_admision":
        return "CAC: admisión"
    if c in ("jornada_nocturna", "jornada_vespertina"):
        return "SIGA: grupo del estudiante"
    if c == "edad_anios":
        return "Ficha socioeconómica / CAC"
    return "Ficha socioeconómica"


def main():
    ds = pd.read_pickle(SALIDAS / "dataset_primer_nivel.pkl")
    G = ds[(ds.estado_periodo == "CERRADO") & (ds.modalidad == "PRESENCIAL") & (ds.grupo == "PREDICCION")].reset_index(drop=True)

    out = pd.DataFrame({
        "id_estudiante": G.id_estudiante, "periodo": G.periodo,
        "particion": G.periodo.map(lambda p: "PRUEBA" if p == PERIODO_PRUEBA else "ENTRENAMIENTO"),
        "carrera": G.carrera_nombre, "paralelo": G.paralelo, "jornada": G.jornada,
        "fecha_inicio_clases": G.fecha_inicio_clases.dt.date, "fecha_corte_d28": G.fecha_corte.dt.date,
        "dias_sin_control_asistencia": G.dias_sin_control_asistencia.astype(int),
        "tiene_datos_atenea": G.tiene_datos_atenea.astype(bool),
    })
    out = pd.concat([out, codificar(G)], axis=1)
    out[OBJETIVO] = G.y.astype(int)
    for c in AUXILIARES:
        out[c] = G[c]

    assert not out.duplicated(["id_estudiante", "periodo"]).any(), "Hay estudiantes repetidos en un mismo periodo"
    assert out[OBJETIVO].isin([0, 1]).all()
    out.to_csv(RUTA, index=False, encoding="utf-8-sig")

    predictores = ASISTENCIA + ATENEA + CONTEXTO
    filas = [dict(columna=c, rol="Identificación", descripcion=t, conjuntos="", fuente="") for c, t in IDENT.items()]
    filas += [dict(columna=c, rol="Predictor", descripcion=ETIQUETAS[c],
                   conjuntos=", ".join(k for k, (_, v) in CONJUNTOS.items() if c in v), fuente=_fuente(c)) for c in predictores]
    filas.append(dict(columna=OBJETIVO, rol="Objetivo", conjuntos="", fuente="SIGA: asistencia y notas al cierre",
                      descripcion="1 si reprueba por inasistencias al menos una asignatura al cierre del periodo; 0 en caso contrario"))
    filas += [dict(columna=c, rol="Auxiliar (no es predictor)", descripcion=t, conjuntos="", fuente="") for c, t in AUXILIARES.items()]
    dic = pd.DataFrame(filas)
    dic["faltantes_pct"] = [round(100 * out[c].isna().mean(), 1) for c in dic.columna]
    assert list(dic.columna) == list(out.columns)

    resumen = out.groupby(["periodo", "particion"]).agg(
        estudiantes=(OBJETIVO, "size"), positivos=(OBJETIVO, "sum"),
        con_datos_atenea=("tiene_datos_atenea", "first")).reset_index()
    resumen["tasa_positivos_pct"] = (100 * resumen.positivos / resumen.estudiantes).round(1)

    with pd.ExcelWriter(SALIDAS / "dataset_entrenamiento.xlsx", engine="openpyxl") as xw:
        out.to_excel(xw, sheet_name="datos", index=False)
        dic.to_excel(xw, sheet_name="diccionario", index=False)
        resumen.to_excel(xw, sheet_name="resumen", index=False)
        for ws in xw.book.worksheets:
            ws.freeze_panes = "A2"
            for c in ws[1]:
                c.font = c.font.copy(bold=True)
            for col in ws.columns:
                w = max(len(str(c.value)) if c.value is not None else 0 for c in col[:200])
                ws.column_dimensions[col[0].column_letter].width = min(max(10, w + 2), 80)

    print(f"Dataset de entrenamiento: {len(out)} filas x {out.shape[1]} columnas "
          f"({len(predictores)} predictores) -> {RUTA}")
    print(resumen.to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
