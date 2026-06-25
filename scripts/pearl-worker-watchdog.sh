#!/usr/bin/env bash
# pearl-worker-watchdog.sh — ensures pearl-worker stays alive
# Run via cron every 2 minutes. If pearl-worker is dead, restart it.

WORKER_CWD="${PEARL_WORKER_ROOT:-${PEARLOS_WORKER_ROOT:-}}"
if [ -z "$WORKER_CWD" ]; then
    for candidate in /workspace/nia-universal /opt/pearlos /home/deploy/pearlos; do
        if [ -f "$candidate/scripts/pearl-worker.py" ]; then
            WORKER_CWD="$candidate"
            break
        fi
    done
fi
WORKER_SCRIPT="$WORKER_CWD/scripts/pearl-worker.py"
LOG="/tmp/pearl-worker-watchdog.log"

if ! pm2 pid pearl-worker > /dev/null 2>&1 || [ "$(pm2 pid pearl-worker)" = "" ] || [ "$(pm2 pid pearl-worker)" = "0" ]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pearl-worker is dead, restarting" >> "$LOG"
    # Auto-recovery: announce immediately, no 60s lead (worker is already down).
    if [ ! -f "$WORKER_SCRIPT" ]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pearl-worker script not found; set PEARL_WORKER_ROOT" >> "$LOG"
        exit 1
    fi
    "$WORKER_CWD/scripts/announce-restart.sh" --no-wait pearl-worker "watchdog auto-recovery (worker was dead)" 2>/dev/null || true
    pm2 delete pearl-worker 2>/dev/null
    cd "$WORKER_CWD"
    pm2 start python3 --name pearl-worker -- "$WORKER_SCRIPT" --sse --executor agency --timeout 1200 --concurrency 2
    pm2 save
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pearl-worker restarted" >> "$LOG"
fi
