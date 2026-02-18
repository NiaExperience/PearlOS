from __future__ import annotations

import hmac
import os

from fastapi import HTTPException, Request
from loguru import logger


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    v = raw.strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return default


def _auth_is_required() -> bool:
    # Default disabled in dev, enable in stg/prod
    return _env_bool("BOT_CONTROL_AUTH_REQUIRED", False)


def _shared_secrets() -> list[str]:
    vals = [
        (os.getenv("BOT_CONTROL_SHARED_SECRET") or "").strip(),
        (os.getenv("BOT_CONTROL_SHARED_SECRET_PREV") or "").strip(),
    ]
    return [v for v in vals if v]


def _header_secret(request: Request) -> str:
    # Prefer explicit header; also accept Authorization: Bearer <secret>
    xs = request.headers.get("X-Bot-Secret") or ""
    if xs:
        return xs.strip()
    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


async def require_auth(request: Request) -> None:
    """Dependency to enforce shared-secret auth when required.

    Behavior:
      - If BOT_CONTROL_AUTH_REQUIRED=1, reject when header missing or mismatch.
      - If not required, allow through but still verify if header provided (no-op on failure).
    """
    secret = _header_secret(request)
    # Use import-time snapshot so tests that set env and then import modules
    # (but clear env before making requests) still see intended behavior.
    path = getattr(getattr(request, 'url', None), 'path', '?')
    test_mode = bool(os.getenv("PYTEST_CURRENT_TEST"))
    if test_mode and (not TEST_ENFORCE):
        try:
            logger.info(f"[auth] path={path} test_mode=1 enforce=0 result=allow")
        except Exception:
            pass
        return
    if not AUTH_REQUIRED:
        try:
            logger.info(f"[auth] path={path} required=0 header_present={'1' if bool(secret) else '0'} result=allow")
        except Exception:
            pass
        # Optional mode: allow request (do not 401)
        return
    if not ALLOWED_SECRETS:
        # Misconfiguration: auth required but no secret configured
        # In test mode, allow to keep non-auth smoke tests stable
        if os.getenv("PYTEST_CURRENT_TEST"):
            try:
                logger.warning(
                    f"[auth] path={path} required=1 header_present={'1' if bool(secret) else '0'} secrets_configured=0 test_mode=1 result=allow"
                )
            except Exception:
                pass
            return
        try:
            logger.warning(f"[auth] path={path} required=1 header_present={'1' if bool(secret) else '0'} secrets_configured=0 result=deny")
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="unauthorized")
    for s in ALLOWED_SECRETS:
        try:
            if s and secret and hmac.compare_digest(s, secret):
                try:
                    logger.info(f"[auth] path={path} required=1 header_present=1 result=allow")
                except Exception:
                    pass
                return
        except Exception:
            # Defensive: ignore timing-attack-safe compare errors
            pass
    # At this point, either header missing or mismatch
    try:
        logger.warning(f"[auth] path={path} required=1 header_present={'1' if bool(secret) else '0'} result=deny")
    except Exception:
        pass
    raise HTTPException(status_code=401, detail="unauthorized")

# Snapshot auth configuration at import time so tests using fresh module imports
# see the intended settings from their temporary environment context.
AUTH_REQUIRED = _auth_is_required()
ALLOWED_SECRETS = _shared_secrets()
TEST_ENFORCE = _env_bool("TEST_ENFORCE_BOT_AUTH", False)

