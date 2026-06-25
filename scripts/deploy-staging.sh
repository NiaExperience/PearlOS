#!/usr/bin/env bash
# deploy-staging.sh — Single source of truth deployment
# ALWAYS deploys and serves from /workspace/nia-universal (GOLDEN-POND on current DO staging)
# NEVER builds from or copies into /opt/pearlos source
set -euo pipefail

SOURCE="/workspace/nia-universal"
INTERFACE_DIR="$SOURCE/apps/interface"
BRANCH="${PEARLOS_STAGING_BRANCH:-GOLDEN-POND}"
LOG="/tmp/deploy-staging.log"
STAGING_URL="${PEARLOS_URL:-https://134-209-76-227.sslip.io}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"; }

# Verify we're on the right branch
CURRENT_BRANCH=$(cd "$SOURCE" && git branch --show-current)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    log "ERROR: Source is on '$CURRENT_BRANCH' not '$BRANCH'. Aborting."
    exit 1
fi

COMMIT=$(cd "$SOURCE" && git rev-parse --short HEAD)
log "Deploying $BRANCH @ $COMMIT"

EXPECTED_CODENAME="${PEARLOS_BUILD_CODENAME:-${1:-}}"
if [ -z "$EXPECTED_CODENAME" ]; then
    log "ERROR: Set PEARLOS_BUILD_CODENAME or pass the codename as the first argument."
    log "Example: PEARLOS_BUILD_CODENAME='GOLDEN POND' scripts/deploy-staging.sh"
    exit 1
fi
export PEARLOS_BUILD_CODENAME="$EXPECTED_CODENAME"
export PEARLOS_BUILD_ID="$COMMIT"
log "Expected codename: $EXPECTED_CODENAME"

# PearlOS QA release gate. This forces the "Pearl connects to Codex before
# building" rule into the staging build path instead of leaving it as policy
# prose. Codex or the operator sets PEARLOS_CODEX_VERIFIED=1 only after a
# release-plan verification pass.
"$SOURCE/scripts/qa-release-gate.sh" \
    --phase pre-build \
    --env staging \
    --codename "$EXPECTED_CODENAME" \
    --require-codex

# Check for uncommitted changes
if [ -n "$(cd "$SOURCE" && git status --porcelain)" ]; then
    log "WARNING: Uncommitted changes in workspace. Commit first for clean deploy."
    echo "Uncommitted files:"
    cd "$SOURCE" && git status --short | head -10
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Aborted by user."
        exit 1
    fi
fi

# Build
log "Building interface..."
cd "$SOURCE"
exec 200>/tmp/nextjs-build.lock
flock -n 200 || { log "ERROR: Another build is running"; exit 1; }
npm run build --workspace=interface 2>&1 | tail -20

# Verify build succeeded. Next may write either .next/BUILD_ID or a static
# build directory named build-<commit>-<timestamp>, depending the build mode.
if [ -f "apps/interface/.next/BUILD_ID" ]; then
    BUILD_ID=$(cat apps/interface/.next/BUILD_ID)
else
    BUILD_ID=$(find apps/interface/.next/static -maxdepth 1 -type d -name 'build-*' -printf '%f\n' 2>/dev/null | sort | tail -1 || true)
fi
if [ -z "${BUILD_ID:-}" ]; then
    log "ERROR: Build failed — no Next build marker found"
    exit 1
fi
log "Build successful: $BUILD_ID"

# Restart from the canonical source tree. If PM2 still points at an old
# copied runtime tree, recreate the process with the correct cwd.
log "Starting interface from $INTERFACE_DIR..."
CURRENT_CWD=$(su - deploy -c "pm2 describe interface --no-color" 2>/dev/null | awk -F '│' '/exec cwd/ {gsub(/^ +| +$/, "", $3); print $3; exit}' || true)
if [ "$CURRENT_CWD" = "$INTERFACE_DIR" ]; then
    su - deploy -c "pm2 restart interface --update-env"
else
    log "PM2 interface cwd was '${CURRENT_CWD:-unknown}', recreating from canonical source"
    su - deploy -c "pm2 delete interface >/dev/null 2>&1 || true"
    su - deploy -c "cd '$INTERFACE_DIR' && pm2 start npm --name interface -- start"
fi
su - deploy -c "pm2 save"
sleep 5

# Verify — local liveness
STATUS=$(curl -sI http://localhost:3000/login | head -1)
log "Interface status: $STATUS"

if echo "$STATUS" | grep -q "200"; then
    log "✅ Local interface is up: $BRANCH @ $COMMIT (build: $BUILD_ID)"
else
    log "❌ Deploy may have failed — interface not returning 200"
    exit 1
fi

# Stage 8.5 — Build verification through the public URL.
# Pulls the expected codename from the generated TypeScript build stamp. Fails
# if it cannot determine a codename; skipping live verification is how stale
# builds slipped through.
BUILT_CODENAME=$(sed -n 's/^  codename: "\(.*\)",$/\1/p' "$SOURCE/apps/interface/src/build-stamp.ts" | head -1)
if [ "$BUILT_CODENAME" != "$EXPECTED_CODENAME" ]; then
    log "ERROR — generated build stamp codename '$BUILT_CODENAME' does not match expected '$EXPECTED_CODENAME'"
    exit 1
fi
if [ -z "$BUILT_CODENAME" ]; then
    log "ERROR — could not determine expected build codename; refusing to skip live verification"
    exit 1
else
    PUBLIC_URL="$STAGING_URL"
    log "Verifying live build: expecting codename '$EXPECTED_CODENAME' at $PUBLIC_URL"
    # Brief settle window for the new process before hitting the tunnel.
    sleep 3
    if "$SOURCE/scripts/verify-build.sh" "$EXPECTED_CODENAME" "$PUBLIC_URL" 2>&1 | tee -a "$LOG"; then
        log "✅ Build verified live: $EXPECTED_CODENAME @ $COMMIT"
    else
        log "❌ Live build verification FAILED — cache likely stale or restart did not take"
        exit 1
    fi
fi

echo ""
echo "Deployed: $BRANCH @ $COMMIT"
echo "Build ID: $BUILD_ID"
echo "Codename: ${EXPECTED_CODENAME:-(unparsed)}"
