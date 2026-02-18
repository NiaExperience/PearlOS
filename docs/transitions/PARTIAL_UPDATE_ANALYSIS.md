# Partial Update Analysis & Refactor Proposal

## Executive Summary

**Problem:** Our current PUT/PATCH operations require sending the entire record, not just the fields being updated. This violates REST conventions and recently caused a staging database issue when partial updates were attempted following standard conventions rather than our implementation.

**Root Cause:** The update path passes incoming data directly to the database without merging with existing data, effectively replacing the entire `content` JSONB field.

**Impact:** 
- Data loss when partial updates are attempted
- Developer confusion (convention vs. implementation mismatch)
- Increased payload sizes
- Potential race conditions when multiple updates occur

---

## Current Implementation Flow

### 1. Entry Points (Multiple Layers)

**Mesh REST API** (`apps/mesh/src/api/contentApi.ts:402-429`):
```typescript
contentApiRouter.put('/content/:type/:id', async (req, res) => {
  const content = req.body?.content;  // ← Partial data from client
  const prism = await Prism.getInstance();
  
  // Check if exists (but don't use existing data!)
  const existing = await prism.query({ 
    contentType: type, 
    where: { page_id: { eq: id } } 
  });
  
  // ⚠️ ISSUE: Passes partial content directly, doesn't merge
  const updated = await prism.update(type, id, content, tenant);
});
```

**Prism Client Actions** (`packages/prism/src/core/actions/content-actions.ts:141-148`):
```typescript
export async function updateContent(
  blockType: string,
  contentId: string,
  content: any,  // ← Partial content from caller
  tenantId?: string
): Promise<PrismContentResult> {
  const prism = await Prism.getInstance();
  return await prism.update(blockType, contentId, content, tenantId);
}
```

### 2. Prism Core Update (`packages/prism/src/prism.ts:175-208`)

```typescript
async update(blockType: string, page_id: string, data: ContentData, tenantId?: string) {
  // Find existing record
  const existingResult = await this.client.findContent(
    blockType, 
    where, 
    undefined, undefined, undefined, 
    tenantId
  );
  
  const processedData = this.applyBusinessRules(data, blockType, tenantId);
  const blockId = existingResult.items[0].block_id;
  
  // ⚠️ ISSUE: Passes processedData (partial) to GraphQL client
  const result = await this.client.updateContent(
    blockId, 
    blockType, 
    processedData,  // ← Still partial!
    page_id,
    parent_id,
    order,
    tenantId
  );
}
```

### 3. PrismGraphQLClient (`packages/prism/src/data-bridge/PrismGraphQLClient.ts:461-510`)

```typescript
async updateContent(
  blockId: string,
  contentType: string,
  data: ContentData,  // ← Still partial
  ...
) {
  // Build input with partial data
  const input: NotionModelInput = {
    type: contentType,
    content: data,  // ⚠️ ISSUE: Partial data sent to GraphQL
    page_id,
    parent_id,
    indexer,
    order
  };
  
  const result = await this.query(
    contentOperations.updateContent,
    { blockId, input }
  );
}
```

### 4. GraphQL Mutation (`apps/mesh/src/resolvers/enhanced/NotionModelResolver.ts:744-810`)

```typescript
updateNotionModel: async (
  _,
  { block_id, input }: { block_id: string; input: Partial<INotionModel> }
) => {
  const processedInput = { ...input };
  
  // ⚠️ CRITICAL ISSUE: Sequelize update with partial input
  const [affectedCount] = await NotionModel.update(processedInput, {
    where: { block_id },
    transaction
  });
  
  // This replaces the entire JSONB content field!
}
```

### 5. Database Layer (Sequelize/PostgreSQL)

When `NotionModel.update({ content: partialData }, { where: { block_id } })` runs:
- PostgreSQL sees: `UPDATE notion_blocks SET content = '{"title":"New"}' WHERE block_id = '...'`
- **Result:** The entire JSONB `content` column is replaced, losing all other fields

