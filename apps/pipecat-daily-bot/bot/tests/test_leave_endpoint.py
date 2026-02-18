"""Tests for the /leave endpoint that clears pending config from Redis."""
import importlib
import os
from unittest.mock import MagicMock

from fastapi.testclient import TestClient


def with_env(env: dict[str, str]):
    """Context manager to temporarily set environment variables."""
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
    """Reload gateway module with current env flags in effect."""
    if 'bot_gateway' in list(importlib.sys.modules.keys()):
        del importlib.sys.modules['bot_gateway']
    if 'auth' in list(importlib.sys.modules.keys()):
        del importlib.sys.modules['auth']
    import bot_gateway
    importlib.reload(bot_gateway)
    return bot_gateway


class TestLeaveEndpoint:
    """Test suite for /leave endpoint."""

    def test_leave_clears_config_keys(self, monkeypatch):
        """Test that /leave deletes config and operator state keys from Redis."""
        with with_env({
            'BOT_CONTROL_AUTH_REQUIRED': '0',
            'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        }):
            gateway = fresh_gateway_module()

        # Mock Redis
        mock_redis = MagicMock()
        mock_redis.delete.return_value = 4  # Simulate 4 keys deleted
        monkeypatch.setattr(gateway, 'r', mock_redis)

        client = TestClient(gateway.app)

        room_url = "https://foo.daily.co/test-room"
        resp = client.post('/leave', json={"room_url": room_url})

        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'ok'
        assert data['room_url'] == room_url
        assert data['keys_deleted'] == 4

        # Verify Redis delete was called with all keys:
        # - bot:config:latest and bot:config:hash for pending config
        # - room_active and room_keepalive for operator state
        mock_redis.delete.assert_called_once_with(
            f"bot:config:latest:{room_url}",
            f"bot:config:hash:{room_url}",
            f"room_active:{room_url}",
            f"room_keepalive:{room_url}"
        )

    def test_leave_requires_room_url(self, monkeypatch):
        """Test that /leave returns 422 when room_url is missing."""
        with with_env({
            'BOT_CONTROL_AUTH_REQUIRED': '0',
            'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        }):
            gateway = fresh_gateway_module()

        mock_redis = MagicMock()
        monkeypatch.setattr(gateway, 'r', mock_redis)

        client = TestClient(gateway.app)

        # Missing room_url
        resp = client.post('/leave', json={})
        assert resp.status_code == 422  # Pydantic validation error

    def test_leave_handles_redis_error_gracefully(self, monkeypatch):
        """Test that /leave returns ok with warning when Redis fails."""
        with with_env({
            'BOT_CONTROL_AUTH_REQUIRED': '0',
            'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        }):
            gateway = fresh_gateway_module()

        # Mock Redis to raise an exception
        mock_redis = MagicMock()
        mock_redis.delete.side_effect = Exception("Redis connection lost")
        monkeypatch.setattr(gateway, 'r', mock_redis)

        client = TestClient(gateway.app)

        room_url = "https://foo.daily.co/test-room"
        resp = client.post('/leave', json={"room_url": room_url})

        # Should still return 200 with warning (non-critical cleanup)
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'ok'
        assert data['room_url'] == room_url
        assert 'warning' in data
        assert 'Redis connection lost' in data['warning']

    def test_leave_returns_503_when_redis_unavailable(self, monkeypatch):
        """Test that /leave returns 503 when Redis is not available."""
        with with_env({
            'BOT_CONTROL_AUTH_REQUIRED': '0',
            'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        }):
            gateway = fresh_gateway_module()

        # Set Redis to None
        monkeypatch.setattr(gateway, 'r', None)

        client = TestClient(gateway.app)

        resp = client.post('/leave', json={"room_url": "https://foo.daily.co/test-room"})
        assert resp.status_code == 503
        assert 'Redis not available' in resp.json()['detail']

    def test_leave_respects_auth_when_required(self, monkeypatch):
        """Test that /leave enforces auth when BOT_CONTROL_AUTH_REQUIRED=1."""
        with with_env({
            'BOT_CONTROL_AUTH_REQUIRED': '1',
            'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
            'TEST_ENFORCE_BOT_AUTH': '1',
        }):
            gateway = fresh_gateway_module()

        mock_redis = MagicMock()
        mock_redis.delete.return_value = 2
        monkeypatch.setattr(gateway, 'r', mock_redis)

        client = TestClient(gateway.app)
        room_url = "https://foo.daily.co/test-room"

        # 1. No header -> 401
        resp = client.post('/leave', json={"room_url": room_url})
        assert resp.status_code == 401

        # 2. Wrong header -> 401
        resp = client.post(
            '/leave',
            json={"room_url": room_url},
            headers={'Authorization': 'Bearer wrong'}
        )
        assert resp.status_code == 401

        # 3. Correct header -> 200
        resp = client.post(
            '/leave',
            json={"room_url": room_url},
            headers={'Authorization': 'Bearer s3cr3t'}
        )
        assert resp.status_code == 200
        assert resp.json()['status'] == 'ok'

    def test_leave_with_zero_keys_deleted(self, monkeypatch):
        """Test that /leave returns correctly when no keys exist to delete."""
        with with_env({
            'BOT_CONTROL_AUTH_REQUIRED': '0',
            'BOT_CONTROL_SHARED_SECRET': 's3cr3t',
        }):
            gateway = fresh_gateway_module()

        mock_redis = MagicMock()
        mock_redis.delete.return_value = 0  # No keys existed
        monkeypatch.setattr(gateway, 'r', mock_redis)

        client = TestClient(gateway.app)

        room_url = "https://foo.daily.co/nonexistent-room"
        resp = client.post('/leave', json={"room_url": room_url})

        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'ok'
        assert data['keys_deleted'] == 0
