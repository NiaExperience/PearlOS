#!/bin/bash
# Master script to run the complete JMeter load test process

# Default settings
NUM_THREADS=${1:-50}
DURATION=${2:-1800} # 30mins, in seconds
RAMP_UP=${3:-300} # 5mins, in seconds
LOOP_COUNT=${4:-25000} # good enough for an hour
LOOP_CONTINUE_FOREVER=${5:-false}

# Kill any process using port 3099 to avoid EADDRINUSE errors
echo "Cleaning up port 3099 before starting API server..."
lsof -ti :3099 | xargs -r kill -9
sleep 1

# Set up working directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if prism is built (the tests imports the dist/prism.js)
if [ ! -f "../../packages/prism/dist/prism.js" ]; then
    echo "ERROR: Prism is not built. Please run 'npm run build' in the root directory."
    exit 1
fi

# Check if the MESH endpoint is accessible
NODE_ENV=development
MESH_ENDPOINT=${MESH_ENDPOINT:-"http://localhost:2000/graphql"}
export MESH_ENDPOINT
export NODE_ENV
# Extract secret and strip surrounding quotes (single or double)
MESH_SHARED_SECRET=$(grep '^MESH_SHARED_SECRET=' ../../.env.local | cut -d'=' -f2- | sed "s/^['\"]//;s/['\"]$//")
export MESH_SHARED_SECRET

echo "Checking if Mesh endpoint is accessible at $MESH_ENDPOINT..."
if ! curl -s --head --request GET "$MESH_ENDPOINT" -H "x-mesh-secret: ${MESH_SHARED_SECRET}" | grep "200\|301\|302" > /dev/null; then
    echo "ERROR: Cannot connect to Mesh endpoint at $MESH_ENDPOINT"
    echo "Please make sure the Mesh app is running before starting the load test."
    echo "You can start it with: npm run dev -w apps/mesh"
    exit 1
fi
echo "Mesh endpoint is accessible. Continuing with load test..."

# Make all scripts executable
chmod +x *.sh

# Step 1: Set up the API server
echo "======= STEP 1: Setting up API Server ======="
./setup-api-server.sh
echo

# Step 2: Start the API server
echo "======= STEP 2: Starting API Server ======="
echo "Starting API server in the background..."
./start-api-server.sh 3099 > ./temp/api-server.log 2>&1 &
API_SERVER_PID=$!
echo "API server started with PID: $API_SERVER_PID"

# Wait for server to start
echo "Waiting for API server to start..."
sleep 5
echo

# Step 3: Set up the test environment
echo "======= STEP 3: Setting up Test Environment ======="
NODE_OPTIONS="--no-warnings=ExperimentalWarning" npx ts-node setup-jmeter-test.ts
echo

# Step 4: Extract tenant ID from config
echo "======= STEP 4: Preparing JMeter Test ======="
TENANT_ID=$(cat ./temp/jmeter-test-config.json | grep -o '"tenantId": "[^"]*' | cut -d'"' -f4)
echo "Using tenant ID: $TENANT_ID"

# Create tenant ID CSV file for JMeter
echo "$TENANT_ID" > tenant-id.csv
echo "Created tenant ID CSV file for JMeter"
echo

# Step 5: Run JMeter test
echo "======= STEP 5: Running JMeter Test ======="
echo "Starting JMeter with:"
echo "  - $NUM_THREADS concurrent users"
echo "  - $DURATION seconds duration"
echo "  - $RAMP_UP seconds ramp-up time"
echo "  - $LOOP_COUNT loops per user"
echo "  - continue forever? $LOOP_CONTINUE_FOREVER"

./run-unified-test.sh "$NUM_THREADS" "$DURATION" "$RAMP_UP" "$LOOP_COUNT" "$LOOP_CONTINUE_FOREVER"
echo

# Step 6: Clean up test environment
echo "======= STEP 6: Cleaning Up ======="
echo "Cleaning up test data..."
NODE_OPTIONS="--no-warnings=ExperimentalWarning" npx ts-node cleanup-jmeter-test.ts
rm -rf ./start-api-server.sh

# Stop API server
if [ -n "$API_SERVER_PID" ]; then
    echo "Stopping API server (PID: $API_SERVER_PID)..."
    kill $API_SERVER_PID
    wait $API_SERVER_PID 2>/dev/null
    echo "API server stopped"
fi

# Remove temporary files
rm -f tenant-id.csv

echo
echo "======= Load Test Complete ======="
echo "Check the results directory for test results and reports"
