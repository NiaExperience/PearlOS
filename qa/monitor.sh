#!/bin/bash
# Screenshot workflow monitor - runs every 5 minutes
# Restarts the screenshot task if it fails

SCRIPT_DIR="/workspace/nia-universal/qa"
LOG_FILE="/workspace/nia-universal/qa/monitor.log"
APP_URL="http://localhost:3000"

echo "[$(date -u)] Monitor started" >> "$LOG_FILE"

while true; do
  echo "[$(date -u)] Running screenshot workflow..." >> "$LOG_FILE"

  if APP_URL="$APP_URL" node "$SCRIPT_DIR/workflow-screenshot.js" >> "$LOG_FILE" 2>&1; then
    echo "[$(date -u)] Screenshots completed successfully" >> "$LOG_FILE"
    # Find the latest screenshot directory and deliver to Discord
    LATEST_DIR=$(ls -dt "$SCRIPT_DIR"/screenshots/workflow-* 2>/dev/null | head -1)
    if [ -n "$LATEST_DIR" ]; then
      echo "[$(date -u)] Delivering screenshots to Discord from $LATEST_DIR" >> "$LOG_FILE"
      DISCORD_BOT_TOKEN="$(grep DISCORD_BOT_TOKEN /workspace/nia-universal/apps/interface/.env.local | cut -d= -f2)" \
        SCREENSHOT_DIR="$LATEST_DIR" \
        node "$SCRIPT_DIR/discord-delivery.js" >> "$LOG_FILE" 2>&1 || echo "[$(date -u)] Discord delivery failed" >> "$LOG_FILE"
    fi
  else
    echo "[$(date -u)] Screenshot task FAILED - will retry in 5 minutes" >> "$LOG_FILE"
  fi

  echo "[$(date -u)] Sleeping 5 minutes..." >> "$LOG_FILE"
  sleep 300
done
