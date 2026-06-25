"""Agency chat - shared transcript of the Glassbox council.

Pearl, Codecs, and Blair post short turns here. The PearlOS UI shows the
scrolling transcript in a light-blue tile at the top of the active-jobs list.

Storage: append-only JSONL at ``/root/.openclaw/agency-chat/messages.jsonl``.
This is system-shared (no per-user scoping) since the conversation is
operator-facing, not user-facing.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from loguru import logger
from pydantic import BaseModel


AGENCY_DATA_DIR = os.getenv(
    "AGENCY_CHAT_DIR",
    os.path.join(os.getenv("PEARL_CHAT_INBOX_DIR", "/root/.openclaw"), "agency-chat"),
)
MESSAGES_LOG_PATH = os.path.join(AGENCY_DATA_DIR, "messages.jsonl")
MAX_MESSAGES_IN_MEMORY = 500
DEFAULT_LIMIT = 50
ABSOLUTE_LIMIT = 200
ALLOWED_SPEAKERS = {"Pearl", "Claude", "Codex", "Codecs"}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AgencyMessageIn(BaseModel):
    speaker: str  # "Pearl", "Codecs", "Codex", or "Claude"
    body: str
    type: Optional[str] = None  # heartbeat, issue, analysis, action, resolution, summary
    severity: Optional[str] = None  # info, watch, warn, critical
    topic_id: Optional[str] = None
    reply_to: Optional[str] = None
    metadata: Optional[dict] = None


class AgencyMessage(BaseModel):
    id: str
    speaker: str
    body: str
    timestamp: str
    type: Optional[str] = None
    severity: Optional[str] = None
    topic_id: Optional[str] = None
    reply_to: Optional[str] = None
    metadata: Optional[dict] = None


_lock = threading.Lock()
_loaded = False
_messages: list[dict] = []


def _ensure_loaded() -> None:
    global _loaded
    if _loaded:
        return
    os.makedirs(AGENCY_DATA_DIR, exist_ok=True)
    if os.path.exists(MESSAGES_LOG_PATH):
        try:
            with open(MESSAGES_LOG_PATH) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        _messages.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
            # Keep only the tail in memory
            if len(_messages) > MAX_MESSAGES_IN_MEMORY:
                del _messages[: -MAX_MESSAGES_IN_MEMORY]
        except Exception as e:
            logger.warning(f"[agency-chat] failed to load existing log: {e}")
    _loaded = True


def _append(record: dict) -> None:
    """Append a record to the JSONL log AND the in-memory cache."""
    os.makedirs(AGENCY_DATA_DIR, exist_ok=True)
    try:
        with open(MESSAGES_LOG_PATH, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as e:
        logger.error(f"[agency-chat] failed to write log: {e}")
        raise
    _messages.append(record)
    if len(_messages) > MAX_MESSAGES_IN_MEMORY:
        del _messages[: -MAX_MESSAGES_IN_MEMORY]


def add_message(payload: AgencyMessageIn) -> dict:
    """Programmatic API for in-process callers (worker, watcher)."""
    with _lock:
        _ensure_loaded()
        speaker = "Codecs" if payload.speaker == "Codex" else payload.speaker
        record = {
            "id": str(uuid.uuid4()),
            "speaker": speaker,
            "body": payload.body,
            "timestamp": _iso_now(),
        }
        for k in ("type", "severity", "topic_id", "reply_to", "metadata"):
            v = getattr(payload, k, None)
            if v is not None:
                record[k] = v
        _append(record)
        return record


router = APIRouter(prefix="/api/agency-chat", tags=["agency-chat"])


def _check_write_secret(x_bot_secret: Optional[str]) -> None:
    expected = os.getenv("BOT_CONTROL_SHARED_SECRET", "").strip()
    if not expected:
        # No secret configured - allow writes (dev mode)
        return
    if not x_bot_secret or x_bot_secret.strip() != expected:
        raise HTTPException(status_code=401, detail="invalid bot secret")


@router.get("/messages")
async def list_messages(
    limit: int = DEFAULT_LIMIT,
    after: Optional[str] = None,
    before: Optional[str] = None,
) -> dict:
    """Public read endpoint. Returns recent messages, optionally filtered
    by id cursor (`after`) or timestamp (`before`)."""
    with _lock:
        _ensure_loaded()
        items = list(_messages)

    if after:
        # Find the index of the message with id=after, return everything AFTER it
        idx = next((i for i, m in enumerate(items) if m.get("id") == after), -1)
        if idx >= 0:
            items = items[idx + 1 :]
    if before:
        # Filter out anything at or after this timestamp
        items = [m for m in items if m.get("timestamp", "") < before]

    capped = max(1, min(limit, ABSOLUTE_LIMIT))
    items = items[-capped:]

    return {"messages": items, "total_in_memory": len(_messages)}


@router.post("/messages")
async def post_message(
    body: AgencyMessageIn,
    x_bot_secret: Optional[str] = Header(default=None, alias="x-bot-secret"),
) -> dict:
    """Write endpoint - requires BOT_CONTROL_SHARED_SECRET header."""
    _check_write_secret(x_bot_secret)
    if body.speaker not in ALLOWED_SPEAKERS:
        raise HTTPException(
            status_code=400,
            detail="speaker must be 'Pearl', 'Claude', 'Codex', or 'Codecs'",
        )
    if not body.body or not body.body.strip():
        raise HTTPException(status_code=400, detail="body is required")
    if len(body.body) > 2000:
        raise HTTPException(status_code=400, detail="body too long (max 2000 chars)")
    record = add_message(body)
    return {"ok": True, "message": record}
