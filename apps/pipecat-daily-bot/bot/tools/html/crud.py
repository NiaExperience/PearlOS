"""CRUD operations for HTML tools."""
from __future__ import annotations

import os
from typing import Any
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import html_actions, notes_actions, sharing_actions
from tools.decorators import bot_tool
from tools.logging_utils import bind_context_logger, bind_tool_logger
from tools.sharing import utils as sharing_tools
from tools import events

from .prompts import DEFAULT_HTML_TOOL_PROMPTS
from .utils import _get_room_state, _create_or_request_html_generation

try:
    from nia_library_templates import LIBRARY_TEMPLATES  # type: ignore
except Exception:
    LIBRARY_TEMPLATES = []


def _auto_select_library_template(title: str, description: str, content_type: str) -> tuple[str | None, str | None]:
    """Heuristic to pick a library template when the request matches known templates.

    Matches against template id, name tokens, and tags in the title/description. Returns
    (library_type, library_template_id) or (None, None) when no confident match is found.
    """

    if not LIBRARY_TEMPLATES:
        return None, None

    text = f"{title} {description}".lower()
    best_match: tuple[str, str] | None = None
    best_score = 0

    for tmpl in LIBRARY_TEMPLATES:
        if tmpl.get("library_type") != content_type:
            continue

        tid = str(tmpl.get("id", "")).lower()
        name = str(tmpl.get("name", "")).lower()
        tags = " ".join(tmpl.get("tags", [])).lower()

        score = 0
        if tid and tid in text:
            score += 3
        for token in name.split():
            if token and token in text:
                score += 2
        for token in tags.split():
            if token and token in text:
                score += 1

        if score > best_score:
            best_score = score
            best_match = (tmpl.get("library_type"), tmpl.get("id"))

    if best_match and best_score > 0:
        return best_match

    return None, None


async def _resolve_applet_by_id_or_title(
    tenant_id: str,
    user_id: str | None,
    applet_id: str | None,
    title: str | None,
    *,
    log: Any | None = None,
):
    """Resolve an applet by id first, then by fuzzy title search.

    Returns a tuple of (applet, resolved_id, error_message). The error_message is
    user-friendly and safe to surface.
    """

    if applet_id:
        applet = await html_actions.get_html_generation_by_id(tenant_id, applet_id)
        if applet:
            return applet, applet.get("_id"), None

    search_title = title.strip() if title else None
    log = log or bind_context_logger(tag="[html_tools]")

    if search_title:
        log.info("Resolving applet by title via fuzzy search", title=search_title)
        found_applet = await html_actions.fuzzy_search_applets(tenant_id, search_title, user_id)
        if found_applet:
            return found_applet, found_applet.get("_id"), None

    # Nothing found by id or title
    if applet_id and search_title:
        return None, None, f"I couldn't find an applet matching id '{applet_id}' or title '{search_title}'."
    if applet_id:
        return None, None, f"I couldn't find an applet with id '{applet_id}'."
    if search_title:
        return None, None, f"I couldn't find an applet matching '{search_title}'."
    return None, None, "An applet id or title is required."

# ============================================================================
# Tool Handlers
# ============================================================================

