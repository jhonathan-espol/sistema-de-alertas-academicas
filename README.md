# Sistema de Alertas Académicas

Aplicación de alertas tempranas con **Next.js**, **Python/FastAPI** y **PostgreSQL de Supabase**. La interfaz y la API transaccional se publican como dos Cloudflare Workers. Los análisis científicos se ejecutan en un servicio Python nativo separado, porque dependen de scikit-learn, XGBoost y SHAP. Ningún servicio requiere Docker.

## Arquitectura

```text
Navegador ── HTTPS ──> Cloudflare Worker: Next.js
     │                       │ API REST + token JWT
     │ análisis con JWT       ▼
     └───────────────> Python/FastAPI de análisis (Render)
                             │ scripts intactos + artefactos privados
             Cloudflare Worker: FastAPI ──> Supabase Data API
                             │                    │
                             └────────────────────┴──> Supabase PostgreSQL + Storage
```

Las credenciales de aplicación se guardan en PostgreSQL; las contraseñas se derivan con PBKDF2-SHA256. El navegador nunca recibe la clave secreta de Supabase. La API comprueba el rol en cada petición, y el rol Administrador es obligatorio para la gestión de usuarios.

## Funciones

- Inicio de sesión con token de acceso y usuarios almacenados en PostgreSQL.
- Dashboard con resumen de alertas y acceso a Entrenamiento, Resultados, Usuarios y Configuración.
- Administración de cuentas, roles, estado, creación y cambio de contraseñas.
- API FastAPI desplegable como Python Worker.
- Interfaz Next.js desplegable en Cloudflare Workers mediante OpenNext.
- Carga y validación de archivos Excel, ejecución de análisis en segundo plano e historial de resultados.
- Tablas protegidas con RLS y sin políticas para acceso público.

## Accesos temporales iniciales

El SQL crea estos usuarios (el nombre de usuario no distingue mayúsculas):

| Usuario | Contraseña temporal | Rol |
|---|---|---|
| `administrador` (también `admin`) | `admin` | Administrador |
| `invitado` | `invitado123` | Invitado |

Al completar el despliegue, inicia sesión como administrador y cambia ambas contraseñas desde **Usuarios**. Las contraseñas nuevas deben tener al menos 10 caracteres.

## Requisitos

- Cuenta GitHub con acceso a `jhonathan-espol/sistema-de-alertas-academicas`.
- Proyecto de Supabase y acceso al SQL Editor y a Settings → API Keys.
- Cuenta Cloudflare con Workers habilitado y acceso a Workers Builds.
- Servicio Python nativo en Render para los análisis (se configura con comandos de build/start, sin Docker).
- Node.js 20+ para el build del frontend en Cloudflare; Python 3.13+ (uv) para el Worker de FastAPI.
- Un secreto aleatorio de al menos 32 caracteres para firmar sesiones (`JWT_SECRET`).

## 1. Publicar el código en GitHub

Abre PowerShell en la carpeta del repositorio. El `origin` que ya existe puede apuntar a otro repositorio, así que agrega el destino académico con un nombre separado:

```powershell
git remote add github-academicas https://github.com/jhonathan-espol/sistema-de-alertas-academicas.git
git status
```

Antes de publicar, comprueba cómo está registrado `frontend`:

```powershell
git ls-files frontend
```

Si el resultado es solo `frontend`, es un checkout Git anidado y GitHub recibiría un gitlink, no los archivos de la interfaz. Convierte esa carpeta en archivos normales rastreados por el repositorio principal. Se conserva el Git interno en la carpeta temporal para no perderlo:

```powershell
$frontendGitBackup = Join-Path $env:TEMP ("sistema-alertas-frontend-git-backup-" + [guid]::NewGuid().ToString())
Move-Item -LiteralPath frontend\.git -Destination $frontendGitBackup
git rm --cached -f frontend
git add -A frontend
Move-Item -LiteralPath $frontendGitBackup -Destination frontend\.git
git status
```

Verifica que `git ls-files frontend` ahora muestre `frontend/package.json`, `frontend/src/...` y los demás archivos, no una sola entrada `frontend`. Luego incluye los cambios del proyecto y publica la rama `main`:

