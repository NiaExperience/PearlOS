#!/bin/bash
export DISCORD_BOT_TOKEN=$(grep DISCORD_BOT_TOKEN /workspace/nia-universal/apps/interface/.env.local | cut -d= -f2)
export SCREENSHOT_DIR=/workspace/nia-universal/qa/screenshots/workflow-2026-04-22T10-54-46-593Z
node /workspace/nia-universal/qa/discord-delivery.js
