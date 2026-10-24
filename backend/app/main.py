from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import alerts, auth, users

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
