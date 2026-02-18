"""Event bus package facade.

The implementation previously lived in this file. It has been split into:
  * ``bus.py``      core publish/subscribe + streaming
  * ``events.py``   string constants & schema version
  * ``event_handlers.py`` higher-level business logic subscriptions (future)

All prior import styles (``import eventbus as eb`` or
``from eventbus import publish``) continue to work because we re-export the
public surface here. New code is encouraged to import explicitly from the
submodules for clarity.
"""

from .bus import (
    emit_call_state,
    emit_first_participant_join,
    emit_participant_join,
    emit_participant_left,
    emit_participants_change,
    emit_bot_speaking_started,
    emit_bot_speaking_stopped,
    emit_bot_transcript,
    BOT_TRANSCRIPT,
    publish,
    register_stream,
    stream_events_generator,
    subscribe,
    unregister_stream,
)
from .events import (
    BOT_CONVO_WRAPUP,
    BOT_SESSION_END,
    BOT_SPEAKING_STARTED,
    BOT_SPEAKING_STOPPED,
    DAILY_CALL_STATE,
    DAILY_PARTICIPANT_FIRST_JOIN,
    DAILY_PARTICIPANT_JOIN,
    DAILY_PARTICIPANT_LEAVE,
    DAILY_PARTICIPANTS_CHANGE,
    EVENT_SCHEMA_VERSION,
)

__all__ = [
    # bus
    "subscribe",
    "publish",
    "emit_call_state",
    "emit_first_participant_join",
    "emit_participant_join",
    "emit_participant_left",
    "emit_participants_change",
    "emit_bot_speaking_started",
    "emit_bot_speaking_stopped",
    "emit_bot_transcript",
    "BOT_TRANSCRIPT",
    "stream_events_generator",
    "register_stream",
    "unregister_stream",
    # events
    "EVENT_SCHEMA_VERSION",
    "DAILY_CALL_STATE",
    "DAILY_PARTICIPANT_FIRST_JOIN",
    "DAILY_PARTICIPANT_JOIN",
    "DAILY_PARTICIPANT_LEAVE",
    "DAILY_PARTICIPANTS_CHANGE",
    "BOT_SESSION_END",
    "BOT_CONVO_WRAPUP",
    "BOT_SPEAKING_STARTED",
    "BOT_SPEAKING_STOPPED",
]
