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

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
import asyncio
import json
import os
import aiohttp
from typing import Any


SPECIALTY_SWARMS_UPDATED_AT = "2026-05-14"
SPECIALTY_SWARMS = (
    ("Legal", ("legal", "contract", "compliance", "gdpr", "lawsuit", "nda", "policy"), ("Legal analyst", "Risk reviewer", "Policy researcher")),
    ("Medical", ("medical", "clinical", "diagnos", "patient", "pharma", "health"), ("Medical researcher", "Clinical safety reviewer", "Evidence analyst")),
    ("Design", ("design", "brand", "visual", "ui", "ux", "logo", "sprite", "creative"), ("Design lead", "Interaction reviewer", "Visual QA")),
    ("Code", ("code", "bug", "fix", "refactor", "api", "component", "deploy", "build"), ("Code implementer", "Regression reviewer", "Release verifier")),
    ("Science", ("science", "scientific", "biology", "chemistry", "physics", "experiment"), ("Science researcher", "Methods reviewer", "Evidence analyst")),
    ("Research", ("research", "investigate", "analyze", "audit", "compare", "survey"), ("Research lead", "Source checker", "Synthesis writer")),
    ("Writing", ("write", "draft", "edit", "copy", "essay", "story", "article"), ("Writer", "Editor", "Tone reviewer")),
    ("Marketing", ("marketing", "campaign", "positioning", "audience", "launch", "sales"), ("Marketing strategist", "Audience researcher", "Copy reviewer")),
)

MULTI_ORB_SWARM_AGENTS = ("Codex", "Claude CLI", "Kimi 2.6", "Gemini", "DeepSeek4Pro")

SWARM_INTENT_TERMS = (
    "agency",
    "agent team",
    "agents",
    "multi agent",
    "multi-agent",
    "openrouter",
    "swarm",
)

SWARM_WORK_TERMS = (
    "accounting database",
    "build a site",
    "build a website",
    "create a site",
    "create a website",
    "deploy a site",
    "deploy a website",
    "full build",
    "make a site",
    "make a website",
)


def _merged_swarm_agents(agents: tuple[str, ...] = ()) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for agent in (*agents, *MULTI_ORB_SWARM_AGENTS):
        key = agent.lower()
        if key not in seen:
            merged.append(agent)
            seen.add(key)
    return merged[:8]


def _choose_task_agents(task: str) -> tuple[str, list[str], str]:
    text = (task or "").lower()
    for category, keywords, agents in SPECIALTY_SWARMS:
        if any(keyword in text for keyword in keywords):
            return "swarm", _merged_swarm_agents(agents), category
    if any(term in text for term in SWARM_INTENT_TERMS) or any(term in text for term in SWARM_WORK_TERMS):
        return "swarm", list(MULTI_ORB_SWARM_AGENTS), "The Agency"
    return "task", ["Pearl agent"], "The Agency"


