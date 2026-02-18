"""REST API for Notes — works without an active Daily room.

Exposes CRUD operations that go directly to Mesh, with optional
UI broadcast via Daily/WebSocket when a room is active.

Mount on the FastAPI app:
    from api.notes_api import router as notes_router
    app.include_router(notes_router, prefix="/api/notes")
"""
from __future__ import annotations

import os
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from actions import notes_actions
from tools.logging_utils import bind_context_logger

log = bind_context_logger(tag="[notes_api]")

router = APIRouter(tags=["notes"])

DEFAULT_TENANT = os.getenv("PEARLOS_TENANT_ID", "00000000-0000-0000-0000-000000000001")
DEFAULT_USER = os.getenv("PEARLOS_DEFAULT_USER", "00000000-0000-0000-0000-000000000099")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tenant(val: str | None) -> str:
    return (val or DEFAULT_TENANT).strip()


def _user(val: str | None) -> str:
    return (val or DEFAULT_USER).strip()


async def _broadcast_note_open_event(note_id: str, note: dict):
    """Broadcast a note.open event so the UI opens/navigates to the note."""
    try:
        from bot_gateway import ws_broadcast
        import aiohttp

        envelope = {
            "v": 1,
            "kind": "nia.event",
            "event": "note.open",
            "ts": int(time.time() * 1000),
            "payload": {
                "noteId": note_id,
                "title": note.get("title", ""),
                "content": note.get("content", ""),
                "mode": note.get("mode", "personal"),
            },
        }
        await ws_broadcast(envelope)

        # Daily broadcast (best-effort)
        api_key = os.getenv("DAILY_API_KEY", "")
        if not api_key:
            return
        from bot_gateway import active_rooms, active_rooms_lock
        async with active_rooms_lock:
            rooms = [
                url for url, info in active_rooms.items()
                if info.get("status") == "running"
            ]
        for room_url in rooms:
            room_name = room_url.rstrip("/").split("/")[-1].split("?")[0]
            if not room_name:
                continue
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"https://api.daily.co/v1/rooms/{room_name}/send-app-message",
                        json={"data": envelope, "recipient": "*"},
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                        timeout=5,
                    ) as resp:
                        if resp.status >= 300:
                            log.warning(f"Daily note.open broadcast error: {resp.status}")
            except Exception as e:
                log.warning(f"Daily note.open broadcast failed for {room_name}: {e}")
    except Exception as e:
        log.warning(f"note.open broadcast failed (non-fatal): {e}")


async def _broadcast_note_event(action: str, note_id: str, extra: dict | None = None):
    """Best-effort broadcast a note refresh event via WebSocket + Daily."""
    try:
        # Import here to avoid circular imports
        from bot_gateway import ws_broadcast, active_rooms, active_rooms_lock
        import aiohttp

        envelope = {
            "v": 1,
            "kind": "nia.event",
            "event": "notes.refresh",
            "ts": int(time.time() * 1000),
            "payload": {
                "noteId": note_id,
                "action": action,
                "timestamp": int(time.time() * 1000),
                **(extra or {}),
            },
        }

        # WebSocket broadcast
        await ws_broadcast(envelope)

        # Daily broadcast (best-effort)
        api_key = os.getenv("DAILY_API_KEY", "")
        if not api_key:
            return

        async with active_rooms_lock:
            rooms = [
                url for url, info in active_rooms.items()
                if info.get("status") == "running"
            ]

        for room_url in rooms:
            room_name = room_url.rstrip("/").split("/")[-1].split("?")[0]
            if not room_name:
                continue
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"https://api.daily.co/v1/rooms/{room_name}/send-app-message",
                        json={"data": envelope, "recipient": "*"},
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                        timeout=5,
                    ) as resp:
                        if resp.status >= 300:
                            log.warning(f"Daily broadcast error: {resp.status}")
            except Exception as e:
                log.warning(f"Daily broadcast failed for {room_name}: {e}")

    except Exception as e:
        log.warning(f"Broadcast failed (non-fatal): {e}")


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class NoteCreate(BaseModel):
    title: str
    content: str = ""
    mode: str = "personal"
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None


class NoteUpdate(BaseModel):
    content: str
    title: Optional[str] = None
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None


class NoteAppend(BaseModel):
    item: str
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None


class NoteDelete(BaseModel):
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_notes(
    tenant_id: str | None = None,
    user_id: str | None = None,
    include_content: bool = False,
    limit: int = 100,
):
    """List all notes for the user."""
    tid = _tenant(tenant_id)
    uid = _user(user_id)
    try:
        notes = await notes_actions.list_notes(tid, uid, limit=limit, include_content=include_content)
        return {"success": True, "notes": notes, "count": len(notes)}
    except Exception as e:
        log.error(f"list_notes failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{note_id}")
async def get_note(
    note_id: str,
    tenant_id: str | None = None,
):
    """Get a single note by ID."""
    tid = _tenant(tenant_id)
    try:
        note = await notes_actions.get_note_by_id(tid, note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        return {"success": True, "note": note}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"get_note failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def create_note(body: NoteCreate):
    """Create a new note."""
    tid = _tenant(body.tenant_id)
    uid = _user(body.user_id)
    try:
        note = await notes_actions.create_note(
            tenant_id=tid,
            user_id=uid,
            title=body.title,
            content=body.content,
            mode=body.mode,
        )
        if not note:
            raise HTTPException(status_code=500, detail="Failed to create note")
        note_id = note.get("page_id") or note.get("_id", "")
        await _broadcast_note_event("create", note_id)
        # Also broadcast note.open so the UI opens the new note
        await _broadcast_note_open_event(note_id, note)
        return {"success": True, "note": note}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"create_note failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{note_id}")
async def update_note(note_id: str, body: NoteUpdate):
    """Update note content (and optionally title)."""
    tid = _tenant(body.tenant_id)
    uid = _user(body.user_id)
    try:
        success = await notes_actions.update_note_content(
            tenant_id=tid,
            note_id=note_id,
            content=body.content,
            user_id=uid,
            title=body.title,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Note not found or permission denied")
        await _broadcast_note_event("update", note_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"update_note failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{note_id}/append")
async def append_to_note(note_id: str, body: NoteAppend):
    """Append an item to a note."""
    tid = _tenant(body.tenant_id)
    uid = _user(body.user_id)
    try:
        success = await notes_actions.append_to_note(
            tenant_id=tid,
            note_id=note_id,
            item=body.item,
            user_id=uid,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Note not found or permission denied")
        await _broadcast_note_event("update", note_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"append_to_note failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{note_id}")
async def delete_note(
    note_id: str,
    tenant_id: str | None = None,
    user_id: str | None = None,
):
    """Delete a note by ID."""
    tid = _tenant(tenant_id)
    uid = _user(user_id)
    try:
        success = await notes_actions.delete_note(
            tenant_id=tid,
            note_id=note_id,
            user_id=uid,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Note not found or permission denied")
        await _broadcast_note_event("delete", note_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"delete_note failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search/{title}")
async def search_notes(
    title: str,
    tenant_id: str | None = None,
    user_id: str | None = None,
):
    """Fuzzy search notes by title."""
    tid = _tenant(tenant_id)
    uid = _user(user_id)
    try:
        results = await notes_actions.fuzzy_search_notes(tid, title, uid)
        return {"success": True, "notes": results or [], "count": len(results or [])}
    except Exception as e:
        log.error(f"search_notes failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
