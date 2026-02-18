"""Event type constants for bot-to-frontend communication.

All event types emitted by bot tools via AppMessageForwarder.
Frontend listeners should use these exact event names.

Uses nia_events package for standardized event constants.
"""

from typing import Any

from tools.logging_utils import bind_context_logger

try:
    from nia_events.events import EventId
    
    # Window Management Events (from nia_events)
    WINDOW_MINIMIZE = EventId.WINDOW_MINIMIZE.value
    WINDOW_MAXIMIZE = EventId.WINDOW_MAXIMIZE.value
    WINDOW_RESTORE = EventId.WINDOW_RESTORE.value
    WINDOW_SNAP_LEFT = EventId.WINDOW_SNAP_LEFT.value
    WINDOW_SNAP_RIGHT = EventId.WINDOW_SNAP_RIGHT.value
    WINDOW_RESET = EventId.WINDOW_RESET.value
    
    # Note Events (from nia_events)
    NOTE_OPEN = EventId.NOTE_OPEN.value
    NOTE_CLOSE = EventId.NOTE_CLOSE.value
    NOTE_UPDATED = EventId.NOTE_UPDATED.value
    NOTE_SAVED = EventId.NOTE_SAVED.value
    NOTE_DOWNLOAD = EventId.NOTE_DOWNLOAD.value
    NOTE_DELETED = EventId.NOTE_DELETED.value
    NOTE_MODE_SWITCH = EventId.NOTE_MODE_SWITCH.value
    NOTES_REFRESH = EventId.NOTES_REFRESH.value
    NOTES_LIST = EventId.NOTES_LIST.value
    APPLET_REFRESH = EventId.APPLET_REFRESH.value
    
    # App/Browser Events (from nia_events)
    APP_OPEN = EventId.APP_OPEN.value
    APPS_CLOSE = EventId.APPS_CLOSE.value
    BROWSER_OPEN = EventId.BROWSER_OPEN.value
    BROWSER_CLOSE = EventId.BROWSER_CLOSE.value
    
    # View/Desktop Events (from nia_events)
    VIEW_CLOSE = EventId.VIEW_CLOSE.value
    DESKTOP_MODE_SWITCH = EventId.DESKTOP_MODE_SWITCH.value
    
    # YouTube Events (from nia_events)
    YOUTUBE_SEARCH = EventId.YOUTUBE_SEARCH.value
    YOUTUBE_PLAY = EventId.YOUTUBE_PLAY.value
    YOUTUBE_PAUSE = EventId.YOUTUBE_PAUSE.value
    YOUTUBE_NEXT = EventId.YOUTUBE_NEXT.value
    
    # Call Events (from nia_events)
    CALL_START = EventId.CALL_START.value
    BOT_SESSION_END = EventId.BOT_SESSION_END.value
    
    # HTML Generation Events (bot-specific, not in nia_events yet)
    HTML_CREATED = 'html.created'
    HTML_UPDATED = 'html.updated'
    HTML_LOADED = 'html.loaded'
    HTML_GENERATION_REQUESTED = 'html.generation.requested'
    HTML_MODIFICATION_REQUESTED = 'html.modification.requested'
    HTML_ROLLBACK_REQUESTED = 'html.rollback.requested'
    
    # Experience Events (Stage rendering system)
    EXPERIENCE_RENDER = 'experience.render'
    EXPERIENCE_DISMISS = 'experience.dismiss'

    # Sprite Events (bot-specific, not in nia_events yet)
    SPRITE_SUMMON = 'sprite.summon'

    # Wonder Canvas Events (bot-specific)
    WONDER_CANVAS_SCENE = 'wonder.scene'
    WONDER_CANVAS_ADD = 'wonder.add'
    WONDER_CANVAS_CLEAR = 'wonder.clear'
    WONDER_CANVAS_ANIMATE = 'wonder.animate'
    WONDER_CANVAS_AVATAR_HINT = 'wonder.avatar_hint'
    
    # Applet Events (from nia_events)
    APPLET_OPEN = EventId.APPLET_OPEN.value
    APPLET_CLOSE = EventId.APPLET_CLOSE.value
    APPLET_UPDATED = EventId.APPLET_UPDATED.value
    APPLET_SHARE_OPEN = EventId.APPLET_SHARE_OPEN.value
    
    # Sharing Events (from nia_events)
    RESOURCE_ACCESS_CHANGED = EventId.RESOURCE_ACCESS_CHANGED.value
    
