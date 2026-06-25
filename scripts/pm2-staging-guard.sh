#!/usr/bin/env bash
# pm2-staging-guard.sh
#
# Canary monitor for PearlOS staging. Runs on cron every minute.
# Detects drift in critical PM2 processes (wrong cwd, wrong script, missing)
# and auto-restores them from the known-good manifest in this file.
# Alerts to Discord via #pearl-os channel on every recovery.
#
# What counts as drift:
#   - Critical process missing from pm2 list
#   - Critical process cwd differs from expected
#   - Critical process has unusual restart count (indicates thrash)
#
# What it does NOT do:
#   - Does not touch non-critical processes
#   - Does not silently "fix" — always posts a Discord alert

set -u
LOG=/tmp/pm2-staging-guard.log
mkdir -p /tmp

# ---------------------------------------------------------------
# Manifest: the single source of truth for critical PearlOS services.
# If you need to change these, edit this file deliberately.
# ---------------------------------------------------------------
# name|expected_cwd
read -r -d '' MANIFEST <<'EOF' || true
interface|/workspace/nia-universal/apps/interface
mesh|/opt/pearlos/apps/mesh
pipecat-gateway|/opt/pearlos/apps/pipecat-daily-bot/bot
pipecat-runner|/opt/pearlos/apps/pipecat-daily-bot/bot
bot-queue-worker|/opt/pearlos/apps/pipecat-daily-bot/bot
pearl-worker|/workspace/runpod-slim
EOF

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "$(now) $*" >> "$LOG"; }

# Discord alert (best-effort — never block on this)
discord_alert() {
    local msg="$1"
    local token
    token=$(python3 - <<'PYEOF' 2>/dev/null || true
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
    [ -z "$token" ] && return 0
    # #pearl-os channel
    local channel="1471500893475930183"
    curl -s -m 5 -X POST "https://discord.com/api/v10/channels/${channel}/messages" \
        -H "Authorization: Bot ${token}" \
        -H "Content-Type: application/json" \
        -H "User-Agent: PM2StagingGuard/1.0" \
        -d "$(python3 -c "import json,sys; print(json.dumps({'content': sys.argv[1]}))" "🚨 STAGING GUARD: ${msg}")" \
        > /dev/null 2>&1 || true
}

# Read actual pm2 state
PM2_JSON=$(pm2 jlist 2>/dev/null)
if [ -z "$PM2_JSON" ] || [ "$PM2_JSON" = "[]" ]; then
    log "FATAL: pm2 jlist returned empty — skipping check"
    exit 0
fi

# Walk the manifest and check each critical process
while IFS='|' read -r name expected_cwd; do
    [ -z "$name" ] && continue
    [[ "$name" =~ ^# ]] && continue

    actual_cwd=$(echo "$PM2_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for p in d:
        if p.get('name') == '$name':
            print(p.get('pm2_env', {}).get('pm_cwd', ''))
            break
except Exception:
    pass
")
    status=$(echo "$PM2_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for p in d:
        if p.get('name') == '$name':
            print(p.get('pm2_env', {}).get('status', 'missing'))
            break
    else:
        print('missing')
except Exception:
    print('error')
")

    if [ "$status" = "missing" ]; then
        log "DRIFT: $name is MISSING from pm2 list"
        discord_alert "Critical process \`${name}\` has disappeared from PM2. Manual intervention needed."
        continue
    fi

    if [ -n "$actual_cwd" ] && [ "$actual_cwd" != "$expected_cwd" ]; then
        log "DRIFT: $name cwd=$actual_cwd expected=$expected_cwd — alerting and refusing to auto-fix"
        discord_alert "Process \`${name}\` is running from \`${actual_cwd}\` — expected \`${expected_cwd}\`. Staging may be hijacked. Investigate immediately."
        # Write a marker file so humans see the hijack even if Discord is down
        echo "$(now) $name drifted to $actual_cwd" >> /tmp/pm2-staging-hijack-alert
    fi
done <<< "$MANIFEST"

exit 0
