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
    "One sec.",
    "On it.",
    "Hmm.",
    "Hang on.",
    "Checking.",
    "Yeah, one sec.",
    "Sure, hang on.",
    "Got it.",
    "Alright.",
    "Mmhm.",
]

_CONTEXTUAL_FILLERS = {
    "weather": ["Checking outside.", "One sec.", "On it."],
    "search": ["Hmm.", "One sec.", "Oh, interesting."],
    "message": ["On it.", "Sending that.", "Yeah, one sec."],
    "discord": ["Checking Discord.", "One sec."],
    "note": ["Pulling up your notes.", "On it.", "One sec."],
    "play": ["On it.", "Got it.", "One sec."],
    "time": ["One sec.", "Checking."],
    "remind": ["Got it.", "On it."],
    "news": ["Checking.", "One sec.", "On it."],
    "price": ["One sec.", "Checking.", "On it."],
    "stock": ["Checking.", "One sec."],
    "email": ["Checking your inbox.", "One sec."],
    "calendar": ["Checking your schedule.", "One sec."],
    "youtube": ["On it.", "Got it.", "One sec."],
    "show": ["On it.", "One sec.", "Yeah, hang on."],
    "tell": ["Sure.", "Alright.", "Hmm."],
    "what is": ["Hmm.", "One sec.", "Yeah."],
    "what's": ["One sec.", "Hmm.", "Yeah."],
    "how": ["Hmm.", "Oh, that's interesting.", "One sec."],
    "who": ["Hmm.", "One sec.", "Checking."],
}


