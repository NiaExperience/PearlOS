import asyncio
import json
import os
import hashlib
from loguru import logger
import redis.asyncio as redis
from core.config import BOT_PID
from core.prompts import MULTI_USER_NOTE, SMART_SILENCE_NOTE
from actions import personality_actions
from room.state import get_room_tenant_id, set_desktop_mode
from tools.sprite_bot_config import set_bot_config, clear_bot_config
from providers.elevenlabs import ElevenLabsTTSService
from providers.kokoro import KokoroTTSService
from pipecat.frames.frames import ManuallySwitchServiceFrame

# Track last applied config hash to deduplicate repeated configs
_last_config_hash: str | None = None

# Lock for personality switching to prevent race conditions
_personality_switch_lock = asyncio.Lock()


def _context_logger(room_url: str):
    session_id = os.getenv("BOT_SESSION_ID")
    user_id = os.getenv("BOT_SESSION_USER_ID")
    user_name = os.getenv("BOT_SESSION_USER_NAME")
    return logger.bind(roomUrl=room_url, sessionId=session_id, userId=user_id, userName=user_name)


async def start_config_listener(
    tts_service,
    context,
    flow_manager,
    room_url,
    task=None,
    sessionOverride=None,
    supported_features=None,
):
    """
    Listen for configuration updates on Redis channel bot:config:room:{room_url}
    Also checks for any pending config on startup.
    """
    log = _context_logger(room_url)

    if os.getenv("USE_REDIS", "false").lower() != "true":
        log.info(f"[{BOT_PID}] [session.config] USE_REDIS not true; skipping config listener")
        return

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    password = (
        os.getenv("REDIS_SHARED_SECRET")
        if os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true"
        else None
    )

    try:
        r = redis.from_url(redis_url, password=password, decode_responses=True)

        # 1. Check for pending config immediately
        config_key = f"bot:config:latest:{room_url}"
        pending_config = await r.get(config_key)
        if pending_config:
            try:
                data = json.loads(pending_config)
                log.info(f"[{BOT_PID}] [session.config] Found pending config on startup: {data}")
                await apply_config_update(
                    data,
                    tts_service,
                    context,
                    flow_manager,
                    room_url,
                    task,
                    sessionOverride,
                    supported_features,
                    log,
                )
                # Optional: delete the key so we don't re-apply it?
                # No, keep it for a bit in case of restarts, it expires anyway.
            except Exception as e:
                log.error(f"[{BOT_PID}] [session.config] Failed to process pending config: {e}")

        # 2. Subscribe to real-time updates
        pubsub = r.pubsub()
        # Subscribe to room-based channel
        channel = f"bot:config:room:{room_url}"
        await pubsub.subscribe(channel)

        log.info(f"[{BOT_PID}] [session.config] Listening for config updates on {channel}")

        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    global _last_config_hash
                    raw_data = message["data"]
                    
                    # Deduplicate: skip if this config matches the last one we processed
                    config_hash = hashlib.sha256(raw_data if isinstance(raw_data, bytes) else raw_data.encode()).hexdigest()[:16]
                    if config_hash == _last_config_hash:
                        log.info(f"[{BOT_PID}] [session.config] Skipping duplicate config (hash={config_hash[:8]})")
                        continue
                    _last_config_hash = config_hash
                    
                    data = json.loads(raw_data)
                    log.info(f"[{BOT_PID}] [session.config] Received config update: {data}")
                    await apply_config_update(
                        data,
                        tts_service,
                        context,
                        flow_manager,
                        room_url,
                        task,
                        sessionOverride,
                        supported_features,
                        log,
                    )
                except Exception as e:
                    log.error(f"[{BOT_PID}] [session.config] Failed to process config update: {e}")
    except Exception as e:
        log.error(f"[{BOT_PID}] [session.config] Config listener failed: {e}")


