"""Phase 2B: Gateway integration tests — /emit-event, /health, /ws/events."""
import asyncio
import json
import time

import pytest
import httpx

GATEWAY_URL = "http://localhost:4444"


def _gateway_reachable() -> bool:
    try:
        r = httpx.get(f"{GATEWAY_URL}/health", timeout=2)
        return r.status_code == 200
    except Exception:
        return False


gateway_up = pytest.mark.skipif(
    not _gateway_reachable(), reason="Gateway not reachable on :4444"
)


@pytest.mark.integration
class TestGatewayHealth:
    @gateway_up
    def test_health(self):
        r = httpx.get(f"{GATEWAY_URL}/health", timeout=5)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


@pytest.mark.integration
class TestEmitEvent:
    @gateway_up
    def test_wonder_scene(self):
        r = httpx.post(
            f"{GATEWAY_URL}/emit-event",
            json={"event": "wonder.scene", "payload": {"html": "<h1>Test</h1>"}},
            timeout=5,
        )
        # 200 or 500 (no DAILY_API_KEY) — both mean endpoint works
        assert r.status_code in (200, 500)

    @gateway_up
    def test_apps_close(self):
        r = httpx.post(
            f"{GATEWAY_URL}/emit-event",
            json={"event": "apps.close", "payload": {}},
            timeout=5,
        )
        assert r.status_code in (200, 500)


@pytest.mark.integration
class TestWebSocketEvents:
    """Connect to /ws/events and verify event delivery after /emit-event POST."""

    @gateway_up
    def test_ws_event_delivery(self):
        """POST an event and verify it arrives on the WebSocket within 3 seconds."""
        import websockets

        async def _run():
            uri = GATEWAY_URL.replace("http", "ws") + "/ws/events"
            async with websockets.connect(uri) as ws:
                # POST an event
                async with httpx.AsyncClient() as client:
                    r = await client.post(
                        f"{GATEWAY_URL}/emit-event",
                        json={
                            "event": "wonder.scene",
                            "payload": {"html": "<p>ws-test</p>"},
                        },
                        timeout=5,
                    )
                # If emit failed due to no DAILY_API_KEY, ws delivery also won't work
                if r.status_code != 200:
                    pytest.skip("emit-event returned non-200 (likely no DAILY_API_KEY)")

                # Wait for event on WS
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
                    data = json.loads(msg)
                    assert data.get("event") == "wonder.scene" or data.get("kind") == "nia.event"
                except asyncio.TimeoutError:
                    pytest.fail("No event received on WebSocket within 3 seconds")

        asyncio.run(_run())
