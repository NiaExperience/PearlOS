#!/usr/bin/env bash
# qa-release-gate.sh - PearlOS build/release workflow guard.
#
# This script is intentionally small and boring. It exists so Pearl and the
# Agency cannot treat the release workflow as a soft reminder.

set -euo pipefail

ROOT="/workspace/nia-universal"
PHASE="pre-build"
TARGET_ENV="staging"
CODENAME="${PEARLOS_BUILD_CODENAME:-}"
URL="${PEARLOS_URL:-https://134-209-76-227.sslip.io}"
REQUIRE_CODEX="0"

usage() {
  cat <<'USAGE'
Usage:
  scripts/qa-release-gate.sh [--phase pre-build|post-build] [--env staging|prod] [--codename NAME] [--url URL] [--require-codex]

The pre-build gate requires:
  - running from /workspace/nia-universal
  - an explicit build codename
  - docs/qa/BUILD_RELEASE_WORKFLOW.md present
  - prod preflight audit passing for current changes
  - PEARLOS_CODEX_VERIFIED=1 when --require-codex is passed

The post-build gate runs live build verification for staging.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      PHASE="${2:-}"
      shift 2
      ;;
    --env)
      TARGET_ENV="${2:-}"
      shift 2
      ;;
    --codename)
      CODENAME="${2:-}"
      shift 2
      ;;
    --url)
      URL="${2:-}"
      shift 2
      ;;
    --require-codex)
      REQUIRE_CODEX="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "qa-release-gate: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "qa-release-gate: FAIL - $*" >&2
  exit 1
}

pass() {
  echo "qa-release-gate: PASS - $*"
}

[[ "$PHASE" == "pre-build" || "$PHASE" == "post-build" ]] || fail "invalid phase '$PHASE'"
[[ "$TARGET_ENV" == "staging" || "$TARGET_ENV" == "prod" ]] || fail "invalid env '$TARGET_ENV'"

cd "$ROOT"

[[ "$(pwd -P)" == "$ROOT" ]] || fail "must run from $ROOT"
[[ -n "$CODENAME" ]] || fail "explicit build codename is required"
[[ -f docs/qa/BUILD_RELEASE_WORKFLOW.md ]] || fail "missing docs/qa/BUILD_RELEASE_WORKFLOW.md"
[[ -f docs/qa/BUG_TRACKER.md ]] || fail "missing docs/qa/BUG_TRACKER.md"
[[ -f docs/production-release-workflow.md ]] || fail "missing docs/production-release-workflow.md"

if [[ "$PHASE" == "pre-build" ]]; then
  if [[ "$REQUIRE_CODEX" == "1" && "${PEARLOS_CODEX_VERIFIED:-}" != "1" ]]; then
    fail "Codex verification required before build. Set PEARLOS_CODEX_VERIFIED=1 only after Codex has reviewed the fix and release plan."
  fi

  scripts/prod-preflight-audit.sh
  pass "pre-build workflow gate passed for $TARGET_ENV build '$CODENAME'"
  exit 0
fi

if [[ "$TARGET_ENV" == "staging" ]]; then
  scripts/verify-build.sh "$CODENAME" "$URL"
  pass "post-build verification passed for staging build '$CODENAME'"
else
  pass "prod post-build gate requires the production release workflow and live health verification"
fi
