# Incremental Load Optimizations for Notes & HtmlGeneration

## Problem Statement

Notes and HtmlGeneration loading is slow due to:
1. **Sequential waterfall fetches** - personal → shared resources → individual shared item lookups
2. **N+1 query pattern** - fetching each shared note/applet individually
3. **UI blocks entirely** until all data arrives (poor perceived performance)

### Current Architecture Issues

**Notes Route** (`features/Notes/routes/route.ts`):
```
1. Fetch user's own notes → WAIT
2. Fetch shared resources list → WAIT  
3. For EACH shared resource: fetch note by ID sequentially → N WAITS
4. Merge, dedupe, return
```

**HtmlGeneration Route** (`features/HtmlGeneration/routes/route.ts`):
```
1. Fetch user's own applets (listHtmlGenerations) → WAIT
2. Fetch shared resources (getUserSharedResources) → WAIT
3. Group by tenant, batch fetch by IDs → WAIT per tenant
4. For each shared item, lookup owner user → N WAITS (cached)
5. Merge, dedupe, return
```

**Client Hooks**:
- `useHtmlApplets` - single fetch, waits for everything
- `loadNotes()` in `notes-view.tsx` - sequential fetches with N+1 for shared

---

## Implementation Plan

### Phase 1: Backend Streaming API (Priority: HIGH)

#### Task 1.1: Create Incremental Notes Endpoint
**File:** `apps/interface/src/features/Notes/routes/incremental/route.ts`

```typescript
// New streaming endpoint: GET /api/notes/incremental?agent=xxx
// Returns batches: { batch: 'personal'|'work'|'shared-to-user'|'shared-to-all', items: Note[], done: boolean }
```

- [ ] Create new route file at `features/Notes/routes/incremental/route.ts`
- [ ] Implement batch streaming using `ReadableStream` or Server-Sent Events (SSE)
- [ ] Batch order:
  1. `personal` - user's own personal notes
  2. `work` - user's own work notes (if mode allows)
  3. `shared-to-user` - notes shared directly to user via organizations
  4. `shared-to-all` - notes from sharedToAllReadOnly organizations
- [ ] Each batch includes `{ batch: string, items: Note[], done: boolean }`
- [ ] Use `findNotesByIds()` batch query instead of individual fetches
- [ ] Add pagination support within batches (cursor-based)

#### Task 1.2: Create Incremental HtmlGeneration Endpoint  
**File:** `apps/interface/src/features/HtmlGeneration/routes/incremental/route.ts`

- [ ] Create new route file at `features/HtmlGeneration/routes/incremental/route.ts`
- [ ] Implement same streaming pattern as Notes
- [ ] Batch order:
  1. `personal` - user's own applets
  2. `shared-to-user` - applets shared via organization membership
  3. `shared-to-all` - applets from sharedToAllReadOnly organizations
- [ ] Use existing `findHtmlContentsByIds()` for batch queries
- [ ] Pre-fetch owner names in parallel using `Promise.all()`

#### Task 1.3: Optimize Shared Resources Query
**File:** `packages/prism/src/core/actions/organization-actions.ts`

- [ ] Add `getUserSharedResourcesBatched()` that returns resources grouped by source
- [ ] Include `isGlobal` flag to distinguish shared-to-user vs shared-to-all
- [ ] Consider adding a DB index on `SharedResources.userId` if missing
- [ ] Cache organization lookups to avoid repeated queries

---

### Phase 2: Client-Side Incremental Loading (Priority: HIGH)

#### Task 2.1: Create useIncrementalFetch Hook
**File:** `apps/interface/src/hooks/use-incremental-fetch.ts`

```typescript
interface IncrementalFetchResult<T> {
  items: T[];
  batches: {
    personal: T[];
    work?: T[];
    sharedToUser: T[];
    sharedToAll: T[];
  };
  loadingBatches: Set<string>;  // Which batches are still loading
  isComplete: boolean;
  error: string | null;
  refresh: () => void;
}
```

- [ ] Create generic hook for incremental data fetching
- [ ] Support both SSE and fetch-then-merge patterns
- [ ] Expose `loadingBatches` set for granular UI feedback
- [ ] Support abort controller for cleanup
- [ ] Deduplicate items by `_id` as batches arrive

#### Task 2.2: Refactor useHtmlApplets Hook
**File:** `apps/interface/src/features/HtmlGeneration/hooks/use-html-applets.ts`

- [ ] Replace single fetch with incremental streaming
- [ ] Update state progressively as batches arrive
- [ ] Keep `loading: true` until `isComplete`
- [ ] Add `loadingPhase: 'personal' | 'shared' | 'complete'` for UI feedback
- [ ] Maintain backward compatibility with existing interface

#### Task 2.3: Refactor Notes loadNotes Function
**File:** `apps/interface/src/features/Notes/components/notes-view.tsx`

- [ ] Replace `loadNotes()` with incremental loading
- [ ] Update `notes` state progressively
- [ ] Show partial results immediately (personal notes first)
- [ ] Add loading indicator per section if desired
- [ ] Preserve existing search/filter behavior during incremental load

