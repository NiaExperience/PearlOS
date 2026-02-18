from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Callable, Awaitable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import eventbus
from services import redis_admin as redis_admin_migration
from eventbus import events
from tools import events as bot_events
from flows import (
    FlowMessagePollingController,
    FlowPacingController,
    FlowParticipantDispatcher,
    get_flow_greeting_state,
    reset_flow_greeting_state,
)
from loguru import logger

from core.config import (
    BOT_ADMIN_MESSAGE_DIR,
    BOT_BEAT_USER_IDLE_SECS,
    BOT_BEAT_USER_IDLE_TIMEOUT_SECS,
    BOT_SPEAK_GATE_DELAY_SECS,
)
from utils.greeting_utils import wait_gate, wait_user_idle
from utils.async_utils import (
    get_running_loop_or_none as _get_running_loop_or_none,
    run_coroutine_in_new_loop as _run_coroutine_in_new_loop,
    schedule_coroutine_on_loop as _schedule_coroutine_on_loop,
)

from session.handlers import SessionEventHandler
from flows.handlers import FlowEventHandler
from flows.admin_handlers import AdminEventHandler

# Use direct module reference to ensure same instance
subscribe = eventbus.subscribe
publish = eventbus.publish

_session_cache = {}

def _truncate_prompt(prompt: str, max_length: int = 50) -> str:
    return prompt[:max_length] + ("..." if len(prompt) > max_length else "")


def _compute_dedup_key(message: dict[str, Any]) -> str | None:
    explicit = message.get('dedup_key')
    if isinstance(explicit, str) and explicit:
        return explicit

    if message.get('role') != 'system':
        return None

    content = message.get('content')
    if isinstance(content, (dict, list)):
        try:
            content_repr = json.dumps(content, sort_keys=True)
        except Exception:
            content_repr = str(content)
    else:
        content_repr = str(content)

    return f"system::{content_repr}"


def _dedupe_system_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []

    for message in reversed(messages):
        key = _compute_dedup_key(message)
        if key is None:
            deduped.append(message)
            continue

        if key in seen:
            continue

        seen.add(key)
        deduped.append(message)

    deduped.reverse()
    return deduped

def _default_wrap_before_queue(
    before: Callable[[], Awaitable[None]] | None = None,
) -> Callable[[], Awaitable[None]]:
    async def _runner() -> None:
        if before is not None:
            await before()

    return _runner

_context_refresh_hook: Callable[[], None] = lambda: None
_wrap_before_queue_hook: Callable[
    [Callable[[], Awaitable[None]] | None], Callable[[], Awaitable[None]]
] = _default_wrap_before_queue


def _register_context_sync_hooks(
    *,
    refresh_hook: Callable[[], None],
    wrap_hook: Callable[[Callable[[], Awaitable[None]] | None], Callable[[], Awaitable[None]]],
) -> None:
    global _context_refresh_hook, _wrap_before_queue_hook
    _context_refresh_hook = refresh_hook
    _wrap_before_queue_hook = wrap_hook


def _refresh_llm_context() -> None:
    try:
        _context_refresh_hook()
    except Exception:  # pragma: no cover - defensive logging
        logger.exception('[context-sync] Failed to update OpenAI context messages')


def _wrap_before_queue(
    before: Callable[[], Awaitable[None]] | None = None,
) -> Callable[[], Awaitable[None]]:
    return _wrap_before_queue_hook(before)

