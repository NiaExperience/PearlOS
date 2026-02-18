"""Flow-managed message polling utilities for the Pipecat Daily Bot.

Handles polling for admin messages and note context messages using a unified polling loop.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional
from dataclasses import dataclass

from loguru import logger

from pipecat_flows import FlowManager
from pipecat.frames.frames import LLMMessagesAppendFrame

from core.config import BOT_SPEAK_GATE_DELAY_SECS
from utils.flow_utils import schedule_flow_llm_run as _schedule_flow_llm_run
from utils.async_utils import run_coroutine_in_new_loop as _run_coroutine_in_new_loop

from .core import _ensure_admin_state, enqueue_admin_instruction

_CreateTask = Callable[[Awaitable[Any]], asyncio.Task[Any]]
_ProcessAdminMessage = Callable[[dict[str, Any]], Awaitable[None]]
_RedisPollingFactory = Callable[[str, _ProcessAdminMessage, str | None], Awaitable[None]]


class FlowMessagePollingController:
    """Coordinate message polling for admin and note context messages.
    
    Polls for both:
    - admin-{pid}-*.json files (admin messages for active bot)
    - pre-spawn-{room_hash}-*.json files (note context buffered before bot spawned)
    
    Persists metadata in Flow state.
    """

    __slots__ = ("_flow_manager", "_task", "_create_task", "_room_url")

    def __init__(
        self,
        *,
        flow_manager: Optional[FlowManager],
        room_url: str,
        create_task: Optional[_CreateTask] = None,
    ) -> None:
        assert flow_manager is not None, "FlowManager is required in Flow-only mode"
        self._flow_manager = flow_manager
        self._room_url = room_url
        self._task: Optional[asyncio.Task[Any]] = None
        self._create_task = create_task or self._default_create_task

    @property
    def enabled(self) -> bool:
        return True

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(
        self,
        *,
        bot_pid: int,
        admin_directory: Path,
        process_admin_message: _ProcessAdminMessage,
        redis_polling_factory: Optional[_RedisPollingFactory] = None,
        poll_interval: float = 1.0,
    ) -> bool:
        if not self.enabled:
            return False

        if self.is_running:
            return True

        coroutine: Optional[Awaitable[Any]]
        source: str

        if redis_polling_factory is not None:
            try:
                # Use room URL as the Redis room key so it matches gateway publish/queue keys
                coroutine = redis_polling_factory(self._room_url, process_admin_message, self._room_url)
                source = "redis"
            except Exception:  # pragma: no cover - defensive guardrail
                logger.exception("[flow.messages] Failed to build Redis polling coroutine")
                coroutine = None
        else:
            coroutine = self._file_polling_loop(
                bot_pid=bot_pid,
                admin_directory=admin_directory,
                process_admin_message=process_admin_message,
                poll_interval=poll_interval,
            )
            source = "file"

        if coroutine is None:
            return False

        try:
            task = self._create_task(coroutine)
        except RuntimeError:
            logger.warning("[flow.messages] No running loop available; skipping message polling start")
            return False

        self._task = task
        self._record_state("source", source)
        self._record_state("running", True)
        return True

    def stop(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        if self.enabled:
            self._record_state("running", False)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _default_create_task(self, coroutine: Awaitable[Any]) -> asyncio.Task[Any]:
        loop = asyncio.get_running_loop()
        return loop.create_task(coroutine)

    def _file_polling_loop(
        self,
        *,
        bot_pid: int,
        admin_directory: Path,
        process_admin_message: _ProcessAdminMessage,
        poll_interval: float,
    ) -> Awaitable[None]:
        async def _runner() -> None:
            directory = admin_directory.expanduser()
            admin_pattern = f"admin-{bot_pid}-*.json"
            
            # Calculate room hash for pre-spawn messages (same logic as server)
            try:
                import os
                from urllib.parse import urlparse
                
                # Canonicalize room URL (same as server._canonical_room_key)
                raw = (self._room_url or '').strip()
                parsed = urlparse(raw)
                scheme = (parsed.scheme or 'http').lower()
                hostname = (parsed.hostname or '').lower()
                port = parsed.port
                if (scheme == 'http' and port == 80) or (scheme == 'https' and port == 443):
                    port_str = ''
                elif port is None:
                    port_str = ''
                else:
                    port_str = f':{port}'
                path = parsed.path or '/'
                path = path.rstrip('/') or '/'
                canonicalize_lower = os.getenv('BOT_CANONICALIZE_LOWER_PATH', '').strip().lower()
                if canonicalize_lower in ('1', 'true', 'yes', 'on'):
                    path = path.lower()
                if not hostname:
                    netloc = (parsed.netloc or '').lower()
                else:
                    netloc = f'{hostname}{port_str}'
                canonical_room = f'{scheme}://{netloc}{path}'
                
                # Calculate hash
                room_hash = hashlib.sha256(canonical_room.encode()).hexdigest()[:12]
                prespawn_pattern = f"pre-spawn-{room_hash}-*.json"
                logger.debug(f"[flow.messages] Polling for pre-spawn messages with hash: {room_hash}")
            except Exception as e:
                logger.warning(f"[flow.messages] Unable to calculate room hash: {e}")
                prespawn_pattern = None

            while True:
                try:
                    await asyncio.sleep(poll_interval)
                except asyncio.CancelledError:
                    raise

                try:
                    directory.mkdir(parents=True, exist_ok=True, mode=0o755)
                except Exception:
                    logger.warning("[flow.messages] Unable to prepare message directory %s" % directory)
                    continue

                # Collect all message files (admin + pre-spawn)
                all_files = []
                try:
                    admin_files = list(directory.glob(admin_pattern))
                    all_files.extend(admin_files)
                    if prespawn_pattern:
                        prespawn_files = list(directory.glob(prespawn_pattern))
                        if prespawn_files:
                            logger.info(f"[flow.messages] Found {len(prespawn_files)} pre-spawn message(s)")
                        all_files.extend(prespawn_files)
                except Exception as glob_error:
                    logger.warning("[flow.messages] Error scanning message directory: %s" % glob_error)
                    continue

                self._touch_poll_state()

                # Process messages in chronological order (sorted by filename timestamp)
                for message_file in sorted(all_files):
                    try:
                        payload = json.loads(message_file.read_text())
                        
                        # Log message type for debugging
                        msg_type = payload.get('type', 'admin')
                        logger.info(f"[flow.messages] Processing {msg_type} message: {message_file.name}")
                        
                        await process_admin_message(payload)
                        message_file.unlink(missing_ok=True)
                        self._increment_processed_count()
                    except asyncio.CancelledError:
                        raise
                    except Exception as file_error:  # pragma: no cover - defensive cleanup
                        logger.error(
                            "[flow.messages] Error processing message file %s: %s" % (message_file, file_error)
                        )
                        try:
                            message_file.unlink(missing_ok=True)
                        except Exception:
                            pass

        return _runner()

    def _record_state(self, key: str, value: Any) -> None:
        """Log an event for flow-event consumers by updating flow state."""
        try:
            flow_state = self._flow_manager.state
            if not isinstance(flow_state, dict):
                return
            
            # Store flow event data in state
            flow_events = flow_state.setdefault("flow_events", {})
            flow_messages = flow_events.setdefault("flow.messages", {})
            flow_messages[key] = value
        except Exception as e:  # pragma: no cover
            logger.warning("[flow.messages] Unable to log flow event: %s" % e)

    def _touch_poll_state(self) -> None:
        flow_state = getattr(self._flow_manager, "state", {})
        if not isinstance(flow_state, dict):
            return

        admin_state = _ensure_admin_state(flow_state)
        poller_state = admin_state.setdefault("poller", {})
        poller_state["last_polled_at"] = time.time()

    def _increment_processed_count(self) -> None:
        flow_state = getattr(self._flow_manager, "state", {})
        if not isinstance(flow_state, dict):
            return

        admin_state = _ensure_admin_state(flow_state)
        poller_state = admin_state.setdefault("poller", {})
        poller_state["processed_count"] = poller_state.get("processed_count", 0) + 1


def get_flow_message_poller_state(flow_manager) -> dict[str, Any]:
    """Get the current state of the message poller from flow-events."""
    flow_state = getattr(flow_manager, "state", {})
    if not isinstance(flow_state, dict):
        return {}
    
    flow_events = flow_state.get("flow_events", {})
    if not isinstance(flow_events, dict):
        return {}
    
    return flow_events.get("flow.messages", {})


def _truncate_prompt(prompt: str, max_length: int = 50) -> str:
    return prompt[:max_length] + ("..." if len(prompt) > max_length else "")


@dataclass(slots=True)
class _AdminInstruction:
    prompt: str
    mode: str
    sender_id: str
    sender_name: str
    timestamp: Any
    context: dict[str, Any] | None = None  # For user text attribution (sourceType, userName, etc.)


def _normalize_admin_instruction(admin_event: dict[str, Any]) -> _AdminInstruction | None:
    prompt = (admin_event.get('prompt') or '').strip()
    if not prompt:
        logger.warning('[admin-message] Received empty admin prompt, ignoring')
        return None

    mode_raw = admin_event.get('mode', 'queued') or 'queued'
    mode = mode_raw.lower().strip()
    if mode in ('direct', 'immediate'):
        mode = 'immediate'
    else:
        mode = 'queued'

    sender_id = admin_event.get('senderId', '')
    sender_name = admin_event.get('senderName', 'Admin')
    timestamp = admin_event.get('timestamp', 0)
    context = admin_event.get('context')  # Extract context for user text attribution

    return _AdminInstruction(
        prompt=prompt,
        mode=mode,
        sender_id=sender_id,
        sender_name=sender_name,
        timestamp=timestamp,
        context=context,
    )


def _build_admin_ack(instruction: _AdminInstruction) -> dict[str, Any]:
    ack_payload = {
        'status': 'received',
        'message': 'Admin prompt received and queued for processing',
        'originalPrompt': _truncate_prompt(instruction.prompt),
        'senderId': instruction.sender_id,
        'timestamp': instruction.timestamp,
        'mode': instruction.mode,
    }

    if instruction.mode == 'immediate':
        ack_payload['status'] = 'processed_immediately'
        ack_payload['message'] = 'Admin prompt processed immediately'

    return ack_payload


def _handle_flow_admin_instruction(
    *,
    instruction: _AdminInstruction,
    flow_manager: Any,
):
    stored_instruction = enqueue_admin_instruction(
        flow_manager,
        prompt=instruction.prompt,
        sender_id=instruction.sender_id,
        sender_name=instruction.sender_name,
        mode=instruction.mode,
        timestamp=instruction.timestamp,
    )

    if stored_instruction is None:
        logger.warning(
            '[admin-message] Failed to persist Flow admin instruction; skipping execution'
        )
        return

    # Format admin message content based on source type
    context = instruction.context or {}
    source_type = context.get('sourceType')
    
    if source_type == 'user-text':
        # User text from Sprite chat - format as user message, not admin instruction
        user_name = context.get('userName') or instruction.sender_name or 'User'
        admin_content = f"[Message from user {user_name}]: {instruction.prompt}"
        logger.info(f'[admin-message] Processing user text message from {user_name}')
    else:
        # Standard admin instruction
        mode_label = "IMMEDIATE" if instruction.mode == "immediate" else "QUEUED"
        sender_suffix = f" from {instruction.sender_name}" if instruction.sender_name else ""
        admin_content = (
            f"ADMIN INSTRUCTION [{mode_label}{sender_suffix}]: {instruction.prompt}\n\n"
            "Respond to this instruction right away and keep the assistant tone natural. "
            "Do not mention that the guidance originated from an admin."
        )

    if instruction.mode == 'immediate':
        # Immediate mode: Queue admin message as context and interrupt current speaker
        # This works like mid-conversation joins - preserves beat flow, just adds context
        async def _queue_immediate_admin() -> None:
            try:
                # Small delay to allow current utterance to complete if needed
                delay = float(BOT_SPEAK_GATE_DELAY_SECS())
                if delay > 0:
                    await asyncio.sleep(delay)
            except Exception:
                pass
            
            try:
                task_obj = getattr(flow_manager, 'task', None)
                if task_obj is not None and hasattr(task_obj, 'queue_frames'):
                    await task_obj.queue_frames([
                        LLMMessagesAppendFrame(messages=[{
                            'role': 'user',
                            'content': admin_content,
                        }])
                    ])
                    logger.debug(f'[admin-message] Queued immediate admin message: {instruction.prompt[:100]}...')
            except Exception as e:
                logger.error(f'[admin-message] Failed to queue immediate admin message: {e}')

        scheduled = _schedule_flow_llm_run(
            flow_manager,
            before_queue=_queue_immediate_admin,
        )
        if scheduled:
            logger.info('[admin-message] Immediate admin message queued for LLM processing (preserves beat flow)')
        else:
            logger.warning(
                '[admin-message] Flow immediate admin prompt could not schedule Flow LLM wakeup'
            )
            # _refresh_llm_context() # Not available here, assume caller handles sync if needed
            _run_coroutine_in_new_loop(_queue_immediate_admin)
    else:
        # Queued mode: Queue admin message as context to be processed when user is idle
        # Also preserves beat flow - no node transition
        logger.info('[admin-message] Flow queued admin prompt stored in Flow state')
        
        async def _queue_queued_admin() -> None:
            try:
                task_obj = getattr(flow_manager, 'task', None)
                if task_obj is not None and hasattr(task_obj, 'queue_frames'):
                    await task_obj.queue_frames([
                        LLMMessagesAppendFrame(messages=[{
                            'role': 'user',
                            'content': admin_content,
                        }])
                    ])
                    logger.debug(f'[admin-message] Queued admin message: {instruction.prompt[:100]}...')
            except Exception as e:
                logger.error(f'[admin-message] Failed to queue admin message: {e}')

        scheduled = _schedule_flow_llm_run(
            flow_manager,
            before_queue=_queue_queued_admin,
        )
        if scheduled:
            logger.info('[admin-message] Queued admin message scheduled for processing after user idle (preserves beat flow)')
        else:
            logger.warning(
                '[admin-message] Flow queued admin prompt could not schedule LLM run'
            )


def handle_admin_instruction(
    *,
    admin_event: dict[str, Any],
    flow_manager: Optional[Any],
) -> Optional[dict[str, Any]]:
    instruction = _normalize_admin_instruction(admin_event)
    if instruction is None:
        return None

    ack_payload = _build_admin_ack(instruction)

    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, 'FlowManager is required'

    try:
        _handle_flow_admin_instruction(
            instruction=instruction,
            flow_manager=flow_manager,
        )
    except Exception as err:  # pragma: no cover - defensive
        logger.exception('[admin-message] Error processing Flow admin instruction: %s', err)
        ack_payload.update(
            {
                'status': 'error',
                'message': f'Error processing admin prompt: {err}',
            }
        )

    return ack_payload
