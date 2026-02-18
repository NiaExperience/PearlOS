"""OpenClaw Bridge Tools.

Provides two tools for LLM → OpenClaw Gateway communication:
  - bot_openclaw_task: fire-and-forget background tasks (direct HTTP)
  - bot_think_deeply: synchronous deep reasoning (direct HTTP)

NOTE (2026-02-16): In ``openclaw_session`` mode (BOT_LLM_MODE=openclaw_session),
these tools are **unused** — OpenClaw handles all inference and tool execution
server-side via OpenClawSessionProcessor.  They remain here because they ARE
still used in the non-openclaw LLM modes (hybrid, sonnet_primary, direct OpenAI).
Do not delete.
"""

from __future__ import annotations

import uuid

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
import asyncio
import json
import os
import aiohttp




@bot_tool(
    name="bot_openclaw_task",
    description=(
        "Fire-and-forget background task for the OpenClaw AI agent (powered by Claude). "
        "Results appear in the PearlOS interface, NOT spoken back to the user. "
        "DO NOT use this for Discord/Telegram messaging, web searches, or anything where "
        "you need the result spoken back. Use bot_think_deeply instead for those. "
        "Only use this for long-running background tasks like: writing code to a file, "
        "running multi-step workflows, or heavy analysis that should display in the UI."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "task": {
                "type": "string",
                "description": "A clear description of the task to delegate to OpenClaw."
            },
            "urgency": {
                "type": "string",
                "enum": ["low", "normal", "high"],
                "description": "Task urgency level. Defaults to 'normal'.",
                "default": "normal"
            }
        },
        "required": ["task"]
    }
)
async def bot_openclaw_task(params: FunctionCallParams):
    """Fire-and-forget background task via direct HTTP to OpenClaw Gateway."""
    arguments = params.arguments or {}
    task = arguments.get("task", "").strip()
    urgency = arguments.get("urgency", "normal")
    log = bind_tool_logger(params, tag="[openclaw_tools]").bind(task=task[:80])

    if not task:
        await params.result_callback(
            {"success": False, "error": "task_required", "user_message": "I need a task description."},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    # --- Dedup check: prevent duplicate fire-and-forget tasks ---
    import time as _time
    _clean_dedup_cache()
    dedup_key_task = _normalize_for_dedup(task)
    if dedup_key_task in _think_deeply_cache:
        cached_ts, cached_result = _think_deeply_cache[dedup_key_task]
        age = _time.time() - cached_ts
        log.info(f"Dedup hit for task — skipping duplicate (age={age:.1f}s)")
        await params.result_callback(
            cached_result,
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    session_key = f"oclaw-{uuid.uuid4().hex[:12]}"

    openclaw_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
    openclaw_key = os.getenv("OPENCLAW_API_KEY", "openclaw-local")

    log.info("Sending openclaw task via direct HTTP (fire-and-forget)")

    payload = {
        "model": os.getenv("BOT_ESCALATION_MODEL", "anthropic/claude-opus-4-6"),
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a sub-agent spawned by Voice Pearl to handle a background task. "
                    "Complete it thoroughly. Results will appear in the PearlOS interface. "
                    "Write in clean natural language — no markdown formatting, no bullet lists.\n\n"
                    "CROSS-SESSION AWARENESS:\n"
                    "You have access to sessions_history. ALWAYS check recent conversation history from other sessions "
                    "before answering questions about what was discussed, what decisions were made, or anything that "
                    "might have happened in another channel.\n\n"
                    "Key sessions to check:\n"
                    "- Discord #general: sessions_history(sessionKey=\"agent:main:discord:channel:1471441655650324533\", limit=30)\n"
                    "- Main/Telegram: sessions_history(sessionKey=\"agent:main:main\", limit=20)\n\n"
                    "When the user asks 'what did we talk about', 'do you remember', 'what's the secret word', "
                    "or anything referencing prior conversation — ALWAYS pull session history first. "
                    "Don't guess or say you don't know.\n\n"
                    "CRITICAL CONSTRAINTS:\n"
                    "- Only use the message tool if the user explicitly asked you to send a message.\n"
                    "- NEVER send your own internal reasoning, confusion, or tool discovery questions to any channel.\n"
                    "- Return your results directly. You are a sub-agent, not an independent agent.\n"
                    "- If you need information about what other sessions have done, read memory/activity-log.md."
                ),
            },
            {"role": "user", "content": f"[urgency={urgency}] {task}"},
        ],
        "stream": False,
        "max_tokens": 4096,
    }

    async def _fire_and_forget():
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{openclaw_url}/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {openclaw_key}"},
                    timeout=aiohttp.ClientTimeout(total=120),
                ) as resp:
                    if resp.status == 200:
                        log.info("OpenClaw background task completed", session_key=session_key)
                    else:
                        error_text = await resp.text()
                        log.error(
                            "OpenClaw background task failed",
                            status=resp.status,
                            error=error_text[:200],
                            session_key=session_key,
                        )
        except Exception as e:
            log.exception(f"OpenClaw background task error: {e}", session_key=session_key)

    # Launch in background — don't await
    asyncio.create_task(_fire_and_forget())

    _task_result = {
        "success": True,
        "sessionKey": session_key,
        "user_message": (
            f"I've sent that task to OpenClaw. You'll see the results appear in the interface. "
            f"Session: {session_key}"
        ),
    }
    # Cache for dedup
    _think_deeply_cache[dedup_key_task] = (_time.time(), _task_result)

    await params.result_callback(
        _task_result,
        properties=FunctionCallResultProperties(run_llm=True),
    )


