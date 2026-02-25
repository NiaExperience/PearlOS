# End-to-End Streaming Test Plan

## Goal
Validate the Chorus TTS websocket server using the **real Kokoro ONNX model and voices** bundled in the repository, confirming that streamed audio is synthesized end-to-end (no mocks).

## 1. Prepare Assets & Environment
- Identify asset locations and formats (e.g., `kokoro-v1.0.onnx`, `voices-v1.0.bin`).
- Export runtime variables (via `.env` or shell) before launching the server:
  ```bash
  export KOKORO_MODEL_PATH="/absolute/path/to/kokoro-v1.0.onnx"
  export KOKORO_VOICES_PATH="/absolute/path/to/voices-v1.0.bin"
  export API_KEYS="test-key"
  ```
- Run `uv sync --extra dev` (add `--extra gpu` when exercising CUDA) to confirm dependencies and verify `python -c "import kokoro_onnx"` succeeds.
- Ensure OS-level requirements (espeak data, etc.) are present; Kokoro typically needs espeak-ng voices installed locally.

## 2. Launch the Server
- In terminal A, start the Chorus TTS service with the configured env vars:
  ```bash
  uv run python main.py
  # or
  uv run uvicorn main:build_app --factory --host 0.0.0.0 --port 8000
  ```
- Keep logs visible; later steps will confirm entries like “Websocket connected”.

## 3. Automated Websocket Client
- Enhance `scripts/ws_e2e_client.py` (already provided) so that it:
  1. Connects to `ws://localhost:8000/v1/text-to-speech/af_alloy/stream-input` with header `xi-api-key: test-key` (see the `--url` flag on `scripts/ws_e2e_client.py`).
  2. Awaits the `connected` message and asserts the voice metadata.
  3. Sends the mandatory initialization payload `{ "text": " " }`, then streams each chunk (sentence by default, or comma-delimited when `--chunk-mode comma` is supplied) with `flush=True` to minimize TTFB, and finishes with `{ "text": "" }`.
  4. Streams `audioOutput` messages, decodes base64 to PCM bytes, accumulates data, and (optionally) plays chunks in real time using `sounddevice`.
  5. Receives `finalOutput`, records chunk count/duration, and reports timing metrics (TTFB, inter-chunk gaps).
  6. Closes gracefully, logging any errors.

## 4. Audio Validation
- Convert accumulated PCM bytes into `numpy.int16` samples:
  ```python
  samples = np.frombuffer(pcm_bytes, dtype="<i2")
  ```
- Basic checks: length > 0, max amplitude above a small threshold (> 1000), optional RMS computation.
- (Optional) Emit a `.wav` file using the `wave` module for human verification.

## 5. Pytest Automation
- Add `tests/test_e2e_real_model.py` with `@pytest.mark.e2e` that:
  - Spawns the server via `asyncio.create_subprocess_exec` (using `uv run` and injected env vars).
  - Waits for port readiness.
  - Runs the client routine to assert audio frames arrive and validations pass.
  - Tears down the server regardless of success/failure.
- Skip the test when assets are missing by checking paths at runtime (use `pytest.skip`).
- Document that the test is optional for CI (gated behind a marker).

## 6. Documentation & Usage
- Add instructions to `AGENTS.md` or README covering:
  - Required assets and env vars.
  - Commands to run the e2e test (`pytest -m e2e`, manual script invocation such as `uv run --extra dev python scripts/ws_e2e_client.py --url ws://localhost:8000/v1/text-to-speech/af_alloy/stream-input --api-key test-key --text "Hello"`).
  - Installing optional dependencies (spaCy model, `sounddevice`) for sentence splitting and playback.
  - Where to find the generated `.wav` if saved.
- Consider a convenience Makefile target (`make test-e2e`) encapsulating the workflow.

## 7. Future Enhancements
- Parameterize the client to test multiple voices/languages.
- Capture metrics (latency, chunk count) and output them for comparison across runs.
- Integrate audio similarity checks (e.g., comparing to reference WAV for deterministic phrases) once deterministic seeds are supported.
