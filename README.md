# Sistema de Alertas Académicas

Sistema de alertas tempranas que, con la información de las **primeras cuatro semanas de clases**, detecta los casos de no continuidad ya constatables y estima el riesgo de que un estudiante de **primer nivel** termine reprobando por inasistencias. Las alertas son un **apoyo a la decisión humana** de bienestar estudiantil y tutoría, no una decisión automatizada.

- **PostgreSQL** guarda usuarios, alertas, fechas de inicio de clases y resultados del modelo (local con pgAdmin; producción en Supabase).
- **Python** hace todo el trabajo analítico (metodología CRISP-DM): lee los reportes de SIGA y ATENEA, construye el dataset al día 28, entrena y evalúa los modelos, explica las predicciones con SHAP y carga los resultados en la base.
- **Next.js** es la aplicación web: inicio de sesión, dashboard, entrenamiento, resultados, gestión de usuarios y configuración (local con Node; producción en Cloudflare Workers).

No se usa Docker.

---

## 1. Cómo está organizado

```
sistema-de-alertas-academicas/
├─ db/esquema.sql            Esquema PostgreSQL (se aplica solo; es idempotente)
├─ ml/                       Pipeline en Python
│  ├─ etl_asistencia.py      Lee los RegistroAsistencia-*.xls (una fila por estudiante × clase, con fecha real)
│  ├─ etl_notas.py           Lee los RegistroNotas-*.xls (solo para construir el desenlace)
│  ├─ construir_dataset.py   Fechas de inicio, ventana días 1-28, predictores, desenlace, seudonimización
│  ├─ variables.py           Conjuntos de predictores A, B y C
│  ├─ dataset_entrenamiento.py  Dataset único de entrenamiento (una fila por estudiante, con diccionario)
│  ├─ entrenar.py            Línea base, Regresión Logística, Random Forest, XGBoost, IC, equidad, SHAP
│  ├─ puntuar.py             Reglas de detección + nivel de riesgo y factores por estudiante
│  ├─ cargar_bd.py           Crea tablas, usuarios iniciales y carga todo a PostgreSQL
│  ├─ pipeline.py            Ejecuta todos los pasos en orden
│  ├─ cache/  salidas/       Datos intermedios y resultados (NO se suben a GitHub)
├─ web/                      Aplicación Next.js (App Router) lista para Cloudflare (OpenNext)
├─ .env.example              Plantilla de variables (copiar como .env)
└─ requirements.txt
```

Los reportes crudos se leen de `..\REPORTES SIGA & ATENEA` (carpeta hermana del proyecto). Puedes cambiarla con la variable `REPORTES_DIR`.

### Roles
| Rol | Puede |
|---|---|
| **Administrador** | Todo: dashboard, entrenamiento, resultados, **gestión de usuarios** (crear, editar, activar/desactivar, cambiar contraseñas, eliminar) y parámetros del sistema |
| **Docente** | Dashboard, entrenamiento, resultados (con registro de seguimiento) y cambiar su propia contraseña |

Usuarios iniciales (se crean en la primera carga y **deben cambiar la contraseña al ingresar**):

| Usuario | Contraseña temporal | Rol |
|---|---|---|
| `Administrador` | `admin` | Administrador |
| `Docente` | `docente123` | Docente |

Las contraseñas se guardan con PBKDF2-SHA256 (nunca en texto plano).

---

## 2. Ejecución local (Windows 11)

Requisitos: Python 3.11+, Node.js 20+ y PostgreSQL (con pgAdmin).

**Paso 1. Variables.** Copia `.env.example` como `.env` en la raíz y completa:

```
DATABASE_URL=postgresql://postgres:TU_CLAVE@localhost:5432/db_alertas
AUTH_SECRET=<genera una con: python -c "import secrets; print(secrets.token_urlsafe(48))">
```

**Paso 2. Dependencias de Python.**

```powershell
pip install -r requirements.txt
```

**Paso 3. Base local.** Crea la base en pgAdmin (clic derecho en *Databases → Create → Database*) o deja que el proyecto la cree:

```powershell
python -m ml.preparar_local
```

**Paso 4. Pipeline completo** (lee los reportes, entrena y carga la base; tarda unos 15 minutos la primera vez):

```powershell
python -m ml.pipeline
```

