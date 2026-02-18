from __future__ import annotations

import json
from typing import Any, Literal, TYPE_CHECKING

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import notes_actions, sharing_actions
from tools.decorators import bot_tool
from services import mesh as mesh_client
from tools.logging_utils import bind_tool_logger, bind_context_logger

from .prompts import DEFAULT_SHARING_TOOL_PROMPTS
from .utils import (
    _resolve_user_id,
    _fuzzy_find_user,
    _find_sharing_organization_for_resource,
    _create_sharing_organization,
    _share_resource_with_participants,
    _get_room_state,
)

log = bind_context_logger(tag="[sharing_tools]")
logger = log

if TYPE_CHECKING:
    from services.app_message_forwarder import AppMessageForwarder

@bot_tool(
    name="bot_share_note_with_user",
    description=DEFAULT_SHARING_TOOL_PROMPTS["bot_share_note_with_user"],
    feature_flag="resourceSharing",
    parameters={
        "type": "object",
        "properties": {
            "note_search_term": {
                "type": "string",
                "description": "Note title or partial title to search for"
            },
            "target_user_email": {
                "type": "string",
                "description": "Email address (or partial email) of user to share with"
            },
            "target_user_name": {
                "type": "string",
                "description": "Name of user to share with (used if email not available)"
            },
            "permission_level": {
                "type": "string",
                "enum": ["read", "write"],
                "description": "Permission level: 'read' for read-only, 'write' for full edit",
                "default": "write"
            }
        },
        "required": ["note_search_term"]
    }
)
async def share_note_with_user_handler(params: FunctionCallParams):
    """Handle bot_share_note_with_user tool call."""
    result = await bot_share_note_with_user(
        params,
        params.arguments.get('note_search_term'),
        params.arguments.get('target_user_email'),
        params.arguments.get('target_user_name'),
        params.arguments.get('permission_level', 'write')
    )
    
    if result.get("success"):
        await params.result_callback(
            result.get("user_message", "Shared note successfully."),
            properties=FunctionCallResultProperties(run_llm=True)
        )
    else:
        await params.result_callback(
            f"Error: {result.get('error', 'Unknown error')}",
            properties=FunctionCallResultProperties(run_llm=True)
        )


