"""Tests for gateway-driven forum transition behavior."""
import importlib
import hmac
import hashlib
import json
import os
import time
import types
from unittest.mock import MagicMock

import pytest
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


def signed_claim_headers(secret: str, claims: dict[str, str]) -> dict[str, str]:
    ts = str(int(time.time() * 1000))
    return signed_claim_headers_at(secret, claims, ts)


def signed_claim_headers_at(secret: str, claims: dict[str, str], ts: str) -> dict[str, str]:
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


def test_config_request_preserves_persona():
    bot_gateway = fresh_gateway_module()

    request = bot_gateway.ConfigRequest(
        room_url="https://daily.example/room",
        personalityId="pearl-press",
        persona="Pearl Press",
    )

    assert request.model_dump(exclude_none=True)["persona"] == "Pearl Press"


def test_voice_identity_enrichment_replaces_stale_body_name_with_authenticated_header(monkeypatch):
    shared_secret_env = "BOT_CONTROL_" + "SHARED_SECRET"
    env = {
        "BOT_CONTROL_AUTH_REQUIRED": "0",
        "USE_REDIS": "false",
    }
    env[shared_secret_env] = "test-value"
    with with_env(
        env
    ):
        gateway = fresh_gateway_module()

    body = {
        "sessionUserId": "user-blair",
        "sessionUserEmail": "blair@example.com",
        "sessionUserName": "Stephanie",
    }
    request = types.SimpleNamespace(
        headers={
            "x-bot-claims": json.dumps(
                {
                    "sessionUserId": "user-blair",
                    "sessionUserEmail": "blair@example.com",
                }
            ),
            "x-user-name": "Blair Erickson",
        }
    )
    logs = []
    req_logger = types.SimpleNamespace(info=lambda *args, **kwargs: logs.append((args, kwargs)))

    gateway._enrich_voice_identity_from_request(body, request, req_logger)

    assert body["sessionUserId"] == "user-blair"
    assert body["sessionUserEmail"] == "blair@example.com"
    assert body["sessionUserName"] == "Blair Erickson"
    assert logs


def test_voice_identity_enrichment_keeps_claims_name_authoritative(monkeypatch):
    shared_secret_env = "BOT_CONTROL_" + "SHARED_SECRET"
    env = {
        "BOT_CONTROL_AUTH_REQUIRED": "0",
        "USE_REDIS": "false",
    }
    env[shared_secret_env] = "test-value"
    with with_env(
        env
    ):
        gateway = fresh_gateway_module()

    body = {
        "sessionUserId": "user-blair",
        "sessionUserEmail": "blair@example.com",
        "sessionUserName": "Stephanie",
    }
    request = types.SimpleNamespace(
        headers={
            "x-bot-claims": json.dumps(
                {
                    "sessionUserId": "user-blair",
                    "sessionUserEmail": "blair@example.com",
                    "sessionUserName": "Blair",
                }
            ),
            "x-user-name": "Wrong Header Name",
        }
    )
    req_logger = types.SimpleNamespace(info=lambda *args, **kwargs: None)

    gateway._enrich_voice_identity_from_request(body, request, req_logger)

    assert body["sessionUserName"] == "Blair"


