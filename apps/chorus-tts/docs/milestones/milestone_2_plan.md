# Milestone 2 Plan

## Objectives
- Deliver a websocket service that mirrors the ElevenLabs streaming protocol while invoking `KokoroEngine` for synthesis.
- Enforce API-key authentication on the websocket handshake and propagate structured errors.
- Handle text buffering, chunk scheduling, and streaming responses according to the PRD.

## Tasks
- **Service Framework**
  - Introduce a FastAPI/Starlette application (`chorus_tts/app.py`) with websocket endpoint `/v1/text-to-speech/{voice_id}/stream-input`.
  - Wire dependency injection so `main.py` creates `Settings`, `VoiceRegistry`, and `KokoroEngine`, then runs `uvicorn`.
  - Add health endpoint (`GET /healthz`) for readiness checks.

- **Authentication & Handshake**
  - Implement middleware/helper to verify API keys from `xi-api-key` header, `Authorization` bearer token, or `api_key` query parameter.
  - Parse query parameters into `HandshakeParams`; reply with `connected` event or error frame when invalid.
  - Track session metadata (UUID, voice, output format) per connection for logging.

- **Message Processing**
  - Build a websocket handler that deserializes incoming JSON into `InitializeConnectionMessage`, `SendTextMessage`, and `CloseConnectionMessage` using schemas.
  - Maintain a text buffer + chunk schedule state (from settings or handshake overrides) and support `flush` / `try_trigger_generation`.
  - Translate schema validation or protocol violations into structured `error` frames with codes defined in the PRD.

- **Streaming & Output**
  - Integrate `KokoroEngine.stream_text` to generate audio chunks; convert to base64 PCM and emit `audioOutput` frames with incremental indices.
  - Emit `finalOutput` with duration/chunk count once synthesis completes or on close.
  - Cancel synthesis gracefully on client disconnect; ensure no orphaned tasks.

- **Error Handling & Logging**
  - Map engine exceptions (`KeyError` for voice, `ValueError` for speed) to response error codes (`error.voice_not_found`, etc.).
  - Add structured logging (request start/stop, chunk timings, auth failures) with log level controlled via settings.
  - Implement inactivity timeout per connection using configuration or handshake hint.

- **Configuration Updates**
  - Extend `Settings` for server knobs (host, port, log level, inactivity timeout) and chunk schedule defaults.
  - Document expected `.env` entries and runtime assumptions in README/AGENTS.md.

- **Testing**
  - Add pytest-based unit tests for auth helper, handshake validation, chunk scheduler, and error translation.
  - Create integration tests using `starlette.testclient` or `websockets` to simulate connection lifecycle with mocked `KokoroEngine`.
  - Provide regression test for flush/try_trigger_generation behaviour and unknown voice error responses.

## Deliverables
- FastAPI application module, websocket handler, and supporting utilities.
- Updated `main.py` (or new entrypoint) with server bootstrap.
- Expanded configuration docs covering server settings and authentication usage.
- Automated tests covering websocket flow, auth, chunking logic, and error responses.
- Milestone 2 checklist appended to this plan when tasks complete.

## Checklist
- [x] FastAPI app exposes `/v1/text-to-speech/{voice_id}/stream-input` with health check and dependency wiring.
- [x] API key authentication validates `xi-api-key` header / bearer tokens and returns structured errors.
- [x] `GenerationSession` buffers text, honours chunk schedules, and supports flush/trigger controls.
- [x] Default segment consumer streams Kokoro audio into `audioOutput` frames and emits `finalOutput` metadata.
- [x] Structured logging and inactivity timeout behaviour added to websocket handler.
- [x] Expanded pytest coverage for auth, buffering, streaming, and edge cases.
- [x] Documentation (AGENTS) updated with websocket usage and configuration guidance.
