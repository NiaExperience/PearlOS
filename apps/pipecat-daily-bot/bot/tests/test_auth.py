import importlib
import hmac
import hashlib
import json
import os
import time
from unittest.mock import MagicMock

from fastapi.testclient import TestClient


def with_env(env: dict[str, str]):
    class _Ctx:
        def __enter__(self):
            self._prev = {k: os.environ.get(k) for k in env}
            os.environ.update(env)

        def __exit__(self, exc_type, exc, tb):
            for k, v in self._prev.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
    return _Ctx()


def fresh_gateway_module():
    # Ensure we reload gateway with current env flags in effect
    if 'bot_gateway' in list(importlib.sys.modules.keys()):
        del importlib.sys.modules['bot_gateway']
    # Also drop auth so its import-time snapshot reflects the env
    if 'auth' in list(importlib.sys.modules.keys()):
        del importlib.sys.modules['auth']
    import bot_gateway
    importlib.reload(bot_gateway)
    return bot_gateway


def signed_claim_headers(secret: str, claims: dict[str, str]) -> dict[str, str]:
    ts = str(int(time.time() * 1000))
    payload = json.dumps(
        {
            "tenantId": claims.get("tenantId") or "",
            "sessionUserId": claims.get("sessionUserId") or "",
            "sessionId": claims.get("sessionId") or "",
            "sessionUserEmail": claims.get("sessionUserEmail") or "",
            "sessionUserName": claims.get("sessionUserName") or "",
        },
        separators=(",", ":"),
    )
    sig = hmac.new(secret.encode("utf-8"), f"{ts}.{payload}".encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "x-bot-claims-ts": ts,
        "x-bot-claims": payload,
        "x-bot-claims-sig": sig,
    }


async def fake_direct_runner_start(_body, session_id, _req_logger):
    return {
        "status": "running",
        "pid": 123,
        "session_id": session_id,
        "room_url": "https://foo.daily.co/bar",
        "personalityId": "default",
        "persona": "Pearl",
    }


def test_optional_auth_allows_requests(monkeypatch):
    with with_env({
        'BOT_CONTROL_AUTH_REQUIRED': '0',
        'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
    }):
        gateway = fresh_gateway_module()

    # Mock Redis
    mock_redis = MagicMock()
    mock_redis.get.return_value = None
    monkeypatch.setattr(gateway, 'r', mock_redis)
    monkeypatch.setattr(gateway, '_direct_runner_start', fake_direct_runner_start)

    client = TestClient(gateway.app)

    # No header should still work when auth not required
    resp = client.post('/join', json={"room_url": "https://foo.daily.co/bar"})
    assert resp.status_code in (200, 422)  # 422 if validation fails, but auth passed
    if resp.status_code == 200:
        assert resp.json()['status'] in ('queued', 'running')


def test_required_auth_enforced(monkeypatch):
    with with_env({
        'BOT_CONTROL_AUTH_REQUIRED': '1',
        'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        'TEST_ENFORCE_BOT_AUTH': '1',
    }):
        gateway = fresh_gateway_module()
    monkeypatch.setenv('BOT_CONTROL_SHARED_SECRET', 's3cr3t')

    # Mock Redis
    mock_redis = MagicMock()
    mock_redis.get.return_value = None
    monkeypatch.setattr(gateway, 'r', mock_redis)

    client = TestClient(gateway.app)

    # 1. No header -> 401
    resp = client.post('/join', json={"room_url": "https://foo.daily.co/bar"})
    assert resp.status_code == 401

    # 2. Wrong header -> 401
    resp = client.post(
        '/join',
        json={"room_url": "https://foo.daily.co/bar"},
        headers={'Authorization': 'Bearer wrong'}
    )
    assert resp.status_code == 401

    # 3. Correct header clears auth; downstream join admission may still
    # queue, run directly, validate, or rate-limit depending on test env.
    claims = {
        "tenantId": "tenant-1",
        "sessionUserId": "user-1",
        "sessionId": "session-1",
        "sessionUserEmail": "user@example.com",
    }
    resp = client.post(
        '/join',
        json={"room_url": "https://foo.daily.co/bar", **claims},
        headers={'Authorization': 'Bearer s3cr3t', **signed_claim_headers("s3cr3t", claims)}
    )
    assert resp.status_code in (200, 422, 429)
    if resp.status_code == 200:
        assert resp.json()['status'] in ('queued', 'running')


def test_bearer_header_also_supported(monkeypatch):
    with with_env({
        'BOT_CONTROL_AUTH_REQUIRED': '1',
        'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        'TEST_ENFORCE_BOT_AUTH': '1',
    }):
        gateway = fresh_gateway_module()
    monkeypatch.setenv('BOT_CONTROL_SHARED_SECRET', 's3cr3t')

    # Mock Redis
    mock_redis = MagicMock()
    mock_redis.get.return_value = None
    monkeypatch.setattr(gateway, 'r', mock_redis)
    monkeypatch.setattr(gateway, '_direct_runner_start', fake_direct_runner_start)

    client = TestClient(gateway.app)

    # "Bearer <token>"
    claims = {
        "tenantId": "tenant-1",
        "sessionUserId": "user-1",
        "sessionId": "session-1",
        "sessionUserEmail": "user@example.com",
    }
    resp = client.post(
        '/join',
        json={"room_url": "https://foo.daily.co/bar", **claims},
        headers={'Authorization': 'Bearer s3cr3t', **signed_claim_headers("s3cr3t", claims)}
    )
    assert resp.status_code in (200, 422, 429)
