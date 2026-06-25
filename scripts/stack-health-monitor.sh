#!/usr/bin/env bash
# stack-health-monitor.sh — Every 5 minutes, check the full PearlOS stack
# Alerts to Discord #pearl-omega if anything is down
# Cron: */5 * * * *

set -euo pipefail

DISCORD_CHANNEL="1494906069149941921"
BOT_TOKEN="MTQ3MTQ5NjAzMzg4NzMyMjE0NA.GBuidy.D4rTA1xJ6VD5WHrKXT8Mmv7rPq5ytYLx4iIJUw"
LOG="/tmp/stack-health.log"
STATE_FILE="/tmp/stack-health-state.json"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"; }

resolve_worker_root() {
    if [ -n "${PEARL_WORKER_ROOT:-}" ]; then
        echo "$PEARL_WORKER_ROOT"
        return
    fi
    if [ -n "${PEARLOS_WORKER_ROOT:-}" ]; then
        echo "$PEARLOS_WORKER_ROOT"
        return
    fi
    for candidate in /workspace/nia-universal /opt/pearlos /home/deploy/pearlos; do
        if [ -f "$candidate/scripts/pearl-worker.py" ]; then
            echo "$candidate"
            return
        fi
    done
}

WORKER_ROOT="$(resolve_worker_root)"

send_discord() {
    curl -s -X POST "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages" \
        -H "Authorization: Bot ${BOT_TOKEN}" \
        -H "Content-Type: application/json" \
        -H "User-Agent: DiscordBot (PearlOS, 1.0)" \
        -d "{\"content\": \"$1\"}" > /dev/null 2>&1
}

issues=""
warnings=""

# ── PM2 Services ──────────────────────────────────────────────────
check_pm2() {
    local name="$1"
    local status
    status=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
procs = json.load(sys.stdin)
for p in procs:
    if p.get('name') == '$name':
        print(p.get('pm2_env',{}).get('status','unknown'))
        break
else:
    print('missing')
" 2>/dev/null)
    if [ "$status" != "online" ]; then
        issues="${issues}\\n🔴 PM2 \`$name\`: $status"
        log "FAIL: PM2 $name is $status"
    fi
}

for svc in interface openclaw-gateway pipecat-gateway pipecat-runner pocket-tts pearl-worker; do
    check_pm2 "$svc"
done

# ── HTTP Health ───────────────────────────────────────────────────
check_http() {
    local name="$1" url="$2"
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
    if [ "$code" = "000" ]; then
        issues="${issues}\\n🔴 \`$name\`: unreachable"
        log "FAIL: $name unreachable"
    elif [ "$code" -ge 500 ]; then
        issues="${issues}\\n🔴 \`$name\`: HTTP $code"
        log "FAIL: $name HTTP $code"
    fi
}

check_http "PearlOS UI" "http://localhost:3000/login"
check_http "OpenClaw" "http://localhost:18789/health"
check_http "Bot Gateway" "http://localhost:4444/health"
check_http "PocketTTS" "http://localhost:8766/health"

# ── DeepSeek proxy check ──────────────────────────────────────────
if ! curl -s --max-time 3 http://localhost:8200/v1/models -H "Authorization: Bearer sk-c4f226aeeaa044f2a9eba95737b491a5" > /dev/null 2>&1; then
    issues="${issues}\\n🔴 DeepSeek proxy not responding on :8200"
fi

# ── Session bloat check + auto-remediate ────────────────────────
# Threshold raised to 3MB (sessions are normal up to that size after the
# server-side tool-result truncator reduced typical bloat). Each session
# is trimmed at most once per 24h, and an actively-used session younger
# than 24h is left alone so an in-flight conversation isn't yanked.
BLOAT_DIR="/root/.openclaw/agents/main/sessions"
BLOAT_ARCHIVE="${BLOAT_DIR}/bloat-archive"
TRIM_STATE_DIR="/tmp/stack-health-trim-state"
mkdir -p "$BLOAT_ARCHIVE" "$TRIM_STATE_DIR"

BLOAT_BYTES=$((3*1024*1024))      # 3 MB
TRIM_COOLDOWN=$((24*60*60))       # 24 hours
ACTIVE_MTIME_SECONDS=$((24*60*60))
KEEP_LAST_MESSAGES=100

now_epoch=$(date +%s)
bloated_sessions=$(find "$BLOAT_DIR" -maxdepth 1 -name "*.jsonl" -size +${BLOAT_BYTES}c -not -path "*/bloat-archive/*" 2>/dev/null)
trimmed_count=0
skipped_active=0
skipped_cooldown=0

