from __future__ import annotations

from typing import Any, TYPE_CHECKING

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import notes_actions, html_actions, sharing_actions
from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger, bind_context_logger

from .prompts import DEFAULT_SHARING_TOOL_PROMPTS
from .utils import (
    _get_room_state,
    _resolve_user_id,
    _fuzzy_find_user,
    _find_sharing_organization_for_resource,
    _create_sharing_organization,
)

log = bind_context_logger(tag="[sharing_tools]")
logger = log

if TYPE_CHECKING:
    from services.app_message_forwarder import AppMessageForwarder
    from typing import Literal


# ============================================================================
# Access Control Tools
# ============================================================================

@bot_tool(
    name="bot_set_user_access_level",
    description=DEFAULT_SHARING_TOOL_PROMPTS["bot_set_user_access_level"],
    feature_flag="resourceSharing",
    parameters={
        "type": "object",
        "properties": {
            "access_level": {
                "type": "string",
                "enum": ["owner", "admin", "member", "viewer"],
                "description": "Access level to grant (owner, admin, member, viewer)"
            },
            "user_email": {
                "type": "string",
                "description": "Email address of the user to update"
            },
            "user_name": {
                "type": "string",
                "description": "Name of the user (used if email not available)"
            },
            "resource_type": {
                "type": "string",
                "enum": ["note", "applet"],
                "description": "Type of resource (note or applet)"
            },
            "resource_title": {
                "type": "string",
                "description": "Title of the note or applet (optional - if not provided, uses the currently active resource)"
            },
            "resource_id": {
                "type": "string",
                "description": "ID of the note or applet (optional - preferred if you have the ID)"
            }
        },
        "required": ["access_level", "resource_type"]
    }
)
async def set_user_access_level_handler(params: FunctionCallParams):
    """Handle bot_set_user_access_level tool call."""
    try:
        result = await bot_set_user_access_level(
            room_url=params.room_url,
            access_level=params.arguments.get("access_level"),
            resource_type=params.arguments.get("resource_type"),
            user_email=params.arguments.get("user_email"),
            user_name=params.arguments.get("user_name"),
            resource_title=params.arguments.get("resource_title"),
            resource_id=params.arguments.get("resource_id"),
            forwarder=params.forwarder,
            params=params
        )
        
        await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
    except Exception as e:
        logger.error(f"[sharing] set_user_access_level_handler error: {e}", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": f"Error updating user access level: {e}"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_upgrade_user_access",
    description=DEFAULT_SHARING_TOOL_PROMPTS["bot_upgrade_user_access"],
    feature_flag="resourceSharing",
    parameters={
        "type": "object",
        "properties": {
            "user_email": {
                "type": "string",
                "description": "Email address of the user to upgrade"
            },
            "user_name": {
                "type": "string",
                "description": "Name of the user (used if email not available)"
            },
            "resource_type": {
                "type": "string",
                "enum": ["note", "applet"],
                "description": "Type of resource (note or applet)"
            },
            "resource_title": {
                "type": "string",
                "description": "Title of the note or applet (optional - if not provided, uses the currently active resource)"
            },
            "resource_id": {
                "type": "string",
                "description": "ID of the note or applet (optional - preferred if you have the ID)"
            }
        },
        "required": ["resource_type"]
    }
)
async def upgrade_user_access_handler(params: FunctionCallParams):
    """Handle bot_upgrade_user_access tool call - convenience wrapper for upgrading to admin."""
    try:
        result = await bot_set_user_access_level(
            room_url=params.room_url,
            access_level="admin",
            resource_type=params.arguments.get("resource_type"),
            user_email=params.arguments.get("user_email"),
            user_name=params.arguments.get("user_name"),
            resource_title=params.arguments.get("resource_title"),
            resource_id=params.arguments.get("resource_id"),
            forwarder=params.forwarder,
            params=params
        )
        await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
    except Exception as e:
        logger.error(f"[sharing] upgrade_user_access_handler error: {e}", exc_info=True)
        await params.result_callback(
            {"success": False, "error": str(e)},
            properties=FunctionCallResultProperties(run_llm=True)
        )


