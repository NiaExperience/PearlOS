"""Chat inbox — one-way channel from Pearl to the user's text chat.

Background workers (e.g. the task-question watcher) write a message here
whenever they have something the user should see in the chat panel. The
frontend polls :code:`GET /api/chat/inbox` for unread items, renders them as
Pearl-authored chat bubbles, and clears the badge via :code:`POST
/api/chat/inbox/mark-read`.

**Per-tenant, per-user store.** Each user gets their own JSONL log and
read-index under ``/root/.openclaw/inbox/<tenant>/`` keyed by their
normalized email (``x-user-email`` and ``x-tenant-id`` from the Next.js
layer). This replaces the old shared ``chat-inbox.jsonl`` and flat
per-user files so that test/QA writes against one tenant can never
surface in another tenant's chat panel.

Each entry carries ``tenant_id`` and ``user_id`` columns so downstream
consumers can identify the addressee even when entries are merged or
copied across files.

Legacy entries from the shared log are auto-migrated on first start:
rows with a recipient are split into per-user files; rows without one
are dropped on the floor (they were already invisible under the old
scoping rules). The migrated source is renamed
``chat-inbox.jsonl.migrated.<ts>`` so the migration is one-shot.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from loguru import logger
from pydantic import BaseModel

from auth import require_auth


INBOX_BASE_DIR = os.getenv("PEARL_CHAT_INBOX_DIR", "/root/.openclaw")
INBOX_DATA_DIR = os.path.join(INBOX_BASE_DIR, "inbox")
LEGACY_LOG_PATH = os.path.join(INBOX_BASE_DIR, "chat-inbox.jsonl")
LEGACY_READ_INDEX_PATH = os.path.join(INBOX_BASE_DIR, "chat-inbox.read.json")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_email(raw: Optional[str]) -> Optional[str]:
    """Lowercase + strip; reject anything outside [a-z0-9._@+-] (same rules
    as the gateway's user-id validator) so callers cannot smuggle one
    user's identity into another's inbox."""
    if not isinstance(raw, str):
        return None
    s = raw.strip().lower()
    if not s:
        return None
    safe = "".join(ch for ch in s if ch.isalnum() or ch in "._@+-")
    if safe != s or len(safe) > 254:
        return None
    return safe


def _normalize_tenant_id(raw: Optional[str]) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    s = raw.strip().lower()
    if not s:
        return None
    safe = "".join(ch for ch in s if ch.isalnum() or ch in "._@+-")
    if safe != s or len(safe) > 254:
        return None
    return safe


def _scope_to_slug(value: str) -> str:
    """Filesystem-safe slug for a normalized tenant or email."""
    return value.replace("@", "_at_").replace("+", "_plus_")


class _UserBucket:
    __slots__ = ("messages", "read_ids", "loaded")

    def __init__(self) -> None:
        self.messages: list[dict] = []
        self.read_ids: set[str] = set()
        self.loaded: bool = False


class InboxStore:
    """Thread-safe per-tenant, per-user inbox.

    Each (tenant_id, user_id) pair gets its own JSONL log + read-index
    file inside ``data_dir``. List/mark-read operations only touch the
    caller's tenant and user files; there is no shared queue that could
    leak across tenants.
    """

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self._lock = threading.RLock()
        self._buckets: dict[tuple[str, str], _UserBucket] = {}
        os.makedirs(self.data_dir, exist_ok=True)
        self._migrate_legacy()

    def _tenant_dir(self, tenant_id: str) -> str:
        return os.path.join(self.data_dir, _scope_to_slug(tenant_id))

    def _log_path(self, tenant_id: str, user_id: str) -> str:
        return os.path.join(self._tenant_dir(tenant_id), f"{_scope_to_slug(user_id)}.jsonl")

    def _read_index_path(self, tenant_id: str, user_id: str) -> str:
        return os.path.join(self._tenant_dir(tenant_id), f"{_scope_to_slug(user_id)}.read.json")

    def _bucket(self, tenant_id: str, user_id: str) -> _UserBucket:
        key = (tenant_id, user_id)
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = _UserBucket()
            self._buckets[key] = bucket
        if not bucket.loaded:
            self._load_bucket(tenant_id, user_id, bucket)
            bucket.loaded = True
        return bucket

    def _load_bucket(self, tenant_id: str, user_id: str, bucket: _UserBucket) -> None:
        log_path = self._log_path(tenant_id, user_id)
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8") as f:
                for lineno, line in enumerate(f, start=1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        bucket.messages.append(json.loads(line))
                    except json.JSONDecodeError as e:
                        logger.warning(
                            f"[chat-inbox] Skipping malformed line {lineno} "
                            f"in {log_path}: {e}"
                        )
        read_path = self._read_index_path(tenant_id, user_id)
        if os.path.exists(read_path):
            try:
                with open(read_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    bucket.read_ids = set(data.get("read_ids") or [])
            except Exception as e:
                logger.warning(
                    f"[chat-inbox] Could not load read index {read_path}: {e}"
                )

    def _append(self, tenant_id: str, user_id: str, entry: dict) -> None:
        path = self._log_path(tenant_id, user_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass

    def _persist_read_index(self, tenant_id: str, user_id: str, bucket: _UserBucket) -> None:
        path = self._read_index_path(tenant_id, user_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"read_ids": sorted(bucket.read_ids)}, f)
        os.replace(tmp, path)

    def add(
        self,
        content: str,
        for_user_email: Optional[str] = None,
        tenant_id: Optional[str] = None,
        task_id: Optional[str] = None,
        task_title: Optional[str] = None,
        kind: str = "task_question_reply",
    ) -> Optional[dict]:
        """Append an entry addressed to ``for_user_email``.

        Returns the persisted entry, or ``None`` if the recipient is
        missing/invalid. Unaddressed entries are dropped: under per-user
        scoping there is no shared bucket they could safely live in.
        """
        user_id = _normalize_email(for_user_email)
        resolved_tenant_id = _normalize_tenant_id(tenant_id)
        if not user_id or not resolved_tenant_id:
            logger.warning(
                "[chat-inbox] dropping entry with missing tenant or recipient "
                f"(task_id={task_id!r}, tenant_id={tenant_id!r}, kind={kind!r})"
            )
            return None
        entry = {
            "id": f"inbox-{uuid.uuid4().hex[:10]}",
            "ts": _iso_now(),
            "role": "assistant",
            "content": content,
            "kind": kind,
            "task_id": task_id,
            "task_title": task_title,
            "tenant_id": resolved_tenant_id,
            "user_id": user_id,
            "for_user_email": user_id,
        }
        with self._lock:
            bucket = self._bucket(resolved_tenant_id, user_id)
            self._append(resolved_tenant_id, user_id, entry)
            bucket.messages.append(entry)
        return dict(entry)

    def list_unread(self, tenant_id: str, user_email: str) -> list[dict]:
        resolved_tenant_id = _normalize_tenant_id(tenant_id)
        target = _normalize_email(user_email)
        if not target or not resolved_tenant_id:
            return []
        with self._lock:
            bucket = self._bucket(resolved_tenant_id, target)
            return [
                dict(m) for m in bucket.messages if m["id"] not in bucket.read_ids
            ]

    def mark_read(self, tenant_id: str, user_email: str, ids: Optional[list[str]] = None) -> int:
        resolved_tenant_id = _normalize_tenant_id(tenant_id)
        target = _normalize_email(user_email)
        if not target or not resolved_tenant_id:
            return 0
        with self._lock:
            bucket = self._bucket(resolved_tenant_id, target)
            owned_ids = {m["id"] for m in bucket.messages}
            if ids is None:
                added = owned_ids - bucket.read_ids
            else:
                added = (set(ids) & owned_ids) - bucket.read_ids
            if not added:
                return 0
            bucket.read_ids.update(added)
            self._persist_read_index(resolved_tenant_id, target, bucket)
            return len(added)

    def _migrate_legacy(self) -> None:
        """One-shot split of the old shared chat-inbox.jsonl into per-user
        files. Runs only when the legacy file is present and not yet
        migrated. Entries without a ``for_user_email`` are skipped — they
        were invisible under the old scoping rules anyway."""
        if not os.path.exists(LEGACY_LOG_PATH):
            return
        legacy_read_ids: set[str] = set()
        if os.path.exists(LEGACY_READ_INDEX_PATH):
            try:
                with open(LEGACY_READ_INDEX_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    legacy_read_ids = set(data.get("read_ids") or [])
            except Exception as e:
                logger.warning(
                    f"[chat-inbox] legacy read index unreadable: {e}"
                )
        per_scope: dict[tuple[str, str], list[dict]] = {}
        skipped = 0
        with open(LEGACY_LOG_PATH, "r", encoding="utf-8") as f:
            for lineno, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError as e:
                    logger.warning(
                        f"[chat-inbox] migration: skipping bad line {lineno}: {e}"
                    )
                    continue
                user_id = _normalize_email(entry.get("for_user_email"))
                tenant_id = _normalize_tenant_id(
                    entry.get("tenant_id")
                    or entry.get("tenantId")
                    or entry.get("requester_tenant_id")
                    or entry.get("requesterTenantId")
                )
                if not user_id or not tenant_id:
                    skipped += 1
                    continue
                entry["tenant_id"] = tenant_id
                entry["user_id"] = user_id
                entry["for_user_email"] = user_id
                per_scope.setdefault((tenant_id, user_id), []).append(entry)
        for (tenant_id, user_id), entries in per_scope.items():
            log_path = self._log_path(tenant_id, user_id)
            # Dedupe by id against any rows already written to this user's
            # file (e.g. by a previous interrupted migration attempt).
            existing_ids: set[str] = set()
            if os.path.exists(log_path):
                with open(log_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            existing_ids.add(json.loads(line).get("id", ""))
                        except json.JSONDecodeError:
                            continue
            new_entries = [e for e in entries if e["id"] not in existing_ids]
            if not new_entries:
                continue
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, "a", encoding="utf-8") as f:
                for e in new_entries:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
            owned_read = legacy_read_ids & {e["id"] for e in entries}
            if owned_read:
                read_path = self._read_index_path(tenant_id, user_id)
                os.makedirs(os.path.dirname(read_path), exist_ok=True)
                existing: set[str] = set()
                if os.path.exists(read_path):
                    try:
                        with open(read_path, "r", encoding="utf-8") as f:
                            existing = set(json.load(f).get("read_ids") or [])
                    except Exception:
                        existing = set()
                merged = sorted(existing | owned_read)
                tmp = read_path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump({"read_ids": merged}, f)
                os.replace(tmp, read_path)
        ts = int(time.time())
        archived = f"{LEGACY_LOG_PATH}.migrated.{ts}"
        os.replace(LEGACY_LOG_PATH, archived)
        if os.path.exists(LEGACY_READ_INDEX_PATH):
            os.replace(
                LEGACY_READ_INDEX_PATH,
                f"{LEGACY_READ_INDEX_PATH}.migrated.{ts}",
            )
        logger.info(
            f"[chat-inbox] migrated legacy log -> {len(per_scope)} tenant/user file(s), "
            f"skipped {skipped} unaddressed entr{'y' if skipped == 1 else 'ies'}; "
            f"archived to {archived}"
        )


_store: Optional[InboxStore] = None


def get_store() -> InboxStore:
    global _store
    if _store is None:
        _store = InboxStore(INBOX_DATA_DIR)
    return _store


router = APIRouter(tags=["chat-inbox"])


class MarkReadRequest(BaseModel):
    ids: Optional[list[str]] = None


class AddInboxRequest(BaseModel):
    content: str
    for_user_email: Optional[str] = None
    tenant_id: Optional[str] = None
    tenantId: Optional[str] = None
    task_id: Optional[str] = None
    task_title: Optional[str] = None
    kind: str = "system_followup"


def _resolve_user_email(x_user_email: Optional[str]) -> str:
    email = _normalize_email(x_user_email)
    if not email:
        raise HTTPException(status_code=401, detail="user identity required")
    return email


def _resolve_tenant_id(*values: Optional[str]) -> str:
    for value in values:
        tenant_id = _normalize_tenant_id(value)
        if tenant_id:
            return tenant_id
    raise HTTPException(status_code=401, detail="tenant identity required")


@router.get("", dependencies=[Depends(require_auth)])
async def list_inbox(
    x_user_email: Optional[str] = Header(default=None, alias="x-user-email"),
    x_tenant_id: Optional[str] = Header(default=None, alias="x-tenant-id"),
    x_pearl_tenant_id: Optional[str] = Header(default=None, alias="x-pearl-tenant-id"),
):
    user_email = _resolve_user_email(x_user_email)
    tenant_id = _resolve_tenant_id(x_tenant_id, x_pearl_tenant_id)
    store = get_store()
    items = store.list_unread(tenant_id, user_email)
    return {"ok": True, "unread_count": len(items), "messages": items}


@router.post("", dependencies=[Depends(require_auth)])
async def add_inbox_message(
    body: AddInboxRequest,
    x_user_email: Optional[str] = Header(default=None, alias="x-user-email"),
    x_tenant_id: Optional[str] = Header(default=None, alias="x-tenant-id"),
    x_pearl_tenant_id: Optional[str] = Header(default=None, alias="x-pearl-tenant-id"),
):
    recipient = body.for_user_email or x_user_email
    tenant_id = _resolve_tenant_id(x_tenant_id, x_pearl_tenant_id, body.tenant_id, body.tenantId)
    entry = get_store().add(
        content=body.content,
        for_user_email=recipient,
        tenant_id=tenant_id,
        task_id=body.task_id,
        task_title=body.task_title,
        kind=body.kind,
    )
    if not entry:
        raise HTTPException(status_code=400, detail="valid recipient required")
    return {"ok": True, "message": entry}


@router.post("/mark-read", dependencies=[Depends(require_auth)])
async def mark_read(
    body: Optional[MarkReadRequest] = None,
    x_user_email: Optional[str] = Header(default=None, alias="x-user-email"),
    x_tenant_id: Optional[str] = Header(default=None, alias="x-tenant-id"),
    x_pearl_tenant_id: Optional[str] = Header(default=None, alias="x-pearl-tenant-id"),
):
    user_email = _resolve_user_email(x_user_email)
    tenant_id = _resolve_tenant_id(x_tenant_id, x_pearl_tenant_id)
    store = get_store()
    ids = body.ids if body else None
    n = store.mark_read(tenant_id, user_email, ids)
    return {"ok": True, "marked": n}
