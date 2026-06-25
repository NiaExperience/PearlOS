#!/usr/bin/env bash
# Sync Pearl's identity files from source of truth to OpenClaw workspace
# and staging deploy. Run this after updating any identity file in
# /workspace/nia-universal/ to ensure Pearl loads the real files.
#
# Root cause: OpenClaw initializes workspaces with generic templates.
# If those templates aren't replaced, Pearl loads blank identity and
# has complete amnesia (can't remember Blair, Neala, team, or anything).

set -euo pipefail

SOURCE="/workspace/nia-universal"
OPENCLAW_WS="/home/deploy/.openclaw/workspace"
STAGING="/home/deploy/pearlos"

IDENTITY_FILES=(
    SOUL.md
    IDENTITY.md
    USER.md
    USER_FACTS.md
    MEMORY.md
    AGENTS.md
)

echo "Syncing Pearl identity files from source → workspace + staging..."

for f in "${IDENTITY_FILES[@]}"; do
    if [ -f "$SOURCE/$f" ]; then
        cp "$SOURCE/$f" "$OPENCLAW_WS/$f" 2>/dev/null && echo "  ✓ $OPENCLAW_WS/$f"
        cp "$SOURCE/$f" "$STAGING/$f" 2>/dev/null && echo "  ✓ $STAGING/$f"
    else
        echo "  ⚠ $SOURCE/$f not found, skipping"
    fi
done

echo ""
echo "Verification:"
grep -l "Neala" "$OPENCLAW_WS/USER.md" "$STAGING/USER.md" 2>/dev/null && echo "  ✓ Neala present in USER.md at both targets" || echo "  ✗ Neala NOT found in synced USER.md"
echo "Done."
