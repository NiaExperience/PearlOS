#!/usr/bin/env bash
# verify-build.sh — Post-deploy build verifier
#
# Confirms that the live URL is serving the build we just deployed, NOT a
# stale HTML shell or stale JS chunk left over in Cloudflare or browser
# caches. Implements Stage 8.5 of the Agency Orchestration Playbook.
#
# Usage:
#   verify-build.sh <EXPECTED_CODENAME> [URL]
#
# Defaults:
#   LOCAL_INTERFACE_DIR = /workspace/nia-universal/apps/interface
#   URL = latest detected Cloudflare quick tunnel, or fallback staging URL
#
# Exit codes:
#   0 — verified: live build matches expected codename
#   1 — mismatch: live build is stale or wrong
#   2 — endpoint unreachable / malformed response
#   3 — usage error
#
# Implements three independent checks. All three must pass to call the
# build verified.
#   A) /api/health/build returns JSON with codename == expected
#   B) /api/health/build commit hash matches local .next/BUILD_ID
#   C) the built JS chunks on disk contain the expected codename and no known
#      deprecated codename markers.
#
# Each request is sent with cache-busting query params and headers. The
# verifier never trusts a single check — Cloudflare can serve a stale
# HTML shell that nonetheless points at fresh JS chunks (or vice versa),
# so the verifier proves both layers are coherent.

set -euo pipefail

EXPECTED="${1:-}"
URL="${2:-}"

if [ -z "$EXPECTED" ]; then
    echo "usage: verify-build.sh <EXPECTED_CODENAME> [URL]" >&2
    exit 3
fi

# Auto-discover the current quick-tunnel URL when one was not supplied.
# Cloudflare quick tunnels rotate hostnames every restart, so any hardcoded
# URL goes stale silently — exactly the failure mode this stage exists to
# catch. Prefer: explicit arg → PEARLOS_URL env → most recent destination
# the cloudflared-3000 sidecar has been routing traffic to → fallback.
if [ -z "$URL" ]; then
    if [ -n "${PEARLOS_URL:-}" ]; then
        URL="$PEARLOS_URL"
    elif [ -f /tmp/cloudflared-3000.log ]; then
        DETECTED=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared-3000.log 2>/dev/null \
            | tail -1 || true)
        if [ -n "$DETECTED" ]; then
            URL="$DETECTED"
            echo "[verify-build] auto-detected tunnel: $URL" >&2
        fi
    fi
    if [ -z "$URL" ]; then
        URL="https://134-209-76-227.sslip.io"
        echo "[verify-build] WARN — falling back to hardcoded URL $URL" >&2
    fi
fi

LOCAL_INTERFACE_DIR="${LOCAL_INTERFACE_DIR:-/workspace/nia-universal/apps/interface}"

# Local commit hash that this deploy claims to have shipped. Used to
# cross-check that the manifest endpoint reports the same SHA. Prefer the
# compiled TypeScript build stamp over the compatibility JSON file.
LOCAL_COMMIT=""
if [ -f "$LOCAL_INTERFACE_DIR/src/build-stamp.ts" ]; then
    LOCAL_COMMIT=$(sed -n 's/^  commitSha: "\(.*\)",$/\1/p' "$LOCAL_INTERFACE_DIR/src/build-stamp.ts" | head -1)
elif [ -f "$LOCAL_INTERFACE_DIR/src/build-info.json" ]; then
    LOCAL_COMMIT=$(jq -r .buildId "$LOCAL_INTERFACE_DIR/src/build-info.json" 2>/dev/null || echo "")
fi
LOCAL_BUILD_ID=""
if [ -f "$LOCAL_INTERFACE_DIR/.next/BUILD_ID" ]; then
    LOCAL_BUILD_ID=$(cat "$LOCAL_INTERFACE_DIR/.next/BUILD_ID")
else
    LOCAL_BUILD_ID=$(find "$LOCAL_INTERFACE_DIR/.next/static" -maxdepth 1 -type d -name 'build-*' -printf '%f\n' 2>/dev/null | sort | tail -1 || true)
fi

CB="$(date +%s%N)"
CURL_OPTS=(
    --silent
    --show-error
    --max-time 15
    --header "Cache-Control: no-cache"
    --header "Pragma: no-cache"
    --header "X-Build-Verifier: pearlos"
)

echo "── Build verification ──"
echo "  Expected codename : $EXPECTED"
echo "  Target URL        : $URL"
echo "  Local app dir     : $LOCAL_INTERFACE_DIR"
echo "  Local commit      : ${LOCAL_COMMIT:-(no build-info.json)}"
echo "  Local BUILD_ID    : ${LOCAL_BUILD_ID:-(no .next/BUILD_ID)}"
echo

