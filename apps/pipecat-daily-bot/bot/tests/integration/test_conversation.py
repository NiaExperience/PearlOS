"""Live Daily two-way conversation integration test."""
from __future__ import annotations

import os
from typing import Iterable

import pytest

# Ensure Chorus TTS server auto-starts for this test module
os.environ.setdefault("PIPECAT_AUTOSTART_CHORUS", "1")

from .audio_device_support import check_audio_device_support
from .harness import LiveSessionConfig, run_live_session


def _missing_env_vars(names: Iterable[str]) -> list[str]:
    return [name for name in names if not os.getenv(name)]


@pytest.mark.asyncio
async def test_two_way_conversation(
    chorus_server_session,
    mesh_test_server,
    unique_tenant_id,
    unique_user_id,
):
    """Test a full two-way conversation: bot greets, user speaks, bot responds.
    
    This test verifies:
    1. Bot produces initial greeting when participant joins
    2. User audio is streamed into Daily room via CustomAudioSource
    3. Daily transcribes the user's audio
    4. Bot processes the transcription and generates a response
    
    Uses test-isolated tenant/user IDs, Mesh server with in-memory database,
    and Chorus TTS server for Kokoro synthesis.
    """

    if os.getenv("PIPECAT_RUN_LIVE_TESTS", "0").lower() in {"0", "false", "off"}:
        pytest.skip("Set PIPECAT_RUN_LIVE_TESTS=1 to exercise the live Daily harness")

    required_env = ["DAILY_DOMAIN", "DAILY_API_KEY"]
    missing = _missing_env_vars(required_env)
    if missing:
        pytest.skip(f"Missing required Daily configuration: {', '.join(missing)}")

    if os.getenv("PIPECAT_SKIP_AUDIO_DEVICE_CHECK", "0").lower() not in {"1", "true", "on"}:
        audio_check = check_audio_device_support()
        if not audio_check.ok:
            pytest.skip(audio_check.message)

    config = LiveSessionConfig.from_env()
    # Use pre-recorded fixture for user audio
    config.audio_fixture_name = "hello_how_are_you.wav"
    config.tenant_id = unique_tenant_id
    config.session_user_id = unique_user_id
    # Enable two-way conversation mode
    config.enable_user_audio = True
    # Give the bot more time to respond to the user's question
    config.assistant_timeout_secs = 10.0

    result = await run_live_session(config)

    # Verify the bot produced a greeting and a response
    assert len(result.assistant_messages) >= 1, "assistant should produce at least greeting"
    assert result.messages, "conversation log is empty"
    
    # Check that we got multiple assistant turns (greeting + response to user question)
    # The bot should greet, then respond to "tell me about yourself"
    assert len(result.assistant_messages) >= 2, "assistant should greet and respond to user question"
