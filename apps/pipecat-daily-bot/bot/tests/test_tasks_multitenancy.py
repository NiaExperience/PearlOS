from __future__ import annotations

import os

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api import tasks_api


@pytest.fixture()
def tasks_client(tmp_path, monkeypatch):
    monkeypatch.setattr(tasks_api, "PUBLIC_TASK_ROOT", str(tmp_path / "workspaces"))
    monkeypatch.setattr(tasks_api, "WORKSPACE_ENTITLEMENTS_CONFIG_PATHS", (str(tmp_path / "workspace-entitlements.json"),))
    monkeypatch.delenv("PEARLOS_STAGING_SOURCE_EDITS_ENABLED", raising=False)
    store = tasks_api.TaskStore(str(tmp_path / "tasks.jsonl"))
    monkeypatch.setattr(tasks_api, "_store", store)

    app = FastAPI()
    app.include_router(tasks_api.router, prefix="/api/tasks")
    app.include_router(tasks_api.swarm_router, prefix="/api/swarm")
    with TestClient(app) as client:
        yield client, store


def _seed_two_users(store: tasks_api.TaskStore) -> tuple[dict, dict]:
    alice = store.create(
        task="Alice private task",
        title="Handle Alice task",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
    )
    bob = store.create(
        task="Bob private task",
        title="Handle Bob task",
        requester_email="bob@example.com",
        requester_user_id="bob-id",
        requester_tenant_id="tenant-b",
    )
    return alice, bob


def test_create_task_direct_honors_explicit_swarm_metadata(tasks_client):
    _client, _store = tasks_client

    task = tasks_api.create_task_direct(
        task="Dispatch an Agency swarm to build a website",
        source="voice",
        kind="swarm",
        agents=["Codex", "Claude CLI", "Kimi 2.6", "Gemini", "DeepSeek4Pro"],
        swarm_category="The Agency",
        execution_mode="full_build",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
    )

    assert task["kind"] == "swarm"
    assert task["agents"] == ["Codex", "Claude CLI", "Kimi 2.6", "Gemini", "DeepSeek4Pro"]
    assert task["swarm_category"] == "The Agency"
    assert task["execution_mode"] == "full_build"
    assert task["requester_email"] == "alice@example.com"
    assert task["requester_user_id"] == "alice-id"
    assert task["requester_tenant_id"] == "tenant-a"


def test_list_tasks_scopes_to_requester_identity(tasks_client):
    client, store = tasks_client
    alice, bob = _seed_two_users(store)

    response = client.get(
        "/api/tasks",
        params={
            "requester_user_id": "alice-id",
            "requester_email": "alice@example.com",
            "requester_tenant_id": "tenant-a",
        },
    )

    assert response.status_code == 200
    ids = {task["id"] for task in response.json()["tasks"]}
    assert alice["id"] in ids
    assert bob["id"] not in ids


def test_list_tasks_requires_tenant_when_requester_identity_is_present(tasks_client):
    client, store = tasks_client
    _seed_two_users(store)

    response = client.get(
        "/api/tasks",
        params={"requester_user_id": "alice-id", "requester_email": "alice@example.com"},
    )

    assert response.status_code == 200
    assert response.json()["tasks"] == []


def test_same_user_id_in_different_tenants_does_not_cross_scope(tasks_client):
    client, store = tasks_client
    tenant_a = store.create(
        task="Tenant A task",
        title="Tenant A task",
        requester_email="sam@example.com",
        requester_user_id="shared-user-id",
        requester_tenant_id="tenant-a",
    )
    tenant_b = store.create(
        task="Tenant B task",
        title="Tenant B task",
        requester_email="sam@example.com",
        requester_user_id="shared-user-id",
        requester_tenant_id="tenant-b",
    )

    response = client.get(
        "/api/tasks",
        params={
            "requester_user_id": "shared-user-id",
            "requester_email": "sam@example.com",
            "requester_tenant_id": "tenant-a",
        },
    )

    assert response.status_code == 200
    ids = {task["id"] for task in response.json()["tasks"]}
    assert ids == {tenant_a["id"]}
    assert tenant_b["id"] not in ids


