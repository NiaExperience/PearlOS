"""Lightweight Redis queue worker for single-server PearlOS deployments.

Replaces the Kubernetes BotOperator. Watches the bot:launch:queue Redis key
and dispatches to the local runner_main.py's /start endpoint.
"""
import asyncio
import json
import os
import signal
import sys
import time

import aiohttp
import redis.asyncio as redis
from loguru import logger

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
QUEUE_KEY = "bot:launch:queue"
RUNNER_URL = os.getenv("RUNNER_URL", "http://localhost:7860")
POLL_TIMEOUT = 2  # seconds to wait on blpop

shutdown = asyncio.Event()


def handle_signal(*_):
    logger.info("[worker] Shutdown signal received")
    shutdown.set()


def _usable_identity(value) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = value.strip()
    if not cleaned or cleaned.lower() in {"anonymous", "null", "none", "undefined"}:
        return ""
    return cleaned


async def hydrate_payload_identity(r: redis.Redis, payload: dict) -> None:
    """Fill missing launch identity from the Redis session state.

    Gateway enqueues the full authenticated body, but older queued jobs or
    retries may only carry the session key. Preserve identity before the runner
    seeds BOT_SESSION_USER_* env vars.
    """
    user_session_key = payload.get("userSessionKey")
    if not user_session_key:
        return

    if (
        _usable_identity(payload.get("sessionUserId"))
        and _usable_identity(payload.get("sessionUserEmail"))
        and _usable_identity(payload.get("sessionUserName"))
    ):
        return

    try:
        raw = await r.get(user_session_key)
        state = json.loads(raw) if raw else {}
    except Exception as e:
        logger.warning(f"[worker] Failed to read session state for identity hydration: {e}")
        return

    changed = False
    for key in ("sessionUserId", "sessionUserEmail", "sessionUserName", "tenantId"):
        current = _usable_identity(payload.get(key))
        fallback = _usable_identity(state.get(key))
        if not current and fallback:
            payload[key] = fallback
            changed = True

    if changed:
        logger.info(
            "[worker] Hydrated queued bot launch identity from session state "
            f"(has_id={bool(_usable_identity(payload.get('sessionUserId')))}, "
            f"has_email={bool(_usable_identity(payload.get('sessionUserEmail')))}, "
            f"has_name={bool(_usable_identity(payload.get('sessionUserName')))})"
        )


async def dispatch_to_runner(session: aiohttp.ClientSession, payload: dict) -> dict:
    """POST the job payload to the runner's /start endpoint."""
    room_url = payload.get("room_url")
    session_id = payload.get("session_id")
    logger.info(f"[worker] Dispatching bot for room={room_url} session={session_id}")

    try:
        async with session.post(
            f"{RUNNER_URL}/start",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            result = await resp.json(content_type=None)
            logger.info(f"[worker] Runner responded {resp.status}: {result.get('sessionId', 'unknown')}")
            if resp.status >= 400:
                return {
                    "error": "runner_http_error",
                    "status": resp.status,
                    "detail": result,
                }
            return result
    except Exception as e:
        logger.error(f"[worker] Failed to dispatch to runner: {e}")
        return {"error": str(e)}


async def update_session_state(r: redis.Redis, payload: dict, runner_result: dict):
    """Update the pending session state in Redis with runner info."""
    user_session_key = payload.get("userSessionKey")
    if not user_session_key:
        return

    try:
        raw = await r.get(user_session_key)
        if raw:
            state = json.loads(raw)
            state["status"] = "running" if "error" not in runner_result else "failed"
            state["runner_url"] = RUNNER_URL
            state["runner_session_id"] = runner_result.get("sessionId")
            state["started_at"] = time.time()
            await r.setex(user_session_key, 3600, json.dumps(state))
            logger.info(f"[worker] Updated session state: {user_session_key} -> {state['status']}")
    except Exception as e:
        logger.error(f"[worker] Failed to update session state: {e}")


async def main():
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    r = redis.from_url(REDIS_URL, decode_responses=True)
    await r.ping()
    logger.info(f"[worker] Connected to Redis at {REDIS_URL}")
    logger.info(f"[worker] Watching queue: {QUEUE_KEY}")
    logger.info(f"[worker] Dispatching to runner at: {RUNNER_URL}")

    async with aiohttp.ClientSession() as session:
        while not shutdown.is_set():
            try:
                result = await r.blpop(QUEUE_KEY, timeout=POLL_TIMEOUT)
                if result is None:
                    continue

                _, raw_payload = result
                payload = json.loads(raw_payload)
                await hydrate_payload_identity(r, payload)
                
                runner_result = await dispatch_to_runner(session, payload)
                await update_session_state(r, payload, runner_result)

            except redis.ConnectionError as e:
                logger.error(f"[worker] Redis connection lost: {e}")
                await asyncio.sleep(5)
            except json.JSONDecodeError as e:
                logger.error(f"[worker] Invalid JSON in queue: {e}")
            except Exception as e:
                logger.error(f"[worker] Unexpected error: {e}")
                await asyncio.sleep(1)

    await r.close()
    logger.info("[worker] Shut down cleanly")


if __name__ == "__main__":
    asyncio.run(main())
