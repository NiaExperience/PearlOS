#!/usr/bin/env bash
# qa-web-chat-discord.sh
# Runs Playwright web-chat E2E tests and posts results + screenshots to Discord.
# Channel: #blair-lagoon (1482123068854763642)

set -euo pipefail

DISCORD_TOKEN="MTQ3MTQ5NjAzMzg4NzMyMjE0NA.GBuidy.D4rTA1xJ6VD5WHrKXT8Mmv7rPq5ytYLx4iIJUw"
DISCORD_CHANNEL="1482123068854763642"
DISCORD_API="https://discord.com/api/v10"
USER_AGENT="DiscordBot (PearlOS, 1.0)"
SCREENSHOT_DIR="/opt/pearlos/tests/e2e/screenshots"
PROJECT_DIR="/opt/pearlos"
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

# ── Helper: post a text message to Discord ──
discord_message() {
  local content="$1"
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${DISCORD_API}/channels/${DISCORD_CHANNEL}/messages" \
    -H "Authorization: Bot ${DISCORD_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "User-Agent: ${USER_AGENT}" \
    -d "$(jq -n --arg c "$content" '{content: $c}')"
}

# ── Helper: upload a screenshot to Discord ──
discord_upload() {
  local filepath="$1"
  local filename
  filename=$(basename "$filepath")
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${DISCORD_API}/channels/${DISCORD_CHANNEL}/messages" \
    -H "Authorization: Bot ${DISCORD_TOKEN}" \
    -H "User-Agent: ${USER_AGENT}" \
    -F "content=${filename}" \
    -F "file=@${filepath}"
}

# ── Clean old screenshots ──
rm -f "${SCREENSHOT_DIR}"/*.png 2>/dev/null || true

# ── Run Playwright tests ──
echo "[qa] Running web-chat E2E tests..."
cd "$PROJECT_DIR"

TEST_OUTPUT=""
TEST_EXIT=0
TEST_OUTPUT=$(npx playwright test tests/e2e/web-chat.spec.ts \
  --config tests/e2e/playwright.config.ts \
  --reporter=list 2>&1) || TEST_EXIT=$?

echo "$TEST_OUTPUT"

# ── Build result summary ──
PASSED=$(echo "$TEST_OUTPUT" | grep -c "✓\|passed" || echo "0")
FAILED=$(echo "$TEST_OUTPUT" | grep -c "✘\|failed\|Error" || echo "0")

if [ "$TEST_EXIT" -eq 0 ]; then
  STATUS="PASSED"
  EMOJI="white_check_mark"
else
  STATUS="FAILED"
  EMOJI="x"
fi

# Extract test names and results from output
DETAILS=$(echo "$TEST_OUTPUT" | grep -E "^\s*(✓|✘|›|.*passed|.*failed)" | head -20 || echo "(no detail lines)")

SUMMARY=":${EMOJI}: **Web Chat QA -- ${STATUS}**
**Time:** ${TIMESTAMP}
**Exit code:** ${TEST_EXIT}

\`\`\`
${DETAILS}
\`\`\`"

# Truncate if too long for Discord (2000 char limit)
if [ ${#SUMMARY} -gt 1900 ]; then
  SUMMARY="${SUMMARY:0:1900}...\`\`\`"
fi

# ── Post results to Discord ──
echo "[qa] Posting results to Discord #blair-lagoon..."
HTTP_CODE=$(discord_message "$SUMMARY")
echo "[qa] Message post status: ${HTTP_CODE}"

# ── Upload screenshots ──
SCREENSHOT_COUNT=0
for img in "${SCREENSHOT_DIR}"/*.png; do
  [ -f "$img" ] || continue
  echo "[qa] Uploading screenshot: $(basename "$img")"
  HTTP_CODE=$(discord_upload "$img")
  echo "[qa]   Upload status: ${HTTP_CODE}"
  SCREENSHOT_COUNT=$((SCREENSHOT_COUNT + 1))
done

if [ "$SCREENSHOT_COUNT" -eq 0 ]; then
  discord_message ":camera: No screenshots were captured during this run."
  echo "[qa] No screenshots found to upload."
else
  echo "[qa] Uploaded ${SCREENSHOT_COUNT} screenshots."
fi

echo "[qa] Done. Overall status: ${STATUS}"
exit "$TEST_EXIT"