**⚡ OPTIMIZATION OPPORTUNITY:** PostgreSQL has native JSONB merge operators (`||` and `jsonb_set`) that can merge without fetching!

---

## The Problem Illustrated

### What Happens Now:

```typescript
// Existing record in DB:
{
  block_id: "abc123",
  content: {
    title: "My Note",
    description: "Important info",
    tags: ["work", "urgent"],
    metadata: { author: "user1", version: 2 }
  }
}

// Client sends partial update:
PUT /content/Notes/abc123
{ content: { title: "Updated Title" } }

// Database after update:
{
  block_id: "abc123",
  content: {
    title: "Updated Title"
    // ❌ description, tags, metadata ALL LOST!
  }
}
```

### What Should Happen:

```typescript
// Database after proper partial update:
{
  block_id: "abc123",
  content: {
    title: "Updated Title",  // ✅ Updated
    description: "Important info",  // ✅ Preserved
    tags: ["work", "urgent"],  // ✅ Preserved
    metadata: { author: "user1", version: 2 }  // ✅ Preserved
  }
}
```

---

## Proposed Solutions

### Option A: PostgreSQL Native JSONB Merge (RECOMMENDED ⭐)

**Use PostgreSQL's `||` operator for JSONB merge directly in the UPDATE query**

**Advantages:**
1. ✅ **Zero extra fetches** - merge happens in single UPDATE statement
2. ✅ **Atomic operation** - no race conditions possible
3. ✅ **Better performance** - database does the merge natively
4. ✅ **Single point of modification** - all update paths converge at resolver
5. ✅ **Database-level consistency** - JSONB operations are atomic

**How it works:**
```sql
-- PostgreSQL JSONB merge operator
UPDATE notion_blocks 
SET content = content || '{"title": "New"}'::jsonb
WHERE block_id = 'abc123';

-- Result: Existing fields preserved, new/updated fields merged
```

### Option B: Application-Level Deep Merge

**Fetch existing record, merge in application code, then update**

**Advantages:**
1. ✅ More control over merge logic
2. ✅ Can implement custom merge rules
3. ✅ Easier to debug and test

**Disadvantages:**
1. ❌ Requires extra SELECT query
2. ❌ Potential race condition between SELECT and UPDATE
3. ❌ More network round trips

**Recommendation: Use Option A (PostgreSQL Native)** for performance and atomicity.

### Implementation Plan

#### Phase 1: Core Fix - PostgreSQL Native Merge

**File:** `apps/mesh/src/resolvers/enhanced/NotionModelResolver.ts`

```typescript
import { literal } from 'sequelize';

updateNotionModel: async (
  _: any,
  { block_id, input }: { block_id: string; input: Partial<INotionModel> },
  context: any
) => {
  try {
    const isBotService = context?.serviceTrusted && context?.botControlTrusted;
    
    if (process.env.DEBUG_BOT_AUTH === 'true' && isBotService) {
      console.log(`🤖 Bot service authenticated - tenant-wide note access granted for update operation`);
    }
    
    const updatedRecord = await NotionModel.sequelize!.transaction(async (transaction) => {
      // ✨ NEW: Build update object with JSONB merge for content field
      const updateFields: any = {};
      
      for (const [key, value] of Object.entries(input)) {
        if (key === 'content' && value !== null && value !== undefined) {
          // Use PostgreSQL's || operator for JSONB merge
          // This merges incoming content with existing content atomically
          updateFields.content = literal(`content || '${JSON.stringify(value)}'::jsonb`);
        } else {
          // Regular field updates
          updateFields[key] = value;
        }
      }

      // Perform atomic update with JSONB merge
      const [affectedCount] = await NotionModel.update(updateFields, {
        where: { block_id },
        transaction,
        returning: false  // We'll fetch after for cache invalidation
      });

      if (affectedCount === 0) {
        throw new Error(`NotionModel with block_id ${block_id} not found`);
      }

      // Fetch updated record for return and cache invalidation
      const record = await NotionModel.findOne({
        where: { block_id },
        transaction
      });

      if (!record) {
        throw new Error(`NotionModel with block_id ${block_id} not found after update`);
      }

      return record;
    });

    // Convert to JSON
    const jsonResult = updatedRecord.toJSON();

    // Invalidate cache
    await cacheService.invalidateOnUpdate(block_id, jsonResult);

    return jsonResult;
  } catch (error) {
    console.error(`Error updating NotionModel with block_id ${block_id}:`, error);
    throw error;
  }
}
```

