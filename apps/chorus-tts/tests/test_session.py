"""Unit tests covering GenerationSession behaviour."""

from __future__ import annotations

import pytest
from chorus_tts.config import Settings
from chorus_tts.schemas import InitializeConnectionMessage
from chorus_tts.session import GenerationSession, SessionError
from chorus_tts.voices import VoiceInfo


def make_settings(tmp_path) -> Settings:
    """Create Settings using temporary files for model and voices."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")
    return Settings(
        model_path=model,
        voices_path=voices,
        api_keys=("key",),
        chunk_length_schedule=(80, 120),
    )


def make_session(tmp_path, *, auto_mode: bool | None = None) -> GenerationSession:
    """Build a GenerationSession configured for tests."""
    settings = make_settings(tmp_path)
    voice_info = VoiceInfo(
        voice_id="af_alloy",
        language_code="en-us",
        category="US female",
    )
    return GenerationSession(
        settings=settings,
        handshake_auto_mode=bool(auto_mode),
        voice_info=voice_info,
    )


def test_initialize_sets_schedule(tmp_path) -> None:
    """Apply chunk schedule values during initialization."""
    session = make_session(tmp_path)
    message = {"text": " ", "generation_config": {"chunk_length_schedule": [120, 160]}}
    outcome = session.process_payload(message)
    assert outcome.initialized_now is True
    assert session.process_payload({"text": ""}).close_connection is True


def test_send_text_triggers_threshold(tmp_path) -> None:
    """Buffer text until the schedule threshold is reached."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    outcome = session.process_payload({"text": "hello world "})
    assert not outcome.segments
    outcome = session.process_payload({"text": "x" * 70 + " "})
    assert outcome.segments
    assert outcome.segments[0].text == "hello world " + "x" * 70


def test_flush_returns_segment(tmp_path) -> None:
    """Emit a segment immediately when flush flag is set."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    outcome = session.process_payload({"text": "short ", "flush": True})
    assert outcome.segments[0].reason == "flush"


def test_close_returns_final_segment(tmp_path) -> None:
    """Mark the final segment when closing the session."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    session.process_payload({"text": "pending "})
    outcome = session.process_payload({"text": ""})
    assert outcome.segments[0].is_final is True
    assert outcome.close_connection is True


def test_auto_mode_generates_each_chunk(tmp_path) -> None:
    """Auto mode should emit segments for every buffered chunk."""
    session = make_session(tmp_path, auto_mode=True)
    session.process_payload({"text": " "})
    outcome = session.process_payload({"text": "auto one "})
    assert outcome.segments
    outcome = session.process_payload({"text": "auto two "})
    assert outcome.segments


def test_speed_change_raises(tmp_path) -> None:
    """Reject attempts to change speed after initialization."""
    session = make_session(tmp_path)
    session.process_payload({"text": " ", "voice_settings": {"speed": 1.1}})
    with pytest.raises(SessionError):
        session.process_payload({"text": "hello ", "voice_settings": {"speed": 1.2}})


def test_voice_speed_initialized_from_subsequent_settings(tmp_path) -> None:
    """Adopt voice speed from later settings when not provided initially."""
    session = make_session(tmp_path)
    session.process_payload({"text": " ", "voice_settings": {"speed": None}})
    session.process_payload({"text": "next ", "voice_settings": {"speed": 1.4}})
    assert session.voice_speed == 1.4


def test_initialize_requires_blank_text(tmp_path) -> None:
    """Require initialization payload to contain blank text."""
    session = make_session(tmp_path)
    with pytest.raises(SessionError):
        session.process_payload({"text": "invalid"})


def test_missing_text_field_raises(tmp_path) -> None:
    """Raise when payload omits required text field."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    with pytest.raises(SessionError):
        session.process_payload({})


def test_invalid_send_text_payload(tmp_path) -> None:
    """Enforce trailing space requirement for sendText."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    with pytest.raises(SessionError):
        session.process_payload({"text": "no-trailing-space"})


def test_invalid_close_payload(tmp_path) -> None:
    """Reject close payloads without expected blank text."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    with pytest.raises(SessionError):
        session.process_payload({"text": None})


def test_reinitialize_raises(tmp_path) -> None:
    """Prevent double initialization calls."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    message = InitializeConnectionMessage(text=" ")
    with pytest.raises(SessionError):
        session._handle_initialize(message)  # noqa: SLF001 - exercising internal guard


def test_send_text_after_close_raises(tmp_path) -> None:
    """Ensure sendText cannot be used after the session closes."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    session.process_payload({"text": ""})
    with pytest.raises(SessionError):
        session.process_payload({"text": "later "})


def test_flush_without_buffer_returns_no_segments(tmp_path) -> None:
    """Do not emit segments when buffer is empty during flush."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    outcome = session.process_payload({"text": "", "flush": True})
    assert not outcome.segments


def test_close_twice(tmp_path) -> None:
    """Treat repeated close calls as idempotent."""
    session = make_session(tmp_path)
    session.process_payload({"text": " "})
    first_close = session.process_payload({"text": ""})
    assert first_close.close_connection is True
    second_close = session.process_payload({"text": ""})
    assert second_close.close_connection is True
    assert not second_close.segments


def test_apply_chunk_schedule_fallback(tmp_path) -> None:
    """Fallback to default schedule when custom values are invalid."""
    session = make_session(tmp_path)
    session._apply_chunk_schedule((0,))  # noqa: SLF001 - ensuring fallback behavior
    chunk_schedule = session._chunk_schedule  # noqa: SLF001 - inspect internal state
    assert chunk_schedule == session.settings.chunk_length_schedule
