import importlib
import os
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

    client = TestClient(gateway.app)

    # No header should still work when auth not required
    resp = client.post('/join', json={"room_url": "https://foo.daily.co/bar"})
    assert resp.status_code in (200, 422)  # 422 if validation fails, but auth passed
    if resp.status_code == 200:
        assert resp.json()['status'] == 'queued'


def test_required_auth_enforced(monkeypatch):
    with with_env({
        'BOT_CONTROL_AUTH_REQUIRED': '1',
        'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        'TEST_ENFORCE_BOT_AUTH': '1',
    }):
        gateway = fresh_gateway_module()

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

    # 3. Correct header -> 200
    resp = client.post(
        '/join',
        json={"room_url": "https://foo.daily.co/bar"},
        headers={'Authorization': 'Bearer s3cr3t'}
    )
    assert resp.status_code == 200
    assert resp.json()['status'] == 'queued'


def test_bearer_header_also_supported(monkeypatch):
    with with_env({
        'BOT_CONTROL_AUTH_REQUIRED': '1',
        'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        'TEST_ENFORCE_BOT_AUTH': '1',
    }):
        gateway = fresh_gateway_module()

    # Mock Redis
    mock_redis = MagicMock()
    mock_redis.get.return_value = None
    monkeypatch.setattr(gateway, 'r', mock_redis)

    client = TestClient(gateway.app)

    # "Bearer <token>"
    resp = client.post(
        '/join',
        json={"room_url": "https://foo.daily.co/bar"},
        headers={'Authorization': 'Bearer s3cr3t'}
    )
    assert resp.status_code == 200