async def apply_config_update(
    config,
    tts_service,
    context,
    flow_manager,
    room_url,
    task=None,
    sessionOverride=None,
    supported_features=None,
    log=None,
):
    log = log or _context_logger(room_url)
    # 0. Check for Session Override Lock
    if sessionOverride and sessionOverride.get("locked"):
        override_mode = sessionOverride.get("mode")
        incoming_mode = config.get("mode")

        # If locked, we generally reject mode switches that don't match the override
        # Specifically, if incoming mode is None (implicit default) or different from override
        if incoming_mode != override_mode:
            log.warning(
                f"[{BOT_PID}] [session.config] Ignoring config update (mode={incoming_mode}) due to locked session override (mode={override_mode})"
            )
            return
    # 1. Handle Mode Switch (Static Path)
    target_service = None

    if config.get("mode") and hasattr(tts_service, "mode_map"):
        mode = config["mode"]
        log.info(f"[{BOT_PID}] [session.config] Received mode switch request: {mode}")

        # Track the mode change in Redis
        await set_desktop_mode(room_url, mode)

        if mode in tts_service.mode_map:
            index = tts_service.mode_map[mode]
            log.info(f"[{BOT_PID}] [session.config] Switching to service index {index} for mode '{mode}'")

            # Resolve the service instance
            if (
                hasattr(tts_service, "services")
                and isinstance(tts_service.services, list)
                and 0 <= index < len(tts_service.services)
            ):
                target_service = tts_service.services[index]

                if task:
                    # Pass the actual service object, not the index
                    await task.queue_frame(ManuallySwitchServiceFrame(target_service))
                else:
                    log.warning(f"[{BOT_PID}] [session.config] Cannot switch service: task is None")
            else:
                log.warning(f"[{BOT_PID}] [session.config] Invalid service index {index} or services list missing")

            # Do NOT return early, so we can apply voice/personality updates
        else:
            log.warning(f"[{BOT_PID}] [session.config] Mode '{mode}' not found in mode_map: {tts_service.mode_map}")

    # 1.5 Implicit Service Switch based on Provider (Fallback for Legacy Mode / Missing Mode Map)
    # If we haven't switched services yet, but we have a specific provider requested, try to find it.
    if not target_service and config.get("voiceProvider") and hasattr(tts_service, "services"):
        # Only do this if we are in a switcher (list of services)
        if isinstance(tts_service.services, list):
            provider = config["voiceProvider"]
            target_index = -1

            for i, svc in enumerate(tts_service.services):
                is_kokoro = isinstance(svc, KokoroTTSService)
                is_eleven = isinstance(svc, ElevenLabsTTSService)

                if provider == "kokoro" and is_kokoro:
                    target_index = i
                    break
                if provider in ["elevenlabs", "11labs"] and is_eleven:
                    target_index = i
                    break

            if target_index >= 0:
                log.info(
                    f"[{BOT_PID}] [session.config] Implicitly switching to service index {target_index} for provider '{provider}'"
                )
                target_service = tts_service.services[target_index]
                if task:
                    await task.queue_frame(ManuallySwitchServiceFrame(target_service))
                else:
                    log.warning(f"[{BOT_PID}] [session.config] Cannot switch service: task is None")

    # Update Voice
    if config.get("voice"):
        new_voice = config["voice"]
        voice_provider = config.get("voiceProvider") or os.getenv("BOT_TTS_PROVIDER")

        # Handle case where voice is a config object (from frontend) rather than just an ID string
        voice_id_to_set = new_voice
        voice_params_to_set = None

        if isinstance(new_voice, dict):
            log.info(f"[{BOT_PID}] [session.config] Received voice config object: {new_voice}")
            voice_id_to_set = new_voice.get("voiceId")
            voice_params_to_set = new_voice
        else:
            log.info(f"[{BOT_PID}] [session.config] Updating voice to {new_voice} (provider: {voice_provider})")

        if voice_id_to_set:
            try:
                updated = False

                # 1. If we identified a target service from mode switch, use it
                if target_service and hasattr(target_service, "set_voice"):
                    await target_service.set_voice(voice_id_to_set)
                    log.info(
                        f"[{BOT_PID}] [session.config] Updated voice on target service for mode '{config.get('mode')}'"
                    )
                    updated = True

                # 2. Else if tts_service IS the service (no switcher)
                elif hasattr(tts_service, "set_voice"):
                    await tts_service.set_voice(voice_id_to_set)
                    updated = True

                # 3. Else if we are using ServiceSwitcher but didn't switch mode (or couldn't resolve service)
                elif hasattr(tts_service, "services"):
                    # Safety check: if we have a mode_map, we shouldn't broadcast voice updates to all services
                    # because they might be different providers (e.g. Kokoro vs ElevenLabs).
                    if hasattr(tts_service, "mode_map") and tts_service.mode_map:
                        log.warning(
                            f"[{BOT_PID}] [session.config] Skipping voice update broadcast because mode_map is present but no specific mode/service was targeted. Please include 'mode' in config update."
                        )
                    else:
                        # Update services in the switcher, filtering by provider if known
                        count = 0
                        # services can be a dict or list depending on implementation, usually dict for ServiceSwitcher
                        services_iter = (
                            tts_service.services.values()
                            if isinstance(tts_service.services, dict)
                            else tts_service.services
                        )

                        for svc in services_iter:
                            # Filter by provider if voiceProvider is specified
                            if voice_provider:
                                is_kokoro = isinstance(svc, KokoroTTSService)
                                is_eleven = isinstance(svc, ElevenLabsTTSService)

                                if voice_provider == "kokoro" and not is_kokoro:
                                    continue
                                if voice_provider in ["elevenlabs", "11labs"] and not is_eleven:
                                    continue

                            if hasattr(svc, "set_voice"):
                                await svc.set_voice(voice_id_to_set)
                                count += 1
                        if count > 0:
                            log.info(
                                f"[{BOT_PID}] [session.config] Updated voice on {count} services in switcher (provider filter: {voice_provider})"
                            )
                            updated = True

                # 4. Legacy fallback (direct attribute access)
                if not updated:
                    if hasattr(tts_service, "_voice_id"):
                        tts_service._voice_id = voice_id_to_set
                        updated = True
                    elif hasattr(tts_service, "voice_id"):
                        tts_service.voice_id = voice_id_to_set
                        updated = True

                if not updated:
                    log.warning(
                        f"[{BOT_PID}] [session.config] TTS service does not support voice update (no set_voice or voice_id attribute found)"
                    )

            except Exception as e:
                log.error(f"[{BOT_PID}] [session.config] Failed to update voice: {e}")

        # If we extracted parameters from the voice object, apply them now
        if voice_params_to_set:
            log.info(
                f"[{BOT_PID}] [session.config] Applying voice parameters from voice object: {voice_params_to_set}"
            )
            try:
                updated_params = False

                # 1. Target service
                if target_service and hasattr(target_service, "set_voice_parameters"):
                    await target_service.set_voice_parameters(voice_params_to_set)
                    updated_params = True

                # 2. Direct service
                elif hasattr(tts_service, "set_voice_parameters"):
                    await tts_service.set_voice_parameters(voice_params_to_set)
                    updated_params = True

                # 3. Switcher services
                elif hasattr(tts_service, "services"):
                    services_iter = (
                        tts_service.services.values()
                        if isinstance(tts_service.services, dict)
                        else tts_service.services
                    )
                    for svc in services_iter:
                        if hasattr(svc, "set_voice_parameters"):
                            await svc.set_voice_parameters(voice_params_to_set)
                            updated_params = True

                if updated_params:
                    log.info(f"[{BOT_PID}] [session.config] Successfully applied voice parameters from voice object")
                else:
                    log.warning(
                        f"[{BOT_PID}] [session.config] Could not apply voice parameters (no set_voice_parameters method found)"
                    )
            except Exception as e:
                log.error(f"[{BOT_PID}] [session.config] Failed to apply voice parameters from object: {e}")

    # Update Voice Parameters
    if config.get("voiceParameters"):
        voice_params = config["voiceParameters"]
        log.info(f"[{BOT_PID}] [session.config] Updating voice parameters: {voice_params}")

        try:
            updated = False

            # 1. If we identified a target service from mode switch, use it
            if target_service and hasattr(target_service, "set_voice_parameters"):
                await target_service.set_voice_parameters(voice_params)
                log.info(
                    f"[{BOT_PID}] [session.config] Updated voice parameters on target service for mode '{config.get('mode')}'"
                )
                updated = True

            # 2. Else if tts_service IS the service (no switcher)
            elif hasattr(tts_service, "set_voice_parameters"):
                await tts_service.set_voice_parameters(voice_params)
                updated = True

            # 3. Else if we are using ServiceSwitcher
            elif hasattr(tts_service, "services"):
                # Update services in the switcher
                count = 0
                services_iter = (
                    tts_service.services.values()
                    if isinstance(tts_service.services, dict)
                    else tts_service.services
                )

                for svc in services_iter:
                    # We could filter by provider if we knew it, but parameters are usually provider-specific anyway.
                    # Kokoro params won't hurt ElevenLabs service if it doesn't have the method.
                    if hasattr(svc, "set_voice_parameters"):
                        await svc.set_voice_parameters(voice_params)
                        count += 1
                if count > 0:
                    log.info(
                        f"[{BOT_PID}] [session.config] Updated voice parameters on {count} services in switcher"
                    )
                    updated = True

            if not updated:
                log.warning(
                    f"[{BOT_PID}] [session.config] TTS service does not support voice parameter update (no set_voice_parameters method)"
                )

        except Exception as e:
            log.error(f"[{BOT_PID}] [session.config] Failed to update voice parameters: {e}")

    # Update Personality (System Prompt) - with lock to prevent race conditions
    if config.get("personalityId"):
        new_pid = config["personalityId"]
        tenant_id = get_room_tenant_id(room_url)

        if tenant_id:
            async with _personality_switch_lock:
                log.info(f"[{BOT_PID}] [session.config] Fetching personality {new_pid} for tenant {tenant_id} (locked)")
                try:
                    # Use resolve_personality to support both Personality and Sprite content types
                    personality_record = await personality_actions.resolve_personality(
                        tenant_id, new_pid
                    )
                    
                    if not personality_record:
                        log.warning(f"[{BOT_PID}] [session.config] Personality/Sprite {new_pid} not found")
                        return
                    
                    # Check for 'primaryPrompt' (canonical) or 'system_prompt' (legacy/fallback)
                    new_prompt = personality_record.get("primaryPrompt") or personality_record.get(
                        "system_prompt"
                    )

                    # Merge Sprite Bot Config if present (from frontend botConfig)
                    sprite_bot_config = config.get("botConfig")
                    if not sprite_bot_config and personality_record.get("type") == "Sprite":
                        # Fallback: fetch botConfig from the sprite record itself
                        sprite_bot_config = personality_record.get("botConfig")
                    
                    if sprite_bot_config:
                        log.info(f"[{BOT_PID}] [session.config] Sprite bot config detected: botType={sprite_bot_config.get('botType')}, tools={len(sprite_bot_config.get('tools', []))}")
                        # Store bot config per-room for runtime tool filtering
                        set_bot_config(room_url, json.dumps(sprite_bot_config))
                        
                        # Merge system prompt: sprite personality + bot config system prompt
                        bot_system_prompt = sprite_bot_config.get("systemPrompt", "").strip()
                        if bot_system_prompt and new_prompt:
                            new_prompt = f"{new_prompt}\n\n## Additional Instructions\n{bot_system_prompt}"
                        
                        # Inject behavior rules into the prompt
                        behaviors = sprite_bot_config.get("behaviors", [])
                        active_behaviors = [b for b in behaviors if b.get("enabled")]
                        if active_behaviors:
                            behavior_lines = [f"- When {b['trigger']}: {b['action']}" for b in active_behaviors]
                            new_prompt = f"{new_prompt}\n\n## Behavior Rules\n" + "\n".join(behavior_lines)
                    else:
                        # Clear any previous bot config for this room
                        clear_bot_config(room_url)

                    if new_prompt:
                        log.info(f"[{BOT_PID}] [session.config] Updating system prompt")

                        # Prepare extra notes
                        extras = [new_prompt, "", MULTI_USER_NOTE]

                        # Check for smart silence - disable for sprite sessions
                        # Sprites are characters that should always respond, not be silent
                        is_sprite_mode = config.get("mode") == "sprite"
                        use_smart_silence = False
                        if not is_sprite_mode:
                            if supported_features and "smartSilence" in supported_features:
                                use_smart_silence = True
                            # Also check environment variable if supported_features not provided (fallback)
                            elif os.getenv('BOT_SUPPORTED_FEATURES') and "smartSilence" in os.getenv(
                                'BOT_SUPPORTED_FEATURES'
                            ):
                                use_smart_silence = True

                        if use_smart_silence:
                            extras.append(SMART_SILENCE_NOTE)
                        elif is_sprite_mode:
                            log.info(f"[{BOT_PID}] [session.config] Skipping smart silence for sprite mode")

                        full_system_content = "\n".join(part for part in extras if part)

                        # Update system prompt in context
                        # We expect 'context' to be OpenAILLMContext which has a messages list
                        if hasattr(context, "messages"):
                            # Find system message
                            updated = False
                            for msg in context.messages:
                                if msg.get("role") == "system":
                                    content = msg.get("content", "")
                                    # Skip dynamic context messages
                                    if (
                                        content.startswith("Current participants")
                                        or content.startswith("Participant roster")
                                        or content.startswith("You are preparing")
                                    ):
                                        continue

                                    msg["content"] = full_system_content
                                    log.info(
                                        f"[{BOT_PID}] [session.config] System prompt updated in context (replaced: {content[:50]}...)"
                                    )
                                    updated = True
                                    break

                            if not updated:
                                log.warning(
                                    f"[{BOT_PID}] [session.config] Could not find suitable system prompt to update in context"
                                )
                        else:
                            log.warning(f"[{BOT_PID}] [session.config] Context does not have messages attribute")
                        
                        # If this is a Sprite, also apply voice config
                        if personality_record.get("type") == "Sprite":
                            sprite_voice_provider = personality_record.get("voiceProvider")
                            sprite_voice_id = personality_record.get("voiceId")
                            sprite_voice_params = personality_record.get("voiceParameters")
                            
                            if sprite_voice_id:
                                log.info(f"[{BOT_PID}] [session.config] Applying Sprite voice: {sprite_voice_provider}/{sprite_voice_id}")
                                
                                # Apply voice to appropriate service
                                if target_service and hasattr(target_service, "set_voice"):
                                    await target_service.set_voice(sprite_voice_id)
                                elif hasattr(tts_service, "set_voice"):
                                    await tts_service.set_voice(sprite_voice_id)
                                elif hasattr(tts_service, "services"):
                                    # Find matching provider in switcher
                                    services_iter = (
                                        tts_service.services.values()
                                        if isinstance(tts_service.services, dict)
                                        else tts_service.services
                                    )
                                    for svc in services_iter:
                                        if sprite_voice_provider == "kokoro" and isinstance(svc, KokoroTTSService):
                                            await svc.set_voice(sprite_voice_id)
                                            if sprite_voice_params and hasattr(svc, "set_voice_parameters"):
                                                await svc.set_voice_parameters(sprite_voice_params)
                                            log.info(f"[{BOT_PID}] [session.config] Sprite voice applied to Kokoro service")
                                            break
                                        elif sprite_voice_provider in ["elevenlabs", "11labs"] and isinstance(svc, ElevenLabsTTSService):
                                            await svc.set_voice(sprite_voice_id)
                                            if sprite_voice_params and hasattr(svc, "set_voice_parameters"):
                                                await svc.set_voice_parameters(sprite_voice_params)
                                            log.info(f"[{BOT_PID}] [session.config] Sprite voice applied to ElevenLabs service")
                                            break

                except Exception as e:
                    log.error(f"[{BOT_PID}] [session.config] Failed to update personality: {e}")
        else:
            log.warning(f"[{BOT_PID}] [session.config] Cannot update personality: tenant_id not found for room")