@bot_tool(
    name="bot_create_app_from_description",
    description=DEFAULT_HTML_TOOL_PROMPTS["bot_create_app_from_description"],
    feature_flag="htmlContent",
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Title/name for the app (provided by user, never inferred)"
            },
            "description": {
                "type": "string",
                "description": "Detailed description of what the app should do, its features, visual style, etc."
            },
            "content_type": {
                "type": "string",
                "enum": ["game", "app", "tool", "interactive"],
                "description": "Type of HTML content to create: 'game' for games/arcade, 'app' for applications, 'tool' for utilities/widgets, 'interactive' for interactive experiences",
                "default": "game"
            },
            "library_type": {
                "type": "string",
                "enum": ["game", "app", "tool", "interactive"],
                "description": "Library type for template selection. Only provide if using a library template.",
                "default": "game"
            },
            "library_template_id": {
                "type": "string",
                "description": "Specific library template ID to use as a starting point. Only provide if user's request is similar an available template."
            }
        },
        "required": ["title", "description"]
    }
)
async def create_app_from_description_handler(params: FunctionCallParams):
    """Request AI generation of an HTML app from a description."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    _ = forwarder  # avoid unused warning; kept for future event hooks
    context = getattr(params, 'handler_context', params.context)
    
    log = bind_tool_logger(params, tag="[html_tools]").bind(arguments=arguments)
    
    log.info("create_app_from_description called")
    
    # Get tenant_id from context
    tenant_id = context.tenant_id() if context and hasattr(context, 'tenant_id') else None
    if not tenant_id:
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
    
    # Get user_id from context
    user_id = context.user_id() if context and hasattr(context, 'user_id') else None
    if not user_id:
        user_id = os.environ.get('BOT_SESSION_USER_ID')
        if user_id:
            log.info("Using BOT_SESSION_USER_ID from environment", userId=user_id)

    log = log.bind(tenantId=tenant_id, userId=user_id)
    
    if not tenant_id:
        log.error("Cannot request HTML generation: no tenant_id")
        await params.result_callback(
            {"success": False, "error": "No tenant context available"}, 
            properties=FunctionCallResultProperties(run_llm=True)
        )
        return
    
    if not user_id:
        log.error("Cannot request HTML generation: no user_id")
        await params.result_callback(
            {"success": False, "error": "No user session available"}, 
            properties=FunctionCallResultProperties(run_llm=True)
        )
        return
    
    # Extract parameters
    title = arguments.get("title", "").strip()
    description = arguments.get("description", "").strip()
    content_type = arguments.get("content_type", "tool")
    library_type = arguments.get("library_type")
    library_template_id = arguments.get("library_template_id")

    # If no template supplied, try to auto-select based on title/description
    if not library_template_id:
        auto_type, auto_template = _auto_select_library_template(title, description, content_type)
        if auto_template:
            library_type = library_type or auto_type
            library_template_id = auto_template
            log.info(
                "Auto-selected library template for request",
                libraryTemplateId=library_template_id,
                libraryType=library_type,
                title=title,
            )
    
    result = await bot_create_app_from_description(
        tenant_id, user_id, title, description, content_type, forwarder, room_url,
        library_type=library_type, library_template_id=library_template_id, log=log
    )
    
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


async def bot_create_app_from_description(
    tenant_id: str,
    user_id: str,
    title: str,
    description: str,
    content_type: str,
    forwarder: Any,
    room_url: str | None = None,
    library_type: str | None = None,
    library_template_id: str | None = None,
    *,
    log: Any | None = None,
) -> dict[str, Any]:
    """Implementation of create_app_from_description."""
    
    log = log or bind_context_logger(
        tag="[html_tools]",
        room_url=room_url,
        user_id=user_id,
    )
    
    # MANDATORY NAME CONFIRMATION: If no title provided, ask for it
    if not title:
        log.info("No title provided, asking user for app name")
        return {
            "success": False,
            "error": "Title required",
            "user_message": "What would you like to name this app?",
            "request_context": {
                "description": description,
                "content_type": content_type,
                "library_type": library_type,
                "library_template_id": library_template_id
            }
        }
    
    if not description:
        log.warning("No description provided")
        return {
            "success": False,
            "error": "Description required",
            "user_message": "I need a description of what the app should do."
        }
    
    # Title and description provided - start generation
    try:
        if forwarder:
            event_data = {
                "title": title,
                "description": description,
                "content_type": content_type,
                "user_request": description,
                "source_note_id": None,
                "features": [],
                "room_url": room_url,
                "libraryType": library_type,
                "libraryTemplateId": library_template_id,
            }
            await forwarder.emit_tool_event(events.HTML_GENERATION_REQUESTED, event_data)
            log.info("Sent HTML_GENERATION_REQUESTED event", title=title)
        
        # Return success - frontend will handle the generation
        log.info("Starting generation", title=title)
        return {
            "success": True,
            "user_message": f"I'm creating '{title}' for you now.",
            "pending": True,
            "request": {
                "title": title,
                "content_type": content_type
            }
        }
        
    except Exception as e:
        log.error("Failed to request HTML generation", error=str(e), exc_info=True)
        return {"success": False, "error": str(e)}


@bot_tool(
    name="bot_create_html_content",
    description=DEFAULT_HTML_TOOL_PROMPTS["bot_create_html_content"],
    feature_flag="htmlContent",
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Title for the HTML applet"
            },
            "html_content": {
                "type": "string",
                "description": "Complete HTML content (single file with embedded CSS/JS)"
            },
            "content_type": {
                "type": "string",
                "enum": ["game", "app", "tool", "interactive"],
                "description": "Type of HTML content being created"
            },
            "user_request": {
                "type": "string",
                "description": "Original user request that created this content"
            },
            "source_note_id": {
                "type": "string",
                "description": "Optional ID of source note if created from note content"
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional tags for searchability"
            }
        },
        "required": ["title", "html_content"]
    }
)
async def create_html_content_handler(params: FunctionCallParams):
    """Create a new HTML applet and emit creation event."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    context = getattr(params, 'handler_context', params.context)
    
    log = bind_tool_logger(params, tag="[html_tools]").bind(arguments=arguments)
    log.info("create_html_applet called")
    
    # Get tenant_id from context first, fall back to _get_room_state()
    tenant_id = context.tenant_id() if context and hasattr(context, 'tenant_id') else None
    if not tenant_id:
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
    
    # Get user_id from context
    user_id = context.user_id() if context and hasattr(context, 'user_id') else None
    if not user_id:
        user_id = os.environ.get('BOT_SESSION_USER_ID')
        if user_id:
            log.info("Using BOT_SESSION_USER_ID from environment", userId=user_id)

    log = log.bind(tenantId=tenant_id, userId=user_id)
    
    if not tenant_id:
        log.error("Cannot create HTML applet: no tenant_id")
        await params.result_callback({"success": False, "error": "No tenant context available"}, properties=FunctionCallResultProperties(run_llm=True))
        return
    
    if not user_id:
        log.error("Cannot create HTML applet: no user_id")
        await params.result_callback({"success": False, "error": "No user session available"}, properties=FunctionCallResultProperties(run_llm=True))
        return
    
    # Extract parameters
    title = arguments.get("title", "").strip()
    html_content = arguments.get("html_content", "").strip()
    content_type = arguments.get("content_type", "app")
    user_request = arguments.get("user_request", "")
    source_note_id = arguments.get("source_note_id")
    tags = arguments.get("tags", [])
    
    result = await bot_create_html_content(
        tenant_id, user_id, title, html_content, content_type, 
        user_request, source_note_id, tags, room_url, forwarder, log=log
    )
    
    log.info("Returning response", userMessage=result.get('user_message'))
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


