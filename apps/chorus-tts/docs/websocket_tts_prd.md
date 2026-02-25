# Websocket TTS PRD

## Goal
- Expose a websocket API mirroring ElevenLabs’ realtime TTS protocol while synthesizing audio via `kokoro_onnx.Kokoro.create_stream`.
- Deliver low-latency streaming audio for frontend agents or clients that already speak ElevenLabs’ API.
- Enforce a simple authentication layer (shared secret or API key) before allowing synthesis.

## Background
- Kokoro ONNX provides synchronous `create` and async `create_stream` methods that emit `(np.ndarray, sample_rate)` chunks.
- ElevenLabs clients expect websocket frames containing JSON metadata and base64 PCM audio chunks; compatibility enables drop-in usage.

## Functional Requirements
- **Connection lifecycle:** accept websocket connections on `/v1/ws` (configurable). Validate handshake, send optional `connected` ack.
- **Request message:** support payload containing `text`, `voice_id`, `model_id`, optionally `voice_speed`, `lang`, `is_phonemes`, `trim_silence`. Reject unsupported fields with `error` frame.
- **Voice mapping:** map incoming `voice_id` strings to Kokoro voice keys or embeddings defined in configuration.
- **Synthesis stream:** invoke `Kokoro.create_stream` with validated parameters. Convert each chunk to 16-bit PCM (mono) at the sample rate returned (default 22050 Hz) and base64-encode.
- **Response frames:** for each chunk emit JSON frame `{ "event": "audio_chunk", "audio": "<base64>", "sample_rate": 22050 }`. After completion send `{ "event": "completed" }`. On failure send `{ "event": "error", "code": "<id>", "message": "<detail>" }`.
- **Authentication:** require clients to present a configured API key via query string or header during the websocket handshake; reject unauthenticated requests with `unauthorized` error.
- **Health endpoint:** simple `GET /healthz` returning readiness status.
- **Logging & metrics:** log connection start/stop, request parameters (without full text unless debug), chunk counts, total synthesis time.

## Websocket API
### Endpoint & Handshake
- **URL:** `wss://<host>/v1/text-to-speech/:voice_id/stream-input`
- **Method:** `GET` → `101 Switching Protocols`
- **Path parameter:** `voice_id` maps to a Kokoro voice key (`chorus_tts/voices.py` will translate ElevenLabs ids to Kokoro embeddings).
- **Authentication:** requests must include either an `xi-api-key` header, `authorization` header (`Bearer <key>`), or an `api_key` query parameter. Keys are compared against the configured allowlist; unauthorized requests receive a JSON error frame and connection close.
- **API key format:** matches ElevenLabs guidance—primary mechanism is the `xi-api-key` header. Query string/API key in first message are accepted solely for compatibility and are discouraged in production.
- **Query parameters (supported subset):**
  - `model_id` (optional) → selects Kokoro voice pack or language; defaults to `kokoro_en`.
  - `output_format` (optional) → accepted values: `pcm_22050`, `pcm_24000`; defaults to `pcm_22050`. Other formats return `error.unsupported_output_format`.
  - `enable_logging`, `enable_ssml_parsing`, `sync_alignment`, `auto_mode`, `apply_text_normalization`, `seed` are accepted but currently ignored; we document their default behaviour for compatibility.
- **Server greeting:** after authentication the server sends `{ "event": "connected", "voice_id": "...", "model_id": "...", "session_id": "<uuid>" }`.

### Client Messages
1. **initializeConnection** (must be first message)
   - `text`: must be a single blank space (`" "`), matching ElevenLabs behaviour.
   - `voice_settings`:
     - Supports `speed` (mapped to Kokoro speed, 0.5–2.0 range). `stability`, `similarity_boost`, `style`, `use_speaker_boost` are accepted but ignored; warnings logged.
   - `generation_config.chunk_length_schedule`, `pronunciation_dictionary_locators`, `xi-api-key`, `authorization`: parsed for compatibility; chunk schedule is stored but only `flush` and `try_trigger_generation` impact Kokoro batching (see below).
   - Reject unknown keys with `error.invalid_initialize`.

2. **sendText**
   - `text`: chunk of user text; should end with a trailing space per ElevenLabs. We buffer text until we call `create_stream`.
   - `try_trigger_generation`: when `true`, we flush the buffered text to Kokoro immediately (subject to minimum 10 characters to avoid zero-length calls).
   - `voice_settings`, `generation_config`: optional repeats must match initial values; mismatches return error.
   - `flush`: boolean; when `true`, triggers synthesis even if buffer length is below schedule threshold.

3. **closeConnection**
   - `text`: must be empty string (`""`). Signals no further input; server drains buffer, finishes streaming, sends final output frame, then closes.

