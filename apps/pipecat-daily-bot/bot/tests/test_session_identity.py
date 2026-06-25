from __future__ import annotations

import pytest

from session.identity import IdentityManager
from session.participants import ParticipantManager


@pytest.mark.asyncio
async def test_resolve_identity_prefers_participant_specific_redis_over_pending(monkeypatch):
    manager = ParticipantManager()
    identity = IdentityManager("https://daily.example/room", manager)
    identity.pending_identity = {
        "sessionUserId": "stale-user",
        "sessionUserName": "Stephanie",
        "sessionUserEmail": "stale@example.com",
    }

    async def fake_scan(_pid: str):
        return {
            "sessionUserId": "user-blair",
            "sessionUserName": "Blair Erickson",
            "sessionUserEmail": "blair@example.com",
        }

    monkeypatch.setattr(identity, "scan_identity", fake_scan)

    resolved = await identity.resolve_identity("participant-1", {"info": {}})

    assert resolved == {
        "sessionUserId": "user-blair",
        "sessionUserName": "Blair Erickson",
        "sessionUserEmail": "blair@example.com",
    }


@pytest.mark.asyncio
async def test_resolve_identity_uses_pending_for_first_unidentified_human(monkeypatch):
    manager = ParticipantManager()
    identity = IdentityManager("https://daily.example/room", manager)
    identity.pending_identity = {
        "sessionUserId": "user-blair",
        "sessionUserName": "Blair Erickson",
        "sessionUserEmail": "blair@example.com",
    }

    async def fake_scan(_pid: str):
        return None

    monkeypatch.setattr(identity, "scan_identity", fake_scan)

    resolved = await identity.resolve_identity("participant-1", {"info": {}})

    assert resolved["sessionUserId"] == "user-blair"
    assert resolved["sessionUserName"] == "Blair Erickson"


@pytest.mark.asyncio
async def test_resolve_identity_does_not_reuse_pending_for_later_human(monkeypatch):
    manager = ParticipantManager()
    manager.active_participants.add("participant-1")
    identity = IdentityManager("https://daily.example/room", manager)
    identity.pending_identity = {
        "sessionUserId": "user-blair",
        "sessionUserName": "Blair Erickson",
        "sessionUserEmail": "blair@example.com",
    }

    async def fake_scan(_pid: str):
        return None

    monkeypatch.setattr(identity, "scan_identity", fake_scan)

    resolved = await identity.resolve_identity("participant-2", {"info": {}})

    assert resolved is None
