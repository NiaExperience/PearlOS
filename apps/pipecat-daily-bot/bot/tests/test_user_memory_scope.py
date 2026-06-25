"""Tests for tenant/user scoped file-backed Pearl memory."""

from __future__ import annotations

import json

from pearl import user_memory


def test_user_memory_uses_tenant_user_subfolder(tmp_path, monkeypatch):
    monkeypatch.setattr(user_memory, "_MEMORY_ROOT", tmp_path)

    scope = user_memory.scope_from_values(
        tenant_id="tenant-alpha",
        user_id="user-blair",
        user_email="blair@example.com",
    )

    assert scope is not None
    root = user_memory.ensure_user_documents(scope, user_name="Blair Erickson")

    assert root == tmp_path / "tenant-alpha" / "user-blair"
    assert user_memory.memory_path(scope) == root / "events.jsonl"
    assert (root / "USER.md").exists()
    assert "- Name: Blair Erickson" in (root / "USER.md").read_text(encoding="utf-8")

    entry = user_memory.append_memory(scope, "Blair prefers direct answers.", source="test")

    rows = [
        json.loads(line)
        for line in (root / "events.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert rows == [entry]
    assert rows[0]["tenantId"] == "tenant-alpha"
    assert rows[0]["userId"] == "user-blair"
    assert rows[0]["userEmail"] == "blair@example.com"


def test_user_memory_rejects_anonymous_scope():
    assert user_memory.scope_from_values(
        tenant_id="tenant-alpha",
        user_id="anonymous",
        user_email="anon@example.com",
    ) is None
