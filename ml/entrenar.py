"""
Modelado y evaluación (CRISP-DM).

 - Alcance: primer nivel, modalidad PRESENCIAL, grupo de predicción (activos al día 28), periodos cerrados.
 - Partición temporal: entrenamiento = periodos anteriores; prueba = cohorte cerrada más reciente.
 - Línea base: % de inasistencia al día 28 (umbral que maximiza F1 en entrenamiento).
 - Modelos: Regresión Logística, Random Forest y XGBoost; hiperparámetros por validación cruzada
   estratificada repetida DENTRO del entrenamiento (la prueba no interviene en ninguna decisión).
 - Intervalos de confianza por bootstrap, robustez por periodo omitido, equidad por subgrupos y SHAP.

Uso:  python -m ml.entrenar
"""
import json
import sys
import warnings
from datetime import datetime

import joblib
import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import shap  # noqa: E402
from imblearn.over_sampling import SMOTE  # noqa: E402
from imblearn.pipeline import Pipeline as ImbPipeline  # noqa: E402
from sklearn.base import clone  # noqa: E402
from sklearn.ensemble import RandomForestClassifier  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.isotonic import IsotonicRegression  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score  # noqa: E402
from sklearn.model_selection import GridSearchCV, RepeatedStratifiedKFold, StratifiedKFold, cross_val_predict  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from xgboost import XGBClassifier  # noqa: E402

from ml import dataset_entrenamiento
from ml.config import B_BOOT, PERIODO_PRUEBA, PERIODOS_CERRADOS, RECALL_OBJETIVO, SALIDAS, SEED
from ml.variables import CONJUNTOS, ETIQUETAS, matriz

warnings.filterwarnings("ignore")
rng = np.random.default_rng(SEED)
NOMBRES = ["Regresión Logística", "Random Forest", "XGBoost"]
BASE = "Línea base (inasistencia día 28)"
METR = ["AUC_PR", "AUC_ROC", "Recall", "Precision", "F1", "Tasa_alerta"]


# ------------------------------------------------------------------ utilidades
def umbral_recall(score, y, objetivo):
    """Mayor umbral con recall >= objetivo (alerta si score >= umbral)."""
    cand = np.unique(score)[::-1]
    for t in cand:
        if (score[y == 1] >= t).mean() >= objetivo:
            return float(t)
    return float(cand[-1])


TASA_MAX_SEGUIMIENTO = 0.60


def umbral_medio(score, y):
    """Umbral del nivel MEDIO: el que captura al 90 % de los casos. Si para lograrlo hubiera que señalar a más
    del 60 % de la cohorte (ocurre cuando muchos estudiantes sin ninguna señal comparten el mismo puntaje),
    el nivel deja de informar: se sube el umbral hasta que alto + medio no superen ese 60 %."""
    t = umbral_recall(score, y, 0.90)
    if (score >= t).mean() > TASA_MAX_SEGUIMIENTO:
        cand = [v for v in np.unique(score) if (score >= v).mean() <= TASA_MAX_SEGUIMIENTO]
        t = float(min(cand)) if cand else t
    return t


def umbral_f1(score, y):
    mejor_t, mejor_f = float(np.max(score)), -1.0
    for t in np.unique(score):
        pred = score >= t
        tp = (pred & (y == 1)).sum()
        if tp == 0:
            continue
        prec, rec = tp / pred.sum(), tp / (y == 1).sum()
        f = 2 * prec * rec / (prec + rec)
        if f > mejor_f:
            mejor_t, mejor_f = float(t), f
    return mejor_t


def umbral_tasa(score, tasa):
    """Umbral que alerta aproximadamente a la fracción 'tasa' de estudiantes."""
    return float(np.quantile(score, 1 - tasa, method="higher"))


def metricas(y, s, thr):
    pred = s >= thr
    tp = (pred & (y == 1)).sum(); fp = (pred & (y == 0)).sum(); fn = ((~pred) & (y == 1)).sum()
    rec = tp / max(tp + fn, 1); prec = tp / max(tp + fp, 1)
    f1 = 2 * prec * rec / max(prec + rec, 1e-9)
    return dict(AUC_PR=average_precision_score(y, s), AUC_ROC=roc_auc_score(y, s),
                Recall=rec, Precision=prec, F1=f1, Tasa_alerta=pred.mean())


def recall_top(y, s, k, desempate):
    n = int(round(k * len(y)))
    idx = np.argsort(-(s + desempate * 1e-9))[:n]
    return y[idx].sum() / max(y.sum(), 1)


def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n; d = 1 + z ** 2 / n
    c = (p + z ** 2 / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z ** 2 / (4 * n ** 2)) / d
    return (max(0, c - h), min(1, c + h))


def modelo(nombre, spw):
    imp = ("imp", SimpleImputer(strategy="median"))
    if nombre == "Regresión Logística":
        pipe = Pipeline([imp, ("sc", StandardScaler()),
                         ("m", LogisticRegression(class_weight="balanced", max_iter=5000))])
        grid = {"m__C": [0.01, 0.03, 0.1, 0.3, 1, 3]}
    elif nombre == "Random Forest":
        pipe = Pipeline([imp, ("m", RandomForestClassifier(n_estimators=400, class_weight="balanced_subsample",
                                                            n_jobs=-1, random_state=SEED))])
        grid = {"m__max_depth": [3, 5, 8], "m__min_samples_leaf": [5, 15, 30]}
    else:
        pipe = Pipeline([imp, ("m", XGBClassifier(subsample=0.8, colsample_bytree=0.8, min_child_weight=5,
                                                  scale_pos_weight=spw, eval_metric="logloss",
                                                  tree_method="hist", n_jobs=4, random_state=SEED))])
        grid = {"m__max_depth": [2, 3, 4], "m__n_estimators": [100, 300], "m__learning_rate": [0.03, 0.1]}
    return pipe, grid


