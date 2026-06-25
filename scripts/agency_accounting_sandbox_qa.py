#!/usr/bin/env python3
"""Agency accounting sandbox QA harness.

This creates a fake, tenant-scoped accounting database under
PEARL_PUBLIC_TASK_ROOT, registers an Agency swarm task against that workspace,
and can deterministically complete the task with an audit artifact. It is
intentionally not a production accounting connector.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_PUBLIC_TASK_ROOT = "/srv/pearl-user-workspaces"
DEFAULT_AGENTS = (
    "Claude",
    "moonshotai/kimi-k2.6",
    "google/gemini-3.1-pro-preview",
)


def safe_component(value: str | None, fallback: str) -> str:
    raw = str(value or "").strip().lower()
    safe = "".join(ch if ch.isalnum() or ch in "._@+-" else "_" for ch in raw)
    safe = safe.strip("._-")
    return (safe or fallback)[:160]


def ensure_under_workspace(path: Path, workspace: Path) -> Path:
    base = workspace.resolve()
    target = path.resolve()
    if target != base and not str(target).startswith(str(base) + os.sep):
        raise ValueError(f"refusing path outside accounting QA workspace: {target}")
    return target


def qa_workspace(public_root: str, tenant_id: str, user_id: str, label: str | None = None) -> Path:
    root = Path(public_root).resolve()
    slug = safe_component(label or f"qa-{int(time.time())}", "qa")
    workspace = (
        root
        / safe_component(tenant_id, "tenant")
        / safe_component(user_id, "user")
        / "accounting-qa"
        / slug
    ).resolve()
    if not str(workspace).startswith(str(root) + os.sep):
        raise ValueError("refusing accounting QA workspace outside public task root")
    return workspace


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def init_ledger(workspace: Path, tenant_id: str) -> Path:
    workspace.mkdir(parents=True, exist_ok=True)
    db_path = ensure_under_workspace(workspace / "accounting.sqlite", workspace)
    with _connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
              tenant_id TEXT NOT NULL,
              id TEXT NOT NULL,
              name TEXT NOT NULL,
              normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
              PRIMARY KEY (tenant_id, id)
            );
            CREATE TABLE IF NOT EXISTS ledger_entries (
              tenant_id TEXT NOT NULL,
              id TEXT NOT NULL,
              vendor TEXT NOT NULL,
              memo TEXT NOT NULL,
              amount_cents INTEGER NOT NULL,
              account_id TEXT NOT NULL,
              approval_status TEXT NOT NULL,
              PRIMARY KEY (tenant_id, id),
              FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id)
            );
            CREATE TABLE IF NOT EXISTS audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tenant_id TEXT NOT NULL,
              actor_user_id TEXT NOT NULL,
              action TEXT NOT NULL,
              before_json TEXT NOT NULL,
              after_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            """
        )
        conn.executemany(
            """
            INSERT OR IGNORE INTO accounts (tenant_id, id, name, normal_balance)
            VALUES (?, ?, ?, ?)
            """,
            [
                (tenant_id, "office_supplies", "Office Supplies", "debit"),
                (tenant_id, "software_subscriptions", "Software Subscriptions", "debit"),
            ],
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO ledger_entries (
              tenant_id, id, vendor, memo, amount_cents, account_id, approval_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tenant_id,
                "invoice-001",
                "Northstar SaaS",
                "Annual workspace subscription renewal",
                129900,
                "office_supplies",
                "approved_for_sandbox_qa",
            ),
        )
    return db_path


def _row_dict(row: sqlite3.Row | None) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def read_entry(db_path: Path, tenant_id: str, entry_id: str = "invoice-001") -> dict[str, Any]:
    with _connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT tenant_id, id, vendor, memo, amount_cents, account_id, approval_status
            FROM ledger_entries
            WHERE tenant_id = ? AND id = ?
            """,
            (tenant_id, entry_id),
        ).fetchone()
    return _row_dict(row)


def apply_reclassification(workspace: Path, tenant_id: str, user_id: str) -> dict[str, Any]:
    db_path = ensure_under_workspace(workspace / "accounting.sqlite", workspace)
    before = read_entry(db_path, tenant_id)
    if not before:
        raise ValueError("sandbox ledger entry not found")
    if before.get("account_id") != "office_supplies":
        raise ValueError("sandbox ledger is not in the expected starting state")

    with _connect(db_path) as conn:
        conn.execute(
            """
            UPDATE ledger_entries
            SET account_id = ?
            WHERE tenant_id = ? AND id = ?
            """,
            ("software_subscriptions", tenant_id, "invoice-001"),
        )
        after_row = conn.execute(
            """
            SELECT tenant_id, id, vendor, memo, amount_cents, account_id, approval_status
            FROM ledger_entries
            WHERE tenant_id = ? AND id = ?
            """,
            (tenant_id, "invoice-001"),
        ).fetchone()
        after = _row_dict(after_row)
        conn.execute(
            """
            INSERT INTO audit_events (
              tenant_id, actor_user_id, action, before_json, after_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                tenant_id,
                user_id,
                "reclassify_invoice_account",
                json.dumps(before, sort_keys=True),
                json.dumps(after, sort_keys=True),
                time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            ),
        )
    return {"before": before, "after": after}