async def bot_create_html_content(
    tenant_id: str,
    user_id: str,
    title: str,
    html_content: str,
    content_type: str,
    user_request: str,
    source_note_id: str | None,
    tags: list[str],
    room_url: str,
    forwarder: Any,
    *,
    log: Any | None = None,
) -> dict[str, Any]:
    """Implementation of create_html_content."""
    
    log = log or bind_context_logger(
        tag="[html_tools]",
        room_url=room_url,
        user_id=user_id,
    )
    
    if not title:
        return {"success": False, "error": "Title is required"}
    
    if not html_content:
        return {"success": False, "error": "HTML content is required"}
    
    # Create HTML generation via actions layer or request frontend AI generation
    try:
        response = await _create_or_request_html_generation(
            tenant_id=tenant_id,
            user_id=user_id,
            title=title,
            content=html_content,
            content_type=content_type,
            user_request=user_request,
            source_note_id=source_note_id,
            tags=tags,
            room_url=room_url,
            forwarder=forwarder,
            log=log,
        )
        return response
        
    except Exception as e:
        log.error("Failed to create HTML applet", error=str(e), exc_info=True)
        return {"success": False, "error": str(e)}


@bot_tool(
    name="bot_create_app_from_note",
    description=DEFAULT_HTML_TOOL_PROMPTS["bot_create_app_from_note"],
    feature_flag="htmlContent",
    parameters={
        "type": "object",
        "properties": {
            "note_id": {
                "type": "string",
                "description": "Specific note ID to use (exact match)"
            },
            "title": {
                "type": "string",
                "description": "Note title to search for (fuzzy search if note_id not provided)"
            },
            "app_title": {
                "type": "string",
                "description": "Optional custom title for the HTML app. If not provided, uses the note's title."
            },
            "content_type": {
                "type": "string",
                "enum": ["game", "app", "tool", "interactive"],
                "description": "Type of HTML content being created"
            },
            "user_request": {
                "type": "string",
                "description": "User's request that triggered this app creation"
            }
        },
        "required": ["app_title"]
    }
)
async def create_app_from_note_handler(params: FunctionCallParams):
    """Create an HTML app directly from a note's content in a single step."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    context = getattr(params, 'handler_context', params.context)
    
    log = bind_tool_logger(params, tag="[html_tools]").bind(arguments=arguments)
    
    log.info("bot_create_app_from_note called")
    
    # Get tenant_id from context first, fall back to _get_room_state()
    tenant_id = context.tenant_id() if context and hasattr(context, 'tenant_id') else None
    if not tenant_id:
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
    
    # Get user_id from context
    user_id = context.user_id() if context and hasattr(context, 'user_id') else None
    if not user_id:
        user_id = os.environ.get('BOT_SESSION_USER_ID')
        if user_id:
            log.info("Using BOT_SESSION_USER_ID from environment", userId=user_id)

    log = log.bind(tenantId=tenant_id, userId=user_id)
    
    if not tenant_id:
        log.error("Cannot create app from note: no tenant_id")
        await params.result_callback(
            {"success": False, "error": "No tenant context available"},
            properties=FunctionCallResultProperties(run_llm=True)
        )
        return
    
    if not user_id:
        log.error("Cannot create app from note: no user_id")
        await params.result_callback(
            {"success": False, "error": "No user session available"},
            properties=FunctionCallResultProperties(run_llm=True)
        )
        return
    
    # Extract parameters
    note_id = arguments.get("note_id")
    note_title = arguments.get("title")
    app_title = arguments.get("app_title")
    content_type = arguments.get("content_type", "app")
    user_request = arguments.get("user_request", "")
    
    result = await bot_create_app_from_note(
        tenant_id, user_id, note_id, note_title, app_title, 
        content_type, user_request, room_url, forwarder, log=log
    )
    
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


async def bot_create_app_from_note(
    tenant_id: str,
    user_id: str,
    note_id: str | None,
    note_title: str | None,
    app_title: str | None,
    content_type: str,
    user_request: str,
    room_url: str,
    forwarder: Any,
    *,
    log: Any | None = None,
) -> dict[str, Any]:
    """Implementation of create_app_from_note."""
    
    log = log or bind_context_logger(
        tag="[html_tools]",
        room_url=room_url,
        user_id=user_id,
    )
    
    # Validate we have either note_id or title
    if not note_id and not note_title:
        return {"success": False, "error": "Either note_id or title must be provided"}
    
    try:
        # Step 1: Find the note
        note = None
        if note_id:
            log.info("Looking up note by ID", noteId=note_id)
            note = await notes_actions.get_note_by_id(tenant_id, note_id)
            if not note:
                return {
                    "success": False, 
                    "error": f"Note with ID '{note_id}' not found",
                    "user_message": f"I couldn't find a note with that ID."
                }
        else:
            log.info("Searching for note by title", noteTitle=note_title)
            notes = await notes_actions.fuzzy_search_notes(tenant_id, note_title, user_id)
            if not notes or len(notes) == 0:
                log.warning("No note found by title", noteTitle=note_title, tenantId=tenant_id)
                return {
                    "success": False, 
                    "error": f"Note with title '{note_title}' not found",
                    "user_message": f"I couldn't find a note matching '{note_title}'."
                }
            if len(notes) > 1:
                log.warning("Multiple notes found with title", noteTitle=note_title, count=len(notes))
                # compile a message of the found titles, modes, and IDs
                found_notes_details = ", ".join([f"title: '{n.get('title')}' mode: '{n.get('mode')}' (note_id: {n.get('_id')})" for n in notes])
                found_notes_info = "; ".join([f"Title: '{n.get('title')}', Mode: '{n.get('mode')}'" for n in notes])
                return {
                    "success": False, 
                    "error": f"Found multiple notes: {found_notes_details}. Use the associated note_id as the 'note_id' param when you retry the operation.",
                    "user_message": f"I found multiple notes matching '{note_title}': {found_notes_info} Please help me choose the correct one."
                }
            # One note found, proceed
            note = notes[0]
        
            log.info("Found note", noteId=note.get("_id"), noteTitle=note.get("title"))
        
        # SECURITY CHECK: Verify permission to read source note (may be a shared note)
        if note.get("mode") == "personal":
            has_read = await sharing_actions.check_resource_read_permission(
                tenant_id=tenant_id, user_id=user_id, resource_id=note["_id"], content_type='Notes'
            )

            if not has_read:
                log.warning("User lacks read permission for note", noteId=note["_id"], userId=user_id)
                return {
                    "success": False,
                    "error": "Permission denied",
                    "user_message": "You don't have permission to read this note.",
                }
        
        # Step 2: Extract note content
        # Note content is stored as a dict with 'type' and 'content' fields
        note_content_dict = note.get("content", {})
        if isinstance(note_content_dict, dict):
            note_content = note_content_dict.get("content", "")
        else:
            note_content = str(note_content_dict)
        
        if not note_content or not note_content.strip():
            log.warning("Note content is empty", noteId=note.get("_id"))
            return {
                "success": False,
                "error": "Note content is empty",
                "user_message": f"The note '{note.get('title')}' doesn't have any content to create an app from."
            }
        
        # Step 3: Determine app title (use app_title if provided, otherwise note title)
        final_title = app_title if app_title else note.get("title", "Untitled App")
        
        # Step 4: Create HTML applet directly or request frontend AI generation
        response = await _create_or_request_html_generation(
            tenant_id=tenant_id,
            user_id=user_id,
            title=final_title,
            content=note_content,
            content_type=content_type,
            user_request=user_request or f"Create an app from note: {note.get('title')}",
            source_note_id=note.get("_id"),
            tags=[],
            room_url=room_url,
            forwarder=forwarder,
            log=log,
        )
        
        # Add source note info to response
        response["source_note"] = {
            "id": note.get("_id"),
            "title": note.get("title")
        }
        
        log.info("Processed app from note", noteId=note.get("_id"), userMessage=response.get("user_message"))
        return response
        
    except Exception as e:
        log.error("Failed to create app from note", error=str(e), exc_info=True)
        return {
            "success": False, 
            "error": str(e), 
            "user_message": "I encountered an error creating the app from the note."
        }

@bot_tool(
    name="bot_update_html_applet",
    description=DEFAULT_HTML_TOOL_PROMPTS["bot_update_html_applet"],
    feature_flag="htmlContent",
    parameters={
        "type": "object",
        "properties": {
            "applet_id": {
                "type": "string",
                "description": "ID of the applet to update"
            },
            "title": {
                "type": "string",
                "description": "Title of the applet to update (used if applet_id is not provided)"
            },
            "new_title": {
                "type": "string",
                "description": "New title for the applet (optional rename)"
            },
            "modification_request": {
                "type": "string",
                "description": "Natural language description of how to modify the applet (e.g., 'change the background to blue', 'add a score counter'), OR if the user wants you to use a note to help update the applet, put the contents of the note here verbatim."
            },
            "note_id": {
                "type": "string",
                "description": "The ID of the note to use for the update (if applicable)"
            },
            "note_title": {
                "type": "string",
                "description": "The title of the note to use for the update (if applicable)"
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "New tags (optional)"
            }
        },
        "required": ["modification_request"]
    }
)
async def update_html_applet_handler(params: FunctionCallParams):
    """Update an existing HTML applet."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    context = getattr(params, 'handler_context', params.context)
    
    log = bind_tool_logger(params, tag="[html_tools]").bind(arguments=arguments)
    log.info("update_html_applet called")
    
    # Get tenant_id from context first, fall back to _get_room_state()
    tenant_id = context.tenant_id() if context and hasattr(context, 'tenant_id') else None
    if not tenant_id:
        tenant_id = _get_room_state().get_room_tenant_id(room_url)

    log = log.bind(tenantId=tenant_id)
    
    if not tenant_id:
        log.error("Cannot update HTML applet: no tenant_id")
        await params.result_callback({"success": False, "error": "No tenant context available"}, properties=FunctionCallResultProperties(run_llm=True))
        return
    
    applet_id = arguments.get("applet_id")
    applet_title = arguments.get("title")
    
    # Get user_id for permission check
    user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
    log = log.bind(userId=user_id)
    if not user_id:
        log.warning("Could not identify user for permission check", error=error_msg)
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
    
    # Extract update fields
    modification_request = arguments.get("modification_request")
    new_title = arguments.get("new_title")
    tags = arguments.get("tags")
    note_id = arguments.get("note_id")
    note_title = arguments.get("note_title")
    
    # Resolve applet by id or title (fuzzy search)
    _applet, resolved_applet_id, resolve_error = await _resolve_applet_by_id_or_title(
        tenant_id, user_id, applet_id, applet_title, log=log
    )
    if resolve_error:
        await params.result_callback({"success": False, "error": resolve_error, "user_message": resolve_error}, properties=FunctionCallResultProperties(run_llm=True))
        return

    result = await bot_update_html_applet(
        tenant_id, user_id, resolved_applet_id, modification_request, new_title, tags, room_url, forwarder, note_id, note_title, log=log
    )
    
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