except ImportError:
    # Fallback if nia_events package not available (e.g., in tests)
    WINDOW_MINIMIZE = 'window.minimize'
    WINDOW_MAXIMIZE = 'window.maximize'
    WINDOW_RESTORE = 'window.restore'
    WINDOW_SNAP_LEFT = 'window.snap.left'
    WINDOW_SNAP_RIGHT = 'window.snap.right'
    WINDOW_RESET = 'window.reset'
    NOTE_OPEN = 'note.open'
    NOTE_CLOSE = 'note.close'
    NOTE_UPDATED = 'note.updated'
    NOTE_SAVED = 'note.saved'
    NOTE_DOWNLOAD = 'note.download'
    NOTE_DELETED = 'note.deleted'
    NOTE_MODE_SWITCH = 'note.mode.switch'
    NOTES_REFRESH = 'notes.refresh'
    NOTES_LIST = 'notes.list'
    APPLET_REFRESH = 'applet.refresh'
    APP_OPEN = 'app.open'
    APPS_CLOSE = 'apps.close'
    BROWSER_OPEN = 'browser.open'
    BROWSER_CLOSE = 'browser.close'
    VIEW_CLOSE = 'view.close'
    DESKTOP_MODE_SWITCH = 'desktop.mode.switch'
    YOUTUBE_SEARCH = 'youtube.search'
    YOUTUBE_PLAY = 'youtube.play'
    YOUTUBE_PAUSE = 'youtube.pause'
    YOUTUBE_NEXT = 'youtube.next'
    CALL_START = 'call.start'
    BOT_SESSION_END = 'bot.session.end'
    HTML_CREATED = 'html.created'
    HTML_UPDATED = 'html.updated'
    HTML_LOADED = 'html.loaded'
    HTML_GENERATION_REQUESTED = 'html.generation.requested'
    HTML_MODIFICATION_REQUESTED = 'html.modification.requested'
    HTML_ROLLBACK_REQUESTED = 'html.rollback.requested'
    EXPERIENCE_RENDER = 'experience.render'
    EXPERIENCE_DISMISS = 'experience.dismiss'
    SPRITE_SUMMON = 'sprite.summon'
    WONDER_CANVAS_SCENE = 'wonder.scene'
    WONDER_CANVAS_ADD = 'wonder.add'
    WONDER_CANVAS_CLEAR = 'wonder.clear'
    WONDER_CANVAS_ANIMATE = 'wonder.animate'
    WONDER_CANVAS_AVATAR_HINT = 'wonder.avatar_hint'
    APPLET_OPEN = 'applet.open'
    APPLET_CLOSE = 'applet.close'
    APPLET_UPDATED = 'applet.updated'
    APPLET_SHARE_OPEN = 'applet.share.open'
    RESOURCE_ACCESS_CHANGED = 'resource.access.changed'

async def emit_nia_event(forwarder: Any, event_name: str, data: dict[str, Any]) -> None:
    """Emit a standardized Nia event via the AppMessageForwarder."""
    event_logger = bind_context_logger(
        room_url=getattr(forwarder, "room_url", None) if forwarder else None,
        session_id=getattr(forwarder, "session_id", None) if forwarder else None,
        tag="[tool_event]",
    )

    if not forwarder:
        event_logger.warning(f"Cannot emit event {event_name}: No forwarder available")
        return

    event_logger.info(f"Emitting event: {event_name}")
    # Use emit_tool_event if available (preferred for tools)
    if hasattr(forwarder, 'emit_tool_event'):
        await forwarder.emit_tool_event(event_name, data)
    else:
        # Fallback to _handle if emit_tool_event is missing (should not happen)
        event_logger.warning(f"Forwarder missing emit_tool_event, falling back to _handle for {event_name}")
        if hasattr(forwarder, '_handle'):
             await forwarder._handle(event_name, data)
