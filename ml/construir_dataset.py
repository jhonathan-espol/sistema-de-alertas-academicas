"""
Preparación de datos (CRISP-DM): construye el dataset de primer nivel al día 28.

 1. Fechas reales de inicio de clases por periodo / carrera / nivel / paralelo (desde SIGA).
 2. Población: estudiantes de primer nivel; modalidad y retiros desde el maestro de matrículas.
 3. Predictores con información EXCLUSIVA de los días 1 a 28 (asistencia SIGA, entregas ATENEA,
    admisión CAC y ficha socioeconómica).
 4. Desenlace al cierre: reprobación por inasistencias (>30 % en al menos una asignatura).
 5. Seudonimización: el dataset no contiene cédulas ni nombres.

Uso:  python -m ml.construir_dataset
"""
import hashlib
import os
import sys
import unicodedata

import numpy as np
import pandas as pd

from ml.config import (CACHE, DIA_CORTE, LIMITE_INASISTENCIA, PERIODO_EN_CURSO, PERIODOS_CERRADOS,
                       REPORTES, SALIDAS)

SAL_PATH = CACHE / "sal_seudonimo.txt"


def _sal():
    if os.environ.get("SEUDONIMO_SAL"):
        return os.environ["SEUDONIMO_SAL"]
    if not SAL_PATH.exists():
        SAL_PATH.write_text(os.urandom(16).hex(), encoding="utf-8")
    return SAL_PATH.read_text(encoding="utf-8").strip()


def seudonimo(cedula, sal):
    return "E" + hashlib.sha256(f"{sal}:{cedula}".encode()).hexdigest()[:9].upper()


def _txt(s):
    if pd.isna(s):
        return np.nan
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().strip().upper()


def _ced(s):
    s = str(s).strip()
    return s.zfill(10) if s.isdigit() else s


# ------------------------------------------------------------------ 1. fechas de inicio
def fechas_inicio(larga):
    v = larga[larga.clase_valida].copy()
    v["jornada"] = v.jornada.str.replace(r"\(\d+\)", "", regex=True)
    grupo = ["periodo", "carrera_sigla", "carrera_nombre", "nivel_num", "paralelo", "jornada"]
    # primera clase de cada asignatura del grupo; el inicio del grupo es la más temprana
    por_asig = v.groupby(grupo + ["asignatura_cod"]).fecha.agg(["min", "max"]).reset_index()
    ini = por_asig.groupby(grupo).agg(fecha_inicio_clases=("min", "min"), fecha_ultima_clase=("max", "max"),
                                      n_asignaturas=("asignatura_cod", "nunique")).reset_index()
    est = v.groupby(grupo).cedula.nunique().rename("n_estudiantes").reset_index()
    ini = ini.merge(est, on=grupo)
    ini["fecha_corte_d28"] = ini.fecha_inicio_clases + pd.Timedelta(days=DIA_CORTE - 1)
    # referencia: inicio más frecuente del periodo y nivel (para marcar grupos que arrancan tarde)
    ref = ini.groupby(["periodo", "nivel_num"]).fecha_inicio_clases.min().rename("inicio_periodo_nivel").reset_index()
    ini = ini.merge(ref, on=["periodo", "nivel_num"])
    ini["dias_desfase"] = (ini.fecha_inicio_clases - ini.inicio_periodo_nivel).dt.days
    return ini


