import asyncio

import pytest
from services.app_message_forwarder import BRIDGE_KIND, AppMessageForwarder
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
