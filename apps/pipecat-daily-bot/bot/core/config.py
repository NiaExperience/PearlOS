"""Centralized BOT_* configuration with environment overrides.

This module defines default values for bot runtime behavior and provides
environment overrides when variables are set. Import these constants instead
of calling os.getenv directly to keep behavior consistent and testable.
"""

from __future__ import annotations

import os
import sys
from dotenv import load_dotenv
from loguru import logger

# Load env only once at import – safe & cheap
load_dotenv(override=True)


def _resolve_log_level() -> str:
    """Resolve log level from env (PYTHON_DEBUG_LEVEL or DEBUG_BOT).

    Accepts typical truthy strings for debug; defaults to INFO.
    """
    raw = os.getenv("PYTHON_DEBUG_LEVEL") or os.getenv("DEBUG_BOT") or "info"
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on", "debug"}:
        return "DEBUG"
    if value in {"warning", "warn"}:
        return "WARNING"
    if value in {"error", "err"}:
        return "ERROR"
    return "INFO"


def _configure_loguru_level() -> None:
    """Ensure loguru honors the configured level before imports emit debug."""
    level = _resolve_log_level()
    if _try_set_level_via_helper(level):
        return
    if _try_set_level_on_base_logger(level):
        return
    _fallback_configure_loguru(level)


def _try_set_level_via_helper(level: str) -> bool:
    helper = getattr(__import__("loguru"), "set_base_level", None)
    if not callable(helper):
        return False
    try:
        helper(level)
        return True
    except Exception:
        return False


def _try_set_level_on_base_logger(level: str) -> bool:
    base_logger = getattr(logger, "_base", None)
    if base_logger is None:
        return False
    level_int = _log_level_to_int(level)
    try:
        base_logger.setLevel(level_int)
        for handler in getattr(base_logger, "handlers", []) or []:
            try:
                handler.setLevel(level_int)
            except Exception:
                pass
        return True
    except Exception:
        return False


def _fallback_configure_loguru(level: str) -> None:
    try:
        logger.remove()
    except Exception:
        pass
    try:
        logger.add(sys.stderr, level=level)
    except Exception:
        pass


def _log_level_to_int(level: str) -> int:
    normalized = level.strip().upper()
    if normalized == "DEBUG":
        return 10
    if normalized == "INFO":
        return 20
    if normalized == "WARNING":
        return 30
    if normalized == "ERROR":
        return 40
    return 20


_configure_loguru_level()

# Global bot process ID for logging
BOT_PID = os.getpid()

def verify_daily_api_key():
    """Check DAILY_API_KEY at module import time."""
    _daily_key_at_import = os.getenv("DAILY_API_KEY")
    logger.debug(f"[config][IMPORT] DAILY_API_KEY present: {bool(_daily_key_at_import)}, length: {len(_daily_key_at_import) if _daily_key_at_import else 0}")

# Verify on import
verify_daily_api_key()

def _env_str(name: str, default: str) -> str:
    v = os.getenv(name)
    return v if v is not None else default


def _env_bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v not in {"0", "false", "False", "no", "No", "off", "OFF"}


def _env_int(name: str, default: int) -> int:
    v = os.getenv(name)
    try:
        return int(v) if v is not None else default
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    v = os.getenv(name)
    try:
        return float(v) if v is not None else default
    except Exception:
        return default


def _env_float_with_alias(name: str, default: float, alias: str | None = None) -> float:
    if os.getenv(name) is not None:
        return _env_float(name, default)
    if alias and os.getenv(alias) is not None:
        return _env_float(alias, default)
    return default


def _env_int_tuple(name: str) -> tuple[int, ...] | None:
    raw = os.getenv(name)
    if not raw:
        return None
    values: list[int] = []
    for part in raw.split(","):
        stripped = part.strip()
        if not stripped:
            continue
        try:
            values.append(int(stripped))
        except ValueError:
            continue
    return tuple(values) if values else None


# ---------------------------------------------------------------------------
# Participant/room lifecycle controls
# ---------------------------------------------------------------------------


def BOT_EMPTY_INITIAL_SECS() -> float:
    return _env_float("BOT_EMPTY_INITIAL_SECS", 10.0)


def BOT_EMPTY_POST_LEAVE_SECS() -> float:
    return _env_float_with_alias("BOT_EMPTY_POST_LEAVE_SECS", 3.0, alias="BOT_EMPTY_GRACE_SECS")


def BOT_VOICE_ONLY() -> bool:
    """Whether the bot is running in voice-only mode (1:1, private session, no video)."""
    return _env_bool("BOT_VOICE_ONLY", False)


def BOT_ADMIN_MESSAGE_DIR() -> str:
    return _env_str("BOT_ADMIN_MESSAGE_DIR", "/tmp/pipecat-bot-admin-messages")


