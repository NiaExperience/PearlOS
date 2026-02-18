"""Pipecat-compatible Kokoro TTS client.

This service mirrors the ElevenLabs websocket contract sufficiently for the
Pipecat runtime while talking to the Chorus Kokoro deployment. It keeps the
connection alive across utterances, forwards audio frames as they stream in,
and leaves word timestamp duties to the base TTS service (text frames are
emitted after playback completes because Kokoro does not return alignment data).
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
from typing import AsyncGenerator, Dict, List, Optional, Callable, Awaitable
from urllib.parse import urlencode

from loguru import logger
from pydantic import BaseModel, Field, field_validator

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    ErrorFrame,
    Frame,
    StartFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
)
from pipecat.services.tts_service import WebsocketTTSService
from pipecat.utils.tracing.service_decorators import traced_tts

try:
    from websockets.asyncio.client import connect as websocket_connect
    from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK
    from websockets.protocol import State
except ModuleNotFoundError as exc:  # pragma: no cover - dependency managed by poetry extras
    raise RuntimeError(
        "Missing websockets dependency; ensure pipecat-ai[elevenlabs] is installed."
    ) from exc


def _output_format_from_rate(sample_rate: int) -> str:
    mapping = {
        8000: "pcm_8000",
        16000: "pcm_16000",
        22050: "pcm_22050",
        24000: "pcm_24000",
        44100: "pcm_44100",
    }
    result = mapping.get(sample_rate)
    if result is None:
        logger.warning(
            "KokoroTTSService: unsupported sample rate %s; defaulting to 22050 Hz payload",
            sample_rate,
        )
        return "pcm_22050"
    return result


# Regex pattern to match emoji characters
# Covers most common emoji ranges including:
# - Emoticons, Dingbats, Symbols
# - Miscellaneous Symbols and Pictographs
# - Emoticons, Transport/Map, Enclosed Characters
# - Supplemental Symbols and Pictographs
# - Regional indicators, Skin tone modifiers, ZWJ sequences
_EMOJI_PATTERN = re.compile(
    "["
    "\U0001F600-\U0001F64F"  # Emoticons
    "\U0001F300-\U0001F5FF"  # Misc Symbols and Pictographs
    "\U0001F680-\U0001F6FF"  # Transport and Map
    "\U0001F700-\U0001F77F"  # Alchemical Symbols
    "\U0001F780-\U0001F7FF"  # Geometric Shapes Extended
    "\U0001F800-\U0001F8FF"  # Supplemental Arrows-C
    "\U0001F900-\U0001F9FF"  # Supplemental Symbols and Pictographs
    "\U0001FA00-\U0001FA6F"  # Chess Symbols
    "\U0001FA70-\U0001FAFF"  # Symbols and Pictographs Extended-A
    "\U0001F1E0-\U0001F1FF"  # Regional indicator symbols (flags)
    "\U0001F3FB-\U0001F3FF"  # Skin tone modifiers
    "\U0000200D"             # Zero-width joiner (used in ZWJ sequences)
    "\U0000FE0F"             # Variation selector-16 (emoji presentation)
    "\U00002600-\U000026FF"  # Misc symbols (sun, clouds, etc.)
    "\U00002702-\U000027BF"  # Dingbats
    "\U000024C2-\U000024CF"  # Enclosed alphanumerics subset (circled letters)
    "\U0001F200-\U0001F251"  # Enclosed ideographic supplement
    "]+",
    flags=re.UNICODE,
)

# Characters that should not be spoken by TTS - they cause pronunciation issues
# Includes markdown formatting, special symbols, and decorative characters
_NONSPEAKABLE_CHARS_PATTERN = re.compile(
    r"[#*_`~\[\]<>|\\^{}]"  # Markdown/code formatting and decorative chars
    r"|"
    r"(?:^|\s)[•●○◦◆◇▪▫▸▹►▻]+(?:\s|$)"  # Bullet points (preserve surrounding space logic)
    r"|"
    r"[→←↑↓↔↕⇒⇐⇑⇓⇔]"  # Arrows
    r"|"
    r"[★☆✓✔✕✖✗✘]"  # Stars and check marks
    r"|"
    r"[│┃┆┇┊┋╎╏║]"  # Box drawing verticals
    r"|"
    r"[─━┄┅┈┉╌╍═]"  # Box drawing horizontals
    r"|"
    r"[┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]"  # Box corners and intersections
)


def _strip_nonspeakable(text: str) -> str:
    """Remove non-speakable characters from text for TTS processing.
    
    Kokoro TTS attempts to pronounce special characters literally or produces
    awkward output, so we strip them before sending to the TTS engine.
    This includes:
    - Markdown formatting: # * _ ` ~ [ ] < > | \\ ^ { }
    - Bullet points: • ● ○ ◦ ◆ ◇ ▪ ▫ ▸ ▹ ► ▻
    - Arrows: → ← ↑ ↓ etc.
    - Stars/checks: ★ ☆ ✓ ✔ ✕ ✖ ✗ ✘
    - Box drawing characters
    
    Emojis are handled separately by _strip_emojis().
    Transcripts retain the original text with all characters.
    """
    result = _NONSPEAKABLE_CHARS_PATTERN.sub(" ", text)
    # Clean up any double spaces left by character removal
    result = re.sub(r"\s{2,}", " ", result)
    return result.strip()


def _sanitize_for_tts(text: str) -> str:
    """Sanitize text for TTS by removing emojis and non-speakable characters.
    
    This is the main entry point for text sanitization before TTS.
    Transcripts retain the original text - only the audio synthesis uses sanitized text.
    """
    # First strip emojis
    result = _EMOJI_PATTERN.sub("", text)
    # Then strip non-speakable characters
    result = _NONSPEAKABLE_CHARS_PATTERN.sub(" ", result)
    # Clean up any double spaces
    result = re.sub(r"\s{2,}", " ", result)
    return result.strip()


class KokoroTTSService(WebsocketTTSService):
    """Streaming Kokoro client compatible with Pipecat's websocket TTS hooks."""

    class InputParams(BaseModel):
        """Optional voice and generation tuning."""

        stability: float | None = Field(default=None, ge=0.0, le=1.0)
        similarity_boost: float | None = Field(default=None, ge=0.0, le=1.0)
        style: float | None = Field(default=None, ge=0.0, le=1.0)
        use_speaker_boost: bool | None = None
        speed: float | None = Field(default=None, ge=0.5, le=2.0)
        chunk_length_schedule: List[int] | None = None
        try_trigger_generation: bool = True

        @field_validator("chunk_length_schedule")
        @classmethod
        def _validate_chunk_schedule(cls, value: List[int] | None) -> List[int] | None:
            if value is None:
                return None
            filtered = [item for item in value if item > 0]
            if not filtered:
                return None
            return filtered

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        voice_id: str,
        model_id: str | None = None,
        language_code: str | None = None,
        output_sample_rate: int = 22050,
        auto_mode: bool = False,
        apply_text_normalization: str | None = None,
        enable_logging: bool = True,
        enable_ssml_parsing: bool = False,
        seed: int | None = None,
        inactivity_timeout: int | None = None,
        params: InputParams | None = None,
        reconnect_on_error: bool = True,
        **kwargs,
    ):
        super().__init__(
            reconnect_on_error=reconnect_on_error,
            push_stop_frames=True,
            pause_frame_processing=True,
            sample_rate=output_sample_rate,
            **kwargs,
        )
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._voice_id = voice_id or "af_alloy"
        self._model_id = model_id
        self._language_code = language_code
        self._output_format = _output_format_from_rate(output_sample_rate)
        self._apply_text_normalization = apply_text_normalization
        self._enable_logging = enable_logging
        self._enable_ssml_parsing = enable_ssml_parsing
        self._seed = seed
        self._inactivity_timeout = inactivity_timeout
        self._auto_mode = auto_mode

        params = params or KokoroTTSService.InputParams()
        self._voice_settings = self._build_voice_settings(params)
        self._generation_config = (
            {"chunk_length_schedule": params.chunk_length_schedule}
            if params.chunk_length_schedule
            else None
        )
        self._try_trigger_generation = params.try_trigger_generation

        self._websocket = None
        self._receive_task: asyncio.Task | None = None
        self._connect_lock = asyncio.Lock()
        self._ttfb_stopped = False
        self._error_handler: Optional[Callable[[Exception], Awaitable[None]]] = None

    def set_error_handler(self, handler: Callable[[Exception], Awaitable[None]]):
        """Set a callback to be invoked when a critical error occurs."""
        self._error_handler = handler

    def _build_voice_settings(self, params: InputParams) -> Dict[str, float | bool] | None:
        payload: Dict[str, float | bool] = {}
        if params.stability is not None:
            payload["stability"] = params.stability
        if params.similarity_boost is not None:
            payload["similarity_boost"] = params.similarity_boost
        if params.style is not None:
            payload["style"] = params.style
        if params.use_speaker_boost is not None:
            payload["use_speaker_boost"] = params.use_speaker_boost
        if params.speed is not None:
            payload["speed"] = params.speed
        return payload or None

    async def start(self, frame: StartFrame):
        await super().start(frame)
        # `sample_rate` is determined by the frame if the caller overrides it.
        if not self._output_format:
            self._output_format = _output_format_from_rate(self.sample_rate or 22050)

    async def stop(self, frame: EndFrame):
        await self._send_close()
        await self._disconnect()
        await super().stop(frame)

    async def cancel(self, frame: CancelFrame):
        await self._send_close()
        await self._disconnect()
        await super().cancel(frame)

    async def set_voice(self, voice_id: str):
        """Update the voice ID and reconnect if necessary."""
        if self._voice_id == voice_id:
            return
        logger.info(f"KokoroTTSService: switching voice from {self._voice_id} to {voice_id}")
        self._voice_id = voice_id
        # Force reconnection on next usage
        await self._disconnect()

    async def set_voice_parameters(self, params: InputParams | dict):
        """Update voice parameters and reconnect if necessary."""
        if isinstance(params, dict):
            # Filter dict to only valid fields to avoid validation errors if extra fields are passed
            valid_fields = self.InputParams.model_fields.keys()
            filtered_params = {k: v for k, v in params.items() if k in valid_fields}
            params = self.InputParams(**filtered_params)
            
        new_settings = self._build_voice_settings(params)
        
        # Merge with existing settings to preserve values not included in this update
        current_settings = self._voice_settings or {}
        merged_settings = current_settings.copy()
        if new_settings:
            merged_settings.update(new_settings)
        
        # Check if settings actually changed
        if self._voice_settings == merged_settings:
            return

        logger.info(f"KokoroTTSService: updating voice settings: {merged_settings}")
        self._voice_settings = merged_settings
        
        # Update other params that are not in voice_settings but in InputParams
        self._try_trigger_generation = params.try_trigger_generation
        if params.chunk_length_schedule:
             self._generation_config = {"chunk_length_schedule": params.chunk_length_schedule}
        else:
             self._generation_config = None

        # Force reconnection on next usage
        await self._disconnect()

    async def update_setting(self, key: str, value: object):  # pragma: no cover - placeholder
        await super().update_setting(key, value)

    async def flush_audio(self):  # pragma: no cover - chorus flush happens with explicit flush flags
        return

    async def _ensure_connected(self):
        if self._websocket and self._websocket.state is State.OPEN:
            return
        async with self._connect_lock:
            if self._websocket and self._websocket.state is State.OPEN:
                return
            await self._connect()

    def _build_query(self) -> str:
        query: Dict[str, str] = {
            "output_format": self._output_format,
            "auto_mode": str(self._auto_mode).lower(),
            "enable_logging": str(self._enable_logging).lower(),
            "enable_ssml_parsing": str(self._enable_ssml_parsing).lower(),
        }
        if self._model_id:
            query["model_id"] = self._model_id
        if self._language_code:
            query["language_code"] = self._language_code
        if self._apply_text_normalization:
            query["apply_text_normalization"] = self._apply_text_normalization
        if self._seed is not None:
            query["seed"] = str(self._seed)
        if self._inactivity_timeout is not None:
            query["inactivity_timeout"] = str(self._inactivity_timeout)
        return urlencode(query)

    async def _connect(self):
        await self._connect_websocket()
        await self._initialize_connection()

    async def _connect_websocket(self):
        url = f"{self._base_url}/v1/text-to-speech/{self._voice_id}/stream-input"
        query = self._build_query()
        if query:
            url = f"{url}?{query}"

        logger.debug("KokoroTTSService: connecting to %s", url)
        try:
            self._websocket = await websocket_connect(
                url,
                max_size=16 * 1024 * 1024,
                additional_headers={"xi-api-key": self._api_key},
            )
        except OSError as e:
            # Catch connection refused and other OS-level connection errors
            logger.error(f"KokoroTTSService connection error: {e}")
            if self._error_handler:
                logger.warning("Triggering error handler for failover...")
                await self._error_handler(e)
            raise e

    async def _initialize_connection(self):
        if not self._websocket:
            raise RuntimeError("Websocket not connected")

        initial = await self._websocket.recv()
        try:
            payload = json.loads(initial)
        except json.JSONDecodeError:
            raise RuntimeError(f"Unexpected handshake payload from Kokoro: {initial!r}") from None

        if payload.get("event") != "connected":
            raise RuntimeError(f"Kokoro handshake failed: {payload}")

        logger.info(
            "KokoroTTSService connected",
            session_id=payload.get("session_id"),
            voice_id=payload.get("voice_id"),
        )

        handshake_message: Dict[str, object] = {"text": " "}
        if self._voice_settings:
            handshake_message["voice_settings"] = self._voice_settings
        if self._generation_config:
            handshake_message["generation_config"] = self._generation_config
        await self._websocket.send(json.dumps(handshake_message))

        if self._receive_task:
            await self.cancel_task(self._receive_task)
        self._receive_task = self.create_task(self._receive_messages())
        self._ttfb_stopped = False

    async def _disconnect(self):
        if self._receive_task:
            await self.cancel_task(self._receive_task)
            self._receive_task = None

        await self._disconnect_websocket()

    async def _send_close(self):
        if not self._websocket or self._websocket.state is not State.OPEN:
            return
        try:
            await self._websocket.send(json.dumps({"text": ""}))
        except Exception as exc:  # noqa: BLE001
            logger.debug("KokoroTTSService close message failed: %s", exc)

    @traced_tts
    async def run_tts(self, text: str) -> AsyncGenerator[Frame, None]:
        await self._ensure_connected()

        # Sanitize text before TTS - remove emojis and non-speakable characters
        # Kokoro TTS tries to pronounce them literally which sounds bad
        # Note: Transcripts retain the original text with all characters
        tts_text = _sanitize_for_tts(text)
        if not tts_text:
            # If text was only emojis/non-speakable chars, skip TTS entirely
            logger.debug("KokoroTTSService: skipping TTS for non-speakable text")
            yield TTSStartedFrame()
            yield None
            return

        message_text = tts_text if tts_text.endswith(" ") else f"{tts_text} "
        payload: Dict[str, object] = {
            "text": message_text,
            "flush": True,
        }
        if self._try_trigger_generation:
            payload["try_trigger_generation"] = True

        self._ttfb_stopped = False
        await self.start_ttfb_metrics()
        await self._websocket.send(json.dumps(payload))
        await self.start_tts_usage_metrics(text)

        yield TTSStartedFrame()
        yield None

    async def _receive_messages(self):
        assert self._websocket is not None
        try:
            async for message in self._websocket:
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    logger.warning("KokoroTTSService: unable to parse message %r", message)
                    continue

                event = payload.get("event")
                if event == "audioOutput":
                    await self._handle_audio_output(payload)
                elif event == "error":
                    await self._handle_error(payload)
                elif event == "finalOutput":
                    logger.debug(
                        "KokoroTTSService final output received",
                        chunks=payload.get("chunks"),
                        duration_ms=payload.get("duration_ms"),
                    )
                elif event == "connected":
                    logger.debug("KokoroTTSService received secondary connected event")
                else:
                    logger.trace("KokoroTTSService ignoring event %s", event)
        except ConnectionClosedOK:
            logger.debug("KokoroTTSService websocket closed normally")
        except ConnectionClosedError as exc:
            logger.warning("KokoroTTSService connection closed with error: %s", exc)
            await self._call_event_handler("on_connection_error", str(exc))
        except Exception as exc:  # noqa: BLE001
            logger.exception("KokoroTTSService receive loop error")
            await self._call_event_handler("on_connection_error", str(exc))
        finally:
            self._websocket = None

    async def _handle_audio_output(self, payload: Dict[str, object]):
        audio_b64 = payload.get("audio")
        if not audio_b64:
            logger.debug("KokoroTTSService audio payload missing 'audio' field: %s", payload)
            return

        try:
            audio = base64.b64decode(audio_b64)
        except Exception as exc:  # noqa: BLE001
            logger.warning("KokoroTTSService failed to decode audio chunk: %s", exc)
            return

        sample_rate = payload.get("sample_rate", self.sample_rate or 22050)
        try:
            sample_rate = int(sample_rate)
        except (TypeError, ValueError):
            sample_rate = self.sample_rate or 22050
        self._sample_rate = sample_rate

        if not self._ttfb_stopped:
            await self.stop_ttfb_metrics()
            self._ttfb_stopped = True

        frame = TTSAudioRawFrame(audio, sample_rate, 1)
        await self.push_frame(frame)

    async def _handle_error(self, payload: Dict[str, object]):
        message = payload.get("message") or "Unknown Kokoro error"
        await self._report_error(ErrorFrame(error=message))

    async def _disconnect_websocket(self):
        if self._websocket:
            try:
                await self._websocket.close()
            finally:
                self._websocket = None
