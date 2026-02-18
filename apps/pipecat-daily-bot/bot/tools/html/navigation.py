"""Navigation operations for HTML tools."""
from __future__ import annotations

from typing import Any
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import html_actions, notes_actions, sharing_actions
from tools.decorators import bot_tool
from tools.logging_utils import bind_context_logger, bind_tool_logger
from tools.sharing import utils as sharing_tools
from tools import events

from .prompts import DEFAULT_HTML_TOOL_PROMPTS
from .utils import _get_room_state

# ============================================================================
# Tool Handlers
# ============================================================================

@bot_tool(
    name="bot_load_html_applet",
    description=DEFAULT_HTML_TOOL_PROMPTS["bot_load_html_applet"],
    feature_flag="htmlContent",
    parameters={
        "type": "object",
        "properties": {
            "applet_id": {
                "type": "string",
                "description": "ID of the applet to load"
            },
            "title": {
                "type": "string",
                "description": "Search for applet by its title (fuzzy match)"
            },
            "note_id": {
                "type": "string",
                "description": "Find applet by its source note ID (searches for applets with this sourceNoteId)"
            },
            "note_title": {
                "type": "string",
                "description": "Find applet by source note title (fuzzy match on note title, then find applets from that note)"
            }
        },
        "required": []
    }
)
async def load_html_applet_handler(params: FunctionCallParams):
    """Load an HTML applet by ID, title, or source note."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    context = getattr(params, 'handler_context', params.context)
    
    log = bind_tool_logger(params, tag="[html_tools]").bind(arguments=arguments)

    log.info("LOAD APPLET HANDLER called")
    
    # Get tenant_id from context first, fall back to _get_room_state()
    tenant_id = context.tenant_id() if context and hasattr(context, 'tenant_id') else None
    if not tenant_id:
        tenant_id = _get_room_state().get_room_tenant_id(room_url)

    log = log.bind(tenantId=tenant_id, roomUrl=room_url)
    log.info("TENANT CONTEXT resolved")
    
    if not tenant_id:
        log.error("Cannot load HTML applet: no tenant_id")
        await params.result_callback({"success": False, "error": "No tenant context available"}, properties=FunctionCallResultProperties(run_llm=True))
        return
    
    user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
    log = log.bind(userId=user_id)
    if not user_id:
        log.warning("Could not identify user for applet loading", error=error_msg)
        await params.result_callback(
            {
                "success": False,
                "error": error_msg or "Could not identify user",
                "user_message": error_msg
                or "I couldn't identify which user is making this request. Please try again.",
            },
            properties=FunctionCallResultProperties(run_llm=True)
        )
        return
    
    result = await bot_load_html_applet(
        tenant_id, user_id, room_url, arguments, forwarder, params, log=log
    )
    
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ============================================================================
# Implementations
# ============================================================================

async def bot_load_html_applet(
    tenant_id: str,
    user_id: str,
    room_url: str,
    arguments: dict[str, Any],
    forwarder: Any,
    params: FunctionCallParams,
    *,
    log: Any | None = None,
) -> dict[str, Any]:
    """Implementation of load_html_applet logic."""
    applet = None
    search_method = None
    log = log or bind_context_logger(tag="[html_tools]", room_url=room_url, user_id=user_id)
    
    # 1. Try loading by applet ID first
    applet_id = arguments.get("applet_id")
    if applet_id:
        log.info("Searching applet by id", appletId=applet_id)
        applet = await html_actions.get_html_generation_by_id(tenant_id, applet_id)
        if applet:
            search_method = "applet ID"
            log.info("Found applet by id", title=applet.get("title"), appletUserId=applet.get("userId"))
    
    # 2. Fall back to applet title search
    if not applet:
        title = arguments.get("title")
        if title:
            log.info("Searching applet by title", title=title)
            applet = await html_actions.fuzzy_search_applets(tenant_id, title, user_id)
            if applet:
                search_method = "applet title"
                log.info("Found applet by title", title=applet.get("title"), appletId=applet.get("_id"), appletUserId=applet.get("userId"))
    
    # 3. Try note ID search - find applets with this sourceNoteId
    if not applet:
        note_id = arguments.get("note_id")
        if note_id:
            # Get all applets and filter by sourceNoteId
            generations = await html_actions.list_html_generations(tenant_id, user_id)
            matching_applets = [
                gen for gen in generations
                if gen.get("sourceNoteId") == note_id
            ]
            if matching_applets:
                # Return the most recent (first in list)
                applet = matching_applets[0]
                search_method = "note ID"
                log.info("Found applets for note id", count=len(matching_applets), noteId=note_id)
    
    # 4. Fall back to note title fuzzy search
    if not applet:
        note_title = arguments.get("note_title")
        if note_title:
            # Use notes_actions to fuzzy search for the note
            notes = await notes_actions.fuzzy_search_notes(tenant_id, note_title, user_id)
            if len(notes) >= 1:
                log.warning("Multiple notes found for note title", noteTitle=note_title, count=len(notes))
                
                # Find applets with this note as source
                generations = await html_actions.list_html_generations(tenant_id, user_id)
                matching_applets = []
                for note in notes:
                    for gen in generations:
                        if gen.get("sourceNoteId") == note.get("_id"):
                            matching_applets.append({"gen": gen, "note": note})
                if matching_applets:
                    applet = matching_applets[0].get("gen")
                    note = matching_applets[0].get("note")
                    search_method = f"note title '{note_title}' matched note '{note.get('title')}'"
                    log.info("Found applets for note title", noteTitle=note_title, count=len(matching_applets), chosenApplet=applet.get("title"))
        
    if not applet:
        error_msg = "HTML applet not found"
        if arguments.get("note_title"):
            error_msg = f"No HTML applet found for note titled '{arguments.get('note_title')}'"
        elif arguments.get("note_id"):
            error_msg = f"No HTML applet found for note ID '{arguments.get('note_id')}'"
        elif arguments.get("title"):
            error_msg = f"No HTML applet found with title '{arguments.get('title')}'"
        
        return {"success": False, "error": error_msg}
    
    # SECURITY CHECK: Verify permission to open applet (may be shared)
    log.info("Permission check start", appletId=applet["_id"], appletTitle=applet.get("title"), appletUserId=applet.get("userId"))
    log.info("Checking permissions", tenantId=tenant_id, userId=user_id, resourceId=applet["_id"], contentType="HtmlGeneration")
    
    has_read = await sharing_actions.check_resource_read_permission(
        tenant_id=tenant_id, user_id=user_id, resource_id=applet["_id"], content_type='HtmlGeneration'
    )
    
    log.info("Permission result", hasRead=has_read)

    if not has_read:
        log.warning(
            "Permission denied to open applet",
            userId=user_id,
            appletId=applet["_id"],
            appletUserId=applet.get("userId"),
            tenantId=tenant_id,
        )
        return {
            "success": False,
            "error": "Permission denied",
            "user_message": "You don't have permission to access this HTML applet.",
        }
    
    log.info("Permission granted for applet", userId=user_id, appletId=applet["_id"])

    # MULTI-USER SESSION HANDLING - DISABLED, WILL FIX LATER
    # If this is a multi-user session, we need to ensure the applet is shared with everyone
    
    # if not sharing_tools._is_private_single_user_session(room_url, params):
    #     logger.info(f"[html_tools] 👥 MULTI-USER SESSION - Sharing applet {applet['_id']} with participants")
        
    #     # Check if user has share permission
    #     has_share = await sharing_actions.check_resource_share_permission(
    #         tenant_id=tenant_id, user_id=user_id, resource_id=applet["_id"], content_type='HtmlGeneration'
    #     )
        
    #     if not has_share:
    #         logger.warning(f"[html_tools] User {user_id} does not have share permission for applet {applet['_id']}")
    #         return {
    #             "success": False,
    #             "error": "Permission denied",
    #             "user_message": "You don't have permission to share this applet with the group.",
    #         }
            
    #     # Share with all participants
    #     share_result = await sharing_tools._share_resource_with_participants(
    #         room_url=room_url,
    #         resource_id=applet["_id"],
    #         content_type='HtmlGeneration',
    #         owner_user_id=user_id
    #     )
        
    #     if not share_result.get("success"):
    #         logger.error(f"[html_tools] Failed to share applet: {share_result.get('errors')}")
    #         # We continue anyway, as some participants might have been shared with
            
    #     # Set as active applet for the room
    #     _get_room_state().set_active_applet_id(room_url, applet["_id"], owner=user_id)
        
    #     # Emit APPLET_OPEN event with shared info
    #     if forwarder and room_url:
    #         open_event_data = {
    #             "applet_id": applet.get("_id"),
    #             "title": applet.get("title"),
    #             "content_type": applet.get("contentType", "app"),
    #             "sharedWith": share_result.get("shared_with", [])
    #         }
    #         await forwarder.emit_tool_event(events.APPLET_OPEN, open_event_data)
    #         logger.info(f"[html_tools] Sent APPLET_OPEN event for applet '{applet.get('title')}' (shared with {len(share_result.get('shared_with', []))} users)")
            
    #         # Also emit HTML_LOADED for local display if needed (though APPLET_OPEN usually handles it)
    #         event_data = {
    #             "applet_id": applet.get("_id"),
    #             "title": applet.get("title"),
    #             "content_type": applet.get("contentType", "app"),
    #             "html_content": applet.get("htmlContent", "")
    #         }
    #         await forwarder.emit_tool_event(events.HTML_LOADED, event_data)
            
    #     user_message = f"Loaded and shared HTML applet '{applet.get('title')}'"
    #     if search_method and search_method.startswith("note"):
    #         user_message += f" (found via {search_method})"
            
    #     return {
    #         "success": True,
    #         "user_message": user_message,
    #         "applet": {
    #             "id": applet.get("_id"),
    #             "title": applet.get("title")
    #         }
    #     }
    # else:
    if has_read:
        # Single user session - emit APPLET_OPEN
        if forwarder and room_url:
            event_data = {
                "applet_id": applet.get("_id"),
                "title": applet.get("title"),
                "content_type": applet.get("contentType", "app"),
                "html_content": applet.get("htmlContent", "")
            }
            await forwarder.emit_tool_event(events.APPLET_OPEN, event_data)
            log.info("Sent APPLET_OPEN event", appletId=applet.get("_id"), title=applet.get("title"))
            
        user_message = f"Loaded HTML applet '{applet.get('title')}'"
        if search_method and search_method.startswith("note"):
            user_message += f" (found via {search_method})"
            
        return {
            "success": True,
            "user_message": user_message,
            "applet": {
                "id": applet.get("_id"),
                "title": applet.get("title")
            }
        }
