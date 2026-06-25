"""Pipecat-compatible Cartesia Sonic TTS service.

Uses Cartesia's SSE TTS endpoint with raw PCM f32 audio, converts it to
24 kHz mono s16le frames for Daily/Pipecat, and consumes Pearl tone tags as
Sonic 3 emotion controls. Natural tags that Cartesia understands, including
`[laughter]`, stay in the transcript.
"""

from __future__ import annotations

import base64
import asyncio
import json
import re
import struct
from typing import AsyncGenerator, Awaitable, Callable, Optional

import aiohttp
from loguru import logger
from pydantic import BaseModel, Field

from pipecat.frames.frames import (
    ErrorFrame,
    Frame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
)
from pipecat.services.tts_service import TTSService

DEFAULT_CARTESIA_VOICE_ID = "cc00e582-ed66-4004-8336-0175b85c85f6"
DEFAULT_CARTESIA_MODEL = "sonic-3"
DEFAULT_CARTESIA_VERSION = "2026-03-01"
DEFAULT_SAMPLE_RATE = 24000

_TONE_TAG_RE = re.compile(r"^\s*\[tone:([A-Za-z][A-Za-z /_-]{0,40})\]\s*", re.IGNORECASE)
_TONE_TAG_RE_ANY = re.compile(r"\[tone:[A-Za-z][A-Za-z /_-]{0,40}\]\s*", re.IGNORECASE)
_CARTESIA_VOICE_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}

_CARTESIA_EMOTIONS = {
    "neutral",
    "angry",
    "excited",
    "content",
    "sad",
    "scared",
    "happy",
    "enthusiastic",
    "elated",
    "euphoric",
    "triumphant",
    "amazed",
    "surprised",
    "flirtatious",
    "joking/comedic",
    "curious",
    "peaceful",
    "serene",
    "calm",
    "grateful",
    "affectionate",
    "trust",
    "sympathetic",
    "anticipation",
    "mysterious",
    "mad",
    "outraged",
    "frustrated",
    "agitated",
    "threatened",
    "disgusted",
    "contempt",
    "envious",
    "sarcastic",
    "ironic",
    "dejected",
    "melancholic",
    "disappointed",
    "hurt",
    "guilty",
    "bored",
    "tired",
    "rejected",
    "nostalgic",
    "wistful",
    "apologetic",
    "hesitant",
    "insecure",
    "confused",
    "resigned",
    "anxious",
    "panicked",
    "alarmed",
    "proud",
    "confident",
    "distant",
    "skeptical",
    "contemplative",
    "determined",
}

_EMOTION_ALIASES = {
    "comedic": "joking/comedic",
    "joking": "joking/comedic",
    "jealous": "envious",
    "shameful": "apologetic",
    "concerned": "sympathetic",
    "thoughtful": "contemplative",
}


