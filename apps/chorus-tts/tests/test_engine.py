"""Unit tests for the Kokoro engine wrapper."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest import mock

import chorus_tts.kokoro_engine as engine_module
import numpy as np
import pytest
from chorus_tts.config import Settings
from chorus_tts.kokoro_engine import AudioChunk, KokoroEngine, float_to_pcm16
from chorus_tts.voices import VoiceRegistry


class FakeKokoro:
    """Stubbed Kokoro implementation capturing stream calls."""

    def __init__(self, outputs: list[np.ndarray]) -> None:
        """Initialise stubbed engine with predetermined outputs."""
        self.outputs = outputs
        self.calls: list[dict[str, object]] = []

    async def create_stream(
        self,
        *,
        text: str,
        voice: str,
        speed: float,
        lang: str,
        is_phonemes: bool,
        trim: bool,
    ):
        """Yield prepared outputs while recording invocation metadata."""
        self.calls.append(
            {
                "text": text,
                "voice": voice,
                "speed": speed,
                "lang": lang,
                "is_phonemes": is_phonemes,
                "trim": trim,
            },
        )
        for chunk in self.outputs:
            yield chunk, 22050


def _build_session(engine: KokoroEngine, model: str, voices: str) -> Any:
    return engine.build_session(model_path=model, voices_path=voices)


def _available_session_count(engine: KokoroEngine) -> int:
    return engine.pool.available


async def _ensure_pool_ready(engine: KokoroEngine) -> None:
    await engine.pool.ensure_ready()


async def _acquire(engine: KokoroEngine) -> Any:
    return await engine.pool.acquire()


async def _release(engine: KokoroEngine, session: Any) -> None:
    await engine.pool.release(session)


def build_settings(tmp_path: Path, *, pool_size: int = 1) -> Settings:
    """Create Settings instances tailored for engine tests."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")
    return Settings(
        model_path=model,
        voices_path=voices,
        api_keys=("test",),
        chunk_length_schedule=(80, 120, 180),
        default_voice_id="af_alloy",
        session_pool_size=pool_size,
    )


@pytest.mark.asyncio
async def test_stream_text_yields_chunks(tmp_path: Path) -> None:
    """Stream text and receive audio chunks from the engine."""
    outputs = [np.array([0.0, 0.5, -0.5], dtype=np.float32)]
    fake_instances: list[FakeKokoro] = []

    def factory(model: str, voices: str) -> FakeKokoro:
        instance = FakeKokoro(outputs)
        fake_instances.append(instance)
        return instance

    settings = build_settings(tmp_path)
    registry = VoiceRegistry(default_voice_id="af_alloy")
    engine = KokoroEngine(settings, registry, kokoro_factory=factory)

    chunks = [
        chunk
        async for chunk in engine.stream_text("Hello world", voice_id=None, speed=1.0)
    ]

    assert len(chunks) == 1
    audio_chunk = chunks[0]
    # Voice id defaults to registry fallback
    assert audio_chunk.voice_id == "af_alloy"
    assert isinstance(audio_chunk.pcm, bytes)
    assert audio_chunk.sample_rate == 22050
    assert (
        audio_chunk.as_base64()
        == AudioChunk(
            voice_id="af_alloy",
            sample_rate=22050,
            pcm=audio_chunk.pcm,
        ).as_base64()
    )

    assert fake_instances[0].calls[0]["voice"] == "af_alloy"


def test_float_to_pcm16_requires_mono_array() -> None:
    """Ensure waveform conversion enforces mono input."""
    stereo = np.zeros((2, 10), dtype=np.float32)
    with pytest.raises(ValueError, match="Audio array must be one-dimensional"):
        float_to_pcm16(stereo)


def test_float_to_pcm16_clips_and_scales() -> None:
    """Clip and scale float samples to PCM16."""
    audio = np.array([-2.0, -1.0, 0.0, 1.0, 2.0], dtype=np.float32)
    pcm = float_to_pcm16(audio)
    # Expect 5 samples * 2 bytes each
    assert len(pcm) == 10
    ints = np.frombuffer(pcm, dtype="<i2")
    assert ints.tolist() == [-32767, -32767, 0, 32767, 32767]


@pytest.mark.asyncio
async def test_stream_text_validates_speed(tmp_path: Path) -> None:
    """Validate speed bounds enforced by the engine."""
    settings = build_settings(tmp_path)
    registry = VoiceRegistry()
    engine = KokoroEngine(
        settings,
        registry,
        kokoro_factory=lambda _m, _v: FakeKokoro([]),
    )

    with pytest.raises(ValueError, match=r"Speed must be between 0\.5 and 2\.0"):
        async for _ in engine.stream_text("Test", speed=0.4):
            pass


@pytest.mark.asyncio
async def test_stream_text_raises_for_unknown_voice(tmp_path: Path) -> None:
    """Raise when requested voice id is not recognised."""
    settings = build_settings(tmp_path)
    registry = VoiceRegistry()
    engine = KokoroEngine(
        settings,
        registry,
        kokoro_factory=lambda _m, _v: FakeKokoro([]),
    )

    with pytest.raises(KeyError):
        async for _ in engine.stream_text("Test", voice_id="nonexistent"):
            pass


