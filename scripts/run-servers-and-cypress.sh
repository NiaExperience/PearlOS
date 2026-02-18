#!/bin/bash

# Clean up processes before starting
echo "🧹 Cleaning up existing processes..."
./scripts/cleanup-processes.sh ports

NODE_ENV=development
if [ "$1" == 'restart' ]; then
    echo "🔄 Not clearing database, restarting postgres container..."
    npm run pg:db-start
else
    echo "🧹 Starting postgres container, clearing database, cloning from aws..."
    npm run pg:db-start
    npm run pg:db-clear
    npm run pg:db-clone-aws
fi

echo "Starting server..."
# Set test environment variables for Cypress
export CYPRESS=true
export NEXT_PUBLIC_TEST_ANONYMOUS_USER=true
export TEST_MODE=true

npm run dev &

echo "Waiting for server to be ready..."
./scripts/wait-for-server.sh

if [ $? -eq 0 ]; then
    echo "🎉 Servers are ready!"
    echo "Interface available at http://localhost:3000"
    echo "Dashboard available at http://localhost:4000"


    echo "Running Cypress..."
    ./scripts/run-cypress.sh cypress run
    ./scripts/cleanup-processes.sh
    echo "Cypress run completed."
else
    echo "❌ Servers failed to start"
    exit 1
fi 