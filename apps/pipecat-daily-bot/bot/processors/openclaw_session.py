"""OpenClawSessionProcessor — Voice Integration Phase 1.

Replaces the standard LLM service in the Pipecat pipeline when running in
``OPENCLAW_SESSION`` mode.  Instead of managing tool schemas and executing
tools locally, this processor delegates *everything* to the OpenClaw Gateway
via its ``/v1/chat/completions`` streaming endpoint.  OpenClaw handles tool
execution server-side (pearlos-tool, web search, message, exec, etc.).

Frame contract (same slot as OpenAILLMService):
    IN  → LLMMessagesFrame | OpenAILLMContextFrame | LLMContextFrame | StartInterruptionFrame
    OUT → LLMFullResponseStartFrame, TextFrame …, LLMFullResponseEndFrame
"""

from __future__ import annotations

import asyncio
import json
import os
import random
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


# ---------------------------------------------------------------------------
# Filler phrase banks — Pearl speaks immediately while thinking
# ---------------------------------------------------------------------------

_INSTANT_FILLERS = [
    "Let me check.",
    "One sec.",
    "On it.",
    "Let me look into that.",
    "Hmm, let me see.",
    "Sure, give me a moment.",
    "Let me find out.",
    "Checking now.",
    "Working on that.",
    "Let me pull that up.",
    "One moment.",
    "Hang on.",
    "Let me think about that.",
    "Sure thing.",
    "Good question, let me check.",
    "Let me get that for you.",
    "Looking into it.",
    "Give me just a second.",
    "Alright, checking.",
    "Let me see what I can find.",
    "Just a moment.",
    "Let me dig into that.",
    "Hold on, checking.",
    "Let me take a look.",
    "Right, let me find that.",
]

_CONTEXTUAL_FILLERS = {
    "weather": ["Let me check the weather.", "Checking the forecast.", "Let me see what it's like out there."],
    "search": ["Let me search for that.", "Searching now.", "Let me look that up."],
    "message": ["Sending that now.", "On it, sending the message.", "Let me send that over."],
    "discord": ["Let me check Discord.", "Checking Discord now."],
    "note": ["Let me open your notes.", "Pulling up your notes.", "Let me grab that."],
    "play": ["Let me find that.", "Searching for that now.", "On it."],
    "time": ["Let me check.", "One sec."],
    "remind": ["Setting that up.", "Got it, setting a reminder."],
    "news": ["Let me check the news.", "Checking what's happening.", "Let me see what's going on."],
    "price": ["Let me look that up.", "Checking the numbers.", "Let me pull those up."],
    "stock": ["Let me check the markets.", "Pulling that up now."],
    "email": ["Let me check your email.", "Checking your inbox."],
    "calendar": ["Let me check your calendar.", "Looking at your schedule."],
    "youtube": ["Let me find that.", "Searching YouTube.", "Let me look for that."],
    "show": ["Let me pull that up.", "On it.", "Working on that."],
    "tell": ["Sure.", "Alright.", "Let me think."],
    "what is": ["Good question.", "Let me look into that.", "Hmm, let me think."],
    "what's": ["Let me check.", "One sec.", "Let me see."],
    "how": ["Let me think about that.", "Good question.", "Let me figure that out."],
    "who": ["Let me look that up.", "Hmm, let me check.", "Let me find out."],
}


def _pick_filler(user_text: str) -> str:
    """Pick a contextual filler phrase based on user message keywords."""
    lower = user_text.lower()
    for keyword, phrases in _CONTEXTUAL_FILLERS.items():
        if keyword in lower:
            return random.choice(phrases)
    return random.choice(_INSTANT_FILLERS)