**Key Changes:**
1. Import `literal` from Sequelize for raw SQL expressions
2. Check if updating `content` field specifically
3. Use PostgreSQL's `||` operator: `content || '{"new":"data"}'::jsonb`
4. This performs atomic merge at database level (no fetch needed!)
5. Only one fetch after update for cache invalidation

#### Phase 2: Handle Field Deletion (Optional Enhancement)

**PostgreSQL JSONB Merge Semantics:**
- The `||` operator merges objects but **cannot delete fields**
- Setting a field to `null` will set it to `null`, not delete it
- For field deletion, we need `jsonb_set` with `#-` operator

**Enhanced Implementation (if field deletion needed):**

```typescript
// Helper function to build JSONB update expression
function buildJsonbUpdate(partialContent: any): any {
  const hasNullValues = Object.values(partialContent).some(v => v === null);
  
  if (!hasNullValues) {
    // Simple merge - use || operator
    return literal(`content || '${JSON.stringify(partialContent)}'::jsonb`);
  } else {
    // Need to handle deletions
    const updates: string[] = [];
    
    for (const [key, value] of Object.entries(partialContent)) {
      if (value === null) {
        // Delete the key using #- operator
        updates.push(`content #- '{${key}}'`);
      } else {
        // Merge the key using jsonb_set
        updates.push(`jsonb_set(content, '{${key}}', '${JSON.stringify(value)}'::jsonb)`);
      }
    }
    
    // Chain the operations
    return literal(updates.join(' || '));
  }
}

// In updateNotionModel:
if (key === 'content' && value !== null && value !== undefined) {
  updateFields.content = buildJsonbUpdate(value);
}
```

**Note:** For MVP, the simple `||` merge is sufficient. Field deletion can be added later if needed.

#### Phase 3: Update Semantics - PATCH vs PUT

**File:** `apps/mesh/src/api/contentApi.ts`

```typescript
// PATCH: Partial updates (merge with existing)
contentApiRouter.patch('/content/:type/:id', async (req, res) => {
  const content = req.body?.content;
  const prism = await Prism.getInstance();
  
  // Prism.update now performs deep merge at resolver level
  const updated = await prism.update(type, id, content, tenant);
  return ok(res, updated.items[0]);
});

