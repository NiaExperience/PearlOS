#!/bin/sh
set -e

# Default to gateway if MODE is not set
MODE=${MODE:-gateway}

case "$MODE" in
  runner)
    echo "Starting Pipecat runner (daily)..."
    # Allow overriding host/port via env vars, default if not set
    export RUNNER_HOST=${RUNNER_HOST:-0.0.0.0}
    export RUNNER_PORT=${RUNNER_PORT:-7860}
    # Use exec to replace the shell with the python process for signal handling
    exec python runner_main.py
    ;;
  gateway)
    echo "Starting Gateway..."
    exec uvicorn bot_gateway:app --host 0.0.0.0 --port 4444
    ;;
  operator)
    echo "Starting Operator..."
    exec python bot_operator.py
    ;;
  *)
    echo "Unknown mode: $MODE"
    exit 1
    ;;
esac
