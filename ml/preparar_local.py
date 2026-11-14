"""
Prepara el entorno local: crea la base indicada en DATABASE_URL si aún no existe.

Uso:  python -m ml.preparar_local
"""
import os
import sys
from urllib.parse import urlparse

import psycopg2

from ml.cargar_bd import leer_env


def main():
    leer_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("Falta DATABASE_URL en el archivo .env")
        return 1
    u = urlparse(url)
    base = u.path.lstrip("/")
    admin = psycopg2.connect(host=u.hostname, port=u.port or 5432, user=u.username, password=u.password, dbname="postgres")
    admin.autocommit = True
    cur = admin.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (base,))
    if cur.fetchone():
        print(f"La base '{base}' ya existe.")
    else:
        cur.execute(f'CREATE DATABASE "{base}"')
        print(f"Base '{base}' creada.")
    admin.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