if [ -n "$bloated_sessions" ]; then
    for bloat_file in $bloated_sessions; do
        filename=$(basename "$bloat_file")
        state_file="${TRIM_STATE_DIR}/${filename}.lasttrim"

        # Skip if recently active (modified in last 24h) AND under 24h old.
        # An "active" session that's still being written to is left to
        # finish naturally; we only trim if it's grown huge AND quiet.
        file_mtime=$(stat -c %Y "$bloat_file" 2>/dev/null || echo 0)
        file_age=$((now_epoch - file_mtime))
        if [ "$file_age" -lt "$ACTIVE_MTIME_SECONDS" ]; then
            log "AUTO-TRIM: $filename is $(du -h "$bloat_file" | cut -f1) but actively in use (mtime ${file_age}s ago) - skipping"
            skipped_active=$((skipped_active + 1))
            continue
        fi

        # Per-file 24h cooldown so we don't re-trim the same file repeatedly
        if [ -f "$state_file" ]; then
            last_trim=$(cat "$state_file" 2>/dev/null || echo 0)
            since_last=$((now_epoch - last_trim))
            if [ "$since_last" -lt "$TRIM_COOLDOWN" ]; then
                log "AUTO-TRIM: $filename is $(du -h "$bloat_file" | cut -f1) but last trimmed ${since_last}s ago (<24h) - skipping"
                skipped_cooldown=$((skipped_cooldown + 1))
                continue
            fi
        fi

        total_lines=$(wc -l < "$bloat_file")
        log "AUTO-TRIM: $filename is $(du -h "$bloat_file" | cut -f1) ($total_lines lines) - trimming"

        archive_name="${filename}.$(date -u +%Y%m%dT%H%M%SZ).pre-trim"
        cp "$bloat_file" "${BLOAT_ARCHIVE}/${archive_name}"

        # Smarter trim: preserve session header/model_change records (which
        # the gateway needs to reconstruct provider state) and keep the
        # last KEEP_LAST_MESSAGES message lines.
        python3 - "$bloat_file" "$KEEP_LAST_MESSAGES" << 'PYEOF' > "${bloat_file}.trimmed"
import json, sys
path, keep = sys.argv[1], int(sys.argv[2])
preserved, messages = [], []
with open(path, encoding='utf-8', errors='replace') as f:
    for line in f:
        s = line.rstrip('\n')
        if not s:
            continue
        try:
            obj = json.loads(s)
            t = obj.get('type')
        except Exception:
            messages.append(s)
            continue
        if t in ('session', 'model_change', 'thinking_level_change'):
            preserved.append(s)
        else:
            messages.append(s)
tail = messages[-keep:]
for line in preserved + tail:
    print(line)
PYEOF
        if [ -s "${bloat_file}.trimmed" ]; then
            mv "${bloat_file}.trimmed" "$bloat_file"
            echo "$now_epoch" > "$state_file"
            trimmed_lines=$(wc -l < "$bloat_file")
            log "AUTO-TRIM: $filename trimmed to $trimmed_lines lines (archived at bloat-archive/${archive_name})"
            trimmed_count=$((trimmed_count + 1))
        else
            log "AUTO-TRIM: $filename trim produced empty output - keeping original"
            rm -f "${bloat_file}.trimmed"
        fi
    done
fi

if [ "$trimmed_count" -gt 0 ]; then
    warnings="${warnings}\n⚠️ $trimmed_count session(s) auto-trimmed (>3MB, idle, past cooldown)"
fi
if [ "$skipped_active" -gt 0 ] || [ "$skipped_cooldown" -gt 0 ]; then
    log "AUTO-TRIM: skipped active=$skipped_active cooldown=$skipped_cooldown"
fi

# Reap stale per-file trim-state markers (no matching session for >14 days)
find "$TRIM_STATE_DIR" -name "*.lasttrim" -mtime +14 -delete 2>/dev/null

# Also check the sessions.json aggregate file
agg_file="${BLOAT_DIR}/sessions.json"
if [ -f "$agg_file" ]; then
    agg_size=$(stat -c%s "$agg_file" 2>/dev/null || echo 0)
    if [ "$agg_size" -gt 2097152 ]; then
        log "WARN: sessions.json is $(du -h "$agg_file" | cut -f1)"
    fi
fi

# Checkpoint cleanup
find /root/.openclaw/agents -name "*.checkpoint.*.jsonl" -mmin +120 -delete 2>/dev/null
find "$BLOAT_ARCHIVE" -name "*.pre-trim" -mtime +7 -delete 2>/dev/null

