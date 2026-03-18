# Partial Update Implementation Plan

## Overview
Three-phase implementation to fix partial record updates across the entire stack, from database layer through application layers.

**Date:** November 3, 2025  
**Related Documents:**
- `PARTIAL_UPDATE_ANALYSIS.md` - Problem analysis and solution design
- `PARTIAL_UPDATE_REFACTOR_AUDIT.md` - Codebase audit results

---

## Phase 1: Database & Mesh API Layer

**Goal:** Fix core update mechanism at database level, ensure Mesh API properly handles PUT/PATCH operations

**Duration:** Week 1 (5-7 days)  
**Risk:** HIGH - Core infrastructure change  
**Testing Focus:** JSONB merge behavior, PUT vs PATCH semantics, edge cases

### 1.1 Database Layer Fix

**File:** `apps/mesh/src/resolvers/enhanced/NotionModelResolver.ts`  
**Function:** `updateNotionModel` (lines 744-810)

**Implementation:**
```typescript
import { literal } from 'sequelize';

updateNotionModel: async (
  _: any,
  { block_id, input }: { block_id: string; input: Partial<INotionModel> },
  context: any
) => {
  try {
    const isBotService = context?.serviceTrusted && context?.botControlTrusted;
    
    const updatedRecord = await NotionModel.sequelize!.transaction(async (transaction) => {
      // ✨ NEW: Build update object with JSONB merge for content field
      const updateFields: any = {};
      
      for (const [key, value] of Object.entries(input)) {
        if (key === 'content' && value !== null && value !== undefined) {
          // Use PostgreSQL's || operator for JSONB merge
          // This merges incoming content with existing content atomically
          updateFields.content = literal(`content || '${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`);
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
1. Import `literal` from sequelize
2. Check if updating `content` field specifically
3. Use `literal()` with PostgreSQL `||` operator for JSONB merge
4. Escape single quotes in JSON string
5. Remove fetch of originalRecord (no longer needed!)
6. Only one fetch after update for cache invalidation

**Testing Requirements:**
- Test shallow merge behavior
- Test nested object handling
- Test array replacement (not merge)
- Test null value handling
- Test concurrent updates
- Test empty update payload
- Test invalid JSONB

---

### 1.2 Mesh API Tests - PUT/PATCH Workflow

**File:** `apps/mesh/__tests__/partial-updates.test.ts` (NEW)

