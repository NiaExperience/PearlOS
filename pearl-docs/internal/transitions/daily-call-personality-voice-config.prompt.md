# Implementation Plan: DailyCall Personality/Voice Configuration

## Objective

Add a new sibling property `dailyCallPersonalityVoiceConfig` to the Assistant record that configures personality and voice settings specifically for DailyCall/Social contexts, separate from the existing desktop OS mode configuration (`modePersonalityVoiceConfig`).

## Current State Analysis

### Existing Structure
- **`modePersonalityVoiceConfig`**: A `Record<string, PersonalityVoiceConfig>` that maps desktop modes (`default`, `home`, `work`, `creative`, `gaming`, `focus`, `relaxation`) to personality/voice configurations.
- Used by:
  - `useVoiceSession.ts` - Primary voice session hook for OS modes
  - `assistant-canvas.tsx` - Derives effective personality config based on current desktop mode
  - `desktop-background-switcher.tsx` - Switches voice on mode change
  - `browser-window.tsx` - Passes config to `DailyCallView`
  - `DailyCallView.tsx` / `Call.tsx` - Receives config for call sessions

### Data Flow
```
Assistant (Prism) 
  → ClientManager / page props 
    → BrowserWindow (modePersonalityVoiceConfig)
      → DailyCallView (modePersonalityVoiceConfig)
        → Call.tsx (modePersonalityVoiceConfig)
```

### Dashboard Configuration
- `assistant-personality-voice-tab.tsx` contains the "Mode Configuration" table that authors `modePersonalityVoiceConfig`
- `AddPersonalityVoiceDialog` is used to edit individual mode configurations
- Save route at `/api/assistant/update` has `modePersonalityVoiceConfig` in allowed fields list

---

## Implementation Plan

### Phase 1: Schema & Type Updates

#### 1.1 Update `assistant.block.ts` (packages/prism)
**File:** `/packages/prism/src/core/blocks/assistant.block.ts`

- Add `dailyCallPersonalityVoiceConfig?: ModePersonalityVoiceConfig` to `IAssistant` interface
- Add corresponding Zod schema field in `AssistantSchema`

```typescript
// In IAssistant interface (around line 520):
dailyCallPersonalityVoiceConfig?: ModePersonalityVoiceConfig;

// In AssistantSchema (around line 570):
dailyCallPersonalityVoiceConfig: z.record(z.string(), PersonalityVoiceConfigSchema.extend({
  room_name: z.string(),
})).optional(),
```

#### 1.2 Update `Assistant.definition.ts` (packages/prism)
**File:** `/packages/prism/src/core/platform-definitions/Assistant.definition.ts`

- Add `dailyCallPersonalityVoiceConfig` JSON Schema property (copy from `modePersonalityVoiceConfig` structure, lines 246-308)

---

### Phase 2: Dashboard UI Updates

#### 2.1 Create Tab Navigation Component
**File:** `/apps/dashboard/src/components/assistant-personality-voice-tab.tsx`

Create a parent tab bar above the existing "Mode Configuration" section with two tabs:
- **"OS"** (first tab) - Shows current mode configuration table for `modePersonalityVoiceConfig`
- **"Social/DailyCall"** (second tab) - Shows similar configuration for `dailyCallPersonalityVoiceConfig`

**Implementation approach:**
1. Add state: `const [activeConfigTab, setActiveConfigTab] = useState<'os' | 'dailyCall'>('os');`
2. Wrap existing Mode Configuration in a conditional render
3. Create similar Mode Configuration table for DailyCall (modes can be simpler: `default` only, or custom entries)
4. Update handlers to operate on the correct config object based on active tab

#### 2.2 Update Save Handler
**File:** `/apps/dashboard/src/components/assistant-personality-voice-tab.tsx`

Update `handleSaveDialog` to:
- Check which tab is active
- Save to the appropriate config property (`modePersonalityVoiceConfig` vs `dailyCallPersonalityVoiceConfig`)

#### 2.3 Update API Route
**File:** `/apps/dashboard/src/app/api/assistant/update/route.ts`

Add `'dailyCallPersonalityVoiceConfig'` to the `allowedFields` array (line ~50).

---

### Phase 3: Interface App Updates

#### 3.1 Update Component Props

**Files to update with new prop:**
1. `/apps/interface/src/components/browser-window.tsx` - Add `dailyCallPersonalityVoiceConfig` prop
2. `/apps/interface/src/components/assistant-canvas.tsx` - Add prop (for context awareness)
3. `/apps/interface/src/features/DailyCall/components/DailyCallView.tsx` - Add prop
4. `/apps/interface/src/features/DailyCall/components/Call.tsx` - Add prop
5. `/apps/interface/src/features/DailyCall/components/ClientManager.tsx` - Add prop

#### 3.2 Wire Props Through Component Tree

**Entry point:** Page components that load Assistant data need to pass `dailyCallPersonalityVoiceConfig` down the tree alongside `modePersonalityVoiceConfig`.

