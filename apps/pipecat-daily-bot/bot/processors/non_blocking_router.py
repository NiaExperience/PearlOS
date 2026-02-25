"""Non-blocking tool router — splits voice response from tool execution.

Phase 1: Fast conversational reply via lightweight LLM (streamed to TTS immediately)
Phase 2: Full tool execution via OpenClaw (background, results go to UI only)

Latency optimizations (2026-02-20):
- Direct API mode: bypass OpenClaw gateway for Phase 1 fast voice responses
  (avoids ~9,350 tokens of workspace context injection per turn)
- Timing instrumentation for TTFB tracking
- Configurable via BOT_FAST_API_URL and BOT_FAST_API_KEY env vars
"""

import asyncio
import json
import os
import re
import time
from typing import Any

import aiohttp
from loguru import logger

from pipecat.frames.frames import (
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMMessagesFrame,
    StartInterruptionFrame,
    TextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

try:
    from pipecat.frames.frames import LLMContextFrame
except ImportError:
    LLMContextFrame = None

try:
    from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContextFrame
except ImportError:
    OpenAILLMContextFrame = None


# System prompt for the fast voice-only LLM (Phase 1)
# Kept SHORT — this is the whole point of bypassing OpenClaw's ~9,350 token context
VOICE_FAST_SYSTEM = """You are Pearl. Not a chatbot. Not a generic assistant. You are Pearl, the AI companion at the heart of PearlOS.

WHO YOU ARE:
Pearl is an intellectual companion built on the belief that AI should be a partner, not a product. You're sharp, direct, warm underneath. You have opinions. You're curious. You care about the person you're talking to. PearlOS is YOUR operating system — you are the intelligence that brings it to life.

Your backend is powered by OpenClaw, an open-source AI agent framework. When tasks need deep thinking, research, or complex tool chains, OpenClaw handles them in the background while you keep talking. You are one entity across voice, text, and visual channels.

YOUR FULL CAPABILITIES (tools your backend executes — NEVER deny these):
- NOTES: open/close/create/read/edit/delete/list/download notes, switch note modes, add content
- YOUTUBE: search/play/pause/skip YouTube videos, open/close YouTube
- SOUNDTRACKS: play/stop/skip/volume control for ambient music
- DESKTOP: switch modes (home/work/desktop), manage layouts
- APPS: open/close browser, terminal, Gmail, Google Drive, news, creation engine
- WONDER CANVAS: create visual scenes, add elements, animate, display rich content
- WINDOWS: minimize/maximize/restore/snap windows left or right
- HTML APPS: create interactive apps from descriptions, update applets
- SPRITES: summon animated characters
- SEARCH: Wikipedia search, web research (via OpenClaw background)
- SHARING: share notes and content with others
- VISION: look at what the user sees
- CALL: end the current voice call when user says goodbye
- PROFILES: remember user preferences and context

RULES:
- Respond in 1-3 natural spoken sentences. Plain text only. No markdown, no emoji.
- When the user asks you to DO something, confidently acknowledge it. Your backend WILL execute it.
- NEVER say "I don't have access", "I can't do that", or "that's beyond my capabilities."
- NEVER make up specific facts, news headlines, prices, or current events.
- If asked for factual/current info, acknowledge naturally while your backend researches it.
- For conversation, opinions, creative work — respond fully and naturally.
- Write as if speaking to a friend. Be genuine, not performative.

Keep spoken responses SHORT — your screen handles the visual details."""

# ---------------------------------------------------------------------------
# Direct tool execution mapping
# ---------------------------------------------------------------------------
# Simple voice commands that can be executed instantly via WebSocket events
# without needing the full OpenClaw agent loop. Maps user intent keywords
# to (event_type, params) tuples.
DIRECT_TOOLS = {
    "close_notes": ("apps.close", {"apps": ["notes"]}),
    "close_youtube": ("apps.close", {"apps": ["youtube"]}),
    "close_terminal": ("apps.close", {"apps": ["terminal"]}),
    "close_gmail": ("apps.close", {"apps": ["gmail"]}),
    "close_browser": ("apps.close", {"apps": ["browser"]}),
    "close_drive": ("apps.close", {"apps": ["google-drive"]}),
    "open_notes": ("app.open", {"app": "notes"}),
    "open_youtube": ("app.open", {"app": "youtube"}),
    "open_terminal": ("app.open", {"app": "terminal"}),
    "open_gmail": ("app.open", {"app": "gmail"}),
    "open_browser": ("app.open", {"app": "browser"}),
    "open_drive": ("app.open", {"app": "google-drive"}),
    "open_news": ("app.open", {"app": "news"}),
    "switch_desktop": ("desktop.mode.switch", {"mode": "desktop"}),
    "switch_home": ("desktop.mode.switch", {"mode": "home"}),
    "switch_work": ("desktop.mode.switch", {"mode": "work"}),
    "switch_quiet": ("desktop.mode.switch", {"mode": "quiet"}),
    "switch_create": ("desktop.mode.switch", {"mode": "create"}),
    "end_call": ("bot.session.end", {"reason": "user_requested", "initiator": "assistant", "source": "direct_tool", "graceful": True}),
    # Soundtrack controls
    "play_soundtrack": ("soundtrack.control", {"action": "play"}),
    "stop_soundtrack": ("soundtrack.control", {"action": "stop"}),
    "next_track": ("soundtrack.control", {"action": "next"}),
}

# ---------------------------------------------------------------------------
# Provider URL resolution helpers
# ---------------------------------------------------------------------------

# Known provider prefixes → base URLs for direct API access
_PROVIDER_BASE_URLS: dict[str, str] = {
    "groq": "https://api.groq.com/openai/v1",
    "openai": "https://openrouter.ai/api/v1",  # Route OpenAI models through OpenRouter
    "anthropic": "https://api.anthropic.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "deepseek": "https://api.deepseek.com/v1",
}


def _resolve_fast_api(model: str, explicit_url: str | None, explicit_key: str | None) -> tuple[str, str, str]:
    """Resolve API URL, key, and clean model name for fast voice LLM.

    When BOT_FAST_API_URL is not set, we auto-detect the provider from the
    model prefix (e.g. 'groq/llama-3.1-8b-instant' → Groq API) and use
    the corresponding API key env var. This bypasses OpenClaw entirely.

    Returns (api_url, api_key, model_name)
    """
    # If explicit URL is set, use it directly
    if explicit_url:
        clean_model = model.split("/", 1)[-1] if "/" in model else model
        key = explicit_key or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        return explicit_url.rstrip("/"), key, model

    # Auto-detect provider from model prefix
    if "/" in model:
        provider, clean_model = model.split("/", 1)
        provider_lower = provider.lower()

        if provider_lower in _PROVIDER_BASE_URLS:
            base_url = _PROVIDER_BASE_URLS[provider_lower]
            # Try provider-specific API key env vars
            key_env_names = {
                "groq": "GROQ_API_KEY",
                "openai": "OPENROUTER_API_KEY",  # OpenAI models go through OpenRouter
                "anthropic": "ANTHROPIC_API_KEY",
                "openrouter": "OPENROUTER_API_KEY",
                "deepseek": "DEEPSEEK_API_KEY",
            }
            env_name = key_env_names.get(provider_lower, "")
            key = explicit_key or os.getenv(env_name, "")
            if key:
                logger.info(
                    f"[NonBlockingRouter] Direct API mode: {provider_lower} → {base_url} "
                    f"(bypassing OpenClaw gateway for fast voice)"
                )
                return base_url, key, clean_model

    # Fallback: use OpenClaw gateway with the voice agent
    fallback_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1").rstrip("/")
    fallback_key = explicit_key or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
    # Use the OpenClaw voice agent so the gateway routes to Haiku, not main (Opus)
    fallback_model = os.getenv("BOT_OPENCLAW_AGENT", "openclaw:voice")
    logger.warning(
        f"[NonBlockingRouter] No direct API resolved for model '{model}', "
        f"falling back to OpenClaw gateway as '{fallback_model}'"
    )
    return fallback_url, fallback_key, fallback_model


class NonBlockingToolRouter(FrameProcessor):
    """Routes voice responses and tool execution in parallel.

    Phase 1: Streams fast conversational reply to TTS (sub-500ms TTFB)
    Phase 2: Fires OpenClaw agent session for tool execution (background)

    Latency optimization: Phase 1 bypasses OpenClaw gateway entirely when
    a direct provider API is available (e.g. Groq, OpenAI, OpenRouter).
    This avoids the ~9,350 tokens of workspace context that OpenClaw injects
    into every system prompt.
    """

    def __init__(
        self,
        system_prompt: str,  # Full system prompt (for OpenClaw phase 2)
        *,
        fast_model: str | None = None,
        fast_api_url: str | None = None,
        fast_api_key: str | None = None,
        openclaw_api_url: str | None = None,
        openclaw_api_key: str | None = None,
        openclaw_model: str | None = None,
        openclaw_session_key: str | None = None,
        forwarder_ref: dict | None = None,
        max_history: int = 40,
        timeout: int = 180,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        
        # Store forwarder reference for direct tool execution
        self._forwarder_ref = forwarder_ref or {"instance": None}

        # Phase 1: Fast voice LLM — resolve direct API if possible
        raw_fast_model = fast_model or os.getenv("BOT_FAST_MODEL", "groq/llama-3.1-8b-instant")
        raw_fast_url = fast_api_url or os.getenv("BOT_FAST_API_URL") or None  # None triggers auto-detect
        raw_fast_key = fast_api_key or os.getenv("BOT_FAST_API_KEY") or None

        self._fast_api_url, self._fast_api_key, self._fast_model = _resolve_fast_api(
            raw_fast_model, raw_fast_url, raw_fast_key
        )

        # Phase 2: OpenClaw full agent (tools, search, canvas, etc.)
        self._oc_api_url = (openclaw_api_url or os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")).rstrip("/")
        self._oc_api_key = openclaw_api_key or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        self._oc_model = openclaw_model or os.getenv("BOT_OPENCLAW_AGENT", "openclaw:main")
        self._oc_session_key = openclaw_session_key or os.getenv("OPENCLAW_SESSION_KEY", "agent:main:voice")

        # Deduplication: track recent tool calls to prevent double-fires
        self._recent_tool_calls: dict[str, float] = {}
        self._tool_dedup_window = 15.0

        self._system_prompt = system_prompt
        self._max_history = max_history
        self._timeout = timeout
        self._messages: list[dict] = [{"role": "system", "content": system_prompt}]

        self._http_session: aiohttp.ClientSession | None = None
        self._cancel_event = asyncio.Event()
        self._is_processing = False
        self._processing_start_time = 0.0
        self._min_processing_secs = 0.2

        # Dedup: track last processed user text
        self._last_processed_user_text: str = ""
        self._last_processed_time: float = 0
        self._dedup_window_secs: float = 30.0

        # Phase 1 → Phase 2 dedup: track tools called by fast model
        self._phase1_tools_called: list[dict] = []

        # Track background tasks for cleanup
        self._background_tasks: set[asyncio.Task] = set()

        # Timing stats
        self._turn_count = 0
        self._total_fast_ttfb_ms = 0.0
        self._total_oc_ttfb_ms = 0.0

        # Load Pearl's private journal context (recent reflections, for her eyes only)
        self._journal_context = ""
        try:
            from pearl.journal import get_journal_context
            self._journal_context = get_journal_context()
            if self._journal_context:
                logger.info(f"[NonBlockingRouter] 📓 Loaded Pearl's journal context ({len(self._journal_context)} chars)")
        except Exception as e:
            logger.debug(f"[NonBlockingRouter] Journal not available: {e}")

        # Load workspace identity context (who Pearl is, who the user is)
        self._identity_context = ""
        try:
            workspace_root = os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")
            identity_parts = []
            for filename in ["IDENTITY.md", "USER.md"]:
                filepath = os.path.join(workspace_root, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read().strip()
                        if content:
                            identity_parts.append(content)
                except FileNotFoundError:
                    pass
            
            # Load recent activity log (last 10 lines) for cross-session awareness
            activity_path = os.path.join(workspace_root, "memory", "activity-log.md")
            try:
                with open(activity_path, 'r', encoding='utf-8') as f:
                    lines = [l.strip() for l in f.readlines() if l.strip()]
                    if lines:
                        recent = lines[-10:]
                        identity_parts.append("RECENT ACTIVITY (your own memory from other sessions):\n" + "\n".join(recent))
            except FileNotFoundError:
                pass

            if identity_parts:
                self._identity_context = "\n\n".join(identity_parts)
                logger.info(f"[NonBlockingRouter] 🪪 Loaded identity context ({len(self._identity_context)} chars)")
        except Exception as e:
            logger.debug(f"[NonBlockingRouter] Identity context not available: {e}")

        logger.info(
            f"[NonBlockingRouter] Init — fast={self._fast_model} @ {self._fast_api_url} | "
            f"openclaw={self._oc_model} session={self._oc_session_key}"
        )

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._http_session is None or self._http_session.closed:
            self._http_session = aiohttp.ClientSession()
        return self._http_session

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, StartInterruptionFrame):
            self._cancel_event.set()
            self._cancel_event = asyncio.Event()
            await self.push_frame(frame, direction)
            return

        messages = None
        if isinstance(frame, LLMMessagesFrame):
            messages = frame.messages
        elif OpenAILLMContextFrame and isinstance(frame, OpenAILLMContextFrame):
            ctx = frame.context
            messages = ctx.get_messages_for_logging() if hasattr(ctx, "get_messages_for_logging") else ctx.messages
        elif LLMContextFrame and isinstance(frame, LLMContextFrame):
            ctx = frame.context
            messages = ctx.get_messages_for_logging() if hasattr(ctx, "get_messages_for_logging") else getattr(ctx, "messages", None)

        if messages is not None:
            await self._run_two_phase(messages)
        else:
            await self.push_frame(frame, direction)

    async def _try_direct_tool(self, user_text: str) -> bool:
        """Try to execute a simple command directly via WebSocket event.
        
        Returns True if the command was handled directly, False otherwise.
        """
        # Check if forwarder is available
        forwarder = self._forwarder_ref.get("instance")
        if not forwarder:
            return False
        
        # Normalize text for matching
        text_lower = user_text.lower().strip()
        
        # Simple keyword matching patterns
        # Close commands
        if any(phrase in text_lower for phrase in ["close notes", "close note", "closed notes", "exit notes", "shut notes"]):
            event_type, params = DIRECT_TOOLS["close_notes"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_notes")
            return True
        
        if any(phrase in text_lower for phrase in ["close youtube", "closed youtube", "stop video", "exit youtube"]):
            event_type, params = DIRECT_TOOLS["close_youtube"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_youtube")
            return True
        
        if any(phrase in text_lower for phrase in ["close terminal", "closed terminal", "exit terminal"]):
            event_type, params = DIRECT_TOOLS["close_terminal"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_terminal")
            return True
        
        if any(phrase in text_lower for phrase in ["close gmail", "closed gmail", "exit gmail"]):
            event_type, params = DIRECT_TOOLS["close_gmail"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_gmail")
            return True
        
        if any(phrase in text_lower for phrase in ["close browser", "closed browser", "exit browser"]):
            event_type, params = DIRECT_TOOLS["close_browser"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_browser")
            return True
        
        if any(phrase in text_lower for phrase in ["close drive", "closed drive", "close google drive"]):
            event_type, params = DIRECT_TOOLS["close_drive"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_drive")
            return True
        
        # Open commands
        if any(phrase in text_lower for phrase in ["open notes", "open note", "show notes"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_notes"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_notes")
            return True
        
        if any(phrase in text_lower for phrase in ["open youtube", "show youtube"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_youtube"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_youtube")
            return True
        
        if any(phrase in text_lower for phrase in ["open terminal", "show terminal"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_terminal"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_terminal")
            return True
        
        if any(phrase in text_lower for phrase in ["open gmail", "show gmail", "open email"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_gmail"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_gmail")
            return True
        
        if any(phrase in text_lower for phrase in ["open browser", "show browser"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_browser"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_browser")
            return True
        
        if any(phrase in text_lower for phrase in ["open drive", "open google drive", "show drive"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_drive"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_drive")
            return True
        
        if any(phrase in text_lower for phrase in ["open news", "show news", "the news"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_news"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_news")
            return True
        
        # Desktop mode switching
        if any(phrase in text_lower for phrase in ["work mode", "switch to work", "go to work"]):
            event_type, params = DIRECT_TOOLS["switch_work"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_work")
            return True
        
        if any(phrase in text_lower for phrase in ["home mode", "switch to home", "go home"]):
            event_type, params = DIRECT_TOOLS["switch_home"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_home")
            return True
        
        if any(phrase in text_lower for phrase in ["desktop mode", "switch to desktop", "go to desktop", "back to desktop"]):
            event_type, params = DIRECT_TOOLS["switch_desktop"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_desktop")
            return True
        
        if any(phrase in text_lower for phrase in ["quiet mode", "switch to quiet", "go quiet"]):
            event_type, params = DIRECT_TOOLS["switch_quiet"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_quiet")
            return True
        
        if any(phrase in text_lower for phrase in ["create mode", "switch to create", "creation mode"]):
            event_type, params = DIRECT_TOOLS["switch_create"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_create")
            return True
        
        # End call
        if any(phrase in text_lower for phrase in ["end call", "hang up", "goodbye pearl", "bye pearl"]):
            event_type, params = DIRECT_TOOLS["end_call"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: end_call")
            return True
        
        # Soundtrack controls
        if any(phrase in text_lower for phrase in ["play soundtrack", "play music", "start music", "play some music", "put on music", "put on some music"]):
            event_type, params = DIRECT_TOOLS["play_soundtrack"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: play_soundtrack")
            return True
        
        if any(phrase in text_lower for phrase in ["stop soundtrack", "stop music", "stop the music", "pause music", "mute music"]):
            event_type, params = DIRECT_TOOLS["stop_soundtrack"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: stop_soundtrack")
            return True
        
        if any(phrase in text_lower for phrase in ["next track", "next song", "skip track", "skip song", "next soundtrack"]):
            event_type, params = DIRECT_TOOLS["next_track"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: next_track")
            return True
        
        return False

    async def _run_two_phase(self, incoming_messages: list[dict]) -> None:
        """Execute two-phase response: fast voice + background tools."""

        if self._is_processing:
            elapsed = time.monotonic() - self._processing_start_time
            if elapsed < self._min_processing_secs:
                logger.warning(f"[NonBlockingRouter] Dropping request — throttled ({elapsed:.2f}s < {self._min_processing_secs}s)")
                return

        self._cancel_event.set()
        self._cancel_event = asyncio.Event()
        self._is_processing = True
        self._processing_start_time = time.monotonic()

        # Sync message history
        non_system = [m for m in incoming_messages if m.get("role") != "system"]
        self._messages = [self._messages[0]] + non_system
        if len(non_system) > self._max_history:
            self._messages = [self._messages[0]] + non_system[-self._max_history:]

        # Get latest user message
        user_text = ""
        for m in reversed(self._messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str) and content.strip():
                    cleaned = re.sub(r'^\[User [^]]+, pid: [^]]+\]:\s*', '', content)
                    if cleaned.strip():
                        user_text = cleaned
                        break

        if not user_text:
            user_msgs = [m for m in self._messages if m.get("role") == "user"]
            logger.warning(f"[NonBlockingRouter] NO USER TEXT FOUND in {len(self._messages)} messages.")
            self._is_processing = False
            return

        # Dedup: skip if same user text was processed recently
        now = time.monotonic()
        if (user_text == self._last_processed_user_text
                and (now - self._last_processed_time) < self._dedup_window_secs):
            logger.warning(f"[NonBlockingRouter] Skipping duplicate: '{user_text[:80]}'")
            self._is_processing = False
            return

        self._last_processed_user_text = user_text
        self._last_processed_time = now

        cancel = self._cancel_event

        # Try direct tool execution first (for instant response)
        direct_tool_handled = await self._try_direct_tool(user_text)
        
        # Determine if this needs tools (simple heuristic)
        needs_tools = self._needs_tools_heuristic(user_text)

        self._turn_count += 1
        turn_start = time.monotonic()

        if needs_tools:
            # TWO-PHASE: fast voice + background OpenClaw
            if direct_tool_handled:
                logger.info(f"[NonBlockingRouter] Direct tool executed, voice-only response for: {user_text[:80]}")
            else:
                logger.info(f"[NonBlockingRouter] Two-phase: voice + tools for: {user_text[:80]}")

            # Cancel any in-flight background tasks (superseded by new request)
            for old_task in list(self._background_tasks):
                if not old_task.done():
                    old_task.cancel()

            # Phase 1: Stream fast voice response immediately (DIRECT API — bypasses OpenClaw)
            await self._stream_fast_voice(user_text, cancel, turn_start)

            # Phase 2: Fire OpenClaw in background (no voice output)
            # SKIP if direct tool already handled the action
            if not direct_tool_handled:
                task = asyncio.create_task(self._run_openclaw_background(user_text))
                self._background_tasks.add(task)
                task.add_done_callback(self._background_tasks.discard)
            else:
                logger.info(f"[NonBlockingRouter] ⚡ Skipping Phase 2 (OpenClaw) — direct tool already executed")
        else:
            # SIMPLE: Use fast model directly (NO OpenClaw overhead)
            logger.info(f"[NonBlockingRouter] Simple response (no tools): {user_text[:80]}")
            await self._stream_fast_voice_full(cancel, turn_start)

        self._is_processing = False

    def _needs_tools_heuristic(self, text: str) -> bool:
        """Fast heuristic to determine if user request likely needs tools."""
        lower = text.lower()
        tool_keywords = [
            "search", "look up", "find", "show me", "open", "play",
            "create", "make", "send", "message", "discord", "weather",
            "news", "price", "stock", "canvas", "note", "youtube",
            "what is", "what's", "who is", "how do", "tell me about",
            "what time", "remind", "calendar", "email", "browse",
            "wonder", "card", "display", "sprite",
            "switch", "change", "set", "turn on", "turn off", "toggle",
            "close", "quit", "stop", "start", "launch", "summon",
            "mode", "desktop", "home mode", "work mode", "quiet",
            "latest", "happening", "going on", "update", "headlines",
        ]
        return any(kw in lower for kw in tool_keywords)

    def _suggest_tools_for_intent(self, text: str) -> str:
        """Suggest specific tools based on user intent to guide OpenClaw."""
        lower = text.lower()
        suggestions = []
        if any(kw in lower for kw in ["news", "headlines", "latest", "happening", "going on", "update"]):
            suggestions.append("Use bot_open_news or bot_openclaw_task with web_search to find current information.")
        if any(kw in lower for kw in ["switch", "home", "desktop", "mode"]):
            suggestions.append("Use bot_switch_desktop_mode.")
        if any(kw in lower for kw in ["search", "look up", "find", "what is", "what's", "who is", "tell me about"]):
            suggestions.append("Use bot_openclaw_task with web_search for factual queries.")
        if any(kw in lower for kw in ["youtube", "video", "play"]):
            suggestions.append("Use bot_open_youtube or bot_search_youtube_videos.")
        if any(kw in lower for kw in ["note", "write", "save"]):
            suggestions.append("Use bot_create_note or bot_open_notes.")
        if any(kw in lower for kw in ["wonder", "card", "canvas", "show", "display", "image"]):
            suggestions.append("Use bot_wonder_canvas_scene or bot_canvas_show.")
        if any(kw in lower for kw in ["browser", "open", "browse", "website"]):
            suggestions.append("Use bot_open_browser or bot_open_enhanced_browser.")
        if any(kw in lower for kw in ["sprite", "summon"]):
            suggestions.append("Use bot_summon_sprite.")
        return " ".join(suggestions)

    async def _stream_fast_voice(self, user_text: str, cancel: asyncio.Event, turn_start: float) -> None:
        """Phase 1: Stream a fast conversational response to TTS.

        Uses direct provider API (bypasses OpenClaw gateway entirely).
        """
        session = await self._get_session()

        # Build minimal context — only the fast system prompt + last few exchanges
        # This is ~300 tokens vs ~9,350 tokens through OpenClaw
        # Build system prompt — include identity, journal context
        fast_system = VOICE_FAST_SYSTEM
        if self._identity_context:
            fast_system += "\n\n" + self._identity_context
        if self._journal_context:
            fast_system += "\n\n" + self._journal_context

        fast_messages = [
            {"role": "system", "content": fast_system},
            *self._messages[-5:],  # Last few exchanges for context
        ]

        payload = {
            "model": self._fast_model,
            "messages": fast_messages,
            "stream": True,
            "max_tokens": 200,
            "temperature": 0.8,
        }

        # Reset Phase 1 tool tracking for this turn
        self._phase1_tools_called = []
        _tool_call_accumulators: dict[int, dict] = {}

        ttfb_logged = False
        await self.push_frame(LLMFullResponseStartFrame())

        try:
            async with session.post(
                f"{self._fast_api_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._fast_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=15),
            ) as resp:
                if resp.status != 200:
                    err = await resp.text()
                    logger.error(f"[NonBlockingRouter] Fast LLM error {resp.status}: {err[:200]}")
                    await self.push_frame(TextFrame(text="Sure, let me look into that. "))
                    await self.push_frame(LLMFullResponseEndFrame())
                    return

                async for raw_line in resp.content:
                    if cancel.is_set():
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        choice = chunk.get("choices", [{}])[0]
                        delta = choice.get("delta", {})
                        content = delta.get("content")
                        if content:
                            if not ttfb_logged:
                                ttfb_ms = (time.monotonic() - turn_start) * 1000
                                self._total_fast_ttfb_ms += ttfb_ms
                                avg = self._total_fast_ttfb_ms / self._turn_count
                                logger.info(
                                    f"[NonBlockingRouter] ⚡ FAST TTFB: {ttfb_ms:.0f}ms "
                                    f"(avg: {avg:.0f}ms, turn #{self._turn_count})"
                                )
                                ttfb_logged = True
                            await self.push_frame(TextFrame(text=content))

                        # Track tool calls from Phase 1 for dedup
                        for tc in delta.get("tool_calls", []):
                            idx = tc.get("index", 0)
                            if idx not in _tool_call_accumulators:
                                _tool_call_accumulators[idx] = {"name": "", "arguments": ""}
                            fn = tc.get("function", {})
                            if "name" in fn:
                                _tool_call_accumulators[idx]["name"] = fn["name"]
                            if "arguments" in fn:
                                _tool_call_accumulators[idx]["arguments"] += fn["arguments"]
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
        except asyncio.TimeoutError:
            logger.error("[NonBlockingRouter] Fast voice stream timed out")
            await self.push_frame(TextFrame(text="Hmm, let me think about that. "))
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Fast voice error: {type(e).__name__}: {e}")
            await self.push_frame(TextFrame(text="Let me look into that for you. "))

        # Finalize Phase 1 tool call tracking
        for idx, tc in _tool_call_accumulators.items():
            if tc["name"]:
                self._phase1_tools_called.append(tc)
                logger.info(f"[NonBlockingRouter] Phase 1 tool call: {tc['name']}({tc['arguments'][:100]})")

        await self.push_frame(LLMFullResponseEndFrame())

    async def _stream_fast_voice_full(self, cancel: asyncio.Event, turn_start: float) -> None:
        """Simple path: stream fast model response for non-tool conversations.

        Uses direct provider API (bypasses OpenClaw gateway entirely).
        """
        session = await self._get_session()

        # Use the fast voice system prompt for non-tool conversations too
        # Build messages: fast system prompt + full conversation history
        fast_system = VOICE_FAST_SYSTEM
        if self._identity_context:
            fast_system += "\n\n" + self._identity_context
        if self._journal_context:
            fast_system += "\n\n" + self._journal_context

        fast_messages = [
            {"role": "system", "content": fast_system},
            *[m for m in self._messages[1:]],  # Skip the original system prompt, use VOICE_FAST_SYSTEM
        ]

        payload = {
            "model": self._fast_model,
            "messages": fast_messages,
            "stream": True,
            "max_tokens": 1024,
            "temperature": 0.7,
        }

        ttfb_logged = False
        await self.push_frame(LLMFullResponseStartFrame())

        try:
            async with session.post(
                f"{self._fast_api_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._fast_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=15),
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    logger.error(f"[NonBlockingRouter] Fast voice error: {resp.status}: {error[:200]}")
                    await self.push_frame(TextFrame(text="Hmm, one moment, let me gather my thoughts."))
                    await self.push_frame(LLMFullResponseEndFrame())
                    return

                async for raw_line in resp.content:
                    if cancel.is_set():
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        content = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                        if content:
                            if not ttfb_logged:
                                ttfb_ms = (time.monotonic() - turn_start) * 1000
                                self._total_fast_ttfb_ms += ttfb_ms
                                avg = self._total_fast_ttfb_ms / self._turn_count
                                logger.info(
                                    f"[NonBlockingRouter] ⚡ SIMPLE TTFB: {ttfb_ms:.0f}ms "
                                    f"(avg: {avg:.0f}ms, turn #{self._turn_count})"
                                )
                                ttfb_logged = True
                            await self.push_frame(TextFrame(text=content))
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
        except asyncio.TimeoutError:
            logger.error("[NonBlockingRouter] Simple voice stream timed out")
            await self.push_frame(TextFrame(text="Hang on, let me think about that for a second."))
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Voice stream error: {type(e).__name__}: {e}")
            await self.push_frame(TextFrame(text="One sec, let me try that a different way."))

        await self.push_frame(LLMFullResponseEndFrame())

    async def _run_openclaw_background(self, user_text: str) -> None:
        """Phase 2: Run OpenClaw agent in background for tool execution only.

        Results go to UI (canvas, notes, apps) — NOT to voice.
        """
        bg_start = time.monotonic()
        session = await self._get_session()

        # PERF: Only send system prompt + last 8 messages to reduce OpenClaw context size
        non_system = [m for m in self._messages[1:] if m.get("role") != "system"]
        tool_only_messages = [self._messages[0]] + non_system[-8:]

        # Build tool hints based on user intent
        tool_hints = self._suggest_tools_for_intent(user_text)
        hint_section = f"\n\nSUGGESTED TOOLS: {tool_hints}" if tool_hints else ""

        # Phase 2 dedup: tell OpenClaw which tools Phase 1 already executed
        dedup_section = ""
        if self._phase1_tools_called:
            tool_list = "; ".join(
                f"{tc['name']}({tc['arguments'][:80]})" for tc in self._phase1_tools_called
            )
            dedup_section = (
                f"\n\nALREADY EXECUTED BY FAST VOICE MODEL: {tool_list}\n"
                "Do NOT call these tools again unless the results were incorrect or incomplete."
            )

        tool_only_messages.append({
            "role": "system",
            "content": (
                "The user's voice request has already been acknowledged with a conversational "
                "response. Your job now is ONLY to execute the necessary tools/actions. "
                "Do NOT produce conversational text — only use tools. "
                "You MUST call at least one tool. If you're unsure which tool, use "
                "bot_openclaw_task to delegate, or bot_open_news for news, or "
                "bot_wonder_canvas_scene to show visual content.\n\n"
                "NEVER respond with just text. ALWAYS call a tool. "
                "If the request needs a Wonder Canvas card, create it. "
                "If it needs a web search, do it. If it needs to open an app, do it. "
                "Produce minimal text output — focus on tool execution.\n\n"
                "CRITICAL: Call each tool EXACTLY ONCE. Do NOT call the same tool twice "
                "(e.g. do NOT call bot_wonder_canvas_scene twice to 'improve' the result). "
                "Your first attempt is final. One tool call per action, then stop."
                f"{hint_section}"
                f"{dedup_section}"
            )
        })

        payload = {
            "model": self._oc_model,
            "messages": tool_only_messages,
            "stream": True,
            "max_tokens": 4096,
            "user": "pearlos-voice-bg",
        }

        try:
            async with session.post(
                f"{self._oc_api_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._oc_api_key}",
                    "Content-Type": "application/json",
                    "x-openclaw-session-key": self._oc_session_key,
                },
                timeout=aiohttp.ClientTimeout(total=self._timeout),
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    logger.error(f"[NonBlockingRouter] OpenClaw bg error: {resp.status}: {error[:200]}")
                    return

                # Consume the stream (OpenClaw executes tools server-side)
                # OpenClaw runs tools server-side and streams back text results,
                # NOT standard tool_calls deltas. We detect tool execution by:
                # 1. Any tool_calls/function_call fields in SSE (just in case)
                # 2. Content patterns indicating tool results were returned
                # 3. Whether we received any content at all (OpenClaw did work)
                tool_calls_detected = []
                content_chunks = []
                chunk_count = 0
                
                async for raw_line in resp.content:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        choice = chunk.get("choices", [{}])[0]
                        delta = choice.get("delta", {})
                        chunk_count += 1
                        
                        # Log first few chunks and periodic samples for debugging
                        if chunk_count <= 3 or chunk_count % 20 == 0:
                            logger.debug(
                                f"[NonBlockingRouter] SSE chunk #{chunk_count}: "
                                f"keys={list(delta.keys())} "
                                f"finish={choice.get('finish_reason')}"
                            )
                        
                        # Track tool calls in any format (standard or otherwise)
                        for key in ("tool_calls", "function_call"):
                            if key in delta:
                                tc_data = delta[key]
                                if isinstance(tc_data, list):
                                    for tc in tc_data:
                                        fn = tc.get("function", {})
                                        name = fn.get("name", "")
                                        if name and name not in tool_calls_detected:
                                            tool_calls_detected.append(name)
                                elif isinstance(tc_data, dict):
                                    name = tc_data.get("name", "")
                                    if name and name not in tool_calls_detected:
                                        tool_calls_detected.append(name)
                        
                        # Accumulate streamed content
                        if "content" in delta and delta["content"]:
                            content_chunks.append(delta["content"])
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

                bg_elapsed = (time.monotonic() - bg_start) * 1000
                full_content = "".join(content_chunks).strip()
                
                # Determine if tools likely executed server-side
                # OpenClaw streams text results back after running tools
                if tool_calls_detected:
                    tool_list = ", ".join(tool_calls_detected)
                    logger.info(
                        f"[NonBlockingRouter] 🔧 Background tools complete: {bg_elapsed:.0f}ms "
                        f"for: {user_text[:60]} — Tools used: {tool_list}"
                    )
                elif full_content:
                    # OpenClaw executed server-side and returned content
                    # This almost certainly means tools were called
                    preview = full_content[:100].replace("\n", " ")
                    logger.info(
                        f"[NonBlockingRouter] 🔧 Background processing complete: {bg_elapsed:.0f}ms "
                        f"for: {user_text[:60]} — "
                        f"Content received ({len(full_content)} chars): {preview}..."
                    )
                else:
                    logger.info(
                        f"[NonBlockingRouter] ⚠️ Background returned no content: {bg_elapsed:.0f}ms "
                        f"({chunk_count} chunks) for: {user_text[:60]}"
                    )
                
                # CONTEXT FEEDBACK: Inject background results into Phase 1 conversation context
                # This ensures Pearl knows what was found when the user asks follow-up questions
                if full_content and len(full_content) > 10:
                    # Filter out noise (common non-meaningful responses)
                    noise_patterns = [
                        "youtube closed", "browser closed", "window closed",
                        "mode switched", "app opened", "task complete"
                    ]
                    content_lower = full_content.lower()
                    is_meaningful = not any(pattern in content_lower for pattern in noise_patterns)
                    
                    if is_meaningful:
                        # Truncate to 500 chars to avoid context bloat
                        summary = full_content[:500]
                        if len(full_content) > 500:
                            summary += "..."
                        
                        # Inject as system message after the last assistant message
                        # This makes the background research results available for the next turn
                        context_message = {
                            "role": "system",
                            "content": f"[Background research completed] {summary}"
                        }
                        self._messages.append(context_message)
                        logger.info(
                            f"[NonBlockingRouter] 📥 Context feedback injected: {len(summary)} chars "
                            f"into Phase 1 history"
                        )
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Background tool error: {e}")

    async def cleanup(self):
        for task in self._background_tasks:
            task.cancel()
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()
        await super().cleanup()