```powershell
git add README.md .gitignore database backend frontend training_service
git commit -m "Construye sistema de alertas académicas"
git push -u github-academicas main
```

Si Git indica que `github-academicas` ya existe, actualiza su URL con `git remote set-url github-academicas https://github.com/jhonathan-espol/sistema-de-alertas-academicas.git`. GitHub solicitará autenticación en el navegador o por Git Credential Manager. No subas `.env.local`, claves de Supabase, contraseñas de producción ni tokens.

## 2. Preparar Supabase

1. Abre el proyecto Supabase que usarás para `db_alertas`. Supabase suele exponer su base de datos de proyecto predeterminada (habitualmente `postgres`) a través de la Data API. Ejecuta el esquema en la base de datos que aparece en **Connect** para ese proyecto; el nombre del proyecto puede ser `db_alertas`.
2. Abre **SQL Editor → New query**.
3. Copia el contenido completo de [`database/schema.sql`](database/schema.sql), ejecútalo y confirma que se crearon `public.users` y `public.alerts`.
4. En **Table Editor**, confirma que ambas tablas tienen RLS habilitado. No agregues políticas para `anon` ni `authenticated`: solo la API backend debe leer o escribir estas tablas.
5. En **Settings → API Keys**, copia el **Project URL** y crea una clave **Secret** (`sb_secret_...`). La clave `service_role` antigua también se admite, pero Supabase recomienda usar Secret keys.
6. Conserva esos valores para agregarlos como secretos del Worker de API en el siguiente paso. Nunca los pongas en `NEXT_PUBLIC_*`, en el repositorio ni en el código del navegador.

El SQL es idempotente para las tablas y los usuarios iniciales. `ON CONFLICT (username) DO NOTHING` no restablece contraseñas existentes al volverlo a ejecutar.

## 3. Preparar el historial y el almacenamiento de análisis

1. En Supabase **SQL Editor**, ejecuta [`database/training_runs.sql`](database/training_runs.sql). Crea la tabla `public.training_runs` con RLS habilitado y sin acceso para `anon` ni `authenticated`.
2. En **Storage**, crea un bucket llamado `training-artifacts` y déjalo **privado**. No crees políticas de lectura pública. El servicio Python lo administra con la clave secreta de servidor.
3. El archivo Excel cargado se valida y procesa en el servicio Python; no se guarda como objeto. El libro de resultados, resumen y gráficos se conservan en ese bucket privado.

## 4. Desplegar la API de aplicación en Cloudflare

1. En Cloudflare abre **Workers & Pages → Create application → GitHub**, autoriza Cloudflare en GitHub y elige el repositorio `jhonathan-espol/sistema-de-alertas-academicas`.
2. Crea un Worker llamado `sistema-alertas-api` (debe coincidir con `name` en `backend/wrangler.jsonc`), selecciona la rama de producción `main` y abre **Settings → Builds**.
   Si el log muestra que Workers Builds espera `sistema-de-alertas-academicas`, corrige el nombre del Worker/proyecto en Cloudflare a `sistema-alertas-api` antes de desplegar, para que el endpoint documentado y el Worker publicado coincidan.
3. Configura el directorio raíz como `backend`, deja vacío el comando de Build y establece el comando de Deploy:

   ```bash
   uv run pywrangler deploy
   ```

   `pywrangler` gestiona el empaquetado Python y publica el Worker. El archivo [`backend/wrangler.jsonc`](backend/wrangler.jsonc) define el entry point y la compatibilidad `python_workers`.
4. Antes del primer deploy, en **Worker → Settings → Variables and Secrets**, agrega estos valores como **Secret** (no como texto plano):

   | Nombre | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL de Supabase, por ejemplo `https://<project-ref>.supabase.co` |
   | `SUPABASE_SECRET_KEY` | Clave Secret `sb_secret_...` de Supabase |
   | `JWT_SECRET` | Cadena aleatoria privada de al menos 32 caracteres |

   Si usas la clave antigua, usa `SUPABASE_SERVICE_ROLE_KEY` en lugar de `SUPABASE_SECRET_KEY`.
