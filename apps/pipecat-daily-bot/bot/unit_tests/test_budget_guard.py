import pytest
from fastapi import HTTPException

import budget_guard


class _FakeBudgetStore:
    def __init__(self):
        self.rows: dict[str, int] = {}
        self.keys: list[str] = []

    def reserve(self, key: str, amount_cents: int, budget_cents: int, _ttl_s: int):
        self.keys.append(key)
        current = self.rows.get(key, 0)
        if current + amount_cents > budget_cents:
            return False, current
        updated = current + amount_cents
        self.rows[key] = updated
        return True, updated


@pytest.fixture(autouse=True)
def reset_budget(monkeypatch):
    monkeypatch.setenv("PEARL_BUDGET_ENFORCEMENT", "off")
    monkeypatch.delenv("PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT", raising=False)
    monkeypatch.delenv("PEARL_TENANT_DAILY_BUDGET_CENTS_TENANT_ALPHA", raising=False)
    budget_guard._memory_budget_store = budget_guard._MemoryBudgetStore()
    budget_guard._redis_budget_store = _FakeBudgetStore()


def test_budget_off_does_not_reserve():
    assert (
        budget_guard.reserve_tenant_budget(
            tenant_id="tenant-alpha",
            surface="chat",
            estimated_cents=50,
        )
        is None
    )


def test_enforce_reserves_until_budget(monkeypatch):
    monkeypatch.setenv("PEARL_BUDGET_ENFORCEMENT", "enforce")
    monkeypatch.setenv("PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT", "100")

    reservation = budget_guard.reserve_tenant_budget(
        tenant_id="tenant-alpha",
        surface="chat",
        estimated_cents=40,
    )

    assert reservation is not None
    assert reservation.used_cents == 40
    assert reservation.budget_cents == 100
    assert reservation.enforced is True


def test_enforce_blocks_over_budget(monkeypatch):
    monkeypatch.setenv("PEARL_BUDGET_ENFORCEMENT", "enforce")
    monkeypatch.setenv("PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT", "100")

    budget_guard.reserve_tenant_budget(
        tenant_id="tenant-alpha",
        surface="chat",
        estimated_cents=80,
    )

    with pytest.raises(HTTPException) as exc:
        budget_guard.reserve_tenant_budget(
            tenant_id="tenant-alpha",
            surface="chat",
            estimated_cents=30,
        )

    assert exc.value.status_code == 402
    assert exc.value.headers["X-Pearl-Budget-Remaining-Cents"] == "20"


def test_enforce_requires_configured_budget(monkeypatch):
    monkeypatch.setenv("PEARL_BUDGET_ENFORCEMENT", "enforce")

    with pytest.raises(HTTPException) as exc:
        budget_guard.reserve_tenant_budget(
            tenant_id="tenant-alpha",
            surface="chat",
            estimated_cents=30,
        )

    assert exc.value.status_code == 503


def test_budget_key_does_not_leak_raw_tenant(monkeypatch):
    monkeypatch.setenv("PEARL_BUDGET_ENFORCEMENT", "enforce")
    monkeypatch.setenv("PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT", "100")
    fake_store = budget_guard._redis_budget_store

    budget_guard.reserve_tenant_budget(
        tenant_id="tenant-alpha",
        surface="chat",
        estimated_cents=30,
    )

    assert fake_store.keys
    assert "tenant-alpha" not in "\n".join(fake_store.keys)


@pytest.mark.asyncio
async def test_async_budget_wrapper_reserves(monkeypatch):
    monkeypatch.setenv("PEARL_BUDGET_ENFORCEMENT", "enforce")
    monkeypatch.setenv("PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT", "100")

    reservation = await budget_guard.reserve_tenant_budget_async(
        tenant_id="tenant-alpha",
        surface="chat",
        estimated_cents=30,
    )

    assert reservation is not None
    assert reservation.used_cents == 30
