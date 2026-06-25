import hashlib
import hmac
import json

import pytest

from processors.non_blocking_router import NonBlockingToolRouter, PASSTHROUGH_TOOL_WHITELIST


def _verified_claims(headers: dict[str, str], secret: str) -> dict:
    timestamp = headers["x-bot-claims-ts"]
    payload = headers["x-bot-claims"]
    signature = headers["x-bot-claims-sig"]
    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{payload}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert signature == expected
    return json.loads(payload)


class _FakeResponse:
    status = 200

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return {"result": {"success": True}}


class _FakeSession:
    def __init__(self):
        self.posts = []

    def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        return _FakeResponse()


@pytest.mark.asyncio
async def test_gateway_tool_payload_uses_router_room_not_global_room(monkeypatch):
    router = NonBlockingToolRouter.__new__(NonBlockingToolRouter)
    router._room_url = "https://daily.test/current-room"
    router._forwarder_ref = {"instance": None}
    monkeypatch.setenv("BOT_CONTROL_SHARED_SECRET", "test-secret")
    monkeypatch.setenv("BOT_SESSION_USER_ID", "user-a")
    monkeypatch.setenv("BOT_SESSION_USER_EMAIL", "user@example.com")

    session = _FakeSession()

    async def fake_get_session():
        return session

    router._get_session = fake_get_session

    import room.state as room_state

    monkeypatch.setattr(
        room_state,
        "get_current_room_url",
        lambda: "https://daily.test/stale-room",
    )
    monkeypatch.setattr(
        room_state,
        "get_room_tenant_id",
        lambda room_url: "tenant-a",
    )

    result = await router._execute_tool_via_gateway("bot_open_notes", {})

    assert result == {"success": True}
    assert session.posts
    payload = session.posts[0][1]["json"]
    assert payload["room_url"] == "https://daily.test/current-room"
    assert payload["tenant_id"] == "tenant-a"
    assert payload["user_id"] == "user-a"
    assert payload["user_email"] == "user@example.com"
    headers = session.posts[0][1]["headers"]
    assert headers["X-Bot-Secret"] == "test-secret"
    assert headers["Authorization"] == "Bearer test-secret"
    assert headers["x-user-id"] == "user-a"
    assert headers["x-user-email"] == "user@example.com"
    assert headers["x-tenant-id"] == "tenant-a"
    assert headers["x-pearl-tenant-id"] == "tenant-a"
    claims = _verified_claims(headers, "test-secret")
    assert claims["tenantId"] == "tenant-a"
    assert claims["sessionUserId"] == "user-a"
    assert claims["sessionUserEmail"] == "user@example.com"


@pytest.mark.asyncio
async def test_gateway_tool_payload_uses_session_tenant_when_room_state_missing(monkeypatch):
    router = NonBlockingToolRouter.__new__(NonBlockingToolRouter)
    router._room_url = "https://daily.test/current-room"
    router._forwarder_ref = {"instance": None}
    monkeypatch.setenv("BOT_CONTROL_SHARED_SECRET", "test-secret")
    monkeypatch.setenv("BOT_SESSION_TENANT_ID", "tenant-from-session")
    monkeypatch.setenv("BOT_SESSION_USER_ID", "user-a")
    monkeypatch.setenv("BOT_SESSION_USER_EMAIL", "user@example.com")

    session = _FakeSession()

    async def fake_get_session():
        return session

    router._get_session = fake_get_session

    import room.state as room_state

    monkeypatch.setattr(room_state, "get_room_tenant_id", lambda room_url: "")

    result = await router._execute_tool_via_gateway("bot_openclaw_task", {"task": "qa task"})

    assert result == {"success": True}
    payload = session.posts[0][1]["json"]
    assert payload["tenant_id"] == "tenant-from-session"
    headers = session.posts[0][1]["headers"]
    assert headers["x-tenant-id"] == "tenant-from-session"
    assert headers["x-pearl-tenant-id"] == "tenant-from-session"
    claims = _verified_claims(headers, "test-secret")
    assert claims["tenantId"] == "tenant-from-session"
    assert claims["sessionUserId"] == "user-a"
    assert claims["sessionUserEmail"] == "user@example.com"


@pytest.mark.asyncio
async def test_photo_magic_phase1_tool_executes_directly():
    assert "bot_photo_magic_generate" in PASSTHROUGH_TOOL_WHITELIST
    assert "bot_photo_magic_generate" in NonBlockingToolRouter.DATA_RICH_TOOLS

    router = NonBlockingToolRouter.__new__(NonBlockingToolRouter)
    router._openclaw_task_dispatch_times = {}
    router._openclaw_task_dispatched = False
    router._end_call_requested = False

    calls = []

    async def fake_execute_tool_via_gateway(name, params, direct_tool_voice_handled=False):
        calls.append(
            {
                "name": name,
                "params": params,
                "direct_tool_voice_handled": direct_tool_voice_handled,
            }
        )
        return {
            "success": True,
            "image_url": "/api/photo-magic/image/generated.png",
            "model": "test-image-model",
        }

    router._execute_tool_via_gateway = fake_execute_tool_via_gateway

    result = await router._execute_phase1_tool_calls(
        [
            {
                "name": "bot_photo_magic_generate",
                "arguments": json.dumps({"prompt": "Jalen Brunson dunking"}),
            }
        ]
    )

    assert calls == [
        {
            "name": "bot_photo_magic_generate",
            "params": {"prompt": "Jalen Brunson dunking"},
            "direct_tool_voice_handled": True,
        }
    ]
    assert result["bot_photo_magic_generate"]["image_url"] == "/api/photo-magic/image/generated.png"
