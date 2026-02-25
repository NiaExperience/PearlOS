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


async def _openclaw_task(prompt: str, log, timeout: int = 60) -> str | None:
    """Fire a synchronous sub-agent call to OpenClaw and return the text result."""
    payload = {
        "model": os.getenv("BOT_ESCALATION_MODEL", "anthropic/claude-opus-4-6"),
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
    from pipecat.frames.frames import LLMMessagesFrame

    arguments = params.arguments or {}
    limit = arguments.get("limit", 5)
    log = bind_tool_logger(params, tag="[task_feedback]")

    log.info("Listing recent tasks with feedback status", limit=limit)

    # Return immediate ack, then fetch in background
    await params.result_callback(
        {
            "success": True,
            "user_message": "Let me check the recent tasks...",
            "_async_pending": True,
        },
        properties=FunctionCallResultProperties(run_llm=True),
    )

    llm = params.llm
    llm_context = params.context

    async def _fetch_tasks():
        prompt = (
            f"Read memory/task-feedback.md and memory/activity-log.md. "
            f"List the {limit} most recent tasks/sub-agent completions with their feedback status. "
            f"For each task, indicate: task name, when it ran, and whether it has feedback (positive/negative/none). "
            f"Format as a natural spoken summary — no markdown, no bullet lists. "
            f"Example: 'The voice latency analysis from this morning has no feedback yet. "
            f"The Pearl avatar fix was marked as correct. The Discord bot restart had negative feedback "
            f"about timeout issues.' If no tasks or feedback found, say so naturally."
        )
        result = await _openclaw_task(prompt, log, timeout=30)
        answer = result or "I couldn't retrieve the task list right now."

        try:
            llm_context.add_message({
                "role": "user",
                "content": (
                    f"[TASK FEEDBACK RESULTS — speak this naturally to the user]: {answer}"
                ),
            })
            await llm.push_frame(LLMMessagesFrame(llm_context.get_messages()))
            log.info("Injected task list into pipeline")
        except Exception as e:
            log.error(f"Failed to inject task list: {e}")

    asyncio.create_task(_fetch_tasks())
