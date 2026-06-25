#!/bin/bash
# cron-watchdog: ensures the cron daemon stays alive.
# Runs as a PM2 long-lived process so it survives even when cron itself
# (and therefore every cron-launched watchdog) is dead.
#
# Background: on 2026-04-22 the cron daemon died and left a stale pid
# file at /run/crond.pid. Because every health monitor on this box is
# scheduled via cron, all of them silently stopped for ~4 days until a
# manual investigation. A cron-out-of-cron watchdog closes that gap.

LOG=/tmp/cron-watchdog.log
INTERVAL_SEC=60

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

discord_token() {
  python3 - <<'PYEOF' 2>/dev/null || true
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
}

log "cron-watchdog starting (pid=$$)"

while true; do
  if ! pgrep -x cron > /dev/null 2>&1; then
    # Clear any stale pid file so init script will start cleanly.
    rm -f /run/crond.pid /var/run/crond.pid 2>/dev/null
    if service cron start > /tmp/cron-watchdog-start.out 2>&1; then
      log "cron was down, restarted OK"
      # Best-effort Discord alert.
      TOKEN=$(discord_token)
      if [ -n "$TOKEN" ]; then
        curl -s -X POST "https://discord.com/api/v10/channels/1482123068854763642/messages" \
          -H "Authorization: Bot $TOKEN" \
          -H "User-Agent: DiscordBot (PearlOS, 1.0)" \
          -H "Content-Type: application/json" \
          -d '{"content":"Pearl'\''s Agency says: cron-watchdog detected the cron daemon was down and restarted it. Health monitors are scheduled via cron, so this prevents the silent multi-day blackout we saw on April 22."}' \
          > /dev/null 2>&1
      fi
    else
      log "cron was down and restart FAILED: $(cat /tmp/cron-watchdog-start.out)"
    fi
  fi
  sleep "$INTERVAL_SEC"
done
