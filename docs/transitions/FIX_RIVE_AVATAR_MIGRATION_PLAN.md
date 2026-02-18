# Fix-RiveAvatar to Staging Migration Plan

---

## Overview

This document outlines the strategy and mapping for porting changes from the `Fix-RiveAvatar` branch onto the new features-first architecture in the current staging branch. It is intended to help original authors and reviewers understand where each major piece of code landed, and how the new structure organizes features, assets, and APIs.

## Branch Analysis

- **Source Branch**: `Fix-RiveAvatar`
- **Target Branch**: `staging-rive-merge` (current)
- **Base Branch**: `staging` (staging-jk-more-fixes merged)
- **Branching Point**: `37e201e58f2b39faa72021df01bf35543f63c44e`
- **Total Changes**: 58 files modified/added

## Key Features Migrated

### 1. Rive Avatar System

- **Files**: 16 `.riv` animation files, `RiveAvatar.tsx` component
- **Purpose**: Animated avatar with lip-sync and state management
- **Integration**: Speech context, VAPI integration, UI state management

### 2. HTML Content Generation

- **Files**: `html-content.block.ts` (now migrated), generation APIs, UI components
- **Purpose**: AI-powered HTML app/game generation with provider selection
- **Data Pattern**: Migrated from old block system to features-first pattern

### 3. Browser Automation

- **Files**: Browser control APIs, automation services, wrapper/UI components
- **Purpose**: Automated browser interaction for generated content
- **Integration**: Desktop interface integration

## Architecture Overview

### HtmlGeneration Feature Structure

```text
apps/interface/src/features/HtmlGeneration/
├── definition.ts                  # Prism schema definition
├── types/
│   └── html-generation-types.ts   # TypeScript interfaces
├── actions/
│   └── html-generation-actions.ts # CRUD operations + AI generation
├── routes/
│   └── route.ts                   # GET_impl, POST_impl for routes
├── components/
│   └── HtmlGenerationViewer.tsx   # React component wrapper
└── index.ts                       # Feature exports
```

API Routes:

apps/interface/src/app/api/

```text
├── create-html-content/route.ts   # POST → HtmlGeneration.POST_impl
├── get-html-content/route.ts      # GET/POST → HtmlGeneration.GET_impl/POST_impl
├── html-content/route.ts          # Unified CRUD endpoint
└── html-content/[id]/route.ts     # Individual content management
```

### RiveAvatar Feature Structure

```text
apps/interface/src/features/RiveAvatar/
├── components/
│   └── RiveAvatar.tsx         # Main animated avatar component
├── types/
│   └── rive-avatar-types.ts   # Animation state types
└── index.ts                   # Feature exports
```

Assets:

```text
apps/interface/public/
└── master_pearl3.riv, master_pearl1.riv, ... (all 16 .riv files)
```

Dependencies:

```text
apps/interface/package.json
└── rive-react: ^4.22.1        # Animation library
```

### BrowserAutomation Feature Structure

```text
apps/interface/src/features/BrowserAutomation/
├── definition.ts              # Feature definition
├── actions/
│   └── index.ts               # Browser control actions
├── services/
│   └── index.ts               # Browser service implementation
├── components/
│   └── RealBrowserView.tsx    # Browser UI component
├── lib/
│   ├── navigation-utils.ts    # Natural language navigation parsing
│   └── events.ts              # Typed browser event contract
├── __tests__/
│   ├── queue-behavior.test.ts # Cooldown ordering test
│   ├── navigation-utils.test.ts # Navigation mapping tests
│   ├── queue-retry-events.test.ts # Retry / failure event tests
│   ├── realbrowser-ui-polish.test.tsx # UI polish (flash, quick links, toast, placeholders)
│   └── realbrowser-integration.test.ts # Navigate→action retry ordering
└── index.ts                   # Feature exports
```

### Data Flow Diagrams

#### HtmlGeneration Data Flow

