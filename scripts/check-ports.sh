#!/usr/bin/env bash
# Check if required ports are available before starting services

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_port() {
    local port=$1
    local service=$2
    
    if command -v lsof >/dev/null 2>&1; then
        if lsof -ti:$port >/dev/null 2>&1; then
            local pid=$(lsof -ti:$port | head -1)
            local process=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")
            echo -e "${RED}[X] Port $port is already in use by $service${NC}"
            echo -e "${YELLOW}   Process: $process (PID: $pid)${NC}"
            echo -e "${YELLOW}   Attempting to free the port...${NC}"
            if kill $pid 2>/dev/null; then
                sleep 1
                if ! lsof -ti:$port >/dev/null 2>&1; then
                    echo -e "${GREEN}[OK] Port $port freed${NC}"
                    return 0
                fi
            fi
            echo -e "${YELLOW}   Could not free automatically. Run: kill $pid${NC}"
            return 1
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -tuln 2>/dev/null | grep -q ":$port "; then
            echo -e "${RED}[X] Port $port is already in use by $service${NC}"
            return 1
        fi
    elif command -v ss >/dev/null 2>&1; then
        if ss -tuln 2>/dev/null | grep -q ":$port "; then
            echo -e "${RED}[X] Port $port is already in use by $service${NC}"
            return 1
        fi
    fi
    
    echo -e "${GREEN}[OK] Port $port is available for $service${NC}"
    return 0
}

echo -e "${YELLOW}[*] Checking required ports...${NC}"
echo ""

ERRORS=0

check_port 3000 "Interface" || ERRORS=$((ERRORS + 1))
check_port 4000 "Dashboard" || ERRORS=$((ERRORS + 1))
check_port 2000 "Mesh GraphQL" || ERRORS=$((ERRORS + 1))
check_port 4444 "Bot Server" || ERRORS=$((ERRORS + 1))
check_port 8000 "Chorus TTS" || ERRORS=$((ERRORS + 1))

echo ""

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}[X] $ERRORS port(s) are already in use.${NC}"
    echo ""
    echo -e "${YELLOW}Would you like to kill the processes using these ports? (y/N)${NC}"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        if lsof -ti:2000 >/dev/null 2>&1; then
            kill $(lsof -ti:2000) 2>/dev/null && echo -e "${GREEN}[OK] Freed port 2000${NC}" || echo -e "${YELLOW}[!] Could not free port 2000${NC}"
        fi
        if lsof -ti:4444 >/dev/null 2>&1; then
            kill $(lsof -ti:4444) 2>/dev/null && echo -e "${GREEN}[OK] Freed port 4444${NC}" || echo -e "${YELLOW}[!] Could not free port 4444${NC}"
        fi
        if lsof -ti:3000 >/dev/null 2>&1; then
            kill $(lsof -ti:3000) 2>/dev/null && echo -e "${GREEN}[OK] Freed port 3000${NC}" || echo -e "${YELLOW}[!] Could not free port 3000${NC}"
        fi
        if lsof -ti:4000 >/dev/null 2>&1; then
            kill $(lsof -ti:4000) 2>/dev/null && echo -e "${GREEN}[OK] Freed port 4000${NC}" || echo -e "${YELLOW}[!] Could not free port 4000${NC}"
        fi
        if lsof -ti:8000 >/dev/null 2>&1; then
            kill $(lsof -ti:8000) 2>/dev/null && echo -e "${GREEN}[OK] Freed port 8000${NC}" || echo -e "${YELLOW}[!] Could not free port 8000${NC}"
        fi
        echo ""
        echo -e "${CYAN}[*] Waiting 2 seconds for ports to be released...${NC}"
        sleep 2
        echo ""
    else
        echo ""
        echo -e "${YELLOW}Please free the ports manually and try again.${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}[OK] All required ports are available${NC}"
echo ""