class OpenClawSessionProcessor(FrameProcessor):
    """Stream chat completions from the OpenClaw Gateway.

    Parameters
    ----------
    system_prompt : str
        The full system prompt (identity + voice rules + workspace context).
    api_url : str | None
        OpenClaw base URL.  Defaults to ``OPENCLAW_API_URL`` env var or
        ``http://localhost:18789/v1``.
    api_key : str | None
        Bearer token.  Defaults to ``OPENCLAW_API_KEY`` env var.
    model : str | None
        Model identifier.  Defaults to ``BOT_SONNET_MODEL`` env var or
        ``anthropic/claude-sonnet-4-20250514``.
    max_tokens : int
        Max tokens per completion.
    timeout : int
        HTTP timeout in seconds.
    """

    def __init__(
        self,
        system_prompt: str,
        *,
        api_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        session_key: str | None = None,
        max_tokens: int = 4096,
        timeout: int = 180,  # Increased for multi-tool agent turns
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._api_url = (
            api_url
            or os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
        ).rstrip("/")
        self._api_key = api_key or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        # Use openclaw:main to explicitly route through the full agent system
        # (tools, skills, exec, memory) rather than relying on the fallback default.
        self._model = model or os.getenv("BOT_OPENCLAW_MODEL", "openclaw:main")
        # Voice gets a dedicated session under the main agent — shares workspace,
        # skills, SOUL.md, MEMORY.md with all other Pearl sessions but doesn't
        # block TUI/Discord with serialized requests.
        self._session_key = session_key or os.getenv(
            "OPENCLAW_SESSION_KEY", "agent:main:voice"
        )
        self._max_tokens = max_tokens
        self._timeout = timeout

        # Conversation history maintained for the session lifetime.
        # Capped to prevent unbounded growth (system + last N turns).
        self._max_history = 40  # ~20 user/assistant pairs
        self._messages: list[dict[str, str]] = [
            {"role": "system", "content": system_prompt},
        ]

        # Meeting mode: when active, Pearl only responds if addressed by name
        self._meeting_mode: bool = False
        self._original_system_prompt: str = system_prompt

        # Reusable HTTP session (lazy-initialized to ensure event loop exists).
        self._http_session: aiohttp.ClientSession | None = None

        # Cancellation flag for in-flight streaming requests.
        self._cancel_event: asyncio.Event = asyncio.Event()

        # Processing guard: prevent self-interruption from bot echo.
        self._is_processing: bool = False
        self._processing_start_time: float = 0.0
        self._last_interruption_time: float = 0.0
        # Minimum seconds into a request before allowing cancellation.
        self._min_processing_secs: float = 2.0
        # Debounce window: ignore rapid-fire interruptions within this window.
        self._interruption_debounce_secs: float = 1.0

        logger.info(
            f"[OpenClawSession] Initialized — model={self._model} "
            f"url={self._api_url} timeout={self._timeout}s"
        )

    # ------------------------------------------------------------------
    # Meeting mode
    # ------------------------------------------------------------------

    _MEETING_SYSTEM_PROMPT = (
        "## MEETING MODE (Active)\n"
        "You are Pearl, a meeting assistant in a group video call.\n"
        "Do NOT speak unless directly addressed by name ('Pearl', 'Hey Pearl').\n"
        "Your role: take notes, summarize discussions, display info on Wonder Canvas when asked.\n"
        "Keep responses brief and professional when you do speak.\n"
        "Never interrupt. Never offer unsolicited commentary.\n"
    )

    _WAKE_PATTERNS = ["pearl", "hey pearl", "pearl,"]

    def set_meeting_mode(self, active: bool) -> None:
        """Toggle meeting mode. When active, Pearl only responds if addressed."""
        self._meeting_mode = active
        # Swap system prompt
        if active:
            self._messages[0] = {"role": "system", "content": self._MEETING_SYSTEM_PROMPT + self._original_system_prompt}
        else:
            self._messages[0] = {"role": "system", "content": self._original_system_prompt}
        logger.info(f"[openclaw_session] Meeting mode {'ENABLED' if active else 'DISABLED'}")

    def _is_addressing_pearl(self, text: str) -> bool:
        """Check if the user is speaking to Pearl by name."""
        lower = text.lower().strip()
        return any(p in lower for p in self._WAKE_PATTERNS)

    # ------------------------------------------------------------------
    # Frame routing
    # ------------------------------------------------------------------

    async def process_frame(
        self, frame: Frame, direction: FrameDirection
    ) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, StartInterruptionFrame):
            await self._handle_interruption(frame, direction)
            return

        # Extract messages from the various context frame types that the
        # upstream context-aggregator might emit.
        messages: list[dict[str, str]] | None = None

        if isinstance(frame, LLMMessagesFrame):
            messages = frame.messages
        elif OpenAILLMContextFrame and isinstance(frame, OpenAILLMContextFrame):
            ctx = frame.context
            messages = (
                ctx.get_messages_for_logging()
                if hasattr(ctx, "get_messages_for_logging")
                else ctx.messages
            )
        elif LLMContextFrame and isinstance(frame, LLMContextFrame):
            ctx = frame.context
            messages = (
                ctx.get_messages_for_logging()
                if hasattr(ctx, "get_messages_for_logging")
                else getattr(ctx, "messages", None)
            )

        if messages is not None:
            await self._run_completion(messages)
        else:
            # Pass through frames we don't handle (audio, control, etc.)
            await self.push_frame(frame, direction)

    # ------------------------------------------------------------------
    # Core streaming completion
    # ------------------------------------------------------------------

    async def _run_completion(self, incoming_messages: list[dict[str, str]]) -> None:
        """Send messages to OpenClaw and stream the response as TextFrames."""

        # Signal any in-flight request to stop — but respect the processing guard.
        if self._is_processing:
            elapsed = time.monotonic() - self._processing_start_time
            if elapsed < self._min_processing_secs:
                logger.info(
                    f"[OpenClawSession] Ignoring new completion request — "
                    f"current request only {elapsed:.1f}s old (min {self._min_processing_secs}s)"
                )
                return
        self._cancel_event.set()
        self._cancel_event = asyncio.Event()
        self._is_processing = True
        self._processing_start_time = time.monotonic()

        # Merge incoming messages into our session history.
        # The context aggregator sends the *full* conversation each time,
        # so we sync: keep our system prompt, then adopt everything after.
        if incoming_messages:
            # Find non-system messages from incoming
            non_system = [m for m in incoming_messages if m.get("role") != "system"]
            # Rebuild: our system prompt + all conversation messages
            self._messages = [self._messages[0]] + non_system

        # Ensure at least one user message (Anthropic requirement).
        if all(m.get("role") == "system" for m in self._messages):
            self._messages.append(
                {"role": "user", "content": "[user has joined the conversation]"}
            )

        # Trim history: keep system prompt + last N non-system messages
        non_system = [m for m in self._messages if m.get("role") != "system"]
        if len(non_system) > self._max_history:
            self._messages = [self._messages[0]] + non_system[-self._max_history:]

        cancel = self._cancel_event

        payload = {
            "model": self._model,
            "messages": self._messages,
            "stream": True,
            "max_tokens": self._max_tokens,
            "user": "pearlos-voice",
        }

        await self.push_frame(LLMFullResponseStartFrame())

        full_response_chunks: list[str] = []

        # -- Instant acknowledgment: speak BEFORE the HTTP request fires --
        user_text = ""
        for m in reversed(self._messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str) and not content.startswith("["):
                    user_text = content
                    break

        # Meeting mode gate: if active, only respond when addressed by name.
        # Still forward transcript to meeting notes endpoint in background.
        if self._meeting_mode and user_text:
            # Always send transcript to meeting notes backend
            try:
                if self._http_session is None or self._http_session.closed:
                    self._http_session = aiohttp.ClientSession()
                gateway_base = os.getenv("BOT_GATEWAY_URL", "http://localhost:7860")
                asyncio.create_task(
                    self._http_session.post(
                        f"{gateway_base}/api/meeting/transcript",
                        json={"speaker": "participant", "text": user_text},
                        timeout=aiohttp.ClientTimeout(total=5),
                    )
                )
            except Exception:
                pass  # best-effort

            if not self._is_addressing_pearl(user_text):
                logger.info(f"[OpenClawSession] Meeting mode: ignoring (not addressed): {user_text[:80]!r}")
                self._is_processing = False
                await self.push_frame(LLMFullResponseEndFrame())
                return

        if user_text:
            filler = _pick_filler(user_text)
            await self.push_frame(TextFrame(text=filler + " "))
            logger.info(f"[OpenClawSession] Instant filler: {filler!r}")

        # No follow-up filler loop — the instant contextual filler above is
        # enough.  The LLM should start streaming its real response quickly;
        # repeated robotic fillers ("Still working on that", "Almost there")
        # degrade the conversational experience.
        filler_task: asyncio.Task | None = None

        try:
            if self._http_session is None or self._http_session.closed:
                self._http_session = aiohttp.ClientSession()
            session = self._http_session
            async with session.post(
                f"{self._api_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                    # Route to main agent session — voice IS the main Pearl,
                    # not a separate session. Shares context with Discord/webchat/TUI.
                    "x-openclaw-session-key": self._session_key,
                },
                timeout=aiohttp.ClientTimeout(total=self._timeout),
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error(
                        f"[OpenClawSession] API error {resp.status}: "
                        f"{error_text[:300]}"
                    )
                    await self.push_frame(
                        TextFrame(
                            text="I'm having trouble thinking right now. "
                            "Let me try again in a moment."
                        )
                    )
                    await self.push_frame(LLMFullResponseEndFrame())
                    return

                async for raw_line in resp.content:
                    if cancel.is_set():
                        logger.info("[OpenClawSession] Cancelled mid-stream (interruption)")
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
                            full_response_chunks.append(content)
                            await self.push_frame(TextFrame(text=content))
                    except (ValueError, IndexError, KeyError):
                        continue

        except asyncio.CancelledError:
            logger.info("[OpenClawSession] Request cancelled (interruption)")
            if filler_task is not None:
                filler_task.cancel()
            raise
        except aiohttp.ClientError as exc:
            logger.error(f"[OpenClawSession] Network error: {exc}")
            await self.push_frame(
                TextFrame(
                    text="I lost my connection for a moment. Could you say that again?"
                )
            )
        except Exception as exc:
            logger.exception(f"[OpenClawSession] Unexpected error: {exc}")
            await self.push_frame(
                TextFrame(text="Something went wrong. Let me try again.")
            )
        finally:
            self._is_processing = False
            if filler_task is not None:
                filler_task.cancel()
            # Record assistant response in history.
            if full_response_chunks:
                self._messages.append(
                    {"role": "assistant", "content": "".join(full_response_chunks)}
                )
            await self.push_frame(LLMFullResponseEndFrame())

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    async def cleanup(self) -> None:
        """Close the shared HTTP session."""
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()
            self._http_session = None
        await super().cleanup()

    # ------------------------------------------------------------------
    # Interruption handling
    # ------------------------------------------------------------------

    async def _handle_interruption(
        self, frame: Frame, direction: FrameDirection
    ) -> None:
        """Signal in-flight request to stop on user interruption.

        Guards against self-interruption (bot echo triggering VAD) and
        rapid-fire interruption spam by enforcing:
          1. A minimum processing time before cancellation is allowed.
          2. A debounce window between successive interruptions.
        """
        now = time.monotonic()

        # Debounce: ignore if an interruption was handled very recently.
        since_last = now - self._last_interruption_time
        if since_last < self._interruption_debounce_secs:
            logger.debug(
                f"[OpenClawSession] Suppressed interruption — debounce "
                f"({since_last:.2f}s < {self._interruption_debounce_secs}s)"
            )
            await self.push_frame(frame, direction)
            return

        # Processing guard: don't cancel a request that just started (likely bot echo).
        if self._is_processing:
            elapsed = now - self._processing_start_time
            if elapsed < self._min_processing_secs:
                logger.info(
                    f"[OpenClawSession] Suppressed interruption — request only "
                    f"{elapsed:.1f}s old (min {self._min_processing_secs}s)"
                )
                await self.push_frame(frame, direction)
                return

        self._last_interruption_time = now
        self._cancel_event.set()
        logger.info("[OpenClawSession] Signalled cancel (user interrupted)")
        await self.push_frame(frame, direction)
