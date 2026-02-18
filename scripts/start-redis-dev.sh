#!/usr/bin/env bash
set -euo pipefail

# Start Redis for development
# This script starts Redis in the background for local development

REDIS_PORT=${REDIS_PORT:-6379}
REDIS_LOG_FILE="/tmp/logs/redis.log"

echo "🔄 Starting Redis server on port $REDIS_PORT..."

# Check if Redis is already running
if lsof -Pi :$REDIS_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "✅ Redis is already running on port $REDIS_PORT"
    exit 0
fi

# Create logs directory
mkdir -p /tmp/logs

# Start Redis server
if command -v redis-server >/dev/null 2>&1; then
    echo "📋 Starting Redis server (logs: $REDIS_LOG_FILE)"
    redis-server --port $REDIS_PORT --daemonize yes --logfile $REDIS_LOG_FILE
    
    # Wait for Redis to start
    for i in {1..10}; do
        if lsof -Pi :$REDIS_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "✅ Redis server started successfully on port $REDIS_PORT"
            exit 0
        fi
        sleep 0.5
    done
    
    echo "❌ Failed to start Redis server"
    exit 1
    
elif command -v docker >/dev/null 2>&1; then
    echo "📋 Redis not installed locally, starting with Docker..."
    docker run -d \
        --name nia-redis-dev \
        -p $REDIS_PORT:6379 \
        --rm \
        redis:alpine \
        > /dev/null
    
    echo "✅ Redis Docker container started on port $REDIS_PORT"
    echo "📋 Container logs: docker logs nia-redis-dev"
    
else
    echo "❌ Neither redis-server nor docker found"
    echo "💡 Install Redis: brew install redis"
    echo "💡 Or install Docker: brew install docker"
    exit 1
fi