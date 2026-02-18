#!/usr/bin/env bash
set -euo pipefail

# Stop Redis servers (development and test)
echo "🛑 Stopping Redis servers..."

# Configuration
REDIS_DEV_PORT=${REDIS_PORT:-6379}
REDIS_TEST_PORT=${REDIS_TEST_PORT:-6380}
REDIS_DEV_PID_FILE="/tmp/redis-dev.pid"
REDIS_TEST_PID_FILE="/tmp/redis-test.pid"

# Function to stop Redis by port
stop_redis_by_port() {
  local port=$1
  local name=$2
  
  echo "🔌 Stopping Redis $name (port $port)..."
  
  if redis-cli -p "$port" ping >/dev/null 2>&1; then
    redis-cli -p "$port" shutdown
    echo "✅ Redis $name stopped"
  else
    echo "ℹ️  Redis $name was not running on port $port"
  fi
}

# Function to stop Redis by PID file
stop_redis_by_pid() {
  local pid_file=$1
  local name=$2
  
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    
    if kill -0 "$pid" 2>/dev/null; then
      echo "🆔 Stopping Redis $name (PID: $pid)..."
      kill "$pid"
      
      # Wait for process to stop
      local count=0
      while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
        sleep 1
        count=$((count + 1))
      done
      
      if kill -0 "$pid" 2>/dev/null; then
        echo "⚠️  Force killing Redis $name (PID: $pid)"
        kill -9 "$pid"
      fi
      
      echo "✅ Redis $name stopped"
    else
      echo "ℹ️  Redis $name process not running (stale PID file)"
    fi
    
    rm -f "$pid_file"
  fi
}

# Stop development Redis
stop_redis_by_port "$REDIS_DEV_PORT" "development"
stop_redis_by_pid "$REDIS_DEV_PID_FILE" "development"

# Stop test Redis
stop_redis_by_port "$REDIS_TEST_PORT" "test"
stop_redis_by_pid "$REDIS_TEST_PID_FILE" "test"

# Stop Docker Redis if running
if command -v docker >/dev/null 2>&1; then
  if docker ps --format "table {{.Names}}" | grep -q "redis-dev"; then
    echo "🐳 Stopping Docker Redis container..."
    docker stop redis-dev >/dev/null 2>&1 || true
    echo "✅ Docker Redis container stopped"
  fi
fi

# Clean up any remaining Redis processes
echo "🧹 Cleaning up any remaining Redis processes..."
REDIS_PROCESSES=$(pgrep -f "redis-server" || true)
if [[ -n "$REDIS_PROCESSES" ]]; then
  echo "⚠️  Found remaining Redis processes: $REDIS_PROCESSES"
  echo "💡 You may want to manually kill these processes"
else
  echo "✅ No Redis processes found"
fi

echo "🎉 Redis shutdown complete!"