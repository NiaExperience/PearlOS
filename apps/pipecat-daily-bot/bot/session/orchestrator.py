from __future__ import annotations

import asyncio
import os
from typing import Any

from loguru import logger

from core.config import BOT_PID
from session.initialization import initialize_session_config
from session.managers import SessionManagers
from session.lifecycle import SessionLifecycle
from session.events import SessionEventHandlers
from handlers import register_default_handlers
from flows import initialize_base_flow, collect_timer_settings
from flows.registry import unregister_flow_manager
from room.state import set_active_note_id, get_active_note_id, clear_room_state
from session.config_listener import start_config_listener

try:
    from bot.pipeline.builder import build_pipeline
except ImportError:
    try:
        from pipeline.builder import build_pipeline
    except ImportError:
        # Fallback for when running as a script in the same directory
        import sys
        from pathlib import Path
        # Add parent directory to path if not present
        parent_dir = str(Path(__file__).parent.parent)
        if parent_dir not in sys.path:
            sys.path.append(parent_dir)
        from pipeline.builder import build_pipeline

async def run_pipeline_session(
    room_url: str,
    personalityId: str,
    persona: str,
    token: str | None = None,
    tenantId: str | None = None,
    voiceId: str | None = None,
    modePersonalityVoiceConfig: dict[str, Any] | None = None,
    supportedFeatures: list[str] | None = None,
    sessionOverride: dict[str, Any] | None = None,
    isOnboarding: bool = False,
    headless: bool = False,
    session_id: str | None = None,
):
    log = logger.bind(
        tag="[orchestrator]",
        botPid=BOT_PID,
        roomUrl=room_url,
        sessionId=session_id,
    )

    log.info(f"[{BOT_PID}] Connecting to Daily room: {room_url}")
    
    # Clear any stale Redis state for this room
    await clear_room_state(room_url)

    # Apply session override if present (Force mode/personality/voice)
    # We do this BEFORE initialization so we fetch the correct personality record
    if sessionOverride and sessionOverride.get("mode") and modePersonalityVoiceConfig:
        override_mode = sessionOverride.get("mode")
        if override_mode in modePersonalityVoiceConfig:
            log.info(f"[{BOT_PID}] Applying session override for mode: {override_mode}")
            mode_config = modePersonalityVoiceConfig[override_mode]
            
            if "personaName" in mode_config:
                persona = mode_config["personaName"]
            if "personalityId" in mode_config:
                personalityId = mode_config["personalityId"]
            
            if "voice" in mode_config:
                v_conf = mode_config["voice"]
                if "voiceId" in v_conf:
                    voiceId = v_conf["voiceId"]
    
    # 1. Initialization & Config
    config = await initialize_session_config(room_url, personalityId, tenantId)
    
    # 2. Pipeline Construction
    # Dynamically resolve builder so tests can monkeypatch package-level build_pipeline
    try:
        import importlib
        pkg = importlib.import_module('bot')
        builder = getattr(pkg, 'build_pipeline', build_pipeline)
    except Exception:
        builder = build_pipeline

    # Support both (room_url, personality, token, tenantId) and (room_url, personality)
    tts = None
    try:
        build_result = await builder(
            room_url,
            persona,
            personalityId,
            token,
            config.personality_record,
            preloaded_prompts=config.preloaded_prompt_payload,
            voiceId=voiceId,
            modePersonalityVoiceConfig=modePersonalityVoiceConfig,
            supportedFeatures=supportedFeatures,
            sessionOverride=sessionOverride,
            isOnboarding=isOnboarding,
        )
    except TypeError:
        # Older builder signature without new prompt param or mode config
        try:
            build_result = await builder(
                room_url,
                persona,
                personalityId,
                token,
                config.personality_record,
                preloaded_prompts=config.preloaded_prompt_payload,
                voiceId=voiceId,
                modePersonalityVoiceConfig=modePersonalityVoiceConfig,
                supportedFeatures=supportedFeatures,
                sessionOverride=sessionOverride,
            )
        except TypeError:
            try:
                build_result = await builder(
                    room_url,
                    persona,
                    personalityId,
                    token,
                    config.personality_record,
                    preloaded_prompts=config.preloaded_prompt_payload,
                    voiceId=voiceId,
                    modePersonalityVoiceConfig=modePersonalityVoiceConfig,
                )
            except TypeError:
                try:
                    build_result = await builder(
                        room_url,
                        persona,
                        personalityId,
                        token,
                        config.personality_record,
                        preloaded_prompts=config.preloaded_prompt_payload,
                        voiceId=voiceId,
                    )
                except TypeError:
                     build_result = await builder(room_url, persona, personalityId, None, None)

    if len(build_result) == 11:
        (
            _pipeline,
            task,
            context_agg,
            transport,
            messages,
            multi_user_aggregator,
            context,
            personality_message,
            flow_manager,
            forwarder_ref,
            tts
        ) = build_result
    else:
        (
            _pipeline,
            task,
            context_agg,
            transport,
            messages,
            multi_user_aggregator,
            context,
            personality_message,
            flow_manager,
            forwarder_ref
        ) = build_result
            
    log.info(f'[{BOT_PID}] Pipeline constructed')
    
    # Test hook: store globally for tests wanting access to fake transport
    if os.getenv('BOT_TEST_EXPOSE_OBJECTS'):
        try:
            globals()['_LAST_TRANSPORT'] = transport
            globals()['_LAST_TASK'] = task
        except Exception:
            pass

    # 3. Register Business Handlers
    handlers_unsub = register_default_handlers(
        room_url=room_url,
        task=task,
        context_agg=context_agg,
        messages=messages,
        context=context,
        personality_message=personality_message,
        transport=transport,
        personality_record=config.personality_record,
        persona=persona,
        flow_manager=flow_manager,
        set_active_note_id=set_active_note_id,
        get_active_note_id=get_active_note_id,
    )

    # 4. Initialize Flow
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"
    timer_settings = collect_timer_settings()
    try:
        await initialize_base_flow(
            flow_manager,
            personality_message=personality_message,
            timer_settings=timer_settings,
            personality_record=config.personality_record,
            room=room_url,
        )
    except Exception as err:
        log.error(f"[{BOT_PID}] Failed to initialize FlowManager: {err}")

    # 5. Patch Transport
    try:
        from pipecat.transports.daily import transport as _daily_mod  # type: ignore

        if not getattr(_daily_mod, "_nia_send_patch", False):
            _orig_send_message = _daily_mod.DailyOutputTransport.send_message

            async def _patched_send_message(self, frame):  # type: ignore
                try:
                    if hasattr(frame, "participant_id") and frame.participant_id.lower() == "api":
                        frame.participant_id = None  # broadcast
                except Exception:
                    pass
                return await _orig_send_message(self, frame)

            _daily_mod.DailyOutputTransport.send_message = _patched_send_message  # type: ignore
            _daily_mod._nia_send_patch = True
            log.info(
                f"[{BOT_PID}] [patch] Applied DailyOutputTransport.send_message participant_id 'api' broadcast normalization (speaking hooks removed)"
            )
    except Exception as e:  # pragma: no cover
        log.warning(f"[{BOT_PID}] [patch] Failed to apply Daily send patch: {e}")

    # 6. Initialize Managers
    managers = SessionManagers(
        room_url,
        transport,
        forwarder_ref,
        session_id=session_id,
    )
    
    # Register managers globally for tool access
    try:
        from core.transport import set_managers
        set_managers(managers)
    except ImportError:
        log.debug(f"[{BOT_PID}] core.transport.set_managers unavailable; skipping")

    await managers.start()
    
    # Start config listener
    if tts:
        log.info(f"[{BOT_PID}] Starting config listener")
        # Keep a reference to the task to prevent garbage collection
        managers.config_listener_task = asyncio.create_task(
            start_config_listener(tts, context, flow_manager, room_url, task, sessionOverride=sessionOverride, supported_features=supportedFeatures)
        )
    
    # Expose aggregator for callers (e.g., run_pipeline_session event handlers)
    try:
        context_agg._multi_user_agg = multi_user_aggregator
    except Exception:
        log.warning(f'[{BOT_PID}] Failed to attach multi_user_aggregator to context_agg (non-fatal)')

    # 7. Lifecycle & Events
    lifecycle = SessionLifecycle(
        managers.participant_manager,
        task,
        room_url=room_url,
        session_id=session_id,
        headless=headless,
    )
    
    # NOTE: Initial idle shutdown is now scheduled AFTER transport joins the room
    # (see transport "on_joined" handler below). This prevents race conditions where
    # the timer starts before the bot has actually joined Daily and can see participants.
    
    event_handlers = SessionEventHandlers(
        managers=managers,
        lifecycle=lifecycle,
        flow_manager=flow_manager,
        context_agg=context_agg,
        room_url=room_url
    )
    event_handlers.register(transport, task)
    
    # Emit call state
    from eventbus import emit_call_state
    log.info(f'[{BOT_PID}] Emitting call state "starting"...')
    emit_call_state(room_url, "starting")

    # 8. Run Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    runner = PipelineRunner()
    
    try:
        await runner.run(task)
    except Exception as e:
        log.error(f"[{BOT_PID}] Pipeline runner error: {e}")
    finally:
        log.info(f"[{BOT_PID}] Bot session ended")
        
        # Generate and save conversation summary
        await lifecycle.save_conversation_summary(
            context_agg, 
            transport, 
            room_url, 
            config.personality_record, 
            persona,
            session_id=session_id,
        )
        
        lifecycle.cancel_pending_shutdown()
        
        try:
            handlers_unsub()
        except Exception:
            pass
            
        await managers.stop()

        try:
            unregister_flow_manager(room_url)
        except Exception:
            log.debug(f"[{BOT_PID}] Failed to unregister FlowManager for room {room_url}")