```text
Client Request → API Route → Feature Route Handler → Feature Actions → Prism → Database
     ↓              ↓              ↓                    ↓           ↓        ↓
POST /api/         route.ts    POST_impl()      createHtmlGeneration()  Prism   Store
create-html-     (thin layer)  (validation)     (AI generation)       Schema   HTML
content                                         + createHtmlContent()          Content
```

#### RiveAvatar Animation Flow

```text
Component Mount → Load Rive File → Initialize State Machine → Handle Interactions
     ↓                ↓                    ↓                        ↓
RiveAvatar.tsx → master_pearl3.riv → 4 Animation States → Speech/UI Context
     ↓                                    ↓                        ↓
Animation Loop ←                   State Transitions ←      User Interactions
(STARTING → RELAXED_SPEAKING → BROWSER_EXPLANATION → CALL_ENDING)
```

## Migration Strategy & Mapping

### Phase 1: Data Model Migration

#### 1.1 Create HtmlGeneration Feature Structure

Following the Notes pattern established in `apps/interface/src/features/Notes/`:

```text
apps/interface/src/features/HtmlGeneration/
├── definition.ts          # Dynamic content definition created
├── types/
│   └── html-generation-types.ts  # TypeScript interfaces created
├── actions/
│   └── html-generation-actions.ts # CRUD actions implemented
├── routes/                # (if needed)
├── components/            # (if needed)
├── lib/                   # (if needed)
└── index.ts              # Export structure created
```

#### 1.2 Convert html-content.block.ts to Features Pattern

- **FROM**: Traditional block with Notion service integration
- **TO**: Dynamic content definition with Prism integration
- **Key Changes**:
  - Removed direct Notion model dependency
  - Uses JSON schema for data validation
  - Follows Notes indexer pattern
  - Implements proper access control
  - Created full CRUD actions (create, read, update, delete, list)

### Phase 2: Component Migration

#### 2.1 Rive Avatar Integration

- Ported `RiveAvatar.tsx` to features structure
- Ensured compatibility with current speech/UI contexts
- Updated Rive library dependencies in package.json

#### 2.2 Browser Automation

- Created `BrowserAutomation` feature following same pattern
- Migrated browser control APIs to new route abstraction
- Updated browser services to use current architecture
- UI components (e.g., RealBrowserView) migrated as needed

#### 2.3 UI Components

- Dialog, slider, and generation toggle components ported as needed
- Imports updated to match new structure

### Phase 3: API Route Migration

#### 3.1 Convert Old API Routes to New Pattern

**Old Fix-RiveAvatar APIs:**

- `/api/browser-control/route.ts`
- `/api/get-html-content/route.ts`
- `/api/create-html-content/route.ts`

**New Pattern:**

- `features/HtmlGeneration/routes/` with implementation abstraction
- Uses `ensureHtmlGenerationDefinition()` pattern

#### 3.2 Update Integration Points

- `[assistantId]/page.tsx` uses new component structure
- Contexts and hooks updated for new architecture
- Authentication/session handling ensured

### Phase 4: Testing & Validation

#### 4.1 Feature Testing

- Rive animations verified
- HTML generation tested with both AI providers
- Browser automation validated

#### 4.2 Integration Testing

- Integration with current platform ensured
- Authentication system tested
- Prism data access patterns verified

## Implementation Notes & Opportunities

### Advanced UI Components (Partial)

- Some components exist but not fully migrated to features pattern
- Examples: `html-content-viewer.tsx`, `mini-browser-view.tsx`, `youtube-view.tsx`, `browser-window.tsx`, `user-card.tsx`

### Enhanced Speech Integration (Partial)

- Core functionality works but could be enhanced
- Examples: `contexts/speech-context.tsx`, `hooks/useVapi.ts`, `components/youtube-view.tsx`, `features/RiveAvatar/`

### Additional Rive Animation Files

- All 16 animation files now migrated

### Browser Automation Components

- Core service migrated, some UI components may be further enhanced

