# Partial Update Refactor - Codebase Audit

## Overview
This document identifies all locations in the codebase where we pre-fetch records before updating them. With the PostgreSQL native JSONB merge fix (using `||` operator), these pre-fetches are now redundant and should be removed for better performance and atomicity.

**Date:** November 3, 2025  
**Related:** PARTIAL_UPDATE_ANALYSIS.md

---

## Critical Path: Core Update Implementation

### 1. ✅ Database Layer (Already Fixed in Analysis)
**File:** `apps/mesh/src/resolvers/enhanced/NotionModelResolver.ts`  
**Lines:** 744-810  
**Current Status:** Uses pre-fetch within transaction for merge  
**Action Required:** Implement PostgreSQL `||` operator (as documented in PARTIAL_UPDATE_ANALYSIS.md)

```typescript
// CURRENT (Lines 762-785):
const originalRecord = await NotionModel.findOne({
  where: { block_id },
  transaction
});

if (!originalRecord) {
  throw new Error(`NotionModel with block_id ${block_id} not found`);
}

// ✨ Perform deep merge logic here
const processedInput = { ...input };
// ... merge logic ...

const [affectedCount] = await NotionModel.update(processedInput, {
  where: { block_id },
  transaction
});

// RECOMMENDED: Remove fetch, use PostgreSQL || operator
updateFields.content = literal(`content || '${JSON.stringify(value)}'::jsonb`);
```

**Impact:** HIGH - Eliminates fetch from critical path, improves atomicity  
**Effort:** 2-3 hours (implementation + tests)  
**Tests Affected:** `apps/mesh/__tests__/partial-updates.test.ts` (need to create)

---

## TypeScript Application Layer

### 2. 🔴 Assistant Actions - Spread Merge Pattern
**File:** `packages/prism/src/core/actions/assistant-actions.ts`  
**Function:** `updateAssistant`  
**Lines:** 358-398  

**Current Implementation:**
```typescript
const result = await prism.query(query);
const existingAssistant = result.items[0];

// Merge existing + incoming data
const updateData: any = {
  ...existingAssistant,  // ← Redundant fetch + spread
  ...assistantData,
};

// Special logic for subDomain regeneration
if (assistantData.name && assistantData.name !== existingAssistant.name) {
  // ... subDomain logic requires existingAssistant.name
}

const updated = await prism.update(BlockType_Assistant, assistantId, updateData, existingAssistant.tenantId);
```

**Analysis:**
- ❌ Pre-fetch for full record spread
- ⚠️ **SPECIAL CASE:** subDomain logic requires `existingAssistant.name` for comparison
- ⚠️ Uses `existingAssistant.tenantId` in update call

**Recommendation:**
```typescript
// Option A: Keep minimal fetch only for special logic
const existingResult = await prism.query({
  contentType: BlockType_Assistant,
  where: { page_id: assistantId },
  limit: 1
});

const existingName = existingResult.items[0]?.name;
const tenantId = existingResult.items[0]?.tenantId;

// Only add subDomain if name changed
if (assistantData.name && assistantData.name !== existingName) {
  assistantData.subDomain = generateSubDomain(assistantData.name);
}

// Direct update (no spread merge)
const updated = await prism.update(BlockType_Assistant, assistantId, assistantData, tenantId);

// Option B: Move subDomain logic to database trigger or resolver
// Then eliminate fetch entirely
```

**Impact:** MEDIUM - High-traffic endpoint  
**Effort:** 2 hours (handle special cases)  
**Tests:** `packages/prism/__tests__/assistant-actions.test.ts`

---

### 3. 🔴 Global Settings - Upsert with Merge
**File:** `packages/prism/src/core/actions/globalSettings-actions.ts`  
**Function:** `upsertGlobalSettings`  
**Lines:** 86-119  

**Current Implementation:**
```typescript
const existing = await queryGlobalSettings(prism);

if (existing && existing._id) {
  const updatePayload: IGlobalSettings = {
    ...existing,  // ← Redundant spread
    interfaceLogin: mergedInterfaceLogin,
    singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY,
  };
  const updated = await prism.update(BlockType_GlobalSettings, existing._id, updatePayload, 'any');
}
```

**Analysis:**
- ❌ Pre-fetch for full record spread
- ⚠️ This is a singleton record (low frequency)
- ℹ️ `mergedInterfaceLogin` is already a nested merge

