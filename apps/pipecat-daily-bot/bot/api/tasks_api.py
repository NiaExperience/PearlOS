"""PearlOS Task List API — single source of truth for work dispatched by
Pearl, Blair, or any other source.

Replaces the previous Discord-mirror flow. Tasks live in an append-only JSONL
event log (one event per line). An in-memory index is rebuilt from the log on
startup and updated in place as events are appended. This gives us:

  - Crash-safe durability (log is append-only; no partial writes)
  - Full audit trail (every create/update event is preserved)
  - Fast reads (index served from memory, not re-parsed per request)

Storage layout:
  /root/.openclaw/tasks/tasks.jsonl   — canonical event log
  /root/.openclaw/tasks/dispatch-log.jsonl  — legacy log, auto-migrated on startup

HTTP surface (mounted at /api/tasks by bot_gateway.py):

  POST   /api/tasks              Create a task
  GET    /api/tasks              List tasks (filters: status, assignee, source, urgency, limit)
  GET    /api/tasks/{id}         Get one task
  PATCH  /api/tasks/{id}         Update status / notes / result / assignee
  DELETE /api/tasks/{id}         Cancel a task (sets status=cancelled)

Curl examples — for Claude CLI integration:

  # Pick up pending work assigned to Claude CLI
  curl -H "Authorization: Bearer $BOT_CONTROL_SHARED_SECRET" \
       "http://localhost:4444/api/tasks?status=pending&assignee=claude_cli"

  # Mark a task as in progress
  curl -X PATCH -H "Authorization: Bearer $BOT_CONTROL_SHARED_SECRET" \
       -H "Content-Type: application/json" \
       -d '{"status":"in_progress","note":"Starting now"}' \
       "http://localhost:4444/api/tasks/disp-abc123"

  # Complete a task with a result summary
  curl -X PATCH -H "Authorization: Bearer $BOT_CONTROL_SHARED_SECRET" \
       -H "Content-Type: application/json" \
       -d '{"status":"completed","result":"Fixed by bumping the body limit"}' \
       "http://localhost:4444/api/tasks/disp-abc123"
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
import threading
import uuid
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field, model_validator

from auth import require_strict_auth
from budget_guard import estimate_cents, reserve_tenant_budget_async
from rate_limit import apply_general_rate_limit


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TASKS_DIR = os.getenv("PEARL_TASKS_DIR", "/root/.openclaw/tasks")
TASKS_LOG_PATH = os.path.join(TASKS_DIR, "tasks.jsonl")
LEGACY_DISPATCH_LOG_PATH = os.path.join(TASKS_DIR, "dispatch-log.jsonl")
PUBLIC_TASK_ROOT = os.getenv("PEARL_PUBLIC_TASK_ROOT", "/srv/pearl-user-workspaces")
STAGING_SOURCE_ROOT = os.getenv("PEARLOS_STAGING_SOURCE_ROOT", "/workspace/nia-universal")
WORKSPACE_ENTITLEMENTS_CONFIG_PATHS = tuple(
    path.strip()
    for path in (
        os.getenv("PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG", ""),
        *os.getenv("PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG_PATHS", "").split(":"),
        "/workspace/nia-universal/config/workspace-entitlements.json",
        "/home/deploy/pearlos/config/workspace-entitlements.json",
    )
    if path.strip()
)
DEFAULT_BLAIR_USER_IDS = (
    "00000000-0000-0000-0003-000000000020",
    "00000000-0000-0000-0003-000000000011",
)
DEFAULT_BLAIR_EMAILS = ("blair@niaxp.com", "blairerickson@gmail.com")
PROTECTED_RUNTIME_PATHS = (
    STAGING_SOURCE_ROOT,
    "/opt/pearlos",
    "/home/deploy/pearlos",
    "/root/.openclaw",
)

# ---------------------------------------------------------------------------
# Claude CLI executor
# ---------------------------------------------------------------------------
# Legacy/manual fallback executor. The normal UI path is event-driven: task
# creates/updates publish to /api/tasks/stream and pearl-worker claims pending
# claude_cli work. Keep /api/tasks/{id}/execute available for older callers.
CLAUDE_BIN = os.getenv("PEARL_CLAUDE_BIN", "claude")
CLAUDE_CWD = os.getenv("PEARL_CLAUDE_CWD", "/root/.openclaw/workspace-pearlos")
CLAUDE_TIMEOUT_S = int(os.getenv("PEARL_CLAUDE_TIMEOUT_S", "600"))
# Keep task "result" summaries bounded — full output lives in the agent's own
# session logs, the task record just needs an audit trail.
CLAUDE_RESULT_MAX_CHARS = int(os.getenv("PEARL_CLAUDE_RESULT_MAX_CHARS", "4000"))

# ── Task-to-Notes auto-delivery ────────────────────────────────────────────
USER_ROOT = os.getenv("PEARLOS_USER_ROOT", "/workspace/user")


def _safe_note_identity(value: Any) -> Optional[str]:
    safe = "".join(ch if ch.isalnum() or ch in "._@+-" else "_" for ch in str(value or ""))
    safe = safe.strip("._-")[:160]
    return safe or None


def _safe_note_title(value: Any) -> str:
    safe = "".join(ch if ch.isalnum() or ch in " _-" else "_" for ch in str(value or ""))
    safe = "-".join(safe.split())[:80].strip("-")
    return safe or "task-result"


def _note_timestamp_suffix(task: dict) -> str:
    stamp = str(task.get("timestamp_created") or task.get("completed_at") or _iso_now())
    digits = re.sub(r"\D", "", stamp)
    if len(digits) >= 14:
        return f"{digits[:8]}-{digits[8:14]}"
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _task_result_note_eligible(task: dict) -> bool:
    if str(task.get("status") or "") not in ("completed", "failed"):
        return False
    if task.get("note_filename") or task.get("file_space_path"):
        return False
    result = str(task.get("result") or "").strip()
    if not result:
        return False
    blocked_fragments = ("claude binary missing", "claude exit=")
    return not any(fragment in result.lower() for fragment in blocked_fragments)


_INTERNAL_NOTE_PATH_PREFIXES = (
    "/srv/pearl-user-workspaces",
    "/home/deploy/pearlos",
    "/opt/pearlos",
    "/workspace/nia-universal",
    "/root/.openclaw",
)


def _is_internal_note_path(value: str) -> bool:
    text = urllib.parse.unquote(str(value or "")).strip()
    if text.startswith("file://"):
        text = text[7:]
    return any(text.startswith(prefix) for prefix in _INTERNAL_NOTE_PATH_PREFIXES)


def _sanitize_task_note_content(value: str) -> str:
    """Remove backend-only paths and internal IDs from user-facing task notes."""

    def replace_markdown_link(match: re.Match[str]) -> str:
        label = match.group(1).strip()
        target = match.group(2).strip()
        return label if _is_internal_note_path(target) else match.group(0)

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", replace_markdown_link, value)

    def replace_internal_path(match: re.Match[str]) -> str:
        raw = match.group(0).rstrip(".,);]")
        suffix = match.group(0)[len(raw):]
        basename = os.path.basename(raw)
        return (basename or "the generated file") + suffix

    text = re.sub(
        r"(?:file://)?/(?:srv/pearl-user-workspaces|home/deploy/pearlos|opt/pearlos|workspace/nia-universal|root/\.openclaw)/[^\s`'\"<>]+",
        replace_internal_path,
        text,
    )
    text = re.sub(r"\b(?:disp|run|swarm)-[A-Za-z0-9_-]{8,}\b", "the task", text)
    text = re.sub(r"\b[a-f0-9]{32,64}\b", "an internal reference", text, flags=re.I)
    text = re.sub(
        r"(?im)^\s*(?:changed|changed files?|files changed|verification|verification run|build output|logs?|not deployed)\s*:\s*$",
        "",
        text,
    )
    text = re.sub(
        r"(?im)^\s*[-*]\s*(?:apps|packages|scripts|docs|config|tests|public|/workspace|/home/deploy|/opt/pearlos)/[^\n]+$",
        "",
        text,
    )
    text = re.sub(
        r"(?im)^\s*(?:PEARLOS_[A-Z0-9_]+|npm run|npx |pm2 |git |cp |curl |su - deploy|ssh )\b[^\n]*$",
        "",
        text,
    )
    text = re.sub(r"(?i)\b(?:DONE|BLOCKED)\s*:\s*", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _public_task_result(value: Any) -> str:
    """Return the public, user-facing form of a task result.

    Worker logs and task stdout can contain paths, command snippets, hashes, and
    retry plumbing. The task result is shown in chat, Notes, ActiveJobs, and
    webhooks, so it must read like a short explanation rather than a dump.
    """
    text = _sanitize_task_note_content(str(value or ""))
    text = re.sub(
        r"(?im)^\s*(?:current host is|host:|pm2 cwd|workdir:|sandbox:|approval:|session id:)\b[^\n]*$",
        "",
        text,
    )
    text = re.sub(
        r"(?is)```(?:json|bash|sh|text|log)?\s*[\s\S]{0,2000}?```",
        lambda match: "" if re.search(r"(tool_call|exec_command|traceback|npm |pm2 |codex|sandbox|/workspace|/opt/pearlos)", match.group(0), re.I) else match.group(0),
        text,
    )
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > CLAUDE_RESULT_MAX_CHARS:
        text = text[: CLAUDE_RESULT_MAX_CHARS - 3].rstrip() + "..."
    return text


def _task_documents_root(task: dict) -> Optional[str]:
    tenant_id = _safe_note_identity(task.get("requester_tenant_id"))
    user_id = _safe_note_identity(task.get("requester_user_id"))
    if not tenant_id or tenant_id == "public" or not user_id:
        return None
    docs_dir = os.path.join(USER_ROOT, tenant_id, user_id, "Documents")
    root = os.path.abspath(USER_ROOT)
    target = os.path.abspath(docs_dir)
    if target != root and target.startswith(root + os.sep):
        return docs_dir
    return None


def _deliver_task_note(task: dict) -> Optional[str]:
    """Write a completed task's result as a .md note in the user's Documents folder.

    Returns the filename (without .md) on success, None on failure.
    The caller should store the filename on the task record so the frontend
    can render an "Open" button that links to the note.
    """
    result = (task.get("result") or "").strip()
    if not result:
        return None
    docs_dir = _task_documents_root(task)
    if not docs_dir:
        logger.warning(
            f"[tasks] note delivery skipped {task.get('id')}: "
            "task is missing requester_tenant_id/requester_user_id"
        )
        return None

    title = (task.get("title") or "Task Result").strip()
    safe_title = _safe_note_title(title)
    filename = f"{safe_title}-{_note_timestamp_suffix(task)}"
    os.makedirs(docs_dir, exist_ok=True)
    file_path = os.path.join(docs_dir, f"{filename}.md")
    safe_result = _sanitize_task_note_content(result)
    content = safe_result if safe_result.startswith("#") else f"# {title}\n\n{safe_result}"
    try:
        if os.path.exists(file_path):
            logger.info(f"[tasks] note delivery reused existing note for {task.get('id')} -> {file_path}")
            return filename
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content.rstrip() + "\n")
        logger.info(f"[tasks] note delivered {task.get('id')} -> {file_path}")
        return filename
    except OSError as e:
        logger.error(f"[tasks] note delivery failed {task.get('id')}: {e}")
        return None


def _safe_relative_parts(value: str) -> list[str]:
    parts = [part for part in str(value or "").strip().replace("\\", "/").split("/") if part]
    if not parts or any(part in (".", "..") for part in parts):
        return []
    return parts


def _result_mentions_filespace(result: str, task_text: str = "") -> bool:
    text = f"{result}\n{task_text}".lower()
    return "filespace" in text or "file space" in text or "my files" in text


def _result_mentions_user_deliverable(result: str, task_text: str = "") -> bool:
    text = f"{result}\n{task_text}".lower()
    if _result_mentions_filespace(result, task_text):
        return True
    return bool(
        re.search(
            r"\b(document|file|files|note|notes|report|write-?up|brief|strategy|plan|pdf|markdown|md)\b",
            text,
        )
        and re.search(
            r"\b(create|created|write|wrote|save|saved|deliver|delivered|draft|drafted|generate|generated|recover|recovered|recreate|recreated|find|found)\b",
            text,
        )
    )


def _candidate_output_source(workspace_root: str, candidate: str) -> Optional[str]:
    raw = str(candidate or "").strip().strip("'\"")
    if not raw:
        return None
    if raw.startswith("file://"):
        raw = urllib.parse.unquote(raw[7:])
    if os.path.isabs(raw):
        src = os.path.realpath(raw)
    else:
        parts = _safe_relative_parts(raw)
        if not parts:
            return None
        src = os.path.realpath(os.path.join(workspace_root, *parts))
    if not (src == workspace_root or src.startswith(workspace_root + os.sep)):
        return None
    if not os.path.isfile(src):
        return None
    return src


def _relative_output_destination(candidate: str, src: str, workspace_root: str) -> Optional[list[str]]:
    raw = str(candidate or "").strip().strip("'\"")
    if raw.startswith("file://"):
        raw = urllib.parse.unquote(raw[7:])
    if os.path.isabs(raw):
        raw = os.path.relpath(src, workspace_root)
    parts = _safe_relative_parts(raw)
    if parts:
        return parts
    basename = os.path.basename(src)
    return [basename] if basename else None


def _promote_filespace_outputs(task: dict, result: str) -> Optional[str]:
    """Copy worker-created files from a task sandbox into FileSpace Documents.

    Agents often create files correctly inside their isolated workspace, then
    say they are in "FileSpace" or hand back a filename for a requested
    document/report. Product FileSpace reads /workspace/user, so we promote
    explicitly referenced output files there before marking the completion as
    user-visible success.
    """
    if not _result_mentions_user_deliverable(result, str(task.get("task") or "")):
        return None

    workspace = str(task.get("workspace_path") or "").strip()
    if not workspace:
        return None
    workspace_root = os.path.realpath(workspace)
    if not os.path.isdir(workspace_root):
        return None

    docs_dir = _task_documents_root(task)
    if not docs_dir:
        return None

    candidates: list[str] = []
    for raw in set(re.findall(r"`([^`]+\.(?:png|jpe?g|gif|webp|svg|pdf|txt|md|csv|json|mp4|mov|webm))`", result, flags=re.I)):
        candidates.append(raw)
    for raw in set(re.findall(r"\b([A-Za-z0-9._@+\-/ ]+\.(?:png|jpe?g|gif|webp|svg|pdf|txt|md|csv|json|mp4|mov|webm))\b", result, flags=re.I)):
        candidates.append(raw.strip())

    copied_dirs: list[str] = []
    docs_root = os.path.realpath(docs_dir)
    os.makedirs(docs_root, exist_ok=True)
    for candidate in candidates:
        src = _candidate_output_source(workspace_root, candidate)
        if not src:
            continue
        parts = _relative_output_destination(candidate, src, workspace_root)
        if not parts:
            continue
        dest = os.path.realpath(os.path.join(docs_root, *parts))
        if not dest.startswith(docs_root + os.sep):
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest):
            base, ext = os.path.splitext(dest)
            suffix = 2
            while os.path.exists(f"{base}-{suffix}{ext}"):
                suffix += 1
            dest = f"{base}-{suffix}{ext}"
        shutil.copy2(src, dest)
        rel_dir = os.path.relpath(os.path.dirname(dest), docs_root).replace(os.sep, "/")
        if rel_dir == ".":
            rel_dir = "."
        copied_dirs.append(rel_dir)

    copied_dirs = [item for item in dict.fromkeys(copied_dirs) if item]
    if copied_dirs:
        return copied_dirs[0]
    return None

# Hard cap on task titles. Titles should be descriptive enough to identify the
# work without becoming a full prompt dump. The ActiveJobs widget now wraps
# titles, so this can be longer than the old one-line cap.
MAX_TITLE_LEN = 140

# Track in-flight executions so duplicate PLAY taps don't spawn two subprocesses.
_executing: set[str] = set()
_executing_lock = threading.Lock()

# Auto-requeue policy: when a task flips to status=failed we bump retry_count
# and, as long as we're under MAX_RETRIES, flip it back to status=pending so
# the worker picks it up again. Failed tasks are never deleted — after the
# retry budget is exhausted the task stays in status=failed in the index and
# remains visible, just not auto-retried.
def _max_retries() -> int:
    try:
        return max(0, int(os.getenv("PEARL_TASKS_MAX_RETRIES", "5")))
    except (TypeError, ValueError):
        return 5


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
Source = Literal[
    "web_chat",
    "google_chat_dm",
    "discord",
    "discord_lookup",
    "telegram",
    "telegram_dm",
    "voice",
    "manual",
]
CreatedBy = Literal["pearl", "blair", "claude_cli", "system", "agency"]
Assignee = Literal["claude_cli", "relay_continuation", "pearl", "blair"]
Urgency = Literal["normal", "urgent"]
Status = Literal["pending", "in_progress", "completed", "failed", "cancelled", "archived"]
ExecutionMode = Literal["fast_draft", "full_build"]
WorkspaceMode = Literal["sandbox", "github_fork", "staging_source", "operator_staging_source"]
PUBLIC_TASK_SOURCES = frozenset({
    "discord",
    "discord_lookup",
    "telegram",
    "telegram_dm",
    "google_chat_dm",
    "web_chat",
    "voice",
})
INTERNAL_OPERATOR_CREATED_BY = frozenset({"blair", "claude_cli", "system", "agency"})


SPECIALTY_SWARMS_UPDATED_AT = "2026-05-14"
SPECIALTY_SWARMS: tuple[dict[str, Any], ...] = (
    {
        "category": "Legal",
        "keywords": ("legal", "contract", "compliance", "gdpr", "lawsuit", "nda", "policy"),
        "agents": ("Legal analyst", "Risk reviewer", "Policy researcher"),
    },
    {
        "category": "Medical",
        "keywords": ("medical", "clinical", "diagnos", "patient", "pharma", "health"),
        "agents": ("Medical researcher", "Clinical safety reviewer", "Evidence analyst"),
    },
    {
        "category": "Design",
        "keywords": ("design", "brand", "visual", "ui", "ux", "logo", "sprite", "creative"),
        "agents": ("Design lead", "Interaction reviewer", "Visual QA"),
    },
    {
        "category": "Code",
        "keywords": ("code", "bug", "fix", "refactor", "api", "component", "deploy", "build"),
        "agents": ("Code implementer", "Regression reviewer", "Release verifier"),
    },
    {
        "category": "Science",
        "keywords": ("science", "scientific", "biology", "chemistry", "physics", "experiment"),
        "agents": ("Science researcher", "Methods reviewer", "Evidence analyst"),
    },
    {
        "category": "Research",
        "keywords": ("research", "investigate", "analyze", "audit", "compare", "survey"),
        "agents": ("Research lead", "Source checker", "Synthesis writer"),
    },
    {
        "category": "Writing",
        "keywords": ("write", "draft", "edit", "copy", "essay", "story", "article"),
        "agents": ("Writer", "Editor", "Tone reviewer"),
    },
    {
        "category": "Marketing",
        "keywords": ("marketing", "campaign", "positioning", "audience", "launch", "sales"),
        "agents": ("Marketing strategist", "Audience researcher", "Copy reviewer"),
    },
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_identity(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _clean_email(value: Any) -> Optional[str]:
    text = str(value or "").strip().lower()
    return text or None


def _requester_scope_from_request(
    request: Request,
    *,
    fallback_email: Optional[str] = None,
    fallback_user_id: Optional[str] = None,
    fallback_tenant_id: Optional[str] = None,
) -> dict[str, Optional[str]]:
    """Extract user-facing requester scope from headers/query/body fallbacks.

    Identity-less requests are treated as internal shared-secret traffic. This
    preserves pearl-worker and operator scripts, while any caller that presents
    a requester identity is constrained to matching task records.
    """
    qp = request.query_params
    headers = request.headers
    user_id = (
        _clean_identity(headers.get("x-user-id"))
        or _clean_identity(qp.get("requester_user_id"))
        or _clean_identity(qp.get("user_id"))
        or _clean_identity(fallback_user_id)
    )
    email = (
        _clean_email(headers.get("x-user-email"))
        or _clean_email(qp.get("requester_email"))
        or _clean_email(qp.get("user_email"))
        or _clean_email(fallback_email)
    )
    tenant_id = (
        _clean_identity(headers.get("x-pearl-tenant-id"))
        or _clean_identity(headers.get("x-tenant-id"))
        or _clean_identity(qp.get("requester_tenant_id"))
        or _clean_identity(qp.get("tenant_id"))
        or _clean_identity(fallback_tenant_id)
    )
    return {"user_id": user_id, "email": email, "tenant_id": tenant_id}


def _scope_is_user_facing(scope: dict[str, Optional[str]]) -> bool:
    return bool(scope.get("user_id") or scope.get("email") or scope.get("tenant_id"))


def _normalized_marker(value: Any) -> str:
    return str(value or "").strip().lower()


def _has_internal_operator_marker(source: Any, created_by: Any) -> bool:
    return (
        _normalized_marker(source) == "manual"
        or _normalized_marker(created_by) in INTERNAL_OPERATOR_CREATED_BY
    )


def _validate_public_origin_task_scope(
    *,
    source: Any,
    created_by: Any,
    requester_email: Optional[str] = None,
    requester_user_id: Optional[str] = None,
    requester_tenant_id: Optional[str] = None,
) -> None:
    if _normalized_marker(source) not in PUBLIC_TASK_SOURCES:
        return
    if _has_internal_operator_marker(source, created_by):
        return

    user_id = _clean_identity(requester_user_id)
    email = _clean_email(requester_email)
    tenant_id = _clean_identity(requester_tenant_id)
    if (user_id or email) and not tenant_id:
        raise ValueError("requester_tenant_id_required")
    if not user_id:
        if tenant_id:
            raise ValueError("requester_user_id_required_for_public_source")
        raise ValueError("requester_scope_required_for_public_source")


def _task_visible_to_requester(task: Optional[dict], scope: dict[str, Optional[str]]) -> bool:
    if not task:
        return False
    if not _scope_is_user_facing(scope):
        return True

    wanted_user_id = _clean_identity(scope.get("user_id"))
    wanted_email = _clean_email(scope.get("email"))
    wanted_tenant = _clean_identity(scope.get("tenant_id"))
    if (wanted_user_id or wanted_email) and not wanted_tenant:
        return False
    if wanted_tenant:
        task_tenant = _clean_identity(task.get("requester_tenant_id") or "public")
        if task_tenant != wanted_tenant:
            return False

    if wanted_user_id or wanted_email:
        task_user_id = _clean_identity(task.get("requester_user_id"))
        task_email = _clean_email(task.get("requester_email"))
        return bool(
            (wanted_user_id and task_user_id == wanted_user_id)
            or (wanted_email and task_email == wanted_email)
        )

    # Tenant-only scope is allowed to see that tenant's tasks after the tenant
    # match above. Tasks without tenant identity remain hidden from scoped calls.
    return bool(wanted_tenant)


def _task_or_404_for_request(store: "TaskStore", task_id: str, scope: dict[str, Optional[str]]) -> dict:
    task = store.get(task_id)
    if not task or not _task_visible_to_requester(task, scope):
        raise HTTPException(status_code=404, detail="task_not_found")
    return task


def _require_swarm_scope(
    request: Request,
    *,
    fallback_email: Optional[str] = None,
    fallback_user_id: Optional[str] = None,
    fallback_tenant_id: Optional[str] = None,
) -> dict[str, Optional[str]]:
    scope = _requester_scope_from_request(
        request,
        fallback_email=fallback_email,
        fallback_user_id=fallback_user_id,
        fallback_tenant_id=fallback_tenant_id,
    )
    if not scope.get("tenant_id") or not (scope.get("user_id") or scope.get("email")):
        raise HTTPException(status_code=400, detail="swarm_scope_required")
    return scope


def _swarm_or_404_for_request(store: "TaskStore", task_id: str, scope: dict[str, Optional[str]]) -> dict:
    task = _task_or_404_for_request(store, task_id, scope)
    if task.get("kind") != "swarm":
        raise HTTPException(status_code=404, detail="task_not_found")
    return task


def _apply_swarm_creation_rate_limit(request: Request, scope: dict[str, Optional[str]]) -> None:
    apply_general_rate_limit(
        request,
        surface="tasks:swarm",
        tenant_id=scope.get("tenant_id"),
        user_id=scope.get("user_id"),
        email=scope.get("email"),
    )


def _envelope_visible_to_requester(envelope: dict, scope: dict[str, Optional[str]]) -> bool:
    if not _scope_is_user_facing(scope):
        return True
    task = envelope.get("task")
    if isinstance(task, dict):
        return _task_visible_to_requester(task, scope)
    return False


def _new_id() -> str:
    return f"disp-{uuid.uuid4().hex[:10]}"


def _default_task_agents(task: str, category: str | None = None) -> tuple[str, list[str], str]:
    text = (task or "").lower()
    for swarm in SPECIALTY_SWARMS:
        keywords = swarm["keywords"]
        if category == swarm["category"] or any(str(keyword) in text for keyword in keywords):
            return "swarm", list(swarm["agents"]), str(swarm["category"])
    return "task", ["Pearl agent"], "The Agency"


def _task_metadata_for_create(
    task: str,
    *,
    explicit_kind: str | None = None,
    agents: list[str] | None = None,
    swarm_category: str | None = None,
) -> tuple[str, list[str], str]:
    """Return task/swarm metadata without auto-promoting normal tasks.

    Older create paths inferred ``kind='swarm'`` from broad keywords like
    "code", "research", and "audit". That made ordinary CLI tasks look like
    multi-agent swarms with synthetic agents. Only explicit swarm callers
    should get swarm metadata; the /api/swarm bridge already does that.
    """
    chosen_agents = [str(a).strip() for a in (agents or []) if str(a).strip()]
    if explicit_kind == "swarm" or len(chosen_agents) > 1:
        _, inferred_agents, inferred_category = _default_task_agents(task, swarm_category)
        return "swarm", chosen_agents or inferred_agents, swarm_category or inferred_category
    return "task", chosen_agents or ["Pearl agent"], swarm_category or "The Agency"


def _safe_path_component(value: str | None, fallback: str = "unknown") -> str:
    raw = str(value or "").strip().lower()
    safe = "".join(ch if ch.isalnum() or ch in "._@+-" else "_" for ch in raw).strip("._-")
    return (safe or fallback)[:160]


def _env_list(name: str, defaults: tuple[str, ...] = ()) -> set[str]:
    configured = tuple(part.strip() for part in os.getenv(name, "").split(",") if part.strip())
    return {str(value).strip().lower() for value in (*configured, *defaults) if str(value).strip()}


def _path_inside(path: str, root: str) -> bool:
    resolved = os.path.abspath(path)
    resolved_root = os.path.abspath(root)
    return resolved == resolved_root or resolved.startswith(resolved_root + os.sep)


def _real_path_inside(path: str, root: str) -> bool:
    resolved = os.path.realpath(path)
    resolved_root = os.path.realpath(root)
    return resolved == resolved_root or resolved.startswith(resolved_root + os.sep)


def _assert_existing_parent_not_symlink(target: str) -> None:
    current = os.path.abspath(target)
    while not os.path.exists(current):
        parent = os.path.dirname(current)
        if parent == current:
            return
        current = parent
    if os.path.realpath(current) != os.path.abspath(current):
        raise ValueError(f"refusing symlinked task workspace parent: {target}")


def _is_staging_source_path(path: str) -> bool:
    return _path_inside(path, STAGING_SOURCE_ROOT)


def _is_protected_runtime_path(path: str) -> bool:
    return any(_path_inside(path, root) for root in PROTECTED_RUNTIME_PATHS)


def _workspace_entitlements_config() -> dict[str, Any]:
    for path in WORKSPACE_ENTITLEMENTS_CONFIG_PATHS:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                parsed = json.load(handle)
            if isinstance(parsed, dict):
                return parsed
        except OSError:
            continue
        except Exception as e:
            logger.warning(f"[tasks] workspace entitlement config unreadable {path}: {e}")
    return {}


def _staging_source_edits_enabled() -> bool:
    env_value = os.getenv("PEARLOS_STAGING_SOURCE_EDITS_ENABLED", "").strip().lower()
    if env_value in ("1", "true", "yes", "on"):
        return True
    cfg = _workspace_entitlements_config()
    return cfg.get("stagingSourceEditsEnabled") is True


def _is_blair_identity(user_id: str | None, email: str | None) -> bool:
    user_id_clean = str(user_id or "").strip().lower()
    email_clean = str(email or "").strip().lower()
    allowed_ids = _env_list("PEARLOS_BLAIR_USER_IDS", DEFAULT_BLAIR_USER_IDS)
    allowed_emails = _env_list("PEARLOS_BLAIR_EMAILS", DEFAULT_BLAIR_EMAILS)
    return bool(
        (user_id_clean and user_id_clean in allowed_ids)
        or (email_clean and email_clean in allowed_emails)
    )


def _operator_staging_source_available(user_id: str | None, email: str | None) -> bool:
    env_enabled = os.getenv("PEARLOS_ENABLE_BLAIR_STAGING_TERMINAL", "").strip().lower() in ("1", "true", "yes", "on")
    env_name = os.getenv("PEARLOS_ENV", "").strip().lower()
    public_url = " ".join(
        str(os.getenv(name, "")).strip().lower()
        for name in ("NEXTAUTH_URL", "PEARLOS_URL", "PUBLIC_URL", "PEARLOS_HOSTNAME")
    )
    production = "app.pearlos.org" in public_url or "production" in public_url or env_name == "production"
    staging = env_name == "staging" or "staging" in public_url or "134-209-76-227.sslip.io" in public_url
    return env_enabled and staging and not production and _is_blair_identity(user_id, email)


def _is_advanced_workspace_user(
    *,
    user_id: str | None,
    email: str | None,
    tenant_role: str | None,
) -> bool:
    if _is_blair_identity(user_id, email):
        return True
    user_id_clean = str(user_id or "").strip().lower()
    email_clean = str(email or "").strip().lower()
    if user_id_clean and user_id_clean in _env_list("PEARLOS_ADVANCED_WORKSPACE_USER_IDS"):
        return True
    if email_clean and email_clean in _env_list("PEARLOS_ADVANCED_WORKSPACE_EMAILS"):
        return True
    return str(tenant_role or "").strip().lower() in ("admin", "owner")


def _looks_like_pearlos_source_task(task: str, title: str | None = None) -> bool:
    text = f"{title or ''}\n{task or ''}".lower()
    if not text.strip():
        return False
    if _looks_like_studio_creation_task(task, title):
        return False
    has_core_surface = re.search(
        r"\b(pearlos|pearl\s+os|pearl\s+views?|pearl\s+vision|home\s*video\s*feed|homevideofeed|"
        r"pixel\s+canvas|wonder\s+canvas|deprecated\s+canvas|stage|staging|pm2|deploy|runtime|"
        r"source\s+(?:tree|repo|checkout)|repo|voice\s+session|ltx|desktop\s+icons?|startup|"
        r"start\s*up|home\s+screen\s+canvas|agency|filespace|file\s+space|pulse|desktop\s+app)\b"
        r"|\b(apps/interface|apps/pipecat|/workspace/nia-universal|home-video-feed|ltx-video|"
        r"clientmanager|chatmode|stage\.tsx)\b",
        text,
    )
    if not has_core_surface:
        return False
    has_repair_intent = re.search(
        r"\b(audit|fix|repair|debug|diagnose|investigate|qa|test|verify|deploy|build|push|"
        r"staging|why|broken|bug|regression|not\s+working|nothing\s+changed|startup|"
        r"start\s*up|glitch|glitches|source|code|patch|implement|route|component|release)\b",
        text,
    )
    return bool(has_repair_intent)


def _looks_like_studio_creation_task(task: str, title: str | None = None) -> bool:
    text = f"{title or ''}\n{task or ''}".lower()
    if not text.strip():
        return False
    has_creation_verb = re.search(r"\b(build|create|make|generate|design|develop|prototype|ship)\b", text)
    has_runnable_artifact = re.search(
        r"\b(web\s*app|single[-\s]?page|html5|canvas|game|playable|interactive|experience|demo|prototype|dashboard|analytics|report|tracker|portal|table|client\s+portal|admin\s+panel|side[-\s]?scroll(?:er|ing)|sidescroller|platformer)\b",
        text,
    )
    if not (has_creation_verb and has_runnable_artifact):
        return False
    has_studio_intent = re.search(
        r"\bstudio\b|\bplay\s*url\b|\bplay\s*link\b|\blink\b|\bopen\s+it\b|\brunnable\b|\bplayable\b",
        text,
    )
    clearly_app_or_game = re.search(
        r"\b(web\s*app|html5|canvas|game|dashboard|analytics|report|tracker|portal|table|client\s+portal|admin\s+panel|side[-\s]?scroll(?:er|ing)|sidescroller|platformer)\b",
        text,
    )
    return bool(has_studio_intent or clearly_app_or_game)


def _studio_creation_id() -> str:
    return str(uuid.uuid4())


def _studio_creation_workspace_path(
    *,
    tenant_id: str | None,
    user_id: str | None,
    creation_id: str,
) -> str:
    root = _scoped_user_workspace_root(tenant_id=tenant_id, user_id=user_id)
    path = os.path.abspath(os.path.join(root, "creations", creation_id))
    if not _path_inside(path, root):
        raise ValueError("invalid Studio creation workspace path")
    return path + os.sep


def _studio_creation_prompt(task: str, *, output_path: str, creation_id: str) -> str:
    normalized = output_path if output_path.endswith(os.sep) else output_path + os.sep
    return (
        f"{task.strip()}\n\n"
        "PearlOS Studio artifact contract:\n"
        "- Treat this as a user-scoped Studio app/game creation, not a PearlOS source, deploy, or production change.\n"
        f"- Output target: {normalized}\n"
        f"- Required artifact: create and verify {normalized}index.html. Supporting assets may live under the same folder.\n"
        f"- Direct play URL: /api/creation/{creation_id}/\n"
        f"- On success, final result must include: Build complete. Output at {normalized}index.html. PLAY URL: /api/creation/{creation_id}/\n"
        "- Do not point the user to an intermediate note unless they explicitly asked for a note.\n"
        "- Before marking complete, confirm index.html exists in the output target.\n"
    )


def _task_workspace_path(*, tenant_id: str | None, user_id: str | None, task_id: str) -> str:
    tenant = _safe_path_component(tenant_id, "public")
    user = _safe_path_component(user_id, "anonymous")
    task = _safe_path_component(task_id, "task")
    root = os.path.abspath(PUBLIC_TASK_ROOT)
    path = os.path.abspath(os.path.join(root, tenant, user, task))
    if not path.startswith(root + os.sep):
        raise ValueError("invalid task workspace path")
    return path


def _scoped_user_workspace_root(*, tenant_id: str | None, user_id: str | None) -> str:
    tenant = _safe_path_component(tenant_id, "public")
    user = _safe_path_component(user_id, "anonymous")
    root = os.path.abspath(PUBLIC_TASK_ROOT)
    path = os.path.abspath(os.path.join(root, tenant, user))
    if not path.startswith(root + os.sep):
        raise ValueError("invalid user workspace path")
    return path


def _fork_workspace_root(*, tenant_id: str | None, user_id: str | None) -> str:
    scoped_root = _scoped_user_workspace_root(tenant_id=tenant_id, user_id=user_id)
    path = os.path.abspath(os.path.join(scoped_root, "forks"))
    if not path.startswith(scoped_root + os.sep):
        raise ValueError("invalid fork workspace path")
    return path


def _fork_workspace_slug(github_fork_url: str | None, fallback: str) -> str:
    raw = str(github_fork_url or "").strip()
    if not raw:
        return _safe_path_component(fallback, "fork")
    try:
        parsed = urllib.parse.urlparse(raw)
        parts = [part for part in parsed.path.replace(".git", "").split("/") if part]
        if len(parts) >= 2:
            return _safe_path_component(f"{parts[-2]}_{parts[-1]}", "fork")
    except Exception:
        pass
    return _safe_path_component(raw.replace(".git", ""), "fork")


def _resolve_workspace_entitlement(
    *,
    tenant_id: str | None,
    user_id: str | None,
    email: str | None,
    task_id: str,
    workspace_mode: str | None = None,
    workspace_path: str | None = None,
    github_fork_url: str | None = None,
    tenant_role: str | None = None,
) -> dict[str, Any]:
    requested_mode = str(workspace_mode or "").strip()
    if requested_mode and requested_mode not in ("sandbox", "github_fork", "staging_source", "operator_staging_source"):
        raise ValueError(f"invalid workspace_mode: {requested_mode}")

    requested_path = os.path.abspath(workspace_path.strip()) if isinstance(workspace_path, str) and workspace_path.strip() else ""
    is_blair = _is_blair_identity(user_id, email)
    can_use_fork = _is_advanced_workspace_user(user_id=user_id, email=email, tenant_role=tenant_role)
    wants_staging = requested_mode == "staging_source" or (requested_path and _is_staging_source_path(requested_path))

    if requested_mode == "operator_staging_source":
        if not _operator_staging_source_available(user_id, email):
            raise ValueError("operator_staging_source_forbidden")
        return {
            "workspace_mode": "operator_staging_source",
            "workspace_path": STAGING_SOURCE_ROOT,
            "github_fork_url": None,
            "workspace_isolation_notice": None,
            "staging_source_edits_enabled": True,
            "workspace_entitlement": {
                "is_blair": is_blair,
                "can_use_fork_workspaces": can_use_fork,
                "can_use_staging_source_edits": True,
            },
        }

    if wants_staging:
        raise ValueError("personal_instance_only")

    if requested_path and _is_protected_runtime_path(requested_path):
        raise ValueError(f"refusing protected workspace path: {requested_path}")

    user_scope = user_id or email or "anonymous"
    if requested_mode == "github_fork":
        if not can_use_fork:
            raise ValueError("github_fork_requires_advanced_access")
        fork_root = _fork_workspace_root(tenant_id=tenant_id, user_id=user_scope)
        path = requested_path or os.path.join(
            fork_root,
            _fork_workspace_slug(github_fork_url, task_id),
        )
        path = os.path.abspath(path)
        if not _path_inside(path, fork_root):
            raise ValueError(f"refusing fork workspace outside requester forks: {path}")
        return {
            "workspace_mode": "github_fork",
            "workspace_path": path,
            "github_fork_url": str(github_fork_url or "").strip() or None,
            "workspace_isolation_notice": None,
            "staging_source_edits_enabled": False,
            "workspace_entitlement": {
                "is_blair": is_blair,
                "can_use_fork_workspaces": can_use_fork,
                "can_use_staging_source_edits": False,
            },
        }

    scoped_root = _scoped_user_workspace_root(tenant_id=tenant_id, user_id=user_scope)
    if requested_path:
        if not _path_inside(requested_path, scoped_root):
            raise ValueError(f"refusing task workspace outside requester scope: {requested_path}")
        path = requested_path
    else:
        path = _task_workspace_path(tenant_id=tenant_id, user_id=user_scope, task_id=task_id)
    return {
        "workspace_mode": "sandbox",
        "workspace_path": path,
        "github_fork_url": None,
        "workspace_isolation_notice": (
            "Workspace isolation active: use this sandbox for PearlOS customization artifacts; "
            "Pearl changes only the requester's PearlOS instance; core PearlOS integration is managed separately."
        ),
        "staging_source_edits_enabled": False,
        "workspace_entitlement": {
            "is_blair": is_blair,
            "can_use_fork_workspaces": can_use_fork,
            "can_use_staging_source_edits": False,
        },
    }


def _validated_workspace_path(
    workspace_path: str | None,
    *,
    tenant_id: str | None,
    user_id: str | None,
) -> str | None:
    if not isinstance(workspace_path, str) or not workspace_path.strip():
        return None
    scoped_root = _scoped_user_workspace_root(tenant_id=tenant_id, user_id=user_id)
    path = os.path.abspath(workspace_path.strip())
    if path != scoped_root and not path.startswith(scoped_root + os.sep):
        raise ValueError(f"refusing task workspace outside requester scope: {path}")
    return path


def _execution_workspace_for_task(task: dict) -> str:
    workspace_mode = str(task.get("workspace_mode") or "").strip()
    workspace = task.get("workspace_path")
    if isinstance(workspace, str) and workspace.strip():
        path = os.path.abspath(workspace)
    else:
        path = _task_workspace_path(
            tenant_id=task.get("requester_tenant_id") or "public",
            user_id=task.get("requester_user_id") or task.get("requester_email") or "anonymous",
            task_id=task.get("id") or _new_id(),
        )
    if workspace_mode == "operator_staging_source":
        return STAGING_SOURCE_ROOT
    if workspace_mode == "staging_source":
        raise ValueError("personal_instance_only")
    root = os.path.abspath(PUBLIC_TASK_ROOT)
    if not _path_inside(path, root):
        raise ValueError(f"refusing task workspace outside {root}: {path}")
    if workspace_mode == "github_fork":
        fork_root = _fork_workspace_root(
            tenant_id=task.get("requester_tenant_id") or "public",
            user_id=task.get("requester_user_id") or task.get("requester_email") or "anonymous",
        )
        if not _path_inside(path, fork_root):
            raise ValueError(f"refusing fork workspace outside requester forks: {path}")
    elif task.get("requester_tenant_id") and (task.get("requester_user_id") or task.get("requester_email")):
        scoped_root = _scoped_user_workspace_root(
            tenant_id=task.get("requester_tenant_id"),
            user_id=task.get("requester_user_id") or task.get("requester_email"),
        )
        if not _path_inside(path, scoped_root):
            raise ValueError(f"refusing requester workspace outside requester scope: {path}")
    _assert_existing_parent_not_symlink(path)
    os.makedirs(path, exist_ok=True)
    if not _real_path_inside(path, root):
        raise ValueError(f"refusing symlinked task workspace outside {root}: {path}")
    return path


def _creation_id_from_workspace(workspace: str) -> str:
    parts = os.path.abspath(workspace).split(os.sep)
    if "creations" not in parts:
        return ""
    idx = len(parts) - 1 - list(reversed(parts)).index("creations")
    if idx + 1 >= len(parts):
        return ""
    creation_id = parts[idx + 1]
    return creation_id if re.match(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", creation_id) else ""


def _public_execution_prompt(task: dict) -> str:
    workspace = _execution_workspace_for_task(task)
    task_text = (task.get("task") or task.get("title") or "").strip()
    workspace_mode = str(task.get("workspace_mode") or "sandbox").strip() or "sandbox"
    isolation_notice = str(task.get("workspace_isolation_notice") or "").strip()
    notice_block = f"Entitlement note: {isolation_notice}\n\n" if isolation_notice else ""
    creation_id = _creation_id_from_workspace(workspace)
    studio_block = (
        "Studio creation contract:\n"
        f"- This workspace is a Studio creation output folder. Create and verify {workspace.rstrip(os.sep)}/index.html.\n"
        f"- Direct play URL: /api/creation/{creation_id}/\n"
        f"- Mark success only after index.html exists and put the PLAY URL in the final result.\n\n"
        if creation_id
        else ""
    )
    return (
        "You are running a public PearlOS user task.\n\n"
        f"Task ID: {task.get('id')}\n"
        f"Tenant ID: {task.get('requester_tenant_id') or 'public'}\n"
        f"User ID: {task.get('requester_user_id') or task.get('requester_email') or 'anonymous'}\n"
        f"Workspace mode: {workspace_mode}\n"
        f"Allowed workspace: {workspace}\n\n"
        f"{notice_block}"
        "Hard safety rules:\n"
        "- Work only inside the allowed workspace above unless the user explicitly asks for read-only public web research.\n"
        "- Do not edit, delete, move, or chmod PearlOS source, deploy, runtime, OpenClaw config, or production files.\n"
        "- Forbidden paths include /workspace/nia-universal, /opt/pearlos, /home/deploy/pearlos, and /root/.openclaw.\n"
        "- If the user asks to customize PearlOS, create sandboxed app files, artifacts, patches, or a GitHub-fork change inside the allowed workspace.\n"
        "- Do not stop with a generic workspace-isolation failure when a sandboxed customization or fork patch can satisfy the request.\n"
        "- Pearl changes only the requester's PearlOS instance; core PearlOS integration is managed separately.\n"
        "- If the requested task requires changing app.pearlos.org or PearlOS production, stop and report that operator approval is required.\n"
        "- Keep all files and outputs for this task inside the allowed workspace.\n\n"
        f"{studio_block}"
        "User task:\n"
        f"{task_text}\n"
    )


def _truncate_title(text: str, limit: int = MAX_TITLE_LEN) -> str:
    t = " ".join((text or "").split())
    return t if len(t) <= limit else t[: limit - 1] + "\u2026"


# When a caller posts a task without an explicit `title`, fall back to a
# short Title-Cased label derived from the meaningful body of the task
# description rather than the raw first few words. Without this, tasks that
# arrive with a giant Agency Playbook system-prompt prefix or a marker like
# "BLAIR APPROVED:" / "RADIANT Build:" produce useless titles that show only
# the prefix and never the actual ask.
import re as _re_titles  # local alias so we don't shadow callers' `re`

# Phrases that mark the start of an Agency / Claude CLI system-prompt block.
# When a task body opens with one of these we treat everything up to the next
# blank line (or "## TASK" / "---" delimiter) as boilerplate and look past it.
_PROMPT_BOILERPLATE_MARKERS = (
    "claude cli orchestration prompt",
    "agency playbook",
    "you are the orchestrator",
    "you are pearl",
    "you are claude",
    "you are an orchestrator",
)

# Marker prefixes that prepend administrative framing but say nothing about
# what the task actually does. Strip them so the title surfaces the real ask.
# Patterns are applied repeatedly so chains like
# "IMPORTANT: BLAIR APPROVED: RADIANT Build: Fix X" collapse cleanly.
_LEADING_MARKER_PATTERNS = (
    _re_titles.compile(r"^\s*blair\s+approved\s+policy\s+update\s*[:\-]?\s*", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*blair\s+approved\s*[:\-]?\s*", _re_titles.IGNORECASE),
    # "IMPORTANT" / "CRITICAL" / "URGENT" with or without trailing colon.
    # We only strip when the next token is lowercase ("IMPORTANT context for..."),
    # an explicit colon, or another marker — so we don't accidentally eat a
    # legitimate single-word noun.
    _re_titles.compile(r"^\s*important\s*[:\-]\s*", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*critical\s*[:\-]\s*", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*urgent\s*[:\-]\s*", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*emergency\s*[:\-]\s*", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*important\s+(?=[a-z])", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*critical\s+(?=[a-z])", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*urgent\s+(?=[a-z])", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*sub[-\s]?task\s+of\s+disp-[a-z0-9]+\.?\s*", _re_titles.IGNORECASE),
    _re_titles.compile(r"^\s*voice\s+follow[-\s]?up\s*[:\-]\s*", _re_titles.IGNORECASE),
    # "RADIANT Build:", "DOLPHIN Build:", "PearlOS DOLPHIN Build:" style markers.
    _re_titles.compile(r"^\s*(?:pearlos\s+)?[A-Z][A-Z0-9]{2,}\s+build\s*[:\-]\s*", _re_titles.IGNORECASE),
    # "context for the RADIANT build:" or "context for the RADIANT:" framing.
    _re_titles.compile(r"^\s*context\s+for\s+the\s+[A-Za-z][A-Za-z0-9]+(?:\s+build)?\s*[:\-]?\s*", _re_titles.IGNORECASE),
)

# Connector / stop words we never want to leave dangling at the end of a title.
_TRAILING_STOP_WORDS = {
    "and", "or", "but", "the", "a", "an", "of", "to", "in", "on",
    "for", "with", "by", "at", "from", "as", "if", "is", "are",
    "was", "were", "be", "been", "being", "this", "that", "these",
    "those", "it", "its", "into", "onto", "via",
}

# Minor words we should NOT capitalize when title-casing (unless they're the
# first word). Keeps titles reading like English instead of "Fix The And Of".
_LOWERCASE_TITLE_WORDS = {
    "a", "an", "and", "or", "but", "the", "of", "to", "in", "on",
    "for", "with", "by", "at", "from", "as", "if", "is", "vs",
    "via", "per",
}


def _strip_prompt_boilerplate(text: str) -> str:
    """Remove a leading system-prompt block from a raw task body.

    The Agency Playbook prepends a multi-paragraph orchestration prompt to
    every dispatched task. The real instruction lives after a "## TASK" /
    "---" delimiter, or after the first blank line if the opening lines look
    like prompt boilerplate. This function returns just the meaningful tail.
    """
    if not text:
        return ""
    raw = text.replace("\r\n", "\n").replace("\r", "\n")

    # Explicit delimiter wins: "## TASK" or "---" with the actual ask after.
    for delim_pattern in (r"\n\s*##\s*TASK\s*\n", r"\n\s*---\s*\n"):
        m = _re_titles.search(delim_pattern, raw, _re_titles.IGNORECASE)
        if m:
            tail = raw[m.end():].strip()
            # If the tail is itself just another header (e.g. "## TASK\n\n##"),
            # strip the second header too.
            tail = _re_titles.sub(r"^\s*##\s*TASK\s*\n+", "", tail, flags=_re_titles.IGNORECASE)
            if tail:
                raw = tail
                break

    # If the opening still looks like a markdown header or a prompt marker,
    # keep peeling off paragraphs (separated by blank lines) until the next
    # paragraph no longer matches a boilerplate marker. Some prompts run
    # multiple paragraphs of "You are X. Do Y." before the real task.
    for _ in range(8):  # safety bound on the unwrap loop
        head = raw.lstrip()
        if not head:
            break
        head_lower = head.lower()
        looks_like_prompt = (
            head.startswith("#")
            or any(head_lower.startswith(m) for m in _PROMPT_BOILERPLATE_MARKERS)
        )
        if not looks_like_prompt:
            break
        parts = _re_titles.split(r"\n\s*\n", head, maxsplit=1)
        if len(parts) != 2 or not parts[1].strip():
            break
        raw = parts[1]

    # Drop any remaining leading markdown header / blank lines.
    lines = raw.split("\n")
    while lines and (lines[0].strip().startswith("#") or not lines[0].strip()):
        lines.pop(0)
    raw = "\n".join(lines).strip()

    return raw


def _strip_leading_markers(text: str) -> str:
    """Strip non-content marker prefixes like 'BLAIR APPROVED:' or 'RADIANT Build:'."""
    s = (text or "").strip()
    if not s:
        return ""
    # Apply repeatedly so chains like "IMPORTANT: BLAIR APPROVED: Fix X" collapse.
    changed = True
    while changed:
        changed = False
        for pat in _LEADING_MARKER_PATTERNS:
            new_s = pat.sub("", s, count=1)
            if new_s != s:
                s = new_s.lstrip()
                changed = True
    return s


def _smart_title_case(text: str) -> str:
    """Title-case `text` but keep minor words lowercase (except as the first word)."""
    parts = text.split()
    out: list[str] = []
    for idx, w in enumerate(parts):
        # Preserve ALL-CAPS acronyms (RADIANT, DOLPHIN, API, UI) if 2+ uppercase
        # letters and no lowercase letters in the word stem.
        stem = _re_titles.sub(r"[^A-Za-z]", "", w)
        if len(stem) >= 2 and stem.isupper():
            out.append(w)
            continue
        lw = w.lower()
        if idx > 0 and lw in _LOWERCASE_TITLE_WORDS:
            out.append(lw)
        else:
            # Capitalise just the first letter; keep internal casing.
            if w:
                out.append(w[:1].upper() + w[1:].lower() if w[1:].islower() or w[1:] == "" else w[:1].upper() + w[1:])
            else:
                out.append(w)
    return " ".join(out)


def _strip_trailing_connectors(text: str) -> str:
    """Drop trailing stop words / numbered-list openers from a title fragment."""
    cur = (text or "").rstrip(" ,;:")
    while True:
        words = cur.split()
        if not words:
            return cur
        last = words[-1].lower().rstrip(".,;:")
        last_stripped = last.strip("()")
        is_numbered = bool(_re_titles.match(r"^\(?\d+\)?\.?$", last_stripped))
        if last in _TRAILING_STOP_WORDS or is_numbered:
            cur = " ".join(words[:-1]).rstrip(" ,;:")
            continue
        return cur


def _trim_to_word_boundary(text: str, limit: int) -> str:
    """Trim `text` to <= limit chars without cutting mid-word; drop trailing connectors."""
    cleaned = _strip_trailing_connectors(text)
    if len(cleaned) <= limit:
        return cleaned
    # Walk back from `limit` to the previous space.
    cut = cleaned[:limit].rsplit(" ", 1)[0] if " " in cleaned[:limit] else cleaned[:limit]
    cut = _strip_trailing_connectors(cut)
    if not cut:
        cut = cleaned[:limit].rstrip()
    return cut + "\u2026"


# ---------------------------------------------------------------------------
# Action-phrase extraction: scans for common task patterns so long
# conversational prompts don't produce useless titles like the first 9 words
# of "Before we execute, save and commit everything as…"
# ---------------------------------------------------------------------------
_ACTION_PATTERNS = (
    # Build/create/make a [thing] — only when the verb is near the start
    (r"(?i)^\s*(?:create|build|make|develop|implement)\s+(?:a\s+|an\s+)?\b(.{3,80}?)(?:\.|$|\n)",
     lambda m: "Build " + m.group(1).strip().rstrip(".")),
    # Fix/resolve/repair [issue]
    (r"(?i)^\s*(?:fix|resolve|repair|patch)\s+(?:the\s+)?\b(.{3,80}?)(?:\.|$|\n)",
     lambda m: "Fix " + m.group(1).strip().rstrip(".")),
    # Research/investigate [topic]
    (r"(?i)^\s*(?:research|investigate|explore|look\s+into)\s+(?:the\s+)?\b(.{3,80}?)(?:\.|$|\n)",
     lambda m: "Research " + m.group(1).strip().rstrip(".")),
    # Write/post/send [message]/[content] — direct action at start
    (r"(?i)^\s*(?:write|post|send|publish)\s+(?:a\s+|an\s+)?\b(.{3,80}?)(?:\.|$|\n)",
     lambda m: "Send " + m.group(1).strip().rstrip(".")),
    # Deploy/launch/push/release [thing]
    (r"(?i)^\s*(?:deploy|launch|push|release)\s+(?:the\s+)?\b(.{3,80}?)(?:\.|$|\n)",
     lambda m: "Deploy " + m.group(1).strip().rstrip(".")),
    # Update/upgrade/modify [thing]
    (r"(?i)^\s*(?:update|upgrade|modify|change)\s+(?:the\s+)?\b(.{3,80}?)(?:\.|$|\n)",
     lambda m: "Update " + m.group(1).strip().rstrip(".")),
    # Ensure/make sure [outcome]
    (r"(?i)^\s*(?:ensure|make\s+sure)\s+(?:that\s+)?\b(.{3,110}?)(?:\.|$|\n)",
     lambda m: "Ensure " + m.group(1).strip().rstrip(".")),
    # Add/install/set up/configure [thing]
    (r"(?i)^\s*(?:add|install|set\s+up|configure)\s+(?:a\s+|an\s+|the\s+)?\b(.{3,80}?)(?:\.|$|\n)",
     lambda m: "Add " + m.group(1).strip().rstrip(".")),
    # Mid-text patterns for long conversational prompts — scan for
    # imperative phrases inside the body text, anchored to sentence breaks
    (r"(?i)[\.!?]\s+(?:please\s+)?(?:create|build|make|develop|implement)\s+(?:a\s+|an\s+|the\s+)?\b(.{3,80})",
     lambda m: "Build " + m.group(1).strip().rstrip(".")),
    (r"(?i)[\.!?]\s+(?:please\s+)?(?:fix|resolve|repair|patch)\s+(?:the\s+)?\b(.{3,80})",
     lambda m: "Fix " + m.group(1).strip().rstrip(".")),
    (r"(?i)[\.!?]\s+(?:please\s+)?(?:research|investigate|explore)\s+(?:the\s+)?\b(.{3,80})",
     lambda m: "Research " + m.group(1).strip().rstrip(".")),
    (r"(?i)[\.!?]\s+(?:please\s+)?(?:ensure|make\s+sure)\s+(?:that\s+)?\b(.{3,110})",
     lambda m: "Ensure " + m.group(1).strip().rstrip(".")),
)


def _extract_action_title(body: str) -> str | None:
    """Try to extract a concise action+object title from the cleaned body."""
    for pattern, fmt in _ACTION_PATTERNS:
        m = _re_titles.search(pattern, body)
        if m:
            title = fmt(m)
            # Keep it short — first sentence only, drop noise words
            title = title.strip()
            # Truncate at any internal sentence boundary
            end = _re_titles.search(r"[\.!?]", title)
            if end and end.start() > 3:  # don't trim a leading "Dr." etc
                title = title[: end.start()]
            # Cap wordiness without reducing the label to a vague fragment.
            words = title.split()
            if len(words) > 20:
                title = " ".join(words[:20])
            if len(title) >= 10:  # must be substantial
                return title
    return None


def _short_title_from_task(text: str, max_words: int = 20, limit: int = MAX_TITLE_LEN) -> str:
    if not text:
        return ""
    # Step 1: peel off the system-prompt block, if any.
    body = _strip_prompt_boilerplate(text)
    # Step 2: peel off leading marker prefixes ("BLAIR APPROVED:", etc.).
    body = _strip_leading_markers(body)
    # Step 3: drop quotes that would render as visual noise on a tile.
    body = body.replace("'", "").replace('"', "").replace("`", "")
    # Step 4: collapse whitespace.
    body = " ".join(body.split())
    if not body:
        # Fallback: even after stripping, give *something* back rather than empty.
        body = " ".join((text or "").replace("'", "").replace('"', "").split())
    if not body:
        return ""

    # Step 4.5: try action-phrase extraction first (handles long conversational prompts).
    action_title = _extract_action_title(body)
    if action_title:
        titled = _smart_title_case(action_title)
        return _trim_to_word_boundary(titled, limit)

    # First sentence boundary (".", "!", "?", or newline collapsed earlier).
    sentence_match = _re_titles.search(r"[\.!?]\s", body)
    sentence = body[: sentence_match.start()].strip() if sentence_match else body
    # If the "sentence" is huge (single paragraph with no punctuation), still
    # trim it; word_boundary handles the cutoff.
    words = sentence.split()
    if len(words) > max_words:
        sentence = " ".join(words[:max_words])
    titled = _smart_title_case(sentence)
    return _trim_to_word_boundary(titled, limit)


def _title_looks_like_prompt_snippet(title: str, task: str) -> bool:
    """Return true when a supplied title is just prompt chrome or a raw prefix."""
    title_clean = " ".join((title or "").split()).strip()
    task_clean = " ".join((task or "").split()).strip()
    if not title_clean:
        return True
    lower = title_clean.lower()
    if lower in _GENERIC_TITLE_BLOCKLIST:
        return True
    if len(title_clean.split()) <= 2 and len(task_clean.split()) > 6:
        return True
    if task_clean.lower().startswith(lower) and len(task_clean) > len(title_clean) + 20:
        return True
    if any(lower.startswith(marker) for marker in _PROMPT_BOILERPLATE_MARKERS):
        return True
    if _strip_leading_markers(title_clean) != title_clean:
        return True
    return False


def _canonical_task_title(task: str, title: Optional[str] = None) -> str:
    """Choose the visible task name from the real task body, not random snippets."""
    generated = _short_title_from_task(task) or _truncate_title(task)
    supplied = _truncate_title(title or "")
    if not supplied or _title_looks_like_prompt_snippet(supplied, task):
        return generated
    return supplied


# ---------------------------------------------------------------------------
# Event bus — broadcasts task create/update events to subscribers (SSE, etc.)
# ---------------------------------------------------------------------------
class TaskEventBus:
    """Minimal fan-out pub/sub for task change events.

    Subscribers (SSE connections, webhook dispatchers, anything wanting push
    notifications) register an ``asyncio.Queue`` via ``subscribe()`` and read
    JSON-serializable envelopes off it. ``publish()`` is safe to call from a
    synchronous context (TaskStore lives in worker threads) — it hands off to
    the registered event loop with ``call_soon_threadsafe``.
    """

    def __init__(self) -> None:
        self._subs: set[asyncio.Queue] = set()
        self._lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        # Called from the FastAPI lifespan once the main loop is known so we
        # can safely hand off cross-thread publishes.
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        with self._lock:
            self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._subs.discard(q)

    def publish(self, envelope: dict) -> None:
        # Snapshot subscribers so we don't hold the lock during I/O.
        with self._lock:
            subs = list(self._subs)
        if not subs:
            return
        loop = self._loop
        for q in subs:
            def _put(queue: asyncio.Queue = q, env: dict = envelope) -> None:
                try:
                    queue.put_nowait(env)
                except asyncio.QueueFull:
                    # Slowest subscriber wins: drop the envelope rather than
                    # blocking the publisher. We never let a stuck SSE client
                    # stall dispatch.
                    pass
            if loop and loop.is_running():
                loop.call_soon_threadsafe(_put)
            else:
                # No loop yet (startup path) — best effort direct.
                _put()


_event_bus = TaskEventBus()


def get_event_bus() -> TaskEventBus:
    return _event_bus


# ---------------------------------------------------------------------------
# Storage — append-only JSONL + in-memory index
# ---------------------------------------------------------------------------
class TaskStore:
    """Thread-safe, append-only task log with in-memory index."""

    def __init__(self, log_path: str):
        self.log_path = log_path
        self._lock = threading.RLock()
        self._index: dict[str, dict] = {}
        os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
        self._load()

    # -- disk helpers -------------------------------------------------------

    def _append_event(self, event: dict) -> None:
        line = json.dumps(event, ensure_ascii=False)
        # Atomic-ish: single write call, flush+fsync so we survive a crash.
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass

    def _load(self) -> None:
        if not os.path.exists(self.log_path):
            logger.info(f"[tasks] No task log at {self.log_path}; starting empty")
            return
        with open(self.log_path, "r", encoding="utf-8") as f:
            for lineno, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError as e:
                    logger.warning(
                        f"[tasks] Skipping malformed line {lineno}: {e}"
                    )
                    continue
                self._apply_event(event)
        # Defensive backfill: older records (especially swarm starts that
        # passed an unbounded `title`) sometimes hold the full task text in
        # the title field. Trim them in memory so the widget never renders a
        # multi-paragraph card. We don't rewrite the log — the create event is
        # historical truth and downstream consumers can still derive the full
        # text from the `task` field.
        for record in self._index.values():
            t = record.get("title")
            if isinstance(t, str) and len(t) > MAX_TITLE_LEN:
                record["title"] = _truncate_title(t)
            if not record.get("full_title"):
                record["full_title"] = record.get("title") or _canonical_task_title(record.get("task") or "")
        logger.info(
            f"[tasks] Loaded {len(self._index)} task(s) from {self.log_path}"
        )

    def _apply_event(self, event: dict) -> None:
        """Fold a single event into the in-memory index."""
        kind = event.get("kind")
        tid = event.get("id")
        if not tid:
            return
        if kind == "create":
            task = event.get("task") or {}
            if task.get("id"):
                self._index[task["id"]] = task
            else:
                # Legacy events may have flattened the record.
                task = {k: v for k, v in event.items() if k != "kind"}
                self._index[tid] = task
        elif kind == "update":
            existing = self._index.get(tid)
            if not existing:
                return
            patch = event.get("patch") or {}
            for k, v in patch.items():
                if k == "notes_append" and v:
                    notes = list(existing.get("notes") or [])
                    notes.append(v)
                    existing["notes"] = notes
                elif k == "agent_activity_merge" and isinstance(v, dict):
                    current = dict(existing.get("agent_activity") or {})
                    for agent_id, activity in v.items():
                        if isinstance(activity, dict):
                            current[str(agent_id)] = {
                                **(current.get(str(agent_id)) or {}),
                                **activity,
                            }
                    existing["agent_activity"] = current
                else:
                    existing[k] = v
            existing["timestamp_updated"] = event.get("ts", _iso_now())

    # -- public API ---------------------------------------------------------

    def create(
        self,
        task: str,
        source: Source = "web_chat",
        created_by: CreatedBy = "pearl",
        assignee: Optional[Assignee] = "claude_cli",
        urgency: Urgency = "normal",
        title: Optional[str] = None,
        task_id: Optional[str] = None,
        kind: Optional[str] = None,
        agents: Optional[list[str]] = None,
        swarm_category: Optional[str] = None,
        status: Optional[str] = None,
        requester_email: Optional[str] = None,
        requester_user_id: Optional[str] = None,
        requester_tenant_id: Optional[str] = None,
        requester_tenant_role: Optional[str] = None,
        discord_channel_id: Optional[str] = None,
        discord_message_id: Optional[str] = None,
        discord_user_id: Optional[str] = None,
        discord_username: Optional[str] = None,
        discord_guild_id: Optional[str] = None,
        discord_channel_name: Optional[str] = None,
        workspace_path: Optional[str] = None,
        workspace_mode: Optional[WorkspaceMode] = None,
        github_fork_url: Optional[str] = None,
        workspace_isolation_notice: Optional[str] = None,
        staging_source_edits_enabled: Optional[bool] = None,
        max_retries: Optional[int] = None,
        timeout_s: Optional[float] = None,
        execution_mode: Optional[ExecutionMode] = None,
    ) -> dict:
        task = (task or "").strip()
        if not task:
            raise ValueError("task description is required")
        has_requester_identity = bool(requester_user_id or requester_email)
        if has_requester_identity and not requester_tenant_id:
            raise ValueError("requester_tenant_id_required")
        _validate_public_origin_task_scope(
            source=source,
            created_by=created_by,
            requester_email=requester_email,
            requester_user_id=requester_user_id,
            requester_tenant_id=requester_tenant_id,
        )
        tid = task_id or _new_id()
        now = _iso_now()
        user_facing_scope = bool(requester_tenant_id and (requester_user_id or requester_email))
        if (
            user_facing_scope
            and not workspace_mode
            and not workspace_path
            and _operator_staging_source_available(requester_user_id, requester_email)
            and _looks_like_pearlos_source_task(task, title)
        ):
            workspace_mode = "operator_staging_source"
        if (
            user_facing_scope
            and not workspace_mode
            and not workspace_path
            and _looks_like_studio_creation_task(task, title)
        ):
            creation_id = _studio_creation_id()
            workspace_path = _studio_creation_workspace_path(
                tenant_id=requester_tenant_id,
                user_id=requester_user_id or requester_email or "anonymous",
                creation_id=creation_id,
            )
            task = _studio_creation_prompt(task, output_path=workspace_path, creation_id=creation_id)
        if user_facing_scope or workspace_path or workspace_mode:
            workspace_resolution = _resolve_workspace_entitlement(
                tenant_id=requester_tenant_id or "public",
                user_id=requester_user_id,
                email=requester_email,
                tenant_role=requester_tenant_role,
                task_id=tid,
                workspace_mode=workspace_mode,
                workspace_path=workspace_path,
                github_fork_url=github_fork_url,
            )
        else:
            # Preserve legacy internal/operator tasks: they keep running from
            # PEARL_WORKER_CWD (/workspace/nia-universal by default) because
            # they have no requester identity and are not user-facing.
            workspace_resolution = {
                "workspace_mode": "internal_source",
                "workspace_path": _task_workspace_path(
                    tenant_id=requester_tenant_id or "public",
                    user_id=requester_user_id or requester_email or "anonymous",
                    task_id=tid,
                ),
                "github_fork_url": None,
                "workspace_isolation_notice": None,
                "staging_source_edits_enabled": False,
                "workspace_entitlement": {
                    "is_blair": False,
                    "can_use_fork_workspaces": False,
                    "can_use_staging_source_edits": False,
                },
            }
        workspace_path = workspace_resolution["workspace_path"]
        if workspace_resolution["workspace_mode"] not in ("staging_source", "operator_staging_source"):
            _assert_existing_parent_not_symlink(workspace_path)
            os.makedirs(workspace_path, exist_ok=True)
            if not _real_path_inside(workspace_path, PUBLIC_TASK_ROOT):
                raise ValueError(f"refusing symlinked task workspace outside {PUBLIC_TASK_ROOT}: {workspace_path}")
        workspace_isolation_notice = (
            workspace_isolation_notice
            if workspace_isolation_notice is not None
            else workspace_resolution.get("workspace_isolation_notice")
        )
        canonical_title = _canonical_task_title(task, title)
        discord_metadata = {
            "discord_channel_id": _clean_task_metadata_id(discord_channel_id),
            "discord_message_id": _clean_task_metadata_id(discord_message_id),
            "discord_user_id": _clean_task_metadata_id(discord_user_id),
            "discord_username": _clean_task_metadata_text(discord_username),
            "discord_guild_id": _clean_task_metadata_id(discord_guild_id),
            "discord_channel_name": _clean_task_metadata_text(discord_channel_name),
        }
        record = {
            "id": tid,
            "timestamp_created": now,
            "timestamp_updated": now,
            "source": source,
            "created_by": created_by,
            "requester_email": requester_email,
            "requester_user_id": requester_user_id,
            "requester_tenant_id": requester_tenant_id or "public",
            "requester_tenant_role": requester_tenant_role,
            **{key: value for key, value in discord_metadata.items() if value},
            "workspace_mode": workspace_resolution["workspace_mode"],
            "workspace_path": workspace_path,
            "github_fork_url": workspace_resolution.get("github_fork_url"),
            "workspace_isolation_notice": workspace_isolation_notice,
            "workspace_entitlement": workspace_resolution.get("workspace_entitlement"),
            "staging_source_edits_enabled": bool(
                staging_source_edits_enabled
                if staging_source_edits_enabled is not None
                else workspace_resolution.get("staging_source_edits_enabled")
            ),
            "protected_paths": list(PROTECTED_RUNTIME_PATHS),
            "assignee": assignee,
            "title": canonical_title,
            "full_title": canonical_title,
            "task": task,
            "urgency": urgency if urgency in ("normal", "urgent") else "normal",
            "emergency": False,
            "status": status if status in (
                "pending", "in_progress", "completed", "failed", "cancelled", "archived"
            ) else "pending",
            "notes": [],
            "completed_at": None,
            "result": None,
            "retry_count": 0,
            "max_retries": max(0, int(max_retries)) if max_retries is not None else None,
            "timeout_s": float(timeout_s) if timeout_s is not None else None,
            "execution_mode": execution_mode,
            "executor_requested": None,
            "executor_effective": None,
            "last_failure_at": None,
            "last_failure_result": None,
                "result_notified_at": None,
                "suppress_result_notification": False,
                "webhook_notified_at": None,
                "note_filename": None,
                "file_space_path": None,
                "claimed_by": None,
                "claim_started_at": None,
            # Swarm bridge: lets the ActiveJobs widget tell CLI tasks (kind='task')
            # apart from OpenRouter swarms (kind='swarm') and render an agent
            # emoji row with live "thinking" bubbles per agent.
            "kind": kind or "task",
            "agents": [str(a) for a in (agents or []) if a],
            "swarm_category": swarm_category,
            # agent_activity: { "<agent_id>": { "status": "running|done|failed",
            #                                    "thought": "<partial text>",
            #                                    "updated_at": "<iso>" } }
            "agent_activity": {},
        }
        with self._lock:
            if tid in self._index:
                raise ValueError(f"task {tid} already exists")
            event = {"kind": "create", "id": tid, "ts": now, "task": record}
            self._append_event(event)
            self._apply_event(event)
            snapshot = dict(self._index[tid])
        try:
            _event_bus.publish({
                "event": "created",
                "ts": now,
                "task": snapshot,
            })
        except Exception as e:  # pragma: no cover — pub/sub must never break writes
            logger.warning(f"[tasks] event publish failed (created): {e}")
        return dict(record)

    def get(self, task_id: str) -> Optional[dict]:
        self.ensure_failed_note_delivery(task_id)
        with self._lock:
            t = self._index.get(task_id)
            return dict(t) if t else None

    def ensure_failed_note_delivery(self, task_id: str) -> Optional[dict]:
        """Backfill note_filename for an old failed result task.

        A prior bug left failed user-facing tasks with result text but no Note
        link. Keep this repair narrow and avoid mutating old completed tasks
        during routine status polling.
        """
        now = _iso_now()
        with self._lock:
            current = self._index.get(task_id)
            if current is None:
                return None
            if current.get("status") != "failed":
                return dict(current)
            if not _task_result_note_eligible(current):
                return dict(current)
            nf = _deliver_task_note(current)
            if not nf:
                return dict(current)
            event = {
                "kind": "update",
                "id": task_id,
                "ts": now,
                "patch": {"note_filename": nf},
            }
            self._append_event(event)
            self._apply_event(event)
            snapshot = dict(self._index[task_id])
        try:
            _event_bus.publish({
                "event": "updated",
                "ts": now,
                "patch": {"note_filename": nf},
                "task": snapshot,
            })
        except Exception as e:  # pragma: no cover
            logger.warning(f"[tasks] event publish failed (note backfill): {e}")
        return snapshot

    def list(
        self,
        status: Optional[str] = None,
        assignee: Optional[str] = None,
        source: Optional[str] = None,
        urgency: Optional[str] = None,
        requester_email: Optional[str] = None,
        requester_user_id: Optional[str] = None,
        requester_tenant_id: Optional[str] = None,
        limit: int = 500,
        include_archived: bool = False,
    ) -> list[dict]:
        with self._lock:
            items = list(self._index.values())
        if status:
            # Callers that explicitly ask for archived/cancelled tasks must
            # still get them even when include_archived is false (backwards compat).
            items = [t for t in items if t.get("status") == status]
        elif not include_archived:
            # Default list view hides archived AND cancelled records — both
            # are soft-deleted from the user's perspective, so they should
            # disappear from the active widget after DELETE. The archive modal
            # passes include_archived=True to surface them again.
            items = [t for t in items if t.get("status") not in ("archived", "cancelled")]
        if assignee:
            items = [t for t in items if t.get("assignee") == assignee]
        if source:
            items = [t for t in items if t.get("source") == source]
        if urgency:
            items = [t for t in items if t.get("urgency") == urgency]
        if (requester_user_id or requester_email) and not requester_tenant_id:
            return []
        if requester_user_id and requester_email:
            wanted = requester_email.strip().lower()
            items = [
                t for t in items
                if t.get("requester_user_id") == requester_user_id
                or (t.get("requester_email") or "").strip().lower() == wanted
            ]
        elif requester_user_id:
            items = [t for t in items if t.get("requester_user_id") == requester_user_id]
        elif requester_email:
            wanted = requester_email.strip().lower()
            items = [t for t in items if (t.get("requester_email") or "").strip().lower() == wanted]
        if requester_tenant_id:
            wanted_tenant = requester_tenant_id.strip()
            items = [
                t for t in items
                if str(t.get("requester_tenant_id") or "public").strip() == wanted_tenant
            ]
        # Newest first by created timestamp
        items.sort(key=lambda t: t.get("timestamp_created", ""), reverse=True)
        selected = items[:limit]
        return [dict(task) for task in selected]

    def update(self, task_id: str, patch: dict) -> Optional[dict]:
        """Apply a partial update to a task. Allowed fields:
        status, assignee, result, title, urgency, notes_append, no_retry.

        Auto-requeue: when a caller sets status=failed we bump the task's
        retry_count and, while we're still under PEARL_TASKS_MAX_RETRIES,
        rewrite the patch to set status=pending instead so the task goes back
        into the queue. The original failure is captured in last_failure_result
        / last_failure_at and appended as a note so the audit trail is intact.
        Failed tasks are never deleted or purged — once retries are exhausted
        the task stays with status=failed in the index.
        """
        allowed = {
            "status", "assignee", "result", "title", "urgency", "emergency",
            "notes_append", "retry_count", "last_failure_at",
            "last_failure_result", "result_notified_at", "webhook_notified_at",
            "suppress_result_notification",
            "note_filename", "file_space_path",
            "executor_requested", "executor_effective",
            "expected_status", "claim_worker", "claimed_by", "claim_started_at",
            "no_retry",
            # Swarm bridge fields — set by pearl-swarm-dispatch as agents
            # join/update/finish so the widget can render live activity.
            "kind", "agents", "swarm_category", "agent_activity",
            # Merge-update for agent_activity: callers send
            # { "agent_activity_merge": { "<agent>": {...} } } and the store
            # shallow-merges into the existing dict instead of replacing it.
            "agent_activity_merge",
        }
        clean: dict[str, Any] = {}
        for k, v in (patch or {}).items():
            if k in allowed:
                clean[k] = v
        if not clean:
            # Nothing to do; return current
            return self.get(task_id)

        # Title updates must stay display-sized, not arbitrary prompt dumps.
        if "title" in clean and isinstance(clean["title"], str):
            clean["title"] = _truncate_title(clean["title"])
            clean["full_title"] = clean["title"]
        raw_result_for_outputs = clean.get("result") if "result" in clean else None
        if "result" in clean:
            clean["result"] = _public_task_result(clean["result"])
        if isinstance(clean.get("notes_append"), dict):
            note_text = str(clean["notes_append"].get("text") or "").strip()
            if note_text:
                clean["notes_append"] = {
                    **clean["notes_append"],
                    "text": _public_task_result(note_text),
                }

        # Validate status transitions lightly.
        if "status" in clean and clean["status"] not in (
            "pending", "in_progress", "completed", "failed", "cancelled", "archived"
        ):
            raise ValueError(f"invalid status: {clean['status']}")

        now = _iso_now()

        # -- Auto-requeue interceptor ---------------------------------------
        # Done under the lock so retry_count is consistent across racing
        # workers that might both mark the same task failed.
        requeue_info: Optional[dict[str, Any]] = None
        with self._lock:
            current = self._index.get(task_id)
            if current is None:
                return None

            current_status = str(current.get("status") or "")
            expected_status = clean.pop("expected_status", None)
            claim_worker = clean.pop("claim_worker", None)
            if expected_status and current_status != str(expected_status):
                raise ValueError(
                    f"status_conflict: expected {expected_status}, found {current_status}"
                )
            if claim_worker and clean.get("status") == "in_progress":
                clean["claimed_by"] = str(claim_worker)[:160]
                clean["claim_started_at"] = now
            terminal_statuses = {"completed", "failed", "cancelled", "archived"}
            status_target = clean.get("status")
            if (
                current_status in terminal_statuses
                and status_target == "pending"
                and not clean.get("assignee")
                and not clean.get("emergency")
            ):
                logger.warning(
                    f"[tasks] preserving terminal status for {task_id}: "
                    f"refusing passive pending patch on {current_status} task"
                )
                clean.pop("status", None)

            status_target = clean.get("status")
            if status_target and status_target not in terminal_statuses and current.get("completed_at"):
                clean["completed_at"] = None

            if clean.get("status") == "failed":
                prior_retries = int(current.get("retry_count") or 0)
                new_retries = prior_retries + 1
                try:
                    max_retries = max(0, int(current.get("max_retries")))
                except (TypeError, ValueError):
                    max_retries = _max_retries()
                failure_text = _public_task_result(clean.get("result") or "(no error detail provided)")
                no_retry = bool(clean.pop("no_retry", False))
                # Stamp failure diagnostics on the task regardless of whether we
                # requeue or give up — Blair needs to see what went wrong.
                clean["retry_count"] = new_retries
                clean["last_failure_at"] = now
                clean["last_failure_result"] = failure_text
                if no_retry:
                    note_text = (
                        f"Attempt #{new_retries} failed: {failure_text}. "
                        f"Marked failed without retry because this is a permanent executor error."
                    )
                    note_kind = "failure"
                elif new_retries <= max_retries:
                    note_text = (
                        f"Attempt #{new_retries} failed: {failure_text}. "
                        f"Auto-requeued as pending for retry."
                    )
                    note_kind = "internal_retry"
                else:
                    note_text = (
                        f"Attempt #{new_retries} failed: {failure_text}. "
                        f"Retry budget of {max_retries} exhausted — leaving "
                        f"task in failed state (record preserved)."
                    )
                    note_kind = "failure"
                failure_note = {"ts": now, "text": _public_task_result(note_text), "kind": note_kind}
                # If the caller supplied their own note we keep both: their
                # note rides along in this event's patch, and the failure
                # note is emitted as a second event below so both land in
                # the log (and in the task's notes list) in order.
                caller_note = clean.pop("notes_append", None)
                if caller_note:
                    clean["notes_append"] = caller_note
                    _extra_failure_note_event = failure_note
                else:
                    clean["notes_append"] = failure_note
                    _extra_failure_note_event = None

                if no_retry:
                    requeue_info = {
                        "requeued": False,
                        "retry_count": new_retries,
                        "max_retries": max_retries,
                        "failure_result": failure_text,
                        "no_retry": True,
                    }
                elif new_retries <= max_retries:
                    # Auto-requeue: flip status back to pending so workers pick
                    # it up again. Don't stamp completed_at.
                    clean["status"] = "pending"
                    requeue_info = {
                        "requeued": True,
                        "retry_count": new_retries,
                        "max_retries": max_retries,
                        "failure_result": failure_text,
                    }
                else:
                    # Retry budget exhausted — leave as failed, stamp
                    # completed_at below.
                    requeue_info = {
                        "requeued": False,
                        "retry_count": new_retries,
                        "max_retries": max_retries,
                        "failure_result": failure_text,
                    }
            else:
                _extra_failure_note_event = None

            # If moving to terminal (and we didn't just requeue), stamp
            # completed_at. Archiving preserves any existing completed_at
            # stamp rather than overwriting it.
            terminal = {"completed", "failed", "cancelled"}
            if clean.get("status") in terminal:
                clean["completed_at"] = now
                if clean.get("status") == "completed":
                    result_text = str(
                        raw_result_for_outputs
                        if raw_result_for_outputs is not None
                        else clean.get("result") or current.get("result") or ""
                    )
                    file_space_path = _promote_filespace_outputs({**current, **clean}, result_text)
                    if file_space_path:
                        clean["file_space_path"] = file_space_path
                # Auto-deliver terminal task results as notes. Failed tasks get
                # a readable note too, so the UI never opens a blank Notes
                # window as the only explanation of a blocker.
                if clean.get("status") in ("completed", "failed"):
                    result_text = str(clean.get("result") or current.get("result") or "")
                    merged = {**current, **clean, "result": result_text}
                    if _task_result_note_eligible(merged):
                        nf = _deliver_task_note(merged)
                        if nf:
                            clean["note_filename"] = nf
            elif not clean.get("status") and current_status == "completed" and "result" in clean:
                merged = {**current, **clean}
                if _task_result_note_eligible(merged):
                    nf = _deliver_task_note(merged)
                    if nf:
                        clean["note_filename"] = nf
            elif clean.get("status") == "archived" and not current.get("completed_at"):
                clean["completed_at"] = now

            event = {"kind": "update", "id": task_id, "ts": now, "patch": clean}
            self._append_event(event)
            self._apply_event(event)
            # If a caller-supplied note needed to coexist with the failure
            # note, emit the failure note as a second event so both are
            # visible in the log and index.
            if _extra_failure_note_event is not None:
                second = {
                    "kind": "update",
                    "id": task_id,
                    "ts": now,
                    "patch": {"notes_append": _extra_failure_note_event},
                }
                self._append_event(second)
                self._apply_event(second)
            snapshot = dict(self._index[task_id])
        # Broadcast outside the lock so SSE subscribers never stall writers.
        try:
            envelope: dict[str, Any] = {
                "event": "updated",
                "ts": now,
                "patch": clean,
                "task": snapshot,
            }
            if requeue_info is not None:
                envelope["requeue"] = requeue_info
            _event_bus.publish(envelope)
        except Exception as e:  # pragma: no cover
            logger.warning(f"[tasks] event publish failed (updated): {e}")
        if requeue_info is not None:
            if requeue_info["requeued"]:
                logger.info(
                    f"[tasks] auto-requeued {task_id} attempt "
                    f"{requeue_info['retry_count']}/"
                    f"{requeue_info['max_retries']} — flipped back to pending"
                )
            else:
                logger.warning(
                    f"[tasks] {task_id} hit retry budget "
                    f"({requeue_info['retry_count']}/"
                    f"{requeue_info['max_retries']}) — staying failed, "
                    f"record preserved"
                )
        return snapshot


# ---------------------------------------------------------------------------
# Legacy migration
# ---------------------------------------------------------------------------
def _migrate_legacy_dispatch_log(store: TaskStore) -> None:
    """If the old flat dispatch-log.jsonl exists and predates tasks.jsonl,
    import each record as a task under the new schema.
    """
    if not os.path.exists(LEGACY_DISPATCH_LOG_PATH):
        return
    # Already migrated? We mark migration by touching a sentinel file so we
    # don't double-import when the gateway restarts.
    sentinel = LEGACY_DISPATCH_LOG_PATH + ".migrated"
    if os.path.exists(sentinel):
        return

    imported = 0
    try:
        with open(LEGACY_DISPATCH_LOG_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    legacy = json.loads(line)
                except json.JSONDecodeError:
                    continue
                tid = legacy.get("id") or _new_id()
                if store.get(tid):
                    continue  # already present
                task_text = legacy.get("task", "") or ""
                try:
                    store.create(
                        task=task_text,
                        source=(legacy.get("source") or "web_chat"),
                        created_by="system",
                        assignee="claude_cli",
                        urgency=(legacy.get("urgency") or "normal"),
                        title=_canonical_task_title(task_text),
                        task_id=tid,
                    )
                    # Migrate any existing status other than dispatched/pending
                    legacy_status = legacy.get("status", "dispatched")
                    if legacy_status and legacy_status not in ("pending", "dispatched"):
                        store.update(
                            tid,
                            {"status": "failed" if legacy_status == "dispatch_failed" else legacy_status},
                        )
                    imported += 1
                except Exception as e:
                    logger.warning(
                        f"[tasks] Legacy migration skipped {tid}: {e}"
                    )
        # Drop sentinel so we don't re-run migration.
        with open(sentinel, "w", encoding="utf-8") as f:
            f.write(_iso_now() + "\n")
        logger.info(
            f"[tasks] Migrated {imported} legacy dispatch record(s) from "
            f"{LEGACY_DISPATCH_LOG_PATH}"
        )
    except Exception as e:
        logger.warning(f"[tasks] Legacy migration failed: {e}")


# ---------------------------------------------------------------------------
# Singleton store
# ---------------------------------------------------------------------------
_store: Optional[TaskStore] = None


def get_store() -> TaskStore:
    global _store
    if _store is None:
        _store = TaskStore(TASKS_LOG_PATH)
        _migrate_legacy_dispatch_log(_store)
    return _store


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------
# AGENTS.md requires labels of the form "<action verb> <what> — <brief context>".
# These single-word titles are explicitly too generic and route to the
# ActiveJobs widget as meaningless chrome. Reject them at the boundary so
# callers upgrade to descriptive labels.
_GENERIC_TITLE_BLOCKLIST = frozenset({
    "task", "job", "work", "running", "processing", "working",
    "pending", "busy", "thinking", "loading", "queued", "new task",
})


class TaskCreateRequest(BaseModel):
    task: str = Field(..., description="Full task description")
    title: Optional[str] = None
    source: Source = "web_chat"
    created_by: CreatedBy = "pearl"
    assignee: Optional[Assignee] = "claude_cli"
    urgency: Urgency = "normal"
    requester_email: Optional[str] = None
    requester_user_id: Optional[str] = None
    requester_tenant_id: Optional[str] = None
    requester_tenant_role: Optional[str] = None
    discord_channel_id: Optional[str] = None
    discord_message_id: Optional[str] = None
    discord_user_id: Optional[str] = None
    discord_username: Optional[str] = None
    discord_guild_id: Optional[str] = None
    discord_channel_name: Optional[str] = None
    workspace_path: Optional[str] = None
    workspace_mode: Optional[WorkspaceMode] = None
    github_fork_url: Optional[str] = None
    workspace_isolation_notice: Optional[str] = None
    staging_source_edits_enabled: Optional[bool] = None
    kind: Optional[Literal["task", "swarm"]] = None
    agents: list[str] = Field(default_factory=list)
    swarm_category: Optional[str] = None
    max_retries: Optional[int] = Field(
        default=None,
        ge=0,
        description="Task-specific retry budget. Falls back to PEARL_TASKS_MAX_RETRIES when omitted.",
    )
    timeout_s: Optional[float] = Field(
        default=None,
        gt=0,
        description="Task-specific worker timeout in seconds. Falls back to the worker default when omitted.",
    )
    execution_mode: Optional[ExecutionMode] = Field(
        default=None,
        description="Launchpad execution mode: fast_draft for short no-retry work, full_build for normal policy-framed builds.",
    )

    @model_validator(mode="after")
    def _reject_generic_title(self) -> "TaskCreateRequest":
        if self.title is None:
            return self
        stripped = self.title.strip()
        if stripped.lower() in _GENERIC_TITLE_BLOCKLIST:
            raise ValueError(
                f"title {stripped!r} is too generic; use the AGENTS.md format "
                f"'<verb> <what> — <brief context>' (e.g. 'Summarize inbox — last 24h')."
            )
        # Hard-cap titles at the server limit. Auto-truncate (rather than 422)
        # so well-meaning callers that paste a long line still get a usable
        # task — the front of the widget can't render more than ~60 chars
        # without ellipsizing anyway, and a multi-line card is unreadable.
        self.title = _truncate_title(stripped)
        return self


def _clean_task_metadata_id(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    return text if re.fullmatch(r"\d{10,}", text) else None


def _clean_task_metadata_text(value: Optional[str], limit: int = 160) -> Optional[str]:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text[:limit] if text else None


class TaskUpdateRequest(BaseModel):
    status: Optional[Status] = None
    assignee: Optional[Assignee] = None
    result: Optional[str] = None
    title: Optional[str] = None
    urgency: Optional[Urgency] = None
    emergency: Optional[bool] = None
    note_filename: Optional[str] = None
    file_space_path: Optional[str] = None
    webhook_notified_at: Optional[str] = None
    suppress_result_notification: Optional[bool] = Field(
        default=None,
        description="When true, terminal task result text is kept out of the chat inbox.",
    )
    executor_requested: Optional[str] = Field(
        default=None,
        description="Executor command requested by the worker, for public status projection.",
    )
    executor_effective: Optional[str] = Field(
        default=None,
        description="Resolved executor actually used by the worker, e.g. codex or claude.",
    )
    expected_status: Optional[Status] = Field(
        default=None,
        description="Optional compare-and-set guard for worker claims.",
    )
    claim_worker: Optional[str] = Field(
        default=None,
        description="Worker identity claiming a pending task.",
    )
    no_retry: Optional[bool] = Field(
        default=None,
        description="When true, a failed task is preserved as failed without auto-requeue.",
    )
    note: Optional[str] = Field(
        default=None,
        description="Free-text note to append to the task's notes list.",
    )
    agent_activity_merge: Optional[dict[str, dict[str, Any]]] = Field(
        default=None,
        description="Merge per-agent status/thought activity into the task.",
    )

    @model_validator(mode="after")
    def _truncate_long_title(self) -> "TaskUpdateRequest":
        if self.title is not None:
            self.title = _truncate_title(self.title)
        return self


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = APIRouter(tags=["tasks"])


@router.post("", dependencies=[Depends(require_strict_auth)])
async def create_task(request: Request, body: TaskCreateRequest):
    scope = _requester_scope_from_request(
        request,
        fallback_email=body.requester_email,
        fallback_user_id=body.requester_user_id,
        fallback_tenant_id=body.requester_tenant_id,
    )
    try:
        _validate_public_origin_task_scope(
            source=body.source,
            created_by=body.created_by,
            requester_email=scope.get("email"),
            requester_user_id=scope.get("user_id"),
            requester_tenant_id=scope.get("tenant_id"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    chosen_kind, chosen_agents, chosen_category = _task_metadata_for_create(
        body.task,
        explicit_kind=body.kind,
        agents=body.agents,
        swarm_category=body.swarm_category,
    )
    apply_general_rate_limit(
        request,
        surface=f"tasks:{chosen_kind or 'task'}",
        tenant_id=scope.get("tenant_id"),
        user_id=scope.get("user_id"),
        email=scope.get("email"),
    )
    budget_surface = "task_swarm" if chosen_kind == "swarm" else "task"
    await reserve_tenant_budget_async(
        tenant_id=scope.get("tenant_id"),
        surface=budget_surface,
        estimated_cents=estimate_cents(budget_surface, 100 if chosen_kind == "swarm" else 25),
    )
    store = get_store()
    try:
        task = store.create(
            task=body.task,
            source=body.source,
            created_by=body.created_by,
            assignee=body.assignee,
            urgency=body.urgency,
            title=body.title,
            kind=chosen_kind,
            agents=chosen_agents,
            swarm_category=chosen_category,
            requester_email=scope.get("email"),
            requester_user_id=scope.get("user_id"),
            requester_tenant_id=scope.get("tenant_id"),
            requester_tenant_role=body.requester_tenant_role,
            discord_channel_id=body.discord_channel_id,
            discord_message_id=body.discord_message_id,
            discord_user_id=body.discord_user_id,
            discord_username=body.discord_username,
            discord_guild_id=body.discord_guild_id,
            discord_channel_name=body.discord_channel_name,
            workspace_path=body.workspace_path,
            workspace_mode=body.workspace_mode,
            github_fork_url=body.github_fork_url,
            workspace_isolation_notice=body.workspace_isolation_notice,
            staging_source_edits_enabled=body.staging_source_edits_enabled,
            max_retries=body.max_retries,
            timeout_s=body.timeout_s,
            execution_mode=body.execution_mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    logger.info(
        f"[tasks] created {task['id']} source={task['source']} "
        f"assignee={task['assignee']} urgency={task['urgency']} "
        f"kind={task.get('kind')} agents={len(task.get('agents') or [])} "
        f"swarm_category={task.get('swarm_category')} "
        f"execution_mode={task.get('execution_mode')}"
    )
    return {"ok": True, "task": task}


@router.get("/stream", dependencies=[Depends(require_strict_auth)])
async def stream_tasks(request: Request):
    """Server-Sent Events stream of task change envelopes.

    Frontend / Pearl instances subscribe here to learn about task
    create/update events without polling. Each event is a line of the form::

        event: task
        data: {"event": "created|updated", "ts": "...", "task": {...}, "patch": {...}}

    Auth: same shared secret as the rest of /api/tasks. For browser
    ``EventSource``s that can't set headers, proxy through
    ``interface/src/app/api/tasks/stream``.
    """
    scope = _requester_scope_from_request(request)
    queue = _event_bus.subscribe()

    async def _gen():
        # Initial sync event so clients know the stream is alive + can replay
        # their current list straightaway.
        hello = {"event": "hello", "ts": _iso_now()}
        yield f"event: hello\ndata: {json.dumps(hello)}\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    envelope = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    # SSE keepalive comment — stops proxies from closing idle streams.
                    yield ": keepalive\n\n"
                    continue
                if not _envelope_visible_to_requester(envelope, scope):
                    continue
                data = json.dumps(envelope, ensure_ascii=False)
                yield f"event: task\ndata: {data}\n\n"
        finally:
            _event_bus.unsubscribe(queue)

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable proxy buffering (nginx)
        },
    )


@router.get("", dependencies=[Depends(require_strict_auth)])
async def list_tasks(
    request: Request,
    status: Optional[str] = Query(None),
    assignee: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    urgency: Optional[str] = Query(None),
    requester_email: Optional[str] = Query(None),
    requester_user_id: Optional[str] = Query(None),
    requester_tenant_id: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    include_archived: bool = Query(False),
):
    store = get_store()
    scope = _requester_scope_from_request(
        request,
        fallback_email=requester_email,
        fallback_user_id=requester_user_id,
        fallback_tenant_id=requester_tenant_id,
    )
    tasks = store.list(
        status=status,
        assignee=assignee,
        source=source,
        urgency=urgency,
        requester_email=scope.get("email"),
        requester_user_id=scope.get("user_id"),
        requester_tenant_id=scope.get("tenant_id"),
        limit=limit,
        include_archived=include_archived,
    )
    return {"ok": True, "count": len(tasks), "tasks": tasks}


@router.get("/{task_id}", dependencies=[Depends(require_strict_auth)])
async def get_task(request: Request, task_id: str):
    store = get_store()
    task = _task_or_404_for_request(store, task_id, _requester_scope_from_request(request))
    return {"ok": True, "task": task}


@router.patch("/{task_id}", dependencies=[Depends(require_strict_auth)])
async def update_task(request: Request, task_id: str, body: TaskUpdateRequest):
    store = get_store()
    scope = _requester_scope_from_request(request)
    _task_or_404_for_request(store, task_id, scope)
    patch: dict[str, Any] = {}
    if body.status is not None:
        patch["status"] = body.status
    if body.assignee is not None:
        patch["assignee"] = body.assignee
    if body.result is not None:
        patch["result"] = body.result
    if body.title is not None:
        patch["title"] = body.title
    if body.urgency is not None:
        patch["urgency"] = body.urgency
    if body.emergency is not None:
        patch["emergency"] = body.emergency
    if body.no_retry is not None:
        patch["no_retry"] = body.no_retry
    if body.webhook_notified_at is not None:
        patch["webhook_notified_at"] = body.webhook_notified_at
    if body.suppress_result_notification is not None:
        patch["suppress_result_notification"] = body.suppress_result_notification
    if body.executor_requested is not None:
        patch["executor_requested"] = body.executor_requested
    if body.executor_effective is not None:
        patch["executor_effective"] = body.executor_effective
    if body.expected_status is not None:
        patch["expected_status"] = body.expected_status
    if body.claim_worker is not None:
        patch["claim_worker"] = body.claim_worker
    if body.note_filename is not None:
        patch["note_filename"] = body.note_filename
    if body.file_space_path is not None:
        patch["file_space_path"] = body.file_space_path
    if body.note:
        patch["notes_append"] = {"ts": _iso_now(), "text": body.note}
    if body.agent_activity_merge:
        patch["agent_activity_merge"] = body.agent_activity_merge
    try:
        updated = store.update(task_id, patch)
    except ValueError as e:
        detail = str(e)
        if detail.startswith("status_conflict:"):
            raise HTTPException(status_code=409, detail=detail)
        raise HTTPException(status_code=400, detail=detail)
    if not updated:
        raise HTTPException(status_code=404, detail="task_not_found")
    if not _task_visible_to_requester(updated, scope):
        raise HTTPException(status_code=404, detail="task_not_found")
    logger.info(
        f"[tasks] updated {task_id} status={updated.get('status')} "
        f"assignee={updated.get('assignee')}"
    )
    return {"ok": True, "task": updated}


@router.delete("/{task_id}", dependencies=[Depends(require_strict_auth)])
async def delete_task(request: Request, task_id: str):
    """Soft-delete: marks the task as cancelled, preserving audit trail.

    Failed tasks are protected — they must never be cancelled or purged
    (rule: a task that has failed stays visible so the failure can be
    inspected and retried). Callers who really want to drop a failed task
    should first PATCH it to a non-failed status.
    """
    store = get_store()
    scope = _requester_scope_from_request(request)
    existing = _task_or_404_for_request(store, task_id, scope)
    if existing.get("status") == "failed":
        raise HTTPException(
            status_code=409,
            detail=(
                "failed_tasks_cannot_be_cancelled: this task is in status "
                "'failed' and must be preserved for audit. Patch it to a "
                "different status first if you really need to drop it."
            ),
        )
    updated = store.update(task_id, {"status": "cancelled"})
    if not updated:
        raise HTTPException(status_code=404, detail="task_not_found")
    if not _task_visible_to_requester(updated, scope):
        raise HTTPException(status_code=404, detail="task_not_found")
    return {"ok": True, "task": updated}


# ---------------------------------------------------------------------------
# Archive endpoints
# ---------------------------------------------------------------------------
# Archiving is soft-delete on top of the soft-delete: `cancelled` is already a
# soft-delete, but we keep those records in the active list so the user can
# see what they killed. `archived` removes a record from the active widget
# without touching the audit log — the event history stays intact and the
# record can be restored to pending with one call.
#
# Clear-Finished: the widget's "clear finished" button calls POST /clear-completed
# which archives every `completed` (and optionally `cancelled`) task in one
# shot. We do NOT touch `failed` — failed records must be preserved for
# inspection per the existing DELETE rule.
@router.post("/{task_id}/archive", dependencies=[Depends(require_strict_auth)])
async def archive_task(request: Request, task_id: str):
    """Mark one task as archived (hidden from the active list but preserved)."""
    store = get_store()
    scope = _requester_scope_from_request(request)
    existing = _task_or_404_for_request(store, task_id, scope)
    if existing.get("status") == "failed":
        raise HTTPException(
            status_code=409,
            detail=(
                "failed_tasks_cannot_be_archived: this task is in status "
                "'failed' and must be preserved for audit. Patch it to a "
                "different status first if you really need to drop it."
            ),
        )
    updated = store.update(task_id, {"status": "archived"})
    if not updated:
        raise HTTPException(status_code=404, detail="task_not_found")
    if not _task_visible_to_requester(updated, scope):
        raise HTTPException(status_code=404, detail="task_not_found")
    return {"ok": True, "task": updated}


@router.post("/{task_id}/restore", dependencies=[Depends(require_strict_auth)])
async def restore_task(request: Request, task_id: str):
    """Restore an archived task back to pending so the worker can pick it up."""
    store = get_store()
    scope = _requester_scope_from_request(request)
    existing = _task_or_404_for_request(store, task_id, scope)
    if existing.get("status") != "archived":
        raise HTTPException(
            status_code=409,
            detail=(
                f"task is in status {existing.get('status')!r}; only archived "
                "tasks can be restored via this endpoint"
            ),
        )
    updated = store.update(task_id, {"status": "pending"})
    if not updated:
        raise HTTPException(status_code=404, detail="task_not_found")
    if not _task_visible_to_requester(updated, scope):
        raise HTTPException(status_code=404, detail="task_not_found")
    return {"ok": True, "task": updated}


class ClearCompletedRequest(BaseModel):
    include_cancelled: bool = Field(
        default=True,
        description=(
            "When true, also archive tasks in status 'cancelled'. Failed tasks "
            "are never archived in bulk and must be handled individually."
        ),
    )
    older_than_days: Optional[float] = Field(
        default=None,
        description=(
            "Only archive records whose completed_at (or timestamp_updated if "
            "completed_at is missing) is older than N days. Omit to archive "
            "everything eligible."
        ),
    )


@router.post("/clear-completed", dependencies=[Depends(require_strict_auth)])
async def clear_completed(request: Request, body: Optional[ClearCompletedRequest] = None):
    """Bulk-archive every completed (and optionally cancelled) task.

    The widget's "Clear Finished" button calls this to sweep finished work
    out of the active list in one network round-trip. Returns the ids of
    archived tasks so the UI can show "N tasks archived".
    """
    store = get_store()
    scope = _requester_scope_from_request(request)
    cfg = body or ClearCompletedRequest()
    cutoff = None
    if cfg.older_than_days is not None and cfg.older_than_days > 0:
        cutoff_ts = (
            datetime.now(timezone.utc).timestamp() - cfg.older_than_days * 86400.0
        )
        cutoff = cutoff_ts

    targets: list[str] = []
    with store._lock:  # noqa: SLF001 — we own this class
        for tid, t in store._index.items():  # noqa: SLF001
            if not _task_visible_to_requester(t, scope):
                continue
            status = t.get("status")
            if status == "completed":
                pass
            elif status == "cancelled" and cfg.include_cancelled:
                pass
            else:
                continue
            if cutoff is not None:
                ref = t.get("completed_at") or t.get("timestamp_updated") or t.get("timestamp_created")
                if not ref:
                    continue
                try:
                    ref_dt = datetime.fromisoformat(ref.replace("Z", "+00:00")).timestamp()
                except (TypeError, ValueError):
                    continue
                if ref_dt > cutoff:
                    continue
            targets.append(tid)

    archived: list[str] = []
    for tid in targets:
        try:
            store.update(tid, {"status": "archived"})
            archived.append(tid)
        except Exception as e:  # pragma: no cover — one bad record must not stop the sweep
            logger.warning(f"[tasks] clear-completed skipped {tid}: {e}")

    logger.info(f"[tasks] clear-completed archived {len(archived)} task(s)")
    return {"ok": True, "archived_count": len(archived), "archived_ids": archived}


# ---------------------------------------------------------------------------
# Execute: actually run the task via Claude CLI
# ---------------------------------------------------------------------------
async def _run_claude_for_task(task: dict) -> None:
    """Spawn `claude --print "<task>"` for one task and record the result.

    Runs off the request path (scheduled via asyncio.create_task). On success,
    PATCHes the task to completed with the trimmed stdout as the result. On
    failure, PATCHes to failed so the existing auto-requeue logic in
    TaskStore.update() can decide whether to flip it back to pending.
    """
    store = get_store()
    task_id = str(task.get("id") or "")
    stdout_file = None
    stderr_file = None
    try:
        if str(task.get("workspace_mode") or "") in ("sandbox", "github_fork"):
            store.update(task_id, {
                "status": "failed",
                "result": "Direct Claude execution is disabled for isolated user workspaces; queued worker execution uses the Codex workspace sandbox.",
            })
            return
        workspace = _execution_workspace_for_task(task)
        prompt = _public_execution_prompt(task)
        stdout_file = tempfile.TemporaryFile()
        stderr_file = tempfile.TemporaryFile()
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_BIN, "--print", "--permission-mode", "dontAsk", prompt,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=stdout_file,
            stderr=stderr_file,
            cwd=workspace,
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=CLAUDE_TIMEOUT_S)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            logger.warning(f"[tasks] execute timeout on {task_id} after {CLAUDE_TIMEOUT_S}s")
            store.update(task_id, {
                "status": "failed",
                "result": f"claude CLI timed out after {CLAUDE_TIMEOUT_S}s",
            })
            return

        stdout_file.seek(0)
        stderr_file.seek(0)
        stdout_b = stdout_file.read()
        stderr_b = stderr_file.read()
        stdout = (stdout_b or b"").decode("utf-8", errors="replace").strip()
        stderr = (stderr_b or b"").decode("utf-8", errors="replace").strip()
        rc = proc.returncode

        if rc != 0:
            detail = stderr[:600] or stdout[:600] or f"exit={rc}"
            logger.warning(f"[tasks] claude exited rc={rc} on {task_id}: {detail}")
            store.update(task_id, {
                "status": "failed",
                "result": f"claude exit={rc}: {detail}",
            })
            return

        trimmed = stdout[:CLAUDE_RESULT_MAX_CHARS]
        if len(stdout) > CLAUDE_RESULT_MAX_CHARS:
            trimmed += "\n…(truncated)"
        store.update(task_id, {
            "status": "completed",
            "result": trimmed or "(no output)",
        })
        logger.info(f"[tasks] execute ok {task_id} ({len(stdout)} chars)")
    except FileNotFoundError:
        logger.error(f"[tasks] CLAUDE_BIN not found at {CLAUDE_BIN}")
        store.update(task_id, {
            "status": "failed",
            "result": f"claude binary missing at {CLAUDE_BIN}",
        })
    except Exception as e:  # noqa: BLE001 — must never escape the background task
        logger.exception(f"[tasks] execute crashed for {task_id}: {e}")
        store.update(task_id, {
            "status": "failed",
            "result": f"executor crashed: {e}",
        })
    finally:
        if stdout_file:
            stdout_file.close()
        if stderr_file:
            stderr_file.close()
        with _executing_lock:
            _executing.discard(task_id)


@router.post("/{task_id}/execute", dependencies=[Depends(require_strict_auth)])
async def execute_task(request: Request, task_id: str):
    """Kick off legacy direct Claude CLI execution for a task."""
    store = get_store()
    scope = _requester_scope_from_request(request)
    existing = _task_or_404_for_request(store, task_id, scope)

    status = existing.get("status")
    if status in ("completed", "cancelled", "archived"):
        raise HTTPException(
            status_code=409,
            detail=f"task is {status!r}; cannot execute",
        )

    with _executing_lock:
        if task_id in _executing:
            return {
                "ok": True,
                "already_running": True,
                "task": existing,
            }
        _executing.add(task_id)

    updated = store.update(task_id, {
        "status": "in_progress",
        "notes_append": {"ts": _iso_now(), "text": "executor: spawning claude CLI"},
    })
    execution_task = dict(updated or existing)
    task_text = execution_task.get("task") or execution_task.get("title") or ""
    if not task_text.strip():
        with _executing_lock:
            _executing.discard(task_id)
        store.update(task_id, {
            "status": "failed",
            "result": "task description is empty",
        })
        raise HTTPException(status_code=400, detail="task description is empty")

    asyncio.create_task(_run_claude_for_task(execution_task))
    logger.info(f"[tasks] execute dispatched {task_id}")
    return {"ok": True, "task": updated, "dispatched": True}


# ---------------------------------------------------------------------------
# Swarm bridge router — surfaces OpenRouter swarms in the ActiveJobs widget.
# ---------------------------------------------------------------------------
# The pearl-swarm-dispatch script calls these endpoints as it orchestrates an
# agent swarm so the widget can show the same task card as CLI runs — with a
# row of per-agent emojis, "thinking" bubbles from partial output, and a
# summary once the swarm finishes.
#
#   POST /api/swarm/start    → create a swarm task (kind='swarm', status='in_progress')
#   POST /api/swarm/update   → merge agent_activity (per-agent status/thought)
#   POST /api/swarm/complete → final summary + status=completed|failed
swarm_router = APIRouter(tags=["swarm"])


class SwarmStartRequest(BaseModel):
    task: str = Field(..., description="Task description dispatched to the swarm")
    title: Optional[str] = None
    agents: list[str] = Field(default_factory=list)
    swarm_category: Optional[str] = None
    source: Source = "manual"
    created_by: CreatedBy = "pearl"
    requester_email: Optional[str] = None
    requester_user_id: Optional[str] = None
    requester_tenant_id: Optional[str] = None
    task_id: Optional[str] = Field(
        default=None,
        description="Caller-supplied id (e.g. swarm-<hex>) so the dispatch script "
        "can join an existing task when it was created upstream.",
    )

    @model_validator(mode="after")
    def _truncate_long_title(self) -> "SwarmStartRequest":
        if self.title is not None:
            self.title = _truncate_title(self.title)
        return self


class SwarmUpdateRequest(BaseModel):
    task_id: str
    agent_activity: dict[str, dict] = Field(
        default_factory=dict,
        description=(
            "Map of agent_id → partial activity dict "
            "({status, thought, updated_at}). Shallow-merged into the task's "
            "existing agent_activity so one agent finishing doesn't wipe the "
            "state of agents still running."
        ),
    )
    note: Optional[str] = None
    requester_email: Optional[str] = None
    requester_user_id: Optional[str] = None
    requester_tenant_id: Optional[str] = None


class SwarmCompleteRequest(BaseModel):
    task_id: str
    status: Literal["completed", "failed"] = "completed"
    result: Optional[str] = None
    agent_activity: Optional[dict[str, dict]] = None
    note: Optional[str] = None
    requester_email: Optional[str] = None
    requester_user_id: Optional[str] = None
    requester_tenant_id: Optional[str] = None


@swarm_router.post("/start", dependencies=[Depends(require_strict_auth)])
async def swarm_start(request: Request, body: SwarmStartRequest):
    """Register a new swarm with the task store so it surfaces in the widget."""
    scope = _require_swarm_scope(
        request,
        fallback_email=body.requester_email,
        fallback_user_id=body.requester_user_id,
        fallback_tenant_id=body.requester_tenant_id,
    )
    _apply_swarm_creation_rate_limit(request, scope)
    await reserve_tenant_budget_async(
        tenant_id=scope.get("tenant_id"),
        surface="swarm",
        estimated_cents=estimate_cents("swarm", 100),
    )
    store = get_store()
    try:
        task = store.create(
            task=body.task,
            source=body.source,
            created_by=body.created_by,
            assignee=None,
            urgency="normal",
            title=body.title,
            task_id=body.task_id,
            kind="swarm",
            agents=body.agents,
            swarm_category=body.swarm_category,
            status="in_progress",
            requester_email=scope.get("email"),
            requester_user_id=scope.get("user_id"),
            requester_tenant_id=scope.get("tenant_id"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    logger.info(
        f"[swarm] started {task['id']} agents={len(task.get('agents') or [])} "
        f"category={task.get('swarm_category')}"
    )
    return {"ok": True, "task": task}


@swarm_router.post("/update", dependencies=[Depends(require_strict_auth)])
async def swarm_update(request: Request, body: SwarmUpdateRequest):
    """Merge per-agent activity into a running swarm task."""
    store = get_store()
    scope = _require_swarm_scope(
        request,
        fallback_email=body.requester_email,
        fallback_user_id=body.requester_user_id,
        fallback_tenant_id=body.requester_tenant_id,
    )
    _swarm_or_404_for_request(store, body.task_id, scope)
    patch: dict[str, Any] = {}
    if body.agent_activity:
        patch["agent_activity_merge"] = body.agent_activity
    if body.note:
        patch["notes_append"] = {"ts": _iso_now(), "text": body.note, "kind": "swarm"}
    if not patch:
        raise HTTPException(status_code=400, detail="nothing_to_update")
    try:
        updated = store.update(body.task_id, patch)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not updated:
        raise HTTPException(status_code=404, detail="task_not_found")
    return {"ok": True, "task": updated}


@swarm_router.post("/complete", dependencies=[Depends(require_strict_auth)])
async def swarm_complete(request: Request, body: SwarmCompleteRequest):
    """Mark a swarm task completed (or failed) with an optional result summary."""
    store = get_store()
    scope = _require_swarm_scope(
        request,
        fallback_email=body.requester_email,
        fallback_user_id=body.requester_user_id,
        fallback_tenant_id=body.requester_tenant_id,
    )
    _swarm_or_404_for_request(store, body.task_id, scope)
    patch: dict[str, Any] = {"status": body.status}
    if body.result is not None:
        patch["result"] = body.result
    if body.agent_activity:
        patch["agent_activity_merge"] = body.agent_activity
    if body.note:
        patch["notes_append"] = {"ts": _iso_now(), "text": body.note, "kind": "swarm"}
    try:
        updated = store.update(body.task_id, patch)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not updated:
        raise HTTPException(status_code=404, detail="task_not_found")
    logger.info(f"[swarm] completed {body.task_id} status={body.status}")
    return {"ok": True, "task": updated}


# ---------------------------------------------------------------------------
# MVP swarm bridge — single upsert endpoint.
# ---------------------------------------------------------------------------
# pearl-swarm-dispatch calls POST /api/swarm/report twice per run:
#   - on start:     { task_id, task, agents, status="in_progress" }
#   - on completion:{ task_id, status="completed"|"failed", partial_results }
#
# Unknown task_ids create a new swarm task; known ones are updated in place.
# This keeps the dispatch script simple (one endpoint, stateless retries) while
# still surfacing swarms in the same widget as CLI tasks.
_SWARM_STATUS_VALUES = {"pending", "in_progress", "completed", "failed", "cancelled"}


class SwarmReportRequest(BaseModel):
    task_id: str = Field(..., description="Caller-owned swarm id (e.g. swarm-<pid>-<hex>)")
    task: Optional[str] = Field(default=None, description="Task text; required on first report")
    title: Optional[str] = None
    agents: Optional[list[str]] = None
    swarm_category: Optional[str] = None
    requester_email: Optional[str] = None
    requester_user_id: Optional[str] = None
    requester_tenant_id: Optional[str] = None
    status: Optional[str] = Field(
        default=None,
        description="pending | in_progress | completed | failed | cancelled",
    )
    partial_results: Optional[str] = Field(
        default=None,
        description="Free-form output captured so far — stored as the task result",
    )
    note: Optional[str] = None
    source: Source = "manual"
    created_by: CreatedBy = "pearl"

    @model_validator(mode="after")
    def _truncate_long_title(self) -> "SwarmReportRequest":
        if self.title is not None:
            self.title = _truncate_title(self.title)
        return self


@swarm_router.post("/report", dependencies=[Depends(require_strict_auth)])
async def swarm_report(request: Request, body: SwarmReportRequest):
    """Upsert a swarm task: create on first report, update on subsequent ones."""
    status = body.status
    if status and status not in _SWARM_STATUS_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"invalid_status (expected one of {sorted(_SWARM_STATUS_VALUES)})",
        )

    scope = _require_swarm_scope(
        request,
        fallback_email=body.requester_email,
        fallback_user_id=body.requester_user_id,
        fallback_tenant_id=body.requester_tenant_id,
    )
    store = get_store()
    existing = store.get(body.task_id)

    if existing is None:
        if not body.task:
            raise HTTPException(
                status_code=400,
                detail="task_required_for_new_swarm",
            )
        _apply_swarm_creation_rate_limit(request, scope)
        await reserve_tenant_budget_async(
            tenant_id=scope.get("tenant_id"),
            surface="swarm",
            estimated_cents=estimate_cents("swarm", 100),
        )
        try:
            created = store.create(
                task=body.task,
                source=body.source,
                created_by=body.created_by,
                assignee=None,
                urgency="normal",
                title=body.title,
                task_id=body.task_id,
                kind="swarm",
                agents=body.agents or [],
                swarm_category=body.swarm_category,
                status=status or "in_progress",
                requester_email=scope.get("email"),
                requester_user_id=scope.get("user_id"),
                requester_tenant_id=scope.get("tenant_id"),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        # Attach any initial partial result / note so the first report is complete.
        follow_up: dict[str, Any] = {}
        if body.partial_results is not None:
            follow_up["result"] = body.partial_results
        if body.note:
            follow_up["notes_append"] = {
                "ts": _iso_now(),
                "text": body.note,
                "kind": "swarm",
            }
        if follow_up:
            created = store.update(body.task_id, follow_up) or created
        logger.info(
            f"[swarm] report:create {body.task_id} status={created.get('status')} "
            f"agents={len(created.get('agents') or [])}"
        )
        return {"ok": True, "task": created, "created": True}

    _swarm_or_404_for_request(store, body.task_id, scope)

    patch: dict[str, Any] = {}
    if status:
        patch["status"] = status
    if body.agents is not None:
        patch["agents"] = body.agents
    if body.swarm_category is not None:
        patch["swarm_category"] = body.swarm_category
    if body.title is not None:
        patch["title"] = body.title
    if body.partial_results is not None:
        patch["result"] = body.partial_results
    if body.note:
        patch["notes_append"] = {"ts": _iso_now(), "text": body.note, "kind": "swarm"}
    if not patch:
        return {"ok": True, "task": existing, "created": False}
    try:
        updated = store.update(body.task_id, patch) or existing
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    logger.info(
        f"[swarm] report:update {body.task_id} status={updated.get('status')}"
    )
    return {"ok": True, "task": updated, "created": False}


@swarm_router.get("/status/{task_id}", dependencies=[Depends(require_strict_auth)])
async def swarm_status(request: Request, task_id: str):
    """Fetch the current state of a swarm task by id."""
    task = _swarm_or_404_for_request(
        get_store(),
        task_id,
        _require_swarm_scope(request),
    )
    return {"ok": True, "task": task}


@swarm_router.get("/list", dependencies=[Depends(require_strict_auth)])
async def swarm_list(
    request: Request,
    status: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    include_archived: bool = Query(False),
):
    """List swarm tasks (kind='swarm'), newest first.

    The widget already polls /api/tasks for everything, so this endpoint is
    a convenience for callers (CLI tools, dashboards) that only care about
    swarm runs.
    """
    scope = _require_swarm_scope(request)
    items = get_store().list(
        status=status,
        requester_email=scope.get("email"),
        requester_user_id=scope.get("user_id"),
        requester_tenant_id=scope.get("tenant_id"),
        limit=limit,
        include_archived=include_archived,
    )
    swarms = [t for t in items if t.get("kind") == "swarm"]
    return {"ok": True, "count": len(swarms), "tasks": swarms}


# Re-export the create helper so bot_gateway.py's dispatch tool can call the
# store directly without an HTTP round-trip.
def create_task_direct(
    task: str,
    source: Source = "web_chat",
    created_by: CreatedBy = "pearl",
    assignee: Optional[Assignee] = "claude_cli",
    urgency: Urgency = "normal",
    title: Optional[str] = None,
    kind: Optional[Literal["task", "swarm"]] = None,
    agents: Optional[list[str]] = None,
    swarm_category: Optional[str] = None,
    requester_email: Optional[str] = None,
    requester_user_id: Optional[str] = None,
    requester_tenant_id: Optional[str] = None,
    requester_tenant_role: Optional[str] = None,
    discord_channel_id: Optional[str] = None,
    discord_message_id: Optional[str] = None,
    discord_user_id: Optional[str] = None,
    discord_username: Optional[str] = None,
    discord_guild_id: Optional[str] = None,
    discord_channel_name: Optional[str] = None,
    workspace_path: Optional[str] = None,
    workspace_mode: Optional[WorkspaceMode] = None,
    github_fork_url: Optional[str] = None,
    workspace_isolation_notice: Optional[str] = None,
    staging_source_edits_enabled: Optional[bool] = None,
    max_retries: Optional[int] = None,
    timeout_s: Optional[float] = None,
    execution_mode: Optional[ExecutionMode] = None,
) -> dict:
    inferred_kind, inferred_agents, inferred_category = _task_metadata_for_create(
        task,
        explicit_kind=kind,
        agents=agents,
        swarm_category=swarm_category,
    )
    return get_store().create(
        task=task,
        source=source,
        created_by=created_by,
        assignee=assignee,
        urgency=urgency,
        title=title,
        kind=inferred_kind,
        agents=inferred_agents,
        swarm_category=inferred_category,
        requester_email=requester_email,
        requester_user_id=requester_user_id,
        requester_tenant_id=requester_tenant_id,
        requester_tenant_role=requester_tenant_role,
        discord_channel_id=discord_channel_id,
        discord_message_id=discord_message_id,
        discord_user_id=discord_user_id,
        discord_username=discord_username,
        discord_guild_id=discord_guild_id,
        discord_channel_name=discord_channel_name,
        workspace_path=workspace_path,
        workspace_mode=workspace_mode,
        github_fork_url=github_fork_url,
        workspace_isolation_notice=workspace_isolation_notice,
        staging_source_edits_enabled=staging_source_edits_enabled,
        max_retries=max_retries,
        timeout_s=timeout_s,
        execution_mode=execution_mode,
    )
