#!/usr/bin/env bash
set -euo pipefail

# Redis Authentication Test Runner with Poetry
# This script runs the Redis authentication test using Poetry from the pipecat-daily-bot environment

echo "🔐 Redis Authentication Test (via Poetry)"
echo "========================================="

# Check if we're in the right directory
if [[ ! -f "apps/pipecat-daily-bot/bot/pyproject.toml" ]]; then
    echo "❌ Error: Please run this from the nia-universal repository root"
    echo "   Current directory: $(pwd)"
    echo "   Expected: directory containing apps/pipecat-daily-bot/"
    exit 1
fi

# Check if Poetry is available in the bot directory
if ! command -v poetry >/dev/null 2>&1; then
    echo "❌ Poetry not found. Please install Poetry first:"
    echo "   curl -sSL https://install.python-poetry.org | python3 -"
    exit 1
fi

# Show current environment configuration
echo "📊 Environment Configuration:"
echo "   REDIS_URL: ${REDIS_URL:-redis://localhost:6379}"
echo "   REDIS_AUTH_REQUIRED: ${REDIS_AUTH_REQUIRED:-false}"
echo "   REDIS_SHARED_SECRET: ${REDIS_SHARED_SECRET:+***REDACTED***}"
echo ""

# Check if Redis server is running
echo "🔍 Checking Redis server availability..."
if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli ping >/dev/null 2>&1; then
        echo "✅ Redis server is running"
    else
        echo "⚠️  Redis server appears to be down"
        echo "💡 Start Redis with: redis-server or docker run -d -p 6379:6379 redis:alpine"
    fi
else
    echo "⚠️  redis-cli not found - cannot check server status"
fi

echo ""
echo "🚀 Running Redis authentication test..."
echo ""

# Run the test via Poetry from the bot directory
cd apps/pipecat-daily-bot/bot
poetry run python ../../../scripts/test-redis-auth.py "$@"

# Capture exit code
test_exit_code=$?

echo ""
if [[ $test_exit_code -eq 0 ]]; then
    echo "🎉 All Redis tests passed!"
else
    echo "❌ Redis tests failed (exit code: $test_exit_code)"
    echo ""
    echo "🛠️  Troubleshooting Tips:"
    echo "   1. Ensure Redis server is running: redis-server"
    echo "   2. Check REDIS_URL points to correct server"
    echo "   3. If using auth, ensure REDIS_AUTH_REQUIRED=true and REDIS_SHARED_SECRET is set"
    echo "   4. Check pipecat-daily-bot Poetry environment: cd apps/pipecat-daily-bot/bot && poetry install"
fi

exit $test_exit_code