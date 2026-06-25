"""Pipecat-compatible Voxtral TTS service (vLLM /v1/audio/speech endpoint).

Talks to a Voxtral-4B-TTS deployment served by vllm-omni. The endpoint is
OpenAI-compatible but actually routes audio through vLLM's omni pipeline.
Bearer auth via an API key.

Voxtral streams WAV; we parse the header once, then pass PCM frames through
in 20ms chunks. Output is 24 kHz mono s16le to match Voxtral's native rate
(pipecat SOXR handles transport resampling if needed).
"""

from __future__ import annotations

import io
import os
import re
import struct
import wave
from typing import AsyncGenerator, Optional

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

_OUTPUT_SAMPLE_RATE = 24000
_TTS_GAIN = float(os.environ.get("VOXTRAL_TTS_GAIN", "1.0"))

# Map LLM-emitted tone tags to Voxtral speaker presets.
# Pearl uses Jane's full emotional range on Mistral's hosted API.
# Each tone tag maps to a distinct Jane voice preset with real vocal emotion.
TONE_VOICE_MAP_MISTRAL = {
    # Direct matches to Jane presets
    "neutral": "gb_jane_neutral",
    "sarcastic": "gb_jane_sarcasm",
    "confused": "gb_jane_confused",
    "shameful": "gb_jane_shameful",
    "sad": "gb_jane_sad",
    "jealous": "gb_jane_jealousy",
    "frustrated": "gb_jane_frustrated",
    "curious": "gb_jane_curious",
    "confident": "gb_jane_confident",
    # Aliases — map common tone tags to closest Jane preset
    "happy": "gb_jane_confident",
    "cheerful": "gb_jane_confident",
    "excited": "gb_jane_confident",
    "casual": "gb_jane_neutral",
    "friendly": "gb_jane_neutral",
    "professional": "gb_jane_confident",
    "serious": "gb_jane_neutral",
    "warm": "gb_jane_neutral",
    "playful": "gb_jane_sarcasm",
    "concerned": "gb_jane_sad",
    "sympathetic": "gb_jane_sad",
    "thoughtful": "gb_jane_curious",
    "angry": "gb_jane_frustrated",
}
TONE_VOICE_MAP_LOCAL = {
    "happy": "cheerful_female",
    "cheerful": "cheerful_female",
    "excited": "cheerful_female",
    "casual": "casual_female",
    "friendly": "casual_female",
    "neutral": "neutral_female",
    "professional": "neutral_female",
    "serious": "neutral_female",
    "sarcastic": "casual_female",
    "sad": "neutral_female",
}
# Auto-select based on default voice format
TONE_VOICE_MAP = TONE_VOICE_MAP_MISTRAL

_TONE_TAG_RE = re.compile(r"^\s*\[tone:(\w+)\]\s*", re.IGNORECASE)
# Strip any stray inline tone tags that the prefix-only regex above missed.
# Without this, mid-utterance `[tone:happy]` literals would be spoken aloud.
_TONE_TAG_RE_ANY = re.compile(r"\[tone:\w+\]\s*", re.IGNORECASE)
# Cartesia natural speech tags (e.g. [laughter]) — Voxtral doesn't support
# these natively, so strip them to prevent the TTS from speaking them literally.
_NATURAL_TAG_RE = re.compile(r"\[laughter\]", re.IGNORECASE)


def _apply_gain(pcm_bytes: bytes, gain: float) -> bytes:
    if gain == 1.0:
        return pcm_bytes
    n = len(pcm_bytes) // 2
    samples = struct.unpack(f"<{n}h", pcm_bytes)
    boosted = []
    for s in samples:
        v = int(s * gain)
        if v > 32767:
            v = 32767
        elif v < -32768:
            v = -32768
        boosted.append(v)
    return struct.pack(f"<{n}h", *boosted)


