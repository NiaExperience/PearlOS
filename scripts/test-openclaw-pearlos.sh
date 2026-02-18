#!/bin/bash
# test-openclaw-pearlos.sh — Verify OpenClaw ↔ PearlOS tool bridge
#
# Run this to confirm the integration is working end-to-end.
# Requires: bot gateway running at localhost:4444, pearlos-tool installed.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "  ${YELLOW}→${NC} $1"; }

FAILURES=0

echo ""
echo "═══════════════════════════════════════════════════"
echo "  OpenClaw ↔ PearlOS Tool Bridge Integration Test"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── Test 1: Gateway Health ───────────────────────────
echo "Test 1: Bot Gateway Health"
HEALTH=$(curl -s http://localhost:4444/health 2>/dev/null)
if echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'" 2>/dev/null; then
    pass "Bot gateway is healthy"
else
    fail "Bot gateway is DOWN or unhealthy: $HEALTH"
    echo ""
    echo "  Cannot continue without bot gateway. Start it first:"
    echo "  cd apps/pipecat-daily-bot && python bot/bot_gateway.py"
    exit 1
fi

# ─── Test 2: pearlos-tool CLI ─────────────────────────
echo ""
echo "Test 2: pearlos-tool CLI"
if command -v pearlos-tool &>/dev/null; then
    pass "pearlos-tool found at $(which pearlos-tool)"
else
    fail "pearlos-tool not found in PATH"
fi

# ─── Test 3: Tool Discovery ──────────────────────────
echo ""
echo "Test 3: Tool Discovery"
TOOL_COUNT=$(curl -s http://localhost:4444/api/tools/list | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null)
if [ "$TOOL_COUNT" -gt 50 ] 2>/dev/null; then
    pass "Discovered $TOOL_COUNT tools via API"
else
    fail "Tool discovery returned unexpected count: $TOOL_COUNT"
fi

# ─── Test 4: Direct Execution (Notes) ────────────────
echo ""
echo "Test 4: Direct Execution (bot_list_notes)"
RESULT=$(pearlos-tool exec bot_list_notes 2>/dev/null)
if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok') or d.get('result',{}).get('success')" 2>/dev/null; then
    NOTE_COUNT=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result',d); print(len(r.get('notes',[])))" 2>/dev/null)
    pass "Direct execution works ($NOTE_COUNT notes found)"
else
    fail "Direct execution failed: $RESULT"
fi

# ─── Test 5: Relay Invocation (UI Command) ───────────
echo ""
echo "Test 5: Relay Invocation (bot_open_notes)"
RESULT=$(pearlos-tool invoke bot_open_notes 2>/dev/null)
if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null; then
    DELIVERY=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('delivery','unknown'))" 2>/dev/null)
    pass "Relay invocation works (delivery: $DELIVERY)"
else
    fail "Relay invocation failed: $RESULT"
fi

# ─── Test 6: Create + Read + Delete Note ─────────────
echo ""
echo "Test 6: Create → Read → Delete Note"
CREATE=$(pearlos-tool exec bot_create_note '{"title":"OpenClaw Integration Test","content":"This note was created by the integration test."}' 2>/dev/null)
NOTE_ID=$(echo "$CREATE" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result',d); n=r.get('note',{}); print(n.get('_id') or n.get('page_id',''))" 2>/dev/null)

if [ -n "$NOTE_ID" ] && [ "$NOTE_ID" != "" ]; then
    pass "Created test note: $NOTE_ID"
    
    # Read it back
    READ=$(pearlos-tool exec bot_read_current_note "{\"note_id\":\"$NOTE_ID\"}" 2>/dev/null)
    READ_TITLE=$(echo "$READ" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result',d); print(r.get('note',{}).get('title',''))" 2>/dev/null)
    if [ "$READ_TITLE" = "OpenClaw Integration Test" ]; then
        pass "Read note back successfully: '$READ_TITLE'"
    else
        fail "Read returned unexpected title: '$READ_TITLE'"
    fi
    
    # Delete it
    DELETE=$(pearlos-tool exec bot_delete_note "{\"note_id\":\"$NOTE_ID\",\"confirm\":true}" 2>/dev/null)
    if echo "$DELETE" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result',d); assert r.get('success')" 2>/dev/null; then
        pass "Deleted test note"
    else
        fail "Delete failed: $DELETE"
    fi
else
    fail "Create note failed: $CREATE"
fi

# ─── Test 7: Note State Endpoint ─────────────────────
echo ""
echo "Test 7: Note State Endpoint"
STATE=$(curl -s http://localhost:4444/api/note-state 2>/dev/null)
if echo "$STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'viewState' in d" 2>/dev/null; then
    VIEW=$(echo "$STATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('viewState','unknown'))" 2>/dev/null)
    pass "Note state endpoint works (viewState: $VIEW)"
else
    fail "Note state endpoint failed: $STATE"
fi

# ─── Test 8: OpenClaw Skill Installed ────────────────
echo ""
echo "Test 8: PearlOS Skill for OpenClaw"
if [ -f "/usr/lib/node_modules/openclaw/skills/pearlos/SKILL.md" ]; then
    pass "SKILL.md installed at /usr/lib/node_modules/openclaw/skills/pearlos/SKILL.md"
else
    fail "SKILL.md not found"
fi

# ─── Summary ─────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
if [ $FAILURES -eq 0 ]; then
    echo -e "  ${GREEN}All tests passed!${NC}"
else
    echo -e "  ${RED}$FAILURES test(s) failed${NC}"
fi
echo "═══════════════════════════════════════════════════"
echo ""

exit $FAILURES
