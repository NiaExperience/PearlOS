#!/bin/bash

# JSONB Query Testing Script for Mesh Server
# Tests the JSONB contentJsonb filter implementation against real PostgreSQL
# 
# Prerequisites:
# - Mesh server running on localhost:2000
# - Real PostgreSQL database connected
# - Test data created with AppletStorage content type

set -e  # Exit on error

# Configuration
MESH_URL="http://localhost:2000/graphql"
MESH_SECRET="NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg=="

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to make GraphQL requests
graphql_query() {
    local query="$1"
    local description="$2"
    
    echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}TEST: ${description}${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo "Query:"
    echo "$query" | jq -R -s .
    echo ""
    
    response=$(curl -s -X POST "$MESH_URL" \
        -H "Content-Type: application/json" \
        -H "x-mesh-secret: $MESH_SECRET" \
        -d "$query")
    
    echo "Response:"
    echo "$response" | jq '.'
    
    # Check for errors
    if echo "$response" | jq -e '.errors' > /dev/null 2>&1; then
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    else
        result_count=$(echo "$response" | jq '.data.notionModel | length')
        echo -e "${GREEN}✓ SUCCESS - Returned $result_count results${NC}"
        return 0
    fi
}

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  JSONB Query Testing for Mesh Server                    ║${NC}"
echo -e "${GREEN}║  Testing contentJsonb filter implementation              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"

# Test 1: Setup - Create test data
echo -e "\n${YELLOW}Setting up test data...${NC}"

graphql_query '{
  "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"score\\\": 50, \\\"level\\\": 1, \\\"status\\\": \\\"active\\\"}}\", indexer: {} }) { block_id page_id content } }"
}' "Create test record 1 (score: 50, level: 1)"

graphql_query '{
  "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"score\\\": 150, \\\"level\\\": 5, \\\"status\\\": \\\"active\\\"}}\", indexer: {} }) { block_id page_id content } }"
}' "Create test record 2 (score: 150, level: 5)"

graphql_query '{
  "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"score\\\": 200, \\\"level\\\": 10, \\\"status\\\": \\\"completed\\\"}}\", indexer: {} }) { block_id page_id content } }"
}' "Create test record 3 (score: 200, level: 10)"

graphql_query '{
  "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"score\\\": 75, \\\"level\\\": 3, \\\"status\\\": \\\"pending\\\"}}\", indexer: {} }) { block_id page_id content } }"
}' "Create test record 4 (score: 75, level: 3)"

# Test 2: JSONB eq operator
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.level\", eq: 5 } }) { block_id content } }"
}' "Filter with eq operator (data.level = 5)"

# Test 3: JSONB gt operator
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.score\", gt: 100 } }) { block_id content } }"
}' "Filter with gt operator (data.score > 100)"

# Test 4: JSONB gte operator
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.score\", gte: 150 } }) { block_id content } }"
}' "Filter with gte operator (data.score >= 150)"

# Test 5: JSONB lt operator
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.level\", lt: 5 } }) { block_id content } }"
}' "Filter with lt operator (data.level < 5)"

# Test 6: JSONB lte operator
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.level\", lte: 3 } }) { block_id content } }"
}' "Filter with lte operator (data.level <= 3)"

# Test 7: JSONB in operator
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.level\", in: [1, 5, 10] } }) { block_id content } }"
}' "Filter with in operator (data.level in [1, 5, 10])"

# Test 8: JSONB contains operator (string)
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.status\", contains: \"active\" } }) { block_id content } }"
}' "Filter with contains operator (data.status contains 'active')"

# Test 9: JSONB ne operator
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.status\", ne: \"pending\" } }) { block_id content } }"
}' "Filter with ne operator (data.status != 'pending')"

# Test 10: Multiple JSONB conditions (AND logic)
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.score\", gte: 100 }, AND: [{ contentJsonb: { path: \"data.level\", gte: 5 } }] }) { block_id content } }"
}' "Multiple conditions (score >= 100 AND level >= 5)"

# Test 11: Deep nested path
graphql_query '{
  "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"user\\\": {\\\"profile\\\": {\\\"age\\\": 25}}}}\", indexer: {} }) { block_id content } }"
}' "Create test record with deep nested path"

graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.user.profile.age\", eq: 25 } }) { block_id content } }"
}' "Filter with deep nested path (data.user.profile.age = 25)"

# Test 12: Verify all AppletStorage records
graphql_query '{
  "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" } }, orderBy: [{ field: \"createdAt\", direction: DESC }]) { block_id content indexer } }"
}' "List all AppletStorage records"

echo -e "\n${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Testing Complete!                                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${YELLOW}Summary:${NC}"
echo "- All JSONB operators tested: eq, ne, gt, gte, lt, lte, in, contains"
echo "- Multiple condition logic tested"
echo "- Deep nested paths tested"
echo "- Results displayed above"