5. Guarda y publica. Copia el dominio que Cloudflare asignó, por ejemplo `https://sistema-alertas-api.<cuenta>.workers.dev`.
6. Comprueba que `https://<dominio-api>/api/health` responda `{"status":"ok","service":"sistema-alertas-api"}`.

Cloudflare Builds necesita permiso para publicar Workers en la cuenta. Usa la conexión de GitHub de Cloudflare o un API token de Cloudflare limitado a Workers Scripts: Edit y Workers Builds: Read. No guardes el token en el repositorio.

## 5. Desplegar el servicio de análisis Python

Cloudflare Python Workers no es el entorno para este cálculo de scikit-learn, XGBoost y SHAP. El servicio de análisis corre en un servicio Python nativo de Render; no uses el runtime Docker.

1. En Render selecciona **New → Web Service**, conecta el repositorio `jhonathan-espol/sistema-de-alertas-academicas` y la rama `main`.
2. Configura la raíz del repositorio como directorio de servicio (vacío o `.`), runtime **Python 3**, comando de build `pip install -r training_service/requirements.txt` y comando de inicio `uvicorn training_service.app:app --host 0.0.0.0 --port $PORT`.
3. Agrega estas variables de entorno en Render. Marca como secretas las claves y el secreto JWT:

   | Nombre | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL del mismo proyecto Supabase usado por la API |
   | `SUPABASE_SECRET_KEY` | Clave Secret `sb_secret_...` (o `SUPABASE_SERVICE_ROLE_KEY` si usas la clave antigua) |
   | `JWT_SECRET` | El mismo secreto JWT activo del Worker `sistema-alertas-api` |
   | `ALLOWED_ORIGINS` | Origen del frontend, por ejemplo `https://alertas-academicas-web.jhonathanespol.workers.dev` |
   | `TRAINING_STORAGE_BUCKET` | `training-artifacts` (opcional; ese es el valor predeterminado) |

4. Despliega el servicio. Comprueba que `https://<servicio-render>/health` responda `{"status":"ok","service":"academic-training"}`. Copia la URL base HTTPS asignada.
5. En Cloudflare, en la configuración de build de `alertas-academicas-web`, define `NEXT_PUBLIC_TRAINING_API_URL` con esa URL base. Guarda la variable y vuelve a desplegar el frontend para incorporarla al bundle.

