#!/bin/bash

# Clean up processes before starting
./scripts/cleanup-processes.sh show
./scripts/cleanup-processes.sh ports node

NODE_ENV=development
#echo "🔄 Not clearing database, restarting postgres container..."
#npm run pg:db-restart

echo "Starting debug server..."

NODE_ENV=development NODE_OPTIONS='--inspect' npm run dev --workspace=dashboard &

echo "Waiting for server to be ready..."
URL="http://localhost:4000/dashboard"
./scripts/wait-for-server.sh "$URL"

if [ $? -eq 0 ]; then
    echo "🎉 Debug server is ready! Debugger available at ws://127.0.0.1:9229"
    echo "Server available at $URL"
    wait
else
    echo "❌ Server failed to start"
    exit 1
fi
