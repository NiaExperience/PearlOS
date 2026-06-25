"""AnthropicVoiceProcessor — Routes through OpenClaw Gateway for voice with full context.

Single-call architecture: Claude Haiku/Sonnet with full workspace context,
tool schemas registered natively, and tool execution via bot gateway mesh bridge.
Routes through OpenClaw gateway (/v1/chat/completions) using setup-token auth
instead of direct Anthropic API.

Frame contract (same slot as OpenAILLMService):
    IN  → LLMMessagesFrame | OpenAILLMContextFrame | LLMContextFrame | StartInterruptionFrame
    OUT → LLMFullResponseStartFrame, TextFrame …, LLMFullResponseEndFrame
"""

from __future__ import annotations

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

from core.prompts import VOICE_TTS_NOTE

try:
    from pipecat.frames.frames import LLMContextFrame
except ImportError:
    LLMContextFrame = None

try:
    from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContextFrame
except ImportError:
    OpenAILLMContextFrame = None


# ---------------------------------------------------------------------------
# Workspace context loader
# ---------------------------------------------------------------------------

def _load_workspace_context(workspace_root: str) -> dict[str, str]:
    """Load workspace files into a dict of {label: content}."""
    files = {
        "SOUL": os.path.join(workspace_root, "SOUL.md"),
        "USER": os.path.join(workspace_root, "USER.md"),
        "MEMORY": os.path.join(workspace_root, "MEMORY.md"),
        "CROSS_SESSION": os.path.join(workspace_root, "memory", "cross-session-state.md"),
        "ACTIVITY_LOG": os.path.join(workspace_root, "memory", "activity-log.md"),
    }
    result = {}
    for label, path in files.items():
        try:
            with open(path, "r", encoding="utf-8") as f:
                if label == "ACTIVITY_LOG":
                    lines = f.readlines()
                    result[label] = "".join(lines[-50:]).strip()
                else:
                    result[label] = f.read().strip()
        except FileNotFoundError:
            logger.warning(f"[AnthropicVoice] Workspace file not found: {path}")
        except Exception as e:
            logger.error(f"[AnthropicVoice] Error reading {path}: {e}")
    return result


def _build_system_prompt(workspace: dict[str, str]) -> str:
    """Build the full system prompt from workspace context."""
    parts = []

    if workspace.get("SOUL"):
        parts.append(workspace["SOUL"])

    if workspace.get("USER"):
        parts.append(f"## USER CONTEXT\n{workspace['USER']}")

    if workspace.get("MEMORY"):
        mem = workspace["MEMORY"]
        if len(mem) > 4000:
            mem = "...\n" + mem[-4000:]
        parts.append(f"## LONG-TERM MEMORY\n{mem}")

    if workspace.get("ACTIVITY_LOG"):
        parts.append(f"## RECENT ACTIVITY (cross-session)\n{workspace['ACTIVITY_LOG']}")

    if workspace.get("CROSS_SESSION"):
        parts.append(f"## CURRENT STATE\n{workspace['CROSS_SESSION']}")

    parts.append(VOICE_TTS_NOTE)

    parts.append(
        "## VOICE SESSION RULES\n"
        "You are speaking aloud via text-to-speech in a PearlOS voice session.\n"
        "- Respond naturally in 1-3 sentences for simple queries, max 5 for complex.\n"
        "- Use tools when you need real-time info or to take actions.\n"
        "- You have full context and memory, use it. You know who Blair is.\n"
        "- Have opinions. Be warm but sharp. You're an intellectual companion.\n"
        "- When using tools, start talking immediately, don't go silent.\n"
        "- For voice commands (open or close apps), execute immediately via tools.\n"
        "- STT may transcribe 'close' as 'closed', always treat as a command.\n"
        "- When showing visual content, use bot_wonder_canvas_template for common types,\n"
        "  and bot_wonder_canvas_scene only for unique or creative HTML.\n"
        "- Image proxy: use /api/image?q=SUBJECT for all images in canvas HTML. (Tool arguments and\n"
        "  canvas HTML are NOT spoken, so URLs are fine inside tool calls. The TTS-safe rules above\n"
        "  apply only to your spoken reply text.)\n"
        "- GOODBYE DETECTION: When the user says goodbye, farewell, or any clear end-call phrase\n"
        "  (e.g. 'okay goodbye', 'alright bye', 'talk to you later', 'that's all thanks'),\n"
        "  say a brief warm goodbye and IMMEDIATELY call bot_end_call to end the session.\n"
        "  Do NOT continue the conversation after a goodbye. End it.\n"
    )

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Tool schema converter (to OpenAI format for OpenClaw gateway)
# ---------------------------------------------------------------------------

