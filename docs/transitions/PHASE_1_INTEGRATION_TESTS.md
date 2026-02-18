# Phase 1 Integration Tests - Setup Guide

## Overview

The Phase 1 partial update tests (`apps/mesh/__tests__/partial-updates.test.ts`) are **integration tests** that run against a **real local PostgreSQL database**, not the in-memory pg-mem test database.

## Why Real PostgreSQL?

pg-mem (the in-memory PostgreSQL emulator) does not support the JSONB `||` merge operator that is core to Phase 1. These tests validate:

1. PostgreSQL JSONB `||` operator works correctly
2. Sequelize `literal()` generates proper SQL
3. NotionModelResolver implements merge semantics
4. Content updates are atomic and preserve existing fields
5. Feature flag properly gates the behavior

## Running the Tests

### Option 1: Start Local Mesh Server First (Recommended)

```bash
# Terminal 1: Start local Mesh server with real PostgreSQL
npm run dev --workspace=mesh

# Terminal 2: Run integration tests
npm run test:js -- --runTestsByPath apps/mesh/__tests__/partial-updates.test.ts --no-coverage
```

### Option 2: Tests Will Skip if Server Not Available

If you run the tests without starting the local server first:

```bash
npm run test:js -- --runTestsByPath apps/mesh/__tests__/partial-updates.test.ts --no-coverage
```

Output:
```
⚠️  Local Mesh server not available on localhost:2000
   Start server with: npm run dev --workspace=mesh
   These tests require a REAL PostgreSQL database, not pg-mem
   Skipping integration tests...
```

All tests will be skipped (not failed).

## Test Configuration

- **Server URL**: `http://localhost:2000/graphql` (development server, NOT test server at 5001)
- **Database**: Real PostgreSQL (configured in your local environment)
- **Feature Flag**: `ENABLE_PARTIAL_UPDATES=true` (set automatically by tests)
- **Cleanup**: Automatic - all test notes are deleted in `afterAll()`

## Test Data Cleanup

The tests automatically clean up after themselves:

1. Track all created note IDs during test execution
2. In `afterAll()`, delete each note using `prism.delete()`
3. Uses a randomly generated tenant ID for isolation

If tests fail or are interrupted, you may have orphaned test data. Check your local database:

```sql
-- Find test notes (look for unusual tenant IDs or recent timestamps)
SELECT * FROM notion_blocks 
WHERE type = 'Notes' 
ORDER BY created_at DESC 
LIMIT 50;

-- Delete orphaned test data if needed
DELETE FROM notion_blocks 
WHERE tenant_id = '<test-tenant-id>';
```

## Integration with CI/CD

For CI/CD pipelines, you have two options:

### Option A: Skip in CI (Current Behavior)
Tests automatically skip if local server not available. No CI changes needed.

### Option B: Docker Compose for CI
Add to `.github/workflows/test.yml`:

```yaml
services:
  postgres:
    image: postgres:15
    env:
      POSTGRES_DB: nia_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5

steps:
  - name: Start Mesh Server
    run: |
      npm run dev --workspace=mesh &
      sleep 5  # Wait for server to start
      
  - name: Run Integration Tests
    run: npm run test:js -- --runTestsByPath apps/mesh/__tests__/partial-updates.test.ts --no-coverage
```

## Test Coverage

The integration tests cover:

### Basic JSONB Merge (6 tests)
- Partial content updates preserve other fields
- Multiple field updates in one call
- Nested object shallow merge
- Array replacement (not merge)
- Null value handling
- Empty object merge

### Edge Cases (7 tests)
- Empty update payload
- Non-content field updates
- Deeply nested objects
- Special characters in JSON
- Unicode and emoji
- Large JSON payloads (10KB+)
- Backslashes and escape sequences

### Concurrent Updates (2 tests)
- Multiple concurrent updates to different fields
- Race conditions on same field (last write wins)

### Error Handling (2 tests)
- Malformed JSON handling
- Non-existent record updates

### Feature Flag (2 tests)
- JSONB merge when flag enabled
- Legacy behavior when flag disabled

### Performance (2 tests)
- Single update latency (<500ms)
- Bulk updates (10 notes) (<2s)

**Total: 21 tests**

## Troubleshooting

### Tests Skip Immediately
**Cause**: Local Mesh server not running or not accessible on port 2000.

**Solution**:
```bash
# Check if server is running
curl http://localhost:2000/graphql

# Start server if not running
npm run dev --workspace=mesh
```

### Tests Fail with "Definition Not Found"
**Cause**: Notes definition wasn't created for test tenant.

**Solution**: The test should auto-create it. If it fails, check that your local database allows definition creation.

### Cleanup Fails
**Cause**: Notes were created but couldn't be deleted.

**Solution**:
```sql
-- Manual cleanup
DELETE FROM notion_blocks WHERE tenant_id = '<shown in test output>';
```

### Tests Pass but Changes Not Persisted
**Cause**: Tests might be running against wrong database.

**Solution**: Check Mesh server logs to confirm it's using your local PostgreSQL, not pg-mem.

## Performance Expectations

On a typical development machine:

- **Setup** (beforeAll): ~500ms
- **Single test**: ~50-200ms
- **Full suite**: ~5-8 seconds
- **Cleanup** (afterAll): ~200ms per note

## Development Workflow

1. **Make changes** to NotionModelResolver or related code
2. **Start local Mesh server** (if not running)
3. **Run integration tests** to validate
4. **Check test output** for any failures
5. **Inspect database** if needed to debug issues
6. **Cleanup happens automatically** - no manual intervention

## Migration Path

When deploying Phase 1:

1. ✅ Run these integration tests locally
2. ✅ Deploy to staging with `ENABLE_PARTIAL_UPDATES=true`
3. ✅ Monitor for 48 hours (see PHASE_1_IMPLEMENTATION_PLAN.md)
4. ✅ Run integration tests against staging (optional)
5. ✅ Deploy to production

## Related Documentation

- `docs/PARTIAL_UPDATE_ANALYSIS.md` - Root cause analysis
- `docs/PARTIAL_UPDATE_REFACTOR_AUDIT.md` - Code audit results
- `docs/PARTIAL_UPDATE_IMPLEMENTATION_PLAN.md` - 3-phase plan
- `docs/PHASE_1_SUMMARY.md` - Implementation summary
- `docs/PHASE_1_TEST_BLOCKER_PGMEM.md` - Why pg-mem doesn't work

---

**Last Updated**: 2025-11-03  
**Status**: ✅ Ready for use  
**Maintainer**: Development Team
