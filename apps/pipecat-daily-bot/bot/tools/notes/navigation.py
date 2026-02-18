"""Navigation tools for notes."""
from __future__ import annotations

from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import notes_actions, sharing_actions
from services.app_message_forwarder import AppMessageForwarder
from tools.decorators import bot_tool
from tools.sharing import utils as sharing_tools
from tools.logging_utils import bind_tool_logger, bind_context_logger

from .prompts import DEFAULT_NOTE_TOOL_PROMPTS
from .utils import _get_room_state, _emit_refresh_event, _build_note_event_payload, _safe_emit_tool_event

_log = bind_context_logger(tag="[notes_tools]")
# Alias to satisfy legacy references that expect `logger`
logger = _log

# ============================================================================
# Tool Handlers
# ============================================================================

@bot_tool(
    name="bot_list_notes",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_list_notes"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "number",
                "description": "Maximum number of notes to return (default 50)",
                "default": 50
            }
        },
        "required": []
    }
)
async def list_notes_handler(params: FunctionCallParams):
    """Handle bot_list_notes tool call."""
    log = bind_tool_logger(params, tag="[notes_tools]")
    room_url = params.room_url
    arguments = params.arguments
    limit = arguments.get("limit", 50)
    result = await bot_list_notes(room_url, limit, params, log)
    # run_llm=False: the result already contains user_message; skip the costly
    # second LLM round-trip which adds 3-8s of latency with Claude.
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=False))

