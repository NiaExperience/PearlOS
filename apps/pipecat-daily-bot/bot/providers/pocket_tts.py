"""Pipecat-compatible PocketTTS service.

Connects to a local PocketTTS server (https://github.com/kyutai-labs/pocket-tts)
via HTTP POST /tts. The server returns WAV audio which we decode and stream as
raw PCM frames to the Pipecat pipeline.

PocketTTS runs entirely on CPU, supports voice cloning, and has ~200ms latency
to first audio chunk.
"""

from __future__ import annotations

import io
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


class PocketTTSService(TTSService):
    """TTS service backed by a local PocketTTS HTTP server.

    Usage:
        svc = PocketTTSService(
            base_url="http://localhost:8766",
            sample_rate=24000,
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
        sample_rate: int = 24000,
        params: Optional[InputParams] = None,
        **kwargs,
    ):
        super().__init__(sample_rate=sample_rate, **kwargs)
        self._base_url = base_url.rstrip("/")
        self._params = params or self.InputParams()
        self._session: Optional[aiohttp.ClientSession] = None
        logger.info(f"PocketTTSService initialized: base_url={self._base_url}, sample_rate={sample_rate}")

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

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        """Synthesize text via PocketTTS HTTP API and yield audio frames.

        Streams the response incrementally — reads the WAV header from the first
        chunk, then yields PCM audio frames as they arrive from the server.
        This eliminates the latency spike from buffering the entire response and
        provides smoother audio delivery to the transport, reducing crackling.
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
        if self._params.voice_url:
            data.add_field("voice_url", self._params.voice_url)

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
                playback_rate = 24000
                frame_size = 2  # channels * width

                # How many bytes per 20ms audio chunk
                chunk_frames = 480  # 24000 / 50
                chunk_bytes = 960  # chunk_frames * frame_size

                # Prebuffer: accumulate this many chunks before yielding
                # TTSStartedFrame to prime the transport buffer.
                PREBUFFER_CHUNKS = 8  # 160ms prebuffer — prevents crackling from buffer underruns
                prebuffer = []
                started = False
                total_pcm_bytes = 0

                async for network_chunk in resp.content.iter_chunked(8192):
                    raw_buf.extend(network_chunk)

                    # Step 1: Parse WAV header once we have enough bytes
                    if not header_parsed:
                        # Standard WAV header is 44 bytes; some have extra
                        # sub-chunks. Try parsing once we have >=128 bytes.
                        if len(raw_buf) < 128:
                            continue

                        result = self._parse_wav_header(bytes(raw_buf))
                        if result is None:
                            # Try with more data next iteration
                            if len(raw_buf) > 4096:
                                logger.error("PocketTTS: couldn't parse WAV header after 4KB")
                                yield ErrorFrame("PocketTTS WAV header parse failed")
                                return
                            continue

                        src_rate, src_channels, src_width, data_offset = result
                        frame_size = src_channels * src_width
                        chunk_frames = src_rate // 50  # 20ms
                        chunk_bytes = chunk_frames * frame_size

                        playback_rate = int(src_rate * self._params.speed)
                        if self._params.speed != 1.0:
                            logger.debug(
                                f"PocketTTS speed={self._params.speed}: "
                                f"reporting rate as {playback_rate} (actual {src_rate})"
                            )

                        logger.debug(
                            f"PocketTTS streaming: rate={src_rate}, ch={src_channels}, "
                            f"width={src_width}, data_offset={data_offset}"
                        )

                        # Strip the header, keep only PCM data
                        raw_buf = raw_buf[data_offset:]
                        header_parsed = True

                    # Step 2: Yield complete 20ms chunks from the buffer
                    while len(raw_buf) >= chunk_bytes:
                        chunk = bytes(raw_buf[:chunk_bytes])
                        del raw_buf[:chunk_bytes]
                        total_pcm_bytes += len(chunk)

                        audio_frame = TTSAudioRawFrame(
                            audio=chunk,
                            sample_rate=playback_rate,
                            num_channels=src_channels,
                        )

                        if not started:
                            # Accumulate prebuffer before signaling start
                            prebuffer.append(audio_frame)
                            if len(prebuffer) >= PREBUFFER_CHUNKS:
                                # Signal start FIRST, then yield prebuffered frames
                                yield TTSStartedFrame()
                                started = True
                                for pf in prebuffer:
                                    yield pf
                                prebuffer = []
                        else:
                            yield audio_frame

                # Flush remaining PCM data in buffer
                if header_parsed and raw_buf:
                    remainder = len(raw_buf) % frame_size
                    if remainder:
                        raw_buf = raw_buf[:-remainder]
                    if raw_buf:
                        total_pcm_bytes += len(raw_buf)
                        audio_frame = TTSAudioRawFrame(
                            audio=bytes(raw_buf),
                            sample_rate=playback_rate,
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
                    # Append 60ms of silence to bridge gap before next TTS segment
                    # This prevents pops/clicks from abrupt audio cutoff between clauses
                    silence_frames = src_rate * 60 // 1000  # 60ms worth
                    silence_bytes = b'\x00' * (silence_frames * frame_size)
                    yield TTSAudioRawFrame(
                        audio=silence_bytes,
                        sample_rate=playback_rate,
                        num_channels=src_channels,
                    )
                    duration = total_pcm_bytes / (src_rate * frame_size) if src_rate and frame_size else 0
                    logger.debug(f"PocketTTS done streaming: {total_pcm_bytes} bytes, {duration:.2f}s")
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