async def bot_update_html_applet(
    tenant_id: str,
    user_id: str,
    applet_id: str,
    modification_request: str,
    new_title: str | None,
    tags: list[str] | None,
    room_url: str,
    forwarder: Any,
    note_id: str | None = None,
    note_title: str | None = None,
    *,
    log: Any | None = None,
) -> dict[str, Any]:
    """Implementation of update_html_applet."""
    
    log = log or bind_context_logger(
        tag="[html_tools]",
        room_url=room_url,
        user_id=user_id,
    )
    
    # Update HTML generation via actions layer
    try:
        # SECURITY CHECK: First fetch the applet to verify it exists and check permissions
        applet = await html_actions.get_html_generation_by_id(tenant_id, applet_id)
        
        if not applet:
            return {
                "success": False,
                "error": "Applet not found",
                "user_message": f"HTML applet with ID {applet_id} not found."
            }
        
        # Check if user has read permission
        # Note: modifyEnhancedApplet also checks this, but we check here to fail fast
        if applet.get("createdBy") != user_id:
            has_read = await sharing_actions.check_resource_read_permission(
                tenant_id=tenant_id, user_id=user_id, resource_id=applet_id, content_type='HtmlGeneration'
            )
            if not has_read:
                log.warning("User lacks read permission for applet", appletId=applet_id, userId=user_id)
                return {"success": False, "error": "Permission denied"}

        # Emit HTML_MODIFICATION_REQUESTED event
        if forwarder:
            event_data = {
                "appletId": applet_id,
                "modificationRequest": modification_request,
                "title": new_title,
                "tags": tags,
                "noteId": note_id,
                "noteTitle": note_title,
                "aiProvider": "anthropic", # Default or configurable
                "aiModel": "claude-3-5-sonnet-20241022", # Default or configurable
                "versioningPreference": "modify_existing", # Default
                "saveChoice": "original", # Default
                "room_url": room_url,
            }
            await forwarder.emit_tool_event(events.HTML_MODIFICATION_REQUESTED, event_data)
            log.info("Sent HTML_MODIFICATION_REQUESTED event", appletId=applet_id)
        
        # Return success to LLM
        return {
            "success": True,
            "user_message": f"I've requested the changes for '{applet.get('title')}'.",
            "pending": True,
            "request": {
                "applet_id": applet_id,
                "modification_request": modification_request
            }
        }
        
    except Exception as e:
        log.error("Failed to update HTML applet", error=str(e), exc_info=True)
        return {"success": False, "error": str(e)}


