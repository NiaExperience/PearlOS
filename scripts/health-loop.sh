#!/bin/bash
# Web Chat Health Check Loop — runs every 5 minutes

while true; do
  node /workspace/nia-universal/scripts/web-chat-health-check.js >> /tmp/web-chat-health-loop.log 2>&1
  sleep 300
done