class VoxtralTTSService(TTSService):
    """TTS backed by a Voxtral vllm-omni HTTP server."""

    class InputParams(BaseModel):
        speed: float = Field(default=1.0, description="Playback speed multiplier")
        voice: str = Field(default="casual_female", description="Voxtral voice preset")
        response_format: str = Field(default="wav", description="Audio format (wav, mp3)")

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:8100",
        api_key: Optional[str] = None,
        model: str = "mistralai/Voxtral-4B-TTS-2603",
        sample_rate: int = _OUTPUT_SAMPLE_RATE,
        params: Optional[InputParams] = None,
        **kwargs,
    ):
        params = params or self.InputParams()
        super().__init__(
            sample_rate=_OUTPUT_SAMPLE_RATE,
            **kwargs,
        )
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._params = params
        self._session: Optional[aiohttp.ClientSession] = None
        logger.info(
            f"VoxtralTTSService init: base_url={self._base_url} model={self._model} "
            f"voice={self._params.voice} sr={_OUTPUT_SAMPLE_RATE}"
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

    def _parse_wav_header(self, header_bytes: bytes):
        try:
            bio = io.BytesIO(header_bytes)
            with wave.open(bio, "rb") as wf:
                sr = wf.getframerate()
                ch = wf.getnchannels()
                w = wf.getsampwidth()
                off = bio.tell()
            return (sr, ch, w, off)
        except Exception as e:
            logger.error(f"Voxtral WAV header parse error: {e}")
            return None

    async def run_tts(self, text: str, context_id: str = "") -> AsyncGenerator[Frame, None]:
        await self._ensure_session()
        text = text.strip()
        if not text:
            return

        voice = self._params.voice
        tone_match = _TONE_TAG_RE.match(text)
        voice_changed = False
        if tone_match:
            tone = tone_match.group(1).lower()
            mapped = TONE_VOICE_MAP.get(tone)
            if mapped:
                if mapped != voice:
                    voice_changed = True
                voice = mapped
                logger.debug(f"Voxtral tone tag [{tone}] -> voice={voice}")
            else:
                logger.debug(f"Voxtral tone tag [{tone}] not in map; using default voice")
            text = text[tone_match.end():].strip()
            if not text:
                return

        text = _TONE_TAG_RE_ANY.sub("", text).strip()
        text = _NATURAL_TAG_RE.sub("", text).strip()
        if not text:
            return

        body = {
            "model": self._model,
            "input": text,
            "voice": voice,
            "response_format": self._params.response_format,
        }
        # Mistral's hosted API does not accept a "speed" parameter (HTTP 422).
        # Only include it when talking to a local vLLM endpoint which supports it.
        is_mistral_hosted = "api.mistral.ai" in self._base_url
        if not is_mistral_hosted and self._params.speed != 1.0:
            body["speed"] = self._params.speed
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        logger.debug(f"Voxtral TTS ({len(text)} chars): {text[:80]}...")

        try:
            async with self._session.post(
                f"{self._base_url}/v1/audio/speech",
                json=body,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status != 200:
                    body_txt = await resp.text()
                    logger.error(f"Voxtral error {resp.status}: {body_txt[:400]}")
                    yield ErrorFrame(f"Voxtral HTTP {resp.status}: {body_txt[:200]}")
                    return

                # Mistral hosted API returns JSON {"audio_data": "<base64>"}
                # containing MP3/WAV. Detect and decode before WAV parsing.
                content_type = resp.headers.get("content-type", "")
                resp_bytes = await resp.read()

                if resp_bytes[:1] == b"{":
                    import json as _json, base64 as _b64
                    try:
                        envelope = _json.loads(resp_bytes)
                        audio_b64 = envelope.get("audio_data", "")
                        resp_bytes = _b64.b64decode(audio_b64)
                        logger.debug(f"Voxtral: decoded {len(resp_bytes)} bytes from JSON envelope")
                    except Exception as e:
                        logger.error(f"Voxtral JSON decode failed: {e}")
                        yield ErrorFrame(f"Voxtral JSON decode failed: {e}")
                        return

                # If decoded data is MP3 (ID3 tag), convert to PCM via pydub/ffmpeg
                if resp_bytes[:3] == b"ID3" or (len(resp_bytes) > 1 and resp_bytes[0] == 0xFF and (resp_bytes[1] & 0xE0) == 0xE0):
                    try:
                        import subprocess, tempfile
                        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_mp3:
                            tmp_mp3.write(resp_bytes)
                            tmp_mp3_path = tmp_mp3.name
                        tmp_wav_path = tmp_mp3_path.replace(".mp3", ".wav")
                        subprocess.run(
                            ["ffmpeg", "-y", "-i", tmp_mp3_path, "-ar", str(_OUTPUT_SAMPLE_RATE),
                             "-ac", "1", "-f", "s16le", tmp_wav_path],
                            capture_output=True, timeout=10,
                        )
                        with open(tmp_wav_path, "rb") as f:
                            pcm_data = f.read()
                        import os
                        os.unlink(tmp_mp3_path)
                        os.unlink(tmp_wav_path)
                        logger.debug(f"Voxtral: MP3->PCM {len(resp_bytes)}B -> {len(pcm_data)}B")
                        # Yield PCM directly in chunks
                        out_rate = _OUTPUT_SAMPLE_RATE
                        out_frame_size = 2
                        out_chunk_frames = out_rate // 50
                        out_chunk_bytes = out_chunk_frames * out_frame_size
                        for i in range(0, len(pcm_data), out_chunk_bytes):
                            chunk = pcm_data[i:i + out_chunk_bytes]
                            if len(chunk) < out_chunk_bytes:
                                chunk = chunk + b"\x00" * (out_chunk_bytes - len(chunk))
                            if _TTS_GAIN != 1.0:
                                chunk = _apply_gain(chunk, _TTS_GAIN)
                            yield TTSAudioRawFrame(audio=chunk, sample_rate=out_rate, num_channels=1)
                        yield TTSStoppedFrame()
                        return
                    except Exception as e:
                        logger.error(f"Voxtral MP3->PCM conversion failed: {e}")
                        yield ErrorFrame(f"Voxtral MP3 decode failed: {e}")
                        return

                raw_buf = bytearray(resp_bytes)
                header_parsed = False
                src_rate = 24000
                src_ch = 1
                src_w = 2
                data_offset = 44

                out_rate = _OUTPUT_SAMPLE_RATE
                out_frame_size = 2
                out_chunk_frames = out_rate // 50  # 20ms
                out_chunk_bytes = out_chunk_frames * out_frame_size

                PREBUFFER_CHUNKS = 12
                prebuffer = []
                started = False
                total_pcm = 0
                out_buf = bytearray()

                # When the tone tag flipped Voxtral to a different voice
                # preset for this utterance, prepend ~50ms of silence so the
                # listener perceives a clean break rather than a formant
                # crack between voices.
                if voice_changed:
                    pad_frames = out_rate * 50 // 1000
                    pad = b"\x00" * (pad_frames * out_frame_size)
                    pad_frame = TTSAudioRawFrame(
                        audio=pad, sample_rate=out_rate, num_channels=1
                    )
                    prebuffer.append(pad_frame)
                    total_pcm += len(pad)

                # Process as WAV (for local vLLM or raw WAV responses)
                result = self._parse_wav_header(bytes(raw_buf))
                if result is None:
                    logger.error(f"Voxtral WAV header parse failed on {len(raw_buf)} bytes, first 4: {raw_buf[:4]}")
                    yield ErrorFrame("Voxtral WAV header parse failed")
                    return
                src_rate, src_ch, src_w, data_offset = result
                raw_buf = raw_buf[data_offset:]
                header_parsed = True
                logger.debug(
                    f"Voxtral stream sr={src_rate} ch={src_ch} w={src_w} passthrough to {out_rate}Hz"
                )

                out_buf.extend(raw_buf)

                while len(out_buf) >= out_chunk_bytes:
                    chunk = bytes(out_buf[:out_chunk_bytes])
                    del out_buf[:out_chunk_bytes]
                    if _TTS_GAIN != 1.0:
                        chunk = _apply_gain(chunk, _TTS_GAIN)
                    total_pcm += len(chunk)
                    frame = TTSAudioRawFrame(
                        audio=chunk,
                        sample_rate=out_rate,
                        num_channels=src_ch,
                    )
                    if not started:
                        prebuffer.append(frame)
                        if len(prebuffer) >= PREBUFFER_CHUNKS:
                            yield TTSStartedFrame()
                            started = True
                            for pf in prebuffer:
                                yield pf
                            prebuffer = []
                    else:
                        yield frame

                if out_buf:
                    rem_mod = len(out_buf) % out_frame_size
                    if rem_mod:
                        out_buf = out_buf[:-rem_mod]
                    if out_buf:
                        remainder = bytes(out_buf)
                        if _TTS_GAIN != 1.0:
                            remainder = _apply_gain(remainder, _TTS_GAIN)
                        total_pcm += len(remainder)
                        frame = TTSAudioRawFrame(
                            audio=remainder,
                            sample_rate=out_rate,
                            num_channels=src_ch,
                        )
                        if not started:
                            prebuffer.append(frame)
                        else:
                            yield frame

                if not started and prebuffer:
                    yield TTSStartedFrame()
                    started = True
                    for pf in prebuffer:
                        yield pf

                if started:
                    silence_frames = out_rate * 80 // 1000
                    silence = b"\x00" * (silence_frames * out_frame_size)
                    yield TTSAudioRawFrame(
                        audio=silence, sample_rate=out_rate, num_channels=src_ch
                    )
                    dur = total_pcm / (out_rate * out_frame_size) if out_rate else 0
                    logger.debug(f"Voxtral done: {total_pcm}B {dur:.2f}s")
                    yield TTSStoppedFrame()
                else:
                    logger.error("Voxtral returned no audio data")
                    yield ErrorFrame("Voxtral returned no audio data")

        except aiohttp.ClientError as e:
            logger.error(f"Voxtral connection error: {e}")
            yield ErrorFrame(f"Voxtral connection error: {e}")
        except Exception as e:
            logger.error(f"Voxtral unexpected error: {e}")
            yield ErrorFrame(f"Voxtral unexpected error: {e}")
