#!/usr/bin/env bash
set -euo pipefail

# Start Redis server for development
echo "🚀 Starting Redis development server..."

# Configuration
REDIS_PORT=${REDIS_PORT:-6379}
REDIS_CONFIG_FILE="$(dirname "$0")/../../config/redis/redis.development.conf"
REDIS_LOG_FILE="/tmp/logs/redis-dev.log"
REDIS_PID_FILE="/tmp/redis-dev.pid"

# Create logs directory
mkdir -p /tmp/logs

# Check if Redis is already running
if [[ -f "$REDIS_PID_FILE" ]] && kill -0 "$(cat "$REDIS_PID_FILE")" 2>/dev/null; then
  echo "✅ Redis development server already running (PID: $(cat "$REDIS_PID_FILE"))"
  echo "🔌 Port: $REDIS_PORT"
  echo "📋 Logs: $REDIS_LOG_FILE"
  exit 0
fi

# Check if port is available
if lsof -Pi :$REDIS_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "❌ Port $REDIS_PORT is already in use"
  echo "💡 Try: lsof -Pi :$REDIS_PORT -sTCP:LISTEN"
  exit 1
fi

# Use custom config if available, otherwise use defaults
if [[ -f "$REDIS_CONFIG_FILE" ]]; then
  echo "📁 Using config: $REDIS_CONFIG_FILE"
  CONFIG_ARGS="$REDIS_CONFIG_FILE"
else
  echo "⚙️  Using default development configuration"
  CONFIG_ARGS="--port $REDIS_PORT --save '' --appendonly no --loglevel verbose --logfile $REDIS_LOG_FILE --daemonize yes --pidfile $REDIS_PID_FILE"
fi

# Start Redis server
echo "⚡ Starting Redis server on port $REDIS_PORT..."

if [[ -f "$REDIS_CONFIG_FILE" ]]; then
  redis-server "$REDIS_CONFIG_FILE" \
    --port "$REDIS_PORT" \
    --logfile "$REDIS_LOG_FILE" \
    --daemonize yes \
    --pidfile "$REDIS_PID_FILE"
else
  redis-server $CONFIG_ARGS
fi

# Wait for Redis to start
echo "⏳ Waiting for Redis to start..."
sleep 2

# Verify Redis is running
if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  echo "✅ Redis development server started successfully"
  echo "🔌 Port: $REDIS_PORT"
  echo "📋 Logs: $REDIS_LOG_FILE"
  echo "🆔 PID: $(cat "$REDIS_PID_FILE")"
  echo ""
  echo "🔧 Useful commands:"
  echo "   Connect: redis-cli -p $REDIS_PORT"
  echo "   Monitor: redis-cli -p $REDIS_PORT monitor"
  echo "   Stop:    ./scripts/redis/stop-redis.sh"
  echo "   Status:  redis-cli -p $REDIS_PORT ping"
else
  echo "❌ Failed to start Redis server"
  
  if [[ -f "$REDIS_LOG_FILE" ]]; then
    echo "📋 Log output:"
    tail -n 20 "$REDIS_LOG_FILE"
  fi
  
  # Clean up PID file if it exists
  [[ -f "$REDIS_PID_FILE" ]] && rm -f "$REDIS_PID_FILE"
  
  exit 1
fi