@bot_tool(
    name="bot_open_note",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_open_note"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "The ID of the note to open"
            },
            "title": {
                "type": "string",
                "description": "The title of the note to open"
            }
        },
        "required": [""]
    }
)
async def open_note_handler(params: FunctionCallParams):
    """Handle bot_open_note tool call."""
    log = bind_tool_logger(params, tag="[notes_tools]")
    try:
        log.info(f"[notes] open_note_handler called. params type: {type(params)}")
        
        # Robustly get room_url
        room_url = getattr(params, 'room_url', None)
        
        # Fallback: Try to recover from global state if missing
        if not room_url:
            room_url = _get_room_state().get_current_room_url()
            if room_url:
                log.info(f"[notes] Recovered room_url from global state: {room_url}")

        if not room_url:
            log.error("[notes] params has no room_url attribute! Attempting fallback from context.")
            # Try to get from context if available (unlikely but worth a try)
            # context = getattr(params, 'context', None)
            # if context and hasattr(context, 'room_url'): ...
            
            return await params.result_callback({
                "success": False,
                "error": "Internal error: room_url is undefined",
                "user_message": "I encountered an internal error (room_url undefined). Please try again."
            }, properties=FunctionCallResultProperties(run_llm=True))

        log.info(f"[notes] params.room_url: {room_url}")
            
        arguments = params.arguments
        forwarder = params.forwarder
        note_id = arguments.get("note_id")
        title = arguments.get("title")
        result = await bot_open_note(room_url, note_id=note_id, title=title, forwarder=forwarder, params=params, log=log)
        # run_llm=False for success path: result already has user_message ("Opened note: X").
        # Skipping the second LLM round-trip saves 3-8s of latency with Claude.
        # On failure, we still want run_llm=True so the LLM can explain the error conversationally.
        should_run_llm = not result.get("success", False)
        await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=should_run_llm))
    except Exception as e:
        log.error(f"[notes] Error in open_note_handler: {e}", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": f"Internal error: {str(e)}",
            "user_message": "I encountered an internal error while trying to open the note."
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_switch_note_mode",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_switch_note_mode"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "description": "The mode to switch to: 'work' (shared) or 'personal' (private)"
            }
        },
        "required": ["mode"]
    },
    passthrough=True
)
async def switch_note_mode_handler(params: FunctionCallParams):
    """Handle bot_switch_note_mode tool call."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    mode = arguments.get("mode")
    result = await bot_switch_note_mode(room_url, mode, forwarder)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_back_to_notes",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_back_to_notes"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {},
        "required": []
    }
)
async def back_to_notes_handler(params: FunctionCallParams):
    """Handle bot_back_to_notes tool call."""
    room_url = params.room_url
    forwarder = params.forwarder
    result = await bot_back_to_notes(room_url, forwarder)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_download_note",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_download_note"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "format": {
                "type": "string",
                "description": "Format to download the note in (e.g. 'markdown', 'text')",
                "enum": ["markdown", "text"],
                "default": "markdown"
            }
        },
        "required": []
    }
)
async def download_note_handler(params: FunctionCallParams):
    """Handle bot_download_note tool call."""
    room_url = params.room_url
    arguments = params.arguments
    fmt = arguments.get("format", "markdown")
    result = await bot_download_note(room_url, fmt)
    await params.result_callback(result)


# ============================================================================
# Implementation
# ============================================================================

async def bot_list_notes(
    room_url: str,
    limit: int = 50,
    params: FunctionCallParams | None = None,
    log=None,
) -> dict[str, Any]:
    """List all available notes for the current tenant.
    
    Args:
        room_url: Daily room URL for tenant context
        limit: Maximum number of notes to return
        forwarder: Optional message forwarder for events
        
    Returns:
        Dict with success status, notes list, and optional error message
    """
    try:
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            return {
                "success": False,
                "error": "No tenant context",
                "user_message": "Cannot list notes without tenant context"
            }
        # SECURITY CHECK: Verify user_id
        user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
        if not user_id:
            (log or _log).warning(f"[notes] Could not identify user for permission check: {error_msg}")
            return {
                "success": False,
                "error": error_msg or "Could not identify user",
                "user_message": error_msg or "I couldn't identify which user is making this request. Please try again."
            }

        # Fetch notes from actions layer
        notes_metadata = await notes_actions.list_notes(tenant_id, user_id, limit=limit)
        
        return {
            "success": True,
            "notes": notes_metadata,
            "count": len(notes_metadata),
            "user_message": f"Found {len(notes_metadata)} note(s)."
        }
        
    except Exception as e:
        (log or _log).error(f"[notes] Error listing notes: {e}")
        return {
            "success": False,
            "error": str(e),
            "user_message": "Failed to list notes."
        }


async def bot_open_note(
    room_url: str,
    note_id: str | None = None,
    title: str | None = None,
    forwarder: AppMessageForwarder | None = None,
    params: FunctionCallParams | None = None,
    log=None,
) -> dict[str, Any]:    
    """Open a specific note and set it as active for this call.
    This function will open a note, and if in a multi-user session
    will verify the note is already shared, or if not will check
    if the user has permission to share it.

    Args:
        room_url: Daily room URL for tenant context
        note_id: ID of the note to open
        title: Title of the note to open (if ID not known)
        forwarder: Optional message forwarder for events
        
    Returns:
        Dict with success status, note data, and optional error message
    """
    try:
        async def open_note(note):
            # Resolve note identifier and set as active (single-user session)
            resolved_note_id = note.get("_id")
            if resolved_note_id:
                await _get_room_state().set_active_note_id(room_url, resolved_note_id, owner="bot")
            else:
                (log or _log).warning("[notes] Unable to resolve note identifier when opening note")

            # Emit refresh + NOTE_OPEN events so UI receives hydrated payload
            if forwarder and note:
                from tools import events
                if resolved_note_id:
                    await _emit_refresh_event(
                        forwarder,
                        resolved_note_id,
                        "set_active",
                        note.get("mode") if note else None
                    )
                payload = _build_note_event_payload(note, resolved_note_id)
                await _safe_emit_tool_event(forwarder, events.NOTE_OPEN, payload)
            elif forwarder:
                (log or _log).warning("[notes] Skipping note events because note payload is missing")
            return {
                "success": True,
                "note": note,
                "user_message": f"Opened note: {note.get('title', 'Untitled')}"
            }

        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            return {
                "success": False,
                "error": "No tenant context",
                "user_message": "Cannot open note without tenant context"
            }

        user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
        if not user_id:
            (log or logger).warning(f"[notes] Could not identify user for permission check: {error_msg}")
            return {
                "success": False,
                "error": error_msg or "Could not identify user",
                "user_message": error_msg or "I couldn't identify which user is making this request. Please try again.",
            }

        # Verify note exists
        note = None
        if (note_id):
            note = await notes_actions.get_note_by_id(tenant_id, note_id)
            if not note:
                return {
                    "success": False,
                    "error": "Note not found",
                    "user_message": f"Note with ID {note_id} not found."
                }
        elif (title):
            notes = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
            if not notes or len(notes) == 0:
                (log or _log).warning(f"[notes] No note found with title: {title} and tenant_id: {tenant_id}")
                return {
                    "success": False, 
                    "error": f"Note with title '{title}' not found",
                    "user_message": f"I couldn't find a note matching '{title}'."
                }
            if len(notes) > 1:
                (log or _log).warning(f"[notes] Multiple notes found with title: {title}, prompting user to choose.")
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
            (log or _log).info(f"[notes] ✅ FUZZY SEARCH RESULT - note_id={note.get('_id')}, title={note.get('title')}, has_content={'content' in note and note.get('content') is not None}, content_type={type(note.get('content')).__name__ if 'content' in note else 'N/A'}")

        if not note:
            note_id = await _get_room_state().get_active_note_id(room_url)
            (log or logger).info(f"[notes] 📋 FETCHING BY ID - note_id={note_id}, tenant_id={tenant_id}")
            note = await notes_actions.get_note_by_id(tenant_id, note_id)
            if not note:
                return {
                    "success": False,
                    "error": "Note not found",
                    "user_message": f"No active note, and note with title '{title}' (or similar) not found."
                }
            (log or logger).info(f"[notes] ✅ FETCHED BY ID - note_id={note.get('_id')}, title={note.get('title')}, has_content={'content' in note and note.get('content') is not None}, content_type={type(note.get('content')).__name__ if 'content' in note else 'N/A'}")
        
        # SECURITY CHECK: private session - Verify user has permission to read this note
        has_read = await sharing_actions.check_resource_read_permission(
            tenant_id=tenant_id, user_id=user_id, resource_id=note["_id"], content_type='Notes'
        )
        if not has_read:
            (log or logger).warning(
                f"[notes] User {user_id} does not have read permission for note {note['_id']}"
            )
            return {
                "success": False,
                "error": "You don't have permission to read this note.",
            }

        # MULTI-USER SESSION - DISABLED, WILL FIX LATER
        # check if all participants have at least read permission
        # Get transport from forwarder which has the reference
        # if not sharing_tools._is_private_single_user_session(room_url, params):
        #     transport = params.forwarder.transport if params.forwarder else None
        #         return {
        #             "success": False,
        #             "error": "Cannot determine participant access",
        #             "user_message": f"I couldn't determine user access for this resource. Please try again.",
        #         }
            
        #     logger.info(f"[notes] Opening note {note['_id']} in multi-user session")
        #     participants = transport.participants()
        #     human_participants = {pid for pid in participants if pid != 'local'}
        #     logger.info(f"[notes] transport.participants() returned: {participants}, human_participants: {human_participants}")
        #     # SECURITY CHECK: multi-user session - Verify sharing exists and is at least read-only for all participants
        #     # Check if the resource is already shared to the participants
        #     can_open = True
        #     for pid in human_participants:
        #         if pid == 'local':  # Skip bot
        #             continue
        #         data = participants.get(pid, {})
        #         # Daily.co transport.participants() structure: info.userId (primary) or info.userData.sessionUserId (fallback)
        #         info = data.get('info', {})
        #         # Try direct userId first (most common)
        #         user_id = info.get('userId')
        #         # Fallback to userData.sessionUserId if available
        #         if not user_id:
        #             user_data = info.get('userData', {})
        #             user_id = user_data.get('sessionUserId')
        #         if not user_id:
        #             return {
        #                 "success": False,
        #                 "error": "Cannot determine participant access",
        #                 "user_message": f"I couldn't determine user access for this resource. Please try again.",
        #             }
        #         if not await sharing_actions.check_resource_read_permission(
        #             tenant_id=tenant_id, user_id=user_id, resource_id=note["_id"], content_type='Notes'
        #         ):
        #             can_open = False
        #             logger.warning(
        #                 f"[notes] Participant user {user_id} does not have read permission for note {note['_id']}"
        #             )
        #             break  # No need to check further

        #     if can_open:
        #         return await open_note(note)

        #     # SECURITY CHECK: multi-user session - Verify owner can share the note
        #     # If the note is not already shared to everyone, check if the opener has share permission
        #     has_share = await sharing_actions.check_resource_share_permission(
        #         tenant_id=tenant_id, user_id=user_id, resource_id=note["_id"], content_type='Notes'
        #     )
        #     if not has_share:
        #         logger.warning(
        #             f"[notes] User {user_id} does not have share permission for note {note['_id']}"
        #         )
        #         return {
        #             "success": False,
        #             "error": "You don't have permission to share this note.",
        #         }

        #     # Use shared utility to share and activate, and return
        #     return await _share_and_activate_note(
        #         room_url=room_url,
        #         note_id=note["_id"],
        #         tenant_id=tenant_id,
        #         owner_user_id=user_id,
        #         forwarder=forwarder
        #     )

        # SINGLE USER PRIVATE SESSION - OPEN THE NOTE
        (log or _log).info(f"[notes] Opening note {note['_id']}")
        return await open_note(note)
        
    except Exception as e:
        (log or _log).error(f"[notes] Error opening note: {e}")
        return {
            "success": False,
            "error": str(e),
            "user_message": "Failed to open note."
        }


async def bot_switch_note_mode(
    room_url: str,
    mode: str,
    forwarder: AppMessageForwarder | None = None,
) -> dict[str, Any]:
    """Switch the notes UI between personal and work mode.
    
    This is a passthrough command that changes the frontend UI mode display,
    not the individual note's mode property in the database.
    
    Args:
        room_url: Daily room URL for tenant context
        mode: Mode to switch to ('work' for shared, 'personal' for private)
        forwarder: Optional message forwarder for events
        
    Returns:
        Dict with success status and optional error message
    """
    try:
        # This is a UI command - emit passthrough event to frontend
        if forwarder:
            from tools import events
            # Emit NOTE_MODE_SWITCH event which will be routed to notepadCommand
            await forwarder.emit_tool_event(events.NOTE_MODE_SWITCH, {
                "mode": mode
            })
        
        return {
            "success": True,
            "user_message": ""  # Silent per prompt instructions
        }
        
    except Exception as e:
        (log or _log).error(f"[notes] Error switching note mode: {e}")
        return {
            "success": False,
            "error": str(e),
            "user_message": "Failed to switch note mode."
        }


async def bot_back_to_notes(
    room_url: str,
    forwarder: AppMessageForwarder | None = None,
) -> dict[str, Any]:
    """Navigate back to the notes list view from the current note.
    
    Args:
        room_url: Daily room URL for tenant context
        forwarder: Optional message forwarder for events
        
    Returns:
        Dict with success status and optional error message
    """
    try:        
        # Emit NOTE_CLOSE event
        if forwarder:
            from tools import events
            await forwarder.emit_tool_event(events.NOTE_CLOSE, {})
        
        return {
            "success": True,
            "user_message": "Returned to notes list."
        }
        
    except Exception as e:
        (log or _log).error(f"[notes] Error returning to notes list: {e}")
        return {
            "success": False,
            "error": str(e),
            "user_message": "Failed to return to notes list."
        }


async def bot_download_note(
    room_url: str,
    fmt: str = "markdown"
) -> dict[str, Any]:
    """Download the current active note content.
    
    Args:
        room_url: Daily room URL for tenant context
        fmt: Format to download (currently only markdown/text supported)
        
    Returns:
        Dict with success status and note content
    """
    try:
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            return {
                "success": False,
                "error": "No tenant context",
                "user_message": "Cannot download note without tenant context"
            }
            
        note_id = _get_room_state().get_active_note_id(room_url)
        if not note_id:
            return {
                "success": False,
                "error": "No active note",
                "user_message": "No note is currently open to download."
            }
            
        note = await notes_actions.get_note_by_id(tenant_id, note_id)
        if not note:
            return {
                "success": False,
                "error": "Note not found",
                "user_message": "The active note could not be found."
            }
            
        # For now, we just return the content as the "download"
        # In a real implementation, this might generate a file URL or similar
        content = note.get("content", "")
        title = note.get("title", "Untitled")
        
        return {
            "success": True,
            "content": content,
            "title": title,
            "format": fmt,
            "user_message": f"Here is the content of '{title}':\n\n{content}"
        }
        
    except Exception as e:
        (log or _log).error(f"[notes] Error downloading note: {e}")
        return {
            "success": False,
            "error": str(e),
            "user_message": "Failed to download note."
        }