@bot_tool(
    name="bot_downgrade_user_access",
    description=DEFAULT_SHARING_TOOL_PROMPTS["bot_downgrade_user_access"],
    feature_flag="resourceSharing",
    parameters={
        "type": "object",
        "properties": {
            "user_email": {
                "type": "string",
                "description": "Email address of the user to downgrade"
            },
            "user_name": {
                "type": "string",
                "description": "Name of the user (used if email not available)"
            },
            "resource_type": {
                "type": "string",
                "enum": ["note", "applet"],
                "description": "Type of resource (note or applet)"
            },
            "resource_title": {
                "type": "string",
                "description": "Title of the note or applet (optional - if not provided, uses the currently active resource)"
            },
            "resource_id": {
                "type": "string",
                "description": "ID of the note or applet (optional - preferred if you have the ID)"
            }
        },
        "required": ["resource_type"]
    }
)
async def downgrade_user_access_handler(params: FunctionCallParams):
    """Handle bot_downgrade_user_access tool call - convenience wrapper for downgrading to viewer."""
    try:
        result = await bot_set_user_access_level(
            room_url=params.room_url,
            access_level="viewer",
            resource_type=params.arguments.get("resource_type"),
            user_email=params.arguments.get("user_email"),
            user_name=params.arguments.get("user_name"),
            resource_title=params.arguments.get("resource_title"),
            resource_id=params.arguments.get("resource_id"),
            forwarder=params.forwarder,
            params=params
        )
        await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
    except Exception as e:
        logger.error(f"[sharing] downgrade_user_access_handler error: {e}", exc_info=True)
        await params.result_callback(
            {"success": False, "error": str(e)},
            properties=FunctionCallResultProperties(run_llm=True)
        )