**Test Coverage:**
```typescript
describe('Partial Update Support - PostgreSQL JSONB Merge', () => {
  describe('Basic JSONB Merge Behavior', () => {
    it('should merge partial content updates atomically', async () => {
      // Create record with multiple fields
      const initial = await createContent('Notes', {
        title: 'Original Title',
        description: 'Original Description',
        tags: ['tag1', 'tag2'],
        metadata: { version: 1, author: 'user1' }
      });
      
      // Update only title
      const updated = await updateContent('Notes', initial.page_id, {
        title: 'Updated Title'
      });
      
      // Verify PostgreSQL || operator preserved all fields
      expect(updated.content).toEqual({
        title: 'Updated Title',      // Changed
        description: 'Original Description',  // Preserved
        tags: ['tag1', 'tag2'],      // Preserved
        metadata: { version: 1, author: 'user1' }  // Preserved
      });
    });
    
    it('should handle nested object updates (shallow merge)', async () => {
      const initial = await createContent('Notes', {
        metadata: { 
          version: 1, 
          author: 'user1', 
          tags: ['old'] 
        }
      });
      
      // Update metadata object
      const updated = await updateContent('Notes', initial.page_id, {
        metadata: { version: 2, tags: ['new'] }
      });
      
      // PostgreSQL || does SHALLOW merge on nested objects
      expect(updated.content.metadata).toEqual({
        version: 2,    // Updated
        author: 'user1',  // Preserved (shallow merge)
        tags: ['new']  // Replaced
      });
    });
    
    it('should replace arrays not merge them', async () => {
      const initial = await createContent('Notes', {
        tags: ['a', 'b', 'c']
      });
      
      const updated = await updateContent('Notes', initial.page_id, {
        tags: ['x', 'y']
      });
      
      // Arrays are replaced in JSONB || merge
      expect(updated.content.tags).toEqual(['x', 'y']);
    });
    
    it('should handle null values (sets to null, does not delete)', async () => {
      const initial = await createContent('Notes', {
        title: 'Title',
        description: 'Description'
      });
      
      const updated = await updateContent('Notes', initial.page_id, {
        description: null
      });
      
      // PostgreSQL || sets field to null (does NOT delete key)
      expect(updated.content).toEqual({
        title: 'Title',
        description: null  // Set to null, not deleted
      });
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle empty update payload', async () => {
      const initial = await createContent('Notes', {
        title: 'Title'
      });
      
      const updated = await updateContent('Notes', initial.page_id, {});
      
      expect(updated.content).toEqual(initial.content);
    });
    
    it('should handle updating non-content fields only', async () => {
      const initial = await createContent('Notes', {
        title: 'Title'
      });
      
      const updated = await updateContent('Notes', initial.page_id, {
        parent_id: 'new-parent',
        order: 5
      });
      
      expect(updated.parent_id).toBe('new-parent');
      expect(updated.order).toBe(5);
      expect(updated.content).toEqual(initial.content);
    });
    
    it('should handle concurrent updates correctly', async () => {
      const initial = await createContent('Notes', {
        count: 0,
        title: 'Initial'
      });
      
      // Simulate concurrent updates
      await Promise.all([
        updateContent('Notes', initial.page_id, { count: 1 }),
        updateContent('Notes', initial.page_id, { title: 'Updated' })
      ]);
      
      const final = await getContent('Notes', initial.page_id);
      
      // Last write wins for each field (JSONB merge is atomic per update)
      expect(final.content.count).toBeDefined();
      expect(final.content.title).toBeDefined();
    });
    
    it('should handle deeply nested object updates', async () => {
      const initial = await createContent('Notes', {
        config: {
          ui: {
            theme: 'dark',
            fontSize: 14
          },
          api: {
            timeout: 5000
          }
        }
      });
      
      const updated = await updateContent('Notes', initial.page_id, {
        config: {
          ui: {
            theme: 'light'
          }
        }
      });
      
      // Shallow merge: config.ui is replaced entirely
      expect(updated.content.config).toEqual({
        ui: { theme: 'light' },  // Replaced (fontSize lost)
        api: { timeout: 5000 }   // Preserved
      });
    });
    
    it('should handle special characters in JSON', async () => {
      const initial = await createContent('Notes', {
        title: 'Normal'
      });
      
      const updated = await updateContent('Notes', initial.page_id, {
        description: "It's a test with 'quotes' and \"double quotes\""
      });
      
      expect(updated.content.description).toBe("It's a test with 'quotes' and \"double quotes\"");
    });
    
    it('should handle unicode and emoji', async () => {
      const initial = await createContent('Notes', {
        title: 'Normal'
      });
      
      const updated = await updateContent('Notes', initial.page_id, {
        description: '🎉 Unicode test: café, naïve, 日本語'
      });
      
      expect(updated.content.description).toBe('🎉 Unicode test: café, naïve, 日本語');
    });
  });
  
  describe('PUT vs PATCH Semantics', () => {
    it('PUT should support partial updates (with merge)', async () => {
      // After our fix, PUT can do partial updates safely
      const initial = await createContent('Notes', {
        title: 'Original',
        description: 'Description',
        tags: ['tag1']
      });
      
      // PUT with partial data
      const updated = await putContent('Notes', initial.page_id, {
        title: 'Updated'
      });
      
      // Merge preserves other fields
      expect(updated.content.description).toBe('Description');
      expect(updated.content.tags).toEqual(['tag1']);
    });
    
    it('PATCH should explicitly support partial updates', async () => {
      const initial = await createContent('Notes', {
        title: 'Original',
        description: 'Description'
      });
      
      // PATCH with partial data (explicit merge semantics)
      const updated = await patchContent('Notes', initial.page_id, {
        title: 'Updated'
      });
      
      expect(updated.content.description).toBe('Description');
    });
  });
  
  describe('Performance & Atomicity', () => {
    it('should complete update in single transaction', async () => {
      const initial = await createContent('Notes', {
        title: 'Original'
      });
      
      // Monitor query count
      const queryCountBefore = getQueryCount();
      
      await updateContent('Notes', initial.page_id, {
        title: 'Updated'
      });
      
      const queryCountAfter = getQueryCount();
      
      // Should be: 1 UPDATE + 1 SELECT (for cache invalidation)
      expect(queryCountAfter - queryCountBefore).toBeLessThanOrEqual(2);
    });
    
    it('should not fetch before update', async () => {
      const initial = await createContent('Notes', {
        title: 'Original'
      });
      
      const queries = monitorQueries(async () => {
        await updateContent('Notes', initial.page_id, {
          title: 'Updated'
        });
      });
      
      // Should NOT have SELECT before UPDATE
      const selectBeforeUpdate = queries.findIndex(q => 
        q.type === 'SELECT' && 
        queries.findIndex(u => u.type === 'UPDATE') > queries.indexOf(q)
      );
      
      expect(selectBeforeUpdate).toBe(-1);
    });
  });
});
```

