import asyncio
import json

import pytest
from services.app_message_forwarder import (
    BRIDGE_KIND,
    DAILY_APP_MSG_MAX_BYTES,
    AppMessageForwarder,
)
from eventbus import events as evt
from eventbus.bus import publish


class DummyClient:
    def __init__(self, collector):
        self._collector = collector

    def send_app_message(self, envelope, _unused=None):
        self._collector.append(envelope)

    def send_message(self, frame):  # frame has .message
        self._collector.append(frame.message)


class DummyTransport:
    room_url = "https://example.daily.co/roomA"

    def __init__(self):
        self.sent = []
        self._client = DummyClient(self.sent)


@pytest.mark.asyncio
async def test_forwarder_envelopes_and_seq(monkeypatch):
    sent = []
    t = DummyTransport()
    fwd = AppMessageForwarder(
        t, snapshot_provider=lambda: {"participants": ["u1"]}, room_url=t.room_url
    )

    async def fake_send(env):  # intercept _send (post envelope build)
        sent.append(env)

    monkeypatch.setattr(fwd, "_send", fake_send)  # type: ignore
    stop = fwd.start()
    publish(evt.DAILY_CALL_STATE, {"room": "r1", "phase": "starting"})
    publish(evt.DAILY_PARTICIPANT_JOIN, {"room": "r1", "participant": "u1"})
    await asyncio.sleep(0.02)
    assert len(sent) == 2
    assert sent[0]["seq"] == 1 and sent[0]["kind"] == BRIDGE_KIND
    assert sent[1]["seq"] == 2 and sent[1]["kind"] == BRIDGE_KIND
    # Request snapshot
    fwd.handle_incoming({"kind": "req", "req": "snapshot"})
    await asyncio.sleep(0.02)
    assert len(sent) == 3
    snap = sent[2]
    assert snap["event"] == "snapshot" and snap["kind"] == BRIDGE_KIND
    assert snap["seq"] == 3
    stop()


@pytest.mark.asyncio
async def test_inproc_mode(monkeypatch):
    t = DummyTransport()
    monkeypatch.setenv('BOT_EVENT_FORWARDER', 'inproc')
    fwd = AppMessageForwarder(t, snapshot_provider=lambda: {}, room_url=t.room_url)
    stop = fwd.start()
    publish(evt.DAILY_CALL_STATE, {"room": "r1", "phase": "starting"})
    await asyncio.sleep(0.02)
    # Should have used inproc transport sender (no HTTP path)
    assert len(t.sent) == 1
    env = t.sent[0]
    assert env['kind'] == BRIDGE_KIND and env['event'] == evt.DAILY_CALL_STATE
    stop()


@pytest.mark.asyncio
async def test_large_payload_skips_daily_inproc(monkeypatch):
    """Payloads exceeding DAILY_APP_MSG_MAX_BYTES must not reach the Daily transport.

    The wonder.scene event is the primary trigger; complex HTML easily exceeds 4KB.
    The WebSocket path still delivers the envelope (tested separately via _ws_broadcast).
    """
    t = DummyTransport()
    monkeypatch.setenv('BOT_EVENT_FORWARDER', 'inproc')
    fwd = AppMessageForwarder(t, snapshot_provider=lambda: {}, room_url=t.room_url)

    # Build an envelope whose serialised size exceeds the Daily limit
    large_html = "x" * (DAILY_APP_MSG_MAX_BYTES + 500)
    large_envelope = {
        "v": 1,
        "kind": BRIDGE_KIND,
        "seq": 1,
        "ts": 0,
        "event": "wonder.scene",
        "payload": {"html": large_html, "layer": "main"},
    }
    assert len(json.dumps(large_envelope).encode("utf-8")) > DAILY_APP_MSG_MAX_BYTES

    # Call _inproc_send directly — should return without touching the transport
    await fwd._inproc_send(large_envelope)

    assert len(t.sent) == 0, "Large payload must NOT be forwarded via Daily inproc"


@pytest.mark.asyncio
async def test_small_payload_reaches_daily_inproc(monkeypatch):
    """Small payloads (under threshold) must still reach the Daily transport."""
    t = DummyTransport()
    monkeypatch.setenv('BOT_EVENT_FORWARDER', 'inproc')
    fwd = AppMessageForwarder(t, snapshot_provider=lambda: {}, room_url=t.room_url)

    small_envelope = {
        "v": 1,
        "kind": BRIDGE_KIND,
        "seq": 1,
        "ts": 0,
        "event": "wonder.clear",
        "payload": {"layer": "main"},
    }
    assert len(json.dumps(small_envelope).encode("utf-8")) < DAILY_APP_MSG_MAX_BYTES

    await fwd._inproc_send(small_envelope)

    assert len(t.sent) == 1, "Small payload must reach Daily inproc"


@pytest.mark.asyncio
async def test_large_payload_skips_daily_http(monkeypatch):
    """_http_post_send must silently skip oversized payloads (no HTTP call made)."""
    import aiohttp as _aiohttp

    t = DummyTransport()
    monkeypatch.setenv('BOT_EVENT_FORWARDER', 'html')
    monkeypatch.setenv('DAILY_API_KEY', 'fake-key')
    fwd = AppMessageForwarder(t, snapshot_provider=lambda: {}, room_url=t.room_url)

    http_calls: list = []

    # Patch aiohttp.ClientSession.post to track calls
    class _FakeResponse:
        status = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def text(self): return ""

    class _FakeSession:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        def post(self, *args, **kwargs):
            http_calls.append(args)
            return _FakeResponse()

    monkeypatch.setattr("services.app_message_forwarder.aiohttp", type(
        "aiohttp", (), {"ClientSession": lambda: _FakeSession()}
    ))

    large_html = "y" * (DAILY_APP_MSG_MAX_BYTES + 500)
    large_envelope = {
        "v": 1,
        "kind": BRIDGE_KIND,
        "seq": 1,
        "ts": 0,
        "event": "wonder.scene",
        "payload": {"html": large_html},
    }
    assert len(json.dumps(large_envelope).encode("utf-8")) > DAILY_APP_MSG_MAX_BYTES

    await fwd._http_post_send(large_envelope)

    assert len(http_calls) == 0, "Large payload must NOT trigger an HTTP call to Daily"
