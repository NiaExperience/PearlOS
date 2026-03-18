#!/bin/bash
# dev-stop.sh — Stop PearlOS services (all or individual)
#
# Usage:
#   bash dev-stop.sh          # Stop ALL services
#   bash dev-stop.sh mesh     # Stop Mesh only (port 2000)
#   bash dev-stop.sh next     # Stop Next.js only (port 3000)
#   bash dev-stop.sh bot      # Stop Bot Gateway only (port 4444)
#   bash dev-stop.sh tmux     # Kill the tmux session only

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

kill_port() {
    local name=$1
    local port=$2
    local pattern=$3

    pids=$(lsof -ti :$port 2>/dev/null)
    if [ -z "$pids" ]; then
        # fallback to pattern match
        pids=$(pgrep -f "$pattern" 2>/dev/null)
    fi

    if [ -n "$pids" ]; then
        echo -e "${YELLOW}Stopping $name (port $port)...${NC}"
        echo "$pids" | xargs kill -9 2>/dev/null
        sleep 1
        # verify
        if lsof -ti :$port >/dev/null 2>&1 || pgrep -f "$pattern" >/dev/null 2>&1; then
            echo -e "${RED}⚠  $name still running, force killing...${NC}"
            lsof -ti :$port 2>/dev/null | xargs kill -9 2>/dev/null
            pgrep -f "$pattern" 2>/dev/null | xargs kill -9 2>/dev/null
        fi
        echo -e "${GREEN}✅ $name stopped${NC}"
    else
        echo -e "${GREEN}✅ $name already stopped${NC}"
    fi
}

kill_tmux() {
    if tmux has-session -t pearlos-dev 2>/dev/null; then
        tmux kill-session -t pearlos-dev
        echo -e "${GREEN}✅ tmux session killed${NC}"
    else
        echo -e "${GREEN}✅ tmux session not running${NC}"
    fi
}

status() {
    echo ""
    echo "── Service Status ──"
    for pair in "Mesh:2000" "Next.js:3000" "Bot:4444"; do
        name="${pair%%:*}"
        port="${pair##*:}"
        if lsof -ti :$port >/dev/null 2>&1; then
            echo -e "  $name :$port  ${RED}● RUNNING${NC}"
        else
            echo -e "  $name :$port  ${GREEN}● STOPPED${NC}"
        fi
    done
    echo ""
}

case "${1:-all}" in
    mesh)
        kill_port "Mesh" 2000 "ts-node.*server"
        ;;
    next|nextjs)
        kill_port "Next.js" 3000 "next"
        ;;
    bot)
        kill_port "Bot Gateway" 4444 "uvicorn.*bot_gateway"
        ;;
    tmux)
        kill_tmux
        ;;
    all)
        echo "🛑 Stopping all PearlOS services..."
        echo ""
        kill_tmux
        kill_port "Bot Gateway" 4444 "uvicorn.*bot_gateway"
        kill_port "Next.js" 3000 "next"
        kill_port "Mesh" 2000 "ts-node.*server"
        ;;
    status)
        status
        exit 0
        ;;
    *)
        echo "Usage: bash dev-stop.sh [mesh|next|bot|tmux|all|status]"
        exit 1
        ;;
esac

status