**Helper Functions:**
```typescript
async function createContent(type: string, content: any) {
  // Create via Prism/Mesh API
}

async function updateContent(type: string, id: string, updates: any) {
  // Update via PUT endpoint
}

async function patchContent(type: string, id: string, updates: any) {
  // Update via PATCH endpoint
}

async function getContent(type: string, id: string) {
  // Fetch via GET endpoint
}

function getQueryCount(): number {
  // Return total query count
}

function monitorQueries(fn: () => Promise<void>): Query[] {
  // Monitor and return all queries executed
}
```

---

### 1.3 Mesh API Enhancement - Add PATCH Endpoint

**File:** `apps/mesh/src/api/contentApi.ts`  
**Lines:** After PUT endpoint (~430)

**Add PATCH endpoint:**
```typescript
/**
 * PATCH /content/:type/:id - Partial update (explicit merge semantics)
 * Unlike PUT which historically implied full replacement, PATCH explicitly
 * indicates partial updates with merge behavior
 */
router.patch('/content/:type/:id', async (req: Request, res: Response) => {
  try {
    const { type, id } = req.params;
    const tenant = getTenantId(req);
    
    log('PATCH [/content/:type/:id] request:', { type, id, tenant, body: req.body });

    // TODO: Add content update authorization (same as PUT)
    
    const content = req.body?.content;
    if (!type || !id || !content) {
      console.error('PATCH [/content/:type/:id] Missing type, id or content');
      return fail(res, 400, 'Missing type, id or content');
    }
    
    const prism = await Prism.getInstance();
    
    // Verify existence (optional - update will fail anyway)
    const existing = await prism.query({ 
      contentType: type, 
      tenantId: tenant, 
      where: { page_id: { eq: id } }, 
      limit: 1 
    });
    
    if (existing.total === 0) {
      console.error(`PATCH [/content/:type/:id] Content not found: ${id}`);
      return fail(res, 404, `Content not found: ${id}`);
    }
    
    // Perform partial update with JSONB merge
    const updated = await prism.update(type, id, content, tenant);
    
    if (updated.total === 0) {
      console.error('PATCH [/content/:type/:id] Update failed');
      return fail(res, 500, 'Failed to update content');
    }
    
    return ok(res, updated.items[0]);
  } catch (error: any) {
    console.error('PATCH [/content/:type/:id] Error:', error);
    return fail(res, 500, `Failed to update content: ${error.message}`);
  }
});
```

---

### 1.4 Feature Flag

**File:** `apps/mesh/.env.example`

```bash
# Partial update support (PostgreSQL JSONB merge)
ENABLE_PARTIAL_UPDATES=true
```

**Usage in resolver:**
```typescript
updateNotionModel: async (...) => {
  const usePartialUpdates = process.env.ENABLE_PARTIAL_UPDATES !== 'false';
  
  if (usePartialUpdates) {
    // Use new JSONB merge logic
  } else {
    // Fall back to old fetch + replace logic
  }
}
```

---

### 1.5 Phase 1 Checklist

- [ ] Implement PostgreSQL `||` operator in `NotionModelResolver.updateNotionModel`
- [ ] Add `literal` import from sequelize
- [ ] Handle quote escaping in JSON strings
- [ ] Remove originalRecord fetch (only keep post-update fetch)
- [ ] Create `apps/mesh/__tests__/partial-updates.test.ts`
- [ ] Write 20+ test cases covering merge behavior
- [ ] Add edge case tests (empty, concurrent, special chars)
- [ ] Add performance/atomicity tests
- [ ] Implement PATCH endpoint in `contentApi.ts`
- [ ] Add feature flag `ENABLE_PARTIAL_UPDATES`
- [ ] Test in local environment
- [ ] Deploy to staging with flag enabled
- [ ] Monitor staging for 48 hours
- [ ] Run load tests comparing before/after performance
- [ ] Document JSONB merge semantics in API docs