async def bot_share_note_with_user(
    params: FunctionCallParams,
    note_search_term: str,
    target_user_email: str | None = None,
    target_user_name: str | None = None,
    permission_level: Literal['read', 'write'] = 'write'
) -> dict:
    """Share a note with a specific user by email or name.
    
    Args:
        params: FunctionCallParams with context, room_url, etc.
        note_search_term: Partial note title to search
        target_user_email: Email address to search for recipient (preferred)
        target_user_name: Name to search for recipient (fallback)
        permission_level: 'read' (viewer) or 'write' (member)
        
    Returns:
        {"success": bool, "user_message": str} or {"success": false, "error": str}
    """
    try:
        from tools.sharing.utils import _get_room_state
        
        bot = _get_room_state()
        room_url = params.room_url
        tenant_id = bot.get_room_tenant_id(room_url)
        if not tenant_id:
            return {
                "success": False,
                "error": "No tenant context available"
            }

        user_id, error_msg = await _resolve_user_id(params, room_url)
        if not user_id:
            logger.warning(f"[notes] Could not identify user for permission check: {error_msg}")
            return {
                "success": False,
                "error": error_msg
            }

        # Step 1: Fuzzy search for note
        logger.info(f"[sharing] Searching for note: '{note_search_term}'")
        
        # Use notes_actions fuzzy search which handles vector search if available
        notes = await notes_actions.fuzzy_search_notes(tenant_id, note_search_term, user_id)
        
        if not notes:
            return {"success": False, "error": f"No notes found matching '{note_search_term}'"}
        
        # Pick the best match (first one)
        note = notes[0]
        note_id = note.get('_id')
        note_title = note.get('title', 'Untitled')
        
        logger.info(f"[sharing] Found note: {note_title} ({note_id})")

        # SECURITY CHECK: Verify user has permission to share this note
        has_share = await sharing_actions.check_resource_share_permission(
            tenant_id=tenant_id,
            user_id=user_id,
            resource_id=note_id,
            content_type='Notes'
        )
        if not has_share:
            return {"success": False, "error": f"You do not have permission to share the note '{note_title}'."}
       
        # Step 2: Find the user using 4-strategy approach (including org members)
        if not target_user_email and not target_user_name:
            return {"success": False, "error": "Must provide target_user_email or target_user_name"}
        
        logger.info(f"[sharing] Searching for user: email='{target_user_email}' name='{target_user_name}'")
        recipient_id, error_msg = await _fuzzy_find_user(
            room_url=room_url,
            user_email=target_user_email,
            user_name=target_user_name,
            resource_id=note_id,
            content_type='Notes',
            tenant_id=tenant_id
        )
        
        if not recipient_id:
            return {"success": False, "error": error_msg}
        
        # Get recipient details for display
        recipient_display = target_user_email or target_user_name
        
        logger.info(f"[sharing] Found user: {recipient_id}")
        
        # Step 3: Get or create sharing organization for this note
        # First try to find existing organization
        org = await _find_sharing_organization_for_resource(
            tenant_id=tenant_id,
            owner_user_id=user_id,
            resource_id=note_id,
            content_type='Notes'
        )
        
        # If no organization exists, create one
        if not org:
            logger.info(f"[sharing] No existing sharing org found, creating new one for Note {note_id}")
            org = await _create_sharing_organization(
                tenant_id=tenant_id,
                owner_user_id=user_id,
                resource_id=note_id,
                content_type='Notes',
                resource_title=note_title
            )
        
        if not org:
            return {"success": False, "error": "Failed to create sharing organization"}
        
        org_id = org.get('_id')
        logger.info(f"[sharing] Using organization: {org_id}")
        
        # Step 4: Map permission level to role
        # read -> viewer (read-only)
        # write -> member (read + write, but no delete)
        role = 'viewer' if permission_level == 'read' else 'member'
        
        # Step 5: Share resource with user
        success = await sharing_actions.share_resource_with_user(
            tenant_id=tenant_id,
            organization_id=org_id,
            user_id=recipient_id,
            resource_id=note_id,
            content_type='Notes',
            role=role
        )
        
        if not success:
            return {"success": False, "error": f"Failed to share note with {recipient_display}"}
        
        # Step 6: Emit event
        forwarder = params.forwarder
        if forwarder:
            from tools import events
            await forwarder.emit_tool_event(events.RESOURCE_ACCESS_CHANGED, {
                "noteId": note_id,
                "userId": recipient_id,
                "permission": permission_level,
                "ownerUserId": user_id,
                "resourceType": "Notes"
            })
        
        logger.info(f"[sharing] Shared '{note_title}' with {recipient_display} ({permission_level})")
        
        return {
            "success": True,
            "user_message": f"✅ Shared '{note_title}' with {recipient_display} ({permission_level} access)."
        }
        
    except Exception as e:
        logger.error(f"[sharing] bot_share_note_with_user error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def _share_and_activate_note(
    room_url: str,
    note_id: str,
    tenant_id: str,
    owner_user_id: str,
    forwarder: AppMessageForwarder | None = None,
) -> dict[str, Any]:
    """Internal utility to share a note with participants and set as active.
    
    This handles the common logic for sharing and activating notes that's used by
    both bot_open_note (LLM tool) and _process_note_context (HTTP endpoint).
    
    Args:
        room_url: Daily room URL
        note_id: ID of the note to share and activate
        tenant_id: Tenant ID for context
        owner_user_id: User ID of the note owner
        forwarder: Optional message forwarder for events
        
    Returns:
        Dict with success status, note_id, and optional error/user_message
    """
    try:
        # Get note details
        note = await notes_actions.get_note_by_id(tenant_id, note_id)
        if not note:
            return {
                "success": False,
                "error": "Note not found",
                "user_message": f"Note with ID {note_id} not found."
            }
        
        # Share with all call participants
        share_result = await _share_resource_with_participants(
            room_url=room_url,
            resource_id=note_id,
            content_type='Notes',
            owner_user_id=owner_user_id
        )
        
        # Set as active note
        _get_room_state().set_active_note_id(room_url, note_id, owner=owner_user_id)
        
        # Emit NOTE_OPEN event (modern event system)
        if forwarder:
            from tools import events
            await forwarder.emit_tool_event(events.NOTE_OPEN, {
                "noteId": note_id,
                "sharedWith": share_result.get("shared_with", [])
            })
            logger.info(f'[sharing] Emitted NOTE_OPEN event for note {note_id}')
        
        # Build user message
        shared_count = len(share_result.get("shared_with", []))
        user_message = f"Set current note to: {note.get('title', 'Untitled')}."
        if shared_count > 0:
            user_message += f" Shared with {shared_count} participant{'s' if shared_count != 1 else ''}."
        
        return {
            "success": True,
            "note_id": note_id,
            "user_message": user_message,
            "shared_count": shared_count
        }
        
    except Exception as e:
        logger.error(f"[sharing] Error in _share_and_activate_note: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "user_message": "Failed to share and activate note."
        }
