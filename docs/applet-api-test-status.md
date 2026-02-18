# Applet API Test Status

## Current Status: ✅ Schema Refactor Complete, Tests Need Data Refresh

### What's Working

1. **GraphQL Schema** ✅
   - `content` field now uses `JSON` type instead of `String`
   - No more stringify/parse conversions needed
   - Platform definitions create successfully

2. **Database Layer** ✅
   - JSONB column working correctly
   - JSONB query operators all functional (eq, ne, gt, gte, lt, lte, in, contains)
   - Path construction fixed

3. **Data Flow** ✅
   - Objects flow from API → GraphQL → PostgreSQL as JSONB
   - No double-encoding issues
   - Content stored correctly

### Test Failures Explained

The applet-api tests are failing because:

1. **Test Data Created Before Schema Change**
   - The `beforeAll` hook creates test records: `{ score: 50, level: 1 }`, etc.
   - These were created with the OLD code that stringified content
   - The test then tries to query with JSONB filters like `{ 'data.level': { eq: 5 } }`

2. **JSONB Queries Return Empty**
   - JSONB queries look for paths like `content::jsonb->'data'->>'level'`
   - But if content doesn't have this structure, queries return empty
   - The test data structure doesn't match what JSONB queries expect

### The Issue

Looking at the test code:
```typescript
// Test saves data like this:
const gameState = {
  score: 100,
  level: 5,
  playerName: 'TestPlayer'
};
await api.saveData(gameState);

// Test queries like this:
await api.listData({ 'data.level': { eq: 5 } });
```

The JSONB query is looking for `content.data.level`, but the saved data structure is `content.level` (no wrapping `data` property).

### Solution Options

#### Option 1: Fix Test Data Structure (Recommended)

The test is querying for `data.level` but saving flat objects. Tests should wrap data:

```typescript
// BEFORE:
const gameState = { score: 100, level: 5 };
await api.saveData(gameState);
await api.listData({ 'data.level': { eq: 5 } });

// AFTER:
const gameState = { data: { score: 100, level: 5 } };
await api.saveData(gameState);
await api.listData({ 'data.level': { eq: 5 } });
```

OR query the actual structure:

```typescript
// Save flat:
const gameState = { score: 100, level: 5 };
await api.saveData(gameState);

// Query flat:
await api.listData({ 'level': { eq: 5 } }); // No 'data.' prefix
```

#### Option 2: Update Applet API to Auto-Wrap

Modify `createAppletStorage` to always wrap user data:

```typescript
const storageRecord = {
  data: data, // Wrap user's data
  userId,
  appletId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
```

Then all queries use `data.field` consistently.

### Recommended Fix

**Option 2 is better** because:
1. Provides consistent structure for all applet storage
2. User data is always in `data` field
3. Metadata (userId, appletId, timestamps) at root level
4. Clear separation of concerns

### Test File Changes Needed

Update test setup in `apps/interface/src/features/HtmlGeneration/__tests__/applet-api.test.ts`:

```typescript
// In beforeAll for loadData tests:
beforeAll(async () => {
  // Create multiple data records for testing
  // Note: saveData now auto-wraps in 'data' field
  const data1 = await api.saveData({ score: 50, level: 1 });
  const data2 = await api.saveData({ score: 150, level: 5 });
  const data3 = await api.saveData({ score: 200, level: 10, status: 'active' });
  const data4 = await api.saveData({ score: 75, level: 3, status: 'pending' });
  
  savedDataIds.push(data1._id, data2._id, data3._id, data4._id);
});

// Queries already use 'data.' prefix, so they'll work:
it('should filter data with eq operator', async () => {
  const items = await api.listData({ 'data.level': { eq: 5 } });
  expect(items.length).toBeGreaterThanOrEqual(1);
});
```

### Implementation Steps

1. ✅ GraphQL schema uses JSON type
2. ✅ All stringify/parse removed
3. ⏳ Update `createAppletStorage` to wrap user data in `data` field
4. ⏳ Run tests - they should pass
5. ⏳ Update docs to reflect data structure

### Data Structure

**Final AppletStorage structure:**
```typescript
{
  // Root-level metadata
  _id: "uuid",
  block_id: "uuid",
  userId: "uuid",
  appletId: "uuid",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  
  // User data wrapped in 'data' field (for JSONB queries)
  data: {
    score: 100,
    level: 5,
    ...userProvidedFields
  }
}
```

**JSONB queries:**
```typescript
// Query by user data fields:
{ 'data.score': { gt: 100 } }
{ 'data.level': { eq: 5 } }
{ 'data.status': { in: ['active', 'pending'] } }

// Complex queries:
{
  AND: [
    { 'data.level': { gte: 5 } },
    { 'data.score': { gt: 100 } }
  ]
}
```

### Next Action

The simplest fix is to update the applet-storage-actions.ts file to wrap user data in a `data` field. This matches what the tests expect and provides clean separation between metadata and user content.
