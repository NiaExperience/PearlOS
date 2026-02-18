"""CRUD operations for notes."""
from __future__ import annotations

import asyncio
import os
from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import notes_actions, sharing_actions
from core.transport import get_session_user_id_from_participant
from services.app_message_forwarder import AppMessageForwarder
from tools.decorators import bot_tool
from tools.sharing import utils as sharing_tools
from tools.sharing.notes import _share_and_activate_note
from tools.logging_utils import bind_tool_logger, bind_context_logger

from .prompts import DEFAULT_NOTE_TOOL_PROMPTS
from .utils import _get_room_state, _emit_refresh_event, _build_note_event_payload, _extract_note_content

_log = bind_context_logger(tag="[notes_tools]")
logger = _log

# ============================================================================
# Tool Handlers
# ============================================================================

@bot_tool(
    name="bot_replace_note",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_replace_note"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The COMPLETE new content for the note in markdown format. Must include ALL items to keep - anything not included will be deleted."
            },
            "title": {
                "type": "string",
                "description": "Optional new title for the note. If provided, the note's title will be updated."
            },
            "note_id": {
                "type": "string",
                "description": "Optional note ID to update. If not provided, updates the currently active note."
            }
        },
        "required": ["content"]
    }
)
async def replace_note_handler(params: FunctionCallParams):
    """Handle bot_replace_note tool call."""
    log = bind_tool_logger(params, tag="[notes_tools]")
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    content = arguments.get("content", "")
    title = arguments.get("title")
    note_id = arguments.get("note_id")
    result = await bot_replace_note(
        room_url,
        content,
        forwarder,
        title,
        note_id=note_id,
        params=params  # Pass params for permission checks
    )
    if result.get("user_message"):
        log.info("[notes] update_note result message: %s" % result.get("user_message"))
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_create_note",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_create_note"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title for the new note"
            },
            "content": {
                "type": "string",
                "description": "Optional initial content for the note (markdown supported). Leave empty or omit for blank note.",
            },
            "mode": {
                "type": "string",
                "description": "The mode for the note: 'personal' (private) or 'work' (public). In a multi-user session, new 'personal' notes will be shared with the current participants, but private for non-participants. Defaults to 'personal' if not specified.",
            }                
        },
        "required": ["title"]
    }
)
async def create_note_handler(params: FunctionCallParams):
    """Handle bot_create_note tool call."""
    log = bind_tool_logger(params, tag="[notes_tools]")
    arguments = params.arguments
    room_url = params.room_url
    forwarder = params.forwarder
    title = arguments.get("title", "")
    content = arguments.get("content", "")
    mode = arguments.get("mode", "personal")
    result = await bot_create_note(
        room_url,
        title,
        content,
        mode,
        forwarder,
        getattr(params, 'handler_context', params.context)
    )
    if result.get("user_message"):
        log.info("[notes] create_note result message: %s" % result.get("user_message"))
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_read_current_note",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_read_current_note"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {},
        "required": []
    }
)
async def read_current_note_handler(
    params: FunctionCallParams | None = None
) -> dict[str, Any]:
    """Handle bot_read_current_note tool call."""
    log = bind_tool_logger(params, tag="[notes_tools]") if params else _log
    room_url = getattr(params, 'room_url', None)
    result = await bot_read_current_note(room_url, params)
    
    if result.get("user_message"):
        log.info("[notes] read_note_content result message: %s" % result.get("user_message"))
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