async def bot_set_user_access_level(
    room_url: str,
    access_level: str,
    resource_type: str,
    user_email: str | None = None,
    user_name: str | None = None,
    resource_title: str | None = None,
    resource_id: str | None = None,
    forwarder: AppMessageForwarder | None = None,
    params: FunctionCallParams | None = None
) -> dict[str, Any]:
    """Set a user's access level for a shared resource.
    
    Can target a specific resource by title/ID or use the currently active resource.
    
    Args:
        room_url: Daily room URL
        access_level: New access level (owner, admin, member, viewer)
        resource_type: Type of resource ('note' or 'applet')
        user_email: Optional user email for identification
        user_name: Optional user name for identification
        resource_title: Optional resource title for lookup
        resource_id: Optional resource ID (preferred if available)
        forwarder: App message forwarder for events
        params: Function call params (for permission checks)
        
    Returns:
        {
            "success": bool,
            "user_message": str
        }
    """
    try:
        # 1. Validate inputs
        if access_level not in ['owner', 'admin', 'member', 'viewer']:
            return {
                "success": False,
                "error": f"Invalid access level: {access_level}"
            }
        
        if resource_type not in ['note', 'applet']:
            return {
                "success": False,
                "error": f"Invalid resource type: {resource_type}"
            }
        
        # 2. Get tenant context
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            return {
                "success": False,
                "error": "No tenant context available"
            }

        user_id, error_msg = await _resolve_user_id(params, room_url)
        if not user_id:
            logger.warning(f"[html_tools] Could not identify user for permission check: {error_msg}")
            return {
                "success": False,
                "error": error_msg
            }

        # 3. Find the resource by ID, title, or use active resource
        content_type = 'Notes' if resource_type == 'note' else 'HtmlGeneration'
        target_resource_id = None
        resource_display_name = None
        
        # Strategy 1: Use provided resource_id
        if resource_id:
            target_resource_id = resource_id
            # Verify it exists
            if resource_type == 'note':
                resource = await notes_actions.get_note_by_id(tenant_id, resource_id)
            else:
                resource = await html_actions.get_html_generation_by_id(tenant_id, resource_id)
            
            if not resource:
                return {
                    "success": False,
                    "error": f"{resource_type.capitalize()} with ID {resource_id} not found"
                }
            resource_display_name = resource.get('title', 'Untitled')
        
        # Strategy 2: Search by title
        elif resource_title:
            if resource_type == 'note':
                title = resource_title.strip()
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
                resource = notes[0]

            else:
                resource = await html_actions.fuzzy_search_applets(tenant_id, resource_title, user_id)
            
            if not resource:
                return {
                    "success": False,
                    "error": f"No {resource_type} found matching title '{resource_title}'"
                }
            target_resource_id = resource['_id']
            resource_display_name = resource.get('title', 'Untitled')
        
        # Strategy 3: Use currently active resource
        else:
            if resource_type == 'note':
                target_resource_id = await _get_room_state().get_active_note_id(room_url)
            else:
                target_resource_id = await _get_room_state().get_active_applet_id(room_url)
            
            if not target_resource_id:
                return {
                    "success": False,
                    "error": f"No active {resource_type} set for this call and no {resource_type} title provided. Please specify which {resource_type} you want to modify."
                }
            resource_display_name = f"active {resource_type}"
        
        # 4. Check caller permissions - REQUIRED for security

        user_id, error_msg = await _resolve_user_id(params, room_url)
        if not user_id:
            return {
                "success": False,
                "error": "Could not identify caller",
                "user_message": f"I couldn't identify who's making this request. {error_msg}"
            }

        # SECURITY CHECK: Verify caller has permission to change access
        has_share = await sharing_actions.check_resource_share_permission(
            tenant_id=tenant_id,
            user_id=user_id,
            resource_id=target_resource_id,
            content_type=content_type
        )
        
        if not has_share:
            return {
                "success": False,
                "error": "Permission denied",
                "user_message": "Only the resource owner or organization owner can change access levels."
            }
        
        # 5. Find target user by email or name
        if not user_email and not user_name:
            return {
                "success": False,
                "error": "Must provide user_email or user_name"
            }
        
        target_user_id, error_msg = await _fuzzy_find_user(
            room_url=room_url,
            user_email=user_email,
            user_name=user_name,
            resource_id=target_resource_id,
            content_type=content_type,
            tenant_id=tenant_id
        )
        
        if not target_user_id:
            return {
                "success": False,
                "error": error_msg
            }
        
        target_user_display = user_email or user_name
        
        # 6. Update role
        success = await sharing_actions.update_user_organization_role(
            tenant_id=tenant_id,
            user_id=target_user_id,
            resource_id=target_resource_id,
            content_type=content_type,
            new_role=access_level
        )
        
        if not success:
            return {
                "success": False,
                "error": f"Failed to update access level for {target_user_display}"
            }
        
        # 7. Emit RESOURCE_ACCESS_CHANGED event
        if forwarder:
            from tools import events
            await forwarder.emit_tool_event(events.RESOURCE_ACCESS_CHANGED, {
                "resourceId": target_resource_id,
                "resourceType": resource_type,
                "userId": target_user_id,
                "newAccessLevel": access_level
            })
        
        return {
            "success": True,
            "user_message": f"Set {target_user_display}'s access level to {access_level} for {resource_display_name}."
        }
        
    except Exception as e:
        logger.error(f"[sharing] bot_set_user_access_level error: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# ============================================================================
# User-to-User Sharing Tools (by email, fuzzy search)
# ============================================================================

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
                "description": "Permission level: 'read' for read-only (use this default if not specified by user), 'write' for full edit",
                "default": "read"
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
        params.arguments.get('permission_level', 'read')
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
    permission_level: Literal['read', 'write'] = 'read'
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
        bot = _get_room_state()
        room_url = params.room_url
        tenant_id = bot.get_room_tenant_id(room_url)
        if not tenant_id:
            return {"success": False, "error": "No tenant context available"}
        
        # Use existing _resolve_user_id to identify the command issuer
        user_id, error_msg = await _resolve_user_id(params, room_url)
        if not user_id:
            return {"success": False, "error": error_msg or "Could not identify user"}
        
        # Step 1: Find the note
        logger.info(f"[sharing] Searching for note: '{note_search_term}'")
        # fuzzy_search_notes signature: (tenant_id: str, title: str, user_id: str) -> Optional[list[dict]]
        title = note_search_term.strip()
        notes = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
        if not notes or len(notes) == 0:
            logger.warning(f"[sharing] No note found with title: {title} and tenant_id: {tenant_id}")
            return {
                    "success": False, 
                    "error": f"Note with title '{title}' not found",
                    "user_message": f"I couldn't find a note matching '{title}'."
            }
        if len(notes) > 1:
            logger.warning(f"[sharing] Multiple notes found with title: {title}, prompting user to choose.")
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
        
        if not note:
            return {"success": False, "error": f"No notes found matching '{note_search_term}'"}
        
        note_id = note.get('_id')
        note_title = note.get('title', 'Untitled')

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
                "resourceType": "Note"
            })
        
        logger.info(f"[sharing] Shared '{note_title}' with {recipient_display} ({permission_level})")
        
        return {
            "success": True,
            "user_message": f"✅ Shared '{note_title}' with {recipient_display} ({permission_level} access)."
        }
        
    except Exception as e:
        logger.error(f"[sharing] bot_share_note_with_user error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@bot_tool(
    name="bot_share_applet_with_user",
    description=DEFAULT_SHARING_TOOL_PROMPTS["bot_share_applet_with_user"],
    feature_flag="resourceSharing",
    parameters={
        "type": "object",
        "properties": {
            "applet_search_term": {
                "type": "string",
                "description": "Applet title or partial title to search for"
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
                "default": "read"
            }
        },
        "required": ["applet_search_term"]
    }
)
async def share_applet_with_user_handler(params: FunctionCallParams):
    """Handle bot_share_applet_with_user tool call."""
    result = await bot_share_applet_with_user(
        params,
        params.arguments.get('applet_search_term'),
        params.arguments.get('target_user_email'),
        params.arguments.get('target_user_name'),
        params.arguments.get('permission_level', 'read')
    )
    
    if result.get("success"):
        await params.result_callback(
            result.get("user_message", "Shared applet successfully."),
            properties=FunctionCallResultProperties(run_llm=True)
        )
    else:
        await params.result_callback(
            f"Error: {result.get('error', 'Unknown error')}",
            properties=FunctionCallResultProperties(run_llm=True)
        )


