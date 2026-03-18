#!/usr/bin/env bash
# PearlOS QA Smoke Test — prevents regressions by checking critical paths
# Usage: ./scripts/qa-smoke-test.sh
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

pass() { echo -e "  ${GREEN}PASS${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; ((WARN++)); }

echo "═══════════════════════════════════════════"
echo " PearlOS QA Smoke Test"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. Service Health ─────────────────────────────────────────────
echo "1. Service Health"
for svc in "Next.js:3000" "Bot:4444" "OpenClaw:18789" "PocketTTS:8766"; do
  name="${svc%%:*}"; port="${svc##*:}"
  if curl -sf -o /dev/null --max-time 3 "http://localhost:${port}" 2>/dev/null || \
     curl -sf -o /dev/null --max-time 3 "http://localhost:${port}/health" 2>/dev/null; then
    pass "$name (:$port)"
  else
    fail "$name (:$port) — not responding"
  fi
done
echo ""

# ── 2. Tool Registration ─────────────────────────────────────────
echo "2. Tool Registration"
TOOLS=$(curl -sf --max-time 5 "http://localhost:4444/api/tools/list" 2>/dev/null || echo "")
if [ -z "$TOOLS" ]; then
  fail "Cannot reach /api/tools/list"
else
  for tool in bot_wonder_canvas_scene bot_wonder_canvas_template bot_wonder_canvas_clear \
              bot_wonder_canvas_add bot_wonder_canvas_animate bot_wonder_canvas_avatar_hint \
              bot_canvas_show bot_think_deeply bot_openclaw_task; do
    if echo "$TOOLS" | grep -q "\"$tool\""; then
      pass "$tool registered"
    else
      fail "$tool NOT registered"
    fi
  done
fi
echo ""

# ── 3. Model Name Validation ─────────────────────────────────────
echo "3. Model Configuration"
ENV_FILE="$(dirname "$0")/../apps/pipecat-daily-bot/.env"
if [ -f "$ENV_FILE" ]; then
  FAST_URL=$(grep -E '^BOT_FAST_API_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || echo "")
  FAST_MODEL=$(grep -E '^BOT_FAST_MODEL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || echo "")
  FAST_KEY=$(grep -E '^BOT_FAST_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || echo "")

  # Check: no anthropic/ prefix when using api.anthropic.com
  if echo "$FAST_URL" | grep -q "api.anthropic.com"; then
    if echo "$FAST_MODEL" | grep -q "^anthropic/"; then
      fail "BOT_FAST_MODEL has 'anthropic/' prefix with direct Anthropic API (will fail)"
    else
      pass "Model name clean for direct Anthropic API: $FAST_MODEL"
    fi
  else
    pass "Model config OK (non-Anthropic provider): $FAST_MODEL"
  fi

  # Check: OAuth token format
  if echo "$FAST_KEY" | grep -q "^sk-ant-oat"; then
    pass "OAuth token detected (sk-ant-oat*)"
    # Verify the code handles Bearer auth (not x-api-key)
    if grep -q "sk-ant-oat" "$(dirname "$0")/../apps/pipecat-daily-bot/bot/processors/non_blocking_router.py" 2>/dev/null; then
      pass "NonBlockingRouter handles OAuth token format"
    else
      fail "NonBlockingRouter may not handle OAuth token format"
    fi
  elif echo "$FAST_KEY" | grep -q "^sk-ant-api"; then
    pass "Standard API key detected"
  elif [ -n "$FAST_KEY" ]; then
    pass "API key present (format: ${FAST_KEY:0:10}...)"
  else
    fail "No BOT_FAST_API_KEY set"
  fi
else
  warn "Bot .env file not found at $ENV_FILE"
fi
echo ""

# ── 4. Auth Format ────────────────────────────────────────────────
echo "4. Auth Headers"
if [ -f "$ENV_FILE" ]; then
  if echo "$FAST_URL" | grep -q "api.anthropic.com" && echo "$FAST_KEY" | grep -q "^sk-ant-oat"; then
    # Verify the router uses Bearer + anthropic-beta header
    ROUTER="$(dirname "$0")/../apps/pipecat-daily-bot/bot/processors/non_blocking_router.py"
    if grep -q "anthropic-beta.*oauth-2025-04-20" "$ROUTER" 2>/dev/null; then
      pass "OAuth anthropic-beta header present in router"
    else
      fail "Missing anthropic-beta header for OAuth"
    fi
    if grep -q 'Bearer.*_fast_api_key' "$ROUTER" 2>/dev/null; then
      pass "Bearer auth used for OAuth tokens"
    else
      fail "Missing Bearer auth for OAuth tokens"
    fi
  else
    pass "Auth format N/A (not using Anthropic OAuth)"
  fi
fi
echo ""

# ── 5. Wonder Canvas Round-Trip ──────────────────────────────────
echo "5. Wonder Canvas Round-Trip (Phase 2 via OpenClaw)"
# We can't do a full voice round-trip in a script, but we can verify
# the tool execution endpoint works
TOOL_TEST=$(curl -sf --max-time 10 -X POST "http://localhost:4444/api/tools/test" \
  -H "Content-Type: application/json" \
  -d '{"tool":"bot_wonder_canvas_template","params":{"template":"fact_card","data":{"title":"QA Test","fact_text":"Smoke test","category":"Test"}}}' 2>/dev/null || echo "NO_ENDPOINT")
if echo "$TOOL_TEST" | grep -q "success"; then
  pass "Wonder Canvas tool execution works"
elif [ "$TOOL_TEST" = "NO_ENDPOINT" ]; then
  warn "No /api/tools/test endpoint — cannot verify round-trip (non-blocking)"
else
  warn "Tool test returned: ${TOOL_TEST:0:100}"
fi
echo ""

# ── 6. Frontend Build ────────────────────────────────────────────
echo "6. Frontend Status"
NEXT_RESP=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:3000/pearlos" 2>/dev/null || echo "000")
if [ "$NEXT_RESP" = "200" ]; then
  pass "Next.js serving /pearlos (HTTP 200)"
elif [ "$NEXT_RESP" = "000" ]; then
  fail "Next.js not responding on :3000"
else
  warn "Next.js returned HTTP $NEXT_RESP on /pearlos"
fi

# Check if wonder canvas runtime is serving
WC_RESP=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:3000/api/wonder-canvas-runtime" 2>/dev/null || echo "000")
if [ "$WC_RESP" = "200" ]; then
  pass "Wonder Canvas runtime serving (HTTP 200)"
else
  fail "Wonder Canvas runtime not serving (HTTP $WC_RESP)"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────
echo "═══════════════════════════════════════════"
echo -e " Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${WARN} warnings${NC}"
echo "═══════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo -e " ${RED}⚠ SMOKE TEST FAILED${NC}"
  exit 1
else
  echo -e " ${GREEN}✓ ALL CHECKS PASSED${NC}"
  exit 0
fi