def intervalos_sin_control(larga):
    """Tramos del periodo en los que NO se controló la asistencia (regla basada solo en los datos):
    5 o más días de clase consecutivos en los que al menos el 90 % de los cursos de primer nivel
    no registra ni una sola hora de inasistencia. Durante esos tramos el conteo de los 28 días se
    pausa: de lo contrario la ventana quedaría sin información y no sería comparable entre periodos.
    Solo se evalúa en periodos cerrados."""
    v = larga[larga.clase_valida & (larga.nivel_num == 1) & larga.periodo.isin(PERIODOS_CERRADOS)].copy()
    v["aus"] = v.horas_clase - v.horas_asistidas
    por_curso = v.groupby(["periodo", "fecha", "archivo"]).aus.sum().reset_index()
    dia = por_curso.groupby(["periodo", "fecha"]).agg(cero=("aus", lambda s: (s == 0).mean()), n=("aus", "size")).reset_index()
    out = {}
    for p, g in dia.groupby("periodo"):
        g = g[g.n >= 10].sort_values("fecha").reset_index(drop=True)
        marca, tramos, i = (g.cero >= 0.9).values, [], 0
        while i < len(g):
            if not marca[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(g) and marca[j + 1]:
                j += 1
            if j - i + 1 >= 5:
                fin = g.fecha[j + 1] - pd.Timedelta(days=1) if j + 1 < len(g) else g.fecha[j]
                tramos.append((g.fecha[i], fin))
            i = j + 1
        if tramos:
            out[p] = tramos
    return out


def dias_pausados(fechas, inicios, tramos):
    """Días calendario de [inicio, fecha] que caen dentro de tramos sin control de asistencia."""
    f, i0 = pd.to_datetime(fechas).values.astype("datetime64[D]"), pd.to_datetime(inicios).values.astype("datetime64[D]")
    total = np.zeros(len(f), dtype=int)
    for a, b in tramos:
        a, b = np.datetime64(a, "D"), np.datetime64(b, "D")
        desde, hasta = np.maximum(i0, a), np.minimum(f, b)
        total += np.clip((hasta - desde).astype(int) + 1, 0, None)
    return total


def fecha_corte(inicios, tramos, dias=DIA_CORTE):
    """Fecha calendario en la que se cumple el día 'dias' de clases con control de asistencia."""
    i0 = pd.to_datetime(inicios).values.astype("datetime64[D]")
    corte = i0 + np.timedelta64(dias - 1, "D")
    for a, b in sorted(tramos):
        a, b = np.datetime64(a, "D"), np.datetime64(b, "D")
        dentro = (corte >= a) & (i0 <= b)
        largo = (b - np.maximum(i0, a)).astype(int) + 1
        corte = corte + np.where(dentro, largo, 0).astype("timedelta64[D]")
    return pd.Series(pd.to_datetime(corte), index=getattr(inicios, "index", None))


# ------------------------------------------------------------------ 2. fuentes administrativas
def leer_matriculas():
    partes = []
    for f in sorted(REPORTES.glob("matriculas_*.xlsx")):
        partes.append(pd.read_excel(f, dtype=str))
    m = pd.concat(partes, ignore_index=True)
    m.columns = ["periodo", "cedula", "nombre", "carrera", "modalidad", "nivel", "paralelo_jornada",
                 "tipo_ingreso", "estado_matricula", "tipo_matricula"]
    m["cedula"] = m.cedula.map(_ced)
    m["carrera"] = m.carrera.map(_txt)
    return m


def leer_socio():
    partes = []
    for f in sorted(REPORTES.glob("datos_socioeconomicos_*.xls")):
        d = pd.read_excel(f, dtype=str)
        d["periodo"] = f.stem.replace("datos_socioeconomicos_", "").replace("_", "-")
        partes.append(d)
    s = pd.concat(partes, ignore_index=True)
    s["cedula"] = s.cedula.map(_ced)
    o = pd.DataFrame({"periodo": s.periodo, "cedula": s.cedula})
    o["sexo"] = s.sexo.map({"HOMBRE": "M", "MUJER": "F"})
    o["estado_civil"] = s.estado_civil.map(_txt)
    o["fecha_nacimiento"] = pd.to_datetime(s.fecha_nacimiento, format="%d/%m/%Y", errors="coerce")
    o["canton_residencia"] = s.canton_residencia.map(_txt)
    o["tipo_colegio"] = s.tipo_colegio.map(_txt)
    o["trabaja"] = s.estudiante_se_dedica_a.map({"TRABAJA Y ESTUDIA": 1.0, "SOLO ESTUDIA": 0.0})
    o["recibe_bdh"] = s.la_familia_del_estudiante_recibe_el_bono_de_desarrollo_humano.map({"SI": 1.0, "NO": 0.0})
    ingreso = pd.to_numeric(s.ingresos_del_hogar.str.replace(",", ""), errors="coerce")
    miembros = pd.to_numeric(s.numero_de_miembros_del_hogar, errors="coerce").clip(lower=1)
    o["ingreso_per_capita_hogar"] = ingreso / miembros
    superior = {"SUPERIOR UNIVERSITARIA", "SUPERIOR NO UNIVERSITARIA", "POSGRADO"}
    padre, madre = s.nivel_de_formacion_del_padre.map(_txt), s.nivel_de_formacion_de_la_madre.map(_txt)
    sin_dato = padre.isna() & madre.isna()
    o["primera_generacion"] = np.where(sin_dato, np.nan, (~(padre.isin(superior) | madre.isin(superior))).astype(float))
    return o.drop_duplicates(["periodo", "cedula"])


def leer_cac():
    c = pd.read_excel(REPORTES / "cac_consolidado.xlsx", dtype=str)
    o = pd.DataFrame({"periodo_cac": c.PERIODO, "cedula": c.cedula.map(_ced)})
    o["puntaje_admision"] = pd.to_numeric(c.nota_postulacion, errors="coerce").where(lambda x: x > 0)
    o["fecha_nacimiento_cac"] = pd.to_datetime(c.fecha_nacimiento, format="%m/%d/%y %I:%M %p", errors="coerce")
    # años de 2 dígitos: nadie nace en el futuro
    futuro = o.fecha_nacimiento_cac > pd.Timestamp("2015-01-01")
    o.loc[futuro, "fecha_nacimiento_cac"] = o.loc[futuro, "fecha_nacimiento_cac"] - pd.DateOffset(years=100)
    return o


def leer_actividades():
    partes = []
    for f in sorted(REPORTES.glob("actividades_academicas_*.csv")):
        a = pd.read_csv(f, dtype=str, na_values=["NULL"],
                        usecols=["periodo_nombre", "identificacion", "materia_codigo", "actividad_id",
                                 "tipo_actividad", "fecha_inicio", "fecha_fin", "fecha_entrega"])
        partes.append(a)
    if not partes:
        return pd.DataFrame(columns=["periodo", "cedula", "materia_codigo", "actividad_id", "tipo_actividad",
                                     "fecha_inicio", "fecha_fin", "fecha_entrega"])
    a = pd.concat(partes, ignore_index=True).rename(columns={"periodo_nombre": "periodo", "identificacion": "cedula"})
    a["cedula"] = a.cedula.map(_ced)
    for c in ["fecha_inicio", "fecha_fin", "fecha_entrega"]:
        a[c] = pd.to_datetime(a[c].str.slice(0, 19), errors="coerce")
    return a


# ------------------------------------------------------------------ 3. predictores de asistencia
def predictores_asistencia(v):
    """v: clases válidas de primer nivel con columnas dia (1..), en_ventana, horas_*."""
    w = v[v.en_ventana].copy()
    w["h_aus"] = w.horas_clase - w.horas_asistidas
    w["semana"] = ((w.dia - 1) // 7 + 1).clip(upper=4)
    k = ["periodo", "cedula"]

    tot = w.groupby(k).agg(horas_programadas_d28=("horas_clase", "sum"), horas_inasistencia_d28=("h_aus", "sum"),
                           n_clases_d28=("nro_clase", "size")).reset_index()
    tot["pct_inasistencia_d28"] = 100 * tot.horas_inasistencia_d28 / tot.horas_programadas_d28

    asig = w.groupby(k + ["asignatura_cod"]).agg(hp=("horas_clase", "sum"), ha=("h_aus", "sum"),
                                                 asis=("horas_asistidas", "sum")).reset_index()
    asig["pct"] = 100 * asig.ha / asig.hp
    a2 = asig.groupby(k).agg(max_pct_inasistencia_asig_d28=("pct", "max"),
                             prop_asig_sobre_limite_d28=("pct", lambda s: (s > LIMITE_INASISTENCIA).mean()),
                             prop_asig_sin_asistencia_d28=("asis", lambda s: (s == 0).mean())).reset_index()

    sem = w.groupby(k + ["semana"]).agg(hp=("horas_clase", "sum"), ha=("h_aus", "sum")).reset_index()
    sem["pct"] = 100 * sem.ha / sem.hp
    sp = sem.pivot_table(index=k, columns="semana", values="pct")
    sp = sp.reindex(columns=[1, 2, 3, 4])
    sem2 = pd.DataFrame({"pct_inasistencia_sem12": sp[[1, 2]].mean(axis=1),
                         "pct_inasistencia_sem34": sp[[3, 4]].mean(axis=1)}).reset_index()
    sem2["tendencia_inasistencia"] = sem2.pct_inasistencia_sem34 - sem2.pct_inasistencia_sem12

    dia = w.groupby(k + ["fecha", "dia"]).agg(asis=("horas_asistidas", "sum")).reset_index().sort_values(k + ["fecha"])
    dia["asistio"] = dia.asis > 0

    def por_estudiante(g):
        asistio = g.asistio.values
        dias = g.dia.values
        n = len(g)
        racha = 0
        for x in asistio[::-1]:
            if x:
                break
            racha += 1
        return pd.Series({"dias_con_clase_d28": n, "dias_asistidos_d28": int(asistio.sum()),
                          "prop_dias_asistidos_d28": asistio.mean(),
                          "dia_primera_asistencia": dias[asistio][0] if asistio.any() else DIA_CORTE + 1,
                          "racha_final_ausente_prop": racha / n,
                          "ultimo_dia_observado": dias.max()})
    d2 = dia.groupby(k).apply(por_estudiante, include_groups=False).reset_index()

    parc = w[w.horas_asistidas > 0].assign(parcial=lambda x: x.horas_asistidas < x.horas_clase)
    p2 = parc.groupby(k).parcial.mean().rename("prop_asistencia_parcial_d28").reset_index()

    out = tot.merge(a2, on=k).merge(sem2, on=k, how="left").merge(d2, on=k).merge(p2, on=k, how="left")
    out["prop_asistencia_parcial_d28"] = out.prop_asistencia_parcial_d28.fillna(0.0)
    return out


def predictores_actividades(act, base):
    """Huella en ATENEA: entregas de tareas, evaluaciones y foros con vencimiento dentro de la ventana."""
    if act.empty:
        return pd.DataFrame(columns=["periodo", "cedula"])
    a = act.merge(base[["periodo", "cedula", "fecha_inicio_clases", "fecha_corte", "dias_sin_control_asistencia"]], on=["periodo", "cedula"])
    fin_corte = a.fecha_corte + pd.Timedelta(hours=23, minutes=59, seconds=59)
    a = a[(a.fecha_fin <= fin_corte) & (a.fecha_fin >= a.fecha_inicio_clases)].copy()
    fin_c = a.fecha_corte + pd.Timedelta(hours=23, minutes=59, seconds=59)
    a["entregada"] = a.fecha_entrega.notna() & (a.fecha_entrega <= fin_c)
    a["a_tiempo"] = a.entregada & (a.fecha_entrega <= a.fecha_fin)
    # el día de entrega se cuenta en días con control de asistencia, igual que la ventana
    dia_cal = (a.fecha_entrega.dt.normalize() - a.fecha_inicio_clases).dt.days + 1
    a["dia_entrega"] = np.where(a.entregada, (dia_cal - a.dias_sin_control_asistencia).clip(lower=1), np.nan)
    k = ["periodo", "cedula"]
    g = a.groupby(k).agg(n_actividades_d28=("actividad_id", "size"), prop_entregadas_d28=("entregada", "mean"),
                         prop_a_tiempo_d28=("a_tiempo", "mean"),
                         dias_con_entrega_d28=("dia_entrega", "nunique"),
                         dia_primera_entrega=("dia_entrega", "min")).reset_index()
    g["dia_primera_entrega"] = g.dia_primera_entrega.fillna(DIA_CORTE + 1)
    ev = a[a.tipo_actividad == "EVALUACION"].groupby(k).entregada.mean().rename("prop_evaluaciones_rendidas_d28").reset_index()
    return g.merge(ev, on=k, how="left")


def detalle_asistencia(V, dias_obs):
    """Desglose de la asistencia de cada estudiante dentro de su ventana (lo que la aplicación muestra en
    «Detalle del estudiante»): por asignatura, por semana y clase por clase. Usa exactamente las mismas
    clases que los predictores, de modo que sus totales coinciden con los porcentajes de la alerta.
    dias_obs: serie indexada por (periodo, cedula) con los días observados de la ventana."""
    w = V[V.en_ventana].copy()
    w["aus"] = w.horas_clase - w.horas_asistidas
    w["semana"] = ((w.dia - 1) // 7 + 1).clip(upper=4).astype(int)
    w["nombre"] = [str(n)[len(str(c)):].strip(" -") if str(n).startswith(str(c)) else str(n) for n, c in zip(w.asignatura, w.asignatura_cod)]
    pct = lambda a, h: round(100 * float(a) / float(h), 1) if h else None  # noqa: E731
    filas = []
    for (periodo, cedula), g in w.sort_values(["asignatura_cod", "fecha", "nro_clase"]).groupby(["periodo", "cedula"]):
        fin = int(dias_obs.get((periodo, cedula), DIA_CORTE))
        asig = [dict(codigo=c, nombre=a.nombre.iloc[0].title(), clases=int(len(a)), horas=float(a.horas_clase.sum()),
                     asistidas=float(a.horas_asistidas.sum()), ausentes=float(a.aus.sum()), pct=pct(a.aus.sum(), a.horas_clase.sum()))
                for c, a in g.groupby("asignatura_cod")]
        sem = [dict(semana=int(s), dia_desde=(int(s) - 1) * 7 + 1, dia_hasta=min(DIA_CORTE if s == 4 else int(s) * 7, fin),
                    horas=float(a.horas_clase.sum()), ausentes=float(a.aus.sum()), pct=pct(a.aus.sum(), a.horas_clase.sum()))
               for s, a in g.groupby("semana")]
        dias = g.groupby("fecha").horas_asistidas.sum()
        clases = [dict(fecha=str(r.fecha.date()), dia=int(r.dia), semana=int(r.semana), codigo=r.asignatura_cod,
                       horas=float(r.horas_clase), asistidas=float(r.horas_asistidas))
                  for r in g.sort_values(["fecha", "asignatura_cod", "nro_clase"]).itertuples()]
        total = dict(horas=float(g.horas_clase.sum()), asistidas=float(g.horas_asistidas.sum()), ausentes=float(g.aus.sum()),
                     pct=pct(g.aus.sum(), g.horas_clase.sum()), dias_con_clase=int(len(dias)), dias_asistidos=int((dias > 0).sum()))
        filas.append(dict(periodo=periodo, cedula=cedula, detalle=dict(total=total, asignaturas=asig, semanas=sem, clases=clases)))
    return pd.DataFrame(filas)


# ------------------------------------------------------------------ principal
def main():
    sal = _sal()
    larga = pd.read_pickle(CACHE / "asistencia_larga.pkl")
    notas = pd.read_pickle(CACHE / "notas_finales.pkl")
    larga["jornada"] = larga.jornada.str.replace(r"\(\d+\)", "", regex=True)

    ini = fechas_inicio(larga)
    tramos = intervalos_sin_control(larga)
    print("\n== Tramos sin control de asistencia (el conteo de los 28 días se pausa)")
    for p, tt in tramos.items():
        for a, b in tt:
            print(f"  {p}: del {a.date()} al {b.date()} ({(b - a).days + 1} días)")
    if not tramos:
        print("  ninguno")
    ini["dias_sin_control_asistencia"] = 0
    for p, tt in tramos.items():
        m = (ini.periodo == p).values
        corte = fecha_corte(ini.loc[m, "fecha_inicio_clases"], tt)
        ini.loc[m, "dias_sin_control_asistencia"] = (corte - ini.loc[m, "fecha_corte_d28"]).dt.days.values
        ini.loc[m, "fecha_corte_d28"] = corte.values
    ini.sort_values(["periodo", "nivel_num", "carrera_nombre", "paralelo", "jornada"]).to_csv(
        SALIDAS / "fechas_inicio_clases.csv", index=False, encoding="utf-8-sig")
    resumen_ini = ini.groupby(["periodo", "nivel_num"]).agg(
        inicio_mas_temprano=("fecha_inicio_clases", "min"), inicio_mas_tardio=("fecha_inicio_clases", "max"),
        grupos=("carrera_sigla", "size")).reset_index()
    print("\n== Inicio de clases por periodo y nivel"); print(resumen_ini.to_string(index=False))

    # ---------- población de primer nivel
    L1 = larga[larga.nivel_num == 1].copy()
    grupo = ["periodo", "carrera_sigla", "nivel_num", "paralelo", "jornada"]
    L1 = L1.merge(ini[grupo + ["fecha_inicio_clases"]], on=grupo, how="left")
    # si un estudiante figura en más de un grupo de primer nivel, se toma el de más asignaturas
    pert = L1.groupby(["periodo", "cedula"] + grupo[1:]).asignatura_cod.nunique().rename("n").reset_index()
    pert = pert.sort_values("n", ascending=False).drop_duplicates(["periodo", "cedula"])
    base = pert.merge(ini[grupo + ["carrera_nombre", "fecha_inicio_clases"]], on=grupo, how="left").drop(columns="n")
    n_asig = L1.groupby(["periodo", "cedula"]).asignatura_cod.nunique().rename("n_asignaturas_matriculadas")
    base = base.merge(n_asig, on=["periodo", "cedula"])

    ultimo_dato = larga[larga.clase_valida].groupby("periodo").fecha.max().rename("fecha_ultimo_dato")
    base = base.merge(ultimo_dato, on="periodo")
    base["fecha_corte"] = base.fecha_inicio_clases + pd.Timedelta(days=DIA_CORTE - 1)
    base["dias_sin_control_asistencia"] = 0
    for p, tt in tramos.items():
        m = (base.periodo == p).values
        corte = fecha_corte(base.loc[m, "fecha_inicio_clases"], tt)
        base.loc[m, "dias_sin_control_asistencia"] = (corte - base.loc[m, "fecha_corte"]).dt.days.values
        base.loc[m, "fecha_corte"] = corte.values
    en_curso = base.periodo == PERIODO_EN_CURSO
    base.loc[en_curso, "fecha_corte"] = base.loc[en_curso, ["fecha_corte", "fecha_ultimo_dato"]].min(axis=1)
    base["dias_observados"] = (base.fecha_corte - base.fecha_inicio_clases).dt.days + 1 - base.dias_sin_control_asistencia
    base["estado_periodo"] = np.where(en_curso, "EN_CURSO", "CERRADO")

    # ---------- modalidad y retiros (maestro de matrículas)
    mat = leer_matriculas()
    m1 = mat[mat.nivel == "PRIMERO"].copy()
    mod_carrera = (m1.groupby("carrera").modalidad.agg(lambda s: s.value_counts().index[0])).to_dict()
    base["carrera_norm"] = base.carrera_nombre.map(_txt)
    base["modalidad"] = base.carrera_norm.map(mod_carrera)
    sin_mod = sorted(base[base.modalidad.isna()].carrera_norm.unique())
    if sin_mod:
        print("\nCarreras sin modalidad en el maestro de matrículas (se asumen PRESENCIAL):", sin_mod)
    base["modalidad"] = base.modalidad.fillna("PRESENCIAL")
    mm = m1[m1.modalidad.isin(["PRESENCIAL", "DUAL"])].sort_values("estado_matricula").drop_duplicates(["periodo", "cedula", "carrera"])
    base = base.merge(mm[["periodo", "cedula", "carrera", "estado_matricula", "tipo_ingreso", "tipo_matricula"]]
                      .rename(columns={"carrera": "carrera_norm"}), on=["periodo", "cedula", "carrera_norm"], how="left")

    # retirados: constan en matrículas, pero SIGA los elimina de los registros de asistencia
    ret = m1[(m1.estado_matricula == "RETIRADO") & m1.modalidad.isin(["PRESENCIAL", "DUAL"])].copy()
    ret = ret[~ret.set_index(["periodo", "cedula"]).index.isin(base.set_index(["periodo", "cedula"]).index)]
    ret = ret.drop_duplicates(["periodo", "cedula"])
    retirados = pd.DataFrame({"periodo": ret.periodo, "cedula": ret.cedula, "carrera_norm": ret.carrera,
                              "carrera_nombre": ret.carrera, "modalidad": ret.modalidad,
                              "jornada": ret.paralelo_jornada.str.split("_").str[-1],
                              "paralelo": ret.paralelo_jornada.str.split("_").str[0],
                              "estado_matricula": "RETIRADO", "estado_periodo": "CERRADO",
                              "tiene_registro_asistencia": "NO"})
    base["tiene_registro_asistencia"] = "SI"

    # ---------- predictores de asistencia (solo días 1 a 28)
    V = L1[L1.clase_valida].merge(base[["periodo", "cedula", "fecha_corte"]], on=["periodo", "cedula"])
    V["dia"] = (V.fecha - V.fecha_inicio_clases).dt.days + 1
    V["con_control"] = True
    for p, tt in tramos.items():
        m = (V.periodo == p).values
        V.loc[m, "dia"] = V.loc[m, "dia"].values - dias_pausados(V.loc[m, "fecha"], V.loc[m, "fecha_inicio_clases"], tt)
        V.loc[m, "con_control"] = ~np.logical_or.reduce([(V.loc[m, "fecha"] >= a) & (V.loc[m, "fecha"] <= b) for a, b in tt])
    V["en_ventana"] = (V.dia >= 1) & (V.fecha <= V.fecha_corte) & V.con_control
    pa = predictores_asistencia(V)
    base = base.merge(pa, on=["periodo", "cedula"], how="left")

    # desglose por asignatura, semana y clase de cada estudiante (para la página de detalle de la aplicación)
    det = detalle_asistencia(V, base.set_index(["periodo", "cedula"]).dias_observados)
    det.insert(1, "id_estudiante", det.cedula.map(lambda c: seudonimo(c, sal)))
    det.drop(columns="cedula").to_pickle(SALIDAS / "detalle_asistencia.pkl")

    # Mismos predictores de asistencia, pero recortados al número de días que lleva observada la cohorte
    # en curso: sirven para entrenar un modelo comparable mientras su ventana de 28 días no se completa.
    horizonte = int(base.loc[en_curso, "dias_observados"].max()) if en_curso.any() else DIA_CORTE
    if horizonte < DIA_CORTE:
        Vh = V[V.periodo.isin(PERIODOS_CERRADOS)].copy()
        Vh["en_ventana"] = Vh.en_ventana & (Vh.dia <= horizonte)
        ph = predictores_asistencia(Vh)
        ph["horizonte_dias"] = horizonte
        ph.insert(0, "id_estudiante", ph.cedula.map(lambda c: seudonimo(c, sal)))
        ph.drop(columns="cedula").to_pickle(SALIDAS / "predictores_horizonte.pkl")
    elif (SALIDAS / "predictores_horizonte.pkl").exists():
        (SALIDAS / "predictores_horizonte.pkl").unlink()

    # regla determinística: inasistencia ya irreversible (supera el 30 % del TOTAL de horas de la asignatura)
    total_asig = V.groupby(["periodo", "asignatura_cod", "paralelo", "jornada"]).apply(
        lambda g: g.drop_duplicates("nro_clase").horas_clase.sum(), include_groups=False).rename("horas_totales").reset_index()
    hist = total_asig[total_asig.periodo.isin(PERIODOS_CERRADOS)]
    ref_asig = hist.sort_values("periodo").groupby("asignatura_cod").horas_totales.last()
    ref_global = hist.horas_totales.median()
    vw = V[V.en_ventana].assign(h_aus=lambda x: x.horas_clase - x.horas_asistidas)
    ir = vw.groupby(["periodo", "cedula", "asignatura_cod", "paralelo", "jornada"]).h_aus.sum().reset_index()
    ir = ir.merge(total_asig, on=["periodo", "asignatura_cod", "paralelo", "jornada"], how="left")
    curso = ir.periodo == PERIODO_EN_CURSO
    ir.loc[curso, "horas_totales"] = ir.loc[curso, "asignatura_cod"].map(ref_asig).fillna(ref_global)
    ir["pct_sobre_total"] = 100 * ir.h_aus / ir.horas_totales
    ir2 = ir.groupby(["periodo", "cedula"]).pct_sobre_total.max().rename("max_pct_inasist_sobre_total_d28").reset_index()
    base = base.merge(ir2, on=["periodo", "cedula"], how="left")
    base["irreversible_inasistencia_d28"] = np.where(base.max_pct_inasist_sobre_total_d28 > LIMITE_INASISTENCIA, "SI", "NO")

    # ---------- huella en ATENEA
    act = leer_actividades()
    pact = predictores_actividades(act, base)
    base = base.merge(pact, on=["periodo", "cedula"], how="left")
    base["tiene_datos_atenea"] = base.periodo.isin(act.periodo.unique())
    con_at = base.tiene_datos_atenea
    base.loc[con_at & base.n_actividades_d28.isna(), "n_actividades_d28"] = 0

    # ---------- admisión y ficha socioeconómica
    socio = leer_socio()
    base = base.merge(socio, on=["periodo", "cedula"], how="left")
    cac = leer_cac()
    cac["orden"] = cac.periodo_cac
    b2 = base[["periodo", "cedula"]].merge(cac, on="cedula")
    b2 = b2[b2.periodo_cac <= b2.periodo].sort_values("periodo_cac").drop_duplicates(["periodo", "cedula"], keep="last")
    base = base.merge(b2[["periodo", "cedula", "puntaje_admision", "fecha_nacimiento_cac"]], on=["periodo", "cedula"], how="left")
    nac = base.fecha_nacimiento.fillna(base.fecha_nacimiento_cac)
    base["edad_anios"] = np.floor((base.fecha_inicio_clases - nac).dt.days / 365.25)
    base.loc[(base.edad_anios < 15) | (base.edad_anios > 80), "edad_anios"] = np.nan

    # ---------- desenlace (cierre del periodo)
    fin = L1.drop_duplicates(["periodo", "cedula", "asignatura_cod"])[["periodo", "cedula", "asignatura_cod",
                                                                      "asist_pct_reporte", "estado_reporte"]]
    fin = fin.merge(notas.drop_duplicates(["periodo", "cedula", "asignatura_cod"])[["periodo", "cedula", "asignatura_cod",
                                                                                     "nota_final", "promocion"]],
                    on=["periodo", "cedula", "asignatura_cod"], how="left")
    fin["rep_inasist"] = fin.estado_reporte.eq("Rep. por Asistencia")
    fin["rep_rend"] = (~fin.rep_inasist) & fin.promocion.eq("NO PROMOVIDO")
    des = fin.groupby(["periodo", "cedula"]).agg(n_asig_reprobadas_inasistencias=("rep_inasist", "sum"),
                                                 n_asig_reprobadas_rendimiento=("rep_rend", "sum"),
                                                 asist_final_media=("asist_pct_reporte", "mean")).reset_index()
    des["pct_inasistencia_final"] = 100 - des.asist_final_media
    base = base.merge(des.drop(columns="asist_final_media"), on=["periodo", "cedula"], how="left")
    base["prop_asig_reprobadas_inasistencias"] = base.n_asig_reprobadas_inasistencias / base.n_asignaturas_matriculadas
    base["via_salida"] = np.select(
        [base.n_asig_reprobadas_inasistencias >= 1, base.n_asig_reprobadas_rendimiento >= 1],
        ["REPRUEBA_INASISTENCIAS", "PERMANECE_REPRUEBA_RENDIMIENTO"], "PERMANECE_APRUEBA")
    base.loc[base.estado_matricula == "RETIRADO", "via_salida"] = "RETIRO_VOLUNTARIO"
    base.loc[base.estado_periodo == "EN_CURSO", ["via_salida", "n_asig_reprobadas_inasistencias",
                                                  "n_asig_reprobadas_rendimiento", "pct_inasistencia_final",
                                                  "prop_asig_reprobadas_inasistencias"]] = np.nan
    retirados["via_salida"] = "RETIRO_VOLUNTARIO"

    # continuidad en el periodo siguiente (solo descriptivo, para validar el desenlace)
    per_orden = PERIODOS_CERRADOS + [PERIODO_EN_CURSO]
    sig = {p: per_orden[i + 1] for i, p in enumerate(per_orden[:-1])}
    presentes = set(zip(mat.periodo, mat.cedula)) | set(zip(larga.periodo, larga.cedula))
    base["continua_periodo_siguiente"] = [
        np.nan if p not in sig else float((sig[p], c) in presentes) for p, c in zip(base.periodo, base.cedula)]

    ds = pd.concat([base, retirados], ignore_index=True)
    ds["grupo"] = np.select([ds.via_salida.eq("RETIRO_VOLUNTARIO"), ds.irreversible_inasistencia_d28.eq("SI")],
                            ["DETECCION_RETIRO", "DETECCION_INASISTENCIA_IRREVERSIBLE"], "PREDICCION")
    ds["y"] = np.where(ds.estado_periodo.eq("EN_CURSO"), np.nan, ds.via_salida.eq("REPRUEBA_INASISTENCIAS").astype(float))

    # nivel socioeconómico por quintiles de ingreso per cápita (solo para análisis de subgrupos)
    cortes = ds.loc[ds.estado_periodo == "CERRADO", "ingreso_per_capita_hogar"].quantile([.2, .4, .6, .8]).values
    ds["nivel_socioeconomico"] = pd.cut(ds.ingreso_per_capita_hogar, [-np.inf, *cortes, np.inf],
                                        labels=["Q1", "Q2", "Q3", "Q4", "Q5"]).astype(object)

    # ---------- seudonimización y salida
    llave = ds[["periodo", "cedula"]].drop_duplicates()
    nombres = larga.drop_duplicates(["periodo", "cedula"])[["periodo", "cedula", "estudiante"]]
    nombres = pd.concat([nombres, mat.rename(columns={"nombre": "estudiante"})[["periodo", "cedula", "estudiante"]]])
    llave = llave.merge(nombres.drop_duplicates(["periodo", "cedula"]), on=["periodo", "cedula"], how="left")
    llave["id_estudiante"] = llave.cedula.map(lambda c: seudonimo(c, sal))
    llave.to_csv(CACHE / "llave_identidad.csv", index=False, encoding="utf-8-sig")   # CONFIDENCIAL: no sale del equipo
    ds.insert(0, "id_estudiante", ds.cedula.map(lambda c: seudonimo(c, sal)))
    ds = ds.drop(columns=["cedula", "fecha_nacimiento", "fecha_nacimiento_cac", "carrera_norm", "fecha_ultimo_dato",
                          "nivel_num"], errors="ignore")
    ds = ds.sort_values(["periodo", "carrera_nombre", "id_estudiante"]).reset_index(drop=True)
    ds.to_pickle(SALIDAS / "dataset_primer_nivel.pkl")
    ds.to_csv(SALIDAS / "dataset_primer_nivel.csv", index=False, encoding="utf-8-sig")

    # ---------- perfilado
    pd.set_option("display.width", 250); pd.set_option("display.max_columns", 40)
    print(f"\nDataset: {ds.shape[0]} filas x {ds.shape[1]} columnas")
    print(ds.groupby(["periodo", "modalidad"]).size().unstack(fill_value=0))
    pres = ds[ds.modalidad == "PRESENCIAL"]
    print("\n== PRESENCIAL: vía de salida por periodo")
    print(pres.groupby(["periodo", "via_salida"], dropna=False).size().unstack(fill_value=0))
    print("\n== PRESENCIAL: grupo por periodo")
    print(pres.groupby(["periodo", "grupo"]).size().unstack(fill_value=0))
    G = pres[(pres.grupo == "PREDICCION") & (pres.estado_periodo == "CERRADO")]
    print("\n== Grupo de predicción: tasa de positivos y calidad de la asistencia al día 28")
    print(G.groupby("periodo").agg(n=("y", "size"), positivos=("y", "sum"), tasa=("y", "mean"),
                                   con_alguna_inasist=("pct_inasistencia_d28", lambda s: (s > 0).mean()),
                                   inasist_media=("pct_inasistencia_d28", "mean"),
                                   horas_prog=("horas_programadas_d28", "median"),
                                   dias_clase=("dias_con_clase_d28", "median"),
                                   continua_pos=("continua_periodo_siguiente", lambda s: s[G.loc[s.index, "y"] == 1].mean()),
                                   continua_neg=("continua_periodo_siguiente", lambda s: s[G.loc[s.index, "y"] == 0].mean())).round(3))
    print("\n== Positivos según proporción de asignaturas reprobadas por inasistencias")
    print(pd.cut(G[G.y == 1].prop_asig_reprobadas_inasistencias, [0, .34, .67, .99, 1]).value_counts().sort_index())
    print("\n== Faltantes (%) en el grupo de predicción")
    print((G.isna().mean() * 100).round(1).loc[lambda s: s > 0].to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
