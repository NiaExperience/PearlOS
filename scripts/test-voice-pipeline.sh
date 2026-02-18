#!/usr/bin/env bash
# test-voice-pipeline.sh — End-to-end voice pipeline smoke tests
# Tests: fast LLM path, agent path, PocketTTS, bot gateway tools
# Usage: ./test-voice-pipeline.sh [--quiet]
set -euo pipefail

QUIET="${1:-}"
PASS=0; FAIL=0
TOKEN="${OPENCLAW_TOKEN:-c29b81e25840c89c64074b4d93a7a9b8227a0742aa5a5442}"
LLM_URL="http://localhost:18789/v1/chat/completions"
TTS_URL="http://localhost:8766/tts"
TOOL_URL="http://localhost:4444/api/tools/invoke"

result() {
  local status="$1"; shift
  if [[ "$status" == "PASS" ]]; then
    ((PASS++))
    echo -e "\033[32m[PASS]\033[0m $*"
  else
    ((FAIL++))
    echo -e "\033[31m[FAIL]\033[0m $*"
  fi
}

# ── Test 1: Fast voice path (streaming LLM) ──
test_fast_voice() {
  local tmpfile; tmpfile=$(mktemp)
  local start; start=$(date +%s%N)
  local ttfb_ns=""
  local tokens=0

  curl -sN --max-time 20 -X POST "$LLM_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"model":"anthropic/claude-sonnet-4-5","messages":[{"role":"user","content":"Say hello in one sentence."}],"stream":true,"max_tokens":100}' \
    > "$tmpfile" 2>/dev/null || true

  # Check for content chunks
  if grep -q '"content"' "$tmpfile" 2>/dev/null; then
    tokens=$(grep -o '"content"' "$tmpfile" | wc -l)
    local end; end=$(date +%s%N)
    local elapsed; elapsed=$(( (end - start) / 1000000 ))
    # TTFB: time to first line with content
    result PASS "Fast voice path: ${elapsed}ms total, streamed ~${tokens} chunks"
  elif grep -q '"error"' "$tmpfile" 2>/dev/null; then
    local err; err=$(grep -o '"message":"[^"]*"' "$tmpfile" | head -1)
    result FAIL "Fast voice path: error — $err"
  else
    result FAIL "Fast voice path: no content received (timeout or empty)"
  fi
  rm -f "$tmpfile"
}

# ── Test 2: OpenClaw agent path (with voice session key) ──
test_agent_path() {
  local tmpfile; tmpfile=$(mktemp)
  local start; start=$(date +%s%N)
  local ttfb_found=false ttfb_ms=0

  # Stream and capture, measuring TTFB
  curl -sN --max-time 30 -X POST "$LLM_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "x-openclaw-session-key: agent:main:voice" \
    -d '{"model":"anthropic/claude-sonnet-4-5","messages":[{"role":"user","content":"What time is it?"}],"stream":true,"max_tokens":200}' \
    > "$tmpfile" 2>/dev/null || true

  if grep -q '"content"' "$tmpfile" 2>/dev/null; then
    local tokens; tokens=$(grep -o '"content"' "$tmpfile" | wc -l)
    local end; end=$(date +%s%N)
    local elapsed; elapsed=$(( (end - start) / 1000000 ))
    local status="PASS"
    local note=""
    if (( elapsed > 10000 )); then
      note=" ⚠️  SLOW (>${elapsed}ms, threshold 10s)"
    fi
    result "$status" "Agent voice path: ${elapsed}ms total, ~${tokens} chunks${note}"
  else
    result FAIL "Agent voice path: no content received (timeout or empty)"
  fi
  rm -f "$tmpfile"
}

# ── Test 3: PocketTTS ──
test_tts() {
  local tmpfile; tmpfile=$(mktemp)
  local start; start=$(date +%s%N)

  # PocketTTS uses multipart form or JSON to /tts
  curl -s --max-time 10 -X POST "$TTS_URL" \
    -F "text=Hello, this is a test." \
    -o "$tmpfile" 2>/dev/null || true

  local size; size=$(wc -c < "$tmpfile" 2>/dev/null || echo 0)
  local end; end=$(date +%s%N)
  local elapsed; elapsed=$(( (end - start) / 1000000 ))

  if (( size > 1000 )); then
    local kb; kb=$(( size / 1024 ))
    result PASS "PocketTTS: ${elapsed}ms, received ${kb}KB audio"
  elif (( size > 0 )); then
    # Might be an error message
    local body; body=$(head -c 200 "$tmpfile")
    result FAIL "PocketTTS: ${elapsed}ms, only ${size} bytes — $body"
  else
    # Try JSON format as fallback
    curl -s --max-time 10 -X POST "$TTS_URL" \
      -H "Content-Type: application/json" \
      -d '{"text":"Hello, this is a test."}' \
      -o "$tmpfile" 2>/dev/null || true
    size=$(wc -c < "$tmpfile" 2>/dev/null || echo 0)
    if (( size > 1000 )); then
      local kb; kb=$(( size / 1024 ))
      result PASS "PocketTTS (JSON): ${elapsed}ms, received ${kb}KB audio"
    else
      result FAIL "PocketTTS: no response (service down?)"
    fi
  fi
  rm -f "$tmpfile"
}

# ── Test 4: Bot gateway tool execution ──
test_tool_exec() {
  local start; start=$(date +%s%N)
  local resp; resp=$(curl -s --max-time 5 -X POST "$TOOL_URL" \
    -H "Content-Type: application/json" \
    -d '{"tool":"bot_wonder_canvas_clear","params":{}}' 2>/dev/null || echo "CURL_FAIL")

  local end; end=$(date +%s%N)
  local elapsed; elapsed=$(( (end - start) / 1000000 ))

  if [[ "$resp" == "CURL_FAIL" ]] || [[ -z "$resp" ]]; then
    result FAIL "Tool execution: no response (gateway down?)"
  elif echo "$resp" | grep -qi "error"; then
    result FAIL "Tool execution: ${elapsed}ms — $resp"
  else
    result PASS "Tool execution: ${elapsed}ms"
  fi
}

# ── Test 5: Health checks ──
test_health() {
  # Check PocketTTS health
  local tts_health; tts_health=$(curl -s --max-time 3 http://localhost:8766/health 2>/dev/null || echo "")
  if [[ -n "$tts_health" ]]; then
    result PASS "PocketTTS health: $tts_health"
  else
    # Try healthz (chorus-tts style)
    tts_health=$(curl -s --max-time 3 http://localhost:8766/healthz 2>/dev/null || echo "")
    if [[ -n "$tts_health" ]]; then
      result PASS "TTS healthz: $tts_health"
    else
      result FAIL "TTS health: no response on :8766"
    fi
  fi
}

# ── Run all tests ──
echo "═══════════════════════════════════════════"
echo "  Voice Pipeline Smoke Tests"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════"
echo ""

test_health
test_fast_voice
test_agent_path
test_tts
test_tool_exec

echo ""
echo "═══════════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "═══════════════════════════════════════════"

exit $FAIL
