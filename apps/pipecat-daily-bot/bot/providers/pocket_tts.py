"""Pipecat-compatible PocketTTS service.

Connects to a local PocketTTS server (https://github.com/kyutai-labs/pocket-tts)
via HTTP POST /tts. The server returns WAV audio which we decode and stream as
raw PCM frames to the Pipecat pipeline.

PocketTTS runs entirely on CPU, supports voice cloning, and has ~200ms latency
to first audio chunk.

Audio is output at PocketTTS's native 24kHz. Pipecat's base_output transport
handles any further resampling via SOXR (VHQ quality) if needed.
"""

from __future__ import annotations

import io
import os
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

# Output at PocketTTS native 24kHz — pipecat's SOXR resampler in base_output
# handles any conversion needed by the transport (e.g. 24k→48k for Opus).
_OUTPUT_SAMPLE_RATE = 24000

# TTS output gain multiplier. PocketTTS (Azelma) outputs audio at a low level
# that's barely audible in screen recordings. This boosts PCM amplitude.
# Default 3.0x (~9.5dB gain). Set TTS_GAIN env var to override.
_TTS_GAIN = float(os.environ.get("TTS_GAIN", "3.0"))


_SOFT_CLIP_KNEE = 26000  # ~80% of full scale; samples below pass through linearly


def _is_voice_url(value: str | None) -> bool:
    if not value:
        return False
    lowered = value.strip().lower()
    return lowered.startswith(("http://", "https://", "hf://"))


def _apply_gain(pcm_bytes: bytes, gain: float) -> bytes:
    """Amplify 16-bit PCM audio with a soft knee instead of hard clipping.

    Hard clipping at ±32767 produces audible buzzing on loud passages.
    Below the knee we apply gain linearly; above it we asymptote toward
    the rail using a smooth piecewise compression so peaks bend rather
    than slam, eliminating the characteristic clip-buzz reported by Blair.
    """
    if gain == 1.0:
        return pcm_bytes
    n_samples = len(pcm_bytes) // 2
    samples = struct.unpack(f"<{n_samples}h", pcm_bytes)
    boosted = []
    knee = _SOFT_CLIP_KNEE
    headroom = 32767 - knee
    for s in samples:
        v = s * gain
        absv = v if v >= 0 else -v
        if absv <= knee:
            out = int(v)
        else:
            over = absv - knee
            compressed = knee + headroom * (over / (over + headroom))
            out = int(compressed if v >= 0 else -compressed)
            if out > 32767:
                out = 32767
            elif out < -32768:
                out = -32768
        boosted.append(out)
    return struct.pack(f"<{n_samples}h", *boosted)


