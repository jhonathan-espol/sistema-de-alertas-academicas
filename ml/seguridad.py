"""Hash de contraseñas compatible con la aplicación web (PBKDF2-HMAC-SHA256, WebCrypto)."""
import base64
import hashlib
import hmac
import os

ITERACIONES = 100_000


def hash_password(password: str) -> str:
    sal = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), sal, ITERACIONES, dklen=32)
    return f"pbkdf2_sha256${ITERACIONES}${base64.b64encode(sal).decode()}${base64.b64encode(h).decode()}"


def verificar_password(password: str, guardado: str) -> bool:
    try:
        _, it, sal, h = guardado.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.b64decode(sal), int(it), dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except Exception:  # noqa: BLE001
        return False
