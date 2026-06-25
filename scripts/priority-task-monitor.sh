#!/usr/bin/env bash
# Priority Task Monitor — runs every 10 minutes
# Checks that P0 tasks are progressing, alerts if stuck

LOG="/tmp/priority-task-monitor.log"
API="http://localhost:4444/api/tasks"
TOKEN=$(python3 - <<'PYEOF' 2>/dev/null || true
import json, os
for path in (
    "/home/deploy/.openclaw/openclaw.json",
    "/home/deploy/.openclaw/relay-openclaw.json",
    "/root/.openclaw/openclaw.json",
):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            cfg = json.load(handle)
        token = (
            cfg.get("channels", {}).get("discord", {}).get("token", "")
            or cfg.get("env", {}).get("DISCORD_BOT_TOKEN", "")
        )
        if token:
            print(token)
            raise SystemExit(0)
    except Exception:
        pass
print(os.environ.get("DISCORD_BOT_TOKEN", ""))
PYEOF
)
CHANNEL="1482123068854763642"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "$(now) $*" >> "$LOG"; }

# Check P0 tasks
declare -A P0_TASKS=(
    ["web chat tool"]="Web Chat Tool Parity"
    ["voice tool"]="Voice Pearl Tool Calling"
    ["wonder canvas"]="Wonder Canvas Restoration"
    ["studio toggle"]="Studio APP/GAME/PEARL"
    ["voxtral"]="Voxtral Setup"
)

TASKS_JSON=$(curl -s "$API" 2>/dev/null)
if [ -z "$TASKS_JSON" ]; then
    log "ERROR: Cannot reach task API"
    exit 1
fi

STUCK=0
for KEY in "${!P0_TASKS[@]}"; do
    PATTERN="${P0_TASKS[$KEY]}"
    # Check if any task matching pattern exists and is in_progress
    COUNT=$(echo "$TASKS_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tasks=[x for x in d.get('tasks',[]) if '$PATTERN' in x.get('title','')]
pending=[x for x in tasks if x.get('status')=='pending']
inprog=[x for x in tasks if x.get('status')=='in_progress']
print(len(inprog) + len(pending))
")
    if [ "$COUNT" -eq 0 ]; then
        log "ALERT: No active task for $KEY ($PATTERN)"
        STUCK=1
    fi
done

# Alert to Discord if any P0 task is missing
if [ "$STUCK" -eq 1 ] && [ -n "$TOKEN" ]; then
    curl -s -m 5 -X POST "https://discord.com/api/v10/channels/${CHANNEL}/messages" \
        -H "Authorization: Bot ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"content":"🚨 Priority Task Monitor: One or more P0 tasks have no active work. Check widget for status."}' \
        > /dev/null 2>&1 || true
fi

log "Check complete. Stuck=$STUCK"