# ─── Check A: manifest endpoint codename ─────────────────────────────────
echo "[A] GET $URL/api/health/build?cb=$CB"
MANIFEST_JSON=$(curl "${CURL_OPTS[@]}" "$URL/api/health/build?cb=$CB" || true)
if [ -z "$MANIFEST_JSON" ]; then
    echo "    FAIL — endpoint returned empty body" >&2
    exit 2
fi

REMOTE_CODENAME=$(echo "$MANIFEST_JSON" | jq -r '.codename // empty' 2>/dev/null || true)
REMOTE_COMMIT=$(echo "$MANIFEST_JSON" | jq -r '.commitSha // empty' 2>/dev/null || true)
REMOTE_BUILD_ID=$(echo "$MANIFEST_JSON" | jq -r '.nextBuildId // empty' 2>/dev/null || true)

if [ -z "$REMOTE_CODENAME" ]; then
    echo "    FAIL — manifest JSON malformed: $MANIFEST_JSON" >&2
    exit 2
fi
echo "    Remote codename  : $REMOTE_CODENAME"
echo "    Remote commit    : $REMOTE_COMMIT"
echo "    Remote BUILD_ID  : $REMOTE_BUILD_ID"

if [ "$REMOTE_CODENAME" != "$EXPECTED" ]; then
    echo "    FAIL — codename mismatch (remote=$REMOTE_CODENAME, expected=$EXPECTED)" >&2
    echo "    The live deploy is stale OR the new build was never restarted." >&2
    exit 1
fi
echo "    PASS"
echo

# ─── Check B: commit hash matches local ──────────────────────────────────
echo "[B] cross-check commit hash"
if [ -n "$LOCAL_COMMIT" ] && [ -n "$REMOTE_COMMIT" ] && [ "$LOCAL_COMMIT" != "unknown" ]; then
    if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
        echo "    FAIL — commit mismatch (local=$LOCAL_COMMIT, remote=$REMOTE_COMMIT)" >&2
        echo "    The Next.js process is running an older build than the one on disk." >&2
        exit 1
    fi
    echo "    PASS — both report $LOCAL_COMMIT"
elif [ -n "$LOCAL_BUILD_ID" ] && [ -n "$REMOTE_BUILD_ID" ]; then
    if [ "$LOCAL_BUILD_ID" != "$REMOTE_BUILD_ID" ]; then
        echo "    FAIL — BUILD_ID mismatch (local=$LOCAL_BUILD_ID, remote=$REMOTE_BUILD_ID)" >&2
        exit 1
    fi
    echo "    PASS — both report BUILD_ID $LOCAL_BUILD_ID"
else
    echo "    SKIP — no local commit/BUILD_ID to cross-check"
fi
echo

# ─── Check C-pre: deployed JS bundle on disk contains the codename ───────
# This is a fast local sanity check before the public HTTP scan: it proves
# the build process correctly baked the keyword into the chunks that were
# deployed. If this fails, the build is wrong regardless of cache state.
echo "[C-pre] grep built server/chunks on disk"
DEPLOYED_CHUNKS_DIR="$LOCAL_INTERFACE_DIR/.next/static/chunks"
DEPLOYED_SERVER_DIR="$LOCAL_INTERFACE_DIR/.next/server"
DEPLOYED_SCAN_DIRS=()
[ -d "$DEPLOYED_CHUNKS_DIR" ] && DEPLOYED_SCAN_DIRS+=("$DEPLOYED_CHUNKS_DIR")
[ -d "$DEPLOYED_SERVER_DIR" ] && DEPLOYED_SCAN_DIRS+=("$DEPLOYED_SERVER_DIR")
LOCAL_MATCH_CHUNK=""
if [ "${#DEPLOYED_SCAN_DIRS[@]}" -gt 0 ]; then
    if grep -rq "$EXPECTED" "${DEPLOYED_SCAN_DIRS[@]}" 2>/dev/null; then
        MATCH_FILE=$(grep -rl "$EXPECTED" "${DEPLOYED_SCAN_DIRS[@]}" 2>/dev/null | head -1)
        LOCAL_MATCH_CHUNK="${MATCH_FILE#"$LOCAL_INTERFACE_DIR/.next/static"}"
        echo "    PASS — keyword in $MATCH_FILE"
    else
        echo "    FAIL — keyword '$EXPECTED' not present in deployed chunks." >&2
        echo "    The build artifact does not contain the codename." >&2
        echo "    Did PEARLOS_BUILD_CODENAME get omitted or did the wrong tree build?" >&2
        exit 1
    fi
else
    echo "    SKIP — no built server/chunk dirs found"
