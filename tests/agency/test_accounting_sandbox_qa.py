from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "agency_accounting_sandbox_qa.py"
spec = importlib.util.spec_from_file_location("agency_accounting_sandbox_qa", MODULE_PATH)
assert spec and spec.loader
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


def test_reclassification_is_tenant_scoped_and_audited(tmp_path):
    workspace = qa.qa_workspace(str(tmp_path), "Tenant A", "User One", "case-1")
    db_path = qa.init_ledger(workspace, "tenant-a")

    edit = qa.apply_reclassification(workspace, "tenant-a", "user-one")
    index_path = qa.write_artifacts(workspace, edit)

    after = qa.read_entry(db_path, "tenant-a")
    assert after["account_id"] == "software_subscriptions"
    assert edit["before"]["account_id"] == "office_supplies"
    assert edit["after"]["account_id"] == "software_subscriptions"
    assert (workspace / "audit.json").is_file()
    assert index_path == workspace / "index.html"
    assert "Accounting Sandbox QA Audit" in index_path.read_text(encoding="utf-8")


def test_path_guard_rejects_database_outside_workspace(tmp_path):
    workspace = tmp_path / "allowed"
    workspace.mkdir()
    outside = tmp_path / "outside.sqlite"
    outside.write_text("", encoding="utf-8")

    with pytest.raises(ValueError, match="outside accounting QA workspace"):
        qa.ensure_under_workspace(outside, workspace)


def test_payload_uses_explicit_requester_scope_and_swarm_models(tmp_path):
    workspace = qa.qa_workspace(str(tmp_path), "tenant-a", "user-1", "case-2")
    payload = qa.task_payload(
        prompt="sandbox task",
        workspace=workspace,
        tenant_id="tenant-a",
        user_id="user-1",
        user_email="user@example.invalid",
        agents=list(qa.DEFAULT_AGENTS),
    )

    assert payload["requester_tenant_id"] == "tenant-a"
    assert payload["requester_user_id"] == "user-1"
    assert payload["workspace_path"] == str(workspace)
    assert payload["kind"] == "swarm"
    assert "moonshotai/kimi-k2.6" in payload["agents"]
    assert "google/gemini-3-pro-preview" in payload["agents"]


def test_payload_can_avoid_worker_claims_for_simulated_completion(tmp_path):
    workspace = qa.qa_workspace(str(tmp_path), "tenant-a", "user-1", "case-4")
    payload = qa.task_payload(
        prompt="sandbox task",
        workspace=workspace,
        tenant_id="tenant-a",
        user_id="user-1",
        user_email="user@example.invalid",
        agents=list(qa.DEFAULT_AGENTS),
        assignee="pearl",
    )

    assert payload["assignee"] == "pearl"


def test_completion_result_mentions_workspace_index_for_webhook_artifact(tmp_path):
    workspace = qa.qa_workspace(str(tmp_path), "tenant-a", "user-1", "case-3")
    result = qa.completion_result(workspace)

    assert f"{workspace}/index.html" in result