def BOT_IDENTITY_DIR() -> str:
    """Directory for temporary identity files (file-based identity sharing).

    Used for cross-process identity sharing when eventbus isolation prevents
    direct event delivery. Files contain session identity data keyed by room.
    Designed for easy Redis migration later.
    """
    return _env_str("BOT_IDENTITY_DIR", "/tmp/pipecat-bot-identity")


# ---------------------------------------------------------------------------
# Service authentication secrets
# ---------------------------------------------------------------------------


def MESH_SHARED_SECRET() -> str | None:
    """Mesh service-level authentication secret."""
    secret = os.getenv("MESH_SHARED_SECRET")
    return secret.strip() if secret else None


def BOT_CONTROL_SHARED_SECRET() -> str | None:
    """Bot control service authentication secret (interface→bot, bot→mesh)."""
    secret = os.getenv("BOT_CONTROL_SHARED_SECRET")
    return secret.strip() if secret else None


def BOT_ZOMBIE_SPAWN_GRACE_SECS() -> float:
    """Additional grace period after spawn before considering zombie checks.

    New sessions often take time to connect and emit their first heartbeat. This grace
    avoids false-positives immediately after starting up. Default 45s.
    """
    return _env_float("BOT_ZOMBIE_SPAWN_GRACE_SECS", 45.0)


def BOT_ZOMBIE_REQUIRED_STALE_HITS() -> int:
    """Number of consecutive stale detections required before reaping a zombie.

    Adds debounce to noisy environments or sporadic heartbeat writes. Default 2.
    """
    return _env_int("BOT_ZOMBIE_REQUIRED_STALE_HITS", 2)


def BOT_AUTORESPAWN_ON_ZOMBIE() -> bool:
    """If true, control server will automatically spawn a fresh bot when a zombie is reaped."""
    return _env_bool("BOT_AUTORESPAWN_ON_ZOMBIE", True)


def BOT_SERVER_REAP_INTERVAL_SECS() -> float:
    """Interval for background server-side reap loop; 0 disables."""
    return _env_float("BOT_SERVER_REAP_INTERVAL_SECS", 10.0)


def BOT_PERSONALITY_REFRESH_INTERVAL_SECS() -> float:
    """Interval for refreshing personality cache from database; 0 disables. Default: 45 seconds."""
    return _env_float("BOT_PERSONALITY_REFRESH_INTERVAL_SECS", 45.0)


# ---------------------------------------------------------------------------
# Conversation wrap-up timers
# ---------------------------------------------------------------------------


def BOT_WRAPUP_AFTER_SECS() -> float:
    return _env_float("BOT_WRAPUP_AFTER_SECS", 1800.0)  # 30m; 0 disables


def BOT_WRAPUP_SYSTEM_MESSAGE() -> str:
    return _env_str(
        "BOT_WRAPUP_SYSTEM_MESSAGE",
        "Offer a concise, friendly wrap-up of the conversation and invite any final quick questions before goodbye.",
    )


# ---------------------------------------------------------------------------
# Conversation context queue management
# ---------------------------------------------------------------------------


def BOT_SANITIZE_FLOW_PROFILE_FIELDS() -> bool:
    """Feature flag controlling whether Flow role messages sanitize profile fields."""

    return _env_bool("BOT_SANITIZE_FLOW_PROFILE_FIELDS", False)


# ---------------------------------------------------------------------------
# Greeting window
# ---------------------------------------------------------------------------


def BOT_GREETING_GRACE_SECS() -> float:
    return _env_float("BOT_GREETING_GRACE_SECS", 5.0)


# ---------------------------------------------------------------------------
# Voice parameters for ElevenLabs TTS
# ---------------------------------------------------------------------------


def BOT_VOICE_SPEED() -> float | None:
    """Voice speed parameter (0.7 to 1.2). Default: 1.2 (matches DailyCall)."""
    v = os.getenv("BOT_VOICE_SPEED")
    return float(v) if v is not None else 1.2


def BOT_VOICE_STABILITY() -> float | None:
    """Voice stability parameter (0.0 to 1.0). Default: 0.7 (matches DailyCall)."""
    v = os.getenv("BOT_VOICE_STABILITY")
    return float(v) if v is not None else 0.7


def BOT_VOICE_SIMILARITY_BOOST() -> float | None:
    """Voice similarity boost parameter (0.0 to 1.0). Default: 0.8 (matches DailyCall)."""
    v = os.getenv("BOT_VOICE_SIMILARITY_BOOST")
    return float(v) if v is not None else 0.8


def BOT_VOICE_STYLE() -> float | None:
    """Voice style parameter (0.0 to 1.0). Default: 0.3 (matches DailyCall)."""
    v = os.getenv("BOT_VOICE_STYLE")
    return float(v) if v is not None else 0.3


