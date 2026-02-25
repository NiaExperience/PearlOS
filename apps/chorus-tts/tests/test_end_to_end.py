"""End-to-end test for the websocket streaming flow."""

from __future__ import annotations

import base64
from pathlib import Path

import numpy as np
import pytest
from chorus_tts.app import create_app
from chorus_tts.config import Settings
from chorus_tts.kokoro_engine import AudioChunk, float_to_pcm16
from chorus_tts.voices import VoiceRegistry
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


def create_settings(tmp_path: Path) -> Settings:
    """Generate Settings with temporary assets for integration tests."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")
    return Settings(
        model_path=model,
        voices_path=voices,
        api_keys=("test",),
        chunk_length_schedule=(50, 80, 120),
        default_voice_id="af_alloy",
        inactivity_timeout=5,
    )


class FakeStreamingEngine:
    """Test double that records calls and yields fixed audio chunks."""

    def __init__(self) -> None:
        """Prepare a reusable audio chunk for streaming."""
        self.calls: list[dict[str, object]] = []
        pcm = float_to_pcm16(np.array([0.0, 0.5, -0.5], dtype=np.float32))
        self._chunk = AudioChunk(voice_id="af_alloy", sample_rate=22050, pcm=pcm)

    async def stream_text(
        self,
        *,
        text: str,
        voice_id: str | None,
        speed: float,
        lang: str,
        is_phonemes: bool,
        trim: bool,
    ):
        """Record invocation parameters and yield a single chunk."""
        self.calls.append(
            {
                "text": text,
                "voice_id": voice_id,
                "speed": speed,
                "lang": lang,
                "trim": trim,
                "chunk_pcm": self._chunk.pcm,
            },
        )
        yield self._chunk


def test_end_to_end_streaming(tmp_path: Path) -> None:
    """Exercise the websocket flow from handshake to final output."""
    settings = create_settings(tmp_path)
    engine = FakeStreamingEngine()
    registry = VoiceRegistry()
    app = create_app(settings, voice_registry=registry, engine=engine)
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input",
        headers={"xi-api-key": "test"},
    ) as ws:
        connected = ws.receive_json()
        assert connected["event"] == "connected"
        assert connected["voice_id"] == "af_alloy"

        # Initialize connection with required blank text
        ws.send_json({"text": " "})
        # Send enough text to trigger chunk generation
        payload = "hello world " + "x" * 60 + " "
        ws.send_json({"text": payload})
        # Close the stream to flush remaining buffer
        ws.send_json({"text": ""})

        audio_message = ws.receive_json()
        assert audio_message["event"] == "audioOutput"
        decoded = base64.b64decode(audio_message["audio"])
        assert decoded == engine.calls[0]["chunk_pcm"]
        assert audio_message["sample_rate"] == 22050
        assert audio_message["segment_reason"] == "auto"

        final_message = ws.receive_json()
        assert final_message["event"] == "finalOutput"
        assert final_message["chunks"] == 1

        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()

    assert len(engine.calls) == 1
    assert engine.calls[0]["text"].startswith("hello world")