def test_direct_join_requires_signed_claims_when_auth_required(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "1",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "TEST_ENFORCE_BOT_AUTH": "1",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()
    monkeypatch.setenv("BOT_CONTROL_SHARED_SECRET", "s3cr3t")

    direct_calls: list[dict] = []

    async def fake_direct_runner_start(body, session_id, req_logger):
        direct_calls.append({"body": body, "session_id": session_id})
        return {"status": "running", "pid": 123, "room_url": body["room_url"], "session_id": session_id}

    monkeypatch.setattr(gateway, "_direct_runner_start", fake_direct_runner_start)
    client = TestClient(gateway.app)

    resp = client.post(
        "/join",
        json={
            "room_url": "https://daily.test/direct-room",
            "tenantId": "tenant-a",
            "sessionUserId": "user-1",
            "sessionId": "session-1",
        },
        headers={"X-Bot-Secret": "s3cr3t"},
    )

    assert resp.status_code == 401
    assert resp.json()["detail"] == "missing_bot_claims"
    assert direct_calls == []


def test_direct_join_rejects_signed_claim_body_tenant_mismatch(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "1",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "TEST_ENFORCE_BOT_AUTH": "1",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()
    monkeypatch.setenv("BOT_CONTROL_SHARED_SECRET", "s3cr3t")

    direct_calls: list[dict] = []

    async def fake_direct_runner_start(body, session_id, req_logger):
        direct_calls.append({"body": body, "session_id": session_id})
        return {"status": "running", "pid": 123, "room_url": body["room_url"], "session_id": session_id}

    monkeypatch.setattr(gateway, "_direct_runner_start", fake_direct_runner_start)
    claims = {
        "tenantId": "tenant-a",
        "sessionUserId": "user-1",
        "sessionId": "session-1",
        "sessionUserEmail": "user@example.com",
    }
    client = TestClient(gateway.app)

    resp = client.post(
        "/join",
        json={
            "room_url": "https://daily.test/direct-room",
            "tenantId": "tenant-b",
            "sessionUserId": "user-1",
            "sessionId": "session-1",
        },
        headers={"X-Bot-Secret": "s3cr3t", **signed_claim_headers("s3cr3t", claims)},
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "claims_mismatch:tenantId"
    assert direct_calls == []


def test_tool_invoke_normalizes_pearl_system_openclaw_task_to_direct_dispatch(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()

    calls: list[dict] = []

    async def fake_openclaw_task(params, tenant_id, user_id):
        calls.append({"params": dict(params), "tenant_id": tenant_id, "user_id": user_id})
        return {"success": True, "task_id": "task-test"}

    monkeypatch.setitem(gateway._DIRECT_TOOL_HANDLERS, "bot_openclaw_task", fake_openclaw_task)
    client = TestClient(gateway.app)

    resp = client.post(
        "/api/tools/invoke",
        json={
            "tool_name": "pearl_system",
            "params": {"action": "openclaw_task", "task": "agent connectivity fix request"},
        },
        headers={
            "X-Bot-Secret": "s3cr3t",
            "x-tenant-id": "tenant-real",
            "x-user-id": "user-1",
            "x-user-email": "sam@example.com",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["tool_name"] == "bot_openclaw_task"
    assert resp.json()["execution"] == "direct"
    assert calls == [
        {
            "params": {
                "action": "openclaw_task",
                "task": "agent connectivity fix request",
                "user_email": "sam@example.com",
                "_authenticated_user_email": "sam@example.com",
                "requester_tenant_id": "tenant-real",
                "requester_user_id": "user-1",
            },
            "tenant_id": "tenant-real",
            "user_id": "user-1",
        }
    ]


def test_tool_invoke_requires_tenant_for_user_task_dispatch(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()

    async def fake_openclaw_task(params, tenant_id, user_id):
        return {"success": True}

    monkeypatch.setitem(gateway._DIRECT_TOOL_HANDLERS, "bot_openclaw_task", fake_openclaw_task)
    client = TestClient(gateway.app)

    resp = client.post(
        "/api/tools/invoke",
        json={"tool_name": "bot_openclaw_task", "params": {"task": "qa task"}, "user_id": "user-1"},
        headers={"X-Bot-Secret": "s3cr3t"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "tenant_id_required_for_task_dispatch"


def test_tool_invoke_normalizes_pearl_open_internal_apps(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()

    async def fake_broadcast(*args, **kwargs):
        return None

    monkeypatch.setattr(gateway, "_broadcast_tool_event_best_effort", fake_broadcast)
    gateway._register_direct_handlers()
    client = TestClient(gateway.app)

    cases = [
        ({"action": "agency"}, "bot_open_app", "agency"),
        ({"action": "studio"}, "bot_open_app", "creation-launchpad"),
        ({"action": "our_pearlos"}, "bot_open_app", "our-pearlos"),
        ({"action": "filespace"}, "bot_open_files", None),
    ]

    for params, expected_tool, expected_app in cases:
        resp = client.post(
            "/api/tools/invoke",
            json={"tool_name": "pearl_open", "params": params},
            headers={"X-Bot-Secret": "s3cr3t"},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["tool_name"] == expected_tool
        assert body["execution"] == "direct"
        if expected_app:
            assert body["result"]["app"] == expected_app


def test_tool_invoke_rejects_stale_signed_claims_when_auth_required(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "1",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "TEST_ENFORCE_BOT_AUTH": "1",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()
    monkeypatch.setenv("BOT_CONTROL_SHARED_SECRET", "s3cr3t")

    claims = {
        "tenantId": "tenant-a",
        "sessionUserId": "user-1",
        "sessionId": "session-1",
        "sessionUserEmail": "user@example.com",
    }
    stale_ts = str(int((time.time() - 600) * 1000))
    client = TestClient(gateway.app)

    resp = client.post(
        "/api/tools/invoke",
        json={
            "tool_name": "bot_list_notes",
            "params": {},
            "tenant_id": "tenant-a",
            "user_id": "user-1",
        },
        headers={"X-Bot-Secret": "s3cr3t", **signed_claim_headers_at("s3cr3t", claims, stale_ts)},
    )

    assert resp.status_code == 401
    assert resp.json()["detail"] == "stale_bot_claims"


def test_tool_invoke_voice_agency_request_queues_swarm_metadata(monkeypatch):
    shared_secret_env = "BOT_CONTROL_" + "SHARED_SECRET"
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "USE_REDIS": "false",
            shared_secret_env: "s3cr3t",
        }
    ):
        gateway = fresh_gateway_module()

    captured: dict = {}
    budget_calls: list[dict] = []

    def fake_create_direct(**kwargs):
        captured.update(kwargs)
        return {"id": "task-test", **kwargs}

    async def fake_reserve_budget(**kwargs):
        budget_calls.append(kwargs)

    monkeypatch.setattr(gateway, "_tasks_create_direct", fake_create_direct)
    monkeypatch.setattr(gateway, "reserve_tenant_budget_async", fake_reserve_budget)
    gateway._register_direct_handlers()
    client = TestClient(gateway.app)

    resp = client.post(
        "/api/tools/invoke",
        json={
            "tool_name": "bot_openclaw_task",
            "params": {
                "task": "Dispatch an Agency swarm to create a website QA smoke.",
                "title": "Create website - QA smoke",
            },
        },
        headers={
            "X-Bot-Secret": "s3cr3t",
            "x-tenant-id": "tenant-real",
            "x-user-id": "user-1",
            "x-user-email": "sam@example.com",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["execution"] == "direct"
    assert captured["source"] == "voice"
    assert captured["kind"] == "swarm"
    assert captured["swarm_category"] == "The Agency"
    assert captured["execution_mode"] == "full_build"
    assert captured["requester_tenant_id"] == "tenant-real"
    assert captured["requester_user_id"] == "user-1"
    assert captured["requester_email"] == "sam@example.com"
    assert budget_calls == [
        {"tenant_id": "tenant-real", "surface": "task_swarm", "estimated_cents": 100}
    ]
    assert {"Codex", "Claude CLI", "Kimi 2.6", "Gemini", "DeepSeek4Pro"}.issubset(
        set(captured["agents"])
    )


def test_tool_invoke_voice_dispatch_uses_authenticated_requester_scope(monkeypatch):
    shared_secret_env = "BOT_CONTROL_" + "SHARED_SECRET"
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "USE_REDIS": "false",
            shared_secret_env: "s3cr3t",
        }
    ):
        gateway = fresh_gateway_module()

    captured: dict = {}

    def fake_create_direct(**kwargs):
        captured.update(kwargs)
        return {"id": "task-test", **kwargs}

    monkeypatch.setattr(gateway, "_tasks_create_direct", fake_create_direct)
    gateway._register_direct_handlers()
    client = TestClient(gateway.app)

    resp = client.post(
        "/api/tools/invoke",
        json={
            "tool_name": "bot_openclaw_task",
            "params": {
                "task": "Dispatch an Agency swarm to audit requester scope.",
                "requester_tenant_id": "tenant-spoof",
                "requester_user_id": "user-spoof",
                "requester_email": "spoof@example.com",
            },
        },
        headers={
            "X-Bot-Secret": "s3cr3t",
            "x-tenant-id": "tenant-real",
            "x-user-id": "user-real",
            "x-user-email": "sam@example.com",
        },
    )

    assert resp.status_code == 200
    assert captured["requester_tenant_id"] == "tenant-real"
    assert captured["requester_user_id"] == "user-real"
    assert captured["requester_email"] == "sam@example.com"


def test_tool_invoke_voice_dispatch_preserves_explicit_swarm_agents(monkeypatch):
    shared_secret_env = "BOT_CONTROL_" + "SHARED_SECRET"
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "USE_REDIS": "false",
            shared_secret_env: "s3cr3t",
        }
    ):
        gateway = fresh_gateway_module()

    captured: dict = {}

    def fake_create_direct(**kwargs):
        captured.update(kwargs)
        return {"id": "task-test", **kwargs}

    monkeypatch.setattr(gateway, "_tasks_create_direct", fake_create_direct)
    gateway._register_direct_handlers()
    client = TestClient(gateway.app)

    resp = client.post(
        "/api/tools/invoke",
        json={
            "tool_name": "bot_openclaw_task",
            "params": {
                "task": "Dispatch an explicit single-agent swarm smoke.",
                "kind": "swarm",
                "agents": ["Codex"],
                "execution_mode": "fast_draft",
            },
        },
        headers={
            "X-Bot-Secret": "s3cr3t",
            "x-tenant-id": "tenant-real",
            "x-user-id": "user-1",
            "x-user-email": "sam@example.com",
        },
    )

    assert resp.status_code == 200
    assert captured["kind"] == "swarm"
    assert captured["agents"] == ["Codex"]
    assert captured["execution_mode"] == "fast_draft"


def test_tool_invoke_voice_dispatch_honors_explicit_task_kind(monkeypatch):
    shared_secret_env = "BOT_CONTROL_" + "SHARED_SECRET"
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "0",
            "USE_REDIS": "false",
            shared_secret_env: "s3cr3t",
        }
    ):
        gateway = fresh_gateway_module()

    captured: dict = {}
    budget_calls: list[dict] = []

    def fake_create_direct(**kwargs):
        captured.update(kwargs)
        return {"id": "task-test", **kwargs}

    async def fake_reserve_budget(**kwargs):
        budget_calls.append(kwargs)

    monkeypatch.setattr(gateway, "_tasks_create_direct", fake_create_direct)
    monkeypatch.setattr(gateway, "reserve_tenant_budget_async", fake_reserve_budget)
    gateway._register_direct_handlers()
    client = TestClient(gateway.app)

    resp = client.post(
        "/api/tools/invoke",
        json={
            "tool_name": "bot_openclaw_task",
            "params": {
                "task": "Create a website QA smoke, but keep this as a normal task.",
                "kind": "task",
                "execution_mode": "fast_draft",
            },
        },
        headers={
            "X-Bot-Secret": "s3cr3t",
            "x-tenant-id": "tenant-real",
            "x-user-id": "user-1",
            "x-user-email": "sam@example.com",
        },
    )

    assert resp.status_code == 200
    assert captured["kind"] == "task"
    assert captured["agents"] is None
    assert captured["execution_mode"] == "fast_draft"
    assert budget_calls == []


def test_direct_join_accepts_valid_signed_claims_when_auth_required(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "1",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "TEST_ENFORCE_BOT_AUTH": "1",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()
    monkeypatch.setenv("BOT_CONTROL_SHARED_SECRET", "s3cr3t")

    direct_calls: list[dict] = []

    async def fake_direct_runner_start(body, session_id, req_logger):
        direct_calls.append({"body": body, "session_id": session_id})
        return {"status": "running", "pid": 123, "room_url": body["room_url"], "session_id": session_id}

    monkeypatch.setattr(gateway, "_direct_runner_start", fake_direct_runner_start)
    claims = {
        "tenantId": "tenant-a",
        "sessionUserId": "user-1",
        "sessionId": "session-1",
        "sessionUserEmail": "user@example.com",
        "sessionUserName": "User One",
    }
    client = TestClient(gateway.app)

    resp = client.post(
        "/join",
        json={
            "room_url": "https://daily.test/direct-room",
            "tenantId": "tenant-a",
            "sessionUserId": "spoof-user",
            "sessionId": "session-1",
            "sessionUserName": "Spoof Name",
        },
        headers={"X-Bot-Secret": "s3cr3t", **signed_claim_headers("s3cr3t", claims)},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "running"
    assert direct_calls[0]["body"]["sessionUserId"] == "user-1"
    assert direct_calls[0]["body"]["sessionUserEmail"] == "user@example.com"
    assert direct_calls[0]["body"]["sessionUserName"] == "User One"


def test_leave_requires_signed_claim_context_when_auth_required(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "1",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "TEST_ENFORCE_BOT_AUTH": "1",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()
    monkeypatch.setenv("BOT_CONTROL_SHARED_SECRET", "s3cr3t")

    gateway.active_rooms.clear()
    client = TestClient(gateway.app)

    resp = client.post(
        "/leave",
        json={"room_url": "https://daily.test/direct-room"},
        headers={"X-Bot-Secret": "s3cr3t"},
    )

    assert resp.status_code == 401
    assert resp.json()["detail"] == "missing_claim_context"


def test_leave_accepts_valid_signed_claim_context_when_auth_required(monkeypatch):
    with with_env(
        {
            "BOT_CONTROL_AUTH_REQUIRED": "1",
            "BOT_CONTROL_SHARED_SECRET": "s3cr3t",
            "TEST_ENFORCE_BOT_AUTH": "1",
            "USE_REDIS": "false",
        }
    ):
        gateway = fresh_gateway_module()
    monkeypatch.setenv("BOT_CONTROL_SHARED_SECRET", "s3cr3t")

    claims = {
        "tenantId": "tenant-a",
        "sessionUserId": "user-1",
        "sessionId": "session-1",
        "sessionUserEmail": "user@example.com",
    }
    gateway.active_rooms.clear()
    client = TestClient(gateway.app)

    resp = client.post(
        "/leave",
        json={
            "room_url": "https://daily.test/direct-room",
            "tenantId": "tenant-a",
            "sessionUserId": "user-1",
            "sessionId": "session-1",
        },
        headers={"X-Bot-Secret": "s3cr3t", **signed_claim_headers("s3cr3t", claims)},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


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


@pytest.mark.asyncio
async def test_photo_magic_direct_result_broadcasts_wonder_scene(monkeypatch):
    gateway = fresh_gateway_module()
    events: list[dict] = []

    async def fake_ws_broadcast(envelope, session_id=None):
        events.append({"envelope": envelope, "session_id": session_id})

    monkeypatch.setattr(gateway, "ws_broadcast", fake_ws_broadcast)

    await gateway._broadcast_tool_event_best_effort(
        "bot_photo_magic_generate",
        {"prompt": "Jalen Brunson dunking over a defender"},
        {
            "success": True,
            "image_url": "/api/photo-magic/image/generated.png",
            "model": "test-image-model",
        },
        room_url=None,
        direct_tool_voice_handled=True,
    )

    scene_events = [
        item["envelope"]
        for item in events
        if item["envelope"].get("event") == "wonder.scene"
    ]
    assert scene_events
    envelope = scene_events[0]
    payload = envelope["payload"]
    assert payload["layer"] == "main"
    assert payload["transition"] == "fade"
    assert "/api/photo-magic/image/generated.png" in payload["html"]
    assert "Photo Magic - test-image-model" in payload["html"]
    assert "Jalen Brunson dunking over a defender" in payload["html"]