### Testing Utilities

- Basic integration tests exist, could be expanded for features and E2E

## Migration Status Summary

- All major features, assets, and APIs migrated to features-first architecture
- All 16 Rive animation files present
- BrowserAutomation, HtmlGeneration, and RiveAvatar features complete
- Some advanced UI and testing enhancements remain optional

## Risk Mitigation & Best Practices

- Data compatibility and migration scripts implemented as needed
- Platform integration follows established patterns
- Performance optimized for Rive and browser automation

## Success Criteria

1. **Functional Parity**: All Fix-RiveAvatar features work in new architecture
2. **Platform Compliance**: Code follows established patterns and conventions
3. **Performance**: No degradation in user experience or system performance
4. **Maintainability**: Code is organized and follows current development practices

## 100% Parity Checklist: Fix-RiveAvatar User Experience

### 1. Advanced UI Components

- [x] Audit and complete migration of:
  - [x] `mini-browser-view.tsx` (resize + agent hook behavior verification pass complete)
  - [x] `browser-window.tsx` (imports updated; window mode flag audited)
  - [x] `html-content-viewer.tsx` (generation states, safe injection, error handling restored)
  - [x] `YouTubeViewWrapper` (renamed from `youtube-view.tsx`; dynamic wrapper + speech context; volume modulation tests added)
  - [x] `user-card.tsx` (confirmed unused in feature flows; retained under components/ as utility)
  - [x] Dedupe `BrowserContainerWrapper` variants (legacy wrapper stubbed)
  - [x] Rename inline HTML toggle to avoid name collision (`HtmlGenerationInlineToggle`)
  - [x] `NotesView` save-refresh correctness (added test + fixed missing post-save reload)

### 2. Enhanced Speech Integration

- [x] Speech detection & assistant/user interaction logic (advanced fields restored behind flag)
- [x] Multi-language heuristic (es, fr, zh, ru)
- [x] Advanced timing/volume controls (confidence + timestamp tracking, volume modulation)
- [x] VAPI reconnection/backoff events (`speech.vapi.error`, `speech.vapi.reconnect`) with exponential strategy
- [x] Additional telemetry / metrics aggregation for reconnection outcomes (`speech.vapi.telemetry` aggregate event: attempts, successes, failures, lastError)

### 3. Browser Automation UI Parity

- [x] `real-browser-view.tsx` authoritative feature path
- [x] Queue + throttling (350ms)
- [x] Namespaced custom events (`browser.queue.*`, `browser.action.*`, `browser.session.*`)
- [x] Navigation parsing (`navigation-utils.ts`) + edge cases
- [x] Strong TS event typings
- [x] Retry / failure path unit tests
- [x] Integration ordering test (navigate → perform retry → success)
- [x] Natural language navigation UX polish (input affordances, rotating placeholder examples)
- [x] Inline link extraction overlay (quick links from `pageInfo`)
- [x] Element highlight flash on perform action (action flash badge)
- [x] Loading state skeleton for initial screenshot area
- [x] Accessibility pass (aria labels on buttons / toolbar)
- [ ] Theming alignment (use shared design tokens vs hard-coded gray classes)
- [x] Keyboard shortcuts (⌘L focus URL bar, ⌘← / ⌘→ history)
- [x] Error recovery banner refinement (inline toast + panel message consistency)

### 4. Testing Utilities & E2E Coverage

