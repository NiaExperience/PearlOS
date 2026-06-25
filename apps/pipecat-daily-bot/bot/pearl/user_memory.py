"""Tenant and user scoped Pearl memory.

This is intentionally small and file-backed for staging. The contract is the
important part: every read/write requires tenant_id and user_id, and there is
no global fallback. The storage backend can move to Prism/Postgres later
without changing callers.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from loguru import logger


_SAFE_COMPONENT_RE = re.compile(r"[^a-zA-Z0-9._@+-]+")
_MEMORY_ROOT = Path(os.getenv("PEARL_USER_MEMORY_DIR", "/home/deploy/.openclaw/user-memory"))
_USER_DOC_NAMES = ("USER.md", "USER_FACTS.md", "MEMORY.md", "activity-log.md", "skills.md")
_MEMORY_DOC_NAMES = ("USER.md", "USER_FACTS.md", "MEMORY.md", "skills.md")


@dataclass(frozen=True)
class MemoryScope:
    tenant_id: str
    user_id: str
    user_email: str = ""


def _safe_component(value: str) -> str:
    cleaned = _SAFE_COMPONENT_RE.sub("_", str(value or "").strip())[:180]
    return cleaned.strip("._-") or "unknown"


def scope_from_values(
    *,
    tenant_id: str | None,
    user_id: str | None,
    user_email: str | None = None,
) -> MemoryScope | None:
    tenant = str(tenant_id or "").strip()
    user = str(user_id or "").strip()
    if not tenant or not user or user.lower() == "anonymous":
        return None
    return MemoryScope(tenant_id=tenant, user_id=user, user_email=str(user_email or "").strip().lower())


def _clean_user_name(value: str | None) -> str:
    cleaned = " ".join(str(value or "").split()).strip()
    if cleaned.lower() in {"anonymous", "null", "none", "undefined"}:
        return ""
    return cleaned[:180]


def scope_from_headers(headers) -> MemoryScope | None:
    return scope_from_values(
        tenant_id=headers.get("x-tenant-id") or headers.get("x-pearl-tenant-id"),
        user_id=headers.get("x-user-id"),
        user_email=headers.get("x-user-email"),
    )


def scope_from_env() -> MemoryScope | None:
    return scope_from_values(
        tenant_id=os.getenv("BOT_SESSION_TENANT_ID") or os.getenv("TENANT_ID"),
        user_id=os.getenv("BOT_SESSION_USER_ID"),
        user_email=os.getenv("BOT_SESSION_USER_EMAIL"),
    )


def memory_path(scope: MemoryScope) -> Path:
    return user_memory_dir(scope) / "events.jsonl"


def legacy_memory_path(scope: MemoryScope) -> Path:
    return (
        _MEMORY_ROOT
        / _safe_component(scope.tenant_id)
        / f"{_safe_component(scope.user_id)}.jsonl"
    )


def user_memory_dir(scope: MemoryScope) -> Path:
    return _MEMORY_ROOT / _safe_component(scope.tenant_id) / _safe_component(scope.user_id)


def user_document_path(scope: MemoryScope, name: str) -> Path:
    if name not in _USER_DOC_NAMES:
        raise ValueError(f"unsupported user memory document: {name}")
    return user_memory_dir(scope) / name


def ensure_user_documents(scope: MemoryScope, user_name: str | None = None) -> Path:
    root = user_memory_dir(scope)
    root.mkdir(parents=True, exist_ok=True)
    clean_name = _clean_user_name(user_name)
    templates = {
        "USER.md": (
            "# User Profile\n\n"
            f"- Tenant ID: {scope.tenant_id}\n"
            f"- User ID: {scope.user_id}\n"
            + (f"- Name: {clean_name}\n" if clean_name else "")
            + (f"- User email: {scope.user_email}\n" if scope.user_email else "")
            + "\n"
        ),
        "USER_FACTS.md": "# User Facts\n\n",
        "MEMORY.md": "# User Memory\n\n",
        "activity-log.md": "# User Activity Log\n\n",
        "skills.md": "# User Skill Preferences\n\n",
    }
    for name, content in templates.items():
        path = root / name
        if not path.exists():
            path.write_text(content, encoding="utf-8")
        elif name == "USER.md" and clean_name:
            try:
                existing = path.read_text(encoding="utf-8")
            except Exception:
                existing = ""
            if "- Name:" not in existing:
                marker = f"- User ID: {scope.user_id}\n"
                if marker in existing:
                    updated = existing.replace(marker, marker + f"- Name: {clean_name}\n", 1)
                else:
                    updated = existing.rstrip() + f"\n- Name: {clean_name}\n"
                path.write_text(updated, encoding="utf-8")
    return root


def _append_user_doc_line(scope: MemoryScope, name: str, line: str) -> None:
    try:
        ensure_user_documents(scope)
        with user_document_path(scope, name).open("a", encoding="utf-8") as f:
            f.write(line.rstrip() + "\n")
    except Exception as exc:
        logger.warning(f"[user-memory] failed to update {name}: {exc}")


def append_memory(scope: MemoryScope, text: str, *, source: str = "unknown", kind: str = "user_fact") -> dict:
    content = " ".join(str(text or "").split()).strip()
    if not content:
        raise ValueError("memory text is required")
    if len(content) > 2000:
        content = content[:2000].rstrip()
    ensure_user_documents(scope)
    path = memory_path(scope)
    entry = {
        "id": f"mem-{uuid.uuid4().hex[:12]}",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "tenantId": scope.tenant_id,
        "userId": scope.user_id,
        "userEmail": scope.user_email,
        "source": source,
        "kind": kind,
        "text": content,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    doc_line = f"- {entry['ts'][:10]} [{kind}/{source}] {content}"
    _append_user_doc_line(scope, "USER_FACTS.md", doc_line)
    _append_user_doc_line(scope, "MEMORY.md", doc_line)
    _append_user_doc_line(scope, "activity-log.md", f"- {entry['ts'][:10]} remembered a {kind} from {source}")
    return entry


def iter_memories(scope: MemoryScope) -> Iterable[dict]:
    rows: list[dict] = []
    for path in (legacy_memory_path(scope), memory_path(scope)):
        if not path.exists():
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if item.get("tenantId") != scope.tenant_id or item.get("userId") != scope.user_id:
                        continue
                    text = item.get("text")
                    if isinstance(text, str) and text.strip():
                        rows.append(item)
        except Exception as exc:
            logger.warning(f"[user-memory] failed to read {path}: {exc}")
    return rows


def list_memories(scope: MemoryScope, *, limit: int = 40) -> list[dict]:
    return list(iter_memories(scope))[-max(1, min(limit, 200)) :]


def search_memories(scope: MemoryScope, query: str, *, limit: int = 20) -> list[dict]:
    needle = str(query or "").strip().lower()
    if not needle:
        return []
    hits = [item for item in iter_memories(scope) if needle in str(item.get("text", "")).lower()]
    return hits[-max(1, min(limit, 100)) :]


def build_memory_block(scope: MemoryScope | None, *, limit: int = 30, user_name: str | None = None) -> str:
    if scope is None:
        return ""
    ensure_user_documents(scope, user_name=user_name)
    items = list_memories(scope, limit=limit)
    docs: list[tuple[str, str]] = []
    for name in _MEMORY_DOC_NAMES:
        path = user_document_path(scope, name)
        try:
            text = path.read_text(encoding="utf-8").strip()
        except Exception as exc:
            logger.warning(f"[user-memory] failed to read {path}: {exc}")
            continue
        meaningful = "\n".join(line for line in text.splitlines() if line.strip() and not line.startswith("#")).strip()
        if meaningful:
            docs.append((name, meaningful[:3000]))
    if not items and not docs:
        return ""
    lines = [
        "## Authenticated User Memory",
        f"Scope: tenant_id={scope.tenant_id} user_id={scope.user_id}"
        + (f" user_email={scope.user_email}" if scope.user_email else ""),
        "These memories belong only to the authenticated current user in this tenant. Use them for continuity, and never apply them to another user or tenant.",
        "",
    ]
    for name, text in docs:
        lines.append(f"### {name}")
        lines.append(text)
        lines.append("")
    for item in items:
        ts = str(item.get("ts") or "")[:10]
        text = " ".join(str(item.get("text") or "").split())
        if text:
            lines.append(f"- {ts}: {text}")
    return "\n".join(lines)
