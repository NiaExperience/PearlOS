import os
import json
import time
import uuid
import hashlib
import hmac
import base64
import asyncio
import csv
import re
import zlib
import html
import zipfile
import xml.etree.ElementTree as ET
from collections import OrderedDict
import urllib.request
from urllib.parse import urlparse
import redis
import aiohttp

# Load dotenv files without overriding real process env.
# Priority:
# 1) exported process env / container env (highest)
# 2) apps/pipecat-daily-bot/.env.local
# 3) apps/pipecat-daily-bot/.env
try:
    from dotenv import load_dotenv
    env_dir = os.path.join(os.path.dirname(__file__), '..')
    # Preserve exported process env first, then allow .env.local to beat .env.
    load_dotenv(os.path.join(env_dir, '.env.local'), override=False)
    load_dotenv(os.path.join(env_dir, '.env'), override=False)
except ImportError:
    pass

from fastapi import FastAPI, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator
from typing import Optional, Dict, Any
from loguru import logger

from tools.logging_utils import bind_context_logger

from auth import AUTH_REQUIRED, require_auth, require_strict_auth
from budget_guard import estimate_cents, reserve_tenant_budget_async

from rate_limit import (
    apply_general_rate_limit,
    add_rate_limit_info,
    check_codex_rate_limit,
    release_codex_rate_limit,
)

try:
    from room.state import (
        get_active_note_id,
        get_active_note_owner,
        get_active_applet_id,
        get_active_applet_owner,
        set_active_note_id,
        set_active_applet_id,
    )
except ImportError:
    logger.warning("Unable to import room state functions in gateway")
    async def get_active_note_id(room_url: str): return None
    async def get_active_note_owner(room_url: str): return None
    async def get_active_applet_id(room_url: str): return None
    async def get_active_applet_owner(room_url: str): return None
    async def set_active_note_id(room_url: str, note_id: str | None, owner: str | None = None): return None
    async def set_active_applet_id(room_url: str, applet_id: str | None, owner: str | None = None): return None


# ---------------------------------------------------------------------------
# Persistent default room — created/reused on startup so the bot is always
# available without the frontend needing to create a room first.
# ---------------------------------------------------------------------------
_default_room_url: str | None = None
_default_room_token: str | None = None

DAILY_API_KEY = os.getenv("DAILY_API_KEY", "")
DAILY_DOMAIN = os.getenv("DAILY_DOMAIN", "pearlos")  # e.g. "pearlos" → pearlos.daily.co
DEFAULT_ROOM_NAME = os.getenv("DEFAULT_ROOM_NAME", "pearl-default")


async def _ensure_persistent_room() -> str:
    """Create or reuse a persistent Daily room named DEFAULT_ROOM_NAME.

    Returns the full room URL (e.g. https://pearlos.daily.co/pearl-default).
    """
    if not DAILY_API_KEY:
        raise RuntimeError("DAILY_API_KEY is required for auto-room creation")

    room_url = f"https://{DAILY_DOMAIN}.daily.co/{DEFAULT_ROOM_NAME}"
    headers = {
        "Authorization": f"Bearer {DAILY_API_KEY}",
        "Content-Type": "application/json",
    }

    async with aiohttp.ClientSession() as session:
        # Check if the room already exists
        async with session.get(
            f"https://api.daily.co/v1/rooms/{DEFAULT_ROOM_NAME}",
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status == 200:
                logger.info(f"[auto-room] Persistent room already exists: {room_url}")
                return room_url

        # Create the room with no expiration (persistent)
        create_body = {
            "name": DEFAULT_ROOM_NAME,
            "privacy": "public",
            "properties": {
                "exp": None,                # never expires
                "enable_chat": True,
                "enable_screenshare": True,
                "start_video_off": True,
                "start_audio_off": True,
                "enable_transcription": "deepgram:nova-2-general",
            },
        }
        async with session.post(
            "https://api.daily.co/v1/rooms",
            headers=headers,
            json=create_body,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status in (200, 201):
                data = await resp.json()
                logger.info(f"[auto-room] Created persistent room: {data.get('url', room_url)}")
                return data.get("url", room_url)
            else:
                txt = await resp.text()
                raise RuntimeError(f"Failed to create Daily room: {resp.status} {txt}")


async def _auto_join_default_room():
    """Ensure persistent room exists, generate a token, and launch the bot."""
    global _default_room_url, _default_room_token

    try:
        _default_room_url = await _ensure_persistent_room()
        logger.info(f"[auto-room] Default room URL: {_default_room_url}")

        # Generate a bot token for the room
        from providers.daily import create_daily_room_token
        _default_room_token = await create_daily_room_token(_default_room_url)

        # Launch the bot session into the default room (direct mode)
        from runner_main import _launch_session
        body = {
            "voiceOnly": True,
            "headless": True,
            "sessionUserId": "system",
            "sessionUserName": "PearlOS",
        }
        info = await _launch_session(
            room_url=_default_room_url,
            token=_default_room_token,
            personalityId=os.getenv("BOT_PERSONALITY", "pearl").lower(),
            persona=os.getenv("BOT_PERSONA", "Pearl"),
            body=body,
        )

        # Track in active_rooms so /join and /emit-event can find it
        async with active_rooms_lock:
            active_rooms[_default_room_url] = {
                "status": "running",
                "session_id": info.id,
                "timestamp": time.time(),
                "personalityId": info.personality,
                "persona": info.persona,
                "auto_created": True,
            }

        logger.info(f"[auto-room] Bot auto-joined default room: session_id={info.id}")
    except Exception as e:
        logger.error(f"[auto-room] Failed to auto-join default room: {e}", exc_info=True)
        # Non-fatal — gateway still works, just without auto-room


from contextlib import asynccontextmanager


# ---------------------------------------------------------------------------
# Task-question watcher — turns `[QUESTION]` notes on tasks into Pearl replies
# in the user's text-chat inbox. Subscribes to the TaskStore's event bus so we
# don't poll. Each reply is written to /api/chat/inbox, where the frontend
# picks it up, renders it as a Pearl-authored chat bubble, and shows a blue
# badge on the chat button until the user opens the chat.
# ---------------------------------------------------------------------------
_QUESTION_PREFIX = "[QUESTION]"
_RESULT_TERMINAL_STATUSES = {"completed", "failed"}


_ASK_PEARL_OPENCLAW_TIMEOUT_SECS = float(
    os.getenv("ASK_PEARL_OPENCLAW_TIMEOUT_SECS", "180")
)


def _normalize_style_punctuation(text: str) -> str:
    value = str(text or "")
    value = value.replace("\\u2014", ", ").replace("\\u2013", "-")
    value = re.sub(r"\s*—+\s*", ", ", value)
    value = re.sub(r"\s+–\s+", ", ", value)
    value = value.replace("–", "-")
    value = re.sub(r"\s+,", ",", value)
    value = re.sub(r",\s{2,}", ", ", value)
    value = re.sub(r"^\s*,\s*", "", value)
    value = re.sub(r"([.!?]\s+),\s*", r"\1", value)
    return value


async def _generate_task_question_reply(
    question: str, task_title: str, task_description: str,
    task_status: str = "", task_result: str = "",
    task_notes: Optional[list] = None,
    task_agents: Optional[list] = None,
) -> Optional[str]:
    """Generate a short reply for ASK PEARL.

    Tries OpenClaw first with an ASK_PEARL_OPENCLAW_TIMEOUT_SECS budget
    (default 180s); on timeout / non-200 / exception falls back to local
    Ollama so the user always gets an answer instead of the queue stalling.
    The previous 12s budget was too tight for any tool-using reply.
    """
    # Build rich context from task metadata
    context_parts = [
        f"Task title: {task_title}",
        f"Task description: {task_description or '(none)'}",
        f"Current status: {task_status or 'unknown'}",
    ]
    if task_result:
        # Truncate long results to keep prompt manageable
        result_preview = task_result[:1000] + ("..." if len(task_result) > 1000 else "")
        context_parts.append(f"Result/output: {result_preview}")
    if task_notes:
        recent_notes = task_notes[-5:]  # Last 5 notes
        notes_text = "\n".join(
            f"  - {n.get('text', str(n))[:200]}" if isinstance(n, dict) else f"  - {str(n)[:200]}"
            for n in recent_notes
        )
        context_parts.append(f"Recent notes:\n{notes_text}")
    if task_agents:
        agents_text = ", ".join(str(a)[:50] for a in task_agents[:5])
        context_parts.append(f"Agents assigned: {agents_text}")

    task_context = "\n".join(context_parts)
    prompt = (
        "You are Pearl. The user just asked a question about one of their "
        "tasks, via the ActiveJobs widget. Reply in ONE short paragraph (2-3 "
        "sentences, plain text, no em-dashes). Open with 'Hey, saw you were "
        f"asking about the {task_title} task.' Then answer their question "
        "using the task context below. If the task has a result, summarize it. "
        "If the task is still running, say so. Be specific.\n\n"
        f"{task_context}\n\n"
        f"User's question: {question}\n"
    )
    headers = {"Content-Type": "application/json"}
    if OPENCLAW_API_KEY:
        headers["Authorization"] = f"Bearer {OPENCLAW_API_KEY}"
    primary_failed = False
    try:
        async with aiohttp.ClientSession() as session:
            resp = await session.post(
                f"{OPENCLAW_BASE_URL}/v1/chat/completions",
                json={
                    "model": "openclaw",
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                },
                headers=headers,
                timeout=aiohttp.ClientTimeout(
                    total=_ASK_PEARL_OPENCLAW_TIMEOUT_SECS,
                    sock_connect=5,
                ),
            )
            if resp.status != 200:
                logger.warning(
                    f"[task-question-watcher] OpenClaw returned {resp.status}; "
                    "trying local Ollama fallback"
                )
                primary_failed = True
            else:
                data = await resp.json()
                reply = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content")
                    or ""
                ).strip()
                if reply:
                    return _normalize_style_punctuation(reply)
                primary_failed = True
    except asyncio.TimeoutError:
        logger.warning(
            f"[task-question-watcher] OpenClaw timed out after "
            f"{_ASK_PEARL_OPENCLAW_TIMEOUT_SECS:.0f}s; trying Ollama fallback"
        )
        primary_failed = True
    except Exception as e:
        logger.warning(
            f"[task-question-watcher] OpenClaw call failed: {e}; trying Ollama fallback"
        )
        primary_failed = True

    if primary_failed:
        logger.warning("[task-question-watcher] Primary LLM failed, no fallback available")
    return None


def _extract_latest_question_note(envelope: dict) -> Optional[str]:
    """Pull the `[QUESTION] ...` text from a task-update envelope, if any."""
    patch = envelope.get("patch") or {}
    appended = patch.get("notes_append")
    if not appended:
        return None
    text = appended.get("text") if isinstance(appended, dict) else str(appended)
    if not text or not text.startswith(_QUESTION_PREFIX):
        return None
    return text[len(_QUESTION_PREFIX):].strip() or None


def _task_result_recipient(task: dict) -> Optional[str]:
    """Resolve the chat-inbox recipient for task completion summaries."""
    for key in ("requester_email", "for_user_email", "user_email"):
        value = str(task.get(key) or "").strip()
        if value:
            return value
    for env_key in ("PEARL_TASK_RESULT_USER_EMAIL", "PEARL_PRIMARY_USER_EMAIL"):
        value = os.getenv(env_key, "").strip()
        if value:
            return value
    return None


def _task_result_tenant(task: dict) -> Optional[str]:
    """Resolve the tenant scope for task completion summaries."""
    for key in ("requester_tenant_id", "tenant_id", "tenantId", "requesterTenantId"):
        value = str(task.get(key) or "").strip()
        if value:
            return value
    for env_key in ("PEARL_TASK_RESULT_TENANT_ID", "PEARL_PRIMARY_TENANT_ID"):
        value = os.getenv(env_key, "").strip()
        if value:
            return value
    return None


def _public_task_result_text(value: str, limit: int = 1400) -> str:
    text = str(value or "")
    text = re.sub(
        r"(?:file://)?/(?:srv/pearl-user-workspaces|home/deploy/pearlos|opt/pearlos|workspace/nia-universal|root/\.openclaw)/[^\s`'\"<>]+",
        lambda m: os.path.basename(m.group(0).rstrip(".,);]")) or "the generated file",
        text,
    )
    text = re.sub(r"\b(?:disp|run|swarm|task|session)-[A-Za-z0-9_.:-]{8,}\b", "the task", text)
    text = re.sub(r"\b[a-f0-9]{32,64}\b", "an internal reference", text, flags=re.I)
    text = re.sub(r"\b(?:DONE|BLOCKED)\s*:\s*", "", text, flags=re.I)
    text = re.sub(
        r"^\s*(?:current host is|host:|pm2 cwd|workdir:|sandbox:|approval:|session id:)\b.*$",
        "",
        text,
        flags=re.I | re.M,
    )
    text = re.sub(
        r"^\s*(?:changed|changed files?|files changed|verification|verification run|build output|logs?|not deployed)\s*:\s*$",
        "",
        text,
        flags=re.I | re.M,
    )
    text = re.sub(
        r"^\s*[-*]\s*(?:apps|packages|scripts|docs|config|tests|public|/workspace|/home/deploy|/opt/pearlos)/[^\n]+$",
        "",
        text,
        flags=re.I | re.M,
    )
    text = re.sub(
        r"^\s*(?:PEARLOS_[A-Z0-9_]+|npm run|npx |pm2 |git |cp |curl |su - deploy|ssh )\b[^\n]*$",
        "",
        text,
        flags=re.I | re.M,
    )
    text = re.sub(r"<tool_call>.*?</tool_call>", "", text, flags=re.I | re.S)
    text = re.sub(
        r"```(?:json|bash|sh|text|log)?\s*[\s\S]{0,2000}?```",
        lambda m: "" if re.search(r"(tool_call|exec_command|traceback|npm |pm2 |codex|sandbox|/workspace|/opt/pearlos)", m.group(0), re.I) else m.group(0),
        text,
        flags=re.I,
    )
    return " ".join(text.split())[:limit]


def _build_task_result_message(task: dict) -> str:
    title = str(task.get("title") or "that task").strip()
    status = str(task.get("status") or "").strip()
    result = _public_task_result_text(str(task.get("result") or "").strip(), 1400)
    if len(result) > 1400:
        result = result[:1397].rstrip() + "..."
    if status == "failed":
        intro = f"The {title} task hit a blocker."
    else:
        intro = f"The {title} task is done."
    if result:
        return f"{intro} {result}"
    return intro


async def _publish_task_result_to_inbox(task: dict, inbox, store) -> bool:
    task_id = str(task.get("id") or "")
    if task_id and hasattr(store, "get"):
        current = store.get(task_id)
        if current:
            task = current
    status = str(task.get("status") or "")
    if status not in _RESULT_TERMINAL_STATUSES:
        return False
    if task.get("result_notified_at"):
        return False
    if task.get("suppress_result_notification"):
        if task_id:
            store.update(task_id, {"result_notified_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())})
        return False
    result = str(task.get("result") or "").strip()
    if not result:
        return False
    recipient = _task_result_recipient(task)
    if not recipient:
        logger.warning(
            "[task-result-watcher] no recipient for completed task result; "
            "set requester_email on tasks or PEARL_TASK_RESULT_USER_EMAIL"
        )
        return False
    tenant_id = _task_result_tenant(task)
    if not tenant_id:
        logger.warning(
            "[task-result-watcher] no tenant for completed task result; "
            "set requester_tenant_id on tasks or PEARL_TASK_RESULT_TENANT_ID"
        )
        return False
    task_title = str(task.get("title") or "Task")
    entry = inbox.add(
        content=_build_task_result_message(task),
        for_user_email=recipient,
        tenant_id=tenant_id,
        task_id=task_id,
        task_title=task_title,
        kind="task_result",
    )
    if not entry:
        return False
    store.update(task_id, {"result_notified_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())})
    logger.info("[task-result-watcher] pushed terminal task result into chat inbox")
    return True


def _task_webhook_event(status: str) -> Optional[str]:
    if status == "completed":
        return "task.completed"
    if status == "failed":
        return "task.failed"
    if status == "cancelled":
        return "task.cancelled"
    return None


def _task_webhook_url() -> str:
    explicit = os.getenv("PEARLOS_TASK_WEBHOOK_API_URL", "").strip()
    if explicit:
        return explicit
    base = (
        os.getenv("NEXT_PUBLIC_INTERFACE_URL", "")
        or os.getenv("PEARLOS_INTERFACE_URL", "")
        or os.getenv("INTERFACE_URL", "")
        or "http://127.0.0.1:3000"
    ).strip().rstrip("/")
    return f"{base}/api/tasks/webhook-event"


def _task_webhook_secret() -> str:
    return (
        os.getenv("BOT_CONTROL_SHARED_SECRET", "")
        or os.getenv("PEARL_TASKS_BOT_SECRET", "")
        or os.getenv("BOT_CONTROL_CLAIMS_SECRET", "")
    ).strip()


def _post_task_webhook_event(task: dict, event: str) -> bool:
    secret = _task_webhook_secret()
    if not secret:
        logger.warning("[task-webhook] skipped: no shared secret configured")
        return False
    body_text = json.dumps({"event": event, "task": task}, separators=(",", ":"))
    timestamp = str(int(time.time()))
    signature = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{body_text}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    body = body_text.encode("utf-8")
    req = urllib.request.Request(
        _task_webhook_url(),
        method="POST",
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
            "X-Bot-Secret": secret,
            "X-PearlOS-Timestamp": timestamp,
            "X-PearlOS-Signature-256": f"sha256={signature}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        return True
    except Exception as e:
        logger.warning("[task-webhook] delivery bridge failed: %s", e)
        return False


async def _publish_task_lifecycle_webhook(task: dict, store) -> bool:
    task_id = str(task.get("id") or "")
    if task_id and hasattr(store, "get"):
        current = store.get(task_id)
        if current:
            task = current
    status = str(task.get("status") or "")
    if status not in _RESULT_TERMINAL_STATUSES and status != "cancelled":
        return False
    if task.get("webhook_notified_at"):
        return False
    if not task.get("requester_tenant_id") or not task.get("id"):
        return False
    event = _task_webhook_event(status)
    if not event:
        return False
    ok = await asyncio.to_thread(_post_task_webhook_event, task, event)
    if ok:
        store.update(task_id, {"webhook_notified_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())})
        logger.info("[task-webhook] published %s for %s", event, task_id)
    return ok


async def _publish_task_notifications_for_event(envelope: dict, inbox, store) -> None:
    """Publish terminal task notifications for task create/update events."""
    if envelope.get("event") not in ("created", "updated"):
        return
    task = envelope.get("task") or {}
    inbox_published = await _publish_task_result_to_inbox(task, inbox, store)
    await _publish_task_lifecycle_webhook(task, store)
    if inbox_published:
        try:
            recipient = _task_result_recipient(task)
            if recipient:
                _chat_log_append(
                    recipient,
                    "assistant",
                    _build_task_result_message(task),
                    tenant_id=_task_result_tenant(task),
                    user_id=str(task.get("requester_user_id") or task.get("user_id") or ""),
                )
        except Exception:
            pass


def _recent_terminal_task(task: dict, max_age_hours: float) -> bool:
    if max_age_hours <= 0:
        return False
    raw = str(task.get("completed_at") or task.get("timestamp_updated") or "")
    if not raw:
        return False
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc).timestamp() - dt.timestamp()
        return age <= max_age_hours * 3600
    except Exception:
        return False


async def _task_question_watcher_loop() -> None:
    """Long-running subscriber that converts [QUESTION] notes into chat inbox
    messages. Runs for the life of the process."""
    try:
        from api.tasks_api import get_event_bus as _get_task_bus
        from api.chat_inbox_api import get_store as _get_inbox
    except Exception as e:
        logger.warning(f"[task-question-watcher] cannot start: {e}")
        return

    queue = _get_task_bus().subscribe()
    inbox = _get_inbox()
    logger.info("[task-question-watcher] subscribed to task event bus")
    try:
        while True:
            envelope = await queue.get()
            if envelope.get("event") != "updated":
                continue
            question = _extract_latest_question_note(envelope)
            if not question:
                continue
            task = envelope.get("task") or {}
            task_id = task.get("id") or ""
            task_title = task.get("title") or task_id or "that task"
            task_description = task.get("task") or ""
            task_status = task.get("status") or ""
            task_result = task.get("result") or ""
            task_notes = task.get("notes") or []
            task_agents = task.get("agents") or []
            logger.info(
                f"[task-question-watcher] {task_id} question: {question!r}"
            )
            reply = await _generate_task_question_reply(
                question, task_title, task_description,
                task_status=task_status, task_result=task_result,
                task_notes=task_notes, task_agents=task_agents,
            )
            if not reply:
                reply = (
                    f"Hey, saw you were asking about the {task_title} task. "
                    "I do not have a reliable task update yet."
                )
            try:
                recipient = _task_result_recipient(task)
                tenant_id = _task_result_tenant(task)
                if not recipient or not tenant_id:
                    logger.warning(
                        f"[task-question-watcher] skipping reply for {task_id}: "
                        "missing requester recipient or tenant"
                    )
                    continue
                inbox.add(
                    content=reply,
                    for_user_email=recipient,
                    tenant_id=tenant_id,
                    task_id=task_id,
                    task_title=task_title,
                    kind="task_question_reply",
                )
                logger.info(
                    f"[task-question-watcher] pushed reply for {task_id} into chat inbox"
                )
            except Exception as e:
                logger.warning(
                    f"[task-question-watcher] failed to push inbox reply: {e}"
                )
    except asyncio.CancelledError:
        logger.info("[task-question-watcher] cancelled, exiting")
        raise
    except Exception as e:
        logger.error(
            f"[task-question-watcher] loop crashed: {e}", exc_info=True
        )


async def _task_result_watcher_loop() -> None:
    """Bridge task completion summaries into Pearl's visible chat inbox."""
    try:
        from api.tasks_api import get_event_bus as _get_task_bus
        from api.tasks_api import get_store as _get_tasks
        from api.chat_inbox_api import get_store as _get_inbox
    except Exception as e:
        logger.warning(f"[task-result-watcher] cannot start: {e}")
        return

    queue = _get_task_bus().subscribe()
    store = _get_tasks()
    inbox = _get_inbox()
    # Do not replay historical task completions on gateway startup by default.
    # Live task events still publish results immediately; startup replay was
    # causing old task summaries to reappear as fresh chat notifications.
    sweep_hours = float(os.getenv("PEARL_TASK_RESULT_SWEEP_HOURS", "0"))
    try:
        for task in store.list(limit=200, include_archived=False):
            if _recent_terminal_task(task, sweep_hours):
                await _publish_task_result_to_inbox(task, inbox, store)
                await _publish_task_lifecycle_webhook(task, store)
    except Exception as e:
        logger.warning(f"[task-result-watcher] startup sweep failed: {e}")

    logger.info("[task-result-watcher] subscribed to task event bus")
    try:
        while True:
            envelope = await queue.get()
            await _publish_task_notifications_for_event(envelope, inbox, store)
    except asyncio.CancelledError:
        logger.info("[task-result-watcher] cancelled, exiting")
        raise
    except Exception as e:
        logger.error(
            f"[task-result-watcher] loop crashed: {e}", exc_info=True
        )


async def _check_single_service(service_name: str, host: str, port: int):
    """Check health of a single service (TCP probe)."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=2.0
        )
        writer.close()
        await writer.wait_closed()
        logger.info(f"[service-check] ✓ {service_name} is reachable on port {port}")
    except (asyncio.TimeoutError, ConnectionRefusedError, OSError) as e:
        logger.warning(
            f"[service-check] ✗ {service_name} unreachable on port {port} - "
            f"some features may be degraded. Error: {e.__class__.__name__}"
        )


async def _check_service_health():
    """Check health of dependent services in parallel (graceful degradation - log warnings only)."""
    services = [
        ("PocketTTS", "127.0.0.1", 8766),
        ("Mesh API", "127.0.0.1", 2000),
        ("OpenClaw Gateway", "127.0.0.1", 18789),
    ]
    
    await asyncio.gather(*[
        _check_single_service(name, host, port)
        for name, host, port in services
    ])


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    # Startup: check service health
    await _check_service_health()

    # Register the task-event pub/sub with the running event loop
    task_question_watcher: Optional[asyncio.Task] = None
    task_result_watcher: Optional[asyncio.Task] = None
    try:
        from api.tasks_api import get_event_bus as _get_task_bus
        _get_task_bus().set_loop(asyncio.get_running_loop())
        logger.info("[gateway] Registered task event bus with running loop")
        task_question_watcher = asyncio.create_task(_task_question_watcher_loop())
        logger.info("[gateway] Started task-question watcher")
        task_result_watcher = asyncio.create_task(_task_result_watcher_loop())
        logger.info("[gateway] Started task-result watcher")
    except Exception as e:
        logger.warning(f"[gateway] Could not wire task event bus: {e}")

    # Startup: auto-create persistent room and join bot
    auto_room_enabled = os.getenv("AUTO_ROOM_ENABLED", "true").lower() != "false"
    if auto_room_enabled and DAILY_API_KEY:
        # Removed: asyncio.sleep(1) — runner_main modules are already imported
        # by the time lifespan runs; no delay needed.
        await _auto_join_default_room()
    else:
        logger.info("[auto-room] Auto-room disabled (AUTO_ROOM_ENABLED=false or no DAILY_API_KEY)")
    yield
    # Shutdown: close persistent aiohttp sessions
    global _daily_broadcast_session
    if _daily_broadcast_session and not _daily_broadcast_session.closed:
        await _daily_broadcast_session.close()
        _daily_broadcast_session = None
    if task_question_watcher and not task_question_watcher.done():
        task_question_watcher.cancel()
        try:
            await task_question_watcher
        except (asyncio.CancelledError, Exception):
            pass
    if task_result_watcher and not task_result_watcher.done():
        task_result_watcher.cancel()
        try:
            await task_result_watcher
        except (asyncio.CancelledError, Exception):
            pass


app = FastAPI(lifespan=lifespan)

# ---------------------------------------------------------------------------
# Mount REST API routers (work without Daily rooms)
# ---------------------------------------------------------------------------
try:
    from api.notes_api import router as notes_router
    app.include_router(notes_router, prefix="/api/notes")
    logger.info("[gateway] Mounted /api/notes REST router")
except Exception as e:
    logger.warning(f"[gateway] Failed to mount notes API: {e}")

try:
    from api.tasks_api import router as tasks_router, create_task_direct as _tasks_create_direct
    app.include_router(tasks_router, prefix="/api/tasks")
    logger.info("[gateway] Mounted /api/tasks REST router")
except Exception as e:
    logger.warning(f"[gateway] Failed to mount tasks API: {e}")
    _tasks_create_direct = None  # type: ignore[assignment]

# Swarm bridge: surfaces OpenRouter swarms as tasks in the ActiveJobs widget.
# Separate mount so failures here don't break the CLI task flow.
try:
    from api.tasks_api import swarm_router as _swarm_router
    app.include_router(_swarm_router, prefix="/api/swarm")
    logger.info("[gateway] Mounted /api/swarm REST router")
except Exception as e:
    logger.warning(f"[gateway] Failed to mount swarm API: {e}")

try:
    from api.chat_inbox_api import router as chat_inbox_router
    app.include_router(chat_inbox_router, prefix="/api/chat/inbox")
    logger.info("[gateway] Mounted /api/chat/inbox REST router")
except Exception as e:
    logger.warning(f"[gateway] Failed to mount chat inbox API: {e}")

# GlassBox archived 2026-05-13 — see archived/glassbox-2026-05-13/
logger.info("[gateway] /api/agency-chat REST router disabled")

# CORS (development convenience). In production restrict origins via env.
ALLOWED_ORIGINS = os.getenv('BOT_CORS_ORIGINS')
if ALLOWED_ORIGINS:
    origins = [o.strip() for o in ALLOWED_ORIGINS.split(',') if o.strip()]
else:
    # Sensible localhost defaults + staging/production origins
    origins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:4000',
        'http://127.0.0.1:4000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://interface.stg.nxops.net',  # Staging interface
        'https://pearlos.org',  # Production
        'https://www.pearlos.org',  # Production www
    ]
    # Auto-add RunPod proxy origins (*.proxy.runpod.net)
    import re
    runpod_pod_id = os.getenv('RUNPOD_POD_ID', '')
    if runpod_pod_id:
        for port in [3000, 4000, 5173]:
            origins.append(f'https://{runpod_pod_id}-{port}.proxy.runpod.net')

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# ---------------------------------------------------------------------------
# WebSocket event channel — allows frontends to receive nia.event envelopes
# without an active Daily.co room.
# ---------------------------------------------------------------------------

_ws_clients: dict[WebSocket, str | None] = {}  # ws -> session_id (None = global-only)
_ws_client_scopes: dict[WebSocket, set[str]] = {}  # ws -> scopes proven by signed token
_ws_client_tenants: dict[WebSocket, str | None] = {}  # ws -> tenant proven by signed token
_ws_clients_lock = asyncio.Lock()

# ---------------------------------------------------------------------------
# Replay buffer — queues recent nia.event envelopes when no WS clients are
# connected so the first canvas push isn't lost.  Replayed on client connect.
# ---------------------------------------------------------------------------
_ws_replay_buffer: list[tuple[dict, str | None, str | None]] = []  # (envelope, session_id, tenant_id)
_WS_REPLAY_MAX = 20          # max envelopes to buffer
_WS_REPLAY_MAX_AGE_S = 30    # drop buffered events older than this
_WS_SCOPED_KINDS = {"nia.event", "nia.tool_result"}
_WS_GLOBAL_SCOPES = {"global", "public", "broadcast"}
_WS_TOKEN_MAX_TTL_MS = 5 * 60 * 1000
_WS_AUTH_PROTOCOL_PREFIX = "pearlos-gateway-auth."


def _normalize_ws_session_id(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    return value or None


def _ws_token_error(status_code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)


def _decode_ws_token_body(body: str) -> Dict[str, Any]:
    padded = body + ("=" * (-len(body) % 4))
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        payload = json.loads(decoded)
    except Exception as exc:
        raise _ws_token_error(401, "invalid_gateway_ws_token") from exc
    if not isinstance(payload, dict):
        raise _ws_token_error(401, "invalid_gateway_ws_token")
    return payload


def _validate_gateway_ws_token(raw_token: Any) -> Dict[str, Any]:
    token = raw_token if isinstance(raw_token, str) else ""
    token = token.strip()
    secret = _claims_secret()
    if not token or "." not in token or not secret:
        raise _ws_token_error(401, "missing_gateway_ws_token")

    body, sig = token.rsplit(".", 1)
    if not body or not sig:
        raise _ws_token_error(401, "invalid_gateway_ws_token")

    expected_sig = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, sig):
        raise _ws_token_error(401, "invalid_gateway_ws_token_signature")

    payload = _decode_ws_token_body(body)
    if payload.get("purpose") != "gateway-ws":
        raise _ws_token_error(401, "invalid_gateway_ws_token_purpose")

    now_ms = int(time.time() * 1000)
    try:
        exp_ms = int(payload.get("exp") or 0)
        iat_ms = int(payload.get("iat") or 0)
    except (TypeError, ValueError) as exc:
        raise _ws_token_error(401, "invalid_gateway_ws_token_time") from exc
    if exp_ms < now_ms:
        raise _ws_token_error(401, "expired_gateway_ws_token")
    if exp_ms - max(iat_ms, now_ms) > _WS_TOKEN_MAX_TTL_MS:
        raise _ws_token_error(401, "gateway_ws_token_ttl_too_long")

    tenant_id = _normalize_ws_session_id(payload.get("tenantId"))
    user_id = _normalize_ws_session_id(payload.get("sessionUserId"))
    session_id = _normalize_ws_session_id(payload.get("sessionId"))
    if not tenant_id or not user_id or not session_id:
        raise _ws_token_error(401, "incomplete_gateway_ws_token")

    raw_scopes = payload.get("allowedScopes")
    allowed_scopes = {
        scope
        for scope in (
            _normalize_ws_session_id(value)
            for value in (raw_scopes if isinstance(raw_scopes, list) else [])
        )
        if scope
    }
    allowed_scopes.add(user_id)
    allowed_scopes.add(session_id)
    payload["allowedScopes"] = sorted(allowed_scopes)
    return payload


def _gateway_ws_auth_protocol(websocket: WebSocket) -> str:
    raw_protocols = websocket.headers.get("sec-websocket-protocol") or ""
    for item in raw_protocols.split(","):
        protocol = item.strip()
        if protocol.startswith(_WS_AUTH_PROTOCOL_PREFIX):
            return protocol
    return ""


def _gateway_ws_auth_token(websocket: WebSocket) -> str:
    protocol = _gateway_ws_auth_protocol(websocket)
    if not protocol:
        return ""
    return protocol[len(_WS_AUTH_PROTOCOL_PREFIX):].strip()


def _gateway_ws_allowed_scopes(claims: Dict[str, Any]) -> set[str]:
    raw = claims.get("allowedScopes")
    return {
        scope
        for scope in (
            _normalize_ws_session_id(value)
            for value in (raw if isinstance(raw, list) else [])
        )
        if scope
    }


def _gateway_ws_scope_allowed(claims: Dict[str, Any], scope: str | None) -> bool:
    normalized = _normalize_ws_session_id(scope)
    return bool(normalized and normalized in _gateway_ws_allowed_scopes(claims))


def _extract_ws_session_id(envelope: dict, session_id: str | None = None) -> str | None:
    explicit = _normalize_ws_session_id(session_id)
    if explicit:
        return explicit

    for key in (
        "session_id",
        "sessionId",
        "targetSessionUserId",
        "sessionUserId",
        "user_id",
        "userId",
    ):
        value = _normalize_ws_session_id(envelope.get(key))
        if value:
            return value

    payload = envelope.get("payload")
    if isinstance(payload, dict):
        for key in (
            "session_id",
            "sessionId",
            "targetSessionUserId",
            "sessionUserId",
            "user_id",
            "userId",
            "requester_user_id",
            "requesterUserId",
        ):
            value = _normalize_ws_session_id(payload.get(key))
            if value:
                return value
        for key in ("room_url", "roomUrl"):
            room_url = _normalize_ws_session_id(payload.get(key))
            if room_url:
                return room_url.rstrip("/").split("/")[-1].split("?")[0] or room_url
    return None


def _extract_ws_tenant_id(envelope: dict, tenant_id: str | None = None) -> str | None:
    explicit = _normalize_ws_session_id(tenant_id)
    if explicit:
        return explicit

    for key in ("tenant_id", "tenantId", "requester_tenant_id", "requesterTenantId"):
        value = _normalize_ws_session_id(envelope.get(key))
        if value:
            return value

    payload = envelope.get("payload")
    if isinstance(payload, dict):
        for key in ("tenant_id", "tenantId", "requester_tenant_id", "requesterTenantId"):
            value = _normalize_ws_session_id(payload.get(key))
            if value:
                return value
    return None


def _is_ws_global_envelope(envelope: dict, session_id: str | None = None) -> bool:
    if _extract_ws_session_id(envelope, session_id):
        return False

    scope = str(envelope.get("scope") or envelope.get("visibility") or "").strip().lower()
    if scope in _WS_GLOBAL_SCOPES or envelope.get("global") is True:
        return True

    # User-visible UI events and tool results are scoped by default. Other
    # backend/system envelopes retain broadcast compatibility.
    return envelope.get("kind") not in _WS_SCOPED_KINDS


def _ws_replay_is_stale(envelope: dict, now: float) -> bool:
    env_ts = envelope.get("ts", 0)
    try:
        env_ts_s = float(env_ts) / 1000.0
    except (TypeError, ValueError):
        return False
    if env_ts_s <= 0:
        return False
    return now - env_ts_s > _WS_REPLAY_MAX_AGE_S


def _prune_ws_replay_buffer(now: float | None = None) -> None:
    if now is None:
        now = time.time()
    _ws_replay_buffer[:] = [
        (env, sid, tid)
        for env, sid, tid in _ws_replay_buffer
        if not _ws_replay_is_stale(env, now)
    ]
    while len(_ws_replay_buffer) > _WS_REPLAY_MAX:
        _ws_replay_buffer.pop(0)


def _ws_tenant_allowed(client_tenant_id: str | None, envelope_tenant_id: str | None) -> bool:
    return not envelope_tenant_id or client_tenant_id == envelope_tenant_id


def _ws_replay_envelopes_for(client_session_id: str | None, client_tenant_id: str | None = None) -> list[dict]:
    client_session_id = _normalize_ws_session_id(client_session_id)
    client_tenant_id = _normalize_ws_session_id(client_tenant_id)
    _prune_ws_replay_buffer()
    envelopes: list[dict] = []
    for env, replay_session_id, replay_tenant_id in list(_ws_replay_buffer):
        if not _ws_tenant_allowed(client_tenant_id, replay_tenant_id):
            continue
        if replay_session_id:
            if client_session_id == replay_session_id:
                envelopes.append(env)
        elif _is_ws_global_envelope(env):
            envelopes.append(env)
    return envelopes

# ---------------------------------------------------------------------------
# Canvas HTML store — offload oversized HTML payloads for URL-based delivery
# ---------------------------------------------------------------------------
_canvas_html_store: OrderedDict[str, tuple[str, float]] = OrderedDict()  # key -> (html, timestamp)
_CANVAS_STORE_TTL = int(os.getenv("CANVAS_STORE_TTL_SECONDS", "3600"))  # 1 hour default
_CANVAS_STORE_MAX = int(os.getenv("CANVAS_STORE_MAX_ENTRIES", "100"))


def canvas_store_html(html: str) -> str:
    """Store HTML content and return a unique key for URL-based retrieval."""
    now = time.time()
    # Evict expired entries
    while _canvas_html_store:
        oldest_key, (_, ts) = next(iter(_canvas_html_store.items()))
        if now - ts > _CANVAS_STORE_TTL:
            _canvas_html_store.pop(oldest_key)
        else:
            break
    # Evict if over max
    while len(_canvas_html_store) >= _CANVAS_STORE_MAX:
        _canvas_html_store.popitem(last=False)
    key = hashlib.sha256(html.encode()).hexdigest()[:16]
    _canvas_html_store[key] = (html, now)
    return key


def _legacy_canvas_tool_to_wonder_scene(tool_name: str, params: dict | None) -> dict[str, Any]:
    """Render legacy canvas tool params as Wonder Canvas HTML.

    The frontend no longer renders canvas.render events, so gateway passthrough
    paths now downgrade these older OpenClaw canvas tools to Pearl Views briefs.
    """
    params = params or {}

    def _jsonish(value: Any, fallback: Any) -> Any:
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str) and value.strip():
            try:
                return json.loads(value)
            except Exception:
                return fallback
        return fallback

    def _esc(value: Any) -> str:
        return html.escape(str(value if value is not None else ""))

    title = _esc(params.get("title") or params.get("headline") or "Canvas")
    body = ""
    if tool_name == "bot_canvas_show_image":
        src = _esc(params.get("image_url") or "")
        caption = _esc(params.get("caption") or params.get("title") or "")
        body = (
            f'<img src="{src}" alt="{caption}" style="max-width:100%;max-height:68vh;'
            'object-fit:contain;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.35);" />'
            f'<p style="margin:16px 0 0;color:rgba(245,239,231,.72);font-size:14px;">{caption}</p>'
        ) if src else '<p>No image URL was provided.</p>'
    elif tool_name == "bot_canvas_show_article":
        source = _esc(params.get("source") or "")
        article_body = _esc(params.get("body") or params.get("url") or "")
        body = (
            f'<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#ffd46b;margin-bottom:10px;">{source}</div>'
            f'<p style="white-space:pre-wrap;line-height:1.65;color:rgba(245,239,231,.78);">{article_body}</p>'
        )
    elif tool_name == "bot_canvas_show_table":
        columns = _jsonish(params.get("columns"), [])
        rows = _jsonish(params.get("rows"), [])
        if isinstance(columns, list) and isinstance(rows, list):
            def _col_key(col: Any) -> str:
                return str(col.get("key") if isinstance(col, dict) else col)

            def _col_label(col: Any) -> str:
                if isinstance(col, dict):
                    return str(col.get("label") or col.get("key") or "")
                return str(col)

            header = "".join(
                f'<th style="text-align:left;padding:10px;border-bottom:1px solid rgba(255,255,255,.18);color:#ffd46b;">{_esc(_col_label(col))}</th>'
                for col in columns
            )
            row_html = ""
            for row in rows[:25]:
                row_html += "<tr>"
                for col in columns:
                    value = row.get(_col_key(col), "") if isinstance(row, dict) else ""
                    row_html += f'<td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">{_esc(value)}</td>'
                row_html += "</tr>"
            body = f'<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr>{header}</tr></thead><tbody>{row_html}</tbody></table>'
        else:
            body = "<p>The table data could not be parsed.</p>"
    else:
        chart_type = _esc(params.get("chart_type") or "chart")
        chart_data = _esc(json.dumps(_jsonish(params.get("chart_data"), {}), ensure_ascii=False, indent=2))
        body = (
            f'<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#ffd46b;margin-bottom:10px;">{chart_type}</div>'
            f'<pre style="white-space:pre-wrap;overflow:auto;max-height:62vh;background:rgba(255,255,255,.06);padding:14px;border-radius:10px;color:rgba(245,239,231,.78);">{chart_data}</pre>'
        )

    scene_html = (
        '<div data-wonder-app-managed style="min-height:100%;padding:34px;'
        'background:#100b18;color:#f5efe7;font-family:Inter,system-ui,sans-serif;">'
        f'<h1 style="margin:0 0 18px;font-size:30px;line-height:1.15;">{title}</h1>'
        f'{body}'
        '</div>'
    )
    return {
        "html": scene_html,
        "transition": "fade",
        "layer": "main",
    }


async def ws_broadcast(envelope: dict, session_id: str | None = None, tenant_id: str | None = None):
    """Send an envelope to connected WebSocket clients.
    
    If session_id is provided, only clients subscribed to that non-empty
    session receive the event. Unscoped clients receive global envelopes only.
    
    When no clients are connected, nia.event envelopes are buffered and
    replayed when the first client connects (solves first-push-lost race).
    """
    effective_session_id = _extract_ws_session_id(envelope, session_id)
    effective_tenant_id = _extract_ws_tenant_id(envelope, tenant_id)
    is_global = _is_ws_global_envelope(envelope, effective_session_id)
    kind = envelope.get("kind", "")
    if not _ws_clients:
        # Buffer nia.event envelopes for replay on first client connect
        if kind in _WS_SCOPED_KINDS and (effective_session_id or is_global):
            _ws_replay_buffer.append((envelope, effective_session_id, effective_tenant_id))
            _prune_ws_replay_buffer()
            logger.debug(
                f"[ws/events] No clients connected - buffered {kind} for replay "
                f"(scope={effective_session_id or 'global'}, tenant={effective_tenant_id or 'any'}, "
                f"buffer={len(_ws_replay_buffer)})"
            )
        return
    if kind in _WS_SCOPED_KINDS and not effective_session_id and not is_global:
        logger.warning(
            f"[ws/events] Dropping unscoped {kind} broadcast; set session_id "
            "or mark the envelope with scope='global' for non-user events"
        )
        return
    payload = json.dumps(envelope)
    async with _ws_clients_lock:
        dead: list[WebSocket] = []
        for ws, client_session in _ws_clients.items():
            client_tenant = _ws_client_tenants.get(ws)
            should_send = (
                client_session == effective_session_id
                if effective_session_id
                else is_global
            ) and _ws_tenant_allowed(client_tenant, effective_tenant_id)
            if should_send:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
        for ws in dead:
            _ws_clients.pop(ws, None)


@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    """WebSocket endpoint for receiving nia.event envelopes.

    Clients connect here to get the same events that would normally be
    delivered via Daily.co app-messages. Scoped user-visible events require
    the client to register a non-empty session/user scope before delivery.
    
    Session scoping: client must send a JSON message with
    {"session_id": "..."} to receive scoped user-visible events. Without it,
    only global/system events are delivered.
    """
    try:
        ws_claims = _validate_gateway_ws_token(_gateway_ws_auth_token(websocket))
    except HTTPException as exc:
        logger.warning(
            "[ws/events] rejected unauthenticated websocket",
            status=exc.status_code,
            detail=exc.detail,
        )
        await websocket.close(code=1008, reason=str(exc.detail))
        return

    await websocket.accept(subprotocol=_gateway_ws_auth_protocol(websocket))
    async with _ws_clients_lock:
        _ws_clients[websocket] = None  # Global-only until a non-empty session_id arrives
        _ws_client_scopes[websocket] = _gateway_ws_allowed_scopes(ws_claims)
        _ws_client_tenants[websocket] = _normalize_ws_session_id(ws_claims.get("tenantId"))
    logger.info(
        "[ws/events] Client connected",
        total=len(_ws_clients),
        tenantId=ws_claims.get("tenantId"),
        sessionUserId=ws_claims.get("sessionUserId"),
    )

    async def _replay_buffered_events(client_session_id: str | None = None):
        if not _ws_replay_buffer:
            return
        replayed = 0
        for env in _ws_replay_envelopes_for(client_session_id, _normalize_ws_session_id(ws_claims.get("tenantId"))):
            try:
                await websocket.send_text(json.dumps(env))
                replayed += 1
            except Exception:
                break
        if replayed:
            logger.info(
                f"[ws/events] Replayed {replayed} buffered event(s) "
                f"to scope={client_session_id or 'global'}"
            )

    # On initial connect, only replay global events. Scoped replay waits until
    # the client sends a non-empty session_id.
    await _replay_buffered_events(None)

    # Start keepalive pinger — sends a ping every 15s to detect dead clients
    async def _keepalive():
        import asyncio as _aio
        try:
            while True:
                await _aio.sleep(15)
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
        except (asyncio.CancelledError, Exception):
            pass

    keepalive_task = asyncio.create_task(_keepalive())
    try:
        while True:
            msg = await websocket.receive_text()
            # Allow clients to register their session scope
            try:
                data = json.loads(msg)
                if isinstance(data, dict) and "session_id" in data:
                    client_session_id = _normalize_ws_session_id(data.get("session_id"))
                    if not client_session_id:
                        logger.warning("[ws/events] Ignoring empty session_id registration")
                        continue
                    if not _gateway_ws_scope_allowed(ws_claims, client_session_id):
                        logger.warning(
                            "[ws/events] Closing client for unauthorized scope registration",
                            attemptedScope=client_session_id,
                            sessionUserId=ws_claims.get("sessionUserId"),
                            tenantId=ws_claims.get("tenantId"),
                        )
                        await websocket.close(code=1008, reason="scope_forbidden")
                        break
                    async with _ws_clients_lock:
                        _ws_clients[websocket] = client_session_id
                    logger.info(f"[ws/events] Client scoped to session={client_session_id}")
                    await _replay_buffered_events(client_session_id)
                # Respond to client pongs (keepalive ack) — no action needed
            except (json.JSONDecodeError, Exception):
                pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        keepalive_task.cancel()
        async with _ws_clients_lock:
            _ws_clients.pop(websocket, None)
            _ws_client_scopes.pop(websocket, None)
            _ws_client_tenants.pop(websocket, None)
        logger.info(f"[ws/events] Client disconnected, total={len(_ws_clients)}")


# ---------------------------------------------------------------------------
# Note state — tracks what note the frontend currently has open so that
# Pearl (via OpenClaw) can query it.
# ---------------------------------------------------------------------------

_note_states: Dict[str, Dict[str, Any]] = {}


class NoteStateUpdate(BaseModel):
    action: str  # 'opened' | 'updated' | 'closed'
    noteId: str | None = None
    title: str | None = None
    content: str | None = None
    viewState: str | None = None
    tenantId: str | None = None
    userId: str | None = None
    sessionId: str | None = None
    roomUrl: str | None = None


def _note_state_key(
    tenant_id: str | None,
    user_id: str | None,
    session_id: str | None = None,
    room_url: str | None = None,
) -> str | None:
    if not tenant_id or not user_id or str(user_id).lower() == "anonymous":
        return None
    room_part = room_url or session_id or "default"
    return f"{tenant_id}:{user_id}:{room_part}"


@app.post("/api/note-state", dependencies=[Depends(require_auth)])
async def post_note_state(body: NoteStateUpdate):
    """Frontend calls this when a note is opened/updated/closed."""
    key = _note_state_key(body.tenantId, body.userId, body.sessionId, body.roomUrl)
    if not key:
        raise HTTPException(status_code=400, detail="tenantId and authenticated userId are required")
    _note_states[key] = {
        "noteId": body.noteId,
        "title": body.title,
        "content": body.content,
        "viewState": body.viewState or ("document" if body.noteId else "library"),
        "action": body.action,
        "tenantId": body.tenantId,
        "userId": body.userId,
        "sessionId": body.sessionId,
        "roomUrl": body.roomUrl,
        "updatedAt": time.time(),
    }
    logger.info(f"[gateway] Note state updated: action={body.action}, noteId={body.noteId}, title={body.title}")

    # Broadcast note state as a nia.event so running bot sessions can inject LLM context
    try:
        event_map = {"opened": "note.open", "updated": "note.updated", "closed": "note.close"}
        event_name = event_map.get(body.action)
        if event_name:
            envelope = {
                "v": 1,
                "kind": "nia.event",
                "event": event_name,
                "ts": int(time.time() * 1000),
                "payload": {
                    "noteId": body.noteId,
                    "title": body.title,
                    "content": body.content,
                    "source": "gateway",
                },
            }
            await ws_broadcast({**envelope, "session_id": body.sessionId or body.roomUrl or key})
            logger.info(f"[gateway] Broadcasted {event_name} event via WebSocket")
    except Exception as e:
        logger.warning(f"[gateway] Failed to broadcast note event: {e}")

    return {"ok": True}


@app.get("/api/note-state")
async def get_note_state(
    tenantId: str | None = None,
    userId: str | None = None,
    sessionId: str | None = None,
    roomUrl: str | None = None,
):
    """Returns the current note state (what note is open in the UI)."""
    key = _note_state_key(tenantId, userId, sessionId, roomUrl)
    if not key:
        raise HTTPException(status_code=400, detail="tenantId and authenticated userId are required")
    return _note_states.get(key, {
        "noteId": None,
        "title": None,
        "content": None,
        "viewState": "library",
        "action": None,
        "tenantId": tenantId,
        "userId": userId,
        "sessionId": sessionId,
        "roomUrl": roomUrl,
        "updatedAt": None,
    })


# ---------------------------------------------------------------------------
# Chat mode — text-only interaction (no Daily call, forwards to OpenClaw)
# ---------------------------------------------------------------------------

from fastapi.responses import StreamingResponse

OPENCLAW_BASE_URL = os.getenv("OPENCLAW_BASE_URL", "http://localhost:18789")
OPENCLAW_API_KEY = os.getenv("OPENCLAW_API_KEY", "")

# ── Direct DeepSeek path (bypasses OpenClaw for web chat) ──────────
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "http://127.0.0.1:8200/v1")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_CHAT_MODEL = os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-v4-flash")
DEEPSEEK_CHAT_TIMEOUT_SECS = float(os.getenv("DEEPSEEK_CHAT_TIMEOUT_SECS", "90"))
DEEPSEEK_CHAT_READ_GAP_SECS = float(os.getenv("DEEPSEEK_CHAT_READ_GAP_SECS", "30"))

# Session key for text chat — uses a dedicated PearlOS text-chat session
# so that chat history only shows user/assistant messages from PearlOS,
# not internal TUI/agent traffic from agent:main:main.
#
# This is the BASE key. Per-user transcripts are scoped under this base
# (e.g. "agent:main:pearlos-text-chat:user:<email>") via
# _user_chat_session_key() so no two users ever share a transcript.
OPENCLAW_CHAT_SESSION_KEY = os.getenv("OPENCLAW_CHAT_SESSION_KEY", "agent:main:pearlos-text-chat")


def _normalize_user_id(raw: str) -> str:
    """Normalise an email/user identifier so it is safe inside an OpenClaw
    session key. Lowercases, strips whitespace, and rejects characters that
    would let a caller forge another user's key (only [a-z0-9._@+-] allowed).
    Returns empty string if the input is unusable.
    """
    if not raw:
        return ""
    s = raw.strip().lower()
    if not s:
        return ""
    # Allow typical email characters; drop anything else.
    safe = "".join(ch for ch in s if ch.isalnum() or ch in "._@+-")
    if safe != s:
        return ""
    if len(safe) > 254:
        return ""
    return safe


def _user_chat_session_key(request: "Request | None") -> str | None:
    """Return the per-user OpenClaw chat session key for the caller.

    Identity is taken from the `x-user-email` header that the Next.js
    interface layer sets after NextAuth verifies the browser cookie. If no
    identifying header is present (anonymous / InPrivate without a session)
    this returns None so callers can short-circuit and serve no history.
    """
    if request is None:
        return None
    raw = request.headers.get("x-user-email") or request.headers.get("x-user-id") or ""
    user_id = _normalize_user_id(raw)
    if not user_id:
        return None
    return f"{OPENCLAW_CHAT_SESSION_KEY}:user:{user_id}"


def _user_chat_session_key_from_identity(identity: str | None) -> str | None:
    user_id = _normalize_user_id(str(identity or ""))
    if not user_id:
        return None
    return f"{OPENCLAW_CHAT_SESSION_KEY}:user:{user_id}"


def _first_header(request: "Request", names: tuple[str, ...]) -> str:
    for name in names:
        value = request.headers.get(name)
        if value:
            return value.strip()
    return ""


def _discord_request_context(request: "Request", body: "ChatRequest | None" = None) -> dict[str, str]:
    """Extract Discord relay metadata from headers or request body."""
    return {
        "discord_user_id": (
            _first_header(request, ("x-discord-user-id", "x-discord-author-id", "x-author-id"))
            or ((body.discordUserId if body else None) or "").strip()
        ),
        "discord_username": (
            _first_header(request, ("x-discord-username", "x-discord-author-name", "x-author-name"))
            or ((body.discordUsername if body else None) or "").strip()
        ),
        "discord_guild_id": (
            _first_header(request, ("x-discord-guild-id", "x-guild-id"))
            or ((body.discordGuildId if body else None) or "").strip()
        ),
        "discord_channel_id": (
            _first_header(request, ("x-discord-channel-id", "x-channel-id"))
            or ((body.discordChannelId if body else None) or "").strip()
        ),
        "discord_channel_name": (
            _first_header(request, ("x-discord-channel-name", "x-channel-name"))
            or ((body.discordChannelName if body else None) or "").strip()
        ),
        "discord_message_id": (
            _first_header(request, ("x-discord-message-id", "x-message-id"))
            or ((body.discordMessageId if body else None) or "").strip()
        ),
    }


async def _resolve_discord_user_profile_context(
    request: "Request",
    body: "ChatRequest",
    latest_user_text: str,
) -> dict[str, Any]:
    """Resolve Discord author ID to PearlOS profile context and sync activity."""
    ctx = _discord_request_context(request, body)
    discord_user_id = ctx.get("discord_user_id", "")
    if not discord_user_id:
        return {}

    try:
        from actions import profile_actions
    except Exception as exc:
        logger.warning(f"[discord-memory] profile_actions unavailable: {exc}")
        return {"discord_user_id": discord_user_id}

    try:
        profile = await profile_actions.get_user_profile_by_discord_id(discord_user_id)
    except Exception as exc:
        logger.warning(f"[discord-memory] Discord profile lookup failed: {exc}")
        return {"discord_user_id": discord_user_id}

    if not profile:
        logger.info(f"[discord-memory] no PearlOS profile link for Discord user {discord_user_id}")
        return {"discord_user_id": discord_user_id}

    user_id = str(profile.get("userId") or "").strip()
    email = str(profile.get("email") or "").strip().lower()
    context_block = ""
    try:
        context_block = profile_actions.build_discord_profile_context(
            profile,
            discord_user_id=discord_user_id,
        )
    except Exception as exc:
        logger.warning(f"[discord-memory] context build failed: {exc}")

    try:
        await profile_actions.record_discord_profile_touch(
            user_id,
            discord_user_id=discord_user_id,
            discord_username=ctx.get("discord_username", ""),
            guild_id=ctx.get("discord_guild_id", ""),
            channel_id=ctx.get("discord_channel_id", ""),
            channel_name=ctx.get("discord_channel_name", ""),
            message_preview=latest_user_text,
        )
    except Exception as exc:
        logger.warning(f"[discord-memory] profile touch sync failed: {exc}")

    logger.info(
        f"[discord-memory] linked Discord user {discord_user_id} to PearlOS user "
        f"has_user_id={bool(user_id)} has_email={bool(email)}"
    )
    return {
        **ctx,
        "profile": profile,
        "user_id": user_id,
        "email": email,
        "context_block": context_block,
    }


def _profile_matches_web_identity(profile: dict, *, user_id: str, email: str) -> bool:
    profile_user_id = str(profile.get("userId") or "").strip()
    profile_email = str(profile.get("email") or "").strip().lower()
    if user_id and profile_user_id and profile_user_id != user_id:
        return False
    if email and profile_email and profile_email != email:
        return False
    return bool(profile_user_id or profile_email)


def _profile_preferred_name(profile: dict) -> str:
    first_name = _usable_voice_identity(profile.get("first_name"))
    if first_name:
        return first_name
    public_persona = profile.get("publicPersona")
    if isinstance(public_persona, dict):
        display_name = _usable_voice_identity(public_persona.get("displayName"))
        if display_name:
            return display_name
    metadata = profile.get("metadata")
    if isinstance(metadata, dict):
        metadata_name = _usable_voice_identity(metadata.get("name"))
        if metadata_name:
            return metadata_name
    return ""


async def _resolve_web_user_profile_context(request: "Request") -> dict[str, Any]:
    """Resolve the authenticated browser user to their PearlOS UserProfile."""
    user_id = str(request.headers.get("x-user-id") or "").strip()
    user_email = str(request.headers.get("x-user-email") or "").strip().lower()
    session_name = _usable_voice_identity(request.headers.get("x-user-name"))
    if not user_id and not user_email:
        return {}

    try:
        from actions import profile_actions
    except Exception as exc:
        logger.warning(f"[chat/profile] profile_actions unavailable: {exc}")
        return {}

    profile = None
    try:
        if user_id:
            profile = await profile_actions.get_user_profile(user_id)
        if not profile and user_email:
            profile = await profile_actions.get_user_profile_by_email(user_email)
    except Exception as exc:
        logger.warning(f"[chat/profile] UserProfile lookup failed: {exc}")
        return {}

    if not profile:
        logger.info("[chat/profile] no UserProfile found for authenticated web user")
        return {}

    if not _profile_matches_web_identity(profile, user_id=user_id, email=user_email):
        logger.warning(
            "[chat/profile] refusing mismatched UserProfile for web user "
            f"has_user_id={bool(user_id)} has_email={bool(user_email)}"
        )
        return {}

    context_block = ""
    try:
        context_block = profile_actions.build_web_profile_context(
            profile,
            session_user_id=user_id,
            session_email=user_email,
            session_name=session_name,
        )
    except Exception as exc:
        logger.warning(f"[chat/profile] profile context build failed: {exc}")

    preferred_name = _profile_preferred_name(profile)
    logger.info(
        "[chat/profile] loaded authenticated UserProfile "
        f"has_user_id={bool(user_id)} has_email={bool(user_email)} "
        f"has_preferred_name={bool(preferred_name)}"
    )
    return {
        "profile": profile,
        "context_block": context_block,
        "preferred_name": preferred_name,
        "user_id": str(profile.get("userId") or user_id).strip(),
        "email": str(profile.get("email") or user_email).strip().lower(),
    }

# ── Fast-path local model ───────────────────────────────────────────
# Short greetings / acknowledgements / small-talk go straight to a small
# local Ollama model so they answer in ~1-3s instead of waiting on the
# OpenClaw → Moonshot/Kimi pipeline (which can stall for minutes when
# upstream is slow). Complex queries still use OpenClaw, but with a
# bounded first-token / inter-chunk timeout that falls back to Ollama
# rather than hanging the user's chat queue.
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_FAST_MODEL = os.getenv("OLLAMA_FAST_MODEL", "")
CHAT_FAST_PATH_ENABLED = os.getenv("CHAT_FAST_PATH_ENABLED", "1").lower() not in ("0", "false", "off", "")
CHAT_OPENCLAW_TIMEOUT_SECS = float(os.getenv("CHAT_OPENCLAW_TIMEOUT_SECS", "300"))
# sock_read = inter-chunk gap timeout. Doubles as first-token timeout.
# Must be long enough for Moonshot/Kimi to warm a session and emit the first
# token of a tool-using reply (~30s observed) AND for any single tool call to
# complete without an SSE chunk being emitted in between (web fetches, file
# reads, sub-agent dispatches can all stall the stream for 60-90s). Too short
# and webchat tool calls abort mid-execution; too long and a genuinely dead
# upstream takes longer to detect.
CHAT_OPENCLAW_READ_GAP_SECS = float(os.getenv("CHAT_OPENCLAW_READ_GAP_SECS", "120"))
CHAT_OLLAMA_TIMEOUT_SECS = float(os.getenv("CHAT_OLLAMA_TIMEOUT_SECS", "20"))
CHAT_HISTORY_TRIM_PAIRS = int(os.getenv("CHAT_HISTORY_TRIM_PAIRS", "25"))
CHAT_IMAGE_ENRICHMENT_ENABLED = os.getenv("CHAT_IMAGE_ENRICHMENT_ENABLED", "0").lower() in ("1", "true", "yes", "on")
DEFAULT_CHAT_VISION_MODEL = os.getenv("BOT_VISION_MODEL", "openai/gpt-4o-mini")
DEFAULT_CHAT_VISION_API_BASE = os.getenv("BOT_VISION_API_BASE", "https://openrouter.ai/api/v1")
CHAT_IMAGE_VISION_MODEL = os.getenv("CHAT_IMAGE_VISION_MODEL", DEFAULT_CHAT_VISION_MODEL)
CHAT_IMAGE_VISION_API_BASE = os.getenv("CHAT_IMAGE_VISION_API_BASE", DEFAULT_CHAT_VISION_API_BASE)
CHAT_IMAGE_VISION_MAX_TOKENS = int(os.getenv("CHAT_IMAGE_VISION_MAX_TOKENS", "260"))
CHAT_DIRECT_VISION_MODEL = os.getenv("CHAT_DIRECT_VISION_MODEL", DEFAULT_CHAT_VISION_MODEL)
CHAT_DIRECT_VISION_API_BASE = os.getenv("CHAT_DIRECT_VISION_API_BASE", DEFAULT_CHAT_VISION_API_BASE)

_WEB_CHAT_VISION_RULES = """## Web Chat Vision Rules

You are Pearl looking at images the user attached in PearlOS web chat.
Describe what is visibly present and answer the user's question directly.
If a person or face appears, use the conversation, user memory, and any labels
or context the user has provided. If that context is enough to know who someone
is, answer naturally. If it is not enough, say what you can see without inventing
a name. Do not refuse just because a person is visible. If the user did not ask
who the person is, describe the scene normally.

If the user asks whether you can see images, say yes and mention a concrete
detail from the image. Keep Pearl's voice: warm, direct, concise, and useful.
Do not answer with generic policy disclaimers."""


def _env_float(name: str, default: float, *, minimum: float = 0.0, maximum: float = 2.0) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return max(minimum, min(maximum, float(raw)))
    except ValueError:
        logger.warning(f"[chat] Invalid {name}={raw!r}; using {default}")
        return default


def _chat_vision_headers(api_base: str) -> dict[str, str]:
    """Build auth headers for either DeepSeek-compatible local vision or OpenRouter."""
    headers = {"Content-Type": "application/json"}
    base = (api_base or "").lower()
    if "openrouter.ai" in base:
        api_key = os.getenv("OPENROUTER_API_KEY", "")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        headers["HTTP-Referer"] = "https://pearlos.app"
        headers["X-Title"] = "PearlOS"
        return headers

    api_key = DEEPSEEK_API_KEY or os.getenv("BOT_VISION_API_KEY", "")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _is_deepseek_family_model(model: str) -> bool:
    return "deepseek" in (model or "").lower()


# Words/phrases that disqualify a query from the fast path. If the last
# user message contains any of these, we route through OpenClaw so the
# main agent can pick tools, recall memory, or coordinate sub-agents.
_FASTPATH_KEYWORD_BLOCKERS = (
    "task", "schedule", "calendar", "email", "gmail", "drive",
    "search", "google", "browse", "open ", "navigate", "play ",
    "youtube", "music", "video", "create ", "write ", "code",
    "send ", "post ", "share", "execute", "run ", "show ",
    "display", "weather", "remember", "recall", "earlier",
    "previously", "last time", "image", "photo", "picture",
    "draw", "generate", "summon", "agency", "swarm", "agent",
    "dispatch", "discord", "openclaw", "kimi", "moonshot", "ollama",
)

_FAST_SYSTEM_PROMPT = (
    "You are Pearl, a warm and concise assistant. Reply in 1 to 2 short "
    "sentences, plain text, no em-dashes, no en-dashes. Do not announce "
    "tools or systems. If the user is greeting or making small talk, "
    "answer naturally and briefly."
)


def _is_simple_query(messages: list[dict]) -> bool:
    """True if the last user message looks like small-talk / a short
    factual question that does not need OpenClaw routing.

    Criteria: ≤12 words, no tool/recall keywords, no image attachments.
    """
    if not CHAT_FAST_PATH_ENABLED or not messages:
        return False
    last_user = None
    for m in reversed(messages):
        if m.get("role") == "user":
            last_user = m
            break
    if last_user is None:
        return False
    content = last_user.get("content", "")
    if isinstance(content, list):  # multimodal (image) → not fast-path
        return False
    if not isinstance(content, str):
        return False
    text = content.strip()
    if not text:
        return False
    if len(text.split()) > 12:
        return False
    lower = text.lower()
    return not any(kw in lower for kw in _FASTPATH_KEYWORD_BLOCKERS)


def _trim_chat_messages(messages: list[dict], max_pairs: int = CHAT_HISTORY_TRIM_PAIRS) -> list[dict]:
    """Keep at most the last `max_pairs` user/assistant turns. System
    messages already in the list are preserved at their original position."""
    if not messages:
        return []
    keep_tail = max_pairs * 2
    system_msgs = [m for m in messages if m.get("role") == "system"]
    other_msgs = [m for m in messages if m.get("role") != "system"]
    return system_msgs + other_msgs[-keep_tail:]


def _ollama_payload_messages(messages: list[dict]) -> list[dict]:
    """Coerce mixed-content (multimodal) messages into plain-text Ollama
    messages, dropping non-text parts. Ollama /api/chat accepts plain text
    only for the small models we use here."""
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        if not role:
            continue
        content = m.get("content", "")
        if isinstance(content, list):
            text_parts = [
                str(p.get("text", ""))
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            content = " ".join(t for t in text_parts if t)
        if not isinstance(content, str):
            content = str(content)
        if content:
            out.append({"role": role, "content": content})
    return out


def _message_text_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(p.get("text", ""))
            for p in content
            if isinstance(p, dict) and p.get("type") == "text"
        ]
        return " ".join(t for t in parts if t)
    return str(content or "")


def _extract_image_urls(content: Any) -> list[str]:
    if not isinstance(content, list):
        return []
    urls: list[str] = []
    for part in content:
        if not isinstance(part, dict) or part.get("type") != "image_url":
            continue
        image_url = part.get("image_url")
        if isinstance(image_url, dict):
            url = image_url.get("url")
        else:
            url = image_url
        if isinstance(url, str) and url.startswith(("data:image/", "http://", "https://")):
            urls.append(url)
    return urls


def _last_user_multimodal_index(messages: list[dict]) -> int | None:
    for idx in range(len(messages) - 1, -1, -1):
        msg = messages[idx]
        if msg.get("role") == "user" and _extract_image_urls(msg.get("content")):
            return idx
    return None


async def _describe_chat_image(image_url: str, user_text: str) -> str | None:
    """Describe one web-chat image before routing to text/tool models.

    Some text/tool paths do not reliably accept raw image_url content blocks,
    so the fallback path converts the attachment into compact text first using
    the configured Pearl Vision endpoint.
    """
    prompt = (
        "Describe the attached image for Pearl so she can answer the user's "
        "message. Be concrete and concise. Include visible text, UI state, "
        "objects, people, errors, and anything the user may be asking about. "
        f"User message: {user_text or '(no text)'}"
    )
    payload = {
        "model": CHAT_IMAGE_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url, "detail": "low"}},
                ],
            }
        ],
        "max_tokens": CHAT_IMAGE_VISION_MAX_TOKENS,
        "temperature": 0.2,
    }
    if _is_deepseek_family_model(CHAT_IMAGE_VISION_MODEL):
        payload["thinking"] = {"type": "disabled"}

    headers = _chat_vision_headers(CHAT_IMAGE_VISION_API_BASE)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{CHAT_IMAGE_VISION_API_BASE.rstrip('/')}/chat/completions",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20, sock_connect=5),
            ) as resp:
                if resp.status != 200:
                    error_text = (await resp.text())[:200]
                    logger.error(f"[chat/vision] status={resp.status} body={error_text}")
                    return None
                data = await resp.json()
                description = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                    .strip()
                )
                if description:
                    logger.info(
                        f"[chat/vision] described image chars={len(description)} model={CHAT_IMAGE_VISION_MODEL}"
                    )
                    return description
    except asyncio.TimeoutError:
        logger.warning("[chat/vision] image description timed out")
    except Exception as exc:
        logger.error(f"[chat/vision] image description failed: {exc}", exc_info=True)
    return None


async def _enrich_latest_chat_image(messages: list[dict]) -> list[dict]:
    idx = _last_user_multimodal_index(messages)
    if idx is None:
        return messages

    enriched = [dict(m) for m in messages]
    content = enriched[idx].get("content")
    image_urls = _extract_image_urls(content)
    user_text = _message_text_content(content).strip()
    descriptions: list[str] = []
    for url in image_urls[:2]:
        desc = await _describe_chat_image(url, user_text)
        if desc:
            descriptions.append(desc)

    if descriptions:
        joined = "\n".join(
            f"Image {i + 1}: {desc}" for i, desc in enumerate(descriptions)
        )
        enriched[idx]["content"] = (
            f"{user_text}\n\n[Attached image analysis]\n{joined}"
            if user_text
            else f"[Attached image analysis]\n{joined}"
        )
    else:
        enriched[idx]["content"] = (
            f"{user_text}\n\n[Attached image could not be inspected by the vision service.]"
            if user_text
            else "[Attached image could not be inspected by the vision service.]"
        )
    return enriched


def _sse_text_chunk(text: str, *, finish_reason: str | None = None) -> str:
    """Build a single OpenAI-style SSE data line so the existing chat client
    parser (`useChatSession`) can consume Ollama output transparently."""
    delta: dict[str, Any] = {}
    if text:
        delta["content"] = _normalize_style_punctuation(text)
    payload = {"choices": [{"delta": delta, "finish_reason": finish_reason}]}
    return f"data: {json.dumps(payload)}\n\n"


async def _stream_ollama_as_openai_sse(
    messages: list[dict],
    *,
    model: str = OLLAMA_FAST_MODEL,
    system_prompt: str | None = _FAST_SYSTEM_PROMPT,
    timeout_secs: float = CHAT_OLLAMA_TIMEOUT_SECS,
    max_tokens: int = 256,
):
    """Stream a chat completion from local Ollama in OpenAI-SSE format.

    `think: False` is critical: reasoning models otherwise emit a long
    internal-chain-of-thought block before answering, pushing "hi" to
    ~6 seconds. With think disabled and num_predict bounded the same call
    returns the visible reply in well under a second.
    """
    payload_msgs: list[dict] = []
    if system_prompt:
        payload_msgs.append({"role": "system", "content": system_prompt})
    payload_msgs.extend(
        m for m in _ollama_payload_messages(messages) if m.get("role") != "system"
    )

    payload = {
        "model": model,
        "messages": payload_msgs,
        "stream": True,
        "think": False,
        "options": {
            "num_predict": max_tokens,
            "temperature": _env_float("CHAT_FAST_TEMPERATURE", 0.95),
        },
    }
    started = time.time()
    sent_any = False
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=timeout_secs, sock_connect=3),
            ) as resp:
                if resp.status != 200:
                    err = (await resp.text())[:200]
                    logger.error(f"[chat/ollama] status={resp.status} body={err!r}")
                    yield _sse_text_chunk(
                        "Sorry, I'm having trouble responding right now. ",
                        finish_reason="stop",
                    )
                    yield "data: [DONE]\n\n"
                    return
                async for raw in resp.content:
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    delta = (obj.get("message") or {}).get("content") or ""
                    if delta:
                        sent_any = True
                        yield _sse_text_chunk(_normalize_style_punctuation(delta))
                    if obj.get("done"):
                        break
        elapsed = time.time() - started
        logger.info(
            f"[chat/ollama] stream done in {elapsed:.2f}s sent_any={sent_any} model={model}"
        )
        yield "data: [DONE]\n\n"
    except asyncio.TimeoutError:
        logger.warning(f"[chat/ollama] timed out after {timeout_secs}s")
        if not sent_any:
            yield _sse_text_chunk(
                "Sorry, I'm taking too long. Try again? ",
                finish_reason="stop",
            )
        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error(f"[chat/ollama] streaming error: {e}", exc_info=True)
        if not sent_any:
            yield _sse_text_chunk(
                "Sorry, I'm having trouble responding right now. ",
                finish_reason="stop",
            )
        yield "data: [DONE]\n\n"


async def _stream_deepseek_direct_sse(
    messages: list[dict],
    *,
    system_prompt: str | None = None,
    tools: list[dict] | None = None,
    max_tokens: int = 4096,
    raise_on_error: bool = False,
):
    """Stream a chat completion from DeepSeek V4 Flash via the local proxy,
    bypassing OpenClaw entirely. Returns OpenAI-style SSE chunks that the
    frontend useChatSession parser already understands.

    Tool calls are passed through as-is in the SSE stream; the browser
    client accumulates tool_call deltas and executes them client-side
    (chat-tool-handlers.ts).
    """
    payload_msgs: list[dict] = []
    if system_prompt:
        payload_msgs.append({"role": "system", "content": system_prompt})
    for m in messages:
        if m.get("role") == "system":
            continue
        # Preserve image_url blocks for DeepSeek-family multimodal gateways.
        # Text-only proxies may reject them; in that case the caller should
        # fall back rather than silently replacing the image with placeholder
        # text and making Pearl blind.
        content = m.get("content")
        if isinstance(content, list):
            has_image = any(isinstance(p, dict) and p.get("type") == "image_url" for p in content)
            if tools and has_image:
                text_parts = [
                    str(p.get("text", ""))
                    for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                ]
                content = " ".join(t for t in text_parts if t) or "[Attached image was inspected separately.]"
            elif not has_image:
                text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                content = " ".join(text_parts)
        payload_msgs.append({"role": m["role"], "content": content or ""})

    payload: dict[str, Any] = {
        "model": DEEPSEEK_CHAT_MODEL,
        "messages": payload_msgs,
        "stream": True,
        "max_tokens": max_tokens,
        "temperature": _env_float("CHAT_TEMPERATURE", 0.95),
        # Disable DeepSeek reasoning/thinking for web chat so the first
        # content token arrives immediately instead of after a reasoning
        # chain. The proxy recognises this field and passes it through.
        "thinking": {"type": "disabled"},
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {"Content-Type": "application/json"}
    if DEEPSEEK_API_KEY:
        headers["Authorization"] = f"Bearer {DEEPSEEK_API_KEY}"

    started = time.time()
    sent_any = False
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{DEEPSEEK_BASE_URL}/chat/completions",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(
                    total=DEEPSEEK_CHAT_TIMEOUT_SECS,
                    sock_connect=5,
                    sock_read=DEEPSEEK_CHAT_READ_GAP_SECS,
                ),
            ) as resp:
                if resp.status != 200:
                    error_text = (await resp.text())[:300]
                    logger.error(
                        f"[chat/deepseek] status={resp.status} body={error_text!r}"
                    )
                    if raise_on_error:
                        raise RuntimeError(f"deepseek status={resp.status}: {error_text}")
                    yield _sse_text_chunk(
                        "Sorry, I'm having trouble responding right now. ",
                        finish_reason="stop",
                    )
                    yield "data: [DONE]\n\n"
                    return
                async for chunk in resp.content.iter_any():
                    text = chunk.decode("utf-8", errors="replace")
                    sent_any = True
                    yield _normalize_style_punctuation(text)
        elapsed = time.time() - started
        logger.info(
            f"[chat/deepseek] stream done in {elapsed:.2f}s sent_any={sent_any}"
        )
        if not sent_any:
            if raise_on_error:
                raise RuntimeError("deepseek returned an empty stream")
            yield _sse_text_chunk(
                "Hmm, I got an empty response. Try again? ",
                finish_reason="stop",
            )
            yield "data: [DONE]\n\n"
    except asyncio.TimeoutError:
        elapsed = time.time() - started
        logger.warning(f"[chat/deepseek] timed out after {elapsed:.1f}s")
        if raise_on_error:
            raise
        if not sent_any:
            yield _sse_text_chunk(
                "Sorry, I'm taking too long. Try again? ",
                finish_reason="stop",
            )
        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error(f"[chat/deepseek] streaming error: {e}", exc_info=True)
        if raise_on_error:
            raise
        if not sent_any:
            yield _sse_text_chunk(
                "Sorry, I'm having trouble responding right now. ",
                finish_reason="stop",
            )
        yield "data: [DONE]\n\n"


async def _stream_openrouter_vision_sse(
    messages: list[dict],
    *,
    system_prompt: str | None = None,
    max_tokens: int = 2048,
):
    """Stream web chat directly through a model that accepts image_url blocks."""

    payload_msgs: list[dict] = []
    if system_prompt:
        payload_msgs.append({"role": "system", "content": system_prompt})
    payload_msgs.append({"role": "system", "content": _WEB_CHAT_VISION_RULES})
    for m in messages:
        if m.get("role") == "system":
            continue
        payload_msgs.append({"role": m["role"], "content": m.get("content") or ""})

    payload: dict[str, Any] = {
        "model": CHAT_DIRECT_VISION_MODEL,
        "messages": payload_msgs,
        "stream": True,
        "max_tokens": max_tokens,
        "temperature": _env_float("CHAT_VISION_TEMPERATURE", 0.6),
    }
    if _is_deepseek_family_model(CHAT_DIRECT_VISION_MODEL):
        payload["thinking"] = {"type": "disabled"}
    headers = _chat_vision_headers(CHAT_DIRECT_VISION_API_BASE)
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{CHAT_DIRECT_VISION_API_BASE.rstrip('/')}/chat/completions",
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=90, sock_connect=5),
        ) as resp:
            if resp.status != 200:
                error_text = (await resp.text())[:500]
                raise RuntimeError(f"vision status={resp.status}: {error_text}")
            async for chunk in resp.content.iter_any():
                text = chunk.decode("utf-8", errors="replace")
                yield _normalize_style_punctuation(text)


async def _deepseek_proxy_available() -> bool:
    """Return true when the configured local DeepSeek-compatible endpoint is
    reachable. This is intentionally a TCP check, not a model call, so a
    missing proxy fails fast before we choose the web-tool path.
    """
    parsed = urlparse(DEEPSEEK_BASE_URL)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=1.5,
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception as exc:
        logger.warning(f"[chat/deepseek] proxy unavailable at {host}:{port}: {exc}")
        return False


async def _call_ollama_text(
    prompt: str,
    *,
    model: str = OLLAMA_FAST_MODEL,
    timeout_secs: float = 12.0,
    max_tokens: int = 200,
) -> str | None:
    """Non-streaming Ollama call used by the ASK PEARL fallback."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "think": False,
                    "options": {"num_predict": max_tokens},
                },
                timeout=aiohttp.ClientTimeout(total=timeout_secs, sock_connect=3),
            ) as resp:
                if resp.status != 200:
                    body = (await resp.text())[:200]
                    logger.warning(
                        f"[chat/ollama] non-stream status={resp.status} body={body!r}"
                    )
                    return None
                data = await resp.json()
                text = ((data.get("message") or {}).get("content") or "").strip()
                if not text:
                    return None
                return _normalize_style_punctuation(text)
    except Exception as e:
        logger.warning(f"[chat/ollama] non-stream call failed: {e}")
        return None


class ChatRequest(BaseModel):
    messages: list[dict]
    fileContexts: list[str] | None = None
    attachments: list[dict] | None = None
    disable_tools: bool | None = None
    finalize_tool_results: bool | None = None
    discordUserId: str | None = None
    discordUsername: str | None = None
    discordGuildId: str | None = None
    discordChannelId: str | None = None
    discordChannelName: str | None = None
    discordMessageId: str | None = None


class ChatHistoryAppendRequest(BaseModel):
    role: str
    content: str


_FILE_CONTEXT_MAX_CHARS = int(os.getenv("PEARL_FILE_CONTEXT_MAX_CHARS", "14000"))
_FILE_CONTEXT_MAX_BYTES = int(os.getenv("PEARL_FILE_CONTEXT_MAX_BYTES", "1000000"))
_LEGACY_CHAT_UPLOAD_ROOT = "/home/deploy/pearlos/user-data/chat-uploads"


def _is_inside_path(candidate: str, root: str) -> bool:
    try:
        resolved = os.path.realpath(candidate)
        resolved_root = os.path.realpath(root)
    except Exception:
        return False
    return resolved == resolved_root or resolved.startswith(resolved_root + os.sep)


def _trusted_attachment_roots(tenant_id: str = "", user_id: str = "") -> list[str]:
    user_root = os.getenv("PEARLOS_USER_ROOT", "/workspace/user")
    public_root = os.getenv("PEARL_PUBLIC_UPLOAD_ROOT", "/srv/pearl-user-workspaces/uploads")
    chat_root = os.getenv("CHAT_UPLOAD_DIR", _LEGACY_CHAT_UPLOAD_ROOT)
    tenant_segment = _safe_public_path_segment(tenant_id, "") if tenant_id else ""
    user_segment = _safe_public_path_segment(user_id, "") if user_id else ""
    if tenant_segment and user_segment:
        roots = [
            os.path.join(user_root, tenant_segment, user_segment),
            os.path.join(public_root, tenant_segment, user_segment),
            os.path.join(chat_root, user_segment),
        ]
    else:
        roots = [user_root, public_root, chat_root]
    cleaned: list[str] = []
    for root in roots:
        value = str(root or "").strip()
        if value and value not in {"/", "."}:
            cleaned.append(value)
    return cleaned


def _trusted_attachment_path(path_value: str, tenant_id: str = "", user_id: str = "") -> str | None:
    if not isinstance(path_value, str) or not path_value.strip():
        return None
    candidate = os.path.realpath(path_value.strip())
    if not os.path.isfile(candidate):
        return None
    for root in _trusted_attachment_roots(tenant_id=tenant_id, user_id=user_id):
        if _is_inside_path(candidate, root):
            return candidate
    return None


def _looks_like_text_file(filename: str, content_type: str) -> bool:
    lower_name = (filename or "").lower()
    lower_type = (content_type or "").lower()
    return (
        lower_type.startswith("text/")
        or any(token in lower_type for token in (
            "json", "csv", "xml", "yaml", "toml", "markdown",
            "javascript", "typescript", "x-python", "x-sh", "sql"
        ))
        or lower_name.endswith((
            ".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv",
            ".xml", ".yml", ".yaml", ".toml", ".js", ".jsx", ".ts", ".tsx",
            ".py", ".sh", ".sql", ".log"
        ))
    )


def _truncate_file_context(text: str, max_chars: int = _FILE_CONTEXT_MAX_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n...[truncated]"


def _read_text_preview(path: str, max_bytes: int = _FILE_CONTEXT_MAX_BYTES) -> str:
    with open(path, "rb") as f:
        raw = f.read(max_bytes + 1)
    suffix = "\n...[truncated by byte limit]" if len(raw) > max_bytes else ""
    return raw[:max_bytes].decode("utf-8", errors="replace") + suffix


def _normalize_extracted_text(text: str) -> str:
    value = str(text or "")
    value = value.replace("\x00", "").replace("\r", "\n")
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]+", " ", value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _useful_extracted_text(text: str) -> bool:
    cleaned = _normalize_extracted_text(text)
    if len(cleaned) < 2 or not re.search(r"[A-Za-z0-9]", cleaned):
        return False
    printable = re.sub(r"[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]", "", cleaned)
    return len(printable) / max(len(cleaned), 1) > 0.7


def _decode_pdf_bytes(raw: bytes) -> str:
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", errors="replace")
    if raw.startswith(b"\xff\xfe"):
        return raw[2:].decode("utf-16-le", errors="replace")
    return raw.decode("latin-1", errors="replace")


def _decode_pdf_literal(raw: str) -> str:
    out = bytearray()
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch != "\\":
            out.append(ord(ch) & 0xFF)
            i += 1
            continue
        i += 1
        if i >= len(raw):
            break
        esc = raw[i]
        if esc == "n":
            out.append(0x0A)
        elif esc == "r":
            out.append(0x0D)
        elif esc == "t":
            out.append(0x09)
        elif esc == "b":
            out.append(0x08)
        elif esc == "f":
            out.append(0x0C)
        elif esc in "\r\n":
            if esc == "\r" and i + 1 < len(raw) and raw[i + 1] == "\n":
                i += 1
        elif esc in "01234567":
            octal = esc
            for _ in range(2):
                if i + 1 < len(raw) and raw[i + 1] in "01234567":
                    i += 1
                    octal += raw[i]
            out.append(int(octal, 8) & 0xFF)
        else:
            out.append(ord(esc) & 0xFF)
        i += 1
    return _normalize_extracted_text(_decode_pdf_bytes(bytes(out)))


def _extract_pdf_literal_strings(data: str) -> list[str]:
    values: list[str] = []
    i = 0
    while i < len(data):
        if data[i] != "(":
            i += 1
            continue
        depth = 1
        escaped = False
        raw: list[str] = []
        j = i + 1
        while j < len(data):
            ch = data[j]
            if escaped:
                raw.append("\\" + ch)
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == "(":
                depth += 1
                raw.append(ch)
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    decoded = _decode_pdf_literal("".join(raw))
                    if _useful_extracted_text(decoded):
                        values.append(decoded)
                    i = j
                    break
                raw.append(ch)
            else:
                raw.append(ch)
            j += 1
        i += 1
    return values


def _extract_pdf_hex_strings(data: str) -> list[str]:
    values: list[str] = []
    for match in re.finditer(r"(?<!<)<([0-9A-Fa-f\s]{4,})>(?!>)", data):
        hex_text = re.sub(r"\s+", "", match.group(1))
        if len(hex_text) % 2:
            continue
        try:
            decoded = _normalize_extracted_text(_decode_pdf_bytes(bytes.fromhex(hex_text)))
        except ValueError:
            continue
        if _useful_extracted_text(decoded):
            values.append(decoded)
    return values


def _pdf_text_preview(path: str, max_bytes: int = min(_FILE_CONTEXT_MAX_BYTES, 12 * 1024 * 1024)) -> str:
    with open(path, "rb") as f:
        raw_bytes = f.read(max_bytes)
    raw = raw_bytes.decode("latin-1", errors="replace")
    chunks = [raw]
    cursor = 0
    while True:
        stream_start = raw.find("stream", cursor)
        if stream_start < 0:
            break
        data_start = stream_start + len("stream")
        if raw[data_start:data_start + 2] == "\r\n":
            data_start += 2
        elif data_start < len(raw) and raw[data_start] in "\r\n":
            data_start += 1
        stream_end = raw.find("endstream", data_start)
        if stream_end < 0:
            break
        descriptor = raw[max(0, stream_start - 1200):stream_start]
        stream_bytes = raw_bytes[data_start:stream_end]
        chunks.append(stream_bytes.decode("latin-1", errors="replace"))
        if re.search(r"/(?:Filter\s*)?(?:\[[^\]]*)?/FlateDecode\b", descriptor):
            for candidate in (stream_bytes, stream_bytes[:-1]):
                try:
                    chunks.append(zlib.decompress(candidate).decode("latin-1", errors="replace"))
                    break
                except Exception:
                    continue
        cursor = stream_end + len("endstream")

    seen: set[str] = set()
    lines: list[str] = []
    for chunk in chunks:
        for value in _extract_pdf_literal_strings(chunk) + _extract_pdf_hex_strings(chunk):
            cleaned = _normalize_extracted_text(value)
            key = cleaned.lower()
            if not cleaned or key in seen:
                continue
            seen.add(key)
            lines.append(cleaned)
            if len("\n".join(lines)) >= _FILE_CONTEXT_MAX_CHARS:
                return _truncate_file_context("\n".join(lines))
    return _truncate_file_context("\n".join(lines))


def _format_json_preview(text: str) -> str:
    try:
        parsed = json.loads(text)
        return json.dumps(parsed, indent=2, ensure_ascii=False)
    except Exception:
        return text


def _format_csv_preview(text: str, filename: str) -> str:
    delimiter = "\t" if filename.lower().endswith(".tsv") else ","
    try:
        rows = list(csv.reader(text.splitlines(), delimiter=delimiter))[:40]
    except Exception:
        return text
    return "\n".join(delimiter.join(row[:20]) for row in rows)


def _xlsx_sheet_preview(path: str, max_rows: int = 20, max_cols: int = 12) -> str:
    ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    try:
        with zipfile.ZipFile(path) as zf:
            shared_strings: list[str] = []
            if "xl/sharedStrings.xml" in zf.namelist():
                root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                for si in root.findall("a:si", ns):
                    shared_strings.append("".join(t.text or "" for t in si.findall(".//a:t", ns)))
            sheet_names = [name for name in zf.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")]
            sections: list[str] = []
            for sheet_name in sheet_names[:3]:
                root = ET.fromstring(zf.read(sheet_name))
                lines: list[str] = []
                for row in root.findall(".//a:sheetData/a:row", ns)[:max_rows]:
                    values: list[str] = []
                    for cell in row.findall("a:c", ns)[:max_cols]:
                        value = cell.find("a:v", ns)
                        raw = value.text if value is not None else ""
                        if cell.attrib.get("t") == "s" and raw.isdigit():
                            idx = int(raw)
                            raw = shared_strings[idx] if 0 <= idx < len(shared_strings) else raw
                        values.append(raw)
                    if any(values):
                        lines.append(" | ".join(values))
                if lines:
                    sections.append(f"{sheet_name}\n" + "\n".join(lines))
            return "\n\n".join(sections) or "[xlsx contained no readable sheet rows]"
    except Exception as exc:
        return f"[xlsx preview failed: {exc}]"


def _office_xml_text(xml_text: str) -> str:
    with_breaks = (
        xml_text
        .replace("<w:tab/>", "\t")
        .replace("<w:tab />", "\t")
        .replace("<w:br/>", "\n")
        .replace("<w:br />", "\n")
    )
    with_breaks = re.sub(r"</(?:w:p|a:p|text:p)>", "\n", with_breaks)
    parts: list[str] = []
    for match in re.finditer(
        r"<(?:w:t|a:t|text:span|text:p)[^>]*>([\s\S]*?)</(?:w:t|a:t|text:span|text:p)>",
        with_breaks,
    ):
        parts.append(html.unescape(re.sub(r"<[^>]+>", " ", match.group(1))))
    return _normalize_extracted_text(" ".join(parts))


def _zip_xml_document_preview(path: str, kind: str) -> str:
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if kind == "docx":
                targets = ["word/document.xml"] + sorted(
                    name for name in names
                    if re.match(r"word/(?:header|footer|footnotes|endnotes)\d*\.xml$", name)
                )
                label = "Word document"
            elif kind == "pptx":
                targets = sorted(
                    (name for name in names if re.match(r"ppt/slides/slide\d+\.xml$", name)),
                    key=lambda value: int(re.search(r"\d+", value).group(0)) if re.search(r"\d+", value) else 0,
                )
                label = "PowerPoint deck"
            else:
                targets = ["content.xml"]
                label = "OpenDocument text"
            sections: list[str] = []
            for target in targets:
                if target not in names:
                    continue
                raw = zf.read(target, pwd=None)
                if len(raw) > _FILE_CONTEXT_MAX_BYTES:
                    raw = raw[:_FILE_CONTEXT_MAX_BYTES]
                text = _office_xml_text(raw.decode("utf-8", errors="replace"))
                if text:
                    heading = f"## {os.path.basename(target).replace('.xml', '')}\n" if kind == "pptx" else ""
                    sections.append(heading + text)
                if len("\n\n".join(sections)) >= _FILE_CONTEXT_MAX_CHARS:
                    break
            return f"{label} preview:\n" + (_truncate_file_context("\n\n".join(sections)) or "[no readable text extracted]")
    except Exception as exc:
        return f"[{kind} preview failed: {exc}]"


def build_pearl_file_context(path: str, filename: str, content_type: str, size: int) -> str:
    """Return a deterministic, model-ready file context block for Pearl."""
    header = [
        "## Attached file",
        f"Name: {filename or os.path.basename(path)}",
        f"MIME: {content_type or 'application/octet-stream'}",
        f"Size: {size} bytes",
        f"Workspace path: {path}",
    ]
    lower_name = (filename or "").lower()
    lower_type = (content_type or "").lower()
    body = ""
    if _looks_like_text_file(filename, content_type):
        text = _read_text_preview(path)
        if "json" in lower_type or lower_name.endswith((".json", ".jsonl")):
            text = _format_json_preview(text)
        elif "csv" in lower_type or lower_name.endswith((".csv", ".tsv")):
            text = _format_csv_preview(text, lower_name)
        body = "Content preview:\n```\n" + _truncate_file_context(text) + "\n```"
    elif lower_name.endswith(".xlsx") or "spreadsheet" in lower_type:
        body = "Spreadsheet preview:\n```\n" + _truncate_file_context(_xlsx_sheet_preview(path)) + "\n```"
    elif lower_name.endswith(".docx") or "wordprocessingml.document" in lower_type:
        body = _zip_xml_document_preview(path, "docx")
    elif lower_name.endswith(".pptx") or "presentationml.presentation" in lower_type:
        body = _zip_xml_document_preview(path, "pptx")
    elif lower_name.endswith(".odt") or "opendocument.text" in lower_type:
        body = _zip_xml_document_preview(path, "odt")
    elif lower_name.endswith(".pdf") or lower_type == "application/pdf":
        preview = _pdf_text_preview(path)
        body = (
            "PDF text preview:\n```\n"
            + (preview or "[no selectable text found; route scanned/image PDFs to OCR or vision tooling]")
            + "\n```"
        )
    elif lower_name.endswith(".doc"):
        try:
            raw = _read_text_preview(path, max_bytes=min(_FILE_CONTEXT_MAX_BYTES, 400000))
            lines: list[str] = []
            for match in re.findall(r"[\x09\x0a\x0d\x20-\x7e]{4,}", raw):
                cleaned = " ".join(match.split())
                if cleaned and not cleaned.startswith(("Root Entry", "WordDocument", "SummaryInformation")):
                    lines.append(cleaned)
            preview = "\n".join(lines)
            body = "Word .doc text preview:\n```\n" + _truncate_file_context(preview or "[no readable text extracted]") + "\n```"
        except Exception as exc:
            body = f"Word .doc attached. Text preview failed: {exc}"
    else:
        body = "Binary/non-text file attached. Use available metadata now; deeper reading requires a MIME-specific extractor."
    return "\n".join(header + ["", body])


_REPAIR_TASK_ACTION_MARKERS = (
    "please fix", "fix this", "fix it", "repair this", "repair it",
    "needs to be fixed", "need this fixed", "patch this", "ship a fix",
)

_REPAIR_TASK_SCOPE_MARKERS = (
    "pearlos", "staging", "web chat", "photo magic", "photomagic",
    "pearl", "discord", "voice", "task queue", "upload path",
    "settings", "tenant", "cartesia", "pockettts",
)

_REPAIR_TASK_NEGATIVE_MARKERS = (
    "summarize", "summary", "read this", "explain", "overview",
    "what is", "what's", "why", "how", "can you look at",
    "help me understand", "review", "compare", "find info",
    "latest", "current", "search", "is this broken",
)


def _should_auto_dispatch_repair_task(text: str) -> bool:
    lower = (text or "").lower()
    if not lower.strip():
        return False
    if any(marker in lower for marker in _REPAIR_TASK_NEGATIVE_MARKERS):
        return False
    return (
        any(marker in lower for marker in _REPAIR_TASK_ACTION_MARKERS)
        and any(marker in lower for marker in _REPAIR_TASK_SCOPE_MARKERS)
    )


def _auto_dispatch_title(text: str) -> str:
    cleaned = " ".join((text or "").strip().split())
    return cleaned[:56] + "..." if len(cleaned) > 59 else cleaned or "Fix web chat issue"


_BUILD_TASK_ACTION_RE = re.compile(
    r"\b(?:build|make|create|generate|code|develop|prototype|implement|ship)\b",
    re.I,
)
_BUILD_TASK_PRODUCT_RE = re.compile(
    r"\b(?:game|app|application|website|site|demo|godot|unity|react|next\.?js|"
    r"dashboard|analytics|report|tracker|portal|table|client\s+portal|admin\s+panel|"
    r"pixel\s*art|procedural(?:ly)?|landscape|forest|studio\s+app)\b",
    re.I,
)
_VISUAL_ANSWER_RE = re.compile(
    r"\b(?:canvas|visual|visualize|infographic|timeline|chart|graph|diagram|map|"
    r"comparison\s+board|visual\s+breakdown|ranked\s+list|ranking|ranked|"
    r"best[-\s]?selling|bestselling|top\s+\d{0,2}|most[-\s]?(?:popular|watched|streamed|played|downloaded|read|sold)|"
    r"highest[-\s]?grossing|all[-\s]?time)\b",
    re.I,
)
_RUNNABLE_BUILD_RE = re.compile(
    r"\b(?:runnable|playable|interactive|deploy|host|website|site|web\s+app|app|game|demo|"
    r"dashboard|analytics|report|tracker|portal|table|admin\s+panel|"
    r"code\s+(?:up|me)|build\s+(?:me\s+)?(?:a|an)\s+(?:app|game|site|website|demo|dashboard|report|tracker|portal))\b",
    re.I,
)
_AFFIRMATION_RE = re.compile(
    r"^\s*(?:yes|yes please|yes plz|yep|yeah|sure|do it|please do|go ahead|"
    r"send it|start it|run it|dispatch it|try again|re-?dispatch it)\s*[.!]*\s*$",
    re.I,
)
_REDISPATCH_OFFER_RE = re.compile(
    r"\b(?:try\s+re-?dispatching|re-?dispatch(?:ing)?\s+it|send\s+it\s+back\s+to\s+the\s+agency|"
    r"triggered\s+from\s+a\s+session|task\s+dispatch\s+system|pearl-task-dispatch)\b",
    re.I,
)
_CHAT_FINALIZER_RE = re.compile(
    r"\b(?:answer\s+my\s+last\s+request\s+using\s+these\s+tool\s+results|"
    r"tool\s+results\s+as\s+private\s+context|do\s+not\s+repeat\s+the\s+raw\s+tool\s+output|"
    r"tool\s+result\s+\d+:)\b",
    re.I,
)
_PROCESS_NARRATION_RE = re.compile(
    r"^\s*(?:let\s+me|i(?:'ll|\s+will|\s+am\s+going\s+to)|i\s+need\s+to|"
    r"checking|looking|grabbing|pulling)\b[^.!?\n]*"
    r"(?:look|search|grab|pull|check|data|numbers|timeline|info|latest)",
    re.I,
)
_PROCESS_NARRATION_PREFIX_RE = re.compile(
    r"^\s*(?:l|le|let|let\s+m|let\s+me|i|i'|i'l|i'll|i\s+w|i\s+wi|i\s+wil|"
    r"i\s+will|i\s+a|i\s+am|i\s+am\s+g|i\s+am\s+going|i\s+n|i\s+need|"
    r"check|checking|look|looking|grab|grabbing|pull|pulling)",
    re.I,
)


def _chat_message_text(message: dict | Any) -> str:
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts).strip()
    return ""


def _build_task_title(text: str) -> str:
    cleaned = " ".join((text or "").strip().split())
    cleaned = re.sub(r"^re:\s*", "", cleaned, flags=re.I).strip()
    if not cleaned:
        return "Build requested project"
    return cleaned[:56] + "..." if len(cleaned) > 59 else cleaned


def _looks_like_build_task(text: str) -> bool:
    lower = (text or "").lower()
    if not lower.strip():
        return False
    if _CHAT_FINALIZER_RE.search(lower):
        return False
    if _VISUAL_ANSWER_RE.search(lower) and not _RUNNABLE_BUILD_RE.search(lower):
        return False
    # Avoid hijacking normal questions about building. Those should be answered
    # inline unless the user clearly asks PearlOS to produce a runnable thing.
    if lower.lstrip().startswith(("why ", "how ", "what ", "where ", "when ")):
        return False
    return bool(_BUILD_TASK_ACTION_RE.search(lower) and _BUILD_TASK_PRODUCT_RE.search(lower))


def _confirmed_redispatch_task(messages: list[dict]) -> str | None:
    if len(messages) < 2:
        return None
    latest_text = _chat_message_text(messages[-1])
    if not _AFFIRMATION_RE.match(latest_text):
        return None

    saw_offer = False
    for idx in range(len(messages) - 2, -1, -1):
        msg = messages[idx]
        role = str(msg.get("role") or "")
        text = _chat_message_text(msg)
        if not text:
            continue
        if role == "assistant" and _REDISPATCH_OFFER_RE.search(text):
            saw_offer = True
            continue
        if saw_offer and role == "user":
            if len(text.split()) >= 5:
                return text
    return None


def _auto_dispatch_build_task(messages: list[dict], latest_user_text: str) -> tuple[str, str] | None:
    """Return (task_body, title) for webchat requests that must hit Agency.

    This plugs the production webchat gap where the LLM can offer to dispatch
    but then claim it lacks CLI/exec permissions. Build/game/app work should
    become a real task before the model has a chance to narrate tool limits.
    """
    confirmed = _confirmed_redispatch_task(messages)
    if confirmed:
        task = (
            "The user confirmed they want this previous webchat request "
            "re-dispatched and completed through the Agency:\n\n"
            f"{confirmed}\n\n"
            "Produce the requested runnable result. If it is a game/app/demo, "
            "save or link the playable artifact so PearlOS can open it directly. "
            "Do not just write a note unless the user explicitly asked for a note. "
            "Before marking complete, verify the direct artifact URL opens successfully."
        )
        return task, _build_task_title(confirmed)

    if _looks_like_build_task(latest_user_text):
        task = (
            "Webchat user asked PearlOS to build/create this:\n\n"
            f"{latest_user_text}\n\n"
            "Produce the requested runnable result. If it is a game/app/demo, "
            "save or link the playable artifact so PearlOS can open it directly. "
            "Do not just write a note unless the user explicitly asked for a note. "
            "Before marking complete, verify the direct artifact URL opens successfully."
        )
        return task, _build_task_title(latest_user_text)
    return None


async def _stream_auto_dispatched_task_reply(message: str):
    yield _sse_text_chunk(message)
    yield "data: [DONE]\n\n"


def _create_webchat_agency_task(
    *,
    task_body: str,
    task_title: str,
    task_kind: str,
    user_email: str | None,
    request: Request,
) -> tuple[dict | None, str | None]:
    if _tasks_create_direct is None:
        return (
            None,
            "I cannot reach the task queue right now. "
            "I am not going to pretend that was dispatched.",
        )

    pearl_surface = (request.headers.get("x-pearl-surface") or "").strip().lower()
    discord_ctx = _discord_request_context(request)
    task_source = (
        "discord"
        if discord_ctx.get("discord_channel_id") or pearl_surface.startswith("discord")
        else "google_chat_dm" if pearl_surface == "google-chat-dm"
        else "web_chat"
    )

    try:
        record = _tasks_create_direct(
            task=task_body,
            source=task_source,
            created_by="pearl",
            assignee="claude_cli",
            urgency="urgent",
            title=task_title,
            requester_email=user_email,
            requester_user_id=request.headers.get("x-user-id"),
            requester_tenant_id=request.headers.get("x-tenant-id")
            or request.headers.get("x-pearl-tenant-id"),
            discord_channel_id=discord_ctx.get("discord_channel_id"),
            discord_message_id=discord_ctx.get("discord_message_id"),
            discord_user_id=discord_ctx.get("discord_user_id"),
            discord_username=discord_ctx.get("discord_username"),
            discord_guild_id=discord_ctx.get("discord_guild_id"),
            discord_channel_name=discord_ctx.get("discord_channel_name"),
        )
    except Exception as exc:
        logger.error(
            f"[chat/auto-dispatch] failed to create {task_kind} task for {user_email}: {exc}",
            exc_info=True,
        )
        return (
            None,
            "I could not create the Agency task record. The task queue rejected it, "
            "so I am not going to pretend that was dispatched.",
        )

    logger.info(
        f"[chat/auto-dispatch] created {task_kind} task {record.get('id')} for {user_email}"
    )
    return record, None


def _file_context_block(body: ChatRequest, request: Request | None = None) -> str:
    blocks: list[str] = []
    tenant_id = ""
    user_id = ""
    if request is not None:
        tenant_id = (
            request.headers.get("x-tenant-id")
            or request.headers.get("x-pearl-tenant-id")
            or ""
        )
        user_id = request.headers.get("x-user-id") or ""
    for att in body.attachments or []:
        if not isinstance(att, dict):
            continue
        path_value = att.get("path")
        if isinstance(path_value, str):
            trusted_path = _trusted_attachment_path(path_value, tenant_id=tenant_id, user_id=user_id)
            if not trusted_path:
                logger.warning(f"[chat/file-context] rejected untrusted attachment path: {path_value}")
                continue
            filename = str(att.get("name") or att.get("filename") or os.path.basename(trusted_path))
            content_type = str(att.get("mime") or att.get("contentType") or "application/octet-stream")
            try:
                blocks.append(build_pearl_file_context(trusted_path, filename, content_type, os.path.getsize(trusted_path)))
            except Exception as exc:
                blocks.append(f"## Attached file\nName: {filename}\nPreview failed: {exc}")
    if not blocks:
        return ""
    intro = (
        "Files attached to the latest user message are direct conversation context. "
        "Read and discuss them naturally. Do not dispatch a task just to inspect them."
    )
    return intro + "\n\n" + "\n\n".join(blocks)


def _file_context_system_messages(body: ChatRequest) -> list[dict]:
    block = _file_context_block(body)
    return [{"role": "system", "content": block}] if block else []


# ── Pearl system-prompt cache ──────────────────────────────────────
# build_web_chat_system_prompt() reads SOUL.md, IDENTITY.md, MEMORY.md tail,
# cross-session-state.md, and today's activity log on every call (~19K tokens
# of text). Caching it for a short TTL eliminates per-request disk I/O while
# keeping activity-log updates visible within seconds.
_PEARL_PROMPT_TTL_SECS = float(os.getenv("PEARL_WEB_PROMPT_TTL_SECS", "60"))
_pearl_prompt_cache: dict[str, Any] = {"value": None, "ts": 0.0}


def _cached_web_chat_system_prompt(
    *,
    tenant_id: str | None = None,
    user_id: str | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
) -> str:
    """Return the cached shared Pearl system prompt, now keyed by user
    identity so that authenticated users get per-user memory injected.
    Unauthenticated callers (no tenant_id/user_id) get the shared prompt
    with no per-user block, exactly as before."""
    cache_key = f"{tenant_id or ''}:{user_id or ''}:{user_email or ''}:{user_name or ''}"
    now = time.time()
    cached = _pearl_prompt_cache.get("value")
    cached_key = _pearl_prompt_cache.get("key")
    if cached is not None and cached_key == cache_key and (now - _pearl_prompt_cache["ts"]) < _PEARL_PROMPT_TTL_SECS:
        age = now - _pearl_prompt_cache["ts"]
        logger.info(
            f"[chat/prompt] cache HIT age={age:.1f}s chars={len(cached)} ttl={_PEARL_PROMPT_TTL_SECS:.0f}s key={cache_key!r}"
        )
        return cached
    from pearl.context_loader import build_web_chat_system_prompt, build_per_user_memory_block
    build_started = time.time()
    prompt = build_web_chat_system_prompt(
        tenant_id=tenant_id,
        user_id=user_id,
        user_email=user_email,
    )
    # Inject per-user memory block if identity headers are present
    per_user_block = build_per_user_memory_block(
        tenant_id=tenant_id,
        user_id=user_id,
        user_email=user_email,
        user_name=user_name,
    )
    if per_user_block:
        prompt = f"{per_user_block}\n\n{prompt}"
    build_secs = time.time() - build_started
    _pearl_prompt_cache["value"] = prompt
    _pearl_prompt_cache["key"] = cache_key
    _pearl_prompt_cache["ts"] = now
    logger.info(
        f"[chat/prompt] cache MISS rebuilt in {build_secs:.2f}s chars={len(prompt)} ttl={_PEARL_PROMPT_TTL_SECS:.0f}s key={cache_key!r}"
    )
    return prompt


async def _web_chat_onboarding_note(request: Request, profile: dict | None = None) -> str:
    """Return onboarding prompt injection for incomplete web-chat users."""
    user_id = str(request.headers.get("x-user-id") or "").strip()
    user_email = str(request.headers.get("x-user-email") or "").strip().lower()
    if not user_id and not user_email:
        return ""
    try:
        if profile is None:
            from actions import profile_actions
            profile = await profile_actions.get_user_profile(user_id) if user_id else None
            if not profile and user_email:
                profile = await profile_actions.get_user_profile_by_email(user_email)
        if profile and profile.get("onboardingComplete") is True:
            return ""
    except Exception as exc:
        logger.warning(f"[chat/onboarding] profile lookup failed; injecting onboarding prompt conservatively: {exc}")

    try:
        from core.prompts import build_onboarding_system_note_async
        return await build_onboarding_system_note_async("web chat")
    except Exception as exc:
        logger.warning(f"[chat/onboarding] failed to build onboarding prompt: {exc}")
        return ""


# ── On-demand memory archive search ─────────────────────────────────
# When the user's message implies they want us to recall a past event
# ("remember when X", "what did we ship last month", etc.) we grep the
# full MEMORY.md and activity-log.md archives and prepend a small block
# to the system prompt. Keeps the working-set prompt lean while still
# answering callbacks that fall outside the last-7-days window.
_MEMORY_SEARCH_SUBSTRINGS = (
    "remember when",
    "what did we",
    "last time",
    "previously",
    "earlier",
    "before",
)
_MEMORY_SEARCH_PREFIXES = (
    "remember",
    "what about",
)
_MEMORY_SEARCH_MAX_CHARS = 500


def _extract_last_user_text(messages: list[dict]) -> str:
    for msg in reversed(messages or []):
        if msg.get("role") != "user":
            continue
        content = msg.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for p in content:
                if isinstance(p, dict) and p.get("type") == "text":
                    parts.append(str(p.get("text", "")))
            return " ".join(parts)
        return ""
    return ""


def _extract_last_user_log_content(messages: list[dict]) -> str:
    """Return a compact, durable transcript entry for the latest user turn."""
    for msg in reversed(messages or []):
        if msg.get("role") != "user":
            continue
        content = msg.get("content", "")
        text = _message_text_content(content).strip()
        image_count = len(_extract_image_urls(content))
        if image_count:
            image_label = "[User attached 1 screenshot/image]" if image_count == 1 else f"[User attached {image_count} screenshots/images]"
            return f"{text}\n\n{image_label}".strip() if text else image_label
        return text
    return ""


def _detect_memory_search_query(text: str) -> str | None:
    """If `text` implies the user wants a memory lookup, return the query
    string to search for. Otherwise return None.

    Prefix triggers ("remember", "what about") strip the trigger before
    searching. Substring triggers search the full message. Very short
    residuals fall back to the full message.
    """
    if not text:
        return None
    stripped = text.strip()
    lower = stripped.lower()
    for prefix in _MEMORY_SEARCH_PREFIXES:
        if lower.startswith(prefix) and (len(lower) == len(prefix) or not lower[len(prefix)].isalpha()):
            residual = stripped[len(prefix):].strip(" ,.?!'\"")
            return residual if len(residual) >= 3 else stripped
    for needle in _MEMORY_SEARCH_SUBSTRINGS:
        if needle in lower:
            return stripped
    return None


def _maybe_memory_search_block(messages: list[dict]) -> str:
    """Return a ready-to-prepend block (capped at 500 chars) if the last
    user message implies a memory search. Empty string otherwise."""
    last_user = _extract_last_user_text(messages)
    query = _detect_memory_search_query(last_user)
    if query is None:
        logger.info("[chat/memsearch] no trigger phrase in last user message")
        return ""
    try:
        from pearl.context_loader import search_memory_archive, search_activity_archive
        mem_hits = search_memory_archive(query, max_matches=5, context=1)
        act_hits = search_activity_archive(query, max_matches=5, context=0)
    except Exception as exc:
        logger.warning(f"[chat/memsearch] archive search failed: {exc}")
        return ""
    blocks: list[str] = []
    if mem_hits and "no matches" not in mem_hits.lower():
        blocks.append(mem_hits)
    if act_hits and "no matches" not in act_hits.lower():
        blocks.append(act_hits)
    if not blocks:
        logger.info(f"[chat/memsearch] triggered for query={query!r} but 0 archive hits")
        return ""
    combined = "\n\n".join(blocks)
    if len(combined) > _MEMORY_SEARCH_MAX_CHARS:
        combined = combined[:_MEMORY_SEARCH_MAX_CHARS] + "\n...[truncated]"
    logger.info(
        f"[chat/memsearch] HIT query={query!r} chars={len(combined)} blocks={len(blocks)}"
    )
    return (
        "## On-demand memory archive search (user asked about a past event)\n"
        + combined
    )


async def _stream_openclaw_sse(
    messages: list[dict],
    session_key: str,
    *,
    system_prompt: str | None = None,
):
    """Stream chat completions through OpenClaw (Pearl's full brain).

    OpenClaw supplies Pearl's identity, memory, session history, and
    server-side tools. We just pass the user's messages and stream
    the SSE response back to the browser.

    `session_key` MUST be a per-user key (see _user_chat_session_key).
    Passing the global base key would cause OpenClaw to merge transcripts
    across users.
    """
    import aiohttp as _aiohttp

    openclaw_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
    openclaw_key = OPENCLAW_API_KEY

    headers = {
        "Content-Type": "application/json",
        "x-openclaw-session-key": session_key,
        "x-openclaw-channel": "webchat",
    }
    if openclaw_key:
        headers["Authorization"] = f"Bearer {openclaw_key}"

    payload_messages = list(messages)
    if system_prompt:
        payload_messages = [{"role": "system", "content": system_prompt}] + [
            m for m in payload_messages if m.get("role") != "system"
        ]

    payload = {
        "model": "openclaw/main",
        "messages": payload_messages,
        "stream": True,
        "temperature": _env_float("CHAT_TEMPERATURE", 0.95),
    }

    timeout = _aiohttp.ClientTimeout(
        total=CHAT_OPENCLAW_TIMEOUT_SECS,
        sock_connect=5,
        sock_read=CHAT_OPENCLAW_READ_GAP_SECS,
    )

    async with _aiohttp.ClientSession() as session:
        async with session.post(
            f"{openclaw_url.rstrip('/')}/chat/completions",
            json=payload,
            headers=headers,
            timeout=timeout,
        ) as resp:
            if resp.status != 200:
                error_text = (await resp.text())[:300]
                logger.error(f"[chat/openclaw] status={resp.status} body={error_text}")
                raise RuntimeError(f"OpenClaw returned {resp.status}")

            async for chunk in resp.content.iter_any():
                text = chunk.decode("utf-8", errors="replace")
                yield _normalize_style_punctuation(text)


def _messages_contain_images(messages: list[dict]) -> bool:
    """Return True if any user message contains image_url content blocks."""
    for msg in messages:
        if msg.get("role") == "user" and _extract_image_urls(msg.get("content")):
            return True
    return False


async def _stream_with_fallback(
    messages: list[dict],
    session_key: str,
    *,
    tools: list[dict] | None = None,
    user_context_block: str | None = None,
    onboarding_note: str | None = None,
    tenant_id: str | None = None,
    user_id: str | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
):
    """Stream web chat with repair-safe tool support.

    When browser-executable tools are available, bypass OpenClaw's currently
    suppressed sidecar loop and ask DeepSeek directly to emit tool calls for
    the web client to execute. Without tools, keep the repaired OpenClaw path
    first and fall back to direct DeepSeek on failure.

    When the user's message contains images, route directly through a
    configured OpenRouter vision model so the actual image_url content blocks
    reach a multimodal endpoint instead of being flattened by the session proxy.
    """
    try:
        pearl_prompt = _cached_web_chat_system_prompt(
            tenant_id=tenant_id,
            user_id=user_id,
            user_email=user_email,
            user_name=user_name,
        )
        clean_user_name = _usable_voice_identity(user_name)
        if clean_user_name:
            current_caller_block = (
                "## Current Web Chat Caller\n"
                f"This is the person currently chatting: name: {clean_user_name}\n"
                "Address this caller by their name if you use a name. Other names may appear in global PearlOS memory, project notes, old transcripts, or linked profiles. Do not use any of those names for the current caller unless this current caller/profile block says so."
            )
            pearl_prompt = f"{current_caller_block}\n\n{pearl_prompt}"
        memory_block = _maybe_memory_search_block(messages)
        if memory_block:
            pearl_prompt = f"{memory_block}\n\n{pearl_prompt}"
        if user_context_block:
            pearl_prompt = f"{user_context_block}\n\n{pearl_prompt}"
        if onboarding_note:
            pearl_prompt = f"{onboarding_note}\n\n{pearl_prompt}"
    except Exception:
        pearl_prompt = "\n\n".join(part for part in [onboarding_note, user_context_block] if part)

    has_images = _messages_contain_images(messages)

    if has_images and tools:
        logger.info(
            f"[chat] message contains images and tools; enriching through vision model={CHAT_IMAGE_VISION_MODEL}"
        )
        messages = await _enrich_latest_chat_image(messages)
    elif has_images:
        logger.info(f"[chat] message contains images; routing through direct vision model={CHAT_DIRECT_VISION_MODEL}")
        try:
            async for chunk in _stream_openrouter_vision_sse(
                messages,
                system_prompt=pearl_prompt or None,
            ):
                yield chunk
            return
        except Exception as exc:
            logger.warning(
                f"[chat] direct vision path failed ({type(exc).__name__}: {exc}); "
                "falling back to image description enrichment"
            )
            messages = await _enrich_latest_chat_image(messages)

    # When browser-executable tools are available (notes, weather, canvas, etc.),
    # try the tools-enabled DeepSeek path first so Pearl can actually create/open
    # notes and execute UI actions. The OpenClaw agent loop does not forward these
    # tool schemas to the underlying model, so tools-enabled requests need the
    # direct path to work.
    #
    # Without tools, use OpenClaw for personality/memory/task-dispatch.
    if tools:
        logger.info(f"[chat] tools provided ({len(tools)}), trying tools-enabled DeepSeek first")
        try:
            async for chunk in _stream_deepseek_direct_sse(
                messages,
                system_prompt=pearl_prompt or None,
                tools=tools,
                raise_on_error=True,
            ):
                yield chunk
            return
        except Exception as e:
            logger.warning(
                f"[chat] tools-enabled DeepSeek failed ({type(e).__name__}: {e}), "
                "falling back to OpenClaw"
            )

    try:
        async for chunk in _stream_openclaw_sse(
            messages,
            session_key,
            system_prompt=pearl_prompt or None,
        ):
            yield chunk
    except Exception as e:
        logger.warning(f"[chat] OpenClaw failed ({type(e).__name__}: {e}), falling back to direct DeepSeek")
        async for chunk in _stream_deepseek_direct_sse(
            messages,
            system_prompt=pearl_prompt or None,
            tools=tools,
            raise_on_error=False,
        ):
            yield chunk


# ── Per-user persistent webchat log ────────────────────────────────
# Canonical store for new webchat traffic. New rows live under
# /root/.openclaw/users/<tenant>/<user>/chat/messages.jsonl so each signed-in
# user gets their own data folder. Readers still fall back to the legacy flat
# /root/.openclaw/inbox/chat-<slug>.jsonl path so existing history survives
# the layout migration.
PEARL_CHAT_INBOX_ROOT = os.getenv("PEARL_CHAT_INBOX_DIR", "/root/.openclaw")
PEARL_CHAT_LOG_DIR = os.path.join(PEARL_CHAT_INBOX_ROOT, "inbox")
PEARL_CHAT_USER_DATA_DIR = os.getenv(
    "PEARL_CHAT_USER_DATA_DIR", os.path.join(PEARL_CHAT_INBOX_ROOT, "users")
)
PEARL_AGENT_STATE_DIR = os.getenv(
    "PEARL_RELAY_STATE_DIR", "/home/deploy/.openclaw/production-repair-relays"
)
PEARL_AGENT_OBLIGATIONS_PATH = os.path.join(
    PEARL_AGENT_STATE_DIR, "pearl-agent-obligations.json"
)


def _chat_log_email_to_slug(email: str) -> str:
    """Filesystem-safe slug for a normalised email. Mirrors the convention
    used by chat_inbox_api._email_to_slug so the two stores stay aligned."""
    return email.replace("@", "_at_").replace("+", "_plus_")


def _legacy_chat_log_path_for_email(email: str) -> str:
    return os.path.join(PEARL_CHAT_LOG_DIR, f"chat-{_chat_log_email_to_slug(email)}.jsonl")


def _chat_log_component(value: str | None, fallback: str) -> str:
    normalized = _normalize_user_id(str(value or ""))
    if not normalized:
        normalized = fallback
    return _chat_log_email_to_slug(normalized)


def _chat_log_path_for_identity(
    identity: str,
    *,
    tenant_id: str | None = None,
    user_id: str | None = None,
) -> str:
    tenant_slug = _chat_log_component(tenant_id, "default")
    user_slug = _chat_log_component(user_id or identity, "unknown")
    return os.path.join(PEARL_CHAT_USER_DATA_DIR, tenant_slug, user_slug, "chat", "messages.jsonl")


def _chat_log_path_for_email(email: str) -> str:
    return _chat_log_path_for_identity(email)


def _chat_log_paths_for_identity(
    identity: str,
    *,
    tenant_id: str | None = None,
    user_id: str | None = None,
) -> list[str]:
    paths = [
        _chat_log_path_for_identity(identity, tenant_id=tenant_id, user_id=user_id),
        _legacy_chat_log_path_for_email(identity),
    ]
    unique: list[str] = []
    for path in paths:
        if path not in unique:
            unique.append(path)
    return unique


def _chat_log_email_from_request(request: "Request | None") -> str | None:
    """Return the normalised x-user-email header value, or None if absent
    or unsafe. Uses the same allow-list as _normalize_user_id so callers
    can't smuggle one user's identity into another's log file."""
    if request is None:
        return None
    raw = request.headers.get("x-user-email") or request.headers.get("x-user-id") or ""
    norm = _normalize_user_id(raw)
    return norm or None


def _chat_log_scope_from_request(request: "Request | None") -> dict[str, str] | None:
    if request is None:
        return None
    identity = _chat_log_email_from_request(request)
    if not identity:
        return None
    tenant_id = _normalize_user_id(
        request.headers.get("x-tenant-id") or request.headers.get("x-pearl-tenant-id") or ""
    )
    user_id = _normalize_user_id(request.headers.get("x-user-id") or "")
    return {
        "identity": identity,
        "tenant_id": tenant_id,
        "user_id": user_id or identity,
    }


def _chat_log_append(
    identity: str,
    role: str,
    content: str,
    *,
    tenant_id: str | None = None,
    user_id: str | None = None,
) -> None:
    """Atomically append a row to the user's persistent chat log. Errors
    are swallowed (logged) so a disk hiccup never tears down the SSE
    stream — the OpenClaw transcript fallback stays available."""
    if not identity or not content:
        return
    try:
        path = _chat_log_path_for_identity(identity, tenant_id=tenant_id, user_id=user_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        entry = {
            "id": f"chat-{uuid.uuid4().hex[:12]}",
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "role": role,
            "content": content,
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
    except Exception as exc:
        logger.warning(f"[chat/log] append failed identity={identity!r} role={role!r}: {exc}")


def _agent_obligation_id(kind: str = "web_chat") -> str:
    return f"{kind}-{int(time.time() * 1000):x}-{uuid.uuid4().hex[:6]}"


def _read_agent_obligations() -> dict:
    try:
        with open(PEARL_AGENT_OBLIGATIONS_PATH, "r", encoding="utf-8") as f:
            state = json.load(f)
    except Exception:
        state = {"schemaVersion": 1, "obligations": {}}
    if not isinstance(state.get("obligations"), dict):
        state["obligations"] = {}
    state.setdefault("schemaVersion", 1)
    return state


def _write_agent_obligations(state: dict) -> None:
    os.makedirs(PEARL_AGENT_STATE_DIR, exist_ok=True)
    state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    tmp = f"{PEARL_AGENT_OBLIGATIONS_PATH}.{os.getpid()}.{int(time.time() * 1000)}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    os.replace(tmp, PEARL_AGENT_OBLIGATIONS_PATH)


def _assistant_reply_needs_continuation(reply: str) -> bool:
    text = " ".join((reply or "").lower().split())
    if not text:
        return False
    incomplete = re.search(
        r"\b(can't|cannot|couldn't|could not|don't have|do not have|not enough|not surfaced|"
        r"isn't surfaced|not public|not listed|unclear|missing|no clean|no direct|not in what i got|"
        r"not in the results|thin|conflicting|need(?:s)? deeper|need(?:s)? more|would need|"
        r"have to dig|keep digging)\b",
        text,
    )
    factual_gap = re.search(
        r"\b(pricing|cost|rate|per[- ]?(hour|minute)|comparison|compare|docs?|sources?|"
        r"current|latest|capabilities|availability|model|api|research|report)\b",
        text,
    )
    return bool(incomplete and factual_gap)


def _create_agent_obligation_for_web_chat(
    *,
    user_email: str,
    user_id: str | None,
    user_text: str,
    assistant_text: str,
) -> None:
    if not user_email or not user_text or not assistant_text:
        return
    state = _read_agent_obligations()
    goal = " ".join(user_text.split())[:500]
    dedupe_key = f"web_chat|deeper_lookup|{user_email}|{goal.lower()[:240]}"
    for item in state["obligations"].values():
        if (
            item.get("dedupeKey") == dedupe_key
            and str(item.get("status") or "") not in {"completed", "failed", "cancelled"}
        ):
            logger.info(f"[pearl-agent-runtime] web obligation already active for {user_email}")
            return
    created_ms = int(time.time() * 1000)
    oid = _agent_obligation_id("web_deeper_lookup")
    state["obligations"][oid] = {
        "id": oid,
        "dedupeKey": dedupe_key,
        "surface": "web_chat",
        "kind": "deeper_lookup",
        "status": "active",
        "title": f"Continue web chat lookup: {goal[:120]}",
        "goal": goal,
        "context": "The first visible web chat answer had an unresolved factual gap. Continue autonomously and bring back the missing details.",
        "lastAnswer": assistant_text[:1600],
        "taskId": "",
        "urgency": "normal",
        "userEmail": user_email,
        "authorId": user_id or "",
        "createdAt": created_ms,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "nextWakeAt": created_ms + 15_000,
        "lastUserVisibleUpdateAt": 0,
    }
    _write_agent_obligations(state)
    logger.info(f"[pearl-agent-runtime] created web obligation {oid} for {user_email}")


@app.post("/api/chat", dependencies=[Depends(require_auth)])
async def chat_completion(request: Request, body: ChatRequest):
    """Stream a chat completion through OpenClaw (Pearl's full brain).

    Primary path: OpenClaw agent session with Pearl's identity, memory,
    tools, and server-side agent loop. Streams SSE tokens in real-time.

    Fallback: Direct DeepSeek V4 Flash with cached system prompt (no tools,
    no memory, no agent loop). Only used when OpenClaw is unreachable.

    The OpenClaw session is scoped to the calling user's email so every
    user gets a private transcript. Anonymous callers (no x-user-email
    header from the interface layer) are rejected — there is no shared
    "default" transcript anymore.
    """
    pearl_surface = (request.headers.get("x-pearl-surface") or "").strip().lower()
    is_google_chat_dm = pearl_surface == "google-chat-dm"
    rate_limit_surface = "google_chat_dm" if is_google_chat_dm else "chat"
    apply_general_rate_limit(request, surface=rate_limit_surface)
    initial_chat_scope = _chat_log_scope_from_request(request) or {}
    await reserve_tenant_budget_async(
        tenant_id=initial_chat_scope.get("tenant_id"),
        surface="chat",
        estimated_cents=estimate_cents("chat", 2),
    )

    if CHAT_IMAGE_ENRICHMENT_ENABLED:
        enriched_input_messages = await _enrich_latest_chat_image(body.messages)
    else:
        enriched_input_messages = body.messages
    file_context_block = _file_context_block(body, request)
    file_context_messages = [{"role": "system", "content": file_context_block}] if file_context_block else []
    trimmed_history = file_context_messages + _trim_chat_messages(enriched_input_messages, max_pairs=CHAT_HISTORY_TRIM_PAIRS)
    latest_user_text = _extract_last_user_text(body.messages)
    is_tool_result_finalizer = bool(body.finalize_tool_results or body.disable_tools)

    web_profile_context = await _resolve_web_user_profile_context(request)
    web_profile_block = str(web_profile_context.get("context_block") or "").strip()
    profile_preferred_name = _usable_voice_identity(web_profile_context.get("preferred_name"))

    discord_context = await _resolve_discord_user_profile_context(request, body, latest_user_text)
    discord_email = str(discord_context.get("email") or "").strip().lower()
    discord_user_id = str(discord_context.get("user_id") or "").strip()
    discord_context_block = str(discord_context.get("context_block") or "").strip()
    user_context_block = "\n\n".join(
        block for block in (web_profile_block, discord_context_block, file_context_block) if block
    ).strip()
    onboarding_note = await _web_chat_onboarding_note(
        request,
        profile=web_profile_context.get("profile") if isinstance(web_profile_context.get("profile"), dict) else None,
    )

    user_session_key = _user_chat_session_key(request)
    if user_session_key is None and discord_email:
        user_session_key = _user_chat_session_key_from_identity(discord_email)
    if user_session_key is None and discord_user_id:
        user_session_key = _user_chat_session_key_from_identity(discord_user_id)
    if user_session_key is None:
        logger.warning("[chat] rejecting POST without browser identity or linked Discord identity")
        raise HTTPException(status_code=401, detail="user identity required")

    # Persist the user's latest message before we start streaming so the
    # history endpoint can see it even if the client disconnects mid-reply.
    user_email = _chat_log_email_from_request(request) or discord_email or discord_user_id
    chat_log_scope = _chat_log_scope_from_request(request) or {}
    chat_log_tenant_id = chat_log_scope.get("tenant_id")
    chat_log_user_id = chat_log_scope.get("user_id") or discord_user_id or user_email
    user_log_content = _extract_last_user_log_content(body.messages).strip()
    if user_email and user_log_content and not is_tool_result_finalizer:
        _chat_log_append(
            user_email,
            "user",
            user_log_content,
            tenant_id=chat_log_tenant_id,
            user_id=chat_log_user_id,
        )

    if not is_tool_result_finalizer and _should_auto_dispatch_repair_task(latest_user_text):
        _record, failure_reply = _create_webchat_agency_task(
            task_body=(
                "Web chat repair request from user:\n"
                f"{latest_user_text}\n\n"
                "Investigate the recent web chat conversation, attached files/screenshots, "
                "upload path, task dispatch path, and Pearl reply behavior. Implement the fix "
                "in /workspace/nia-universal, copy changes to the staging deploy tree, rebuild "
                "and restart the relevant PM2 services, then verify on staging. Follow "
                "docs/qa/BUILD_RELEASE_WORKFLOW.md. Codex CLI must verify the release plan "
                "before any staging build; use PEARLOS_CODEX_VERIFIED=1 only after that pass."
            ),
            task_title=_auto_dispatch_title(latest_user_text),
            task_kind="repair",
            user_email=user_email,
            request=request,
        )
        reply = failure_reply or (
            "That is in the repair queue now."
        )
        if user_email:
            _chat_log_append(
                user_email,
                "assistant",
                reply,
                tenant_id=chat_log_tenant_id,
                user_id=chat_log_user_id,
            )
        return StreamingResponse(
            _stream_auto_dispatched_task_reply(reply),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    build_dispatch = (
        None
        if is_tool_result_finalizer
        else _auto_dispatch_build_task(body.messages, latest_user_text)
    )
    if build_dispatch:
        task_body, task_title = build_dispatch
        _record, failure_reply = _create_webchat_agency_task(
            task_body=task_body,
            task_title=task_title,
            task_kind="build",
            user_email=user_email,
            request=request,
        )
        if failure_reply:
            reply = failure_reply
        else:
            reply = (
                "I started it as a task. I'll send the result back here in Google Chat when it finishes."
                if is_google_chat_dm
                else (
                    "I started it as an Agency task. It should show in The Agency "
                    "and the task list, with the result attached there when it finishes."
                )
            )
        if user_email:
            _chat_log_append(
                user_email,
                "assistant",
                reply,
                tenant_id=chat_log_tenant_id,
                user_id=chat_log_user_id,
            )
        return StreamingResponse(
            _stream_auto_dispatched_task_reply(reply),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    async def _stream_with_disconnect(messages):
        """Wrap the stream to stop when the client disconnects.
        This frees the OpenClaw session lane for the next request.

        We accumulate the assistant's emitted text into a buffer and
        persist it to the per-user chat log when the stream finishes —
        cleanly OR on disconnect — so the user always sees Pearl's reply
        on reload. Upstream chunks are SSE-framed (`data: {...}\\n\\n`)
        so we parse out the `delta.content` field for the persistent
        log; the raw chunks are still yielded to the browser unchanged."""
        delta_buf: list[str] = []
        sse_carry = ""
        filter_carry = ""
        early_text_buffer = ""
        early_text_events: list[str] = []
        early_text_closed = False

        def _drain_sse(blob: str) -> None:
            nonlocal sse_carry
            sse_carry += blob
            while "\n\n" in sse_carry:
                event, sse_carry = sse_carry.split("\n\n", 1)
                for raw_line in event.split("\n"):
                    line = raw_line.strip()
                    if not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        obj = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    for choice in obj.get("choices", []) or []:
                        delta = choice.get("delta") or {}
                        text = delta.get("content")
                        if isinstance(text, str) and text:
                            delta_buf.append(text)

        def _choice_delta(obj: dict) -> dict:
            choices = obj.get("choices") or []
            if not choices or not isinstance(choices[0], dict):
                return {}
            delta = choices[0].get("delta") or {}
            return delta if isinstance(delta, dict) else {}

        def _event_has_tool_call(obj: dict) -> bool:
            delta = _choice_delta(obj)
            if isinstance(delta.get("tool_calls"), list) and delta.get("tool_calls"):
                return True
            if isinstance(obj.get("tool_calls"), list) and obj.get("tool_calls"):
                return True
            return False

        def _event_content(obj: dict) -> str:
            if obj.get("type") == "text" and isinstance(obj.get("content"), str):
                return obj.get("content") or ""
            delta = _choice_delta(obj)
            text = delta.get("content")
            return text if isinstance(text, str) else ""

        def _flush_early_text() -> str:
            nonlocal early_text_buffer, early_text_events, early_text_closed
            if not early_text_events:
                return ""
            out = ""
            if not _PROCESS_NARRATION_RE.search(early_text_buffer):
                out = "\n\n".join(early_text_events) + "\n\n"
            early_text_buffer = ""
            early_text_events = []
            early_text_closed = True
            return out

        def _filter_process_narration_sse(blob: str, *, final: bool = False) -> str:
            """Drop pre-tool process narration without touching normal answers."""
            nonlocal filter_carry, early_text_buffer, early_text_events, early_text_closed
            filter_carry += blob
            output: list[str] = []
            while "\n\n" in filter_carry:
                event, filter_carry = filter_carry.split("\n\n", 1)
                if not event.strip():
                    continue
                line_payloads = [
                    line.strip()[len("data:"):].strip()
                    for line in event.split("\n")
                    if line.strip().startswith("data:")
                ]
                payload = line_payloads[0] if line_payloads else ""
                if payload == "[DONE]":
                    output_text = _flush_early_text()
                    if output_text:
                        output.append(output_text.rstrip("\n"))
                    output.append(event)
                    continue
                try:
                    obj = json.loads(payload) if payload else {}
                except json.JSONDecodeError:
                    output_text = _flush_early_text()
                    if output_text:
                        output.append(output_text.rstrip("\n"))
                    output.append(event)
                    early_text_closed = True
                    continue

                if _event_has_tool_call(obj):
                    early_text_buffer = ""
                    early_text_events = []
                    early_text_closed = True
                    output.append(event)
                    continue

                text = _event_content(obj)
                if text and not early_text_closed:
                    early_text_buffer += text
                    early_text_events.append(event)
                    if _PROCESS_NARRATION_RE.search(early_text_buffer) or (
                        len(early_text_buffer) < 32 and _PROCESS_NARRATION_PREFIX_RE.match(early_text_buffer)
                    ):
                        continue
                    output_text = _flush_early_text()
                    if output_text:
                        output.append(output_text.rstrip("\n"))
                    continue

                output.append(event)

            if final and filter_carry.strip():
                output_text = _flush_early_text()
                if output_text:
                    output.append(output_text.rstrip("\n"))
                output.append(filter_carry.strip())
                filter_carry = ""

            return ("\n\n".join(output) + ("\n\n" if output else ""))

        try:
            try:
                from pearl.bot_tools import WEB_CHAT_BOT_TOOLS
                web_chat_tools = None if is_tool_result_finalizer else WEB_CHAT_BOT_TOOLS
            except Exception as exc:
                logger.warning(f"[chat/tools] failed to load web chat tools: {exc}")
                web_chat_tools = None

            async for chunk in _stream_with_fallback(
                messages,
                user_session_key,
                tools=web_chat_tools,
                user_context_block=user_context_block or None,
                onboarding_note=onboarding_note or None,
                tenant_id=request.headers.get("x-tenant-id") or request.headers.get("x-pearl-tenant-id"),
                user_id=request.headers.get("x-user-id"),
                user_email=request.headers.get("x-user-email"),
                user_name=profile_preferred_name,
            ):
                if await request.is_disconnected():
                    logger.info("[chat] Client disconnected, stopping stream")
                    return
                filtered_chunk = _filter_process_narration_sse(chunk) if isinstance(chunk, str) else chunk
                if isinstance(filtered_chunk, str) and user_email:
                    _drain_sse(filtered_chunk)
                if filtered_chunk:
                    yield filtered_chunk
            tail = _filter_process_narration_sse("", final=True)
            if tail:
                if user_email:
                    _drain_sse(tail)
                yield tail
        finally:
            if user_email and not is_tool_result_finalizer:
                full = "".join(delta_buf).strip()
                if full:
                    _chat_log_append(
                        user_email,
                        "assistant",
                        full,
                        tenant_id=chat_log_tenant_id,
                        user_id=chat_log_user_id,
                    )
                    if not is_google_chat_dm and _assistant_reply_needs_continuation(full):
                        try:
                            _create_agent_obligation_for_web_chat(
                                user_email=user_email,
                                user_id=request.headers.get("x-user-id"),
                                user_text=latest_user_text,
                                assistant_text=full,
                            )
                        except Exception as exc:
                            logger.warning(f"[pearl-agent-runtime] web obligation create failed: {exc}")

    return StreamingResponse(
        _stream_with_disconnect(trimmed_history),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Task control endpoint ──────────────────────────────────────────
class StopTaskRequest(BaseModel):
    task_label: Optional[str] = None
    taskId: Optional[str] = None
    action: str = "stop"  # stop, pause, cancel, or kill


def _park_task_queue_record(task_id: str, action: str) -> dict | None:
    """Move a queue task out of executable state so the worker stops it.

    The queue worker listens to task update events. Parking the record on a
    non-worker assignee is the control signal that terminates any matching
    in-flight subprocess and prevents immediate auto-reclaim.
    """
    try:
        from api.tasks_api import get_store
    except Exception as exc:
        logger.warning(f"[stop_task] task store unavailable: {exc}")
        return None

    task_id = (task_id or "").strip()
    if not task_id:
        return None

    store = get_store()
    existing = store.get(task_id)
    if not existing:
        return None

    clean_action = action if action in ("pause", "stop", "cancel", "kill") else "stop"
    parked_status = "pending" if clean_action == "pause" else "cancelled"
    note_action = "paused" if clean_action == "pause" else "stopped"
    if clean_action in ("cancel", "kill"):
        note_action = "cancelled"

    return store.update(task_id, {
        "status": parked_status,
        "assignee": "pearl",
        "urgency": "normal",
        "notes_append": {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            "text": f"{note_action} from UI via task control endpoint",
        },
    })

@app.post("/api/tasks/stop", dependencies=[Depends(require_strict_auth)])
async def stop_task(body: StopTaskRequest):
    """Stop a running OpenClaw sub-agent or background task."""
    try:
        task_label = (body.task_label or body.taskId or "").strip()
        if not task_label:
            raise HTTPException(status_code=400, detail="task_label_required")
        parked_task = _park_task_queue_record(body.taskId or "", body.action)
        async with aiohttp.ClientSession() as session:
            # Get list of sessions
            headers = {"Content-Type": "application/json"}
            if OPENCLAW_API_KEY:
                headers["Authorization"] = f"Bearer {OPENCLAW_API_KEY}"
            
            async with session.get(
                f"{OPENCLAW_BASE_URL}/api/sessions",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail=f"OpenClaw returned {resp.status}")
                
                try:
                    data = await resp.json(content_type=None)
                except Exception as exc:
                    logger.warning(f"[stop_task] OpenClaw sessions response was not JSON: {exc}")
                    data = {}
                sessions = data.get("sessions", []) if isinstance(data, dict) else []
                
                # Find session matching task_label
                target_session = None
                for s in sessions:
                    session_label = s.get("label", "")
                    session_key = s.get("key", "")
                    # Match by label or key containing the task_label
                    if (task_label.lower() in session_label.lower() or
                        task_label.lower() in session_key.lower()):
                        target_session = s
                        break
                
                if not target_session:
                    response = {
                        "status": "not_found",
                        "message": f"No active task found matching '{task_label}'",
                    }
                    if parked_task:
                        response["task_status"] = "parked"
                    return response
                
                session_key = target_session["key"]
                
                # Send stop signal to the session
                # (OpenClaw doesn't have a direct kill API, so we send a stop message)
                async with session.post(
                    f"{OPENCLAW_BASE_URL}/v1/chat/completions",
                    headers=headers,
                    json={
                        "model": "openclaw",
                        "messages": [
                            {
                                "role": "system",
                                "content": f"User requested to {body.action} this task. Stop all work immediately and report status."
                            }
                        ],
                        "stream": False,
                        "x-openclaw-session-key": session_key
                    },
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as stop_resp:
                    if stop_resp.status == 200:
                        response = {
                            "status": "stopped",
                            "message": f"Sent {body.action} signal to task '{task_label}'",
                            "session_key": session_key
                        }
                        if parked_task:
                            response["task_status"] = "parked"
                        return response
                    else:
                        raise HTTPException(status_code=502, detail=f"Failed to stop task: {stop_resp.status}")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[stop_task] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Chat history endpoint ──────────────────────────────────────────
OPENCLAW_SESSIONS_DIR = os.path.join(
    os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace"),
    "..", "agents", "main", "sessions",
)
# Normalise so ../agents resolves properly
OPENCLAW_SESSIONS_DIR = os.path.normpath(OPENCLAW_SESSIONS_DIR)


# Prefixes that mark an OpenClaw transcript message as internal automation /
# system bookkeeping rather than something the human user actually typed in
# webchat. These are stored as `role=user` in the transcript because that is
# the only way to inject context into OpenClaw, but they are NOT the user's
# chat — surfacing them in /api/chat/history makes the webchat look like it
# is full of "old test/QA messages". See SPECTRUM bug #1.
_INTERNAL_USER_MESSAGE_PREFIXES = (
    "System (untrusted):",
    "[Chat messages since your last reply",
    "[System reminder",
    "<system-reminder>",
    "[Pearl-task automation]",
    "[Automation]",
    "[QA]",
    "[Test]",
)


def _looks_like_internal_user_message(content: str) -> bool:
    """True if a user-role message looks like automation/QA/system noise
    rather than something the human typed. We strip leading whitespace so
    a stray newline before the marker doesn't defeat the filter."""
    head = content.lstrip()[:80]
    return any(head.startswith(p) for p in _INTERNAL_USER_MESSAGE_PREFIXES)


_WRAPPED_USER_MARKER = "[Chat messages since your last reply"
_WRAPPED_USER_CURRENT_MARKER = "[Current message - respond to this]"


def _extract_wrapped_user_message(content: str) -> str:
    """OpenClaw wraps every user input as:

        [Chat messages since your last reply - for context]
        ... prior turns ...

        [Current message - respond to this]
        User: <the actual text>

    Pull the actual text out so the history view shows what the human
    typed instead of dropping the whole entry. Returns "" if the wrapper
    didn't contain a [Current message] block (in which case the row is
    pure context bookkeeping and should be discarded by the caller)."""
    if _WRAPPED_USER_CURRENT_MARKER not in content:
        return ""
    # Take everything after the LAST [Current message - respond to this]
    # marker so a wrapper that itself quoted a previous wrapper still
    # resolves to the freshest user text.
    tail = content.rsplit(_WRAPPED_USER_CURRENT_MARKER, 1)[-1]
    # Drop the newline(s) that always follow the marker.
    tail = tail.lstrip("\r\n")
    # Strip the leading "User:" label if present (one-liners may not have it).
    if tail.lower().startswith("user:"):
        tail = tail[len("user:"):].lstrip()
    return tail.strip()


def _parse_before_ms(value: object) -> Optional[int]:
    """Coerce a query-string `before` cursor (ms epoch) to int. Returns
    None if the value is missing or unparseable."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _entry_ts_ms(ts_value: object) -> Optional[int]:
    """Best-effort conversion of an ISO-8601 timestamp string to epoch ms,
    used for `before` cursor filtering."""
    if not ts_value or not isinstance(ts_value, str):
        return None
    try:
        from datetime import datetime
        s = ts_value.replace("Z", "+00:00")
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except Exception:
        return None


def _read_persistent_chat_log(
    identity: str,
    *,
    tenant_id: str | None = None,
    user_id: str | None = None,
) -> list[dict]:
    """Read all rows from the per-user persistent chat log. Returns []
    when the file does not exist or has no usable entries.

    User-role rows that look like automation/QA/system noise are dropped,
    and rows wrapped as a "[Chat messages since your last reply...]"
    context block are unwrapped to the actual current user text. Without
    this, past automation traffic that landed in the persistent log
    (because a QA call carried a real user's x-user-email header) would
    replay forever as fake "old test/QA messages" in the user's webchat.
    See SPECTRUM bug #1.
    """
    rows: list[dict] = []
    for path in _chat_log_paths_for_identity(identity, tenant_id=tenant_id, user_id=user_id):
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    role = entry.get("role")
                    content = entry.get("content")
                    if role not in ("user", "assistant") or not isinstance(content, str):
                        continue

                    if role == "user":
                        head = content.lstrip()
                        if head.startswith(_WRAPPED_USER_MARKER):
                            extracted = _extract_wrapped_user_message(content)
                            if not extracted:
                                continue  # pure context wrapper, no current msg
                            content = extracted
                        elif _looks_like_internal_user_message(content):
                            continue

                    rows.append({
                        "role": role,
                        "content": content,
                        "timestamp": entry.get("ts", ""),
                    })
        except Exception as exc:
            logger.warning(f"[chat/history] persistent log read failed for {identity!r} path={path!r}: {exc}")
    rows.sort(key=lambda row: _entry_ts_ms(row.get("timestamp")) or 0)
    return rows


def _coerce_voice_startup_chat_context(raw: object, limit: int = 12) -> list[dict[str, Any]]:
    """Normalize startup chat turns before handing them to the voice bot."""
    if not isinstance(raw, list):
        return []
    turns: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        text = " ".join(content.split()).strip()
        if not text:
            continue
        turn: dict[str, Any] = {
            "role": role,
            "content": text[:1600],
        }
        timestamp = item.get("timestamp")
        if isinstance(timestamp, (str, int, float)) and str(timestamp).strip():
            turn["timestamp"] = timestamp
        turns.append(turn)
    return turns[-limit:]


def _enrich_voice_startup_context(body: dict[str, Any], req_logger) -> None:
    """Attach recent webchat turns to voice startup from the canonical log.

    The browser may include a local cache, but the gateway is the reliable
    place to recover context when that cache is missing or stale.
    """
    existing_turns = _coerce_voice_startup_chat_context(body.get("webChatContext"))
    if existing_turns:
        body["webChatContext"] = existing_turns
        req_logger.info("[gateway] Voice startup webchat context accepted", turnCount=len(existing_turns))
        return

    tenant_id = _normalize_user_id(
        str(body.get("tenantId") or body.get("sessionTenantId") or body.get("pearlTenantId") or "")
    )
    session_user_id = _normalize_user_id(str(body.get("sessionUserId") or ""))

    for raw_user_ref in (body.get("sessionUserEmail"), body.get("sessionUserId")):
        user_ref = _normalize_user_id(str(raw_user_ref or ""))
        if not user_ref:
            continue
        persistent_turns = _coerce_voice_startup_chat_context(
            _read_persistent_chat_log(
                user_ref,
                tenant_id=tenant_id,
                user_id=session_user_id or user_ref,
            )
        )
        if persistent_turns:
            body["webChatContext"] = persistent_turns
            req_logger.info(
                "[gateway] Voice startup webchat context loaded from persistent log",
                turnCount=len(persistent_turns),
            )
            return

    req_logger.info("[gateway] No voice startup webchat context available")


@app.get("/api/chat/history", dependencies=[Depends(require_auth)])
async def chat_history(request: Request, limit: int = 50, before: Optional[int] = None):
    """Return recent user/assistant chat messages from the calling user's
    OpenClaw transcript.

    Each user has their own session key (see _user_chat_session_key). A
    request that does not identify a user (no x-user-email header from the
    interface layer) gets an empty list — there is no longer a shared
    "default" transcript that would otherwise leak one user's history to
    another. This is what makes a fresh InPrivate window with no NextAuth
    cookie show no history.

    User-role messages that are actually internal automation bookkeeping
    (exec-completed notices, "[Chat messages since your last reply...]"
    context blocks, system reminders) are filtered out so webchat shows
    only what the human actually typed and what Pearl actually replied.
    """
    try:
        user_session_key = _user_chat_session_key(request)
        if user_session_key is None:
            return {"messages": []}

        before_ms = before if isinstance(before, int) else _parse_before_ms(before)

        # 1. Persistent per-user chat log (canonical store for new traffic).
        user_email = _chat_log_email_from_request(request)
        if user_email:
            chat_log_scope = _chat_log_scope_from_request(request) or {}
            persistent = _read_persistent_chat_log(
                user_email,
                tenant_id=chat_log_scope.get("tenant_id"),
                user_id=chat_log_scope.get("user_id"),
            )
            if persistent:
                if before_ms is not None:
                    persistent = [
                        m for m in persistent
                        if (_entry_ts_ms(m.get("timestamp")) or 0) < before_ms
                    ]
                return {"messages": persistent[-limit:]}

        # 2. Legacy fallback: read from OpenClaw's transcript and unwrap
        # the "[Chat messages since your last reply]" blocks so the user's
        # actual text (which lives after [Current message - respond to this])
        # surfaces in the history view. Pure context-only wrappers are
        # dropped, as are other internal automation prefixes.
        sessions_file = os.path.join(OPENCLAW_SESSIONS_DIR, "sessions.json")
        if not os.path.exists(sessions_file):
            return {"messages": []}

        with open(sessions_file, "r") as f:
            sessions = json.load(f)

        session_info = sessions.get(user_session_key)
        if not session_info:
            return {"messages": []}

        # Prefer the explicit sessionFile path recorded in sessions.json,
        # since OpenClaw may rotate the transcript file (checkpoint/overflow)
        # while keeping the same sessionId. Fall back to <sessionId>.jsonl only
        # if sessionFile is absent.
        transcript_path = session_info.get("sessionFile")
        if not transcript_path:
            session_id = session_info.get("sessionId")
            if not session_id:
                return {"messages": []}
            transcript_path = os.path.join(OPENCLAW_SESSIONS_DIR, f"{session_id}.jsonl")

        if not os.path.exists(transcript_path):
            return {"messages": []}

        messages = []
        with open(transcript_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if entry.get("type") != "message":
                    continue

                msg = entry.get("message", {})
                role = msg.get("role")
                if role not in ("user", "assistant"):
                    continue

                # Extract text content
                content_raw = msg.get("content", "")
                if isinstance(content_raw, list):
                    # content is array of content blocks
                    text_parts = []
                    has_tool_call = False
                    for block in content_raw:
                        if isinstance(block, dict):
                            if block.get("type") == "text":
                                text_parts.append(block.get("text", ""))
                            elif block.get("type") == "toolCall":
                                has_tool_call = True
                    if has_tool_call and not text_parts:
                        continue  # skip pure tool-call messages
                    content = "\n".join(text_parts)
                elif isinstance(content_raw, str):
                    content = content_raw
                else:
                    continue

                content = content.strip()
                if not content:
                    continue

                # User-role messages are almost always wrapped as a
                # [Chat messages since your last reply...] block by
                # OpenClaw before persistence. Try to extract the actual
                # user text from inside the wrapper; fall back to the
                # noise filter for everything else.
                if role == "user":
                    head = content.lstrip()
                    if head.startswith(_WRAPPED_USER_MARKER):
                        extracted = _extract_wrapped_user_message(content)
                        if not extracted:
                            continue  # pure context wrapper, no current msg
                        content = extracted
                    elif _looks_like_internal_user_message(content):
                        continue

                ts_value = entry.get("timestamp", "")
                if before_ms is not None:
                    ts_ms = _entry_ts_ms(ts_value)
                    if ts_ms is not None and ts_ms >= before_ms:
                        continue

                messages.append({
                    "role": role,
                    "content": content,
                    "timestamp": ts_value,
                })

        # Return last N messages
        return {"messages": messages[-limit:]}

    except Exception as e:
        logger.error(f"[chat/history] Error reading transcript: {e}", exc_info=True)
        return {"messages": []}


@app.post("/api/chat/history", dependencies=[Depends(require_auth)])
async def chat_history_append(request: Request, body: ChatHistoryAppendRequest):
    """Append a user-visible web-chat transcript row for browser-side paths
    that do not stream through /api/chat.

    The interface proxy supplies the tenant/user identity through trusted
    auth-scoped headers; body identity fields are ignored.
    """
    role = str(body.role or "").strip().lower()
    content = str(body.content or "").strip()
    if role not in {"user", "assistant"}:
        raise HTTPException(status_code=400, detail="role must be user or assistant")
    if not content:
        raise HTTPException(status_code=400, detail="content required")
    if len(content) > 20000:
        content = content[:20000] + "\n...[truncated]"

    user_email = _chat_log_email_from_request(request)
    if not user_email:
        raise HTTPException(status_code=401, detail="user identity required")
    chat_log_scope = _chat_log_scope_from_request(request) or {}
    _chat_log_append(
        user_email,
        role,
        content,
        tenant_id=chat_log_scope.get("tenant_id"),
        user_id=chat_log_scope.get("user_id") or user_email,
    )
    return {"ok": True}


# ── Webchat archive endpoint ───────────────────────────────────────
@app.post("/api/chat/archive", dependencies=[Depends(require_auth)])
async def chat_archive(request: Request):
    """Archive the calling user's persistent chat log AND orphan their
    OpenClaw session pointer so Pearl starts a fresh transcript on the
    next /api/chat call. The underlying OpenClaw transcript .jsonl file
    is left in place — that store is owned by OpenClaw and rotates on
    its own cadence."""
    user_email = _chat_log_email_from_request(request)
    if not user_email:
        raise HTTPException(status_code=401, detail="user identity required")

    archived_path: Optional[str] = None
    chat_log_scope = _chat_log_scope_from_request(request) or {}
    for log_path in _chat_log_paths_for_identity(
        user_email,
        tenant_id=chat_log_scope.get("tenant_id"),
        user_id=chat_log_scope.get("user_id"),
    ):
        if not os.path.exists(log_path):
            continue
        ts_ms = int(time.time() * 1000)
        base, ext = os.path.splitext(os.path.basename(log_path))
        archived_path = os.path.join(
            os.path.dirname(log_path),
            f"{base}.archived.{ts_ms}{ext or '.jsonl'}",
        )
        try:
            os.rename(log_path, archived_path)
        except OSError as exc:
            logger.error(f"[chat/archive] could not rename {log_path}: {exc}")
            raise HTTPException(status_code=500, detail="archive failed")

    # Drop the OpenClaw session pointer for this user so Pearl forks a
    # fresh transcript on the next message. Failures are logged but do
    # not fail the request — orphaning the persistent log is the
    # primary visible effect.
    user_session_key = _user_chat_session_key(request)
    if user_session_key:
        sessions_file = os.path.join(OPENCLAW_SESSIONS_DIR, "sessions.json")
        try:
            if os.path.exists(sessions_file):
                with open(sessions_file, "r", encoding="utf-8") as f:
                    sessions = json.load(f)
                if user_session_key in sessions:
                    sessions.pop(user_session_key, None)
                    tmp = sessions_file + ".tmp"
                    with open(tmp, "w", encoding="utf-8") as f:
                        json.dump(sessions, f, indent=2)
                        f.flush()
                        try:
                            os.fsync(f.fileno())
                        except OSError:
                            pass
                    os.replace(tmp, sessions_file)
        except Exception as exc:
            logger.warning(
                f"[chat/archive] could not clear OpenClaw session pointer "
                f"for {user_session_key!r}: {exc}"
            )

    return {"ok": True, "archived": archived_path}


# ---------------------------------------------------------------------------
# Image proxy / resolver — returns a reliable image for a given search query.
# Uses Wikipedia's REST API to find an actual matching thumbnail.
# Used by Wonder Canvas so it doesn't have to guess Unsplash photo IDs.
# ---------------------------------------------------------------------------

_image_cache: OrderedDict[str, str] = OrderedDict()  # query -> resolved image URL (LRU, capped)
_IMAGE_URL_CACHE_MAX = 200

# Wikipedia requires a descriptive User-Agent with contact info per their
# robot policy (https://w.wiki/4wJS).  Generic / short UAs get 403'd.
_WIKI_UA = "PearlOS/1.0 (https://pearlos.org; contact@pearlos.org) aiohttp/3.x"


async def _resolve_wiki_title(session: aiohttp.ClientSession, q: str) -> str | None:
    """Use Wikipedia's opensearch API to resolve the canonical article title."""
    import urllib.parse
    url = (
        f"https://en.wikipedia.org/w/api.php?action=opensearch"
        f"&search={urllib.parse.quote(q)}&limit=1&format=json"
    )
    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=6),
            headers={"User-Agent": _WIKI_UA},
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                if len(data) >= 2 and data[1]:
                    return data[1][0].replace(" ", "_")
    except Exception as e:
        logger.warning(f"[image-proxy] opensearch failed for '{q}': {e}")
    return None


def _make_svg_placeholder(q: str) -> str:
    """Return a simple SVG placeholder with the query text."""
    import html
    label = html.escape(q[:40])
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">'
        f'<rect width="600" height="400" fill="#1a0e2e"/>'
        f'<text x="300" y="200" font-family="Georgia" font-size="24" '
        f'fill="#FFD233" text-anchor="middle" dominant-baseline="middle">{label}</text>'
        f'</svg>'
    )
    return svg


from fastapi.responses import RedirectResponse, Response as FastAPIResponse
from collections import OrderedDict

# LRU cache for image bytes: key -> (content_type, bytes)
_image_bytes_cache: OrderedDict[str, tuple[str, bytes]] = OrderedDict()
_IMAGE_BYTES_CACHE_MAX = 50


async def _fetch_image_bytes(session: aiohttp.ClientSession, url: str) -> tuple[str, bytes] | None:
    """Fetch image bytes from a URL. Returns (content_type, bytes) or None."""
    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=15),
            headers={"User-Agent": _WIKI_UA},
        ) as resp:
            if resp.status == 200:
                ct = resp.headers.get("Content-Type", "image/jpeg")
                data = await resp.read()
                if len(data) > 0:
                    return (ct, data)
    except Exception as e:
        logger.warning(f"[image-proxy] Failed to fetch bytes from {url}: {e}")
    return None


@app.get("/api/image")
async def image_proxy(q: str):
    """Resolve a search query to a real image via Wikipedia.

    Returns the actual image bytes (cached in memory) to avoid downstream
    rate-limiting from Wikimedia 302 redirects.

    Usage: GET /api/image?q=sea+turtle
    """
    q_lower = q.lower().strip()

    # 1. Check bytes cache
    if q_lower in _image_bytes_cache:
        _image_bytes_cache.move_to_end(q_lower)
        ct, img_bytes = _image_bytes_cache[q_lower]
        logger.info(f"[image-proxy] Bytes cache hit for '{q_lower}' ({len(img_bytes)} bytes)")
        return FastAPIResponse(content=img_bytes, media_type=ct, headers={
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
        })

    # 2. Resolve URL (from URL cache or Wikipedia API)
    img_url = _image_cache.get(q_lower)

    if not img_url:
        async with aiohttp.ClientSession() as session:
            # Try progressively simpler search terms
            words = q_lower.split()
            search_variants = [q_lower]
            # Add subset variants: first 3 words, first 2, first 1
            for n in (3, 2, 1):
                if len(words) > n:
                    search_variants.append(" ".join(words[:n]))

            for variant in search_variants:
                slug = await _resolve_wiki_title(session, variant)
                if not slug:
                    slug = variant.replace(" ", "_").capitalize()

                wiki_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"
                try:
                    async with session.get(
                        wiki_url,
                        timeout=aiohttp.ClientTimeout(total=8),
                        headers={"User-Agent": _WIKI_UA},
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for key in ("thumbnail", "originalimage"):
                                src = (data.get(key) or {}).get("source")
                                if src:
                                    img_url = src
                                    break
                            if img_url:
                                import re as _re
                                img_url = _re.sub(r"/\d+px-", "/800px-", img_url)
                                _image_cache[q_lower] = img_url
                                if len(_image_cache) > _IMAGE_URL_CACHE_MAX:
                                    _image_cache.popitem(last=False)
                                logger.info(f"[image-proxy] Resolved '{q_lower}' (variant='{variant}') → {img_url}")
                                break
                        else:
                            logger.info(f"[image-proxy] Wikipedia returned {resp.status} for slug '{slug}'")
                except Exception as e:
                    logger.warning(f"[image-proxy] Wikipedia lookup failed for '{variant}': {e}")

            # NOTE: source.unsplash.com is defunct (returns 503). No Unsplash fallback.
            if not img_url:
                logger.info(f"[image-proxy] No image found for '{q_lower}' via Wikipedia")

    # 3. Fetch and cache image bytes
    if img_url:
        async with aiohttp.ClientSession() as session:
            result = await _fetch_image_bytes(session, img_url)
            if result:
                ct, img_bytes = result
                _image_bytes_cache[q_lower] = (ct, img_bytes)
                if len(_image_bytes_cache) > _IMAGE_BYTES_CACHE_MAX:
                    _image_bytes_cache.popitem(last=False)
                logger.info(f"[image-proxy] Cached bytes for '{q_lower}' ({len(img_bytes)} bytes)")
                return FastAPIResponse(content=img_bytes, media_type=ct, headers={
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*",
                })

    # 4. Fallback: SVG placeholder
    logger.info(f"[image-proxy] Using SVG placeholder for '{q_lower}'")
    svg_content = _make_svg_placeholder(q)
    return FastAPIResponse(content=svg_content, media_type="image/svg+xml", headers={
        "Access-Control-Allow-Origin": "*",
    })


# ---------------------------------------------------------------------------
# Photo Magic — image generation / editing via the interface OpenRouter routes
# ---------------------------------------------------------------------------

from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse

PHOTO_MAGIC_OUTPUT_DIR = os.getenv("PHOTO_MAGIC_OUTPUT_DIR", "/tmp/photo-magic")
PHOTO_MAGIC_INTERFACE_BASE_URL = (
    os.getenv("PHOTO_MAGIC_INTERFACE_BASE_URL")
    or os.getenv("NEXTAUTH_INTERFACE_URL")
    or os.getenv("NEXT_PUBLIC_INTERFACE_URL")
    or os.getenv("NEXT_PUBLIC_APP_URL")
    or "http://127.0.0.1:3000"
).rstrip("/")


class PhotoMagicGenerateRequest(BaseModel):
    prompt: str


def _photo_magic_claim_headers(
    *,
    request: Request | None = None,
    tenant_id: str | None = None,
    user_id: str | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
    session_id: str | None = None,
) -> dict[str, str]:
    if request is not None:
        forwarded = {
            "x-bot-claims-ts": (request.headers.get("x-bot-claims-ts") or "").strip(),
            "x-bot-claims": (request.headers.get("x-bot-claims") or "").strip(),
            "x-bot-claims-sig": (request.headers.get("x-bot-claims-sig") or "").strip(),
        }
        if all(forwarded.values()):
            return forwarded

    clean_tenant_id = (tenant_id or "").strip()
    clean_user_id = (user_id or "").strip()
    secret = _claims_secret()
    if not (clean_tenant_id and clean_user_id and secret):
        return {}

    timestamp = str(int(time.time() * 1000))
    payload = json.dumps(
        {
            "tenantId": clean_tenant_id,
            "sessionUserId": clean_user_id,
            "sessionId": (session_id or "photo-magic").strip() or "photo-magic",
            "sessionUserEmail": (user_email or "").strip(),
            "sessionUserName": (user_name or "").strip(),
        },
        separators=(",", ":"),
    )
    signature = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{payload}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "x-bot-claims-ts": timestamp,
        "x-bot-claims": payload,
        "x-bot-claims-sig": signature,
    }


async def _proxy_photo_magic_json(
    path: str,
    *,
    json_body: dict | None = None,
    form_data: aiohttp.FormData | None = None,
    claim_headers: dict[str, str] | None = None,
) -> dict:
    url = f"{PHOTO_MAGIC_INTERFACE_BASE_URL}{path}"
    timeout = aiohttp.ClientTimeout(total=180, sock_connect=5)
    headers = claim_headers or {}
    async with aiohttp.ClientSession(timeout=timeout) as session:
        if form_data is not None:
            response_ctx = session.post(url, data=form_data, headers=headers)
        else:
            response_ctx = session.post(url, json=json_body or {}, headers=headers)
        async with response_ctx as response:
            text = await response.text()
            try:
                payload = json.loads(text) if text else {}
            except json.JSONDecodeError:
                payload = {"detail": text}
            if response.status >= 400:
                detail = payload.get("detail") or payload.get("error") or text or f"Photo Magic returned {response.status}"
                raise HTTPException(status_code=response.status, detail=detail)
            if not isinstance(payload, dict):
                raise HTTPException(status_code=502, detail="Photo Magic returned an unexpected response")
            return payload


def _normalize_photo_magic_payload(payload: dict) -> dict:
    image_url = payload.get("imageUrl") or payload.get("image_url")
    filename = payload.get("filename") or (os.path.basename(image_url) if isinstance(image_url, str) else None)
    return {
        **payload,
        "image_url": image_url,
        "imageUrl": image_url,
        "filename": filename,
        "image_path": payload.get("image_path"),
    }


@app.post("/api/photo-magic/generate")
async def photo_magic_generate(body: PhotoMagicGenerateRequest, request: Request):
    """Generate an image from a text prompt (no input photo)."""
    try:
        payload = await _proxy_photo_magic_json(
            "/api/photo-magic/generate",
            json_body={"prompt": body.prompt},
            claim_headers=_photo_magic_claim_headers(request=request),
        )
        return _normalize_photo_magic_payload(payload)
    except Exception as e:
        logger.error(f"[photo-magic] Generate failed: {e}", exc_info=True)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/photo-magic/edit")
async def photo_magic_edit(
    request: Request,
    prompt: str = Form(...),
    file: UploadFile = File(...),
):
    """Edit an uploaded image using a text prompt."""
    try:
        form = aiohttp.FormData()
        form.add_field("prompt", prompt)
        form.add_field(
            "file",
            await file.read(),
            filename=file.filename or "upload.png",
            content_type=file.content_type or "image/png",
        )
        payload = await _proxy_photo_magic_json(
            "/api/photo-magic/edit",
            form_data=form,
            claim_headers=_photo_magic_claim_headers(request=request),
        )
        return _normalize_photo_magic_payload(payload)
    except Exception as e:
        logger.error(f"[photo-magic] Edit failed: {e}", exc_info=True)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/photo-magic/inpaint")
async def photo_magic_inpaint(
    request: Request,
    prompt: str = Form(...),
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
):
    """Inpaint: edit masked areas of an image using a text prompt."""
    try:
        form = aiohttp.FormData()
        form.add_field("prompt", prompt)
        form.add_field(
            "file",
            await file.read(),
            filename=file.filename or "upload.png",
            content_type=file.content_type or "image/png",
        )
        form.add_field(
            "mask",
            await mask.read(),
            filename=mask.filename or "mask.png",
            content_type=mask.content_type or "image/png",
        )
        payload = await _proxy_photo_magic_json(
            "/api/photo-magic/inpaint",
            form_data=form,
            claim_headers=_photo_magic_claim_headers(request=request),
        )
        return _normalize_photo_magic_payload(payload)
    except Exception as e:
        logger.error(f"[photo-magic] Inpaint failed: {e}", exc_info=True)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/photo-magic/edit-multi")
async def photo_magic_edit_multi(
    request: Request,
    prompt: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """Multi-image composition (up to 3 images) with a text prompt."""
    try:
        form = aiohttp.FormData()
        form.add_field("prompt", prompt)
        for f in files[:3]:
            form.add_field(
                "files",
                await f.read(),
                filename=f.filename or "upload.png",
                content_type=f.content_type or "image/png",
            )
        payload = await _proxy_photo_magic_json(
            "/api/photo-magic/edit-multi",
            form_data=form,
            claim_headers=_photo_magic_claim_headers(request=request),
        )
        return _normalize_photo_magic_payload(payload)
    except Exception as e:
        logger.error(f"[photo-magic] Multi-edit failed: {e}", exc_info=True)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/photo-magic/status/{prompt_id}")
async def photo_magic_status(prompt_id: str):
    """Check generation status for a prompt_id."""
    from comfyui_client import get_status
    return await get_status(prompt_id)


@app.get("/api/photo-magic/gallery")
async def photo_magic_gallery():
    """List all generated images with metadata, newest first."""
    import glob
    files = glob.glob(os.path.join(PHOTO_MAGIC_OUTPUT_DIR, "*.png"))
    items = []
    for f in sorted(files, key=os.path.getmtime, reverse=True)[:50]:
        name = os.path.basename(f)
        items.append({
            "filename": name,
            "url": f"/api/photo-magic/result/{name}",
            "created": os.path.getmtime(f),
            "size": os.path.getsize(f),
        })
    return {"items": items}


@app.get("/api/photo-magic/result/{filename}")
async def photo_magic_result(filename: str):
    """Serve a generated image file."""
    # Sanitize filename to prevent path traversal
    safe_name = os.path.basename(filename)
    path = os.path.join(PHOTO_MAGIC_OUTPUT_DIR, safe_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path, media_type="image/png")


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
QUEUE_KEY = "bot:launch:queue"
REDIS_AUTH_REQUIRED = os.getenv('REDIS_AUTH_REQUIRED', 'false').lower() == 'true'
REDIS_SHARED_SECRET = os.getenv('REDIS_SHARED_SECRET')
USE_REDIS = os.getenv('USE_REDIS', 'false').lower() == 'true'
TEST_BYPASS_REDIS = os.getenv('TEST_BYPASS_REDIS', 'false').lower() == 'true'

# Direct runner configuration (used when USE_REDIS=false)
RUNNER_URL = os.getenv("RUNNER_URL", "http://localhost:7860")
DIRECT_RUNNER_HTTP = os.getenv("DIRECT_RUNNER_HTTP", "true").lower() not in {"0", "false", "no", "off"}
RUNNER_START_TIMEOUT = int(os.getenv("RUNNER_START_TIMEOUT", "60"))

# In-memory room locks for direct runner mode (replaces Redis when disabled)
# Structure: { room_url: { "status": "running", "session_id": "...", "timestamp": ... } }
active_rooms: Dict[str, Dict[str, Any]] = {}
active_rooms_lock = asyncio.Lock()

# Track bots by user/session for forum transition feature in direct mode.
# Structure: { user_bot_key: { "session_id": "...", "room_url": "...", "personalityId": "...", "persona": "...", "timestamp": ... } }
user_bots: Dict[str, Dict[str, Any]] = {}
user_bots_lock = asyncio.Lock()


async def _runner_request(method: str, path: str, *, json_body: dict | None = None, timeout_secs: int = 10) -> dict:
    url = f"{RUNNER_URL.rstrip('/')}/{path.lstrip('/')}"
    async with aiohttp.ClientSession() as session:
        async with session.request(
            method,
            url,
            json=json_body,
            timeout=aiohttp.ClientTimeout(total=timeout_secs, sock_connect=3),
        ) as resp:
            try:
                payload = await resp.json()
            except Exception:
                payload = {"detail": await resp.text()}
            if resp.status >= 400:
                raise HTTPException(status_code=resp.status, detail=payload)
            return payload


def _runner_transition_can_start_fresh(exc: HTTPException) -> bool:
    """Return true when a transition failed because the remembered runner session is stale."""
    status_code = getattr(exc, "status_code", None)
    if status_code == 404:
        return True

    detail = getattr(exc, "detail", "")
    if isinstance(detail, dict):
        detail_text = json.dumps(detail, sort_keys=True).lower()
    else:
        detail_text = str(detail).lower()

    if status_code == 409 and "already finished" in detail_text:
        return True
    return False


async def _clear_direct_stale_user_bot_transition(
    *,
    user_bot_key: str,
    existing_room: str,
    existing_session_id: str,
) -> None:
    async with active_rooms_lock:
        active_rooms.pop(existing_room, None)

    async with user_bots_lock:
        current = user_bots.get(user_bot_key) or {}
        current_room = current.get("room_url")
        current_session_id = current.get("session_id")
        if current_room == existing_room and current_session_id == existing_session_id:
            user_bots.pop(user_bot_key, None)


async def _external_runner_start(body: dict, session_id: str, req_logger) -> dict:
    """Start a voice bot in the standalone runner service."""
    room_url = body.get("room_url")
    tenant_id = body.get("tenantId")
    session_user_id = (body.get("sessionUserId") or "").strip() or None
    user_bot_key = _user_bot_key(session_user_id, tenant_id) if session_user_id else None

    start_body = dict(body)
    start_body["sessionId"] = session_id
    if body.get("personalityId") and not start_body.get("personality"):
        start_body["personality"] = body.get("personalityId")
    if body.get("persona") and not start_body.get("persona"):
        start_body["persona"] = body.get("persona")

    if user_bot_key:
        async with user_bots_lock:
            existing_user_bot = dict(user_bots.get(user_bot_key) or {})
        existing_room = existing_user_bot.get("room_url")
        existing_session_id = existing_user_bot.get("session_id")
        existing_runner_url = existing_user_bot.get("runner_url") or RUNNER_URL
        if existing_room and existing_session_id and existing_room != room_url:
            req_logger.info(
                "[gateway] Direct mode: transitioning standalone runner bot",
                existingRoom=existing_room,
                targetRoom=room_url,
                transitionSessionId=existing_session_id,
            )
            try:
                transition_resp = await _post_runner_transition(
                    existing_runner_url,
                    existing_session_id,
                    _transition_request_payload(body, existing_user_bot, room_url),
                )
            except HTTPException as transition_exc:
                if not _runner_transition_can_start_fresh(transition_exc):
                    raise
                req_logger.warning(
                    "[gateway] Direct mode: stale standalone runner transition failed; starting fresh bot",
                    existingRoom=existing_room,
                    targetRoom=room_url,
                    transitionSessionId=existing_session_id,
                    transitionStatus=getattr(transition_exc, "status_code", None),
                    transitionDetail=getattr(transition_exc, "detail", None),
                )
                await _clear_direct_stale_user_bot_transition(
                    user_bot_key=user_bot_key,
                    existing_room=existing_room,
                    existing_session_id=existing_session_id,
                )
            else:
                transitioned = _transition_response(
                    transition_resp,
                    existing_session_id,
                    existing_user_bot,
                    body,
                    room_url,
                    body.get("debugTraceId"),
                )
                async with active_rooms_lock:
                    active_rooms.pop(existing_room, None)
                    active_rooms[room_url] = {
                        "status": "running",
                        "session_id": transitioned["session_id"],
                        "timestamp": time.time(),
                        "personalityId": transitioned["personalityId"],
                        "persona": transitioned["persona"],
                        "transitioned_from": existing_room,
                        "runner_url": existing_runner_url,
                    }
                async with user_bots_lock:
                    user_bots[user_bot_key] = {
                        "session_id": transitioned["session_id"],
                        "room_url": transitioned["room_url"],
                        "personalityId": transitioned["personalityId"],
                        "persona": transitioned["persona"],
                        "tenantId": tenant_id,
                        "timestamp": time.time(),
                        "transitioned_at": time.time(),
                        "runner_url": existing_runner_url,
                    }
                return transitioned

    req_logger.info("[gateway] Direct mode: starting standalone runner session", runnerUrl=RUNNER_URL)
    try:
        payload = await _runner_request("POST", "/start", json_body=start_body, timeout_secs=RUNNER_START_TIMEOUT)
    except asyncio.TimeoutError as exc:
        req_logger.error(
            "[gateway] Direct runner start timed out",
            runnerUrl=RUNNER_URL,
            timeoutSecs=RUNNER_START_TIMEOUT,
        )
        raise HTTPException(
            status_code=503,
            detail={
                "error": "runner_start_timeout",
                "message": "Voice runner did not answer /start before the gateway timeout.",
            },
        ) from exc
    except aiohttp.ClientError as exc:
        req_logger.error(
            "[gateway] Direct runner start request failed",
            runnerUrl=RUNNER_URL,
            error=str(exc),
        )
        raise HTTPException(
            status_code=503,
            detail={
                "error": "runner_unreachable",
                "message": "Voice runner is not reachable from the gateway.",
            },
        ) from exc

    returned_session_id = payload.get("sessionId") or session_id
    personality = payload.get("personality") or body.get("personalityId") or "pearl"
    persona = payload.get("persona") or body.get("persona") or "Pearl"

    async with active_rooms_lock:
        active_rooms[room_url] = {
            "status": "running",
            "session_id": returned_session_id,
            "timestamp": time.time(),
            "personalityId": personality,
            "persona": persona,
            "runner_url": RUNNER_URL,
        }

    if user_bot_key:
        async with user_bots_lock:
            user_bots[user_bot_key] = {
                "session_id": returned_session_id,
                "room_url": room_url,
                "personalityId": personality,
                "persona": persona,
                "tenantId": tenant_id,
                "timestamp": time.time(),
                "runner_url": RUNNER_URL,
            }

    return {
        "status": "running",
        "session_id": returned_session_id,
        "room_url": room_url,
        "personalityId": personality,
        "persona": persona,
        "reused": False,
        "runner_url": RUNNER_URL,
        "message": "Bot started via standalone runner",
        "debugTraceId": body.get("debugTraceId"),
    }

# Initialize Redis
r = None
if USE_REDIS:
    try:
        password = REDIS_SHARED_SECRET if REDIS_AUTH_REQUIRED else None
        r = redis.Redis.from_url(REDIS_URL, password=password, decode_responses=True)
        logger.info(f"[gateway] Connected to Redis at {REDIS_URL}")
    except Exception as e:
        logger.error(f"[gateway] Failed to connect to Redis: {e}")
        r = None
else:
    logger.info("[gateway] USE_REDIS not true; skipping Redis client initialization")
logger.info(
    "[gateway] Runtime auth/env snapshot",
    useRedis=USE_REDIS,
    redisAvailable=bool(r),
    authRequired=(os.getenv("BOT_CONTROL_AUTH_REQUIRED", "1").strip().lower() in ("1", "true", "yes", "on")),
    hasBotSharedSecret=bool((os.getenv("BOT_CONTROL_SHARED_SECRET") or "").strip()),
    hasClaimsSecret=bool((os.getenv("BOT_CONTROL_CLAIMS_SECRET") or "").strip()),
    redisUrlPresent=bool((REDIS_URL or "").strip()),
)


def _user_bot_key(session_user_id: str, tenant_id: str | None) -> str:
    """Back-compat alias to canonical user session bot key."""
    tenant_scope = (tenant_id or "global").strip() or "global"
    return f"user_bot:{tenant_scope}:{session_user_id}"


def _user_session_bot_key(tenant_id: str, session_user_id: str, session_id: str) -> str:
    tenant_scope = tenant_id.strip() or "global"
    return f"user_session_bot:{tenant_scope}:{session_user_id}:{session_id}"


def _user_session_keepalive_key(tenant_id: str, session_user_id: str, session_id: str) -> str:
    tenant_scope = tenant_id.strip() or "global"
    return f"user_session_keepalive:{tenant_scope}:{session_user_id}:{session_id}"


def _room_presence_key(tenant_id: str, room_url: str, session_user_id: str, session_id: str) -> str:
    tenant_scope = tenant_id.strip() or "global"
    return f"room_presence:{tenant_scope}:{room_url}:{session_user_id}:{session_id}"


def _room_lock_key(room_url: str) -> str:
    return f"room_active:{room_url}"


def _transition_request_payload(
    body: Dict[str, Any],
    existing_user_bot: Dict[str, Any],
    room_url: str,
) -> Dict[str, Any]:
    return {
        "new_room_url": room_url,
        "new_token": body.get("token"),
        "personalityId": existing_user_bot.get("personalityId") or body.get("personalityId"),
        "persona": existing_user_bot.get("persona") or body.get("persona"),
        "debugTraceId": body.get("debugTraceId"),
        "sessionUserId": body.get("sessionUserId"),
        "sessionUserName": body.get("sessionUserName"),
        "sessionUserEmail": body.get("sessionUserEmail"),
        "visionMode": body.get("visionMode"),
        "supportedFeatures": body.get("supportedFeatures"),
    }


async def _post_runner_transition(
    runner_url: str,
    session_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    url = f"{runner_url.rstrip('/')}/sessions/{session_id}/transition"
    async with aiohttp.ClientSession() as session:
        async with session.post(
            url,
            json=payload,
            timeout=aiohttp.ClientTimeout(total=RUNNER_START_TIMEOUT, sock_connect=3),
        ) as resp:
            try:
                result = await resp.json()
            except Exception:
                result = {"detail": await resp.text()}
            if resp.status >= 400:
                raise HTTPException(status_code=resp.status, detail=result)
            return result


def _transition_response(
    transition_resp: Dict[str, Any],
    existing_session_id: str,
    existing_user_bot: Dict[str, Any],
    body: Dict[str, Any],
    room_url: str,
    debug_trace_id: str | None,
) -> Dict[str, Any]:
    transitioned_session_id = transition_resp.get("session_id") or existing_session_id
    transitioned_personality = (
        transition_resp.get("personalityId")
        or existing_user_bot.get("personalityId")
        or body.get("personalityId")
    )
    transitioned_persona = (
        transition_resp.get("persona")
        or existing_user_bot.get("persona")
        or body.get("persona")
    )
    return {
        "status": "transitioned",
        "session_id": transitioned_session_id,
        "room_url": transition_resp.get("room_url") or room_url,
        "personalityId": transitioned_personality,
        "persona": transitioned_persona,
        "reused": True,
        "detail": "Transitioned existing bot to requested room",
        "debugTraceId": debug_trace_id,
    }


async def _try_in_process_user_bot_transition(
    body: Dict[str, Any],
    room_url: str,
    tenant_id: str | None,
    session_user_id: str | None,
    user_bot_key: str | None,
    req_logger,
) -> Dict[str, Any] | None:
    if not user_bot_key:
        return None
    try:
        from runner_main import _first_session_for_room, transition_session, TransitionRequest

        async with user_bots_lock:
            existing_user_bot = dict(user_bots.get(user_bot_key) or {})
        existing_room = existing_user_bot.get("room_url")
        existing_session_id = existing_user_bot.get("session_id")
        if not existing_room or not existing_session_id:
            return None

        target_session = _first_session_for_room(room_url)
        if target_session and not target_session.task.done():
            if hasattr(target_session, "cancel_pending_shutdown"):
                target_session.cancel_pending_shutdown()
            async with user_bots_lock:
                user_bots[user_bot_key] = {
                    "session_id": target_session.id,
                    "room_url": room_url,
                    "personalityId": target_session.personality,
                    "persona": target_session.persona,
                    "tenantId": tenant_id,
                    "timestamp": time.time(),
                }
            return {
                "status": "joined_existing",
                "session_id": target_session.id,
                "room_url": room_url,
                "personalityId": target_session.personality,
                "persona": target_session.persona,
                "reused": True,
                "detail": "Target room already has a bot",
                "debugTraceId": body.get("debugTraceId"),
            }

        if existing_room == room_url:
            return None

        req_logger.info(
            "[gateway] Direct mode: transitioning existing in-process user bot",
            existingRoom=existing_room,
            targetRoom=room_url,
            transitionSessionId=existing_session_id,
        )
        transition_req = TransitionRequest(
            **_transition_request_payload(body, existing_user_bot, room_url)
        )
        transition_resp = await transition_session(existing_session_id, transition_req)
        transitioned = _transition_response(
            transition_resp,
            existing_session_id,
            existing_user_bot,
            body,
            room_url,
            body.get("debugTraceId"),
        )
        async with active_rooms_lock:
            active_rooms.pop(existing_room, None)
            active_rooms[room_url] = {
                "status": "running",
                "session_id": transitioned["session_id"],
                "timestamp": time.time(),
                "personalityId": transitioned["personalityId"],
                "persona": transitioned["persona"],
                "transitioned_from": existing_room,
            }
        async with user_bots_lock:
            user_bots[user_bot_key] = {
                "session_id": transitioned["session_id"],
                "room_url": transitioned["room_url"],
                "personalityId": transitioned["personalityId"],
                "persona": transitioned["persona"],
                "tenantId": tenant_id,
                "timestamp": time.time(),
                "transitioned_at": time.time(),
            }
        return transitioned
    except Exception as transition_err:
        req_logger.warning(
            f"[gateway] Direct mode: in-process transition probe failed: {transition_err}"
        )
        return None


def _claims_secret() -> str:
    return (os.getenv("BOT_CONTROL_CLAIMS_SECRET") or os.getenv("BOT_CONTROL_SHARED_SECRET") or "").strip()


def _validate_signed_claims(request: Request, expected: Dict[str, str]) -> None:
    ts = (request.headers.get("x-bot-claims-ts") or "").strip()
    payload = (request.headers.get("x-bot-claims") or "").strip()
    sig = (request.headers.get("x-bot-claims-sig") or "").strip()
    secret = _claims_secret()
    if not (ts and payload and sig and secret):
        logger.warning(
            "[gateway] Signed claims missing",
            path=str(getattr(getattr(request, "url", None), "path", "?")),
            hasTs=bool(ts),
            hasPayload=bool(payload),
            hasSig=bool(sig),
            hasClaimsSecret=bool(secret),
        )
        raise HTTPException(status_code=401, detail="missing_bot_claims")
    try:
        ts_ms = int(ts)
        max_age_ms = int(os.getenv("BOT_CONTROL_CLAIMS_MAX_AGE_MS", "300000"))
        now_ms = int(time.time() * 1000)
        if max_age_ms > 0 and abs(now_ms - ts_ms) > max_age_ms:
            logger.warning(
                "[gateway] Signed claims stale",
                path=str(getattr(getattr(request, "url", None), "path", "?")),
                ageMs=abs(now_ms - ts_ms),
                maxAgeMs=max_age_ms,
            )
            raise HTTPException(status_code=401, detail="stale_bot_claims")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "[gateway] Signed claims timestamp invalid",
            path=str(getattr(getattr(request, "url", None), "path", "?")),
        )
        raise HTTPException(status_code=401, detail="stale_bot_claims") from exc
    try:
        parsed = json.loads(payload)
    except Exception as exc:
        logger.warning(
            "[gateway] Signed claims payload invalid",
            path=str(getattr(getattr(request, "url", None), "path", "?")),
        )
        raise HTTPException(status_code=401, detail="invalid_bot_claims_payload") from exc

    canonical_payload = json.dumps(
        {
            "tenantId": parsed.get("tenantId") or "",
            "sessionUserId": parsed.get("sessionUserId") or "",
            "sessionId": parsed.get("sessionId") or "",
            "sessionUserEmail": parsed.get("sessionUserEmail") or "",
            "sessionUserName": parsed.get("sessionUserName") or "",
        },
        separators=(",", ":"),
    )
    expected_sig = hmac.new(secret.encode("utf-8"), f"{ts}.{canonical_payload}".encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, sig):
        logger.warning(
            "[gateway] Signed claims signature mismatch",
            path=str(getattr(getattr(request, "url", None), "path", "?")),
            tenantId=parsed.get("tenantId") or "",
            sessionUserId=parsed.get("sessionUserId") or "",
            sessionId=parsed.get("sessionId") or "",
        )
        raise HTTPException(status_code=401, detail="invalid_bot_claims_signature")
    for key, expected_val in expected.items():
        if (parsed.get(key) or "") != (expected_val or ""):
            logger.warning(
                "[gateway] Signed claims mismatch",
                path=str(getattr(getattr(request, "url", None), "path", "?")),
                mismatchKey=key,
                expectedValue=expected_val or "",
                claimsValue=(parsed.get(key) or ""),
            )
            raise HTTPException(status_code=403, detail=f"claims_mismatch:{key}")


def _validate_join_claims_when_auth_required(request: Request, body: Dict[str, Any], session_id: str) -> None:
    if not AUTH_REQUIRED:
        return
    tenant_id = (body.get("tenantId") or "").strip()
    session_user_id = (body.get("sessionUserId") or "").strip()
    if not tenant_id or not session_user_id:
        raise HTTPException(status_code=403, detail="tenantId and sessionUserId are required")
    _validate_signed_claims(
        request,
        {
            "tenantId": tenant_id,
            "sessionUserId": session_user_id,
            "sessionId": session_id,
        },
    )


def _safe_json_loads(raw: Any) -> Dict[str, Any]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _signed_claims_for_request(request: Request, *, required: bool = True) -> Dict[str, Any]:
    ts = (request.headers.get("x-bot-claims-ts") or "").strip()
    payload = (request.headers.get("x-bot-claims") or "").strip()
    sig = (request.headers.get("x-bot-claims-sig") or "").strip()
    if not required:
        if not (ts or payload or sig):
            return {}
    try:
        _validate_signed_claims(request, {})
    except HTTPException:
        if required or ts or payload or sig:
            raise
        return {}
    return _safe_json_loads(request.headers.get("x-bot-claims") or "")


def _usable_voice_identity(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = value.strip()
    if not cleaned or cleaned.lower() in {"anonymous", "null", "none", "undefined"}:
        return ""
    return cleaned


def _enrich_voice_identity_from_request(body: dict[str, Any], request: Request, req_logger) -> None:
    """Preserve authenticated caller identity before launching a voice bot.

    The runner seeds BOT_SESSION_USER_* from this body. Prefer the signed claims
    created by the authenticated interface proxy, then forwarded user headers,
    over user-supplied body values so stale room metadata cannot rename the
    voice caller.
    """
    claims = _safe_json_loads(request.headers.get("x-bot-claims") or "")
    identity_sources = (
        (
            _usable_voice_identity(claims.get("sessionUserId")),
            _usable_voice_identity(claims.get("sessionUserEmail")),
            _usable_voice_identity(claims.get("sessionUserName")),
            "claims",
        ),
        (
            _usable_voice_identity(request.headers.get("x-user-id")),
            _usable_voice_identity(request.headers.get("x-user-email")),
            _usable_voice_identity(request.headers.get("x-user-name")),
            "headers",
        ),
    )

    before_has_id = bool(_usable_voice_identity(body.get("sessionUserId")))
    before_has_email = bool(_usable_voice_identity(body.get("sessionUserEmail")))
    before_has_name = bool(_usable_voice_identity(body.get("sessionUserName")))
    applied_source = ""

    claims_name = _usable_voice_identity(claims.get("sessionUserName"))

    for user_id, email, name, source in identity_sources:
        changed = False
        if user_id and _usable_voice_identity(body.get("sessionUserId")) != user_id:
            body["sessionUserId"] = user_id
            changed = True
        if email and _usable_voice_identity(body.get("sessionUserEmail")) != email:
            body["sessionUserEmail"] = email
            changed = True
        current_name = _usable_voice_identity(body.get("sessionUserName"))
        should_replace_name = (
            bool(name)
            and current_name != name
            and (source == "claims" or not claims_name)
        )
        if should_replace_name:
            body["sessionUserName"] = name
            changed = True
        if changed:
            applied_source = source

    if applied_source:
        req_logger.info(
            "[gateway] Voice launch identity enriched",
            source=applied_source,
            hadUserId=before_has_id,
            hasUserId=bool(_usable_voice_identity(body.get("sessionUserId"))),
            hadEmail=before_has_email,
            hasEmail=bool(_usable_voice_identity(body.get("sessionUserEmail"))),
            hadName=before_has_name,
            hasName=bool(_usable_voice_identity(body.get("sessionUserName"))),
        )


def _cleanup_user_bot_mappings_for_room(redis_client: Any, room_url: str) -> int:
    """Delete any user_bot mappings that currently point at a room."""
    deleted = 0
    try:
        for key in redis_client.scan_iter(match="user_bot:*"):
            payload = _safe_json_loads(redis_client.get(key))
            if payload.get("room_url") == room_url:
                redis_client.delete(key)
                deleted += 1
    except Exception as exc:
        logger.warning(f"[gateway] Failed cleaning user_bot mappings for {room_url}: {exc}")
    return deleted


async def _cleanup_direct_user_bot_mappings_for_room(room_url: str) -> int:
    """Delete in-memory user_bot mappings that currently point at a room."""
    deleted = 0
    async with user_bots_lock:
        for key, payload in list(user_bots.items()):
            if (payload or {}).get("room_url") == room_url:
                user_bots.pop(key, None)
                deleted += 1
    return deleted

class VoiceParameters(BaseModel):
    speed: float | None = None
    stability: float | None = None
    similarityBoost: float | None = None
    style: float | None = None
    optimizeStreamingLatency: float | None = None
    maxCallDuration: int | None = None
    participantLeftTimeout: int | None = None
    participantAbsentTimeout: int | None = None
    enableRecording: bool | None = None
    enableTranscription: bool | None = None
    applyGreenscreen: bool | None = None
    language: str | None = None

class JoinRequest(BaseModel):
    room_url: str | None = None
    personalityId: str | None = None
    persona: str | None = None
    tenantId: str | None = None
    voice: str | None = None
    voiceParameters: VoiceParameters | None = None
    voiceProvider: str | None = None
    token: str | None = None  # Daily room token for bot authorization
    # Voice-only session support
    voiceOnly: bool = False  # If true, bot joins with video off
    visionMode: bool = False  # If true, enable Pearl Vision frame analysis
    sessionPersistence: int | None = None  # Seconds to keep room alive after leave (default from env)
    # Deterministic identity mapping (optional)
    participantId: str | None = None  # Real Daily.co participant ID for accurate mapping
    sessionUserId: str | None = None
    sessionUserEmail: str | None = None
    sessionUserName: str | None = None
    sessionId: str | None = None  # Real Daily.co session ID (for accurate session history tracking)
    isOnboarding: bool = False
    sessionOverride: Dict[str, Any] | None = None
    activeNoteId: str | None = None
    webChatContext: list[dict[str, Any]] | None = None
    activeNoteContext: Dict[str, Any] | None = None
    # Feature flags for conditional tool registration
    supportedFeatures: list[str] | None = None  # e.g., ['notes', 'youtube', 'gmail'] - filters tools by feature_flag
    # Static path configuration for mode switching
    modePersonalityVoiceConfig: Dict[str, Any] | None = None
    debugTraceId: str | None = None

class JoinResponse(BaseModel):
    pid: int
    room_url: str
    personalityId: str
    persona: str
    reused: bool = False

class AdminMessage(BaseModel):
    room_url: Optional[str] = None
    message: str
    mode: Optional[str] = 'queued'
    sender_id: Optional[str] = 'system'
    sender_name: Optional[str] = 'System'
    timestamp: Optional[float] = None

class ConfigRequest(BaseModel):
    room_url: str
    personalityId: str | None = None
    persona: str | None = None
    voice: str | None = None
    voiceProvider: str | None = None
    voiceParameters: VoiceParameters | None = None
    mode: str | None = None
    supportedFeatures: list[str] | None = None
    sessionId: str | None = None
    sessionUserId: str | None = None
    sessionUserEmail: str | None = None
    sessionUserName: str | None = None


class ActiveAppletRequest(BaseModel):
    room_url: str
    applet_id: str | None = None
    owner: str | None = None


class ActiveNoteRequest(BaseModel):
    room_url: str
    note_id: str | None = None
    owner: str | None = None

async def _direct_runner_start(body: dict, session_id: str, req_logger) -> dict:
    """Start a bot session by calling the runner function directly (no Redis, no HTTP).
    
    This is used when USE_REDIS=false for simpler local development.
    Imports and calls _launch_session directly to avoid needing a separate runner process.
    """
    room_url = body.get("room_url")
    session_user_id = (body.get("sessionUserId") or "").strip() or None
    tenant_id = body.get("tenantId")
    user_bot_key = _user_bot_key(session_user_id, tenant_id) if session_user_id else None
    debug_trace_id = body.get("debugTraceId")

    in_process_transition = await _try_in_process_user_bot_transition(
        body,
        room_url,
        tenant_id,
        session_user_id,
        user_bot_key,
        req_logger,
    )
    if in_process_transition:
        return in_process_transition

    if DIRECT_RUNNER_HTTP:
        return await _external_runner_start(body, session_id, req_logger)
    
    # Log initial state
    try:
        from runner_main import sessions as runner_sessions, _first_session_for_room
        runner_session = _first_session_for_room(room_url)
        runner_session_info = {
            "id": runner_session.id,
            "room_url": runner_session.room_url,
            "task_done": runner_session.task.done(),
        } if runner_session else None
        req_logger.info(
            f"[gateway] JOIN REQUEST START: room_url={room_url}, session_id={session_id}, "
            f"active_rooms_count={len(active_rooms)}, runner_sessions_count={len(runner_sessions)}, "
            f"runner_session_for_room={runner_session_info}, debug_trace_id={debug_trace_id}"
        )
    except Exception as e:
        req_logger.info(
            f"[gateway] JOIN REQUEST START: room_url={room_url}, session_id={session_id}, "
            f"active_rooms_count={len(active_rooms)}, cannot_check_runner_sessions: {e}, debug_trace_id={debug_trace_id}"
        )

    # Direct-mode forum transition support:
    # If this user already has a live bot in another room, move that same bot session into this room.
    if user_bot_key:
        try:
            from runner_main import _first_session_for_room, transition_session, TransitionRequest
            async with user_bots_lock:
                existing_user_bot = dict(user_bots.get(user_bot_key) or {})
            existing_room = existing_user_bot.get("room_url")
            existing_session_id = existing_user_bot.get("session_id")

            # If target room already has a running bot, reuse it and skip transition/spawn.
            target_session = _first_session_for_room(room_url)
            if target_session and not target_session.task.done():
                req_logger.info(
                    "[gateway] Direct mode: target room already has live bot; reusing",
                    targetRoom=room_url,
                    sessionId=target_session.id,
                )
                # Cancel any pending idle shutdown — the user is reconnecting.
                # Without this, a post-leave shutdown timer can kill the bot
                # before the new participant's Daily join event arrives.
                target_session.cancel_pending_shutdown()
                req_logger.info(
                    "[gateway] Direct mode: cancelled pending shutdown on reused session",
                    sessionId=target_session.id,
                )
                async with user_bots_lock:
                    user_bots[user_bot_key] = {
                        "session_id": target_session.id,
                        "room_url": room_url,
                        "personalityId": target_session.personality,
                        "persona": target_session.persona,
                        "tenantId": tenant_id,
                        "timestamp": time.time(),
                    }
                return {
                    "status": "joined_existing",
                    "session_id": target_session.id,
                    "room_url": room_url,
                    "personalityId": target_session.personality,
                    "persona": target_session.persona,
                    "reused": True,
                    "detail": "Target room already has a bot",
                    "debugTraceId": debug_trace_id,
                }

            # Attempt in-process transition when we have a known previous user bot in a different room.
            if existing_room and existing_session_id and existing_room != room_url:
                req_logger.info(
                    "[gateway] Direct mode: transitioning existing user bot",
                    existingRoom=existing_room,
                    targetRoom=room_url,
                    transitionSessionId=existing_session_id,
                )
                transition_req = TransitionRequest(
                    new_room_url=room_url,
                    new_token=body.get("token"),
                    personalityId=existing_user_bot.get("personalityId") or body.get("personalityId"),
                    persona=existing_user_bot.get("persona") or body.get("persona"),
                    debugTraceId=debug_trace_id,
                    sessionUserId=session_user_id,
                    sessionUserName=body.get("sessionUserName"),
                    sessionUserEmail=body.get("sessionUserEmail"),
                )
                transition_resp = await transition_session(existing_session_id, transition_req)
                transitioned_session_id = transition_resp.get("session_id") or existing_session_id
                transitioned_personality = (
                    transition_resp.get("personalityId")
                    or existing_user_bot.get("personalityId")
                    or body.get("personalityId")
                )
                transitioned_persona = (
                    transition_resp.get("persona")
                    or existing_user_bot.get("persona")
                    or body.get("persona")
                )
                async with active_rooms_lock:
                    active_rooms.pop(existing_room, None)
                    active_rooms[room_url] = {
                        "status": "running",
                        "session_id": transitioned_session_id,
                        "timestamp": time.time(),
                        "personalityId": transitioned_personality,
                        "persona": transitioned_persona,
                        "transitioned_from": existing_room,
                    }
                async with user_bots_lock:
                    user_bots[user_bot_key] = {
                        "session_id": transitioned_session_id,
                        "room_url": room_url,
                        "personalityId": transitioned_personality,
                        "persona": transitioned_persona,
                        "tenantId": tenant_id,
                        "timestamp": time.time(),
                        "transitioned_at": time.time(),
                    }
                return {
                    "status": "transitioned",
                    "session_id": transitioned_session_id,
                    "room_url": room_url,
                    "personalityId": transitioned_personality,
                    "persona": transitioned_persona,
                    "reused": True,
                    "detail": f"Transitioned bot from {existing_room} to {room_url}",
                    "debugTraceId": debug_trace_id,
                }
        except Exception as transition_err:
            req_logger.warning(
                f"[gateway] Direct mode: transition probe failed, falling back to normal launch: {transition_err}"
            )
    
    # Check in-memory room locks with better concurrent request handling
    async with active_rooms_lock:
        existing = active_rooms.get(room_url)
        req_logger.info(
            f"[gateway] Checking active_rooms for {room_url}: existing={existing}, "
            f"all_active_rooms={dict(active_rooms)}"
        )
        if existing:
            existing_status = existing.get("status")
            existing_age = time.time() - existing.get("timestamp", 0)
            
            # If pending and recent (< 30s), wait for it to complete instead of returning immediately
            if existing_status == "pending" and existing_age < 30:
                req_logger.info(
                    f"[gateway] Direct mode: Found pending bot for {room_url} (age: {existing_age:.1f}s), waiting for completion"
                )
                # Release lock and wait for pending request to complete
                # Poll every 0.5s for up to 30s
                max_wait = 30.0
                poll_interval = 0.5
                waited = 0.0
                while waited < max_wait:
                    await asyncio.sleep(poll_interval)
                    waited += poll_interval
                    async with active_rooms_lock:
                        current = active_rooms.get(room_url)
                        if not current:
                            # Entry was removed (likely failed), break and proceed with new launch
                            req_logger.info(
                                f"[gateway] Direct mode: Pending entry removed after {waited:.1f}s, proceeding with new launch"
                            )
                            break
                        current_status = current.get("status")
                        if current_status == "running":
                            # First request completed successfully
                            req_logger.info(
                                f"[gateway] Direct mode: Pending request completed after {waited:.1f}s"
                            )
                            return {
                                "status": "running",
                                "session_id": current.get("session_id"),
                                "room_url": room_url,
                                "personalityId": current.get("personalityId") or body.get("personalityId"),
                                "persona": current.get("persona") or body.get("persona"),
                                "reused": True,
                                "detail": "Bot launch completed by concurrent request"
                            }
                        elif current_status != "pending":
                            # Status changed to something else (shouldn't happen, but handle it)
                            break
                
                # If we get here, either timeout or entry was removed
                async with active_rooms_lock:
                    current = active_rooms.get(room_url)
                    if current and current.get("status") == "pending":
                        # Still pending after timeout - remove stale entry and proceed
                        req_logger.warning(
                            f"[gateway] Direct mode: Pending request timed out after {waited:.1f}s, removing stale entry"
                        )
                        active_rooms.pop(room_url, None)
                    elif current and current.get("status") == "running":
                        # Completed while we were checking
                        return {
                            "status": "running",
                            "session_id": current.get("session_id"),
                            "room_url": room_url,
                            "personalityId": current.get("personalityId") or body.get("personalityId"),
                            "persona": current.get("persona") or body.get("persona"),
                            "reused": True,
                            "detail": "Bot launch completed by concurrent request",
                            "debugTraceId": debug_trace_id,
                        }
            
            # If running and recent (< 2 minutes), verify session exists and reuse it
            if existing_status == "running" and existing_age < 120:
                # Verify the session actually exists in runner_main
                try:
                    from runner_main import sessions
                    existing_session_id = existing.get("session_id")
                    if existing_session_id and existing_session_id in sessions:
                        req_logger.info(
                            f"[gateway] Direct mode: Found existing bot for {room_url} (age: {existing_age:.1f}s)"
                        )
                        # Cancel any pending idle shutdown on the reused session
                        sessions[existing_session_id].cancel_pending_shutdown()
                        return {
                            "status": "running",
                            "session_id": existing_session_id,
                            "room_url": room_url,
                            "personalityId": existing.get("personalityId") or body.get("personalityId"),
                            "persona": existing.get("persona") or body.get("persona"),
                            "reused": True,
                            "detail": "Bot already active for this room",
                            "debugTraceId": debug_trace_id,
                        }
                    else:
                        # Session doesn't exist - stale entry
                        req_logger.warning(
                            f"[gateway] Direct mode: Running entry found but session {existing_session_id} not found, removing stale entry"
                        )
                        active_rooms.pop(room_url, None)
                except ImportError:
                    # Can't verify, but assume it's valid if recent
                    req_logger.info(
                        f"[gateway] Direct mode: Found existing bot for {room_url} (age: {existing_age:.1f}s, cannot verify session)"
                    )
                    return {
                        "status": "running",
                        "session_id": existing.get("session_id"),
                        "room_url": room_url,
                        "personalityId": existing.get("personalityId") or body.get("personalityId"),
                        "persona": existing.get("persona") or body.get("persona"),
                        "reused": True,
                        "detail": "Bot already active for this room",
                        "debugTraceId": debug_trace_id,
                    }
            
            # Stale entry (pending > 30s or running > 2min), remove it
            req_logger.info(
                f"[gateway] Direct mode: Removing stale room lock for {room_url} "
                f"(status={existing_status}, age={existing_age:.1f}s)"
            )
            active_rooms.pop(room_url, None)
        
        # Set pending state to prevent concurrent launches
        active_rooms[room_url] = {
            "status": "pending",
            "session_id": session_id,
            "timestamp": time.time(),
            "personalityId": body.get("personalityId"),
            "persona": body.get("persona"),
        }
        req_logger.info(
            f"[gateway] Set active_rooms[{room_url}] to pending: {active_rooms[room_url]}"
        )
    
    # Before launching, check for and clean up any stale sessions for this room
    req_logger.info(f"[gateway] Checking for stale sessions before launch for room {room_url}")
    try:
        from runner_main import sessions, _first_session_for_room
        req_logger.info(
            f"[gateway] Runner sessions state: total={len(sessions)}, "
            f"session_ids={list(sessions.keys())}"
        )
        existing_session = _first_session_for_room(room_url)
        if existing_session:
            req_logger.warning(
                f"[gateway] STALE SESSION FOUND: session_id={existing_session.id}, "
                f"room_url={existing_session.room_url}, task_done={existing_session.task.done()}, "
                f"terminating before new launch"
            )
            if not existing_session.task.done():
                req_logger.info(f"[gateway] Cancelling task for session {existing_session.id}")
                existing_session.task.cancel()
                try:
                    await asyncio.wait_for(existing_session.task, timeout=5)
                    req_logger.info(f"[gateway] Session {existing_session.id} cancelled successfully")
                except (asyncio.TimeoutError, asyncio.CancelledError) as e:
                    req_logger.warning(
                        f"[gateway] Session {existing_session.id} did not cancel cleanly: {e}, removing anyway"
                    )
            sessions.pop(existing_session.id, None)
            req_logger.info(
                f"[gateway] Cleared stale session {existing_session.id} for room {room_url}, "
                f"remaining_sessions={len(sessions)}"
            )
        else:
            req_logger.info(f"[gateway] No existing session found for room {room_url}")
    except ImportError as e:
        req_logger.warning(f"[gateway] Cannot import runner_main to check stale sessions: {e}")
    except Exception as e:
        req_logger.error(
            f"[gateway] Error checking for stale sessions: {e}",
            exc_info=True
        )
    
    req_logger.info(
        "[gateway] Direct mode: Importing and calling _launch_session directly",
        personalityId=body.get("personalityId"),
    )
    
    try:
        # Dynamically import _launch_session from runner_main
        # This avoids circular imports and allows the gateway to work standalone
        try:
            from runner_main import _launch_session
        except ImportError:
            # Try alternative import path
            import sys
            from pathlib import Path
            runner_path = Path(__file__).parent / "runner_main.py"
            if runner_path.exists():
                import importlib.util
                spec = importlib.util.spec_from_file_location("runner_main", runner_path)
                runner_module = importlib.util.module_from_spec(spec)
                sys.modules["runner_main"] = runner_module
                spec.loader.exec_module(runner_module)
                _launch_session = runner_module._launch_session
            else:
                raise ImportError("Could not find runner_main.py")
        
        # Call _launch_session directly
        req_logger.info(
            f"[gateway] Calling _launch_session for room_url={room_url}, "
            f"session_id={session_id}, active_rooms_before={dict(active_rooms)}"
        )
        info = await asyncio.wait_for(
            _launch_session(
                room_url=body.get("room_url"),
                token=body.get("token"),
                personalityId=body.get("personalityId") or "pearl",
                persona=body.get("persona") or "Pearl",
                body=body
            ),
            timeout=35,
        )
        
        req_logger.info(
            f"[gateway] _launch_session returned: session_id={info.id}, room_url={info.room_url}, "
            f"personality={info.personality}, persona={info.persona}"
        )
        
        # Verify session was actually created
        try:
            from runner_main import sessions as runner_sessions
            if info.id not in runner_sessions:
                req_logger.error(
                    f"[gateway] CRITICAL: Session {info.id} not found in runner_sessions after launch! "
                    f"runner_sessions={list(runner_sessions.keys())}"
                )
            else:
                req_logger.info(
                    f"[gateway] Verified session {info.id} exists in runner_sessions"
                )
        except Exception as e:
            req_logger.warning(f"[gateway] Could not verify session in runner_sessions: {e}")
        
        # Update room state to running
        async with active_rooms_lock:
            old_state = active_rooms.get(room_url, {}).copy()
            active_rooms[room_url] = {
                "status": "running",
                "session_id": info.id,
                "timestamp": time.time(),
                "personalityId": info.personality,
                "persona": info.persona,
            }
            req_logger.info(
                f"[gateway] Updated active_rooms[{room_url}]: old={old_state}, new={active_rooms[room_url]}"
            )

        if user_bot_key:
            async with user_bots_lock:
                user_bots[user_bot_key] = {
                    "session_id": info.id,
                    "room_url": info.room_url,
                    "personalityId": info.personality,
                    "persona": info.persona,
                    "tenantId": tenant_id,
                    "timestamp": time.time(),
                }
        
        return {
            "status": "running",
            "session_id": info.id,
            "room_url": info.room_url,
            "personalityId": info.personality,
            "persona": info.persona,
            "reused": False,
            "message": "Bot started via direct function call",
            "debugTraceId": debug_trace_id,
        }
                
    except HTTPException as e:
        # Preserve structured statuses from the runner (e.g. 429 from the
        # spawn-cooldown gate) so callers can back off correctly. Still
        # clear the pending entry so a future request isn't blocked.
        req_logger.warning(
            f"[gateway] _launch_session returned HTTPException: status={e.status_code} "
            f"detail={e.detail} room_url={room_url}"
        )
        async with active_rooms_lock:
            active_rooms.pop(room_url, None)
        raise
    except asyncio.TimeoutError:
        req_logger.error(
            f"[gateway] TIMEOUT launching session: room_url={room_url}, session_id={session_id}, "
            f"active_rooms_before_cleanup={dict(active_rooms)}"
        )
        async with active_rooms_lock:
            removed = active_rooms.pop(room_url, None)
            req_logger.info(
                f"[gateway] Removed timed-out entry from active_rooms: room_url={room_url}, "
                f"removed={removed}, remaining_active_rooms={dict(active_rooms)}"
            )
        raise HTTPException(
            status_code=504,
            detail="Timed out launching bot session"
        )
    except Exception as e:
        req_logger.error(
            f"[gateway] FAILED to launch session: room_url={room_url}, session_id={session_id}, "
            f"error={e}, active_rooms_before_cleanup={dict(active_rooms)}",
            exc_info=True
        )
        async with active_rooms_lock:
            removed = active_rooms.pop(room_url, None)
            req_logger.info(
                f"[gateway] Removed failed entry from active_rooms: room_url={room_url}, "
                f"removed={removed}, remaining_active_rooms={dict(active_rooms)}"
            )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to launch bot session: {str(e)}"
        )


@app.post("/join", dependencies=[Depends(require_auth)])
@app.post("/start", dependencies=[Depends(require_auth)])
async def join_room(request_body: JoinRequest, request: Request):
    # Parse request body
    body = request_body.model_dump()
    session_id = body.get("sessionId") or uuid.uuid4().hex
    body["sessionId"] = session_id
    debug_trace_id = (body.get("debugTraceId") or f"gateway:{session_id[:8]}").strip()
    body["debugTraceId"] = debug_trace_id

    # Ensure supportedFeatures is a list
    if body.get("supportedFeatures") is None:
        body["supportedFeatures"] = []
    if body.get("visionMode") and "vision" not in body["supportedFeatures"]:
        body["supportedFeatures"].append("vision")

    # Validate minimal requirements
    room_url = body.get("room_url")
    if not room_url:
         raise HTTPException(status_code=400, detail="Missing room_url")

    req_logger = logger.bind(
        roomUrl=room_url,
        sessionId=session_id,
        userId=body.get("sessionUserId"),
        userName=body.get("sessionUserName"),
        debugTraceId=debug_trace_id,
    )
    _enrich_voice_identity_from_request(body, request, req_logger)
    _enrich_voice_startup_context(body, req_logger)
    
    # Log join request received
    logger.info(
        f"[gateway] /join ENDPOINT CALLED: room_url={room_url}, session_id={session_id}, "
        f"USE_REDIS={USE_REDIS}, r_available={r is not None}, "
        f"active_rooms_count={len(active_rooms)}, debug_trace_id={debug_trace_id}"
    )

    voice_parameters = body.get("voiceParameters") or {}
    mode_config_keys = list((body.get("modePersonalityVoiceConfig") or {}).keys()) or None
    requested_voice_provider = (body.get("voiceProvider") or "").strip().lower()
    cartesia_enabled = os.getenv("CARTESIA_TTS_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    if requested_voice_provider == "cartesia" and not cartesia_enabled:
        req_logger.warning("[gateway] Cartesia requested but disabled; falling back to PocketTTS")
        body["voiceProvider"] = "pocket"

    req_logger.info(
        "[gateway] Join request summary",
        personalityId=body.get("personalityId"),
        persona=body.get("persona"),
        voiceId=body.get("voice"),
        voiceProvider=body.get("voiceProvider"),
        voiceParams={
            k: voice_parameters.get(k)
            for k in ("speed", "stability", "similarityBoost", "style", "optimizeStreamingLatency")
            if voice_parameters.get(k) is not None
        } or None,
        supportedFeatures=body.get("supportedFeatures"),
        visionMode=bool(body.get("visionMode")),
        modeConfigKeys=mode_config_keys,
    )
    _validate_join_claims_when_auth_required(request, body, session_id)

    # =========================================================================
    # DIRECT RUNNER MODE (when USE_REDIS=false)
    # =========================================================================
    if (not USE_REDIS) or (not r):
        req_logger.info("[gateway] Direct runner mode enabled (USE_REDIS=false)")
        result = await _direct_runner_start(body, session_id, req_logger)
        req_logger.info(
            f"[gateway] /join RETURNING: room_url={room_url}, result={result}"
        )
        return result
    
    # =========================================================================
    # REDIS QUEUE MODE (production)
    # One bot per user session, no room-level dedupe.
    # =========================================================================
    session_user_id = (body.get("sessionUserId") or "").strip()
    tenant_id = (body.get("tenantId") or "").strip()
    if not session_user_id or not tenant_id:
        raise HTTPException(status_code=403, detail="tenantId and sessionUserId are required")

    user_bot_key = _user_bot_key(session_user_id, tenant_id)
    session_key = _user_session_bot_key(tenant_id, session_user_id, session_id)
    keepalive_key = _user_session_keepalive_key(tenant_id, session_user_id, session_id)
    presence_key = _room_presence_key(tenant_id, room_url, session_user_id, session_id)
    req_logger.info(
        "[multitenancy_audit] Redis session scope resolved",
        tenantId=tenant_id,
        sessionUserId=session_user_id,
        sessionId=session_id,
        roomUrl=room_url,
        sessionKey=session_key,
        keepaliveKey=keepalive_key,
        presenceKey=presence_key,
    )

    try:
        existing_user_bot = _safe_json_loads(r.get(user_bot_key))
        existing_room = existing_user_bot.get("room_url")
        existing_session_id = existing_user_bot.get("session_id")
        existing_room_state = _safe_json_loads(r.get(_room_lock_key(existing_room))) if existing_room else {}
        existing_runner_url = (
            existing_room_state.get("runner_url")
            or existing_user_bot.get("runner_url")
            or RUNNER_URL
        )
        if existing_room and existing_session_id and existing_room != room_url:
            req_logger.info(
                "[gateway] Redis mode: transitioning existing user bot",
                existingRoom=existing_room,
                targetRoom=room_url,
                transitionSessionId=existing_session_id,
                runnerUrl=existing_runner_url,
            )
            transition_resp = await _post_runner_transition(
                existing_runner_url,
                existing_session_id,
                _transition_request_payload(body, existing_user_bot, room_url),
            )
            transitioned = _transition_response(
                transition_resp,
                existing_session_id,
                existing_user_bot,
                body,
                room_url,
                debug_trace_id,
            )
            room_state = {
                "status": "running",
                "session_id": transitioned["session_id"],
                "runner_url": existing_runner_url,
                "personalityId": transitioned["personalityId"],
                "persona": transitioned["persona"],
                "timestamp": time.time(),
                "transitioned_from": existing_room,
            }
            user_state = {
                "session_id": transitioned["session_id"],
                "room_url": transitioned["room_url"],
                "personalityId": transitioned["personalityId"],
                "persona": transitioned["persona"],
                "tenantId": tenant_id,
                "timestamp": time.time(),
                "transitioned_at": time.time(),
                "runner_url": existing_runner_url,
            }
            r.setex(_room_lock_key(room_url), 300, json.dumps(room_state))
            r.setex(user_bot_key, 3600, json.dumps(user_state))
            r.delete(_room_lock_key(existing_room))
            return transitioned
    except Exception as e:
        req_logger.warning(
            f"[gateway] Redis mode: transition probe failed, falling back to normal launch: {e}"
        )

    try:
        existing_state = _safe_json_loads(r.get(session_key))
        if existing_state:
            keepalive_raw = _safe_json_loads(r.get(keepalive_key))
            keepalive_ts = float(keepalive_raw.get("timestamp") or 0)
            keepalive_fresh = keepalive_ts and (time.time() - keepalive_ts <= 45)
            if keepalive_fresh:
                req_logger.info(
                    "[multitenancy_audit] Existing bot reused for same user session",
                    tenantId=tenant_id,
                    sessionUserId=session_user_id,
                    sessionId=session_id,
                    roomUrl=room_url,
                    reused=True,
                    existingPid=existing_state.get("pid") or existing_state.get("job_id"),
                )
                return {
                    "status": existing_state.get("status", "running"),
                    "pid": existing_state.get("pid") or existing_state.get("job_id"),
                    "session_id": existing_state.get("session_id") or session_id,
                    "runner_url": existing_state.get("runner_url"),
                    "room_url": room_url,
                    "personalityId": existing_state.get("personalityId") or body.get("personalityId"),
                    "persona": existing_state.get("persona") or body.get("persona"),
                    "reused": True,
                    "detail": "Bot already active for user session",
                    "debugTraceId": debug_trace_id,
                }
            r.delete(session_key)
            r.delete(keepalive_key)
    except Exception as e:
        req_logger.warning(f"[gateway] Failed checking existing user-session bot state: {e}")

    try:
        pending_state = {
            "status": "pending",
            "room_url": room_url,
            "session_id": session_id,
            "tenantId": tenant_id,
            "sessionUserId": session_user_id,
            "sessionUserEmail": body.get("sessionUserEmail") or "",
            "sessionUserName": body.get("sessionUserName") or "",
            "timestamp": time.time(),
        }
        r.setex(session_key, 60, json.dumps(pending_state))
        r.setex(presence_key, 300, json.dumps({"timestamp": time.time()}))
        req_logger.info(
            "[multitenancy_audit] Pending bot state created",
            tenantId=tenant_id,
            sessionUserId=session_user_id,
            sessionId=session_id,
            roomUrl=room_url,
        )
    except Exception as e:
        req_logger.error(f"[gateway] Failed to set pending user-session state: {e}")

    # Push to Redis queue
    try:
        payload = json.dumps({**body, "userSessionKey": session_key, "presenceKey": presence_key})
        r.rpush(QUEUE_KEY, payload)
        req_logger.info(
            "[gateway] Queued job for room",
            personalityId=body.get("personalityId"),
            persona=body.get("persona"),
            voiceId=body.get("voice"),
            voiceProvider=body.get("voiceProvider"),
            debugTraceId=debug_trace_id,
            tenantId=tenant_id,
            sessionUserId=session_user_id,
            sessionId=session_id,
            userSessionKey=session_key,
        )
        return {"status": "queued", "message": "Bot launch requested", "debugTraceId": debug_trace_id}
    except Exception as e:
        # If queue fails, we should try to clear the pending lock
        r.delete(session_key)
        req_logger.error(f"[gateway] Redis push failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/admin", dependencies=[Depends(require_auth)])
async def send_admin_message(body: AdminMessage, request: Request):
    # Require room_url; admin messaging is room-keyed
    if not body.room_url:
        raise HTTPException(status_code=400, detail="room_url is required for admin messaging")

    header_session_id = request.headers.get("x-session-id") or None
    header_user_id = request.headers.get("x-user-id") or None
    header_user_name = request.headers.get("x-user-name") or None

    sender_id = body.sender_id or header_user_id or "system"
    sender_name = body.sender_name or header_user_name or "System"
    claim_payload_raw = request.headers.get("x-bot-claims") or ""
    claim_payload = _safe_json_loads(claim_payload_raw)
    claim_tenant = (claim_payload.get("tenantId") or "").strip()
    claim_session_id = (claim_payload.get("sessionId") or header_session_id or "").strip()
    claim_user_id = (claim_payload.get("sessionUserId") or header_user_id or sender_id or "").strip()
    if not (claim_tenant and claim_session_id and claim_user_id):
        raise HTTPException(status_code=401, detail="missing_claim_context")
    _validate_signed_claims(
        request,
        {
            "tenantId": claim_tenant,
            "sessionUserId": claim_user_id,
            "sessionId": claim_session_id,
        },
    )

    admin_logger = bind_context_logger(
        room_url=body.room_url,
        session_id=header_session_id,
        user_id=header_user_id or sender_id,
        user_name=header_user_name or sender_name,
        tag="[gateway]",
    )

    try:
        # Construct payload matching RedisClient format
        import datetime
        
        payload = {
            "id": f"admin_{int(datetime.datetime.now().timestamp() * 1000)}_{os.urandom(4).hex()}",
            "type": "admin_message", 
            "timestamp": datetime.datetime.now().isoformat(),
            "message": body.message,
            "mode": body.mode,
            "sender_id": sender_id,
            "sender_name": sender_name,
            "room_url": body.room_url,
            "session_id": claim_session_id,
            "user_id": claim_user_id,
            "user_name": header_user_name or sender_name,
            "tenant_id": claim_tenant,
        }
        
        payload_str = json.dumps(payload)

        if USE_REDIS and r:
            # Redis path: publish + queue
            channel = f"admin:bot:{body.room_url}"
            r.publish(channel, payload_str)

            queue_key = f"admin:queue:{body.room_url}"
            r.rpush(queue_key, payload_str)
            r.expire(queue_key, 3600)
            
            admin_logger.info(f"[gateway] Sent admin message via Redis to {channel} (room: {body.room_url})")
        else:
            # File-based fallback for direct runner mode (USE_REDIS=false)
            # Write admin message as JSON file for the file-polling loop to pick up.
            # The bot polls for admin-{pid}-*.json in BOT_ADMIN_MESSAGE_DIR.
            from pathlib import Path
            from core.config import BOT_ADMIN_MESSAGE_DIR
            admin_dir = Path(BOT_ADMIN_MESSAGE_DIR()).expanduser()
            admin_dir.mkdir(parents=True, exist_ok=True)
            
            # In direct runner mode, bot runs in the same process as gateway
            bot_pid = os.getpid()
            filename = f"admin-{bot_pid}-{payload['id']}.json"
            filepath = admin_dir / filename
            filepath.write_text(payload_str)
            
            admin_logger.info(f"[gateway] Wrote admin message file {filename} (room: {body.room_url})")

        return {"status": "ok", "id": payload["id"], "room_url": body.room_url}
        
    except Exception as e:
        admin_logger.error(f"[gateway] Admin message failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class LeaveRequest(BaseModel):
    room_url: str
    tenantId: str | None = None
    sessionUserId: str | None = None
    sessionId: str | None = None


@app.post("/leave", dependencies=[Depends(require_auth)])
async def leave_room(body: LeaveRequest, request: Request):
    """Clean up room state when client leaves.
    
    Clears pending config from Redis to prevent stale sprite/voice config
    from affecting the next session in the same room.
    """
    if AUTH_REQUIRED and not (body.tenantId and body.sessionUserId and body.sessionId):
        raise HTTPException(status_code=401, detail="missing_claim_context")

    if body.tenantId and body.sessionUserId and body.sessionId:
        _validate_signed_claims(
            request,
            {
                "tenantId": body.tenantId,
                "sessionUserId": body.sessionUserId,
                "sessionId": body.sessionId,
            },
        )

    # Direct runner mode - clear in-memory state and terminate actual session
    if (not USE_REDIS) or (not r):
        logger.info(
            f"[gateway] LEAVE REQUEST START: room_url={body.room_url}, "
            f"active_rooms_before={dict(active_rooms)}"
        )

        if DIRECT_RUNNER_HTTP:
            async with active_rooms_lock:
                removed = active_rooms.pop(body.room_url, None)
            session_id = body.sessionId or (removed or {}).get("session_id")
            if session_id:
                try:
                    await _runner_request("POST", f"/sessions/{session_id}/leave", timeout_secs=10)
                    logger.info(
                        f"[gateway] LEAVE: Standalone runner session terminated: "
                        f"room_url={body.room_url}, session_id={session_id}"
                    )
                except HTTPException as e:
                    logger.warning(
                        f"[gateway] LEAVE: Standalone runner termination returned {e.status_code}: {e.detail}"
                    )
                except Exception as e:
                    logger.warning(f"[gateway] LEAVE: Standalone runner termination failed: {e}")
            deleted_user_mappings = await _cleanup_direct_user_bot_mappings_for_room(body.room_url)
            return {
                "status": "ok",
                "room_url": body.room_url,
                "message": "Standalone runner cleanup",
                "removed": bool(removed),
                "session_id": session_id,
                "deleted_user_mappings": deleted_user_mappings,
            }
        
        # Check runner sessions before cleanup
        try:
            from runner_main import sessions as runner_sessions, _first_session_for_room
            runner_session = _first_session_for_room(body.room_url)
            logger.info(
                f"[gateway] LEAVE: Runner sessions state: total={len(runner_sessions)}, "
                f"session_ids={list(runner_sessions.keys())}, "
                f"session_for_room={runner_session.id if runner_session else None}"
            )
        except Exception as e:
            logger.warning(f"[gateway] LEAVE: Could not check runner sessions: {e}")
        
        async with active_rooms_lock:
            removed = active_rooms.pop(body.room_url, None)
            logger.info(
                f"[gateway] LEAVE: Removed from active_rooms: room_url={body.room_url}, "
                f"removed={removed}, remaining_active_rooms={dict(active_rooms)}"
            )
            
            if removed:
                logger.info(
                    f"[gateway] LEAVE: Removed entry details: status={removed.get('status')}, "
                    f"session_id={removed.get('session_id')}, timestamp={removed.get('timestamp')}"
                )
                # Also terminate the actual session in runner_main if it exists
                session_id = removed.get("session_id")
                if session_id:
                    try:
                        from runner_main import sessions, _sessions_for_room
                        room_sessions = _sessions_for_room(body.room_url)
                        if room_sessions:
                            logger.info(
                                f"[gateway] LEAVE: Found {len(room_sessions)} session(s) for room {body.room_url}"
                            )
                            for existing_session in room_sessions:
                                if body.sessionId and existing_session.id != body.sessionId:
                                    continue
                                logger.info(
                                    f"[gateway] LEAVE: Terminating session: id={existing_session.id}, "
                                    f"room_url={existing_session.room_url}, task_done={existing_session.task.done()}"
                                )
                                if not existing_session.task.done():
                                    logger.info(f"[gateway] LEAVE: Cancelling task for session {existing_session.id}")
                                    existing_session.task.cancel()
                                    try:
                                        await asyncio.wait_for(existing_session.task, timeout=5)
                                        logger.info(f"[gateway] LEAVE: Session {existing_session.id} cancelled successfully")
                                    except (asyncio.TimeoutError, asyncio.CancelledError) as e:
                                        logger.warning(
                                            f"[gateway] LEAVE: Session {existing_session.id} did not cancel cleanly: {e}"
                                        )
                                # Remove from sessions registry
                                sessions.pop(existing_session.id, None)
                                logger.info(
                                    f"[gateway] LEAVE: Session {existing_session.id} terminated and removed"
                                )
                            logger.info(
                                f"[gateway] LEAVE: All sessions for room {body.room_url} terminated, "
                                f"remaining_sessions={len(sessions)}, session_ids={list(sessions.keys())}"
                            )
                        else:
                            logger.warning(
                                f"[gateway] LEAVE: No sessions found for room_url={body.room_url} "
                                f"in runner_sessions"
                            )
                    except ImportError as e:
                        logger.warning(
                            f"[gateway] LEAVE: Could not import runner_main to terminate session: {e}"
                        )
                    except Exception as e:
                        logger.error(
                            f"[gateway] LEAVE: Error terminating session: {e}",
                            exc_info=True
                        )
                # Remove any in-memory user->bot mappings for this room.
                deleted_user_mappings = await _cleanup_direct_user_bot_mappings_for_room(body.room_url)
                if deleted_user_mappings:
                    logger.info(
                        f"[gateway] LEAVE: Direct mode removed {deleted_user_mappings} user_bot mappings for room {body.room_url}"
                    )
            else:
                logger.info(f"[gateway] LEAVE: No entry found in active_rooms for {body.room_url}")
                # Still try to clean up any stale sessions for this room
                try:
                    from runner_main import sessions, _first_session_for_room
                    existing_session = _first_session_for_room(body.room_url)
                    if existing_session:
                        logger.warning(
                            f"[gateway] LEAVE: Found orphaned session {existing_session.id} for room {body.room_url}, "
                            f"task_done={existing_session.task.done()}, terminating"
                        )
                        if not existing_session.task.done():
                            existing_session.task.cancel()
                            try:
                                await asyncio.wait_for(existing_session.task, timeout=5)
                            except (asyncio.TimeoutError, asyncio.CancelledError):
                                pass
                        sessions.pop(existing_session.id, None)
                        logger.info(
                            f"[gateway] LEAVE: Orphaned session {existing_session.id} removed, "
                            f"remaining_sessions={len(sessions)}"
                        )
                    else:
                        logger.info(f"[gateway] LEAVE: No orphaned session found for {body.room_url}")
                except (ImportError, Exception) as e:
                    logger.debug(f"[gateway] LEAVE: Could not check for orphaned sessions: {e}")
                # Also remove stale user_bot mappings in direct mode even if active_rooms entry was missing.
                deleted_user_mappings = await _cleanup_direct_user_bot_mappings_for_room(body.room_url)
                if deleted_user_mappings:
                    logger.info(
                        f"[gateway] LEAVE: Direct mode removed {deleted_user_mappings} stale user_bot mappings for room {body.room_url}"
                    )
        
        # Final state check
        try:
            from runner_main import sessions as runner_sessions, _first_session_for_room
            runner_session = _first_session_for_room(body.room_url)
            logger.info(
                f"[gateway] LEAVE COMPLETE: room_url={body.room_url}, "
                f"active_rooms={dict(active_rooms)}, runner_sessions_count={len(runner_sessions)}, "
                f"session_for_room={runner_session.id if runner_session else None}"
            )
        except Exception as e:
            logger.warning(f"[gateway] LEAVE COMPLETE: Could not verify final state: {e}")
            
        return {"status": "ok", "room_url": body.room_url, "message": "Direct mode cleanup"}

    header_session_id = request.headers.get("x-session-id") or None
    header_user_id = request.headers.get("x-user-id") or None

    leave_logger = bind_context_logger(
        room_url=body.room_url,
        session_id=header_session_id,
        user_id=header_user_id,
        tag="[gateway]",
    )

    try:
        # Clear pending config keys so next session starts fresh
        config_key = f"bot:config:latest:{body.room_url}"
        config_hash_key = f"bot:config:hash:{body.room_url}"
        
        # Also clear room_active and room_keepalive keys to signal operator
        # that no bot is active. This prevents "DUPLICATE REJECTED" errors
        # when user quickly starts a new session (within 3s shutdown delay).
        room_active_key = f"room_active:{body.room_url}"
        room_keepalive_key = f"room_keepalive:{body.room_url}"
        
        leave_logger.info(f"[gateway] Preparing to delete keys for leave cleanup for room {body.room_url}: {config_key}, {config_hash_key}, {room_active_key}, {room_keepalive_key}")
        deleted = r.delete(config_key, config_hash_key, room_active_key, room_keepalive_key)
        deleted_user_mappings = _cleanup_user_bot_mappings_for_room(r, body.room_url)
        deleted_session_keys = 0
        if body.tenantId and body.sessionUserId and body.sessionId:
            session_key = _user_session_bot_key(body.tenantId, body.sessionUserId, body.sessionId)
            keepalive_key = _user_session_keepalive_key(body.tenantId, body.sessionUserId, body.sessionId)
            presence_key = _room_presence_key(body.tenantId, body.room_url, body.sessionUserId, body.sessionId)
            deleted_session_keys = r.delete(session_key, keepalive_key, presence_key)
        
        leave_logger.info(
            f"[gateway] Leave cleanup for room, deleted {deleted}/4 keys "
            f"(config_latest, config_hash, room_active, room_keepalive), "
            f"user_bot_mappings_removed={deleted_user_mappings}"
        )
        return {
            "status": "ok",
            "room_url": body.room_url,
            "keys_deleted": deleted,
            "user_bot_mappings_deleted": deleted_user_mappings,
            "session_keys_deleted": deleted_session_keys,
        }

    except Exception as e:
        leave_logger.error(f"[gateway] Leave cleanup failed: {e}")
        # Non-critical - don't fail the request
        return {"status": "ok", "room_url": body.room_url, "warning": str(e)}


@app.post("/config", dependencies=[Depends(require_auth)])
async def update_config(request: ConfigRequest, raw_request: Request):
    if not r:
        raise HTTPException(status_code=503, detail="Redis not available")
    claim_payload = _safe_json_loads(raw_request.headers.get("x-bot-claims") or "")
    claim_tenant = (claim_payload.get("tenantId") or "").strip()
    claim_session_user_id = (claim_payload.get("sessionUserId") or request.sessionUserId or "").strip()
    claim_session_id = (claim_payload.get("sessionId") or request.sessionId or "").strip()
    if not (claim_tenant and claim_session_user_id and claim_session_id):
        raise HTTPException(status_code=401, detail="missing_claim_context")
    _validate_signed_claims(
        raw_request,
        {
            "tenantId": claim_tenant,
            "sessionUserId": claim_session_user_id,
            "sessionId": claim_session_id,
        },
    )
    config_logger = bind_context_logger(
        room_url=request.room_url,
        session_id=request.sessionId,
        user_id=request.sessionUserId,
        user_name=request.sessionUserName,
        tag="[gateway]",
    )
    
    # We no longer require the bot to be fully "running" to accept config.
    # We publish to a room-based channel and set a latest-config key.
    # The bot will pick this up on startup or via pubsub.
    
    # Check if room is at least known (active or pending)
    lock_key = f"room_active:{request.room_url}"
    existing_state = r.get(lock_key)
    
    if not existing_state:
        # Try with/without trailing slash
        alt_url = request.room_url.rstrip('/') if request.room_url.endswith('/') else request.room_url + '/'
        alt_key = f"room_active:{alt_url}"
        existing_state = r.get(alt_key)
        
        if existing_state:
            lock_key = alt_key
            # Update request room_url to match the one in Redis for consistency
            request.room_url = alt_url
    
    if not existing_state:
        # If the room isn't even pending, we usually can't configure a bot that doesn't exist.
        # However, to handle race conditions where /config arrives before /join is fully processed,
        # we allow persisting the config. The bot will pick it up on startup via the latest-config key.
        config_logger.warning("Received config for unknown room; persisting for startup race handling")
    
    # We don't care if status is "pending" or "running".
    # We persist the config so the bot finds it when it's ready.
    
    payload_dict = request.model_dump(mode="json", exclude_none=True)
    payload = json.dumps(payload_dict, sort_keys=True)
    
    # Deduplicate config updates - skip if identical to last published config
    config_hash = hashlib.sha256(payload.encode()).hexdigest()[:16]
    config_hash_key = f"bot:config:hash:{request.room_url}"
    last_hash = r.get(config_hash_key)
    
    # Handle both bytes and str (depends on Redis client's decode_responses setting)
    if last_hash:
        last_hash_str = last_hash.decode() if isinstance(last_hash, bytes) else last_hash
    else:
        last_hash_str = None
    
    if last_hash_str and last_hash_str == config_hash:
        config_logger.info("Config unchanged (hash match), skipping publish", hash=config_hash[:8])
        return {"status": "ok", "message": "Config unchanged, skipped"}
    
    config_logger.info("Config payload", payload=payload_dict)
    
    # Store the hash for deduplication (TTL matches config key)
    r.setex(config_hash_key, 300, config_hash)
    
    # 1. Set latest config key (TTL 5 minutes to allow for startup delays)
    config_key = f"bot:config:latest:{request.room_url}"
    r.setex(config_key, 300, payload)
    
    # 2. Publish to room-based channel
    channel = f"bot:config:room:{request.room_url}"
    r.publish(channel, payload)
    
    config_logger.info(
        "Published config update",
        channel=channel,
        configKey=config_key,
    )
    
    return {"status": "ok", "message": "Config update published/queued"}

@app.get("/api/room/active-note")
async def get_active_note(room_url: str):
    """Get the active note for a session.
    
    Returns 200 OK with has_active_note=False if no note is active,
    instead of 404, to avoid frontend errors for late joiners.
    """
    note_id = await get_active_note_id(room_url)
    owner_id = await get_active_note_owner(room_url)
    
    if note_id:
        return {
            "has_active_note": True,
            "note_id": note_id,
            "owner_id": owner_id,
            "note_title": "Shared Note" # We don't store title in Redis yet
        }
    
    return {
        "has_active_note": False,
        "note_id": None
    }


@app.post("/api/room/active-note", dependencies=[Depends(require_auth)])
async def set_active_note(body: ActiveNoteRequest):

    if not body.room_url:
        raise HTTPException(status_code=400, detail="room_url is required")

    note_logger = bind_context_logger(
        room_url=body.room_url,
        session_id=body.owner,
        user_id=body.owner,
        user_name=None,
        tag="[gateway]",
    )

    try:
        await set_active_note_id(body.room_url, body.note_id, owner=body.owner)
        note_logger.info("Updated active note", noteId=body.note_id, owner=body.owner)
        return {"status": "ok", "note_id": body.note_id}
    except Exception as e:
        note_logger.error("Failed to set active note", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/room/active-applet")
async def get_active_applet(room_url: str):
    """Get the active applet for a session.
    
    Returns 200 OK with has_active_applet=False if no applet is active,
    instead of 404, to avoid frontend errors for late joiners.
    """
    applet_id = await get_active_applet_id(room_url)
    owner_id = await get_active_applet_owner(room_url)
    
    if applet_id:
        return {
            "has_active_applet": True,
            "applet_id": applet_id,
            "owner_id": owner_id
        }
    
    return {
        "has_active_applet": False,
        "applet_id": None
    }


@app.post("/api/room/active-applet", dependencies=[Depends(require_auth)])
async def set_active_applet(body: ActiveAppletRequest):

    if not body.room_url:
        raise HTTPException(status_code=400, detail="room_url is required")

    applet_logger = bind_context_logger(
        room_url=body.room_url,
        session_id=body.owner,
        user_id=body.owner,
        user_name=None,
        tag="[gateway]",
    )

    try:
        await set_active_applet_id(body.room_url, body.applet_id, owner=body.owner)
        applet_logger.info("Updated active applet", appletId=body.applet_id, owner=body.owner)
        return {"status": "ok", "applet_id": body.applet_id}
    except Exception as e:
        applet_logger.error("Failed to set active applet", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

# ---------------------------------------------------------------------------
# OpenClaw → PearlOS UI event bridge
# ---------------------------------------------------------------------------

class EmitEventRequest(BaseModel):
    event: str                          # e.g. "youtube.search", "app.open"
    payload: Dict[str, Any] = {}        # event-specific data
    room_url: str | None = None         # optional; defaults to first active room

@app.post("/emit-event", dependencies=[Depends(require_auth)])
async def emit_event(body: EmitEventRequest):
    """Send a nia.event envelope to the PearlOS frontend via Daily REST API.
    
    This allows OpenClaw (or any external caller) to trigger PearlOS UI actions
    (open apps, play YouTube, control windows, etc.) without going through Pipecat.
    """
    import time as _time

    api_key = os.getenv("DAILY_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="DAILY_API_KEY not configured")

    # Build nia.event envelope (same shape as AppMessageForwarder)
    envelope = {
        "v": 1,
        "kind": "nia.event",
        "seq": 0,  # external events use seq=0
        "ts": int(_time.time() * 1000),
        "event": body.event,
        "payload": body.payload,
    }

    # Resolve target room (optional — Daily delivery is best-effort)
    # Prefer non-auto-created rooms (real user sessions) over the persistent default room.
    room_url = body.room_url
    if not room_url:
        async with active_rooms_lock:
            best_url = None
            best_is_auto = True
            best_ts = 0
            for url, info in active_rooms.items():
                if info.get("status") != "running":
                    continue
                is_auto = info.get("auto_created", False)
                ts = info.get("timestamp", 0)
                if best_url is None or (best_is_auto and not is_auto) or (is_auto == best_is_auto and ts > best_ts):
                    best_url = url
                    best_is_auto = is_auto
                    best_ts = ts
            room_url = best_url

    # Derive room name for session scoping
    room_name = None
    if room_url:
        room_name = room_url.rstrip("/").split("/")[-1].split("?")[0] or None

    # Broadcast to WebSocket clients scoped to this room/session
    await ws_broadcast(envelope, session_id=room_name)

    if not room_url or not room_name:
        logger.info(f"[emit-event] No active room; delivered {body.event} via WebSocket only")
        return {"ok": True, "event": body.event, "delivery": "websocket-only"}

    # Also send via Daily REST API if room is available
    url = f"https://api.daily.co/v1/rooms/{room_name}/send-app-message"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json={"data": envelope, "recipient": "*"}, headers=headers, timeout=10) as resp:
                if resp.status >= 300:
                    txt = await resp.text()
                    if resp.status == 404:
                        logger.debug(f"[emit-event] Daily room {room_name} not active (WebSocket delivered): {txt[:120]}")
                    else:
                        logger.warning(f"[emit-event] Daily API error: {resp.status} {txt[:200]}")
                logger.info(f"[emit-event] Sent {body.event} to {room_name} (Daily + WebSocket)")
                return {"ok": True, "event": body.event, "room": room_name, "delivery": "daily+websocket"}
    except Exception as e:
        logger.warning(f"[emit-event] Daily delivery failed (WebSocket still sent): {e}")
        return {"ok": True, "event": body.event, "delivery": "websocket-only", "daily_error": str(e)}


# ---------------------------------------------------------------------------
# Tool proxy bridge – OpenClaw ↔ PearlOS bot tools
# ---------------------------------------------------------------------------

class ToolInvokeRequest(BaseModel):
    tool_name: str
    params: Dict[str, Any] | None = {}
    direct_tool_voice_handled: bool = False

    @model_validator(mode="before")
    @classmethod
    def _coerce_null_params(cls, values: Any) -> Any:
        """Coerce null params to empty dict — Groq sends null for no-arg tools."""
        if isinstance(values, dict) and values.get("params") is None:
            values["params"] = {}
        return values
    room_url: str | None = None  # optional; defaults to first active room
    # Direct execution context (used when no Daily room is active)
    tenant_id: str | None = None
    user_id: str | None = None
    user_email: str | None = None


_TOOL_NAME_ALIASES: dict[str, str] = {
    "web_search": "bot_web_search",
    "search_web": "bot_web_search",
    "search": "bot_web_search",
    "web_fetch": "bot_web_fetch",
    "browser_fetch": "bot_web_fetch",
    "fetch_url": "bot_web_fetch",
}


def _normalize_tool_name(tool_name: str) -> str:
    cleaned = (tool_name or "").strip()
    return _TOOL_NAME_ALIASES.get(cleaned, cleaned)


def _normalize_task_dispatch_tool(tool_name: str, params: dict | None) -> tuple[str, dict]:
    """Map compact voice super-tool task actions to the canonical task bridge."""
    normalized_params = dict(params or {})
    action = str(normalized_params.get("action") or "").strip()
    if tool_name == "pearl_system" and action == "openclaw_task":
        return "bot_openclaw_task", normalized_params
    if tool_name == "pearl_tasks" and action in {"create", "dispatch", "start"}:
        return "bot_openclaw_task", normalized_params
    return tool_name, normalized_params


def _pearl_open_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


_PEARLOS_OPEN_APP_ALIASES: dict[str, str] = {
    "agency": "agency",
    "theagency": "agency",
    "tasks": "agency",
    "tasklist": "agency",
    "rooms": "agency",
    "files": "files",
    "file": "files",
    "filespace": "files",
    "filemanager": "files",
    "notes": "notes",
    "note": "notes",
    "notepad": "notepad",
    "youtube": "youtube",
    "video": "youtube",
    "terminal": "terminal",
    "cmd": "terminal",
    "command": "terminal",
    "news": "news",
    "thenews": "news",
    "pulse": "pulse",
    "globalpulse": "pulse",
    "socialpulse": "pulse",
    "studio": "creation-launchpad",
    "creationstudio": "creation-launchpad",
    "creationlaunchpad": "creation-launchpad",
    "launchpad": "creation-launchpad",
    "creationengine": "creation-engine",
    "appletbuilder": "creation-engine",
    "htmlapplet": "creation-engine",
    "ourpearlos": "our-pearlos",
    "ourpearl": "our-pearlos",
    "publicfeatures": "our-pearlos",
    "featurecatalog": "our-pearlos",
    "communityfeatures": "our-pearlos",
    "settings": "settings",
    "preferences": "settings",
    "profilesettings": "settings",
}

_PEARLOS_OPEN_TOOL_BY_APP: dict[str, str] = {
    "notes": "bot_open_notes",
    "notepad": "bot_open_notes",
    "files": "bot_open_files",
    "youtube": "bot_open_youtube",
    "terminal": "bot_open_terminal",
    "news": "bot_open_news",
    "creation-engine": "bot_open_creation_engine",
}

_DIRECT_OPEN_TOOL_APP_ALIASES: dict[str, str] = {
    "bot_open_agency": "agency",
    "bot_open_the_agency": "agency",
    "bot_open_filespace": "files",
    "bot_open_studio": "creation-launchpad",
    "bot_open_creation_launchpad": "creation-launchpad",
    "bot_open_our_pearlos": "our-pearlos",
    "bot_open_pulse": "pulse",
    "bot_open_settings": "settings",
}


def _normalize_pearl_open_tool(tool_name: str, params: dict | None) -> tuple[str, dict]:
    normalized_params = dict(params or {})

    alias_app = _DIRECT_OPEN_TOOL_APP_ALIASES.get(tool_name)
    if alias_app:
        normalized_params["app"] = alias_app
        return "bot_open_app", normalized_params

    if tool_name != "pearl_open":
        return tool_name, normalized_params

    raw_action = (
        normalized_params.get("action")
        or normalized_params.get("app")
        or normalized_params.get("target")
        or normalized_params.get("name")
        or ""
    )
    action_key = _pearl_open_key(raw_action)

    if action_key == "youtube":
        video_id = str(
            normalized_params.get("videoId") or normalized_params.get("video_id") or ""
        ).strip()
        query = str(normalized_params.get("query") or "").strip()
        if video_id:
            return "bot_play_youtube_video", {"video_id": video_id}
        if query:
            return "bot_search_youtube_videos", {"query": query}

    app = _PEARLOS_OPEN_APP_ALIASES.get(action_key)
    if not app:
        return tool_name, normalized_params

    tool_for_app = _PEARLOS_OPEN_TOOL_BY_APP.get(app)
    next_params = {
        key: value
        for key, value in normalized_params.items()
        if key not in {"action", "app", "target", "name"}
    }
    if app == "files":
        query = str(
            normalized_params.get("query")
            or normalized_params.get("fileSearchQuery")
            or normalized_params.get("search")
            or ""
        ).strip()
        next_params = {"query": query} if query else {}
    if app == "news" and normalized_params.get("category"):
        next_params = {"category": normalized_params.get("category")}
    if tool_for_app:
        return tool_for_app, next_params

    next_params["app"] = app
    return "bot_open_app", next_params


_CANVAS_POLICY_WINDOW_SECONDS = 25.0
_CANVAS_LOADING_TEMPLATES = {"loading_card", "progress_tracker"}
_CANVAS_ALWAYS_ALLOW_TEMPLATES = _CANVAS_LOADING_TEMPLATES | {"error_card"}
_VAGUE_CANVAS_TOPICS = {
    "game",
    "a game",
    "the game",
    "video game",
    "a video game",
    "the video game",
    "behind it game",
    "behind it",
    "it game",
    "that game",
    "this game",
}


def _normalize_canvas_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _canvas_template_topic(params: dict | None) -> str:
    data = (params or {}).get("data")
    if not isinstance(data, dict):
        data = {}
    for key in (
        "title",
        "name",
        "subject",
        "topic",
        "query",
        "headline",
        "label",
        "caption",
        "image_url",
        "photo_url",
    ):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            text = value
            if "/api/image?q=" in text:
                text = text.split("/api/image?q=", 1)[1].split("&", 1)[0].replace("+", " ")
            return _normalize_canvas_text(text)
    return ""


def _canvas_call_signature(tool_name: str, params: dict | None) -> str:
    normalized = json.dumps(params or {}, sort_keys=True, default=str)
    return hashlib.sha256(f"{tool_name}:{normalized}".encode()).hexdigest()


def _should_skip_gateway_canvas_call(tool_name: str, params: dict | None, room_url: str | None) -> tuple[bool, str]:
    """Apply canvas policy for gateway-direct UI calls.

    REST/gateway execution bypasses the in-process Wonder Canvas tool dedup.
    This keeps voice from replacing one rich canvas with another generic card in
    the same room. A loading_card/progress_tracker can still be followed by final
    content, and callers can opt in to replacement with force/allow_update.
    """
    canvas_tools = {"bot_wonder_canvas_scene", "bot_wonder_canvas_template"}
    if tool_name not in canvas_tools:
        return False, ""

    params = params or {}
    template = _normalize_canvas_text(params.get("template"))
    force = bool(params.get("force") or params.get("allow_update") or params.get("replace"))

    if tool_name == "bot_wonder_canvas_template" and not force:
        topic = _canvas_template_topic(params)
        if topic in _VAGUE_CANVAS_TOPICS and template not in _CANVAS_ALWAYS_ALLOW_TEMPLATES:
            return True, f"vague canvas topic: {topic}"

    if force or template in _CANVAS_ALWAYS_ALLOW_TEMPLATES:
        return False, ""

    now = time.monotonic()
    scope = room_url or "default"
    cache = getattr(_should_skip_gateway_canvas_call, "_cache", {})
    previous = cache.get(scope)
    signature = _canvas_call_signature(tool_name, params)

    if previous and now - previous["ts"] < _CANVAS_POLICY_WINDOW_SECONDS:
        previous_template = previous.get("template", "")
        if previous_template not in _CANVAS_LOADING_TEMPLATES:
            if previous.get("signature") == signature:
                return True, "duplicate canvas payload"
            return True, "non-loading canvas replacement too soon"

    cache[scope] = {"ts": now, "signature": signature, "template": template}
    if len(cache) > 100:
        cache = {k: v for k, v in cache.items() if now - v["ts"] < 120.0}
    _should_skip_gateway_canvas_call._cache = cache
    return False, ""


MULTI_ORB_SWARM_AGENTS = (
    "Codex",
    "Claude CLI",
    "Kimi 2.6",
    "Gemini",
    "DeepSeek4Pro",
)

_VOICE_SWARM_INTENT_TERMS = (
    "agency",
    "agent team",
    "agents",
    "multi agent",
    "multi-agent",
    "openrouter",
    "swarm",
)

_VOICE_SWARM_WORK_TERMS = (
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


def _clean_agent_names(raw: Any) -> list[str]:
    if isinstance(raw, str):
        candidates: list[Any] = raw.split(",")
    elif isinstance(raw, (list, tuple, set)):
        candidates = list(raw)
    else:
        return []

    agents: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        name = str(candidate or "").strip()
        key = name.lower()
        if name and key not in seen:
            agents.append(name)
            seen.add(key)
    return agents


def _voice_task_swarm_metadata(task: str, params: dict) -> dict[str, Any]:
    explicit_kind = str(
        params.get("kind") or params.get("task_kind") or params.get("dispatch_kind") or ""
    ).strip().lower()
    requested_mode = str(params.get("execution_mode") or "").strip()
    execution_mode = requested_mode if requested_mode in {"fast_draft", "full_build"} else None
    requested_agents = _clean_agent_names(
        params.get("agents") or params.get("models") or params.get("swarm_agents")
    )
    category = str(
        params.get("swarm_category") or params.get("category") or "The Agency"
    ).strip() or "The Agency"
    text = " ".join(
        str(value or "")
        for value in (
            task,
            params.get("title"),
            params.get("action"),
            params.get("swarm_category"),
            params.get("category"),
        )
    ).lower()

    if explicit_kind == "task":
        return {
            "kind": "task",
            "agents": requested_agents or None,
            "swarm_category": category if requested_agents else None,
            "execution_mode": execution_mode,
        }

    wants_swarm = (
        explicit_kind == "swarm"
        or len(requested_agents) > 1
        or any(term in text for term in _VOICE_SWARM_INTENT_TERMS)
        or any(term in text for term in _VOICE_SWARM_WORK_TERMS)
    )
    if not wants_swarm:
        return {
            "kind": None,
            "agents": requested_agents or None,
            "swarm_category": category if requested_agents else None,
            "execution_mode": execution_mode,
        }

    return {
        "kind": "swarm",
        "agents": requested_agents or list(MULTI_ORB_SWARM_AGENTS),
        "swarm_category": category,
        "execution_mode": execution_mode or "full_build",
    }


@app.get("/api/tools/list")
async def list_tools():
    """Return all discovered bot tools with name, description, parameters, and feature_flag."""
    try:
        from tools.discovery import get_discovery
        discovery = get_discovery()
        tools = discovery.discover_tools()
        tool_list = []
        for name, meta in sorted(tools.items()):
            tool_list.append({
                "name": name,
                "description": meta.get("description", ""),
                "parameters": meta.get("parameters", {}),
                "feature_flag": meta.get("feature_flag"),
                "passthrough": meta.get("passthrough", False),
            })
        return {"tools": tool_list, "count": len(tool_list)}
    except Exception as e:
        logger.error(f"[tools] Failed to list tools: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Direct tool execution handlers (no Daily room required)
# ---------------------------------------------------------------------------

# Map of tool_name -> async handler(params, tenant_id, user_id) -> dict
# These execute data operations directly via Mesh, returning results synchronously.
_DIRECT_TOOL_HANDLERS: Dict[str, Any] = {}


def _register_direct_handlers():
    """Register direct execution handlers for notes tools."""
    from actions import notes_actions

    def _direct_note_state(tenant_id: str | None, user_id: str | None, session_id: str | None = None) -> dict:
        key = _note_state_key(tenant_id, user_id, session_id)
        if not key:
            return {}
        return _note_states.get(key, {})

    def _set_direct_note_state(tenant_id: str, user_id: str, note: dict | None, action: str = "opened") -> None:
        key = _note_state_key(tenant_id, user_id)
        if not key:
            return
        _note_states[key] = {
            "noteId": (note or {}).get("_id") or (note or {}).get("page_id"),
            "title": (note or {}).get("title"),
            "content": (note or {}).get("content"),
            "viewState": "document" if note else "library",
            "action": action,
            "tenantId": tenant_id,
            "userId": user_id,
            "updatedAt": time.time(),
        }

    async def _handle_bot_list_notes(params: dict, tenant_id: str, user_id: str) -> dict:
        limit = params.get("limit", 50)
        notes = await notes_actions.list_notes(tenant_id, user_id, limit=limit)
        return {
            "success": True,
            "notes": notes,
            "count": len(notes),
            "user_message": f"Found {len(notes)} note(s).",
        }

    async def _handle_bot_create_note(params: dict, tenant_id: str, user_id: str) -> dict:
        title = params.get("title", "")
        content = params.get("content", "")
        mode = params.get("mode", "personal")
        if not title:
            return {"success": False, "error": "title is required"}
        note = await notes_actions.create_note(tenant_id, user_id, title, content, mode)
        if note:
            _set_direct_note_state(tenant_id, user_id, note)
            return {
                "success": True,
                "note": note,
                "user_message": f"Created note '{title}'.",
            }
        return {"success": False, "error": "Failed to create note via Mesh"}

    async def _handle_bot_replace_note(params: dict, tenant_id: str, user_id: str) -> dict:
        content = params.get("content", "")
        title = params.get("title")
        state = _direct_note_state(tenant_id, user_id)
        note_id = params.get("note_id") or state.get("noteId")
        if not note_id:
            return {"success": False, "error": "note_id is required (no note currently open)"}
        if not content:
            return {"success": False, "error": "content is required"}
        ok = await notes_actions.update_note_content(tenant_id, note_id, content, user_id, title)
        if ok:
            updated = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
            return {"success": True, "note": updated, "user_message": "Note updated."}
        return {"success": False, "error": "Failed to update note"}

    async def _handle_bot_open_note(params: dict, tenant_id: str, user_id: str) -> dict:
        note_id = params.get("note_id")
        title = params.get("title")

        def _return_open(note: dict) -> dict:
            _set_direct_note_state(tenant_id, user_id, note)
            return {
                "success": True,
                "note": note,
                "user_message": f"Opened note: {note.get('title', 'Untitled')}",
            }

        if note_id:
            note = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
            if note:
                return _return_open(note)
            return {"success": False, "error": f"Note {note_id} not found"}
        if title:
            matches = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
            if matches and len(matches) == 1:
                return _return_open(matches[0])
            if matches and len(matches) > 1:
                return {"success": False, "error": "Multiple notes match that title", "matches": [{"_id": n.get("_id"), "title": n.get("title")} for n in matches]}
            return {"success": False, "error": f"No note matching '{title}'"}
        return {"success": False, "error": "note_id or title required"}

    async def _handle_bot_read_current_note(params: dict, tenant_id: str | None, user_id: str | None) -> dict:
        state = _direct_note_state(tenant_id, user_id)
        note_id = params.get("note_id") or state.get("noteId")
        if not note_id:
            return {"success": False, "error": "note_id is required (no note currently open)"}
        if not tenant_id or not user_id or str(user_id).lower() == "anonymous":
            return {"success": False, "error": "tenant_id is required to fetch note content"}
        note = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
        if not note:
            return {"success": False, "error": "Note not found"}
        return {"success": True, "note": note, "user_message": f"Here's the content of '{note.get('title', 'Untitled')}'."}

    async def _handle_bot_delete_note(params: dict, tenant_id: str, user_id: str) -> dict:
        note_id = params.get("note_id")
        title = params.get("title")
        confirm = params.get("confirm", False)
        if not confirm:
            return {"success": False, "error": "Set confirm=true to delete"}
        if not note_id and title:
            matches = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
            if matches and len(matches) == 1:
                note_id = matches[0].get("_id")
            elif matches and len(matches) > 1:
                return {"success": False, "error": "Multiple notes match that title", "matches": [{"_id": n.get("_id"), "title": n.get("title")} for n in matches]}
            else:
                return {"success": False, "error": f"No note matching '{title}'"}
        if not note_id:
            return {"success": False, "error": "note_id or title required"}
        ok = await notes_actions.delete_note(tenant_id, note_id, user_id)
        if ok:
            return {"success": True, "user_message": "Note deleted."}
        return {"success": False, "error": "Failed to delete note (not found or permission denied)"}

    async def _handle_bot_save_note(params: dict, tenant_id: str, user_id: str) -> dict:
        # Notes auto-save via Mesh; this is a no-op acknowledgement
        return {"success": True, "user_message": "Note saved (auto-persisted via Mesh)."}

    async def _handle_bot_add_note_content(params: dict, tenant_id: str, user_id: str) -> dict:
        content = params.get("content", "")
        position = params.get("position", "end")
        state = _direct_note_state(tenant_id, user_id)
        note_id = params.get("note_id") or state.get("noteId")
        if not note_id:
            return {"success": False, "error": "No note currently open. Create or open a note first"}
        if not content:
            return {"success": False, "error": "content is required"}
        note = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
        if not note:
            return {"success": False, "error": f"Note {note_id} not found"}
        existing_raw = note.get("content", "") or ""
        existing = existing_raw.get("content", "") if isinstance(existing_raw, dict) else str(existing_raw)
        if position == "start":
            new_content = content + "\n\n" + existing if existing else content
        else:
            new_content = existing + "\n\n" + content if existing else content
        success = await notes_actions.update_note_content(
            tenant_id=tenant_id,
            note_id=note_id,
            content=new_content,
            user_id=user_id,
        )
        if success:
            updated = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
            updated_note = updated or {**note, "content": new_content}
            _set_direct_note_state(tenant_id, user_id, updated_note, action="updated")
            return {"success": True, "note": updated_note, "user_message": "Added content to note."}
        return {"success": False, "error": "Failed to add content to note"}

    _DIRECT_TOOL_HANDLERS["bot_list_notes"] = _handle_bot_list_notes
    _DIRECT_TOOL_HANDLERS["bot_create_note"] = _handle_bot_create_note
    _DIRECT_TOOL_HANDLERS["bot_replace_note"] = _handle_bot_replace_note
    _DIRECT_TOOL_HANDLERS["bot_open_note"] = _handle_bot_open_note
    _DIRECT_TOOL_HANDLERS["bot_read_current_note"] = _handle_bot_read_current_note
    _DIRECT_TOOL_HANDLERS["bot_delete_note"] = _handle_bot_delete_note
    _DIRECT_TOOL_HANDLERS["bot_save_note"] = _handle_bot_save_note
    _DIRECT_TOOL_HANDLERS["bot_add_note_content"] = _handle_bot_add_note_content

    # Photo Magic — generate images via the interface OpenRouter route
    async def _handle_bot_photo_magic_generate(params: dict, tenant_id: str, user_id: str) -> dict:
        prompt = params.get("prompt", "")
        if not prompt:
            return {"success": False, "error": "prompt is required"}
        try:
            payload = await _proxy_photo_magic_json(
                "/api/photo-magic/generate",
                json_body={"prompt": prompt},
                claim_headers=_photo_magic_claim_headers(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    user_email=params.get("_authenticated_user_email") or params.get("user_email"),
                    user_name=params.get("_authenticated_user_name") or params.get("user_name"),
                    session_id=params.get("session_id"),
                ),
            )
            normalized = _normalize_photo_magic_payload(payload)
            return {
                "success": True,
                "image_path": normalized.get("image_path"),
                "image_url": normalized.get("image_url"),
                "filename": normalized.get("filename"),
                "model": normalized.get("model"),
                "agency_tracked": bool(normalized.get("agencyTracked")),
                "user_message": "I started it as a tracked image-generation job, and the image is ready.",
            }
        except Exception as e:
            logger.error(f"[photo-magic] Generate via tool failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    _DIRECT_TOOL_HANDLERS["bot_photo_magic_generate"] = _handle_bot_photo_magic_generate

    # Note view-control tools — pure UI, no Mesh/DB needed.
    # Direct handlers just return success; the broadcast mechanism sends
    # the nia.event envelope with the payload to all connected clients.
    async def _handle_note_control_passthrough(params: dict, tenant_id: str, user_id: str) -> dict:
        return {"success": True, "user_message": "Note control command sent."}

    for _nt in [
        "bot_scroll_note",
        "bot_highlight_note",
        "bot_highlight_note_text",
        "bot_navigate_note_heading",
        "bot_clear_note_highlights",
    ]:
        _DIRECT_TOOL_HANDLERS[_nt] = _handle_note_control_passthrough

    # Canvas Lab / Wonder Canvas tools — pure UI, no Mesh/DB needed.
    # Direct handlers just return success; the broadcast mechanism sends
    # the nia.event envelope with the payload to all connected clients.
    async def _handle_wonder_passthrough(params: dict, tenant_id: str, user_id: str) -> dict:
        return {"success": True, "user_message": "Canvas updated."}

    for _wt in [
        "bot_pearl_visual_state",
        "bot_pixel_canvas",
        "bot_wonder_canvas_scene",
        "bot_wonder_canvas_add",
        "bot_wonder_canvas_remove",
        "bot_wonder_canvas_clear",
        "bot_wonder_canvas_animate",
        "bot_wonder_canvas_template",
    ]:
        _DIRECT_TOOL_HANDLERS[_wt] = _handle_wonder_passthrough

    # ---------------------------------------------------------------------------
    # bot_canvas_show — creates a note via Mesh and opens it on the UI.
    # The _broadcast_tool_event_best_effort emits note.open so the frontend
    # navigates to the new note even without a voice session.
    # ---------------------------------------------------------------------------
    async def _handle_bot_canvas_show(params: dict, tenant_id: str, user_id: str) -> dict:
        title = params.get("title", "Untitled")
        content = params.get("content", "")
        if not content:
            return {"success": False, "error": "content is required"}
        mode = "work"
        note = await notes_actions.create_note(tenant_id, user_id, title, content, mode)
        if note:
            return {
                "success": True,
                "note": note,
                "user_message": f"I've put '{title}' on your screen.",
            }
        return {"success": False, "error": "Failed to create note via Mesh"}

    _DIRECT_TOOL_HANDLERS["bot_canvas_show"] = _handle_bot_canvas_show

    # bot_canvas_show_file — reads a file and creates a note with its content
    async def _handle_bot_canvas_show_file(params: dict, tenant_id: str, user_id: str) -> dict:
        from pathlib import Path
        file_path = params.get("file_path", "")
        title = params.get("title")
        if not file_path:
            return {"success": False, "error": "file_path is required"}
        path = Path(file_path)
        if not path.is_absolute():
            for base in [
                Path("/workspace/OpenClaw/workspace"),
                Path("/workspace/nia-universal"),
                Path.cwd(),
            ]:
                candidate = base / file_path
                if candidate.exists():
                    path = candidate
                    break
        if not path.exists():
            return {"success": False, "error": f"File not found: {file_path}"}
        try:
            from services.openclaw_mesh_bridge import _file_to_markdown
            content = _file_to_markdown(path)
        except ImportError:
            # Fallback: read as text
            try:
                content = path.read_text(errors="replace")[:50000]
            except Exception as e:
                return {"success": False, "error": f"Cannot read file: {e}"}
        display_title = title or path.name
        note = await notes_actions.create_note(tenant_id, user_id, display_title, content, "work")
        if note:
            return {"success": True, "note": note, "user_message": f"I've put '{display_title}' on your screen."}
        return {"success": False, "error": "Failed to create note via Mesh"}

    _DIRECT_TOOL_HANDLERS["bot_canvas_show_file"] = _handle_bot_canvas_show_file

    # Canvas content tools (chart, article, image, table) — pure UI events.
    # The broadcast mechanism emits Pearl Views compatibility events for the frontend.
    async def _handle_canvas_content_passthrough(params: dict, tenant_id: str, user_id: str) -> dict:
        return {"success": True, "user_message": "Content displayed on canvas."}

    for _ct in [
        "bot_canvas_show_chart",
        "bot_canvas_show_article",
        "bot_canvas_show_image",
        "bot_canvas_show_table",
    ]:
        _DIRECT_TOOL_HANDLERS[_ct] = _handle_canvas_content_passthrough

    # ---------------------------------------------------------------------------
    # bot_open_news — opens the standalone News app window.
    # Keep this aligned with tools.view_tools.bot_open_news so direct voice,
    # REST invoke, and Phase 2 all deliver the same UI event.
    # ---------------------------------------------------------------------------
    async def _handle_bot_open_news(params: dict, tenant_id: str, user_id: str) -> dict:
        category = (params or {}).get("category")
        category = str(category).strip().lower() if category else None
        return {
            "success": True,
            "user_message": "Opening The News app.",
            "category": category,
        }

    _DIRECT_TOOL_HANDLERS["bot_open_news"] = _handle_bot_open_news

    # ---------------------------------------------------------------------------
    # bot_get_weather — fetches live weather data and opens the standalone
    # Weather app through _broadcast_tool_event_best_effort.
    # ---------------------------------------------------------------------------
    async def _handle_bot_get_weather(params: dict, tenant_id: str, user_id: str) -> dict:
        import aiohttp as _aiohttp
        try:
            from tools.weather_tools import _geocode, _fetch_weather, _decode_wmo
        except ImportError:
            return {"success": False, "error": "Weather tools not available"}

        location = (params.get("location") or "").strip()
        if not location:
            return {"success": False, "error": "Location is required."}

        try:
            async with _aiohttp.ClientSession() as session:
                geo = await _geocode(session, location)
                if not geo:
                    return {"success": False, "error": f"Could not find location: {location}"}

                loc_display = geo["name"]
                if geo.get("admin1"):
                    loc_display += f", {geo['admin1']}"
                if geo.get("country"):
                    loc_display += f", {geo['country']}"

                weather = await _fetch_weather(session, geo["latitude"], geo["longitude"], geo["timezone"])
                if not weather:
                    return {"success": False, "error": "Failed to fetch weather data."}

            current = weather.get("current", {})
            daily = weather.get("daily", {})
            current_units = weather.get("current_units", {})

            wmo = current.get("weather_code", 0)
            desc, emoji, icon = _decode_wmo(wmo)

            forecast_list = []
            for i, d in enumerate(daily.get("time", [])):
                fc_desc, _, _ = _decode_wmo(daily["weather_code"][i] if i < len(daily.get("weather_code", [])) else 0)
                forecast_list.append({
                    "date": d,
                    "condition": fc_desc,
                    "high_f": daily["temperature_2m_max"][i] if i < len(daily.get("temperature_2m_max", [])) else None,
                    "low_f": daily["temperature_2m_min"][i] if i < len(daily.get("temperature_2m_min", [])) else None,
                })

            return {
                "success": True,
                "location": loc_display,
                "current": {
                    "temperature_f": current.get("temperature_2m"),
                    "feels_like_f": current.get("apparent_temperature"),
                    "condition": desc,
                    "humidity_pct": current.get("relative_humidity_2m"),
                    "wind_mph": current.get("wind_speed_10m"),
                },
                "forecast": forecast_list,
                "user_message": f"Here's the weather for {loc_display}.",
            }
        except Exception as e:
            return {"success": False, "error": f"Weather fetch failed: {str(e)}"}

    _DIRECT_TOOL_HANDLERS["bot_get_weather"] = _handle_bot_get_weather

    class _GatewayToolLog:
        def info(self, message: str, **kwargs):
            logger.info(f"[tools] {message} {kwargs if kwargs else ''}")

        def warning(self, message: str, **kwargs):
            logger.warning(f"[tools] {message} {kwargs if kwargs else ''}")

        def error(self, message: str, **kwargs):
            logger.error(f"[tools] {message} {kwargs if kwargs else ''}")

    async def _handle_bot_web_search(params: dict, tenant_id: str | None, user_id: str | None) -> dict:
        query = (params or {}).get("query") or (params or {}).get("q") or ""
        query = str(query).strip()
        if not query:
            return {"success": False, "error": "query is required"}
        try:
            count = int((params or {}).get("count") or (params or {}).get("limit") or 5)
        except Exception:
            count = 5
        count = max(1, min(count, 10))
        try:
            from tools.web_search_tools import _search_brave, _search_duckduckgo, aiohttp as _search_aiohttp
            if _search_aiohttp is None:
                return {"success": False, "error": "aiohttp not available"}
            log = _GatewayToolLog()
            provider = "brave"
            results = await _search_brave(query, count, log)
            if not results:
                provider = "duckduckgo"
                results = await _search_duckduckgo(query, count, log)
            return {
                "success": True,
                "provider": provider,
                "query": query,
                "num_results": len(results),
                "results": results,
                "user_message": f"Found {len(results)} web result(s) for {query}.",
            }
        except Exception as e:
            logger.error(f"[tools] bot_web_search direct execution failed: {e}", exc_info=True)
            return {"success": False, "error": f"Search failed: {e}"}

    async def _handle_bot_web_fetch(params: dict, tenant_id: str | None, user_id: str | None) -> dict:
        url = str((params or {}).get("url") or "").strip()
        if not url:
            return {"success": False, "error": "url is required"}
        try:
            from tools.web_search_tools import _strip_html, _validate_url, aiohttp as _search_aiohttp
            if _search_aiohttp is None:
                return {"success": False, "error": "aiohttp not available"}
            url_error = _validate_url(url)
            if url_error:
                return {"success": False, "error": url_error}
            async with _search_aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (compatible; PearlOS/1.0)"},
                    timeout=_search_aiohttp.ClientTimeout(total=15),
                    allow_redirects=True,
                ) as resp:
                    if resp.status != 200:
                        return {"success": False, "error": f"Failed to fetch URL (status {resp.status})"}
                    html = await resp.text(errors="replace")
            text = _strip_html(html)
            if len(text) > 4000:
                text = text[:4000] + "... [truncated]"
            return {"success": True, "url": url, "content": text, "user_message": f"Fetched {url}."}
        except Exception as e:
            logger.error(f"[tools] bot_web_fetch direct execution failed: {e}", exc_info=True)
            return {"success": False, "error": f"Fetch failed: {e}"}

    _DIRECT_TOOL_HANDLERS["bot_web_search"] = _handle_bot_web_search
    _DIRECT_TOOL_HANDLERS["bot_web_fetch"] = _handle_bot_web_fetch

    async def _handle_bot_get_public_profile(params: dict, tenant_id: str | None, user_id: str | None) -> dict:
        params = params or {}
        requester_user_id = str(user_id or params.get("requester_user_id") or "").strip()
        requester_email = str(params.get("user_email") or params.get("requester_email") or "").strip().lower()
        if not requester_user_id and not requester_email:
            return {
                "success": False,
                "error": "Signed-in user identity is required to read public profile information.",
            }

        try:
            from actions import profile_actions
            profile = await profile_actions.get_user_profile(requester_user_id) if requester_user_id else None
            if not profile and requester_email:
                profile = await profile_actions.get_user_profile_by_email(requester_email)
        except Exception as e:
            logger.error(f"[tools] bot_get_public_profile lookup failed: {e}", exc_info=True)
            return {"success": False, "error": f"Profile lookup failed: {e}"}

        if not profile:
            return {"success": False, "error": "No PearlOS profile found for the signed-in user."}

        persona = profile.get("publicPersona")
        if not isinstance(persona, dict):
            persona = {}

        social_links = persona.get("socialLinks")
        clean_social_links = {}
        if isinstance(social_links, dict):
            for key in ("twitter", "bluesky", "github", "website"):
                value = social_links.get(key)
                if value:
                    clean_social_links[key] = str(value)

        interests = persona.get("interests")
        clean_interests = []
        if isinstance(interests, list):
            clean_interests = [str(item) for item in interests if str(item).strip()][:20]

        public_profile = {
            "displayName": persona.get("displayName") or profile.get("first_name") or "",
            "bio": persona.get("bio") or "",
            "interests": clean_interests,
            "socialLinks": clean_social_links,
            "avatarUrl": persona.get("avatarUrl") or "",
            "location": persona.get("location") or "",
            "profession": persona.get("profession") or "",
            "isPublic": bool(persona.get("isPublic")),
        }
        has_public_profile = any(
            bool(public_profile.get(key))
            for key in ("displayName", "bio", "interests", "socialLinks", "avatarUrl", "location", "profession")
        )

        return {
            "success": True,
            "has_public_profile": has_public_profile,
            "is_public": public_profile["isPublic"],
            "public_profile": public_profile,
            "user_message": "Public profile loaded.",
        }

    _DIRECT_TOOL_HANDLERS["bot_get_public_profile"] = _handle_bot_get_public_profile

    async def _handle_pearl_search(params: dict, tenant_id: str | None, user_id: str | None) -> dict:
        action = str((params or {}).get("action") or "web").strip()
        if action == "web":
            return await _handle_bot_web_search(params, tenant_id, user_id)
        if action == "fetch":
            return await _handle_bot_web_fetch(params, tenant_id, user_id)
        if action == "weather":
            return await _handle_bot_get_weather(params, tenant_id, user_id)
        return {"success": False, "error": f"Unsupported pearl_search action: {action}"}

    async def _handle_pearl_canvas(params: dict, tenant_id: str | None, user_id: str | None) -> dict:
        action = str((params or {}).get("action") or "scene").strip()
        if action in {"fluid", "state", "visual_state"}:
            params = {
                **(params or {}),
                "action": "state",
                "mode": (params or {}).get("mode") or "explain",
                "title": (params or {}).get("title") or (params or {}).get("topic") or (params or {}).get("focus") or "Pearl",
            }
            return await _handle_wonder_passthrough(params, tenant_id, user_id)
        if action in {"scene", "pixel"}:
            return await _handle_wonder_passthrough(params, tenant_id, user_id)
        if action == "video":
            params = {**(params or {}), "render_mode": "video"}
            return await _handle_wonder_passthrough(params, tenant_id, user_id)
        if action == "generate_video":
            params = {
                **(params or {}),
                "render_mode": "generate_video",
                "use_avatar_image": (params or {}).get("use_avatar_image", True),
                "duration": (params or {}).get("duration", 6),
                "fps": (params or {}).get("fps", 24),
                "generate_audio": (params or {}).get("generate_audio", False),
            }
            return await _handle_wonder_passthrough(params, tenant_id, user_id)
        if action == "clear":
            params = {**(params or {}), "render_mode": "clear"}
            return await _handle_wonder_passthrough(params, tenant_id, user_id)
        if action in {"template", "animate", "add_layer", "avatar_hint"}:
            params = {
                **(params or {}),
                "render_mode": "text",
                "text": (params or {}).get("text")
                or (params or {}).get("content")
                or (params or {}).get("title")
                or (params or {}).get("name")
                or "Pearl visual",
            }
            return await _handle_wonder_passthrough(params, tenant_id, user_id)
        return {"success": False, "error": f"Unsupported pearl_canvas action: {action}"}

    _DIRECT_TOOL_HANDLERS["pearl_search"] = _handle_pearl_search
    _DIRECT_TOOL_HANDLERS["pearl_canvas"] = _handle_pearl_canvas

    # bot_end_call — emits bot.session.end nia.event; the actual Pipecat
    # session teardown is handled by the Daily pipeline when the bot process
    # receives the event via app-message. The gateway's role is just to
    # broadcast the UI event so the frontend can react immediately.
    async def _handle_bot_end_call(params: dict, tenant_id: str, user_id: str) -> dict:
        import time as _time

        result = {"success": True, "user_message": "Closing the assistant session."}

        # Broadcast bot.session.end BEFORE returning so the frontend receives it
        # even if the Daily session is torn down immediately after.
        ui_envelope = {
            "v": 1,
            "kind": "nia.event",
            "seq": 0,
            "ts": int(_time.time() * 1000),
            "event": "bot.session.end",
            "payload": {"reason": "bot_end_call"},
        }

        # 1. WebSocket broadcast (reaches frontend even without Daily)
        try:
            await ws_broadcast(ui_envelope)
        except Exception as _ws_err:
            logger.warning(f"[bot_end_call] WS broadcast failed: {_ws_err}")

        # 2. Daily REST API broadcast (reaches in-call participants)
        _room_url = None
        async with active_rooms_lock:
            for _u, _i in active_rooms.items():
                if _i.get("status") == "running":
                    _room_url = _u
                    break

        if _room_url:
            _room_name = _room_url.rstrip("/").split("/")[-1].split("?")[0]
            _api_key = os.getenv("DAILY_API_KEY", "")
            if _room_name and _api_key:
                try:
                    async with aiohttp.ClientSession() as _sess:
                        async with _sess.post(
                            f"https://api.daily.co/v1/rooms/{_room_name}/send-app-message",
                            json={"data": ui_envelope, "recipient": "*"},
                            headers={
                                "Authorization": f"Bearer {_api_key}",
                                "Content-Type": "application/json",
                            },
                            timeout=5,
                        ) as _resp:
                            if _resp.status < 300:
                                logger.info(f"[bot_end_call] Delivered bot.session.end via Daily to {_room_name}")
                            else:
                                _txt = await _resp.text()
                                logger.warning(f"[bot_end_call] Daily broadcast error: {_resp.status} {_txt[:120]}")
                except Exception as _daily_err:
                    logger.warning(f"[bot_end_call] Daily broadcast failed: {_daily_err}")

        return result

    _DIRECT_TOOL_HANDLERS["bot_end_call"] = _handle_bot_end_call

    # ── Generic passthrough handlers for UI-only tools ──────────────
    # These tools just emit nia.event UI envelopes (open/close apps, window
    # management, YouTube, soundtrack, etc.). They don't need backend logic —
    # the _broadcast_tool_event_best_effort function handles the actual event
    # emission based on _PASSTHROUGH_UI_EVENTS mapping.
    async def _handle_ui_passthrough(params: dict, tenant_id: str, user_id: str) -> dict:
        return {"success": True, "user_message": "Done."}

    async def _handle_bot_open_app(params: dict, tenant_id: str, user_id: str) -> dict:
        app = str((params or {}).get("app") or "").strip()
        if not app:
            return {"success": False, "error": "app_required", "user_message": "I need an app to open."}
        return {"success": True, "app": app, "user_message": f"Opening {app}."}

    _UI_PASSTHROUGH_TOOLS = [
        "bot_open_app",
        "bot_open_notes", "bot_close_notes",
        "bot_open_files",
        "bot_open_youtube", "bot_close_youtube",
        "bot_open_gmail", "bot_close_gmail",
        "bot_open_terminal", "bot_close_terminal",
        "bot_open_google_drive", "bot_close_google_drive",
        "bot_open_creation_engine", "bot_close_applet_creation_engine",
        "bot_open_browser", "bot_open_enhanced_browser",
        "bot_close_browser_window", "bot_close_view",
        "bot_minimize_window", "bot_maximize_window",
        "bot_restore_window", "bot_snap_window_left",
        "bot_snap_window_right", "bot_reset_window_position",
        "bot_switch_desktop_mode",
        "bot_search_youtube_videos", "bot_play_youtube_video",
        "bot_pause_youtube_video", "bot_play_next_youtube_video",
        "bot_play_soundtrack", "bot_stop_soundtrack",
        "bot_next_soundtrack_track", "bot_adjust_soundtrack_volume",
        "bot_set_soundtrack_volume",
        "bot_switch_note_mode", "bot_show_share_dialog",
    ]
    for _tool_name in _UI_PASSTHROUGH_TOOLS:
        _DIRECT_TOOL_HANDLERS[_tool_name] = _handle_ui_passthrough
    _DIRECT_TOOL_HANDLERS["bot_open_app"] = _handle_bot_open_app

    # --- OpenClaw bridge: fire-and-forget background task ---
    async def _handle_bot_openclaw_task(params: dict, tenant_id: str | None, user_id: str | None) -> dict:
        """Queue agent work through the canonical PearlOS task system.

        Voice, web chat, and Discord must share the same work path. The older
        voice bridge called OpenClaw directly, which bypassed pearl-worker and
        left Discord round trips/messages disconnected from the unified queue.
        """
        params = params or {}
        task = params.get("task", "").strip()
        urgency = params.get("urgency", "normal")
        if not task:
            return {"success": False, "error": "task_required", "user_message": "I need a task description."}
        if _tasks_create_direct is None:
            logger.error("[tools] bot_openclaw_task failed: task API is not mounted")
            return {
                "success": False,
                "error": "task_api_unavailable",
                "user_message": "I cannot reach the task queue right now.",
            }

        urgency_value = "urgent" if urgency == "high" else "normal"
        swarm_metadata = _voice_task_swarm_metadata(task, params)
        requester_email = params.get("_authenticated_user_email")
        if not requester_email and not (tenant_id or user_id):
            requester_email = params.get("user_email") or params.get("requester_email")
        requester_user_id = user_id or params.get("requester_user_id")
        requester_tenant_id = tenant_id or params.get("requester_tenant_id")
        discord_channel_id = str(params.get("discord_channel_id") or params.get("discordChannelId") or "").strip()
        discord_message_id = str(params.get("discord_message_id") or params.get("discordMessageId") or "").strip()
        discord_user_id = str(params.get("discord_user_id") or params.get("discordUserId") or "").strip()
        discord_username = str(params.get("discord_username") or params.get("discordUsername") or "").strip()
        discord_guild_id = str(params.get("discord_guild_id") or params.get("discordGuildId") or "").strip()
        discord_channel_name = str(params.get("discord_channel_name") or params.get("discordChannelName") or "").strip()
        task_source = "discord" if discord_channel_id else "voice"
        if swarm_metadata.get("kind") == "swarm":
            await reserve_tenant_budget_async(
                tenant_id=requester_tenant_id,
                surface="task_swarm",
                estimated_cents=estimate_cents("task_swarm", 100),
            )
        record = _tasks_create_direct(
            task=task,
            source=task_source,
            created_by="pearl",
            assignee="claude_cli",
            urgency=urgency_value,
            title=params.get("title"),
            kind=swarm_metadata.get("kind"),
            agents=swarm_metadata.get("agents"),
            swarm_category=swarm_metadata.get("swarm_category"),
            execution_mode=swarm_metadata.get("execution_mode"),
            requester_email=requester_email,
            requester_user_id=requester_user_id,
            requester_tenant_id=requester_tenant_id,
            discord_channel_id=discord_channel_id,
            discord_message_id=discord_message_id,
            discord_user_id=discord_user_id,
            discord_username=discord_username,
            discord_guild_id=discord_guild_id,
            discord_channel_name=discord_channel_name,
        )
        logger.info(
            f"[tools] Queued voice task {record.get('id')} via bot_openclaw_task "
            f"kind={record.get('kind')} agents={len(record.get('agents') or [])}"
        )
        return {
            "success": True,
            "task_id": record.get("id"),
            "task": record,
            "user_message": "The task is queued.",
        }

    _DIRECT_TOOL_HANDLERS["bot_openclaw_task"] = _handle_bot_openclaw_task


# Register on import
try:
    _register_direct_handlers()
except Exception as _reg_err:
    logger.warning(f"[tools] Failed to register direct tool handlers (will retry on first invoke): {_reg_err}")


# Persistent aiohttp session for Daily API broadcasts (avoids TCP reconnect per broadcast)
_daily_broadcast_session: aiohttp.ClientSession | None = None

async def _get_daily_broadcast_session() -> aiohttp.ClientSession:
    global _daily_broadcast_session
    if _daily_broadcast_session is None or _daily_broadcast_session.closed:
        _daily_broadcast_session = aiohttp.ClientSession()
    return _daily_broadcast_session


async def _broadcast_tool_event_best_effort(
    tool_name: str,
    params: dict,
    result: dict,
    room_url: str | None,
    direct_tool_voice_handled: bool = False,
):
    """Best-effort broadcast of tool result events via Daily + WebSocket.

    Called after direct tool execution so the UI stays in sync when a room IS active.
    Emits both a nia.tool_result AND the corresponding nia.event UI envelope so
    the frontend can react to tool outcomes without a Daily room.
    """
    import time as _time
    try:
        await _broadcast_tool_event_best_effort_inner(
            tool_name, params, result, room_url, direct_tool_voice_handled
        )
    except Exception as e:
        logger.error(f"[tools] _broadcast_tool_event_best_effort FAILED for {tool_name}: {e}", exc_info=True)


async def _broadcast_tool_event_best_effort_inner(
    tool_name: str,
    params: dict,
    result: dict,
    room_url: str | None,
    direct_tool_voice_handled: bool = False,
):
    # ┌──────────────────────────────────────────────────────────────────────┐
    # │ CRITICAL: DO NOT skip this broadcast based on Daily session state.  │
    # │                                                                     │
    # │ When tools are invoked via REST POST /api/tools/invoke (i.e. from   │
    # │ the OpenClaw gateway), this WebSocket broadcast is the ONLY way     │
    # │ the frontend receives the event. There is no in-process forwarder   │
    # │ in the REST path — the AppMessageForwarder (Daily app-message) only │
    # │ exists during in-process pipecat voice sessions.                    │
    # │                                                                     │
    # │ During voice sessions, tools run in-process via pipecat and use     │
    # │ params.forwarder.emit_tool_event() → Daily app-message. The REST    │
    # │ path + this broadcast are NOT involved in that flow.                │
    # │                                                                     │
    # │ The frontend event-dedup.ts ring buffer handles the (rare) case     │
    # │ where both paths deliver the same event.                            │
    # │                                                                     │
    # │ History: 2026-02-28 — A "fix" that skipped this broadcast when a    │
    # │ Daily session was active broke Wonder Canvas completely because     │
    # │ REST-invoked tools lost their only delivery path. Reverted in       │
    # │ commit 149a1eb6.                                                    │
    # └──────────────────────────────────────────────────────────────────────┘
    import time as _time

    _broadcast_ts = int(_time.time() * 1000)

    envelope = {
        "v": 1,
        "kind": "nia.tool_result",
        "seq": 0,
        "ts": _broadcast_ts,
        "tool_name": tool_name,
        "params": params,
        "result": result,
        "source": "rest-api",
    }
    if direct_tool_voice_handled:
        envelope["direct_tool_voice_handled"] = True

    # Derive room name for session scoping
    _room_name_for_scope = None
    if room_url:
        _room_name_for_scope = room_url.rstrip("/").split("/")[-1].split("?")[0] or None

    # WebSocket broadcast scoped to active room/session
    await ws_broadcast(envelope, session_id=_room_name_for_scope)

    # Also deliver via Daily app-message forwarder if a voice session is active.
    # WebSocket delivery through Next.js rewrites + RunPod proxy is unreliable;
    # the Daily app-message path is the primary reliable channel during voice.
    _forwarder = None
    if room_url:
        from room.state import get_forwarder as _get_fwd
        _forwarder = _get_fwd(room_url)

    # Emit proper nia.event UI envelopes for tools that have UI side-effects.
    # This mirrors what the in-process forwarder does during a Daily session.
    _TOOL_UI_EVENTS: dict[str, str] = {
        "bot_open_note": "note.open",
        "bot_create_note": "note.open",
        "bot_replace_note": "note.updated",
        "bot_add_note_content": "note.updated",
        "bot_remove_note_content": "note.updated",
        "bot_replace_note_content": "note.updated",
        "bot_delete_note": "note.deleted",
        "bot_save_note": "note.saved",
        "bot_list_notes": "notes.list",
        "bot_close_note": "note.close",
        "bot_search_youtube": "youtube.search",
        "bot_play_youtube": "youtube.play",
        "bot_pause_youtube": "youtube.pause",
        "bot_next_youtube": "youtube.next",
        "bot_open_app": "app.open",
        "bot_close_apps": "apps.close",
        "bot_open_browser": "browser.open",
        "bot_close_browser": "browser.close",
        "bot_minimize_window": "window.minimize",
        "bot_maximize_window": "window.maximize",
        "bot_restore_window": "window.restore",
        "bot_snap_left": "window.snap.left",
        "bot_snap_right": "window.snap.right",
        "bot_reset_window": "window.reset",
        "bot_switch_desktop_mode": "desktop.mode.switch",
        "bot_close_view": "view.close",
        "bot_notes_refresh": "notes.refresh",
        "bot_note_mode_switch": "note.mode.switch",
        "bot_note_download": "note.download",
        # App open/close tools → app.open with app name in payload
        "bot_open_notes": "app.open",
        "bot_open_files": "app.open",
        "bot_close_notes": "apps.close",
        "bot_open_youtube": "app.open",
        "bot_close_youtube": "apps.close",
        "bot_open_gmail": "app.open",
        "bot_close_gmail": "apps.close",
        "bot_open_terminal": "app.open",
        "bot_close_terminal": "apps.close",
        "bot_open_google_drive": "app.open",
        "bot_close_google_drive": "apps.close",
        "bot_open_creation_engine": "app.open",
        "bot_close_applet_creation_engine": "apps.close",
        "bot_open_enhanced_browser": "browser.open",
        "bot_close_browser_window": "browser.close",
        "bot_search_youtube_videos": "youtube.search",
        "bot_play_youtube_video": "youtube.play",
        "bot_pause_youtube_video": "youtube.pause",
        "bot_play_next_youtube_video": "youtube.next",
        "bot_snap_window_left": "window.snap.left",
        "bot_snap_window_right": "window.snap.right",
        "bot_reset_window_position": "window.reset",
        "bot_switch_note_mode": "note.mode.switch",
        # Standalone app windows
        "bot_open_news": "app.open",
        "bot_get_weather": "app.open",
        # Photo Magic — display through Pearl Views instead of deprecated Wonder Canvas
        "bot_photo_magic_generate": "pixel.canvas",
        # Pearl home visual surfaces
        "bot_pearl_visual_state": "pearl.visual.state",
        "bot_pixel_canvas": "pixel.canvas",
        # Deprecated Wonder Canvas tools are downgraded to Pearl Views events.
        "bot_wonder_canvas_scene": "pixel.canvas",
        "bot_wonder_canvas_add": "pixel.canvas",
        "bot_wonder_canvas_remove": "pixel.canvas",
        "bot_wonder_canvas_clear": "pixel.canvas.clear",
        "bot_wonder_canvas_animate": "pixel.canvas",
        "bot_wonder_canvas_template": "pixel.canvas",
        # Note control tools (scroll, highlight, navigate)
        "bot_scroll_note": "note.scroll",
        "bot_highlight_note": "note.highlight",
        "bot_highlight_note_text": "note.highlight",
        "bot_navigate_note_heading": "note.navigate.heading",
        "bot_clear_note_highlights": "note.highlight.clear",
        # OpenClaw Canvas tools — bot_canvas_show creates a note
        "bot_canvas_show": "note.open",
        "bot_canvas_show_file": "note.open",
        # Canvas content tools — avoid deprecated Wonder Canvas events
        "bot_canvas_show_chart": "pixel.canvas",
        "bot_canvas_show_article": "pixel.canvas",
        "bot_canvas_show_image": "pixel.canvas",
        "bot_canvas_show_table": "pixel.canvas",
        # Soundtrack tools
        "bot_play_soundtrack": "soundtrack.control",
        "bot_stop_soundtrack": "soundtrack.control",
        "bot_next_soundtrack_track": "soundtrack.control",
        "bot_adjust_soundtrack_volume": "soundtrack.control",
        "bot_set_soundtrack_volume": "soundtrack.control",
        # PearlOS interface customization
        "bot_customize_interface": "interface.customize",
        # Session control
        "bot_end_call": "bot.session.end",
    }

    # Map tool names to app names for app.open events
    _TOOL_APP_NAMES: dict[str, str] = {
        "bot_open_notes": "notes",
        "bot_open_files": "files",
        "bot_open_youtube": "youtube",
        "bot_open_gmail": "gmail",
        "bot_open_terminal": "terminal",
        "bot_open_google_drive": "google-drive",
        "bot_open_creation_engine": "creation-launchpad",
    }

    # Map close tools to their app names (for apps.close payload.apps array)
    _TOOL_CLOSE_APP_NAMES: dict[str, str] = {
        "bot_close_notes": "notes",
        "bot_close_youtube": "youtube",
        "bot_close_gmail": "gmail",
        "bot_close_terminal": "terminal",
        "bot_close_google_drive": "google-drive",
        "bot_close_applet_creation_engine": "creation-engine",
    }

    ui_event = _TOOL_UI_EVENTS.get(tool_name)
    if ui_event and isinstance(result, dict) and result.get("success"):
        # Build payload from params + result for the UI event
        ui_payload = dict(params) if params else {}
        if tool_name == "bot_pearl_visual_state":
            action = str(ui_payload.get("action") or ui_payload.get("mode") or "").strip().lower()
            ui_event = "pearl.visual.clear" if action == "clear" else "pearl.visual.state"
            if action != "clear":
                ui_payload.setdefault("seq", int(_time.time() * 1000))

        # Deprecated template calls are represented as Pearl Views video briefs.
        if tool_name == "bot_wonder_canvas_template" and ui_event == "pixel.canvas":
            ui_payload = {
                "render_mode": "generate_video",
                "title": (params or {}).get("title") or (params or {}).get("name") or "Canvas",
                "scene_hint": (params or {}).get("text") or (params or {}).get("name") or "Canvas updated.",
                "sounds": "soft interface ticks, gentle room tone",
                "use_avatar_image": True,
                "duration": 6,
                "fps": 24,
                "generate_audio": False,
                "camera_motion": "static",
            }

        # bot_open_news: open the standalone News app.
        if tool_name == "bot_open_news" and ui_event == "app.open":
            ui_payload = {
                "app": "news",
                "title": "News",
                "meta": {"category": result.get("category")},
            }

        # bot_get_weather: open the standalone Weather app with structured data.
        if tool_name == "bot_get_weather" and ui_event == "app.open":
            result.pop("_weather_html", None)
            result.pop("_weather_css", None)
            ui_payload = {
                "app": "weather",
                "title": "Weather",
                "meta": {
                    "location": result.get("location"),
                    "weather": dict(result),
                },
            }

        # bot_photo_magic_generate: show a Pearl Views brief instead of Wonder Canvas.
        if tool_name == "bot_photo_magic_generate" and ui_event == "pixel.canvas":
            _image_url = result.get("image_url") or result.get("imageUrl")
            if _image_url:
                _prompt = str((params or {}).get("prompt") or "").strip()
                ui_payload = {
                    "render_mode": "generate_video",
                    "title": "Generated Image",
                    "scene_hint": _prompt[:700] if _prompt else "Generated image ready.",
                    "url": str(_image_url),
                    "sounds": "soft room tone, subtle interface movement",
                    "use_avatar_image": False,
                    "duration": 6,
                    "fps": 24,
                    "generate_audio": False,
                    "camera_motion": "static",
                }
            else:
                logger.warning("[tools] bot_photo_magic_generate result missing image_url; skipping UI broadcast")
                ui_event = None

        # Legacy canvas content tools are represented as Pearl Views video briefs.
        if ui_event == "pixel.canvas" and tool_name in (
            "bot_canvas_show_chart", "bot_canvas_show_article",
            "bot_canvas_show_image", "bot_canvas_show_table",
        ):
            ui_payload = {
                "render_mode": "generate_video",
                "title": (params or {}).get("title") or (params or {}).get("headline") or "Canvas",
                "scene_hint": (params or {}).get("summary") or (params or {}).get("caption") or "Canvas content is ready.",
                "sounds": "soft interface ticks, gentle room tone",
                "use_avatar_image": True,
                "duration": 6,
                "fps": 24,
                "generate_audio": False,
                "camera_motion": "static",
                "timestamp": int(_time.time() * 1000),
            }

        if (
            ui_event == "pixel.canvas"
            and tool_name.startswith("bot_wonder_canvas_")
            and not ui_payload.get("render_mode")
        ):
            ui_payload = {
                "title": (params or {}).get("title") or (params or {}).get("name") or "Canvas",
                "text": (params or {}).get("text") or (params or {}).get("content") or (params or {}).get("name") or "Canvas updated.",
                "mood": (params or {}).get("mood") or "focused",
            }

        # Merge select result fields (note data, etc.)
        if "note" in result:
            note = result["note"]
            ui_payload.setdefault("noteId", note.get("_id") or note.get("id"))
            ui_payload.setdefault("title", note.get("title"))
            # For note.updated events, include content at top level for frontend animation
            if note.get("content") is not None:
                ui_payload.setdefault("content", note.get("content"))
            ui_payload["note"] = note  # pass full note object for immediate rendering
        if "notes" in result:
            ui_payload["notes"] = result["notes"]
        # Inject app name for open events
        open_app = _TOOL_APP_NAMES.get(tool_name)
        if open_app:
            ui_payload["app"] = open_app
        # Inject apps array for close events
        close_app = _TOOL_CLOSE_APP_NAMES.get(tool_name)
        if close_app:
            ui_payload["apps"] = [close_app]

        # Build soundtrack.control payload from tool name + params
        if ui_event == "soundtrack.control":
            _action_map = {
                "bot_play_soundtrack": "play",
                "bot_stop_soundtrack": "stop",
                "bot_next_soundtrack_track": "next",
                "bot_adjust_soundtrack_volume": "volume",
                "bot_set_soundtrack_volume": "volume",
            }
            _st_action = _action_map.get(tool_name, "play")
            ui_payload["action"] = _st_action
            if tool_name == "bot_play_soundtrack":
                ui_payload.setdefault("source", "voice_tool")
                ui_payload.setdefault("overridePreference", True)
            if _st_action == "volume":
                ui_payload.setdefault("volume", (params or {}).get("volume", 0.5))
            if tool_name == "bot_play_soundtrack":
                _genre = (params or {}).get("genre") or (params or {}).get("playlist")
                if _genre:
                    ui_payload["genre"] = _genre

        # snake_case → camelCase fixup for note control tools
        if tool_name == "bot_scroll_note" and isinstance(ui_payload, dict):
            if "search_text" in ui_payload:
                ui_payload["searchText"] = ui_payload.pop("search_text")

        ui_envelope = {
            "v": 1,
            "kind": "nia.event",
            "seq": 0,
            "ts": _broadcast_ts,
            "event": ui_event,
            "payload": ui_payload,
            "source": "gateway-broadcast",  # Anti-echo: prevents bot from re-forwarding
        }
        await ws_broadcast(ui_envelope, session_id=_room_name_for_scope)
        logger.info(f"[tools] Broadcast nia.event '{ui_event}' via WS (scope={_room_name_for_scope}, payload_keys={list(ui_payload.keys()) if isinstance(ui_payload, dict) else 'N/A'})")

        # Also emit via Daily app-message forwarder for reliable delivery
        # during voice sessions (WebSocket through proxy is unreliable).
        # SKIP for canvas tools that already emit via their own forwarder in-process —
        # re-emitting here causes double canvas renders visible to the user.
        _TOOLS_WITH_OWN_FORWARDER = {
            "bot_wonder_canvas_scene", "bot_wonder_canvas_template",
            "bot_wonder_canvas_add", "bot_wonder_canvas_remove",
            "bot_wonder_canvas_clear", "bot_wonder_canvas_animate",
            "bot_pixel_canvas",
            "bot_customize_interface",
        }
        if _forwarder and tool_name not in _TOOLS_WITH_OWN_FORWARDER:
            try:
                await _forwarder.emit_tool_event(ui_event, ui_payload, ts=_broadcast_ts)
                logger.info(f"[tools] Also emitted '{ui_event}' via Daily forwarder (reliable path)")
            except Exception as _fwd_err:
                logger.warning(f"[tools] Daily forwarder emit failed for '{ui_event}': {_fwd_err}")
        elif _forwarder and tool_name in _TOOLS_WITH_OWN_FORWARDER:
            logger.info(f"[tools] Skipped forwarder re-emit for '{tool_name}' (tool handles own emission)")

        # ── Secondary events: tools that emit multiple UI events ─────────
        # bot_close_browser_window / bot_close_view also need pixel.canvas.clear
        # when closing canvas-resident apps.
        # In the voice/Daily path, the tool code emits pixel.canvas.clear via
        # forwarder.emit_tool_event — but in the REST path, the forwarder
        # doesn't exist, so we must emit the secondary event here.
        _WONDER_CANVAS_APPS = {'wonder', 'canvas-content'}
        if tool_name in ("bot_close_browser_window", "bot_close_view"):
            _close_apps = (params or {}).get("apps", [])
            _needs_canvas_clear = (
                not _close_apps  # closing all → also clear canvas
                or any(
                    str(a).lower() in _WONDER_CANVAS_APPS
                    for a in (_close_apps if isinstance(_close_apps, list) else [])
                )
            )
            if _needs_canvas_clear:
                _clear_ts = int(_time.time() * 1000)
                _clear_envelope = {
                    "v": 1,
                    "kind": "nia.event",
                    "seq": 0,
                    "ts": _clear_ts,
                    "event": "pixel.canvas.clear",
                    "payload": {},
                    "source": "gateway-broadcast",
                }
                await ws_broadcast(_clear_envelope, session_id=_room_name_for_scope)
                if _forwarder:
                    try:
                        await _forwarder.emit_tool_event("pixel.canvas.clear", {}, ts=_clear_ts)
                    except Exception:
                        pass
                logger.info(f"[tools] Also broadcast pixel.canvas.clear for {tool_name}")

        # Also deliver ui_envelope via Daily REST API so voice-session frontends
        # receive the event even when the WS bridge is stopped (Daily call active).
        # Resolve room now (before the later room_url re-resolution) so we can
        # send both ui_envelope and tool_result in the same request block below.
        _ui_room_url = room_url
        if _ui_room_url:
            _ui_room_name = _ui_room_url.rstrip("/").split("/")[-1].split("?")[0]
            _ui_api_key = os.getenv("DAILY_API_KEY", "")
            if _ui_room_name and _ui_api_key:
                try:
                    import copy as _ui_copy
                    _daily_ui_envelope = _ui_copy.deepcopy(ui_envelope)

                    # ── Truncate large payloads to fit Daily's 4096-byte message limit ──
                    # The frontend can fetch full note content via its own API using noteId.
                    _daily_ui_str = json.dumps({"data": _daily_ui_envelope, "recipient": "*"})
                    if len(_daily_ui_str) > 3800:
                        _daily_ui_payload = _daily_ui_envelope.get("payload", {})
                        if isinstance(_daily_ui_payload, dict):
                            # Truncate top-level content field
                            if isinstance(_daily_ui_payload.get("content"), str) and len(_daily_ui_payload["content"]) > 200:
                                _daily_ui_payload["content"] = _daily_ui_payload["content"][:200] + "…"
                            # Truncate content inside embedded note object
                            _embedded_note = _daily_ui_payload.get("note")
                            if isinstance(_embedded_note, dict):
                                _nc = _embedded_note.get("content")
                                if isinstance(_nc, str) and len(_nc) > 200:
                                    _embedded_note["content"] = _nc[:200] + "…"
                                elif isinstance(_nc, dict):
                                    _embedded_note["content"] = ""
                            # NOTE: html/css fields are NOT truncated here.
                            # Weather cards and other rich UI can be ~5-10 KB which
                            # Daily app-messages handle fine.  Truncating to 200
                            # chars caused broken/partial renders when this REST
                            # delivery won the race against the WS path.
                        logger.debug(f"[tools] Truncated ui_envelope for Daily delivery: {len(_daily_ui_str)} -> {len(json.dumps({'data': _daily_ui_envelope, 'recipient': '*'}))} bytes")

                    _ui_url = f"https://api.daily.co/v1/rooms/{_ui_room_name}/send-app-message"
                    _ui_hdrs = {"Authorization": f"Bearer {_ui_api_key}", "Content-Type": "application/json"}
                    _ui_sess = await _get_daily_broadcast_session()
                    async with _ui_sess.post(
                            _ui_url,
                            json={"data": _daily_ui_envelope, "recipient": "*"},
                            headers=_ui_hdrs,
                            timeout=5,
                        ) as _ui_resp:
                            if _ui_resp.status >= 300 and _ui_resp.status != 404:
                                _ui_txt = await _ui_resp.text()
                                logger.debug(f"[tools] Daily ui_event error: {_ui_resp.status} {_ui_txt[:120]}")
                            else:
                                logger.info(f"[tools] Delivered nia.event '{ui_event}' via Daily to {_ui_room_name}")
                except Exception as _ui_e:
                    logger.debug(f"[tools] Daily ui_event delivery skipped: {_ui_e}")

    # Daily broadcast (best-effort, only with explicit room context)
    if not room_url:
        return

    room_name = room_url.rstrip("/").split("/")[-1].split("?")[0]
    api_key = os.getenv("DAILY_API_KEY", "")
    if not room_name or not api_key:
        return

    try:
        url = f"https://api.daily.co/v1/rooms/{room_name}/send-app-message"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        # Truncate large payloads to avoid Daily's 4096-byte limit
        import copy as _copy
        daily_envelope = _copy.deepcopy(envelope)
        _payload_str = json.dumps({"data": daily_envelope, "recipient": "*"})
        if len(_payload_str) > 3800:
            # Strip large fields (HTML, note content) that the frontend gets via WS anyway
            if "params" in daily_envelope and isinstance(daily_envelope["params"], dict):
                for _big_key in ("html", "content", "css"):
                    if _big_key in daily_envelope["params"] and len(str(daily_envelope["params"][_big_key])) > 500:
                        daily_envelope["params"][_big_key] = "[truncated — delivered via WebSocket]"
            if "result" in daily_envelope and isinstance(daily_envelope["result"], dict):
                if "note" in daily_envelope["result"] and isinstance(daily_envelope["result"]["note"], dict):
                    note = daily_envelope["result"]["note"]
                    if len(str(note.get("content", ""))) > 500:
                        note["content"] = note["content"][:500] + "..."

        _daily_sess = await _get_daily_broadcast_session()
        async with _daily_sess.post(url, json={"data": daily_envelope, "recipient": "*"}, headers=headers, timeout=10) as resp:
            if resp.status >= 300:
                txt = await resp.text()
                logger.warning(f"[tools] Daily broadcast error: {resp.status} {txt[:200]}")
    except Exception as e:
        logger.warning(f"[tools] Daily broadcast failed (non-fatal): {e}")


@app.post("/api/tools/invoke", dependencies=[Depends(require_strict_auth)])
async def invoke_tool(body: ToolInvokeRequest, request: Request):
    """Invoke a bot tool — directly via Mesh when possible, or via Daily room relay.

    **Direct execution** (no Daily room needed):
      If the tool has a registered direct handler AND tenant_id/user_id are provided
      (or derivable), the data operation runs synchronously via the Mesh API and
      the result is returned in the response body.  A best-effort UI broadcast is
      also sent to any active Daily room / WebSocket clients.

    **Room relay** (legacy path):
      If direct execution is not available, the invocation is forwarded to the
      bot process via Daily app-message for async execution in the pipeline.
    """
    import time as _time

    # ------------------------------------------------------------------
    # 1. Try direct execution (Mesh-backed, no Daily room required)
    # ------------------------------------------------------------------
    requested_tool_name = body.tool_name
    body.tool_name = _normalize_tool_name(body.tool_name)
    body.tool_name, body.params = _normalize_task_dispatch_tool(body.tool_name, body.params)
    body.tool_name, body.params = _normalize_pearl_open_tool(body.tool_name, body.params)
    if body.tool_name == "pearl_search":
        _action = str((body.params or {}).get("action") or "web").strip()
        _search_map = {
            "web": "bot_web_search",
            "fetch": "bot_web_fetch",
            "weather": "bot_get_weather",
        }
        body.tool_name = _search_map.get(_action, body.tool_name)
    if body.tool_name == "pearl_canvas":
        _action = str((body.params or {}).get("action") or "scene").strip()
        _canvas_map = {
            "fluid": "bot_pearl_visual_state",
            "state": "bot_pearl_visual_state",
            "visual_state": "bot_pearl_visual_state",
            "scene": "bot_pixel_canvas",
            "pixel": "bot_pixel_canvas",
            "video": "bot_pixel_canvas",
            "generate_video": "bot_pixel_canvas",
            "clear": "bot_pixel_canvas",
            "template": "bot_pixel_canvas",
            "animate": "bot_pixel_canvas",
            "add_layer": "bot_pixel_canvas",
            "avatar_hint": "bot_pixel_canvas",
        }
        body.tool_name = _canvas_map.get(_action, body.tool_name)
        if body.tool_name == "bot_pearl_visual_state":
            body.params = {
                **body.params,
                "action": "state",
                "mode": body.params.get("mode") or "explain",
                "title": body.params.get("title") or body.params.get("topic") or body.params.get("focus") or "Pearl",
            }
        if body.tool_name == "bot_pixel_canvas" and "text" not in body.params and "content" in body.params:
            body.params = {**body.params, "text": body.params.get("content")}
        if body.tool_name == "bot_pixel_canvas" and _action == "video":
            body.params = {**body.params, "render_mode": "video"}
        elif body.tool_name == "bot_pixel_canvas" and _action == "generate_video":
            body.params = {
                **body.params,
                "render_mode": "generate_video",
                "use_avatar_image": body.params.get("use_avatar_image", True),
                "duration": body.params.get("duration", 6),
                "fps": body.params.get("fps", 24),
                "generate_audio": body.params.get("generate_audio", False),
            }
        elif body.tool_name == "bot_pixel_canvas" and _action == "clear":
            body.params = {**body.params, "render_mode": "clear"}
        elif body.tool_name == "bot_pixel_canvas" and _action in {"template", "animate", "add_layer", "avatar_hint"}:
            body.params = {
                **body.params,
                "render_mode": "text",
                "text": body.params.get("text")
                or body.params.get("content")
                or body.params.get("title")
                or body.params.get("name")
                or "Pearl visual",
            }
    if requested_tool_name != body.tool_name:
        logger.info(f"[tools] Normalized tool name {requested_tool_name!r} -> {body.tool_name!r}")

    direct_handler = _DIRECT_TOOL_HANDLERS.get(body.tool_name)

    # Lazy-retry registration if first attempt failed at import time
    if not _DIRECT_TOOL_HANDLERS and direct_handler is None:
        try:
            _register_direct_handlers()
            direct_handler = _DIRECT_TOOL_HANDLERS.get(body.tool_name)
        except Exception:
            pass

    if direct_handler:
        request_headers = request.headers
        signed_claims = _signed_claims_for_request(request, required=False)
        if signed_claims:
            body.tenant_id = (signed_claims.get("tenantId") or "").strip()
            body.user_id = (signed_claims.get("sessionUserId") or "").strip()
            body.user_email = (signed_claims.get("sessionUserEmail") or "").strip()
        elif (not AUTH_REQUIRED) or os.getenv("PEARLOS_ALLOW_RAW_TOOL_SCOPE", "").strip() == "1":
            header_tenant_id = (
                request_headers.get("x-pearl-tenant-id")
                or request_headers.get("x-tenant-id")
                or ""
            ).strip()
            header_user_id = (request_headers.get("x-user-id") or "").strip()
            header_user_email = (request_headers.get("x-user-email") or "").strip()
            if not body.tenant_id and header_tenant_id:
                body.tenant_id = header_tenant_id
            if not body.user_id and header_user_id:
                body.user_id = header_user_id
            if not body.user_email and header_user_email:
                body.user_email = header_user_email

        # Resolve tenant_id and user_id — from body, headers, session env, then
        # default only for identity-less internal/UI calls.
        tenant_id = body.tenant_id
        user_id = body.user_id
        user_email = body.user_email
        if body.tool_name == "bot_openclaw_task" and (user_id or user_email) and not tenant_id:
            raise HTTPException(status_code=400, detail="tenant_id_required_for_task_dispatch")
        tenant_id = tenant_id or os.getenv("DEFAULT_TENANT_ID")
        if body.user_email:
            body.params = {
                **(body.params or {}),
                "user_email": body.user_email,
                "_authenticated_user_email": body.user_email,
            }
        elif user_email:
            body.params = {
                **(body.params or {}),
                "user_email": user_email,
                "_authenticated_user_email": user_email,
            }
        if tenant_id:
            body.params = {**(body.params or {}), "requester_tenant_id": tenant_id}
        if user_id:
            body.params = {**(body.params or {}), "requester_user_id": user_id}
        discord_ctx = _discord_request_context(request)
        if any(discord_ctx.values()):
            body.params = {
                **(body.params or {}),
                **{key: value for key, value in discord_ctx.items() if value},
            }

        # Pure UI tools (Wonder Canvas, etc.) don't need tenant/user context
        _UI_ONLY_TOOLS = {
            "bot_pearl_visual_state",
            "bot_pixel_canvas",
            "bot_wonder_canvas_scene", "bot_wonder_canvas_add",
            "bot_wonder_canvas_remove", "bot_wonder_canvas_clear",
            "bot_wonder_canvas_animate", "bot_wonder_canvas_template",
            "bot_end_call", "bot_open_news", "bot_get_weather",
            "bot_web_search", "bot_web_fetch", "pearl_search", "pearl_canvas",
            # Canvas content tools (pure UI — no Mesh needed)
            "bot_canvas_show_chart", "bot_canvas_show_article",
            "bot_canvas_show_image", "bot_canvas_show_table",
            # UI passthrough tools (open/close apps, window mgmt, YouTube, soundtrack)
            "bot_open_notes", "bot_close_notes",
            "bot_open_app",
            "bot_open_files",
            "bot_open_youtube", "bot_close_youtube",
            "bot_open_gmail", "bot_close_gmail",
            "bot_open_terminal", "bot_close_terminal",
            "bot_open_google_drive", "bot_close_google_drive",
            "bot_open_creation_engine", "bot_close_applet_creation_engine",
            "bot_open_browser", "bot_open_enhanced_browser",
            "bot_close_browser_window", "bot_close_view",
            "bot_minimize_window", "bot_maximize_window",
            "bot_restore_window", "bot_snap_window_left",
            "bot_snap_window_right", "bot_reset_window_position",
            "bot_switch_desktop_mode",
            "bot_search_youtube_videos", "bot_play_youtube_video",
            "bot_pause_youtube_video", "bot_play_next_youtube_video",
            "bot_play_soundtrack", "bot_stop_soundtrack",
            "bot_next_soundtrack_track", "bot_adjust_soundtrack_volume",
            "bot_set_soundtrack_volume",
            "bot_switch_note_mode", "bot_show_share_dialog",
            "bot_scroll_note", "bot_highlight_note", "bot_highlight_note_text",
            "bot_navigate_note_heading", "bot_clear_note_highlights",
            "bot_read_current_note",
            # OpenClaw task bridge. User-scoped dispatch requires tenant context.
            "bot_openclaw_task",
        }
        _skip_canvas, _skip_canvas_reason = _should_skip_gateway_canvas_call(
            body.tool_name,
            body.params,
            body.room_url,
        )
        if _skip_canvas:
            logger.warning(
                f"[tools] Canvas policy skipped {body.tool_name}: {_skip_canvas_reason}"
            )
            return {
                "ok": True,
                "tool_name": body.tool_name,
                "execution": "canvas_policy_skipped",
                "result": {
                    "success": True,
                    "skipped": True,
                    "reason": _skip_canvas_reason,
                    "user_message": "Wonder Canvas already has a relevant visual.",
                },
            }

        # Deduplication: prevent the same canvas tool from firing twice within 10s
        _CANVAS_DEDUP_TOOLS = {"bot_wonder_canvas_scene", "bot_wonder_canvas_template"}
        if body.tool_name in _CANVAS_DEDUP_TOOLS:
            _now = _time.monotonic()
            import hashlib as _hashlib
            _content_hash = _hashlib.md5(str(body.params).encode()).hexdigest()[:8]
            _dedup_key = f"{body.tool_name}:{body.room_url or 'default'}:{_content_hash}"
            _last_call = getattr(invoke_tool, '_dedup_cache', {}).get(_dedup_key, 0)
            if _now - _last_call < 0.5:  # was 2.0 — too aggressive for interactive stories
                logger.warning(f"[tools] DEDUP: Skipping duplicate {body.tool_name} call ({_now - _last_call:.1f}s since last)")
                return {
                    "ok": True,
                    "tool_name": body.tool_name,
                    "execution": "dedup_skipped",
                    "result": {"success": True, "user_message": "Wonder Canvas already updated (dedup)."},
                }
            if not hasattr(invoke_tool, '_dedup_cache'):
                invoke_tool._dedup_cache = {}
            invoke_tool._dedup_cache[_dedup_key] = _now
            # Prevent unbounded growth: evict entries older than 30s
            if len(invoke_tool._dedup_cache) > 100:
                invoke_tool._dedup_cache = {
                    k: v for k, v in invoke_tool._dedup_cache.items()
                    if _now - v < 30.0
                }

        is_ui_only_tool = body.tool_name in _UI_ONLY_TOOLS
        if AUTH_REQUIRED and not signed_claims and not is_ui_only_tool:
            raise HTTPException(status_code=401, detail="signed_bot_claims_required")

        if (tenant_id and user_id) or is_ui_only_tool:
            logger.info(f"[tools] Direct-executing {body.tool_name} (tenant={tenant_id}, user={user_id})")
            try:
                result = await direct_handler(body.params, tenant_id, user_id)
                # Best-effort UI broadcast
                asyncio.ensure_future(
                    _broadcast_tool_event_best_effort(
                        body.tool_name,
                        body.params,
                        result,
                        body.room_url,
                        body.direct_tool_voice_handled,
                    )
                )
                return {
                    "ok": True,
                    "tool_name": body.tool_name,
                    "execution": "direct",
                    "result": result,
                }
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"[tools] Direct execution of {body.tool_name} failed: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Direct tool execution failed: {e}")
        else:
            logger.info(
                f"[tools] Direct handler exists for {body.tool_name} but missing context "
                f"(tenant_id={tenant_id}, user_id={user_id}); falling back to room relay"
            )

    # ------------------------------------------------------------------
    # 2. Fallback: relay to bot process via Daily app-message
    # ------------------------------------------------------------------

    # Resolve tool metadata
    try:
        from tools.discovery import get_discovery
        discovery = get_discovery()
        tools = discovery.discover_tools()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tool discovery failed: {e}")

    if body.tool_name not in tools:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown tool: {body.tool_name}. Use GET /api/tools/list to see available tools.",
        )

    # Build a tool-invoke envelope that the bot process listens for
    envelope = {
        "v": 1,
        "kind": "nia.tool_invoke",
        "seq": 0,
        "ts": int(_time.time() * 1000),
        "tool_name": body.tool_name,
        "params": body.params,
        "source": "gateway_relay",
    }

    # Resolve room name for session scoping
    _relay_room_name = None
    _relay_room_url = body.room_url
    if _relay_room_url:
        _relay_room_name = _relay_room_url.rstrip("/").split("/")[-1].split("?")[0] or None
    # Broadcast to WebSocket clients scoped to active session
    await ws_broadcast(envelope, session_id=_relay_room_name)

    # For passthrough/UI tools, also emit a nia.event envelope so the
    # frontend can act on it even without a Daily room.  The _TOOL_UI_EVENTS
    # and _TOOL_APP_NAMES maps live in _broadcast_tool_event_best_effort but
    # we duplicate the lookup here for the relay path.
    _PASSTHROUGH_UI_EVENTS: dict[str, str] = {
        "bot_open_notes": "app.open",
        "bot_open_app": "app.open",
        "bot_open_files": "app.open",
        "bot_close_notes": "apps.close",
        "bot_open_youtube": "app.open",
        "bot_close_youtube": "apps.close",
        "bot_open_gmail": "app.open",
        "bot_close_gmail": "apps.close",
        "bot_open_terminal": "app.open",
        "bot_close_terminal": "apps.close",
        "bot_open_google_drive": "app.open",
        "bot_close_google_drive": "apps.close",
        "bot_open_creation_engine": "app.open",
        "bot_close_applet_creation_engine": "apps.close",
        "bot_open_browser": "browser.open",
        "bot_open_enhanced_browser": "browser.open",
        "bot_close_browser_window": "browser.close",
        "bot_close_view": "view.close",
        "bot_minimize_window": "window.minimize",
        "bot_maximize_window": "window.maximize",
        "bot_restore_window": "window.restore",
        "bot_snap_window_left": "window.snap.left",
        "bot_snap_window_right": "window.snap.right",
        "bot_reset_window_position": "window.reset",
        "bot_switch_desktop_mode": "desktop.mode.switch",
        "bot_search_youtube_videos": "youtube.search",
        "bot_play_youtube_video": "youtube.play",
        "bot_pause_youtube_video": "youtube.pause",
        "bot_play_next_youtube_video": "youtube.next",
        "bot_play_soundtrack": "soundtrack.control",
        "bot_stop_soundtrack": "soundtrack.control",
        "bot_next_soundtrack_track": "soundtrack.control",
        "bot_adjust_soundtrack_volume": "soundtrack.control",
        "bot_set_soundtrack_volume": "soundtrack.control",
        "bot_customize_interface": "interface.customize",
        "bot_switch_note_mode": "note.mode.switch",
        "bot_show_share_dialog": "share.show",
        # Standalone app windows
        "bot_open_news": "app.open",
        "bot_get_weather": "app.open",
        # Pearl home visual surfaces and deprecated Wonder Canvas aliases
        "bot_pearl_visual_state": "pearl.visual.state",
        "bot_pixel_canvas": "pixel.canvas",
        "bot_wonder_canvas_scene": "pixel.canvas",
        "bot_wonder_canvas_add": "pixel.canvas",
        "bot_wonder_canvas_remove": "pixel.canvas",
        "bot_wonder_canvas_clear": "pixel.canvas.clear",
        "bot_wonder_canvas_animate": "pixel.canvas",
        "bot_wonder_canvas_template": "pixel.canvas",
        # Note control tools (scroll, highlight, navigate)
        "bot_scroll_note": "note.scroll",
        "bot_highlight_note": "note.highlight",
        "bot_highlight_note_text": "note.highlight",
        "bot_navigate_note_heading": "note.navigate.heading",
        "bot_clear_note_highlights": "note.highlight.clear",
        # OpenClaw Canvas tools
        "bot_canvas_show": "note.open",
        "bot_canvas_show_file": "note.open",
        "bot_canvas_show_chart": "pixel.canvas",
        "bot_canvas_show_article": "pixel.canvas",
        "bot_canvas_show_image": "pixel.canvas",
        "bot_canvas_show_table": "pixel.canvas",
        # Session control — emit bot.session.end so frontend teardown triggers
        "bot_end_call": "bot.session.end",
    }
    _PASSTHROUGH_APP_NAMES: dict[str, str] = {
        "bot_open_notes": "notes",
        "bot_open_files": "files",
        "bot_open_youtube": "youtube",
        "bot_open_gmail": "gmail",
        "bot_open_terminal": "terminal",
        "bot_open_google_drive": "google-drive",
        "bot_open_creation_engine": "creation-launchpad",
    }

    # Map close tools to their app names (for apps.close payload.apps array)
    _PASSTHROUGH_CLOSE_APP_NAMES: dict[str, str] = {
        "bot_close_notes": "notes",
        "bot_close_youtube": "youtube",
        "bot_close_gmail": "gmail",
        "bot_close_terminal": "terminal",
        "bot_close_google_drive": "google-drive",
        "bot_close_applet_creation_engine": "creation-engine",
    }

    # Map soundtrack tools to their control actions
    _SOUNDTRACK_ACTIONS: dict[str, dict] = {
        "bot_play_soundtrack": {"action": "play", "source": "voice_tool", "overridePreference": True},
        "bot_stop_soundtrack": {"action": "stop"},
        "bot_next_soundtrack_track": {"action": "next"},
        "bot_adjust_soundtrack_volume": {"action": "adjustVolume"},
        "bot_set_soundtrack_volume": {"action": "volume"},
    }

    pt_event = _PASSTHROUGH_UI_EVENTS.get(body.tool_name)
    if pt_event:
        pt_payload = dict(body.params) if body.params else {}
        if body.tool_name == "bot_pearl_visual_state":
            action = str(pt_payload.get("action") or pt_payload.get("mode") or "").strip().lower()
            pt_event = "pearl.visual.clear" if action == "clear" else "pearl.visual.state"
            if action != "clear":
                pt_payload.setdefault("seq", int(_time.time() * 1000))
        # Inject app name for app.open events
        app_name = _PASSTHROUGH_APP_NAMES.get(body.tool_name)
        if app_name:
            pt_payload["app"] = app_name
        # Inject apps array for apps.close events
        close_app_name = _PASSTHROUGH_CLOSE_APP_NAMES.get(body.tool_name)
        if close_app_name:
            pt_payload["apps"] = [close_app_name]
        # Inject soundtrack control action
        soundtrack_action = _SOUNDTRACK_ACTIONS.get(body.tool_name)
        if soundtrack_action:
            pt_payload.update(soundtrack_action)
        if pt_event == "pixel.canvas" and body.tool_name in {
            "bot_canvas_show_chart",
            "bot_canvas_show_article",
            "bot_canvas_show_image",
            "bot_canvas_show_table",
        }:
            pt_payload = {
                "title": (body.params or {}).get("title") or (body.params or {}).get("headline") or "Canvas",
                "text": (body.params or {}).get("summary") or (body.params or {}).get("caption") or "Canvas content is ready.",
                "mood": "focused",
            }
        if pt_event == "pixel.canvas" and body.tool_name.startswith("bot_wonder_canvas_"):
            pt_payload = {
                "title": (body.params or {}).get("title") or (body.params or {}).get("name") or "Canvas",
                "text": (body.params or {}).get("text") or (body.params or {}).get("content") or (body.params or {}).get("name") or "Canvas updated.",
                "mood": (body.params or {}).get("mood") or "focused",
            }
        # snake_case → camelCase for note scroll
        if body.tool_name == "bot_scroll_note" and "search_text" in pt_payload:
            pt_payload["searchText"] = pt_payload.pop("search_text")
        ui_envelope = {
            "v": 1,
            "kind": "nia.event",
            "seq": 0,
            "ts": int(_time.time() * 1000),
            "event": pt_event,
            "payload": pt_payload,
        }
        await ws_broadcast(ui_envelope, session_id=_relay_room_name)
        logger.info(f"[tools] Emitted nia.event '{pt_event}' via WebSocket for {body.tool_name}")

        # ── Secondary events: close tools need pixel.canvas.clear for canvas apps ──
        _WONDER_CANVAS_APPS_RELAY = {'wonder', 'canvas-content'}
        if body.tool_name in ("bot_close_browser_window", "bot_close_view"):
            _close_apps_relay = (body.params or {}).get("apps", [])
            _needs_clear_relay = (
                not _close_apps_relay
                or any(
                    str(a).lower() in _WONDER_CANVAS_APPS_RELAY
                    for a in (_close_apps_relay if isinstance(_close_apps_relay, list) else [])
                )
            )
            if _needs_clear_relay:
                _clear_env = {
                    "v": 1,
                    "kind": "nia.event",
                    "seq": 0,
                    "ts": int(_time.time() * 1000),
                    "event": "pixel.canvas.clear",
                    "payload": {},
                }
                await ws_broadcast(_clear_env, session_id=_relay_room_name)
                logger.info(f"[tools] Also broadcast pixel.canvas.clear for relay {body.tool_name}")

    # Resolve target room (optional — Daily delivery is best-effort)
    room_url = body.room_url
    if not room_url:
        logger.info(f"[tools] No active room; delivered {body.tool_name} invoke via WebSocket only")
        return {
            "ok": True,
            "tool_name": body.tool_name,
            "delivery": "websocket-only",
            "note": "Tool invocation sent via WebSocket. No active Daily room.",
        }

    # Derive room name from URL
    room_name = room_url.rstrip("/").split("/")[-1].split("?")[0]
    if not room_name:
        return {
            "ok": True,
            "tool_name": body.tool_name,
            "delivery": "websocket-only",
            "note": "Could not derive room name; sent via WebSocket only.",
        }

    api_key = os.getenv("DAILY_API_KEY", "")
    if not api_key:
        return {
            "ok": True,
            "tool_name": body.tool_name,
            "delivery": "websocket-only",
            "note": "DAILY_API_KEY not configured; sent via WebSocket only.",
        }

    # Also send via Daily REST API app-message to the room
    url = f"https://api.daily.co/v1/rooms/{room_name}/send-app-message"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json={"data": envelope, "recipient": "*"},
                headers=headers,
                timeout=10,
            ) as resp:
                if resp.status >= 300:
                    txt = await resp.text()
                    # 404 = room not hosting a call; WebSocket already delivered, not worth warning
                    if resp.status == 404:
                        logger.debug(f"[tools] Daily room {room_name} not active (WebSocket delivered): {txt[:120]}")
                    else:
                        logger.warning(f"[tools] Daily API error: {resp.status} {txt[:200]}")
                logger.info(
                    f"[tools] Invoked {body.tool_name} in room {room_name} (Daily + WebSocket)"
                )
                return {
                    "ok": True,
                    "tool_name": body.tool_name,
                    "room": room_name,
                    "delivery": "daily+websocket",
                    "note": "Tool execution is async. Results will appear in the voice session.",
                }
    except Exception as e:
        logger.warning(f"[tools] Daily delivery failed (WebSocket still sent): {e}")
        return {
            "ok": True,
            "tool_name": body.tool_name,
            "delivery": "websocket-only",
            "daily_error": str(e),
        }


@app.get("/default-room")
async def get_default_room():
    """Return the persistent default room URL and connection info.

    The frontend can call this on load to connect to the always-on room
    instead of creating a new one.
    """
    if not _default_room_url:
        raise HTTPException(status_code=503, detail="Default room not yet initialized")

    # Generate a fresh participant token for the caller
    try:
        from providers.daily import create_daily_room_token
        token = await create_daily_room_token(_default_room_url)
    except Exception as e:
        logger.warning(f"[default-room] Could not generate token: {e}")
        token = None

    room_info: Dict[str, Any] = {
        "room_url": _default_room_url,
        "room_name": DEFAULT_ROOM_NAME,
    }
    if token:
        room_info["token"] = token

    # Include bot session info if available
    async with active_rooms_lock:
        state = active_rooms.get(_default_room_url)
        if state:
            room_info["bot_session_id"] = state.get("session_id")
            room_info["bot_status"] = state.get("status")

    return room_info


# ---------------------------------------------------------------------------
# REST tool execution — direct data operations without Daily room requirement
# ---------------------------------------------------------------------------

class DirectToolRequest(BaseModel):
    """Execute a tool directly against the data layer (Mesh API).

    Unlike /api/tools/invoke which relays via Daily app-message, this endpoint
    executes data operations synchronously and returns results.  UI broadcast
    events are sent opportunistically when a Daily room / WS clients exist.
    """
    tool_name: str
    params: Dict[str, Any] = {}
    # Context for data operations (required for most tools)
    tenant_id: str | None = None
    user_id: str | None = None
    room_url: str | None = None  # optional; used for active-note state & broadcast


# Default tenant/user from env for local dev convenience
_DEFAULT_TENANT = os.getenv("PEARLOS_TENANT_ID", "00000000-0000-0000-0000-000000000001")
_DEFAULT_USER = os.getenv("BOT_SESSION_USER_ID", "00000000-0000-0000-0000-000000000099")


async def _broadcast_note_event(action: str, note_id: str, note: dict | None = None, mode: str | None = None):
    """Best-effort broadcast of note events to WS + Daily."""
    import time as _time
    payload = {
        "v": 1,
        "kind": "nia.event",
        "seq": 0,
        "event": "notes.refresh",
        "ts": int(_time.time() * 1000),
        "payload": {
            "noteId": note_id,
            "action": action,
            "mode": mode,
        },
    }
    if note:
        payload["payload"]["note"] = {
            "_id": note.get("_id") or note.get("page_id"),
            "title": note.get("title"),
            "content": note.get("content") if isinstance(note.get("content"), str) else (note.get("content", {}).get("content", "") if isinstance(note.get("content"), dict) else ""),
            "mode": note.get("mode"),
        }
    # Resolve room for scoping
    _refresh_room_name = None
    _refresh_room_url = None
    async with active_rooms_lock:
        for _url, _info in active_rooms.items():
            if _info.get("status") == "running":
                _refresh_room_url = _url
                _refresh_room_name = _url.rstrip("/").split("/")[-1].split("?")[0] or None
                break
    # WebSocket broadcast scoped to active session
    await ws_broadcast(payload, session_id=_refresh_room_name)
    # Daily broadcast (best-effort)
    try:
        api_key = os.getenv("DAILY_API_KEY", "")
        if api_key:
            room_url = _refresh_room_url
            if room_url:
                room_name = _refresh_room_name
                if room_name:
                    url = f"https://api.daily.co/v1/rooms/{room_name}/send-app-message"
                    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                    async with aiohttp.ClientSession() as session:
                        async with session.post(url, json={"data": payload, "recipient": "*"}, headers=headers, timeout=5) as resp:
                            if resp.status >= 300:
                                logger.debug(f"[rest-tools] Daily broadcast returned {resp.status}")
    except Exception as e:
        logger.debug(f"[rest-tools] Daily broadcast skipped: {e}")


@app.post("/api/tools/execute", dependencies=[Depends(require_strict_auth)])
async def execute_tool(body: DirectToolRequest, request: Request):
    """Execute a tool directly against the Mesh data layer.

    Returns the tool result synchronously.  No Daily room required.
    UI events are broadcast opportunistically to connected WS/Daily clients.
    """
    signed_claims = _signed_claims_for_request(request, required=AUTH_REQUIRED)
    tenant_id = (signed_claims.get("tenantId") or body.tenant_id or "").strip()
    user_id = (signed_claims.get("sessionUserId") or body.user_id or "").strip()
    if not user_id or str(user_id).lower() == "anonymous":
        raise HTTPException(status_code=401, detail="authenticated user_id is required")
    if not tenant_id or str(tenant_id).lower() == "public":
        raise HTTPException(status_code=401, detail="authenticated tenant_id is required")
    tool = body.tool_name
    p = body.params
    state_key = _note_state_key(tenant_id, user_id)
    state = _note_states.get(state_key, {}) if state_key else {}

    try:
        from actions import notes_actions

        # ---- Notes CRUD ----
        if tool == "bot_create_note":
            note = await notes_actions.create_note(
                tenant_id=tenant_id,
                user_id=user_id,
                title=p.get("title", "Untitled"),
                content=p.get("content", ""),
                mode=p.get("mode", "personal"),
            )
            if not note:
                raise HTTPException(status_code=500, detail="Failed to create note")
            note_id = note.get("_id") or note.get("page_id")
            await _broadcast_note_event("create", note_id, note, note.get("mode"))
            return {"ok": True, "tool_name": tool, "result": {"success": True, "note": note}}

        elif tool == "bot_replace_note":
            note_id = p.get("note_id")
            if not note_id:
                raise HTTPException(status_code=400, detail="note_id is required for direct execution")
            success = await notes_actions.update_note_content(
                tenant_id=tenant_id,
                note_id=note_id,
                content=p.get("content", ""),
                user_id=user_id,
                title=p.get("title"),
            )
            if not success:
                raise HTTPException(status_code=500, detail="Failed to update note")
            updated = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
            await _broadcast_note_event("update", note_id, updated, (updated or {}).get("mode"))
            return {"ok": True, "tool_name": tool, "result": {"success": True, "note": updated}}

        elif tool == "bot_read_current_note":
            note_id = p.get("note_id") or state.get("noteId")
            if not note_id:
                raise HTTPException(status_code=400, detail="note_id is required for direct execution")
            note = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
            if not note:
                raise HTTPException(status_code=404, detail="Note not found")
            return {"ok": True, "tool_name": tool, "result": {"success": True, "note": note}}

        elif tool == "bot_delete_note":
            note_id = p.get("note_id")
            if not note_id:
                raise HTTPException(status_code=400, detail="note_id is required for direct execution")
            deleted = await notes_actions.delete_note(tenant_id, note_id, user_id)
            if not deleted:
                raise HTTPException(status_code=500, detail="Failed to delete note")
            await _broadcast_note_event("delete", note_id)
            return {"ok": True, "tool_name": tool, "result": {"success": True}}

        elif tool == "bot_list_notes":
            notes = await notes_actions.list_notes(
                tenant_id=tenant_id,
                user_id=user_id,
                limit=p.get("limit", 100),
                include_content=p.get("include_content", False),
            )
            return {"ok": True, "tool_name": tool, "result": {"success": True, "notes": notes}}

        elif tool == "bot_add_note_content":
            content = p.get("content", "")
            position = p.get("position", "end")
            note_id = p.get("note_id") or state.get("noteId")
            if not note_id:
                raise HTTPException(status_code=400, detail="No note currently open. Create or open a note first")
            if not content:
                raise HTTPException(status_code=400, detail="content is required")
            note = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
            if not note:
                raise HTTPException(status_code=404, detail=f"Note {note_id} not found")
            existing = note.get("content", "") or ""
            if position == "start":
                new_content = content + "\n\n" + existing if existing else content
            else:
                new_content = existing + "\n\n" + content if existing else content
            success = await notes_actions.update_note_content(
                tenant_id=tenant_id,
                note_id=note_id,
                content=new_content,
                user_id=user_id,
            )
            if not success:
                raise HTTPException(status_code=500, detail="Failed to add content to note")
            updated = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)
            if state_key:
                _note_states[state_key] = {
                    "noteId": note_id,
                    "title": (updated or note).get("title"),
                    "content": new_content,
                    "viewState": "document",
                    "action": "updated",
                    "tenantId": tenant_id,
                    "userId": user_id,
                    "updatedAt": time.time(),
                }
            await _broadcast_note_event("update", note_id, updated, (updated or {}).get("mode"))
            return {"ok": True, "tool_name": tool, "result": {"success": True, "note": updated}}

        elif tool == "bot_search_notes":
            title = p.get("title") or p.get("query", "")
            if not title:
                raise HTTPException(status_code=400, detail="title/query is required")
            notes = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
            return {"ok": True, "tool_name": tool, "result": {"success": True, "notes": notes or []}}

        else:
            # Fall back to the relay-based invoke for non-data tools
            raise HTTPException(
                status_code=404,
                detail=f"Tool '{tool}' not supported for direct execution. Use /api/tools/invoke for relay-based execution.",
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[rest-tools] Error executing {tool}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/active-rooms")
async def get_active_rooms():
    """Return currently tracked active rooms."""
    async with active_rooms_lock:
        return {"rooms": {url: {"status": info.get("status"), "session_id": info.get("session_id")} for url, info in active_rooms.items()}}


def _safe_public_path_segment(value: str | None, fallback: str = "unknown") -> str:
    raw = str(value or "").strip().lower()
    safe = re.sub(r"[^a-z0-9._@+-]+", "_", raw).strip("._-")
    return (safe or fallback)[:160]


def _effective_upload_content_type(filename: str | None, raw_content_type: str | None, head: bytes = b"") -> str:
    import mimetypes
    name = str(filename or "")
    lower_name = name.lower()
    lower_type = str(raw_content_type or "").lower()
    guessed = mimetypes.guess_type(name)[0] or ""
    if lower_name.endswith(".pdf") or head.startswith(b"%PDF-"):
        return "application/pdf"
    if lower_name.endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if lower_name.endswith(".pptx"):
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    if lower_name.endswith(".xlsx"):
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if lower_name.endswith(".odt"):
        return "application/vnd.oasis.opendocument.text"
    if lower_name.endswith(".ods"):
        return "application/vnd.oasis.opendocument.spreadsheet"
    if lower_type.startswith("image/") and guessed and not guessed.startswith("image/"):
        return guessed
    return raw_content_type or guessed or "application/octet-stream"


@app.post("/api/upload", dependencies=[Depends(require_strict_auth)])
async def upload_file(request: Request, file: UploadFile = File(...)):
    """Upload a file into a tenant/user scoped public upload folder."""
    public_root = os.getenv("PEARL_PUBLIC_UPLOAD_ROOT", "/srv/pearl-user-workspaces/uploads")
    claims = _signed_claims_for_request(request, required=AUTH_REQUIRED)
    tenant_id = _safe_public_path_segment(claims.get("tenantId"), "public")
    user_id = _safe_public_path_segment(claims.get("sessionUserId"), "anonymous")
    if tenant_id == "public" or user_id == "anonymous":
        raise HTTPException(status_code=401, detail="authenticated upload scope required")

    safe_name = f"{uuid.uuid4().hex[:8]}_{os.path.basename(file.filename or 'file')}"
    payload = await file.read()
    content_type = _effective_upload_content_type(file.filename, file.content_type, payload[:16])
    is_image = content_type.startswith("image/")

    date_dir = time.strftime("%Y-%m-%d", time.gmtime())
    dest_dir = os.path.join(public_root, tenant_id, user_id, date_dir)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, safe_name)
    relative_key = "/".join([tenant_id, user_id, date_dir, safe_name])

    with open(dest_path, "wb") as f:
        f.write(payload)

    result: dict = {
        "ok": True,
        "filename": safe_name,
        "originalName": file.filename,
        "contentType": content_type,
        "isImage": is_image,
        "tenantId": tenant_id,
        "userId": user_id,
        "path": relative_key,
        "storageKey": relative_key,
        "size": os.path.getsize(dest_path),
    }
    if is_image:
        result["pearlFileContext"] = "\n".join([
            "## Attached image",
            f"Name: {file.filename or safe_name}",
            f"MIME: {content_type}",
            f"Size: {os.path.getsize(dest_path)} bytes",
            f"Stored attachment: {relative_key}",
        ])
    else:
        try:
            context = build_pearl_file_context(
                dest_path,
                file.filename or safe_name,
                content_type,
                os.path.getsize(dest_path),
            )
            result["pearlFileContext"] = context.replace(f"Workspace path: {dest_path}", f"Stored attachment: {relative_key}")
        except Exception as exc:
            logger.warning(f"[upload] file context failed for {file.filename}: {exc}")
            result["pearlFileContext"] = "\n".join([
                "## Attached file",
                f"Name: {file.filename or safe_name}",
                f"MIME: {content_type}",
                f"Size: {os.path.getsize(dest_path)} bytes",
                f"Stored attachment: {relative_key}",
                f"Preview failed: {exc}",
            ])

    logger.info(f"[upload] Saved {file.filename} -> {dest_path} tenant={tenant_id} user={user_id} image={is_image}")
    return result


@app.post("/api/soundtrack/state")
async def soundtrack_state_update(request: Request):
    """Receive soundtrack state updates from the frontend."""
    try:
        body = await request.json()
        from tools.soundtrack_tools import update_soundtrack_state
        update_soundtrack_state(body)
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/canvas/{key}.html")
async def get_canvas_html(key: str):
    """Serve stored canvas HTML by key (URL-based payload delivery)."""
    entry = _canvas_html_store.get(key)
    if not entry:
        raise HTTPException(status_code=404, detail="Canvas HTML not found or expired")
    html, ts = entry
    if time.time() - ts > _CANVAS_STORE_TTL:
        _canvas_html_store.pop(key, None)
        raise HTTPException(status_code=404, detail="Canvas HTML expired")
    return FastAPIResponse(content=html, media_type="text/html")


@app.get("/health")
async def health():
    payload = {"status": "ok"}
    if (not USE_REDIS) and DIRECT_RUNNER_HTTP:
        try:
            runner = await _runner_request("GET", "/health", timeout_secs=2)
        except asyncio.TimeoutError:
            degraded = {
                "status": "degraded",
                "runner": {
                    "status": "down",
                    "error": "runner_health_timeout",
                },
            }
            return FastAPIResponse(
                content=json.dumps(degraded),
                status_code=503,
                media_type="application/json",
            )
        except Exception as exc:
            degraded = {
                "status": "degraded",
                "runner": {
                    "status": "down",
                    "error": type(exc).__name__,
                },
            }
            return FastAPIResponse(
                content=json.dumps(degraded),
                status_code=503,
                media_type="application/json",
            )
        payload["runner"] = {
            "status": "up",
            "sessions": runner.get("sessions"),
        }
    return payload

# ---------------------------------------------------------------------------
# Meeting Mode — Pearl as silent note-taker
# ---------------------------------------------------------------------------

_meeting_state: Dict[str, Any] = {
    "active": False,
    "room_url": None,
    "started_at": None,
    "segments": [],       # list of {speaker, text, timestamp}
    "notes_summary": None,
    "key_points": [],
    "action_items": [],
    "decisions": [],
}


class MeetingStartRequest(BaseModel):
    room_url: str | None = None


class MeetingStopRequest(BaseModel):
    room_url: str | None = None


class MeetingShowRequest(BaseModel):
    room_url: str | None = None


@app.post("/api/meeting/start", dependencies=[Depends(require_auth)])
async def meeting_start(body: MeetingStartRequest):
    """Enter meeting mode — Pearl mutes, starts accumulating transcript notes."""
    global _meeting_state
    _meeting_state = {
        "active": True,
        "room_url": body.room_url,
        "started_at": time.time(),
        "segments": [],
        "notes_summary": None,
        "key_points": [],
        "action_items": [],
        "decisions": [],
    }
    logger.info(f"[meeting] Meeting mode STARTED for room {body.room_url}")

    # Broadcast meeting mode event so the bot pipeline knows to switch prompts
    try:
        envelope = {
            "v": 1,
            "kind": "nia.event",
            "event": "meeting.mode.start",
            "ts": int(time.time() * 1000),
            "payload": {"room_url": body.room_url},
        }
        await ws_broadcast(envelope)
    except Exception as e:
        logger.warning(f"[meeting] Failed to broadcast meeting start: {e}")

    return {"ok": True, "active": True}


@app.post("/api/meeting/stop", dependencies=[Depends(require_auth)])
async def meeting_stop(body: MeetingStopRequest):
    """Exit meeting mode — generate final summary."""
    global _meeting_state
    if not _meeting_state.get("active"):
        return {"ok": True, "active": False, "summary": None}

    # Generate summary from accumulated segments using OpenClaw
    summary = None
    segments = _meeting_state.get("segments", [])
    if segments:
        try:
            transcript_text = "\n".join(
                f"{s.get('speaker', 'Unknown')}: {s.get('text', '')}"
                for s in segments
            )
            prompt = (
                "Summarize this meeting transcript concisely. Include:\n"
                "1. Key discussion points\n"
                "2. Action items (who needs to do what)\n"
                "3. Decisions made\n\n"
                f"Transcript:\n{transcript_text[:8000]}"
            )
            _oc_headers = {"Content-Type": "application/json"}
            if OPENCLAW_API_KEY:
                _oc_headers["Authorization"] = f"Bearer {OPENCLAW_API_KEY}"
            async with aiohttp.ClientSession() as session:
                resp = await session.post(
                    f"{OPENCLAW_BASE_URL}/v1/chat/completions",
                    json={
                        "model": "openclaw",
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": False,
                    },
                    headers=_oc_headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                )
                if resp.status == 200:
                    data = await resp.json()
                    summary = data.get("choices", [{}])[0].get("message", {}).get("content")
                    _meeting_state["notes_summary"] = summary
        except Exception as e:
            logger.warning(f"[meeting] Failed to generate summary: {e}")

    result = {
        "ok": True,
        "active": False,
        "summary": summary,
        "segment_count": len(segments),
        "duration_minutes": round((time.time() - (_meeting_state.get("started_at") or time.time())) / 60, 1),
    }

    # Broadcast stop event
    try:
        envelope = {
            "v": 1,
            "kind": "nia.event",
            "event": "meeting.mode.stop",
            "ts": int(time.time() * 1000),
            "payload": {"summary": summary},
        }
        await ws_broadcast(envelope)
    except Exception:
        pass

    _meeting_state["active"] = False
    logger.info(f"[meeting] Meeting mode STOPPED. {len(segments)} segments, summary={'yes' if summary else 'no'}")
    return result


@app.get("/api/meeting/notes")
async def meeting_notes():
    """Return current accumulated meeting notes."""
    return {
        "active": _meeting_state.get("active", False),
        "segments": _meeting_state.get("segments", []),
        "notes_summary": _meeting_state.get("notes_summary"),
        "key_points": _meeting_state.get("key_points", []),
        "action_items": _meeting_state.get("action_items", []),
        "decisions": _meeting_state.get("decisions", []),
        "segment_count": len(_meeting_state.get("segments", [])),
        "started_at": _meeting_state.get("started_at"),
    }


@app.post("/api/meeting/transcript")
async def meeting_add_transcript(request: Request):
    """Add a transcript segment (called by the bot pipeline when STT produces text)."""
    body = await request.json()
    if not _meeting_state.get("active"):
        return {"ok": False, "reason": "meeting mode not active"}
    segment = {
        "speaker": body.get("speaker", "Unknown"),
        "text": body.get("text", ""),
        "timestamp": time.time(),
    }
    _meeting_state["segments"].append(segment)
    # Cap segments to prevent unbounded memory growth in long meetings
    MAX_MEETING_SEGMENTS = 5000
    if len(_meeting_state["segments"]) > MAX_MEETING_SEGMENTS:
        _meeting_state["segments"] = _meeting_state["segments"][-MAX_MEETING_SEGMENTS:]
    return {"ok": True, "segment_count": len(_meeting_state["segments"])}


@app.post("/api/meeting/show")
async def meeting_show(body: MeetingShowRequest):
    """Display current meeting notes on Wonder Canvas."""
    if not _meeting_state.get("segments"):
        return {"ok": False, "reason": "no notes to display"}

    # Build HTML for Wonder Canvas
    segments = _meeting_state.get("segments", [])
    summary = _meeting_state.get("notes_summary") or ""
    key_points = _meeting_state.get("key_points", [])
    action_items = _meeting_state.get("action_items", [])

    duration = round((time.time() - (_meeting_state.get("started_at") or time.time())) / 60, 1)

    kp_html = "".join(f"<li>{p}</li>" for p in key_points) if key_points else ""
    ai_html = "".join(f"<li>{a}</li>" for a in action_items) if action_items else ""
    recent = segments[-15:]
    transcript_html = "".join(
        f"<p><strong>{s.get('speaker', '?')}:</strong> {s.get('text', '')}</p>"
        for s in recent
    )

    html = f"""
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e0e0e8;padding:32px;max-width:720px;margin:0 auto;">
  <h2 style="color:#FFD233;">📝 Meeting Notes</h2>
  <p style="color:#888;font-size:13px;">{duration} min · {len(segments)} segments</p>
  {"<div style='margin:16px 0'><h3 style='color:#FFD233;font-size:15px'>Summary</h3><p style='font-size:14px'>" + summary + "</p></div>" if summary else ""}
  {"<div style='margin:16px 0'><h3 style='color:#FFD233;font-size:15px'>Key Points</h3><ul style='padding-left:20px'>" + kp_html + "</ul></div>" if kp_html else ""}
  {"<div style='margin:16px 0'><h3 style='color:#FFD233;font-size:15px'>Action Items</h3><ul style='padding-left:20px'>" + ai_html + "</ul></div>" if ai_html else ""}
  <div style="margin:16px 0"><h3 style="color:#FFD233;font-size:15px">Recent Transcript</h3>
    <div style="font-size:12px;color:#aaa">{transcript_html}</div>
  </div>
</div>"""

    # Broadcast as Pearl Views video brief.
    envelope = {
        "v": 1,
        "kind": "nia.event",
        "event": "pixel.canvas",
        "ts": int(time.time() * 1000),
        "seq": 0,
        "payload": {
            "render_mode": "generate_video",
            "title": "Meeting Notes",
            "scene_hint": summary or f"{len(segments)} meeting-note segments captured.",
            "sounds": "soft room tone, subtle interface ticks",
            "use_avatar_image": True,
            "duration": 6,
            "fps": 24,
            "generate_audio": False,
            "camera_motion": "static",
            "html": html,
        },
    }
    await ws_broadcast(envelope)
    logger.info(f"[meeting] Displayed meeting notes on Pearl Views ({len(segments)} segments)")
    return {"ok": True, "segments_shown": len(recent)}


@app.get("/api/meeting/state")
async def meeting_state():
    """Return meeting mode state (active/inactive)."""
    return {
        "active": _meeting_state.get("active", False),
        "started_at": _meeting_state.get("started_at"),
        "room_url": _meeting_state.get("room_url"),
        "segment_count": len(_meeting_state.get("segments", [])),
    }


# ---------------------------------------------------------------------------
# Health (duplicate removed — primary handler is @app.get("/health") above)
# ---------------------------------------------------------------------------
