# Chorus TTS Integration Cheat Sheet for LLM Agents

This document encodes the websocket protocol, authentication rules, and message sequencing used by the Chorus TTS server. The language and formatting aim to be machine-friendly so another LLM can follow the instructions without additional context.

## 1. Prerequisites

- **Assets:** Ensure the Kokoro ONNX model and voices binary exist and are referenced via:
  - `KOKORO_MODEL_PATH`
  - `KOKORO_VOICES_PATH`
- **API keys:** Provide at least one value through `API_KEYS` (comma-separated) or `API_KEYS_FILE` (one key per line). The server rejects websocket handshakes when no key matches.
- **Server configuration:** Optional overrides include `SERVER_HOST`, `SERVER_PORT`, `DEFAULT_VOICE_ID`, `CHUNK_LENGTH_SCHEDULE`, `INACTIVITY_TIMEOUT`, and ONNX Runtime tuning variables (`ORT_PROVIDERS`, etc.).
- **Launch command:** `uv run python main.py` (or use Uvicorn: `uv run uvicorn main:build_app --factory --host 0.0.0.0 --port 8000`).

## 2. Endpoints

| Purpose | URL | Notes |
| --- | --- | --- |
| Health probe | `http://{host}:{port}/healthz` | Returns `{ "status": "ok" }` when the service is ready. |
| Websocket TTS | `ws://{host}:{port}/v1/text-to-speech/{voice_id}/stream-input` | `voice_id` must be one of the supported Kokoro voice identifiers (see Section 6). |

## 3. Authentication

- Preferred: `xi-api-key` header containing one of the configured API keys.
- Alternate: `Authorization: Bearer <token>` header using the same keys as bearer tokens.
- Fallback: `api_key=<token>` query parameter during the websocket handshake.
- If none of the above match, the server closes the connection with `error.unauthorized`.

## 4. Handshake Parameters (`/stream-input` query string)

| Parameter | Default | Description |
| --- | --- | --- |
| `model_id` | `None` | Reserved for future model routing (currently unused). |
| `output_format` | `pcm_22050` | Must remain `pcm_22050`. Any other value triggers `error.unsupported_output_format`. |
| `api_key` | `None` | Fallback API key (see authentication). |
| `authorization` | `None` | Optional bearer token. |
| `language_code` | `None` | Overrides automatic voice language resolution when needed. |
| `enable_logging` | `true` | Hint to enable verbose logging (server-side). |
| `enable_ssml_parsing` | `false` | Future toggle for SSML support. |
| `inactivity_timeout` | `20` | Custom timeout (seconds) before idle connections close. Must be between 5 and 180. |
| `sync_alignment` | `false` | Reserved. |
| `auto_mode` | `false` | When `true`, buffered text auto-flushes once thresholds are reached. |
| `apply_text_normalization` | `auto` | Controls preprocessing of text. |
| `seed` | `None` | Optional RNG seed (0–4294967295). |

## 5. Message Flow Overview

1. **Client connects** to the websocket endpoint with authentication headers/query parameters.
2. **Server validates** the API key, voice id, and output format. If successful, it accepts the websocket and emits a `connected` event:
   ```json
   {
     "event": "connected",
     "session_id": "uuid",
     "voice_id": "resolved_voice_id",
     "language_code": "voice_language",
     "output_format": "pcm_22050"
   }
   ```
3. **Client initialises** the session with an `initializeConnection` payload (text must be a single space):
   ```json
   {
     "text": " ",
     "voice_settings": {
       "speed": 1.0
     },
     "generation_config": {
       "chunk_length_schedule": [80, 120, 180]
     }
   }
   ```
   - `voice_settings` is optional; the first value fixes the allowed speed for the rest of the session.
   - `generation_config.chunk_length_schedule` overrides buffering thresholds. If omitted, server defaults apply.
4. **Client streams text** using `sendText` messages. Rules:
   - `text` must end with a single space unless `flush` is true.
   - Set `try_trigger_generation` to force generation when the internal buffer exceeds half of the smallest chunk length.
   - Set `flush` to push whatever is buffered immediately.
5. **Server responds** with `audioOutput` frames when audio is ready:
   ```json
   {
     "event": "audioOutput",
     "chunk_index": 0,
     "audio": "<base64 PCM 22050 Hz data>",
     "sample_rate": 22050,
     "isFinal": false,
     "segment_reason": "auto"
   }
   ```
6. **Client finalises** by optionally sending a final `sendText` with `flush: true` (text may be empty when `flush` is set) and then a `closeConnection` message:
   ```jsonc
   // sendText
   { "text": "", "flush": true }
   // closeConnection
   { "text": "" }
   ```
7. **Server sends** a `finalOutput` summary and closes the websocket:
   ```json
   {
     "event": "finalOutput",
     "isFinal": true,
     "chunks": 3,
     "duration_ms": 5420
   }
   ```

## 6. Supported Voice Identifiers

All voices mirror the Kokoro reference list. Example categories:

- **US female:** `af_alloy`, `af_aoede`, `af_bella`, `af_heart`, `af_jessica`, `af_kore`, `af_nicole`, `af_nova`, `af_river`, `af_sarah`, `af_sky`
- **US male:** `am_adam`, `am_echo`, `am_eric`, `am_fenrir`, `am_liam`, `am_michael`, `am_onyx`, `am_puck`
- **UK voices:** `bf_alice`, `bf_emma`, `bf_isabella`, `bf_lily`, `bm_daniel`, `bm_fable`, `bm_george`, `bm_lewis`
- **French:** `ff_siwis`
- **Italian:** `if_sara`, `im_nicola`
- **Japanese:** `jf_alpha`, `jf_gongitsune`, `jf_nezumi`, `jf_tebukuro`, `jm_kumo`
- **Mandarin:** `zf_xiaobei`, `zf_xiaoni`, `zf_xiaoxiao`, `zf_xiaoyi`, `zm_yunjian`, `zm_yunxi`, `zm_yunxia`, `zm_yunyang`

Use the `voice_id` path parameter to pick a voice; the server falls back to the default (configured via `DEFAULT_VOICE_ID`) when no specific voice is supplied.

## 7. Error Handling

- Authentication failure → `error` event with `code: "error.unauthorized"` and websocket close code 1008.
- Unknown voice → `error.voice_not_found` (close code 4000).
- Unsupported output format → `error.unsupported_output_format` (close code 4000).
- Invalid request payloads during the session trigger `error.invalid_request` and immediate closure.
- Inactivity beyond the configured timeout triggers `error.inactivity_timeout`.

## 8. Minimal Conversation Example

Ordered list describing a successful session:

1. **Handshake URL:**
   ```text
   ws://127.0.0.1:8000/v1/text-to-speech/af_alloy/stream-input?auto_mode=true
   ```
   Headers:
   ```text
   xi-api-key: test-key
   ```
2. **Server event:** `connected` (see step 2 above).
3. **Client → Server:** `initializeConnection` payload (step 3).
4. **Client → Server:**
   ```json
   {
     "text": "Hello there. ",
     "flush": false,
     "try_trigger_generation": true
   }
   ```
5. **Server → Client:** Multiple `audioOutput` frames.
6. **Client → Server:**
   ```json
   {
     "text": "",
     "flush": true
   }
   ```
7. **Client → Server:**
   ```json
   { "text": "" }
   ```
8. **Server → Client:** `finalOutput` followed by websocket closure.

The sequence above mirrors ElevenLabs’ streaming contract, ensuring compatibility with existing clients and SDKs.
