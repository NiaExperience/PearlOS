# Phase 1 Test Blocker

## Issue
The comprehensive test suite (`partial-updates.test.ts`) cannot run because:

1. **Content Definition Missing**: "Notes" content type doesn't exist in test environment
2. **Test Complexity**: Tests require full Prism + Mesh + Database setup
3. **UUID Validation Errors**: `page_id` field requires valid UUIDs, not arbitrary strings

## Current Test Failures

**All 19 tests failing with same error:**
```
Content definition for type "Notes" not found.
```

**Additional UUID validation errors in error handler test:**
```
CastError: cannot cast type text to uuid in string: "non-existent-id-12345"
```

## Two Path Forward Options

### Option A: Fix Test Environment (Comprehensive)
**Pros:**
- Full integration test coverage
- Tests real Prism+Mesh interaction
- Validates end-to-end behavior

**Cons:**
- Requires creating Notes definition
- Complex test setup (Prism, Mesh, tenant, definitions)
- Slower test execution

**Steps:**
1. Add Notes definition creation in `beforeAll()`
2. Fix all UUID references to use `randomUUID()`
3. Add proper cleanup in `afterAll()`

### Option B: Unit Test Database Layer Directly (Simple)
**Pros:**
- Fast, focused testing
- No Prism/Mesh dependency
- Tests actual implementation layer

**Cons:**
- Doesn't test full integration
- May miss Prism-level issues

**Steps:**
1. Import NotionModel Sequelize model directly
2. Test `updateNotionModel` resolver mutation
3. Verify PostgreSQL || operator behavior
4. Add Sequelize transaction cleanup

## Recommendation

**Start with Option B** (unit tests), then add integration tests in Phase 2:

### Immediate Action (Option B)
Create `partial-updates-unit.test.ts`:
```typescript
import { NotionModel } from '../src/resolvers/models/notion-model';
import { updateNotionModel } from '../src/resolvers/enhanced/NotionModelResolver';

describe('Phase 1: JSONB Merge Unit Tests', () => {
  // Direct database/resolver testing
  // No Prism dependency
  // Fast execution
});
```

### Future Action (Option A)
Keep `partial-updates.test.ts` for Phase 2 integration tests after:
- Notes definition is registered
- Test fixtures are created
- UUID handling is fixed

## Decision

Proceeding with **Option B** to unblock Phase 1 validation while maintaining comprehensive test suite for Phase 2 integration testing.

**Rationale:**
1. Database layer is the critical fix - must validate it works
2. Integration tests can wait until Phase 2 (Prism optimization)
3. Faster feedback loop for database behavior
4. Can still deploy Phase 1 to staging with unit test coverage

---

**Next Steps:**
1. Create `partial-updates-unit.test.ts` with direct Sequelize/resolver tests
2. Run unit tests to validate PostgreSQL || operator
3. Document integration test requirements for Phase 2
4. Proceed with Phase 1 staging deployment once unit tests pass