Opciones: `--sin-etl` reutiliza los reportes ya leídos; `--sin-bd` no toca la base. Si solo quieres las tablas y los dos usuarios: `python -m ml.cargar_bd --solo-esquema`.

**Paso 5. Aplicación web.**

```powershell
cd web
npm install
npm run dev
```

Abre http://localhost:3000 e ingresa con `Administrador` / `admin`.

### Cuando lleguen datos nuevos
Copia los reportes nuevos en `REPORTES SIGA & ATENEA` (por ejemplo, las asistencias actualizadas del periodo en curso dentro de `ASISTENCIAS Y NOTAS\2026-2P`) y vuelve a ejecutar `python -m ml.pipeline`. El seguimiento registrado por los usuarios se conserva.

Al iniciar un periodo nuevo, actualiza `PERIODOS_CERRADOS`, `PERIODO_EN_CURSO` y `PERIODO_PRUEBA` en `ml/config.py`.

---

## 3. Qué hace el modelo (resumen metodológico)

| Elemento | Definición |
|---|---|
| Población | Primer nivel, modalidad presencial (la modalidad dual queda fuera del alcance) |
| Día 1 | **Primera clase registrada del grupo del estudiante** (periodo + carrera + nivel + paralelo + jornada), tomada de los registros de asistencia de SIGA. No se usa una fecha única por periodo: el primer nivel empieza semanas después que los demás niveles en varios periodos |
| Ventana de predicción | Días 1 a 28. Ningún predictor usa información posterior |
| Tramos sin control de asistencia | Si durante 5 o más días de clase seguidos al menos el 90 % de los cursos de primer nivel no registra ni una hora de inasistencia, ese tramo no cuenta para los 28 días (el conteo se pausa). Solo ocurre en 2024-2P: del 24-oct al 19-nov-2024 no se registraron faltas en ningún nivel, y su día 28 pasa al 9-dic-2024 |
| Cohorte en curso | Mientras no llega al día 28 se puntúa con un modelo de solo asistencia entrenado con los periodos cerrados recortados al mismo número de días observados |
| Grupo de detección (reglas) | Retiro voluntario registrado; inasistencia ya irreversible (las horas faltadas superan el 30 % del total de horas de una asignatura) |
| Grupo de predicción | Estudiantes activos al día 28 |
| Desenlace | Reprobar por inasistencias al menos una asignatura al cierre del periodo |
| Línea base | % de inasistencia acumulada al día 28, con el umbral que maximiza F1 en entrenamiento |
| Modelos | Regresión Logística, Random Forest y XGBoost; hiperparámetros por validación cruzada estratificada repetida (5×2) dentro del entrenamiento; pesos de clase (se contrasta con SMOTE) |
| Conjuntos de variables | **A** asistencia (10) · **B** A + admisión y contexto socioeconómico (22) · **C** A + entregas en la plataforma virtual ATENEA (14). No se usan el número de asignaturas ni el de actividades asignadas: dependen de la malla del periodo, no del estudiante |
| Partición | Temporal: entrenamiento 2023-2P a 2025-2P; prueba retrospectiva 2026-1P (no interviene en ninguna decisión) |
| Evaluación | AUC-PR, AUC-ROC, Recall, Precisión, F1 y tasa de alerta con IC 95 % (bootstrap, 2 000 remuestreos); robustez dejando un periodo fuera; equidad por sexo, nivel socioeconómico, jornada, zona, edad y situación laboral |
| Explicación | Valores SHAP: importancia global y los factores que elevan la alerta de cada estudiante |
| Niveles de riesgo | **Alto**: puntaje sobre el umbral que captura al menos el 70 % de los casos en entrenamiento · **Medio**: hasta el umbral del 90 % (alto + medio nunca superan el 60 % de la cohorte) · **Bajo**: el resto |

### Dataset único de entrenamiento

Los tres modelos se entrenan y evalúan desde **un solo archivo**, `ml/salidas/dataset_entrenamiento.csv`, que reúne lo que en los reportes está repartido entre SIGA (asistencia, notas, matrículas), ATENEA (actividades), CAC (admisión) y la ficha socioeconómica. Se regenera con `python -m ml.dataset_entrenamiento` (el pipeline lo hace solo).