**Recommendation:**
```typescript
// Simplified - only update what changed
if (existing && existing._id) {
  const updatePayload = {
    interfaceLogin: mergedInterfaceLogin,
    singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY,
  };
  const updated = await prism.update(BlockType_GlobalSettings, existing._id, updatePayload, 'any');
  // PostgreSQL || will preserve other fields
}
```

**Impact:** LOW - Singleton, infrequent updates  
**Effort:** 30 minutes  
**Tests:** `packages/prism/__tests__/globalSettings-actions.test.ts`

---

### 4. 🔴 Functional Prompt - History Tracking Pattern
**File:** `packages/prism/src/core/actions/functionalPrompt-actions.ts`  
**Function:** `createOrUpdate`  
**Lines:** 85-132  

**Current Implementation:**
```typescript
const existing = await findByFeatureKey(featureKey);

if (existing) {
  // Generate diff from existing.promptContent
  const delta = generateDiff(existing.promptContent, promptContent, featureKey);
  
  const historyEntry: IFunctionalPromptHistoryEntry = {
    userId: lastModifiedByUserId || 'system',
    delta,
    modifiedAt: new Date().toISOString()
  };
  
  const updatedHistory = [...(existing.history || []), historyEntry];
  
  const updated = {
    ...existing,  // ← Redundant spread
    promptContent,
    lastModifiedByUserId,
    history: updatedHistory,
    updatedAt: new Date().toISOString()
  };
  
  await prism.update(FunctionalPromptDefinition.dataModel.block, existing._id!, updated);
}
```

**Analysis:**
- ❌ Pre-fetch for diff generation and history append
- ⚠️ **SPECIAL CASE:** Requires `existing.promptContent` for diff
- ⚠️ **SPECIAL CASE:** Requires `existing.history` for append

**Recommendation:**
```typescript
// Keep minimal fetch for business logic
const existing = await findByFeatureKey(featureKey);

if (existing) {
  const delta = generateDiff(existing.promptContent, promptContent, featureKey);
  const historyEntry = { /* ... */ };
  
  // PostgreSQL jsonb_set for nested array append
  // OR: Send partial update with history array
  const updated = {
    promptContent,
    lastModifiedByUserId,
    history: [...(existing.history || []), historyEntry],  // Still need existing array
    updatedAt: new Date().toISOString()
  };
  
  await prism.update(/* ... */, updated);
}
```

**Decision:** **KEEP FETCH** - Business logic requires existing data for diff/history  
**Alternative:** Move diff generation to database layer (trigger/function)  
**Impact:** MEDIUM - Version tracking feature  
**Effort:** Consider refactor if frequent updates

---

### 5. 🟡 Assistant Feedback - Safety Merge
**File:** `packages/prism/src/core/actions/assistant-feedback-actions.ts`  
**Function:** `updateAssistantFeedback`  
**Lines:** 70-96  

**Current Implementation:**
```typescript
const existingAssistantFeedback = await getAssistantFeedbackById(assistantFeedbackId);
if (!existingAssistantFeedback) {
  throw new Error('AssistantFeedback not found');
}

const mergedData = {
  ...existingAssistantFeedback,  // ← Defensive spread
  ...updateData,
  _id: assistantFeedbackId
};

const updated = await prism.update(BlockType_AssistantFeedback, assistantFeedbackId, mergedData, 'any');
```

**Analysis:**
- ❌ Pre-fetch for existence check and spread merge
- ℹ️ Existence check is legitimate, but can fail at update
- ℹ️ `_id` preservation is unnecessary (update uses ID parameter)

**Recommendation:**
```typescript
// Simplified - let update fail naturally if not found
const updated = await prism.update(
  BlockType_AssistantFeedback, 
  assistantFeedbackId, 
  updateData,  // No spread needed
  'any'
);

if (!updated || updated.total === 0) {
  throw new Error('AssistantFeedback not found');
}
```

**Impact:** LOW - Feedback is infrequent  
**Effort:** 15 minutes  
**Tests:** `packages/prism/__tests__/assistant-feedback-actions.test.ts`

---

### 6. 🟡 User Profile - Complex Merge Logic
**File:** `packages/prism/src/core/actions/userProfile-actions.ts`  
**Function:** `saveOrUpdateUserProfileRecord`  
**Lines:** 330-365  

