"""Hash de contraseña y tokens de acceso sin dependencias nativas."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any


# Cloudflare Workers Web Crypto rejects PBKDF2 counts above 100,000.
ITERATIONS = 100_000
MAX_WORKERS_ITERATIONS = 100_000
TOKEN_MINUTES = 60


async def _derive_password(password: str, salt: str, iterations: int) -> bytes:
    """Derive a PBKDF2-SHA256 key using Workers Web Crypto or CPython hashlib."""
    try:
        from js import Object, TextEncoder, Uint8Array, crypto
        from pyodide.ffi import to_js
    except ImportError:
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations)

    if iterations > MAX_WORKERS_ITERATIONS:
        raise ValueError("Este hash supera el máximo PBKDF2 admitido por Cloudflare Workers")

    encoder = TextEncoder.new()
    key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        False,
        to_js(["deriveBits"]),
    )
    parameters = to_js(
        {
            "name": "PBKDF2",
            "hash": "SHA-256",
            "salt": encoder.encode(salt),
            "iterations": iterations,
        },
        dict_converter=Object.fromEntries,
    )
    derived = await crypto.subtle.deriveBits(parameters, key, 256)
    return bytes(Uint8Array.new(derived).to_py())


async def hash_password(password: str) -> str:
    salt = secrets.token_urlsafe(18)
    derived = (await _derive_password(password, salt, ITERATIONS)).hex()
    return f"pbkdf2_sha256${ITERATIONS}${salt}${derived}"


async def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        derived = (await _derive_password(password, salt, int(rounds))).hex()
        return hmac.compare_digest(derived, expected)
    except (ValueError, TypeError):
        return False


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _secret(request: Any) -> str:
    bindings = request.scope.get("env")
    value = getattr(bindings, "JWT_SECRET", None) if bindings is not None else None
    if value is None and isinstance(bindings, dict):
        value = bindings.get("JWT_SECRET")
    return str(value or os.getenv("JWT_SECRET", ""))


def create_token(user: dict[str, Any], request: Any) -> str:
    secret = _secret(request)
    if len(secret) < 32:
        raise RuntimeError("Configure JWT_SECRET con al menos 32 caracteres en Cloudflare")
    now = int(time.time())
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(json.dumps({"sub": user["id"], "iat": now, "exp": now + TOKEN_MINUTES * 60}, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}"
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64(signature)}"


def decode_token(token: str, request: Any) -> dict[str, Any] | None:
    try:
        secret = _secret(request)
        header, payload, signature = token.split(".")
        signing_input = f"{header}.{payload}"
        expected = _b64(hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest())
        if not secret or not hmac.compare_digest(signature, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if int(data["exp"]) <= int(time.time()):
            return None
        return data
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None
