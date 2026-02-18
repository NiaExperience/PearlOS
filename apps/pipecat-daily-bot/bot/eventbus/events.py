"""Canonical event/topic names & schema version constants.

These string constants centralize topic naming to avoid typos and ease
refactors. They intentionally mirror the existing ad-hoc names used before
the refactor; future renames should happen here with deprecation strategy.
"""

from nia_events import EventId

EVENT_SCHEMA_VERSION = "1"

# Daily call lifecycle
DAILY_CALL_STATE = EventId.DAILY_CALL_STATE.value

# Participant presence (from shared generator)
DAILY_PARTICIPANT_FIRST_JOIN = EventId.DAILY_PARTICIPANT_FIRST_JOIN.value
DAILY_PARTICIPANT_JOIN = EventId.DAILY_PARTICIPANT_JOIN.value
DAILY_PARTICIPANT_LEAVE = EventId.DAILY_PARTICIPANT_LEAVE.value
DAILY_PARTICIPANTS_CHANGE = EventId.DAILY_PARTICIPANTS_CHANGE.value  # snapshot diff style
DAILY_PARTICIPANT_IDENTITY = EventId.DAILY_PARTICIPANT_IDENTITY.value

# Heartbeat / liveness
# DAILY_BOT_HEARTBEAT removed

# Session termination (control server emits)
BOT_SESSION_END = EventId.BOT_SESSION_END.value

# Conversation pacing & lifecycle (timer-based) from shared generator
BOT_CONVO_PACING_BEAT = (
    EventId.BOT_CONVERSATION_PACING_BEAT.value
)  # scheduled beat with specific timing
BOT_CONVO_WRAPUP = EventId.BOT_CONVERSATION_WRAPUP.value  # soft end-of-call cue

# Bot speech state (emitted when TTS or audio output begins / ends). 
BOT_SPEAKING_STARTED = EventId.BOT_SPEAKING_STARTED.value  
BOT_SPEAKING_STOPPED = EventId.BOT_SPEAKING_STOPPED.value

# Admin prompts and responses
ADMIN_PROMPT_MESSAGE = EventId.ADMIN_PROMPT_MESSAGE.value
ADMIN_PROMPT_RESPONSE = EventId.ADMIN_PROMPT_RESPONSE.value

# LLM context messaging (no admin privilege requirement)
LLM_CONTEXT_MESSAGE = EventId.LLM_CONTEXT_MESSAGE.value

__all__ = [
    "EVENT_SCHEMA_VERSION",
    "DAILY_CALL_STATE",
    "DAILY_PARTICIPANT_FIRST_JOIN",
    "DAILY_PARTICIPANT_JOIN",
    "DAILY_PARTICIPANT_LEAVE",
    "DAILY_PARTICIPANTS_CHANGE",
    "DAILY_PARTICIPANT_IDENTITY",
    "BOT_SESSION_END",
    "BOT_CONVO_PACING_BEAT",
    "BOT_CONVO_WRAPUP",
    "BOT_SPEAKING_STARTED",
    "BOT_SPEAKING_STOPPED",
    "ADMIN_PROMPT_MESSAGE",
    "ADMIN_PROMPT_RESPONSE",
    "LLM_CONTEXT_MESSAGE",
]
