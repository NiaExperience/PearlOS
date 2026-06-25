#!/usr/bin/env bash
# Voice QA cron — runs every 30 min, alerts on degradation
LOG="/tmp/voice-qa-cron.log"
RESULTS_DIR="/workspace/user/Documents/voice-qa"
ALERT_THRESHOLD_MS=8000
DISCORD_CHANNEL="1494906069149941921"
BOT_TOKEN="MTQ3MTQ5NjAzMzg4NzMyMjE0NA.GBuidy.D4rTA1xJ6VD5WHrKXT8Mmv7rPq5ytYLx4iIJUw"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Running voice QA" >> "$LOG"

# Run quick 3-test suite
RESULT=$(python3 /opt/pearlos/scripts/voice-qa-test.py --quick 2>&1)
AVG=$(echo "$RESULT" | grep "Avg total E2E" | grep -oP '\d+(?=ms)')
PASSED=$(echo "$RESULT" | grep "Passed:" | grep -oP '\d+(?=/)')
TOTAL=$(echo "$RESULT" | grep "Passed:" | grep -oP '(?=/)\d+' | tail -1)

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) avg=${AVG}ms passed=${PASSED}" >> "$LOG"

# Alert if avg latency exceeds threshold or tests fail
if [ -n "$AVG" ] && [ "$AVG" -gt "$ALERT_THRESHOLD_MS" ]; then
    curl -s -X POST "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages" \
        -H "Authorization: Bot ${BOT_TOKEN}" \
        -H "Content-Type: application/json" \
        -H "User-Agent: DiscordBot (PearlOS, 1.0)" \
        -d "{\"content\": \"Pearl's Agency says: ⚠️ **Voice QA Alert** — avg latency ${AVG}ms (threshold: ${ALERT_THRESHOLD_MS}ms). ${PASSED} tests passed.\"}" > /dev/null 2>&1
fi

tail -100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