class PocketTTSService(TTSService):
    """TTS service backed by a local PocketTTS HTTP server.

    Usage:
        svc = PocketTTSService(
            base_url="http://localhost:8766",
            sample_rate=16000,  # output rate after resampling
        )
    """

    class InputParams(BaseModel):
        """Parameters forwarded to PocketTTS /tts endpoint."""
        voice_url: Optional[str] = Field(default=None, description="URL to voice WAV for cloning")
        speed: float = Field(default=1.0, description="Playback speed multiplier (e.g. 1.2 = 20% faster)")

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:8766",
        sample_rate: int = _OUTPUT_SAMPLE_RATE,
        params: Optional[InputParams] = None,
        **kwargs,
    ):
        # Always output at _OUTPUT_SAMPLE_RATE regardless of what caller passes
        super().__init__(sample_rate=_OUTPUT_SAMPLE_RATE, **kwargs)
        self._base_url = base_url.rstrip("/")
        self._params = params or self.InputParams()
        self._session: Optional[aiohttp.ClientSession] = None
        logger.info(f"PocketTTSService initialized: base_url={self._base_url}, output_sample_rate={_OUTPUT_SAMPLE_RATE}")

    async def _ensure_session(self):
        if self._session is None or self._session.closed:
            # Use a TCP connector with keepalive to reduce connection overhead
            connector = aiohttp.TCPConnector(keepalive_timeout=300)
            self._session = aiohttp.ClientSession(connector=connector)

    async def cleanup(self):
        if self._session and not self._session.closed:
            await self._session.close()
        await super().cleanup()

    def can_generate_metrics(self) -> bool:
        return True

    def _parse_wav_header(self, header_bytes: bytes) -> tuple[int, int, int, int] | None:
        """Parse WAV header to extract audio format info.

        Returns (sample_rate, num_channels, sample_width, data_offset) or None on failure.
        PocketTTS streams WAV with chunked transfer encoding. The header is in
        the first chunk (typically 44 bytes for standard WAV, but can vary with
        extra sub-chunks). We parse it to get format info for the PCM data that
        follows.
        """
        try:
            bio = io.BytesIO(header_bytes)
            with wave.open(bio, "rb") as wf:
                src_rate = wf.getframerate()
                src_channels = wf.getnchannels()
                src_width = wf.getsampwidth()
                # After wave.open reads params + positions to data start,
                # bio.tell() is at the PCM data offset
                data_offset = bio.tell()
            return (src_rate, src_channels, src_width, data_offset)
        except Exception as e:
            logger.error(f"PocketTTS WAV header parse error: {e}")
            return None

    async def run_tts(self, text: str, context_id: str = "") -> AsyncGenerator[Frame, None]:
        """Synthesize text via PocketTTS HTTP API and yield audio frames.

        Streams the response incrementally — reads the WAV header from the first
        chunk, then yields PCM audio frames as they arrive from the server.
        This eliminates the latency spike from buffering the entire response and
        provides smoother audio delivery to the transport, reducing crackling.
        
        Args:
            text: Text to synthesize
            context_id: Optional context identifier for tracking (unused by PocketTTS)
        """
        await self._ensure_session()

        # Skip empty or whitespace-only text
        text = text.strip()
        if not text:
            return

        logger.debug(f"PocketTTS synthesizing ({len(text)} chars): {text[:80]}...")

        # Build multipart form data
        data = aiohttp.FormData()
        data.add_field("text", text)
        if _is_voice_url(self._params.voice_url):
            data.add_field("voice_url", self._params.voice_url)
        elif self._params.voice_url:
            logger.debug(
                f"PocketTTS ignoring non-URL voice selector: {self._params.voice_url[:80]}"
            )

        try:
            async with self._session.post(
                f"{self._base_url}/tts",
                data=data,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.error(f"PocketTTS error {resp.status}: {body}")
                    yield ErrorFrame(f"PocketTTS HTTP {resp.status}: {body}")
                    return

                # --- Streaming WAV parser ---
                # PocketTTS returns chunked WAV. We accumulate bytes until we
                # have enough to parse the header, then stream PCM chunks as
                # they arrive.

                raw_buf = bytearray()
                header_parsed = False
                src_rate = 24000
                src_channels = 1
                src_width = 2  # 16-bit
                data_offset = 44
                frame_size = 2  # channels * width

                # Output at native sample rate (no resampling here)
                out_rate = _OUTPUT_SAMPLE_RATE
                out_frame_size = 2  # mono 16-bit

                # How many bytes per 20ms output chunk
                out_chunk_frames = out_rate // 50  # 480 frames at 24kHz
                out_chunk_bytes = out_chunk_frames * out_frame_size

                # Prebuffer: accumulate chunks before yielding TTSStartedFrame
                PREBUFFER_CHUNKS = 12  # 240ms prebuffer
                prebuffer = []
                started = False
                total_pcm_bytes = 0

                # Output buffer (accumulates PCM for chunking into 20ms frames)
                out_buf = bytearray()

                async for network_chunk in resp.content.iter_chunked(8192):
                    raw_buf.extend(network_chunk)

                    # Step 1: Parse WAV header once we have enough bytes
                    if not header_parsed:
                        if len(raw_buf) < 128:
                            continue

                        result = self._parse_wav_header(bytes(raw_buf))
                        if result is None:
                            if len(raw_buf) > 4096:
                                logger.error("PocketTTS: couldn't parse WAV header after 4KB")
                                yield ErrorFrame("PocketTTS WAV header parse failed")
                                return
                            continue

                        src_rate, src_channels, src_width, data_offset = result
                        frame_size = src_channels * src_width

                        logger.debug(
                            f"PocketTTS streaming: src_rate={src_rate}, ch={src_channels}, "
                            f"width={src_width}, passthrough at {out_rate}Hz"
                        )

                        # Strip the header, keep only PCM data
                        raw_buf = raw_buf[data_offset:]
                        header_parsed = True

                    # Step 2: Pass through native PCM in 20ms chunks
                    out_buf.extend(raw_buf)
                    raw_buf.clear()

                    while len(out_buf) >= out_chunk_bytes:
                        chunk = bytes(out_buf[:out_chunk_bytes])
                        del out_buf[:out_chunk_bytes]
                        if _TTS_GAIN != 1.0:
                            chunk = _apply_gain(chunk, _TTS_GAIN)
                        total_pcm_bytes += len(chunk)

                        audio_frame = TTSAudioRawFrame(
                            audio=chunk,
                            sample_rate=out_rate,
                            num_channels=src_channels,
                        )

                        if not started:
                            prebuffer.append(audio_frame)
                            if len(prebuffer) >= PREBUFFER_CHUNKS:
                                yield TTSStartedFrame()
                                started = True
                                for pf in prebuffer:
                                    yield pf
                                prebuffer = []
                        else:
                            yield audio_frame

                # Flush remaining output buffer
                if out_buf:
                    out_remainder = len(out_buf) % out_frame_size
                    if out_remainder:
                        out_buf = out_buf[:-out_remainder]
                    if out_buf:
                        remainder = bytes(out_buf)
                        if _TTS_GAIN != 1.0:
                            remainder = _apply_gain(remainder, _TTS_GAIN)
                        total_pcm_bytes += len(remainder)
                        audio_frame = TTSAudioRawFrame(
                            audio=remainder,
                            sample_rate=out_rate,
                            num_channels=src_channels,
                        )
                        if not started:
                            prebuffer.append(audio_frame)
                        else:
                            yield audio_frame

                # If we never hit the prebuffer threshold (short audio),
                # flush whatever we have
                if not started and prebuffer:
                    yield TTSStartedFrame()
                    started = True
                    for pf in prebuffer:
                        yield pf

                if started:
                    # Append 80ms of silence to bridge gap before next TTS segment
                    silence_frames = out_rate * 80 // 1000
                    silence_bytes = b'\x00' * (silence_frames * out_frame_size)
                    yield TTSAudioRawFrame(
                        audio=silence_bytes,
                        sample_rate=out_rate,
                        num_channels=src_channels,
                    )
                    duration = total_pcm_bytes / (out_rate * out_frame_size) if out_rate and out_frame_size else 0
                    logger.debug(f"PocketTTS done streaming: {total_pcm_bytes} bytes, {duration:.2f}s (output at {out_rate}Hz)")
                    yield TTSStoppedFrame()
                else:
                    logger.error("PocketTTS returned no audio data")
                    yield ErrorFrame("PocketTTS returned no audio data")

        except aiohttp.ClientError as e:
            logger.error(f"PocketTTS connection error: {e}")
            yield ErrorFrame(f"PocketTTS connection error: {e}")
        except Exception as e:
            logger.error(f"PocketTTS unexpected error: {e}")
            yield ErrorFrame(f"PocketTTS unexpected error: {e}")
