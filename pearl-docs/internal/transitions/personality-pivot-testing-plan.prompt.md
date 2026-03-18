# Personality Pivot Testing & Debugging Plan

This plan guides the manual verification and debugging phase of the Personality Pivot refactor.

## 1. Manual Verification Checklist

### Dashboard (`apps/dashboard`)
- [ ] **Edit "Default" Mode**:
  - Navigate to the **Personality/Voice** tab.
  - Verify the "Default" mode section is visible.
  - Modify "Persona Name", "Voice", or "Personality".
  - Click **Save**.
  - Reload the page and verify changes persist.
- [ ] **Edit Specific Mode (e.g., Work)**:
  - Configure a specific mode (e.g., "Work").
  - Save and reload.
  - Verify the specific mode settings are distinct from "Default".

### Interface (`apps/interface`)
- [x] **Default Mode Loading**:
  - Load an assistant where `onboardingComplete` is `true`.
  - Verify the assistant initializes with the "Default" mode's persona and voice.
- [x] **Mode Switching**:
  - Trigger a desktop mode switch (e.g., Home -> Work).
  - Verify the assistant updates to the "Work" mode configuration (if set).
  - Verify it falls back to "Default" or "Standard" if the specific mode is not configured (depending on fallback logic).
- [x] **Onboarding Flow**:
  - Load an assistant where `onboardingComplete` is `false`.
  - Verify the assistant strictly uses the "Default" personality configuration, ignoring other mode settings.
- [x] **Verify "Mode Configuration" Table**:
    - [x] Check that the table displays the following columns:
        - [x] Mode (e.g., "default", "voice", "chat")
        - [x] Persona (New column showing the persona name)
        - [x] Personality (Should show full name, e.g., "Erica - Professional Assistant")
        - [x] Voice (Should show provider/voiceId)
        - [x] Actions (Edit/Delete buttons)
    - [x] Verify that the "Personality" column displays the full name (e.g., "Erica - Professional Assistant") instead of just the ID.

## 2. Bug Resolution Protocol

When a bug is discovered during manual testing:

1.  **Report**: User reports the bug with reproduction steps.
2.  **Triage**: We decide on the approach:
    *   **Type A (Logic/State)**: Create a failing Unit or Integration test to reproduce the issue before fixing.
    *   **Type B (Visual/Trivial)**: Fix directly without a reproduction test.
3.  **Fix**: Implement the resolution.
4.  **Verify**: Run the new test (if applicable) and confirm the fix manually.

## 3. Active Bugs / Issues

*   **[Fixed]** `TypeError: Cannot read properties of undefined (reading 'provider')` in Dashboard.
    *   **Description**: Crash when rendering `allowedPersonalities` list if `voice` object is missing in the config.
    *   **Resolution**: Added optional chaining/checks for `config.voice`.
*   **[Fixed]** `TypeError: Cannot read properties of undefined (reading 'provider')` in `AddPersonalityVoiceDialog`.
    *   **Description**: Crash when opening the edit dialog for a personality configuration that is missing the `voice` object.
    *   **Resolution**: Added a check for `existingConfig.voice` in the `useEffect` hook and provided default values if missing.
*   **[Fixed]** Onboarding completion tool not called.
    *   **Description**: The assistant failed to call `bot_onboarding_complete` when the user requested to skip or end the onboarding flow.
    *   **Resolution**: Updated `prompt.txt` to include explicit, critical instructions to call the tool immediately upon completion or skip request.
