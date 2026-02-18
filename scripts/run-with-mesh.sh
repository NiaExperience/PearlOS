#!/bin/bash
# Script to run the Mesh server and Next.js applications together

# Start from the project root directory
cd "$(dirname "$0")/.."

# Define colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo -e "${RED}Error: Node.js is not installed.${NC}"
  exit 1
fi

# Start the Mesh server in the background
echo -e "${GREEN}Starting Mesh server...${NC}"
(cd apps/mesh && npm run dev) &
MESH_PID=$!

# Wait for the Mesh server to start
echo -e "${BLUE}Waiting for Mesh server to start...${NC}"
sleep 5

# Set environment variable for Next.js apps
export MESH_ENDPOINT=http://localhost:2000/graphql

# Start the Next.js applications
echo -e "${GREEN}Starting Next.js applications...${NC}"
npm run dev

# Function to handle script termination
cleanup() {
  echo -e "${BLUE}Shutting down servers...${NC}"
  kill $MESH_PID
  exit 0
}

# Register the cleanup function to run on script termination
trap cleanup SIGINT SIGTERM

# Wait for all background processes to finish
wait
