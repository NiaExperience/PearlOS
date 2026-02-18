import asyncio

import runner_main
from fastapi.testclient import TestClient


def test_runner_smoke(monkeypatch):
    # Disable Redis for this test to avoid connection errors
    # Must patch the module variable directly since it's evaluated at import time
    monkeypatch.setattr(runner_main, "USE_REDIS", False)
    
    # Stub _launch_session to avoid real Daily provisioning & pipeline
    async def fake_launch(room_url, token, personality, persona, body=None):
        async def _dummy():
            await asyncio.sleep(10)
        task = asyncio.create_task(_dummy())
        canonical_session_id = (body or {}).get("sessionId") or "sid123"
        info = runner_main.SessionInfo(canonical_session_id, task, None, room_url, token, personality, persona)
        runner_main.sessions[info.id] = info
        return info

    monkeypatch.setattr(runner_main, "_launch_session", fake_launch)

    client = TestClient(runner_main.app)

    h = client.get("/health")
    assert h.status_code == 200
    assert h.json()["sessions"] == 0

    provided_session = "sid-provided"
    start = client.post("/start", json={"room_url": "https://example.daily.test/room2", "personality": "pearl", "sessionId": provided_session})
    assert start.status_code == 200
    body = start.json()
    assert body["sessionId"] == provided_session
    assert body["personality"] == "pearl"
    assert body["provisioned"] is False

    sessions = client.get("/sessions")
    assert sessions.status_code == 200
    assert len(sessions.json()) == 1

    leave = client.post(f"/sessions/{provided_session}/leave")
    assert leave.status_code == 200
    assert leave.json()["status"] in {"terminated", "already-finished"}

    sessions2 = client.get("/sessions")
    assert len(sessions2.json()) == 0


def test_runner_transition_endpoint(monkeypatch):
    monkeypatch.setattr(runner_main, "USE_REDIS", False)
    runner_main.sessions.clear()
    runner_main._transitioning_sessions.clear()

    launch_calls = []

    async def fake_launch(room_url, token, personality, persona, body=None):
        launch_calls.append(
            {
                "room_url": room_url,
                "token": token,
                "personality": personality,
                "persona": persona,
                "body": dict(body or {}),
            }
        )
        async def _dummy():
            await asyncio.sleep(0)
        task = asyncio.create_task(_dummy())
        sid = (body or {}).get("sessionId") or "sid-transition"
        info = runner_main.SessionInfo(
            sid,
            task,
            None,
            room_url,
            token,
            personality,
            persona,
            body,
        )
        runner_main.sessions[sid] = info
        return info

    monkeypatch.setattr(runner_main, "_launch_session", fake_launch)

    class _FakeTask:
        def __init__(self):
            self._done = False

        def done(self):
            return self._done

        def cancel(self):
            self._done = True

        def __await__(self):
            async def _noop():
                return None
            return _noop().__await__()

    runner_main.sessions["sid-original"] = runner_main.SessionInfo(
        "sid-original",
        _FakeTask(),
        None,
        "https://old.daily.test/room",
        None,
        "p-old",
        "Pearl",
        {
            "sessionId": "sid-original",
            "sessionUserId": "u1",
            "sessionUserName": "User One",
        },
    )

    client = TestClient(runner_main.app)

    resp = client.post(
        "/sessions/sid-original/transition",
        json={
            "new_room_url": "https://new.daily.test/room",
            "personalityId": "p-new",
            "persona": "Pearl",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "transitioned"
    assert data["session_id"] == "sid-original"
    assert data["room_url"] == "https://new.daily.test/room"

    assert len(launch_calls) == 1
    assert launch_calls[0]["room_url"] == "https://new.daily.test/room"
    assert launch_calls[0]["body"]["sessionId"] == "sid-original"
    assert launch_calls[0]["body"]["sessionUserId"] == "u1"
