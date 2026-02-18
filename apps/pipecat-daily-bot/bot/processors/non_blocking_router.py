"""Non-blocking tool router — splits voice response from tool execution.

Phase 1: Fast conversational reply via lightweight LLM (streamed to TTS immediately)
Phase 2: Full tool execution via OpenClaw (background, results go to UI only)
"""

import asyncio
import json
import os
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
VOICE_FAST_SYSTEM = """You are Pearl, a voice assistant. You're about to respond to the user.

RULES:
- Respond in 1-3 natural spoken sentences
- NO tool calls, NO function calls — just speak
- If the user asks for something that needs a tool (search, canvas, notes, etc.), 
  acknowledge it conversationally and share what you know about the topic
- Be warm, knowledgeable, and conversational
- NEVER say "let me check" or "one moment" — instead, start talking about the actual topic
- Example: User asks "What's the weather?" → "It's been pretty warm lately in most of the US..."
  (while the actual weather lookup happens in the background)
- Example: User asks "Show me info about sea turtles" → "Oh, sea turtles are incredible — 
  they've been around for over 100 million years and can migrate thousands of miles..."
  (while the canvas card builds in the background)

Keep it SHORT. The detailed info will appear on screen via the canvas/tools.
"""

# Classifier prompt to determine if a message needs tools
NEEDS_TOOLS_CLASSIFIER = """Given this user message, does it require external tool execution 
(web search, opening apps, playing media, sending messages, creating notes, showing canvas cards)?

Reply with ONLY "yes" or "no".

User message: {message}"""