@bot_tool(
    name="bot_rollback_app",
    description=DEFAULT_HTML_TOOL_PROMPTS["bot_rollback_app"],
    feature_flag="htmlContent",
    parameters={
        "type": "object",
        "properties": {
            "applet_id": {
                "type": "string",
                "description": "The ID of the applet to rollback"
            },
            "title": {
                "type": "string",
                "description": "The title of the applet to rollback (used if ID is not provided)"
            },
            "steps": {
                "type": "integer",
                "description": "Number of versions to rollback (default: 1)"
            }
        },
        "required": []
    }
)
async def rollback_app_handler(params: FunctionCallParams):
    """Rollback an applet to a previous version."""
    room_url = params.room_url
    arguments = params.arguments
    forwarder = params.forwarder
    context = getattr(params, 'handler_context', params.context)
    
    log = bind_tool_logger(params, tag="[html_tools]").bind(arguments=arguments)
    log.info("bot_rollback_app called")
    
    # Get tenant_id from context first, fall back to _get_room_state()
    tenant_id = context.tenant_id() if context and hasattr(context, 'tenant_id') else None
    if not tenant_id:
        tenant_id = _get_room_state().get_room_tenant_id(room_url)

    log = log.bind(tenantId=tenant_id)
    
    if not tenant_id:
        log.error("Cannot rollback applet: no tenant_id")
        await params.result_callback({"success": False, "error": "No tenant context available"}, properties=FunctionCallResultProperties(run_llm=True))
        return

    # Get user_id for permission check and search
    user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
    log = log.bind(userId=user_id)
    if not user_id:
        log.warning("Could not identify user for permission check", error=error_msg)
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
    
    applet_id = arguments.get("applet_id")
    title = arguments.get("title")

    # Resolve applet by id or title (fuzzy search)
    _applet, resolved_applet_id, resolve_error = await _resolve_applet_by_id_or_title(
        tenant_id, user_id, applet_id, title, log=log
    )
    if resolve_error:
        await params.result_callback({"success": False, "error": resolve_error, "user_message": resolve_error}, properties=FunctionCallResultProperties(run_llm=True))
        return
    
    steps = arguments.get("steps", 1)
    
    result = await bot_rollback_app(
        tenant_id, user_id, resolved_applet_id, steps, room_url, forwarder, log=log
    )
    
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


