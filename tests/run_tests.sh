#!/usr/bin/env bash
# PearlOS Test Suite Runner
set -euo pipefail
cd "$(dirname "$0")"

echo "═══════════════════════════════════════════"
echo "  PearlOS Test Suite"
echo "═══════════════════════════════════════════"
echo ""

# Source Daily API key from bot .env so voice tests run
BOT_ENV="$(dirname "$0")/../apps/pipecat-daily-bot/.env"
if [ -f "$BOT_ENV" ]; then
    DAILY_KEY=$(grep '^DAILY_API_KEY' "$BOT_ENV" | head -1 | sed "s/^DAILY_API_KEY=['\"]\\?\\([^'\"]*\\)['\"]\\?/\\1/")
    [ -n "$DAILY_KEY" ] && export DAILY_API_KEY="$DAILY_KEY"
fi

FAILED=0
PASSED=0

run_suite() {
    local name="$1"
    local path="$2"
    echo "▶ Running: $name"
    if python3 -m pytest "$path" -v --tb=short 2>&1 | tee /tmp/pearlos_test_${name}.log; then
        PASSED=$((PASSED + 1))
        echo "  ✅ $name PASSED"
    else
        FAILED=$((FAILED + 1))
        echo "  ❌ $name FAILED"
    fi
    echo ""
}

# Run each suite
run_suite "api_health" "api/test_health.py"
run_suite "notes_crud" "smoke/test_notes_crud.py"
run_suite "settings" "smoke/test_settings.py"
run_suite "voice" "smoke/test_voice.py"
run_suite "visual_regression" "visual/test_visual_regression.py"

echo "═══════════════════════════════════════════"
echo "  Summary: $PASSED passed, $FAILED failed"
echo "═══════════════════════════════════════════"

exit $FAILED
