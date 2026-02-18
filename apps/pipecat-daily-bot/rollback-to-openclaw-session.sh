#!/bin/bash
# ROLLBACK: Restore openclaw_session mode if hybrid/Groq doesn't work
cp /workspace/nia-universal/apps/pipecat-daily-bot/.env.backup.20260216_230337 /workspace/nia-universal/apps/pipecat-daily-bot/.env
echo "✅ .env restored from backup"
echo "Now restart bot gateway:"
echo "  kill $(pgrep -f 'uvicorn bot_gateway') 2>/dev/null"
echo "  cd /workspace/nia-universal/apps/pipecat-daily-bot/bot && nohup uvicorn bot_gateway:app --host 0.0.0.0 --port 4444 > /tmp/bot_gateway.log 2>&1 &"
