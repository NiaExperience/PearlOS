# Personality Voice Selection Feature Plan

## Objective
Enable user-selectable personalities with voice configuration from the PearlMultiMenu, allowing users to dynamically switch the assistant's personality and voice during their session.

## Scope

### Phase 1: Data Model & Schema Changes
1. **Transform `allowedPersonalities` from array to map**
   - Current: `allowedPersonalities: string[]` (array of personality IDs)
   - New: `allowedPersonalities: Record<string, PersonalityVoiceConfig>`
   - Structure:
     ```typescript
     interface PersonalityVoiceConfig {
       personalityId: string;
       personalityName: string;  // Cached for quick display
       voiceId: string;
       voiceProvider: string;  // '11labs' | 'kokoro'
       voiceParameters?: {
         // ElevenLabs parameters
         stability?: number;
         similarityBoost?: number;
         style?: number;
         optimizeStreamingLatency?: number;
         // Kokoro parameters
         speed?: number;
         language?: string;  // 'en-US' | 'en-GB' | etc.
       };
     }
     ```

2. **Update locations** (active code only):
   - `packages/prism/src/core/blocks/assistant.block.ts` - IAssistant interface, Zod schema
   - `packages/prism/src/core/platform-definitions/Assistant.definition.ts` - JSON schema
   - ~~Mongoose schemas (dead code, skip)~~

### Phase 2: Dashboard UI - Add Personality Modal
1. **Fix and enhance the "+" button** (currently broken)
   - Location: `apps/dashboard/src/components/assistant-model-tab.tsx` (line 559)
   - Current state: `setAllowedPersonalitiesDialog(true)` exists but no dialog implementation

2. **Create `AddPersonalityVoiceDialog` component**
   - Path: `apps/dashboard/src/components/dialogs/add-personality-voice-dialog.tsx`
   - Features:
     - **Personality Selection**: Dropdown of all personalities in tenant
     - **Voice Provider Selection**: Radio buttons or dropdown ('11labs' | 'kokoro')
     - **Voice Configuration**:
       - If 11labs: Text input for voice ID string
       - If kokoro: Dropdown populated from `KOKORO_VOICES` constant
     - **Voice Parameters** (collapsible/advanced section):
       - For 11labs: stability, similarityBoost, style, optimizeStreamingLatency sliders
       - For kokoro: speed slider (0.5-2.0), language dropdown (en-US, en-GB filtered)
     - **Validation**:
       - Ensure personality not already in allowedPersonalities map
       - Validate voice ID format
       - Ensure all required fields populated
     - **Save action**: Add to `allowedPersonalities` map with key = personalityName

3. **Update display badges**
   - Location: `apps/dashboard/src/components/assistant-model-tab.tsx` (lines 565-587)
   - Show personality name (key) with voice provider icon (🎤 for 11labs, 🎵 for kokoro)
   - Clicking badge opens edit mode (re-use same dialog, pre-populated)
   - X button removes from map

4. **Migration strategy for existing data**
   - On assistant load/edit, if `allowedPersonalities` is array:
     - Convert to map using personality names as keys
     - Default voice config: inherit from assistant's current `voice.provider` and `voice.voiceId`
     - Mark form as dirty to prompt save
   - Backend should also handle this gracefully on read/write

### Phase 3: Interface - PearlMultiMenu Update
1. **Disable non-Talk icons**
   - Location: `apps/interface/src/features/PearlMultiMenu/components/PearlMultiMenu.tsx`
   - Icons to disable: top (Chat/Message), bottom-right (Eyes/Vision), bottom-left (Question/Help), top-left (Sleep/Moon)
   - Implementation:
     - Add `opacity: 0.3` and `cursor: not-allowed` styles
     - Remove `onClick` handlers
     - Update `title` attributes to show "Coming soon" or similar

