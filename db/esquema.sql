-- Sistema de Alertas Académicas - esquema PostgreSQL (local y Supabase)
-- Se puede ejecutar varias veces sin perder datos (idempotente).

CREATE TABLE IF NOT EXISTS usuarios (
    id                     BIGSERIAL PRIMARY KEY,
    usuario                TEXT        NOT NULL,
    nombre                 TEXT        NOT NULL,
    rol                    TEXT        NOT NULL CHECK (rol IN ('ADMINISTRADOR', 'DOCENTE')),
    password_hash          TEXT        NOT NULL,
    activo                 BOOLEAN     NOT NULL DEFAULT TRUE,
    debe_cambiar_password  BOOLEAN     NOT NULL DEFAULT TRUE,
    ultimo_acceso          TIMESTAMPTZ,
    creado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_usuario_uk ON usuarios (lower(usuario));

CREATE TABLE IF NOT EXISTS configuracion (
    clave           TEXT PRIMARY KEY,
    valor           TEXT NOT NULL,
    descripcion     TEXT,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS periodos (
    periodo            TEXT PRIMARY KEY,
    estado             TEXT NOT NULL CHECK (estado IN ('CERRADO', 'EN_CURSO')),
    rol_modelo         TEXT,                -- ENTRENAMIENTO | PRUEBA | COHORTE_ACTUAL
    inicio_primer_nivel DATE,
    ultimo_dato        DATE,
    dias_observados    INT,
    modelo             TEXT,
    umbral_alto        NUMERIC,
    umbral_medio       NUMERIC
);

CREATE TABLE IF NOT EXISTS inicio_clases (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             TEXT NOT NULL,
    carrera_sigla       TEXT NOT NULL,
    carrera             TEXT NOT NULL,
    nivel               INT  NOT NULL,
    paralelo            TEXT NOT NULL,
    jornada             TEXT NOT NULL,
    fecha_inicio_clases DATE NOT NULL,
    fecha_corte_d28     DATE NOT NULL,
    fecha_ultima_clase  DATE,
    n_asignaturas       INT,
    n_estudiantes       INT,
    dias_desfase        INT
);
CREATE INDEX IF NOT EXISTS inicio_clases_periodo_ix ON inicio_clases (periodo, nivel);

CREATE TABLE IF NOT EXISTS alertas (
    id                     BIGSERIAL PRIMARY KEY,
    periodo                TEXT NOT NULL,
    id_estudiante          TEXT NOT NULL,        -- seudónimo irreversible
    identificacion         TEXT,                 -- solo si se cargó con INCLUIR_IDENTIDAD=1
    nombre                 TEXT,                 -- solo si se cargó con INCLUIR_IDENTIDAD=1
    carrera                TEXT,
    paralelo               TEXT,
    jornada                TEXT,
    estado_periodo         TEXT NOT NULL,
    grupo                  TEXT NOT NULL,        -- PREDICCION | DETECCION_*
    motivo_deteccion       TEXT,
    nivel_riesgo           TEXT NOT NULL,        -- ALTO | MEDIO | BAJO | DETECTADO | SIN_PUNTAJE
    puntaje                NUMERIC,
    probabilidad           NUMERIC,
    alerta_linea_base      BOOLEAN,
    modelo                 TEXT,
    factores               JSONB NOT NULL DEFAULT '[]',
    fecha_inicio_clases    DATE,
    fecha_corte            DATE,
    dias_observados        INT,
    n_asignaturas          INT,
    pct_inasistencia_d28   NUMERIC,
    max_pct_inasistencia_asig_d28 NUMERIC,
    prop_dias_asistidos_d28 NUMERIC,
    dia_primera_asistencia INT,
    prop_entregadas_d28    NUMERIC,
    sexo                   TEXT,
    edad                   INT,
    nivel_socioeconomico   TEXT,
    zona                   TEXT,
    trabaja                BOOLEAN,
    via_salida             TEXT,                 -- desenlace real (solo periodos cerrados)
    reprobo_inasistencias  BOOLEAN,
    estado_seguimiento     TEXT NOT NULL DEFAULT 'PENDIENTE'
                           CHECK (estado_seguimiento IN ('PENDIENTE', 'CONTACTADO', 'EN_ACOMPANAMIENTO', 'CERRADO')),
    nota_seguimiento       TEXT,
    seguimiento_por        TEXT,
    seguimiento_en         TIMESTAMPTZ,
    UNIQUE (periodo, id_estudiante)
);
CREATE INDEX IF NOT EXISTS alertas_periodo_ix ON alertas (periodo, nivel_riesgo);

CREATE TABLE IF NOT EXISTS ejecuciones_modelo (
    id          BIGSERIAL PRIMARY KEY,
    ejecutado_en TIMESTAMPTZ NOT NULL,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    resultados  JSONB NOT NULL
);

-- En Supabase, estas tablas solo deben ser accesibles desde el servidor de la aplicación
-- (conexión directa de Postgres). RLS activado y sin políticas = la API pública no puede leerlas.
ALTER TABLE usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion      ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inicio_clases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejecuciones_modelo ENABLE ROW LEVEL SECURITY;