async def bot_share_applet_with_user(
    params: FunctionCallParams,
    applet_search_term: str,
    target_user_email: str | None = None,
    target_user_name: str | None = None,
    permission_level: Literal['read', 'write'] = 'read'
) -> dict:
    """Share an applet with a specific user by email or name.
    
    Args:
        params: FunctionCallParams with context, room_url, etc.
        applet_search_term: Partial applet title to search
        target_user_email: Email address to search for recipient (preferred)
        target_user_name: Name to search for recipient (fallback)
        permission_level: 'read' (viewer) or 'write' (admin)
        
    Returns:
        {"success": bool, "user_message": str} or {"success": false, "error": str}
    """
    try:
        import mesh_client
        import json
        
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
            logger.warning(f"[html_tools] Could not identify user for permission check: {error_msg}")
            return {
                "success": False,
                "error": error_msg
            }

        # Step 1: Fuzzy search for applet
        logger.info(f"[sharing] Searching for applet: '{applet_search_term}'")
        
        where = {"indexer": {"path": "createdBy", "equals": user_id}}
        params_search = {
            "tenant": tenant_id, # Resources are defined per-tenant
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "20"
        }
        
        response = await mesh_client.request("GET", "/content/HtmlGeneration", params=params_search)
        
        applets = []
        if response.get("success") and response.get("data"):
            all_applets = response.get("data", [])
            query_lower = applet_search_term.lower().strip()
            
            for applet in all_applets:
                title = applet.get('title', '').lower()
                if query_lower in title:
                    applets.append(applet)
            
            applets.sort(key=lambda a: len(a.get('title', '')))
        
        if not applets:
            return {"success": False, "error": f"No applets found matching '{applet_search_term}'"}

        applet = applets[0]
        applet_id = applet.get('_id')
        applet_title = applet.get('title', 'Untitled')
        
        logger.info(f"[sharing] Found applet: {applet_title} ({applet_id})")

        # SECURITY CHECK: Verify user has permission to share this applet
        has_share = await sharing_actions.check_resource_share_permission(
            tenant_id=tenant_id,
            user_id=user_id,
            resource_id=applet_id,
            content_type='HtmlGeneration'
        )
        if not has_share:
            return {"success": False, "error": f"You do not have permission to share the applet '{applet_title}'."}
       
        # Step 2: Find the user using 4-strategy approach (including org members)
        if not target_user_email and not target_user_name:
            return {"success": False, "error": "Must provide target_user_email or target_user_name"}
        
        logger.info(f"[sharing] Searching for user: email='{target_user_email}' name='{target_user_name}'")
        recipient_id, error_msg = await _fuzzy_find_user(
            room_url=room_url,
            user_email=target_user_email,
            user_name=target_user_name,
            resource_id=applet_id,
            content_type='HtmlGeneration',
            tenant_id=tenant_id
        )
        success_message = ""
        error_message = ""
        if recipient_id:
            # Get recipient details for display
            recipient_display = target_user_email or target_user_name
            
            logger.info(f"[sharing] Found user: {recipient_id}")
            
            # Step 3: Get or create sharing organization for this applet
            # First try to find existing organization
            org = await _find_sharing_organization_for_resource(
                tenant_id=tenant_id,
                owner_user_id=user_id,
                resource_id=applet_id,
                content_type='HtmlGeneration'
            )
            
            # If no organization exists, create one
            if not org:
                logger.info(f"[sharing] No existing sharing org found, creating new one for HtmlGeneration {applet_id}")
                org = await _create_sharing_organization(
                    tenant_id=tenant_id,
                    owner_user_id=user_id,
                    resource_id=applet_id,
                    content_type='HtmlGeneration',
                    resource_title=applet_title
                )
            
            if org:
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
                    resource_id=applet_id,
                    content_type='HtmlGeneration',
                    role=role
                )
                
                if success:
                    # Step 6: Emit event
                    forwarder = params.forwarder
                    if forwarder:
                        from tools import events
                        await forwarder.emit_tool_event(events.RESOURCE_ACCESS_CHANGED, {
                            "htmlGenerationId": applet_id,
                            "userId": recipient_id,
                            "permission": permission_level,
                            "ownerUserId": user_id,
                            "resourceType": "HtmlGeneration"
                        })
                    
                    logger.info(f"[sharing] Shared '{applet_title}' with {recipient_display} ({permission_level})")
                    success_message = f"Shared '{applet_title}' with {recipient_display} ({permission_level} access)."
                else:
                    error_message = f"Failed to share applet with {recipient_display}"

            else:
                error_message = "Failed to create sharing organization"
        else:
            error_message = error_msg or "Could not find user"
    
        forwarder = params.forwarder
        # If we have a forwarder, open the share control
        if forwarder:
            from tools import events
            await forwarder.emit_tool_event(events.APPLET_SHARE_OPEN, {
                "appletId": applet_id,
                "title": applet_title,
                "permission": permission_level,
                "resourceType": "HtmlGeneration",
                "requestedBy": user_id,
            })
            return {
                "success": True,
                "user_message": (
                    "I couldn't find that user, so I opened the share control to generate a link. "
                    "Please tell them: 'We couldn't find that person in the system, but here's a link you can share.'"
                ) if error_message else success_message + " I've also opened the share control for you."
            }

        # No forwarder, just return result
        if success_message:
            return {"success": True, "user_message": success_message}
        else:
            return {"success": False, "error": error_message or "User not found"}
        
    except Exception as e:
        logger.error(f"[sharing] bot_share_applet_with_user error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
