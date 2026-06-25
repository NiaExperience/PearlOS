from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
WORKER_PATH = ROOT / "scripts" / "pearl-worker.py"
spec = importlib.util.spec_from_file_location("pearl_worker", WORKER_PATH)
pearl_worker = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(pearl_worker)


def _task(**overrides):
    task = {
        "id": "task-1",
        "requester_tenant_id": "tenant-a",
        "requester_user_id": "alice-id",
        "requester_email": "alice@example.com",
        "workspace_mode": "sandbox",
    }
    task.update(overrides)
    return task


def test_worker_routes_normal_user_to_sandbox_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(pearl_worker, "PUBLIC_TASK_ROOT", str(tmp_path / "workspaces"))
    workspace = tmp_path / "workspaces" / "tenant-a" / "alice-id" / "task-1"
    task = _task(workspace_path=str(workspace))

    assert pearl_worker._is_public_workspace_task(task) is True
    assert pearl_worker._task_workspace(task) == str(workspace)
    assert workspace.is_dir()
    assert "inside the allowed workspace" in pearl_worker._public_workspace_guard(task)


def test_worker_rejects_blair_staging_source_user_tasks(tmp_path, monkeypatch):
    source = tmp_path / "nia-universal"
    source.mkdir()
    monkeypatch.setattr(pearl_worker, "STAGING_SOURCE_ROOT", str(source))
    monkeypatch.delenv("PEARLOS_STAGING_SOURCE_EDITS_ENABLED", raising=False)
    monkeypatch.setenv("PEARLOS_BLAIR_EMAILS", "blair@example.com")
    task = _task(
        workspace_mode="staging_source",
        workspace_path=str(source),
        staging_source_edits_enabled=False,
        requester_email="blair@example.com",
    )

    assert pearl_worker._is_public_workspace_task(task) is False
    with pytest.raises(ValueError, match="personal_instance_only"):
        pearl_worker._task_workspace(task)


def test_worker_rejects_staging_source_for_normal_user(tmp_path, monkeypatch):
    source = tmp_path / "nia-universal"
    apps_dir = source / "apps"
    apps_dir.mkdir(parents=True)
    monkeypatch.setattr(pearl_worker, "STAGING_SOURCE_ROOT", str(source))
    monkeypatch.setenv("PEARLOS_STAGING_SOURCE_EDITS_ENABLED", "1")
    monkeypatch.setenv("PEARLOS_BLAIR_EMAILS", "blair@example.com")
    task = _task(
        workspace_mode="staging_source",
        workspace_path=str(apps_dir),
        staging_source_edits_enabled=True,
        requester_email="alice@example.com",
    )

    assert pearl_worker._is_public_workspace_task(task) is False
    with pytest.raises(ValueError, match="personal_instance_only"):
        pearl_worker._task_workspace(task)


def test_worker_routes_advanced_user_to_fork_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(pearl_worker, "PUBLIC_TASK_ROOT", str(tmp_path / "workspaces"))
    workspace = tmp_path / "workspaces" / "tenant-a" / "alice-id" / "forks" / "blair_pearlos-fork"
    task = _task(
        workspace_mode="github_fork",
        workspace_path=str(workspace),
        github_fork_url="https://github.com/blair/pearlos-fork.git",
    )

    assert pearl_worker._is_public_workspace_task(task) is True
    assert pearl_worker._task_workspace(task) == str(workspace)
    assert workspace.is_dir()


def test_worker_rejects_requester_workspace_outside_scope_even_without_mode(tmp_path, monkeypatch):
    monkeypatch.setattr(pearl_worker, "PUBLIC_TASK_ROOT", str(tmp_path / "workspaces"))
    bob_workspace = tmp_path / "workspaces" / "tenant-a" / "bob-id" / "task-1"
    task = _task(workspace_mode="", workspace_path=str(bob_workspace))

    assert pearl_worker._is_public_workspace_task(task) is True
    with pytest.raises(ValueError, match="outside requester scope"):
        pearl_worker._task_workspace(task)


def test_worker_reconciles_clean_exit_when_ui_left_task_pending():
    task = _task(status="pending", assignee="claude_cli")

    assert pearl_worker._should_reconcile_clean_exit(task, "claude_cli") is True


def test_worker_does_not_reconcile_clean_exit_after_user_parks_task():
    task = _task(status="pending", assignee="pearl")

    assert pearl_worker._should_reconcile_clean_exit(task, "claude_cli") is False


def test_office_visible_agents_show_pearl_for_generic_worker_task():
    task = _task(agents=["Pearl agent"])

    assert pearl_worker._office_visible_agents(task) == ["Pearl"]


def test_office_visible_agents_keep_named_studio_agents():
    task = _task(agents=["Pearl agent", "Codex", "Opus"])

    assert pearl_worker._office_visible_agents(task) == ["Codex", "Opus"]