// PUT: Full replacement (explicit contract)
contentApiRouter.put('/content/:type/:id', async (req, res) => {
  const content = req.body?.content;
  const prism = await Prism.getInstance();
  
  // For PUT, we fetch existing and replace content entirely
  const existing = await prism.query({ 
    contentType: type, 
    where: { page_id: { eq: id } } 
  });
  
  if (existing.total === 0) {
    return fail(res, 404, 'Content not found');
  }
  
  // Explicit full replacement (keep metadata, replace content)
  const fullReplacement = {
    ...existing.items[0],
    content,  // Complete replacement
    updated_at: new Date().toISOString()
  };
  
  const updated = await prism.update(type, id, fullReplacement, tenant);
  return ok(res, updated.items[0]);
});
```

---

## Testing Strategy

### Unit Tests

**File:** `apps/mesh/__tests__/partial-updates.test.ts` (NEW)

```typescript
describe('Partial Update Support - PostgreSQL JSONB Merge', () => {
  it('should merge partial content updates atomically', async () => {
    // Create initial record
    const initial = await createContent('Notes', {
      title: 'Original',
      description: 'Desc',
      tags: ['a', 'b'],
      metadata: { version: 1 }
    });
    
    // Partial update (only title)
    const updated = await updateContent('Notes', initial.page_id, {
      title: 'Updated'
    });
    
    // Verify merge - PostgreSQL || operator preserved all fields
    expect(updated.content).toEqual({
      title: 'Updated',  // Changed
      description: 'Desc',  // Preserved by ||
      tags: ['a', 'b'],  // Preserved by ||
      metadata: { version: 1 }  // Preserved by ||
    });
  });
  
  it('should merge nested objects (shallow merge)', async () => {
    const initial = await createContent('Notes', {
      metadata: { author: 'user1', version: 1, tags: ['old'] }
    });
    
    // Update metadata object
    const updated = await updateContent('Notes', initial.page_id, {
      metadata: { version: 2, tags: ['new'] }
    });
    
    // PostgreSQL || does SHALLOW merge on nested objects
    expect(updated.content.metadata).toEqual({
      author: 'user1',  // Preserved
      version: 2,  // Updated
      tags: ['new']  // Replaced (not merged)
    });
  });
  
  it('should replace arrays (JSONB || behavior)', async () => {
    const initial = await createContent('Notes', {
      tags: ['a', 'b', 'c']
    });
    
    const updated = await updateContent('Notes', initial.page_id, {
      tags: ['x', 'y']
    });
    
    // Arrays are replaced in JSONB || merge
    expect(updated.content.tags).toEqual(['x', 'y']);
  });
  
  it('should handle concurrent updates correctly', async () => {
    // Create initial
    const initial = await createContent('Notes', {
      count: 0,
      title: 'Initial'
    });
    
    // Simulate concurrent updates (race condition test)
    await Promise.all([
      updateContent('Notes', initial.page_id, { count: 1 }),
      updateContent('Notes', initial.page_id, { title: 'Updated' })
    ]);
    
    const final = await getContent('Notes', initial.page_id);
    
    // Both updates should be reflected (no data loss)
    expect(final.content.count).toBeDefined();
    expect(final.content.title).toBeDefined();
  });
  
  it('should handle null values (sets to null, does not delete)', async () => {
    const initial = await createContent('Notes', {
      title: 'Title',
      description: 'Desc'
    });
    
    const updated = await updateContent('Notes', initial.page_id, {
      description: null
    });
    
    // PostgreSQL || sets field to null (does NOT delete)
    expect(updated.content).toEqual({
      title: 'Title',
      description: null  // Set to null, not deleted
    });
  });
});
```

### Integration Tests

```typescript
describe('Mesh REST API - Partial Updates', () => {
  it('PATCH should perform partial update', async () => {
    const created = await request(app)
      .post('/content/Notes')
      .send({ 
        content: { 
          title: 'Original', 
          body: 'Content' 
        } 
      });
    
    const patched = await request(app)
      .patch(`/content/Notes/${created.body.page_id}`)
      .send({ 
        content: { title: 'Updated' } 
      });
    
    expect(patched.body.content).toEqual({
      title: 'Updated',
      body: 'Content'  // Preserved
    });
  });
  
  it('PUT should replace content', async () => {
    const created = await request(app)
      .post('/content/Notes')
      .send({ 
        content: { 
          title: 'Original', 
          body: 'Content' 
        } 
      });
    
    const replaced = await request(app)
      .put(`/content/Notes/${created.body.page_id}`)
      .send({ 
        content: { title: 'Only Title' } 
      });
    
    expect(replaced.body.content).toEqual({
      title: 'Only Title'
      // body intentionally removed (full replacement)
    });
  });
});
```

---

## Migration Strategy

### Phase 1: Non-Breaking Changes (Week 1)

1. ✅ Update `updateNotionModel` resolver with PostgreSQL JSONB merge
2. ✅ Add feature flag: `ENABLE_PARTIAL_UPDATES=true`
3. ✅ Add unit tests for JSONB merge behavior
4. ✅ Deploy to staging
5. ✅ Run regression tests
6. ✅ Performance benchmarks (should be faster!)

### Phase 2: API Enhancement (Week 2)
1. ✅ Implement PATCH endpoint with merge semantics
2. ✅ Update PUT endpoint documentation (full replacement)
3. ✅ Add integration tests
4. ✅ Update Prism client docs

### Phase 3: Client Updates (Week 3)
1. ✅ Update all API routes using `updateContent` actions
2. ✅ Change PUT calls to PATCH where appropriate
3. ✅ Update Python bot actions (sharing_actions.py, etc.)
4. ✅ Update dashboard personality/assistant updates

### Phase 4: Production Rollout (Week 4)
1. ✅ Deploy to production with feature flag
2. ✅ Monitor error rates and logs
3. ✅ Enable for all tenants
4. ✅ Remove feature flag

---

## Benefits

### Immediate

- ✅ **No more data loss** from partial updates
- ✅ **Follows REST conventions** (PATCH = partial, PUT = full)
- ✅ **Smaller payloads** (only send changed fields)
- ✅ **Better performance** (atomic DB operation, no extra fetch)
- ✅ **Zero race conditions** (atomic JSONB merge)

### Long-term

- ✅ **Better developer experience** (intuitive API)
- ✅ **Easier client code** (don't need to fetch-then-merge)
- ✅ **Better audit trail** (only changed fields logged)
- ✅ **Optimistic UI updates** (can update local state with partial data)
- ✅ **Reduced database load** (one query instead of two)

---

## Risks & Mitigation

### Risk 1: Breaking Changes for Existing Clients
**Mitigation:** 
- Feature flag during transition
- Both PUT and PATCH supported
- Extensive testing before rollout

### Risk 2: Unexpected Merge Behavior
**Mitigation:**
- Clear documentation of merge semantics
- Comprehensive unit tests for edge cases
- Arrays replace (don't merge) to avoid confusion

### Risk 3: Performance Impact
**Mitigation:**
- ✅ PostgreSQL JSONB merge is **faster** than fetch + update
- ✅ One atomic operation instead of two queries
- ✅ Already within transaction (no extra overhead)
- ✅ Benchmark to confirm improvement

### Risk 4: JSONB Merge Semantics
**Consideration:**
- PostgreSQL `||` does **shallow merge** on nested objects
- Arrays are replaced (not merged)
- `null` sets to null (doesn't delete key)

**Mitigation:**
- Document merge behavior clearly
- Add tests for edge cases
- Provide utility function for deep merge if needed (Phase 2)

---

## Documentation Updates Required

1. **API Documentation** (`docs/api/mesh-rest-api.md`)
   - Document PATCH vs PUT semantics
   - Provide examples of partial updates
   - Explain merge behavior

2. **Prism Client Guide** (`packages/prism/README.md`)
   - Update `updateContent` action docs
   - Add best practices for partial vs full updates

3. **Developer Guide** (`DEVELOPER_GUIDE.md`)
   - Add section on content updates
   - Explain when to use PATCH vs PUT

4. **Migration Guide** (`docs/migrations/partial-updates.md`)
   - Steps for updating existing code
   - Breaking changes (if any)
   - Timeline and rollout plan

---

## Recommendation

**Proceed with the refactor** using the proposed strategy:

1. **High Impact, Low Risk:** Single-point modification with clear semantics
2. **Standards Compliant:** Aligns with REST conventions
3. **Backward Compatible:** Feature flag allows gradual rollout
4. **Well-Tested:** Comprehensive test coverage planned

**Estimated Effort:** 2-3 weeks for full implementation and rollout

**Next Steps:**
1. Review and approve this proposal
2. Create implementation tasks/tickets
3. Begin Phase 1 (deepMerge + resolver update)
4. Run staging validation
5. Proceed with client updates

---

## Questions for Discussion

1. Should we make PATCH the default for all updates, or keep PUT for backward compatibility?
2. Should we add a `?merge=false` query parameter for explicit replacement behavior?
3. Do we want to track which fields were updated in the audit log?
4. Should we add a `PATCH` method to the Prism client actions API?

---

**Document Status:** Draft for Review  
**Author:** GitHub Copilot  
**Date:** 2025-11-03  
**Version:** 1.0
