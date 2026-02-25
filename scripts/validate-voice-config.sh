#!/bin/bash
# Voice Configuration Validation Script
# Validates all voice system components after improvements

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔍 PearlOS Voice Configuration Validator"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PASS=0
FAIL=0

check_service() {
    local name=$1
    local port=$2
    
    if netstat -tlnp 2>/dev/null | grep -q ":${port}.*LISTEN"; then
        echo -e "${GREEN}✓${NC} $name (port $port) is running"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗${NC} $name (port $port) is NOT running"
        ((FAIL++))
        return 1
    fi
}

check_env_var() {
    local var_name=$1
    local file=$2
    
    if grep -q "^${var_name}=" "$file" 2>/dev/null; then
        local value=$(grep "^${var_name}=" "$file" | head -1 | cut -d= -f2-)
        if [ -n "$value" ]; then
            echo -e "${GREEN}✓${NC} $var_name is set in $file"
            ((PASS++))
            return 0
        fi
    fi
    echo -e "${RED}✗${NC} $var_name is NOT set in $file"
    ((FAIL++))
    return 1
}

check_code_fix() {
    local file=$1
    local pattern=$2
    local description=$3
    
    if grep -q "$pattern" "$file" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $description"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗${NC} $description (not found in $file)"
        ((FAIL++))
        return 1
    fi
}

echo "📡 Service Health Checks"
echo "────────────────────────"
check_service "PocketTTS" 8766
check_service "Mesh API" 2000
check_service "OpenClaw Gateway" 18789
check_service "Bot Gateway" 4444
check_service "Next.js Interface" 3000
echo ""

echo "📝 Configuration Checks"
echo "───────────────────────"
check_env_var "BOT_TTS_PROVIDER" "/workspace/nia-universal/apps/pipecat-daily-bot/.env"
check_env_var "BOT_PERSONALITY_RECORD" "/workspace/nia-universal/apps/pipecat-daily-bot/.env"
check_env_var "DEFAULT_TENANT_ID" "/workspace/nia-universal/apps/pipecat-daily-bot/.env"
echo ""

echo "🔧 Code Fix Verification"
echo "────────────────────────"
check_code_fix \
    "/workspace/nia-universal/apps/pipecat-daily-bot/bot/core/config.py" \
    'provider = os.getenv("BOT_TTS_PROVIDER"' \
    "TTS provider reads from env (not hardcoded)"

check_code_fix \
    "/workspace/nia-universal/apps/pipecat-daily-bot/bot/session/initialization.py" \
    "raise ValueError" \
    "Personality loading errors are explicit"

check_code_fix \
    "/workspace/nia-universal/apps/pipecat-daily-bot/bot/bot_gateway.py" \
    "_check_service_health" \
    "Service health checks on startup"

echo ""

# Check for recent bot gateway logs with personality loaded
echo "📋 Runtime Validation"
echo "─────────────────────"
if [ -f "/tmp/bot_gateway_restart.log" ]; then
    if grep -q "Application startup complete" "/tmp/bot_gateway_restart.log" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Bot Gateway started successfully"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} Bot Gateway startup may have issues"
        ((FAIL++))
    fi
    
    if grep -q "service-check.*PocketTTS.*reachable" "/tmp/bot_gateway_restart.log" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Service health checks executed at startup"
        ((PASS++))
    else
        echo -e "${YELLOW}⚠${NC}  Service health checks not found in logs"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Bot Gateway logs not found (may not have restarted yet)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📊 Validation Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✓ Passed:${NC} $PASS"
echo -e "  ${RED}✗ Failed:${NC} $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed! System is ready for voice testing.${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some checks failed. Review and fix before testing.${NC}"
    exit 1
fi
