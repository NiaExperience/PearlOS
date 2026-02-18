import importlib

from loguru import logger


def test_eventbus_publish_logs(monkeypatch):
    monkeypatch.setenv("BOT_EVENT_BUS", "log")
    # Capture logs via a custom sink list
    records = []

    def sink(msg):
        records.append(msg)

    token = logger.add(sink, level="INFO")
    try:
        eb = importlib.import_module("eventbus")
        ev1 = eb.emit_call_state("room", "starting")
        ev2 = eb.emit_participant_join("room", "p1")
        ev3 = eb.emit_participant_left("room", "p1", "left")
    finally:
        logger.remove(token)
    combined = "\n".join(str(r) for r in records)
    assert "daily.call.state" in combined
    assert "daily.participant.join" in combined
    assert "daily.participant.leave" in combined
    # Envelope structure
    for ev in (ev1, ev2, ev3):
        assert {"id", "ts", "type", "version", "data"}.issubset(ev.keys())
        assert ev["version"] == "1"


# TODO: These tests hang, fix and refactor
# def test_sse_stream_envelopes(monkeypatch):
#     class FakeProc:
#         def __init__(self, pid=60001):
#             self.pid = pid

#     monkeypatch.setattr(server, "Popen", lambda cmd: FakeProc())
#     monkeypatch.setattr(server.os, "kill", lambda pid, sig: None)
#     # Ensure logging backend (not required but consistent)
#     monkeypatch.setenv("BOT_EVENT_BUS", "log")
#     client = TestClient(server.app)
#     with client.stream("GET", "/events", timeout=5) as r:
#         # Small delay to ensure server registered streaming queue
#         time.sleep(0.05)
#         eb.emit_call_state("room-sse", "starting")
#         lines: list[str] = []
#         deadline = time.time() + 3.0
#         for chunk in r.iter_text():
#             if chunk:
#                 lines.extend([ln for ln in chunk.splitlines() if ln])
#             if any(l.startswith("data: ") for l in lines):
#                 break
#             if time.time() > deadline:
#                 break
#     data_lines = [l for l in lines if l.startswith("data: ")]
#     assert data_lines, "Expected at least one SSE data line within timeout"
#     raw = data_lines[-1][6:].strip()
#     env = json.loads(raw)
#     assert env.get("type") == "daily.call.state"
#     assert env.get("version") == "1"


# def test_websocket_event_stream(monkeypatch):
#     class FakeProc:
#         def __init__(self, pid=61001):
#             self.pid = pid

#     monkeypatch.setattr(server, "Popen", lambda cmd: FakeProc())
#     monkeypatch.setattr(server.os, "kill", lambda pid, sig: None)
#     monkeypatch.setenv("BOT_EVENT_BUS", "log")
#     client = TestClient(server.app)
#     with client.websocket_connect("/ws/events") as ws:
#         # Allow register_stream to attach
#         time.sleep(0.02)
#         eb.emit_participant_join("room-ws", "p1")
#         msg = ws.receive_json(timeout=3)
#         assert msg.get("version") == "1"
#         assert msg.get("type") == "daily.participant.join"
#         assert "id" in msg and "data" in msg