fi
echo

echo "[C-stale] grep built server/chunks for deprecated codenames"
STALE_NAMES=("LAKE GLIMMER" "LOCAL UNNAMED BUILD")
for stale in "${STALE_NAMES[@]}"; do
    if [ "$stale" != "$EXPECTED" ] && [ "${#DEPLOYED_SCAN_DIRS[@]}" -gt 0 ] && grep -rq "$stale" "${DEPLOYED_SCAN_DIRS[@]}" 2>/dev/null; then
        MATCH_FILE=$(grep -rl "$stale" "${DEPLOYED_SCAN_DIRS[@]}" 2>/dev/null | head -1)
        echo "    FAIL — deprecated codename '$stale' still present in $MATCH_FILE" >&2
        exit 1
    fi
done
echo "    PASS — no deprecated codename markers found"
echo

# ─── Check C: HTML shell inlines or links the codename ───────────────────
echo "[C] HTML shell scan for keyword"
SHELL_PATH="/login"
HTML=$(curl "${CURL_OPTS[@]}" "$URL$SHELL_PATH?cb=$CB" || true)
if [ -z "$HTML" ]; then
    echo "    FAIL — could not fetch $URL$SHELL_PATH" >&2
    exit 2
fi

# The codename ships into the bundle via SettingsPanels.tsx. The login
# shell does not import that component, so we follow the chunk graph: pull
# every /_next/static/chunks/*.js URL out of the HTML, fetch each, and
# grep for the keyword. One match anywhere is sufficient.
mapfile -t CHUNKS < <(echo "$HTML" | grep -oE '/_next/static/chunks/[a-zA-Z0-9_./-]+\.js' | sort -u)
echo "    found ${#CHUNKS[@]} JS chunks linked from $SHELL_PATH"

FOUND=0
# First, scan the HTML itself in case the keyword inlined.
if echo "$HTML" | grep -q "$EXPECTED"; then
    echo "    PASS — keyword '$EXPECTED' found inline in HTML"
    FOUND=1
fi

if [ "$FOUND" -eq 0 ]; then
    for chunk in "${CHUNKS[@]}"; do
        BODY=$(curl "${CURL_OPTS[@]}" "$URL$chunk?cb=$CB" || true)
        if [ -n "$BODY" ] && echo "$BODY" | grep -q "$EXPECTED"; then
            echo "    PASS — keyword '$EXPECTED' found in $chunk"
            FOUND=1
            break
        fi
    done
fi

if [ "$FOUND" -eq 0 ]; then
    # Fallback: hit the settings panel directly. The shell at /login is
    # a small bundle and may not transitively load SettingsPanels at all.
    echo "    not found via /login chunk graph, trying /settings"
    HTML2=$(curl "${CURL_OPTS[@]}" "$URL/settings?cb=$CB" || true)
    if echo "$HTML2" | grep -q "$EXPECTED"; then
        echo "    PASS — keyword found inline at /settings"
        FOUND=1
    else
        mapfile -t CHUNKS2 < <(echo "$HTML2" | grep -oE '/_next/static/chunks/[a-zA-Z0-9_./-]+\.js' | sort -u)
        for chunk in "${CHUNKS2[@]}"; do
            BODY=$(curl "${CURL_OPTS[@]}" "$URL$chunk?cb=$CB" || true)
            if [ -n "$BODY" ] && echo "$BODY" | grep -q "$EXPECTED"; then
                echo "    PASS — keyword '$EXPECTED' found in $chunk (via /settings)"
                FOUND=1
                break
            fi
        done
    fi
fi

if [ "$FOUND" -eq 0 ] && [ -n "$LOCAL_MATCH_CHUNK" ]; then
    echo "    not found via route chunk graph, trying local matching chunk $LOCAL_MATCH_CHUNK"
    BODY=$(curl "${CURL_OPTS[@]}" "$URL/_next/static$LOCAL_MATCH_CHUNK?cb=$CB" || true)
    if [ -n "$BODY" ] && echo "$BODY" | grep -q "$EXPECTED"; then
        echo "    PASS — keyword '$EXPECTED' found in /_next/static$LOCAL_MATCH_CHUNK"
        FOUND=1
    fi
fi

if [ "$FOUND" -eq 0 ]; then
    echo "    FAIL — keyword not found in scanned chunks." >&2
    echo "    Manifest agreed but HTML/JS bundle did not contain the keyword." >&2
    echo "    Possible causes: chunk graph did not load SettingsPanels, OR" >&2
    echo "    Cloudflare is still holding an older JS chunk for this path." >&2
    exit 1
fi
echo

echo "── verified: $EXPECTED is live at $URL ──"
exit 0
