#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/chorus-tts"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "ℹ️ Skipping Chorus uv sync: directory not found (${APP_DIR})."
  exit 0
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "ℹ️ Skipping Chorus uv sync: 'uv' CLI not detected on PATH."
  echo "   Install from https://docs.astral.sh/uv/ to enable automatic sync."
  exit 0
fi

echo "🔄 Running 'uv sync' in ${APP_DIR}"
cd "${APP_DIR}"
exec uv sync "$@"