def write_artifacts(workspace: Path, edit: dict[str, Any]) -> Path:
    ensure_under_workspace(workspace / "audit.json", workspace).write_text(
        json.dumps(edit, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    before = edit["before"]
    after = edit["after"]
    amount = int(after["amount_cents"]) / 100
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accounting Sandbox QA Audit</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #172033; }}
    main {{ max-width: 760px; }}
    table {{ border-collapse: collapse; width: 100%; margin-top: 1rem; }}
    th, td {{ border: 1px solid #cfd7e6; padding: 0.65rem; text-align: left; }}
    th {{ background: #eef3fb; }}
    code {{ background: #eef3fb; padding: 0.1rem 0.25rem; border-radius: 4px; }}
  </style>
</head>
<body>
  <main>
    <h1>Accounting Sandbox QA Audit</h1>
    <p>This artifact is generated from a fake tenant-scoped ledger. No customer
    finance data or production accounting connector is involved.</p>
    <table>
      <tr><th>Vendor</th><td>{after["vendor"]}</td></tr>
      <tr><th>Memo</th><td>{after["memo"]}</td></tr>
      <tr><th>Amount</th><td>${amount:,.2f}</td></tr>
      <tr><th>Before account</th><td><code>{before["account_id"]}</code></td></tr>
      <tr><th>After account</th><td><code>{after["account_id"]}</code></td></tr>
      <tr><th>Approval</th><td>{after["approval_status"]}</td></tr>
    </table>
  </main>
</body>
</html>
"""
    index_path = ensure_under_workspace(workspace / "index.html", workspace)
    index_path.write_text(html, encoding="utf-8")
    return index_path


def build_task_prompt(workspace: Path, db_path: Path) -> str:
    return f"""Run the Agency accounting database QA sandbox.

Allowed workspace:
{workspace}

Sandbox database:
{db_path}

Task:
Reclassify sandbox ledger entry invoice-001 from office_supplies to
software_subscriptions, write an audit.json before/after record, and write a
human-readable index.html audit artifact in the allowed workspace.

Hard rules:
- This is fake QA data only. Do not touch real accounting, customer, OAuth,
  production, source, deploy, or OpenClaw files.
- Do not read or write any database outside the allowed workspace.
- Preserve tenant scope in every ledger query.
- On success, complete the task with a result mentioning {workspace}/index.html.
"""


def task_payload(
    *,
    prompt: str,
    workspace: Path,
    tenant_id: str,
    user_id: str,
    user_email: str,
    agents: list[str],
    assignee: str = "claude_cli",
) -> dict[str, Any]:
    return {
        "task": prompt,
        "title": "QA accounting sandbox edit",
        "source": "manual",
        "created_by": "pearl",
        "assignee": assignee,
        "urgency": "normal",
        "requester_tenant_id": tenant_id,
        "requester_user_id": user_id,
        "requester_email": user_email or None,
        "workspace_path": str(workspace),
        "kind": "swarm",
        "agents": agents,
        "swarm_category": "Finance/accounting",
        "max_retries": 0,
        "timeout_s": 300,
        "execution_mode": "full_build",
    }


def completion_result(workspace: Path) -> str:
    return (
        "Accounting sandbox edit complete. The before/after audit and review "
        f"artifact are at {workspace}/index.html."
    )


def load_secret() -> str:
    return os.getenv("BOT_CONTROL_SHARED_SECRET", "").strip() or os.getenv(
        "PEARL_TASKS_BOT_SECRET", ""
    ).strip()


def api_headers() -> dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    secret = load_secret()
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
        headers["X-Bot-Secret"] = secret
    return headers


def post_json(url: str, body: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(body).encode("utf-8"),
        headers=api_headers(),
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def patch_json(url: str, body: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        method="PATCH",
        data=json.dumps(body).encode("utf-8"),
        headers=api_headers(),
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def parse_agents(value: str) -> list[str]:
    agents = [part.strip() for part in re.split(r"[,;]", value) if part.strip()]
    return agents or list(DEFAULT_AGENTS)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=os.getenv("PEARL_TASKS_API", "http://127.0.0.1:4444/api/tasks"))
    parser.add_argument("--public-task-root", default=os.getenv("PEARL_PUBLIC_TASK_ROOT", DEFAULT_PUBLIC_TASK_ROOT))
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--user-email", default="")
    parser.add_argument("--label", default="")
    parser.add_argument("--agents", default=",".join(DEFAULT_AGENTS))
    parser.add_argument(
        "--simulate-completion",
        action="store_true",
        help="Apply the fake ledger edit locally and mark the task complete for webhook QA.",
    )
    args = parser.parse_args(argv)

    workspace = qa_workspace(args.public_task_root, args.tenant_id, args.user_id, args.label or None)
    db_path = init_ledger(workspace, args.tenant_id)
    prompt = build_task_prompt(workspace, db_path)
    payload = task_payload(
        prompt=prompt,
        workspace=workspace,
        tenant_id=args.tenant_id,
        user_id=args.user_id,
        user_email=args.user_email,
        agents=parse_agents(args.agents),
        assignee="pearl" if args.simulate_completion else "claude_cli",
    )

    try:
        created = post_json(args.api.rstrip("/"), payload)
        task = created.get("task") or {}
        task_id = str(task.get("id") or "")
        if not task_id:
            print("Accounting sandbox task registration failed: no task was returned.", file=sys.stderr)
            return 1
        if args.simulate_completion:
            edit = apply_reclassification(workspace, args.tenant_id, args.user_id)
            write_artifacts(workspace, edit)
            patch_json(
                f"{args.api.rstrip('/')}/{urllib.parse.quote(task_id, safe='')}",
                {"status": "completed", "result": completion_result(workspace)},
            )
            print("Accounting sandbox task completed with an audit artifact.")
        else:
            print("Accounting sandbox task dispatched.")
        return 0
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"Accounting sandbox QA failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