@pytest.mark.asyncio
async def test_warm_pool_creates_all_sessions(tmp_path: Path) -> None:
    """Warm the pool by creating sessions for each slot."""
    outputs = [np.array([0.1, -0.1], dtype=np.float32)]
    create_count = 0

    def factory(model: str, voices: str) -> FakeKokoro:
        nonlocal create_count
        create_count += 1
        return FakeKokoro(outputs)

    settings = build_settings(tmp_path, pool_size=3)
    registry = VoiceRegistry()
    engine = KokoroEngine(settings, registry, kokoro_factory=factory)

    warmed = await engine.warm_pool(
        text="hello",
        voice_id=registry.default_voice_id,
        speed=1.0,
        lang="en-us",
        trim=True,
    )

    assert warmed == 3
    assert create_count == 3
    assert _available_session_count(engine) == 3


@pytest.mark.asyncio
async def test_concurrent_streams_use_distinct_sessions(tmp_path: Path) -> None:
    """Ensure concurrent streamers lease unique sessions."""
    active_sessions: set[int] = set()
    peak_active = 0
    lock = asyncio.Lock()

    class TrackingKokoro(FakeKokoro):
        async def create_stream(self, **kwargs):
            nonlocal peak_active
            async with lock:
                active_sessions.add(id(self))
                peak_active = max(peak_active, len(active_sessions))
            try:
                async for chunk in super().create_stream(**kwargs):
                    yield chunk
            finally:
                async with lock:
                    active_sessions.discard(id(self))

    def factory(model: str, voices: str) -> TrackingKokoro:
        return TrackingKokoro([np.array([0.0, 0.2], dtype=np.float32)])

    settings = build_settings(tmp_path, pool_size=2)
    registry = VoiceRegistry()
    engine = KokoroEngine(settings, registry, kokoro_factory=factory)

    async def consume():
        async for _ in engine.stream_text("Hello world", voice_id=None, speed=1.0):
            break

    await asyncio.gather(consume(), consume())
    assert peak_active >= 2


@pytest.mark.asyncio
async def test_pool_handles_warmup_failures(tmp_path: Path) -> None:
    """Return sessions to pool even when warmup raises."""

    class FailingKokoro(FakeKokoro):
        async def create_stream(self, **kwargs):
            message = "warmup failure"
            raise RuntimeError(message)
            if False:
                yield np.array(
                    [0.0],
                )  # pragma: no cover - satisfy async generator protocol

    def factory(model: str, voices: str) -> FailingKokoro:
        return FailingKokoro([])

    settings = build_settings(tmp_path, pool_size=2)
    engine = KokoroEngine(settings, VoiceRegistry(), kokoro_factory=factory)

    with pytest.raises(RuntimeError):
        await engine.warm_pool(text="warm", voice_id="af_alloy")

    # Sessions should be returned to the pool despite failure.
    assert _available_session_count(engine) == 2


@pytest.mark.asyncio
async def test_acquire_releases_back_to_pool(tmp_path: Path) -> None:
    """Acquire and release sessions without leaking instances."""

    class ObserveKokoro(FakeKokoro):
        pass

    def factory(model: str, voices: str) -> ObserveKokoro:
        return ObserveKokoro([np.array([0.0], dtype=np.float32)])

    settings = build_settings(tmp_path, pool_size=1)
    engine = KokoroEngine(settings, VoiceRegistry(), kokoro_factory=factory)

    await _ensure_pool_ready(engine)
    session_first = await _acquire(engine)
    await _release(engine, session_first)
    session_second = await _acquire(engine)
    assert session_first is session_second
    await _release(engine, session_second)


def test_default_factory_uses_custom_providers(monkeypatch, tmp_path: Path) -> None:
    """Use configured providers when building inference sessions."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")

    fake_session = mock.Mock()
    fake_kokoro = mock.Mock()

    def fake_inference_session(*args, **kwargs):
        return fake_session

    def fake_from_session(session, voices_path):
        assert session is fake_session
        assert voices_path == str(voices)
        return fake_kokoro

    with (
        mock.patch("chorus_tts.kokoro_engine.ort") as ort_mod,
        mock.patch("chorus_tts.kokoro_engine.Kokoro") as kokoro_cls,
    ):
        ort_mod.SessionOptions.return_value = mock.Mock()
        ort_mod.InferenceSession.side_effect = fake_inference_session
        kokoro_cls.from_session.side_effect = fake_from_session

        settings = Settings(
            model_path=model,
            voices_path=voices,
            api_keys=("test",),
            ort_providers=("CUDAExecutionProvider", "CPUExecutionProvider"),
        )

        engine = KokoroEngine(settings, VoiceRegistry())
        result = _build_session(engine, str(model), str(voices))

    assert result is fake_kokoro
    ort_mod.InferenceSession.assert_called_once()
    kokoro_cls.from_session.assert_called_once_with(
        fake_session,
        voices_path=str(voices),
    )


def test_default_factory_without_providers(monkeypatch, tmp_path: Path) -> None:
    """Fallback to direct Kokoro invocation when providers unset."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")

    fake_session = mock.Mock()
    fake_kokoro = mock.Mock()

    with (
        mock.patch("chorus_tts.kokoro_engine.ort") as ort_mod,
        mock.patch("chorus_tts.kokoro_engine.Kokoro") as kokoro_cls,
    ):
        ort_mod.SessionOptions.return_value = mock.Mock()
        ort_mod.InferenceSession.return_value = fake_session
        kokoro_cls.return_value = fake_kokoro

        settings = Settings(model_path=model, voices_path=voices, api_keys=("test",))
        engine = KokoroEngine(settings, VoiceRegistry())

        result = _build_session(engine, str(model), str(voices))

    assert result is fake_kokoro
    kokoro_cls.assert_called_once_with(model_path=str(model), voices_path=str(voices))


