"""Core event bus implementation.

Moved from ``eventbus.__init__`` to this dedicated module so we can begin
separating concerns:

  * bus.py   -> transport‑agnostic pub/sub + streaming queues
  * events.py -> canonical event/topic name constants & schema version
  * event_handlers.py -> higher level business logic subscriptions (future)

The public API (publish/subscribe/emit_*) is still re‑exported at the package
level for backwards compatibility (existing imports from ``eventbus`` keep
working). New code should prefer explicit imports from ``eventbus.bus`` or the
symbolic names in ``eventbus.events`` for clarity.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from . import events as _evt

EVENT_BUS_BACKEND = os.getenv("BOT_EVENT_BUS", "log")

_subscribers: dict[str, list[Callable[[str, dict[str, Any]], None]]] = {}
_wildcard_subscribers: list[Callable[[str, dict[str, Any]], None]] = []
_stream_queues: list[asyncio.Queue[dict[str, Any]]] = []  # full envelopes


def subscribe(topic: str, handler: Callable[[str, dict[str, Any]], None]):
    """Subscribe to a topic. Use '*' for a wildcard subscription.

    Returns an unsubscribe callable (idempotent).
    """
    
    if topic == '*':
        _wildcard_subscribers.append(handler)

        def _unsub():
            try:
                _wildcard_subscribers.remove(handler)
            except ValueError:
                pass

        return _unsub
    bucket = _subscribers.setdefault(topic, [])
    bucket.append(handler)

    def _unsub():
        try:
            bucket.remove(handler)
        except ValueError:
            pass

    return _unsub


def _envelope(topic: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex,
        "ts": datetime.now(timezone.utc).isoformat(),
        "type": topic,
        "version": _evt.EVENT_SCHEMA_VERSION,
        "data": data,
    }


def publish(topic: str, payload: dict[str, Any]):
    """Publish an event with a versioned envelope.

    Subscribers get the raw (topic, payload).
    Streaming consumers (SSE/WS) receive the full envelope object.
    """
    env = _envelope(topic, payload)
    if EVENT_BUS_BACKEND == "log":
        # Skip repetitive partial transcripts logging
        if topic == "bot.transcript" and not payload.get("isFinal"):
            pass
        else:
            logger.info(f"[eventbus] {topic} {env}")

    # Topic subscribers
    subscribers = list(_subscribers.get(topic, []))
    for h in subscribers:
        try:
            h(topic, payload)
        except Exception as e:  # pragma: no cover
            logger.warning(f"[eventbus] subscriber error topic={topic} err={e}")

    # Wildcard subscribers
    for h in list(_wildcard_subscribers):
        try:
            h(topic, payload)
        except Exception as e:  # pragma: no cover
            logger.warning(f"[eventbus] wildcard subscriber error topic={topic} err={e}")

    # Streaming fan‑out (best effort)
    for q in list(_stream_queues):
        if q.full():
            try:
                q.get_nowait()
            except Exception:
                pass
        try:
            q.put_nowait(env)
        except Exception:
            pass
    return env


# Convenience emitters (kept here; they reference canonical names from events.py)
def emit_call_state(room_url: str, phase: str):
    return publish(_evt.DAILY_CALL_STATE, {"room": room_url, "phase": phase})


def emit_first_participant_join(room_url: str, participant_id: str, name: str | None = None, context: dict | None = None):
    data = {"room": room_url, "participant": participant_id}
    if name:
        data["name"] = name
    if context is not None:
        data["context"] = context
    return publish(_evt.DAILY_PARTICIPANT_FIRST_JOIN, data)


def emit_participant_join(
    room_url: str, participant_id: str, name: str | None = None, context: dict | None = None
):
    data = {"room": room_url, "participant": participant_id}
    if name:
        data["name"] = name
    if context is not None:
        data["context"] = context
    return publish(_evt.DAILY_PARTICIPANT_JOIN, data)


def emit_participant_left(room_url: str, participant_id: str, reason: str | None = None):
    return publish(
        _evt.DAILY_PARTICIPANT_LEAVE,
        {"room": room_url, "participant": participant_id, "reason": reason},
    )


def emit_participants_change(room_url: str, participants: list[str]):
    return publish(_evt.DAILY_PARTICIPANTS_CHANGE, {"room": room_url, "participants": participants})


def emit_bot_speaking_started(room_url: str, meta: dict | None = None):
    data = {"room": room_url}
    if meta:
        data.update(meta)
    try:
        logger.info(
            f"[speak.emit] START room={room_url} meta={ {k:v for k,v in data.items() if k!='room'} }"
        )
    except Exception:
        pass
    return publish(_evt.BOT_SPEAKING_STARTED, data)


def emit_bot_speaking_stopped(room_url: str, meta: dict | None = None):
    data = {"room": room_url}
    if meta:
        data.update(meta)
    try:
        logger.info(
            f"[speak.emit] STOP  room={room_url} meta={ {k:v for k,v in data.items() if k!='room'} }"
        )
    except Exception:
        pass
    return publish(_evt.BOT_SPEAKING_STOPPED, data)


# Topic name for bot transcript - matches frontend's expected "bot.transcript"
BOT_TRANSCRIPT = "bot.transcript"


def emit_bot_transcript(room_url: str, text: str, is_final: bool = False):
    """Emit bot transcript text for real-time display in the frontend.
    
    Args:
        room_url: The Daily room URL
        text: The transcript text (sentence or accumulated)
        is_final: True when this is the complete transcript for a speaking turn
    """
    import time
    data = {
        "room": room_url,
        "text": text,
        "isFinal": is_final,
        "timestamp": int(time.time() * 1000),
    }
    # Only log final transcripts to avoid log spam
    if is_final:
        try:
            logger.info(
                f"[transcript.emit] FINAL room={room_url} text={text[:80]}{'...' if len(text) > 80 else ''}"
            )
        except Exception:
            pass
    return publish(BOT_TRANSCRIPT, data)


async def register_stream() -> asyncio.Queue[dict[str, Any]]:
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
    _stream_queues.append(q)
    return q


def unregister_stream(q: asyncio.Queue):
    try:
        _stream_queues.remove(q)  # type: ignore[arg-type]
    except ValueError:
        pass


def reset_bus():
    """Reset the event bus state (clear all subscribers)."""
    _subscribers.clear()
    _wildcard_subscribers.clear()
    # We do NOT clear stream queues as those might be long-lived monitoring connections
    logger.info("[eventbus] Bus state reset (subscribers cleared)")


async def stream_events_generator():
    q = await register_stream()
    try:
        while True:
            env = await q.get()
            yield env
    finally:
        unregister_stream(q)


__all__ = [
    "subscribe",
    "publish",
    "emit_call_state",
    "emit_first_participant_join",
    "emit_participant_join",
    "emit_participant_left",
    "emit_participants_change",
    "emit_bot_speaking_started",
    "emit_bot_speaking_stopped",
    "stream_events_generator",
    "register_stream",
    "unregister_stream",
]
