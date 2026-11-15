"""
Carga a PostgreSQL (local o Supabase): esquema, usuarios iniciales, fechas de inicio,
alertas y resultados del entrenamiento.

Uso:
    python -m ml.cargar_bd                 # usa DATABASE_URL del archivo .env de la raíz
    python -m ml.cargar_bd --solo-esquema  # crea tablas y usuarios iniciales, sin datos del modelo

Variables:
    DATABASE_URL          postgresql://usuario:clave@host:puerto/db_alertas
    INCLUIR_IDENTIDAD=1   carga también cédula y nombre (por defecto solo el seudónimo)
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import Json, execute_values

from ml.config import CACHE, RAIZ, SALIDAS
from ml.seguridad import hash_password

USUARIOS_INICIALES = [  # contraseñas temporales: la aplicación obliga a cambiarlas en el primer ingreso
    ("Administrador", "Administrador", "ADMINISTRADOR", "admin"),
    ("Docente", "Docente", "DOCENTE", "docente123"),
]
CONFIG_INICIAL = [
    ("institucion", "Institución de Educación Superior", "Nombre que se muestra en la aplicación"),
    ("capacidad_semanal", "40", "Estudiantes que el equipo de bienestar puede contactar por semana"),
    ("mostrar_identidad_docente", "no", "Si los docentes pueden ver cédula y nombre (si/no)"),
    ("seudonimizar", "si", "Ocultar cédulas y nombres de estudiantes en toda la aplicación (si/no)"),
]


def leer_env():
    ruta = RAIZ / ".env"
    if ruta.exists():
        for linea in ruta.read_text(encoding="utf-8").splitlines():
            if "=" in linea and not linea.strip().startswith("#"):
                k, v = linea.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def nn(v):
    """Convierte NaN/NaT y tipos de numpy a valores que PostgreSQL entiende."""
    if v is None or (isinstance(v, float) and np.isnan(v)) or v is pd.NaT:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, pd.Timestamp):
        return v.date()
    return v


def main():
    leer_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("Falta DATABASE_URL (defínela en el archivo .env de la raíz del proyecto).")
        return 1
    solo_esquema = "--solo-esquema" in sys.argv
    con = psycopg2.connect(url)
    con.autocommit = False
    cur = con.cursor()
    cur.execute((RAIZ / "db" / "esquema.sql").read_text(encoding="utf-8"))

    for usuario, nombre, rol, clave in USUARIOS_INICIALES:
        cur.execute("SELECT 1 FROM usuarios WHERE lower(usuario) = lower(%s)", (usuario,))
        if not cur.fetchone():
            cur.execute("INSERT INTO usuarios (usuario, nombre, rol, password_hash) VALUES (%s, %s, %s, %s)",
                        (usuario, nombre, rol, hash_password(clave)))
            print(f"Usuario creado: {usuario} ({rol})")
    for clave, valor, desc in CONFIG_INICIAL:
        cur.execute("INSERT INTO configuracion (clave, valor, descripcion) VALUES (%s, %s, %s) ON CONFLICT (clave) DO NOTHING",
                    (clave, valor, desc))
    con.commit()
    if solo_esquema:
        print("Esquema y usuarios iniciales listos.")
        return 0

    # ---------------- fechas de inicio de clases
    ini = pd.read_csv(SALIDAS / "fechas_inicio_clases.csv", parse_dates=["fecha_inicio_clases", "fecha_corte_d28", "fecha_ultima_clase"])
    cur.execute("TRUNCATE inicio_clases RESTART IDENTITY")
    execute_values(cur, """INSERT INTO inicio_clases (periodo, carrera_sigla, carrera, nivel, paralelo, jornada, fecha_inicio_clases,
                           fecha_corte_d28, fecha_ultima_clase, n_asignaturas, n_estudiantes, dias_desfase) VALUES %s""",
                   [tuple(nn(x) for x in (r.periodo, r.carrera_sigla, r.carrera_nombre, r.nivel_num, r.paralelo, r.jornada,
                                          r.fecha_inicio_clases, r.fecha_corte_d28, r.fecha_ultima_clase, r.n_asignaturas,
                                          r.n_estudiantes, r.dias_desfase)) for r in ini.itertuples()])

    # ---------------- alertas (se conserva el seguimiento ya registrado por el personal)
    a = pd.read_pickle(SALIDAS / "alertas.pkl")
    if os.environ.get("INCLUIR_IDENTIDAD") == "1":
        llave = pd.read_csv(CACHE / "llave_identidad.csv", dtype=str).drop_duplicates(["periodo", "id_estudiante"])
        a = a.merge(llave[["periodo", "id_estudiante", "cedula", "estudiante"]], on=["periodo", "id_estudiante"], how="left")
    else:
        a["cedula"] = None; a["estudiante"] = None
    a = a.drop_duplicates(["periodo", "id_estudiante"])
    filas = []
    for r in a.itertuples():
        zona = None if pd.isna(r.canton_residencia) else ("Machala" if r.canton_residencia == "MACHALA" else "Otros cantones")
        filas.append(tuple(nn(x) for x in (
            r.periodo, r.id_estudiante, r.cedula, r.estudiante, r.carrera_nombre, r.paralelo, r.jornada, r.estado_periodo, r.grupo,
            r.motivo_deteccion, r.nivel_riesgo, r.puntaje, r.probabilidad,
            None if pd.isna(r.pct_inasistencia_d28) else bool(r.alerta_linea_base), r.modelo, Json(r.factores),
            r.fecha_inicio_clases, r.fecha_corte, r.dias_observados, r.n_asignaturas_matriculadas, r.pct_inasistencia_d28,
            r.max_pct_inasistencia_asig_d28, r.prop_dias_asistidos_d28, r.dia_primera_asistencia, r.prop_entregadas_d28,
            r.sexo, r.edad_anios, r.nivel_socioeconomico, zona, None if pd.isna(r.trabaja) else bool(r.trabaja),
            r.via_salida, None if pd.isna(r.y) else bool(r.y))))
    execute_values(cur, """
        INSERT INTO alertas (periodo, id_estudiante, identificacion, nombre, carrera, paralelo, jornada, estado_periodo, grupo,
            motivo_deteccion, nivel_riesgo, puntaje, probabilidad, alerta_linea_base, modelo, factores, fecha_inicio_clases,
            fecha_corte, dias_observados, n_asignaturas, pct_inasistencia_d28, max_pct_inasistencia_asig_d28,
            prop_dias_asistidos_d28, dia_primera_asistencia, prop_entregadas_d28, sexo, edad, nivel_socioeconomico, zona,
            trabaja, via_salida, reprobo_inasistencias)
        VALUES %s
        ON CONFLICT (periodo, id_estudiante) DO UPDATE SET
            identificacion = EXCLUDED.identificacion, nombre = EXCLUDED.nombre, carrera = EXCLUDED.carrera,
            paralelo = EXCLUDED.paralelo, jornada = EXCLUDED.jornada, estado_periodo = EXCLUDED.estado_periodo,
            grupo = EXCLUDED.grupo, motivo_deteccion = EXCLUDED.motivo_deteccion, nivel_riesgo = EXCLUDED.nivel_riesgo,
            puntaje = EXCLUDED.puntaje, probabilidad = EXCLUDED.probabilidad, alerta_linea_base = EXCLUDED.alerta_linea_base,
            modelo = EXCLUDED.modelo, factores = EXCLUDED.factores, fecha_inicio_clases = EXCLUDED.fecha_inicio_clases,
            fecha_corte = EXCLUDED.fecha_corte, dias_observados = EXCLUDED.dias_observados, n_asignaturas = EXCLUDED.n_asignaturas,
            pct_inasistencia_d28 = EXCLUDED.pct_inasistencia_d28,
            max_pct_inasistencia_asig_d28 = EXCLUDED.max_pct_inasistencia_asig_d28,
            prop_dias_asistidos_d28 = EXCLUDED.prop_dias_asistidos_d28, dia_primera_asistencia = EXCLUDED.dia_primera_asistencia,
            prop_entregadas_d28 = EXCLUDED.prop_entregadas_d28, sexo = EXCLUDED.sexo, edad = EXCLUDED.edad,
            nivel_socioeconomico = EXCLUDED.nivel_socioeconomico, zona = EXCLUDED.zona, trabaja = EXCLUDED.trabaja,
            via_salida = EXCLUDED.via_salida, reprobo_inasistencias = EXCLUDED.reprobo_inasistencias
        """, filas, page_size=500)
    cur.execute("DELETE FROM alertas WHERE (periodo, id_estudiante) NOT IN %s", (tuple((f[0], f[1]) for f in filas),))

    # ---------------- desglose de asistencia por asignatura, semana y clase (página de detalle del estudiante)
    ruta_det = SALIDAS / "detalle_asistencia.pkl"
    if ruta_det.exists():
        det = pd.read_pickle(ruta_det).drop_duplicates(["periodo", "id_estudiante"])
        cur.execute("UPDATE alertas SET detalle_asistencia = NULL")
        execute_values(cur, """UPDATE alertas a SET detalle_asistencia = v.d::jsonb
                               FROM (VALUES %s) AS v(periodo, id_estudiante, d)
                               WHERE a.periodo = v.periodo AND a.id_estudiante = v.id_estudiante""",
                       [(r.periodo, r.id_estudiante, json.dumps(r.detalle, ensure_ascii=False)) for r in det.itertuples()], page_size=300)

    # ---------------- periodos y resultados del entrenamiento
    res = json.load(open(SALIDAS / "resultados.json", encoding="utf-8"))
    resumen = {x["periodo"]: x for x in json.load(open(SALIDAS / "resumen_puntuacion.json", encoding="utf-8"))}
    cur.execute("TRUNCATE periodos")
    for p, g in a.groupby("periodo"):
        s = resumen.get(p, {})
        estado = g.estado_periodo.iloc[0]
        rol = "COHORTE_ACTUAL" if estado == "EN_CURSO" else ("PRUEBA" if p == res["meta"]["periodo_prueba"] else "ENTRENAMIENTO")
        cur.execute("""INSERT INTO periodos (periodo, estado, rol_modelo, inicio_primer_nivel, ultimo_dato, dias_observados, modelo,
                       umbral_alto, umbral_medio) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (p, estado, rol, nn(g.fecha_inicio_clases.min()), nn(g.fecha_corte.max()), nn(g.dias_observados.max()),
                     s.get("modelo"), s.get("umbral_alto"), s.get("umbral_medio")))
    cur.execute("UPDATE ejecuciones_modelo SET activo = FALSE")
    cur.execute("INSERT INTO ejecuciones_modelo (ejecutado_en, activo, resultados) VALUES (%s, TRUE, %s)",
                (res["meta"]["fecha"], Json(res)))
    con.commit()
    cur.execute("SELECT periodo, nivel_riesgo, count(*) FROM alertas GROUP BY 1, 2 ORDER BY 1, 2")
    print(pd.DataFrame(cur.fetchall(), columns=["periodo", "nivel", "n"]).pivot(index="periodo", columns="nivel", values="n").fillna(0).astype(int))
    print(f"Carga completa: {len(filas)} estudiantes, {len(ini)} grupos con fecha de inicio.")
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