@pytest.mark.parametrize(
    ("method", "path_suffix", "kwargs"),
    [
        ("get", "", {}),
        ("patch", "", {"json": {"status": "cancelled"}}),
        ("delete", "", {}),
        ("post", "/archive", {}),
        ("post", "/restore", {}),
    ],
)
def test_task_read_and_mutations_reject_other_requester(
    tasks_client, method: str, path_suffix: str, kwargs: dict
):
    client, store = tasks_client
    _, bob = _seed_two_users(store)
    store.update(bob["id"], {"status": "archived"})

    request = getattr(client, method)
    response = request(
        f"/api/tasks/{bob['id']}{path_suffix}",
        headers={
            "x-pearl-tenant-id": "tenant-a",
            "x-user-id": "alice-id",
            "x-user-email": "alice@example.com",
        },
        **kwargs,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "task_not_found"


def test_task_mutation_allows_owner_and_preserves_internal_worker_access(tasks_client):
    client, store = tasks_client
    alice, bob = _seed_two_users(store)

    owner_response = client.patch(
        f"/api/tasks/{alice['id']}",
        headers={
            "x-pearl-tenant-id": "tenant-a",
            "x-user-id": "alice-id",
            "x-user-email": "alice@example.com",
        },
        json={"urgency": "urgent"},
    )
    internal_response = client.patch(
        f"/api/tasks/{bob['id']}",
        json={"urgency": "urgent"},
    )

    assert owner_response.status_code == 200
    assert owner_response.json()["task"]["urgency"] == "urgent"
    assert internal_response.status_code == 200
    assert internal_response.json()["task"]["urgency"] == "urgent"


def test_task_update_persists_executor_status_for_public_progress(tasks_client):
    client, store = tasks_client
    alice, _ = _seed_two_users(store)

    response = client.patch(
        f"/api/tasks/{alice['id']}",
        json={
            "executor_requested": "codex",
            "executor_effective": "codex",
            "status": "in_progress",
        },
    )

    assert response.status_code == 200
    task = response.json()["task"]
    assert task["executor_requested"] == "codex"
    assert task["executor_effective"] == "codex"
    assert store.get(alice["id"])["executor_effective"] == "codex"


def test_stream_filter_helper_hides_other_requester_events():
    scope = {"user_id": "alice-id", "email": "alice@example.com", "tenant_id": "tenant-a"}
    alice_envelope = {
        "event": "updated",
        "task": {
            "id": "disp-alice",
            "requester_user_id": "alice-id",
            "requester_email": "alice@example.com",
            "requester_tenant_id": "tenant-a",
        },
    }
    bob_envelope = {
        "event": "updated",
        "task": {
            "id": "disp-bob",
            "requester_user_id": "bob-id",
            "requester_email": "bob@example.com",
            "requester_tenant_id": "tenant-b",
        },
    }

    assert tasks_api._envelope_visible_to_requester(alice_envelope, scope) is True
    assert tasks_api._envelope_visible_to_requester(bob_envelope, scope) is False


def test_create_accepts_requester_scoped_workspace_path(tasks_client, tmp_path):
    _client, store = tasks_client
    workspace = tmp_path / "workspaces" / "tenant-a" / "alice-id" / "creations" / "creation-1"

    task = store.create(
        task="Build a Studio app",
        title="Build Studio app",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
        workspace_path=str(workspace),
    )

    assert task["workspace_path"] == str(workspace)
    assert task["workspace_mode"] == "sandbox"
    assert workspace.is_dir()


def test_create_rejects_workspace_path_outside_requester_scope(tasks_client, tmp_path):
    _client, store = tasks_client
    bob_workspace = tmp_path / "workspaces" / "tenant-a" / "bob-id" / "creations" / "creation-1"

    with pytest.raises(ValueError, match="outside requester scope"):
        store.create(
            task="Build a Studio app",
            title="Build Studio app",
            requester_email="alice@example.com",
            requester_user_id="alice-id",
            requester_tenant_id="tenant-a",
            workspace_path=str(bob_workspace),
        )


def test_create_rejects_protected_staging_workspace_for_normal_user(tasks_client):
    _client, store = tasks_client

    with pytest.raises(ValueError, match="personal_instance_only"):
        store.create(
            task="Patch staging source",
            title="Patch staging source",
            requester_email="alice@example.com",
            requester_user_id="alice-id",
            requester_tenant_id="tenant-a",
            workspace_path="/workspace/nia-universal",
        )


def test_create_defaults_user_tasks_to_sandbox_workspace(tasks_client, tmp_path):
    _client, store = tasks_client

    task = store.create(
        task="Customize PearlOS safely",
        title="Customize PearlOS",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
    )

    assert task["workspace_mode"] == "sandbox"
    assert task["workspace_path"].startswith(str(tmp_path / "workspaces" / "tenant-a" / "alice-id"))
    assert "requester's PearlOS instance" in task["workspace_isolation_notice"]
    assert task["workspace_entitlement"]["can_use_staging_source_edits"] is False


def test_create_rejects_blair_staging_workspace_for_user_tasks(tasks_client, tmp_path, monkeypatch):
    _client, store = tasks_client
    source = tmp_path / "nia-universal"
    source.mkdir()
    monkeypatch.setattr(tasks_api, "STAGING_SOURCE_ROOT", str(source))
    monkeypatch.setenv("PEARLOS_BLAIR_EMAILS", "blair@example.com")

    with pytest.raises(ValueError, match="personal_instance_only"):
        store.create(
            task="Fix the Pulse app globe in PearlOS source",
            title="Fix Pulse",
            requester_email="blair@example.com",
            requester_user_id="blair-id",
            requester_tenant_id="tenant-a",
            workspace_mode="staging_source",
        )


def test_create_keeps_blair_pearlos_source_tasks_in_sandbox(tasks_client, tmp_path, monkeypatch):
    _client, store = tasks_client
    source = tmp_path / "nia-universal"
    source.mkdir()
    monkeypatch.setattr(tasks_api, "STAGING_SOURCE_ROOT", str(source))
    monkeypatch.setenv("PEARLOS_BLAIR_EMAILS", "blair@example.com")

    task = store.create(
        task="The Pulse app globe is broken; fix the PearlOS desktop app source",
        title="Fix Pulse Globe",
        requester_email="blair@example.com",
        requester_user_id="blair-id",
        requester_tenant_id="tenant-a",
    )

    assert task["workspace_mode"] == "sandbox"
    assert task["workspace_path"].startswith(str(tmp_path / "workspaces" / "tenant-a" / "blair-id"))


def test_create_routes_admin_github_fork_workspace(tasks_client, tmp_path):
    _client, store = tasks_client

    task = store.create(
        task="Implement in fork",
        title="Implement in fork",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
        requester_tenant_role="admin",
        workspace_mode="github_fork",
        github_fork_url="https://github.com/blair/pearlos-fork.git",
    )

    expected = tmp_path / "workspaces" / "tenant-a" / "alice-id" / "forks" / "blair_pearlos-fork"
    assert task["workspace_mode"] == "github_fork"
    assert task["workspace_path"] == str(expected)
    assert task["github_fork_url"] == "https://github.com/blair/pearlos-fork.git"
    assert expected.is_dir()


def test_swarm_start_applies_rate_limit_before_budget(tasks_client, monkeypatch):
    client, _store = tasks_client
    rate_calls: list[dict] = []
    budget_calls: list[dict] = []

    def fake_rate_limit(_request, **kwargs):
        rate_calls.append(kwargs)

    async def fake_budget(**kwargs):
        budget_calls.append(kwargs)

    monkeypatch.setattr(tasks_api, "apply_general_rate_limit", fake_rate_limit)
    monkeypatch.setattr(tasks_api, "reserve_tenant_budget_async", fake_budget)

    response = client.post(
        "/api/swarm/start",
        json={
            "task": "Create a small website",
            "title": "Create website",
            "agents": ["planner", "builder"],
            "requester_tenant_id": "tenant-a",
            "requester_user_id": "alice-id",
        },
    )

    assert response.status_code == 200
    assert rate_calls == [
        {
            "surface": "tasks:swarm",
            "tenant_id": "tenant-a",
            "user_id": "alice-id",
            "email": None,
        }
    ]
    assert budget_calls
    assert budget_calls[0]["tenant_id"] == "tenant-a"
    assert budget_calls[0]["surface"] == "swarm"


def test_swarm_start_rate_limit_blocks_before_budget(tasks_client, monkeypatch):
    client, store = tasks_client

    def fake_rate_limit(_request, **_kwargs):
        raise HTTPException(status_code=429, detail="rate_limited")

    async def fake_budget(**_kwargs):
        raise AssertionError("budget should not be reserved after rate limit failure")

    monkeypatch.setattr(tasks_api, "apply_general_rate_limit", fake_rate_limit)
    monkeypatch.setattr(tasks_api, "reserve_tenant_budget_async", fake_budget)

    response = client.post(
        "/api/swarm/start",
        json={
            "task": "Create a small website",
            "requester_tenant_id": "tenant-a",
            "requester_user_id": "alice-id",
        },
    )

    assert response.status_code == 429
    assert store.list(include_archived=True) == []


def test_swarm_report_create_applies_rate_limit_and_budget(tasks_client, monkeypatch):
    client, _store = tasks_client
    rate_calls: list[dict] = []
    budget_calls: list[dict] = []

    def fake_rate_limit(_request, **kwargs):
        rate_calls.append(kwargs)

    async def fake_budget(**kwargs):
        budget_calls.append(kwargs)

    monkeypatch.setattr(tasks_api, "apply_general_rate_limit", fake_rate_limit)
    monkeypatch.setattr(tasks_api, "reserve_tenant_budget_async", fake_budget)

    response = client.post(
        "/api/swarm/report",
        json={
            "task_id": "swarm-alice",
            "task": "Edit the accounting sandbox",
            "status": "in_progress",
            "requester_tenant_id": "tenant-a",
            "requester_user_id": "alice-id",
        },
    )

    assert response.status_code == 200
    assert response.json()["created"] is True
    assert rate_calls[0]["surface"] == "tasks:swarm"
    assert rate_calls[0]["tenant_id"] == "tenant-a"
    assert budget_calls[0]["surface"] == "swarm"


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (
            "/api/swarm/update",
            {
                "task_id": "swarm-bob",
                "agent_activity": {"planner": {"status": "running"}},
            },
        ),
        (
            "/api/swarm/complete",
            {
                "task_id": "swarm-bob",
                "status": "completed",
                "result": "done",
            },
        ),
        (
            "/api/swarm/report",
            {
                "task_id": "swarm-bob",
                "status": "completed",
                "partial_results": "done",
            },
        ),
    ],
)
def test_swarm_mutations_reject_other_requester(tasks_client, path: str, body: dict):
    client, store = tasks_client
    store.create(
        task="Bob private swarm",
        title="Handle Bob swarm",
        kind="swarm",
        requester_email="bob@example.com",
        requester_user_id="bob-id",
        requester_tenant_id="tenant-b",
        task_id="swarm-bob",
        status="in_progress",
    )

    response = client.post(
        path,
        headers={
            "x-pearl-tenant-id": "tenant-a",
            "x-user-id": "alice-id",
            "x-user-email": "alice@example.com",
        },
        json=body,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "task_not_found"
    assert store.get("swarm-bob")["status"] == "in_progress"


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (
            "/api/swarm/update",
            {
                "task_id": "swarm-bob",
                "agent_activity": {"planner": {"status": "running"}},
            },
        ),
        (
            "/api/swarm/complete",
            {
                "task_id": "swarm-bob",
                "status": "completed",
                "result": "done",
            },
        ),
        (
            "/api/swarm/report",
            {
                "task_id": "swarm-bob",
                "status": "completed",
                "partial_results": "done",
            },
        ),
    ],
)
def test_swarm_mutation_headers_override_forged_body_scope(
    tasks_client,
    path: str,
    body: dict,
):
    client, store = tasks_client
    store.create(
        task="Bob private swarm",
        title="Handle Bob swarm",
        kind="swarm",
        requester_email="bob@example.com",
        requester_user_id="bob-id",
        requester_tenant_id="tenant-b",
        task_id="swarm-bob",
        status="in_progress",
    )
    forged_body = {
        **body,
        "requester_tenant_id": "tenant-b",
        "requester_user_id": "bob-id",
        "requester_email": "bob@example.com",
    }

    response = client.post(
        path,
        headers={
            "x-pearl-tenant-id": "tenant-a",
            "x-user-id": "alice-id",
            "x-user-email": "alice@example.com",
        },
        json=forged_body,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "task_not_found"
    assert store.get("swarm-bob")["status"] == "in_progress"


def test_swarm_status_and_list_scope_to_requester(tasks_client):
    client, store = tasks_client
    alice = store.create(
        task="Alice private swarm",
        title="Handle Alice swarm",
        kind="swarm",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
        task_id="swarm-alice",
        status="in_progress",
    )
    bob = store.create(
        task="Bob private swarm",
        title="Handle Bob swarm",
        kind="swarm",
        requester_email="bob@example.com",
        requester_user_id="bob-id",
        requester_tenant_id="tenant-b",
        task_id="swarm-bob",
        status="in_progress",
    )

    headers = {
        "x-pearl-tenant-id": "tenant-a",
        "x-user-id": "alice-id",
        "x-user-email": "alice@example.com",
    }
    status_response = client.get(f"/api/swarm/status/{bob['id']}", headers=headers)
    list_response = client.get("/api/swarm/list", headers=headers)

    assert status_response.status_code == 404
    assert list_response.status_code == 200
    ids = {task["id"] for task in list_response.json()["tasks"]}
    assert ids == {alice["id"]}


def test_swarm_status_and_list_accept_query_scope(tasks_client):
    client, store = tasks_client
    alice = store.create(
        task="Alice private swarm",
        title="Handle Alice swarm",
        kind="swarm",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
        task_id="swarm-alice",
        status="in_progress",
    )
    store.create(
        task="Bob private swarm",
        title="Handle Bob swarm",
        kind="swarm",
        requester_email="bob@example.com",
        requester_user_id="bob-id",
        requester_tenant_id="tenant-b",
        task_id="swarm-bob",
        status="in_progress",
    )
    query = {
        "requester_tenant_id": "tenant-a",
        "requester_user_id": "alice-id",
        "requester_email": "alice@example.com",
    }

    status_response = client.get(f"/api/swarm/status/{alice['id']}", params=query)
    list_response = client.get("/api/swarm/list", params=query)

    assert status_response.status_code == 200
    assert status_response.json()["task"]["id"] == alice["id"]
    assert list_response.status_code == 200
    ids = {task["id"] for task in list_response.json()["tasks"]}
    assert ids == {alice["id"]}


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (
            "/api/swarm/update",
            {
                "task_id": "task-alice",
                "agent_activity": {"planner": {"status": "running"}},
            },
        ),
        (
            "/api/swarm/complete",
            {
                "task_id": "task-alice",
                "status": "completed",
                "result": "done",
            },
        ),
        (
            "/api/swarm/report",
            {
                "task_id": "task-alice",
                "status": "completed",
                "partial_results": "done",
            },
        ),
    ],
)
def test_swarm_mutations_reject_non_swarm_task(tasks_client, path: str, body: dict):
    client, store = tasks_client
    task = store.create(
        task="Alice normal task",
        title="Handle Alice task",
        kind="task",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
        task_id="task-alice",
        status="in_progress",
    )

    response = client.post(
        path,
        headers={
            "x-pearl-tenant-id": "tenant-a",
            "x-user-id": "alice-id",
            "x-user-email": "alice@example.com",
        },
        json=body,
    )

    assert response.status_code == 404
    assert store.get(task["id"])["status"] == "in_progress"