### Server Responses
- **audioOutput**
  - `event`: `"audioOutput"`
  - `audio`: base64 encoded 16-bit PCM mono bytes at selected sample rate.
  - `sample_rate`: matches the Kokoro chunk sample rate (default `22050`).
  - `isFinal`: `false` for partial chunks.
  - `normalizedAlignment` / `alignment`: returned only when `sync_alignment=true` and alignment data is available (initial implementation returns `null` placeholders).
  - `chunk_index`: incremental integer for ordering (non-ElevenLabs extension; documented as optional).
- **finalOutput**
  - `event`: `"finalOutput"`
  - `isFinal`: `true`
  - `duration_ms`: total rendered duration.
  - `error`: omitted on success. If set, mirrors `error` frame payload.
- **error**
  - Structure: `{ "event": "error", "code": "<namespace.slug>", "message": "<detail>", "retryable": <bool>, "session_id": "<uuid>" }`.
  - Codes include `error.unauthorized`, `error.invalid_payload`, `error.voice_not_found`, `error.engine_failure`, `error.unsupported_output_format`.
- **keepAlive** (optional future extension): server emits every `inactivity_timeout/2` seconds unless auto_mode is enabled.

### Flow Control & Buffering
- Text chunks accumulate in a per-connection buffer. The default `chunk_length_schedule` is `[80, 120, 180]`; when thresholds are crossed, buffered text is passed to `create_stream`.
- `flush` or `try_trigger_generation` immediately synthesizes the current buffer (with a minimum 10-character safeguard).
- On client disconnect, in-flight Kokoro tasks are cancelled and no additional frames are sent.

### Differences from ElevenLabs
- Only PCM output is available; MP3/Opus/μ-law formats are not supported initially.
- Alignment payloads are empty until Kokoro exposes timing metadata.
- `voice_settings` fields other than `speed` are no-ops.
- `auto_mode` maps to bypassing the chunk schedule entirely (generate on every `sendText` call).

## Non-Goals
- Billing and account management.
- Advanced ElevenLabs features (voice cloning, style/emotion controls, contextual conversation ids).
- GPU acceleration or scaling across processes (initial single-instance focus).

## Architecture
- **Framework:** `FastAPI` + `uvicorn` or `starlette` to leverage asyncio and built-in websocket support.
- **Engine initialization:** on startup load environment/config values (model path, voices path, voice map) and instantiate a singleton `Kokoro`.
- **Connection handler:** for each websocket:
  1. Receive first message (JSON). Validate using Pydantic schema.
  2. Spawn async task to iterate over `create_stream`.
  3. For each chunk:
     - Convert float array to `int16` PCM, ensure little endian, encode with `base64.b64encode`.
     - Send `audio_chunk` frame.
  4. After iteration, send `completed`.
  5. Catch cancellation: on client disconnect, cancel iteration, drain queue, release resources.
- **Backpressure:** use asyncio `Queue` between executor thread and websocket send to avoid overwhelming network; limit queue length, drop / delay accordingly.
- **Configuration:** use `.env` or `pyproject.toml` extras for `MODEL_PATH`, `VOICES_PATH`, `VOICE_MAP_FILE`, `HOST`, `PORT`, `LOG_LEVEL`.

## Testing
- **Unit tests:**
  - Schema validation for incoming messages (missing `text`, unknown `voice_id`, out-of-range `voice_speed`).
  - Conversion helper from ndarray → PCM bytes → base64.
  - Error translation when Kokoro raises (voice not found, phonemizer issues).
- **Integration tests:**
  - Use `websockets` test client to open connection, send sample request, assert receipt of `audio_chunk` (using mocked Kokoro stream) and `completed`.
  - Test disconnect mid-stream to ensure task cancellation and no crashes.
- **Performance smoke test:** run against real Kokoro engine with short text, verify first chunk latency (<500ms target) and final audio length matches expected.

## Risks & Mitigations
- **Protocol mismatch:** need authoritative ElevenLabs websocket schema. Mitigate by documenting supported subset and providing sample frames; allow feature flags for differing clients.
- **Latency spikes:** ONNX inference runs in thread executor; monitor chunk timing, adjust batch sizes or disable trim for faster first chunk if necessary.
- **Resource usage:** large texts may produce many chunks; enforce max text length and provide rate limiting per connection.

## Deliverables
- `main.py` hosting websocket server (FastAPI) with CLI/env configuration.
- `chorus_tts/config.py` and `chorus_tts/voices.py` for mappings and settings.
- Tests under `tests/` covering schema, handlers, and mock streaming.
- Updated `AGENTS.md` / README with run instructions (`uv run uvicorn main:app --reload`).
- Optional `examples/client.py` to demonstrate compatibility with ElevenLabs-style clients.

## Milestones
1. Milestone 1: Define schemas, config, and Kokoro wrapper (Day 1).
2. Milestone 2: Implement websocket handler, chunk conversion, error handling (Day 2).
3. Milestone 3: Write tests, add documentation, run integration smoke tests (Day 3).
4. Milestone 4: Buffer for refinements, logging, deployment notes (Day 4).
