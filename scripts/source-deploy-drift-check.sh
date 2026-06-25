#!/usr/bin/env bash
# source-deploy-drift-check.sh — Guard against /opt/pearlos drift
#
# Compares /workspace/nia-universal/apps to /opt/pearlos/apps and alerts
# Discord (#pearl-omega) if any source-code file differs between the two.
# This catches the "agent edited /opt/pearlos directly without updating
# /workspace/nia-universal" failure mode that bit us on 2026-04-30.
#
# Cron (NOT installed — review first):
#   */30 * * * * /opt/pearlos/scripts/source-deploy-drift-check.sh >> /tmp/drift-check.log 2>&1
#
# Manual run:
#   /opt/pearlos/scripts/source-deploy-drift-check.sh
#
# Exit codes:
#   0  no drift, or drift only inside the allowlist
#   1  drift detected in code files

set -uo pipefail

SOURCE_ROOT="/workspace/nia-universal"
DEPLOY_ROOT="/opt/pearlos"
DISCORD_CHANNEL="1494906069149941921"   # #pearl-omega
LOG="/tmp/drift-check.log"
STATE_FILE="/tmp/drift-check-state.json"
COOLDOWN_SECONDS=$((30 * 60))  # don't re-alert more than once per 30 min for same set

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"; }

# Discord helper. Pulls bot token from deploy config first, root legacy config
# last. Silent on failure.
send_discord() {
    local content="$1"
    local token=""
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
    if [ -z "$token" ]; then
        log "WARN: no Discord token available, skipping alert"
        return 0
    fi
    # JSON-encode content safely.
    local payload
    payload=$(python3 -c "import json,sys; print(json.dumps({'content': sys.argv[1]}))" "$content" 2>/dev/null)
    curl -s -X POST "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages" \
        -H "Authorization: Bot ${token}" \
        -H "Content-Type: application/json" \
        -H "User-Agent: DiscordBot (drift-check, 1.0)" \
        -d "$payload" > /dev/null 2>&1 || log "WARN: Discord POST failed"
}

# Sanity check.
if [ ! -d "$SOURCE_ROOT/apps" ] || [ ! -d "$DEPLOY_ROOT/apps" ]; then
    log "FAIL: missing $SOURCE_ROOT/apps or $DEPLOY_ROOT/apps — cannot diff"
    exit 2
fi

# Build the list of differing files.
# diff -rq emits one line per differing or only-in-one-tree file.
# We run it in non-strict mode (don't `set -e`) because diff returns 1 when
# differences exist.
RAW_DIFF=$(diff -rq "$SOURCE_ROOT/apps" "$DEPLOY_ROOT/apps" 2>/dev/null || true)

# Filter: only keep paths that look like source code AND are not in the
# allowlist of expected drift (build artifacts, deps, env, generated files).
#
# Allowlist patterns (regex, anchored on the path component portion):
#   .next/...           — build output, expected to differ
#   node_modules/...    — deps, expected to differ
#   __pycache__/...     — compiled python
#   *.env, *.env.*      — environment files
#   dist/, coverage/    — build/test artifacts
#   build-info.json     — generated per-build
#   bot-tools-manifest.json — generated per-deploy
#   *.log, *.lock, *.tsbuildinfo
#   .git/, .turbo/, .cache/, .vercel/  — tooling caches
#
# Source code extensions we care about: ts, tsx, js, jsx, mjs, cjs, py, sh,
# json (config), yaml, yml, toml, md (rules/docs).

