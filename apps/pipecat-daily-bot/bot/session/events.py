from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

from core.config import BOT_PID
from session.participant_data import (
    derive_name_and_context_enhanced,
    extract_user_metadata,
    is_stealth_participant,
)
from session.participants import ParticipantManager
from eventbus import (
    emit_first_participant_join,
    emit_participant_join,
    emit_participant_left,
    emit_participants_change,
)
from flows import (
    record_participant_join,
    record_participant_leave,
)
from room.state import (
    get_active_note_id,
    get_active_note_owner,
    get_active_applet_id,
    get_active_applet_owner,
)
from core.transport import get_session_user_id_from_participant

class SessionEventHandlers:
    def __init__(
        self,
        managers: Any,  # SessionManagers
        lifecycle: Any,  # SessionLifecycle
        flow_manager: Any,
        context_agg: Any,
        room_url: str,
    ):
        self.managers = managers
        self.lifecycle = lifecycle
        self.flow_manager = flow_manager
        self.context_agg = context_agg
        self.room_url = room_url
        
        # Diagnostics
        self.seen_upstream_frame_types: set[str] = set()
        
        # Track if we've started the idle timer (only start once after join)
        self._idle_timer_started = False

    def register(self, transport: Any, task: Any):
        """Register all event handlers."""
        
        # Transport events
        transport.event_handler("on_joined")(self.on_joined)
        transport.event_handler("on_first_participant_joined")(self.on_first_participant_joined)
        transport.event_handler("on_participant_joined")(self.on_participant_joined)
        transport.event_handler("on_participant_left")(self.on_participant_left)
        transport.event_handler("on_error")(self.on_error)
        
        # Task events
        task.event_handler("on_frame_reached_upstream")(self.on_frame_reached_upstream)
        task.event_handler("on_frame_reached_downstream")(self.on_frame_reached_downstream)
        
        # Register aliases
        try:
            for alias in ("on_frame", "on_frame_reached"):
                try:
                    task.event_handler(alias)(self.on_frame_reached_upstream)
                except Exception:
                    pass
        except Exception:
            pass
            
        try:
            for alias in ("on_frame_sent", "on_frame_reached_output"):
                try:
                    task.event_handler(alias)(self.on_frame_reached_downstream)
                except Exception:
                    pass
        except Exception:
            pass

    async def on_joined(self, transport, data):
        """Called when the bot has joined the Daily room.
        
        This is the correct time to start the initial idle timer, as the bot
        can now see participants. Starting the timer earlier (at dispatch time)
        causes race conditions where the timer expires before the bot can
        detect existing participants.
        
        We also check for existing participants in case the user joined before
        the bot - if participants exist, we cancel any pending shutdown.
        """
        log = logger.bind(tag="[events]", botPid=BOT_PID)
        log.info(f"[{BOT_PID}] [events] Bot joined room")
        
        # Check for existing participants (user may have joined before bot)
        existing_count = 0
        try:
            if hasattr(transport, 'participants') and callable(transport.participants):
                participants = transport.participants()
                if participants:
                    # Filter out bot participants (usually named "Pearl" or similar)
                    for pid, pdata in participants.items():
                        pinfo = pdata.get('info', {}) if isinstance(pdata, dict) else {}
                        is_local = pdata.get('local', False) if isinstance(pdata, dict) else False
                        user_name = pinfo.get('userName', '')
                        # Skip local (bot) participant
                        if is_local:
                            continue
                        existing_count += 1
                        log.info(f"[{BOT_PID}] [events] Found existing participant: {user_name} ({pid})")
        except Exception as e:
            log.warning(f"[{BOT_PID}] [events] Failed to check existing participants: {e}")
        
        if existing_count > 0:
            log.info(f"[{BOT_PID}] [events] {existing_count} participant(s) already in room - cancelling any pending idle shutdown")
            # Register them with participant manager and cancel idle timer
            self.lifecycle.cancel_pending_shutdown()
        
        # Start the idle timer (if no participants, timer will handle shutdown)
        if not self._idle_timer_started:
            self._idle_timer_started = True
            self.lifecycle.schedule_shutdown(self.lifecycle.initial_idle_secs, "initial_idle")

    async def on_first_participant_joined(self, transport, participant):
        multi_user_aggregator = getattr(self.context_agg, "_multi_user_agg", None)
        name = participant.get('info', {}).get('userName', 'Guest')
        pid = participant.get('id')
        
        # Resolve identity using IdentityManager (same as on_participant_joined)
        try:
            if isinstance(pid, str) and isinstance(participant, dict):
                mapped = await self.managers.identity_manager.resolve_identity(pid, participant)
                
                if mapped:
                    info = participant.get('info')
                    if not isinstance(info, dict):
                        info = {}
                        participant['info'] = info
                    user_data = info.get('userData')
                    if not isinstance(user_data, dict):
                        user_data = {}
                        info['userData'] = user_data
                    # Copy over expected keys from identity mapping
                    for k in ("sessionUserId", "sessionUserName", "sessionUserEmail"):
                        v = mapped.get(k)
                        if isinstance(v, str) and v.strip():
                            user_data[k] = v.strip()
        except Exception as e:
            logger.warning(f"[{BOT_PID}] [participants.identity] Failed to apply identity mapping in first_join: {e}")

        # Log raw payload and lookup meta for shape discovery (scrubbed)
        try:
            if isinstance(participant, dict):
                # DEBUG: Check for userData specifically
                info_block = participant.get('info', {})
                logger.info(f"[{BOT_PID}] [participants.debug] first_join keys={list(participant.keys())} info_keys={list(info_block.keys()) if isinstance(info_block, dict) else 'not_dict'}")
                logger.info(f"[{BOT_PID}] [participants.debug] first_join userData check: top={participant.get('userData') is not None} info={info_block.get('userData') is not None if isinstance(info_block, dict) else False}")
                
                logger.info(
                    f"[{BOT_PID}] [participants.debug] first_join raw={ParticipantManager.scrub_value(None, participant)}"
                )
            if pid:
                meta = self.managers.participant_manager.lookup_participant_meta(pid)
                if meta is not None:
                    logger.info(
                        f"[{BOT_PID}] [participants.debug] first_join.lookup pid={pid} meta={ParticipantManager.scrub_value(None, meta)}"
                    )
        except Exception:
            pass
        logger.info(f"[{BOT_PID}] First participant joined: {pid} name={name}")
        if self.flow_manager and hasattr(self.flow_manager, "initialize"):
            logger.debug(f"[{BOT_PID}] Initializing flow")
            await self.flow_manager.initialize()
        try:
            if pid and multi_user_aggregator:
                # Map the participant ID to username in our aggregator
                multi_user_aggregator.set_participant_name(pid, name)
                # Use enhanced name derivation with profile loading for first participant too
                pname, pctx = await derive_name_and_context_enhanced(
                    pid, participant, self.managers.participant_manager.lookup_participant_meta
                )
                # Backfill session_metadata into live participant payload so downstream checks (e.g., private session)
                # can read it from transport snapshots.
                try:
                    session_metadata = pctx.get('session_metadata') if isinstance(pctx, dict) else None
                    if isinstance(session_metadata, dict):
                        info = participant.get('info') if isinstance(participant.get('info'), dict) else {}
                        if not isinstance(info, dict):
                            info = {}
                        participant['info'] = info
                        user_data = info.get('userData') if isinstance(info.get('userData'), dict) else {}
                        if not isinstance(user_data, dict):
                            user_data = {}
                        info['userData'] = user_data
                        if 'session_metadata' not in user_data:
                            user_data['session_metadata'] = session_metadata
                            logger.debug(f"[{BOT_PID}] [participants.debug] first_join backfilled session_metadata for pid={pid}")
                except Exception as inner:
                    logger.debug(f"[{BOT_PID}] [participants.debug] first_join backfill failed: {inner}")
                emit_first_participant_join(self.room_url, pid, pname, pctx)
                # Capture transcription for the participant
                await transport.capture_participant_transcription(pid)
            # Greeting + transcription now handled by eventbus business handlers
        except Exception as e:
            logger.error(f"[{BOT_PID}] Error in first participant handler: {e}")

    async def on_participant_joined(self, transport, participant):
        multi_user_aggregator = getattr(self.context_agg, "_multi_user_agg", None)
        pid = participant.get('id') if isinstance(participant, dict) else None
        is_local = bool(participant.get('local')) if isinstance(participant, dict) else False
        
        # Resolve identity using IdentityManager
        try:
            if isinstance(pid, str) and isinstance(participant, dict):
                mapped = await self.managers.identity_manager.resolve_identity(pid, participant)
                
                if mapped:
                    info = participant.get('info')
                    if not isinstance(info, dict):
                        info = {}
                        participant['info'] = info
                    user_data = info.get('userData')
                    if not isinstance(user_data, dict):
                        user_data = {}
                        info['userData'] = user_data
                    # Copy over expected keys from identity mapping
                    for k in ("sessionUserId", "sessionUserName", "sessionUserEmail"):
                        v = mapped.get(k)
                        if isinstance(v, str) and v.strip():
                            user_data[k] = v.strip()
        except Exception as e:
            logger.warning(f"[{BOT_PID}] [participants.identity] Failed to apply identity mapping: {e}")

        # Use enhanced name derivation with profile loading (now sees merged userData)
        pname, pctx = await derive_name_and_context_enhanced(
            pid, participant, self.managers.participant_manager.lookup_participant_meta
        )

        # Backfill session_metadata into live participant payload so downstream checks (e.g., private session)
        # can read it from transport snapshots.
        try:
            session_metadata = pctx.get('session_metadata') if isinstance(pctx, dict) else None
            if isinstance(session_metadata, dict):
                info = participant.get('info') if isinstance(participant.get('info'), dict) else {}
                if not isinstance(info, dict):
                    info = {}
                participant['info'] = info
                user_data = info.get('userData') if isinstance(info.get('userData'), dict) else {}
                if not isinstance(user_data, dict):
                    user_data = {}
                info['userData'] = user_data
                if 'session_metadata' not in user_data:
                    user_data['session_metadata'] = session_metadata
                    logger.debug(f"[{BOT_PID}] [participants.debug] join backfilled session_metadata for pid={pid}")
        except Exception as inner:
            logger.debug(f"[{BOT_PID}] [participants.debug] join backfill failed: {inner}")

        # Extract user metadata for logging
        user_metadata = extract_user_metadata(participant, self.managers.participant_manager.lookup_participant_meta, pid)
        stealth_join = is_stealth_participant(pid or "", pname, pctx)

        if not is_local:
            record_participant_join(
                self.flow_manager,
                pid,
                pname,
                pctx,
                stealth=stealth_join,
            )
        # Stealth suppression: ignore stealth participants entirely (no events, no roster)
        try:
            if stealth_join:
                logger.info(f"[{BOT_PID}] [participants] stealth join detected pid={pid}")
                await self.managers.participant_manager.add_stealth_participant(pid)
                self.lifecycle.cancel_pending_shutdown()
                return
        except Exception:
            pass

        # Log raw payload and lookup meta for shape discovery (scrubbed)
        try:
            if isinstance(participant, dict):
                # DEBUG: Check for userData specifically
                info_block = participant.get('info', {})
                logger.info(f"[{BOT_PID}] [participants.debug] join keys={list(participant.keys())} info_keys={list(info_block.keys()) if isinstance(info_block, dict) else 'not_dict'}")
                logger.info(f"[{BOT_PID}] [participants.debug] join userData check: top={participant.get('userData') is not None} info={info_block.get('userData') is not None if isinstance(info_block, dict) else False}")

                logger.info(f"[{BOT_PID}] [participants.debug] join raw={ParticipantManager.scrub_value(None, participant)}")
            if pid:
                meta = self.managers.participant_manager.lookup_participant_meta(pid)
                if meta is not None:
                    logger.info(
                        f"[{BOT_PID}] [participants.debug] join.lookup pid={pid} meta={ParticipantManager.scrub_value(None, meta)}"
                    )
            # Log extracted user metadata and profile status for debugging
            if user_metadata:
                has_profile = pctx and pctx.get("has_user_profile", False)
                logger.info(
                    f"[{BOT_PID}] [participants.metadata] pid={pid} session_user_id={user_metadata.get('session_user_id')} session_user_name={user_metadata.get('session_user_name')} has_profile={has_profile}"
                )
            else:
                logger.info(f"[{BOT_PID}] [participants.metadata] pid={pid} no_user_metadata_found")
        except Exception:
            pass
        logger.info(f"[{BOT_PID}] Participant joined: {pid} name={pname} local={is_local}")
        if not pid:
            return
        if is_local:
            if not self.managers.participant_manager.local_bot_id:
                self.managers.participant_manager.local_bot_id = pid
                logger.info(f"[{BOT_PID}] [participants] detected local bot id={self.managers.participant_manager.local_bot_id}")
            return
        was_empty = self.managers.participant_manager.human_count() == 0
        
        # Acquire lock to prevent race with reconcile_loop
        async with self.managers.participant_manager.active_participants_lock:
            if pid not in self.managers.participant_manager.active_participants:
                self.managers.participant_manager.active_participants.add(pid)
                try:
                    if multi_user_aggregator:
                        # Map the participant ID to username in our aggregator
                        multi_user_aggregator.set_participant_name(pid, pname)
                    emit_participant_join(self.room_url, pid, pname, pctx)
                    # Capture transcription for the participant
                    await transport.capture_participant_transcription(pid)
                except Exception:
                    pass
        
        try:
            logger.info(f"[{BOT_PID}] [participants] join id={pid} count={self.managers.participant_manager.human_count()}")
        except Exception:
            pass
        if was_empty:
            self.lifecycle.cancel_pending_shutdown()
        else:
            try:
                emit_participants_change(self.room_url, sorted(list(self.managers.participant_manager.get_active_participants())))
            except Exception:
                pass
        
        # PHASE 2: Share current note/applet with new joiner
        try:
            from tools.sharing.utils import _share_resource_with_single_user
            
            # Get user ID of joining participant
            user_data = participant.get('info', {}).get('userData', {}) if isinstance(participant, dict) else {}
            user_id = user_data.get('sessionUserId') if isinstance(user_data, dict) else None
            
            if user_id:
                # Share current note if active
                note_id = await get_active_note_id(self.room_url)
                note_owner = await get_active_note_owner(self.room_url)
                if note_id:
                    await _share_resource_with_single_user(
                        room_url=self.room_url,
                        resource_id=note_id,
                        content_type='Notes',
                        user_id=user_id,
                        owner_user_id=note_owner or "unknown"
                    )
                    logger.info(f"[{BOT_PID}] [sharing] Shared active note {note_id} with new joiner {user_id}")
                
                # Share current applet if active
                applet_id = await get_active_applet_id(self.room_url)
                applet_owner = await get_active_applet_owner(self.room_url)
                if applet_id:
                    await _share_resource_with_single_user(
                        room_url=self.room_url,
                        resource_id=applet_id,
                        content_type='HtmlGeneration',
                        user_id=user_id,
                        owner_user_id=applet_owner or "unknown"
                    )
                    logger.info(f"[{BOT_PID}] [sharing] Shared active applet {applet_id} with new joiner {user_id}")
        except Exception as e:
            logger.error(f"[{BOT_PID}] [sharing] Failed to share resources with new joiner: {e}", exc_info=True)

    async def on_participant_left(self, transport, participant, reason):
        pid = participant.get('id')
        is_local = bool(participant.get('local')) if isinstance(participant, dict) else False
        record_participant_leave(self.flow_manager, pid)
        logger.info(f"[{BOT_PID}] Participant left: {pid}, reason: {reason} local={is_local}")
        if not pid:
            return
        if is_local and self.managers.participant_manager.local_bot_id == pid:
            self.managers.participant_manager.local_bot_id = None
            return
        
        # Acquire lock to prevent race with reconcile_loop
        async with self.managers.participant_manager.active_participants_lock:
            # Check if this participant owns the active note
            if pid in self.managers.participant_manager.active_participants:
                self.managers.participant_manager.active_participants.discard(pid)
                try:
                    emit_participant_left(self.room_url, pid, reason)
                except Exception:
                    pass
            
            # Also remove from stealth participants if present
            self.managers.participant_manager.stealth_participants.discard(pid)
            
            # Note closure logic: check if leaving participant is note owner
            try:
                active_note_owner = await get_active_note_owner(self.room_url)
                if active_note_owner:
                    # Get user ID of leaving participant
                    leaving_user_id = get_session_user_id_from_participant(pid)
                    
                    # Compare with note owner (note owner is stored as userId)
                    if leaving_user_id and leaving_user_id == active_note_owner:
                        logger.info(f"[{BOT_PID}] [notes] Note owner {leaving_user_id} left the call, scheduling note closure")
                        
                        # Schedule delayed note closure (5 seconds)
                        async def delayed_note_closure():
                            await asyncio.sleep(5)
                            
                            # Check if owner rejoined (acquire lock for read access)
                            owner_participant_id = None
                            async with self.managers.participant_manager.active_participants_lock:
                                for active_pid in self.managers.participant_manager.active_participants:
                                    active_user_id = get_session_user_id_from_participant(active_pid)
                                    if active_user_id == active_note_owner:
                                        owner_participant_id = active_pid
                                        break
                            
                            if owner_participant_id:
                                logger.info(f"[{BOT_PID}] [notes] Note owner {active_note_owner} rejoined, cancelling note closure")
                                return
                            
                            # Owner hasn't rejoined, close the note
                            logger.info(f"[{BOT_PID}] [notes] Closing note after owner departure")
                            
                            # Get participant name for voice message
                            participant_name = participant.get('info', {}).get('userName', 'the user')
                            
                            # Queue voice message
                            voice_message = f"Looks like {participant_name} left the conversation, I'll need to close the active note."
                            logger.info(f"[{BOT_PID}] [notes] Voice confirmation: {voice_message}")
                            
                            # Emit event via app-message if forwarder available
                            # (This would notify the frontend to clear UI indicators)
                        
                        # Start the delayed closure task
                        asyncio.create_task(delayed_note_closure())
                        
            except Exception as e:
                logger.error(f"[{BOT_PID}] [notes] Error in note closure logic: {e}")
        
        try:
            logger.info(f"[{BOT_PID}] [participants] left id={pid} count={self.managers.participant_manager.human_count()}")
        except Exception:
            pass
        
        total_count = self.managers.participant_manager.human_count() + self.managers.participant_manager.stealth_count()
        if total_count == 0:
            self.lifecycle.schedule_shutdown(self.lifecycle.post_leave_idle_secs, "post_leave_idle")
        else:
            self.lifecycle.cancel_pending_shutdown()
        try:
            emit_participants_change(self.room_url, sorted(list(self.managers.participant_manager.get_active_participants())))
        except Exception:
            pass

    async def on_error(self, transport, error):
        logger.error(f"[{BOT_PID}] Daily transport error: {error}")
        # Don't cancel the task on transport errors, let it recover

    async def on_frame_reached_upstream(self, task, frame):
        if hasattr(frame, '__class__'):
            frame_type = frame.__class__.__name__

            # Log new frame types for debugging (removed temp debug logging)
            if frame_type not in self.seen_upstream_frame_types:
                logger.debug(f"[{BOT_PID}] [Frame Debug] New upstream frame type: {frame_type}")
                if hasattr(frame, '__dict__'):
                    frame_attrs = [attr for attr in dir(frame) if not attr.startswith('_')]
                    logger.debug(f"[{BOT_PID}] [Frame Debug] {frame_type} attributes: {frame_attrs}")

            # Check for app message frames
            if "MessageFrame" in frame_type or "TransportMessageFrame" in frame_type:
                logger.info(f"[{BOT_PID}] 📨 Received message frame: {frame_type}")
                try:
                    if hasattr(frame, 'message'):
                        message = frame.message
                        logger.info(f"[{BOT_PID}] 📨 Message frame content: {message}")
                        # Process the app message through the managers
                        self.managers.handle_app_message(message)
                    else:
                        logger.warning(f"[{BOT_PID}] 📨 Message frame {frame_type} has no 'message' attribute")
                        # Log all attributes to debug
                        attrs = {
                            attr: getattr(frame, attr, None)
                            for attr in dir(frame)
                            if not attr.startswith('_')
                        }
                        logger.debug(f"[{BOT_PID}] 📨 Frame attributes: {attrs}")
                except Exception as e:
                    logger.error(f"[{BOT_PID}] 📨 Error processing message frame: {e}")
                    logger.exception(e)
                return  # Don't process as other frame types

            # Log first occurrences of frame types to learn actual names
            try:
                if (
                    len(self.seen_upstream_frame_types) < 30
                    and frame_type not in self.seen_upstream_frame_types
                ):
                    self.seen_upstream_frame_types.add(frame_type)
                    logger.info(f"[{BOT_PID}] 📦 Upstream frame type: {frame_type}")
            except Exception:
                pass
            if "Interruption" in frame_type or "Speaking" in frame_type:
                logger.info(f"[{BOT_PID}] 🔊 Interruption event: {frame_type}")
                # Try to infer speaking toggles from frame type names (best-effort)
            if "Transcription" in frame_type or "Text" in frame_type:
                logger.info(f"[{BOT_PID}] 📝 STT event: {frame_type}")
            # Broaden audio/mic detection across common frame names and payload shapes
            audio_name_hints = ("Audio", "PCM", "Pcm", "Pcm16", "Wave", "Wav", "Mic", "Input")
            has_audioish_name = any(hint in frame_type for hint in audio_name_hints)
            if has_audioish_name:
                # Only log; do not mark speaking based on name alone (frames can flow during silence)
                logger.info(f"[{BOT_PID}] 🎵 Audio-like event: {frame_type}")

    async def on_frame_reached_downstream(self, task, frame):
        if hasattr(frame, '__class__'):
            frame_type = frame.__class__.__name__
            if "Interruption" in frame_type or "Speaking" in frame_type:
                logger.info(f"[{BOT_PID}] 🔊 Downstream interruption event: {frame_type}")
            elif "Transcription" in frame_type or "Text" in frame_type:
                logger.info(f"[{BOT_PID}] 📝 Downstream STT event: {frame_type}")
            elif "Audio" in frame_type or "PCM" in frame_type or "Pcm" in frame_type:
                logger.info(f"[{BOT_PID}] 🎵 Downstream audio event: {frame_type}")