def _env_float(name: str, default: float, *, minimum: float = 0.0, maximum: float = 2.0) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return max(minimum, min(maximum, float(raw)))
    except ValueError:
        logger.warning(f"[OpenClawSession] Invalid {name}={raw!r}; using {default}")
        return default


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
        Model identifier (or ``openclaw/<agent>`` route). Resolution order:
        explicit arg > ``BOT_OPENCLAW_AGENT`` env > ``BOT_VOICE_MODEL`` env >
        ``openclaw/voice`` (routes to the voice agent, which is configured to
        use ``pearl-llm/deepseek-v4-flash`` server-side).
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
        toolbox_bundle: Any = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        # OpenClaw Gateway base URL (OpenAI-compatible). We POST to
        # ``{api_url}/chat/completions`` and consume SSE-formatted chunks.
        self._api_url = (
            api_url
            or os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
        ).rstrip("/")
        self._api_key = api_key or os.getenv("OPENCLAW_API_KEY", "")
        # Resolve model: explicit ctor arg > BOT_OPENCLAW_AGENT env >
        # BOT_VOICE_MODEL env > default voice agent route. The voice agent's
        # underlying provider model (e.g. pearl-llm/deepseek-v4-flash) is
        # configured server-side in OpenClaw via gateway.defaults.model.primary.
        env_agent = os.getenv("BOT_OPENCLAW_AGENT", "").strip()
        env_voice_model = os.getenv("BOT_VOICE_MODEL", "").strip()
        self._model = model or env_agent or env_voice_model or "openclaw/voice"

        # toolbox_bundle is accepted for call-site compatibility but unused:
        # in OpenClaw routing mode, tools execute server-side inside the agent
        # (the voice agent's TOOLS.md / OpenClaw plugin surface). We never
        # forward tool schemas or execute tool_calls locally.
        if toolbox_bundle is not None:
            try:
                regs = list(getattr(toolbox_bundle, "registrations", []) or [])
                logger.info(
                    f"[OpenClawSession] Ignoring local toolbox_bundle "
                    f"({len(regs)} tools) — OpenClaw executes tools server-side"
                )
            except Exception:
                pass
        # Voice gets a dedicated session under the main agent — shares workspace,
        # skills, SOUL.md, MEMORY.md with all other Pearl sessions but doesn't
        # block TUI/Discord with serialized requests.
        self._session_key = session_key or os.getenv(
            "OPENCLAW_SESSION_KEY", "agent:voice:voice"
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
        self._pending_incoming: list[dict[str, str]] | None = None
        self._last_user_text: str = ""
        self._last_user_time: float = 0.0
        # True once the first content token has been pushed for the current turn.
        # Until the bot is actually speaking, interruptions should be suppressed
        # because there is nothing audible to interrupt.
        self._response_started: bool = False
        # Minimum seconds into a request before allowing cancellation.
        self._min_processing_secs: float = 2.0
        # Debounce window: ignore rapid-fire interruptions within this window.
        self._interruption_debounce_secs: float = 1.5

        # ── User model preference (from UI settings) ──────────────
        # The UI saves model preferences via /api/bot/model-settings which
        # writes to the bot .env file. We also query /api/model-preference
        # at startup to get the full provider/model ID and pass it as a
        # header to OpenClaw so the gateway uses the user's chosen model.
        self._model_override: str | None = None
        self._gateway_url = os.getenv("BOT_GATEWAY_URL", "http://localhost:7860")
        self._internal_secret = os.getenv("INTERNAL_API_SECRET", "pearl-internal")

        logger.info(
            f"[OpenClawSession] Initialized — model={self._model} "
            f"url={self._api_url} timeout={self._timeout}s"
        )

    async def _fetch_model_preference(self) -> str | None:
        """Query the model-preference API for the user's voice model selection.
        
        Returns a model ID like 'anthropic/claude-haiku-4-5' or None.
        """
        try:
            if self._http_session is None or self._http_session.closed:
                self._http_session = aiohttp.ClientSession()
            url = f"{self._gateway_url}/api/model-preference?channel=voice"
            async with self._http_session.get(
                url,
                headers={"x-internal-secret": self._internal_secret},
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    model_id = data.get("modelId")
                    if model_id:
                        logger.info(
                            f"[OpenClawSession] User model preference: {model_id}"
                        )
                        return model_id
                else:
                    logger.warning(
                        f"[OpenClawSession] Model preference API returned {resp.status}"
                    )
        except Exception as e:
            logger.warning(f"[OpenClawSession] Failed to fetch model preference: {e}")
        return None

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
            # One-line debug breadcrumb so "voice greets but doesn't reply"
            # bugs are diagnosable from logs: confirms a context frame with
            # user messages reached the LLM processor.
            try:
                last_user = next(
                    (m.get("content") for m in reversed(messages) if m.get("role") == "user"),
                    None,
                )
                if last_user:
                    preview = (last_user if isinstance(last_user, str) else str(last_user))[:80]
                    logger.debug(f"[OpenClawSession] received user frame: {preview!r}")
            except Exception:
                pass
            await self._run_completion(messages)
        else:
            # Pass through frames we don't handle (audio, control, etc.)
            await self.push_frame(frame, direction)

    # ------------------------------------------------------------------
    # Core streaming completion
    # ------------------------------------------------------------------

    def _latest_user_text(self) -> str:
        """Return latest user utterance from current message history."""
        for msg in reversed(self._messages):
            if msg.get("role") != "user":
                continue
            content = msg.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()
        return ""

    async def _run_completion(self, incoming_messages: list[dict[str, str]]) -> None:
        """Send messages to OpenClaw and stream the response as TextFrames."""

        # Do not drop live user turns. Keep the latest context snapshot.
        # But DON'T cancel the in-flight request if it hasn't started producing
        # output yet — OpenClaw can take 5-10s for first token, and cancelling
        # before any response arrives creates an infinite loop where the bot
        # never speaks (the "silence after Hi" bug).
        if self._is_processing:
            self._pending_incoming = incoming_messages
            if self._response_started:
                # Bot is already speaking — cancel to process fresh user input
                self._cancel_event.set()
                logger.info("[OpenClawSession] Queued user turn + cancelled (bot was speaking)")
            else:
                # Bot hasn't spoken yet — let the request complete, then handle
                # the queued turn. Cancelling here would cause permanent silence.
                logger.info("[OpenClawSession] Queued user turn (preserving in-flight request — no response yet)")
            return

        self._is_processing = True
        try:
            next_incoming: list[dict[str, str]] | None = incoming_messages
            while next_incoming is not None:
                self._pending_incoming = None
                self._cancel_event.set()
                self._cancel_event = asyncio.Event()
                self._processing_start_time = time.monotonic()
                self._response_started = False

                # Merge incoming messages into our session history.
                # The context aggregator sends the *full* conversation each time,
                # so we sync: keep our system prompt, then adopt everything after.
                if next_incoming:
                    non_system = [
                        m for m in next_incoming if m.get("role") != "system"
                    ]
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

                # Debounce duplicate transcript snapshots (partial->final churn).
                user_text = self._latest_user_text()
                now = time.monotonic()
                if (
                    user_text
                    and user_text == self._last_user_text
                    and (now - self._last_user_time) < 3.0
                ):
                    logger.debug(
                        "[OpenClawSession] Skipping duplicate user turn snapshot"
                    )
                    next_incoming = self._pending_incoming
                    continue
                if user_text:
                    self._last_user_text = user_text
                    self._last_user_time = now

                cancel = self._cancel_event
                turn_start = time.monotonic()

                await self.push_frame(LLMFullResponseStartFrame())

                full_response_chunks: list[str] = []

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
                        logger.info(
                            f"[OpenClawSession] Meeting mode: ignoring (not addressed): {user_text[:80]!r}"
                        )
                        await self.push_frame(LLMFullResponseEndFrame())
                        next_incoming = self._pending_incoming
                        continue

                # Instant filler removed per Blair's directive (2026-02-23)
                # Pearl now waits naturally for OpenClaw response without filler phrases

                # No follow-up filler loop — the instant contextual filler above is
                # enough.  The LLM should start streaming its real response quickly;
                # repeated robotic fillers ("Still working on that", "Almost there")
                # degrade the conversational experience.
                filler_task: asyncio.Task | None = None

                try:
                    if self._http_session is None or self._http_session.closed:
                        self._http_session = aiohttp.ClientSession()
                    session = self._http_session
                    # Fetch user's model preference on first request (lazy init)
                    if self._model_override is None:
                        pref = await self._fetch_model_preference()
                        # Use empty string as sentinel for "already checked, no preference"
                        self._model_override = pref or ""

                    req_headers = {
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                        # Route to main agent session — voice IS the main Pearl,
                        # not a separate session. Shares context with Discord/webchat/TUI.
                        "x-openclaw-session-key": self._session_key,
                        # Tell the gateway this is a voice channel so bindings
                        # resolve correctly (not hardcoded to "webchat").
                        "x-openclaw-channel": "voice",
                    }
                    # Pass user's model preference so OpenClaw uses the UI-selected model
                    if self._model_override:
                        req_headers["x-openclaw-model-override"] = self._model_override

                    # OpenAI-compatible streaming completion. OpenClaw's voice
                    # agent owns its own tool surface server-side — we only
                    # consume text tokens here.
                    payload = {
                        "model": self._model,
                        "messages": self._messages,
                        "stream": True,
                        "max_tokens": self._max_tokens,
                        "temperature": _env_float("BOT_VOICE_TEMPERATURE", 0.9),
                        "user": "pearlos-voice",
                    }

                    async with session.post(
                        f"{self._api_url}/chat/completions",
                        json=payload,
                        headers=req_headers,
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
                                    text="Hmm, give me just a moment to think about that."
                                )
                            )
                            await self.push_frame(LLMFullResponseEndFrame())
                            next_incoming = self._pending_incoming
                            continue

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
                                    if not full_response_chunks:
                                        ttfb_ms = (time.monotonic() - turn_start) * 1000
                                        logger.info(
                                            f"[OpenClawSession] ⚡ TTFB: {ttfb_ms:.0f}ms "
                                            f"(first content token from OpenClaw)"
                                        )
                                        self._response_started = True
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
                            text="Lost my train of thought. Try that again."
                        )
                    )
                except Exception as exc:
                    logger.exception(f"[OpenClawSession] Unexpected error: {exc}")
                    await self.push_frame(
                        TextFrame(text="Trying that a different way.")
                    )
                finally:
                    if filler_task is not None:
                        filler_task.cancel()
                    # Record assistant response in history.
                    if full_response_chunks:
                        self._messages.append(
                            {"role": "assistant", "content": "".join(full_response_chunks)}
                        )
                    await self.push_frame(LLMFullResponseEndFrame())
                    next_incoming = self._pending_incoming
        finally:
            self._is_processing = False

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

        Guards against spurious cancellations by enforcing:
          1. No cancellation until the bot has started speaking (first token received).
             Before that, there is nothing audible to interrupt and cancelling just
             prevents the bot from ever responding (the "interruption storm" bug).
          2. A minimum processing time before cancellation is allowed.
          3. A debounce window between successive interruptions.
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

        if self._is_processing:
            # Gate: don't cancel until the bot has actually started speaking.
            # While waiting for the LLM's first token there is no audio to
            # interrupt, and cancelling here creates an infinite loop where
            # the bot never responds.
            if not self._response_started:
                logger.info(
                    "[OpenClawSession] Suppressed interruption — response not yet "
                    "started (no audio to interrupt)"
                )
                await self.push_frame(frame, direction)
                return

            # Processing guard: don't cancel a request that just started speaking.
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