DRIFTED_FILES=()
DRIFTED_RAW_LINES=()
while IFS= read -r line; do
    [ -z "$line" ] && continue
    # diff lines come in two shapes:
    #   "Files A and B differ"
    #   "Only in DIR: NAME"
    # Extract the relative path under apps/ for filtering.
    rel_path=""
    if [[ "$line" =~ ^Files\ ${SOURCE_ROOT}/apps/(.+)\ and\ ${DEPLOY_ROOT}/apps/.+\ differ$ ]]; then
        rel_path="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^Only\ in\ ${SOURCE_ROOT}/apps/?(.*):\ (.+)$ ]]; then
        sub="${BASH_REMATCH[1]}"
        name="${BASH_REMATCH[2]}"
        if [ -n "$sub" ]; then rel_path="${sub}/${name}"; else rel_path="${name}"; fi
    elif [[ "$line" =~ ^Only\ in\ ${DEPLOY_ROOT}/apps/?(.*):\ (.+)$ ]]; then
        sub="${BASH_REMATCH[1]}"
        name="${BASH_REMATCH[2]}"
        if [ -n "$sub" ]; then rel_path="${sub}/${name}"; else rel_path="${name}"; fi
    else
        # Unknown diff line format; keep as raw drift signal but skip filter.
        continue
    fi

    # Allowlist: skip these path segments / extensions.
    case "$rel_path" in
        */.next/*|.next/*|*/.next|.next) continue ;;
        */node_modules/*|node_modules/*|*/node_modules|node_modules) continue ;;
        */__pycache__/*|__pycache__/*|*/__pycache__|__pycache__) continue ;;
        */dist/*|dist/*|*/dist|dist) continue ;;
        */coverage/*|coverage/*|*/coverage|coverage) continue ;;
        */.turbo/*|.turbo/*|*/.cache/*|.cache/*) continue ;;
        */.vercel/*|.vercel/*|*/.git/*|.git/*) continue ;;
        */.venv/*|.venv/*|*/venv/*|venv/*) continue ;;
        *.env|*.env.*|*/.env|*/.env.*) continue ;;
        *build-info.json|*/build-info.json) continue ;;
        *bot-tools-manifest.json|*/bot-tools-manifest.json) continue ;;
        *.log|*.lock|*.tsbuildinfo|*.pyc) continue ;;
        *.map|*.d.ts.map|*.js.map) continue ;;
        # Pearl runtime artifacts written by the live deploy. These are
        # legitimately deploy-side and never need to flow back to source.
        */journal_entries/*|journal_entries/*) continue ;;
        */pearl/memory/*|pearl/memory/*) continue ;;
        */pearl_emails/*|pearl_emails/*) continue ;;
        */conversation_logs/*|conversation_logs/*) continue ;;
        */screenshots*/*|screenshots*/*) continue ;;
    esac

    # Whitelist: only flag known source extensions.
    case "$rel_path" in
        *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.sh|*.json|*.yaml|*.yml|*.toml|*.md)
            DRIFTED_FILES+=("$rel_path")
            DRIFTED_RAW_LINES+=("$line")
            ;;
        *)
            # Files without a recognized extension (or "Only in" directory
            # entries pointing to a folder) are skipped to keep noise low.
            ;;
    esac
done <<< "$RAW_DIFF"

DRIFT_COUNT=${#DRIFTED_FILES[@]}
log "drift-check: ${DRIFT_COUNT} drifted code file(s)"

if [ "$DRIFT_COUNT" -eq 0 ]; then
    echo "no drift"
    exit 0
fi

# Print a report to stdout (also captured into the cron log).
echo "=== Source/deploy drift detected (${DRIFT_COUNT} files) ==="
for f in "${DRIFTED_FILES[@]}"; do
    echo "  $f"
done
echo "============================================================"

# Build the Discord message: list the first 5 files.
preview=""
i=0
for f in "${DRIFTED_FILES[@]}"; do
    preview="${preview}\n  • ${f}"
    i=$((i + 1))
    if [ "$i" -ge 5 ]; then break; fi
done
extra=""
if [ "$DRIFT_COUNT" -gt 5 ]; then
    extra=$'\n  • ... and '"$((DRIFT_COUNT - 5))"' more'
fi

# Fingerprint the drift set so we don't spam the same alert every 30 min.
fingerprint=$(printf '%s\n' "${DRIFTED_FILES[@]}" | sort -u | sha256sum | cut -d' ' -f1)
last_fingerprint=""
last_sent=0
if [ -r "$STATE_FILE" ]; then
    last_fingerprint=$(python3 -c "import json,sys; print(json.load(open('$STATE_FILE')).get('fingerprint',''))" 2>/dev/null || echo "")
    last_sent=$(python3 -c "import json,sys; print(json.load(open('$STATE_FILE')).get('sent_at',0))" 2>/dev/null || echo 0)
fi
now=$(date +%s)
should_alert=1
if [ "$fingerprint" = "$last_fingerprint" ] && [ $((now - last_sent)) -lt "$COOLDOWN_SECONDS" ]; then
    should_alert=0
    log "drift-check: same fingerprint as last alert ($((now - last_sent))s ago) — suppressing"
fi

if [ "$should_alert" = "1" ]; then
    msg=$'Pearl\'s Agency says: \xe2\x9a\xa0\xef\xb8\x8f Source/deploy drift detected on '"${DRIFT_COUNT}"$' file(s). The deploy at /opt/pearlos has diverged from the source at /workspace/nia-universal — that means an agent edited the deploy directly and the next rebuild will silently overwrite their work.'"${preview}${extra}"$'\nRun /opt/pearlos/scripts/sync-deploy-to-source.sh to pull deploy-only edits back to source before the next build.'
    send_discord "$msg"
    python3 -c "import json,sys; json.dump({'fingerprint':'$fingerprint','sent_at':$now,'count':$DRIFT_COUNT}, open('$STATE_FILE','w'))" 2>/dev/null || true
    log "drift-check: alert sent (fingerprint=${fingerprint:0:12}, count=${DRIFT_COUNT})"
fi

exit 1
