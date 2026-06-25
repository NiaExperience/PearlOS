from pathlib import Path

import pytest

from tools.notes import file_ops


def test_file_note_create_uses_tenant_and_user_documents(tmp_path, monkeypatch):
    monkeypatch.setattr(file_ops, "USER_ROOT", tmp_path)

    note = file_ops.create_note(
        "Voice Saved Note",
        "visible in Notes",
        tenant_id="tenant-a",
        user_id="user-a",
    )

    note_path = Path(note["filePath"])
    assert note_path == tmp_path / "tenant-a" / "user-a" / "Documents" / "Voice-Saved-Note.md"
    assert note_path.exists()
    assert not (tmp_path / "user-a" / "Documents" / "Voice-Saved-Note.md").exists()


def test_file_note_get_can_read_legacy_user_only_location(tmp_path, monkeypatch):
    monkeypatch.setattr(file_ops, "USER_ROOT", tmp_path)
    legacy_path = tmp_path / "user-a" / "Documents" / "Legacy.md"
    legacy_path.parent.mkdir(parents=True)
    legacy_path.write_text("# Legacy\n\nold path", encoding="utf-8")

    note = file_ops.get_note("Legacy", tenant_id="tenant-a", user_id="user-a")

    assert note is not None
    assert note["title"] == "Legacy"
    assert note["content"].endswith("old path")


def test_file_note_create_requires_tenant(tmp_path, monkeypatch):
    monkeypatch.setattr(file_ops, "USER_ROOT", tmp_path)

    with pytest.raises(ValueError, match="tenant_id"):
        file_ops.create_note("No Tenant", "hidden", user_id="user-a")
