from __future__ import annotations

import pytest
from fastapi import HTTPException

from api.chat_inbox_api import (
    AddInboxRequest,
    InboxStore,
    add_inbox_message,
    list_inbox,
    mark_read,
)


def test_inbox_store_isolates_same_email_across_tenants(tmp_path):
    store = InboxStore(str(tmp_path))

    entry_a = store.add(
        content="Tenant A update",
        for_user_email="User+QA@Example.com",
        tenant_id="Tenant-A",
        task_id="task-a",
    )
    entry_b = store.add(
        content="Tenant B update",
        for_user_email="user+qa@example.com",
        tenant_id="tenant-b",
        task_id="task-b",
    )

    assert entry_a is not None
    assert entry_b is not None
    assert entry_a["tenant_id"] == "tenant-a"
    assert entry_b["tenant_id"] == "tenant-b"

    assert [m["task_id"] for m in store.list_unread("tenant-a", "user+qa@example.com")] == ["task-a"]
    assert [m["task_id"] for m in store.list_unread("tenant-b", "user+qa@example.com")] == ["task-b"]

    assert store.mark_read("tenant-a", "user+qa@example.com", ids=[entry_a["id"], entry_b["id"]]) == 1
    assert store.list_unread("tenant-a", "user+qa@example.com") == []
    assert [m["task_id"] for m in store.list_unread("tenant-b", "user+qa@example.com")] == ["task-b"]

    assert (tmp_path / "tenant-a" / "user_plus_qa_at_example.com.jsonl").exists()
    assert (tmp_path / "tenant-b" / "user_plus_qa_at_example.com.jsonl").exists()


def test_inbox_store_drops_entries_without_tenant(tmp_path):
    store = InboxStore(str(tmp_path))

    assert store.add(content="Missing tenant", for_user_email="user@example.com") is None
    assert store.add(content="Missing user", tenant_id="tenant-a") is None
    assert store.list_unread("", "user@example.com") == []
    assert store.mark_read("", "user@example.com") == 0


@pytest.mark.asyncio
async def test_list_and_mark_read_require_tenant_header():
    with pytest.raises(HTTPException) as list_error:
        await list_inbox(x_user_email="user@example.com")
    assert list_error.value.status_code == 401
    assert list_error.value.detail == "tenant identity required"

    with pytest.raises(HTTPException) as mark_error:
        await mark_read(x_user_email="user@example.com")
    assert mark_error.value.status_code == 401
    assert mark_error.value.detail == "tenant identity required"


@pytest.mark.asyncio
async def test_add_inbox_message_uses_header_tenant_before_body(monkeypatch):
    calls: list[dict] = []

    class RecordingStore:
        def add(self, **kwargs):
            calls.append(kwargs)
            return {"id": "inbox-1", **kwargs}

    monkeypatch.setattr("api.chat_inbox_api.get_store", lambda: RecordingStore())

    response = await add_inbox_message(
        AddInboxRequest(
            content="Scoped",
            for_user_email="target@example.com",
            tenant_id="tenant-body",
            tenantId="tenant-camel",
        ),
        x_user_email="caller@example.com",
        x_tenant_id="tenant-header",
        x_pearl_tenant_id="tenant-pearl",
    )

    assert response["ok"] is True
    assert calls == [
        {
            "content": "Scoped",
            "for_user_email": "target@example.com",
            "tenant_id": "tenant-header",
            "task_id": None,
            "task_title": None,
            "kind": "system_followup",
        }
    ]
