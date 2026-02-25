# Chorus TTS

Chorus TTS is a local websocket service that mirrors the ElevenLabs streaming protocol while synthesizing speech with the Kokoro ONNX model.

## Prerequisites
- Python 3.10+
- [uv](https://docs.astral.sh/uv/) for dependency management
- Kokoro assets: `kokoro-v1.0.onnx` and `voices-v1.0.bin` at the repository root
- Optional: `espeak-ng` voices installed on the host for phonemizer support
- Optional (for the e2e client):
  - `sounddevice` for real-time playback (installed via uv)
  - spaCy English model for sentence-aware streaming:
    ```bash
    uv add --dev https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0.tar.gz
    ```

## Setup
- Install dependencies:
  ```bash
  uv sync
  ```
- Export runtime configuration (adjust paths as needed):
  ```bash
  export KOKORO_MODEL_PATH="$PWD/kokoro-v1.0.onnx"
  export KOKORO_VOICES_PATH="$PWD/voices-v1.0.bin"
  export API_KEYS="test-key"
  # optional overrides
  export SERVER_PORT=8000
  export SERVER_HOST=127.0.0.1
  # optional: pre-build multiple inference sessions for concurrency
  export KOKORO_SESSION_POOL_SIZE=4
  ```
- Reference `AGENTS.md` for additional configuration details.

### Optional GPU dependencies
- Install the GPU runtime build when CUDA drivers are available:
  ```bash
  uv sync --extra gpu
  ```
- Ensure the CUDA shared libraries shipped by the NVIDIA wheels are discoverable by populating `LD_LIBRARY_PATH` from the active
  virtual environment:
  ```bash
  export LD_LIBRARY_PATH="$(uv run --no-sync python - <<'PY'
import os
import sys
from pathlib import Path

prefix = Path(sys.prefix) / f"lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages"
search_paths = [
    prefix / "nvidia" / "cuda_runtime" / "lib",
    prefix / "nvidia" / "cuda_runtime" / "lib64",
    prefix / "nvidia" / "cublas" / "lib",
    prefix / "nvidia" / "cublas" / "lib64",
    prefix / "nvidia" / "cudnn" / "lib",
    prefix / "nvidia" / "cudnn" / "lib64",
    prefix / "nvidia" / "curand" / "lib",
    prefix / "nvidia" / "curand" / "lib64",
    prefix / "nvidia" / "cufft" / "lib",
    prefix / "nvidia" / "cufft" / "lib64",
    prefix / "onnxruntime" / "capi",
]
print(":".join(str(path) for path in search_paths if path.exists()), end="")
PY
)":${LD_LIBRARY_PATH:-}"
  ```
- Configure ONNX Runtime to prefer the GPU (unset any variables you do not need):
  ```bash
  export ORT_PROVIDERS="CUDAExecutionProvider,CPUExecutionProvider"
  export ORT_ENABLE_MEM_PATTERN=1
  export ORT_GRAPH_OPTIMIZATION_LEVEL=ALL
  export ORT_EXECUTION_MODE=SEQUENTIAL
  # Optional thread hints
  # export ORT_INTRA_OP_NUM_THREADS=1
  # export ORT_INTER_OP_NUM_THREADS=1
  ```
- Sanity-check the GPU environment before starting the server:
  ```bash
  uv run --no-sync python - <<'PY'
import onnxruntime as ort

print(ort.get_available_providers())
PY
  ```

## Container image
- Build the unified CPU/GPU image (downloads Kokoro assets during the build):
  ```bash
  docker build -t chorus-tts:latest .
  ```
- Run the container (Docker 24.0+ syntax shown; adjust GPU flags for your runtime):
  ```bash
  docker run --rm --gpus all \
      -p 8000:8000 \
      -e API_KEYS="test-key" \
      -e ORT_PROVIDERS="CUDAExecutionProvider,CPUExecutionProvider" \
      chorus-tts:latest
  ```
- The image bakes `kokoro-v1.0.onnx` and `voices-v1.0.bin` into `/app/assets`; override `KOKORO_MODEL_PATH` or
  `KOKORO_VOICES_PATH` if you mount alternate assets at runtime.

## Running the Server
- Launch with uv:
  ```bash
  uv run python main.py
  ```
- Or via Uvicorn directly:
  ```bash
  uv run uvicorn main:build_app --factory --host 0.0.0.0 --port 8000
  ```
- Verify readiness:
  ```bash
  curl http://127.0.0.1:8000/healthz
  ```

## Manual Websocket Test
- With the server running, stream audio using the helper script:
  ```bash
  uv run --extra dev python scripts/ws_e2e_client.py \
      --url ws://127.0.0.1:8000/v1/text-to-speech/af_alloy/stream-input \
      --api-key test-key \
      --text "Hello there. This is a streaming test." \
      --chunk-mode sentence \
      --metrics \
      --wav out.wav
  ```
- The client automatically splits text into sentences (via spaCy when available) or commas (`--chunk-mode comma`), triggers flushes per chunk to lower TTFB, emits timing metrics via logging, and optionally plays/stores audio. Optional dependencies such as `sounddevice` are best-effort; if they are missing, playback is skipped and the script continues.

## Automated Tests
- Run the standard suite (mocks and integration):
  ```bash
  uv run --extra dev pytest
  ```
- The `tests/test_end_to_end.py` case mirrors the websocket flow with a fake engine; pair it with the manual script above to validate against real assets.

## Load Testing
- Install the load-testing tooling:
  ```bash
  uv sync --extra load
  ```
- With the server running (ideally on a GPU-enabled host), exercise concurrent websocket sessions:
  ```bash
  uv run --extra load locust -f loadtest/locustfile.py --headless -u 5 -r 1 -t 5m
  ```
- See `docs/locust_load_test_plan.md` for environment variables, telemetry guidance, and recommended load profiles.

## Development Workflow
- Run the fast test suite:
  ```bash
  PYTHONPATH=. uv run --extra dev pytest
  ```
- Focus on websocket behaviour:
  ```bash
  PYTHONPATH=. uv run --extra dev pytest tests/test_app.py
  ```
- Collect coverage:
  ```bash
  PYTHONPATH=. uv run --extra dev pytest --cov=chorus_tts --cov-report=term-missing
  ```
- The websocket API follows the ElevenLabs contract: initialize with a blank message, stream `sendText` payloads, issue `flush` or `try_trigger_generation` as needed, and finish with an empty text payload. Responses include `audioOutput` frames (base64 PCM 22050 Hz) followed by `finalOutput`.

## Repository Layout
- `main.py` – entry point wiring configuration and Uvicorn
- `chorus_tts/` – application modules (config, engine wrapper, websocket handler, session state)
- `tests/` – unit, integration, and end-to-end tests (mock-based and real asset checks)
- `scripts/` – manual tooling such as the websocket client
- `docs/` – PRDs, milestone plans, and e2e test instructions

## Additional Notes
- Use `docs/e2e_testing_plan.md` for the detailed real-asset validation workflow.
- GPU deployment considerations are captured in `docs/gpu_deployment_notes.md`.
- Metrics, structured logging, and inactivity handling are enabled by default; review logs for `session_id`, chunk counts, and timeouts when debugging.
