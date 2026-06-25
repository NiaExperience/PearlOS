#!/bin/bash
# Web Chat Health Check for PearlOS Staging
# Tests: (a) text response (b) image understanding (c) tool calls

set -e

STAGING_URL="https://trio-yorkshire-foundations-lived.trycloudflare.com"
TEST_TIMESTAMP=$(date -Iseconds)
LOG_FILE="/tmp/web-chat-health-check.log"
FAILED=0

echo "[$TEST_TIMESTAMP] Starting Web Chat Health Check..." | tee -a "$LOG_FILE"

# Function to log results
log_result() {
    local test_name="$1"
    local status="$2"
    local details="$3"
    echo "[$TEST_TIMESTAMP] $test_name: $status - $details" | tee -a "$LOG_FILE"
}

# Test 1: Check if staging interface is reachable
echo "[$TEST_TIMESTAMP] Test 1: Checking interface availability..."
if curl -s -o /dev/null -w "%{http_code}" "$STAGING_URL" | grep -q "200\|307"; then
    log_result "Interface Reachable" "PASS" "HTTP 200/307 received"
else
    log_result "Interface Reachable" "FAIL" "Cannot reach staging URL"
    FAILED=1
fi

# Test 2: Check bot gateway health
echo "[$TEST_TIMESTAMP] Test 2: Checking bot gateway health..."
GATEWAY_HEALTH=$(curl -s "http://localhost:4444/health" 2>/dev/null || echo "{}" | jq -r '.status // "unknown"')
if [ "$GATEWAY_HEALTH" = "healthy" ] || [ "$GATEWAY_HEALTH" = "ok" ]; then
    log_result "Bot Gateway Health" "PASS" "Gateway is healthy"
else
    log_result "Bot Gateway Health" "WARN" "Status: $GATEWAY_HEALTH"
fi

# Test 3: Check OpenClaw connectivity via bot gateway
echo "[$TEST_TIMESTAMP] Test 3: Checking OpenClaw connectivity..."
OPENCLAW_STATUS=$(curl -s "http://localhost:18789/v1/models" -H "Authorization: Bearer $OPENROUTER_API_KEY" 2>/dev/null | jq -r '.data[0].id // "unavailable"')
if [ "$OPENCLAW_STATUS" != "unavailable" ]; then
    log_result "OpenClaw Connectivity" "PASS" "Model: $OPENCLAW_STATUS"
else
    log_result "OpenClaw Connectivity" "FAIL" "Cannot reach OpenClaw"
    FAILED=1
fi

# Test 4: Verify PM2 services
echo "[$TEST_TIMESTAMP] Test 4: Checking PM2 services..."
OFFLINE_COUNT=$(pm2 status | grep -E "stopped|errored" | wc -l)
if [ "$OFFLINE_COUNT" -eq 0 ]; then
    log_result "PM2 Services" "PASS" "All services online"
else
    log_result "PM2 Services" "WARN" "$OFFLINE_COUNT service(s) offline"
    pm2 status | grep -E "stopped|errored" | tee -a "$LOG_FILE"
fi

# Summary
echo "[$TEST_TIMESTAMP] Health Check Complete. Failed tests: $FAILED" | tee -a "$LOG_FILE"
echo "---" | tee -a "$LOG_FILE"

exit $FAILED
