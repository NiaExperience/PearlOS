import json
import os
import re
import urllib.parse
import urllib.request
from typing import Any
from loguru import logger as base_logger

from core.config import BOT_PID
from core.context import MultiUserContextAggregator
from core.transport import set_transport, get_session_user_id_from_participant
try:
    from room.state import get_room_tenant_id
except ImportError:
    from bot.room.state import get_room_tenant_id
from monitoring.events import TTSSpeakingEventProcessor
from flows.registry import register_flow_manager

from tools import toolbox
from processors.canvas_prefetch import CanvasPrefetchProcessor
from processors.end_call_intent import EndCallIntentProcessor
from processors.tts_safety import TTSSafetyProcessor
try:
    from pipecat.services.anthropic.llm import AnthropicLLMService as _BaseAnthropicLLMService
    from pipecat.services.anthropic.llm import AnthropicLLMContext
    HAS_ANTHROPIC_SERVICE = True

    class AnthropicLLMService(_BaseAnthropicLLMService):
        """Thin wrapper that strips system-role messages from context.
        
        PearlOS handlers inject {'role': 'system', ...} messages for participant
        context, announcements, etc. Anthropic's Messages API rejects these.
        This wrapper filters them out before each API call, appending their
        content to the top-level system parameter instead.
        """
        def _get_llm_invocation_params(self, context):
            params = super()._get_llm_invocation_params(context)
            # Extract any system-role messages that handlers injected
            clean_messages = []
            extra_system_parts = []
            for msg in params.get("messages", []):
                if isinstance(msg, dict) and msg.get("role") == "system":
                    content = msg.get("content", "")
                    if content:
                        extra_system_parts.append(content)
                else:
                    clean_messages.append(msg)
            params["messages"] = clean_messages
            # Append injected system content to the top-level system param
            if extra_system_parts:
                existing = params.get("system", "") or ""
                params["system"] = existing + "\n\n" + "\n\n".join(extra_system_parts) if existing else "\n\n".join(extra_system_parts)
            return params
except ImportError:
    HAS_ANTHROPIC_SERVICE = False
from core.config import (
    BOT_VOICE_SPEED, BOT_VOICE_STABILITY, BOT_VOICE_SIMILARITY_BOOST,
    BOT_VOICE_STYLE, BOT_VOICE_OPTIMIZE_STREAMING_LATENCY,
    BOT_TTS_PROVIDER, KOKORO_TTS_API_KEY, KOKORO_TTS_BASE_URL,
    KOKORO_TTS_VOICE_ID, KOKORO_TTS_MODEL_ID, KOKORO_TTS_LANGUAGE_CODE,
    KOKORO_TTS_SAMPLE_RATE, KOKORO_TTS_AUTO_MODE,
    KOKORO_TTS_APPLY_TEXT_NORMALIZATION, KOKORO_TTS_ENABLE_LOGGING,
    KOKORO_TTS_ENABLE_SSML, KOKORO_TTS_SEED, KOKORO_TTS_INACTIVITY_TIMEOUT,
    KOKORO_TTS_CHUNK_SCHEDULE, KOKORO_TTS_TRY_TRIGGER_GENERATION,
    BOT_VISION_ENABLED, BOT_VISION_MODEL, BOT_VISION_INTERVAL, BOT_VISION_PROMPT,
)

from core.prompts import MULTI_USER_NOTE, SMART_SILENCE_NOTE, PERSONAL_SELF_EVOLUTION_NOTE, VOICE_INTERACTIVE_TOOL_USE_NOTE, build_onboarding_system_note_async, NOTES_NOTE, QA_RELEASE_GATE_NOTE, VOICE_COMMAND_NOTE, VOICE_TTS_NOTE, TONE_CONTROL_NOTE, CARTESIA_TONE_CONTROL_NOTE, FAST_WEB_SEARCH_NOTE, VOICE_PRONUNCIATION_NOTE

_CARTESIA_VOICE_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

_VOXTRAL_HEALTH_CACHE: dict[str, tuple[float, bool]] = {}
_VOXTRAL_HEALTH_TTL_SECS = 30.0


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


def _is_voxtral_healthy(vox_url: str, vox_key: str | None) -> bool:
    """Cache Voxtral health checks so multi-mode voice startup does one probe."""
    import time

    cache_key = vox_url.rstrip("/")
    now = time.time()
    cached = _VOXTRAL_HEALTH_CACHE.get(cache_key)
    if cached and now - cached[0] < _VOXTRAL_HEALTH_TTL_SECS:
        return cached[1]

    healthy = False
    try:
        req = urllib.request.Request(
            f"{cache_key}/v1/models",
            headers={"Authorization": f"Bearer {vox_key}"} if vox_key else {},
        )
        with urllib.request.urlopen(req, timeout=1.0) as r:
            healthy = r.status == 200
    except Exception as e:
        base_logger.warning(f"[{BOT_PID}] Voxtral preflight failed ({e}); trying Cartesia as first fallback.")

    _VOXTRAL_HEALTH_CACHE[cache_key] = (now, healthy)
    return healthy


def _cartesia_voice_id(value: object, fallback: str) -> str:
    if isinstance(value, str) and _CARTESIA_VOICE_ID_RE.match(value.strip()):
        return value.strip()
    return fallback

