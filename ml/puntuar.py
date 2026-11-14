"""
Despliegue analítico: genera la tabla de alertas (una fila por estudiante presencial de primer nivel).

 - Grupo de detección (reglas determinísticas): retiro voluntario o inasistencia ya irreversible.
 - Grupo de predicción: puntaje del modelo, probabilidad calibrada, nivel de riesgo y los factores
   (SHAP) que más empujan la alerta de cada estudiante.
 - Periodos cerrados: el puntaje es SIEMPRE fuera de periodo (el modelo no vio esa cohorte).
 - Cohorte en curso: usa el mejor modelo cuyas variables estén disponibles para esa cohorte.

Uso:  python -m ml.puntuar
"""
import json
import sys

import joblib
import numpy as np
import pandas as pd

from ml.config import DIA_CORTE, SALIDAS
from ml.entrenar import shap_valores
from ml.variables import ETIQUETAS, matriz

PORCENTAJES = {"pct_inasistencia_d28", "max_pct_inasistencia_asig_d28", "pct_inasistencia_sem12", "pct_inasistencia_sem34"}
PROPORCIONES = {v for v in ETIQUETAS if v.startswith("prop_") or v == "racha_final_ausente_prop"}


def _valor(var, x):
    if pd.isna(x):
        return "sin dato"
    if var in PORCENTAJES:
        return f"{x:.0f} %"
    if var in PROPORCIONES:
        return f"{100 * x:.0f} %"
    if var == "log_ingreso_pc":
        return f"USD {np.expm1(x):.0f}"
    if float(x).is_integer():
        return f"{int(x)}"
    return f"{x:.1f}"


def factores(bundle, X, top=3):
    sv = shap_valores(bundle["pipeline"], bundle["X_ref"], X)
    out = []
    for i in range(len(X)):
        orden = np.argsort(-sv[i])[:top]
        out.append([dict(variable=X.columns[j], etiqueta=ETIQUETAS[X.columns[j]], valor=_valor(X.columns[j], X.iloc[i, j]),
                         aporte=round(float(sv[i, j]), 3)) for j in orden if sv[i, j] > 0])
    return out


def nivel(score, alto, medio):
    return np.where(score >= alto, "ALTO", np.where(score >= medio, "MEDIO", "BAJO"))


def main():
    ds = pd.read_pickle(SALIDAS / "dataset_primer_nivel.pkl")
    M = joblib.load(SALIDAS / "modelos.joblib")
    hist = pd.read_pickle(SALIDAS / "predicciones_historicas.pkl").set_index(["periodo", "id_estudiante"])
    fin, sel = M["finales"], M["seleccionado"]
    d = ds[ds.modalidad == "PRESENCIAL"].copy().reset_index(drop=True)
    d["puntaje"] = np.nan; d["probabilidad"] = np.nan; d["nivel_riesgo"] = None; d["modelo"] = None
    d["factores"] = [[] for _ in range(len(d))]
    d["motivo_deteccion"] = d.grupo.map({"DETECCION_RETIRO": "Retiro voluntario registrado",
                                         "DETECCION_INASISTENCIA_IRREVERSIBLE": "Inasistencia irreversible: ya superó el 30 % del total de horas de una asignatura"})
    d.loc[d.grupo != "PREDICCION", "nivel_riesgo"] = "DETECTADO"
    d["alerta_linea_base"] = d.pct_inasistencia_d28 >= M["thr_base"]
    resumen = []

    for periodo, g in d[d.grupo == "PREDICCION"].groupby("periodo"):
        cerrado = g.estado_periodo.iloc[0] == "CERRADO"
        if cerrado:
            idx = [i for i, e in zip(g.index, g.id_estudiante) if (periodo, e) in hist.index]
            if not idx:
                continue
            h = hist.loc[[(periodo, d.at[i, "id_estudiante"]) for i in idx]]
            conj, nombre = h.conjunto.iloc[0], h.nombre.iloc[0]
            b = fin[conj]
            score = h.score.values
            alto, medio = M["thr_hist"][conj]
            origen = f"{nombre} [{conj}] · predicción fuera de periodo"
        else:
            disponibles = ["A"]
            if g.sexo.notna().mean() > 0.5 and g.puntaje_admision.notna().mean() > 0.3:
                disponibles.append("B")
            if bool(g.tiene_datos_atenea.iloc[0]):
                disponibles.append("C")
            conj = max(disponibles, key=lambda c: fin[c]["cv_ap"])
            dias = int(g.dias_observados.max())
            if dias < DIA_CORTE and "H" in fin and fin["H"]["horizonte"] == dias:
                conj = "H"   # ventana incompleta: modelo entrenado con el mismo número de días observados
            b = fin[conj]
            idx = list(g.index)
            alto, medio = b["umbral_alto"], b["umbral_medio"]
            origen = (f"{b['nombre']} · asistencia de los primeros {dias} días" if conj == "H"
                      else f"{b['nombre']} [{conj}] · entrenado con {len(b['periodos'])} periodos cerrados")
        if not idx:
            continue
        X = d.loc[idx, b["columnas"]].astype(float) if conj == "H" else matriz(d.loc[idx], conj)
        if not cerrado:
            score = b["pipeline"].predict_proba(X)[:, 1]
        d.loc[idx, "puntaje"] = score
        d.loc[idx, "probabilidad"] = fin[conj]["calibrador"].predict(score)
        d.loc[idx, "nivel_riesgo"] = nivel(score, alto, medio)
        d.loc[idx, "modelo"] = origen
        for i, f in zip(idx, factores(b, X)):
            d.at[i, "factores"] = f
        resumen.append(dict(periodo=periodo, estado="CERRADO" if cerrado else "EN_CURSO", modelo=origen, conjunto=conj,
                            umbral_alto=round(float(alto), 4), umbral_medio=round(float(medio), 4), estudiantes=len(idx),
                            dias_observados=int(d.loc[idx, "dias_observados"].max()),
                            ventana_completa=bool(d.loc[idx, "dias_observados"].max() >= DIA_CORTE),
                            **{k: int(v) for k, v in pd.Series(d.loc[idx, "nivel_riesgo"]).value_counts().items()}))

    d.loc[d.nivel_riesgo.isna(), "nivel_riesgo"] = "SIN_PUNTAJE"
    d.to_pickle(SALIDAS / "alertas.pkl")
    json.dump(resumen, open(SALIDAS / "resumen_puntuacion.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    pd.set_option("display.width", 250)
    print(pd.DataFrame(resumen).fillna(0).to_string(index=False))
    c = d[(d.estado_periodo == "CERRADO") & (d.grupo == "PREDICCION")]
    print("\nTasa real de reprobación por inasistencias según nivel (periodos cerrados, fuera de periodo):")
    print(c.groupby(["periodo", "nivel_riesgo"]).y.agg(["size", "mean"]).round(3).unstack().to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
