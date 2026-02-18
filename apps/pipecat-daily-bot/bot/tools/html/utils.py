"""Utility functions for HTML tools."""
import json
from typing import Any

from actions import html_actions
from tools import events
from tools.logging_utils import bind_context_logger


# Lazy import helper to avoid circular import
def _get_room_state():
    try:
        import room.state as state
    except ImportError:
        import bot.room.state as state
    return state


def _is_html_content(content: str) -> bool:
    """Check if content appears to be valid HTML.
    
    Args:
        content: String content to check
        
    Returns:
        True if content looks like HTML (starts with <!DOCTYPE or <html)
    """
    return content.strip().lower().startswith(('<!doctype', '<html'))


async def _create_or_request_html_generation(
    tenant_id: str,
    user_id: str,
    title: str,
    content: str,
    content_type: str,
    user_request: str,
    source_note_id: str | None,
    tags: list[str],
    room_url: str,
    forwarder: Any,
    *,
    log: Any | None = None,
) -> dict[str, Any]:
    """Create HTML applet directly or request frontend AI generation.
    
    This function handles two paths:
    1. If content is already HTML -> create applet directly via actions layer
    2. If content is not HTML -> emit event to request frontend AI generation
    
    Args:
        tenant_id: Tenant identifier
        user_id: User identifier
        title: Title for the HTML applet
        content: Content to create HTML from (may or may not be HTML already)
        content_type: Type of HTML content (game, app, tool, interactive)
        user_request: Original user request
        source_note_id: Optional source note ID
        tags: Optional tags
        room_url: Room URL for event emission
        forwarder: Event forwarder for emitting events
        
    Returns:
        Dict with success status, user_message, and either applet data or pending status
    """
    log = log or bind_context_logger(tag="[html_tools]", room_url=room_url, user_id=user_id)
    is_html = _is_html_content(content)
    
    if is_html:
        log.info("Content appears to be HTML, creating applet directly")
        # Direct HTML creation
        applet = await html_actions.create_html_generation(
            tenant_id=tenant_id,
            user_id=user_id,
            title=title,
            html_content=content,
            content_type=content_type,
            user_request=user_request,
            source_note_id=source_note_id,
            tags=tags
        )
        
        if not applet:
            return {
                "success": False,
                "error": "Failed to create HTML applet",
                "user_message": "I couldn't create the HTML applet right now."
            }
        
        # Emit HTML_CREATED event
        if forwarder and room_url:
            event_data = {
                "applet_id": applet.get("_id"),
                "title": title,
                "content_type": content_type,
                "html_content": content
            }
            if source_note_id:
                event_data["source_note_id"] = source_note_id
            await forwarder.emit_tool_event(events.HTML_CREATED, event_data)
            log.info("Sent HTML_CREATED event", appletId=applet.get("_id"), title=title)
            
            # Also open the applet in the creation engine
            open_event_data = {
                "applet_id": applet.get("_id"),
                "title": title,
                "content_type": content_type
            }
            await forwarder.emit_tool_event(events.APPLET_OPEN, open_event_data)
            log.info("Sent APPLET_OPEN event", appletId=applet.get("_id"), title=title)
        
        # Return success with created applet
        return {
            "success": True,
            "user_message": f"I've created the HTML applet titled '{title}'.",
            "applet": {
                "id": applet.get("_id"),
                "title": title,
                "content_type": content_type
            }
        }
    else:
        log.info("Content is not HTML, requesting AI generation from frontend")
        # Fire event to request AI generation in the frontend
        if forwarder:
            event_data = {
                "title": title,
                "description": content if len(content) < 500 else content[:500] + "...",
                "content_type": content_type,
                "user_request": user_request,
                "source_note_id": source_note_id,
                "features": [],
                "room_url": room_url,
            }
            await forwarder.emit_tool_event(events.HTML_GENERATION_REQUESTED, event_data)
            log.info("Sent HTML_GENERATION_REQUESTED event", title=title)
        
        # Return pending status - frontend will handle the generation
        return {
            "success": True,
            "pending": True,
            "user_message": f"I'm generating an HTML applet titled '{title}'. This will take a moment...",
            "request": {
                "title": title,
                "content_type": content_type
            }
        }