2. **Implement Talk icon personality selector**
   - When "top-right" (Talk) icon is clicked:
     - Show modal/dropdown with list of personality names from `allowedPersonalitiesMap`
     - Display personality names as selectable buttons or list items
     - On selection:
       - Emit custom event: `personalityChanged` with payload:
         ```typescript
         {
           personalityId: string;
           personalityName: string;
           voiceId: string;
           voiceProvider: string;
           voiceParameters?: VoiceParametersInput;
         }
         ```
       - Event should bubble to parent containers

3. **Create personality selection modal**
   - New component: `apps/interface/src/components/PersonalitySelector.tsx`
   - Props:
     - `allowedPersonalities: Record<string, PersonalityVoiceConfig>`
     - `currentPersonalityId?: string` (to highlight current selection)
     - `onSelect: (config: PersonalityVoiceConfig) => void`
   - Design:
     - Modal overlay with list of personality options
     - Each item shows personality name + voice provider badge
     - Visual indicator for currently active personality
     - Close on selection or outside click

### Phase 4: State Management & Event Handling
1. **AssistantCanvas updates**
   - Location: `apps/interface/src/components/assistant-canvas.tsx`
   - Listen for `personalityChanged` event
   - When received:
     - Update local state with new personality/voice config
     - If voice session active: call `updatePersonality()` method (see Phase 5)
     - Emit event to browser-window layer for potential DailyCall sync

2. **Browser-window event relay** (optional, TBD)
   - Location: `apps/interface/src/features/ManeuverableWindow/components/WindowControls.tsx`
   - Listen for `personalityChanged` from assistant-canvas
   - Store current personality config in window state
   - If DailyCall is active, potentially trigger bot personality/voice update (future work)

### Phase 5: Voice Session Personality Update
1. **Add personality switching to voice session**
   - Location: `apps/interface/src/hooks/useVoiceSession.ts`
   - New method: `updatePersonality(config: PersonalityVoiceConfig)`
   - Implementation:
     - If no active session: update initial config only (for next join)
     - If session active (bot already joined):
       - **Option A (Simple)**: Display message "Personality changes will apply on next session" *(only show when voice session is active)*
       - **Option B (Complex)**: Send bot update command via Daily events (requires bot-side support)
       - **Recommended**: Start with Option A, add Option B in future iteration

2. **Personality state persistence**
   - Store selected personality in localStorage: `nia-assistant-personality-${assistantId}`
   - Load on page mount to restore user's last choice
   - Clear on logout/session end

### Phase 6: Testing & Validation
1. **Unit tests**
   - Dashboard: AddPersonalityVoiceDialog component
     - Personality selection
     - Voice provider switching
     - Form validation
     - Save/cancel actions
   - Interface: PersonalitySelector component
     - Rendering personality list
     - Selection handling
     - Event emission
   - Schema validation for new data structure

2. **Integration tests**
   - Assistant CRUD with new allowedPersonalities structure
   - Migration from array to map format
   - Event flow from PearlMultiMenu → AssistantCanvas
   - Voice session updates (Option A behavior)

3. **E2E tests** (manual initially, automate later)
   - Dashboard flow: Add personality → Configure voice → Save → Verify in DB
   - Interface flow: Open menu → Select Talk → Choose personality → Verify voice change (next session)
   - Data migration: Load old assistant → Verify auto-conversion → Save → Verify format

## Files to Modify

### Core Schema & Types (sync required)

1. `packages/prism/src/core/blocks/assistant.block.ts`
   - Update `IAssistant` interface
   - Update `AssistantSchema` Zod schema
   - Add `PersonalityVoiceConfig` interface

2. `packages/prism/src/core/platform-definitions/Assistant.definition.ts`
   - Update JSON schema for `allowedPersonalities`

### Dashboard Components

3. `apps/dashboard/src/components/assistant-model-tab.tsx`
   - Fix "+" button handler
   - Update badges display
   - Add edit functionality
   - Implement migration logic on form load

