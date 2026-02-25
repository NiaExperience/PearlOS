# Milestone 1 Plan

## Objectives
- Establish configuration, voice mapping, and synthesis wrapper foundations required for the websocket server.
- Provide test scaffolding and documentation updates that unblock later milestones.

## Tasks
- **Configuration**
  - Implement `chorus_tts/config.py` with a Pydantic `Settings` model loading `KOKORO_MODEL_PATH`, `KOKORO_VOICES_PATH`, and API key sources (`API_KEYS`, `API_KEYS_FILE`).
  - Validate file paths at startup and support loading `.env` via `python-dotenv` (or document manual export if we defer dependency).
  - Document configuration precedence (env > `.env` > defaults) in README/PRD appendix.

- **Voice Registry**
  - Capture the fixed Kokoro speaker catalog and expose helper utilities to validate requested voice ids and list supported languages.
  - Default to `af_alloy` when a client does not provide a voice.

- **Kokoro Wrapper**
  - Create `chorus_tts/kokoro_engine.py` exposing a singleton `KokoroEngine` initialized from `Settings`.
  - Wrap `Kokoro.create_stream` to accept buffered text, resolved voice, speed, language, and trim flag.
  - Add helper to convert returned `np.ndarray` float32 audio to 16-bit PCM little-endian bytes and base64 encode.
  - Standardize error types (`VoiceNotFound`, `InvalidSpeed`, `EngineFailure`) for later translation to websocket responses.

- **Schema Definitions**
  - Introduce `chorus_tts/schemas.py` with Pydantic models for query params (`HandshakeParams`) and websocket events (`InitializeConnectionMessage`, `SendTextMessage`, `CloseConnectionMessage`).
  - Capture compatibility fields (ignored in milestone 1) while validating core fields (`text`, `flush`, `try_trigger_generation`, `voice_settings.speed`).
  - Define enums/constants for `OutputFormat`, `ErrorCode`, and chunk schedule representation.

- **Testing Scaffold**
  - Set up `tests/` package with pytest configuration.
  - Add tests for `Settings` validation (missing paths, bad API key inputs), voice mapping loader (missing voice, default fallback), and PCM conversion (numpy arrays → bytes → base64).
  - Create fixtures/mocks for Kokoro stream to avoid ONNX calls in unit tests.

- **Documentation**
  - Update `docs/websocket_tts_prd.md` appendix or README with configuration instructions (env vars, voice map format).
  - Add milestone completion checklist summarizing required tasks and test results.

## Deliverables
- `chorus_tts/config.py`, `chorus_tts/voices.py`, `chorus_tts/kokoro_engine.py`, and `chorus_tts/schemas.py`.
- Initial pytest suite covering configuration, voice mapping, and PCM conversion.
 - Updated documentation outlining configuration and voice catalog usage.
- Milestone 1 checklist stored alongside this plan once tasks complete.

## Checklist
- [x] Settings loader validates required paths, API key sources, and chunk schedule parsing.
- [x] Voice registry enumerates the Kokoro voice catalog and enforces default voice fallback.
- [x] Kokoro engine wrapper converts float audio to PCM bytes and supports async streaming.
- [x] Websocket handshakes/messages represented with Pydantic schemas and validation tests.
- [x] Pytest suite in `tests/` exercises configuration, voice mapping, engine helpers, and schemas.
- [x] Documentation (AGENTS.md and this plan) notes configuration expectations and milestone status.
