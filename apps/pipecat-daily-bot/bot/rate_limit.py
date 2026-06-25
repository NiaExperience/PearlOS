"""
Rate limiting for the bot gateway.

Rate limits:
  - General API: per-user, per-tenant, and per-surface buckets
  - Codex tasks:   3 concurrent, 20/day per user

Backend:
  - PEARL_RATE_LIMIT_BACKEND=auto|redis|memory (default: auto)
  - auto uses Redis when configured, otherwise falls back to memory
  - redis, and auto with Redis configured, fail closed if Redis cannot be reached

Key source: resolved tenant/user/email → request headers/query → fallback to client IP.
Rate limit headers are added to all responses: X-RateLimit-Remaining, X-RateLimit-Reset.

This file lives at /workspace/nia-universal/apps/pipecat-daily-bot/bot/rate_limit.py
and is source-of-truth for the rate limiter. The deploy copy at
/home/deploy/pearlos/apps/pipecat-daily-bot/bot/rate_limit.py is a copy.
"""

from __future__ import annotations

import hashlib
import os
import time
import threading
from dataclasses import dataclass
from typing import Optional

from fastapi import Request, HTTPException, Response
from loguru import logger

try:
    import redis
except Exception:  # pragma: no cover - optional runtime dependency guard
    redis = None


# ── Configuration ──────────────────────────────────────────────────────────

RATE_LIMIT_REQUESTS_PER_MINUTE = 60
RATE_LIMIT_BURST = 120
CODEX_CONCURRENT_LIMIT = 3
CODEX_DAILY_LIMIT = 20

# Window sizes in seconds
_RATE_WINDOW_S = 60          # 1 minute sliding window
_CODEX_DAY_S = 86400         # 24 hours
_REDIS_DISABLE_S = 30


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def _rate_backend() -> str:
    value = (os.getenv("PEARL_RATE_LIMIT_BACKEND") or "auto").strip().lower()
    return value if value in {"auto", "redis", "memory"} else "auto"


def _rate_window_s() -> int:
    return _env_int("PEARL_RATE_LIMIT_WINDOW_S", _RATE_WINDOW_S)


def _user_limit(default_burst: int) -> int:
    return _env_int("PEARL_RATE_LIMIT_USER_MAX", default_burst)


def _tenant_limit(default_burst: int) -> int:
    return _env_int("PEARL_RATE_LIMIT_TENANT_MAX", max(default_burst * 10, 600))


def _surface_limit(default_burst: int) -> int:
    return _env_int("PEARL_RATE_LIMIT_SURFACE_MAX", max(default_burst * 25, 1500))


# ── In-memory store ────────────────────────────────────────────────────────

class _Bucket:
    """Sliding-window counters for a single rate-limit key."""
    def __init__(self):
        self._lock = threading.Lock()
        self._timestamps: list[float] = []          # general requests
        self._codex_timestamps: list[float] = []     # codex task create times
        self._codex_active: int = 0                   # open codex tasks

    def check_general(self, now: float, max_requests: int, window_s: int) -> tuple[int, float]:
        """Return (remaining, reset_epoch_s). Negative remaining = blocked."""
        with self._lock:
            cutoff = now - window_s
            # Evict expired
            self._timestamps = [t for t in self._timestamps if t > cutoff]
            count = len(self._timestamps)
            if count >= max_requests:
                # Find when the oldest in the window expires
                oldest = self._timestamps[0]
                reset_ts = oldest + window_s
                return -1, reset_ts
            # Add this request
            self._timestamps.append(now)
            count = len(self._timestamps)
            if count >= 1:
                oldest = self._timestamps[0]
                reset_ts = oldest + window_s
            else:
                reset_ts = now + window_s
            return max_requests - count, reset_ts

    def check_codex_create(self, now: float) -> tuple[int, float]:
        """Return (daily_remaining, reset_epoch_s). Negative = blocked."""
        with self._lock:
            cutoff = now - _CODEX_DAY_S
            self._codex_timestamps = [t for t in self._codex_timestamps if t > cutoff]
            count = len(self._codex_timestamps)
            remaining = CODEX_DAILY_LIMIT - count
            if remaining <= 0:
                oldest = self._codex_timestamps[0]
                return 0, oldest + _CODEX_DAY_S
            # Concurrent check
            if self._codex_active >= CODEX_CONCURRENT_LIMIT:
                return -1, now  # blocked by concurrency
            self._codex_timestamps.append(now)
            self._codex_active += 1
            return CODEX_DAILY_LIMIT - count - 1, now + _CODEX_DAY_S

    def release_codex(self):
        with self._lock:
            if self._codex_active > 0:
                self._codex_active -= 1


