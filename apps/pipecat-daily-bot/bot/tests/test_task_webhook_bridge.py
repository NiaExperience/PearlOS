from __future__ import annotations

import importlib
import sys
from typing import Any

import pytest


@pytest.fixture()
def gateway(monkeypatch):
    monkeypatch.setenv("BOT_CONTROL_AUTH_REQUIRED", "0")
    monkeypatch.setenv("USE_REDIS", "false")
    if "bot_gateway" in sys.modules:
        del sys.modules["bot_gateway"]
    import bot_gateway

    return importlib.reload(bot_gateway)


class RecordingStore:
    def __init__(self, current: dict[str, Any] | None = None) -> None:
        self.current = current
        self.updates: list[tuple[str, dict[str, Any]]] = []

    def get(self, task_id: str) -> dict[str, Any] | None:
        if self.current and self.current.get("id") == task_id:
            return self.current
        return None

    def update(self, task_id: str, patch: dict[str, Any]) -> None:
        self.updates.append((task_id, patch))
        if self.current and self.current.get("id") == task_id:
            self.current.update(patch)


class FailingInbox:
    def add(self, **_kwargs: Any) -> None:
        raise AssertionError("stale task envelopes should not publish duplicate inbox entries")


class RecordingInbox:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def add(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return {"id": "inbox-1", **kwargs}


@pytest.mark.asyncio
async def test_terminal_task_webhook_marks_notified(gateway, monkeypatch):
    calls: list[tuple[str, str]] = []

    def fake_post(task: dict, event: str) -> bool:
        calls.append((task["id"], event))
        return True

    monkeypatch.setattr(gateway, "_post_task_webhook_event", fake_post)
    store = RecordingStore()

    ok = await gateway._publish_task_lifecycle_webhook(
        {
            "id": "task-1",
            "status": "completed",
            "requester_tenant_id": "tenant-a",
        },
        store,
    )

    assert ok is True
    assert calls == [("task-1", "task.completed")]
    assert store.updates
    assert store.updates[0][0] == "task-1"
    assert "webhook_notified_at" in store.updates[0][1]


@pytest.mark.asyncio
async def test_terminal_task_webhook_skips_already_notified(gateway, monkeypatch):
    def fail_post(_task: dict, _event: str) -> bool:
        raise AssertionError("webhook bridge should not post twice")

    monkeypatch.setattr(gateway, "_post_task_webhook_event", fail_post)
    store = RecordingStore()

    ok = await gateway._publish_task_lifecycle_webhook(
        {
            "id": "task-1",
            "status": "completed",
            "requester_tenant_id": "tenant-a",
            "webhook_notified_at": "2026-06-04T00:00:00+00:00",
        },
        store,
    )

    assert ok is False
    assert store.updates == []


@pytest.mark.asyncio
async def test_created_terminal_event_publishes_lifecycle_webhook(gateway, monkeypatch):
    calls: list[str] = []

    async def fake_inbox(_task: dict, _inbox: object, _store: object) -> bool:
        return False

    async def fake_webhook(task: dict, _store: object) -> bool:
        calls.append(task["id"])
        return True

    monkeypatch.setattr(gateway, "_publish_task_result_to_inbox", fake_inbox)
    monkeypatch.setattr(gateway, "_publish_task_lifecycle_webhook", fake_webhook)

    await gateway._publish_task_notifications_for_event(
        {
            "event": "created",
            "task": {
                "id": "task-created-complete",
                "status": "completed",
                "requester_tenant_id": "tenant-a",
            },
        },
        inbox=object(),
        store=object(),
    )

    assert calls == ["task-created-complete"]


@pytest.mark.asyncio
async def test_stale_terminal_event_uses_current_notification_marker(gateway, monkeypatch):
    def fail_post(_task: dict, _event: str) -> bool:
        raise AssertionError("stale task envelopes should not publish duplicate webhooks")

    monkeypatch.setattr(gateway, "_post_task_webhook_event", fail_post)
    store = RecordingStore(
        {
            "id": "task-stale",
            "status": "completed",
            "requester_tenant_id": "tenant-a",
            "webhook_notified_at": "2026-06-04T00:00:00+00:00",
        }
    )

    ok = await gateway._publish_task_lifecycle_webhook(
        {
            "id": "task-stale",
            "status": "completed",
            "requester_tenant_id": "tenant-a",
        },
        store,
    )

    assert ok is False
    assert store.updates == []


@pytest.mark.asyncio
async def test_stale_terminal_event_uses_current_inbox_marker(gateway):
    store = RecordingStore(
        {
            "id": "task-stale",
            "status": "completed",
            "result": "Already sent.",
            "requester_email": "qa@example.invalid",
            "requester_tenant_id": "tenant-a",
            "result_notified_at": "2026-06-04T00:00:00+00:00",
        }
    )

    ok = await gateway._publish_task_result_to_inbox(
        {
            "id": "task-stale",
            "status": "completed",
            "result": "Already sent.",
            "requester_email": "qa@example.invalid",
            "requester_tenant_id": "tenant-a",
        },
        FailingInbox(),
        store,
    )

    assert ok is False
    assert store.updates == []


@pytest.mark.asyncio
async def test_terminal_task_result_publishes_inbox_with_tenant_scope(gateway):
    store = RecordingStore()
    inbox = RecordingInbox()

    ok = await gateway._publish_task_result_to_inbox(
        {
            "id": "task-tenant",
            "title": "Scoped Task",
            "status": "completed",
            "result": "Done.",
            "requester_email": "qa@example.invalid",
            "requester_tenant_id": "tenant-a",
        },
        inbox,
        store,
    )

    assert ok is True
    assert inbox.calls == [
        {
            "content": "The Scoped Task task is done. Done.",
            "for_user_email": "qa@example.invalid",
            "tenant_id": "tenant-a",
            "task_id": "task-tenant",
            "task_title": "Scoped Task",
            "kind": "task_result",
        }
    ]
    assert store.updates
    assert "result_notified_at" in store.updates[0][1]


@pytest.mark.asyncio
async def test_terminal_task_result_without_tenant_does_not_publish_inbox(gateway):
    store = RecordingStore()
    inbox = RecordingInbox()

    ok = await gateway._publish_task_result_to_inbox(
        {
            "id": "task-no-tenant",
            "title": "Unscoped Task",
            "status": "completed",
            "result": "Done.",
            "requester_email": "qa@example.invalid",
        },
        inbox,
        store,
    )

    assert ok is False
    assert inbox.calls == []
    assert store.updates == []