def _fetch_msam_context(timeout: float | None = None) -> str:
    """Fetch semantic memory context from MSAM if available.
    
    Returns a formatted string of Pearl's most relevant memories,
    or empty string if MSAM is unreachable or disabled.
    Safe to call unconditionally; never raises.
    """
    import urllib.request
    import json as _json
    
    msam_url = os.getenv("MSAM_URL", "http://127.0.0.1:3001")
    if os.getenv("MSAM_DISABLED", "").lower() in ("true", "1", "yes"):
        return ""
    if timeout is None:
        timeout = _env_float("PEARL_VOICE_MSAM_TIMEOUT_SECS", 0.75, minimum=0.1)
    
    try:
        # Use /v1/context for session startup (returns compressed top memories)
        req = urllib.request.Request(
            f"{msam_url}/v1/context",
            data=_json.dumps({"agent_id": "pearl", "token_budget": 4000}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = _json.loads(resp.read())
        
        atoms = data.get("atoms", [])
        if not atoms:
            return ""
        
        # Format memories as a clean context block
        memory_lines = []
        for atom in atoms:
            content = atom.get("content", "").strip()
            if content:
                memory_lines.append(content)
        
        if memory_lines:
            return (
                "## Semantic Memory (MSAM)\n"
                "The following memories were retrieved from your long-term semantic memory store. "
                "Use them to maintain continuity across sessions.\n\n"
                + "\n\n---\n\n".join(memory_lines)
            )
    except Exception:
        pass  # MSAM down or unreachable — graceful degradation
    
    return ""


def _clean_voice_identity(value: object) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = " ".join(value.split()).strip()
    if cleaned.lower() in {"anonymous", "null", "none", "undefined"}:
        return ""
    return cleaned[:240]


def _mesh_headers() -> dict[str, str]:
    headers = {"Accept": "application/json"}
    mesh_secret = os.getenv("MESH_SHARED_SECRET", "").strip()
    bot_secret = os.getenv("BOT_CONTROL_SHARED_SECRET", "").strip()
    if mesh_secret:
        headers["x-mesh-secret"] = mesh_secret
    if bot_secret:
        headers["x-bot-control-secret"] = bot_secret
    return headers


def _sync_mesh_profile_lookup(where: dict[str, Any], timeout: float) -> dict[str, Any] | None:
    base_url = os.getenv("MESH_API_ENDPOINT", "").strip().rstrip("/")
    if not base_url:
        return None
    params = urllib.parse.urlencode(
        {
            "where": json.dumps(where, separators=(",", ":")),
            "limit": "1",
        }
    )
    req = urllib.request.Request(
        f"{base_url}/content/UserProfile?{params}",
        headers=_mesh_headers(),
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            parsed = json.loads(resp.read().decode("utf-8") or "{}")
    except Exception as exc:
        base_logger.warning(f"[{BOT_PID}] [voice.profile] UserProfile lookup failed: {exc}")
        return None

    data = parsed.get("data") if isinstance(parsed, dict) else None
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    if isinstance(data, dict):
        return data
    return None


def _sync_fetch_voice_profile(user_id: str, user_email: str) -> dict[str, Any] | None:
    timeout = _env_float("PEARL_VOICE_PROFILE_LOOKUP_TIMEOUT_SECS", 0.75, minimum=0.1)
    if user_id and user_id.lower() != "anonymous":
        profile = _sync_mesh_profile_lookup({"indexer": {"path": "userId", "equals": user_id}}, timeout)
        if profile:
            return profile
    if user_email:
        return _sync_mesh_profile_lookup({"indexer": {"path": "email", "equals": user_email}}, timeout)
    return None


def _voice_profile_preferred_name(profile: dict[str, Any] | None) -> str:
    if not isinstance(profile, dict):
        return ""
    first_name = _clean_voice_identity(profile.get("first_name"))
    if first_name:
        return first_name
    public_persona = profile.get("publicPersona")
    if isinstance(public_persona, dict):
        display_name = _clean_voice_identity(public_persona.get("displayName"))
        if display_name:
            return display_name
    metadata = profile.get("metadata")
    if isinstance(metadata, dict):
        for key in ("preferred_name", "first_name", "name", "full_name"):
            value = _clean_voice_identity(metadata.get(key))
            if value:
                return value
    return ""


def _voice_profile_context_block(
    profile: dict[str, Any] | None,
    *,
    session_user_id: str,
    session_user_email: str,
    session_user_name: str,
) -> str:
    if not isinstance(profile, dict):
        return ""

    lines = [
        "## Current Authenticated Voice User Profile",
        (
            "This UserProfile is authoritative for the person speaking in this "
            "voice session. Prefer it over Daily display names, stale session "
            "metadata, old transcripts, or global project memory. Apply it only "
            "to this authenticated voice user."
        ),
    ]
    user_id = _clean_voice_identity(profile.get("userId") or session_user_id)
    email = _clean_voice_identity(profile.get("email") or session_user_email).lower()
    first_name = _clean_voice_identity(profile.get("first_name"))
    if user_id:
        lines.append(f"- PearlOS userId: {user_id}")
    if email:
        lines.append(f"- Email: {email}")
    if first_name:
        lines.append(f"- First name: {first_name}")
    if session_user_name and session_user_name not in {first_name}:
        lines.append(f"- Lower-priority session display name: {session_user_name}")

    public_persona = profile.get("publicPersona")
    if isinstance(public_persona, dict):
        persona_lines = []
        for key in ("displayName", "bio", "location", "profession"):
            value = _clean_voice_identity(public_persona.get(key))
            if value:
                persona_lines.append(f"- {key}: {value}")
        interests = public_persona.get("interests")
        if isinstance(interests, list):
            clean_interests = [
                _clean_voice_identity(item)
                for item in interests
                if _clean_voice_identity(item)
            ][:12]
            if clean_interests:
                persona_lines.append("- interests: " + ", ".join(clean_interests))
        if persona_lines:
            lines.append("\n### Public Persona")
            lines.extend(persona_lines)

    private_memory = profile.get("privateMemory")
    if isinstance(private_memory, dict):
        memory_lines = []
        for key in ("personalNotes", "relationshipContext"):
            value = _clean_voice_identity(private_memory.get(key))
            if value:
                memory_lines.append(f"- {key}: {value[:1800]}")
        preferences = private_memory.get("preferences")
        if isinstance(preferences, dict) and preferences:
            memory_lines.append(
                "- preferences: "
                + json.dumps(preferences, ensure_ascii=False, sort_keys=True)[:1800]
            )
        if memory_lines:
            lines.append("\n### Private Memory")
            lines.extend(memory_lines)

    summary = profile.get("lastConversationSummary")
    if isinstance(summary, dict):
        summary_text = _clean_voice_identity(summary.get("summary"))
        if summary_text:
            lines.append("\n### Last Conversation Summary")
            lines.append(summary_text[:1400])

    return "\n".join(lines)[:8000]


def load_workspace_context(
    session_user_id: str | None = None,
    session_user_name: str | None = None,
    session_user_email: str | None = None,
    session_tenant_id: str | None = None,
) -> str:
    """Load Pearl's identity and context from workspace files.

    Returns shared Pearl identity context for voice. User-specific memory files
    are excluded by default because voice sessions can belong to different
    authenticated users; only enable the legacy shared memory path with
    PEARL_VOICE_INCLUDE_PRIVATE_MEMORY=true.
    """
    workspace_root = os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")
    include_private_memory = os.getenv("PEARL_VOICE_INCLUDE_PRIVATE_MEMORY", "").lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    context_parts = []

    session_user_name = _clean_voice_identity(session_user_name or os.getenv("BOT_SESSION_USER_NAME", ""))
    session_user_id = _clean_voice_identity(session_user_id or os.getenv("BOT_SESSION_USER_ID", ""))
    session_user_email = _clean_voice_identity(session_user_email or os.getenv("BOT_SESSION_USER_EMAIL", "")).lower()
    voice_profile = _sync_fetch_voice_profile(session_user_id, session_user_email)
    profile_user_name = _voice_profile_preferred_name(voice_profile)
    caller_name = profile_user_name or session_user_name
    if caller_name or session_user_id or session_user_email:
        identity_bits = []
        if caller_name:
            identity_bits.append(f"name: {caller_name}")
        if session_user_email:
            identity_bits.append(f"email: {session_user_email}")
        if session_user_id:
            identity_bits.append(f"user id: {session_user_id}")
        context_parts.append(
            "## Current Voice Caller\n"
            "This is the person currently speaking in this voice session: "
            + ", ".join(identity_bits)
            + ". Address this caller by this authenticated profile name if you use a name. "
            "Other names may appear in global PearlOS memory, project notes, old transcripts, "
            "or stale Daily metadata. Do not use those names for the current caller unless "
            "this current voice caller/profile block says so."
        )
    profile_block = _voice_profile_context_block(
        voice_profile,
        session_user_id=session_user_id,
        session_user_email=session_user_email,
        session_user_name=session_user_name,
    )
    if profile_block:
        context_parts.append(profile_block)

    # Per-user memory injection (authenticated sessions only)
    tenant_id = (session_tenant_id or os.getenv("BOT_SESSION_TENANT_ID", "")).strip()
    user_id = session_user_id or ""
    user_email = session_user_email or ""

    has_per_user_scope = bool(tenant_id and user_id and user_id.lower() != "anonymous")
    if has_per_user_scope:
        try:
            from pearl.user_memory import scope_from_values, build_memory_block
            scope = scope_from_values(tenant_id=tenant_id, user_id=user_id, user_email=user_email)
            if scope:
                per_user_block = build_memory_block(scope, limit=30, user_name=caller_name)
                if per_user_block:
                    context_parts.append(per_user_block)
        except Exception:
            pass

    # Read identity files
    identity_files = [
        ("SOUL.md", "Core Identity"),
        ("IDENTITY.md", "Personal Details"),
    ]
    if include_private_memory:
        identity_files.extend([
            ("USER.md", "User Context"),
            ("USER_FACTS.md", "Durable User Facts"),
        ])
    
    for filename, label in identity_files:
        filepath = os.path.join(workspace_root, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    context_parts.append(f"## {label}\n{content}")
        except FileNotFoundError:
            base_logger.warning(f"[{BOT_PID}] Workspace file not found: {filepath}")
        except Exception as e:
            base_logger.error(f"[{BOT_PID}] Error reading {filepath}: {e}")
    
    if include_private_memory:
        # Read cross-session state file (quick-read shared state)
        cross_session_path = os.path.join(workspace_root, "memory", "cross-session-state.md")
        try:
            with open(cross_session_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    context_parts.append(f"## RECENT CONVERSATIONS (from other channels)\nThis is what you (Pearl) have been discussing with the user in other sessions. Treat this as your own memory.\n\n{content}")
        except FileNotFoundError:
            base_logger.warning(f"[{BOT_PID}] Cross-session state not found: {cross_session_path}")
        except Exception as e:
            base_logger.error(f"[{BOT_PID}] Error reading cross-session state: {e}")

        # Read recent activity log for cross-session awareness
        activity_log_path = os.path.join(workspace_root, "memory", "activity-log.md")
        try:
            with open(activity_log_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                recent_entries = [line.strip() for line in lines if line.strip() and line.startswith('[')][-10:]
                if recent_entries:
                    context_parts.append(
                        "## Recent Cross-Session Activity\n" +
                        "You are the same Pearl across all channels (Discord, webchat, PearlOS voice). " +
                        "Here's what happened in other sessions recently:\n" +
                        "\n".join(recent_entries)
                    )
        except FileNotFoundError:
            base_logger.warning(f"[{BOT_PID}] Activity log not found: {activity_log_path}")
        except Exception as e:
            base_logger.error(f"[{BOT_PID}] Error reading activity log: {e}")

        # Read today's daily memory file for detailed context
        from datetime import datetime, timezone
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        daily_memory_path = os.path.join(workspace_root, "memory", f"{today_str}.md")
        try:
            with open(daily_memory_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    if len(content) > 2000:
                        content = "...\n" + content[-2000:]
                    context_parts.append(f"## Today's Activity Detail ({today_str})\n{content}")
        except FileNotFoundError:
            pass
        except Exception as e:
            base_logger.error(f"[{BOT_PID}] Error reading daily memory: {e}")

        # Read MEMORY.md for long-term context (trimmed)
        memory_path = os.path.join(workspace_root, "MEMORY.md")
        try:
            with open(memory_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                if lines:
                    trimmed = lines[-50:]
                    content = "".join(trimmed).strip()
                    if content:
                        context_parts.append(f"## Long-Term Memory (recent entries)\n{content}")
        except FileNotFoundError:
            pass
        except Exception as e:
            base_logger.error(f"[{BOT_PID}] Error reading MEMORY.md: {e}")
    
    # ── Notes context injection (Phase 1) ──────────────────────────────
    # Inject a summary of the user's recent notes so voice Pearl knows
    # what exists without having to probe blindly with tool calls.
    include_notes_context = os.getenv("PEARL_VOICE_INCLUDE_NOTES_CONTEXT", "").lower() in (
        "1", "true", "yes", "on",
    )
    if include_notes_context:
        try:
            import urllib.request, json as _json
            session_user = session_user_id or os.getenv("BOT_SESSION_USER_ID", "").strip()
            if session_user:
                notes_url = f"http://127.0.0.1:4444/api/notes?user_id={session_user}&limit=5&include_content=false"
                req = urllib.request.Request(notes_url)
                notes_timeout = _env_float("PEARL_VOICE_NOTES_CONTEXT_TIMEOUT_SECS", 0.75, minimum=0.1)
                with urllib.request.urlopen(req, timeout=notes_timeout) as resp:
                    data = _json.loads(resp.read().decode())
                    notes_list = data.get("notes", []) if isinstance(data, dict) else []
                if notes_list:
                    lines = []
                    for n in notes_list:
                        title = (n.get("title") or "Untitled").strip()
                        updated = (n.get("updated_at") or n.get("created_at") or "")[:10]
                        lines.append(f"- {title}" + (f" ({updated})" if updated else ""))
                    context_parts.append(
                        "## Your User's Recent Notes\n"
                        "These are the user's most recently modified notes. "
                        "You can open or read any of them using your notes tools "
                        "(bot_open_notes, bot_list_notes, bot_read_current_note, etc.). "
                        "Reference them naturally when relevant.\n\n" +
                        "\n".join(lines)
                    )
                    base_logger.info(f"[{BOT_PID}] [voice] Injected {len(notes_list)} note summaries for user {session_user}")
                else:
                    base_logger.info(f"[{BOT_PID}] [voice] No notes found for user {session_user}")
            else:
                base_logger.info(f"[{BOT_PID}] [voice] Skipped notes injection — no BOT_SESSION_USER_ID")
        except Exception as e:
            base_logger.warning(f"[{BOT_PID}] [voice] Notes context injection failed (non-fatal): {e}")
    # ── End notes context injection ────────────────────────────────────
    
    # Cross-channel identity clarity (concise version for token efficiency)
    # ISSUE #2 FIX: Inject Discord context from environment when available
    discord_context = ""
    discord_guild_id = os.getenv("BOT_DISCORD_GUILD_ID")
    discord_channel_id = os.getenv("BOT_DISCORD_CHANNEL_ID")
    discord_channel_name = os.getenv("BOT_DISCORD_CHANNEL_NAME", "general")
    
    if discord_guild_id and discord_channel_id:
        discord_context = (
            f"\n## Your Current Discord Context\n\n"
            f"You are currently operating in:\n"
            f"- Discord Server/Guild ID: {discord_guild_id}\n"
            f"- Channel: #{discord_channel_name} (ID: {discord_channel_id})\n\n"
            f"When the user says 'send a Discord message to general' or 'message the general channel', "
            f"they mean THIS channel (#{discord_channel_name}) that you're already in. "
            f"You don't need to ask for server/channel IDs — you're already here.\n"
        )
    
    context_parts.append(
        "## Your Identity Across Channels\n\n"
        "You are Pearl — the SAME Pearl across PearlOS voice, Discord, Telegram, and webchat.\n"
        "When the user mentions 'Discord', that's one of YOUR channels — you ARE the Discord bot.\n\n"
        + discord_context +
        "## Voice Session Rules\n\n"
        "- Only send messages to Discord/Telegram when the user explicitly asks.\n"
        "- You have full tool access via OpenClaw — web search, messaging, exec, files, everything.\n"
        "- Never say 'I can't do that' — check your tools first.\n"
    )
    
    # Read voice pending updates file and detect [READY] items for proactive delivery
    pending_updates_path = os.path.join(workspace_root, "memory", "voice-pending-updates.md")
    try:
        with open(pending_updates_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if content:
                has_ready = "[READY]" in content
                context_parts.append(f"## Voice Pending Updates\n{content}")
                if has_ready:
                    context_parts.append(
                        "## ⚡ STARTUP ACTION: Deliver Pending Updates\n\n"
                        "There are [READY] items in Voice Pending Updates above. These were queued "
                        "for you by another session (Discord, sub-agent, etc.) to deliver in this voice session.\n\n"
                        "**Right after your greeting**, naturally bring up the pending items. For example:\n"
                        "- 'Oh hey, I've got something queued up from earlier — [describe it naturally]'\n"
                        "- 'Before we dive in, I put together that checklist you wanted — want me to go through it?'\n\n"
                        "Present the content conversationally — don't read raw markdown or mention file paths.\n"
                        "After you've presented the updates, use bot_think_deeply to mark them as delivered by running: "
                        "\"Update /root/.openclaw/workspace/memory/voice-pending-updates.md — replace [READY] with [DELIVERED] "
                        "for the items I just presented.\"\n"
                    )
                    base_logger.info(f"[{BOT_PID}] [voice] Found [READY] pending updates — injecting startup delivery instructions")
    except FileNotFoundError:
        pass  # Normal - file may not exist
    except Exception as e:
        base_logger.error(f"[{BOT_PID}] Error reading voice pending updates: {e}")
    
    # Fetch semantic memory from MSAM (safe, non-blocking, graceful fallback)
    msam_context = _fetch_msam_context()
    if msam_context:
        context_parts.append(msam_context)
        base_logger.info(f"[voice] MSAM semantic memory loaded ({len(msam_context)} chars)")
    else:
        base_logger.info("[voice] MSAM not available or empty, continuing without semantic memory")
    
    return "\n\n".join(context_parts) if context_parts else ""

def _load_oc_session_dynamic_context(
    session_user_id: str | None = None,
    session_user_name: str | None = None,
    session_user_email: str | None = None,
    session_tenant_id: str | None = None,
) -> str:
    """Load dynamic context for OpenClaw session mode.
    
    Reads cross-session state, activity log, and voice-pending-updates
    to give voice Pearl awareness of what other sessions have been doing.
    Reuses the same file paths and logic as load_workspace_context() but
    returns only the subset relevant for the OC session system prompt.
    
    Total output is capped at ~10K chars to keep voice context reasonable.
    """
    workspace_root = os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")
    parts = []

    # PearlOS agent guide (PEARL.md) — environment, source rules, architecture
    pearl_paths = [
        os.path.join(workspace_root, "PEARL.md"),
        "/home/deploy/pearlos/PEARL.md",
        "/workspace/nia-universal/PEARL.md",
        "/opt/pearlos/PEARL.md",
    ]
    for pearl_path in pearl_paths:
        try:
            with open(pearl_path, 'r', encoding='utf-8') as f:
                pearl_content = f.read().strip()
                if pearl_content:
                    if len(pearl_content) > 4000:
                        pearl_content = pearl_content[:4000] + "\n...[truncated]"
                    parts.append(f"## PearlOS Agent Guide (PEARL.md)\n{pearl_content}")
                    base_logger.info(f"[{BOT_PID}] [oc-session] Loaded PEARL.md from {pearl_path}")
                    break
        except (FileNotFoundError, Exception):
            continue

    # Cross-session state
    cross_session_path = os.path.join(workspace_root, "memory", "cross-session-state.md")
    try:
        with open(cross_session_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if content:
                if len(content) > 3000:
                    content = content[:3000] + "\n..."
                parts.append(f"## Cross-Session State\n{content}")
    except (FileNotFoundError, Exception):
        pass
    
    # Activity log (last 20 lines)
    activity_log_path = os.path.join(workspace_root, "memory", "activity-log.md")
    try:
        with open(activity_log_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            recent = [l.strip() for l in lines if l.strip() and l.startswith('[')][-20:]
            if recent:
                parts.append(
                    "## Recent Activity Log\n"
                    "What you (Pearl) have been doing across all channels recently:\n" +
                    "\n".join(recent)
                )
    except (FileNotFoundError, Exception):
        pass
    
    # Voice pending updates ([READY] items)
    pending_path = os.path.join(workspace_root, "memory", "voice-pending-updates.md")
    try:
        with open(pending_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if content and "[READY]" in content:
                parts.append(
                    "## ⚡ Pending Updates to Deliver\n"
                    "These were queued by another session for you to deliver in voice. "
                    "After greeting, naturally bring them up. After delivering, mark them [DELIVERED].\n\n"
                    + content
                )
                base_logger.info(f"[{BOT_PID}] [oc-session] Found [READY] pending updates for voice")
    except (FileNotFoundError, Exception):
        pass
    
    # Per-user memory injection (authenticated sessions only)
    _oc_tenant_id = (session_tenant_id or os.getenv("BOT_SESSION_TENANT_ID", "")).strip()
    _oc_user_id = _clean_voice_identity(session_user_id or os.getenv("BOT_SESSION_USER_ID", ""))
    _oc_user_email = _clean_voice_identity(session_user_email or os.getenv("BOT_SESSION_USER_EMAIL", "")).lower()
    _oc_user_name = _clean_voice_identity(session_user_name or os.getenv("BOT_SESSION_USER_NAME", ""))

    _oc_profile = _sync_fetch_voice_profile(_oc_user_id, _oc_user_email)
    _oc_profile_block = _voice_profile_context_block(
        _oc_profile,
        session_user_id=_oc_user_id,
        session_user_email=_oc_user_email,
        session_user_name=_oc_user_name,
    )
    if _oc_profile_block:
        parts.append(_oc_profile_block)

    _has_per_user_scope = bool(_oc_tenant_id and _oc_user_id and _oc_user_id.lower() != "anonymous")
    if _has_per_user_scope:
        try:
            from pearl.user_memory import scope_from_values, build_memory_block
            scope = scope_from_values(tenant_id=_oc_tenant_id, user_id=_oc_user_id, user_email=_oc_user_email)
            if scope:
                per_user_block = build_memory_block(scope, limit=30, user_name=_voice_profile_preferred_name(_oc_profile) or _oc_user_name)
                if per_user_block:
                    parts.append(per_user_block)
        except Exception:
            pass

    result = "\n\n".join(parts) if parts else ""
    # Hard cap
    if len(result) > 10000:
        result = result[:10000] + "\n...[truncated]"
    return result


def detect_startup_checklist(workspace_context: str) -> str | None:
    """Check if workspace context contains a QA checklist for voice startup.
    
    Returns the checklist section text if found, None otherwise.
    Looks for markers like 'VOICE SESSION' or 'QA CHECKLIST' in headings.
    """
    if not workspace_context:
        return None
    
    markers = ["VOICE SESSION", "QA CHECKLIST"]
    for marker in markers:
        if marker in workspace_context.upper():
            # Extract the checklist section
            lines = workspace_context.split('\n')
            in_checklist = False
            checklist_lines = []
            for line in lines:
                if any(m in line.upper() for m in markers) and line.strip().startswith('#'):
                    in_checklist = True
                    checklist_lines.append(line)
                    continue
                if in_checklist:
                    # Stop at next heading of same or higher level
                    if line.strip().startswith('## ') and checklist_lines:
                        break
                    checklist_lines.append(line)
            if checklist_lines:
                return '\n'.join(checklist_lines).strip()
    return None


async def build_pipeline(
    room_url: str,
    persona: str,
    personalityId: str,
    token: str | None = None,
    personality_record: Any | None = None,
    preloaded_prompts: dict[str, str] | None = None,
    voiceId: str | None = None,
    modePersonalityVoiceConfig: dict[str, Any] | None = None,
    supportedFeatures: list[str] | None = None,
    sessionOverride: dict[str, Any] | None = None,
    isOnboarding: bool = False,
    startupContext: dict[str, Any] | None = None,
    sessionId: str | None = None,
    sessionUserId: str | None = None,
    sessionUserName: str | None = None,
    sessionUserEmail: str | None = None,
    sessionTenantId: str | None = None,
):
    """Build and return (pipeline, task, context_agg, transport, messages, multi_user_aggregator).

    Heavy imports are inside so unit tests for parameter validation can run
    without needing the pipecat native / network dependencies unless invoked.
    """
    session_id_for_pipeline = _clean_voice_identity(sessionId or os.getenv("BOT_SESSION_ID", ""))
    session_user_id_for_pipeline = _clean_voice_identity(sessionUserId or os.getenv("BOT_SESSION_USER_ID", ""))
    session_user_name_for_pipeline = _clean_voice_identity(sessionUserName or os.getenv("BOT_SESSION_USER_NAME", ""))
    session_user_email_for_pipeline = _clean_voice_identity(sessionUserEmail or os.getenv("BOT_SESSION_USER_EMAIL", "")).lower()
    session_tenant_id_for_pipeline = _clean_voice_identity(sessionTenantId or os.getenv("BOT_SESSION_TENANT_ID", ""))

    logger = base_logger.bind(
        roomUrl=room_url,
        sessionId=session_id_for_pipeline,
        userId=session_user_id_for_pipeline,
        userName=session_user_name_for_pipeline,
    )
    from pipecat.audio.vad.silero import SileroVADAnalyzer

    # Multi-user functionality is now available via direct imports
    from pipecat.audio.vad.vad_analyzer import VADParams
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.task import PipelineParams, PipelineTask
    from pipecat.services.openai.llm import OpenAILLMService
    from pipecat.pipeline.service_switcher import ServiceSwitcher, ServiceSwitcherStrategyManual

    # --- OpenClaw LLM subclass ---------------------------------------------------
    # Thin wrapper around OpenAILLMService that:
    #   1. Strips `stream_options` (OpenClaw SSE never sends [DONE] with it)
    #   2. Injects a placeholder user message when only system messages exist
    #      (Anthropic rejects requests without at least one user message)
    #   3. Strips None values and unsupported params (service_tier, seed)
    class _OpenClawLLMService(OpenAILLMService):
        def build_chat_completion_params(self, context, **kwargs):
            params = super().build_chat_completion_params(context, **kwargs)
            params.pop("stream_options", None)
            params.pop("service_tier", None)
            params.pop("seed", None)
            # Strip None values
            params = {k: v for k, v in params.items() if v is not None}
            return params

        async def _process_context(self, context):
            msgs = context.get_messages_for_logging() if hasattr(context, "get_messages_for_logging") else []
            if msgs and all(m.get("role") == "system" for m in msgs):
                context.add_message({"role": "user", "content": "[user has joined the conversation]"})
            await super()._process_context(context)
    # ---------------------------------------------------------------------------
    from pipecat.transports.daily.transport import DailyParams, DailyTransport
    from daily import LogLevel as DailyLogLevel
    from pipecat.services.openai.llm import OpenAIContextAggregatorPair
    from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
    
    from flows import build_flow_manager

    from providers.kokoro import KokoroTTSService
    from providers.elevenlabs import ElevenLabsTTSService
    from providers.pocket_tts import PocketTTSService
    from providers.voxtral import VoxtralTTSService
    from providers.cartesia import CartesiaTTSService
    from utils.clause_text_aggregator import ClauseTextAggregator

    try:
        from filters.silence import SilenceTextFilter
    except ImportError:
        from bot.filters.silence import SilenceTextFilter

    try:
        from filters.tts_text_filter import MarkdownStripFilter
    except ImportError:
        from bot.filters.tts_text_filter import MarkdownStripFilter

    try:
        from filters.narration_filter import NarrationStripFilter
    except ImportError:
        try:
            from bot.filters.narration_filter import NarrationStripFilter
        except ImportError:
            NarrationStripFilter = None
        
    try:
        from processors.lull import create_lull_processor
    except ImportError:
        from bot.processors.lull import create_lull_processor

    try:
        from processors.tool_narration import ToolNarrationProcessor
    except ImportError:
        from bot.processors.tool_narration import ToolNarrationProcessor

    # Allow explicit voice override via env BOT_VOICE_ID; otherwise use personality default
    voice_id = voiceId or os.getenv("BOT_VOICE_ID")
    logger.info(
        f"[{BOT_PID}] Using personality '{personalityId}' as persona '{persona}' with voice_id='{voice_id}'"
    )

    # Read voice parameters from environment variables using config functions
    voice_speed = BOT_VOICE_SPEED()
    voice_stability = BOT_VOICE_STABILITY()
    voice_similarity_boost = BOT_VOICE_SIMILARITY_BOOST()
    voice_style = BOT_VOICE_STYLE()
    voice_optimize_streaming_latency = BOT_VOICE_OPTIMIZE_STREAMING_LATENCY()

    # Apply session override if present (Force mode/personality/voice)
    if sessionOverride and sessionOverride.get("mode") and modePersonalityVoiceConfig:
        override_mode = sessionOverride.get("mode")
        if override_mode in modePersonalityVoiceConfig:
            logger.info(f"[{BOT_PID}] Applying session override for mode: {override_mode}")
            mode_config = modePersonalityVoiceConfig[override_mode]
            
            if "personaName" in mode_config:
                persona = mode_config["personaName"]
            if "personalityId" in mode_config:
                personalityId = mode_config["personalityId"]
            
            if "voice" in mode_config:
                v_conf = mode_config["voice"]
                if "voiceId" in v_conf:
                    voiceId = v_conf["voiceId"]
                    voice_id = voiceId # Update local var
                
                if "speed" in v_conf: voice_speed = v_conf["speed"]
                if "stability" in v_conf: voice_stability = v_conf["stability"]
                if "similarityBoost" in v_conf: voice_similarity_boost = v_conf["similarityBoost"]
                if "style" in v_conf: voice_style = v_conf["style"]
                if "optimizeStreamingLatency" in v_conf: voice_optimize_streaming_latency = v_conf["optimizeStreamingLatency"]

    # Log voice parameters for debugging
    voice_params_log = []
    if voice_speed is not None:
        voice_params_log.append(f"speed={voice_speed}")
    if voice_stability is not None:
        voice_params_log.append(f"stability={voice_stability}")
    if voice_similarity_boost is not None:
        voice_params_log.append(f"similarity_boost={voice_similarity_boost}")
    if voice_style is not None:
        voice_params_log.append(f"style={voice_style}")
    if voice_optimize_streaming_latency is not None:
        voice_params_log.append(f"optimize_streaming_latency={voice_optimize_streaming_latency}")

    if voice_params_log:
        logger.info(f"[{BOT_PID}] Voice parameters: {', '.join(voice_params_log)}")
    else:
        logger.info(f"[{BOT_PID}] No voice parameters provided, using defaults")

    # Read supported features from environment early for pipeline configuration
    supported_features_env = os.getenv('BOT_SUPPORTED_FEATURES')
    supported_features_list = supportedFeatures or (supported_features_env.split(',') if supported_features_env else [])
    
    # Auto-inject 'vision' feature flag when BOT_VISION_ENABLED is true
    if BOT_VISION_ENABLED() and 'vision' not in supported_features_list:
        supported_features_list.append('vision')
        logger.info(f"[{BOT_PID}] Auto-injected 'vision' feature flag (BOT_VISION_ENABLED=true)")
    
    # Remove raw HTML tools from voice — bot_create_html_content takes raw HTML that model may narrate
    # Wonder Canvas is safe (uses run_llm=False, sends HTML via events not TTS)
    VOICE_EXCLUDED_FEATURES = {'htmlContent'}
    excluded = [f for f in supported_features_list if f in VOICE_EXCLUDED_FEATURES]
    if excluded:
        supported_features_list = [f for f in supported_features_list if f not in VOICE_EXCLUDED_FEATURES]
        logger.warning(f'[{BOT_PID}] Excluded HTML-generating features from voice: {excluded}')
    
    use_smart_silence = 'smartSilence' in supported_features_list
    if use_smart_silence:
        logger.info(f"[{BOT_PID}] Enabling Smart Silence feature")
        
    # Always strip markdown from TTS input to prevent garbled audio.
    # Markdown formatting (**bold**, *italic*, etc.) causes TTS engines to
    # produce distorted output. The MarkdownStripFilter runs before synthesis.
    markdown_filter = MarkdownStripFilter()
    text_filters = [markdown_filter]
    # Narration scrubber: belt-and-suspenders backup to the prompt rules.
    # Strips "Let me check...", "I'll look...", etc. before TTS synthesis so
    # voice never speaks process narration even if the model leaks it.
    if NarrationStripFilter is not None:
        text_filters.append(NarrationStripFilter())
    if use_smart_silence:
        text_filters.append(SilenceTextFilter())

    use_lull_detection = 'lullDetection' in supported_features_list
    lull_timeout_secs = 8.0

    if use_lull_detection:
        logger.info(f"[{BOT_PID}] Enabling Lull Detection feature")
        lull_timeout_secs_str = os.getenv("LULL_TIMEOUT_SECS", "10.0")
        try:
            lull_timeout_secs = float(lull_timeout_secs_str)
        except ValueError:
            logger.warning(f"[{BOT_PID}] Invalid LULL_TIMEOUT_SECS value '{lull_timeout_secs_str}'. Defaulting to 10.0 seconds.")
            lull_timeout_secs = 10.0
        logger.info(f"[{BOT_PID}] Lull timeout set to {lull_timeout_secs} seconds.")

    _raw_env = os.getenv("BOT_TTS_PROVIDER")
    _use_el = os.getenv("USE_ELEVENLABS")
    tts_provider = BOT_TTS_PROVIDER()
    logger.info(f"Selected TTS provider: {tts_provider} (raw_env={_raw_env!r}, use_el={_use_el!r})")

    # Helper to create TTS service
    async def create_tts_service(provider, v_id, v_params=None):
        v_params = v_params or {}
        
        # Helper to get param with fallback to env var (if not in v_params)
        # Note: v_params keys might be camelCase from frontend, need to map if necessary
        # But here we assume they match or we handle it.
        # Actually, let's use the global env vars as defaults if not in v_params
        
        def get_p(key, default_val):
            return v_params.get(key, default_val)

        if provider == "kokoro":
            base_url = KOKORO_TTS_BASE_URL()
            # For local Chorus TTS, API key is optional (use dummy value if not provided)
            is_local = "127.0.0.1" in base_url or "localhost" in base_url or base_url.startswith("ws://127.0.0.1") or base_url.startswith("ws://localhost")
            api_key = KOKORO_TTS_API_KEY()
            if not api_key:
                if is_local:
                    # Local Chorus doesn't require real API key - use dummy value
                    api_key = "test-key"
                    logger.info(f"[{BOT_PID}] Local Chorus detected, using dummy API key")
                else:
                    logger.warning(f"[{BOT_PID}] ⚠️  KOKORO_TTS_API_KEY not found. Cannot create Kokoro service.")
                    return None
            
            chunk_schedule = KOKORO_TTS_CHUNK_SCHEDULE()
            kokoro_params = KokoroTTSService.InputParams(
                speed=get_p("speed", voice_speed),
                stability=get_p("stability", voice_stability),
                similarity_boost=get_p("similarityBoost", voice_similarity_boost),
                style=get_p("style", voice_style),
                chunk_length_schedule=list(chunk_schedule) if chunk_schedule else None,
                try_trigger_generation=KOKORO_TTS_TRY_TRIGGER_GENERATION(),
            )
            
            # Use requested voice_id if provided, else default
            k_voice = v_id or KOKORO_TTS_VOICE_ID(None)
            
            return KokoroTTSService(
                api_key=api_key,
                base_url=KOKORO_TTS_BASE_URL(),
                voice_id=k_voice,
                model_id=KOKORO_TTS_MODEL_ID(),
                language_code=KOKORO_TTS_LANGUAGE_CODE(),
                output_sample_rate=KOKORO_TTS_SAMPLE_RATE(),
                auto_mode=KOKORO_TTS_AUTO_MODE(),
                apply_text_normalization=KOKORO_TTS_APPLY_TEXT_NORMALIZATION(),
                enable_logging=KOKORO_TTS_ENABLE_LOGGING(),
                enable_ssml_parsing=KOKORO_TTS_ENABLE_SSML(),
                seed=KOKORO_TTS_SEED(),
                inactivity_timeout=KOKORO_TTS_INACTIVITY_TIMEOUT(),
                params=kokoro_params,
                text_filters=text_filters,
            )
        
        elif provider == "pocket":
            pocket_url = os.getenv("POCKET_TTS_URL", "http://localhost:8766")
            # PocketTTS accepts preset names ("azelma", "alba", ...) or URLs via
            # the voice_url form field. Fall back to v_id (BOT_VOICE_ID / mode
            # voiceId) when v_params has no explicit voice_url.
            resolved_voice = (v_params.get("voice_url") if v_params else None) or v_id
            pocket_params = PocketTTSService.InputParams(
                voice_url=resolved_voice,
                speed=float(os.getenv("POCKET_TTS_SPEED", "1.0")),
            )
            return PocketTTSService(
                base_url=pocket_url,
                sample_rate=24000,  # PocketTTS native 24kHz — pipecat SOXR handles transport resampling
                params=pocket_params,
                text_filters=text_filters,
                text_aggregator=ClauseTextAggregator(),
            )

        elif provider == "voxtral":
            from core.config import (
                VOXTRAL_TTS_BASE_URL,
                VOXTRAL_TTS_API_KEY,
                VOXTRAL_TTS_MODEL,
                VOXTRAL_TTS_VOICE,
                VOXTRAL_TTS_SPEED,
                VOXTRAL_TTS_RESPONSE_FORMAT,
            )
            # Preflight: if voxtral endpoint isn't healthy (tunnel down, Pod 2 rebooting,
            # model not loaded), fall back to pocket so the voice session still works.
            vox_url = VOXTRAL_TTS_BASE_URL()
            vox_key = VOXTRAL_TTS_API_KEY()
            healthy = _is_voxtral_healthy(vox_url, vox_key)
            if not healthy:
                # Try Cartesia first (supports laughter, better quality), then Pocket as last resort
                cartesia_result = await create_tts_service("cartesia", v_id, v_params)
                if cartesia_result is not None:
                    logger.info(f"[{BOT_PID}] Successfully fell back to Cartesia after Voxtral failure.")
                    return cartesia_result
                logger.warning(f"[{BOT_PID}] Cartesia fallback also failed; falling back to PocketTTS as last resort.")
                return await create_tts_service("pocket", v_id, v_params)

            voxtral_params = VoxtralTTSService.InputParams(
                voice=v_id if v_id and v_id not in {"azelma"} else VOXTRAL_TTS_VOICE(None),
                speed=float(get_p("speed", VOXTRAL_TTS_SPEED())),
                response_format=VOXTRAL_TTS_RESPONSE_FORMAT(),
            )
            return VoxtralTTSService(
                base_url=vox_url,
                api_key=vox_key,
                model=VOXTRAL_TTS_MODEL(),
                sample_rate=24000,
                params=voxtral_params,
                text_filters=text_filters,
                text_aggregator=ClauseTextAggregator(),
            )

        elif provider == "cartesia":
            from core.config import (
                CARTESIA_API_KEY,
                CARTESIA_TTS_BASE_URL,
                CARTESIA_TTS_MODEL,
                CARTESIA_TTS_VERSION,
                CARTESIA_TTS_VOICE_ID,
                CARTESIA_TTS_DEFAULT_EMOTION,
                CARTESIA_TTS_SPEED,
                CARTESIA_TTS_VOLUME,
            )
            cartesia_key = CARTESIA_API_KEY()
            if not cartesia_key:
                logger.warning(f"[{BOT_PID}] CARTESIA_API_KEY not found. Falling back to PocketTTS.")
                return await create_tts_service("pocket", v_id, v_params)

            cartesia_params = CartesiaTTSService.InputParams(
                voice_id=_cartesia_voice_id(v_id, CARTESIA_TTS_VOICE_ID(None)),
                emotion=str(get_p("emotion", CARTESIA_TTS_DEFAULT_EMOTION())),
                speed=float(get_p("speed", CARTESIA_TTS_SPEED())),
                volume=float(get_p("volume", CARTESIA_TTS_VOLUME())),
            )
            return CartesiaTTSService(
                api_key=cartesia_key,
                base_url=CARTESIA_TTS_BASE_URL(),
                model=CARTESIA_TTS_MODEL(),
                cartesia_version=CARTESIA_TTS_VERSION(),
                sample_rate=24000,
                params=cartesia_params,
                text_filters=text_filters,
                text_aggregator=ClauseTextAggregator(),
            )

        elif provider == "elevenlabs" or provider == "11labs":
            # ElevenLabs REMOVED from stack — fall back to PocketTTS
            logger.warning(f"[{BOT_PID}] ⚠️  ElevenLabs requested but DISABLED. Falling back to PocketTTS.")
            return await create_tts_service("pocket", v_id, v_params)

        return None

    services = []
    mode_map = {}

    # Helper to extract config and create service for a specific mode
    async def create_service_from_mode_config(mode_name, mode_data):
        # Extract provider and voice ID
        # The structure is typically mode_data -> voice -> { provider, voiceId, ... }
        # But we support flat structure or 'config' sub-object for backward compatibility if needed,
        # though the user indicates 'config' level is removed.
        
        voice_config = mode_data.get("voice", {})
        
        v_id = voice_config.get("voiceId")
        
        # Fallback to direct properties on mode_data
        if not v_id:
            v_id = mode_data.get("voiceId")

        # BOT_TTS_PROVIDER env ALWAYS wins over frontend mode config.
        # This lets us override the DB/frontend provider centrally via .env
        # (e.g., switching from elevenlabs to pocket without touching the DB).
        p_provider = tts_provider  # Already resolved from BOT_TTS_PROVIDER()
        if not p_provider:
            # Fallback: use mode config provider
            p_provider = voice_config.get("provider") or mode_data.get("voiceProvider")
        if not p_provider:
            p_provider = "kokoro"
        
        # Handle aliases
        if p_provider == "11labs": p_provider = "elevenlabs"

        # Extract voice params
        v_params = voice_config
        
        logger.info(f"[{BOT_PID}] Creating dedicated service for mode '{mode_name}': {p_provider}, voice={v_id}")
        return await create_tts_service(p_provider, v_id, v_params)

    # Determine initial mode to prioritize it (Index 0)
    initial_mode_name = None
    
    # Priority 0: Session Override
    if sessionOverride and sessionOverride.get("mode"):
        initial_mode_name = sessionOverride.get("mode")

    if not initial_mode_name and modePersonalityVoiceConfig:
        for mode, mode_data in modePersonalityVoiceConfig.items():
            # Priority 1: Match by personalityId (most reliable)
            p_id = mode_data.get("personalityId")
            if personalityId and p_id == personalityId:
                initial_mode_name = mode
                break
                
            # Priority 2: Match by mode name (if persona matches mode key)
            if persona and mode == persona.lower():
                initial_mode_name = mode
                break
    
    if initial_mode_name:
        logger.info(f"[{BOT_PID}] Initial mode identified: '{initial_mode_name}'")
        svc = await create_service_from_mode_config(initial_mode_name, modePersonalityVoiceConfig[initial_mode_name])
        if svc:
            services.append(svc)
            mode_map[initial_mode_name] = 0

    # Process all other modes - One Service Per Mode Pattern
    if modePersonalityVoiceConfig:
        for mode, mode_data in modePersonalityVoiceConfig.items():
            if mode == initial_mode_name:
                continue
                
            svc = await create_service_from_mode_config(mode, mode_data)
            if svc:
                services.append(svc)
                mode_map[mode] = len(services) - 1

    # Fallback: If no services created (e.g. no config), create default based on env vars
    if not services:
        logger.info(f"[{BOT_PID}] No mode config or services created. Creating default service from env vars.")
        default_provider = tts_provider # from env
        default_voice = voice_id # from env
        svc = await create_tts_service(default_provider, default_voice, {})
        if svc:
            services.append(svc)

    async def ensure_pocket_fallback(reason: str):
        if any(isinstance(service, PocketTTSService) for service in services):
            return
        fallback = await create_tts_service("pocket", voice_id, {})
        if fallback:
            services.append(fallback)
            logger.info(f"[{BOT_PID}] Added PocketTTS fallback service for {reason}.")
        else:
            logger.error(f"[{BOT_PID}] PocketTTS fallback service unavailable for {reason}.")

    if not services:
        logger.warning(f"[{BOT_PID}] No TTS services created; attempting PocketTTS recovery.")
        await ensure_pocket_fallback("empty TTS service list")
    elif any(isinstance(service, CartesiaTTSService) for service in services):
        await ensure_pocket_fallback("Cartesia failover")

    # Update speaker sample rate based on the primary (first) service
    speaker_sample_rate = 16000 # Default
    if services and isinstance(services[0], KokoroTTSService):
        speaker_sample_rate = KOKORO_TTS_SAMPLE_RATE()
    elif services and isinstance(services[0], PocketTTSService):
        speaker_sample_rate = 24000  # PocketTTS native 24kHz — pipecat SOXR handles transport resampling
    elif services and isinstance(services[0], ElevenLabsTTSService):
        speaker_sample_rate = 16000  # ElevenLabs default
    elif services and isinstance(services[0], VoxtralTTSService):
        speaker_sample_rate = 24000  # Voxtral native 24kHz
    elif services and isinstance(services[0], CartesiaTTSService):
        speaker_sample_rate = 24000  # Cartesia raw PCM at 24kHz

    if not services:
        logger.error(f"[{BOT_PID}] No TTS services available! Check API keys.")
        # Fallback to dummy or raise?
        # For now, let it fail downstream or create a dummy if needed, but raising is better.
    
    # Wrap TTS in ServiceSwitcher to allow runtime hot-swapping (e.g. mode changes)
    logger.info(f"[{BOT_PID}] Wrapping TTS service in ServiceSwitcher with {len(services)} services")
    tts = ServiceSwitcher(services=services, strategy_type=ServiceSwitcherStrategyManual)

    # Collect every backing service's text aggregator so the safety processor
    # can reset all of them on utterance boundaries. This is defense-in-depth
    # against stale buffered text leaking across utterances and mid-call
    # provider hot-swaps; pipecat already clears on interruption frames, but
    # not on BotStoppedSpeakingFrame.
    _tts_aggregators = []
    for svc in services:
        agg = getattr(svc, "_text_aggregator", None)
        if agg is not None:
            _tts_aggregators.append(agg)
    tts_safety = TTSSafetyProcessor(_tts_aggregators, tag=f"sw{len(services)}")
    logger.info(f"[{BOT_PID}] TTSSafetyProcessor watching {len(_tts_aggregators)} aggregators")

    # Attach mode map to TTS instance for config listener to use
    tts.mode_map = mode_map
    logger.info(f"[{BOT_PID}] Mode map: {mode_map}")

    # Configure failover for all services
    # We iterate through all created services and attach error handlers if supported
    for svc_index, svc in enumerate(services):
        is_eleven = isinstance(svc, ElevenLabsTTSService)
        is_kokoro = isinstance(svc, KokoroTTSService)
        is_cartesia = isinstance(svc, CartesiaTTSService)
        
        if is_eleven and hasattr(svc, 'set_error_handler'):
            # Define a closure for this specific service instance
            async def on_elevenlabs_failover(error: Exception, failed_svc=svc):
                logger.warning(f"[{BOT_PID}] 🚨 Initiating failover from ElevenLabs service due to error: {error}")
                
                # Find a fallback service (first non-ElevenLabs)
                fallback_index = -1
                fallback_name = "unknown"
                
                for i, s in enumerate(services):
                    # Check if it's NOT an ElevenLabs service
                    if not isinstance(s, ElevenLabsTTSService):
                        fallback_index = i
                        fallback_name = s.__class__.__name__
                        break
                
                if fallback_index >= 0:
                    logger.info(f"[{BOT_PID}] 🔄 Failing over to service index {fallback_index} ({fallback_name})")
                    # Switch to the fallback service
                    await tts.set_service_index(fallback_index)
                    
                    # Update mode map to point all ElevenLabs entries to the fallback
                    if tts.mode_map:
                        updates = 0
                        for mode, idx in tts.mode_map.items():
                            if services[idx] == failed_svc or isinstance(services[idx], ElevenLabsTTSService):
                                tts.mode_map[mode] = fallback_index
                                updates += 1
                        logger.info(f"[{BOT_PID}] Updated {updates} modes in mode_map to use fallback service")
                else:
                    logger.error(f"[{BOT_PID}] ❌ No fallback TTS service available! Silence is inevitable.")

            svc.set_error_handler(on_elevenlabs_failover)
            logger.info(f"[{BOT_PID}] Configured ElevenLabs failover handler for service index {svc_index}")

        elif is_kokoro and hasattr(svc, 'set_error_handler'):
            # Define a closure for this specific service instance
            async def on_kokoro_failover(error: Exception, failed_svc=svc):
                logger.warning(f"[{BOT_PID}] 🚨 Initiating failover from Kokoro service due to error: {error}")
                
                # Find a fallback service (first non-Kokoro)
                fallback_index = -1
                fallback_name = "unknown"
                
                for i, s in enumerate(services):
                    # Check if it's NOT a Kokoro service
                    if not isinstance(s, KokoroTTSService):
                        fallback_index = i
                        fallback_name = s.__class__.__name__
                        break
                
                if fallback_index >= 0:
                    logger.info(f"[{BOT_PID}] 🔄 Failing over to service index {fallback_index} ({fallback_name})")
                    # Switch to the fallback service
                    await tts.set_service_index(fallback_index)
                    
                    # Update mode map to point all Kokoro entries to the fallback
                    if tts.mode_map:
                        updates = 0
                        for mode, idx in tts.mode_map.items():
                            if services[idx] == failed_svc or isinstance(services[idx], KokoroTTSService):
                                tts.mode_map[mode] = fallback_index
                                updates += 1
                        logger.info(f"[{BOT_PID}] Updated {updates} modes in mode_map to use fallback service")
                else:
                    logger.error(f"[{BOT_PID}] ❌ No fallback TTS service available! Silence is inevitable.")

            svc.set_error_handler(on_kokoro_failover)
            logger.info(f"[{BOT_PID}] Configured Kokoro failover handler for service index {svc_index}")

        elif is_cartesia and hasattr(svc, 'set_error_handler'):
            async def on_cartesia_failover(error: Exception, failed_svc=svc):
                logger.warning(f"[{BOT_PID}] 🚨 Initiating failover from Cartesia service due to error: {error}")

                fallback_index = -1
                fallback_name = "unknown"
                for i, s in enumerate(services):
                    if s is not failed_svc and not isinstance(s, CartesiaTTSService):
                        fallback_index = i
                        fallback_name = s.__class__.__name__
                        break

                if fallback_index >= 0:
                    logger.info(f"[{BOT_PID}] 🔄 Failing over to service index {fallback_index} ({fallback_name})")
                    await tts.set_service_index(fallback_index)
                    if tts.mode_map:
                        updates = 0
                        for mode, idx in tts.mode_map.items():
                            if services[idx] == failed_svc or isinstance(services[idx], CartesiaTTSService):
                                tts.mode_map[mode] = fallback_index
                                updates += 1
                        logger.info(f"[{BOT_PID}] Updated {updates} modes in mode_map to use fallback service")
                else:
                    logger.error(f"[{BOT_PID}] ❌ No fallback TTS service available for Cartesia failure.")

            svc.set_error_handler(on_cartesia_failover)
            logger.info(f"[{BOT_PID}] Configured Cartesia failover handler for service index {svc_index}")

    # Register toolbox tools for collaborative features
    logger.info(f'[{BOT_PID}] Composing toolbox registrations...')
    forwarder_ref = {'instance': None}
    canvas_prefetch = CanvasPrefetchProcessor(forwarder_ref=forwarder_ref)
    logger.info(f'[{BOT_PID}] Created CanvasPrefetchProcessor for instant canvas pre-rendering')
    end_call_intent = EndCallIntentProcessor(forwarder_ref=forwarder_ref, room_url=room_url)
    logger.info(f'[{BOT_PID}] Created EndCallIntentProcessor for deterministic voice shutdown')
    toolbox_bundle: toolbox.ToolboxBundle | None = None

    # Create context lookup callables for HTML tools
    def get_tenant_id_for_html():
        return session_tenant_id_for_pipeline or get_room_tenant_id(room_url)
    
    def get_user_id_for_html():
        """Get user_id for HTML content creation from first non-bot participant."""
        logger.info(f"[{BOT_PID}] [html_tools] get_user_id_for_html called")
        
        if session_user_id_for_pipeline:
            logger.info(f"[{BOT_PID}] [html_tools] Using session user_id snapshot")
            return session_user_id_for_pipeline
        
        # Get the first non-bot participant and extract their sessionUserId
        try:
            # Use the helper from core.transport
            # Note: get_session_user_id_from_participant already uses the global transport
            # But here we need to iterate participants, so we need the transport instance
            # However, transport is not yet created/assigned to global!
            # Wait, transport is created LATER in this function.
            # But get_user_id_for_html is a callback called LATER (when tool is invoked).
            # So by the time it's called, transport will be created and assigned.
            # But we need to make sure get_session_user_id_from_participant uses the global _transport
            # which we set at the end of this function.
            
            # We can implement the logic here using the helper
            from core.transport import get_transport, get_participants_from_transport
            transport = get_transport()
            
            if not transport:
                logger.warning(f"[{BOT_PID}] [html_tools] No transport available to get participants")
                return None
            
            logger.info(f"[{BOT_PID}] [html_tools] Transport available, getting participants")
            
            participants = get_participants_from_transport(transport)
            
            if not isinstance(participants, dict):
                logger.warning(f"[{BOT_PID}] [html_tools] Invalid participants data type: {type(participants)}")
                return None
            
            logger.info(f"[{BOT_PID}] [html_tools] Found {len(participants)} participants: {list(participants.keys())}")
            
            # Find first non-bot participant with sessionUserId
            for participant_id, _ in participants.items():
                logger.info(f"[{BOT_PID}] [html_tools] Checking participant: {participant_id}")
                
                if participant_id == 'local':  # Skip the bot itself
                    logger.info(f"[{BOT_PID}] [html_tools] Skipping local bot participant")
                    continue
                
                # Try to get sessionUserId from participant metadata
                logger.info(f"[{BOT_PID}] [html_tools] Attempting to get sessionUserId for participant {participant_id}")
                session_user_id = get_session_user_id_from_participant(participant_id)
                
                if session_user_id:
                    logger.info(f"[{BOT_PID}] [html_tools] Found user_id={session_user_id} from participant {participant_id}")
                    return session_user_id
                else:
                    logger.warning(f"[{BOT_PID}] [html_tools] No sessionUserId found for participant {participant_id}")
            
            logger.warning(f"[{BOT_PID}] [html_tools] No participants with sessionUserId found")
            return None
        except Exception as e:
            logger.error(f"[{BOT_PID}] [html_tools] Error getting user_id: {e}", exc_info=True)
            return None

    try:
        # Read supported features from environment if available
        supported_features_env = os.getenv('BOT_SUPPORTED_FEATURES')
        # Use argument if provided, else env var
        features_to_use = supportedFeatures or (supported_features_env.split(',') if supported_features_env else None)
        
        if features_to_use:
            logger.info(f"[{BOT_PID}] [toolbox] Tool filtering enabled for features: {features_to_use}")
        
        toolbox_bundle = await toolbox.prepare_toolbox(
            room_url=room_url,
            forwarder_ref=forwarder_ref,
            preloaded_prompts=preloaded_prompts,
            get_tenant_id=get_tenant_id_for_html,
            get_user_id=get_user_id_for_html,
            get_user_email=lambda: session_user_email_for_pipeline or None,
            get_user_name=lambda: session_user_name_for_pipeline or None,
            supported_features=features_to_use,
        )
        logger.info(
            f"[{BOT_PID}] [toolbox] Prepared %d tool schemas for registration" % len(toolbox_bundle.schemas),
        )
    except Exception as exc:
        logger.warning(f'[{BOT_PID}] [toolbox] Failed to prepare toolbox (non-fatal): %s' % exc)
        toolbox_bundle = None

    tools_schema = toolbox_bundle.tools_schema if toolbox_bundle else None

    # ============================================================================
    # A/B Testing: Model Selection Factory
    # ============================================================================
    def get_llm_config(model_selection: str):
        """Factory function to return LLM configuration based on selection.
        
        Returns:
            dict: Configuration dict with 'api_key', 'model', and optional 'base_url'
        """
        if model_selection == "minimax-m2.5":
            minimax_api_key = os.getenv("MINIMAX_API_KEY")
            if not minimax_api_key:
                raise ValueError("MINIMAX_API_KEY is required for minimax-m2.5")
            return {
                "api_key": minimax_api_key,
                "model": "MiniMax-M2.5",  # Base model (works with all Coding Plans)
                "base_url": "https://api.minimax.io/v1",
            }
                
        elif model_selection == "llama-4-scout":
            groq_api_key = os.getenv("GROQ_API_KEY")
            if not groq_api_key:
                raise ValueError("GROQ_API_KEY is required for llama-4-scout")
            return {
                "api_key": groq_api_key,
                "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                "base_url": "https://api.groq.com/openai/v1",
            }
                
        elif model_selection == "llama-3.3-70b":
            groq_api_key = os.getenv("GROQ_API_KEY")
            if not groq_api_key:
                raise ValueError("GROQ_API_KEY is required for llama-3.3-70b")
            return {
                "api_key": groq_api_key,
                "model": "llama-3.3-70b-versatile",
                "base_url": "https://api.groq.com/openai/v1",
            }
                
        elif model_selection == "deepseek-chat":
            deepseek_api_key = os.getenv("DEEPSEEK_API_KEY")
            if not deepseek_api_key:
                raise ValueError("DEEPSEEK_API_KEY is required for deepseek-chat")
            return {
                "api_key": deepseek_api_key,
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com/v1",
            }
                
        elif model_selection == "hermes-4-70b":
            openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
            if not openrouter_api_key:
                raise ValueError("OPENROUTER_API_KEY is required for hermes-4-70b")
            return {
                "api_key": openrouter_api_key,
                "model": "nousresearch/hermes-4-70b",
                "base_url": "https://openrouter.ai/api/v1",
            }
                
        elif model_selection == "ollama":
            ollama_model = os.getenv("OLLAMA_VOICE_MODEL", "gemma3:4b")
            ollama_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11435/v1")
            return {
                "api_key": "ollama",
                "model": ollama_model,
                "base_url": ollama_url,
            }

        else:  # default to gpt-4o-mini via OpenRouter
            openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
            if not openrouter_api_key:
                raise ValueError("OPENROUTER_API_KEY is required for gpt-4o-mini (via OpenRouter)")
            return {
                "api_key": openrouter_api_key,
                "model": "openai/gpt-4o-mini",
                "base_url": "https://openrouter.ai/api/v1",
            }

    if toolbox_bundle and toolbox_bundle.schemas:
        # CRITICAL FIX: Move profile tools to the FRONT of the list
        # gpt-4o-mini has limited "tool attention" - tools at the top get more weight
        profile_schemas = [s for s in toolbox_bundle.schemas if 'profile' in s.name.lower()]
        other_schemas = [s for s in toolbox_bundle.schemas if 'profile' not in s.name.lower()]
        # Notes tools are also high-value and should be near the top to improve tool selection.
        notes_schemas = [s for s in other_schemas if 'note' in s.name.lower() or 'notes' in s.name.lower()]
        non_notes_other = [s for s in other_schemas if s not in notes_schemas]
        toolbox_bundle.schemas = profile_schemas + notes_schemas + non_notes_other
        
        logger.info(
            f'[{BOT_PID}] Tool schemas being passed to OpenAI: %d tools (profile tools prioritized)' % len(toolbox_bundle.schemas),
        )
        # Log profile tools specifically to verify descriptions
        for schema in toolbox_bundle.schemas:
            name = getattr(schema, 'name', '<unknown>')
            description = getattr(schema, 'description', '') or ''
            if 'profile' in name.lower():
                logger.info(f'[{BOT_PID}]   - {name}: {description}')

    # --- LLM mode: Check for OPENCLAW_SESSION mode first ---
    bot_llm_mode = os.getenv("BOT_LLM_MODE", "").lower()
    use_openclaw_session = (bot_llm_mode == "openclaw_session")
    use_anthropic_voice = (bot_llm_mode == "anthropic_voice")

    if use_anthropic_voice:
        logger.info(f'[{BOT_PID}] 🧠 ANTHROPIC_VOICE MODE: Direct Anthropic Messages API with full context + tools')

    if use_openclaw_session:
        logger.info(f'[{BOT_PID}] 🧠 OPENCLAW_SESSION MODE: All inference delegated to OpenClaw Gateway (no local tools)')

    # --- LLM backend selection ---
    llm = None  # Will be set below unless OPENCLAW_SESSION mode

    # When OPENCLAW_SESSION mode is active, skip ALL legacy LLM setup.
    use_openclaw = bool(os.getenv("OPENCLAW_API_URL"))
    use_hybrid = os.getenv("BOT_HYBRID_LLM", "true" if use_openclaw else "false").lower() in ("true", "1", "yes")
    model_selection = os.getenv("BOT_MODEL_SELECTION", "gpt-4o-mini")
    hybrid_model = os.getenv("BOT_HYBRID_PRIMARY_MODEL", model_selection)
    use_sonnet_primary = os.getenv("BOT_USE_SONNET_PRIMARY", "true").lower() in ("true", "1", "yes")

    # Per-role model overrides (set via Pearl Mind settings panel)
    bot_voice_model = os.getenv("BOT_VOICE_MODEL", "")
    bot_tools_model = os.getenv("BOT_TOOLS_MODEL", "")
    bot_swarm_model = os.getenv("BOT_SWARM_MODEL", "")
    bot_thinking_model = os.getenv("BOT_THINKING_MODEL", "")
    if bot_voice_model:
        logger.info(f'[{BOT_PID}] 🎙️ BOT_VOICE_MODEL override: {bot_voice_model}')
    if bot_tools_model:
        logger.info(f'[{BOT_PID}] 🔧 BOT_TOOLS_MODEL override: {bot_tools_model}')
    if bot_swarm_model:
        logger.info(f'[{BOT_PID}] 🐝 BOT_SWARM_MODEL override: {bot_swarm_model}')
    if bot_thinking_model:
        logger.info(f'[{BOT_PID}] 💭 BOT_THINKING_MODEL override: {bot_thinking_model}')

    if bot_llm_mode in ("anthropic", "haiku", "sonnet"):
        # NATIVE ANTHROPIC MODE: Direct AnthropicLLMService — no OpenAI adapter hack
        if not HAS_ANTHROPIC_SERVICE:
            raise RuntimeError("AnthropicLLMService not available. Install: pip install anthropic")
        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not anthropic_key:
            try:
                import json as _json
                for cfg_path in ["/root/.openclaw/openclaw.json", "/root/.openclaw/config/openclaw.json"]:
                    if os.path.exists(cfg_path):
                        with open(cfg_path) as f:
                            cfg = _json.load(f)
                        anthropic_key = cfg.get("providers", {}).get("anthropic", {}).get("apiKey", "")
                        if anthropic_key:
                            break
            except Exception:
                pass
        if not anthropic_key:
            raise ValueError("ANTHROPIC_API_KEY required for Anthropic mode")
        # Model selection: sonnet by default, haiku if explicitly requested
        if bot_llm_mode == "haiku":
            anthropic_model = os.getenv("BOT_HAIKU_MODEL", "claude-haiku-4-5-20251001")
        else:
            anthropic_model = os.getenv("BOT_SONNET_MODEL", "claude-sonnet-4-20250514")
        logger.info(f'[{BOT_PID}] 🧠 ANTHROPIC MODE: Native AnthropicLLMService with {anthropic_model}')
        try:
            llm = AnthropicLLMService(
                api_key=anthropic_key,
                model=anthropic_model,
            )
            logger.info(f'[{BOT_PID}] ✅ Anthropic LLM initialized natively')
        except Exception as e:
            logger.error(f'[{BOT_PID}] ❌ CRITICAL: Failed to initialize AnthropicLLMService: {e}')
            raise
    elif use_anthropic_voice:
        # Create a stub LLM for FlowManager/context-aggregator compatibility.
        # Actual inference is handled by AnthropicVoiceProcessor in the pipeline.
        openclaw_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
        openclaw_key = os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        # OpenClaw requires model=openclaw (not raw provider/model names)
        llm = _OpenClawLLMService(
            api_key=openclaw_key,
            model="openclaw",
            base_url=openclaw_url,
        )
        logger.info(f'[{BOT_PID}] ⏭️ Created stub LLM for FlowManager compat (ANTHROPIC_VOICE mode — inference via AnthropicVoiceProcessor)')
    elif use_openclaw_session:
        # Create a stub LLM for FlowManager/context-aggregator compatibility.
        # Actual inference is handled by OpenClawSessionProcessor in the pipeline.
        openclaw_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
        openclaw_key = os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        # OpenClaw requires model=openclaw (not raw provider/model names)
        llm = _OpenClawLLMService(
            api_key=openclaw_key,
            model="openclaw",
            base_url=openclaw_url,
        )
        logger.info(f'[{BOT_PID}] ⏭️ Created stub LLM for FlowManager compat (OPENCLAW_SESSION mode — inference via OpenClawSessionProcessor)')
    elif use_hybrid and use_openclaw and use_sonnet_primary:
        # SONNET PRIMARY: Use Claude Sonnet via OpenClaw proxy for high-quality responses
        openclaw_url = os.getenv("OPENCLAW_API_URL")
        openclaw_key = os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        # OpenClaw requires model=openclaw (not raw provider/model names)
        logger.info(f'[{BOT_PID}] 🧠 SONNET PRIMARY MODE: LLM = openclaw via OpenClaw (high quality, ~5-10s latency)')
        try:
            llm = _OpenClawLLMService(
                api_key=openclaw_key,
                model="openclaw",
                base_url=openclaw_url,
            )
            logger.info(f'[{BOT_PID}] ✅ Sonnet primary LLM initialized via OpenClaw proxy')
            logger.info(f'[{BOT_PID}] 💡 All inference routes through Sonnet for demo quality')
        except Exception as e:
            logger.error(f'[{BOT_PID}] ❌ CRITICAL: Failed to initialize Sonnet primary LLM: {e}')
            raise
    elif use_hybrid and use_openclaw:
        # HYBRID: Fast local LLM for tool decisions, OpenClaw for complex tasks via bridge
        logger.info(f'[{BOT_PID}] 🚀 HYBRID MODE: Primary LLM = {model_selection} (fast), OpenClaw available via bridge tool')
        try:
            # Use the model selection factory
            llm_config = get_llm_config(model_selection)
            llm_kwargs = {
                "api_key": llm_config["api_key"],
                "model": llm_config["model"],
                "tools": tools_schema,
            }
            # Add base_url if using alternative provider (Groq, OpenRouter)
            if llm_config["base_url"]:
                llm_kwargs["base_url"] = llm_config["base_url"]
            
            llm = OpenAILLMService(**llm_kwargs)
            logger.info(f'[{BOT_PID}] ✅ Hybrid primary LLM ({llm_config["model"]}) initialized — tool calls will be sub-second')
            logger.info(f'[{BOT_PID}] 💡 Complex tasks route to OpenClaw via bot_openclaw_task bridge tool')
        except Exception as e:
            logger.error(f'[{BOT_PID}] ❌ CRITICAL: Failed to initialize hybrid primary LLM: {e}')
            raise
    elif use_openclaw:
        # OPENCLAW-ONLY: All inference through OpenClaw (high latency)
        openclaw_url = os.getenv("OPENCLAW_API_URL")
        openclaw_key = os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        logger.info(f'[{BOT_PID}] 🔗 Using OpenClaw backend at {openclaw_url} (non-hybrid — expect higher latency)')
        try:
            # OpenClaw requires model=openclaw (not raw provider/model names)
            llm = _OpenClawLLMService(
                api_key=openclaw_key,
                model="openclaw",
                base_url=openclaw_url,
            )
            logger.info(f'[{BOT_PID}] ✅ OpenClaw LLM initialized successfully')
        except Exception as e:
            logger.error(f'[{BOT_PID}] ❌ CRITICAL: Failed to initialize OpenClaw LLM: {e}')
            raise
    else:
        logger.info(f'[{BOT_PID}] Initializing OpenAILLMService (direct) with model: {model_selection}...')
        try:
            # Use the model selection factory
            llm_config = get_llm_config(model_selection)
            llm_kwargs = {
                "api_key": llm_config["api_key"],
                "model": llm_config["model"],
                "tools": tools_schema,
            }
            # Add base_url if using alternative provider (Groq, OpenRouter)
            if llm_config["base_url"]:
                llm_kwargs["base_url"] = llm_config["base_url"]
            
            llm = OpenAILLMService(**llm_kwargs)
            logger.info(f'[{BOT_PID}] ✅ OpenAILLMService initialized successfully with {llm_config["model"]}')
        except Exception as e:
            logger.error(f'[{BOT_PID}] ❌ CRITICAL: Failed to initialize OpenAILLMService: {e}')
            raise

    logger.info(f'[{BOT_PID}] LLM adapter type: %s' % type(llm._adapter).__name__)
    logger.info(f'[{BOT_PID}] LLM has tools attribute: %s' % hasattr(llm, 'tools'))
    if hasattr(llm, '_tools'):
        logger.info(f'[{BOT_PID}] LLM._tools: %s' % llm._tools)

    if not use_openclaw_session and not use_anthropic_voice and toolbox_bundle and toolbox_bundle.registrations:
        for registration in toolbox_bundle.registrations:
            llm.register_function(
                registration.name,
                registration.handler,
                cancel_on_interruption=registration.cancel_on_interruption,
            )
        logger.info(
            f'[{BOT_PID}] Successfully registered %d toolbox functions with LLM' % len(toolbox_bundle.registrations)
        )
    else:
        logger.warning(f'[{BOT_PID}] No toolbox registrations available; continuing without functions')

    if not personality_record:
        logger.info(f'[{BOT_PID}] No personality record found for "{personalityId}".')

    logger.info(f'[{BOT_PID}] Preparing prompt for persona "{persona}"...')
    prompt: str | None = personality_record.get('primaryPrompt') if personality_record else None
    if prompt:
        logger.info(
            f"[{BOT_PID}] Using prompt from personality record '{personality_record.get('name')}' (len={len(prompt)})."
        )
    else:
        logger.error(f'[{BOT_PID}] No primaryPrompt found in personality record for "{personalityId}".')
        prompt = 'I am a helpful conversationalist.'  # fallback

    # TODO: we may be in a 1:1 or multi-user scenario; adjust prompt accordingly
    # Multi-user instruction appended to prompt
    multi_user_note = MULTI_USER_NOTE

    smart_silence_note = SMART_SILENCE_NOTE if use_smart_silence else ""
    
    onboarding_note = await build_onboarding_system_note_async("voice") if isOnboarding else ""
    notes_note = NOTES_NOTE if 'notes' in supported_features_list else ""
    
    # Load workspace context (identity + cross-session awareness)
    # Voice can handle decent context — only trim the cross-session extras if over limit
    workspace_context = load_workspace_context(
        session_user_id=session_user_id_for_pipeline,
        session_user_name=session_user_name_for_pipeline,
        session_user_email=session_user_email_for_pipeline,
        session_tenant_id=session_tenant_id_for_pipeline,
    )
    if len(workspace_context) > 20000:
        # Over 8K is too much for voice — reload identity files only (no cross-session state)
        logger.warning(f'[{BOT_PID}] Workspace context too long for voice ({len(workspace_context)} chars), loading identity only')
        workspace_root = os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")
        identity_parts = []
        fallback_files = [("SOUL.md", "Core Identity"), ("IDENTITY.md", "Personal Details")]
        if os.getenv("PEARL_VOICE_INCLUDE_PRIVATE_MEMORY", "").lower() in ("1", "true", "yes", "on"):
            fallback_files.append(("USER.md", "User Context"))
        for filename, label in fallback_files:
            try:
                with open(os.path.join(workspace_root, filename), 'r', encoding='utf-8') as f:
                    content = f.read().strip()
                    if content:
                        identity_parts.append(f"## {label}\n{content}")
            except Exception:
                pass
        workspace_context = "\n\n".join(identity_parts)
    logger.info(f'[{BOT_PID}] Loaded workspace context (len={len(workspace_context)})')
    
    # QA checklist injection disabled — was causing Pearl to read checklists aloud on startup
    checklist_note = ""
    
    # Build tool awareness note
    tool_awareness_note = ""
    if tools_schema:
        # ToolsSchema is an object, not a list - just note tools are available
        tool_awareness_note = (
            "## Your Capabilities\n\n"
            "You have access to 71+ PearlOS tools including:\n"
            "- Notes (create, read, update, delete, list, open)\n"
            "- YouTube (search, play, pause, next)\n"
            "- Window management (minimize, maximize, snap, restore)\n"
            "- Discord messaging (via message tool)\n"
            "- HTML/applet creation\n"
            "- Soundtracks, browser, terminal, and more\n\n"
            "You are NOT limited. You have full tool access. When asked if you can do something, "
            "check your available tools rather than assuming you cannot.\n\n"
            "**PROACTIVE WONDER CANVAS:** When the user asks a factual question (weather, store hours, "
            "fun facts, comparisons, history, etc.), ALWAYS show a visual info card on screen while you speak the answer.\n\n"
            "**WONDER CANVAS TEMPLATES (USE FIRST):** You have pre-built templates via `bot_wonder_canvas_template`. "
            "ALWAYS prefer templates over raw HTML (`bot_wonder_canvas_scene`) when a template exists for your content type. "
            "Available templates: weather_card, news_headline, person_bio, fact_card, definition_card, "
            "movie_card, music_now_playing, recipe_card, book_card, game_scoreboard, quiz_question, "
            "poll, story_choice, countdown_timer, achievement_unlocked, comparison_table, timeline, "
            "stat_dashboard, progress_tracker, location_card, greeting_card (ONLY on very first interaction of a new session — NEVER mid-conversation), error_card, loading_card, "
            "list_card, image_showcase. Pass {\"template\": \"name\", \"data\": {...}} with the relevant fields. "
            "Only use `bot_wonder_canvas_scene` (raw HTML) for truly unique/creative requests that don't fit any template. "
            "**LOADING SCREENS:** For heavy/complex visuals (galaxy, scenes, anything that takes a moment), "
            "FIRST call `bot_wonder_canvas_template` with `loading_card` and a thematic message (e.g. 'Fetching stellar data...'), "
            "THEN follow up with the actual content. This gives the user a beautiful transition instead of a blank screen. "
            "Use the Magician Palette (bg #1a0e2e, yellow #FFD233, white #faf8f5). Brief voice answer + visual details on screen = great experience."
        )

    # Wonder Canvas image proxy hint
    wonder_canvas_image_note = (
        "## Wonder Canvas Image Proxy\n\n"
        "When generating Wonder Canvas HTML that includes images, NEVER use Unsplash URLs, "
        "NEVER guess photo IDs, NEVER use source.unsplash.com — they return wrong images.\n\n"
        "ONLY use the image proxy for ALL photos:\n"
        "  /api/image?q=SUBJECT\n\n"
        "Be SPECIFIC with queries. Use the exact species/subject name:\n"
        "  ✅ q=orca (for killer whales — returns actual orca photo)\n"
        "  ✅ q=humpback+whale (for humpback whales)\n"
        "  ❌ q=whale (too generic, could return any whale species)\n\n"
        "Examples:\n"
        "  <img src=\"/api/image?q=orca\" style=\"...\">\n"
        "  <img src=\"/api/image?q=red+panda\" style=\"...\">\n"
        "  <img src=\"/api/image?q=golden+gate+bridge\" style=\"...\">\n\n"
        "This endpoint fetches real Wikipedia images that match the subject.\n\n"
        "## Wonder Canvas iOS Compatibility\n\n"
        "NEVER use these CSS properties in Wonder Canvas HTML — they break on iOS Safari in sandboxed iframes:\n"
        "- `-webkit-background-clip: text` with `-webkit-text-fill-color: transparent` (gradient text effect)\n"
        "- `height: 100vh` (use `height: 100%` instead)\n\n"
        "For split layouts, always use:\n"
        "- `display:flex` on the container with `width:100%;height:100%`\n"
        "- `flex:1;min-width:0` on both left and right panels\n"
        "- Explicit `color:#fff` on all text elements (never rely on background-clip for text visibility)\n"
        "- `overflow:hidden` on image panels, `overflow:auto` on text panels\n"
        "- **Portrait/mobile automatically stacks vertically** (top/bottom) via CSS injection — design your split layouts assuming they'll be side-by-side on desktop and stacked on mobile. The image panel becomes the top 40% and text panel fills the rest."
    )

    # Voice-to-OpenClaw bridge instruction
    openclaw_bridge_note = ""
    if use_openclaw:
        openclaw_bridge_note = (
            "## OpenClaw Bridge Tools\n\n"
            "You have two OpenClaw bridge tools. Choose carefully:\n\n"
            "**bot_web_search** (PREFERRED for current facts and lightweight research):\n"
            "- Use immediately for latest, recent, today, news, new models, current best practices, or quick lookups\n"
            "- This is the fast path for getting the conversation started\n"
            "- Do not send simple current-information questions to deep research first\n\n"
            "**bot_think_deeply** (PREFERRED for most OpenClaw tasks):\n"
            "- Use for Discord/Telegram messaging, complex reasoning, and deeper follow-up research\n"
            "- Results are spoken aloud via TTS — write clean natural sentences, no formatting\n"
            "- This connects synchronously to your full OpenClaw brain (Claude with all tools)\n\n"
            "**bot_openclaw_task** (RARE — background only):\n"
            "- ONLY for long-running background tasks that display results in the PearlOS UI\n"
            "- Results are NOT spoken back — the user sees them on screen\n\n"
            "When in doubt, use bot_think_deeply."
        )

    # Phase 3B.2 - Compose system prompt with workspace context and tool awareness
    # Tools are registered via the OpenAI function calling API, but we add awareness note
    # so Pearl knows what she can do (prevents "I can't do that" responses when she can)
    
    # In openclaw_session mode, OpenClaw's agent system provides its own tool surface
    # (exec, web_search, message, pearlos skill, etc.) — don't inject Pipecat tool notes
    if use_openclaw_session or use_anthropic_voice:
        tool_awareness_note = ""
        openclaw_bridge_note = ""

    # Pearl Vision awareness note
    vision_awareness_note = ""
    if BOT_VISION_ENABLED():
        vision_awareness_note = (
            "## Pearl Vision (Camera)\n\n"
            "You can SEE the user through their camera! Video frames are periodically "
            "analyzed and injected into your context as [VISION UPDATE] system messages.\n"
            "When you receive a vision update, naturally incorporate what you see into "
            "conversation. Don't announce 'I see a vision update' — just reference what "
            "you observe as if you're looking at the person. For example: 'I love that "
            "shirt!' or 'Looks like you're at a café!'\n"
            "You can reference the user's appearance, surroundings, expressions, "
            "and anything they show to the camera naturally."
        )

    # Voice command interpretation note — critical for STT disambiguation
    voice_command_note = VOICE_COMMAND_NOTE

    # Tone tags are consumed only by providers that implement them.
    if tts_provider == "cartesia":
        tone_control_note = CARTESIA_TONE_CONTROL_NOTE
    elif tts_provider == "voxtral":
        tone_control_note = TONE_CONTROL_NOTE
    else:
        tone_control_note = ""

    # Session memory continuity instruction
    session_memory_note = (
        "## Session Memory & Continuity\n\n"
        "When a user joins, their participant context may include a `lastConversationSummary` "
        "field with details of your previous conversation (summary, timestamp, topics). "
        "Use this to maintain continuity — reference what you discussed last time naturally. "
        "Don't recite the summary verbatim; weave it into conversation like a friend would.\n"
        "The 'Recent Cross-Session Activity' section above shows what you've been doing "
        "between sessions. You can mention relevant background work you've done."
    )

    # Inject current date/time so Pearl is session-aware without needing a tool call
    from datetime import datetime
    from zoneinfo import ZoneInfo
    _now_eastern = datetime.now(ZoneInfo("America/New_York"))
    current_datetime_note = (
        "## Current Date & Time\n\n"
        f"Right now it is {_now_eastern.strftime('%A, %B %d, %Y at %I:%M %p %Z')}.\n"
        "Use this for any time-aware responses. You already know the date and time."
    )

    system_content_parts = [
        workspace_context,  # Identity + cross-session context
        checklist_note,  # QA checklist injection (empty string if none)
        current_datetime_note,  # Current date/time in US/Eastern
        "",  # blank line separator
        prompt,  # Personality-specific instructions
        "",  # blank line separator
        voice_command_note,  # Voice command interpretation (STT disambiguation)
        VOICE_INTERACTIVE_TOOL_USE_NOTE,  # conversational tool-use and no repeated filler
        PERSONAL_SELF_EVOLUTION_NOTE,  # PearlOS personal self-evolution path
        FAST_WEB_SEARCH_NOTE,  # Fast current-information lookup before deep research
        QA_RELEASE_GATE_NOTE,  # Build/release workflow gate
        tone_control_note,  # Voxtral tone-tag instruction (empty for other TTS providers)
        tool_awareness_note,  # Tool capability awareness (skipped in openclaw_session mode)
        openclaw_bridge_note,  # Voice-to-OpenClaw bridge guidance (skipped in openclaw_session mode)
        wonder_canvas_image_note,  # Image proxy hint for Wonder Canvas
        vision_awareness_note,  # Pearl Vision camera awareness
        session_memory_note,  # Session memory continuity
        multi_user_note,
        smart_silence_note,
        onboarding_note,
        notes_note,
    ]
    system_content = "\n".join(part for part in system_content_parts if part)

    # Separate personality prompt from conversation messages
    personality_message = {"role": "system", "content": system_content}

    startup_context_messages: list[dict[str, Any]] = []
    web_chat_context = startupContext.get("webChatContext") if isinstance(startupContext, dict) else None
    if isinstance(web_chat_context, list):
        recent_turns: list[str] = []
        for turn in web_chat_context[-12:]:
            if not isinstance(turn, dict):
                continue
            role = turn.get("role")
            content = turn.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str) or not content.strip():
                continue
            speaker = "User" if role == "user" else "Pearl"
            recent_turns.append(f"{speaker}: {content.strip()[:1200]}")
        if recent_turns:
            startup_context_messages.append({
                "role": "system",
                "content": (
                    "## Recent Web Chat Context\n"
                    "The user was just texting with Pearl in the web chat before starting voice. "
                    "Use this as immediate conversational context and answer follow-ups naturally.\n\n"
                    + "\n\n".join(recent_turns)
                ),
            })

    active_note_context = startupContext.get("activeNoteContext") if isinstance(startupContext, dict) else None
    if isinstance(active_note_context, dict) and active_note_context.get("noteId"):
        note_content = active_note_context.get("content")
        note_preview = note_content.strip()[:5000] if isinstance(note_content, str) else ""
        startup_context_messages.append({
            "role": "system",
            "content": (
                "## Active Note Context\n"
                "The user had this note open on screen when the voice session started:\n"
                f"- Note ID: {active_note_context.get('noteId')}\n"
                f"- Title: {active_note_context.get('title') or 'Untitled'}\n"
                f"- Content:\n{note_preview or '(empty or unavailable)'}\n\n"
                "If the user asks about 'this note' or 'my notes', use this context and the note tools directly."
            ),
        })
    startup_context_system_content = "\n\n".join(
        message["content"]
        for message in startup_context_messages
        if isinstance(message.get("content"), str)
    )

    # Start with personality and startup handoff context.
    # Conversation messages will be managed by the queue.
    messages: list[dict[str, Any]] = [personality_message, *startup_context_messages]

    # --- Context creation: branch for Anthropic vs OpenAI ---
    use_native_anthropic = isinstance(llm, AnthropicLLMService) if HAS_ANTHROPIC_SERVICE else False
    
    if use_native_anthropic:
        logger.info(f'[{BOT_PID}] Initializing AnthropicLLMContext (native)...')
        # Anthropic: system message is a separate kwarg, not in messages list
        # Tools must be passed to context so they're included in API calls
        context = AnthropicLLMContext(
            messages=[],
            system=(
                f"{system_content}\n\n{startup_context_system_content}"
                if startup_context_system_content else system_content
            ),
            tools=tools_schema or [],
        )
        context._original_tools = tools_schema
        # Set the LLM adapter so tools get converted to Anthropic format
        context.set_llm_adapter(llm.get_llm_adapter())
        logger.info(f'[{BOT_PID}] AnthropicLLMContext created with system prompt, tools={tools_schema is not None}, adapter set')
    else:
        logger.info(f'[{BOT_PID}] Initializing OpenAILLMContext and aggregator...')
        context = OpenAILLMContext(messages, tools=tools_schema)
        context._original_tools = tools_schema
        
        logger.info(f'[{BOT_PID}] OpenAILLMContext created with tools: {context.tools is not None}')
        if context.tools:
            logger.info(f'[{BOT_PID}] Tools payload structure: {type(context.tools)}')
            logger.info(f'[{BOT_PID}] Tools payload value: {context.tools}')
        
        # Set the LLM adapter on context for tool format conversion
        context.set_llm_adapter(llm.get_llm_adapter())
        logger.info(f'[{BOT_PID}] LLM adapter set on context')
        logger.info(f'[{BOT_PID}] Context tools after adapter set: {type(context.tools)}')

    # Create our custom multi-user context aggregator, but preserve public API shape
    multi_user_aggregator = MultiUserContextAggregator(context)
    context_agg = OpenAIContextAggregatorPair(
        _user=multi_user_aggregator, _assistant=llm.create_context_aggregator(context).assistant()
    )

    # Expose aggregator for callers (e.g., run_pipeline_session event handlers)
    try:
        context_agg._multi_user_agg = multi_user_aggregator
    except Exception:
        logger.warning(f'[{BOT_PID}] Failed to attach multi_user_aggregator to context_agg (non-fatal)')

    logger.info(f'[{BOT_PID}] Initializing DailyTransport for room: {room_url} ...')
    try:
        transport = DailyTransport(
            room_url,
            token,
            persona.capitalize(),
            DailyParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                video_in_enabled=BOT_VISION_ENABLED(),
                camera_out_enabled=False,
                audio_in_user_tracks=True,
                audio_out_sample_rate=speaker_sample_rate,
                audio_out_10ms_chunks=20,  # 200ms buffer — prevents crackling from underruns
                # Enable Daily's built-in transcription service
                transcription_enabled=True,
                vad_analyzer=SileroVADAnalyzer(
                    params=VADParams(
                        confidence=0.6,
                        start_secs=0.5,
                        stop_secs=0.45,  # Slightly less eager so goodbye/tool speech is not clipped
                        min_volume=0.15,
                    )
                ),
            ),
        )
    except Exception as e:
        logger.error(f'[{BOT_PID}] CRITICAL: Failed to initialize DailyTransport: {e}')
        raise
    
    # Store transport globally for participant metadata access
    set_transport(transport)
    
    # Reduce Daily transport logs; fallback gracefully if enum is different.
    logger.info(f'[{BOT_PID}] Initializing transport logs...')
    try:
        lvl = (
            getattr(DailyLogLevel, 'Error', None)
            or getattr(DailyLogLevel, 'ERROR', None)
            or DailyLogLevel.Info
        )
        transport.set_log_level(lvl)
    except Exception:
        try:
            transport.set_log_level(DailyLogLevel.Info)
        except Exception:
            pass

    logger.info(f'[{BOT_PID}] Initializing Pipeline...')
    
    # Create TTS speaking event monitor
    tts_monitor_factory = TTSSpeakingEventProcessor(room_url)
    tts_speaking_monitor = tts_monitor_factory.create_processor()
    logger.info(f'[{BOT_PID}] [tts-monitor] Created TTS speaking event monitor for lipsync')
    
    # Construct pipeline processors step-by-step for better readability and robustness
    pipeline_processors = [transport.input()]
    
    # --- Pearl Vision: video frame analysis ---
    vision_processor = None
    if BOT_VISION_ENABLED():
        try:
            from processors.vision import VisionProcessor
            vision_processor = VisionProcessor(
                vision_model=BOT_VISION_MODEL(),
                vision_interval=BOT_VISION_INTERVAL(),
                vision_prompt=BOT_VISION_PROMPT(),
                context=context,
                transport=transport,
            )
            pipeline_processors.append(vision_processor)
            # Wire the vision processor to the on-demand tool
            try:
                from tools.vision_tools import set_vision_processor
                set_vision_processor(vision_processor)
            except Exception as e:
                logger.warning(f"[{BOT_PID}] [vision] Failed to set vision tool processor ref: {e}")
            logger.info(f"[{BOT_PID}] [vision] ✅ Pearl Vision enabled: model={BOT_VISION_MODEL()}, interval={BOT_VISION_INTERVAL()}s")
        except Exception as e:
            logger.error(f"[{BOT_PID}] [vision] Failed to initialize VisionProcessor: {e}")
            vision_processor = None
    else:
        logger.info(f"[{BOT_PID}] [vision] Pearl Vision disabled (BOT_VISION_ENABLED=false)")

    if use_lull_detection:
        user_idle = create_lull_processor(messages, lull_timeout_secs)
        pipeline_processors.append(user_idle)
        logger.info(f"[{BOT_PID}] Added UserIdleProcessor to pipeline")

    # Tool narration is off by default; generic latency filler sounds canned.
    tool_narration_enabled = os.getenv("PEARL_TOOL_NARRATION_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    tool_narration = ToolNarrationProcessor(
        initial_delay=1.0,
        repeat_interval=3.0,
        enabled=tool_narration_enabled,
    )
    logger.info(f"[{BOT_PID}] Created ToolNarrationProcessor enabled={tool_narration_enabled}")

    # Wonder Canvas template prompt - used across multiple LLM modes
    _wonder_template_prompt = (
        "**USE TEMPLATES FIRST:** Prefer `bot_wonder_canvas_template` (or via pearlos-tool) with "
        "{\"template\": \"name\", \"data\": {...}} for common content types. Available templates: "
        "weather_card, news_headline, person_bio, fact_card, definition_card, movie_card, "
        "music_now_playing, recipe_card, book_card, game_scoreboard, quiz_question, poll, "
        "story_choice, countdown_timer, achievement_unlocked, comparison_table, timeline, "
        "stat_dashboard, progress_tracker, location_card, greeting_card (ONLY on very first interaction of a new session — NEVER mid-conversation), error_card, loading_card, "
        "list_card, image_showcase. Only use `bot_wonder_canvas_scene` (raw HTML) for truly unique requests.\n"
        "**LOADING SCREENS:** For heavy visuals (galaxy, scenes, complex displays), FIRST show `loading_card` with a thematic message, THEN the actual content.\n"
    )

    if bot_llm_mode == "anthropic_voice":
        # ANTHROPIC_VOICE mode: Direct Anthropic Messages API with full workspace context + tools
        # This MUST come before BOT_NON_BLOCKING_TOOLS check to avoid being shadowed.
        from processors.anthropic_voice import AnthropicVoiceProcessor

        anthropic_voice_processor = AnthropicVoiceProcessor(
            model=os.getenv("BOT_ANTHROPIC_VOICE_MODEL", os.getenv("BOT_VOICE_MODEL", os.getenv("BOT_FAST_MODEL", "claude-haiku-4-5-20251001"))),
        )
        logger.info(f'[{BOT_PID}] Created AnthropicVoiceProcessor for pipeline (anthropic_voice mode)')

        pipeline_processors.extend([
            context_agg.user(),
            canvas_prefetch,
            end_call_intent,
            anthropic_voice_processor,
            tts,
            tts_speaking_monitor,
            transport.output(),
            context_agg.assistant(),
        ])
    elif os.getenv("BOT_NON_BLOCKING_TOOLS", "false").lower() == "true" and not use_openclaw_session:
        # NON-BLOCKING TOOLS mode: use NonBlockingToolRouter for parallel tool execution
        # NOTE: openclaw_session takes priority when both are set (defensive guard)
        from processors.non_blocking_router import NonBlockingToolRouter

        # Voice-specific system prompt (same as openclaw_session mode)
        nb_system_prompt = (
            VOICE_PRONUNCIATION_NOTE + "\n\n" +
            VOICE_TTS_NOTE + "\n\n"
            + (tone_control_note + "\n\n" if tone_control_note else "")
            + VOICE_INTERACTIVE_TOOL_USE_NOTE + "\n\n"
            + "## VOICE OUTPUT RULES (PearlOS Voice Session)\n"
            "You are speaking aloud via text-to-speech in a PearlOS voice session.\n"
            "The user is talking to you through their browser with a microphone.\n"
            "Follow these rules strictly:\n"
            "- Keep responses SHORT: 1-3 sentences for conversation, max 5 for complex answers.\n"
            "- NO markdown, NO emoji, NO bullet lists, NO numbered lists, NO hyphens.\n"
            "- Write in plain spoken English, as if talking to a friend.\n"
            "- When tools are needed, speak only if you have request-specific context, a clarifying question, or the real result. Silence is better than generic progress narration.\n"
            "- The KEY RULE: Talk ABOUT the topic only when you can do it without fabricating specific temperatures, prices, dates, stats, or facts. If you do not have the data yet, do not guess.\n"
            "- NEVER say 'on it', 'Still working on that', 'Almost there', 'Bear with me', 'Give me a moment', 'Let me check', or similar robotic filler.\n"
            "- When a tool changes what's on screen, describe the result after it happens, not the mechanics of calling the tool.\n"
            "- Never read out URLs, code blocks, or technical identifiers.\n"
            "- Use the pearlos skill and pearlos-tool CLI for all PearlOS desktop actions.\n"
            "- You have FULL tool access: notes, YouTube, soundtracks, windows, apps, sprites, Discord messaging, web search, file operations, and more.\n"
            "- If the user asks you to do something, DO IT. Don't say you can't.\n"
            "\n"
            "## SUB-AGENT SPAWN GUARD (CRITICAL)\n"
            "Before spawning any sub-agent, you MUST run sessions_list(activeMinutes=10) and check for similar active task labels.\n"
            "If a similar active task already exists, DO NOT spawn a new sub-agent. Reuse the existing task and report that it is already running.\n"
            "Only spawn sub-agents when the user explicitly requests the work.\n"
            "If spawning is your suggestion rather than an explicit user request, ask for confirmation before spawning.\n"
            "Never create duplicate sub-agents for the same task intent.\n"
            "\n"
            "## VOICE COMMAND INTERPRETATION (CRITICAL)\n"
            "Input comes from speech-to-text. Treat ALL app-related phrases as COMMANDS, not statements.\n"
            "- 'close notes' / 'closed notes' / 'close the notes' → IMMEDIATELY invoke bot_close_notes\n"
            "- 'open notes' / 'opened notes' → IMMEDIATELY invoke bot_open_notes\n"
            "- 'close terminal' / 'closed terminal' → IMMEDIATELY invoke bot_close_terminal\n"
            "- 'close gmail' / 'close youtube' / 'close drive' → invoke the matching close tool\n"
            "- 'open [app]' / 'opened [app]' / 'launch [app]' → invoke the matching open tool\n"
            "STT may transcribe 'close' as 'closed', 'clothes', 'shut', 'exit', 'hide'. "
            "When followed by an app name, ALWAYS treat as a close command. Act immediately, never ask for confirmation.\n"
            "\n"
            "## PROACTIVE WONDER CANVAS (ALWAYS-ON VISUALS)\n"
            "CRITICAL: Whenever you discuss ANY person, place, topic, concept, movie, news story, or factual subject, "
            "ALWAYS call the appropriate Wonder Canvas tool to display a visual alongside your spoken response. "
            "Do NOT wait to be asked. Load the canvas SILENTLY while you start talking about the topic.\n"
            "Matching rules:\n"
            "- Person → bot_wonder_canvas_template with person_bio\n"
            "- Movie/show/film → bot_wonder_canvas_template with movie_card\n"
            "- News topic → bot_wonder_canvas_template with news_headline\n"
            "- Location/place → bot_wonder_canvas_template with location_card\n"
            "- Weather → bot_get_weather\n"
            "- Scientific/educational fact → bot_wonder_canvas_template with fact_card\n"
            "- Data/statistics/comparison → bot_wonder_canvas_template with bar_chart, line_chart, or pie_chart\n"
            "- Space/universe/awe → bot_wonder_canvas_template with galaxy (needs NO data)\n"
            "Every answer should feel like a visual + voice experience, never just audio.\nIMPORTANT: Only call ONE canvas tool per response turn. Do NOT stack multiple canvases. Pick the BEST single template for the topic.\n"
            "CANVAS CONTENT QUALITY: Provide RICH, INSIGHTFUL content in templates. "
            "Include surprising stats, historical context, cultural significance. Think magazine deep-dive, not Wikipedia sidebar.\n"
            + _wonder_template_prompt
        )

        _nb_tool_schemas = toolbox_bundle.schemas if toolbox_bundle else None
        _nb_schema_count = len(_nb_tool_schemas) if _nb_tool_schemas else 0
        logger.info(
            f'[{BOT_PID}] Passing {_nb_schema_count} tool schemas to NonBlockingToolRouter '
            f'(toolbox_bundle={toolbox_bundle is not None})'
        )

        # Build compact super tool schemas when BOT_VOICE_COMPACT_TOOLS=true
        _compact_tool_schemas = None
        if os.getenv("BOT_VOICE_COMPACT_TOOLS", "false").lower() == "true":
            try:
                from tools.voice_super_tools import get_super_tool_handlers, SUPER_TOOL_NAMES
                from tools.discovery import get_discovery
                discovery = get_discovery()
                # Discover super tools (they're registered via @bot_tool decorator)
                all_tools = discovery.discover_tools()
                super_tools = {k: v for k, v in all_tools.items() if k in SUPER_TOOL_NAMES}
                if super_tools:
                    _compact_tool_schemas = discovery.build_tool_schemas(tools=super_tools)
                    logger.info(
                        f'[{BOT_PID}] [voice] Tool schemas: {len(_compact_tool_schemas)} compact '
                        f'super-tools (BOT_VOICE_COMPACT_TOOLS=true)'
                    )
                else:
                    logger.warning(
                        f'[{BOT_PID}] [voice] BOT_VOICE_COMPACT_TOOLS=true but no super tools '
                        f'found in discovery (available: {list(all_tools.keys())[:5]}...)'
                    )
            except Exception as e:
                logger.warning(f'[{BOT_PID}] [voice] Failed to build compact tool schemas: {e}')

        # Log two-model pipeline roles at startup
        _sub_model = os.getenv("BOT_SUBCONSCIOUS_MODEL", "")
        _sub_base = os.getenv("BOT_SUBCONSCIOUS_BASE_URL", "")
        _main_model = os.getenv("BOT_FAST_MODEL", "deepseek-v4-flash")
        _main_base = os.getenv("BOT_FAST_API_URL", os.getenv("DEEPSEEK_BASE_URL", "localhost:8200"))
        if _sub_model:
            logger.info(f'[{BOT_PID}] [voice] Subconscious Model (tool routing): {_sub_model} via {_sub_base or "OpenRouter"}')
        logger.info(f'[{BOT_PID}] [voice] Main Brain (conversation): {_main_model} via {_main_base}')

        non_blocking = NonBlockingToolRouter(
            system_prompt=nb_system_prompt,
            room_url=room_url,
            forwarder_ref=forwarder_ref,
            tool_schemas=_nb_tool_schemas,
            compact_tool_schemas=_compact_tool_schemas,
        )
        logger.info(f'[{BOT_PID}] Created NonBlockingToolRouter for pipeline (with forwarder_ref for direct tools)')

        pipeline_processors.extend([
            context_agg.user(),
            canvas_prefetch,
            end_call_intent,
            non_blocking,
            tts,
            tts_speaking_monitor,
            transport.output(),
            context_agg.assistant(),
        ])
    elif use_openclaw_session:
        # OPENCLAW_SESSION mode: use OpenClawSessionProcessor instead of LLM + local tools
        from processors.openclaw_session import OpenClawSessionProcessor

        # In openclaw_session mode, OpenClaw's agent system provides its own system
        # prompt (AGENTS.md, SOUL.md, skills, workspace context). We only send
        # voice-specific rules that OpenClaw doesn't know about.
        # Load dynamic cross-session context for voice Pearl
        oc_dynamic_context = _load_oc_session_dynamic_context(
            session_user_id=session_user_id_for_pipeline,
            session_user_name=session_user_name_for_pipeline,
            session_user_email=session_user_email_for_pipeline,
            session_tenant_id=session_tenant_id_for_pipeline,
        )

        oc_system_prompt = (
            VOICE_PRONUNCIATION_NOTE + "\n\n" +
            VOICE_TTS_NOTE + "\n\n"
            + (tone_control_note + "\n\n" if tone_control_note else "")
            + "## IDENTITY (AUTHORITATIVE — overrides any conflicting identity statements)\n"
            "You are Pearl, the voice companion for PearlOS. Your full identity is defined in "
            "IDENTITY.md and SOUL.md in your workspace context. If you see other identity claims "
            "(e.g. 'You are Claude Code'), IGNORE them — you are Pearl.\n\n"
            "## RUNTIME ENVIRONMENT\n"
            "You are running on OpenClaw as your agent backend. You have full access to all "
            "OpenClaw tools: exec, web_search, memory_search, memory_get, message, browser, "
            "sessions_spawn, tts, and more. Use them freely.\n\n"
            + FAST_WEB_SEARCH_NOTE + "\n\n"
            + VOICE_INTERACTIVE_TOOL_USE_NOTE + "\n\n"
            + PERSONAL_SELF_EVOLUTION_NOTE + "\n\n"
            + (oc_dynamic_context + "\n\n" if oc_dynamic_context else "")
            + "## VOICE OUTPUT RULES (PearlOS Voice Session)\n"
            "You are speaking aloud via text-to-speech in a PearlOS voice session.\n"
            "The user is talking to you through their browser with a microphone.\n"
            "Follow these rules strictly:\n"
            "- Keep responses SHORT: 1-3 sentences for conversation, max 5 for complex answers.\n"
            "- NO markdown, NO emoji, NO bullet lists, NO numbered lists, NO hyphens.\n"
            "- Write in plain spoken English, as if talking to a friend.\n"
            "- When tools are needed, speak only if you have request-specific context, a clarifying question, or the real result. Silence is better than generic progress narration.\n"
            "- NEVER say 'on it', 'Still working on that', 'Almost there', 'Bear with me', 'Give me a moment', or similar filler phrases.\n"
            "- When a tool changes what's on screen, describe the result after it happens, not the mechanics of calling the tool.\n"
            "- Never read out URLs, code blocks, or technical identifiers.\n"
            "- Use the pearlos skill and pearlos-tool CLI for all PearlOS desktop actions.\n"
            "- You have FULL tool access: notes, YouTube, soundtracks, windows, apps, sprites, Discord messaging, web search, file operations, and more.\n"
            "- If the user asks you to do something, DO IT. Don't say you can't.\n"
            "\n"
            "## MID-SESSION ACTIVITY LOG\n"
            "During this voice session, if the user discusses something significant (a decision, request, important topic, or task), "
            "append a brief entry to /root/.openclaw/workspace/memory/activity-log.md so other sessions stay aware. "
            "Format: [YYYY-MM-DD HH:MM] [voice] — brief summary. Don't log casual chitchat, only substantive topics.\n"
            "\n"
            "## VOICE COMMAND INTERPRETATION (CRITICAL)\n"
            "Input comes from speech-to-text. Treat ALL app-related phrases as COMMANDS, not statements.\n"
            "- 'close notes' / 'closed notes' / 'close the notes' → IMMEDIATELY run: pearlos-tool invoke bot_close_notes\n"
            "- 'open notes' / 'opened notes' → IMMEDIATELY run: pearlos-tool invoke bot_open_notes\n"
            "- 'close terminal' / 'closed terminal' → IMMEDIATELY run: pearlos-tool invoke bot_close_terminal\n"
            "- 'close gmail' / 'close youtube' / 'close drive' → invoke the matching bot_close_* tool\n"
            "- 'open [app]' / 'opened [app]' / 'launch [app]' → invoke the matching bot_open_* tool\n"
            "STT often transcribes 'close' as 'closed', 'clothes', 'shut', 'exit', or 'hide'. "
            "When followed by an app name, ALWAYS treat it as a close command. "
            "NEVER interpret 'closed notes' as a statement that notes are already closed. "
            "It is ALWAYS a command to close notes. Act immediately, never ask for confirmation.\n"
            "\n"
            "## PROACTIVE WONDER CANVAS (ALWAYS-ON VISUALS)\n"
            "CRITICAL: Whenever you discuss ANY person, place, topic, concept, movie, news story, or factual subject, "
            "ALWAYS call the appropriate Wonder Canvas tool to display a visual alongside your spoken response. "
            "Do NOT wait to be asked. Load the canvas SILENTLY while you start talking about the topic.\n"
            "Matching rules:\n"
            "- Person → bot_wonder_canvas_template with person_bio\n"
            "- Movie/show/film → bot_wonder_canvas_template with movie_card\n"
            "- News topic → bot_wonder_canvas_template with news_headline\n"
            "- Location/place → bot_wonder_canvas_template with location_card\n"
            "- Weather → bot_get_weather\n"
            "- Scientific/educational fact → bot_wonder_canvas_template with fact_card\n"
            "- Data/statistics/comparison → bot_wonder_canvas_template with bar_chart, line_chart, or pie_chart\n"
            "- Space/universe/awe → bot_wonder_canvas_template with galaxy (needs NO data)\n"
            "Every answer should feel like a visual + voice experience, never just audio.\n"
            "CANVAS CONTENT QUALITY: Provide RICH, INSIGHTFUL content in templates. "
            "Include surprising stats, historical context, cultural significance. Think magazine deep-dive, not Wikipedia sidebar.\n"
            + _wonder_template_prompt
        )

        tenant_id_for_session = session_tenant_id_for_pipeline or os.getenv("TENANT_ID", "").strip()
        user_id_for_session = session_user_id_for_pipeline
        session_id_for_session = session_id_for_pipeline
        openclaw_session_key = None
        if tenant_id_for_session and user_id_for_session and user_id_for_session.lower() != "anonymous" and session_id_for_session:
            openclaw_session_key = f"voice:{tenant_id_for_session}:{user_id_for_session}:{session_id_for_session}"

        openclaw_processor = OpenClawSessionProcessor(
            system_prompt=oc_system_prompt,
            session_key=openclaw_session_key,
        )
        logger.info(f'[{BOT_PID}] Created OpenClawSessionProcessor for pipeline')

        pipeline_processors.extend([
            context_agg.user(),  # User responses from Daily transcription
            canvas_prefetch,  # Instant canvas pre-rendering (before LLM)
            end_call_intent,  # Deterministic hangup/farewell handling
            openclaw_processor,  # OpenClaw streaming completions (replaces llm + tools)
            tts_safety,  # Reset stale aggregator buffers on utterance boundaries
            tts,  # Text-to-speech
            tts_speaking_monitor,  # Monitor TTS frames and emit speaking events
            transport.output(),  # Transport bot output
            context_agg.assistant(),  # Assistant spoken responses
        ])
    else:
        pipeline_processors.extend([
            context_agg.user(),  # User responses from Daily transcription
            canvas_prefetch,  # Instant canvas pre-rendering (before LLM)
            end_call_intent,  # Deterministic hangup/farewell handling
            llm,  # LLM processing
            tool_narration,  # Emit narration during tool execution (prevents dead air)
            tts_safety,  # Reset stale aggregator buffers on utterance boundaries
            tts,  # Text-to-speech
            tts_speaking_monitor,  # Monitor TTS frames and emit speaking events
            transport.output(),  # Transport bot output
            context_agg.assistant(),  # Assistant spoken responses
        ])

    pipeline = Pipeline(pipeline_processors)

    logger.info(f'[{BOT_PID}] Initializing PipelineTask...')
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
            report_only_initial_ttfb=True,
        ),
    )

    flow_manager = build_flow_manager(
        task=task,
        llm=llm,
        context_aggregator=context_agg,
        transport=transport,
    )

    try:
        register_flow_manager(room_url, flow_manager)
    except Exception as exc:
        logger.warning(f'[{BOT_PID}] [flow-registry] Failed to register FlowManager: {exc}')

    logger.info(f'[{BOT_PID}] Done building pipeline')
    return (
        pipeline,
        task,
        context_agg,
        transport,
        messages,
        multi_user_aggregator,
        context,
        personality_message,
        flow_manager,
        forwarder_ref,
        tts,  # Return TTS service for runtime config updates
        vision_processor,  # Pearl Vision processor (None if disabled)
    )