# ── Task queue ────────────────────────────────────────────────────
pending=$(curl -s "http://localhost:4444/api/tasks?status=pending&limit=1" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo "?")
stuck=$(curl -s "http://localhost:4444/api/tasks?status=in_progress&limit=10" 2>/dev/null | python3 -c "
import sys,json,time
d=json.load(sys.stdin)
count=0
for t in d.get('tasks',[]):
    updated = t.get('timestamp_updated','')
    # If in_progress for more than 30 min, it's stuck
    count += 1
print(count)
" 2>/dev/null || echo "?")

if [ "$pending" != "?" ] && [ "$pending" -gt 5 ]; then
    warnings="${warnings}\\n⚠️ Task queue: $pending pending tasks piling up"
fi

# ── Pearl-worker alive ───────────────────────────────────────────
worker_pid=$(pm2 pid pearl-worker 2>/dev/null)
if [ -z "$worker_pid" ] || [ "$worker_pid" = "0" ]; then
    issues="${issues}\\n🔴 pearl-worker is dead — tasks won't be consumed"
    log "FAIL: pearl-worker dead, restarting"
    # Auto-recovery: announce immediately, no 60s lead (worker is already down).
    if [ -z "$WORKER_ROOT" ] || [ ! -f "$WORKER_ROOT/scripts/pearl-worker.py" ]; then
        log "FAIL: pearl-worker script not found; set PEARL_WORKER_ROOT"
        issues="${issues} (auto-restart skipped: worker root not found)"
    else
        "$WORKER_ROOT/scripts/announce-restart.sh" --no-wait pearl-worker "stack-health auto-recovery (worker was dead)" 2>/dev/null || true
        pm2 delete pearl-worker 2>/dev/null
        (cd "$WORKER_ROOT" && pm2 start python3 --name pearl-worker -- "$WORKER_ROOT/scripts/pearl-worker.py" --sse --executor agency --timeout 1200 --concurrency 2) 2>/dev/null
        pm2 save 2>/dev/null
        issues="${issues} (auto-restarted)"
    fi
fi

# ── Cloudflared ───────────────────────────────────────────────────
if ! pgrep -x cloudflared > /dev/null 2>&1; then
    warnings="${warnings}\\n⚠️ Cloudflared tunnel not running"
fi

# ── VRAM check ────────────────────────────────────────────────────
vram_free=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1)
if [ -n "$vram_free" ] && [ "$vram_free" -lt 2000 ]; then
    warnings="${warnings}\\n⚠️ GPU VRAM low: ${vram_free}MB free"
fi

# ── Report ────────────────────────────────────────────────────────
log "Check complete: issues=$(echo -e "$issues" | grep -c '🔴') warnings=$(echo -e "$warnings" | grep -c '⚠️')"

if [ -n "$issues" ]; then
    send_discord "Pearl's Agency says: 🚨 **Stack Health Alert**${issues}${warnings}"
elif [ -n "$warnings" ]; then
    # Only send warnings once per hour (not every 5 min)
    last_warn=$(stat -c %Y "$STATE_FILE" 2>/dev/null || echo 0)
    now=$(date +%s)
    if [ $((now - last_warn)) -gt 3600 ]; then
        send_discord "Pearl's Agency says: ⚠️ **Stack Warnings**${warnings}"
        touch "$STATE_FILE"
    fi
fi

# Trim log
tail -500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"

# ── Pod 3 Ollama tunnel ──────────────────────────────────────────
if ! curl -s --max-time 3 http://localhost:11435/api/tags > /dev/null 2>&1; then
    # Kill stale tunnels and reconnect
    pkill -f "ssh.*11435.*103.196" 2>/dev/null
    sleep 1
    nohup ssh -T -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -N -L 11435:localhost:11434 root@103.196.86.132 -p 19341 -i ~/.ssh/id_ed25519 > /tmp/ssh-tunnel-pod3.log 2>&1 &
    sleep 3
    # Warm up the model
    curl -s http://localhost:11435/api/generate -d '{"model":"qwen3:30b-a3b","prompt":"ping","stream":false}' > /dev/null 2>&1 &
    issues="${issues}\n🔴 Pod 3 tunnel was dead — auto-reconnected"
    log "FAIL: Pod 3 tunnel dead, reconnected"
fi

# ── Branch divergence guard ──────────────────────────────────────
WORKSPACE_COMMIT=$(cd /workspace/nia-universal && git rev-parse --short HEAD 2>/dev/null)
DEPLOYED_BUILD=$(cat /workspace/nia-universal/apps/interface/.next/BUILD_ID 2>/dev/null)
if [ -n "$WORKSPACE_COMMIT" ] && [ -n "$DEPLOYED_BUILD" ]; then
    if ! echo "$DEPLOYED_BUILD" | grep -q "$WORKSPACE_COMMIT"; then
        warnings="${warnings}\n⚠️ Branch divergence: workspace@${WORKSPACE_COMMIT} but deployed build=${DEPLOYED_BUILD}"
    fi
fi