def test_engine_requires_kokoro(tmp_path: Path, monkeypatch) -> None:
    """Raise if Kokoro implementation is unavailable."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")

    settings = Settings(model_path=model, voices_path=voices, api_keys=("test",))

    monkeypatch.setattr("chorus_tts.kokoro_engine.Kokoro", None)

    with pytest.raises(RuntimeError):
        KokoroEngine(settings, VoiceRegistry())


def test_default_factory_requires_onnxruntime(tmp_path: Path, monkeypatch) -> None:
    """Raise when ONNX Runtime is needed but missing."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")

    with (
        mock.patch("chorus_tts.kokoro_engine.ort", None),
        mock.patch("chorus_tts.kokoro_engine.Kokoro", mock.Mock()),
    ):
        engine_instance = KokoroEngine(
            Settings(
                model_path=model,
                voices_path=voices,
                api_keys=("test",),
                ort_intra_op_num_threads=1,
            ),
            VoiceRegistry(),
        )
        with pytest.raises(RuntimeError):
            _build_session(engine_instance, str(model), str(voices))


def test_default_factory_sets_session_options(monkeypatch, tmp_path: Path) -> None:
    """Populate ONNX Runtime session options based on settings."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")

    settings = Settings(
        model_path=model,
        voices_path=voices,
        api_keys=("test",),
        ort_intra_op_num_threads=3,
        ort_inter_op_num_threads=2,
        ort_graph_optimization_level="ALL",
        ort_execution_mode="parallel",
        ort_enable_mem_pattern=True,
    )

    fake_session = mock.Mock()
    fake_kokoro = mock.Mock()

    class DummyOptions:
        def __init__(self):
            self.intra_op_num_threads = None
            self.inter_op_num_threads = None
            self.graph_optimization_level = None
            self.execution_mode = None
            self.enable_mem_pattern = None

    with (
        mock.patch("chorus_tts.kokoro_engine.ort") as ort_mod,
        mock.patch("chorus_tts.kokoro_engine.Kokoro") as kokoro_cls,
    ):
        ort_mod.SessionOptions.return_value = DummyOptions()
        ort_mod.InferenceSession.return_value = fake_session
        kokoro_cls.from_session.return_value = fake_kokoro

        engine = KokoroEngine(settings, VoiceRegistry())
        result = _build_session(engine, str(model), str(voices))

    assert result is fake_kokoro
    opts = ort_mod.SessionOptions.return_value
    assert opts.intra_op_num_threads == 3
    assert opts.inter_op_num_threads == 2
    graph_level_map = engine_module._GRAPH_LEVEL_MAP  # noqa: SLF001
    execution_mode_map = engine_module._EXECUTION_MODE_MAP  # noqa: SLF001
    assert opts.graph_optimization_level == graph_level_map["ALL"]
    assert opts.execution_mode == execution_mode_map["PARALLEL"]
    assert opts.enable_mem_pattern is True


def test_default_factory_without_custom_providers(monkeypatch, tmp_path: Path) -> None:
    """Omit providers argument when none are configured."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")

    settings = Settings(
        model_path=model,
        voices_path=voices,
        api_keys=("test",),
        ort_intra_op_num_threads=1,
    )

    fake_session = mock.Mock()
    fake_kokoro = mock.Mock()

    with (
        mock.patch("chorus_tts.kokoro_engine.ort") as ort_mod,
        mock.patch("chorus_tts.kokoro_engine.Kokoro") as kokoro_cls,
    ):
        ort_mod.SessionOptions.return_value = mock.Mock()
        ort_mod.InferenceSession.return_value = fake_session
        kokoro_cls.from_session.return_value = fake_kokoro

        engine = KokoroEngine(settings, VoiceRegistry())
        result = _build_session(engine, str(model), str(voices))

    assert result is fake_kokoro
    ort_mod.InferenceSession.assert_called_once()
    _, kwargs = ort_mod.InferenceSession.call_args
    # providers should be omitted when none configured
    assert "providers" not in kwargs
