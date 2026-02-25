# SPDX-License-Identifier: MIT
"""Session and buffering utilities for the websocket TTS flow."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from pydantic import ValidationError

from .config import Settings
from .schemas import (
    CloseConnectionMessage,
    InitializeConnectionMessage,
    SendTextMessage,
    VoiceSettings,
)
from .voices import VoiceInfo

MIN_TRIGGER_CHARS = 30


class SessionError(Exception):
    """Raised when a websocket payload is invalid for the current session state."""


@dataclass(frozen=True, slots=True)
class PendingSegment:
    """Text segment that should be fed into the TTS engine."""

    text: str
    is_final: bool
    reason: str = "auto"  # e.g. "auto", "flush", "close", "trigger"


@dataclass(slots=True)
class ProcessOutcome:
    """Result of processing a websocket message."""

    segments: list[PendingSegment] = field(default_factory=list)
    close_connection: bool = False
    initialized_now: bool = False


class GenerationSession:
    """Track buffering state per websocket connection and trigger generation."""

    def __init__(
        self,
        settings: Settings,
        *,
        handshake_auto_mode: bool,
        voice_info: VoiceInfo,
    ) -> None:
        """Initialise buffering and voice state for a websocket session."""
        self.settings = settings
        self.voice_info = voice_info
        self.auto_mode = handshake_auto_mode
        self.buffer: str = ""
        self.initialized = False
        self.closed = False
        self.voice_speed: float = 1.0
        self._chunk_schedule: tuple[int, ...] = settings.chunk_length_schedule
        self._schedule_index = 0
        self._trigger_threshold = max(MIN_TRIGGER_CHARS, min(self._chunk_schedule) // 2)
        self._voice_settings_initial: VoiceSettings | None = None

    def process_payload(self, payload: dict) -> ProcessOutcome:
        """Parse and apply a websocket payload to determine follow-up actions."""
        if not self.initialized:
            message = self._parse_initialize(payload)
            return self._handle_initialize(message)

        if "text" not in payload:
            error_message = "Missing 'text' field in payload."
            raise SessionError(error_message)

        if payload.get("text") == "":
            close_message = self._parse_close(payload)
            return self._handle_close(close_message)

        text_message = self._parse_send_text(payload)
        return self._handle_send_text(text_message)

    def _parse_initialize(self, payload: dict) -> InitializeConnectionMessage:
        try:
            return InitializeConnectionMessage(**payload)
        except ValidationError as exc:
            message = "Invalid initializeConnection payload"
            raise SessionError(message) from exc

    def _parse_send_text(self, payload: dict) -> SendTextMessage:
        try:
            return SendTextMessage(**payload)
        except ValidationError as exc:
            message = "Invalid sendText payload"
            raise SessionError(message) from exc

    def _parse_close(self, payload: dict) -> CloseConnectionMessage:
        try:
            return CloseConnectionMessage(**payload)
        except ValidationError as exc:
            message = "Invalid closeConnection payload"
            raise SessionError(message) from exc

    def _handle_initialize(
        self,
        message: InitializeConnectionMessage,
    ) -> ProcessOutcome:
        if self.initialized:
            error_message = "Session already initialized."
            raise SessionError(error_message)
        self.initialized = True
        if message.voice_settings:
            self._voice_settings_initial = message.voice_settings
            if message.voice_settings.speed is not None:
                self.voice_speed = message.voice_settings.speed

        if (
            message.generation_config
            and message.generation_config.chunk_length_schedule
        ):
            schedule = tuple(message.generation_config.chunk_length_schedule)
            self._apply_chunk_schedule(schedule)
        else:
            self._apply_chunk_schedule(self.settings.chunk_length_schedule)

        return ProcessOutcome(initialized_now=True)

    def _handle_send_text(self, message: SendTextMessage) -> ProcessOutcome:
        if not self.initialized or self.closed:
            error_message = "Session not ready for sendText."
            raise SessionError(error_message)

        self._validate_voice_settings(message.voice_settings)

        appended_text = message.text or ""
        if appended_text:
            self.buffer += appended_text

        return ProcessOutcome(segments=self._maybe_generate_segments(message))

    def _handle_close(self, message: CloseConnectionMessage) -> ProcessOutcome:
        if self.closed:
            return ProcessOutcome(close_connection=True)
        self.closed = True
        segments: list[PendingSegment] = []
        segment = self._consume_buffer(reason="close", is_final=True)
        if segment:
            segments.append(segment)
        return ProcessOutcome(segments=segments, close_connection=True)

    def _validate_voice_settings(self, current: VoiceSettings | None) -> None:
        if current is None:
            return
        if self._voice_settings_initial is None:
            # Store the first provided settings to enforce consistency later.
            self._voice_settings_initial = current

        initial_speed = self._voice_settings_initial.speed
        if (
            current.speed is not None
            and initial_speed is not None
            and current.speed != initial_speed
        ):
            message = "Speed cannot change after initialization."
            raise SessionError(message)
        if current.speed is not None and initial_speed is None:
            self._voice_settings_initial = VoiceSettings(speed=current.speed)
            self.voice_speed = current.speed

    def _consume_buffer(
        self,
        reason: str,
        *,
        is_final: bool | None = None,
    ) -> PendingSegment | None:
        text = self.buffer.strip()
        if not text:
            return None
        self.buffer = ""
        final_flag = bool(is_final)
        if not final_flag:
            self._advance_schedule()
        return PendingSegment(text=text, is_final=final_flag, reason=reason)

    def _apply_chunk_schedule(self, schedule: Sequence[int]) -> None:
        filtered = tuple(value for value in schedule if value >= 1)
        if not filtered:
            filtered = self.settings.chunk_length_schedule
        self._chunk_schedule = filtered
        self._schedule_index = 0
        self._trigger_threshold = max(MIN_TRIGGER_CHARS, min(self._chunk_schedule) // 2)

    def _current_threshold(self) -> int:
        index = min(self._schedule_index, len(self._chunk_schedule) - 1)
        return self._chunk_schedule[index]

    def _advance_schedule(self) -> None:
        if self._schedule_index < len(self._chunk_schedule) - 1:
            self._schedule_index += 1

    def _maybe_generate_segments(
        self,
        message: SendTextMessage,
    ) -> list[PendingSegment]:
        conditions = (
            ("flush", message.flush),
            ("auto", self.auto_mode),
            ("auto", len(self.buffer.strip()) >= self._current_threshold()),
            (
                "trigger",
                message.try_trigger_generation
                and len(self.buffer.strip()) >= self._trigger_threshold,
            ),
        )

        for reason, predicate in conditions:
            if predicate:
                segment = self._consume_buffer(reason=reason)
                return [segment] if segment else []

        return []
