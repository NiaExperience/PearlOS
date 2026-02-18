#!/usr/bin/env bash
set -euo pipefail

# Enable Redis admin messaging for pipecat-daily-bot
# This script sets the environment variable to enable Redis migration

echo "🔄 Enabling Redis admin messaging for pipecat-daily-bot..."

# Set environment variables for Redis
export REDIS_URL="redis://localhost:6379"
export USE_REDIS="true"
export ENVIRONMENT="development"

echo "✅ Environment variables set:"
echo "   REDIS_URL=$REDIS_URL"
echo "   USE_REDIS=$USE_REDIS"  
echo "   ENVIRONMENT=$ENVIRONMENT"

# Test Redis connectivity
echo ""
echo "🧪 Testing Redis connectivity..."
if node scripts/redis-admin-helper.js ping | jq -r .result 2>/dev/null | grep -q true; then
    echo "✅ Redis is accessible and responding"
else
    echo "❌ Redis connectivity test failed"
    exit 1
fi

echo ""
echo "🚀 Redis admin messaging is now enabled!"
echo "💡 Restart pipecat-daily-bot to use Redis instead of file-based messaging"
echo ""
echo "To start with Redis enabled:"
echo "  cd apps/pipecat-daily-bot && REDIS_URL=$REDIS_URL USE_REDIS=true npm run dev"