from __future__ import annotations

import asyncio
import os
from typing import Any, Callable, Optional

from loguru import logger

from core.config import (
    BOT_BEAT_MIN_SPEAK_GAP_SECS,
    BOT_BEAT_POST_SPEAK_BUFFER_SECS,
    BOT_BEAT_REPEAT_INTERVAL_SECS,
    BOT_BEAT_USER_IDLE_SECS,
    BOT_BEAT_USER_IDLE_TIMEOUT_SECS,
    BOT_WRAPUP_AFTER_SECS,
    BOT_WRAPUP_SYSTEM_MESSAGE,
)
from eventbus import events, publish
from flows import (
    FlowPacingController,
    get_flow_greeting_state,
    transition_to_wrapup_node,
)
from utils.async_utils import (
    get_running_loop_or_none as _get_running_loop_or_none,
    run_coroutine_in_new_loop as _run_coroutine_in_new_loop,
    schedule_coroutine_on_loop as _schedule_coroutine_on_loop,
)
from utils.flow_utils import schedule_flow_llm_run as _schedule_flow_llm_run
from utils.greeting_utils import wait_user_idle
from pipecat.frames.frames import LLMMessagesAppendFrame


class FlowEventHandler:
    """Handles flow pacing, beats, wrapup, and speaking state events."""

    def __init__(
        self,
        flow_manager: Any,
        room_url: str,
        pacing_controller: FlowPacingController,
        messages: list[dict],
        refresh_llm_context_callback: Callable[[], None],
        wrap_before_queue_hook: Callable[[Callable], Callable],
    ):
        self.flow_manager = flow_manager
        self.room_url = room_url
        self.pacing_controller = pacing_controller
        self.messages = messages
        self.refresh_llm_context = refresh_llm_context_callback
        self.wrap_before_queue_hook = wrap_before_queue_hook

        # State
        self.bot_speaking = False
        self.bot_speaking_started_at = 0.0
        self.last_bot_stop_ts = 0.0
        
        self.user_speaking = False
        self.last_user_stop_ts = 0.0
        
        self.pending_beat_prompt: Optional[str] = None
        self.active_beat_prompt: Optional[str] = None
        self.active_prompt_interrupted = False
        
        self.last_beat_spoken_at: dict[str, float] = {}
        
        self.wrapup_task: asyncio.Task | None = None
        self.participant_refresh_task: asyncio.Task | None = None
        
        # Config
        self.wrapup_after_secs = float(BOT_WRAPUP_AFTER_SECS())
        self.wrapup_message = BOT_WRAPUP_SYSTEM_MESSAGE()

    def _get_greeting_state(self):
        return get_flow_greeting_state(self.flow_manager, self.room_url)

    async def _wrapup_once(self):
        try:
            await asyncio.sleep(self.wrapup_after_secs)
            publish(
                events.BOT_CONVO_WRAPUP,
                {
                    'room': self.room_url,
                    'after_secs': self.wrapup_after_secs,
                },
            )
        except asyncio.CancelledError:
            return
        except Exception:
            return

    def on_greeting(self, topic, payload):
        if self.pacing_controller:
            # Schedule wrapup
            if self.wrapup_after_secs > 0:
                async def _transition_wrapup_node() -> None:
                    try:
                        await transition_to_wrapup_node(self.flow_manager)
                    except Exception:
                        logger.exception('[flow.wrapup] Failed to transition Flow to wrapup node')

                self.pacing_controller.schedule_wrapup(
                    delay=self.wrapup_after_secs,
                    on_wrapup=_transition_wrapup_node,
                )
            
            # Schedule beats
            st = self._get_greeting_state()
            personality_record = st.get('personality_record')
            if personality_record:
                try:
                    repeat_interval = float(BOT_BEAT_REPEAT_INTERVAL_SECS())
                    self.pacing_controller.schedule_beats(
                        personality_record=personality_record,
                        repeat_interval=repeat_interval,
                    )
                except Exception:
                    logger.exception('[flow.pacing] Failed to schedule beats')
        else:
            if self.wrapup_after_secs > 0 and self.wrapup_task is None:
                try:
                    loop = _get_running_loop_or_none()
                    self.wrapup_task = loop.create_task(self._wrapup_once())
                except RuntimeError:
                    pass

    def on_bot_speaking_started(self, topic, payload):
        self.bot_speaking = True
        try:
            import time as _t
            self.bot_speaking_started_at = _t.time()
        except Exception:
            self.bot_speaking_started_at = 0.0
        
        # Mark greeting speech as started on FIRST bot speech
        # This lifts the tool gate - tools are blocked until the bot has spoken at least once
        st = self._get_greeting_state()
        if not st.get('greeting_speech_started', False):
            st['greeting_speech_started'] = True
            greeted_ids = st.get('greeted_user_ids', set())
            logger.info(f'[flow.greeting] Greeting speech started (greeted {len(greeted_ids)} user(s))')
        
        if isinstance(self.pending_beat_prompt, str) and self.pending_beat_prompt.strip():
            self.active_beat_prompt = self.pending_beat_prompt.strip()
            self.pending_beat_prompt = None
            self.active_prompt_interrupted = False

    def on_bot_speaking_stopped(self, topic, payload):
        self.bot_speaking = False
        try:
            import time as _t
            self.last_bot_stop_ts = _t.time()
        except Exception:
            pass

        try:
            if self.active_beat_prompt:
                duration = 0.0
                try:
                    if self.bot_speaking_started_at and self.last_bot_stop_ts:
                        duration = float(self.last_bot_stop_ts - self.bot_speaking_started_at)
                except Exception:
                    duration = 0.0

                if self.active_prompt_interrupted or (duration > 0.0 and duration < 1.0):
                    beat_text = self.active_beat_prompt
                    self.active_beat_prompt = None
                    self.active_prompt_interrupted = False

                    async def _reissue_after_idle():
                        try:
                            idle_secs = float(BOT_BEAT_USER_IDLE_SECS())
                            timeout = float(BOT_BEAT_USER_IDLE_TIMEOUT_SECS())
                            if idle_secs > 0:
                                await wait_user_idle(
                                    idle_secs,
                                    is_user_speaking_getter=lambda: self.user_speaking,
                                    timeout_secs=timeout,
                                )

                            nudge = {
                                'role': 'system',
                                'content': (
                                    'You started speaking but were interrupted or cut off.'
                                ),
                            }

                            async def _before_queue():
                                try:
                                    task_obj = getattr(self.flow_manager, 'task', None)
                                    if task_obj is not None and hasattr(task_obj, 'queue_frames'):
                                        await task_obj.queue_frames([LLMMessagesAppendFrame(messages=[nudge])])
                                except Exception:
                                    pass

                            _schedule_flow_llm_run(self.flow_manager, before_queue=_before_queue)
                        except Exception:
                            pass

                    loop = _get_running_loop_or_none()
                    if loop is not None:
                        loop.create_task(_reissue_after_idle())
                else:
                    self.active_beat_prompt = None
                    self.active_prompt_interrupted = False
        except Exception:
            pass

    def mark_user_speaking_started(self):
        self.user_speaking = True
        if self.bot_speaking and self.active_beat_prompt:
            self.active_prompt_interrupted = True

    def mark_user_speaking_stopped(self):
        self.user_speaking = False
        try:
            import time as _t
            self.last_user_stop_ts = _t.time()
        except Exception:
            pass

    def on_pacing_beat(self, topic, payload):
        beat_message = payload.get('message', '')

        async def _transition_to_beat_node():
            try:
                try:
                    text = beat_message if isinstance(beat_message, str) else ''
                    if text.strip():
                        self.pending_beat_prompt = text.strip()
                except Exception:
                    pass
                
                try:
                    import time as _t
                    post_buffer = float(BOT_BEAT_POST_SPEAK_BUFFER_SECS())
                    if post_buffer > 0 and self.last_bot_stop_ts:
                        since = max(0.0, _t.time() - float(self.last_bot_stop_ts or 0.0))
                        if since < post_buffer:
                            remaining = post_buffer - since
                            end = _t.time() + remaining
                            while _t.time() < end:
                                if self.user_speaking:
                                    break
                                await asyncio.sleep(0.1)
                except Exception:
                    pass

                try:
                    idle_secs = float(BOT_BEAT_USER_IDLE_SECS())
                    if idle_secs > 0:
                        await wait_user_idle(
                            idle_secs,
                            is_user_speaking_getter=lambda: self.user_speaking,
                            timeout_secs=float(BOT_BEAT_USER_IDLE_TIMEOUT_SECS()),
                        )
                except Exception:
                    pass
                
                try:
                    st = self._get_greeting_state()
                    greeted_ids = st.get('greeted_ids', set()) if isinstance(st, dict) else set()
                    stime = payload.get('start_time', None)
                    if isinstance(stime, (int, float)) and float(stime) == 0.0 and greeted_ids:
                        return
                except Exception:
                    pass

                try:
                    import time as _t
                    min_gap = float(BOT_BEAT_MIN_SPEAK_GAP_SECS())
                    now = _t.time()
                    last_at = self.last_beat_spoken_at.get(self.room_url, 0.0)
                    if min_gap > 0 and (now - last_at) < min_gap:
                        return
                except Exception:
                    pass

                fm_state = self.flow_manager.state
                nodes = fm_state.get('nodes', {}) if isinstance(fm_state, dict) else {}
                beat_index = fm_state.get('beat_nodes', []) if isinstance(fm_state, dict) else []
                target_name = None
                
                if isinstance(beat_index, list):
                    for entry in beat_index:
                        if isinstance(entry, dict) and entry.get('message') == beat_message:
                            target_name = entry.get('name')
                            break
                    if target_name is None and beat_index:
                        target_name = beat_index[0].get('name')
                node_cfg = nodes.get(target_name) if isinstance(nodes, dict) and target_name else None
                
                if isinstance(node_cfg, dict):
                    await self.flow_manager.set_node_from_config(node_cfg)

                async def _gate() -> None:
                    return None

                scheduled = _schedule_flow_llm_run(
                    self.flow_manager,
                    before_queue=self.wrap_before_queue_hook(_gate),
                )
                if scheduled:
                    try:
                        import time as _t
                        self.last_beat_spoken_at[self.room_url] = _t.time()
                    except Exception:
                        pass
            except Exception:
                logger.exception('[flow.beat-node] Failed to transition to beat node')

        loop = _get_running_loop_or_none()
        if loop is not None:
            _schedule_coroutine_on_loop(loop, _transition_to_beat_node)
        else:
            _run_coroutine_in_new_loop(_transition_to_beat_node)

    def on_wrapup(self, topic, payload):
        try:
            closing = (
                self.wrapup_message
                or 'Politely wrap up the conversation, thank everyone for participating, and encourage any brief final thoughts before ending.'
            )
            if 'wrap up' not in closing and 'wrap-up' not in closing.lower():
                closing = closing + ' Please wrap up and thank everyone.'
            self.messages.append({'role': 'system', 'content': closing})
            self.refresh_llm_context()
        except Exception:
            pass

    def close(self):
        if self.wrapup_task and not self.wrapup_task.done():
            try:
                self.wrapup_task.cancel()
            except Exception:
                pass
        self.wrapup_task = None
        
        if self.participant_refresh_task and not self.participant_refresh_task.done():
            try:
                self.participant_refresh_task.cancel()
            except Exception:
                pass
        self.participant_refresh_task = None
