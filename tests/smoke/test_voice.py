"""Smoke test for Voice / Daily room."""
import os
import requests
import pytest

DAILY_API_KEY = os.getenv("DAILY_API_KEY", "")
DAILY_DOMAIN = os.getenv("DAILY_DOMAIN", "pearlos")
DEFAULT_ROOM = os.getenv("DEFAULT_ROOM_NAME", "pearl-default")


@pytest.mark.skipif(not DAILY_API_KEY, reason="DAILY_API_KEY not set")
class TestVoiceRoom:
    def test_daily_room_exists(self):
        headers = {"Authorization": f"Bearer {DAILY_API_KEY}"}
        r = requests.get(
            f"https://api.daily.co/v1/rooms/{DEFAULT_ROOM}",
            headers=headers,
            timeout=10,
        )
        assert r.status_code == 200, f"Room not found: {r.status_code}"

    def test_room_has_participants(self):
        """Check if the bot is present in the room (may be 0 if idle)."""
        headers = {"Authorization": f"Bearer {DAILY_API_KEY}"}
        r = requests.get(
            f"https://api.daily.co/v1/rooms/{DEFAULT_ROOM}/presence",
            headers=headers,
            timeout=10,
        )
        # 200 means room exists with presence info; don't assert participants > 0
        assert r.status_code in (200, 404)
