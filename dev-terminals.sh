#!/bin/bash
# dev-terminals.sh — Start all PearlOS services in separate visible terminals
# Usage: bash dev-terminals.sh
#
# Opens 3 tmux panes (Mesh, Next.js, Bot) with full log visibility.
# Postgres must already be running as a system service.

set -e

SESSION="pearlos-dev"

# Kill existing session if any
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Check postgres
if ! pg_isready -q 2>/dev/null; then
    echo "⚠️  Postgres is not running. Starting it..."
    sudo service postgresql start 2>/dev/null || pg_ctlcluster 14 main start 2>/dev/null || echo "❌ Could not start Postgres. Start it manually first."
    sleep 2
fi

echo "🚀 Starting PearlOS dev environment in tmux session: $SESSION"
echo ""

# Create session with first pane — Mesh
tmux new-session -d -s "$SESSION" -n "services" \
    "echo '🔷 MESH (port 2000)' && echo '─────────────────────────────' && cd /workspace/nia-universal/apps/mesh && npx ts-node --transpile-only src/server.ts; read"

# Wait for Mesh to boot before starting dependents
sleep 3

# Split horizontally — Next.js
tmux split-window -h -t "$SESSION" \
    "echo '🟢 NEXT.JS (port 3000)' && echo '─────────────────────────────' && cd /workspace/nia-universal/apps/interface && npx next dev -p 3000; read"

# Split the right pane vertically — Bot
tmux split-window -v -t "$SESSION" \
    "echo '🟣 BOT GATEWAY (port 4444)' && echo '─────────────────────────────' && cd /workspace/nia-universal/apps/pipecat-daily-bot/bot && USE_ELEVENLABS=false BOT_TTS_PROVIDER=pocket uvicorn bot_gateway:app --host 0.0.0.0 --port 4444; read"

# Even out the layout
tmux select-layout -t "$SESSION" main-vertical

echo "✅ All services starting in tmux session '$SESSION'"
echo ""
echo "  tmux attach -t $SESSION     ← attach to see all logs"
echo "  tmux kill-session -t $SESSION  ← stop everything"
echo ""
echo "Inside tmux:"
echo "  Ctrl+B then arrow keys  ← switch between panes"
echo "  Ctrl+B then z           ← zoom/unzoom a pane"
echo "  Ctrl+C                  ← stop a service"
echo ""

# Auto-attach
tmux attach -t "$SESSION"
