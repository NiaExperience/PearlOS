#!/usr/bin/env bash
# announce-restart.sh
#
# Posts a 1-minute heads-up to Discord #pearl-omega before a PearlOS service
# restart, gateway reset, or deploy/build operation, then sleeps the configured
# lead time and exits 0 so the caller can proceed with the actual restart.
#
# Policy (Blair, 2026-04-30): every restart, gateway reset, or rebuild MUST
# announce 1 minute in advance in #pearl-omega so users aren't surprised by a
# brief unresponsive window. Restart scripts source this helper instead of
# calling pm2/curl directly. See:
# /root/.claude/projects/-workspace-runpod-slim/memory/  (policy lives here)
#
# Usage:
#   announce-restart.sh <service-name> [reason]
#   announce-restart.sh --no-wait <service-name> [reason]    # auto-recovery
#   announce-restart.sh --lead 30 <service-name> [reason]    # override lead
#
# Env overrides:
#   RESTART_LEAD_SECONDS  default 60. 0 disables the wait.
#   ANNOUNCE_CHANNEL_ID   default 1494906069149941921 (#pearl-omega).
#   DISCORD_BOT_TOKEN     legacy env fallback. Deploy config is preferred.
#   ANNOUNCE_SUPPRESS=1   skip everything (used for nested calls).
#
# Always exits 0. Discord failures must never block a real restart.

set -u

LOG=/tmp/announce-restart.log
CHANNEL_ID="${ANNOUNCE_CHANNEL_ID:-1494906069149941921}"
LEAD="${RESTART_LEAD_SECONDS:-60}"
WAIT=1

if [ "${ANNOUNCE_SUPPRESS:-0}" = "1" ]; then
    exit 0
fi

while [ $# -gt 0 ]; do
    case "$1" in
        --no-wait) WAIT=0; shift ;;
        --lead)    LEAD="${2:-60}"; shift 2 ;;
        --) shift; break ;;
        -*) shift ;;
        *) break ;;
    esac
done

SERVICE="${1:-unknown-service}"
REASON="${2:-}"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "$(now) [announce-restart] $*" >> "$LOG"; }

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

if [ "$WAIT" = "1" ] && [ "${LEAD:-0}" -gt 0 ] 2>/dev/null; then
    when_msg="in ${LEAD} seconds"
else
    when_msg="now"
fi

if [ -n "$REASON" ]; then
    msg="Heads up, restarting \`${SERVICE}\` ${when_msg} (${REASON}). May be unresponsive for a few moments."
else
    msg="Heads up, restarting \`${SERVICE}\` ${when_msg}. May be unresponsive for a few moments."
fi

log "service=$SERVICE wait=$WAIT lead=$LEAD reason=${REASON:-none}"

if [ -n "$token" ]; then
    python3 - "$token" "$CHANNEL_ID" "$msg" >> "$LOG" 2>&1 <<'PYEOF' || log "discord post raised"
import json, ssl, sys, urllib.request, urllib.error
token, channel, content = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(
    f"https://discord.com/api/v10/channels/{channel}/messages",
    data=json.dumps({"content": content}).encode(),
    headers={
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
        "User-Agent": "PearlOSRestartAnnouncer/1.0 (+restart)",
    },
    method="POST",
)
try:
    r = urllib.request.urlopen(req, timeout=8)
    print("posted", r.status)
except urllib.error.HTTPError as e:
    print("http", e.code, e.read()[:300])
except Exception as e:
    print("err", repr(e))
PYEOF
else
    log "no Discord token; skipping announcement"
fi

if [ "$WAIT" = "1" ] && [ "${LEAD:-0}" -gt 0 ] 2>/dev/null; then
    sleep "$LEAD"
fi

exit 0