4. `apps/dashboard/src/components/dialogs/add-personality-voice-dialog.tsx` (NEW)
   - Complete dialog implementation

### Interface Components

5. `apps/interface/src/features/PearlMultiMenu/components/PearlMultiMenu.tsx`
   - Disable 4 icons
   - Implement Talk icon handler
   - Add modal integration

6. `apps/interface/src/components/PersonalitySelector.tsx` (NEW)
   - Personality selection modal

7. `apps/interface/src/components/assistant-canvas.tsx`
   - Add event listener for personalityChanged
   - Update voice session integration

8. `apps/interface/src/hooks/useVoiceSession.ts`
   - Add `updatePersonality` method
   - Implement Option A (message on active session)

### Events

9. `packages/events/src/descriptors/personality-changed.event.json` (NEW)
   - Event descriptor for personality changes

10. `packages/events/src/index.ts`
    - Export new event

## Risk Assessment

### High Risk

- **Schema migration complexity**: Converting array to map (only 2 core files)
  - Mitigation: Create comprehensive migration utility, test thoroughly
  - Rollback: Keep backward compatibility in read logic for 1-2 releases

- **State sync issues**: Personality changes not properly reflected in active sessions
  - Mitigation: Start with simple "next session" approach
  - Future enhancement: Add real-time update support

### Medium Risk
- **Voice parameter mismatch**: Wrong parameters passed for provider type
  - Mitigation: TypeScript unions and runtime validation
  - Add integration tests for each provider

- **Dialog broken state**: Current "+" button appears broken
  - Mitigation: Implement complete dialog before shipping
  - Add error boundaries and fallback UI

### Low Risk
- **PearlMultiMenu icon positioning**: Disabled icons may confuse users
  - Mitigation: Clear visual indicators (opacity, tooltip)
  - Consider "Coming Soon" badges

## Success Criteria
1. ✅ Dashboard admin can add/edit/remove personality-voice configurations
2. ✅ Interface users see only Talk icon as active in PearlMultiMenu
3. ✅ Clicking Talk icon shows list of configured personalities
4. ✅ Selecting personality triggers state update and event emission
5. ✅ Selected personality persists across page refreshes (localStorage)
6. ✅ Voice parameters correctly applied based on provider type
7. ✅ Migration from old array format to new map format works seamlessly
8. ✅ All tests pass (unit, integration, E2E manual validation)

## Out of Scope (Future Work)
- Real-time personality switching during active voice session (requires bot-side support)
- DailyCall personality/voice synchronization
- Custom voice sample upload
- Personality preview/testing in dashboard
- Voice parameter presets/templates
- Multi-language personality support beyond English
- Analytics/tracking of personality usage

## Implementation Order
1. **Phase 1**: Schema changes (all files in sync)
2. **Phase 2**: Dashboard UI (dialog + migration)
3. **Phase 3**: Interface UI (menu + selector)
4. **Phase 4**: State management (events + handlers)
5. **Phase 5**: Voice session updates (Option A)
6. **Phase 6**: Testing & validation

## Checkpoints
- After Phase 1: Run `npm run build`, `npm run type-check` - all must pass
- After Phase 2: Manual test in Dashboard - add/edit/remove personalities
- After Phase 3: Manual test in Interface - disabled icons + Talk icon modal
- After Phase 4: Verify event emission in browser console
- After Phase 5: Test personality selection with voice session
- After Phase 6: Full regression testing

## Notes

- Voice provider constants already available: `KOKORO_VOICES` in `packages/prism/src/core/constants/kokoro-voices.ts`
- ElevenLabs voice IDs are strings, no enum/constant list available
- Consider adding voice preview/test feature in future iterations
- PearlMultiMenu Rive file (`/pearlmenu2.riv`) may need updates if icon behavior changes required at animation level
- **Mongoose schemas in `apps/*/src/migration/` are legacy/dead code** - NOT updating to reduce scope and avoid touching deprecated code paths

