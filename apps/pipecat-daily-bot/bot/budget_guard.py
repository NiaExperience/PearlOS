"""Tenant budget admission guard for PearlOS gateway work.

This is a hard preflight reserve, not full provider billing. It prevents
unbounded tenant spend before expensive chat/task/swarm work starts. Actual
token-accurate reconciliation still belongs at provider/tool boundaries.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from loguru import logger

try:
    import redis
except Exception:  # pragma: no cover - optional runtime dependency guard
    redis = None


_DAY_S = 86400


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return value if value >= 0 else default


def _budget_mode() -> str:
    value = (os.getenv("PEARL_BUDGET_ENFORCEMENT") or "off").strip().lower()
    return value if value in {"off", "monitor", "enforce"} else "off"


def _tenant_hash(tenant_id: str) -> str:
    return hashlib.sha256(tenant_id.strip().lower().encode("utf-8")).hexdigest()[:32]


def _budget_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def _redis_url() -> str:
    return os.getenv("PEARL_BUDGET_REDIS_URL") or os.getenv("REDIS_URL") or "redis://localhost:6379"


def _tenant_budget_cents(tenant_id: str) -> int:
    safe_name = "".join(ch.upper() if ch.isalnum() else "_" for ch in tenant_id)[:80]
    specific = _env_int(f"PEARL_TENANT_DAILY_BUDGET_CENTS_{safe_name}", -1)
    if specific >= 0:
        return specific
    return _env_int("PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT", 0)


def estimate_cents(surface: str, default: int) -> int:
    safe_surface = "".join(ch.upper() if ch.isalnum() else "_" for ch in surface)[:80]
    return max(0, _env_int(f"PEARL_BUDGET_ESTIMATE_CENTS_{safe_surface}", default))


@dataclass(frozen=True)
class BudgetReservation:
    tenant_hash: str
    surface: str
    reserved_cents: int
    used_cents: int
    budget_cents: int
    enforced: bool


class _MemoryBudgetStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._rows: dict[str, tuple[int, float]] = {}

    def reserve(self, key: str, amount_cents: int, budget_cents: int, ttl_s: int) -> tuple[bool, int]:
        now = time.time()
        with self._lock:
            current, expires_at = self._rows.get(key, (0, now + ttl_s))
            if expires_at <= now:
                current = 0
                expires_at = now + ttl_s
            if current + amount_cents > budget_cents:
                self._rows[key] = (current, expires_at)
                return False, current
            new_total = current + amount_cents
            self._rows[key] = (new_total, expires_at)
            return True, new_total


class _RedisBudgetStore:
    _SCRIPT = """
local key = KEYS[1]
local amount = tonumber(ARGV[1])
local budget = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local current = tonumber(redis.call('GET', key) or '0')
if current + amount > budget then
  return {0, current}
end
local updated = redis.call('INCRBY', key, amount)
redis.call('EXPIRE', key, ttl)
return {1, updated}
"""

    def __init__(self):
        self._lock = threading.Lock()
        self._client = None

    def _get_client(self):
        if redis is None:
            raise RuntimeError("redis package is not installed")
        with self._lock:
            if self._client is not None:
                return self._client
            password = None
            if os.getenv("REDIS_AUTH_REQUIRED", "false").strip().lower() == "true":
                password = os.getenv("REDIS_SHARED_SECRET")
                if not password:
                    raise RuntimeError("Redis auth required but REDIS_SHARED_SECRET is not set")
            self._client = redis.Redis.from_url(
                _redis_url(),
                password=password,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
                health_check_interval=30,
            )
            return self._client

    def reserve(self, key: str, amount_cents: int, budget_cents: int, ttl_s: int) -> tuple[bool, int]:
        raw = self._get_client().eval(self._SCRIPT, 1, key, amount_cents, budget_cents, ttl_s)
        return bool(int(raw[0])), int(raw[1])


_memory_budget_store = _MemoryBudgetStore()
_redis_budget_store = _RedisBudgetStore()


def reserve_tenant_budget(
    *,
    tenant_id: Optional[str],
    surface: str,
    estimated_cents: int,
) -> Optional[BudgetReservation]:
    """Reserve estimated spend for a tenant.

    Raises HTTP 402 when enforcement is enabled and the reserve would exceed
    the tenant's daily budget. Raises HTTP 503 if enforcement is enabled but
    budget state cannot be reached.
    """
    mode = _budget_mode()
    if mode == "off":
        return None
    tenant = str(tenant_id or "public").strip() or "public"
    reserve_cents = max(0, int(estimated_cents or 0))
    if reserve_cents <= 0:
        return None
    budget_cents = _tenant_budget_cents(tenant)
    if budget_cents <= 0:
        if mode == "enforce":
            raise HTTPException(status_code=503, detail="tenant budget is not configured")
        return None

    hashed = _tenant_hash(tenant)
    key = f"pearl:budget:v1:{_budget_day()}:{hashed}"
    try:
        allowed, used = _redis_budget_store.reserve(key, reserve_cents, budget_cents, _DAY_S + 3600)
    except Exception as error:
        if mode == "enforce":
            logger.error(f"[budget] Redis budget reserve failed: {error}")
            raise HTTPException(status_code=503, detail="tenant budget service unavailable")
        allowed, used = _memory_budget_store.reserve(key, reserve_cents, budget_cents, _DAY_S + 3600)

    if not allowed and mode == "enforce":
        raise HTTPException(
            status_code=402,
            detail="tenant budget exceeded",
            headers={
                "X-Pearl-Budget-Remaining-Cents": str(max(0, budget_cents - used)),
                "X-Pearl-Budget-Limit-Cents": str(budget_cents),
            },
        )
    return BudgetReservation(
        tenant_hash=hashed,
        surface=surface,
        reserved_cents=reserve_cents if allowed else 0,
        used_cents=used,
        budget_cents=budget_cents,
        enforced=(mode == "enforce"),
    )


async def reserve_tenant_budget_async(
    *,
    tenant_id: Optional[str],
    surface: str,
    estimated_cents: int,
) -> Optional[BudgetReservation]:
    return await asyncio.to_thread(
        reserve_tenant_budget,
        tenant_id=tenant_id,
        surface=surface,
        estimated_cents=estimated_cents,
    )
