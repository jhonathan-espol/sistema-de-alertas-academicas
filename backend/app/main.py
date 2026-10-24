from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# In Python Workers, the directory containing `main.py` is the import root.
# Keep imports relative to `app/` so Pywrangler can bundle them as Worker modules.
from routes import alerts, auth, users

app = FastAPI(title="Sistema de Alertas API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(auth.router, prefix="/api/auth", tags=["Autenticación"])
app.include_router(users.router, prefix="/api/users", tags=["Usuarios"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alertas"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "sistema-alertas-api"}


from workers import asgi

Default = asgi.entrypoint(app)