# Helper: register all event handlers for a room and return a composite unsubscribe.
def register_default_handlers(
    *,
    room_url: str,
    task: Any,
    context_agg: Any,
    messages: list[dict],
    context: Any = None,
    personality_message: Optional[dict] = None,
    transport: Any = None,
    personality_record: Optional[dict[str, Any]] = None,
    persona: Optional[str] = None,
    flow_manager: Optional[Any] = None,
    set_active_note_id: Optional[Callable[[str, str | None, str | None], Awaitable[None]]] = None,
    get_active_note_id: Optional[Callable[[str], Awaitable[str | None]]] = None,
) -> Callable[[], None]:
    if flow_manager is None:
        logger.error(
            '[handlers] FlowManager is required but was None; aborting handler registration'
        )
        raise RuntimeError('FlowManager is required for bot handlers')

    unsubscribes: list[Callable[[], None]] = []

    multi_user_aggregator = getattr(context_agg, '_multi_user_agg', None)

    def _refresh_llm_context_local() -> None:
        if context is None:
            return
        try:
            context.set_messages(_dedupe_system_messages(list(messages)))
            if not context.tools and hasattr(context, '_original_tools') and context._original_tools:
                context._tools = context._original_tools
                logger.debug('[context-sync] Restored tools after RESET_WITH_SUMMARY cleared them')
        except Exception:
            logger.exception('[context-sync] Failed to update OpenAI context messages')

    async def _refresh_llm_context_async() -> None:
        _refresh_llm_context_local()

    def _wrap_before_queue_impl(
        before: Optional[Callable[[], Awaitable[None]]] = None,
    ) -> Callable[[], Awaitable[None]]:
        async def _runner() -> None:
            await _refresh_llm_context_async()
            try:
                await wait_gate(
                    float(BOT_SPEAK_GATE_DELAY_SECS()),
                    speaking_flag_getter=lambda: flow_handler.bot_speaking,
                )
            except Exception:
                pass

            try:
                idle_secs = float(BOT_BEAT_USER_IDLE_SECS())
                if idle_secs > 0:
                    await wait_user_idle(
                        idle_secs,
                        is_user_speaking_getter=lambda: flow_handler.user_speaking,
                        timeout_secs=float(BOT_BEAT_USER_IDLE_TIMEOUT_SECS()),
                    )
            except Exception:
                pass

            if before is not None:
                await before()

        return _runner

    _register_context_sync_hooks(
        refresh_hook=_refresh_llm_context_local,
        wrap_hook=_wrap_before_queue_impl,
    )

    if hasattr(multi_user_aggregator, 'register_context_sync_callback'):
        try:
            multi_user_aggregator.register_context_sync_callback(_refresh_llm_context_local)
        except Exception:
            logger.exception('[context-sync] Failed to register aggregator sync callback')

    _refresh_llm_context_local()

    try:
        if room_url in _session_cache:
            _session_cache.pop(room_url, None)
    except Exception:
        pass

    dispatcher = FlowParticipantDispatcher(flow_manager)
    pacing_controller = FlowPacingController(
        flow_manager=flow_manager, publish=publish, room=room_url
    )
    if not pacing_controller:
        raise RuntimeError('Failed to initialize FlowPacingController')

    try:
        reset_flow_greeting_state(flow_manager, room_url)
    except Exception:
        pass

    st = get_flow_greeting_state(flow_manager, room_url)
    st['flow_manager'] = flow_manager
    st['personality_message'] = personality_message
    st['personality_record'] = personality_record

    # Instantiate Handlers
    session_handler = SessionEventHandler(
        flow_manager=flow_manager,
        room_url=room_url,
        dispatcher=dispatcher,
        messages=messages,
        refresh_llm_context_callback=_refresh_llm_context_local,
    )
    
    flow_handler = FlowEventHandler(
        flow_manager=flow_manager,
        room_url=room_url,
        pacing_controller=pacing_controller,
        messages=messages,
        refresh_llm_context_callback=_refresh_llm_context_local,
        wrap_before_queue_hook=_wrap_before_queue_impl,
    )
    
    admin_handler = AdminEventHandler(
        flow_manager=flow_manager,
        room_url=room_url,
        set_active_note_id=set_active_note_id,
        get_active_note_id=get_active_note_id,
    )

    # Register Subscriptions
    unsubscribes.append(subscribe(events.DAILY_PARTICIPANT_JOIN, session_handler.on_join))
    unsubscribes.append(subscribe(events.DAILY_PARTICIPANT_LEAVE, session_handler.on_leave))
    unsubscribes.append(subscribe(events.DAILY_PARTICIPANTS_CHANGE, session_handler.on_snapshot))
    unsubscribes.append(subscribe(events.DAILY_PARTICIPANT_IDENTITY, session_handler.on_identity))
    
    unsubscribes.append(subscribe('bot.conversation.greeting', flow_handler.on_greeting))
    unsubscribes.append(subscribe(events.BOT_SPEAKING_STARTED, flow_handler.on_bot_speaking_started))
    unsubscribes.append(subscribe(events.BOT_SPEAKING_STOPPED, flow_handler.on_bot_speaking_stopped))
    unsubscribes.append(subscribe(events.BOT_CONVO_PACING_BEAT, flow_handler.on_pacing_beat))
    unsubscribes.append(subscribe(events.BOT_CONVO_WRAPUP, flow_handler.on_wrapup))
    
    unsubscribes.append(subscribe('admin.prompt.message', admin_handler.on_admin_prompt))
    unsubscribes.append(subscribe('llm.context.message', admin_handler.on_llm_context_message))

    # User speaking events
    try:
        _USER_STARTED = getattr(events, 'USER_SPEAKING_STARTED', None)
        _USER_STOPPED = getattr(events, 'USER_SPEAKING_STOPPED', None)

        if _USER_STARTED is not None:
            unsubscribes.append(subscribe(_USER_STARTED, lambda *_: flow_handler.mark_user_speaking_started()))
        if _USER_STOPPED is not None:
            unsubscribes.append(subscribe(_USER_STOPPED, lambda *_: flow_handler.mark_user_speaking_stopped()))
    except Exception:
        pass

    # Admin Polling
    admin_polling_controller = FlowMessagePollingController(
        flow_manager=flow_manager,
        room_url=room_url
    )
    redis_polling_func = redis_admin_migration.get_message_polling_loop()
    admin_polling_controller.start(
        bot_pid=os.getpid(),
        admin_directory=Path(BOT_ADMIN_MESSAGE_DIR()).expanduser(),
        process_admin_message=admin_handler.process_admin_message,
        redis_polling_factory=redis_polling_func,
    )



    def _composite_unsub():
        for u in unsubscribes:
            try:
                u()
            except Exception:
                pass
        
        session_handler.close()
        flow_handler.close()
        
        if admin_polling_controller:
            try:
                admin_polling_controller.stop()
            except Exception:
                pass
        
        if pacing_controller:
            try:
                pacing_controller.cancel_all()
            except Exception:
                pass
        
        try:
            reset_flow_greeting_state(flow_manager, room_url)
        except Exception:
            pass
        
        _session_cache.pop(room_url, None)

    # Test helpers
    def get_current_participant_context() -> dict[str, Any] | None:
        return session_handler.current_participant_context

    _composite_unsub.get_current_participant_context = get_current_participant_context
    _composite_unsub.mark_user_speaking_started = flow_handler.mark_user_speaking_started
    _composite_unsub.mark_user_speaking_stopped = flow_handler.mark_user_speaking_stopped

    return _composite_unsub

__all__ = ['register_default_handlers']
