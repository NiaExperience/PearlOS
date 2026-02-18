## Plan: Implement Mode-Specific Personalities

Refactor Assistant data model and UI to support distinct personality and voice configurations per desktop mode, replacing the single `botPersonality`.

### 1. Data Model
*   **File**: `packages/prism/src/core/platform-definitions/Assistant.definition.ts`
    *   [x] Remove `botPersonalityId`.
    *   [x] Add `modePersonalityVoiceConfig` (Map<DesktopMode, { room_name: string, config: PersonalityVoiceConfig }>).
*   **File**: `packages/prism/src/core/blocks/assistant.block.ts`
    *   [x] Update `IAssistant` interface and `AssistantSchema` (Zod).
    *   [x] Define `ModePersonalityVoiceConfig` type.

### 2. Dashboard UI
*   **File**: `apps/dashboard/src/components/assistant-model-tab.tsx`
    *   [x] Rename "OS Personality" to "Default Personality".
    *   [x] Remove "DailyCall personality" selector.
    *   [x] Add configuration table for `modePersonalityVoiceConfig`:
        *   Rows for each desktop mode.
        *   Personality selector per mode.
        *   Voice config modal trigger per mode.
*   **File**: `apps/dashboard/src/app/dashboard/admin/personalities/personalities_client.tsx`
    *   [x] Update usage count logic to traverse `modePersonalityVoiceConfig`.
*   **File**: `apps/dashboard/src/app/dashboard/assistants/page.tsx`
    *   [x] Sort assistants list by name.

### 3. Runtime (Interface)
*   **File**: `apps/interface/src/app/api/bot/config/route.ts` (NEW)
    *   [x] Create a new route to proxy requests to `bot_gateway/config`.
    *   [x] This endpoint allows hot-patching voice/personality at runtime.
*   **File**: `apps/interface/src/features/DailyCall/lib/botClient.ts`
    *   [x] Update `joinRoom` to accept and send mode-specific personality/voice config.
    *   [x] Add `updateBotConfig(room_url, config)` function to call `/api/bot/config`.
*   **File**: `apps/interface/src/contexts/voice-session-context.tsx`
    *   [x] Update logic to resolve the correct personality/voice based on the current desktop mode.
*   **File**: `apps/interface/src/components/desktop-background-switcher.tsx`
    *   [x] Detect mode changes.
    *   [x] If in an active voice session, call `updateBotConfig` with the new mode's settings.

### 4. Bot Gateway (pipecat-daily-bot)
*   **pipecat-daily-bot**:
    *   [x] Implement `/config` endpoint in `bot_gateway`.
    *   [x] Implement Redis listener in bot process to handle updates.
    *   [x] **Architecture Update**: Implement "Provider Singleton" pattern in `ServiceSwitcher`.
        *   Instead of creating a new service instance for every mode, pre-register **one** instance of each available provider (ElevenLabs, Kokoro) at startup.
        *   Map each Desktop Mode to the corresponding provider's **index** in the switcher list.
        *   On mode switch, the `config_listener` will:
            1.  Resolve the service object from the list using the index.
            2.  Queue a `ManuallySwitchServiceFrame` with the **service object** (not index).
            3.  Call `set_voice()` on that instance to update the voice ID dynamically.
        *   This ensures support for both "Warm Pool" (unknown modes at startup) and efficient resource usage.

### 5. Status & Troubleshooting (Current)
*   **Status**: 🚧 Debugging
*   **Focus Areas**:
    1.  **Call State Propagation**:
        *   [x] Diagnose why the desktop avatar (Rive) does not animate to closed state when the call ends via voice command.
        *   [x] Verify `callState` updates in `Call.tsx` and propagation to `DesktopBackgroundSwitcher`.
    2.  **Bot Silence in DailyCall**:
        *   [ ] Diagnose why the bot is silent (no greeting/response) in `DailyCall` video sessions.
        *   [ ] Verify `joinRoom` parameters and bot initialization.

### 6. Resolved Items
*   **Mode-Specific Config**: Implemented and verified.
*   **Hot-Swap Logic**: Implemented for voice-only, disabled for DailyCall (as requested).
*   **Bot Provider Architecture**: "Provider Singleton" pattern implemented.