**Success Criteria:**
- ✅ All tests pass (20+ cases)
- ✅ No extra SELECT before UPDATE in queries
- ✅ Update latency improves by 20-40%
- ✅ No data loss in staging for 48 hours
- ✅ Concurrent updates handled correctly

---

## Phase 2: Prism Package Layer

**Goal:** Optimize Prism package to remove redundant fetches, add partial update tests

**Duration:** Week 2 (5-7 days)  
**Risk:** MEDIUM - Business logic layer  
**Testing Focus:** Prism actions, business rules, authorization

### 2.1 Prism Core - Remove Redundant Fetch

**File:** `packages/prism/src/prism.ts`  
**Function:** `update` (lines 175-208)

**Current Implementation:**
```typescript
async update(blockType: string, page_id: string, data: ContentData, tenantId?: string) {
  // Find content first
  const existingResult = await this.client.findContent(blockType, where, ...);
  if (existingResult.total === 0) {
    throw new Error(`Content not found with id: ${page_id}`);
  }
  
  const processedData = this.applyBusinessRules(data, blockType, tenantId);
  const blockId = existingResult.items[0].block_id;
  
  return await this.client.updateContent(blockId, blockType, processedData, ...);
}
```

**Optimized Implementation:**
```typescript
async update(blockType: string, page_id: string, data: ContentData, tenantId?: string) {
  // Apply business rules to incoming data
  const processedData = this.applyBusinessRules(data, blockType, tenantId);
  
  // Option A: Optimistic update (try update first, resolve block_id from page_id)
  // GraphQL mutation uses page_id, resolver looks up block_id internally
  const result = await this.client.updateContent(
    page_id,  // Use page_id directly
    blockType, 
    processedData,
    undefined, // block_id resolved in resolver
    undefined, // parent_id
    undefined, // order
    tenantId
  );
  
  if (result.total === 0) {
    throw new Error(`Content not found with id: ${page_id}`);
  }
  
  return this.applyBusinessLogic(result);
}
```

**Alternative (if GraphQL requires block_id):**
```typescript
async update(blockType: string, page_id: string, data: ContentData, tenantId?: string) {
  const processedData = this.applyBusinessRules(data, blockType, tenantId);
  
  // Try update with page_id → block_id lookup in single resolver call
  try {
    const result = await this.client.updateContentByPageId(
      page_id,
      blockType,
      processedData,
      tenantId
    );
    return this.applyBusinessLogic(result);
  } catch (error) {
    if (error.message.includes('not found')) {
      throw new Error(`Content not found with id: ${page_id}`);
    }
    throw error;
  }
}
```

---

### 2.2 Action Layer Optimizations

**Files to Update:**

#### 2.2.1 Global Settings (Simple)
**File:** `packages/prism/src/core/actions/globalSettings-actions.ts`

```typescript
// BEFORE:
const updatePayload: IGlobalSettings = {
  ...existing,
  interfaceLogin: mergedInterfaceLogin,
};

// AFTER:
const updatePayload = {
  interfaceLogin: mergedInterfaceLogin,
  singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY,
};
```

#### 2.2.2 Assistant Feedback (Simple)
**File:** `packages/prism/src/core/actions/assistant-feedback-actions.ts`

```typescript
// BEFORE:
const existingAssistantFeedback = await getAssistantFeedbackById(assistantFeedbackId);
const mergedData = {
  ...existingAssistantFeedback,
  ...updateData,
};

// AFTER:
const updated = await prism.update(
  BlockType_AssistantFeedback, 
  assistantFeedbackId, 
  updateData,  // Direct partial update
  'any'
);
```

#### 2.2.3 User Profile (Complex - Keep Partial Fetch)
**File:** `packages/prism/src/core/actions/userProfile-actions.ts`

```typescript
// BEFORE:
const updatedRecord: any = { ...existing };
if (first_name) updatedRecord.first_name = first_name;
// ... etc

// AFTER:
const updatePayload: any = {};
if (first_name) updatePayload.first_name = first_name;
if (normalizedEmail) updatePayload.email = normalizedEmail;
if (userId) updatePayload.userId = userId;
if (mergedMetadata !== undefined) updatePayload.metadata = mergedMetadata;

// Handle field deletion (if needed later with jsonb_set)
if (removeUserId) {
  updatePayload.userId = null;
}

await prism.update(UserProfileDefinition.dataModel.block, existing._id, updatePayload);
```

