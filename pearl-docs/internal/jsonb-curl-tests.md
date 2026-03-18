# JSONB Query Testing - Individual Curl Commands

This document provides individual curl commands for testing JSONB queries against the Mesh server.

## Configuration

```bash
MESH_URL="http://localhost:2000/graphql"
MESH_SECRET="NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg=="
```

## Setup Test Data

### Create Test Record 1 (score: 50, level: 1)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"score\\\": 50, \\\"level\\\": 1, \\\"status\\\": \\\"active\\\"}}\", indexer: {} }) { block_id page_id content } }"
  }' | jq '.'
```

### Create Test Record 2 (score: 150, level: 5)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"score\\\": 150, \\\"level\\\": 5, \\\"status\\\": \\\"active\\\"}}\", indexer: {} }) { block_id page_id content } }"
  }' | jq '.'
```

### Create Test Record 3 (score: 200, level: 10)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"score\\\": 200, \\\"level\\\": 10, \\\"status\\\": \\\"completed\\\"}}\", indexer: {} }) { block_id page_id content } }"
  }' | jq '.'
```

### Create Test Record 4 (score: 75, level: 3)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"score\\\": 75, \\\"level\\\": 3, \\\"status\\\": \\\"pending\\\"}}\", indexer: {} }) { block_id page_id content } }"
  }' | jq '.'
```

## Test JSONB Queries

### Test 1: eq operator (data.level = 5)

**Expected**: 1 result (level: 5)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.level\", eq: 5 } }) { block_id content } }"
  }' | jq '.'
```

### Test 2: gt operator (data.score > 100)

**Expected**: 2 results (score: 150, 200)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.score\", gt: 100 } }) { block_id content } }"
  }' | jq '.'
```

### Test 3: gte operator (data.score >= 150)

**Expected**: 2 results (score: 150, 200)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.score\", gte: 150 } }) { block_id content } }"
  }' | jq '.'
```

### Test 4: lt operator (data.level < 5)

**Expected**: 2 results (level: 1, 3)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.level\", lt: 5 } }) { block_id content } }"
  }' | jq '.'
```

### Test 5: lte operator (data.level <= 3)

**Expected**: 2 results (level: 1, 3)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.level\", lte: 3 } }) { block_id content } }"
  }' | jq '.'
```

### Test 6: in operator (data.level in [1, 5, 10])

**Expected**: 3 results (level: 1, 5, 10)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.level\", in: [1, 5, 10] } }) { block_id content } }"
  }' | jq '.'
```

### Test 7: ne operator (data.status != "pending")

**Expected**: 3 results (status: active, active, completed)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.status\", ne: \"pending\" } }) { block_id content } }"
  }' | jq '.'
```

### Test 8: contains operator (data.status contains "active")

**Expected**: 2 results (status: active, active)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.status\", contains: \"active\" } }) { block_id content } }"
  }' | jq '.'
```

### Test 9: Deep nested path (data.user.profile.age = 25)

First create a record with nested data:

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "mutation { createNotionModel(input: { type: \"AppletStorage\", content: \"{\\\"data\\\": {\\\"user\\\": {\\\"profile\\\": {\\\"age\\\": 25, \\\"name\\\": \\\"John\\\"}}}}\", indexer: {} }) { block_id content } }"
  }' | jq '.'
```

Then query it:

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.user.profile.age\", eq: 25 } }) { block_id content } }"
  }' | jq '.'
```

### Test 10: Combined conditions (score >= 100 AND level >= 5)

**Expected**: 2 results (score: 150/level: 5, score: 200/level: 10)

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" }, contentJsonb: { path: \"data.score\", gte: 100 } }) { block_id content } }"
  }' | jq '.'
```

## Verify All Records

List all AppletStorage records:

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{
    "query": "query { notionModel(where: { type: { eq: \"AppletStorage\" } }, orderBy: [{ field: \"createdAt\", direction: DESC }]) { block_id content indexer } }"
  }' | jq '.'
```

## Expected SQL Queries Generated

The resolver should generate PostgreSQL queries like:

```sql
-- Test 1 (eq):
SELECT * FROM notion_blocks 
WHERE type = 'AppletStorage' 
  AND (content::jsonb->'data'->>'level')::numeric = 5;

-- Test 2 (gt):
SELECT * FROM notion_blocks 
WHERE type = 'AppletStorage' 
  AND (content::jsonb->'data'->>'score')::numeric > 100;

-- Test 3 (gte):
SELECT * FROM notion_blocks 
WHERE type = 'AppletStorage' 
  AND (content::jsonb->'data'->>'score')::numeric >= 150;

-- Test 4 (in):
SELECT * FROM notion_blocks 
WHERE type = 'AppletStorage' 
  AND (content::jsonb->'data'->>'level')::numeric IN (1, 5, 10);

-- Test 5 (contains):
SELECT * FROM notion_blocks 
WHERE type = 'AppletStorage' 
  AND (content::jsonb->'data'->>'status')::text ILIKE '%active%';

-- Test 6 (deep nested):
SELECT * FROM notion_blocks 
WHERE type = 'AppletStorage' 
  AND (content::jsonb->'data'->'user'->'profile'->>'age')::numeric = 25;
```

## Running the Automated Test Suite

Run all tests at once:

```bash
./scripts/test-jsonb-queries.sh
```

## Troubleshooting

### Check if mesh server is running

```bash
curl -X POST http://localhost:2000/graphql \
  -H "Content-Type: application/json" \
  -H "x-mesh-secret: NEFGOUQ4Q0QtQ0NBRi00MDg2LTkwQjQtQzQ1NzhGRTIyQjRFCg==" \
  -d '{"query": "{ __typename }"}' | jq '.'
```

### Check PostgreSQL connection

```bash
psql -h localhost -p 5432 -U postgres -d testdb -c "SELECT version();"
```

### Verify table structure

```bash
psql -h localhost -p 5432 -U postgres -d testdb -c "\d notion_blocks"
```

### Check if GIN indexes exist

```bash
psql -h localhost -p 5432 -U postgres -d testdb -c "\di"
```

### Enable SQL logging in mesh server

Set in `.env.local`:

```bash
DEBUG_PRISM=true
NODE_ENV=development
```

This will log all SQL queries to console.
