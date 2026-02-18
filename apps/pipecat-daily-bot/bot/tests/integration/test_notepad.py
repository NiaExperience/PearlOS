"""Live Daily tool call integration test."""
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


def _log_session_result(result):
    print("Session messages (role: content):")
    for msg in result.messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        print(f"[{role}] {content} | full={msg}")

    if result.tool_calls:
        print("Tool calls:")
        for tc in result.tool_calls:
            print(f"tool={tc.get('name')} id={tc.get('id')} args={tc.get('arguments')}")


@pytest.mark.asyncio
async def test_notepad_tool_call(
    chorus_server_session,
    mesh_test_server,
    unique_tenant_id,
    unique_user_id,
):
    """Test bot responds to 'open notepad' request by calling the bot_open_notes tool.
    
    This test verifies:
    1. Bot produces initial greeting when participant joins
    2. User audio ('open notepad.wav') is streamed into Daily room
    3. Daily transcribes the user's request
    4. Bot processes the request and calls the bot_open_notes tool
    
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
    # Use pre-recorded 'open notepad' fixture
    config.audio_fixture_name = "open_notepad.wav"
    config.tenant_id = unique_tenant_id
    config.session_user_id = unique_user_id
    # Enable two-way conversation mode
    config.enable_user_audio = True
    # Give the bot time to process the tool call
    config.assistant_timeout_secs = 10.0
    # Wait specifically for the tool call to return early
    config.expected_tool_call = "bot_open_notes"

    result = await run_live_session(config)
    _log_session_result(result)

    # Verify the bot produced a greeting
    assert len(result.assistant_messages) >= 1, "assistant should produce at least greeting"
    assert result.messages, "conversation log is empty"
    
    # Verify the bot called the bot_open_notes tool
    assert result.tool_calls, "bot should have made at least one tool call"
    tool_names = [tc["name"] for tc in result.tool_calls]
    assert "bot_open_notes" in tool_names, (
        f"bot should have called bot_open_notes, but only called: {tool_names}"
    )
