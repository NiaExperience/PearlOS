# SPDX-License-Identifier: MIT
"""Thin wrapper around `kokoro_onnx.Kokoro` for websocket-friendly audio.

Provides helpers for PCM conversion and base64 encoding to support FastAPI
handlers that stream audio over websockets.
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass
from typing import Any, cast

import numpy as np

from .config import Settings
from .voices import VoiceRegistry

try:
    from kokoro_onnx import Kokoro as _ImportedKokoro
except (ImportError, AttributeError):  # pragma: no cover - optional dependency
    _Kokoro: Any | None = None
else:
    _Kokoro = cast(Any, _ImportedKokoro)

Kokoro: Any | None = _Kokoro

try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover - onnxruntime is an optional runtime dependency
    ort = cast(Any, None)

KokoroFactory = Callable[[str, str], Any]


class SessionPool:
    """Asynchronous pool for Kokoro sessions."""

    def __init__(self, size: int, factory: Callable[[], Any]) -> None:
        """Initialise the pool with a desired size and factory callback."""
        self._size = max(size, 1)
        self._factory = factory
        self._lock = asyncio.Lock()
        self._created = 0
        self._available: asyncio.Queue[Any] = asyncio.Queue(maxsize=self._size)

    @property
    def size(self) -> int:
        """Total number of sessions managed by the pool."""
        return self._size

    @property
    def created(self) -> int:
        """Number of sessions created so far."""
        return self._created

    @property
    def available(self) -> int:
        """Number of idle sessions ready for leasing."""
        return self._available.qsize()

    async def ensure_ready(self) -> None:
        """Build the session pool if it has not yet been initialised."""
        if self._created >= self._size:
            return

        async with self._lock:
            while self._created < self._size:
                session = self._factory()
                self._created += 1
                await self._available.put(session)

    async def acquire(self) -> Any:
        """Lease an existing session, creating the pool on first use."""
        await self.ensure_ready()
        return await self._available.get()

    async def release(self, session: Any) -> None:
        """Return a leased session to the pool."""
        self._available.put_nowait(session)


@dataclass(frozen=True, slots=True)
class AudioChunk:
    """Bundled audio payload returned by the engine."""

    voice_id: str
    sample_rate: int
    pcm: bytes

    def as_base64(self) -> str:
        """Return the PCM data encoded as base64."""
        return base64.b64encode(self.pcm).decode("ascii")


def float_to_pcm16(audio: np.ndarray) -> bytes:
    """Convert a floating-point numpy array in [-1, 1] to 16-bit PCM bytes."""
    if audio.ndim != 1:
        message = "Audio array must be one-dimensional."
        raise ValueError(message)
    clipped = np.clip(audio, -1.0, 1.0)
    scaled = np.round(clipped * 32767.0).astype("<i2")
    return scaled.tobytes()


class KokoroEngine:
    """Lazily wraps `kokoro_onnx.Kokoro` with pooling and streaming helpers."""

    def __init__(
        self,
        settings: Settings,
        voice_registry: VoiceRegistry,
        kokoro_factory: KokoroFactory | None = None,
        session_pool: SessionPool | None = None,
    ) -> None:
        """Initialise the engine wrapper and prepare the session pool."""
        if Kokoro is None and kokoro_factory is None:
            message = "kokoro-onnx must be installed to use KokoroEngine."
            raise RuntimeError(message)

        self._settings = settings
        self._voice_registry = voice_registry
        self._kokoro_factory = kokoro_factory or self._default_factory
        self._pool_size = max(int(settings.session_pool_size), 1)

        def factory() -> Any:
            return self.build_session()

        self._session_pool = session_pool or SessionPool(self._pool_size, factory)

    @property
    def pool(self) -> SessionPool:
        """Expose the session pool for observability and tests."""
        return self._session_pool

    def build_session(
        self,
        *,
        model_path: str | None = None,
        voices_path: str | None = None,
    ) -> Any:
        """Construct a Kokoro session using the configured factory."""
        model = model_path or str(self._settings.model_path)
        voices = voices_path or str(self._settings.voices_path)
        return self._kokoro_factory(model, voices)

    async def stream_text(
        self,
        text: str,
        voice_id: str | None = None,
        *,
        speed: float = 1.0,
        lang: str = "en-us",
        is_phonemes: bool = False,
        trim: bool = True,
    ) -> AsyncGenerator[AudioChunk, None]:
        """Stream audio chunks for the provided text."""
        if not (0.5 <= speed <= 2.0):
            message = "Speed must be between 0.5 and 2.0."
            raise ValueError(message)

        kokoro = await self._session_pool.acquire()
        resolved_id, info = self._voice_registry.resolve(voice_id)
        kokoro_voice = info.voice_id

        try:
            async for audio_array, sample_rate in kokoro.create_stream(
                text=text,
                voice=kokoro_voice,
                speed=speed,
                lang=lang,
                is_phonemes=is_phonemes,
                trim=trim,
            ):
                yield AudioChunk(
                    voice_id=resolved_id,
                    sample_rate=sample_rate,
                    pcm=float_to_pcm16(audio_array),
                )
        finally:
            await self._session_pool.release(kokoro)

    async def warm_pool(
        self,
        *,
        text: str,
        voice_id: str,
        speed: float = 1.0,
        lang: str = "en-us",
        is_phonemes: bool = False,
        trim: bool = True,
    ) -> int:
        """Warm each pooled session to minimise the first-request latency.

        Returns:
            Number of sessions warmed.

        """
        _resolved_id, info = self._voice_registry.resolve(voice_id)
        await self._session_pool.ensure_ready()
        warmed = 0
        leased: list[Any] = []
        try:
            for _ in range(self._pool_size):
                session = await self._session_pool.acquire()
                leased.append(session)
                async for _audio, _rate in session.create_stream(
                    text=text,
                    voice=info.voice_id,
                    speed=speed,
                    lang=lang,
                    is_phonemes=is_phonemes,
                    trim=trim,
                ):
                    break
                warmed += 1
        finally:
            for session in leased:
                await self._session_pool.release(session)
        return warmed

    def _default_factory(self, model_path: str, voices_path: str) -> Any:
        """Instantiate Kokoro, applying optional ONNX Runtime overrides."""
        if Kokoro is None:
            message = "kokoro-onnx must be installed to use KokoroEngine."
            raise RuntimeError(message)

        custom_runtime_requested = any(
            (
                self._settings.ort_providers,
                self._settings.ort_intra_op_num_threads is not None,
                self._settings.ort_inter_op_num_threads is not None,
                self._settings.ort_graph_optimization_level is not None,
                self._settings.ort_execution_mode is not None,
                self._settings.ort_enable_mem_pattern is not None,
            ),
        )

        if not custom_runtime_requested:
            return Kokoro(model_path=model_path, voices_path=voices_path)

        if ort is None:
            message = "onnxruntime must be installed to configure execution providers."
            raise RuntimeError(message)

        session_options = ort.SessionOptions()
        if self._settings.ort_intra_op_num_threads is not None:
            session_options.intra_op_num_threads = (
                self._settings.ort_intra_op_num_threads
            )
        if self._settings.ort_inter_op_num_threads is not None:
            session_options.inter_op_num_threads = (
                self._settings.ort_inter_op_num_threads
            )
        if self._settings.ort_graph_optimization_level is not None:
            session_options.graph_optimization_level = _GRAPH_LEVEL_MAP[
                self._settings.ort_graph_optimization_level
            ]
        if self._settings.ort_execution_mode is not None:
            session_options.execution_mode = _EXECUTION_MODE_MAP[
                self._settings.ort_execution_mode
            ]
        if self._settings.ort_enable_mem_pattern is not None:
            session_options.enable_mem_pattern = self._settings.ort_enable_mem_pattern

        providers = list(self._settings.ort_providers)
        if providers:
            session = ort.InferenceSession(
                model_path,
                sess_options=session_options,
                providers=providers,
            )
        else:
            session = ort.InferenceSession(
                model_path,
                sess_options=session_options,
            )

        return Kokoro.from_session(session, voices_path=voices_path)


_GRAPH_LEVEL = getattr(ort, "GraphOptimizationLevel", None)
_GRAPH_LEVEL_MAP = {
    "DISABLE": getattr(_GRAPH_LEVEL, "ORT_DISABLE_ALL", None),
    "BASIC": getattr(_GRAPH_LEVEL, "ORT_ENABLE_BASIC", None),
    "EXTENDED": getattr(_GRAPH_LEVEL, "ORT_ENABLE_EXTENDED", None),
    "ALL": getattr(_GRAPH_LEVEL, "ORT_ENABLE_ALL", None),
}

_EXECUTION_MODE = getattr(ort, "ExecutionMode", None)
_EXECUTION_MODE_MAP = {
    "SEQUENTIAL": getattr(_EXECUTION_MODE, "ORT_SEQUENTIAL", None),
    "PARALLEL": getattr(_EXECUTION_MODE, "ORT_PARALLEL", None),
}

# Public aliases for tests and introspection helpers
GRAPH_LEVEL_MAP = _GRAPH_LEVEL_MAP
EXECUTION_MODE_MAP = _EXECUTION_MODE_MAP