- [x] Navigation parser edge cases
- [x] YouTube volume modulation unit tests
- [x] SpeechContext advanced transition tests
- [x] Browser action queue retry/failure + ordering integration
- [x] HtmlGeneration actions (refactored to real Prism integration) – basic CRUD + generation wrapper
- [x] Notes actions real integration tests (CRUD + mode filtering)
- [x] NotesView jsdom test exposing & fixing save-refresh bug
- [x] HtmlGeneration integration generation/list tests (wrapper functions) using fallback HTML path
- [x] Browser UI polish tests (quick links, flash, placeholder rotation, keyboard shortcut, toast)
- [x] HtmlGeneration E2E (fast vs advanced, cancellation, concurrency using real viewer instead of stub) – CLOSED
- [x] Notes & HtmlGeneration route-level handler tests added (auth / CRUD + negatives) – CLOSED
- [x] Speech reconnect telemetry aggregation test (attempts, successes, failures) – CLOSED
- [x] Speech reconnect ceiling test (exponential backoff cap + reset) – CLOSED
- [ ] RiveAvatar + Speech sync deterministic test – IN PROGRESS (expand with stage exposure / assertions)
- [x] Notes theming/token pass – CLOSED
- [x] RiveAvatar asset presence test – CLOSED

### 5. UX Polish & Parity Review

- [ ] Unified theming (dark/light) across Browser / Media / Notes / Generation
- [ ] Skeletons / spinners consistency (YouTube, Browser, HTML Viewer, Notes)
- [ ] Avatar animation timing tuned against speech confidence thresholds
- [x] Optional: Audit / retire `user-card.tsx` (DONE: audited; retained; item closed)
- [ ] Final parity audit & release notes

---

## Recent Progress (2025-08-09 – Update 4)

(New since Update 3)

- Implemented speech reconnect ceiling test validating exponential backoff cap and reset; telemetry ceiling validation complete.
- Stabilized Notes route handler tests via dynamic module isolation (jest.resetModules + jest.doMock) eliminating prior full-suite contamination failure.
- Previous Update 3 items retained (Browser Automation UI polish, navigation matrix test, speech reconnect telemetry aggregation, etc.).

## Testing Strategy Refactor

| Layer | Old Approach | New Approach |
|-------|--------------|--------------|
| Feature Actions (server) | Heavily mocked Prism instance | Real Prism in-memory backend; only session mocked |
| Component Logic | Partial snapshot / shallow tests | Behavioral tests (event ordering, state refresh, retry flows) |
| E2E Flows | Deferred / stubbed viewer | Pending: will replace stubs with actual components once stability harness added |

Benefits: Catches integration regressions earlier; improves confidence in definition retry logic; reduces brittle mock maintenance.

## Remaining Gaps Toward Full Parity

1. HtmlGeneration E2E lifecycle (fast vs advanced mode, concurrent requests, cancellation) – IN PROGRESS (themed)
2. Cross-feature concurrency (BrowserAutomation + Speech + HtmlGeneration) – ADDED test `cross-feature-concurrency.test.tsx` covering simultaneous navigation, speech events, dual generation flows.
3. Theming & skeleton consistency pass (extend to HtmlGeneration, Notes, RiveAvatar containers)
4. Route-level integration tests: expand negative auth / ownership edges
5. Notes multi-tenant / unauthorized delete edge cases
6. RiveAvatar minimal rendering & asset presence test (expanded deterministic sync assertions)
7. Final parity audit & release notes

## Immediate Next Steps (Revised)

1. HtmlGeneration E2E (fast vs advanced & cancellation).
2. Cross-feature concurrency simulation (navigation + speech + YouTube volume).
3. Extend theming/skeleton to remaining features.
4. Expand route-level auth negative cases & Notes unauthorized delete test.
5. RiveAvatar asset presence/minimal render deterministic sync assertions.
6. Final parity audit & release notes draft.

## Definition / Schema Safety

Continue using `ensure*Definition` helpers; integration tests already validate retry path (absence → auto-create → retry). Create shared utility to drop a definition deliberately for negative-path tests.

## Risk & Mitigation (Remaining)

| Risk | Mitigation |
|------|-----------|
| E2E flakiness (timers, retries) | Use controlled fake timers + explicit await for queue drains |
| Animation timing nondeterministic | Mock `requestAnimationFrame` stride + deterministic timestamps |
| Reconnect exponential backoff grows suite time | Inject backoff strategy function for tests (constant small delay) |

---
