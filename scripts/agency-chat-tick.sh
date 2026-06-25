#!/bin/bash
# agency-chat-tick.sh - Claude side of the autonomous Pearl-Claude conversation.
#
# Every 15 minutes (per Council recommendation), this script:
#   1. Reads recent system state (smoothness monitor metrics, recent alerts)
#   2. If something material has changed since last tick, posts a Claude turn
#      to /api/agency-chat/messages
#   3. Otherwise stays silent (Council rule: no message unless it adds new info)
#
# Pearl posts her own turns directly through the OpenClaw worker when she has
# Discord-side observations, so this script handles only the Claude/orchestrator role.

set -euo pipefail

LOG=/tmp/agency-chat-tick.log
STATE_FILE=/tmp/agency-chat-tick-state.json
LOCKFILE=/tmp/agency-chat-tick.lock

# Lockfile to prevent overlapping runs
if [ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE" 2>/dev/null)" 2>/dev/null; then
    exit 0
fi
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "[$(ts)] $1" >> "$LOG"; }

SECRET=$(grep "^BOT_CONTROL_SHARED_SECRET=" /opt/pearlos/apps/pipecat-daily-bot/.env 2>/dev/null | head -1 | cut -d= -f2)
if [ -z "$SECRET" ]; then
    log "no BOT_CONTROL_SHARED_SECRET found, exiting"
    exit 0
fi

post_message() {
    local body="$1"
    local type="${2:-heartbeat}"
    curl -s -X POST http://localhost:4444/api/agency-chat/messages \
        -H "Content-Type: application/json" \
        -H "x-bot-secret: $SECRET" \
        -d "$(python3 -c "import json,sys; print(json.dumps({'speaker':'Claude','body':sys.argv[1],'type':sys.argv[2]}))" "$body" "$type")" \
        > /dev/null 2>&1
}

# === Gather metrics ===
LOAD=$(awk '{print $1}' /proc/loadavg)
LOAD_5M=$(awk '{print $2}' /proc/loadavg)

# PM2 high-restart processes
HIGH_RESTART=$(pm2 jlist 2>/dev/null | python3 -c "
import json, sys
try:
    procs = json.load(sys.stdin)
    items = []
    for p in procs:
        name = p.get('name','')
        rt = p.get('pm2_env',{}).get('restart_time',0)
        if rt > 100:
            items.append(f'{name}:{rt}')
    print(','.join(items[:3]) if items else '')
except: print('')
")

# Recent gateway timeouts (last 15 min)
RECENT_TIMEOUTS=$(grep "FailoverError: LLM request timed out" /root/.pm2/logs/openclaw-gateway-error.log 2>/dev/null | tail -100 | python3 -c "
import sys, re
from datetime import datetime, timedelta, timezone
cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).strftime('%Y-%m-%dT%H:%M:%S')
count = sum(1 for line in sys.stdin if re.match(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})', line) and line.split('T')[1][:8] >= cutoff[11:])
print(count)
" 2>/dev/null || echo "0")

# Stuck tasks (in_progress > 30min)
STUCK_TASKS=$(curl -s http://localhost:4444/api/tasks 2>/dev/null | python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta
try:
    data = json.load(sys.stdin)
    tasks = data if isinstance(data, list) else data.get('tasks', data.get('data', []))
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    stuck = [t for t in tasks if t.get('status') == 'in_progress' and datetime.strptime(t.get('timestamp_created','')[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc) < cutoff]
    print(len(stuck))
except: print('0')
" 2>/dev/null || echo "0")

# Biggest session size in KB
MAX_SESSION_KB=$(find /root/.openclaw/agents -name "*.jsonl" -not -name "*.bak.*" -not -name "*.deleted.*" -not -name "*.reset.*" 2>/dev/null | xargs -I {} stat -c '%s' {} 2>/dev/null | sort -n | tail -1 | awk '{printf "%d", $1/1024}')

# === Compose message based on state ===

LAST_LOAD=$(grep -o '"last_load":[0-9.]*' "$STATE_FILE" 2>/dev/null | cut -d: -f2 || echo "0")
LAST_TIMEOUTS=$(grep -o '"last_timeouts":[0-9]*' "$STATE_FILE" 2>/dev/null | cut -d: -f2 || echo "0")
LAST_STUCK=$(grep -o '"last_stuck":[0-9]*' "$STATE_FILE" 2>/dev/null | cut -d: -f2 || echo "0")

# Decide whether to speak (Council value-filter rule)
SPEAK=false
MSG=""
TYPE="heartbeat"

# Material change in any metric?
LOAD_DELTA=$(python3 -c "print(abs(float('$LOAD_5M') - float('$LAST_LOAD')) > 5)")
if [ "$LOAD_DELTA" = "True" ]; then
    SPEAK=true
    MSG="Load avg shifted to $LOAD_5M (was $LAST_LOAD). "
fi

if [ "$RECENT_TIMEOUTS" -gt "$LAST_TIMEOUTS" ] && [ "$RECENT_TIMEOUTS" -ge 2 ]; then
    SPEAK=true
    MSG="${MSG}LLM timeouts in last 15min: $RECENT_TIMEOUTS (was $LAST_TIMEOUTS). "
    TYPE="issue"
fi

if [ "$STUCK_TASKS" -gt "$LAST_STUCK" ] && [ "$STUCK_TASKS" -ge 2 ]; then
    SPEAK=true
    MSG="${MSG}Stuck tasks: $STUCK_TASKS (was $LAST_STUCK). Worker may be backed up. "
    TYPE="issue"
fi

if [ -n "$HIGH_RESTART" ]; then
    SPEAK=true
    MSG="${MSG}High-restart processes: $HIGH_RESTART. "
fi

if [ "$MAX_SESSION_KB" -gt 200 ]; then
    SPEAK=true
    MSG="${MSG}Largest session is ${MAX_SESSION_KB}KB, smoothness monitor should auto-trim. "
fi

# Hourly heartbeat if nothing else to say (every 4th tick at 15-min cadence = hourly)
TICK_NUM=$(date -u +%-M)
if [ "$SPEAK" = false ] && [ $((TICK_NUM % 60)) -lt 15 ]; then
    SPEAK=true
    MSG="System steady. Load $LOAD_5M, no timeouts, no stuck tasks. Largest session ${MAX_SESSION_KB}KB."
    TYPE="heartbeat"
fi

if [ "$SPEAK" = true ]; then
    post_message "$MSG" "$TYPE"
    log "posted [$TYPE]: $MSG"
fi

# Save state
cat > "$STATE_FILE" <<EOF
{"last_load":$LOAD_5M,"last_timeouts":$RECENT_TIMEOUTS,"last_stuck":$STUCK_TASKS,"last_tick":"$(ts)"}
EOF
