# Auto-generated. Do not edit.
from enum import Enum

class EventId(str, Enum):
    ASSISTANT_STARTED = "assistant.started"
    ONBOARDING_COMPLETE = "onboarding.complete"
    DAILY_PARTICIPANT_FIRST_JOIN = "daily.participant.first.join"
    DAILY_CALL_ERROR = "daily.call.error"
    DAILY_PARTICIPANT_JOIN = "daily.participant.join"
    DAILY_PARTICIPANT_LEAVE = "daily.participant.leave"
    DAILY_CALL_STATE = "daily.call.state"
    DAILY_PARTICIPANTS_CHANGE = "daily.participants.change"
    DAILY_PARTICIPANT_IDENTITY = "daily.participant.identity"
    DAILY_BOT_HEARTBEAT = "daily.bot.heartbeat"
    BOT_SESSION_END = "bot.session.end"
    BOT_CONVERSATION_PACING_BEAT = "bot.conversation.pacing.beat"
    BOT_CONVERSATION_WRAPUP = "bot.conversation.wrapup"
    BOT_SPEAKING_STARTED = "bot.speaking.started"
    BOT_SPEAKING_STOPPED = "bot.speaking.stopped"
    ADMIN_PROMPT_MESSAGE = "admin.prompt.message"
    ADMIN_PROMPT_RESPONSE = "admin.prompt.response"
    LLM_CONTEXT_MESSAGE = "llm.context.message"
    WINDOW_MINIMIZE = "window.minimize"
    WINDOW_MAXIMIZE = "window.maximize"
    WINDOW_RESTORE = "window.restore"
    WINDOW_SNAP_LEFT = "window.snap.left"
    WINDOW_SNAP_RIGHT = "window.snap.right"
    WINDOW_RESET = "window.reset"
    NOTE_OPEN = "note.open"
    NOTE_CLOSE = "note.close"
    NOTE_UPDATED = "note.updated"
    NOTE_SAVED = "note.saved"
    NOTE_DOWNLOAD = "note.download"
    NOTE_DELETED = "note.deleted"
    NOTE_MODE_SWITCH = "note.mode.switch"
    NOTES_REFRESH = "notes.refresh"
    NOTES_LIST = "notes.list"
    APP_OPEN = "app.open"
    APPS_CLOSE = "apps.close"
    BROWSER_OPEN = "browser.open"
    BROWSER_CLOSE = "browser.close"
    VIEW_CLOSE = "view.close"
    DESKTOP_MODE_SWITCH = "desktop.mode.switch"
    YOUTUBE_SEARCH = "youtube.search"
    YOUTUBE_PLAY = "youtube.play"
    YOUTUBE_PAUSE = "youtube.pause"
    YOUTUBE_NEXT = "youtube.next"
    CALL_START = "call.start"
    HTML_CREATED = "html.created"
    HTML_UPDATED = "html.updated"
    HTML_LOADED = "html.loaded"
    HTML_GENERATION_REQUESTED = "html.generation.requested"
    HTML_MODIFICATION_REQUESTED = "html.modification.requested"
    HTML_ROLLBACK_REQUESTED = "html.rollback.requested"
    APPLET_REFRESH = "applet.refresh"
    APPLET_OPEN = "applet.open"
    APPLET_CLOSE = "applet.close"
    APPLET_UPDATED = "applet.updated"
    RESOURCE_ACCESS_CHANGED = "resource.access.changed"
    APPLET_SHARE_OPEN = "applet.share.open"
    SPRITE_SUMMON = "sprite.summon"

EVENT_IDS = [
    EventId.ASSISTANT_STARTED.value,
    EventId.ONBOARDING_COMPLETE.value,
    EventId.DAILY_PARTICIPANT_FIRST_JOIN.value,
    EventId.DAILY_CALL_ERROR.value,
    EventId.DAILY_PARTICIPANT_JOIN.value,
    EventId.DAILY_PARTICIPANT_LEAVE.value,
    EventId.DAILY_CALL_STATE.value,
    EventId.DAILY_PARTICIPANTS_CHANGE.value,
    EventId.DAILY_PARTICIPANT_IDENTITY.value,
    EventId.DAILY_BOT_HEARTBEAT.value,
    EventId.BOT_SESSION_END.value,
    EventId.BOT_CONVERSATION_PACING_BEAT.value,
    EventId.BOT_CONVERSATION_WRAPUP.value,
    EventId.BOT_SPEAKING_STARTED.value,
    EventId.BOT_SPEAKING_STOPPED.value,
    EventId.ADMIN_PROMPT_MESSAGE.value,
    EventId.ADMIN_PROMPT_RESPONSE.value,
    EventId.LLM_CONTEXT_MESSAGE.value,
    EventId.WINDOW_MINIMIZE.value,
    EventId.WINDOW_MAXIMIZE.value,
    EventId.WINDOW_RESTORE.value,
    EventId.WINDOW_SNAP_LEFT.value,
    EventId.WINDOW_SNAP_RIGHT.value,
    EventId.WINDOW_RESET.value,
    EventId.NOTE_OPEN.value,
    EventId.NOTE_CLOSE.value,
    EventId.NOTE_UPDATED.value,
    EventId.NOTE_SAVED.value,
    EventId.NOTE_DOWNLOAD.value,
    EventId.NOTE_DELETED.value,
    EventId.NOTE_MODE_SWITCH.value,
    EventId.NOTES_REFRESH.value,
    EventId.NOTES_LIST.value,
    EventId.APP_OPEN.value,
    EventId.APPS_CLOSE.value,
    EventId.BROWSER_OPEN.value,
    EventId.BROWSER_CLOSE.value,
    EventId.VIEW_CLOSE.value,
    EventId.DESKTOP_MODE_SWITCH.value,
    EventId.YOUTUBE_SEARCH.value,
    EventId.YOUTUBE_PLAY.value,
    EventId.YOUTUBE_PAUSE.value,
    EventId.YOUTUBE_NEXT.value,
    EventId.CALL_START.value,
    EventId.HTML_CREATED.value,
    EventId.HTML_UPDATED.value,
    EventId.HTML_LOADED.value,
    EventId.HTML_GENERATION_REQUESTED.value,
    EventId.HTML_MODIFICATION_REQUESTED.value,
    EventId.HTML_ROLLBACK_REQUESTED.value,
    EventId.APPLET_REFRESH.value,
    EventId.APPLET_OPEN.value,
    EventId.APPLET_CLOSE.value,
    EventId.APPLET_UPDATED.value,
    EventId.RESOURCE_ACCESS_CHANGED.value,
    EventId.APPLET_SHARE_OPEN.value,
    EventId.SPRITE_SUMMON.value,
]