@dataclass(frozen=True)
class _RateLimitBucket:
    scope: str
    key: str
    max_requests: int


@dataclass(frozen=True)
class _RateLimitResult:
    scope: str
    remaining: int
    reset_ts: float


class _MemoryRateLimitStore:
    """Thread-safe in-memory store of rate limit buckets."""

    def __init__(self):
        self._lock = threading.Lock()
        self._buckets: dict[str, _Bucket] = {}
        # Periodic cleanup: evict idle buckets every 5 minutes
        self._last_cleanup = time.time()

    def _maybe_cleanup(self, now: float):
        if now - self._last_cleanup < 300:  # 5 min
            return
        self._last_cleanup = now
        with self._lock:
            stale = []
            for key, bucket in self._buckets.items():
                with bucket._lock:
                    bucket._timestamps[:] = [t for t in bucket._timestamps if t > now - max(_RATE_WINDOW_S, _CODEX_DAY_S)]
                    bucket._codex_timestamps[:] = [t for t in bucket._codex_timestamps if t > now - _CODEX_DAY_S]
                    if not bucket._timestamps and not bucket._codex_timestamps and bucket._codex_active == 0:
                        stale.append(key)
            for key in stale:
                del self._buckets[key]

    def get_bucket(self, key: str) -> _Bucket:
        now = time.time()
        self._maybe_cleanup(now)
        with self._lock:
            if key not in self._buckets:
                self._buckets[key] = _Bucket()
            return self._buckets[key]

    def check_many(self, buckets: list[_RateLimitBucket], now: float, window_s: int) -> list[_RateLimitResult]:
        results: list[_RateLimitResult] = []
        for rate_bucket in buckets:
            bucket = self.get_bucket(rate_bucket.key)
            remaining, reset_ts = bucket.check_general(now, rate_bucket.max_requests, window_s)
            results.append(
                _RateLimitResult(
                    scope=rate_bucket.scope,
                    remaining=remaining,
                    reset_ts=reset_ts,
                )
            )
        return results


class _RedisRateLimitStore:
    """Redis-backed sliding-window store.

    Uses one sorted set per bucket and a Lua script so each bucket check is
    atomic across gateway processes. Composite limits are evaluated bucket by
    bucket; a blocked request may consume earlier buckets, which is conservative.
    """

    _SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= max_requests then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset_ts = now + window
  if oldest[2] then
    reset_ts = tonumber(oldest[2]) + window
  end
  return {-1, reset_ts}
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, window + 60)
count = count + 1
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset_ts = now + window
if oldest[2] then
  reset_ts = tonumber(oldest[2]) + window
