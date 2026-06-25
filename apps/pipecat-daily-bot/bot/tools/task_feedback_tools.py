"""Voice-mode task feedback tools.

Allows users to give feedback on completed tasks entirely via voice:
  - bot_thumbs_up_task: mark a task as correct
  - bot_task_feedback: submit negative feedback with details
  - bot_list_recent_tasks: list recent tasks and their feedback status

These tools delegate to OpenClaw Gateway for storage and retrieval,
using the same HTTP pattern as openclaw_tools.py.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid

import aiohttp
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_OPENCLAW_URL = lambda: os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
_OPENCLAW_KEY = lambda: os.getenv("OPENCLAW_API_KEY", "openclaw-local")
_TASKS_API = lambda: os.getenv("PEARL_TASKS_API", os.getenv("BOT_GATEWAY_URL", "http://localhost:4444").rstrip("/") + "/api/tasks")
_TASKS_SECRET = lambda: os.getenv("BOT_CONTROL_SHARED_SECRET", "") or os.getenv("PEARL_TASKS_BOT_SECRET", "")


async def _openclaw_task(prompt: str, log, timeout: int = 60) -> str | None:
    """Fire a synchronous sub-agent call to OpenClaw and return the text result."""
    payload = {
        "model": "openclaw",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a sub-agent handling task feedback storage. "
                    "Respond with a brief natural-language confirmation. "
                    "No markdown, no bullet lists. Keep it to 1-2 sentences.\n\n"
                    "CRITICAL: Do NOT send messages to any channel. Return your answer directly."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "max_tokens": 512,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{_OPENCLAW_URL()}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {_OPENCLAW_KEY()}"},
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("choices", [{}])[0].get("message", {}).get("content", "")
                else:
                    log.error("OpenClaw feedback call failed", status=resp.status)
                    return None
    except Exception as e:
        log.exception(f"OpenClaw feedback error: {e}")
        return None


async def _list_recent_queue_tasks(limit: int, log) -> str | None:
    headers = {"Accept": "application/json"}
    secret = _TASKS_SECRET()
    if secret:
        headers["X-Bot-Secret"] = secret
        headers["Authorization"] = f"Bearer {secret}"
    base = _TASKS_API().rstrip("/")
    try:
        async with aiohttp.ClientSession(headers=headers) as session:
            tasks: list[dict] = []
            for status in ("completed", "failed", "in_progress", "pending"):
                async with session.get(
                    base,
                    params={"status": status, "limit": max(limit, 5)},
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status != 200:
                        log.error("Task queue lookup failed", status=resp.status)
                        return None
                    data = await resp.json()
                    tasks.extend(data.get("tasks") or [])
        tasks.sort(key=lambda t: t.get("completed_at") or t.get("timestamp_updated") or t.get("timestamp_created") or "", reverse=True)
        tasks = tasks[:limit]
        if not tasks:
            return "I do not see any recent queued tasks yet."
        parts: list[str] = []
        for task in tasks:
            title = str(task.get("title") or "Untitled task")
            status = str(task.get("status") or "unknown").replace("_", " ")
            result = str(task.get("result") or "").strip()
            if len(result) > 180:
                result = result[:177].rstrip() + "..."
            if result and status in ("completed", "failed"):
                parts.append(f"{title} is {status}: {result}")
            else:
                parts.append(f"{title} is {status}.")
        return " ".join(parts)
    except Exception as e:
        log.exception(f"Task queue lookup error: {e}")
        return None


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@bot_tool(
    name="bot_thumbs_up_task",
    description=(
        "Mark a completed task as correct (thumbs up). "
        "Use when the user says a task worked correctly, was good, or wants to approve it. "
        "Examples: 'that task was good', 'mark it as correct', 'thumbs up on that'."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": (
                    "Task identifier or descriptive name. Can be a job ID, "
                    "task name, or description of what the task was about."
                ),
            },
        },
        "required": ["task_id"],
    },
)
async def bot_thumbs_up_task(params: FunctionCallParams):
    """Mark a completed task as correct."""
    arguments = params.arguments or {}
    task_id = arguments.get("task_id", "").strip()
    log = bind_tool_logger(params, tag="[task_feedback]").bind(task_id=task_id)

    if not task_id:
        await params.result_callback(
            {"success": False, "user_message": "Which task would you like to mark as correct?"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    feedback_id = f"fb-{uuid.uuid4().hex[:8]}"
    log.info("Recording positive feedback", feedback_id=feedback_id)

    # Store via OpenClaw sub-agent (writes to memory/activity-log or a feedback store)
    prompt = (
        f"Record positive feedback (thumbs up) for task: '{task_id}'. "
        f"Feedback ID: {feedback_id}. Source: voice. "
        f"Append to memory/task-feedback.md with timestamp. "
        f"Format: [timestamp] ✅ POSITIVE | task='{task_id}' | id={feedback_id} | source=voice"
    )
    asyncio.create_task(_openclaw_task(prompt, log))

    await params.result_callback(
        {
            "success": True,
            "feedback_id": feedback_id,
            "task_id": task_id,
            "rating": "positive",
            "user_message": f"Got it, I've marked '{task_id}' as correct.",
        },
        properties=FunctionCallResultProperties(run_llm=True),
    )


@bot_tool(
    name="bot_task_feedback",
    description=(
        "Submit feedback for a task that didn't work correctly (thumbs down). "
        "Use when the user says a task was wrong, didn't work, had issues, or wants to report a bug. "
        "Examples: 'that task was wrong', 'the voice analysis didn't work', "
        "'report a bug with the avatar fix', 'mark that as incorrect'."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": (
                    "Task identifier or descriptive name. Can be a job ID, "
                    "task name, or description of what the task was about."
                ),
            },
            "feedback_text": {
                "type": "string",
                "description": (
                    "What went wrong — the user's description of the issue. "
                    "This is typically transcribed from voice."
                ),
            },
            "severity": {
                "type": "string",
                "enum": ["low", "medium", "high"],
                "description": "How severe the issue is. Defaults to medium.",
                "default": "medium",
            },
        },
        "required": ["task_id", "feedback_text"],
    },
)
async def bot_task_feedback(params: FunctionCallParams):
    """Submit negative feedback for a task with voice-transcribed details."""
    arguments = params.arguments or {}
    task_id = arguments.get("task_id", "").strip()
    feedback_text = arguments.get("feedback_text", "").strip()
    severity = arguments.get("severity", "medium")
    log = bind_tool_logger(params, tag="[task_feedback]").bind(task_id=task_id)

    if not task_id:
        await params.result_callback(
            {"success": False, "user_message": "Which task are you giving feedback on?"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    if not feedback_text:
        await params.result_callback(
            {"success": False, "user_message": "What went wrong with the task?"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    feedback_id = f"fb-{uuid.uuid4().hex[:8]}"
    log.info("Recording negative feedback", feedback_id=feedback_id, severity=severity)

    # Store via OpenClaw sub-agent
    prompt = (
        f"Record negative feedback for task: '{task_id}'. "
        f"Feedback ID: {feedback_id}. Severity: {severity}. Source: voice. "
        f"User feedback: \"{feedback_text}\"\n"
        f"Append to memory/task-feedback.md with timestamp. "
        f"Format: [timestamp] ❌ NEGATIVE | task='{task_id}' | id={feedback_id} | "
        f"severity={severity} | source=voice | notes: {feedback_text}"
    )
    asyncio.create_task(_openclaw_task(prompt, log))

    await params.result_callback(
        {
            "success": True,
            "feedback_id": feedback_id,
            "task_id": task_id,
            "rating": "negative",
            "severity": severity,
            "user_message": (
                f"I've logged your feedback about '{task_id}'. "
                f"Severity marked as {severity}. Would you like to escalate this?"
            ),
        },
        properties=FunctionCallResultProperties(run_llm=True),
    )


@bot_tool(
    name="bot_list_recent_tasks",
    description=(
        "List recent completed tasks and their feedback status. "
        "Use when the user asks to see tasks, review what's been done, "
        "check feedback status, or find tasks that need feedback. "
        "Examples: 'show me recent tasks', 'what tasks need feedback', "
        "'list completed tasks'."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Max number of tasks to return. Defaults to 5.",
                "default": 5,
            },
        },
        "required": [],
    },
)
async def bot_list_recent_tasks(params: FunctionCallParams):
    """List recent tasks and their feedback status via OpenClaw."""
    from tools.openclaw_tools import _queue_llm_messages

    arguments = params.arguments or {}
    limit = arguments.get("limit", 5)
    log = bind_tool_logger(params, tag="[task_feedback]")

    log.info("Listing recent tasks with feedback status", limit=limit)

    # Return immediate ack, then fetch in background
    await params.result_callback(
        {
            "success": True,
            "user_message": "Checking recent tasks.",
            "_async_pending": True,
        },
        properties=FunctionCallResultProperties(run_llm=True),
    )

    room_url = getattr(params, "room_url", None)

    async def _fetch_tasks():
        answer = await _list_recent_queue_tasks(int(limit or 5), log)
        if not answer:
            prompt = (
                f"Read memory/task-feedback.md and memory/activity-log.md. "
                f"List the {limit} most recent tasks/sub-agent completions with their feedback status. "
                f"For each task, indicate: task name, when it ran, and whether it has feedback "
                f"(positive/negative/none). Format as a natural spoken summary — no markdown, "
                f"no bullet lists. If no tasks or feedback found, say so naturally."
            )
            result = await _openclaw_task(prompt, log, timeout=30)
            answer = result or "I couldn't retrieve the task list right now."

        try:
            ok = await _queue_llm_messages(
                room_url,
                [{
                    "role": "user",
                    "content": (
                        f"[TASK FEEDBACK RESULTS — speak this naturally to the user]: {answer}"
                    ),
                }],
                run_after=True,
            )
            if ok:
                log.info("Injected task list into pipeline")
            else:
                log.error("Failed to inject task list: no flow_manager/task for room")
        except Exception as e:
            log.error(f"Failed to inject task list: {e}")

    asyncio.create_task(_fetch_tasks())