def BOT_VOICE_OPTIMIZE_STREAMING_LATENCY() -> float | None:
    """Optimize streaming latency parameter (0.0 to 1.0). Default: 1 (matches DailyCall)."""
    v = os.getenv("BOT_VOICE_OPTIMIZE_STREAMING_LATENCY")
    return float(v) if v is not None else 1


# ---------------------------------------------------------------------------
# Kokoro (Chorus) TTS configuration
# ---------------------------------------------------------------------------


def BOT_TTS_PROVIDER() -> str:
    # HARDCODED: PocketTTS is the TTS provider. Period.
    # Previous attempts to use env vars were defeated by dotenv load order,
    # leading spaces, and override conflicts. This is the nuclear option.
    return "pocket"


def KOKORO_TTS_BASE_URL() -> str:
    return _env_str("KOKORO_TTS_BASE_URL", "ws://127.0.0.1:8000")


def KOKORO_TTS_API_KEY() -> str | None:
    value = os.getenv("KOKORO_TTS_API_KEY")
    return value.strip() if value else None


def KOKORO_TTS_VOICE_ID(default: str | None = None) -> str:
    value = os.getenv("KOKORO_TTS_VOICE_ID")
    if value:
        return value.strip()
    if default:
        return default
    return "af_alloy"


def KOKORO_TTS_MODEL_ID() -> str | None:
    value = os.getenv("KOKORO_TTS_MODEL_ID")
    return value.strip() if value else None


def KOKORO_TTS_LANGUAGE_CODE() -> str | None:
    value = os.getenv("KOKORO_TTS_LANGUAGE_CODE")
    return value.strip() if value else None


def KOKORO_TTS_APPLY_TEXT_NORMALIZATION() -> str | None:
    value = os.getenv("KOKORO_TTS_APPLY_TEXT_NORMALIZATION")
    return value.strip() if value else None


def KOKORO_TTS_CHUNK_SCHEDULE() -> tuple[int, ...] | None:
    return _env_int_tuple("KOKORO_TTS_CHUNK_SCHEDULE")


def KOKORO_TTS_AUTO_MODE() -> bool:
    return _env_bool("KOKORO_TTS_AUTO_MODE", False)


def KOKORO_TTS_TRY_TRIGGER_GENERATION() -> bool:
    return _env_bool("KOKORO_TTS_TRY_TRIGGER_GENERATION", True)


def KOKORO_TTS_INACTIVITY_TIMEOUT() -> int | None:
    value = os.getenv("KOKORO_TTS_INACTIVITY_TIMEOUT")
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def KOKORO_TTS_SAMPLE_RATE() -> int:
    return _env_int("KOKORO_TTS_SAMPLE_RATE", 22050)


def KOKORO_TTS_ENABLE_LOGGING() -> bool:
    return _env_bool("KOKORO_TTS_ENABLE_LOGGING", True)


def KOKORO_TTS_ENABLE_SSML() -> bool:
    return _env_bool("KOKORO_TTS_ENABLE_SSML_PARSING", False)


def KOKORO_TTS_SEED() -> int | None:
    value = os.getenv("KOKORO_TTS_SEED")
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Default system messages for greetings (used as backstops)
# ---------------------------------------------------------------------------


# Defaulting to 0 (disabled), as each beat prompt is baked into the node role_messages now
def BOT_BEAT_REPEAT_INTERVAL_SECS() -> float:
    return _env_float("BOT_BEAT_REPEAT_INTERVAL_SECS", 0.0)


def BOT_BEAT_MIN_SPEAK_GAP_SECS() -> float:
    """Minimum seconds between appending beat messages to avoid chattiness.

    Acts as a soft throttle so the assistant doesn't speak on every beat in quick succession.
    """
    return _env_float("BOT_BEAT_MIN_SPEAK_GAP_SECS", 15.0)


def BOT_GREETING_SINGLE_SYSTEM_MESSAGE() -> str:
    return _env_str(
        "BOT_GREETING_SINGLE_SYSTEM_MESSAGE",
        "Greet user(s) {{username}} briefly, warmly, and naturally.",
    )


def BOT_GREETING_PAIR_SYSTEM_MESSAGE() -> str:
    return _env_str(
        "BOT_GREETING_PAIR_SYSTEM_MESSAGE",
        "Greet user(s) {{username}} inclusively and concisely.",
    )


def BOT_GREETING_GROUP_SYSTEM_MESSAGE() -> str:
    return _env_str(
        "BOT_GREETING_GROUP_SYSTEM_MESSAGE",
        "Greet the group (don't bother with names here) and provide a concise kickoff for the conversation.",
    )


def BOT_SPEAK_GATE_DELAY_SECS() -> float:
    """Delay before speaking when switching nodes (e.g., immediate admin), to avoid interrupting.

    A small delay approximates "wait for a pause" without requiring transport-level silence events.
    """
    return _env_float("BOT_SPEAK_GATE_DELAY_SECS", 0.75)


