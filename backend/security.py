from __future__ import annotations

import base64
import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient
from sqlalchemy.orm import Session

from .db import UserRole


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    role: str
    email: str | None = None
    display_name: str | None = None
    auth_mode: str = "supabase"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_demo_auth_enabled() -> bool:
    default = "true" if os.getenv("APP_ENV", "development").lower() != "production" else "false"
    return os.getenv("DEMO_AUTH_ENABLED", default).lower() == "true"


def _demo_secret() -> str:
    secret = os.getenv("SENTINEL_SESSION_SECRET")
    if secret:
        return secret
    if os.getenv("APP_ENV", "development").lower() != "production":
        # Local SIH demo fallback. Never use this fallback in production.
        return "sentinel-local-demo-secret-change-before-production"
    raise HTTPException(503, "SENTINEL_SESSION_SECRET is not configured")


def make_demo_session(role: str) -> str:
    secret = _demo_secret()
    payload = f"{role}|{utc_now_iso()}".encode()
    encoded = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f"{encoded}.{sig}"


def verify_demo_session(value: Optional[str], allowed: set[str]) -> AuthUser:
    if not is_demo_auth_enabled():
        raise HTTPException(401, "Demo authentication is disabled")
    if not value or "." not in value:
        raise HTTPException(401, "Missing or invalid demo session")
    encoded, signature = value.split(".", 1)
    try:
        padded = encoded + "=" * (-len(encoded) % 4)
        payload = base64.urlsafe_b64decode(padded.encode())
        role, _ = payload.decode().split("|", 1)
    except Exception as exc:
        raise HTTPException(401, "Invalid demo session") from exc
    secret = _demo_secret().encode()
    expected = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(401, "Invalid demo session signature")
    if role not in allowed:
        raise HTTPException(403, "Role not permitted")
    return AuthUser(user_id=f"demo:{role}", role=role, display_name=role.title(), auth_mode="demo")


_JWKS: PyJWKClient | None = None


def _jwks_client() -> PyJWKClient:
    global _JWKS
    if _JWKS is None:
        url = os.getenv("SUPABASE_URL", "").rstrip("/")
        if not url:
            raise HTTPException(503, "SUPABASE_URL is not configured")
        _JWKS = PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)
    return _JWKS


def verify_supabase_jwt(token: str) -> dict:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise HTTPException(503, "SUPABASE_URL is not configured")
    issuer = f"{url}/auth/v1"
    audience = os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated")

    try:
        key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            key.key,
            algorithms=["ES256", "RS256"],
            audience=audience,
            issuer=issuer,
            options={"require": ["sub", "exp"]},
        )
    except Exception as exc:
        legacy_secret = os.getenv("SUPABASE_JWT_SECRET")
        if legacy_secret:
            try:
                return jwt.decode(token, legacy_secret, algorithms=["HS256"], audience=audience, issuer=issuer)
            except Exception:
                pass
        raise HTTPException(401, "Invalid or expired access token") from exc


def current_user(
    db: Session,
    authorization: Optional[str] = Header(default=None),
    x_sentinel_session: Optional[str] = Header(default=None),
) -> AuthUser:
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(401, "Authorization must use Bearer token")
        claims = verify_supabase_jwt(token)
        user_id = str(claims.get("sub"))
        metadata = claims.get("app_metadata") or {}
        role = metadata.get("role") or (claims.get("user_metadata") or {}).get("role")
        display_name = metadata.get("display_name") or (claims.get("user_metadata") or {}).get("display_name")
        email = claims.get("email")
        record = db.get(UserRole, user_id)
        if record and record.active:
            role = record.role
            display_name = record.display_name or display_name
        if role not in {"officer", "commander", "personnel"}:
            raise HTTPException(403, "No authorized Sentinel role is assigned to this account")
        return AuthUser(user_id=user_id, role=role, email=email, display_name=display_name or email, auth_mode="supabase")

    allowed = {"officer", "commander", "personnel"}
    if x_sentinel_session and is_demo_auth_enabled():
        return verify_demo_session(x_sentinel_session, allowed)

    raise HTTPException(401, "Authentication required")


def require_roles(user: AuthUser, *roles: str) -> None:
    if user.role not in set(roles):
        raise HTTPException(403, "Role not permitted")