# ---------------------------------------------------------------------------
# Dedup cache for bot_think_deeply to prevent duplicate Discord messages
# when multiple voice sessions or retries hit OpenClaw simultaneously.
# Key: normalized question text, Value: (timestamp, result)
# ---------------------------------------------------------------------------
_think_deeply_cache: dict[str, tuple[float, dict]] = {}
_THINK_DEEPLY_DEDUP_WINDOW = 30  # seconds


def _normalize_for_dedup(text: str) -> str:
    """Normalize text for dedup comparison (lowercase, strip whitespace)."""
    return " ".join(text.lower().split())


def _clean_dedup_cache():
    """Remove expired entries from the dedup cache."""
    import time
    now = time.time()
    expired = [k for k, (ts, _) in _think_deeply_cache.items() if now - ts > _THINK_DEEPLY_DEDUP_WINDOW]
    for k in expired:
        del _think_deeply_cache[k]


@bot_tool(
    name="bot_think_deeply",
    description=(
        "Connect to your full OpenClaw brain for tasks that need results spoken back to the user. "
        "This is your gateway to: sending Discord/Telegram messages, web research, file access, "
        "deep analysis, and any capability beyond your built-in PearlOS tools. "
        "Use this when the user asks you to: send a Discord message, search the web, "
        "look something up, do complex reasoning, or anything requiring your OpenClaw backend. "
        "The result is returned synchronously and you can speak it back. "
        "Examples: 'send a message to #general on Discord saying hello', "
        "'search the web for latest news about X', 'what's in my recent emails'. "
        "Do NOT use for simple PearlOS operations (notes, YouTube) — use built-in tools for those."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "The question or problem that requires deep thinking."
            },
            "context": {
                "type": "string",
                "description": "Relevant context from the conversation (optional).",
                "default": ""
            }
        },
        "required": ["question"]
    }
)
async def bot_think_deeply(params: FunctionCallParams):
    """Non-blocking call to OpenClaw for deeper reasoning.
    
    Returns an immediate acknowledgment to Pipecat so the voice pipeline isn't
    blocked, then runs the actual OpenClaw call in a background task.  When the
    result arrives it is injected into the conversation context and a new LLM
    turn is triggered so the bot speaks the answer.
    """
    from pipecat.frames.frames import LLMMessagesFrame

    arguments = params.arguments or {}
    question = arguments.get("question", "").strip()
    context = arguments.get("context", "").strip()
    log = bind_tool_logger(params, tag="[bot_think_deeply]").bind(question=question[:80])

    if not question:
        await params.result_callback(
            {"success": False, "error": "question_required", "analysis": "I need a question to think about."},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    # --- Dedup check ---
    import time as _time
    _clean_dedup_cache()
    dedup_key = _normalize_for_dedup(question)
    if dedup_key in _think_deeply_cache:
        cached_ts, cached_result = _think_deeply_cache[dedup_key]
        age = _time.time() - cached_ts
        log.info(f"Dedup hit — returning cached result (age={age:.1f}s)")
        await params.result_callback(
            cached_result,
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    openclaw_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
    openclaw_key = os.getenv("OPENCLAW_API_KEY", "openclaw-local")

    escalation_model = os.getenv("BOT_ESCALATION_MODEL", "") or "anthropic/claude-opus-4-6"

    try:
        timeout_seconds = int(os.getenv("BOT_ESCALATION_TIMEOUT", "90"))
    except (ValueError, TypeError):
        timeout_seconds = 90

    prompt = f"Context: {context}\n\nQuestion: {question}" if context else question

    payload = {
        "model": escalation_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a sub-agent spawned by Voice Pearl for synchronous reasoning. "
                    "Your responses will be spoken aloud via TTS, so write in clean natural sentences. "
                    "No markdown, no bullet lists, no emojis, no special formatting. "
                    "Keep it concise — aim for 2-4 sentences unless the topic demands more depth. "
                    "You have OpenClaw tool access for web search, file operations, and research. "
                    "Use tools as needed, then give a natural spoken summary of what you found.\n\n"
                    "CROSS-SESSION AWARENESS:\n"
                    "You have access to sessions_history. ALWAYS check recent conversation history from other sessions "
                    "before answering questions about what was discussed, what decisions were made, or anything that "
                    "might have happened in another channel.\n\n"
                    "Key sessions to check:\n"
                    "- Discord #general: sessions_history(sessionKey=\"agent:main:discord:channel:1471441655650324533\", limit=30)\n"
                    "- Main/Telegram: sessions_history(sessionKey=\"agent:main:main\", limit=20)\n\n"
                    "When the user asks 'what did we talk about', 'do you remember', 'what's the secret word', "
                    "or anything referencing prior conversation — ALWAYS pull session history first. "
                    "Don't guess or say you don't know.\n\n"
                    "CRITICAL CONSTRAINTS:\n"
                    "- Do NOT use the message tool to send messages to Discord, Telegram, or any channel.\n"
                    "- Do NOT broadcast your reasoning or ask questions in any channel.\n"
                    "- Return your answer directly to the caller. You are a sub-agent, not independent.\n"
                    "- If asked to send a Discord message, use the message tool ONLY for that specific request.\n"
                    "- Never send unsolicited messages. Never announce what tools you do or don't have."
                )
            },
            {"role": "user", "content": prompt}
        ],
        "stream": True,
        "max_tokens": 2048
    }

    # Capture references we need in the background task
    llm = params.llm
    llm_context = params.context

    log.info(f"Returning immediate ack; launching background OpenClaw call (model={escalation_model})")

    # Return immediately so Pipecat's tool timeout is satisfied
    await params.result_callback(
        {
            "success": True,
            "analysis": "Let me think about that for a moment...",
            "_async_pending": True,
        },
        properties=FunctionCallResultProperties(run_llm=True),
    )

    # ---- Background task: call OpenClaw and inject result ----
    async def _background_think():
        _start = _time.time()
        _status_sent = False
        result_text = None
        error_msg = None

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{openclaw_url}/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {openclaw_key}"},
                    timeout=aiohttp.ClientTimeout(total=timeout_seconds)
                ) as resp:
                    if resp.status == 200:
                        chunks: list[str] = []
                        async for raw_line in resp.content:
                            line = raw_line.decode("utf-8", errors="replace").strip()
                            if not line.startswith("data:"):
                                continue
                            data_str = line[len("data:"):].strip()
                            if data_str == "[DONE]":
                                break

                            # Send a status update if > 30s elapsed
                            elapsed = _time.time() - _start
                            if elapsed > 30 and not _status_sent:
                                _status_sent = True
                                log.info("OpenClaw call > 30s, injecting status update")
                                try:
                                    llm_context.add_message({
                                        "role": "assistant",
                                        "content": "Still working on that, one more moment..."
                                    })
                                    await llm.push_frame(LLMMessagesFrame(llm_context.get_messages()))
                                except Exception as _se:
                                    log.warning(f"Failed to push status frame: {_se}")

                            try:
                                chunk = json.loads(data_str)
                                delta = (
                                    chunk.get("choices", [{}])[0]
                                    .get("delta", {})
                                    .get("content")
                                )
                                if delta:
                                    chunks.append(delta)
                            except (ValueError, IndexError, KeyError):
                                continue
                        result_text = "".join(chunks) or "OpenClaw returned an empty response."
                        log.info(f"Deep thinking complete (streamed {len(chunks)} chunks, {_time.time()-_start:.1f}s)")
                    elif resp.status == 401:
                        error_msg = "I'm having trouble accessing my deep thinking module. Let me try to help with what I know."
                    elif resp.status == 402:
                        error_msg = "I can't access deeper reasoning right now due to API limits. Let me answer based on what I know."
                    else:
                        _err = await resp.text()
                        log.error(f"OpenClaw Gateway error {resp.status}: {_err[:200]}")
                        error_msg = "I'm having trouble thinking deeply right now. Let me answer with what I know."
        except asyncio.TimeoutError:
            log.error(f"OpenClaw request timed out after {timeout_seconds}s")
            error_msg = "My deep thinking request timed out. Let me answer with what I know."
        except aiohttp.ClientError as e:
            log.error(f"Network error calling OpenClaw: {e}")
            error_msg = "I can't reach my deep thinking module right now. Let me answer based on what I know."
        except Exception as e:
            log.exception(f"Unexpected error in bot_think_deeply background: {e}")
            error_msg = "Something went wrong while thinking deeply. Let me answer with what I know."

        # Inject the result (or error) into the conversation and trigger a new LLM turn
        answer = result_text or error_msg or "I wasn't able to get a result."

        # Cache for dedup
        if result_text:
            _think_deeply_cache[dedup_key] = (_time.time(), {"success": True, "analysis": result_text})

        try:
            # Add the result as a system message so the LLM can speak it
            llm_context.add_message({
                "role": "user",
                "content": (
                    f"[DEEP THINKING RESULT — speak this to the user naturally, "
                    f"do not say 'here are the results' just convey the information]: {answer}"
                )
            })
            await llm.push_frame(LLMMessagesFrame(llm_context.get_messages()))
            log.info("Injected deep thinking result into pipeline")
        except Exception as _inj_err:
            log.error(f"Failed to inject deep thinking result: {_inj_err}")

    asyncio.create_task(_background_think())