def _normalize_emotion(value: object, default: str = "neutral") -> str:
    if not isinstance(value, str):
        return default
    normalized = value.strip().lower().replace("_", " ").replace("-", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = _EMOTION_ALIASES.get(normalized, normalized)
    return normalized if normalized in _CARTESIA_EMOTIONS else default


def _valid_cartesia_voice_id(value: object) -> bool:
    return isinstance(value, str) and bool(_CARTESIA_VOICE_ID_RE.match(value.strip()))


def _float32le_to_s16le(data: bytes) -> tuple[bytes, bytes]:
    usable = len(data) - (len(data) % 4)
    if usable <= 0:
        return b"", data

    samples = struct.unpack(f"<{usable // 4}f", data[:usable])
    out = bytearray()
    for sample in samples:
        if sample > 1.0:
            sample = 1.0
        elif sample < -1.0:
            sample = -1.0
        out.extend(struct.pack("<h", int(sample * 32767)))
    return bytes(out), data[usable:]


class CartesiaTTSService(TTSService):
    """TTS backed by Cartesia Sonic 3 over HTTP SSE."""

    class InputParams(BaseModel):
        voice_id: str = Field(default=DEFAULT_CARTESIA_VOICE_ID, description="Cartesia voice ID")
        emotion: str = Field(default="neutral", description="Default Sonic emotion")
        speed: float = Field(default=1.0, description="Sonic generation speed")
        volume: float = Field(default=1.0, description="Sonic generation volume")

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.cartesia.ai",
        model: str = DEFAULT_CARTESIA_MODEL,
        cartesia_version: str = DEFAULT_CARTESIA_VERSION,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        params: Optional[InputParams] = None,
        **kwargs,
    ):
        params = params or self.InputParams()
        params.emotion = _normalize_emotion(params.emotion)
        super().__init__(
            sample_rate=sample_rate,
            **kwargs,
        )
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._cartesia_version = cartesia_version
        self._sample_rate = sample_rate
        self._params = params
        self._session: Optional[aiohttp.ClientSession] = None
        self._error_handler: Optional[Callable[[Exception], Awaitable[None]]] = None
        self._request_lock = asyncio.Lock()
        logger.info(
            f"CartesiaTTSService init: base_url={self._base_url} model={self._model} "
            f"voice={self._params.voice_id} sr={self._sample_rate}"
        )

    async def _ensure_session(self):
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(keepalive_timeout=300)
            self._session = aiohttp.ClientSession(connector=connector)

    async def cleanup(self):
        if self._session and not self._session.closed:
            await self._session.close()
        await super().cleanup()

    def can_generate_metrics(self) -> bool:
        return True

    def set_error_handler(self, handler: Callable[[Exception], Awaitable[None]]):
        self._error_handler = handler

    async def _report_error(self, message: str):
        if self._error_handler:
            try:
                await self._error_handler(RuntimeError(message))
            except Exception as e:
                logger.warning(f"Cartesia failover handler failed: {e}")

    async def set_voice(self, voice: str):
        if not voice:
            return
        voice = voice.strip()
        if not _valid_cartesia_voice_id(voice):
            logger.warning(f"Ignoring non-Cartesia voice id for CartesiaTTSService: {voice[:80]}")
            return
        self._params.voice_id = voice

    def _extract_emotion(self, text: str) -> tuple[str, str]:
        emotion = self._params.emotion
        match = _TONE_TAG_RE.match(text)
        if match:
            emotion = _normalize_emotion(match.group(1), emotion)
            text = text[match.end():].strip()
            logger.debug(f"Cartesia tone tag -> emotion={emotion}")
        return emotion, _TONE_TAG_RE_ANY.sub("", text).strip()

    async def run_tts(self, text: str, context_id: str = "") -> AsyncGenerator[Frame, None]:
        await self._ensure_session()
        text = text.strip()
        if not text:
            return

        emotion, text = self._extract_emotion(text)
        if not text:
            return

        body = {
            "model_id": self._model,
            "transcript": text,
            "voice": {
                "mode": "id",
                "id": self._params.voice_id,
            },
            "output_format": {
                "container": "raw",
                "encoding": "pcm_f32le",
                "sample_rate": self._sample_rate,
            },
            "language": "en",
            "generation_config": {
                "volume": self._params.volume,
                "speed": self._params.speed,
                "emotion": emotion,
            },
        }
        if context_id:
            body["context_id"] = context_id

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Cartesia-Version": self._cartesia_version,
            "Content-Type": "application/json",
        }

        logger.debug(f"Cartesia TTS ({len(text)} chars, emotion={emotion}): {text[:80]}...")

        frame_bytes = int(self._sample_rate * 0.02) * 2

        try:
            async with self._request_lock:
                async for frame in self._run_tts_request(body, headers, frame_bytes):
                    yield frame
        except aiohttp.ClientError as e:
            message = f"Cartesia connection error: {e}"
            logger.error(message)
            await self._report_error(message)
            yield ErrorFrame(message)
        except Exception as e:
            message = f"Cartesia unexpected error: {e}"
            logger.error(message)
            await self._report_error(message)
            yield ErrorFrame(message)

    async def _run_tts_request(
        self,
        body: dict,
        headers: dict,
        frame_bytes: int,
    ) -> AsyncGenerator[Frame, None]:
        pcm_buf = bytearray()
        f32_remainder = b""
        started = False
        total_pcm = 0

        max_attempts = 3
        for attempt in range(max_attempts):
            async with self._session.post(
                f"{self._base_url}/tts/sse",
                json=body,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                    if resp.status in _RETRYABLE_STATUS and attempt < max_attempts - 1:
                        body_txt = await resp.text()
                        delay = min(0.35 * (2 ** attempt), 1.5)
                        logger.warning(
                            f"Cartesia retryable HTTP {resp.status} on attempt {attempt + 1}/{max_attempts}: "
                            f"{body_txt[:240]} retrying in {delay:.2f}s"
                        )
                        await asyncio.sleep(delay)
                        continue

                    if resp.status != 200:
                        body_txt = await resp.text()
                        message = f"Cartesia HTTP {resp.status}: {body_txt[:200]}"
                        logger.error(f"Cartesia error {resp.status}: {body_txt[:400]}")
                        await self._report_error(message)
                        yield ErrorFrame(message)
                        return

                    text_buf = ""
                    response_done = False
                    async for raw_chunk in resp.content.iter_chunked(4096):
                        text_buf += raw_chunk.decode("utf-8", errors="ignore")
                        lines = text_buf.splitlines(keepends=True)
                        if lines and not lines[-1].endswith(("\n", "\r")):
                            text_buf = lines.pop()
                        else:
                            text_buf = ""
                        for raw_line in lines:
                            line = raw_line.strip()
                            if not line or not line.startswith("data:"):
                                continue
                            payload = line[5:].strip()
                            if payload == "[DONE]":
                                response_done = True
                                break
                            try:
                                event = json.loads(payload)
                            except json.JSONDecodeError:
                                logger.debug(f"Cartesia ignored non-JSON SSE payload: {payload[:80]}")
                                continue
                            if event.get("type") == "error" or event.get("error"):
                                message = event.get("message") or event.get("error") or "Cartesia SSE error"
                                logger.error(f"Cartesia SSE error: {message}")
                                await self._report_error(str(message))
                                yield ErrorFrame(str(message))
                                return
                            if event.get("done") is True:
                                response_done = True
                                break
                            audio_b64 = event.get("data")
                            if event.get("type") != "chunk" or not isinstance(audio_b64, str):
                                continue

                            audio_f32 = f32_remainder + base64.b64decode(audio_b64)
                            audio_s16, f32_remainder = _float32le_to_s16le(audio_f32)
                            pcm_buf.extend(audio_s16)

                            while len(pcm_buf) >= frame_bytes:
                                chunk = bytes(pcm_buf[:frame_bytes])
                                del pcm_buf[:frame_bytes]
                                if not started:
                                    yield TTSStartedFrame()
                                    started = True
                                total_pcm += len(chunk)
                                yield TTSAudioRawFrame(
                                    audio=chunk,
                                    sample_rate=self._sample_rate,
                                    num_channels=1,
                                )
                        if response_done:
                            break

                    if text_buf.strip():
                        line = text_buf.strip()
                        if not line or not line.startswith("data:"):
                            logger.debug(f"Cartesia ignored trailing SSE fragment: {line[:80]}")

            if pcm_buf:
                rem = len(pcm_buf) % 2
                if rem:
                    pcm_buf = pcm_buf[:-rem]
                if pcm_buf:
                    if not started:
                        yield TTSStartedFrame()
                        started = True
                    total_pcm += len(pcm_buf)
                    yield TTSAudioRawFrame(
                        audio=bytes(pcm_buf),
                        sample_rate=self._sample_rate,
                        num_channels=1,
                    )

            if started:
                silence = b"\x00" * (self._sample_rate * 80 // 1000 * 2)
                yield TTSAudioRawFrame(
                    audio=silence,
                    sample_rate=self._sample_rate,
                    num_channels=1,
                )
                logger.debug(f"Cartesia done: {total_pcm}B")
                yield TTSStoppedFrame()
                return
            else:
                message = "Cartesia returned no audio data"
                logger.error(message)
                await self._report_error(message)
                yield ErrorFrame(message)
                return
