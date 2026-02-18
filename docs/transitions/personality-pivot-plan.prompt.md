# Personality Pivot Implementation Checklist

This document serves as the master checklist for the Personality Pivot refactor.  Keep track of progress here as you implement the changes across the various codebases.

## Phase 1: Data Model Changes (`packages/prism`)
- [x] **1.1 Update `PersonalityVoiceConfig`**
  - Modify `packages/prism/src/core/blocks/assistant.block.ts`
  - Add `personalityId`, `personalityName`, `personaName`, `voice`.
- [x] **1.2 Update `ModePersonalityVoiceConfig`**
  - Flatten structure in `packages/prism/src/core/blocks/assistant.block.ts`.
  - Remove nested `config` object.
- [x] **1.3 Update `IAssistant` and `AssistantSchema`**
  - Remove root fields: `personalityId`, `persona_name`, `voice`.
  - Update `modePersonalityVoiceConfig` definition.
  - Add `'default'` to `desktopMode` enum/keys.

## Phase 1.5: Data Migration on Load (`packages/prism`)
- [x] **1.4 Implement Migration Logic**
  - In `packages/prism/src/core/actions/assistant-actions.ts`:
  - Check if `modePersonalityVoiceConfig['default']` exists.
  - If not, construct it from legacy root fields (`personalityId`, `persona_name`, `voice`).

## Phase 2: Dashboard Changes (`apps/dashboard`)
- [x] **2.1 Model Tab (`assistant-model-tab.tsx`)**
  - Remove "Default Personality" selector.
  - Move "Mode Configuration" section to the new "Personality/Voice" tab.
- [x] **2.2 Voice Tab (`assistant-voice-tab.tsx`)**
  - Rename tab in UI to "Personality/Voice".
  - Integrate "Mode Configuration" UI.
  - Update "Configure" button's popup dialog:
    - Add "Persona Name" input.
    - Move "Additional Configuration" (voice settings) into this dialog.
   - Remove root-level "Voice Configuration" and "Additional Configuration".
- [x] **2.3 Save Logic**
  - Ensure `modePersonalityVoiceConfig['default']` is populated.
  - Filter out root `personalityId`, `persona_name`, `voice` from submission.

## Phase 3: Interface Changes (`apps/interface`)
- [x] **3.1 Update Data Access**
  - Replace `assistant.personalityId` -> `assistant.modePersonalityVoiceConfig['default'].personalityId`
  - Replace `assistant.voice` -> `assistant.modePersonalityVoiceConfig['default'].voice`
  - Replace `assistant.persona_name` -> `assistant.modePersonalityVoiceConfig['default'].personaName`
- [x] **3.2 Onboarding & Join Logic**
  - In `apps/interface/src/app/[assistantId]/page.tsx` and `ClientManager.tsx`:
  - Force "default" mode config when `onboardingComplete` is false.
  - Pass `is_onboarding` flag to bot.

## Phase 4: Verification
- [x] Verify `npm run build` passes for all apps.
- [x] Verify `npm test` passes from the root.
- [ ] Verify Dashboard allows editing "Default" mode.
- [ ] Verify Interface loads correct personality for "Default" mode.
- [ ] Verify Onboarding flow uses "Default" personality.
