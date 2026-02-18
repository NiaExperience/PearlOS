"""Content manipulation tools for notes."""
from __future__ import annotations

from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import notes_actions
from tools.decorators import bot_tool
from tools.sharing import utils as sharing_tools
from tools.logging_utils import bind_tool_logger

from .crud import bot_replace_note
from .prompts import DEFAULT_NOTE_TOOL_PROMPTS
from .utils import _get_room_state, _extract_note_content

# ============================================================================
# Tool Handlers
# ============================================================================

@bot_tool(
    name="bot_replace_note_content",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_replace_note_content"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The content to write to the note"
            },
            "section": {
                "type": "string",
                "description": "Optional section identifier where content should be written"
            },
            "note_id": {
                "type": "string",
                "description": "Optional note ID to write to. If not provided, writes to the currently active note."
            },
            "title": {
                "type": "string",
                "description": "The title of the note to modify. If not provided, writes to the currently active note."
            }        
        },
        "required": ["content"]
    }
)
async def replace_note_content_handler(params: FunctionCallParams):
    """Handle bot_replace_note_content tool call."""
    log = bind_tool_logger(params, tag="[notes_tools]")

    async def replace_note_content(
        params: FunctionCallParams | None = None,
    ) -> dict[str, Any]:
        """Remove specific content or sections from the note.
        
        Args:
            room_url: Daily room URL for tenant context
            pattern: Text pattern to replace
            replace: The text to replace 'pattern' with
            forwarder: Optional message forwarder for events
            params: Function call params (for permission checks)
            note_id: Optional note ID to remove from (if not provided, uses active note)
            
        Returns:
            Dict with success status and optional error message
        """
        room_url = params.room_url
        arguments = params.arguments
        forwarder = params.forwarder
        pattern = arguments.get("pattern")
        replace = arguments.get("replace")
        note_id = arguments.get("note_id")
        title = arguments.get("title")
        try:
            user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
            if not user_id:
                log.warning(f"[notes] Could not identify user for permission check: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg or "Could not identify user",
                    "user_message": error_msg or "I couldn't identify which user is making this request. Please try again."
                }
            
            # Get tenant context
            tenant_id = _get_room_state().get_room_tenant_id(room_url)
            if not tenant_id:
                return {
                    "success": False,
                    "error": "No tenant context",
                    "user_message": "I'm having trouble accessing the workspace context."
                }

            note = None
            if note_id:
                note = await notes_actions.get_note_by_id(tenant_id, note_id)
            # Accept note_id parameter or fall back to active note
            else:
                note_id = await _get_room_state().get_active_note_id(room_url)
                if note_id:
                    note = await notes_actions.get_note_by_id(tenant_id, note_id)
                elif title:
                    notes = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
                    if not notes or len(notes) == 0:
                        log.warning(f"[notes] No note found with title: {title} and tenant_id: {tenant_id}")
                        return {
                            "success": False, 
                            "error": f"Note with title '{title}' not found",
                            "user_message": f"I couldn't find a note matching '{title}'."
                        }
                    if len(notes) > 1:
                        log.warning(f"[notes] Multiple notes found with title: {title}, prompting user to choose.")
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
                    log.error("[notes] Cannot append: no note_id or title provided, and no active note")
                    return {
                        "success": False, 
                        "error": "No note_id or title provided, and no active note",
                        "user_message": "Please open a note first, or specify which note to add to."
                    }
            
            if not note:
                return {
                    "success": False,
                    "error": "Note not found",
                    "user_message": "The note you're trying to update doesn't exist."
                }

            # SECURITY CHECK: inside bot_replace_note
            
            existing_content = _extract_note_content(note)
            # Replace pattern in content
            new_content = existing_content.replace(pattern, replace)
            # Update note with modified content and permission check, passing note_id explicitly
            return await bot_replace_note(room_url, new_content, forwarder=forwarder, note_id=note_id, params=params)
            
        except Exception as e:
            log.error(f"[notes] Error removing note content: {e}")
            return {
                "success": False,
                "error": str(e),
                "user_message": "Failed to remove content from note."
            }

    result = await replace_note_content(params)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_add_note_content",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_add_note_content"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The content to add to the note"
            },
            "position": {
                "type": "string",
                "description": "Where to add content: 'start', 'end', or 'cursor' (default 'end')",
                "default": "end"
            },
            "note_id": {
                "type": "string",
                "description": "Optional note ID to add content to. If not provided, adds to the currently active note."
            },
            "title": {
                "type": "string",
                "description": "Optiona title of the note to modify. If not provided, adds to the currently active note."
            },
        },
        "required": ["content"]
    }
)
async def add_note_content_handler(params: FunctionCallParams):
    """Handle bot_add_note_content tool call."""
    log = bind_tool_logger(params, tag="[notes_tools]")

    async def add_note_content(
        params: FunctionCallParams | None = None
    ) -> dict[str, Any]:
        """Add new content to the note without replacing existing content.
        """

        room_url = params.room_url
        arguments = params.arguments
        forwarder = params.forwarder
        content = arguments.get("content")
        position = arguments.get("position", "end")
        note_id = arguments.get("note_id")
        title = arguments.get("title")
        try:
            user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
            if not user_id:
                log.warning(f"[notes] Could not identify user for permission check: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg or "Could not identify user",
                    "user_message": error_msg or "I couldn't identify which user is making this request. Please try again."
                }
            
            # Get tenant context
            tenant_id = _get_room_state().get_room_tenant_id(room_url)
            if not tenant_id:
                return {
                    "success": False,
                    "error": "No tenant context",
                    "user_message": "I'm having trouble accessing the workspace context."
                }

            note = None
            if note_id:
                note = await notes_actions.get_note_by_id(tenant_id, note_id)
            # Accept note_id parameter or fall back to active note
            else:
                note_id = await _get_room_state().get_active_note_id(room_url)
                if note_id:
                    note = await notes_actions.get_note_by_id(tenant_id, note_id)
                elif title:
                    notes = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
                    if not notes or len(notes) == 0:
                        log.warning(f"[notes] No note found with title: {title} and tenant_id: {tenant_id}")
                        return {
                            "success": False, 
                            "error": f"Note with title '{title}' not found",
                            "user_message": f"I couldn't find a note matching '{title}'."
                        }
                    if len(notes) > 1:
                        log.warning(f"[notes] Multiple notes found with title: {title}, prompting user to choose.")
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
                    log.error("[notes] Cannot append: no note_id or title provided, and no active note")
                    return {
                        "success": False, 
                        "error": "No note_id or title provided, and no active note",
                        "user_message": "Please open a note first, or specify which note to add to."
                    }
            
            if not note:
                return {
                    "success": False,
                    "error": "Note not found",
                    "user_message": "The note you're trying to update doesn't exist."
                }

            # SECURITY CHECK: inside bot_replace_note

            existing_content = _extract_note_content(note)
            # Add content based on position
            if position == "start":
                new_content = content + "\n\n" + existing_content
            else:  # 'end' or 'cursor' (default to end)
                new_content = existing_content + "\n\n" + content
            
            # Update note with combined content and permission check, passing note_id explicitly
            return await bot_replace_note(room_url, new_content, forwarder=forwarder, note_id=note_id, params=params)
            
        except Exception as e:
            log.error(f"[notes] Error adding note content: {e}")
            return {
                "success": False,
                "error": str(e),
                "user_message": "Failed to add content to note."
            }

    result = await add_note_content(params)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_remove_note_content",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_remove_note_content"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Text pattern to remove from the note"
            },
            "note_id": {
                "type": "string",
                "description": "Optional note ID to remove content from. If not provided, removes from the currently active note."
            },
            "title": {
                "type": "string",
                "description": "Optiona title of the note to modify. If not provided, adds to the currently active note."
            },
        },
        "required": ["pattern"]
    }
)
async def remove_note_content_handler(params: FunctionCallParams):
    """Handle bot_remove_note_content tool call."""
    async def remove_note_content(
        params: FunctionCallParams | None = None,
    ) -> dict[str, Any]:
        """Remove specific content or sections from the note.
        
        Args:
            room_url: Daily room URL for tenant context
            pattern: Text pattern to remove
            forwarder: Optional message forwarder for events
            params: Function call params (for permission checks)
            note_id: Optional note ID to remove from (if not provided, uses active note)
            
        Returns:
            Dict with success status and optional error message
        """
        room_url = params.room_url
        arguments = params.arguments
        forwarder = params.forwarder
        pattern = arguments.get("pattern")
        note_id = arguments.get("note_id")
        title = arguments.get("title")
        try:
            user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
            if not user_id:
                logger.warning(f"[notes] Could not identify user for permission check: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg or "Could not identify user",
                    "user_message": error_msg or "I couldn't identify which user is making this request. Please try again."
                }
            
            # Get tenant context
            tenant_id = _get_room_state().get_room_tenant_id(room_url)
            if not tenant_id:
                return {
                    "success": False,
                    "error": "No tenant context",
                    "user_message": "I'm having trouble accessing the workspace context."
                }

            note = None
            if note_id:
                note = await notes_actions.get_note_by_id(tenant_id, note_id)
            # Accept note_id parameter or fall back to active note
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
                    logger.error("[notes] Cannot append: no note_id or title provided, and no active note")
                    return {
                        "success": False, 
                        "error": "No note_id or title provided, and no active note",
                        "user_message": "Please open a note first, or specify which note to add to."
                    }
            
            if not note:
                return {
                    "success": False,
                    "error": "Note not found",
                    "user_message": "The note you're trying to update doesn't exist."
                }

            # SECURITY CHECK: inside bot_replace_note

            existing_content = _extract_note_content(note)
            # Remove pattern from content
            new_content = existing_content.replace(pattern, "")
            
            # Update note with modified content and permission check, passing note_id explicitly
            return await bot_replace_note(room_url, new_content, forwarder=forwarder, note_id=note_id, params=params)
            
        except Exception as e:
            logger.error(f"[notes] Error removing note content: {e}")
            return {
                "success": False,
                "error": str(e),
                "user_message": "Failed to remove content from note."
            }

    result = await remove_note_content(params)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