The prop flow:
```
ClientManager/Page
  → BrowserWindow (dailyCallPersonalityVoiceConfig)
    → DailyCallView (dailyCallPersonalityVoiceConfig)
      → Call.tsx (dailyCallPersonalityVoiceConfig)
```

#### 3.3 Update Call.tsx to Use DailyCall Config

**File:** `/apps/interface/src/features/DailyCall/components/Call.tsx`

Currently, `Call.tsx` receives `modePersonalityVoiceConfig` but for DailyCall context, it should use `dailyCallPersonalityVoiceConfig` if provided.

**Logic:**
```typescript
// In Call.tsx, derive effective config:
const effectiveVoiceConfig = dailyCallPersonalityVoiceConfig?.default 
  ?? dailyCallPersonalityVoiceConfig 
  ?? modePersonalityVoiceConfig?.[currentMode];
```

**Note:** For DailyCall, we typically want a single config (e.g., `default` key) rather than mode-switching. The exact UX can be:
- Single personality/voice for all Social/DailyCall sessions
- OR mode-aware if desired (but simpler to start with single)

#### 3.4 Update Bot Join Payload

The personality/voice config is sent to the bot when joining. Update `joinRoom` call in `Call.tsx` to pass the DailyCall-specific config.

---

### Phase 4: Testing

#### 4.1 Unit Tests
- Test `AssistantSchema` validation with new field
- Test Dashboard tab switching behavior
- Test save/load of `dailyCallPersonalityVoiceConfig`

#### 4.2 Integration Tests
- Dashboard: Configure dailyCall personality, save, reload, verify persistence
- Interface: Start DailyCall, verify correct personality/voice is used

---

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/prism/src/core/blocks/assistant.block.ts` | Modify | Add `dailyCallPersonalityVoiceConfig` to IAssistant interface and Zod schema |
| `packages/prism/src/core/platform-definitions/Assistant.definition.ts` | Modify | Add JSON Schema for `dailyCallPersonalityVoiceConfig` |
| `apps/dashboard/src/components/assistant-personality-voice-tab.tsx` | Modify | Add tab bar with OS/Social tabs, duplicate mode config for dailyCall |
| `apps/dashboard/src/app/api/assistant/update/route.ts` | Modify | Add `dailyCallPersonalityVoiceConfig` to allowed fields |
| `apps/interface/src/components/browser-window.tsx` | Modify | Add prop, pass to DailyCallView |
| `apps/interface/src/components/assistant-canvas.tsx` | Modify | Add prop for awareness |
| `apps/interface/src/features/DailyCall/components/DailyCallView.tsx` | Modify | Add prop, pass to Call |
| `apps/interface/src/features/DailyCall/components/Call.tsx` | Modify | Add prop, use for config resolution |
| `apps/interface/src/features/DailyCall/components/ClientManager.tsx` | Modify | Add prop, pass through |

---

## Open Questions for Review

1. **DailyCall Mode Granularity:** Should `dailyCallPersonalityVoiceConfig` support multiple modes like the OS config (home, work, etc.) or just a single `default` entry?
   - ANSWER: Yes, support multiple modes for future flexibility.

2. **Fallback Behavior:** If `dailyCallPersonalityVoiceConfig` is not set, should DailyCall fall back to `modePersonalityVoiceConfig` or use Assistant default props?
   - ANSWER: Yes, fall back to `modePersonalityVoiceConfig` for consistency.

3. **Tab Labels:** "OS" and "Social/DailyCall" - are these the preferred labels or should we use different terminology?
    - ANSWER: "OS" and "Social/DailyCall" are acceptable for clarity.

4. **Bot Session Propagation:** Does the bot (pipecat) need any changes to receive/use the new config, or does it already generically accept personality/voice params?
   - ANSWER: The bot receives personality/voice config via the join payload. As long as we pass the right config, no bot changes should be needed.
   - CRITICAL: We gate desktop mode switching when in a DailyCall session, and allow it in a voice-only session; ensure this logic remains intact.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Schema migration issues | Low | Medium | New field is optional; existing data unaffected |
| Prop drilling complexity | Medium | Low | Follow existing pattern for `modePersonalityVoiceConfig` |
| Test coverage gaps | Medium | Medium | Add unit tests for new schema, integration tests for UI |
| UI confusion between tabs | Low | Low | Clear tab labels and section descriptions |

---

## Estimated Effort

- **Phase 1 (Schema):** ~30 minutes
- **Phase 2 (Dashboard UI):** ~2 hours
- **Phase 3 (Interface wiring):** ~1-2 hours
- **Phase 4 (Testing):** ~1 hour

**Total:** ~4-5 hours

---

## Next Steps

1. Review and approve this plan
2. Proceed with Phase 1 (Schema changes)
3. Proceed with Phase 2 (Dashboard UI)
4. Proceed with Phase 3 (Interface wiring)
5. Manual testing and validation
6. Add unit/integration tests