def test_successful_sandbox_deliverable_is_not_treated_as_blocked():
    result = (
        "Built the interactive overview as `index.html` in the sandbox workspace.\n\n"
        "Verification run: checked the embedded JavaScript. "
        "No PearlOS source, deploy, runtime, or production files were touched."
    )

    assert pearl_worker._looks_like_blocked_result(result) is False


def test_public_discord_content_normalizes_style_dashes():
    clean = pearl_worker._public_discord_content(
        "One model writes — another checks — and 1–3 reviewers catch errors."
    )

    assert clean == "One model writes, another checks, and 1-3 reviewers catch errors."


def test_worker_direct_discord_send_disabled_for_requester_tasks(monkeypatch):
    monkeypatch.setenv("PEARL_ENABLE_WORKER_DIRECT_DISCORD_SEND", "true")
    task = _task(
        title='send "hello" to Discord channel 1494906069149941921',
        task='send "hello" to Discord channel 1494906069149941921',
    )

    assert pearl_worker._extract_simple_discord_send(task) is None


def test_worker_ignores_free_text_discord_channels_for_web_tasks():
    task = _task(
        source="web_chat",
        task="Build the demo. Discord source channel 1494906069149941921",
    )

    assert pearl_worker._task_source_discord_channel(task) == ""


def test_fallback_commentary_is_contextual_not_canned():
    task = _task(
        title="Standup connector audit",
        task=(
            "Audit Discord, GoogleChat, text/SMS, Slack, and the multimodal image sharing issue. "
            "Post the report in Notes and bring the direct link back to blair-lagoon."
        ),
    )

    messages = [
        pearl_worker._fallback_commentary(task, "claimed", 0),
        pearl_worker._fallback_commentary(task, "running", 180),
        pearl_worker._fallback_commentary(task, "wrapping_up", 240),
    ]

    assert any("channel audit" in message or "multimodal" in message for message in messages)
    for message in messages:
        assert "Still working on it" not in message
        assert "Still working on " not in message
        assert "Working through" not in message
        assert "only post again" not in message


def test_task_completion_notice_adds_production_notes_deep_link(monkeypatch):
    monkeypatch.delenv("PEARLOS_PUBLIC_APP_URL", raising=False)
    monkeypatch.delenv("PEARLOS_USER_FACING_APP_URL", raising=False)
    task = _task(
        source="discord",
        note_filename="Standup-Connector-Audit-2026-06-16.md",
    )

    message = pearl_worker._task_completion_notice(task, "Standup audit", "Saved the report in Notes.")

    assert "https://app.pearlos.org/pearlos?desktopMode=work&openApp=notes&noteId=Standup-Connector-Audit-2026-06-16" in message
    assert "134-209-76-227.sslip.io" not in message


def test_task_completion_notice_respects_explicit_public_app_origin(monkeypatch):
    monkeypatch.setenv("PEARLOS_PUBLIC_APP_URL", "https://app.pearlos.org")
    task = _task(note_filename="My Note.md")

    message = pearl_worker._task_completion_notice(task, "Report", "")

    assert "https://app.pearlos.org/pearlos?desktopMode=work&openApp=notes&noteId=My+Note" in message


def test_actual_workspace_isolation_blocker_is_treated_as_blocked():
    result = "I could not continue because workspace isolation active and no recoverable content was available."

    assert pearl_worker._looks_like_blocked_result(result) is True


def test_report_saved_but_not_delivered_to_notes_is_treated_as_blocked():
    result = (
        "I completed the standup audit and saved the report at "
        "`docs/qa/standup-connector-audit-2026-06-16.md`.\n\n"
        "I could not post it into Notes or Discord from this sandbox because "
        "`/workspace/user` is mounted read-only and local/Discord network calls are blocked. "
        "The next recovery step is to copy that report into Blair's scoped Notes folder."
    )

    assert pearl_worker._looks_like_blocked_result(result) is True


def test_sandbox_patch_that_cannot_apply_is_treated_as_blocked():
    result = (
        "Created a sandboxed patch for the protected source file, but did not apply or deploy it "
        "because protected PearlOS source edits are disabled."
    )

    assert pearl_worker._looks_like_blocked_result(result) is True


def test_plain_executor_error_distinguishes_sandbox_from_auth():
    snippet, next_step = pearl_worker._plain_executor_error(
        "bwrap: Creating new namespace failed: Operation not permitted",
        "Codex",
    )

    assert "sandbox" in snippet
    assert "smoke test" in next_step
    assert "signed out" not in snippet


def test_public_task_failure_result_is_conversational():
    task = _task(title="Golden Horizon game")
    message = pearl_worker._public_task_failure_result(
        task,
        boss_name="Codex",
        err_msg="bwrap: Operation not permitted\n/workspace/nia-universal/apps/interface/file.ts",
        rc=1,
        timed_out=False,
    )

    assert "I couldn't finish Golden Horizon game" in message
    assert "worker sandbox" in message
    assert "/workspace/nia-universal" not in message
    assert "bwrap:" not in message
