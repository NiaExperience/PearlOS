from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Callable, Optional

from loguru import logger

from core.config import (
    BOT_GREETING_GRACE_SECS,
    BOT_PARTICIPANT_REFRESH_MESSAGE,
    BOT_PROFILE_INSTRUCTION_MESSAGE,
)
from eventbus import events, publish
from flows import (
    FlowParticipantDispatcher,
    get_flow_greeting_state,
    initialize_base_flow,
    collect_timer_settings,
)
from tools import events as bot_events
from utils.async_utils import (
    get_running_loop_or_none as _get_running_loop_or_none,
    run_coroutine_in_new_loop as _run_coroutine_in_new_loop,
    schedule_coroutine_on_loop as _schedule_coroutine_on_loop,
)
from utils.flow_utils import schedule_flow_llm_run as _schedule_flow_llm_run
from pipecat.frames.frames import LLMMessagesAppendFrame, TTSSpeakFrame
from session.participant_data import is_stealth_participant


class SessionEventHandler:
    """Handles participant lifecycle events (join, leave, identity) and greeting logic."""

    def __init__(
        self,
        flow_manager: Any,
        room_url: str,
        dispatcher: FlowParticipantDispatcher,
        messages: list[dict],
        refresh_llm_context_callback: Callable[[], None],
    ):
        self.flow_manager = flow_manager
        self.room_url = room_url
        self.dispatcher = dispatcher
        self.messages = messages
        self.refresh_llm_context = refresh_llm_context_callback
        
        # State for participant context message management
        self.current_participant_context: dict[str, Any] | None = None
        self.participant_context_message: dict[str, Any] | None = None

    def _get_greeting_state(self):
        return get_flow_greeting_state(self.flow_manager, self.room_url)

    def _build_participant_data(self, pid: str, pctx: dict, fallback_name: str = None, is_private: bool = False) -> dict:
        """Build participant data object for JSON output."""
        if not pctx or not isinstance(pctx, dict):
            return {
                'username': fallback_name or pid,
                'info': 'Basic participant info only',
            }

        participant_name = None
        user_profile = pctx.get('profile_data') or pctx.get('user_profile')
        session_metadata = pctx.get('session_metadata')
        session_user_id = session_metadata.get('session_user_id') if session_metadata else None

        if fallback_name and fallback_name != pid:
            participant_name = fallback_name
        elif session_metadata and isinstance(session_metadata, dict):
            participant_name = session_metadata.get('session_user_name')
        elif user_profile and isinstance(user_profile, dict):
            participant_name = user_profile.get('name')
        else:
            participant_name = pid

        # Replace "anonymous" with "friend" for greetings
        if isinstance(participant_name, str) and participant_name.lower() == "anonymous":
            participant_name = "friend"

        participant_data = {
            'username': participant_name,
            'participant_id': pid,
        }
        
        if session_user_id and isinstance(session_user_id, str):
            participant_data['user_id'] = session_user_id
        if session_metadata and isinstance(session_metadata, dict):
            tenant_id = session_metadata.get('tenant_id') or session_metadata.get('tenantId')
            if isinstance(tenant_id, str) and tenant_id.strip():
                participant_data['tenant_id'] = tenant_id.strip()

        if user_profile and isinstance(user_profile, dict):
            logger.debug(f"[_build_participant_data] Processing user_profile keys: {list(user_profile.keys())}")
            
            # Extract top-level fields first (excluding internal/reserved keys)
            for key, value in user_profile.items():
                if key.startswith('_') or key in ['metadata', 'userId', 'id', 'email', 'name']:
                    continue
                if value and str(value).strip():
                    participant_data[key] = value

            metadata = user_profile.get('metadata')
            profile_name = user_profile.get('name')
            if isinstance(profile_name, str):
                cleaned_profile_name = profile_name.strip()
                if cleaned_profile_name and cleaned_profile_name != participant_data['username']:
                    participant_data['profile_name'] = cleaned_profile_name
            if metadata and isinstance(metadata, dict):
                for key, value in metadata.items():
                    if key.lower() in ['email', 'email_address', 'user_email']:
                        continue
                    if value and str(value).strip():
                        participant_data[key] = value
        elif session_metadata and isinstance(session_metadata, dict):
            sname = session_metadata.get('session_user_name')
            if isinstance(sname, str):
                cleaned = sname.strip()
                if cleaned and cleaned != participant_data['username']:
                    participant_data['session_name'] = cleaned
        else:
            participant_data['info'] = 'Basic participant info only'

        return participant_data

    def _emit_immediate_participant_context(self):
        """Emit immediate participant context update when participants join/leave."""
        st = self._get_greeting_state()
        active_participants = st.get('participants', set())
        participant_contexts = st.get('participant_contexts', {})

        human_participants = {pid for pid in active_participants if pid != 'local'}
        non_stealth_participants = set()
        
        for pid in human_participants:
            pctx = participant_contexts.get(pid)
            fallback_name = st.get('grace_participants', {}).get(pid)
            if not is_stealth_participant(pid, fallback_name, pctx):
                non_stealth_participants.add(pid)

        if not non_stealth_participants:
            self.current_participant_context = None
            if self.participant_context_message is not None:
                try:
                    self.messages.remove(self.participant_context_message)
                except ValueError:
                    pass
                self.participant_context_message = None
            self.refresh_llm_context()
            return

        participants_data = []
        is_private_session = False
        for pid in non_stealth_participants:
            pctx = participant_contexts.get(pid)
            if pctx and isinstance(pctx, dict):
                session_metadata = pctx.get('session_metadata')
                if session_metadata and isinstance(session_metadata, dict):
                    if session_metadata.get('private', False):
                        is_private_session = True
                        break

        for pid in sorted(non_stealth_participants):
            pctx = participant_contexts.get(pid)
            fallback_name = st.get('grace_participants', {}).get(pid)
            participant_data = self._build_participant_data(pid, pctx, fallback_name, is_private=is_private_session)
            participants_data.append(participant_data)

        if participants_data:
            logger.debug(f"[_emit_immediate_participant_context] Emitting participants_data: {json.dumps(participants_data)}")
            refresh_marker = BOT_PARTICIPANT_REFRESH_MESSAGE()
            profile_content = f'{refresh_marker}\n'
            profile_content += json.dumps(participants_data, indent=2)
            profile_content += f'\n\n{BOT_PROFILE_INSTRUCTION_MESSAGE()}'

            if self.participant_context_message is None:
                self.messages[:] = [
                    msg for msg in self.messages
                    if not (isinstance(msg, dict) and isinstance(msg.get('content'), str) and refresh_marker in msg['content'])
                ]
                self.participant_context_message = {'role': 'system', 'content': profile_content}
                self.messages.append(self.participant_context_message)
            else:
                self.participant_context_message['content'] = profile_content

            self.current_participant_context = self.participant_context_message
            self.refresh_llm_context()
        else:
            self.current_participant_context = None
            if self.participant_context_message is not None:
                try:
                    self.messages.remove(self.participant_context_message)
                except ValueError:
                    pass
                self.participant_context_message = None
            self.refresh_llm_context()

    async def _enqueue_transient_system_message(self, content: str, *, log_context: str) -> bool:
        try:
            fm_state = self.flow_manager.state if hasattr(self.flow_manager, 'state') else {}
            nodes = fm_state.get('nodes', {}) if isinstance(fm_state, dict) else {}
            current_node_name = fm_state.get('current_node') if isinstance(fm_state, dict) else None

            if current_node_name and isinstance(nodes, dict):
                current_node = nodes.get(current_node_name)
                if isinstance(current_node, dict):
                    task_messages = current_node.setdefault('task_messages', [])
                    task_messages.append({'role': 'system', 'content': content})
                    return True
        except Exception:
            pass

        try:
            task_obj = getattr(self.flow_manager, 'task', None)
            if task_obj is not None and hasattr(task_obj, 'queue_frames'):
                await task_obj.queue_frames([
                    LLMMessagesAppendFrame(messages=[{'role': 'system', 'content': content}])
                ])
                return True
        except Exception:
            pass

        return False

    def _build_join_announcement(self, participant_ids: list, participant_names: list, mode: str) -> str:
        if mode == 'single' and participant_names and participant_names[0]:
            name = participant_names[0]
            return (
                f'{name} just joined the conversation. '
                f'Briefly acknowledge their arrival (e.g., "Hey {name}, welcome!") '
                f'and continue with what you were discussing.'
            )
        elif mode == 'pair' and len(participant_names) >= 2:
            names = ' and '.join(participant_names[:2])
            return (
                f'{names} just joined the conversation. '
                f'Briefly welcome them and continue with what you were discussing.'
            )
        elif mode == 'group':
            count = len(participant_ids)
            name_list = ', '.join(participant_names) if participant_names else f'{count} people'
            return (
                f'{name_list} just joined the conversation. '
                f'Briefly acknowledge the group and continue with what you were discussing.'
            )
        else:
            return (
                'Someone just joined the conversation. '
                'Briefly welcome them and continue with what you were discussing.'
            )

    def _emit_greeting(self, st, mode: str, trigger_pid: str):
        pmap = st['grace_participants']
        ids = list(pmap.keys())
        names = [n for n in pmap.values() if n]
        
        if not ids:
            return

        already_greeted_count = len(st.get('greeted_user_ids', set()))
        is_first_greeting = already_greeted_count == 0

        for pid in ids:
            pctx = st.get('participant_contexts', {}).get(pid)
            if pctx and isinstance(pctx, dict):
                session_metadata = pctx.get('session_metadata')
                if session_metadata and isinstance(session_metadata, dict):
                    user_id = session_metadata.get('session_user_id')
                    if user_id:
                        st['greeted_user_ids'].add(user_id)

        message_code = {
            'single': 'SINGLE_GREETING',
            'pair': 'PAIR_GREETING',
            'group': 'GROUP_GREETING',
        }.get(mode, 'GREETING')
        
        semantic = {
            'room': self.room_url,
            'trigger_participant': trigger_pid,
            'participants': ids,
            'participant_names': names,
            'mode': mode,
            'message': message_code,
        }

        async def _go_first_beat():
            try:
                if not is_first_greeting:
                    announcement = self._build_join_announcement(ids, names, mode)
                    async def _queue_announcement():
                        await self._enqueue_transient_system_message(announcement, log_context='greeting→continue')
                    
                    _schedule_flow_llm_run(self.flow_manager, before_queue=_queue_announcement)
                    return
                
                fm_state = self.flow_manager.state if hasattr(self.flow_manager, 'state') else {}
                nodes = fm_state.get('nodes', {}) if isinstance(fm_state, dict) else {}
                beat_index = fm_state.get('beat_nodes', []) if isinstance(fm_state, dict) else []
                target_name = None
                if isinstance(beat_index, list) and beat_index:
                    entry = beat_index[0]
                    if isinstance(entry, dict):
                        target_name = entry.get('name')
                node_cfg = nodes.get(target_name) if isinstance(nodes, dict) and target_name else None
                
                if isinstance(node_cfg, dict):
                    await self.flow_manager.set_node_from_config(node_cfg)

                # FAST GREETING: Speak a short canned phrase immediately via TTS,
                # then wait for user voice input (skip the LLM round-trip).
                import random
                quick_greetings = ["Hey.", "What's up?", "Hey there.", "Hi."]
                quick_phrase = random.choice(quick_greetings)
                logger.info(f'[greeting] Fast greeting: "{quick_phrase}" (skipping LLM round-trip)')

                task = getattr(self.flow_manager, 'task', None)
                if task and hasattr(task, 'queue_frames'):
                    await task.queue_frames([TTSSpeakFrame(text=quick_phrase)])
                    # Mark greeting speech as started so tool gate lifts
                    st['greeting_speech_started'] = True
                else:
                    # Fallback: do the normal LLM greeting if we can't queue frames
                    logger.warning('[greeting] Cannot queue TTSSpeakFrame, falling back to LLM greeting')
                    async def _fast_first_run_gate() -> None:
                        try:
                            self.refresh_llm_context()
                        except Exception:
                            pass
                    _schedule_flow_llm_run(self.flow_manager, before_queue=_fast_first_run_gate)
            except Exception:
                logger.exception('[greeting→beat_0] Failed transitioning to first beat')

        loop = _get_running_loop_or_none()
        if loop is not None:
            _schedule_coroutine_on_loop(loop, _go_first_beat)
        else:
            _run_coroutine_in_new_loop(_go_first_beat)

        publish('bot.conversation.greeting', semantic)
        
        # Reset grace
        st['grace_participants'].clear()
        t = st.get('grace_task')
        if t and not t.done():
            try:
                t.cancel()
            except Exception:
                pass
        st['grace_task'] = None

    async def _grace_countdown(self, st, trigger_pid: str, started_with: int):
        import time
        grace_secs = float(BOT_GREETING_GRACE_SECS())
        
        if started_with == 1:
            pctx = st.get('participant_contexts', {}).get(trigger_pid)
            if pctx and isinstance(pctx, dict):
                session_metadata = pctx.get('session_metadata')
                if session_metadata and isinstance(session_metadata, dict):
                    if session_metadata.get('private', False):
                        grace_secs = 0.0
        
        try:
            if started_with == 1:
                single_cap = float(os.getenv('BOT_SINGLE_GREETING_MAX_SECS', '1.0'))
                effective = min(grace_secs, single_cap)
            else:
                effective = grace_secs
            await asyncio.sleep(effective)
        except asyncio.CancelledError:
            return
        except Exception:
            return

        count = len(st['grace_participants'])
        if count == 0:
            return
        if count == 1:
            self._emit_greeting(st, 'single', trigger_pid)
        elif count == 2:
            self._emit_greeting(st, 'pair', trigger_pid)
        else:
            self._emit_greeting(st, 'group', trigger_pid)

    def _ingest_participant(self, pid: str, pname: str | None, pctx: Any = None, skip_greeting: bool = False):
        st = self._get_greeting_state()
        if pid == 'local':
            return
        
        # Skip bot personality/persona matches
        if pname:
            personality_record = st.get('personality_record')
            personality_name = personality_record.get('name', '').lower().strip() if personality_record else ''
            if personality_name and pname.lower().strip() == personality_name:
                return

        is_stealth = is_stealth_participant(pid, pname, pctx)
        self.dispatcher.handle_join(
            room=self.room_url,
            participant_id=pid,
            display_name=pname,
            context=pctx,
            stealth=is_stealth,
        )
        if is_stealth:
            return
        
        if skip_greeting:
            st['participant_contexts'][pid] = pctx
            return
        
        st['participant_contexts'][pid] = pctx

        if pctx and isinstance(pctx, dict):
            session_metadata = pctx.get('session_metadata')
            if session_metadata and isinstance(session_metadata, dict):
                tenant_id = session_metadata.get('tenant_id') or session_metadata.get('tenantId')
                if isinstance(tenant_id, str) and tenant_id.strip():
                    try:
                        import bot
                        bot.set_room_tenant_id(self.room_url, tenant_id.strip())
                    except Exception:
                        pass

        # Private session re-init
        if pctx and isinstance(pctx, dict):
            session_metadata = pctx.get('session_metadata')
            if session_metadata and isinstance(session_metadata, dict):
                is_private = session_metadata.get('private', False)
                if is_private and not st.get('flow_initialized_private', False):
                    flow_manager_ref = st.get('flow_manager')
                    personality_message_ref = st.get('personality_message')
                    personality_record_ref = st.get('personality_record')
                    
                    if flow_manager_ref:
                        try:
                            timer_settings = collect_timer_settings()
                            loop = _get_running_loop_or_none()
                            coro = initialize_base_flow(
                                flow_manager_ref,
                                personality_message=personality_message_ref,
                                timer_settings=timer_settings,
                                personality_record=personality_record_ref,
                                room=self.room_url,
                                is_private_session=True
                            )
                            if loop and getattr(loop, 'is_running', lambda: False)():
                                loop.create_task(coro)
                            else:
                                _run_coroutine_in_new_loop(coro)
                            st['flow_initialized_private'] = True
                        except Exception:
                            pass

        # Check if already greeted
        user_id = None
        if pctx and isinstance(pctx, dict):
            session_metadata = pctx.get('session_metadata')
            if session_metadata and isinstance(session_metadata, dict):
                user_id = session_metadata.get('session_user_id')
            if not user_id:
                user_profile = pctx.get('user_profile')
                if user_profile and isinstance(user_profile, dict):
                    user_id = user_profile.get('userId')
            if not user_id:
                profile_data = pctx.get('profile_data')
                if profile_data and isinstance(profile_data, dict):
                    user_id = profile_data.get('userId')
        
        if user_id and user_id in st.get('greeted_user_ids', set()):
            self._emit_immediate_participant_context()
            
            async def _queue_welcome_back():
                welcome_msg = f"Welcome back, {pname}!" if pname and pname != pid else "Welcome back!"
                welcome_content = (
                    f'{welcome_msg} Briefly acknowledge their return '
                    f'(e.g., "Hey {pname}, good to see you again!") and continue naturally.'
                )
                await self._enqueue_transient_system_message(welcome_content, log_context='participant.rejoin')
            
            _schedule_flow_llm_run(self.flow_manager, before_queue=_queue_welcome_back)
            return

        if pid not in st['grace_participants']:
            st['grace_participants'][pid] = pname
        
        if 'pair_task' not in st:
            st['pair_task'] = None
        count = len(st['grace_participants'])

        if count == 1 and st.get('grace_task') is None:
            try:
                loop = _get_running_loop_or_none()
                if loop is not None and getattr(loop, 'is_running', lambda: False)():
                    task = loop.create_task(self._grace_countdown(st, pid, 1))
                    st['grace_task'] = task
                else:
                    self._emit_greeting(st, 'single', pid)
            except Exception:
                self._emit_greeting(st, 'single', pid)
            return

        if count == 2:
            t = st.get('grace_task')
            if t and not t.done():
                try:
                    t.cancel()
                except Exception:
                    pass

            upgrade_delay = min(0.01, float(BOT_GREETING_GRACE_SECS()) / 2.0)

            async def _maybe_pair(current_trigger=pid):
                await asyncio.sleep(upgrade_delay)
                if len(st['grace_participants']) == 2:
                    self._emit_greeting(st, 'pair', current_trigger)

            try:
                loop = _get_running_loop_or_none()
                if loop is not None and getattr(loop, 'is_running', lambda: False)():
                    st['pair_task'] = loop.create_task(_maybe_pair())
                else:
                    self._emit_greeting(st, 'pair', pid)
            except Exception:
                self._emit_greeting(st, 'pair', pid)
            return

        if count >= 3:
            t = st.get('pair_task')
            if t and not t.done():
                try:
                    t.cancel()
                except Exception:
                    pass
                st['pair_task'] = None
            t2 = st.get('grace_task')
            if t2 and not t2.done():
                try:
                    t2.cancel()
                except Exception:
                    pass
                st['grace_task'] = None
            self._emit_greeting(st, 'group', pid)

    def _autoplay_soundtrack(self):
        """Emit soundtrack.control play event when the first participant joins a session."""
        async def _do_play():
            try:
                from room.state import get_forwarder
                forwarder = get_forwarder(self.room_url)
                if forwarder:
                    await forwarder.emit_tool_event("soundtrack.control", {"action": "play"})
                    logger.info("[handlers] Soundtrack autoplay triggered on session start")
                else:
                    logger.debug("[handlers] No forwarder available for soundtrack autoplay (room not yet active)")
            except Exception:
                logger.exception("[handlers] Failed to autoplay soundtrack on session start")

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_do_play())
        except RuntimeError:
            logger.warning("[handlers] Could not schedule soundtrack autoplay: no running event loop")

    def on_join(self, topic, payload):
        room = payload.get('room')
        pid = payload.get('participant')
        pname = payload.get('name')
        pctx = payload.get('context')
        if not room or not pid:
            return

        st = self._get_greeting_state()
        is_stealth = is_stealth_participant(pid, pname, pctx)

        # Detect first real participant joining (before mutating st['participants'])
        is_first_join = (
            pid != 'local'
            and not is_stealth
            and len(st['participants']) == 0
            and not st.get('soundtrack_started', False)
        )

        if not is_stealth:
            before = len(st['participants'])
            st['participants'].add(pid)
            after = len(st['participants'])
            if after != before:
                publish(
                    'bot.roster.delta',
                    {'room': room, 'action': 'join', 'participant': pid, 'count': after},
                )

        self._ingest_participant(pid, pname, pctx)
        
        if pid != 'local':
            is_stealth_ctx = False
            if pctx and isinstance(pctx, dict):
                session_metadata = pctx.get('session_metadata')
                if session_metadata and isinstance(session_metadata, dict):
                    is_stealth_ctx = session_metadata.get('stealth', False)

            if not is_stealth_ctx:
                self._emit_immediate_participant_context()
                self._send_active_context_to_joiner(pid)

            # Autoplay soundtrack on first participant join (after context is set up)
            if is_first_join and not is_stealth_ctx:
                st['soundtrack_started'] = True
                self._autoplay_soundtrack()

    def _send_active_context_to_joiner(self, participant_id: str):
        async def _do_send():
            try:
                import bot
                session_user_id = bot.get_session_user_id_from_participant(participant_id)
                if not session_user_id:
                    return
                
                from bot.room.state import get_forwarder, get_active_note_id, get_active_applet_id
                
                forwarder = get_forwarder(self.room_url)
                if not forwarder:
                    return
                
                active_note_id = await get_active_note_id(self.room_url)
                if active_note_id:
                    await forwarder.emit_tool_event(
                        bot_events.NOTE_OPEN,
                        {"noteId": active_note_id},
                        target_session_user_id=session_user_id
                    )
                
                active_applet_id = await get_active_applet_id(self.room_url)
                if active_applet_id:
                    await forwarder.emit_tool_event(
                        bot_events.APPLET_OPEN,
                        {"appletId": active_applet_id},
                        target_session_user_id=session_user_id
                    )
            except Exception:
                pass

        # Schedule the coroutine on the current loop
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_do_send())
        except RuntimeError:
            logger.error("[handlers] Could not schedule _do_send: no running loop")

    def on_leave(self, topic, payload):
        room = payload.get('room')
        pid = payload.get('participant')
        pname = payload.get('name')
        pctx = payload.get('context')
        if not room or not pid:
            return
        st = self._get_greeting_state()

        is_stealth = is_stealth_participant(pid, pname, pctx)
        self.dispatcher.handle_leave(room=room, participant_id=pid)

        existed = pid in st['participants']
        if not is_stealth:
            st['participants'].discard(pid)

        if pid in st['grace_participants']:
            st['grace_participants'].pop(pid, None)
            if not st['grace_participants']:
                t = st.get('grace_task')
                if t and not t.done():
                    try:
                        t.cancel()
                    except Exception:
                        pass
                st['grace_task'] = None

        if not st['participants']:
            st['greeted_user_ids'].clear()
            st['grace_participants'].clear()
            t = st.get('grace_task')
            if t and not t.done():
                try:
                    t.cancel()
                except Exception:
                    pass
            st['grace_task'] = None
            pt = st.get('pair_task')
            if pt and not pt.done():
                try:
                    pt.cancel()
                except Exception:
                    pass
            st['pair_task'] = None

        if existed and not is_stealth:
            publish(
                'bot.roster.delta',
                {
                    'room': room,
                    'action': 'leave',
                    'participant': pid,
                    'count': len(st['participants']),
                },
            )
            if pid != 'local':
                self._emit_immediate_participant_context()

    def on_snapshot(self, topic, payload):
        room = payload.get('room')
        participants = payload.get('participants') or []
        if not room:
            return
        st = self._get_greeting_state()
        st['participants'] = set(participants)
        self.dispatcher.handle_snapshot(room=room, participants=participants)
        publish(
            'bot.roster.snapshot',
            {'room': room, 'participants': participants, 'count': len(participants)},
        )

    def on_identity(self, topic, payload):
        room = payload.get('room') if isinstance(payload, dict) else None
        pid = payload.get('participant') if isinstance(payload, dict) else None
        if not room or room != self.room_url or not pid:
            return

        self.dispatcher.handle_identity(room=room, participant_id=pid, payload=payload)
        self._emit_immediate_participant_context()

    def close(self):
        st = self._get_greeting_state()
        if st:
            t = st.get('grace_task')
            if t and not t.done():
                try:
                    t.cancel()
                except Exception:
                    pass
            st['grace_task'] = None
            
            pt = st.get('pair_task')
            if pt and not pt.done():
                try:
                    pt.cancel()
                except Exception:
                    pass
            st['pair_task'] = None