def _usable_identity(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = value.strip()
    if not cleaned or cleaned.lower() in {"anonymous", "null", "none", "undefined"}:
        return ""
    return cleaned


def _normalize_mapping(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _identity_from_participant_meta(meta: Any) -> dict[str, str]:
    if not isinstance(meta, dict):
        return {}

    candidates: list[dict[str, Any]] = []
    info = _normalize_mapping(meta.get("info"))
    user_data = _normalize_mapping(meta.get("userData"))
    client_data = _normalize_mapping(meta.get("clientData"))
    if info:
        candidates.append(info)
        info_user_data = _normalize_mapping(info.get("userData"))
        if info_user_data:
            candidates.append(info_user_data)
        info_client_data = _normalize_mapping(info.get("clientData"))
        if info_client_data:
            candidates.append(info_client_data)
    if user_data:
        candidates.append(user_data)
    if client_data:
        candidates.append(client_data)
    candidates.append(meta)

    identity: dict[str, str] = {}
    for candidate in candidates:
        user_id = _usable_identity(
            candidate.get("sessionUserId")
            or candidate.get("userId")
            or candidate.get("user_id")
        )
        email = _usable_identity(
            candidate.get("sessionUserEmail")
            or candidate.get("email")
            or candidate.get("userEmail")
        )
        tenant_id = _usable_identity(candidate.get("tenantId") or candidate.get("tenant_id"))
        if user_id and not identity.get("sessionUserId"):
            identity["sessionUserId"] = user_id
        if email and not identity.get("sessionUserEmail"):
            identity["sessionUserEmail"] = email
        if tenant_id and not identity.get("tenantId"):
            identity["tenantId"] = tenant_id
        if identity.get("sessionUserId") and identity.get("sessionUserEmail"):
            break
    return identity


def _identity_from_daily_participants() -> dict[str, str]:
    """Last-resort identity lookup from live Daily participant metadata."""
    try:
        try:
            from core.transport import get_managers, get_participants_from_transport
        except ImportError:
            from bot.core.transport import get_managers, get_participants_from_transport

        identities: list[dict[str, str]] = []
        participants = get_participants_from_transport()
        if isinstance(participants, dict):
            for pid, meta in participants.items():
                if pid == "local":
                    continue
                identity = _identity_from_participant_meta(meta)
                if identity:
                    identities.append(identity)

        managers = get_managers()
        identity_manager = getattr(managers, "identity_manager", None) if managers else None
        participant_map = getattr(identity_manager, "participant_identity_map", None)
        if isinstance(participant_map, dict):
            for pid, mapped in participant_map.items():
                if pid == "local":
                    continue
                identity = _identity_from_participant_meta(mapped)
                if identity:
                    identities.append(identity)

        for identity in identities:
            if _usable_identity(identity.get("sessionUserId")) or _usable_identity(identity.get("sessionUserEmail")):
                return identity
    except Exception:
        return {}
    return {}


async def _queue_llm_messages(
    room_url: str | None,
    messages: list[dict],
    *,
    run_after: bool = True,
) -> bool:
    """Append messages to the active LLM context and (optionally) trigger a run.

    Background tools (bot_think_deeply, task_feedback list, etc.) need to push
    their async result back into the live voice conversation after their
    synchronous result_callback has already returned. The right hook is the
    flow_manager's pipeline task — the same path session/managers.py uses for
    REST tool-result injection. `params.context` is unreliable here because the
    toolbox wrapper substitutes a HandlerContext (no add_message) when pipecat
    doesn't pass an LLM context through.
    """
    if not room_url or not messages:
        return False
    try:
        from flows.registry import get_flow_manager
        from pipecat.frames.frames import LLMMessagesAppendFrame, LLMRunFrame

        flow_manager = get_flow_manager(room_url)
        if not flow_manager:
            return False
        task = getattr(flow_manager, "task", None)
        if not task or not hasattr(task, "queue_frames"):
            return False

        frames: list = [LLMMessagesAppendFrame(messages=list(messages))]
        if run_after:
            frames.append(LLMRunFrame())
        await task.queue_frames(frames)
        return True
    except Exception:
        return False




@bot_tool(
    name="bot_openclaw_task",
    description=(
        "Background OpenClaw task. Results show in UI, NOT spoken back. "
        "For results you need to speak, use bot_think_deeply instead."
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
    """Queue background work through PearlOS /api/tasks.

    This keeps voice on the same agent path as web chat and Discord. The old
    implementation streamed directly to OpenClaw, which bypassed pearl-worker
    and could not reliably send cross-channel messages.
    """
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

    control_base = os.getenv("BOT_CONTROL_BASE_URL", "http://127.0.0.1:4444").rstrip("/")
    token = (
        os.getenv("BOT_CONTROL_SHARED_SECRET")
        or os.getenv("OPENCLAW_GATEWAY_TOKEN")
        or os.getenv("OPENCLAW_API_KEY")
        or ""
    )
    payload = {
        "task": task,
        "source": "voice",
        "created_by": "pearl",
        "assignee": "claude_cli",
        "urgency": "urgent" if urgency == "high" else "normal",
    }
    session_user_id = _usable_identity(os.getenv("BOT_SESSION_USER_ID"))
    session_user_email = _usable_identity(os.getenv("BOT_SESSION_USER_EMAIL"))
    session_tenant_id = _usable_identity(os.getenv("BOT_SESSION_TENANT_ID") or os.getenv("DEFAULT_TENANT_ID"))
    if not session_user_id or not session_user_email:
        fallback_identity = _identity_from_daily_participants()
        session_user_id = session_user_id or _usable_identity(fallback_identity.get("sessionUserId"))
        session_user_email = session_user_email or _usable_identity(fallback_identity.get("sessionUserEmail"))
        session_tenant_id = session_tenant_id or _usable_identity(fallback_identity.get("tenantId"))
        if session_user_id or session_user_email:
            log.info(
                "Resolved voice task requester from Daily participant metadata",
                hasUserId=bool(session_user_id),
                hasEmail=bool(session_user_email),
            )
    if session_user_id:
        payload["requester_user_id"] = session_user_id
    if session_user_email:
        payload["requester_email"] = session_user_email
    if session_tenant_id:
        payload["requester_tenant_id"] = session_tenant_id
    kind, agents, swarm_category = _choose_task_agents(task)
    payload.update({
        "kind": kind,
        "agents": agents,
        "swarm_category": swarm_category,
    })
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["x-bot-secret"] = token

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{control_base}/api/tasks",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                body = await resp.text()
                if resp.status >= 300:
                    log.error("PearlOS task queue rejected voice task", status=resp.status, error=body[:200])
                    await params.result_callback(
                        {
                            "success": False,
                            "error": f"task_queue_http_{resp.status}",
                            "user_message": "I cannot reach the task queue right now.",
                        },
                        properties=FunctionCallResultProperties(run_llm=True),
                    )
                    return
                data = json.loads(body)
                task_record = data.get("task") or {}
    except Exception as e:
        log.exception(f"PearlOS task queue error: {e}")
        await params.result_callback(
            {
                "success": False,
                "error": "task_queue_error",
                "user_message": "I cannot reach the task queue right now.",
            },
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    _task_result = {
        "success": True,
        "task_id": task_record.get("id"),
        "task": task_record,
        "user_message": "The Agency task is queued.",
    }
    # Cache for dedup
    _think_deeply_cache[dedup_key_task] = (_time.time(), _task_result)

    await params.result_callback(
        _task_result,
        properties=FunctionCallResultProperties(run_llm=True),
    )

    task_id = task_record.get("id")
    room_url = getattr(params, "room_url", None)
    if task_id and room_url and task_id not in _monitored_task_ids:
        _monitored_task_ids.add(task_id)

        async def _watch_task_result():
            try:
                try:
                    followup_seconds = max(5, int(os.getenv("VOICE_TASK_FOLLOWUP_SECONDS", "15")))
                except ValueError:
                    followup_seconds = 15
                async with aiohttp.ClientSession() as session:
                    for _ in range(120):
                        await asyncio.sleep(followup_seconds)
                        async with session.get(
                            f"{control_base}/api/tasks/{task_id}",
                            headers=headers,
                            timeout=aiohttp.ClientTimeout(total=10),
                        ) as resp:
                            if resp.status >= 300:
                                continue
                            data = await resp.json()
                            watched = data.get("task") or {}
                        status = watched.get("status")
                        result = (watched.get("result") or "").strip()
                        if status in {"completed", "failed", "cancelled"}:
                            if not result:
                                result = f"The task finished with status {status}."
                            ok = await _queue_llm_messages(
                                room_url,
                                [{
                                    "role": "system",
                                    "content": (
                                        "A background task you delegated during this voice call has finished. "
                                        f"Task: {task}\n"
                                        f"Status: {status}\n"
                                        f"Result: {result}\n\n"
                                        "Tell the user the result naturally and briefly. If it failed, say what failed "
                                        "and what the next concrete recovery step is."
                                    ),
                                }],
                                run_after=True,
                            )
                            if not ok:
                                log.warning("Task result completed but could not be injected into voice call", task_id=task_id)
                            return
                        status_word = "running" if status == "in_progress" else "queued" if status == "pending" else (status or "still active")
                        ok = await _queue_llm_messages(
                            room_url,
                            [{
                                "role": "system",
                                "content": (
                                    "A background task you delegated during this voice call is not finished yet. "
                                    f"Task: {task}\n"
                                    f"Status: {status_word}\n\n"
                                    "Give the user a very brief natural update only if it is useful in the conversation. "
                                    "Do not mention task IDs, run IDs, hashes, or internal system identifiers. "
                                    "If you update them, say you are still watching it and will bring back the result."
                                ),
                            }],
                            run_after=True,
                        )
                        if not ok:
                            log.warning("Task progress checkpoint could not be injected into voice call", task_id=task_id)
            except Exception as e:
                log.warning(f"Task result watcher failed: {e}", task_id=task_id)
            finally:
                _monitored_task_ids.discard(task_id)

        asyncio.create_task(_watch_task_result())


# ---------------------------------------------------------------------------
# Dedup cache for bot_think_deeply to prevent duplicate Discord messages
# when multiple voice sessions or retries hit OpenClaw simultaneously.
# Key: normalized question text, Value: (timestamp, result)
# ---------------------------------------------------------------------------
_think_deeply_cache: dict[str, tuple[float, dict]] = {}
_THINK_DEEPLY_DEDUP_WINDOW = 30  # seconds
_monitored_task_ids: set[str] = set()


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
        "Connect to OpenClaw backend for: messaging (Discord/Telegram), web search, file access, "
        "deep analysis. Result is spoken back to user. NOT for PearlOS ops (notes, YouTube)."
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
    from pipecat.frames.frames import LLMMessagesAppendFrame, LLMRunFrame

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

    escalation_model = os.getenv("BOT_ESCALATION_MODEL", "") or "anthropic/claude-opus-4.6"

    try:
        timeout_seconds = int(os.getenv("BOT_ESCALATION_TIMEOUT", "90"))
    except (ValueError, TypeError):
        timeout_seconds = 90

    prompt = f"Context: {context}\n\nQuestion: {question}" if context else question

    payload = {
        "model": "openclaw",
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

    # Capture references we need in the background task. We use the
    # flow_manager's pipeline task to queue frames rather than relying on
    # `params.context`, because the toolbox wrapper sometimes substitutes a
    # HandlerContext (which has no add_message). The flow_manager path is the
    # same one session/managers.py uses for REST tool result injection.
    room_url = getattr(params, "room_url", None)

    log.info(f"Launching background OpenClaw call without spoken filler (model={escalation_model})")

    # Return immediately so Pipecat's tool timeout is satisfied
    await params.result_callback(
        {
            "success": True,
            "analysis": "deep_analysis_pending",
            "_async_pending": True,
        },
        properties=FunctionCallResultProperties(run_llm=False),
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

                            # Do not inject generic spoken status while waiting.
                            elapsed = _time.time() - _start
                            if elapsed > 30 and not _status_sent:
                                _status_sent = True
                                log.info("OpenClaw call > 30s; staying silent until concrete result")

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
                        error_msg = "Let me approach this a different way."
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
            # Inject the result as a system message and trigger an LLM run so
            # the bot speaks the answer. We queue frames on the pipeline task
            # rather than mutating an LLM context object, because the params
            # object passed to background tools doesn't reliably expose the
            # active OpenAILLMContext.
            ok = await _queue_llm_messages(
                room_url,
                [{
                    "role": "user",
                    "content": (
                        f"[DEEP THINKING RESULT — speak this to the user naturally, "
                        f"do not say 'here are the results' just convey the information]: {answer}"
                    ),
                }],
                run_after=True,
            )
            if ok:
                log.info("Injected deep thinking result into pipeline")
            else:
                log.error("Failed to inject deep thinking result: no flow_manager/task for room")
        except Exception as _inj_err:
            log.error(f"Failed to inject deep thinking result: {_inj_err}")

    asyncio.create_task(_background_think())
