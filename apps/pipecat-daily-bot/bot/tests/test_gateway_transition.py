"""Tests for gateway-driven forum transition behavior."""
import importlib
import json
import os
import types
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
    if "bot_gateway" in list(importlib.sys.modules.keys()):
        del importlib.sys.modules["bot_gateway"]
    if "auth" in list(importlib.sys.modules.keys()):
        del importlib.sys.modules["auth"]
    import bot_gateway

    importlib.reload(bot_gateway)
    return bot_gateway


class _FakeResponse:
    def __init__(self, status: int, payload: dict):
        self.status = status
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self._payload

    async def text(self):
        return json.dumps(self._payload)


class _FakeSession:
    def __init__(self, response: _FakeResponse):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def post(self, *_args, **_kwargs):
        return self._response


def test_join_transitions_existing_user_bot(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "USE_REDIS": "true",
        }
    ):
        gateway = fresh_gateway_module()

    room_url = "https://daily.test/new-room"
    old_room = "https://daily.test/old-room"
    tenant_id = "t1"
    user_id = "u1"
    user_key = f"user_bot:{tenant_id}:{user_id}"

    mock_redis = MagicMock()
    state_map = {
        f"room_active:{room_url}": None,
        user_key: json.dumps(
            {
                "session_id": "sid-1",
                "room_url": old_room,
                "personalityId": "p-old",
                "persona": "Pearl",
            }
        ),
        f"room_active:{old_room}": json.dumps(
            {
                "status": "running",
                "session_id": "sid-1",
                "runner_url": "http://runner.test",
                "personalityId": "p-old",
                "persona": "Pearl",
            }
        ),
    }
    mock_redis.get.side_effect = lambda key: state_map.get(key)
    mock_redis.setex.return_value = True
    mock_redis.delete.return_value = 1
    monkeypatch.setattr(gateway, "r", mock_redis)

    fake_resp = _FakeResponse(
        200,
        {
            "status": "transitioned",
            "session_id": "sid-1",
            "room_url": room_url,
            "personalityId": "p-old",
            "persona": "Pearl",
        },
    )
    monkeypatch.setattr(gateway.aiohttp, "ClientSession", lambda: _FakeSession(fake_resp))

    client = TestClient(gateway.app)
    resp = client.post(
        "/join",
        json={
            "room_url": room_url,
            "tenantId": tenant_id,
            "sessionUserId": user_id,
            "sessionUserName": "User One",
            "personalityId": "p-new",
            "persona": "Pearl",
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "transitioned"
    assert data["reused"] is True
    assert data["session_id"] == "sid-1"
    assert data["room_url"] == room_url

    mock_redis.setex.assert_called()
    mock_redis.delete.assert_any_call(f"room_active:{old_room}")


def test_join_transitions_existing_user_bot_in_direct_mode(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()

    room_url = "https://daily.test/forum-room"
    old_room = "https://daily.test/voice-room"
    tenant_id = "t1"
    user_id = "u-direct"
    user_key = gateway._user_bot_key(user_id, tenant_id)

    class _Task:
        def done(self):
            return False

    class _Session:
        def __init__(self, sid: str, room: str, personality: str, persona: str):
            self.id = sid
            self.room_url = room
            self.personality = personality
            self.persona = persona
            self.task = _Task()

    transition_calls: list[dict] = []

    async def fake_transition_session(session_id: str, body):
        transition_calls.append(
            {
                "session_id": session_id,
                "new_room_url": body.new_room_url,
                "new_token": body.new_token,
            }
        )
        return {
            "status": "transitioned",
            "session_id": session_id,
            "room_url": body.new_room_url,
            "personalityId": "p-old",
            "persona": "Pearl",
        }

    class _TransitionRequest:
        def __init__(self, **kwargs):
            self.new_room_url = kwargs.get("new_room_url")
            self.new_token = kwargs.get("new_token")
            self.personalityId = kwargs.get("personalityId")
            self.persona = kwargs.get("persona")
            self.sessionUserId = kwargs.get("sessionUserId")
            self.sessionUserName = kwargs.get("sessionUserName")
            self.sessionUserEmail = kwargs.get("sessionUserEmail")

    fake_runner_main = types.SimpleNamespace(
        sessions={"sid-direct": _Session("sid-direct", old_room, "p-old", "Pearl")},
        _first_session_for_room=lambda room: None,
        transition_session=fake_transition_session,
        TransitionRequest=_TransitionRequest,
    )
    monkeypatch.setitem(importlib.sys.modules, "runner_main", fake_runner_main)

    gateway.user_bots.clear()
    gateway.active_rooms.clear()
    gateway.user_bots[user_key] = {
        "session_id": "sid-direct",
        "room_url": old_room,
        "personalityId": "p-old",
        "persona": "Pearl",
        "tenantId": tenant_id,
    }

    client = TestClient(gateway.app)
    resp = client.post(
        "/join",
        json={
            "room_url": room_url,
            "tenantId": tenant_id,
            "sessionUserId": user_id,
            "sessionUserName": "Direct User",
            "personalityId": "p-new",
            "persona": "Pearl",
            "token": "tok-for-forum",
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "transitioned"
    assert data["reused"] is True
    assert data["session_id"] == "sid-direct"
    assert data["room_url"] == room_url
    assert transition_calls == [
        {
            "session_id": "sid-direct",
            "new_room_url": room_url,
            "new_token": "tok-for-forum",
        }
    ]

