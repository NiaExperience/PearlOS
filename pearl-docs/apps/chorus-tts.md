## Chorus TTS (`apps/chorus-tts`)

The Chorus TTS service provides low‑latency text‑to‑speech over WebSocket using Kokoro ONNX models.

- **Purpose**: offer a local or self‑hosted TTS backend compatible with PearlOS’s voice pipeline.
- **Tech stack**: Python, ASGI server (Uvicorn), Kokoro ONNX models, `uv` for dependency management.
- **Structure**:
  - `main.py`: ASGI entrypoint that exposes the WebSocket and HTTP endpoints.
  - `chorus_tts/`: Python package with model loading, request handling, and streaming logic.
  - `pyproject.toml` and `uv.lock`: dependency and environment metadata.
- **Integration**:
  - Consumed by the Pipecat Daily Bot as a TTS provider.
  - Configured via environment variables for model paths, voice presets, and port.

