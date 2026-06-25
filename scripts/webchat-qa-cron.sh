#!/usr/bin/env bash
LOG="/tmp/webchat-qa-cron.log"
DISCORD_CHANNEL="1494906069149941921"
BOT_TOKEN="MTQ3MTQ5NjAzMzg4NzMyMjE0NA.GBuidy.D4rTA1xJ6VD5WHrKXT8Mmv7rPq5ytYLx4iIJUw"
FAIL_THRESHOLD=50

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Running webchat QA" >> "$LOG"

RESULT=$(python3 /opt/pearlos/scripts/webchat-qa-test.py --quick 2>&1)
PASS_RATE=$(echo "$RESULT" | grep "Passed:" | grep -oP '\d+(?=%)')
AVG=$(echo "$RESULT" | grep "Avg latency" | grep -oP '\d+(?=ms)')

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pass_rate=${PASS_RATE}% avg=${AVG}ms" >> "$LOG"

if [ -n "$PASS_RATE" ] && [ "$PASS_RATE" -lt "$FAIL_THRESHOLD" ]; then
    curl -s -X POST "https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages" \
        -H "Authorization: Bot ${BOT_TOKEN}" \
        -H "Content-Type: application/json" \
        -H "User-Agent: DiscordBot (PearlOS, 1.0)" \
        -d "{\"content\": \"Pearl's Agency says: ⚠️ **Web Chat QA Alert** — pass rate ${PASS_RATE}% (threshold: ${FAIL_THRESHOLD}%). Avg latency: ${AVG}ms.\"}" > /dev/null 2>&1
fi

tail -100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