class NonBlockingToolRouter(FrameProcessor):
    """Routes voice responses and tool execution in parallel.
    
    Phase 1: Streams fast conversational reply to TTS (sub-500ms TTFB)
    Phase 2: Fires OpenClaw agent session for tool execution (background)
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
        max_history: int = 40,
        timeout: int = 180,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        
        # Phase 1: Fast voice LLM (GPT-4o-mini via OpenAI or local)
        self._fast_model = fast_model or os.getenv("BOT_FAST_MODEL", "anthropic/claude-sonnet-4-5")
        self._fast_api_url = (fast_api_url or os.getenv("BOT_FAST_API_URL") or os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")).rstrip("/")
        self._fast_api_key = fast_api_key or os.getenv("BOT_FAST_API_KEY") or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        
        # Phase 2: OpenClaw full agent (tools, search, canvas, etc.)
        self._oc_api_url = (openclaw_api_url or os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")).rstrip("/")
        self._oc_api_key = openclaw_api_key or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        # Always use openclaw:main for background tool execution — raw model names
        # cause the agentic loop to iterate and call tools multiple times
        self._oc_model = openclaw_model or os.getenv("BOT_OPENCLAW_MODEL", "openclaw:main")
        self._oc_session_key = openclaw_session_key or os.getenv("OPENCLAW_SESSION_KEY", "agent:main:voice")
        
        # Deduplication: track recent tool calls to prevent double-fires
        self._recent_tool_calls: dict[str, float] = {}  # tool_name -> timestamp
        self._tool_dedup_window = 15.0  # seconds
        
        self._system_prompt = system_prompt
        self._max_history = max_history
        self._timeout = timeout
        self._messages: list[dict] = [{"role": "system", "content": system_prompt}]
        
        self._http_session: aiohttp.ClientSession | None = None
        self._cancel_event = asyncio.Event()
        self._is_processing = False
        self._processing_start_time = 0.0
        self._min_processing_secs = 2.0
        
        # Dedup: track last processed user text to prevent re-processing
        # when tool results re-inject the same context frame
        self._last_processed_user_text: str = ""
        self._last_processed_time: float = 0
        self._dedup_window_secs: float = 30.0
        
        # Track background tasks for cleanup
        self._background_tasks: set[asyncio.Task] = set()
        
        logger.info(
            f"[NonBlockingRouter] Init — fast={self._fast_model} "
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
            logger.warning(f"[NonBlockingRouter] GOT MESSAGES FRAME: {len(messages)} messages, last role={messages[-1].get('role') if messages else 'none'}")
            await self._run_two_phase(messages)
        else:
            await self.push_frame(frame, direction)

    async def _run_two_phase(self, incoming_messages: list[dict]) -> None:
        """Execute two-phase response: fast voice + background tools."""
        
        if self._is_processing:
            elapsed = time.monotonic() - self._processing_start_time
            if elapsed < self._min_processing_secs:
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
                    # Strip multi-user "[User name, pid: xxx]: " prefix if present
                    import re
                    cleaned = re.sub(r'^\[User [^]]+, pid: [^]]+\]:\s*', '', content)
                    if cleaned.strip():
                        user_text = cleaned
                        break
        
        if not user_text:
            # Log what user messages look like
            user_msgs = [m for m in self._messages if m.get("role") == "user"]
            logger.warning(f"[NonBlockingRouter] NO USER TEXT FOUND in {len(self._messages)} messages. User msgs: {[str(m.get('content',''))[:80] for m in user_msgs[-3:]]}")
            self._is_processing = False
            return
        logger.warning(f"[NonBlockingRouter] User text: '{user_text[:100]}'")
        
        # Dedup: skip if same user text was processed recently
        now = time.monotonic()
        if (user_text == self._last_processed_user_text
                and (now - self._last_processed_time) < self._dedup_window_secs):
            logger.warning(
                f"[NonBlockingRouter] Skipping duplicate user text "
                f"(seen {now - self._last_processed_time:.1f}s ago): '{user_text[:80]}'"
            )
            self._is_processing = False
            return
        
        self._last_processed_user_text = user_text
        self._last_processed_time = now
        
        cancel = self._cancel_event
        
        # Determine if this needs tools (simple heuristic — no LLM call needed)
        needs_tools = self._needs_tools_heuristic(user_text)
        
        if needs_tools:
            # TWO-PHASE: fast voice + background OpenClaw
            logger.info(f"[NonBlockingRouter] Two-phase: voice + tools for: {user_text[:80]}")
            
            # Phase 1: Stream fast voice response immediately
            await self._stream_fast_voice(user_text, cancel)
            
            # Phase 2: Fire OpenClaw in background (no voice output)
            task = asyncio.create_task(self._run_openclaw_background(user_text))
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)
        else:
            # SIMPLE: Just use OpenClaw directly (streams voice like before)
            logger.info(f"[NonBlockingRouter] Simple response (no tools): {user_text[:80]}")
            await self._stream_openclaw_voice(cancel)
        
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
        ]
        return any(kw in lower for kw in tool_keywords)

    async def _stream_fast_voice(self, user_text: str, cancel: asyncio.Event) -> None:
        """Phase 1: Stream a fast conversational response to TTS."""
        session = await self._get_session()
        
        # Build minimal context for fast model
        fast_messages = [
            {"role": "system", "content": VOICE_FAST_SYSTEM},
            # Include last few exchanges for context
            *self._messages[-5:],
        ]
        
        payload = {
            "model": self._fast_model,
            "messages": fast_messages,
            "stream": True,
            "max_tokens": 200,  # Keep it short
            "temperature": 0.8,
        }
        
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
                    logger.error(f"[NonBlockingRouter] Fast LLM error: {resp.status}")
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
                        content = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                        if content:
                            await self.push_frame(TextFrame(text=content))
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Fast voice error: {type(e).__name__}: {e}")
            await self.push_frame(TextFrame(text="Let me look into that for you. "))
        
        await self.push_frame(LLMFullResponseEndFrame())

    async def _run_openclaw_background(self, user_text: str) -> None:
        """Phase 2: Run OpenClaw agent in background for tool execution only.
        
        Results go to UI (canvas, notes, apps) — NOT to voice.
        """
        session = await self._get_session()
        
        # Add instruction to NOT produce conversational text — only execute tools
        tool_only_messages = list(self._messages)
        tool_only_messages.append({
            "role": "system", 
            "content": (
                "The user's voice request has already been acknowledged with a conversational "
                "response. Your job now is ONLY to execute the necessary tools/actions. "
                "Do NOT produce conversational text — only use tools. "
                "If the request needs a Wonder Canvas card, create it. "
                "If it needs a web search, do it. If it needs to open an app, do it. "
                "Produce minimal text output — focus on tool execution.\n\n"
                "CRITICAL: Call each tool EXACTLY ONCE. Do NOT call the same tool twice "
                "(e.g. do NOT call bot_wonder_canvas_scene twice to 'improve' the result). "
                "Your first attempt is final. One tool call per action, then stop."
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
                async for raw_line in resp.content:
                    pass  # Just let it run — tools execute as side effects
                    
                logger.info(f"[NonBlockingRouter] Background tool execution complete for: {user_text[:60]}")
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Background tool error: {e}")

    async def _stream_openclaw_voice(self, cancel: asyncio.Event) -> None:
        """Simple path: stream OpenClaw response directly to voice (no tools expected).
        
        Uses the fast model for quick TTFB since no tools are needed.
        Falls back to a spoken error if the request hangs or fails.
        """
        session = await self._get_session()
        
        # Use fast model for simple responses — no need for full agentic loop
        payload = {
            "model": self._fast_model,
            "messages": self._messages,
            "stream": True,
            "max_tokens": 1024,
            "user": "pearlos-voice",
        }
        
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
                    logger.error(f"[NonBlockingRouter] OpenClaw voice error: {resp.status}")
                    await self.push_frame(TextFrame(text="Sorry, I'm having trouble right now."))
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
                            await self.push_frame(TextFrame(text=content))
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
        except asyncio.TimeoutError:
            logger.error("[NonBlockingRouter] Simple voice stream timed out (sock_read=15s)")
            await self.push_frame(TextFrame(text="Sorry, I'm having a little trouble responding right now. Could you try again?"))
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Voice stream error: {type(e).__name__}: {e}")
            await self.push_frame(TextFrame(text="Something went wrong, let me try again."))
        
        await self.push_frame(LLMFullResponseEndFrame())

    async def cleanup(self):
        for task in self._background_tasks:
            task.cancel()
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()
        await super().cleanup()
