import asyncio
import base64
import hashlib
import hmac
import importlib
import json
import time

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


def fresh_gateway_module(monkeypatch):
    monkeypatch.setenv("AUTO_ROOM_ENABLED", "false")
    monkeypatch.setenv("BOT_CONTROL_AUTH_REQUIRED", "0")
    monkeypatch.setenv("BOT_CONTROL_CLAIMS_SECRET", "test-claims-secret")
    monkeypatch.setenv("USE_REDIS", "false")
    if "bot_gateway" in importlib.sys.modules:
        del importlib.sys.modules["bot_gateway"]
    import bot_gateway

    return importlib.reload(bot_gateway)


class FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_text(self, payload: str):
        self.sent.append(json.loads(payload))


def make_ws_token(payload: dict, secret: str = "test-claims-secret") -> str:
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")
    sig = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def ws_token_payload(**overrides):
    now = int(time.time() * 1000)
    payload = {
        "purpose": "gateway-ws",
        "tenantId": "tenant-a",
        "sessionUserId": "user-1",
        "sessionId": "sid-1",
        "sessionUserEmail": "sam@example.com",
        "sessionUserName": "Sam",
        "allowedScopes": ["sid-1", "user-1"],
        "iat": now,
        "exp": now + 90_000,
    }
    payload.update(overrides)
    return payload


