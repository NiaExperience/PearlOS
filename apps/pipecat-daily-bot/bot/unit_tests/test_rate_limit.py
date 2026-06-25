from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers, QueryParams

import rate_limit


class _FakeEvalRedis:
    def __init__(self):
        self._sets: dict[str, list[tuple[float, str]]] = {}

    def eval(self, _script, _num_keys, key, now, window_s, max_requests, member):
        now = float(now)
        window_s = float(window_s)
        max_requests = int(max_requests)
        values = [
            (score, existing_member)
            for score, existing_member in self._sets.get(key, [])
            if score > now - window_s
        ]
        values.sort(key=lambda item: item[0])
        if len(values) >= max_requests:
            self._sets[key] = values
            return [-1, values[0][0] + window_s]
        values.append((now, str(member)))
        values.sort(key=lambda item: item[0])
        self._sets[key] = values
        return [max_requests - len(values), values[0][0] + window_s]


def _request(*, headers: dict[str, str] | None = None, path: str = "/api/tasks"):
    return SimpleNamespace(
        headers=Headers(headers or {}),
        query_params=QueryParams({}),
        client=SimpleNamespace(host="127.0.0.1"),
        url=SimpleNamespace(path=path),
    )


@pytest.fixture(autouse=True)
def reset_rate_limits(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_BACKEND", "memory")
    monkeypatch.setenv("PEARL_RATE_LIMIT_WINDOW_S", "60")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("PEARL_RATE_LIMIT_REDIS_URL", raising=False)
    rate_limit._memory_rate_store = rate_limit._MemoryRateLimitStore()
    rate_limit._redis_rate_store = rate_limit._RedisRateLimitStore()


def test_user_bucket_blocks_same_tenant_user(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_USER_MAX", "1")
    monkeypatch.setenv("PEARL_RATE_LIMIT_TENANT_MAX", "20")
    monkeypatch.setenv("PEARL_RATE_LIMIT_SURFACE_MAX", "20")
    request = _request()

    rate_limit.apply_general_rate_limit(
        request,
        surface="tasks:swarm",
        tenant_id="tenant-alpha",
        user_id="user-alpha",
    )

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            request,
            surface="tasks:swarm",
            tenant_id="tenant-alpha",
            user_id="user-alpha",
        )

    assert exc.value.status_code == 429
    assert exc.value.headers["X-RateLimit-Scope"] == "user"


def test_tenant_bucket_blocks_second_user(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_USER_MAX", "20")
    monkeypatch.setenv("PEARL_RATE_LIMIT_TENANT_MAX", "1")
    monkeypatch.setenv("PEARL_RATE_LIMIT_SURFACE_MAX", "20")
    request = _request()

    rate_limit.apply_general_rate_limit(
        request,
        surface="tasks:swarm",
        tenant_id="tenant-alpha",
        user_id="user-alpha",
    )

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            request,
            surface="tasks:swarm",
            tenant_id="tenant-alpha",
            user_id="user-beta",
        )

    assert exc.value.status_code == 429
    assert exc.value.headers["X-RateLimit-Scope"] == "tenant"


def test_surface_bucket_blocks_across_tenants(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_USER_MAX", "20")
    monkeypatch.setenv("PEARL_RATE_LIMIT_TENANT_MAX", "20")
    monkeypatch.setenv("PEARL_RATE_LIMIT_SURFACE_MAX", "1")
    request = _request()

    rate_limit.apply_general_rate_limit(
        request,
        surface="tasks:swarm",
        tenant_id="tenant-alpha",
        user_id="user-alpha",
    )

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            request,
            surface="tasks:swarm",
            tenant_id="tenant-beta",
            user_id="user-beta",
        )

    assert exc.value.status_code == 429
    assert exc.value.headers["X-RateLimit-Scope"] == "surface"


def test_bucket_keys_do_not_leak_raw_identity_values():
    request = _request(headers={"x-user-email": "person@example.test"})

    buckets = rate_limit._rate_limit_buckets_for_request(
        request,
        surface="tasks:swarm",
        tenant_id="tenant-alpha",
        user_max=5,
    )

    joined_keys = "\n".join(bucket.key for bucket in buckets)
    assert "tenant-alpha" not in joined_keys
    assert "person@example.test" not in joined_keys


def test_redis_backend_enforces_bucket(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_BACKEND", "redis")
    monkeypatch.setenv("PEARL_RATE_LIMIT_USER_MAX", "1")
    monkeypatch.setenv("PEARL_RATE_LIMIT_TENANT_MAX", "20")
    monkeypatch.setenv("PEARL_RATE_LIMIT_SURFACE_MAX", "20")
    rate_limit._redis_rate_store._client = _FakeEvalRedis()
    request = _request()

    rate_limit.apply_general_rate_limit(
        request,
        surface="tasks:swarm",
        tenant_id="tenant-alpha",
        user_id="user-alpha",
    )

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            request,
            surface="tasks:swarm",
            tenant_id="tenant-alpha",
            user_id="user-alpha",
        )

    assert exc.value.status_code == 429
    assert exc.value.headers["X-RateLimit-Scope"] == "user"


def test_redis_backend_fails_closed_when_unavailable(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_BACKEND", "redis")
    request = _request()

    def broken_check_many(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(rate_limit._redis_rate_store, "check_many", broken_check_many)

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            request,
            surface="tasks:swarm",
            tenant_id="tenant-alpha",
            user_id="user-alpha",
        )

    assert exc.value.status_code == 503


def test_auto_backend_fails_closed_when_redis_is_configured(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_BACKEND", "auto")
    monkeypatch.setenv("USE_REDIS", "true")
    request = _request()

    def broken_check_many(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(rate_limit._redis_rate_store, "check_many", broken_check_many)

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            request,
            surface="tasks:swarm",
            tenant_id="tenant-alpha",
            user_id="user-alpha",
        )

    assert exc.value.status_code == 503


def test_auto_backend_uses_memory_when_redis_is_unconfigured(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_BACKEND", "auto")
    monkeypatch.delenv("USE_REDIS", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("PEARL_RATE_LIMIT_REDIS_URL", raising=False)
    monkeypatch.setenv("PEARL_RATE_LIMIT_USER_MAX", "1")
    request = _request()

    rate_limit.apply_general_rate_limit(
        request,
        surface="tasks:swarm",
        tenant_id="tenant-alpha",
        user_id="user-alpha",
    )

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            request,
            surface="tasks:swarm",
            tenant_id="tenant-alpha",
            user_id="user-alpha",
        )

    assert exc.value.status_code == 429


def test_forwarded_for_is_ignored_by_default(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_USER_MAX", "1")
    monkeypatch.setenv("PEARL_RATE_LIMIT_TENANT_MAX", "20")
    monkeypatch.setenv("PEARL_RATE_LIMIT_SURFACE_MAX", "20")

    rate_limit.apply_general_rate_limit(
        _request(headers={"x-forwarded-for": "203.0.113.1"}),
        surface="tasks:swarm",
        tenant_id="tenant-alpha",
    )

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            _request(headers={"x-forwarded-for": "203.0.113.2"}),
            surface="tasks:swarm",
            tenant_id="tenant-alpha",
        )

    assert exc.value.status_code == 429
    assert exc.value.headers["X-RateLimit-Scope"] == "user"


def test_client_surface_headers_do_not_fragment_implicit_surface(monkeypatch):
    monkeypatch.setenv("PEARL_RATE_LIMIT_USER_MAX", "20")
    monkeypatch.setenv("PEARL_RATE_LIMIT_TENANT_MAX", "20")
    monkeypatch.setenv("PEARL_RATE_LIMIT_SURFACE_MAX", "1")

    rate_limit.apply_general_rate_limit(
        _request(headers={"x-pearl-surface": "one"}, path="/api/implicit"),
        tenant_id="tenant-alpha",
        user_id="user-alpha",
    )

    with pytest.raises(HTTPException) as exc:
        rate_limit.apply_general_rate_limit(
            _request(headers={"x-pearl-surface": "two"}, path="/api/implicit"),
            tenant_id="tenant-beta",
            user_id="user-beta",
        )

    assert exc.value.status_code == 429
    assert exc.value.headers["X-RateLimit-Scope"] == "surface"
