"""Live Daily → LLM integration smoke test."""
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
async def test_live_daily_session_produces_assistant_response(
    chorus_server_session,
    mesh_test_server,
    unique_tenant_id,
    unique_user_id,
):
    """Run the end-to-end Daily harness and verify an assistant reply arrives.
    
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
    # No user audio needed for this test - just verify bot greeting
    config.tenant_id = unique_tenant_id
    config.session_user_id = unique_user_id

    result = await run_live_session(config)

    # Verify the bot produced a greeting
    assert any(msg.strip() for msg in result.assistant_messages), "assistant produced no speech"
    assert result.messages, "conversation log is empty"