def test_gateway_ws_token_allows_only_signed_session_and_user_scopes(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    claims = gateway._validate_gateway_ws_token(make_ws_token(ws_token_payload()))

    assert gateway._gateway_ws_scope_allowed(claims, "sid-1") is True
    assert gateway._gateway_ws_scope_allowed(claims, "user-1") is True
    assert gateway._gateway_ws_scope_allowed(claims, "sid-2") is False


def test_gateway_ws_token_rejects_bad_signature(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    token = make_ws_token(ws_token_payload()) + "bad"

    try:
        gateway._validate_gateway_ws_token(token)
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
        assert getattr(exc, "detail", "") == "invalid_gateway_ws_token_signature"
    else:
        raise AssertionError("expected invalid signature to be rejected")


def test_gateway_ws_token_rejects_expired_token(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    expired = ws_token_payload(exp=int(time.time() * 1000) - 1_000)

    try:
        gateway._validate_gateway_ws_token(make_ws_token(expired))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
        assert getattr(exc, "detail", "") == "expired_gateway_ws_token"
    else:
        raise AssertionError("expected expired token to be rejected")


def test_ws_events_rejects_missing_token_at_handshake(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    client = TestClient(gateway.app)

    try:
        with client.websocket_connect("/ws/events"):
            raise AssertionError("expected websocket without token to be rejected")
    except WebSocketDisconnect as exc:
        assert exc.code == 1008
        assert str(exc.reason) == "missing_gateway_ws_token"


def test_ws_events_accepts_signed_token_and_authorized_scope(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    client = TestClient(gateway.app)
    protocol = f"pearlos-gateway-auth.{make_ws_token(ws_token_payload())}"

    with client.websocket_connect("/ws/events", subprotocols=[protocol]) as websocket:
        assert websocket.accepted_subprotocol == protocol
        websocket.send_json({"session_id": "sid-1"})


def test_ws_events_rejects_unauthorized_scope_registration(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    client = TestClient(gateway.app)
    protocol = f"pearlos-gateway-auth.{make_ws_token(ws_token_payload())}"

    with client.websocket_connect("/ws/events", subprotocols=[protocol]) as websocket:
        websocket.send_json({"session_id": "sid-2"})
        try:
            websocket.receive_json()
        except WebSocketDisconnect as exc:
            assert exc.code == 1008
            assert str(exc.reason) == "scope_forbidden"
        else:
            raise AssertionError("expected unauthorized scope to close websocket")


def test_scoped_broadcast_only_reaches_matching_session(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    gateway._ws_clients.clear()
    gateway._ws_client_tenants.clear()
    gateway._ws_replay_buffer.clear()

    unscoped = FakeWebSocket()
    empty_scoped = FakeWebSocket()
    matching = FakeWebSocket()
    other = FakeWebSocket()
    gateway._ws_clients[unscoped] = None
    gateway._ws_clients[empty_scoped] = ""
    gateway._ws_clients[matching] = "sid-1"
    gateway._ws_clients[other] = "sid-2"

    asyncio.run(
        gateway.ws_broadcast(
            {
                "v": 1,
                "kind": "nia.event",
                "event": "note.open",
                "ts": int(time.time() * 1000),
                "payload": {"noteId": "private"},
            },
            session_id="sid-1",
        )
    )

    assert matching.sent[-1]["event"] == "note.open"
    assert unscoped.sent == []
    assert empty_scoped.sent == []
    assert other.sent == []


def test_scoped_broadcast_requires_matching_tenant_when_present(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    gateway._ws_clients.clear()
    gateway._ws_client_tenants.clear()
    gateway._ws_replay_buffer.clear()

    tenant_a = FakeWebSocket()
    tenant_b = FakeWebSocket()
    gateway._ws_clients[tenant_a] = "sid-1"
    gateway._ws_client_tenants[tenant_a] = "tenant-a"
    gateway._ws_clients[tenant_b] = "sid-1"
    gateway._ws_client_tenants[tenant_b] = "tenant-b"

    asyncio.run(
        gateway.ws_broadcast(
            {
                "v": 1,
                "kind": "nia.event",
                "event": "note.open",
                "ts": int(time.time() * 1000),
                "tenantId": "tenant-a",
                "payload": {"noteId": "private"},
            },
            session_id="sid-1",
        )
    )

    assert tenant_a.sent[-1]["event"] == "note.open"
    assert tenant_b.sent == []


def test_target_user_event_reaches_only_matching_user_scope(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    gateway._ws_clients.clear()
    gateway._ws_client_tenants.clear()
    gateway._ws_replay_buffer.clear()

    matching = FakeWebSocket()
    other = FakeWebSocket()
    gateway._ws_clients[matching] = "user-1"
    gateway._ws_clients[other] = "user-2"

    asyncio.run(
        gateway.ws_broadcast(
            {
                "v": 1,
                "kind": "nia.event",
                "event": "app.open",
                "ts": int(time.time() * 1000),
                "targetSessionUserId": "user-1",
                "payload": {"app": "news"},
            }
        )
    )

    assert matching.sent[-1]["event"] == "app.open"
    assert other.sent == []


def test_unscoped_user_visible_event_is_not_broadcast_by_default(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    gateway._ws_clients.clear()
    gateway._ws_client_tenants.clear()
    gateway._ws_replay_buffer.clear()

    unscoped = FakeWebSocket()
    scoped = FakeWebSocket()
    gateway._ws_clients[unscoped] = None
    gateway._ws_clients[scoped] = "sid-1"

    asyncio.run(
        gateway.ws_broadcast(
            {
                "v": 1,
                "kind": "nia.event",
                "event": "tool.result.visible",
                "ts": int(time.time() * 1000),
                "payload": {"value": "private-by-default"},
            }
        )
    )

    assert unscoped.sent == []
    assert scoped.sent == []


def test_explicit_global_event_still_broadcasts_to_all_clients(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    gateway._ws_clients.clear()
    gateway._ws_client_tenants.clear()
    gateway._ws_replay_buffer.clear()

    unscoped = FakeWebSocket()
    scoped = FakeWebSocket()
    gateway._ws_clients[unscoped] = None
    gateway._ws_clients[scoped] = "sid-1"

    asyncio.run(
        gateway.ws_broadcast(
            {
                "v": 1,
                "kind": "nia.event",
                "scope": "global",
                "event": "system.notice",
                "ts": int(time.time() * 1000),
                "payload": {"status": "ok"},
            }
        )
    )

    assert [msg["event"] for msg in unscoped.sent] == ["system.notice"]
    assert [msg["event"] for msg in scoped.sent] == ["system.notice"]


def test_replay_filtering_respects_session_scope(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    gateway._ws_clients.clear()
    gateway._ws_client_tenants.clear()
    gateway._ws_replay_buffer.clear()
    ts = int(time.time() * 1000)

    asyncio.run(
        gateway.ws_broadcast(
            {"kind": "nia.event", "event": "sid-a", "ts": ts},
            session_id="sid-a",
        )
    )
    asyncio.run(
        gateway.ws_broadcast(
            {"kind": "nia.event", "event": "sid-b", "ts": ts},
            session_id="sid-b",
        )
    )
    asyncio.run(
        gateway.ws_broadcast(
            {"kind": "nia.event", "scope": "global", "event": "global", "ts": ts}
        )
    )

    assert [env["event"] for env in gateway._ws_replay_envelopes_for(None)] == ["global"]
    assert [env["event"] for env in gateway._ws_replay_envelopes_for("sid-a")] == [
        "sid-a",
        "global",
    ]
    assert [env["event"] for env in gateway._ws_replay_envelopes_for("sid-b")] == [
        "sid-b",
        "global",
    ]
    assert [env["event"] for env in gateway._ws_replay_envelopes_for("sid-c")] == ["global"]


def test_replay_filtering_respects_tenant_scope(monkeypatch):
    gateway = fresh_gateway_module(monkeypatch)
    gateway._ws_clients.clear()
    gateway._ws_client_tenants.clear()
    gateway._ws_replay_buffer.clear()
    ts = int(time.time() * 1000)

    asyncio.run(
        gateway.ws_broadcast(
            {"kind": "nia.event", "event": "tenant-a", "tenantId": "tenant-a", "ts": ts},
            session_id="sid-1",
        )
    )
    asyncio.run(
        gateway.ws_broadcast(
            {"kind": "nia.event", "event": "tenant-b", "tenantId": "tenant-b", "ts": ts},
            session_id="sid-1",
        )
    )

    assert [env["event"] for env in gateway._ws_replay_envelopes_for("sid-1", "tenant-a")] == ["tenant-a"]
    assert [env["event"] for env in gateway._ws_replay_envelopes_for("sid-1", "tenant-b")] == ["tenant-b"]
