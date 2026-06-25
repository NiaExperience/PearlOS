#!/usr/bin/env bash
# sync-deploy-to-source.sh — Pull deploy-only edits back to source.
#
# Use this when /opt/pearlos has been edited directly (against the rules)
# and you need to recover those edits to /workspace/nia-universal BEFORE
# the next rebuild silently overwrites them.
#
# Reads the same drift list as source-deploy-drift-check.sh, prompts for
# confirmation, then copies each drifted code file from /opt/pearlos into
# /workspace/nia-universal at the matching path.
#
# This is NOT auto-run. It's a manual fallback after drift is detected.
#
# Usage:
#   /opt/pearlos/scripts/sync-deploy-to-source.sh           # interactive
#   /opt/pearlos/scripts/sync-deploy-to-source.sh --dry-run # show plan only
#   /opt/pearlos/scripts/sync-deploy-to-source.sh --yes     # skip prompt
#
# Exit codes:
#   0  success (or no drift)
#   1  user declined / nothing to do
#   2  precondition failure

set -uo pipefail

SOURCE_ROOT="/workspace/nia-universal"
DEPLOY_ROOT="/opt/pearlos"

DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        --dry-run|-n) DRY_RUN=1 ;;
        --yes|-y)     ASSUME_YES=1 ;;
        --help|-h)
            sed -n '2,21p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown arg: $arg" >&2
            exit 2
            ;;
    esac
done

if [ ! -d "$SOURCE_ROOT/apps" ] || [ ! -d "$DEPLOY_ROOT/apps" ]; then
    echo "FAIL: missing $SOURCE_ROOT/apps or $DEPLOY_ROOT/apps" >&2
    exit 2
fi

echo "Computing drift between source and deploy..."
RAW_DIFF=$(diff -rq "$SOURCE_ROOT/apps" "$DEPLOY_ROOT/apps" 2>/dev/null || true)

DRIFTED_FILES=()
while IFS= read -r line; do
    [ -z "$line" ] && continue
    rel_path=""
    deploy_only=0
    if [[ "$line" =~ ^Files\ ${SOURCE_ROOT}/apps/(.+)\ and\ ${DEPLOY_ROOT}/apps/.+\ differ$ ]]; then
        rel_path="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^Only\ in\ ${SOURCE_ROOT}/apps/?(.*):\ (.+)$ ]]; then
        # Source has a file deploy doesn't. Don't sync (deploy is missing it).
        # We skip these — source-only files are not "deploy-side edits".
        continue
    elif [[ "$line" =~ ^Only\ in\ ${DEPLOY_ROOT}/apps/?(.*):\ (.+)$ ]]; then
        sub="${BASH_REMATCH[1]}"
        name="${BASH_REMATCH[2]}"
        if [ -n "$sub" ]; then rel_path="${sub}/${name}"; else rel_path="${name}"; fi
        deploy_only=1
    else
        continue
    fi

    # Same allowlist as the drift checker.
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
        */journal_entries/*|journal_entries/*) continue ;;
        */pearl/memory/*|pearl/memory/*) continue ;;
        */pearl_emails/*|pearl_emails/*) continue ;;
        */conversation_logs/*|conversation_logs/*) continue ;;
        */screenshots*/*|screenshots*/*) continue ;;
    esac

    case "$rel_path" in
        *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.sh|*.json|*.yaml|*.yml|*.toml|*.md)
            DRIFTED_FILES+=("$rel_path")
            ;;
    esac
done <<< "$RAW_DIFF"

DRIFT_COUNT=${#DRIFTED_FILES[@]}

if [ "$DRIFT_COUNT" -eq 0 ]; then
    echo "No drift. Nothing to sync."
    exit 0
fi

echo
echo "Plan: copy $DRIFT_COUNT file(s) from $DEPLOY_ROOT/apps -> $SOURCE_ROOT/apps"
echo "------------------------------------------------------------"
for f in "${DRIFTED_FILES[@]}"; do
    src="$DEPLOY_ROOT/apps/$f"
    dst="$SOURCE_ROOT/apps/$f"
    if [ -f "$src" ]; then
        if [ -f "$dst" ]; then
            tag="UPDATE"
        else
            tag="CREATE"
        fi
    else
        tag="SKIP (deploy file missing)"
    fi
    echo "  [${tag}] $f"
done
echo "------------------------------------------------------------"
echo

if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run — no files copied. Re-run without --dry-run to apply."
    exit 0
fi

if [ "$ASSUME_YES" != "1" ]; then
    # When stdin is a TTY, prompt. Otherwise refuse to proceed without --yes.
    if [ -t 0 ]; then
        read -r -p "Apply this sync? [y/N] " reply
        case "$reply" in
            y|Y|yes|YES) ;;
            *) echo "Aborted by user."; exit 1 ;;
        esac
    else
        echo "Non-interactive shell and --yes not given. Refusing to proceed." >&2
        echo "Re-run with --yes to confirm, or --dry-run to preview." >&2
        exit 1
    fi
fi

echo
echo "Applying sync..."
copied=0
skipped=0
for f in "${DRIFTED_FILES[@]}"; do
    src="$DEPLOY_ROOT/apps/$f"
    dst="$SOURCE_ROOT/apps/$f"
    if [ ! -f "$src" ]; then
        echo "  skip (missing in deploy): $f"
        skipped=$((skipped + 1))
        continue
    fi
    mkdir -p "$(dirname "$dst")"
    if cp -f "$src" "$dst"; then
        echo "  ok: $f"
        copied=$((copied + 1))
    else
        echo "  FAIL: $f" >&2
        skipped=$((skipped + 1))
    fi
done

echo
echo "Done. Copied $copied, skipped $skipped."
echo "Next steps:"
echo "  1. Review the changes in $SOURCE_ROOT (git diff or your editor)."
echo "  2. Build .next from source:"
echo "       cd $SOURCE_ROOT && npm run build --prefix apps/interface"
echo "  3. Sync the build to deploy:"
echo "       rsync -a --delete $SOURCE_ROOT/apps/interface/.next/ $DEPLOY_ROOT/apps/interface/.next/"
echo "  4. Restart whatever PM2 process owns the affected app."
echo "  5. Re-run /opt/pearlos/scripts/source-deploy-drift-check.sh to confirm clean."