def _convert_tools_to_openai(discovered_tools: dict[str, dict]) -> list[dict]:
    """Convert discovered bot tools to OpenAI tool format for OpenClaw gateway."""
    openai_tools = []
    for name, meta in sorted(discovered_tools.items()):
        params = meta.get("parameters", {})
        schema = {
            "type": "object",
            "properties": params.get("properties", {}),
        }
        if "required" in params:
            schema["required"] = params["required"]

        openai_tools.append({
            "type": "function",
            "function": {
                "name": name,
                "description": meta.get("description", ""),
                "parameters": schema,
            },
        })
    return openai_tools


def _get_openclaw_token() -> str:
    """Read the OpenClaw gateway auth token from config."""
    for cfg_path in ["/root/.openclaw/openclaw.json", "/root/.openclaw/config/openclaw.json"]:
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            token = cfg.get("gateway", {}).get("auth", {}).get("token", "")
            if token:
                return token
            # Also check setupToken
            token = cfg.get("setupToken", "")
            if token:
                return token
        except Exception:
            continue
    return os.getenv("OPENCLAW_TOKEN", "dummy-token")


def _env_float(name: str, default: float, *, minimum: float = 0.0, maximum: float = 2.0) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return max(minimum, min(maximum, float(raw)))
    except ValueError:
        logger.warning(f"[AnthropicVoice] Invalid {name}={raw!r}; using {default}")
        return default


# ---------------------------------------------------------------------------
# Main processor
# ---------------------------------------------------------------------------