end
return {max_requests - count, reset_ts}
"""

    def __init__(self):
        self._lock = threading.Lock()
        self._client = None
        self._disabled_until = 0.0

    def _redis_should_run(self) -> bool:
        backend = _rate_backend()
        if backend == "memory":
            return False
        if backend == "redis":
            return True
        return bool(
            os.getenv("PEARL_RATE_LIMIT_REDIS_URL")
            or os.getenv("REDIS_URL")
            or (os.getenv("USE_REDIS", "").strip().lower() == "true")
        )

    def _redis_url(self) -> str:
        return (
            os.getenv("PEARL_RATE_LIMIT_REDIS_URL")
            or os.getenv("REDIS_URL")
            or "redis://localhost:6379"
        )

    def _get_client(self):
        if redis is None:
            raise RuntimeError("redis package is not installed")
        now = time.time()
        if _rate_backend() == "auto" and self._disabled_until > now:
            raise RuntimeError("redis temporarily disabled after previous rate-limit failure")
        with self._lock:
            if self._client is not None:
                return self._client
            password = None
            if os.getenv("REDIS_AUTH_REQUIRED", "false").strip().lower() == "true":
                password = os.getenv("REDIS_SHARED_SECRET")
                if not password:
                    raise RuntimeError("Redis auth required but REDIS_SHARED_SECRET is not set")
            self._client = redis.Redis.from_url(
                self._redis_url(),
                password=password,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
                health_check_interval=30,
            )
            return self._client

    def _disable_temporarily(self, error: Exception) -> None:
        if _rate_backend() != "auto":
            return
        self._disabled_until = time.time() + _REDIS_DISABLE_S
        logger.warning(
            f"[rate-limit] Redis unavailable; rate-limit backend disabled for {_REDIS_DISABLE_S}s: {error}"
        )

    def check_many(self, buckets: list[_RateLimitBucket], now: float, window_s: int) -> list[_RateLimitResult]:
        if not self._redis_should_run():
            raise RuntimeError("Redis rate limit backend is not configured")
        client = self._get_client()
        results: list[_RateLimitResult] = []
        for index, rate_bucket in enumerate(buckets):
            member = f"{time.time_ns()}:{threading.get_ident()}:{index}"
            raw = client.eval(
                self._SCRIPT,
                1,
                rate_bucket.key,
                now,
                window_s,
                rate_bucket.max_requests,
                member,
            )
            remaining = int(raw[0])
            reset_ts = float(raw[1])
            results.append(
                _RateLimitResult(
                    scope=rate_bucket.scope,
                    remaining=remaining,
                    reset_ts=reset_ts,
                )
            )
        return results


_memory_rate_store = _MemoryRateLimitStore()
_redis_rate_store = _RedisRateLimitStore()


# ── Key extraction ─────────────────────────────────────────────────────────

def _clean_subject(value: object) -> str:
    return str(value or "").strip()


def _identity_digest(value: object) -> str:
    text = _clean_subject(value).lower()
    if not text:
        text = "unknown"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]


def _surface_name(request: Request, explicit_surface: Optional[str]) -> str:
    surface = _clean_subject(explicit_surface)
    if not surface:
        path = getattr(getattr(request, "url", None), "path", "") or "unknown"
        surface = f"path:{path}"
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in surface)
    return "-".join(part for part in cleaned.split("-") if part)[:80] or "unknown"


def _request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded and _env_bool("PEARL_TRUST_X_FORWARDED_FOR", False):
        return forwarded.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def _rate_limit_identity(
    request: Request,
    *,
    user_id: Optional[str] = None,
    email: Optional[str] = None,
) -> tuple[str, str]:
    """Resolve a user-facing rate-limiting identity from explicit scope, headers, or IP."""
    explicit_user = _clean_subject(user_id)
    if explicit_user:
        return "user", explicit_user
    header_user = _clean_subject(request.headers.get("x-user-id"))
    if header_user:
        return "user", header_user
    explicit_email = _clean_subject(email).lower()
    if explicit_email:
        return "email", explicit_email
    header_email = _clean_subject(request.headers.get("x-user-email")).lower()
    if header_email:
        return "email", header_email
    return "ip", _request_ip(request)


def _rate_limit_tenant(request: Request, *, tenant_id: Optional[str] = None) -> str:
    return (
        _clean_subject(tenant_id)
        or _clean_subject(request.headers.get("x-pearl-tenant-id"))
        or _clean_subject(request.headers.get("x-tenant-id"))
        or _clean_subject(request.query_params.get("requester_tenant_id"))
        or _clean_subject(request.query_params.get("tenant_id"))
        or "public"
    )


def _rate_limit_key(request: Request) -> str:
    """Resolve the legacy per-user key used by Codex concurrency limits."""
    identity_kind, identity = _rate_limit_identity(request)
    return f"{identity_kind}:{_identity_digest(identity)}"


def _rate_limit_buckets_for_request(
    request: Request,
    *,
    surface: Optional[str] = None,
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
    email: Optional[str] = None,
    user_max: int = RATE_LIMIT_BURST,
    tenant_max: Optional[int] = None,
    surface_max: Optional[int] = None,
) -> list[_RateLimitBucket]:
    surface_scope = _surface_name(request, surface)
    tenant_scope = _rate_limit_tenant(request, tenant_id=tenant_id)
    identity_kind, identity = _rate_limit_identity(request, user_id=user_id, email=email)
    tenant_hash = _identity_digest(tenant_scope)
    identity_hash = _identity_digest(f"{identity_kind}:{identity}")
    surface_hash = _identity_digest(surface_scope)
    tenant_limit = tenant_max if tenant_max is not None else _tenant_limit(user_max)
    surface_limit = surface_max if surface_max is not None else _surface_limit(user_max)
    prefix = "pearl:rate-limit:v1"
    return [
        _RateLimitBucket(
            scope="user",
            key=f"{prefix}:user:{surface_scope}:{tenant_hash}:{identity_hash}",
            max_requests=user_max,
        ),
        _RateLimitBucket(
            scope="tenant",
            key=f"{prefix}:tenant:{surface_scope}:{tenant_hash}",
            max_requests=tenant_limit,
        ),
        _RateLimitBucket(
            scope="surface",
            key=f"{prefix}:surface:{surface_hash}",
            max_requests=surface_limit,
        ),
    ]


_RATE_LIMIT_HEADER_PREFIX = "X-RateLimit"

def _set_rate_limit_headers(response: Response, remaining: int, reset_epoch: float):
    """Add X-RateLimit-* headers to a response."""
    reset_ts = int(reset_epoch)
    response.headers["X-RateLimit-Remaining"] = str(max(0, remaining))
    response.headers["X-RateLimit-Reset"] = str(reset_ts)


def _check_rate_buckets(
    buckets: list[_RateLimitBucket],
    *,
    now: float,
    window_s: int,
) -> list[_RateLimitResult]:
    backend = _rate_backend()
    redis_configured = _redis_rate_store._redis_should_run()
    if backend != "memory" and redis_configured:
        try:
            return _redis_rate_store.check_many(buckets, now, window_s)
        except Exception as error:
            if hasattr(_redis_rate_store, "_disable_temporarily"):
                _redis_rate_store._disable_temporarily(error)
            logger.error(f"[rate-limit] Redis backend configured but unavailable: {error}")
            raise HTTPException(
                status_code=503,
                detail="Rate limit service unavailable.",
            )
    return _memory_rate_store.check_many(buckets, now, window_s)


# ── Decorator / middleware style ───────────────────────────────────────────

def apply_general_rate_limit(
    request: Request,
    response: Optional[Response] = None,
    limit: int = RATE_LIMIT_REQUESTS_PER_MINUTE,
    burst: int = RATE_LIMIT_BURST,
    *,
    surface: Optional[str] = None,
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
    email: Optional[str] = None,
):
    """Check general API rate limit. Raises HTTPException(429) if exceeded.

    Call this at the start of each endpoint that needs rate limiting.
    Pass the response object (after creating it) to set rate limit headers.
    """
    now = time.time()
    del limit  # Kept for backwards-compatible call sites; burst is the enforced cap.
    user_max = _user_limit(burst)
    buckets = _rate_limit_buckets_for_request(
        request,
        surface=surface,
        tenant_id=tenant_id,
        user_id=user_id,
        email=email,
        user_max=user_max,
    )
    results = _check_rate_buckets(buckets, now=now, window_s=_rate_window_s())
    remaining = min((result.remaining for result in results), default=user_max)
    reset_ts = max((result.reset_ts for result in results), default=now + _rate_window_s())
    if response is not None:
        _set_rate_limit_headers(response, remaining, reset_ts)
    exceeded = next((result for result in results if result.remaining < 0), None)
    if exceeded is not None:
        retry_after = max(1, int(exceeded.reset_ts - now))
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please wait before retrying.",
            headers={
                "Retry-After": str(retry_after),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(int(exceeded.reset_ts)),
                "X-RateLimit-Scope": exceeded.scope,
            },
        )


def check_codex_rate_limit(request: Request) -> tuple[int, float]:
    """Check Codex task submission rate limit. Returns (remaining, reset_ts).

    Raises HTTPException(429) if the user is over daily or concurrent limits.
    Caller must call release_codex_rate_limit() when the task completes.
    """
    key = _rate_limit_key(request)
    bucket = _memory_rate_store.get_bucket(key)
    now = time.time()
    remaining, reset_ts = bucket.check_codex_create(now)
    if remaining < 0:
        retry_after = max(1, int(reset_ts - now))
        detail = (
            "Codex task limit exceeded. Max 3 concurrent tasks and 20 per day."
            if remaining == -1
            else "Daily Codex task limit reached. Try again tomorrow."
        )
        raise HTTPException(
            status_code=429,
            detail=detail,
            headers={
                "Retry-After": str(retry_after),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(int(reset_ts)),
            },
        )
    return remaining, reset_ts


def release_codex_rate_limit(request: Request):
    """Release a concurrent Codex slot for this user."""
    key = _rate_limit_key(request)
    bucket = _memory_rate_store.get_bucket(key)
    bucket.release_codex()


# ── Headers-only middleware (non-blocking) ─────────────────────────────────
# This is a lightweight approach for endpoints that want informational headers
# without hard rate limit enforcement. Use apply_general_rate_limit() for
# endpoints that need enforcement.

def add_rate_limit_info(request: Request, response: Response):
    """Add X-RateLimit headers to a response without enforcing.

    This is informational only — useful for endpoints monitored by
    the frontend to show rate limit status.
    """
    key = _rate_limit_key(request)
    bucket = _memory_rate_store.get_bucket(key)
    now = time.time()
    with bucket._lock:
        cutoff = now - _RATE_WINDOW_S
        count = len([t for t in bucket._timestamps if t > cutoff])
    remaining = max(0, RATE_LIMIT_BURST - count)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Reset"] = str(int(now + _RATE_WINDOW_S))
