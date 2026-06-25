#!/bin/bash
# Load env vars from .env file (for BOT_CONTROL_SHARED_SECRET etc.)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi
export PEARL_CLAUDE_BIN=/usr/bin/claude
if [ -z "${PEARL_CODEX_BIN:-}" ]; then
  if command -v codex >/dev/null 2>&1; then
    export PEARL_CODEX_BIN="$(command -v codex)"
  else
    CODEX_VENDOR_BIN="$(find /root/.openclaw/plugin-runtime-deps -path '*/@openai/codex-linux-x64/vendor/*/codex/codex' -type f -perm -111 2>/dev/null | sort -V | tail -1)"
    export PEARL_CODEX_BIN="${CODEX_VENDOR_BIN:-/snap/bin/codex}"
  fi
fi
if [ -z "${CODEX_HOME:-}" ]; then
  for candidate in \
    "${HOME:-/home/deploy}/.codex" \
    "${HOME:-/home/deploy}/snap/codex/current" \
    "${HOME:-/home/deploy}/snap/codex/34" \
    /root/snap/codex/34
  do
    if [ -f "$candidate/auth.json" ]; then
      export CODEX_HOME="$candidate"
      break
    fi
  done
fi
if [ -z "${CODEX_HOME:-}" ]; then
  export CODEX_HOME="${HOME:-/home/deploy}/.codex"
fi
export PEARL_TASKS_API=http://localhost:4444/api/tasks
export PEARL_WORKER_ASSIGNEE=claude_cli
if [ -z "${PEARLOS_AGENCY_BOSS_CONFIG:-}" ]; then
  export PEARLOS_AGENCY_BOSS_CONFIG="$(cd "$SCRIPT_DIR/../.." && pwd)/config/agency-boss.json"
fi

WORKER_SCRIPT="${PEARL_WORKER_SCRIPT:-}"
if [ -z "$WORKER_SCRIPT" ]; then
  REPO_ROOT_FROM_SCRIPT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  for candidate in \
    "${PEARLOS_SOURCE_ROOT:-}/scripts/pearl-worker.py" \
    "$REPO_ROOT_FROM_SCRIPT/scripts/pearl-worker.py" \
    /workspace/nia-universal-pearl-prod/scripts/pearl-worker.py \
    /workspace/nia-universal/scripts/pearl-worker.py \
    "$SCRIPT_DIR/scripts/pearl-worker.py"
  do
    if [ -f "$candidate" ]; then
      WORKER_SCRIPT="$candidate"
      break
    fi
  done
fi
if [ -z "$WORKER_SCRIPT" ] || [ ! -f "$WORKER_SCRIPT" ]; then
  echo "pearl-worker.py not found; set PEARL_WORKER_SCRIPT" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$WORKER_SCRIPT")/.." && pwd)"
if [ -x "$REPO_ROOT/scripts/pearl-codex-worker-preflight.sh" ]; then
  "$REPO_ROOT/scripts/pearl-codex-worker-preflight.sh"
fi

cd "$SCRIPT_DIR/bot"
exec poetry run python "$WORKER_SCRIPT" --sse --executor agency --timeout 1200 --concurrency 2