Render admite despliegues FastAPI con runtime Python nativo, comandos de build/start y sin Docker ([guía oficial de FastAPI en Render](https://render.com/docs/deploy-fastapi)). El servicio valida el JWT de la aplicación y consulta en Supabase que la cuenta siga activa y tenga rol Administrador; la clave de Supabase nunca llega al navegador.

Los scripts originales permanecen sin modificaciones. El servicio invoca `analisis_preliminar.py` con las rutas de entrada/salida que acepta como argumentos. Para `complemento.py`, genera una copia temporal de ejecución que adapta sus rutas absolutas; el archivo fuente se conserva intacto. La validación requiere un `.xlsx` con las columnas del conjunto académico y los periodos `2023-2`, `2024-1`, `2024-2`, `2025-1` y `2025-2`.

## 6. Desplegar Next.js en Cloudflare

1. En **Workers & Pages → Create application → GitHub**, conecta de nuevo el mismo repositorio y rama `main` para crear el segundo Worker, llamado `alertas-academicas-web`.
2. En **Settings → Builds**, configura `frontend` como raíz del proyecto y confirma que el nombre coincida con [`frontend/wrangler.jsonc`](frontend/wrangler.jsonc).
3. Configura **Build command** y **Deploy command** por separado:

   ```bash
   npm run cf:build
   ```

   Usa `npx wrangler deploy` como **Deploy command**. Si Cloudflare pide un comando de instalación, usa `npm ci`. El script `cf:build` genera `.open-next` y Wrangler publica el artefacto según `frontend/wrangler.jsonc`.
4. Antes del build de producción, define `NEXT_PUBLIC_API_URL` como **variable de build** con el dominio del Worker de API copiado en el paso anterior, sin barra final. Ejemplo: `https://sistema-alertas-api.<cuenta>.workers.dev`. Define también `NEXT_PUBLIC_TRAINING_API_URL` con la URL base de Render, sin barra final.
5. Guarda y despliega. Cloudflare construirá la aplicación Next.js con OpenNext y la publicará como Worker.
6. Abre el dominio asignado al Worker web. Inicia sesión con una de las cuentas temporales y cambia las contraseñas en **Usuarios**.
7. Opcional: en **Worker → Settings → Domains & Routes**, agrega tu dominio propio y configura sus registros DNS en Cloudflare.

Configura ambas URLs públicas en el entorno de Preview si habilitas previews y agrega su origen al `ALLOWED_ORIGINS` de Render. No pongas secretos en variables `NEXT_PUBLIC_*`.

Guías oficiales: [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [OpenNext para Next.js](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/), [Python Workers y FastAPI](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/), [claves API de Supabase](https://supabase.com/docs/guides/getting-started/api-keys) y [Data API de Supabase](https://supabase.com/docs/guides/api).

## 7. Despliegues posteriores

Al conectar los dos Workers y el servicio Render a la misma rama de GitHub, cada push a `main` puede volver a desplegar los proyectos. Si el build automático de Cloudflare no detecta cambios, confirma que cada Worker tenga su propio directorio raíz (`backend` o `frontend`) y su comando correspondiente.

## Estructura

```text
backend/
  app/main.py                 FastAPI / Python Worker
  app/auth.py                 PBKDF2 y JWT
  app/database.py             Cliente HTTPS de Supabase Data API
  app/routes/                 Inicio de sesión, usuarios y alertas
  pyproject.toml              Dependencias Python / uv
  wrangler.jsonc              Configuración Cloudflare
training_service/
  app.py                      API de carga, validación e historial de análisis
  requirements.txt            Dependencias de ML para Python nativo
database/schema.sql           Tablas, RLS y cuentas iniciales
database/training_runs.sql    Historial de ejecuciones
frontend/
  src/app/                    Páginas Next.js
  src/components/             Componentes de interfaz
  src/lib/api.ts              Cliente de la API
  open-next.config.ts         Adaptador Cloudflare OpenNext
  wrangler.jsonc              Configuración del Worker web
```

## Endpoints principales

| Método | Ruta | Acceso |
|---|---|---|
| `POST` | `/api/auth/login` | Público |
| `GET` | `/api/auth/me` | Sesión válida |
| `GET`, `POST` | `/api/users` | Administrador |
| `PATCH` | `/api/users/{id}` | Administrador |
| `POST` | `/api/users/{id}/change-password` | Administrador |
| `DELETE` | `/api/users/{id}` | Administrador |
| `GET`, `POST` | `/api/alerts` | Sesión válida |
| `PATCH`, `DELETE` | `/api/alerts/{id}` | Sesión válida |
| `GET` | `/api/health` | Público |

## Seguridad y notas de operación

- `SUPABASE_SECRET_KEY` omite RLS y tiene acceso elevado; solo configúrala como secreto en el Worker de API. La API valida JWT propio y rol antes de acceder a las tablas.
- El esquema no crea políticas públicas. La clave de Supabase no se expone al cliente Next.js.
- `JWT_SECRET` debe ser distinto por entorno y mantenerse privado. Si se rota, las sesiones existentes tendrán que iniciar sesión de nuevo.
- Las credenciales incluidas son temporales y públicas en este repositorio: cambia ambas contraseñas inmediatamente después del primer acceso de producción.
- El análisis genera evaluación y gráficos retrospectivos; los scripts no guardan un estimador serializado para predicción individual en tiempo real.
- Los resultados quedan en un bucket Storage privado y solo un Administrador autenticado puede listarlos o descargarlos.
- `analisis_preliminar.py` y `complemento.py` se conservan intactos; el servicio usa una copia temporal de `complemento.py` para resolver sus rutas absolutas.
- No se utiliza Docker.
