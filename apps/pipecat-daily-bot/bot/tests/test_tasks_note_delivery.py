from __future__ import annotations

from api import tasks_api


def _documents_dir(tmp_path, tenant_id="tenant-a", user_id="alice-id"):
    return tmp_path / "users" / tenant_id / user_id / "Documents"


def _note_store(tmp_path, monkeypatch) -> tasks_api.TaskStore:
    monkeypatch.setattr(tasks_api, "USER_ROOT", str(tmp_path / "users"))
    monkeypatch.setattr(tasks_api, "PUBLIC_TASK_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.setattr(
        tasks_api,
        "WORKSPACE_ENTITLEMENTS_CONFIG_PATHS",
        (str(tmp_path / "workspace-entitlements.json"),),
    )
    return tasks_api.TaskStore(str(tmp_path / "tasks.jsonl"))


def test_completed_result_delivers_note_to_requester_documents(tmp_path, monkeypatch):
    store = _note_store(tmp_path, monkeypatch)
    task = store.create(
        task="Summarize the team speech transcript.",
        title="Team Meeting Summary",
        requester_user_id="alice-id",
        requester_email="alice@example.com",
        requester_tenant_id="tenant-a",
    )

    updated = store.update(
        task["id"],
        {
            "status": "completed",
            "result": (
                "Completed summary with action items. "
                "[team-meeting-summary.html](/srv/pearl-user-workspaces/tenant/alice/disp-deadbeef99/team-meeting-summary.html)"
            ),
        },
    )

    filename = updated["note_filename"]
    assert filename
    assert task["id"] not in filename
    note_path = _documents_dir(tmp_path) / f"{filename}.md"
    content = note_path.read_text(encoding="utf-8")
    assert content == (
        "# Team Meeting Summary\n\nCompleted summary with action items. team-meeting-summary.html\n"
    )
    assert "/srv/pearl-user-workspaces" not in content
    assert "disp-deadbeef99" not in content


def test_completed_note_delivery_reuses_existing_file_without_overwrite(tmp_path, monkeypatch):
    store = _note_store(tmp_path, monkeypatch)
    task = store.create(
        task="Summarize the team speech transcript.",
        title="Team Meeting Summary",
        requester_user_id="alice-id",
        requester_email="alice@example.com",
        requester_tenant_id="tenant-a",
    )
    first = store.update(task["id"], {"status": "completed", "result": "Original summary."})
    note_path = _documents_dir(tmp_path) / f"{first['note_filename']}.md"
    note_path.write_text("User edited this note.\n", encoding="utf-8")

    second = store.update(task["id"], {"status": "completed", "result": "Updated summary."})

    assert second["note_filename"] == first["note_filename"]
    assert note_path.read_text(encoding="utf-8") == "User edited this note.\n"


def test_requester_identity_requires_tenant_scope(tmp_path, monkeypatch):
    store = _note_store(tmp_path, monkeypatch)

    try:
        store.create(
            task="Summarize the team speech transcript.",
            requester_user_id="alice-id",
            requester_email="alice@example.com",
        )
    except ValueError as exc:
        assert str(exc) == "requester_tenant_id_required"
    else:
        raise AssertionError("expected missing requester tenant to be rejected")


def test_pending_task_claim_is_atomic(tmp_path, monkeypatch):
    store = _note_store(tmp_path, monkeypatch)
    task = store.create(
        task="Summarize the team speech transcript.",
        requester_user_id="alice-id",
        requester_email="alice@example.com",
        requester_tenant_id="tenant-a",
    )

    claimed = store.update(
        task["id"],
        {
            "expected_status": "pending",
            "claim_worker": "worker-a",
            "status": "in_progress",
        },
    )

    assert claimed["status"] == "in_progress"
    assert claimed["claimed_by"] == "worker-a"
    assert claimed["claim_started_at"]
    try:
        store.update(
            task["id"],
            {
                "expected_status": "pending",
                "claim_worker": "worker-b",
                "status": "in_progress",
            },
        )
    except ValueError as exc:
        assert str(exc).startswith("status_conflict:")
    else:
        raise AssertionError("expected second worker claim to conflict")


def test_get_backfills_legacy_completed_task_without_note(tmp_path, monkeypatch):
    store = _note_store(tmp_path, monkeypatch)
    task = store.create(
        task="Summarize the team speech transcript.",
        title="Legacy Team Summary",
        requester_user_id="alice-id",
        requester_email="alice@example.com",
        requester_tenant_id="tenant-a",
    )
    with store._lock:
        store._index[task["id"]].update(
            {
                "status": "completed",
                "result": "Legacy summary that predates note delivery.",
                "note_filename": None,
                "file_space_path": None,
            }
        )

    recovered = store.get(task["id"])

    assert recovered["note_filename"]
    note_path = _documents_dir(tmp_path) / f"{recovered['note_filename']}.md"
    assert note_path.exists()
    assert "Legacy summary that predates note delivery." in note_path.read_text(encoding="utf-8")
