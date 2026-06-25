#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="${PEARLOS_APP_ROOT:-$SCRIPT_DIR}"
if [[ ! -d "$APP_ROOT/bot" && -d "/workspace/nia-universal/apps/pipecat-daily-bot/bot" ]]; then
  APP_ROOT="/workspace/nia-universal/apps/pipecat-daily-bot"
fi

cd "$APP_ROOT/bot"
exec poetry run python bot_queue_worker.py
