#!/bin/bash
# Quick script to clone AWS DB via tunnel
# This script:
# 1. Starts the SSM tunnel in the background
# 2. Temporarily updates environment to use localhost
# 3. Runs the clone script
# 4. Cleans up

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================="
echo "Clone AWS DB via SSM Tunnel"
echo "=========================================="
echo ""

# Check if tunnel is already running
if lsof -Pi :15432 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "✅ Tunnel already running on port 15432"
    echo ""
else
    echo "🚇 Starting K8s proxy tunnel in background..."
    
    # Start tunnel in background
    nohup "$SCRIPT_DIR/staging-db-tunnel.sh" > /tmp/rds-tunnel.log 2>&1 &
    TUNNEL_PID=$!
    
    echo "   PID: $TUNNEL_PID"
    echo "   Waiting for tunnel to establish..."
    
    # Wait for tunnel to be ready (max 10 seconds)
    for i in {1..20}; do
        if lsof -Pi :15432 -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "✅ Tunnel established!"
            break
        fi
        if [ $i -eq 20 ]; then
            echo "❌ Tunnel failed to start. Check /tmp/rds-tunnel.log"
            exit 1
        fi
        sleep 0.5
        echo -n "."
    done
    echo ""
fi

echo ""
echo "🔧 Running clone with tunnel connection..."
echo "   (localhost:15432 → nia-dev RDS)"
echo ""

# Run the clone script with modified env vars
cd "$PROJECT_ROOT"
AWS_POSTGRES_HOST=localhost AWS_POSTGRES_PORT=15432 npm run pg:db-clone-aws

CLONE_EXIT=$?

echo ""
if [ $CLONE_EXIT -eq 0 ]; then
    echo "✅ Clone completed successfully!"
else
    echo "❌ Clone failed with exit code: $CLONE_EXIT"
fi

echo ""
echo "💡 Tunnel is still running on localhost:15432"
echo "   To stop it: pkill -f 'kubectl port-forward'"
echo "   To remove proxy pod: kubectl delete pod rds-proxy-temp -n mesh-stg"
echo ""
echo "=========================================="

exit $CLONE_EXIT