def shap_valores(pipe, X_ref, X):
    """Valores SHAP de la clase positiva en el espacio de las variables originales."""
    pre, est = pipe[:-1], pipe[-1]
    Xt = pre.transform(X)
    if isinstance(est, LogisticRegression):
        sv = shap.LinearExplainer(est, pre.transform(X_ref)).shap_values(Xt)
    else:
        sv = shap.TreeExplainer(est).shap_values(Xt)
        if isinstance(sv, list):
            sv = sv[1]
        elif getattr(sv, "ndim", 2) == 3:
            sv = sv[:, :, 1]
    return np.asarray(sv)


def r(x, n=3):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


# ------------------------------------------------------------------ datos y alcance
def main():
    ds = pd.read_pickle(SALIDAS / "dataset_primer_nivel.pkl")
    cer = ds[ds.estado_periodo == "CERRADO"]
    pres = cer[cer.modalidad == "PRESENCIAL"]
    # Los modelos se entrenan y evalúan ÚNICAMENTE con el dataset de entrenamiento (un solo archivo);
    # el dataset de primer nivel solo aporta los conteos descriptivos de la población (alcance y perfil).
    G = dataset_entrenamiento.leer()
    assert len(G) == (pres.grupo == "PREDICCION").sum(), "Regenera el dataset: python -m ml.dataset_entrenamiento"
    TRAIN_P = [p for p in PERIODOS_CERRADOS if p < PERIODO_PRUEBA]
    tr, te = G[G.periodo.isin(TRAIN_P)], G[G.periodo == PERIODO_PRUEBA]
    ytr, yte = tr.y.values, te.y.values
    print(f"Entrenamiento {TRAIN_P}: {len(tr)} / {ytr.sum()} positivos | Prueba {PERIODO_PRUEBA}: {len(te)} / {yte.sum()}", flush=True)

    perf = []
    for p, g in pres.groupby("periodo"):
        gg = G[G.periodo == p]
        perf.append(dict(periodo=p, estudiantes=len(g),
                         aprueba=int((g.via_salida == "PERMANECE_APRUEBA").sum()),
                         reprueba_rendimiento=int((g.via_salida == "PERMANECE_REPRUEBA_RENDIMIENTO").sum()),
                         reprueba_inasistencias=int((g.via_salida == "REPRUEBA_INASISTENCIAS").sum()),
                         retiro_voluntario=int((g.via_salida == "RETIRO_VOLUNTARIO").sum()),
                         irreversibles_d28=int((g.grupo == "DETECCION_INASISTENCIA_IRREVERSIBLE").sum()),
                         grupo_prediccion=len(gg), positivos=int(gg.y.sum()),
                         tasa_positivos_pct=r(gg.y.mean() * 100, 1),
                         inicio_clases=str(gg.fecha_inicio_clases.min().date()),
                         dias_sin_control_asistencia=int(gg.dias_sin_control_asistencia.max()),
                         corte_d28=str(gg.fecha_corte.min().date()),
                         pct_con_alguna_inasistencia_d28=r((gg.pct_inasistencia_d28 > 0).mean() * 100, 1),
                         positivos_sin_inasistencia_d28_pct=r((gg[gg.y == 1].pct_inasistencia_d28 == 0).mean() * 100, 1),
                         positivos_que_no_continuan_pct=r((1 - gg[gg.y == 1].continua_periodo_siguiente.mean()) * 100, 1),
                         negativos_que_no_continuan_pct=r((1 - gg[gg.y == 0].continua_periodo_siguiente.mean()) * 100, 1),
                         rol="PRUEBA" if p == PERIODO_PRUEBA else "ENTRENAMIENTO"))
    perf = pd.DataFrame(perf)

    alcance = [
        ["Estudiantes de primer nivel en periodos cerrados (presencial + dual)", len(cer)],
        ["  modalidad DUAL (fuera del alcance)", int((cer.modalidad == "DUAL").sum())],
        ["Estudiantes presenciales en periodos cerrados", len(pres)],
        ["  grupo de detección: retiros voluntarios", int((pres.grupo == "DETECCION_RETIRO").sum())],
        ["  grupo de detección: inasistencia irreversible al día 28", int((pres.grupo == "DETECCION_INASISTENCIA_IRREVERSIBLE").sum())],
        ["Grupo de predicción (presencial, activo al día 28)", len(G)],
        ["  positivos (reprobados por inasistencias)", int(G.y.sum())],
        ["  tasa de positivos (%)", r(G.y.mean() * 100, 1)],
        [f"Entrenamiento ({TRAIN_P[0]} a {TRAIN_P[-1]}): estudiantes / positivos", f"{len(tr)} / {int(ytr.sum())}"],
        [f"Prueba retrospectiva ({PERIODO_PRUEBA}): estudiantes / positivos", f"{len(te)} / {int(yte.sum())}"],
        ["Techo de predictores (10 eventos por variable, entrenamiento)", int(ytr.sum() // 10)],
        ["Positivos que reprobaron TODAS sus asignaturas por inasistencias", int((G[G.y == 1].prop_asig_reprobadas_inasistencias == 1).sum())],
        ["Positivos que reprobaron solo PARTE de sus asignaturas por inasistencias", int((G[G.y == 1].prop_asig_reprobadas_inasistencias < 1).sum())],
    ]

    criterios = [
        ["C1", "El modelo seleccionado (por AUC-PR en validación cruzada del entrenamiento) supera a la línea base en AUC-PR de prueba, con IC 95 % de la diferencia que excluya 0."],
        ["C2", "A igual carga de trabajo (misma tasa de alerta que la línea base), el modelo seleccionado alcanza mayor sensibilidad (Recall) que la línea base en prueba."],
        ["C3", "Añadir admisión/contexto (B) o plataforma virtual (C) mejora el AUC-PR de prueba respecto al conjunto solo de asistencia (A)."],
        ["C4", "Ningún subgrupo (sexo, nivel socioeconómico, jornada, zona, edad, situación laboral) presenta una tasa de falsos negativos superior en más de 10 puntos a la general con IC que excluya la tasa general."],
    ]

    # ------------------------------------------------------------------ línea base
    base_tr, base_te = tr.pct_inasistencia_d28.values, te.pct_inasistencia_d28.values
    thr_base = umbral_f1(base_tr, ytr)
    thr_base_r70 = umbral_recall(base_tr, ytr, RECALL_OBJETIVO)
    tasa_base_tr = float((base_tr >= thr_base).mean())
    print(f"Línea base: umbral F1 máx. = {thr_base:.2f} % (tasa de alerta en entrenamiento {tasa_base_tr:.3f}); "
          f"umbral Recall>=0.70 = {thr_base_r70:.2f}", flush=True)

    # ------------------------------------------------------------------ modelos
    cv_tune = RepeatedStratifiedKFold(n_splits=5, n_repeats=2, random_state=SEED)
    cv_oof = StratifiedKFold(5, shuffle=True, random_state=SEED)
    res = {}
    for conj in CONJUNTOS:
        # el conjunto C solo puede entrenarse con periodos que tienen datos de la plataforma
        trc = tr[tr.tiene_datos_atenea] if conj == "C" else tr
        Xtr, ytrc, Xte = matriz(trc, conj), trc.y.values, matriz(te, conj)
        spw = (ytrc == 0).sum() / (ytrc == 1).sum()
        for n in NOMBRES:
            pipe, grid = modelo(n, spw)
            gs = GridSearchCV(pipe, grid, scoring="average_precision", cv=cv_tune, n_jobs=1, refit=True)
            gs.fit(Xtr, ytrc)
            best = gs.best_estimator_
            oof = cross_val_predict(clone(best), Xtr, ytrc, cv=cv_oof, method="predict_proba")[:, 1]
            res[(n, conj)] = dict(cv_ap=float(gs.best_score_), cv_sd=float(gs.cv_results_["std_test_score"][gs.best_index_]),
                                  params=gs.best_params_, best=best, Xtr=Xtr, Xte=Xte, ytr=ytrc, oof=oof,
                                  thr=umbral_recall(oof, ytrc, RECALL_OBJETIVO), thr_carga=umbral_tasa(oof, tasa_base_tr),
                                  pte=best.predict_proba(Xte)[:, 1], n_train=len(trc), pos_train=int(ytrc.sum()),
                                  periodos_train=sorted(trc.periodo.unique()))
            print(f"{n} [{conj}] CV AUC-PR={gs.best_score_:.3f} {gs.best_params_}", flush=True)

    # Comparación justa entre conjuntos: C solo dispone de los periodos con plataforma virtual, así que el
    # AUC-PR de validación cruzada de A y B se recalcula sobre esos MISMOS periodos antes de seleccionar.
    tr_c = tr[tr.tiene_datos_atenea]
    for k, v in res.items():
        if k[1] == "C":
            v["cv_comun"] = v["cv_ap"]
        else:
            Xc, yc = matriz(tr_c, k[1]), tr_c.y.values
            v["cv_comun"] = float(np.mean([average_precision_score(yc[b_], clone(v["best"]).fit(Xc.iloc[a_], yc[a_]).predict_proba(Xc.iloc[b_])[:, 1])
                                           for a_, b_ in cv_tune.split(Xc, yc)]))
        print(f"{k[0]} [{k[1]}] CV AUC-PR en periodos comunes = {v['cv_comun']:.3f}", flush=True)

    # selección por validación cruzada del entrenamiento (nunca por la prueba)
    sel = max(res, key=lambda k: res[k]["cv_comun"])
    selA = max([k for k in res if k[1] == "A"], key=lambda k: res[k]["cv_ap"])
    print("Seleccionado por CV:", sel, "| mejor solo-asistencia:", selA, flush=True)

    # ------------------------------------------------------------------ evaluación en prueba con IC
    sc = {BASE: (base_te, thr_base, thr_base)}
    for (n, c), v in res.items():
        sc[f"{n} [{c}]"] = (v["pte"], v["thr"], v["thr_carga"])
    n_te = len(yte)
    boots = {k: {m: [] for m in METR + ["Recall_carga", "Tasa_carga"]} for k in sc}
    for _ in range(B_BOOT):
        idx = rng.integers(0, n_te, n_te); yb = yte[idx]
        if yb.sum() in (0, n_te):
            continue
        for k, (s, t, tc) in sc.items():
            m = metricas(yb, s[idx], t)
            for mk in METR:
                boots[k][mk].append(m[mk])
            mc = metricas(yb, s[idx], tc)
            boots[k]["Recall_carga"].append(mc["Recall"]); boots[k]["Tasa_carga"].append(mc["Tasa_alerta"])
    ic = lambda a: [r(np.percentile(a, 2.5)), r(np.percentile(a, 97.5))]  # noqa: E731

    tabla = []
    m_base = metricas(yte, base_te, thr_base)
    for k, (s, t, tc) in sc.items():
        m, mc = metricas(yte, s, t), metricas(yte, s, tc)
        fila = dict(modelo=k, es_base=k == BASE, umbral=r(t, 4))
        for mk in METR:
            fila[mk] = r(m[mk]); fila[mk + "_IC95"] = ic(boots[k][mk])
        fila["Recall_igual_carga"] = r(mc["Recall"]); fila["Recall_igual_carga_IC95"] = ic(boots[k]["Recall_carga"])
        fila["Tasa_alerta_igual_carga"] = r(mc["Tasa_alerta"])
        if k != BASE:
            nombre, conj = k.split(" [")[0], k.split("[")[1][0]
            v = res[(nombre, conj)]
            d_ap = np.array(boots[k]["AUC_PR"]) - np.array(boots[BASE]["AUC_PR"])
            d_rc = np.array(boots[k]["Recall_carga"]) - np.array(boots[BASE]["Recall"])
            fila.update(nombre=nombre, conjunto=conj, conjunto_desc=CONJUNTOS[conj][0], n_variables=len(CONJUNTOS[conj][1]),
                        cv_auc_pr=r(v["cv_ap"]), cv_sd=r(v["cv_sd"]), cv_auc_pr_periodos_comunes=r(v["cv_comun"]),
                        hiperparametros={a.replace("m__", ""): b for a, b in v["params"].items()},
                        n_entrenamiento=v["n_train"], positivos_entrenamiento=v["pos_train"],
                        periodos_entrenamiento=v["periodos_train"],
                        dif_AUC_PR_vs_base=r(m["AUC_PR"] - m_base["AUC_PR"]), dif_AUC_PR_IC95=ic(d_ap),
                        dif_Recall_igual_carga_vs_base=r(mc["Recall"] - m_base["Recall"]), dif_Recall_IC95=ic(d_rc),
                        seleccionado=(nombre, conj) == sel)
        tabla.append(fila)
    tabla_df = pd.DataFrame(tabla)
    prevalencia = float(yte.mean())

    # recall a tasas de alerta fijas (comparación de carga de trabajo)
    des = rng.random(n_te); carga = []
    for kq in [0.2, 0.3, 0.4, 0.5]:
        for k, (s, _, _) in sc.items():
            bs = []
            for _ in range(500):
                i = rng.integers(0, n_te, n_te)
                if yte[i].sum() == 0:
                    continue
                bs.append(recall_top(yte[i], s[i], kq, des[i]))
            carga.append(dict(tasa_alerta=int(kq * 100), modelo=k, recall=r(recall_top(yte, s, kq, des)),
                              ic95=[r(np.percentile(bs, 2.5), 2), r(np.percentile(bs, 97.5), 2)]))

    # ------------------------------------------------------------------ pesos de clase vs SMOTE (solo entrenamiento)
    smote = []
    for n in ["Regresión Logística", "Random Forest"]:
        v = res[(n, sel[1])]
        X, yy = v["Xtr"], v["ytr"]
        ap_w = np.mean([average_precision_score(yy[b], clone(v["best"]).fit(X.iloc[a], yy[a]).predict_proba(X.iloc[b])[:, 1])
                        for a, b in cv_tune.split(X, yy)])
        params = {k.replace("m__", ""): val for k, val in v["params"].items()}
        if n == "Regresión Logística":
            ps = ImbPipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()),
                              ("sm", SMOTE(random_state=SEED)), ("m", LogisticRegression(max_iter=5000, **params))])
        else:
            ps = ImbPipeline([("imp", SimpleImputer(strategy="median")), ("sm", SMOTE(random_state=SEED)),
                              ("m", RandomForestClassifier(n_estimators=400, n_jobs=-1, random_state=SEED, **params))])
        ap_s = np.mean([average_precision_score(yy[b], clone(ps).fit(X.iloc[a], yy[a]).predict_proba(X.iloc[b])[:, 1])
                        for a, b in cv_tune.split(X, yy)])
        smote.append(dict(modelo=n, conjunto=sel[1], AUC_PR_pesos_de_clase=r(ap_w), AUC_PR_SMOTE=r(ap_s)))

    # ------------------------------------------------------------------ robustez: un periodo fuera cada vez
    periodos = sorted(G.periodo.unique())
    lopo, pooled = [], {}
    for (n, conj), v in res.items():
        Gc = G[G.tiene_datos_atenea] if conj == "C" else G
        XG = matriz(Gc, conj)
        oofp = pd.Series(np.nan, index=G.index)
        for p in sorted(Gc.periodo.unique()):
            a, b = (Gc.periodo != p).values, (Gc.periodo == p).values
            spw = (Gc.y[a] == 0).sum() / (Gc.y[a] == 1).sum()
            pipe, _ = modelo(n, spw); pipe.set_params(**v["params"])
            oofp.loc[Gc.index[b]] = pipe.fit(XG[a], Gc.y[a]).predict_proba(XG[b])[:, 1]
        pooled[(n, conj)] = oofp
        for p in periodos:
            mk = (G.periodo == p).values & oofp.notna().values
            if mk.sum():
                lopo.append(dict(periodo=p, modelo=f"{n} [{conj}]", AUC_PR=r(average_precision_score(G.y[mk], oofp[mk])),
                                 AUC_ROC=r(roc_auc_score(G.y[mk], oofp[mk]))))
    for p in periodos:
        mk = (G.periodo == p).values
        lopo.append(dict(periodo=p, modelo=BASE, AUC_PR=r(average_precision_score(G.y[mk], G.pct_inasistencia_d28[mk])),
                         AUC_ROC=r(roc_auc_score(G.y[mk], G.pct_inasistencia_d28[mk]))))
        lopo.append(dict(periodo=p, modelo="Prevalencia (referencia)", AUC_PR=r(G.y[mk].mean()), AUC_ROC=0.5))

    # ------------------------------------------------------------------ equidad por subgrupos (predicciones fuera de periodo)
    vs = res[sel]
    sp = pooled[sel]
    Ge = G[sp.notna()].copy(); Ge["score"] = sp[sp.notna()]
    Ge["alerta_modelo"] = (Ge.score >= vs["thr"]).astype(int)
    Ge["alerta_base"] = (Ge.pct_inasistencia_d28 >= thr_base).astype(int)
    Ge["g_sexo"] = Ge.sexo_M.map({1.0: "Hombre", 0.0: "Mujer"}).fillna("Sin dato")
    Ge["g_nse"] = Ge.nivel_socioeconomico.map({"Q1": "Q1-Q2 (menor ingreso)", "Q2": "Q1-Q2 (menor ingreso)", "Q3": "Q3",
                                               "Q4": "Q4-Q5 (mayor ingreso)", "Q5": "Q4-Q5 (mayor ingreso)"}).fillna("Sin dato")
    Ge["g_jornada"] = Ge.jornada.str.capitalize()
    Ge["g_zona"] = Ge.reside_machala.map({1.0: "Machala", 0.0: "Otros cantones"}).fillna("Sin dato")
    Ge["g_edad"] = pd.cut(Ge.edad_anios, [0, 19, 24, 100], labels=["17-19 años", "20-24 años", "25 años o más"]).astype(object).fillna("Sin dato")
    Ge["g_trabaja"] = Ge.trabaja.map({1.0: "Trabaja y estudia", 0.0: "Solo estudia"}).fillna("Sin dato")
    kk = int(Ge.y.sum()); fnr_gen = 1 - ((Ge.y == 1) & (Ge.alerta_modelo == 1)).sum() / kk
    sub = []
    for var, et in [("g_sexo", "Sexo"), ("g_nse", "Nivel socioeconómico"), ("g_jornada", "Jornada"),
                    ("g_zona", "Zona de residencia"), ("g_edad", "Edad"), ("g_trabaja", "Situación laboral")]:
        for val, g in Ge.groupby(var):
            k = int(g.y.sum()); tp = int(((g.y == 1) & (g.alerta_modelo == 1)).sum()); tpb = int(((g.y == 1) & (g.alerta_base == 1)).sum())
            lo, hi = wilson(k - tp, k)
            sub.append(dict(variable=et, grupo=val, estudiantes=len(g), positivos=k,
                            recall_modelo=r(tp / k) if k else None, FNR_modelo=r(1 - tp / k) if k else None,
                            FNR_IC95=[r(lo, 2), r(hi, 2)], recall_base=r(tpb / k) if k else None,
                            FNR_base=r(1 - tpb / k) if k else None,
                            tasa_alerta_modelo=r(g.alerta_modelo.mean()), tasa_alerta_base=r(g.alerta_base.mean()),
                            dif_FNR_vs_general=r(1 - tp / k - fnr_gen) if k else None,
                            senal=bool(k >= 10 and (1 - tp / k - fnr_gen) > 0.10 and lo > fnr_gen)))

    # ------------------------------------------------------------------ SHAP del modelo seleccionado (sobre la prueba)
    cols = list(vs["Xte"].columns)
    sv = shap_valores(vs["best"], vs["Xtr"], vs["Xte"])
    imp_shap = pd.DataFrame({"variable": cols, "etiqueta": [ETIQUETAS[c] for c in cols],
                             "mean_abs_SHAP": np.abs(sv).mean(axis=0),
                             "direccion": [float(np.corrcoef(vs["Xte"][c].fillna(vs["Xte"][c].median()), sv[:, i])[0, 1])
                                           if np.std(sv[:, i]) > 0 else 0.0 for i, c in enumerate(cols)]})
    imp_shap = imp_shap.sort_values("mean_abs_SHAP", ascending=False).reset_index(drop=True)

    # ------------------------------------------------------------------ sensibilidades
    sens = []
    # (a) desenlace estricto: reprobar por inasistencias al menos 2/3 de las asignaturas
    y_est = (te.prop_asig_reprobadas_inasistencias >= 2 / 3).astype(int).values
    for k in [BASE, f"{sel[0]} [{sel[1]}]"]:
        sens.append(dict(analisis="Desenlace estricto (>= 2/3 de asignaturas reprobadas por inasistencias)", modelo=k,
                         AUC_PR=r(average_precision_score(y_est, sc[k][0])), AUC_ROC=r(roc_auc_score(y_est, sc[k][0])),
                         prevalencia=r(y_est.mean())))
    # (b) sin el periodo cuya ventana tuvo que ajustarse por un tramo sin control de asistencia
    #     (si no hay ninguno, sin el periodo con menos inasistencias registradas)
    ajustados = tr.loc[tr.dias_sin_control_asistencia > 0, "periodo"].unique()
    hay_ajuste = len(ajustados) > 0
    atip = ajustados[0] if hay_ajuste else perf[perf.rol == "ENTRENAMIENTO"].sort_values("pct_con_alguna_inasistencia_d28").iloc[0].periodo
    tr2 = tr[tr.periodo != atip]
    if sel[1] == "C":
        tr2 = tr2[tr2.tiene_datos_atenea]
    spw2 = (tr2.y == 0).sum() / (tr2.y == 1).sum()
    pipe2, _ = modelo(sel[0], spw2); pipe2.set_params(**vs["params"])
    p2 = pipe2.fit(matriz(tr2, sel[1]), tr2.y.values).predict_proba(vs["Xte"])[:, 1]
    motivo = "ventana ajustada por un tramo sin control de asistencia" if hay_ajuste else "periodo con menos inasistencias registradas"
    sens.append(dict(analisis=f"Entrenamiento sin {atip} ({motivo})", modelo=f"{sel[0]} [{sel[1]}]",
                     AUC_PR=r(average_precision_score(yte, p2)), AUC_ROC=r(roc_auc_score(yte, p2)), prevalencia=r(prevalencia)))
    sens.append(dict(analisis="Referencia (prueba, desenlace principal)", modelo=BASE, AUC_PR=r(m_base["AUC_PR"]),
                     AUC_ROC=r(m_base["AUC_ROC"]), prevalencia=r(prevalencia)))

    # ------------------------------------------------------------------ modelos finales (todos los periodos cerrados)
    finales = {}
    for conj in CONJUNTOS:
        k = max([q for q in res if q[1] == conj], key=lambda q: res[q]["cv_ap"])
        Gc = G[G.tiene_datos_atenea] if conj == "C" else G
        X, yy = matriz(Gc, conj), Gc.y.values
        spw = (yy == 0).sum() / (yy == 1).sum()
        pipe, _ = modelo(k[0], spw); pipe.set_params(**res[k]["params"])
        oof = cross_val_predict(clone(pipe), X, yy, cv=cv_oof, method="predict_proba")[:, 1]
        pipe.fit(X, yy)
        cal = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(oof, yy)
        finales[conj] = dict(nombre=k[0], conjunto=conj, pipeline=pipe, calibrador=cal, columnas=list(X.columns),
                             umbral_alto=umbral_recall(oof, yy, RECALL_OBJETIVO), umbral_medio=umbral_medio(oof, yy),
                             X_ref=X, cv_ap=res[k]["cv_ap"], n=len(Gc), positivos=int(yy.sum()),
                             periodos=sorted(Gc.periodo.unique()))
    # ---- modelo al horizonte de la cohorte en curso: mientras su ventana no llega al día 28, se usa un modelo
    # entrenado con los periodos cerrados recortados al MISMO número de días observados (solo asistencia).
    horizonte = None
    ruta_h = SALIDAS / "predictores_horizonte.pkl"
    if ruta_h.exists():
        ph = pd.read_pickle(ruta_h)
        dias_h = int(ph.horizonte_dias.iloc[0])
        Gh = G[["id_estudiante", "periodo", "y"]].merge(ph, on=["id_estudiante", "periodo"], how="inner")
        cols_h = [c for c in CONJUNTOS["A"][1] if Gh[c].notna().any()]
        Xh, yh = Gh[cols_h].astype(float), Gh.y.values
        spw = (yh == 0).sum() / (yh == 1).sum()
        mejor_h = None
        for n in NOMBRES:
            pipe, grid = modelo(n, spw)
            gs = GridSearchCV(pipe, grid, scoring="average_precision", cv=cv_tune, n_jobs=1, refit=False).fit(Xh, yh)
            if mejor_h is None or gs.best_score_ > mejor_h[1]:
                mejor_h = (n, float(gs.best_score_), gs.best_params_)
        pipe, _ = modelo(mejor_h[0], spw); pipe.set_params(**mejor_h[2])
        a_, b_ = Gh.periodo.isin(TRAIN_P).values, (Gh.periodo == PERIODO_PRUEBA).values
        p_h = clone(pipe).fit(Xh[a_], yh[a_]).predict_proba(Xh[b_])[:, 1]
        oof = cross_val_predict(clone(pipe), Xh, yh, cv=cv_oof, method="predict_proba")[:, 1]
        pipe.fit(Xh, yh)
        finales["H"] = dict(nombre=mejor_h[0], conjunto="H", pipeline=pipe, columnas=cols_h, X_ref=Xh, horizonte=dias_h,
                            calibrador=IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(oof, yh),
                            umbral_alto=umbral_recall(oof, yh, RECALL_OBJETIVO), umbral_medio=umbral_medio(oof, yh),
                            cv_ap=mejor_h[1], n=len(Gh), positivos=int(yh.sum()), periodos=sorted(Gh.periodo.unique()))
        horizonte = dict(dias=dias_h, modelo=mejor_h[0], cv_auc_pr=r(mejor_h[1]),
                         auc_pr_prueba=r(average_precision_score(yh[b_], p_h)), auc_roc_prueba=r(roc_auc_score(yh[b_], p_h)),
                         auc_pr_base_prueba=r(average_precision_score(yh[b_], Gh.pct_inasistencia_d28[b_].fillna(0))),
                         tasa_alerta_alto=r(float((oof >= finales["H"]["umbral_alto"]).mean())),
                         precision_alto=r(float(yh[oof >= finales["H"]["umbral_alto"]].mean())))
        print("Modelo al horizonte:", horizonte, flush=True)

    # predicciones históricas fuera de periodo (para el tablero): modelo seleccionado y, en los periodos
    # donde no puede aplicarse (sin datos de plataforma), el mejor modelo solo de asistencia
    hist = G[["id_estudiante", "periodo", "y"]].copy()
    hist["score"] = pooled[sel]; hist["nombre"] = sel[0]; hist["conjunto"] = sel[1]
    falta = hist.score.isna().values
    hist.loc[falta, "score"] = pooled[selA][falta]; hist.loc[falta, "nombre"] = selA[0]; hist.loc[falta, "conjunto"] = selA[1]
    hist.to_pickle(SALIDAS / "predicciones_historicas.pkl")
    thr_hist = {k[1]: (res[k]["thr"], umbral_medio(res[k]["oof"], res[k]["ytr"])) for k in (sel, selA)}
    joblib.dump(dict(finales=finales, seleccionado=sel, thr_base=thr_base, fecha=datetime.now().isoformat(), thr_hist=thr_hist),
                SALIDAS / "modelos.joblib")

    # ------------------------------------------------------------------ figuras
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False, "axes.spines.right": False})
    AZ, GR, RJ, NA = "#2563EB", "#8C8C8C", "#DC2626", "#F59E0B"
    fig, ax = plt.subplots(figsize=(10, 5.5))
    pv = pres.groupby(["periodo", "via_salida"]).size().unstack(fill_value=0)
    bot = np.zeros(len(pv))
    for col, lab, colr in [("PERMANECE_APRUEBA", "Aprueba", "#93C5FD"), ("PERMANECE_REPRUEBA_RENDIMIENTO", "Reprueba por rendimiento", NA),
                           ("REPRUEBA_INASISTENCIAS", "Reprueba por inasistencias (clase positiva)", RJ), ("RETIRO_VOLUNTARIO", "Retiro voluntario", GR)]:
        if col in pv:
            ax.bar(pv.index, pv[col], bottom=bot, label=lab, color=colr); bot += pv[col].values
    for i, t_ in enumerate(bot):
        ax.text(i, t_ + 4, int(t_), ha="center", fontsize=10)
    ax.set_ylabel("Estudiantes (presencial)"); ax.set_title("Desenlace del primer periodo por cohorte (presencial, periodos cerrados)", loc="left", fontsize=12)
    ax.legend(frameon=False, fontsize=9); plt.tight_layout(); plt.savefig(SALIDAS / "fig1_casos_por_periodo.png", dpi=180); plt.close()

    curvas = {}
    fig, ax = plt.subplots(figsize=(7.5, 6))
    for k, colr in [(BASE, GR), (f"{selA[0]} [{selA[1]}]", NA), (f"{sel[0]} [{sel[1]}]", AZ)]:
        if k in curvas:
            continue
        pr_, rc_, _ = precision_recall_curve(yte, sc[k][0])
        paso = max(1, len(rc_) // 120)
        curvas[k] = [[r(a), r(b)] for a, b in zip(rc_[::paso], pr_[::paso])]
        ax.plot(rc_, pr_, color=colr, lw=2.2, label=f"{k} (AUC-PR {average_precision_score(yte, sc[k][0]):.2f})")
    ax.axhline(prevalencia, color=RJ, ls="--", lw=1); ax.text(0.02, prevalencia + 0.015, f"Prevalencia {prevalencia:.2f}", color=RJ, fontsize=9)
    ax.set_xlabel("Sensibilidad (Recall)"); ax.set_ylabel("Precisión"); ax.set_ylim(0, 1.02); ax.set_xlim(0, 1)
    ax.set_title(f"Curvas precisión-sensibilidad en la cohorte de prueba ({PERIODO_PRUEBA})", loc="left", fontsize=11)
    ax.legend(frameon=False, fontsize=8.5, loc="lower left"); plt.tight_layout(); plt.savefig(SALIDAS / "fig2_curvas_PR_prueba.png", dpi=180); plt.close()

    fig, ax = plt.subplots(figsize=(9, 5.6))
    t = tabla_df.iloc[::-1].reset_index(drop=True)
    for i, rw in t.iterrows():
        colr = GR if rw.es_base else (AZ if rw.get("seleccionado") is True else "#93C5FD")
        ax.plot(rw.AUC_PR_IC95, [i, i], color=colr, lw=2.5); ax.plot(rw.AUC_PR, i, "o", color=colr, ms=8)
    ax.set_yticks(range(len(t))); ax.set_yticklabels(t.modelo); ax.axvline(prevalencia, color=RJ, ls="--", lw=1)
    ax.set_xlabel("AUC-PR en prueba (IC 95 % por bootstrap)"); ax.set_title(f"Modelos frente a la línea base (cohorte {PERIODO_PRUEBA})", loc="left", fontsize=11)
    plt.tight_layout(); plt.savefig(SALIDAS / "fig3_comparacion_modelos.png", dpi=180); plt.close()

    fig, ax = plt.subplots(figsize=(8.5, 5.5))
    top = imp_shap.head(10).iloc[::-1]
    ax.barh(top.etiqueta, top.mean_abs_SHAP, color=AZ); ax.set_xlabel(f"Importancia media |SHAP| (cohorte {PERIODO_PRUEBA})")
    ax.set_title(f"Variables que más influyen en el riesgo: {sel[0]} [{sel[1]}]", loc="left", fontsize=11)
    plt.tight_layout(); plt.savefig(SALIDAS / "fig4_shap_importancia.png", dpi=180); plt.close()

    fig, ax = plt.subplots(figsize=(9, 6.5))
    s2 = pd.DataFrame(sub); s2 = s2[(s2.positivos >= 10) & (s2.grupo != "Sin dato")].reset_index(drop=True)
    ax.barh(range(len(s2))[::-1], s2.FNR_modelo, color=[RJ if x else AZ for x in s2.senal])
    ax.axvline(fnr_gen, color=GR, ls="--", lw=1); ax.text(fnr_gen + 0.005, len(s2) - 0.4, f"FNR general {fnr_gen:.2f}", color=GR, fontsize=9)
    ax.set_yticks(range(len(s2))[::-1]); ax.set_yticklabels([f"{a}: {b} (n+={c})" for a, b, c in zip(s2.variable, s2.grupo, s2.positivos)], fontsize=9)
    ax.set_xlabel("Tasa de falsos negativos del modelo seleccionado"); ax.set_title("Falsos negativos por subgrupo (predicciones fuera de periodo)", loc="left", fontsize=11)
    plt.tight_layout(); plt.savefig(SALIDAS / "fig5_subgrupos_FNR.png", dpi=180); plt.close()

    # ------------------------------------------------------------------ veredicto de los criterios
    fs = tabla_df[tabla_df.seleccionado == True].iloc[0]  # noqa: E712
    ap = {row.modelo: row.AUC_PR for row in tabla_df.itertuples()}
    mejoras = {c: r(max(ap[f"{n} [{c}]"] for n in NOMBRES) - max(ap[f"{n} [A]"] for n in NOMBRES)) for c in ["B", "C"]}
    veredicto = [
        dict(criterio="C1", cumple=bool(fs.dif_AUC_PR_IC95[0] > 0),
             detalle=f"Diferencia de AUC-PR {fs.dif_AUC_PR_vs_base:+.3f} (IC 95 % {fs.dif_AUC_PR_IC95[0]:+.3f} a {fs.dif_AUC_PR_IC95[1]:+.3f})."),
        dict(criterio="C2", cumple=bool(fs.dif_Recall_IC95[0] > 0),
             detalle=f"Recall a igual carga {fs.Recall_igual_carga:.3f} frente a {m_base['Recall']:.3f} de la línea base; diferencia {fs.dif_Recall_igual_carga_vs_base:+.3f} (IC 95 % {fs.dif_Recall_IC95[0]:+.3f} a {fs.dif_Recall_IC95[1]:+.3f})."),
        dict(criterio="C3", cumple=bool(max(mejoras.values()) > 0),
             detalle=f"Mejor AUC-PR de B menos mejor de A: {mejoras['B']:+.3f}; de C menos A: {mejoras['C']:+.3f}."),
        dict(criterio="C4", cumple=not any(s_["senal"] for s_ in sub),
             detalle="Subgrupos con señal: " + (", ".join(f"{s_['variable']} = {s_['grupo']}" for s_ in sub if s_["senal"]) or "ninguno") + "."),
    ]

    # ------------------------------------------------------------------ salida
    resultados = dict(
        meta=dict(fecha=datetime.now().isoformat(timespec="seconds"), periodos_entrenamiento=TRAIN_P, periodo_prueba=PERIODO_PRUEBA,
                  n_entrenamiento=len(tr), positivos_entrenamiento=int(ytr.sum()), n_prueba=len(te), positivos_prueba=int(yte.sum()),
                  prevalencia_prueba=r(prevalencia), recall_objetivo=RECALL_OBJETIVO, bootstrap=B_BOOT, semilla=SEED,
                  seleccionado=dict(modelo=sel[0], conjunto=sel[1], descripcion=CONJUNTOS[sel[1]][0]),
                  mejor_solo_asistencia=dict(modelo=selA[0], conjunto=selA[1]),
                  linea_base=dict(umbral_pct_inasistencia=r(thr_base, 2), umbral_recall70=r(thr_base_r70, 2),
                                  tasa_alerta_entrenamiento=r(tasa_base_tr)),
                  fnr_general=r(fnr_gen), horizonte=horizonte,
                  finales={c: dict(modelo=f["nombre"], umbral_alto=r(f["umbral_alto"], 4), umbral_medio=r(f["umbral_medio"], 4),
                                   n=f["n"], positivos=f["positivos"], periodos=f["periodos"], variables=f["columnas"])
                           for c, f in finales.items()}),
        criterios=[dict(descripcion=b, **next(v_ for v_ in veredicto if v_["criterio"] == a)) for a, b in criterios],
        alcance=[dict(concepto=a, valor=b) for a, b in alcance],
        perfil=perf.to_dict("records"),
        modelos=tabla, recall_por_carga=carga, lopo=lopo, subgrupos=sub,
        shap=[dict(variable=a, etiqueta=b, importancia=r(c, 4), direccion=r(d, 2)) for a, b, c, d in imp_shap.itertuples(index=False)],
        smote=smote, sensibilidad=sens, curvas_pr=curvas,
        conjuntos={c: dict(descripcion=d, variables=[dict(variable=v_, etiqueta=ETIQUETAS[v_]) for v_ in vs_]) for c, (d, vs_) in CONJUNTOS.items()},
    )
    json.dump(resultados, open(SALIDAS / "resultados.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)

    with pd.ExcelWriter(SALIDAS / "resultados_modelo.xlsx", engine="openpyxl") as xw:
        pd.DataFrame(resultados["criterios"]).to_excel(xw, sheet_name="0_criterios", index=False)
        pd.DataFrame(resultados["alcance"]).to_excel(xw, sheet_name="1_alcance", index=False)
        perf.to_excel(xw, sheet_name="2_perfil_por_periodo", index=False)
        tabla_df.drop(columns=["es_base"]).to_excel(xw, sheet_name=f"3_prueba_{PERIODO_PRUEBA}", index=False)
        pd.DataFrame(carga).to_excel(xw, sheet_name="4_recall_por_carga", index=False)
        pd.DataFrame(lopo).pivot(index="modelo", columns="periodo", values="AUC_PR").reset_index().to_excel(xw, sheet_name="5_AUC-PR_periodo_fuera", index=False)
        pd.DataFrame(sub).to_excel(xw, sheet_name="6_subgrupos", index=False)
        imp_shap.to_excel(xw, sheet_name="7_SHAP", index=False)
        pd.DataFrame(smote).to_excel(xw, sheet_name="8_pesos_vs_SMOTE", index=False)
        pd.DataFrame(sens).to_excel(xw, sheet_name="9_sensibilidad", index=False)
        for ws in xw.book.worksheets:
            for c in ws[1]:
                c.font = c.font.copy(bold=True)
            for col in ws.columns:
                w = max(len(str(c.value)) if c.value is not None else 0 for c in col)
                ws.column_dimensions[col[0].column_letter].width = min(max(12, w + 2), 70)

    pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
    print("\n== PRUEBA", PERIODO_PRUEBA)
    print(tabla_df[["modelo", "AUC_PR", "AUC_PR_IC95", "AUC_ROC", "Recall", "Precision", "Tasa_alerta", "Recall_igual_carga",
                    "Tasa_alerta_igual_carga", "dif_AUC_PR_vs_base", "dif_AUC_PR_IC95", "dif_Recall_igual_carga_vs_base", "dif_Recall_IC95", "cv_auc_pr"]].to_string(index=False))
    print("\n== Recall por carga"); print(pd.DataFrame(carga).pivot(index="modelo", columns="tasa_alerta", values="recall").to_string())
    print("\n== AUC-PR con un periodo fuera"); print(pd.DataFrame(lopo).pivot(index="modelo", columns="periodo", values="AUC_PR").to_string())
    print("\n== Subgrupos"); print(pd.DataFrame(sub).drop(columns=["FNR_IC95"]).to_string(index=False))
    print("\n== SHAP"); print(imp_shap.head(12).to_string(index=False))
    print("\n== SMOTE"); print(pd.DataFrame(smote).to_string(index=False))
    print("\n== Sensibilidad"); print(pd.DataFrame(sens).to_string(index=False))
    print("\n== Criterios"); [print(v_) for v_ in veredicto]
    print("\n== Perfil"); print(perf.to_string(index=False))
    print("LISTO", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