#### 2.2.4 Assistant Actions (Special Case - Keep Minimal Fetch)
**File:** `packages/prism/src/core/actions/assistant-actions.ts`

```typescript
// BEFORE:
const existingAssistant = result.items[0];
const updateData: any = {
  ...existingAssistant,
  ...assistantData,
};

// AFTER:
// Minimal fetch only for special logic
const result = await prism.query(query);
const existingName = result.items[0]?.name;
const tenantId = result.items[0]?.tenantId || 'any';

// Only add subDomain if name changed
const updateData: any = { ...assistantData };
if (assistantData.name && assistantData.name !== existingName) {
  updateData.subDomain = generateSubDomain(assistantData.name);
}

const updated = await prism.update(BlockType_Assistant, assistantId, updateData, tenantId);
```

---

### 2.3 Prism Package Tests

**File:** `packages/prism/__tests__/partial-updates-prism.test.ts` (NEW)

```typescript
describe('Prism Package - Partial Updates', () => {
  describe('Core Update Method', () => {
    it('should update without pre-fetching record', async () => {
      const prism = await Prism.getInstance();
      
      const created = await prism.create('Notes', {
        title: 'Original',
        description: 'Description'
      });
      
      const queries = monitorQueries(async () => {
        await prism.update('Notes', created._id, {
          title: 'Updated'
        });
      });
      
      // Should NOT have SELECT before UPDATE
      const selectQueries = queries.filter(q => q.includes('SELECT'));
      const updateQueries = queries.filter(q => q.includes('UPDATE'));
      
      expect(selectQueries.length).toBeLessThanOrEqual(1); // Only post-update fetch
      expect(updateQueries.length).toBe(1);
    });
    
    it('should apply business rules before update', async () => {
      // Test that business rules are still applied
    });
    
    it('should throw error for non-existent content', async () => {
      const prism = await Prism.getInstance();
      
      await expect(
        prism.update('Notes', 'non-existent-id', { title: 'Updated' })
      ).rejects.toThrow('Content not found');
    });
  });
  
  describe('Action Layer Optimizations', () => {
    it('globalSettings: should update without spread', async () => {
      // Test simplified globalSettings update
    });
    
    it('assistantFeedback: should update without pre-fetch', async () => {
      // Test direct update
    });
    
    it('userProfile: should build update payload directly', async () => {
      // Test conditional update payload building
    });
    
    it('assistant: should only fetch for special logic', async () => {
      // Test minimal fetch for subDomain logic
    });
  });
  
  describe('Authorization Integration', () => {
    it('should preserve authorization checks', async () => {
      // Ensure auth still works without spread merges
    });
  });
});
```

---

### 2.4 Phase 2 Checklist

- [ ] Optimize `packages/prism/src/prism.ts` update method
- [ ] Update `globalSettings-actions.ts` (remove spread)
- [ ] Update `assistant-feedback-actions.ts` (remove pre-fetch)
- [ ] Update `userProfile-actions.ts` (build payload directly)
- [ ] Update `assistant-actions.ts` (minimal fetch only)
- [ ] Create `packages/prism/__tests__/partial-updates-prism.test.ts`
- [ ] Write tests for each optimized action
- [ ] Test business rule application
- [ ] Test authorization preservation
- [ ] Run full Prism test suite
- [ ] Update Prism documentation
- [ ] Deploy to staging
- [ ] Monitor for regressions

**Success Criteria:**
- ✅ All Prism tests pass
- ✅ Business rules still applied correctly
- ✅ Authorization checks preserved
- ✅ No regressions in existing features
- ✅ Query count reduced in monitored actions

---

## Phase 3: Application Layer Optimizations

**Goal:** Update application layers to use partial updates correctly, add comprehensive tests

**Duration:** Week 3-4 (10 days)  
**Risk:** LOW - Application code, uses Prism APIs  
**Testing Focus:** Feature-specific workflows, integration tests

### Phase 3.a: Pipecat Daily Bot (Python)

**Status:** ✅ No changes needed

**Analysis:** Python bot does not directly perform updates with pre-fetch patterns. All updates flow through TypeScript Prism actions.

**Validation:**
- [ ] Audit bot code for any direct Prism calls
- [ ] Ensure bot uses Prism action APIs correctly
- [ ] Add bot integration tests for content updates
- [ ] Monitor bot update operations in staging

---

### Phase 3.b: Interface Application

**Files to Update:**