class AnthropicVoiceProcessor(FrameProcessor):
    """OpenClaw Gateway processor for voice with full workspace context.

    Routes through OpenClaw gateway (/v1/chat/completions) using token auth.
    - Pre-loads workspace files into system prompt (~15K tokens)
    - Registers all bot tools in OpenAI tool format
    - Streams text to TTS pipeline
    - Executes tool calls via bot gateway mesh bridge
    - Feeds tool results back for multi-turn continuation
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        workspace_path: str | None = None,
        gateway_url: str | None = None,
        max_history: int = 40,
        max_tool_rounds: int = 5,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)

        # Model selection
        self._model = model or os.getenv("BOT_ANTHROPIC_VOICE_MODEL", os.getenv("BOT_VOICE_MODEL", "anthropic/claude-haiku-4-5"))

        # Route to correct API based on model provider
        if self._model.startswith("groq/"):
            self._api_url = "https://api.groq.com/openai"
            self._api_token = os.getenv("GROQ_API_KEY", "")
            self._api_model = self._model.replace("groq/", "")  # Groq API wants just the model name
            if not self._api_token:
                logger.error("[AnthropicVoice] GROQ_API_KEY not set but model is groq/*")
            logger.info(f"[AnthropicVoice] Using Groq direct API for model {self._api_model}")
        else:
            self._api_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789")
            self._api_token = _get_openclaw_token()
            # OpenClaw requires model=openclaw (not raw provider/model names)
            self._api_model = "openclaw"
            if not self._api_token or self._api_token == "dummy-token":
                logger.warning("[AnthropicVoice] No OpenClaw token found — API calls may fail")
        self._max_tokens = max_tokens
        self._max_history = max_history
        self._max_tool_rounds = max_tool_rounds
        self._bot_gateway_url = (gateway_url or os.getenv("BOT_GATEWAY_URL", "http://localhost:4444")).rstrip("/")

        # Load workspace context
        ws_path = workspace_path or os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")
        workspace = _load_workspace_context(ws_path)
        self._system_prompt = _build_system_prompt(workspace)
        logger.info(
            f"[AnthropicVoice] System prompt built: {len(self._system_prompt)} chars "
            f"(~{len(self._system_prompt) // 4} tokens)"
        )

        # Load tools (OpenAI format for OpenClaw gateway)
        self._tools: list[dict] = []
        try:
            from tools.discovery import get_discovery
            discovery = get_discovery()
            discovered = discovery.discover_tools()
            self._tools = _convert_tools_to_openai(discovered)
            logger.info(f"[AnthropicVoice] Registered {len(self._tools)} tools (OpenAI format)")
        except Exception as e:
            logger.warning(f"[AnthropicVoice] Tool discovery failed (non-fatal): {e}")

        # Conversation history (OpenAI format)
        self._messages: list[dict] = []
        self._http_session: aiohttp.ClientSession | None = None
        self._cancel_event = asyncio.Event()
        self._is_processing = False
        self._pending_incoming: list[dict] | None = None
        self._response_started: bool = False

        # Dedup
        self._last_user_text = ""
        self._last_user_time = 0.0

        # Stats
        self._turn_count = 0
        self._total_ttfb_ms = 0.0

        logger.info(
            f"[AnthropicVoice] Initialized: model={self._model}, api={self._api_url}, "
            f"tools={len(self._tools)}, bot_gateway={self._bot_gateway_url}"
        )

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._http_session is None or self._http_session.closed:
            self._http_session = aiohttp.ClientSession()
        return self._http_session

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, StartInterruptionFrame):
            if self._is_processing and not self._response_started:
                logger.info(
                    "[AnthropicVoice] Suppressed interruption — response not yet "
                    "started (no audio to interrupt)"
                )
                await self.push_frame(frame, direction)
                return
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
            await self._handle_messages(messages)
        else:
            await self.push_frame(frame, direction)

    async def _handle_messages(self, incoming: list[dict]) -> None:
        """Process incoming messages through OpenClaw gateway with tool loop."""
        if self._is_processing:
            # Do not drop live user turns. Keep the newest context snapshot and
            # cancel the in-flight request so we can process fresh speech next.
            self._pending_incoming = incoming
            self._cancel_event.set()
            logger.info("[AnthropicVoice] Queued latest user turn while processing")
            return

        self._is_processing = True

        try:
            next_incoming: list[dict] | None = incoming
            while next_incoming is not None:
                self._pending_incoming = None
                self._cancel_event.set()
                self._cancel_event = asyncio.Event()
                self._response_started = False

                self._sync_messages(next_incoming)

                user_text = self._get_latest_user_text()
                if not user_text:
                    break

                # Dedup
                now = time.monotonic()
                if user_text == self._last_user_text and (now - self._last_user_time) < 30.0:
                    logger.warning(f"[AnthropicVoice] Skipping duplicate: '{user_text[:60]}'")
                    break
                self._last_user_text = user_text
                self._last_user_time = now

                self._turn_count += 1
                turn_start = time.monotonic()
                cancel = self._cancel_event

                # Tool execution loop
                round_num = 0
                first_text_emitted = False

                while round_num < self._max_tool_rounds:
                    round_num += 1

                    text_chunks, tool_calls, finish_reason = await self._call_openclaw_streaming(
                        cancel, turn_start, not first_text_emitted
                    )

                    if text_chunks:
                        first_text_emitted = True

                    if cancel.is_set():
                        break

                    # If no tool calls, we're done
                    if finish_reason != "tool_calls" or not tool_calls:
                        break

                    # Add assistant message with tool_calls
                    assistant_msg: dict[str, Any] = {"role": "assistant"}
                    if text_chunks:
                        assistant_msg["content"] = "".join(text_chunks)
                    else:
                        assistant_msg["content"] = None
                    assistant_msg["tool_calls"] = [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {
                                "name": tc["name"],
                                "arguments": json.dumps(tc["arguments"]),
                            },
                        }
                        for tc in tool_calls
                    ]
                    self._messages.append(assistant_msg)

                    # Execute each tool and add results
                    for tc in tool_calls:
                        result = await self._invoke_tool(tc["name"], tc["arguments"])
                        self._messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": json.dumps(result) if isinstance(result, dict) else str(result),
                        })
                        logger.info(f"[AnthropicVoice] Tool {tc['name']} executed in round {round_num}")

                next_incoming = self._pending_incoming

        except Exception as e:
            logger.error(f"[AnthropicVoice] Error processing: {e}", exc_info=True)
        finally:
            self._is_processing = False

    def _sync_messages(self, incoming: list[dict]) -> None:
        """Sync incoming OpenAI-format messages into our history."""
        openai_msgs = []
        for msg in incoming:
            role = msg.get("role", "")
            content = msg.get("content", "")

            if role == "system":
                continue  # We inject our own system prompt
            elif role == "user":
                if isinstance(content, str) and content.strip():
                    openai_msgs.append({"role": "user", "content": content})
            elif role == "assistant":
                if isinstance(content, str) and content.strip():
                    openai_msgs.append({"role": "assistant", "content": content})

        # Merge consecutive same-role messages
        merged = []
        for msg in openai_msgs:
            if merged and merged[-1]["role"] == msg["role"]:
                prev = merged[-1]["content"]
                curr = msg["content"]
                if isinstance(prev, str) and isinstance(curr, str):
                    merged[-1]["content"] = prev + "\n" + curr
                continue
            merged.append(msg)

        # Ensure starts with user message
        if merged and merged[0]["role"] != "user":
            merged.insert(0, {"role": "user", "content": "[conversation start]"})

        # Trim
        if len(merged) > self._max_history:
            merged = merged[-self._max_history:]
            if merged and merged[0]["role"] != "user":
                merged.insert(0, {"role": "user", "content": "[earlier conversation trimmed]"})

        self._messages = merged

    def _get_latest_user_text(self) -> str:
        for msg in reversed(self._messages):
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    cleaned = re.sub(r'^\[User [^]]+, pid: [^]]+\]:\s*', '', content)
                    if cleaned.strip():
                        return cleaned.strip()
        return ""

    async def _call_openclaw_streaming(
        self,
        cancel: asyncio.Event,
        turn_start: float,
        is_first_stream: bool,
    ) -> tuple[list[str], list[dict], str]:
        """Call OpenClaw gateway /v1/chat/completions with streaming.

        Returns (text_chunks, tool_calls, finish_reason).
        tool_calls format: [{"id": "...", "name": "...", "arguments": {...}}]
        """
        session = await self._get_session()

        # Build messages with system prompt first
        api_messages = [{"role": "system", "content": self._system_prompt}] + self._messages

        payload: dict[str, Any] = {
            "model": self._api_model,
            "max_tokens": self._max_tokens,
            "messages": api_messages,
            "stream": True,
            "temperature": _env_float("BOT_VOICE_TEMPERATURE", 0.9),
        }
        if self._tools:
            payload["tools"] = self._tools

        headers = {
            "Authorization": f"Bearer {self._api_token}",
            "Content-Type": "application/json",
        }

        text_chunks: list[str] = []
        tool_calls_accum: dict[int, dict] = {}  # index -> {id, name, arguments_str}
        finish_reason = "stop"
        ttfb_logged = False

        if is_first_stream:
            await self.push_frame(LLMFullResponseStartFrame())

        try:
            async with session.post(
                f"{self._api_url}/v1/chat/completions",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=120, sock_connect=10, sock_read=60),
            ) as resp:
                if resp.status != 200:
                    err = await resp.text()
                    logger.error(f"[AnthropicVoice] OpenClaw API error {resp.status}: {err[:300]}")
                    await self.push_frame(TextFrame(text="Hmm, let me try that again. "))
                    await self.push_frame(LLMFullResponseEndFrame())
                    return text_chunks, [], "error"

                async for raw_line in resp.content:
                    if cancel.is_set():
                        break

                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue

                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    if not data_str:
                        continue

                    try:
                        event = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    choices = event.get("choices", [])
                    if not choices:
                        continue

                    choice = choices[0]
                    delta = choice.get("delta", {})
                    fr = choice.get("finish_reason")

                    # Text content
                    content = delta.get("content")
                    if content:
                        if not ttfb_logged:
                            ttfb_ms = (time.monotonic() - turn_start) * 1000
                            self._total_ttfb_ms += ttfb_ms
                            avg = self._total_ttfb_ms / self._turn_count
                            logger.info(
                                f"[AnthropicVoice] ⚡ TTFB: {ttfb_ms:.0f}ms "
                                f"(avg: {avg:.0f}ms, turn #{self._turn_count})"
                            )
                            ttfb_logged = True
                            self._response_started = True
                        text_chunks.append(content)
                        await self.push_frame(TextFrame(text=content))

                    # Tool calls (streamed incrementally)
                    tc_deltas = delta.get("tool_calls", [])
                    for tc_delta in tc_deltas:
                        idx = tc_delta.get("index", 0)
                        if idx not in tool_calls_accum:
                            tool_calls_accum[idx] = {
                                "id": tc_delta.get("id", ""),
                                "name": "",
                                "arguments_str": "",
                            }
                        acc = tool_calls_accum[idx]
                        if tc_delta.get("id"):
                            acc["id"] = tc_delta["id"]
                        fn = tc_delta.get("function", {})
                        if fn.get("name"):
                            acc["name"] = fn["name"]
                            logger.info(f"[AnthropicVoice] Tool call started: {acc['name']}")
                        if fn.get("arguments"):
                            acc["arguments_str"] += fn["arguments"]

                    if fr:
                        finish_reason = fr

        except asyncio.TimeoutError:
            logger.error("[AnthropicVoice] OpenClaw API request timed out")
            await self.push_frame(TextFrame(text="Let me try that again. "))
        except Exception as e:
            logger.error(f"[AnthropicVoice] Stream error: {type(e).__name__}: {e}")
            await self.push_frame(TextFrame(text="One moment. "))

        # Parse accumulated tool calls
        tool_calls = []
        for idx in sorted(tool_calls_accum.keys()):
            acc = tool_calls_accum[idx]
            try:
                args = json.loads(acc["arguments_str"]) if acc["arguments_str"] else {}
            except json.JSONDecodeError:
                args = {}
                logger.warning(f"[AnthropicVoice] Failed to parse tool args for {acc['name']}")
            tool_calls.append({
                "id": acc["id"],
                "name": acc["name"],
                "arguments": args,
            })

        # Normalize finish_reason: OpenAI uses "tool_calls" for tool use
        if finish_reason != "tool_calls":
            # No tool continuation — close the response
            if text_chunks:
                self._messages.append({"role": "assistant", "content": "".join(text_chunks)})
            await self.push_frame(LLMFullResponseEndFrame())

        return text_chunks, tool_calls, finish_reason

    async def _invoke_tool(self, tool_name: str, params: dict) -> dict:
        """Execute a tool via the bot gateway mesh bridge."""
        session = await self._get_session()
        room_url = os.getenv("BOT_ROOM_URL", "")
        tenant_id = ""
        if room_url:
            try:
                from room import state as room_state
                tenant_id = room_state.get_room_tenant_id(room_url) or ""
            except Exception:
                tenant_id = ""
        tenant_id = (tenant_id or os.getenv("BOT_SESSION_TENANT_ID") or "").strip()
        session_user_id = (os.getenv("BOT_SESSION_USER_ID") or "").strip()
        session_user_email = (os.getenv("BOT_SESSION_USER_EMAIL") or "").strip()
        payload = {
            "tool_name": tool_name,
            "params": params,
            "room_url": room_url,
        }
        if tenant_id:
            payload["tenant_id"] = tenant_id
        if session_user_id:
            payload["user_id"] = session_user_id
        if session_user_email:
            payload["user_email"] = session_user_email
        headers = {"Content-Type": "application/json"}
        auth_token = (
            os.getenv("BOT_CONTROL_SHARED_SECRET")
            or os.getenv("BOT_CONTROL_SHARED_SECRET_PREV")
            or os.getenv("BOT_CONTROL_CLAIMS_SECRET")
            or os.getenv("BOT_CONTROL_CLAIMS_SECRET_PREV")
            or ""
        ).strip()
        if auth_token:
            headers["X-Bot-Secret"] = auth_token
            headers["Authorization"] = f"Bearer {auth_token}"
        if session_user_id:
            headers["x-user-id"] = session_user_id
        if session_user_email:
            headers["x-user-email"] = session_user_email
        if tenant_id:
            headers["x-tenant-id"] = tenant_id
            headers["x-pearl-tenant-id"] = tenant_id

        try:
            async with session.post(
                f"{self._bot_gateway_url}/api/tools/invoke",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    return result.get("result", result)
                else:
                    err = await resp.text()
                    logger.error(f"[AnthropicVoice] Tool invoke error {resp.status}: {err[:200]}")
                    return {"error": f"Tool execution failed: {resp.status}", "detail": err[:200]}
        except Exception as e:
            logger.error(f"[AnthropicVoice] Tool invoke exception: {e}")
            return {"error": str(e)}

    async def cleanup(self):
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()
        await super().cleanup()