async def bot_rollback_app(
    tenant_id: str,
    user_id: str,
    applet_id: str,
    steps: int = 1,
    room_url: str = "",
    forwarder: Any = None,
    *,
    log: Any | None = None,
) -> dict[str, Any]:
    """Implementation of rollback_app."""
    
    log = log or bind_context_logger(
        tag="[html_tools]",
        room_url=room_url,
        user_id=user_id,
    )
    
    try:
        # SECURITY CHECK: First fetch the applet to verify it exists and check permissions
        applet = await html_actions.get_html_generation_by_id(tenant_id, applet_id)
        
        if not applet:
            return {
                "success": False,
                "error": "Applet not found",
                "user_message": f"HTML applet with ID {applet_id} not found."
            }
        
        # Check if user has write permission (owner or shared with write access)
        if applet.get("createdBy") != user_id:
            has_write = await sharing_actions.check_resource_write_permission(
                tenant_id=tenant_id, user_id=user_id, resource_id=applet_id, content_type='HtmlGeneration'
            )
            if not has_write:
                log.warning("User lacks write permission for applet", appletId=applet_id, userId=user_id)
                return {"success": False, "error": "Permission denied"}

        # Emit HTML_ROLLBACK_REQUESTED event
        if forwarder:
            event_data = {
                "appletId": applet_id,
                "steps": steps
            }
            await forwarder.emit_tool_event(events.HTML_ROLLBACK_REQUESTED, event_data)
            log.info("Sent HTML_ROLLBACK_REQUESTED event", appletId=applet_id, steps=steps)
        
        # Return success to LLM
        return {
            "success": True,
            "user_message": f"I've requested a rollback for '{applet.get('title')}'.",
        }
        
    except Exception as e:
        log.error("Failed to rollback applet", error=str(e), exc_info=True)
        return {
            "success": False, 
            "error": str(e), 
            "user_message": "I encountered an error rolling back the applet."
        }