async def bot_read_current_note(
    room_url: str | None,
    params: FunctionCallParams | None = None
) -> dict[str, Any]:
    """Fetch the full content for the requested note after permission checks."""
    log = bind_tool_logger(params, tag="[notes_tools]") if params else _log
    try:
        # Fallback: Try to recover from global state if missing
        if not room_url:
            room_url = _get_room_state().get_current_room_url()
            if room_url:
                log.info(f"[notes] Recovered room_url from global state: {room_url}")

        if not room_url:
            log.error("[notes] params has no room_url attribute in bot_read_current_note!")
            return {
                "success": False,
                "error": "Internal error: room_url is undefined",
                "user_message": "I encountered an internal error (room_url undefined). Please try again."
            }

        log.info(f"[notes] bot_read_current_note called for room {room_url}")

        note_id = await _get_room_state().get_active_note_id(room_url)

        if not note_id:
            return {
                "success": False,
                "error": "No note specified",
                "user_message": "Please open a note first, or specify which note to read by ID."
            }

        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            return {
                "success": False,
                "error": "No tenant context",
                "user_message": "I'm having trouble accessing the workspace context. Could you try again in a moment?"
            }

        user_id: str | None = None
        error_msg = ""

        if params is not None:
            user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)

        if not user_id:
            log.warning(f"[notes] Cannot read note without identifying user: {error_msg}")
            return {
                "success": False,
                "error": error_msg or "Could not identify user",
                "user_message": error_msg or "I couldn't identify which user is making this request. Please try again."
            }

        has_read = await sharing_actions.check_resource_read_permission(
            tenant_id=tenant_id,
            user_id=user_id,
            resource_id=note_id,
            content_type='Notes'
        )

        if not has_read:
            log.warning(f"[notes] User {user_id} does not have read permission for note {note_id}")
            return {
                "success": False,
                "error": "Permission denied",
                "user_message": "You don't have permission to read that note."
            }

        note = await notes_actions.get_note_by_id(tenant_id, note_id)
        if not note:
            log.error(f"[notes] Note {note_id} not found while reading")
            return {
                "success": False,
                "error": "Note not found",
                "user_message": "The note you're trying to read no longer exists."
            }

        log.info(f"[notes] 📖 READ NOTE - note_id={note_id}, note_keys={list(note.keys())}, raw_content_type={type(note.get('content')).__name__}, raw_content_preview={repr(note.get('content'))[:200] if note.get('content') else 'None/Empty'}")
        # Extract content - handle both string and dict formats
        content = _extract_note_content(note)
        
        log.info(f"[notes] 📖 EXTRACTED CONTENT - note_id={note_id}, content_length={len(content)}, content_preview={repr(content)[:200]}")
        title = note.get("title") or "Untitled"
        user_message = f"Here's the current content of '{title}'."
        if not content.strip():
            user_message = f"'{title}' is currently empty."
            log.warning(f"[notes] ⚠️ EMPTY CONTENT - note_id={note_id}, title={title}, extracted_content={repr(content)}")

        return {
            "success": True,
            "note": note,
            "user_message": user_message
        }

    except Exception as exc:  # pragma: no cover - defensive logging path
        log.error(f"[notes] Error reading note content: {exc}", exc_info=True)
        return {
            "success": False,
            "error": str(exc),
            "user_message": "I hit an error while trying to read that note. Please try again."
        }


@bot_tool(
    name="bot_save_note",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_save_note"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "Optional note ID to save. If not provided, saves the currently active note."
            }
        },
        "required": []
    }
)
async def save_note_handler(params: FunctionCallParams):
    """Handle bot_save_note tool call."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    note_id = arguments.get("note_id")
    result = await bot_save_note(room_url, forwarder, note_id=note_id)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_delete_note",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_delete_note"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "The (optional) ID of the note to delete. Prefer this, use title only if ID is not known."
            },
            "title": {
                "type": "string",
                "description": "The title of the note to delete"
            },
            "confirm": {
                "type": "boolean",
                "description": "Confirmation flag to prevent accidental deletion",
                "default": False
            }
        },
        "required": []
    }
)
async def delete_note_handler(params: FunctionCallParams):
    """Handle bot_delete_note tool call."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    note_id = arguments.get("note_id")
    title = arguments.get("title")
    confirm = arguments.get("confirm", False)
    result = await bot_delete_note(room_url, note_id, title, confirm, forwarder, params)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ============================================================================
# Implementation
# ============================================================================