def test_swarm_report_existing_update_does_not_reserve_budget(tasks_client, monkeypatch):
    client, store = tasks_client
    store.create(
        task="Alice private swarm",
        title="Handle Alice swarm",
        kind="swarm",
        requester_email="alice@example.com",
        requester_user_id="alice-id",
        requester_tenant_id="tenant-a",
        task_id="swarm-alice",
        status="in_progress",
    )

    def fake_rate_limit(_request, **_kwargs):
        raise AssertionError("existing swarm report update should not rate-limit create budget")

    async def fake_budget(**_kwargs):
        raise AssertionError("existing swarm report update should not reserve budget")

    monkeypatch.setattr(tasks_api, "apply_general_rate_limit", fake_rate_limit)
    monkeypatch.setattr(tasks_api, "reserve_tenant_budget_async", fake_budget)

    response = client.post(
        "/api/swarm/report",
        json={
            "task_id": "swarm-alice",
            "status": "completed",
            "partial_results": "done",
            "requester_tenant_id": "tenant-a",
            "requester_user_id": "alice-id",
            "requester_email": "alice@example.com",
        },
    )

    assert response.status_code == 200
    assert response.json()["created"] is False
    assert store.get("swarm-alice")["status"] == "completed"


def test_swarm_get_headers_override_forged_query_scope(tasks_client):
    client, store = tasks_client
    store.create(
        task="Bob private swarm",
        title="Handle Bob swarm",
        kind="swarm",
        requester_email="bob@example.com",
        requester_user_id="bob-id",
        requester_tenant_id="tenant-b",
        task_id="swarm-bob",
        status="in_progress",
    )
    headers = {
        "x-pearl-tenant-id": "tenant-a",
        "x-user-id": "alice-id",
        "x-user-email": "alice@example.com",
    }
    forged_query = {
        "requester_tenant_id": "tenant-b",
        "requester_user_id": "bob-id",
        "requester_email": "bob@example.com",
    }

    status_response = client.get(
        "/api/swarm/status/swarm-bob",
        headers=headers,
        params=forged_query,
    )
    list_response = client.get(
        "/api/swarm/list",
        headers=headers,
        params=forged_query,
    )

    assert status_response.status_code == 404
    assert list_response.status_code == 200
    assert list_response.json()["tasks"] == []