| Contenido | Detalle |
|---|---|
| Filas | Una por estudiante y periodo: primer nivel, presencial, periodos cerrados, grupo de predicción |
| `particion` | `ENTRENAMIENTO` (periodos anteriores) o `PRUEBA` (cohorte cerrada más reciente) |
| Predictores (26) | 10 de asistencia, 4 de la plataforma virtual y 12 de admisión y contexto, ya codificados como números y calculados solo con los días 1 a 28 |
| `y_reprueba_inasistencias` | Variable objetivo (1 = reprueba por inasistencias al menos una asignatura) |
| Columnas auxiliares | Desenlace detallado y nivel socioeconómico: sirven para la sensibilidad y la equidad, **no son predictores** |
| Datos faltantes | Quedan vacíos a propósito. La imputación se hace dentro de cada modelo y en cada pliegue de la validación cruzada, para que la prueba no influya en el entrenamiento |
| `tiene_datos_atenea` | El conjunto C solo usa las filas con `True` (no hay datos de plataforma en 2023-2P) |

`ml/salidas/dataset_entrenamiento.xlsx` trae la misma tabla con una hoja `diccionario` (rol, descripción, fuente y % de faltantes de cada columna) y una hoja `resumen` por periodo. El archivo no contiene cédulas ni nombres, pero es información individual de estudiantes y **no se sube a GitHub**.

Todos los resultados (tablas y figuras) quedan en `ml/salidas/` y se muestran en la página **Entrenamiento**. Los criterios de éxito se declararon antes de evaluar y se informan se cumplan o no.

### Resultado de la última ejecución (prueba retrospectiva 2026-1P: 187 estudiantes, 49 positivos)

| | Línea base | Modelo seleccionado (Random Forest, conjunto C) |
|---|---|---|
| AUC-PR | 0,808 | 0,862 (diferencia +0,054; IC 95 %: −0,001 a +0,121) |
| Sensibilidad a igual carga de trabajo | 0,816 | 0,816 |
| Precisión en su punto de operación | 0,513 (alerta al 42 %) | 0,679 (alerta al 28 %) |

Lectura: el modelo ordena mejor y alerta con más precisión, pero la mejora en AUC-PR no alcanza a ser estadísticamente concluyente con una cohorte de prueba de este tamaño, y a igual carga detecta los mismos casos que la regla simple. La revisión de equidad señala a la **jornada nocturna** (tasa de falsos negativos 0,43 frente a 0,32 general), que debe revisarse antes de usar el sistema. Las variables con más peso son la inasistencia de las semanas 3-4 y la proporción de actividades entregadas en la plataforma.

**Privacidad.** El dataset de modelado no contiene cédulas ni nombres: cada estudiante se identifica con un código seudónimo (hash con sal local). La llave `ml/cache/llave_identidad.csv` permite al equipo autorizado saber a quién corresponde cada código y **no sale del equipo**. Si la institución autoriza guardar identidades en la base, carga con `INCLUIR_IDENTIDAD=1`; el administrador decide en *Configuración* si los docentes las ven.

---

## 4. Subir el proyecto a GitHub

Repositorio: https://github.com/jhonathan-espol/sistema-de-alertas-academicas.git

El `.gitignore` ya excluye el `.env`, los reportes, la caché, el dataset y los modelos. **Antes de cada `git add`, revisa con `git status` que no aparezca ningún archivo `.xls`, `.xlsx`, `.csv`, `.pkl` ni el `.env`.**

```powershell
cd D:\ESPOL\sistema-de-alertas-academicas
git init
git branch -M main
git add .
git status
git commit -m "Sistema de alertas académicas: pipeline, esquema y aplicación web"
git remote add origin https://github.com/jhonathan-espol/sistema-de-alertas-academicas.git
git push -u origin main
```

Si el repositorio remoto ya tiene archivos (por ejemplo un README creado en GitHub), antes del `push` ejecuta `git pull origin main --allow-unrelated-histories` y resuelve los conflictos. La primera vez, Git abrirá el navegador para que inicies sesión en GitHub.

Para cambios posteriores: `git add .` → `git commit -m "descripción"` → `git push`.

---

## 5. Base de datos en Supabase

> En Supabase, `db_alertas` es el nombre del **proyecto**. Dentro de cada proyecto la base PostgreSQL siempre se llama `postgres`; por eso las cadenas de conexión terminan en `/postgres`.

**Paso 1. Obtén las cadenas de conexión.** En https://supabase.com/dashboard abre el proyecto `db_alertas` → botón **Connect** (parte superior). Necesitas dos:

| Uso | Opción en Supabase | Puerto | Forma |
|---|---|---|---|
| Cargar datos desde tu laptop | **Session pooler** | 5432 | `postgresql://postgres.<ref>:<CLAVE>@aws-0-<region>.pooler.supabase.com:5432/postgres` |
| La aplicación en Cloudflare | **Transaction pooler** | 6543 | `postgresql://postgres.<ref>:<CLAVE>@aws-0-<region>.pooler.supabase.com:6543/postgres` |

`<CLAVE>` es la contraseña de la base que definiste al crear el proyecto. Si no la recuerdas: *Project Settings → Database → Reset database password*. Si la clave tiene caracteres especiales (`@`, `#`, `/`, `:`), codifícalos en la URL (por ejemplo `@` → `%40`).

**Paso 2. Crea las tablas y carga los datos desde tu laptop.** En PowerShell, en la raíz del proyecto (la variable solo vale para esa ventana, tu `.env` local no cambia):

```powershell
$env:DATABASE_URL = "postgresql://postgres.<ref>:<CLAVE>@aws-0-<region>.pooler.supabase.com:5432/postgres"
python -m ml.cargar_bd
```

Esto crea las tablas, los usuarios `Administrador` y `Docente` y carga alertas, fechas de inicio y resultados del modelo (ya entrenado en local; no hace falta reentrenar). Cada vez que reentrenes, repite este paso para actualizar producción.

**Paso 3. Verifica.** En Supabase → **Table Editor** deben aparecer `usuarios`, `alertas`, `periodos`, `inicio_clases`, `ejecuciones_modelo` y `configuracion`.

**Paso 4. Seguridad (ya queda configurada por el esquema).**
- Las seis tablas tienen **Row Level Security activado y sin políticas**: la API pública de Supabase (claves `anon`/`publishable`) no puede leerlas ni escribirlas. La aplicación entra por conexión directa de PostgreSQL con la clave de la base, que solo vive como secreto en Cloudflare.
- No uses ni publiques la `service_role key`; este proyecto no la necesita.
- En *Project Settings → Database* mantén activado **Enforce SSL on incoming connections**.
- Ingresa a la aplicación en producción apenas la despliegues y cambia las dos contraseñas temporales.

---

## 6. Aplicación en Cloudflare (Workers)

La aplicación se despliega como un **Worker** con el adaptador OpenNext (`web/wrangler.jsonc` y `web/open-next.config.ts` ya están listos). La forma recomendada en Windows es que **Cloudflare compile desde GitHub**, porque el empaquetado de OpenNext se ejecuta en Linux.

### Opción A (recomendada): conectar el repositorio de GitHub

1. Entra a https://dash.cloudflare.com → **Workers & Pages** → **Create** → pestaña **Workers** → **Import a repository**.
2. Autoriza a Cloudflare en GitHub y elige `jhonathan-espol/sistema-de-alertas-academicas`.
3. Configura el proyecto:
   - **Project name**: `sistema-de-alertas-academicas` (debe coincidir con `name` en `web/wrangler.jsonc`)
   - **Root directory** (*Advanced settings*): `web`
   - **Build command**: `npx opennextjs-cloudflare build`
   - **Deploy command**: `npx opennextjs-cloudflare deploy`
4. Pulsa **Create and deploy**.
5. En el Worker → **Settings → Variables and Secrets → Add**, crea una variable de tipo **Secret** (si la creas como texto normal, el siguiente despliegue la borra):
   - `AUTH_SECRET` = una clave nueva de 48+ caracteres (`python -c "import secrets; print(secrets.token_urlsafe(48))"`); no reutilices la de tu `.env` local
6. Abre la dirección `https://sistema-de-alertas-academicas.<tu-subdominio>.workers.dev`.

### Conexión a la base: Hyperdrive

En Cloudflare la aplicación **no usa `DATABASE_URL`**: se conecta a Supabase a través de **Hyperdrive** (binding `HYPERDRIVE` en `web/wrangler.jsonc`). Un Worker no puede conectarse directamente al pooler de Supabase, porque su certificado no lo emite una autoridad pública y el runtime lo rechaza; Hyperdrive mantiene esa conexión y el Worker le habla por un canal interno. Está incluido en el plan gratuito.

