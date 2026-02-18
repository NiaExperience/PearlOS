#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/chorus-tts"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "❌ Chorus TTS app directory not found: ${APP_DIR}" >&2
  exit 1
fi

MODEL_PATH="${APP_DIR}/kokoro-v1.0.onnx"
VOICES_PATH="${APP_DIR}/voices-v1.0.bin"

# Ensure required assets are present; downloader skips existing files.
bash "${SCRIPT_DIR}/download-chorus-assets.sh"

for asset in "${MODEL_PATH}" "${VOICES_PATH}"; do
  if [[ ! -f "${asset}" ]]; then
    echo "❌ Missing asset: ${asset}" >&2
    echo "   Attempted automatic download, try: npm run chorus:download-assets" >&2
    exit 1
  fi
done

if ! command -v uv >/dev/null 2>&1; then
  echo "❌ The 'uv' CLI is not installed or not on PATH." >&2
  echo "   Install from https://docs.astral.sh/uv/ and rerun." >&2
  exit 1
fi

# Ensure the Python environment is up to date before launching.
# Use --extra gpu so onnxruntime-gpu stays installed when ORT_PROVIDERS=CUDAExecutionProvider.
bash "${SCRIPT_DIR}/chorus-uv-sync.sh" --extra gpu

export KOKORO_MODEL_PATH="${KOKORO_MODEL_PATH:-${MODEL_PATH}}"
export KOKORO_VOICES_PATH="${KOKORO_VOICES_PATH:-${VOICES_PATH}}"
export API_KEYS="${API_KEYS:-test-key}"
export SERVER_HOST="${SERVER_HOST:-127.0.0.1}"
export SERVER_PORT="${SERVER_PORT:-8000}"

echo "🚀 Starting Chorus TTS"
echo "   Host: ${SERVER_HOST}"
echo "   Port: ${SERVER_PORT}"
echo "   Model: ${KOKORO_MODEL_PATH}"
echo "   Voices: ${KOKORO_VOICES_PATH}"

cd "${APP_DIR}"
exec uv run --no-sync uvicorn main:build_app --factory --host "${SERVER_HOST}" --port "${SERVER_PORT}" "$@"
 