"""Unit tests for websocket schema models."""

from __future__ import annotations

import pytest
from chorus_tts.schemas import (
    ApplyTextNormalization,
    CloseConnectionMessage,
    GenerationConfig,
    HandshakeParams,
    InitializeConnectionMessage,
    OutputFormat,
    SendTextMessage,
)
from pydantic import ValidationError


def test_handshake_defaults() -> None:
    """Verify defaults assigned during handshake parsing."""
    params = HandshakeParams()
    assert params.output_format == OutputFormat.PCM_22050
    assert params.enable_logging is True
    assert params.inactivity_timeout == 20
    assert params.apply_text_normalization == ApplyTextNormalization.AUTO


def test_handshake_rejects_invalid_output_format() -> None:
    """Reject unsupported output formats."""
    with pytest.raises(ValidationError):
        HandshakeParams(output_format="mp3_44100_128")  # type: ignore[arg-type]


def test_initialize_connection_requires_single_space_text() -> None:
    """Enforce single-space payload for initialize message."""
    msg = InitializeConnectionMessage(text=" ")
    assert msg.text == " "

    with pytest.raises(ValidationError):
        InitializeConnectionMessage(text="invalid")  # type: ignore[arg-type]


def test_send_text_requires_trailing_space() -> None:
    """Require trailing space for sendText payloads."""
    msg = SendTextMessage(text="Hello world ")
    assert msg.text.endswith(" ")

    with pytest.raises(ValidationError):
        SendTextMessage(text="Hello world")


def test_send_text_allows_flush_without_text() -> None:
    """Allow flush flag without accompanying text."""
    msg = SendTextMessage(text="", flush=True)
    assert msg.flush is True


def test_generation_config_validates_schedule() -> None:
    """Validate chunk length schedule bounds."""
    cfg = GenerationConfig(chunk_length_schedule=[80, 120, 180])
    assert cfg.chunk_length_schedule == [80, 120, 180]

    with pytest.raises(ValidationError):
        GenerationConfig(chunk_length_schedule=[40])


def test_close_connection_requires_empty_text() -> None:
    """Require empty string for closeConnection payloads."""
    msg = CloseConnectionMessage(text="")
    assert msg.text == ""

    with pytest.raises(ValidationError):
        CloseConnectionMessage(text="not-empty")  # type: ignore[arg-type]