**Current Implementation:**
```typescript
// Update path
const updatedRecord: any = { ...existing };  // ← Spread existing
if (first_name) updatedRecord.first_name = first_name;
if (normalizedEmail) updatedRecord.email = normalizedEmail;
if (userId) updatedRecord.userId = userId;
if (mergedMetadata !== undefined) updatedRecord.metadata = mergedMetadata;

if (removeUserId) {
  delete updatedRecord.userId;
}

await prism.update(UserProfileDefinition.dataModel.block, updatedRecord._id, updatedRecord);
```

**Analysis:**
- ❌ Spreads existing then conditionally overwrites fields
- ⚠️ `mergedMetadata` is already merged from `existing.metadata`
- ℹ️ Complex conditional logic for field updates

**Recommendation:**
```typescript
// Build update payload directly
const updatePayload: any = {};
if (first_name) updatePayload.first_name = first_name;
if (normalizedEmail) updatePayload.email = normalizedEmail;
if (userId) updatePayload.userId = userId;
if (mergedMetadata !== undefined) updatePayload.metadata = mergedMetadata;

// Handle field deletion separately (if needed)
if (removeUserId) {
  updatePayload.userId = null;  // PostgreSQL || will set to null
}

await prism.update(UserProfileDefinition.dataModel.block, existing._id, updatePayload);
```

**Impact:** MEDIUM - User profile updates moderately frequent  
**Effort:** 1 hour  
**Tests:** `packages/prism/__tests__/userProfile-actions.test.ts`

---

### 7. 🔴 HTML Generation - Authorization Check + Spread
**File:** `apps/interface/src/features/HtmlGeneration/actions/html-generation-actions.ts`  
**Function:** `updateHtmlContent`  
**Lines:** 260-286  

**Current Implementation:**
```typescript
const existingContent = await findHtmlContentById(contentId, tenantId);
if (!existingContent) {
  throw new Error('Content not found');
}

if (existingContent.createdBy !== session.user.id) {
  throw new Error('Unauthorized to update this content');
}

const updateData = {
  ...existingContent,  // ← Spread merge
  ...updates,
  updatedAt: new Date().toISOString()
};

await prism.update(HtmlGenerationDefinition.dataModel.block, contentId, updateData, tenantId);
```

**Analysis:**
- ❌ Pre-fetch for authorization check and spread
- ⚠️ Authorization is legitimate concern
- ℹ️ `updatedAt` should be handled by system, not client

**Recommendation:**
```typescript
// Keep minimal fetch for authorization only
const existingContent = await findHtmlContentById(contentId, tenantId);
if (!existingContent) {
  throw new Error('Content not found');
}

if (existingContent.createdBy !== session.user.id) {
  throw new Error('Unauthorized to update this content');
}

// Direct update - no spread needed
const updatePayload = {
  ...updates,
  updatedAt: new Date().toISOString()  // System timestamp
};

await prism.update(HtmlGenerationDefinition.dataModel.block, contentId, updatePayload, tenantId);
```

**Impact:** MEDIUM - HTML generation feature  
**Effort:** 30 minutes  
**Tests:** `apps/interface/src/features/HtmlGeneration/__tests__/html-generation-actions.test.ts`

---

### 8. 🟢 Notes Feature - Clean Partial Update (Good Example!)
**File:** `apps/interface/src/features/Notes/actions/notes-actions.ts`  
**Function:** `updateNote`  
**Lines:** 410-470  

**Current Implementation:**
```typescript
export async function updateNote(noteId: string, noteData: UpdateNoteParams, tenantId: string) {
  // Apply business logic
  noteData = await applyBusinessLogic(noteData as Note);

  // Update normalizedTitle if title changed
  if ((noteData as any).title) {
    (noteData as any).normalizedTitle = (noteData as any).title.trim().toLowerCase();
  }

  const prism = await Prism.getInstance();
  const updated = await prism.update(NotesDefinition.dataModel.block, noteId, noteData, tenantId);
  
  if (!updated || updated.total === 0 || updated.items.length === 0) {
    throw new Error('Failed to update note');
  }
  return updated.items[0] as unknown as Note;
}
```

**Analysis:**
- ✅ **NO PRE-FETCH** - Already implements partial update correctly!
- ✅ Only applies business logic transformations
- ✅ Sends partial data directly to update