def BOT_BEAT_USER_IDLE_SECS() -> float:
    """Required user idle time (seconds) before delivering a beat message."""
    return _env_float("BOT_BEAT_USER_IDLE_SECS", 1.0)


def BOT_BEAT_USER_IDLE_TIMEOUT_SECS() -> float:
    """Maximum time (seconds) to wait for user idle before delivering a beat message anyway."""
    # A reasonable default to avoid indefinite waits (chatty user); can be tuned as needed
    return _env_float("BOT_BEAT_USER_IDLE_TIMEOUT_SECS", 15.0)


def BOT_BEAT_POST_SPEAK_BUFFER_SECS() -> float:
    """Additional buffer time (seconds) after the bot finishes speaking before delivering a beat message."""
    return _env_float("BOT_BEAT_POST_SPEAK_BUFFER_SECS", 2.0)


def BOT_PROFILE_PREAMBLE_MESSAGE() -> str:
    return _env_str(
        "BOT_PROFILE_PREAMBLE_MESSAGE",
        "User context available for {{username}}",
    )


def BOT_PROFILE_INSTRUCTION_MESSAGE() -> str:
    return _env_str(
        "BOT_PROFILE_INSTRUCTION_MESSAGE",
        "Remember this information in your session context.",
    )


# Defaulting to 0 (disabled), as the participant context is baked into role_messages now



def BOT_PARTICIPANT_REFRESH_MESSAGE() -> str:
    return _env_str(
        "BOT_PARTICIPANT_REFRESH_MESSAGE",
        "Current participants and their context:",
    )


__all__ = [
    "BOT_PID",
    "verify_daily_api_key",
    # lifecycle
    "BOT_EMPTY_INITIAL_SECS",
    "BOT_EMPTY_POST_LEAVE_SECS",
    "BOT_VOICE_ONLY",
    "BOT_ADMIN_MESSAGE_DIR",
    "BOT_IDENTITY_DIR",
    "BOT_ZOMBIE_SPAWN_GRACE_SECS",
    "BOT_ZOMBIE_REQUIRED_STALE_HITS",
    "BOT_AUTORESPAWN_ON_ZOMBIE",
    "BOT_SERVER_REAP_INTERVAL_SECS",
    # greeting
    "BOT_GREETING_GRACE_SECS",
    "BOT_GREETING_SINGLE_SYSTEM_MESSAGE",
    "BOT_GREETING_PAIR_SYSTEM_MESSAGE",
    "BOT_GREETING_GROUP_SYSTEM_MESSAGE",
    # beats
    "BOT_SPEAK_GATE_DELAY_SECS",
    "BOT_BEAT_USER_IDLE_SECS",
    "BOT_BEAT_USER_IDLE_TIMEOUT_SECS",
    "BOT_BEAT_REPEAT_INTERVAL_SECS",
    "BOT_BEAT_MIN_SPEAK_GAP_SECS",
    "BOT_BEAT_POST_SPEAK_BUFFER_SECS",
    "BOT_SANITIZE_FLOW_PROFILE_FIELDS",
    # wrapup
    "BOT_WRAPUP_AFTER_SECS",
    "BOT_WRAPUP_SYSTEM_MESSAGE",
    # voice parameters
    "BOT_VOICE_SPEED",
    "BOT_VOICE_STABILITY",
    "BOT_VOICE_SIMILARITY_BOOST",
    "BOT_VOICE_STYLE",
    "BOT_VOICE_OPTIMIZE_STREAMING_LATENCY",
    "BOT_TTS_PROVIDER",
    "KOKORO_TTS_BASE_URL",
    "KOKORO_TTS_API_KEY",
    "KOKORO_TTS_VOICE_ID",
    "KOKORO_TTS_MODEL_ID",
    "KOKORO_TTS_LANGUAGE_CODE",
    "KOKORO_TTS_APPLY_TEXT_NORMALIZATION",
    "KOKORO_TTS_CHUNK_SCHEDULE",
    "KOKORO_TTS_AUTO_MODE",
    "KOKORO_TTS_TRY_TRIGGER_GENERATION",
    "KOKORO_TTS_INACTIVITY_TIMEOUT",
    "KOKORO_TTS_SAMPLE_RATE",
    "KOKORO_TTS_ENABLE_LOGGING",
    "KOKORO_TTS_ENABLE_SSML",
    "KOKORO_TTS_SEED",
    # user profile
    "BOT_PROFILE_PREAMBLE_MESSAGE",
    "BOT_PROFILE_INSTRUCTION_MESSAGE",
    # participant refresh
    "BOT_PARTICIPANT_REFRESH_MESSAGE",
]