---

### Phase 3: UI/UX Improvements (Priority: MEDIUM)

#### Task 3.1: Progressive Loading Indicator
**Files:** 
- `apps/interface/src/features/Notes/components/notes-view.tsx`
- `apps/interface/src/features/HtmlGeneration/components/HtmlContentViewer.tsx`

- [ ] Replace binary loading spinner with phased indicator
- [ ] Show: "Loading your [notes/applets]..." → "Loading shared..." → Done
- [ ] Consider skeleton loaders for list items
- [ ] Keep spinner until ALL batches complete (per original requirements)

#### Task 3.2: Optimistic UI Updates
- [ ] Show personal items immediately while shared items load
- [ ] Use subtle "loading more..." indicator at bottom of list
- [ ] Animate new items sliding in as batches arrive

#### Task 3.3: Error Handling per Batch
- [ ] If shared batch fails, still show personal items
- [ ] Show warning toast if partial data available
- [ ] Add retry button for failed batches

---

### Phase 4: Database & Query Optimizations (Priority: MEDIUM)

#### Task 4.1: Add Batch Query Methods
**File:** `apps/interface/src/features/Notes/actions/notes-actions.ts`

- [ ] Add `findNotesByIds(ids: string[], tenantId: string): Promise<Note[]>`
- [ ] Use Prism `where: { _id: { in: ids } }` query
- [ ] Single query instead of N individual fetches

#### Task 4.2: Add Database Indexes (if needed)
**Files:** Schema definitions or migration scripts

- [ ] Ensure index on `Notes.userId + tenantId + mode`
- [ ] Ensure index on `HtmlGeneration.parent_id + tenantId`
- [ ] Ensure index on `SharedResources.userId + contentType`

#### Task 4.3: Implement Response Caching
- [ ] Add short TTL cache (30s) for shared resources list
- [ ] Use React Query or SWR for client-side caching with stale-while-revalidate
- [ ] Cache owner user lookups (already partially done)

---

### Phase 5: Testing & Validation (Priority: HIGH)

#### Task 5.1: Unit Tests
- [ ] Test incremental route returns correct batch structure
- [ ] Test batch ordering (personal before shared)
- [ ] Test deduplication logic
- [ ] Test error handling per batch

#### Task 5.2: Integration Tests
- [ ] Test full flow: API → Hook → Component
- [ ] Test with large datasets (50+ items per batch)
- [ ] Test offline/error recovery

#### Task 5.3: Performance Benchmarks
- [ ] Measure current load time (baseline)
- [ ] Target: First meaningful paint < 200ms
- [ ] Target: Complete load < 1000ms for typical user
- [ ] Add performance logging/metrics

---

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `features/Notes/routes/incremental/route.ts` | **NEW** | Streaming notes endpoint |
| `features/HtmlGeneration/routes/incremental/route.ts` | **NEW** | Streaming applets endpoint |
| `hooks/use-incremental-fetch.ts` | **NEW** | Generic incremental fetch hook |
| `features/HtmlGeneration/hooks/use-html-applets.ts` | **MODIFY** | Use incremental loading |
| `features/Notes/components/notes-view.tsx` | **MODIFY** | Use incremental loading |
| `features/Notes/lib/notes-api.ts` | **MODIFY** | Add batch fetch function |
| `features/Notes/actions/notes-actions.ts` | **MODIFY** | Add findNotesByIds |
| `packages/prism/.../organization-actions.ts` | **MODIFY** | Optimize shared resources query |

---

## Implementation Order (Recommended)

```
Week 1:
├── Task 1.3: Optimize getUserSharedResources (backend foundation)
├── Task 4.1: Add batch query methods
└── Task 2.1: Create useIncrementalFetch hook

Week 2:
├── Task 1.1: Create incremental Notes endpoint
├── Task 2.3: Refactor Notes loadNotes
└── Task 5.1: Unit tests for Notes

Week 3:
├── Task 1.2: Create incremental HtmlGeneration endpoint
├── Task 2.2: Refactor useHtmlApplets
└── Task 5.1: Unit tests for HtmlGeneration

Week 4:
├── Task 3.1-3.3: UI improvements
├── Task 5.2-5.3: Integration tests & benchmarks
└── Task 4.2-4.3: DB indexes & caching (if needed)
```

---

## Success Criteria

- [ ] **Perceived performance**: First items visible within 200ms
- [ ] **Total load time**: Complete data within 1000ms for typical user (10 personal, 5 shared)
- [ ] **Loading indicator**: Spinner remains active until ALL batches complete
- [ ] **Incremental display**: List updates as each batch arrives
- [ ] **Error resilience**: Personal items shown even if shared fetch fails
- [ ] **No regressions**: All existing tests pass, no UI breaking changes

---

## Notes

- The batch order (personal → work → shared-to-user → shared-to-all) ensures users see their own content first
- Work mode notes are only relevant for Notes feature (not HtmlGeneration)
- Consider WebSocket for real-time updates in future iteration
- Mobile performance is especially important given slower network conditions