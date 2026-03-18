"""Shared utilities for note tools."""
from __future__ import annotations

import inspect
import time
from typing import Any

from tools.logging_utils import bind_context_logger

log = bind_context_logger(tag="[notes_tools]")
from services.app_message_forwarder import AppMessageForwarder

# Lazy import helper to avoid circular import
def _get_room_state():
    try:
        import room.state as state
    except ImportError:
        import bot.room.state as state
    return state

def _extract_note_content(note: dict[str, Any]) -> str:
    """Extract content string from note, handling both string and dict formats.
    
    Note content may be stored as:
    - A string: "content text"
    - A dict: {"type": "...", "content": "content text"}
    
    Args:
        note: Note dictionary
        
    Returns:
        Content as string, empty string if not found or invalid
    """
    note_id = note.get("_id") or note.get("page_id") or "unknown"
    note_content = note.get("content", "")
    
    log.info(f"[notes] 📝 EXTRACTING CONTENT - note_id={note_id}, content_type={type(note_content).__name__}, content_value={repr(note_content)[:200] if note_content else 'None/Empty'}")
    if isinstance(note_content, dict):
        extracted = note_content.get("content", "") or ""
        log.info(f"[notes] 📝 EXTRACTED FROM DICT - note_id={note_id}, extracted_length={len(extracted)}, extracted_preview={repr(extracted)[:100]}")
        return extracted
    
    result = str(note_content) if note_content else ""
    log.info(f"[notes] 📝 EXTRACTED AS STRING - note_id={note_id}, result_length={len(result)}, result_preview={repr(result)[:100]}")
    return result

async def _emit_refresh_event(
    forwarder: AppMessageForwarder,
    note_id: str,
    action: str,
    mode: str | None = None
) -> None:
    """Emit nia.event refresh hint via Daily app-message.
    
    Args:
        forwarder: App message forwarder
        note_id: Note _id that changed
        mode: Note mode when available (e.g. personal/work)
        action: Action type ("update", "create", "saved", "delete", "set_active", "open")
    """
    try:
        from tools import events

        payload: dict[str, Any] = {
            "noteId": note_id,
            "action": action,
            "timestamp": int(time.time() * 1000)
        }

        if mode:
            payload["mode"] = mode

        await _safe_emit_tool_event(forwarder, events.NOTES_REFRESH, payload)
        log.info(f"[notes] Emitted refresh event for note {note_id}, action={action}")
    except Exception as e:
        log.error(f"[notes] Failed to emit refresh event: {e}")


async def _safe_emit_tool_event(forwarder: AppMessageForwarder, event: str, payload: dict[str, Any]) -> None:
    """Emit tool events whether the forwarder is sync or async.

    Accepts MagicMock/Mock forwarders in tests by checking awaitable results first.
    """
    emit_fn = getattr(forwarder, "emit_tool_event", None)
    if not emit_fn:
        return

    try:
        result = emit_fn(event, payload)
        if inspect.isawaitable(result):
            await result
    except Exception as exc:
        log.error(f"[notes] Failed to emit {event}: {exc}")


def _build_note_event_payload(note: dict[str, Any], note_id: str | None = None) -> dict[str, Any]:
    """Construct a common payload for NOTE_OPEN events."""
    resolved_id = note_id or note.get("_id") or note.get("page_id")
    if not resolved_id:
        log.warning("[notes] Unable to resolve note identifier for NOTE_OPEN payload")

    log.info(f"[notes] 📦 BUILDING EVENT PAYLOAD - note_id={resolved_id}, note_keys={list(note.keys())}, raw_content_type={type(note.get('content')).__name__}, raw_content_preview={repr(note.get('content'))[:200] if note.get('content') else 'None/Empty'}")
    extracted_content = _extract_note_content(note)
    log.info(f"[notes] 📦 EXTRACTED FOR PAYLOAD - note_id={resolved_id}, extracted_length={len(extracted_content)}, extracted_preview={repr(extracted_content)[:200]}")
    payload: dict[str, Any] = {
        "noteId": resolved_id,
        "mode": note.get("mode"),
        "title": note.get("title"),
        "content": extracted_content,
    }

    safe_note = {
        "_id": resolved_id,
        "title": note.get("title"),
        "content": extracted_content,  # Use extracted content instead of raw
        "mode": note.get("mode"),
    }
    
    log.info(f"[notes] 📦 PAYLOAD BUILT - note_id={resolved_id}, payload_content_length={len(payload.get('content', ''))}, safe_note_content_length={len(safe_note.get('content', ''))}")

    tenant_id = note.get("tenantId")
    if tenant_id:
        safe_note["tenantId"] = tenant_id

    user_id = note.get("userId")
    if user_id:
        safe_note["userId"] = user_id

    payload["note"] = safe_note
    return payload


# ============================================================================
# LLM Context Injection (Active Note)
# ============================================================================

_NOTE_CONTEXT_MARKER = "## 📝 ACTIVE NOTE CONTEXT"


async def _inject_note_context_for_llm(
    room_url: str,
    note_id: str | None,
    title: str | None,
    content: str | None,
) -> None:
    """Inject or update a system message with active note content.

    Keeps the LLM context in sync so it always knows what note is open
    and what's inside it. Called from note open/create/update/close tools.
    """
    try:
        from flows.registry import get_flow_manager
        from pipecat.frames.frames import LLMMessagesAppendFrame

        flow_manager = get_flow_manager(room_url)
        if not flow_manager:
            return

        task = getattr(flow_manager, "task", None)
        if not task or not hasattr(task, "queue_frames"):
            return

        if note_id:
            preview = (content or "")[:3000]
            if content and len(content) > 3000:
                preview += "\n... (content truncated, use bot_read_current_note for full text)"

            context_content = (
                f"{_NOTE_CONTEXT_MARKER}\n"
                "The user currently has this note open on screen:\n"
                f"- **Note ID:** {note_id}\n"
                f"- **Title:** {title or 'Untitled'}\n"
                f"- **Content:**\n{preview}\n\n"
                "If the user says 'edit this note', 'add to the note', etc., "
                "you already know which note they mean. Use the note tools directly "
                "without asking which note."
            )
        else:
            context_content = (
                f"{_NOTE_CONTEXT_MARKER}\n"
                "No note is currently open. The user closed or navigated away from the note view."
            )

        # Remove any previous note context message from the context
        context = getattr(task, "_context", None) or getattr(flow_manager, "context", None)
        if context and hasattr(context, "messages"):
            messages = context.messages
            context.messages = [
                m for m in messages
                if not (
                    isinstance(m, dict)
                    and isinstance(m.get("content"), str)
                    and _NOTE_CONTEXT_MARKER in m["content"]
                )
            ]

        await task.queue_frames([
            LLMMessagesAppendFrame(messages=[{
                "role": "system",
                "content": context_content,
            }]),
        ])
        log.info(f"[notes] 💉 Injected note context for LLM: note_id={note_id}, title={title}, content_len={len(content or '')}")
    except Exception as e:
        # Non-fatal, note tools should still succeed
        log.warning(f"[notes] Failed to inject note context for LLM: {e}")
        return