**Action:** **NO CHANGES NEEDED** - Use as reference pattern  
**Impact:** N/A - Already optimized  
**Note:** This is the pattern we want everywhere!

---

### 9. 🟢 Applet Storage - Clean Partial Update (Good Example!)
**File:** `apps/interface/src/features/HtmlGeneration/actions/applet-storage-actions.ts`  
**Function:** `updateAppletStorage`  
**Lines:** 140-160  

**Current Implementation:**
```typescript
export async function updateAppletStorage(
  dataId: string,
  data: unknown,
  tenantId: string,
  userId?: string
): Promise<Record<string, unknown>> {
  const updatedRecord: Record<string, unknown> = {
    data,
    updatedAt: new Date().toISOString()
  };

  if (userId) {
    updatedRecord.userId = userId;
  }

  return await ContentActions.updateContent(
    AppletStorageDefinition.dataModel.block,
    dataId,
    updatedRecord,
    tenantId
  );
}
```

**Analysis:**
- ✅ **NO PRE-FETCH** - Builds partial update payload directly
- ✅ Only includes fields being updated
- ℹ️ Note: API route does pre-fetch for authorization (see #10)

**Action:** **NO CHANGES NEEDED**  
**Impact:** N/A

---

### 10. 🔴 Applet API Route - Authorization Check
**File:** `apps/interface/src/app/api/applet-api/route.ts`  
**Function:** `handleUpdateOperation`  
**Lines:** 230-288  

**Current Implementation:**
```typescript
// Verify ownership
const existingResult = await findAppletStorage(existingQuery, tenantId);
if (!existingResult || existingResult.total === 0) {
  return NextResponse.json({ error: 'Data not found' }, { status: 404 });
}

const existingData = existingResult.items[0];
if (existingData.userId !== userId) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// Update
const result = await updateAppletStorage(dataId, data, tenantId, userId);
```

**Analysis:**
- ⚠️ Pre-fetch for authorization check (legitimate)
- ℹ️ `updateAppletStorage` does NOT spread existing data
- ✅ Authorization pattern is necessary at API boundary

**Recommendation:** **KEEP AS-IS** - Authorization check is valid use case  
**Alternative:** Move authorization to resolver/middleware layer  
**Impact:** N/A  
**Note:** This is acceptable pattern for API routes

---

### 11. 🔴 Photo Upload Route - Upsert Pattern
**File:** `apps/dashboard/src/app/api/upload-photos/route.ts`  
**Lines:** 95-115  

**Current Implementation:**
```typescript
const items = await ContentActions.findContent({
  contentType: contentType,
  tenantId: tenantId,
  where: where,
});

if (items && items.items && items.items.length > 0) {
  const existingPhoto = items.items[0];
  const updateData = {
    ...existingPhoto,  // ← Spread merge
    ...photoData
  };
  const updated = await prism.update(contentType, existingPhoto._id!, updateData, tenantId);
}
```

**Analysis:**
- ❌ Pre-fetch for upsert logic with spread
- ℹ️ Upsert: create if missing, update if exists

**Recommendation:**
```typescript
if (items && items.items && items.items.length > 0) {
  const existingPhoto = items.items[0];
  // Direct update - no spread
  const updated = await prism.update(
    contentType, 
    existingPhoto._id!, 
    photoData,  // PostgreSQL || will merge
    tenantId
  );
}
```

**Impact:** LOW - Photo uploads less frequent  
**Effort:** 15 minutes  
**Tests:** `apps/dashboard/__tests__/upload-images.api.test.ts`

---

## Summary Statistics

### Changes Required

| Priority | Count | Total Effort |
|----------|-------|--------------|
| 🔴 High  | 6     | ~8 hours     |
| 🟡 Medium| 2     | ~1.5 hours   |
| 🟢 Good  | 2     | 0 hours      |

### Patterns Identified

1. **Spread Merge** (6 instances) - `{ ...existing, ...updates }`
2. **Authorization Check** (3 instances) - Legitimate pre-fetch
3. **Business Logic Dependencies** (2 instances) - Requires existing data
4. **Clean Partial** (2 instances) - Already correct! ✅

---

## Migration Strategy

### Phase 1: Core Fix (Week 1)
1. ✅ Implement PostgreSQL `||` operator in `NotionModelResolver.updateNotionModel`
2. ✅ Add comprehensive tests for JSONB merge behavior
3. ✅ Deploy with feature flag to staging

### Phase 2: Remove Redundant Fetches (Week 2)
**Simple Cases (No Business Logic):**
1. `globalSettings-actions.ts` - Remove spread merge
2. `assistant-feedback-actions.ts` - Remove defensive fetch
3. `upload-photos/route.ts` - Remove spread merge
4. `html-generation-actions.ts` - Keep auth, remove spread

**Total:** ~3 hours of changes

### Phase 3: Complex Refactors (Week 3)
**Cases Requiring Special Handling:**
1. `assistant-actions.ts` - Handle subDomain logic carefully
2. `userProfile-actions.ts` - Simplify conditional merge
3. `functionalPrompt-actions.ts` - **Keep fetch** (business logic required)

**Total:** ~5 hours of changes

### Phase 4: Testing & Validation (Week 4)
1. Update all affected test files
2. Integration tests for authorization patterns
3. Performance benchmarks (before/after)
4. Staging validation with monitoring

---

## Testing Checklist

### Unit Tests to Update
- [ ] `apps/mesh/__tests__/partial-updates.test.ts` (create new)
- [ ] `packages/prism/__tests__/assistant-actions.test.ts`
- [ ] `packages/prism/__tests__/globalSettings-actions.test.ts`
- [ ] `packages/prism/__tests__/assistant-feedback-actions.test.ts`
- [ ] `packages/prism/__tests__/userProfile-actions.test.ts`
- [ ] `apps/interface/src/features/HtmlGeneration/__tests__/html-generation-actions.test.ts`
- [ ] `apps/dashboard/__tests__/upload-images.api.test.ts`

### Integration Tests to Add
- [ ] End-to-end update flow with partial data
- [ ] Authorization checks still work without pre-fetch
- [ ] Concurrent update scenarios (race conditions)
- [ ] JSONB merge behavior with nested objects/arrays

### Performance Tests
- [ ] Benchmark update latency (before/after)
- [ ] Measure query reduction (SELECT count)
- [ ] Transaction duration metrics
- [ ] Cache hit rate changes

---

## Risk Assessment

### Low Risk ✅
- Notes actions (already correct)
- Applet storage actions (already correct)
- Global settings (singleton, low frequency)
- Photo uploads (low frequency)

### Medium Risk ⚠️
- HTML generation (moderate usage)
- User profiles (moderate frequency)
- Assistant feedback (low frequency but customer-facing)

### High Risk 🔴
- Assistant actions (high traffic, special logic)
- Functional prompts (version tracking complexity)
- NotionModelResolver (core update path)

### Mitigation Strategy
1. Feature flag for new behavior
2. Gradual rollout (staging → 10% → 50% → 100%)
3. Real-time monitoring and alerts
4. Quick rollback plan
5. Comprehensive logging for debugging

---

## Files Not Requiring Changes

### Authorization-Only Fetches (Keep)
- `apps/interface/src/app/api/applet-api/route.ts:230-288` (handleUpdateOperation)
- `apps/interface/src/features/Notes/actions/notes-actions.ts:410-420` (deleteNote check)
- `apps/interface/src/features/HtmlGeneration/actions/html-generation-actions.ts:308-320` (deleteHtmlContent check)

### Business Logic Dependencies (Keep)
- `packages/prism/src/core/actions/functionalPrompt-actions.ts` (diff generation)

### Already Optimized (Reference Examples)
- `apps/interface/src/features/Notes/actions/notes-actions.ts:434-470` (updateNote)
- `apps/interface/src/features/HtmlGeneration/actions/applet-storage-actions.ts:140-160` (updateAppletStorage)

---

## Python Bot Layer

### Search Status
Searched Python files for update patterns:
- ❌ No `existing = get_content()` patterns found
- ❌ No `**existing` spread patterns found
- ℹ️ Python bot primarily uses Prism actions (TypeScript layer)

**Conclusion:** Python bot layer does not directly perform updates with pre-fetch patterns. All updates flow through TypeScript Prism actions.

---

## Next Steps

1. **Review this audit** with team
2. **Prioritize files** based on traffic/risk
3. **Create tracking issues** for each file
4. **Implement Phase 1** (core fix) first
5. **Validate in staging** before proceeding
6. **Document patterns** for future development

**Owner:** TBD  
**Timeline:** 4 weeks total  
**Tracking:** GitHub Project or Jira epic