#### 3.b.1 HTML Generation Actions
**File:** `apps/interface/src/features/HtmlGeneration/actions/html-generation-actions.ts`

```typescript
// BEFORE:
const existingContent = await findHtmlContentById(contentId, tenantId);
const updateData = {
  ...existingContent,
  ...updates,
};

// AFTER:
const existingContent = await findHtmlContentById(contentId, tenantId);
// Keep auth check
if (existingContent.createdBy !== session.user.id) {
  throw new Error('Unauthorized');
}

// Direct partial update
const updateData = {
  ...updates,
  updatedAt: new Date().toISOString()
};
```

#### 3.b.2 Notes Actions
**Status:** ✅ Already optimized (reference example)

**File:** `apps/interface/src/features/Notes/actions/notes-actions.ts`  
**No changes needed** - Already implements partial updates correctly!

#### 3.b.3 Applet Storage Actions
**Status:** ✅ Already optimized (reference example)

**File:** `apps/interface/src/features/HtmlGeneration/actions/applet-storage-actions.ts`  
**No changes needed** - Already implements partial updates correctly!

#### 3.b.4 API Routes
**File:** `apps/interface/src/app/api/applet-api/route.ts`

**Status:** ⚠️ Keep authorization check, ensure underlying action uses partial update

```typescript
// handleUpdateOperation - Keep as-is (auth check is valid)
const existingResult = await findAppletStorage(existingQuery, tenantId);
if (existingData.userId !== userId) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// updateAppletStorage already uses partial updates ✅
const result = await updateAppletStorage(dataId, data, tenantId, userId);
```

---

### Phase 3.c: Dashboard Application

**Files to Update:**

#### 3.c.1 Photo Upload Route
**File:** `apps/dashboard/src/app/api/upload-photos/route.ts`

```typescript
// BEFORE:
const existingPhoto = items.items[0];
const updateData = {
  ...existingPhoto,
  ...photoData
};

// AFTER:
const existingPhoto = items.items[0];
// Direct partial update
const updated = await prism.update(
  contentType, 
  existingPhoto._id!, 
  photoData,  // No spread needed
  tenantId
);
```

#### 3.c.2 Migration Actions
**Status:** ℹ️ Migration code, one-time use

**Note:** Migration actions in `apps/dashboard/src/migration/actions/` use Mongoose `findByIdAndUpdate` which is MongoDB-specific. These are legacy migration utilities and don't affect the production Prism/Mesh flow.

**Decision:** Leave as-is (migration code, not production path)

---

### 3.3 Integration Tests

**File:** `tests/integration/partial-updates-e2e.test.ts` (NEW)

```typescript
describe('End-to-End Partial Updates', () => {
  describe('Interface → Prism → Mesh → Database', () => {
    it('should update note via interface action', async () => {
      const session = await getTestSession();
      const tenantId = session.user.tenantId;
      
      // Create via interface
      const note = await createNote({
        title: 'Test Note',
        content: 'Original content',
        tags: ['tag1']
      }, tenantId);
      
      // Update via interface
      const updated = await updateNote(note._id, {
        title: 'Updated Title'
      }, tenantId);
      
      // Verify merge
      expect(updated.title).toBe('Updated Title');
      expect(updated.content).toBe('Original content');
      expect(updated.tags).toEqual(['tag1']);
    });
    
    it('should update HTML content with authorization', async () => {
      // Test HTML generation update flow
    });
    
    it('should update applet storage with ownership check', async () => {
      // Test applet storage update flow
    });
  });
  
  describe('Dashboard → Prism → Mesh → Database', () => {
    it('should update photo album', async () => {
      // Test photo upload/update flow
    });
  });
  
  describe('Bot → Prism → Mesh → Database', () => {
    it('should update note via bot service', async () => {
      // Test bot update flow
    });
  });
  
  describe('Performance Regression', () => {
    it('should complete updates faster than baseline', async () => {
      const iterations = 100;
      
      const baseline = await measureUpdateTime(iterations, 'before');
      const optimized = await measureUpdateTime(iterations, 'after');
      
      // Should be 20-40% faster
      expect(optimized).toBeLessThan(baseline * 0.8);
    });
  });
});
```

---

### 3.4 Phase 3 Checklist

**Phase 3.a: Bot**
- [ ] Audit bot code for direct Prism calls
- [ ] Validate bot uses Prism actions correctly
- [ ] Add bot integration tests
- [ ] Monitor bot operations in staging

