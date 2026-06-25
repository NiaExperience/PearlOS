#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi
cd "$SCRIPT_DIR/bot"
exec poetry run uvicorn bot_gateway:app --host 0.0.0.0 --port 4444 --timeout-keep-alive 30
