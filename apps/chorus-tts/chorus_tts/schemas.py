# SPDX-License-Identifier: MIT
"""Pydantic models for websocket handshake parameters and message payloads."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class OutputFormat(str, Enum):
    """Enumerate supported PCM output formats."""

    PCM_22050 = "pcm_22050"
    PCM_24000 = "pcm_24000"


class ApplyTextNormalization(str, Enum):
    """Control how Kokoro normalises incoming text."""

    AUTO = "auto"
    ON = "on"
    OFF = "off"


class VoiceSettings(BaseModel):
    """User-controllable voice rendering parameters."""

    model_config = ConfigDict(extra="ignore")

    stability: float | None = Field(default=None, ge=0.0, le=1.0)
    similarity_boost: float | None = Field(default=None, ge=0.0, le=1.0)
    style: float | None = Field(default=None, ge=0.0, le=1.0)
    use_speaker_boost: bool | None = None
    speed: float | None = Field(default=None, ge=0.5, le=2.0)


class GenerationConfig(BaseModel):
    """Optional per-session overrides for generation behaviour."""

    model_config = ConfigDict(extra="ignore")

    chunk_length_schedule: list[int] | None = Field(default=None)

    @field_validator("chunk_length_schedule")
    @classmethod
    def _validate_schedule(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        if not value:
            message = "chunk_length_schedule cannot be empty."
            raise ValueError(message)
        for item in value:
            if not 50 <= item <= 500:
                message = "chunk_length_schedule values must be between 50 and 500."
                raise ValueError(message)
        return value


class HandshakeParams(BaseModel):
    """Query parameters accepted by the websocket handshake endpoint."""

    model_config = ConfigDict(extra="ignore")

    model_id: str | None = None
    output_format: OutputFormat = OutputFormat.PCM_22050
    api_key: str | None = Field(default=None, alias="api_key")
    authorization: str | None = None
    language_code: str | None = None
    enable_logging: bool = True
    enable_ssml_parsing: bool = False
    inactivity_timeout: int = Field(default=20, ge=5, le=180)
    sync_alignment: bool = False
    auto_mode: bool = False
    apply_text_normalization: ApplyTextNormalization = ApplyTextNormalization.AUTO
    seed: int | None = Field(default=None, ge=0, le=4_294_967_295)


class BaseMessage(BaseModel):
    """Base model for websocket message payloads."""

    model_config = ConfigDict(extra="ignore")


class InitializeConnectionMessage(BaseMessage):
    """Payload required to initialise a websocket session."""

    text: Literal[" "]
    voice_settings: VoiceSettings | None = None
    generation_config: GenerationConfig | None = None
    pronunciation_dictionary_locators: list[dict[str, str]] | None = None
    xi_api_key: str | None = None
    authorization: str | None = None


class SendTextMessage(BaseMessage):
    """Payload carrying text or flush instructions during a session."""

    text: str
    try_trigger_generation: bool = False
    flush: bool = False
    voice_settings: VoiceSettings | None = None
    generation_config: GenerationConfig | None = None

    @model_validator(mode="after")
    def _validate_text(self) -> SendTextMessage:
        if self.flush:
            return self
        if not self.text:
            message = "text must be provided when flush is false."
            raise ValueError(message)
        if not self.text.endswith(" "):
            message = "text should end with a single space."
            raise ValueError(message)
        return self


class CloseConnectionMessage(BaseMessage):
    """Payload instructing the server to close the websocket session."""

    text: Literal[""]


class ConnectedEvent(BaseMessage):
    """Server acknowledgement after accepting the websocket handshake."""

    event: Literal["connected"]
    session_id: str
    voice_id: str
    language_code: str
    output_format: OutputFormat


class AudioOutputEvent(BaseMessage):
    """Chunk of PCM data streamed back to the websocket client."""

    event: Literal["audioOutput"]
    chunk_index: int
    audio: str
    sample_rate: int
    is_final: bool = Field(alias="isFinal")
    segment_reason: str

    model_config = ConfigDict(populate_by_name=True)


class FinalOutputEvent(BaseMessage):
    """Summary emitted when the session completes successfully."""

    event: Literal["finalOutput"]
    is_final: Literal[True] = Field(alias="isFinal")
    chunks: int
    duration_ms: int

    model_config = ConfigDict(populate_by_name=True)


class ErrorEvent(BaseMessage):
    """Error reported back to websocket clients."""

    event: Literal["error"]
    code: str
    message: str
    retryable: bool