**Phase 3.b: Interface**
- [ ] Update `html-generation-actions.ts` (keep auth, remove spread)
- [ ] Validate `notes-actions.ts` (already optimized)
- [ ] Validate `applet-storage-actions.ts` (already optimized)
- [ ] Review `applet-api/route.ts` (auth check valid)
- [ ] Add interface integration tests
- [ ] Test HTML generation feature end-to-end
- [ ] Test notes feature end-to-end
- [ ] Test applet storage end-to-end

**Phase 3.c: Dashboard**
- [ ] Update `upload-photos/route.ts` (remove spread)
- [ ] Review migration actions (leave as-is)
- [ ] Add dashboard integration tests
- [ ] Test photo upload feature end-to-end

**Integration Testing**
- [ ] Create `tests/integration/partial-updates-e2e.test.ts`
- [ ] Write 15+ end-to-end scenarios
- [ ] Test all application → Prism → Mesh flows
- [ ] Add performance regression tests
- [ ] Run full integration test suite

**Success Criteria:**
- ✅ All application tests pass
- ✅ Integration tests cover key workflows
- ✅ Performance improvement measured
- ✅ No regressions in features
- ✅ Authorization still works correctly

---

## Rollout Strategy

### Week 1: Phase 1 (Database & Mesh)
- Days 1-3: Implement & test database layer
- Days 4-5: Add Mesh API tests & PATCH endpoint
- Weekend: Deploy to staging, monitor

### Week 2: Phase 2 (Prism)
- Days 1-3: Optimize Prism core & actions
- Days 4-5: Add Prism package tests
- Weekend: Deploy to staging, monitor

### Week 3-4: Phase 3 (Applications)
- Days 1-2: Bot validation
- Days 3-5: Interface updates & tests
- Days 6-8: Dashboard updates & tests
- Days 9-10: Integration tests & performance validation

### Week 5: Production Rollout
- Day 1: Final staging validation
- Day 2: Deploy to production (10% traffic)
- Day 3: Monitor, increase to 50%
- Day 4-5: Monitor, increase to 100%
- Week 6: Remove feature flag, cleanup old code

---

## Success Metrics

### Performance
- ✅ Update latency reduced by 20-40%
- ✅ Query count per update reduced by 50%
- ✅ Transaction duration reduced by 30%
- ✅ Database CPU usage reduced by 15%

### Reliability
- ✅ Zero data loss incidents
- ✅ Concurrent update conflicts reduced
- ✅ Error rate unchanged or improved
- ✅ Cache hit rate maintained or improved

### Code Quality
- ✅ 150+ new tests added
- ✅ Test coverage increased by 10%
- ✅ Code complexity reduced in 11 files
- ✅ Technical debt items resolved

---

## Monitoring & Alerts

### Key Metrics to Watch
1. **Update latency** (p50, p95, p99)
2. **Query count per update** (SELECT, UPDATE)
3. **Error rate** for update operations
4. **Data consistency** checks
5. **Cache invalidation** success rate

### Alerts to Configure
- Update latency > 500ms (p95)
- Error rate > 1% for updates
- Data inconsistency detected
- Query count anomaly (> 3 queries per update)

---

## Rollback Plan

### Phase 1 Rollback
```bash
# Disable feature flag
export ENABLE_PARTIAL_UPDATES=false
# Restart Mesh server
pm2 restart mesh
```

### Phase 2/3 Rollback
```bash
# Revert code changes
git revert <commit-sha>
# Deploy previous version
npm run deploy:staging
```

### Emergency Rollback
```bash
# Full rollback to last stable version
git checkout <last-stable-tag>
npm run deploy:all
```

---

## Documentation Updates

- [ ] Update API documentation (PUT vs PATCH semantics)
- [ ] Document JSONB merge behavior
- [ ] Add examples to developer guide
- [ ] Update troubleshooting guide
- [ ] Create runbook for operations team
- [ ] Update architecture diagrams

---

## Team Communication

### Before Each Phase
- Team meeting to review plan
- Risk assessment discussion
- Assignment of tasks
- Timeline confirmation

### During Each Phase
- Daily standups
- Slack updates on progress
- Pair programming sessions
- Code review coordination

### After Each Phase
- Retrospective meeting
- Documentation of lessons learned
- Performance results sharing
- Decision on phase completion

---

**Next Step:** Start Phase 1 implementation! 🚀