La configuración ya está creada (`alertas-db`) y su id figura en `wrangler.jsonc`; el id no es un secreto. Si cambias la contraseña de la base o migras de proyecto en Supabase, actualízala desde `web`:

```powershell
npx wrangler login
npx wrangler hyperdrive update 0f05fdef0d404106bf9fd6cb0d5469d1 --connection-string="postgresql://postgres.<ref>:<CLAVE>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Para crear una nueva desde cero: `npx wrangler hyperdrive create alertas-db --connection-string="..."` y copia el id que devuelve en `wrangler.jsonc`.

Desde ese momento, cada `git push` a `main` vuelve a compilar y desplegar automáticamente.

### Opción B: desplegar desde la laptop con Wrangler

Probado en Windows 11 con PowerShell (OpenNext avisa de que recomienda WSL, pero compila y despliega).

```bash
cd web
npm install
npx wrangler login
npm run deploy
npx wrangler secret put AUTH_SECRET     # pega la clave de sesiones (solo la primera vez)
```

### Ajustes en Cloudflare

- **Dominio propio** (opcional): Worker → *Settings → Domains & Routes → Add → Custom domain*. El dominio debe estar en tu cuenta de Cloudflare.
- **Variables**: nunca escribas `AUTH_SECRET` ni una cadena de conexión real en `wrangler.jsonc`. El `localConnectionString` que aparece ahí es un valor de ejemplo que exigen las herramientas para emular el Worker en local.
- **Compatibilidad**: `wrangler.jsonc` ya declara `nodejs_compat` (necesario para el cliente de PostgreSQL) y una `compatibility_date` reciente.
- **Registros**: Worker → *Observability → Logs* para ver errores en vivo.
- **Límite de CPU**: el plan gratuito de Workers concede 10 ms de CPU por petición. La verificación de contraseñas (PBKDF2, 100 000 iteraciones) es la operación más costosa; si el inicio de sesión devuelve el error **1102 (Worker exceeded resource limits)**, la solución es el plan Workers Paid. No lo he podido comprobar en tu cuenta.
- **Conexiones**: la aplicación abre una conexión por petición contra Hyperdrive, que reutiliza las conexiones reales con Supabase.

### Comprobación final en producción

1. Abre la URL del Worker → debe mostrar el inicio de sesión.
2. Ingresa con `Administrador` / `admin` → te pedirá una contraseña nueva.
3. Revisa *Dashboard*, *Entrenamiento* y *Resultados*; en *Usuarios*, cambia la contraseña de `Docente` o pídele que ingrese y la cambie.

---

## 7. Flujo de trabajo habitual

```
Reportes nuevos (SIGA / ATENEA)
        │  python -m ml.pipeline                (laptop: procesa, entrena, carga la base local)
        ▼
Revisión en http://localhost:3000
        │  $env:DATABASE_URL="<session pooler>"; python -m ml.cargar_bd     (publica en Supabase)
        ▼
Producción en Cloudflare (lee de Supabase; no requiere redeploy por datos nuevos)
        │  git push                              (solo cuando cambia el código)
        ▼
Cloudflare recompila y despliega
```

## 8. Limitaciones que conviene tener presentes

- El desenlace modelado es la reprobación por inasistencias. Los cambios de carrera y traslados no constan en los reportes; los retiros se identifican por el maestro de matrículas y no traen fecha.
- En 2024-2P no hay inasistencias registradas entre el 24-oct y el 19-nov-2024 en ningún nivel. El pipeline pausa el conteo de la ventana en ese tramo; la causa (por ejemplo, una suspensión o un cambio temporal de modalidad) debe confirmarse con la institución.
- La cohorte en curso se puntúa con las variables disponibles. Antes del día 28 se usa un modelo de solo asistencia al mismo horizonte de días, con menos señal que el modelo completo (AUC-PR 0,80 al día 19 frente a 0,86 al día 28 en la cohorte de prueba) y más alertas por cada caso real; los niveles son preliminares. Al completar la ventana y cargar las actividades de ATENEA del periodo, se aplica el modelo seleccionado.
- Las listas de un periodo en curso incluyen a estudiantes que después se retiran y desaparecen de los registros; por eso la cohorte actual puede mostrar más inasistencia que los periodos cerrados al mismo día.
- El proyecto no mide el efecto de las alertas sobre la retención.
