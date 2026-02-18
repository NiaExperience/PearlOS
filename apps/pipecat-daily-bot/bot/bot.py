"""Pipecat Daily bot entrypoint.

Refactored to make core pipeline construction testable without establishing
network transports during import. Heavy imports are deferred until runtime so
pytest can import this module and unit test helper functions quickly.
"""

from __future__ import annotations

import os
import sys

from loguru import logger

# Import utilities and services
from providers.daily import create_daily_room_token
from utils.logging_utils import _configure_logging_filters, _install_fd_muter
from core.config import BOT_PID

# Import pipeline runner
try:
    from bot.session.orchestrator import run_pipeline_session
except ImportError:
    try:
        from session.orchestrator import run_pipeline_session
    except ImportError:
        # Fallback for when running as a script in the same directory
        import sys
        from pathlib import Path
        sys.path.append(str(Path(__file__).parent))
        from session.orchestrator import run_pipeline_session

# Configure logging
_configure_logging_filters()
_install_fd_muter()


async def bot(runner_args):  # Entry point expected by pipecat runner
    """Pipecat runner-compatible bot entrypoint.

    runner_args may have (room_url, token, webrtc_connection, websocket, ...)
    For Daily runner modes we expect room_url & token.
    """
    logger.info(f"DEBUG: BOT_VOICE_ID env var: {os.getenv('BOT_VOICE_ID')}")
    logger.info(f"DEBUG: runner_args: {runner_args}")

    room_url: str | None = getattr(runner_args, "room_url", None) or os.getenv("DAILY_ROOM_URL")

    # If no room_url provided, we need one to connect to
    if not room_url:
        logger.error(f"[{BOT_PID}] DAILY_ROOM_URL is required to connect to an existing room")
        return

    body = getattr(runner_args, "body", {}) or {}

    personalityId = (
        getattr(runner_args, "personalityId", None) or body.get("personalityId") or (os.getenv("BOT_PERSONALITY", "")).lower()
    )
    persona = getattr(runner_args, "persona", None) or body.get("persona") or os.getenv("BOT_PERSONA", "")
    
    # Use token from args if present, otherwise try to generate one
    token: str | None = getattr(runner_args, "token", None)
    
    # If API key present and no token provided, attempt token generation
    daily_api_key = os.getenv("DAILY_API_KEY")
    logger.debug(f"DAILY_API_KEY present: {bool(daily_api_key)}, length: {len(daily_api_key) if daily_api_key else 0}")
    
    if not token and daily_api_key:
        try:
            token = await create_daily_room_token(room_url)
            logger.info(f"[{BOT_PID}] Generated token for existing room: {room_url}")
        except Exception as e:
            logger.error(f"[{BOT_PID}] Failed to generate token for room: {e}")
            # Continue without token; DailyTransport may accept None depending on room policy
    elif not token:
        logger.warning(f"No DAILY_API_KEY found - transcription will be disabled!")
    
    tenantId = getattr(runner_args, "tenantId", None) or body.get("tenantId") or os.getenv("BOT_TENANT_ID")
    voiceId = getattr(runner_args, "voice", None) or getattr(runner_args, "voiceId", None) or body.get("voice") or body.get("voiceId") or os.getenv("BOT_VOICE_ID")
    activeNoteId = getattr(runner_args, "activeNoteId", None) or body.get("activeNoteId")

    # Propagate additional runner args to environment variables for warm bot reuse
    
    # Voice Provider
    voiceProvider = getattr(runner_args, "voiceProvider", None) or body.get("voiceProvider")
    if voiceProvider:
        os.environ["BOT_TTS_PROVIDER"] = str(voiceProvider)

    # Voice Parameters
    voiceParameters = getattr(runner_args, "voiceParameters", None) or body.get("voiceParameters")
    if voiceParameters and isinstance(voiceParameters, dict):
        if voiceParameters.get("speed") is not None:
            os.environ["BOT_VOICE_SPEED"] = str(voiceParameters.get("speed"))
        if voiceParameters.get("stability") is not None:
            os.environ["BOT_VOICE_STABILITY"] = str(voiceParameters.get("stability"))
        if voiceParameters.get("similarityBoost") is not None:
            os.environ["BOT_VOICE_SIMILARITY_BOOST"] = str(voiceParameters.get("similarityBoost"))
        if voiceParameters.get("style") is not None:
            os.environ["BOT_VOICE_STYLE"] = str(voiceParameters.get("style"))
        if voiceParameters.get("optimizeStreamingLatency") is not None:
            os.environ["BOT_VOICE_OPTIMIZE_STREAMING_LATENCY"] = str(voiceParameters.get("optimizeStreamingLatency"))

    # Mode Personality Voice Config (Static Path)
    modePersonalityVoiceConfig = getattr(runner_args, "modePersonalityVoiceConfig", None) or body.get("modePersonalityVoiceConfig")

    # Session Override
    sessionOverride = getattr(runner_args, "sessionOverride", None) or body.get("sessionOverride")

    # Supported Features (Feature Flags)
    supportedFeatures = getattr(runner_args, "supportedFeatures", None) or body.get("supportedFeatures")

    # Headless/persistent session (auto-created room, no idle shutdown)
    headless = body.get("headless", False)

    # Onboarding State
    isOnboarding = getattr(runner_args, "isOnboarding", None) or body.get("isOnboarding") or (os.getenv("BOT_IS_ONBOARDING", "false").lower() == "true")
    
    if isOnboarding:
        if supportedFeatures is None:
            supportedFeatures = []
        if "onboarding" not in supportedFeatures:
            supportedFeatures.append("onboarding")
        logger.info(f"[{BOT_PID}] Onboarding mode active - ensured 'onboarding' feature flag is present")

    # Run the pipeline session
    await run_pipeline_session(
        room_url,
        personalityId,
        persona,
        token,
        tenantId,
        voiceId,
        modePersonalityVoiceConfig=modePersonalityVoiceConfig,
        supportedFeatures=supportedFeatures,
        sessionOverride=sessionOverride,
        isOnboarding=isOnboarding,
        headless=headless,
        session_id=body.get("sessionId"),
    )