async def bot_replace_note(
    room_url: str,
    content: str,
    forwarder: AppMessageForwarder | None = None,
    title: str | None = None,
    note_id: str | None = None,
    params: FunctionCallParams | None = None
) -> dict[str, Any]:
    """Update the content and optionally the title of the active shared note.
    
    Args:
        room_url: Daily room URL
        content: New content (markdown string)
        forwarder: App message forwarder for sending refresh events
        title: Optional new title for the note
        params: Function call params (for permission checks)
        note_id: Optional note ID to update (if not provided, uses active note)
        
    Returns:
        {
            "success": bool,
            "note": dict (updated note) or None,
            "error": str (optional),
            "user_message": str (optional - friendly message for LLM to speak to user)
        }
    """
    try:
        logger.info(f"[notes] bot_replace_note called for room {room_url} (title={'provided' if title else 'unchanged'})")
        
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            logger.error(f"[notes] No tenant_id for room {room_url}")
            return {
                "success": False, 
                "error": "No tenant context",
                "user_message": "I'm having trouble accessing the workspace context. Could you try reloading the page?"
            }

        # SECURITY CHECK: Verify write permission
        user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
        if not user_id:
            logger.warning(f"[notes] Could not identify user for permission check: {error_msg}")
            return {
                "success": False,
                "error": error_msg or "Could not identify user",
                "user_message": error_msg or "I couldn't identify which user is making this request. Please try again."
            }
    
        note = None
        # Accept note_id parameter or fall back to active note
        if note_id:
            note = await notes_actions.get_note_by_id(tenant_id, note_id)
        else:
            note_id = await _get_room_state().get_active_note_id(room_url)
            if note_id:
                note = await notes_actions.get_note_by_id(tenant_id, note_id)
            elif title:
                notes = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
                if not notes or len(notes) == 0:
                    logger.warning(f"[notes] No note found with title: {title} and tenant_id: {tenant_id}")
                    return {
                        "success": False, 
                        "error": f"Note with title '{title}' not found",
                        "user_message": f"I couldn't find a note matching '{title}'."
                    }
                if len(notes) > 1:
                    logger.warning(f"[notes] Multiple notes found with title: {title}, prompting user to choose.")
                    # compile a message of the found titles, modes, and IDs
                    found_notes_details = ", ".join([f"title: '{n.get('title')}' mode: '{n.get('mode')}' (note_id: {n.get('_id')})" for n in notes])
                    found_notes_info = "; ".join([f"Title: '{n.get('title')}', Mode: '{n.get('mode')}'" for n in notes])
                    return {
                        "success": False, 
                        "error": f"Found multiple notes: {found_notes_details}. Use the associated note_id as the 'note_id' param when you retry the operation.",
                        "user_message": f"I found multiple notes matching '{title}': {found_notes_info} Please help me choose the correct one."
                    }
                # One note found, proceed
                note = notes[0]
            else:
                logger.error("[notes] Cannot update: no note_id or title provided, and no active note")
                return {
                    "success": False, 
                    "error": "No note_id or title provided, and no active note",
                    "user_message": "Please open a note first, or specify which note to update."
                }

        if not note:
            return {
                "success": False,
                "error": "Note not found",
                "user_message": "The note you're trying to update doesn't exist."
            }
        
        # Update via Mesh (dual-secret auth) with retry logic
        # content is a plain string, not a dict
        max_retries = 3
        retry_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                # Use actions layer instead of mesh_client directly
                success = await notes_actions.update_note_content(
                    tenant_id=tenant_id,
                    note_id=note_id,
                    content=content,
                    user_id=user_id,
                    title=title
                )
                
                if success:
                    # Fetch updated note to return
                    updated_note = await notes_actions.get_note_by_id(tenant_id, note_id)
                    logger.info(f"[notes] Updated note {note_id}")

                    # Emit refresh event via Daily app-message
                    if forwarder:
                        await _emit_refresh_event(
                            forwarder,
                            note_id,
                            "update",
                            updated_note.get("mode") if updated_note else None
                        )

                    return {
                        "success": True, 
                        "note": updated_note,
                        "user_message": "I've updated the note" + (f" title to '{title}'" if title else "") + "."
                    }
                else:
                    logger.warning(f"[notes] Attempt {attempt + 1}/{max_retries}: Mesh returned None for update_note")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(retry_delay * (2 ** attempt))
                        continue
                    else:
                        logger.error(f"[notes] Failed to update note {note_id} after {max_retries} attempts")
                        return {
                            "success": False, 
                            "error": "Update failed after retries",
                            "user_message": "I tried to update the note but the server isn't responding. Could you try again in a moment?"
                        }
                        
            except Exception as retry_e:
                logger.warning(f"[notes] Attempt {attempt + 1}/{max_retries} failed: {retry_e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(retry_delay * (2 ** attempt))
                    continue
                else:
                    raise
            
    except Exception as e:
        logger.error(f"[notes] Error updating note: {e}", exc_info=True)
        return {
            "success": False, 
            "error": str(e),
            "user_message": f"I encountered an error while updating the note: {str(e)[:100]}. Please try again."
        }


async def bot_create_note(
    room_url: str,
    title: str,
    content: str = "",
    mode: str = "personal",
    forwarder: AppMessageForwarder | None = None,
    context: Any = None
) -> dict[str, Any]:
    """Create a new shared note for this conversation.
    
    Automatically sets as the active note.
    
    Args:
        room_url: Daily room URL
        title: Note title
        content: Initial content (optional)
        forwarder: App message forwarder for sending refresh events
        
    Returns:
        {
            "success": bool,
            "note": dict (new note) or None,
            "error": str (optional),
            "user_message": str (optional - friendly message for LLM to speak to user)
        }
    """
    try:
        logger.info(f"[notes] create_note called for room {room_url}, title='{title}'")
        
        # Get tenant_id from context first, fall back to _get_room_state()
        tenant_id = context.tenant_id() if context and hasattr(context, 'tenant_id') else None
        if not tenant_id:
            tenant_id = _get_room_state().get_room_tenant_id(room_url)
            if not tenant_id:
                logger.error(f"[notes] Cannot create note: no tenant_id for room {room_url}")
                return {
                    "success": False, 
                    "error": "No tenant context",
                    "user_message": "I'm having trouble accessing the workspace context right now. Could you try again in a moment?"
                }
        
        # Get session user ID - try BOT_SESSION_USER_ID environment variable first (most reliable for voice sessions)
        session_user_id = os.environ.get('BOT_SESSION_USER_ID')
        if session_user_id:
            logger.info(f"[notes] Using BOT_SESSION_USER_ID from environment: {session_user_id}")
        else:
            # Fallback: Try to get from context
            if context and hasattr(context, 'user_id'):
                session_user_id = context.user_id()
                logger.info(f"[notes] Context returned user_id: {session_user_id}")
            else:
                # Fallback: Try to get the owner participant ID from the active note (web sessions)
                owner_participant_id = await _get_room_state().get_active_note_owner(room_url)
                if owner_participant_id:
                    logger.info(f"[notes] Attempting to get user ID for participant {owner_participant_id}")
                    session_user_id = get_session_user_id_from_participant(owner_participant_id)
                    
                    # Last resort: Try scanning identity files/Redis
                    if not session_user_id:
                        logger.warning(f"[notes] Primary lookup failed, attempting identity file/Redis scan for participant {owner_participant_id}")
                        try:
                            if hasattr(_get_room_state(), '_scan_identity_queue') and callable(_get_room_state()._scan_identity_queue):
                                identity_data = _get_room_state()._scan_identity_queue(room_url, owner_participant_id)
                                if identity_data:
                                    session_user_id = identity_data.get('sessionUserId')
                                    if session_user_id:
                                        logger.info(f"[notes] Retrieved user ID from identity storage: {session_user_id}")
                                    else:
                                        logger.warning("[notes] Identity data found but no sessionUserId field")
                                else:
                                    logger.warning(f"[notes] No identity data found in storage for participant {owner_participant_id}")
                            else:
                                logger.warning("[notes] Identity file scanning not available (likely in test environment)")
                        except Exception as e:
                            logger.error(f"[notes] Error scanning identity storage: {e}")
        
        # If still no user ID, fail with user-friendly error
        if not session_user_id:
            logger.error(f"[notes] Cannot create note: no sessionUserId found after all attempts for room {room_url}")
            return {
                "success": False, 
                "error": "No user ID found",
                "user_message": "I'm having trouble identifying your user account. Could you try reloading the page? If the problem persists, please contact support."
            }
        
        logger.info(f"[notes] Creating note with user_id={session_user_id}, tenant={tenant_id}")
        
        # Create via Mesh - use sessionUserId as parent (note owner), include tenant for required fields
        # content is a plain string, not a dict
        max_retries = 3
        retry_delay = 1.0  # seconds
        
        for attempt in range(max_retries):
            try:
                # Use actions layer instead of mesh_client directly
                new_note = await notes_actions.create_note(
                    tenant_id=tenant_id,
                    user_id=session_user_id,
                    title=title,
                    content=content,
                    mode=mode
                )
                
                if new_note:
                    note_id = new_note.get("_id") or new_note.get("page_id")
                    logger.info(f"[notes] Created note {note_id}: {title}")
                    
                    # Set as active note
                    await _get_room_state().set_active_note_id(room_url, note_id)

                    # Emit NOTE_OPEN event (modern event system)
                    if forwarder and note_id:
                        from tools import events

                        await _emit_refresh_event(
                            forwarder,
                            note_id,
                            "create",
                            new_note.get("mode") if new_note else None
                        )

                        payload = _build_note_event_payload(new_note, note_id)
                        await forwarder.emit_tool_event(events.NOTE_OPEN, payload)
                    elif forwarder:
                        logger.warning("[notes] Created note missing identifier; skipping event emit")

                    return {
                        "success": True, 
                        "note": new_note,
                        "user_message": f"I've created a new note titled '{title}'."
                    }
                else:
                    logger.warning(f"[notes] Attempt {attempt + 1}/{max_retries}: Mesh returned None for create_note")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(retry_delay * (2 ** attempt))  # Exponential backoff
                        continue
                    else:
                        logger.error(f"[notes] Failed to create note after {max_retries} attempts: {title}")
                        return {
                            "success": False, 
                            "error": "Create failed after retries",
                            "user_message": "I tried to create the note but the server isn't responding. Could you try again in a moment?"
                        }
                        
            except Exception as retry_e:
                logger.warning(f"[notes] Attempt {attempt + 1}/{max_retries} failed with error: {retry_e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(retry_delay * (2 ** attempt))
                    continue
                else:
                    raise  # Re-raise on final attempt
            
    except Exception as e:
        logger.error(f"[notes] Error creating note: {e}", exc_info=True)
        return {
            "success": False, 
            "error": str(e),
            "user_message": f"I encountered an error while trying to create the note: {str(e)[:100]}. Please try again."
        }

async def set_active_note(
    room_url: str,
    note_id: str,
    forwarder: AppMessageForwarder | None = None,
    owner: str | None = None
) -> dict[str, Any]:
    """Change which note is active for this conversation.
    
    Verifies the note exists and is shared (mode="work").
    
    Args:
        room_url: Daily room URL
        note_id: Note _id (UUID)
        forwarder: App message forwarder for sending refresh events
        owner: User ID who is opening the note (optional)
        
    Returns:
        {
            "success": bool,
            "note": dict or None,
            "error": str (optional)
        }
    """
    try:
        logger.info(f"[notes] set_active_note called for room {room_url}, owner={owner}")
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            logger.error(f"[notes] No tenant_id for room {room_url}")
            return {"success": False, "error": "No tenant context"}
        
        # Verify note exists and is shared
        note = await notes_actions.get_note_by_id(tenant_id, note_id)
        if not note:
            logger.error(f"[notes] Note {note_id} not found")
            return {"success": False, "error": "Note not found"}
        
        # Check if note is shared (mode="work") - using indexer.mode path
        mode = note.get("mode")  # Direct mode field, not indexer.mode
        if mode != "work":
            logger.error(f"[notes] Note {note_id} is not shared (mode={mode})")
            return {"success": False, "error": "Note is not shared"}
        
        # Resolve identifier and set as active with owner
        resolved_note_id = note_id or note.get("_id") or note.get("page_id")
        if resolved_note_id:
            await _get_room_state().set_active_note_id(room_url, resolved_note_id, owner)
            logger.info(f"[notes] Set active note to {resolved_note_id} with owner {owner}")
        else:
            logger.warning("[notes] Unable to resolve note identifier while setting active note")
        
        # Emit refresh/NOTE_OPEN events with payload for UI hydration
        if forwarder:
            from tools import events

            if resolved_note_id:
                await _emit_refresh_event(
                    forwarder,
                    resolved_note_id,
                    "open",
                    note.get("mode") if note else None
                )

            payload = _build_note_event_payload(note, resolved_note_id)
            await forwarder.emit_tool_event(events.NOTE_OPEN, payload)

        return {"success": True, "note": note}
        
    except Exception as e:
        logger.error(f"[notes] Error setting active note: {e}")
        return {"success": False, "error": str(e)}


async def bot_save_note(
    room_url: str,
    forwarder: AppMessageForwarder | None = None,
    note_id: str | None = None
) -> dict[str, Any]:
    """Save the current note's changes to persistent storage.
    
    Note: In the current implementation, notes are automatically saved,
    but this provides explicit save feedback.
    
    Args:
        room_url: Daily room URL for tenant context
        forwarder: Optional message forwarder for events
        note_id: Optional note ID to save (if not provided, uses active note)
        
    Returns:
        Dict with success status and optional error message
    """
    try:
        # Accept note_id parameter or fall back to active note
        if not note_id:
            note_id = await _get_room_state().get_active_note_id(room_url)
        
        if not note_id:
            return {
                "success": False,
                "error": "No note specified",
                "user_message": "No note is currently open to save."
            }
        
        # Emit refresh event
        if forwarder:
            # Emit legacy notes.refresh event for frontend compatibility
            note_mode: str | None = None
            tenant_id = _get_room_state().get_room_tenant_id(room_url)
            if tenant_id and note_id:
                try:
                    note = await notes_actions.get_note_by_id(tenant_id, note_id)
                    if note:
                        note_mode = note.get("mode")
                except Exception as fetch_error:
                    logger.warning(f"[notes] Failed to fetch note {note_id} for save event mode lookup: {fetch_error}")

            await _emit_refresh_event(forwarder, note_id, "saved", note_mode)
        
        return {
            "success": True,
            "user_message": "Note saved successfully."
        }
        
    except Exception as e:
        logger.error(f"[notes] Error saving note: {e}")
        return {
            "success": False,
            "error": str(e),
            "user_message": "Failed to save note."
        }


async def bot_delete_note(
    room_url: str,
    note_id: str | None,
    title: str | None,
    confirm: bool = False,
    forwarder: AppMessageForwarder | None = None,
    params: FunctionCallParams | None = None
) -> dict[str, Any]:
    """Delete a note permanently.
    
    Args:
        room_url: Daily room URL for tenant context
    note_id: ID of the note to delete
    title: Title of the note to delete (used when note_id is absent)
        confirm: Confirmation flag to prevent accidental deletion
        forwarder: Optional message forwarder for events
        
    Returns:
        Dict with success status and optional error message
    """
    try:
        if not confirm:
            return {
                "success": False,
                "error": "Confirmation required",
                "user_message": "Please confirm deletion by setting confirm=true"
            }
        
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            return {
                "success": False,
                "error": "No tenant context",
                "user_message": "Cannot delete note without tenant context"
            }
        
        user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
        if not user_id:
            logger.warning(f"[notes] Could not identify user for permission check: {error_msg}")
            return {
                "success": False,
                "error": error_msg or "Could not identify user",
                "user_message": error_msg or "I couldn't identify which user is making this request. Please try again."
            }        

        note: dict[str, Any] | None = None
        
        if not note_id:
            if not title:
                return {
                    "success": False,
                    "error": "Note ID or title required",
                    "user_message": "Please provide either the note ID or title to delete the note."
                }

            notes = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
            if not notes or len(notes) == 0:
                logger.warning(f"[notes] No note found with title: {title} and tenant_id: {tenant_id}")
                return {
                    "success": False, 
                    "error": f"Note with title '{title}' not found",
                    "user_message": f"I couldn't find a note matching '{title}'."
                }
            if len(notes) > 1:
                logger.warning(f"[notes] Multiple notes found with title: {title}, prompting user to choose.")
                # compile a message of the found titles, modes, and IDs
                found_notes_details = ", ".join([f"title: '{n.get('title')}' mode: '{n.get('mode')}' (note_id: {n.get('_id')})" for n in notes])
                found_notes_info = "; ".join([f"Title: '{n.get('title')}', Mode: '{n.get('mode')}'" for n in notes])
                return {
                    "success": False, 
                    "error": f"Found multiple notes: {found_notes_details}. Use the associated note_id as the 'note_id' param when you retry the operation.",
                    "user_message": f"I found multiple notes matching '{title}': {found_notes_info} Please help me choose the correct one."
                }
            # One note found, proceed
            note = notes[0]
            note_id = note.get("_id")

        if not note_id:
            return {
                "success": False,
                "error": "Note not found",
                "user_message": f"Note titled '{title}' not found."
            }
        
        # Delete note via actions layer
        deleted = await notes_actions.delete_note(tenant_id, note_id, user_id)

        if not deleted:
            return {
                "success": False,
                "error": "Deletion failed",
                "user_message": "Failed to delete note."
            }
        
        # Emit NOTE_DELETED event
        if forwarder:
            from tools import events
            await forwarder.emit_tool_event(events.NOTE_DELETED, {"noteId": note_id})

            note_mode: str | None = note.get("mode") if note else None
            if note_mode is None:
                try:
                    existing_note = await notes_actions.get_note_by_id(tenant_id, note_id)
                    if existing_note:
                        note_mode = existing_note.get("mode")
                except Exception as fetch_error:
                    logger.warning(
                        f"[notes] Failed to fetch note {note_id} for delete event mode lookup: {fetch_error}"
                    )

            await _emit_refresh_event(forwarder, note_id, "delete", note_mode)
        
        # If this was the active note, clear it
        if await _get_room_state().get_active_note_id(room_url) == note_id:
            await _get_room_state().set_active_note_id(room_url, None, None)
        
        return {
            "success": True,
            "user_message": "Note deleted successfully."
        }
        
    except Exception as e:
        logger.error(f"[notes] Error deleting note: {e}")
        return {
            "success": False,
            "error": str(e),
            "user_message": "Failed to delete note."
        }
