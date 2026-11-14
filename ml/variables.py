"""Definición de los conjuntos de predictores (todos calculados con información de los días 1 a 28)."""
import numpy as np
import pandas as pd

ASISTENCIA = [
    "pct_inasistencia_d28", "max_pct_inasistencia_asig_d28", "prop_asig_sobre_limite_d28",
    "prop_asig_sin_asistencia_d28", "pct_inasistencia_sem12", "pct_inasistencia_sem34",
    "prop_dias_asistidos_d28", "dia_primera_asistencia", "racha_final_ausente_prop",
    "prop_asistencia_parcial_d28",
]
# No se incluyen el número de asignaturas matriculadas ni el número de actividades asignadas: dependen de la
# malla y del docente de cada periodo (no del comportamiento del estudiante) y distorsionan la predicción
# cuando el modelo se aplica a un periodo con otra malla (p. ej. 6 asignaturas en 2023-2P frente a 5 después).
ATENEA = ["prop_entregadas_d28", "prop_a_tiempo_d28", "dias_con_entrega_d28", "dia_primera_entrega"]
CONTEXTO = ["puntaje_admision", "edad_anios", "sexo_M", "jornada_nocturna", "jornada_vespertina", "trabaja",
            "log_ingreso_pc", "colegio_fiscal", "primera_generacion", "recibe_bdh", "reside_machala", "soltero"]

CONJUNTOS = {
    "A": ("Asistencia", ASISTENCIA),
    "B": ("Asistencia + admisión y contexto", ASISTENCIA + CONTEXTO),
    "C": ("Asistencia + plataforma virtual (ATENEA)", ASISTENCIA + ATENEA),
}

ETIQUETAS = {
    "pct_inasistencia_d28": "Inasistencia acumulada (%)",
    "max_pct_inasistencia_asig_d28": "Inasistencia en su asignatura más crítica (%)",
    "prop_asig_sobre_limite_d28": "Proporción de asignaturas sobre el 30 % de inasistencia",
    "prop_asig_sin_asistencia_d28": "Proporción de asignaturas sin ninguna asistencia",
    "pct_inasistencia_sem12": "Inasistencia en semanas 1-2 (%)",
    "pct_inasistencia_sem34": "Inasistencia en semanas 3-4 (%)",
    "prop_dias_asistidos_d28": "Proporción de días asistidos",
    "dia_primera_asistencia": "Día de la primera asistencia",
    "racha_final_ausente_prop": "Racha final de días ausente (proporción)",
    "prop_asistencia_parcial_d28": "Proporción de clases con asistencia parcial",
    "n_asignaturas_matriculadas": "Asignaturas matriculadas",
    "n_actividades_d28": "Actividades asignadas en la plataforma",
    "prop_entregadas_d28": "Proporción de actividades entregadas",
    "prop_a_tiempo_d28": "Proporción de actividades entregadas a tiempo",
    "dias_con_entrega_d28": "Días con entregas en la plataforma",
    "dia_primera_entrega": "Día de la primera entrega en la plataforma",
    "puntaje_admision": "Puntaje de admisión",
    "edad_anios": "Edad (años)",
    "sexo_M": "Sexo masculino",
    "jornada_nocturna": "Jornada nocturna",
    "jornada_vespertina": "Jornada vespertina",
    "trabaja": "Trabaja y estudia",
    "log_ingreso_pc": "Ingreso per cápita del hogar (log)",
    "colegio_fiscal": "Colegio fiscal",
    "primera_generacion": "Primera generación en educación superior",
    "recibe_bdh": "Hogar recibe bono de desarrollo humano",
    "reside_machala": "Reside en Machala",
    "soltero": "Estado civil soltero",
}


def _bin(serie, valor):
    return serie.map(lambda v: np.nan if pd.isna(v) else float(v == valor))


def matriz(d, conjunto):
    """Predictores de un conjunto. Acepta el dataset de entrenamiento (ya codificado) o el dataset de
    primer nivel (sin codificar, p. ej. la cohorte en curso que se va a puntuar)."""
    cols = CONJUNTOS[conjunto][1]
    if "sexo_M" in d.columns:
        return d[cols].astype(float)
    return codificar(d)[cols]


def codificar(d):
    """Todos los predictores (asistencia, plataforma y contexto) codificados como números."""
    X = pd.DataFrame(index=d.index)
    for c in ASISTENCIA + ATENEA:
        X[c] = pd.to_numeric(d[c], errors="coerce") if c in d else np.nan
    X["puntaje_admision"] = d.puntaje_admision
    X["edad_anios"] = d.edad_anios
    X["sexo_M"] = _bin(d.sexo, "M")
    X["jornada_nocturna"] = _bin(d.jornada, "NOCTURNA")
    X["jornada_vespertina"] = _bin(d.jornada, "VESPERTINA")
    X["trabaja"] = d.trabaja
    X["log_ingreso_pc"] = np.log1p(d.ingreso_per_capita_hogar.astype(float))
    X["colegio_fiscal"] = _bin(d.tipo_colegio, "FISCAL")
    X["primera_generacion"] = d.primera_generacion
    X["recibe_bdh"] = d.recibe_bdh
    X["reside_machala"] = _bin(d.canton_residencia, "MACHALA")
    X["soltero"] = _bin(d.estado_civil, "SOLTERO")
    return X[ASISTENCIA + ATENEA + CONTEXTO].astype(float)
