# Voice-Only Applet Crash Handling Plan

## Objective
Add a voice-session-aware fallback when HtmlGeneration applets crash: proactively notify the voice assistant with fix/close instructions and auto-dismiss the crash dialog once a new generation or modification flow begins.

## Current Behavior (baseline)
- Crash detection: iframe posts `nia-applet-error`; HtmlContentViewer sets `error`, `crashDetails`, and shows a crash dialog with "Retry" and "Attempt Fix". (see apps/interface/src/features/HtmlGeneration/components/HtmlContentViewer.tsx)
- Attempt Fix: builds `modificationRequest` from `crashDetails`, POSTs `/api/modify-applet`, dispatches `NIA_EVENT_HTML_MODIFICATION_REQUESTED`, and may auto-open the returned applet. Dialog remains visible until state changes manually.
- HTML events: window events already exist for `NIA_EVENT_HTML_GENERATION_REQUESTED` and `NIA_EVENT_HTML_MODIFICATION_REQUESTED` (handled in browser-window), but the crash dialog does not auto-dismiss on those events.
- Voice context: `useVoiceSession()` (and voice-session-context) exposes `callStatus`, `toggleCall`, `roomUrl`, `getCallObject`, etc. `useLLMMessaging()` provides `sendMessage()` when a Daily room is active.

## Desired Behavior
1) When the crash dialog appears **and** a voice-only session is active, send a queued LLM message that:
   - Tells the user an error occurred but a fix is possible.
   - Instructs the bot: if the user agrees, call `bot_update_html_applet` with the same payload we would send via Attempt Fix; if they decline, call `bot_close_applet_creation_engine`.
2) Dialog dismissal: once any `HTML_MODIFICATION_REQUESTED` or `HTML_GENERATION_REQUESTED` event fires, hide the crash dialog (clear `error`/status) regardless of voice state.

## Integration Points
- Crash UI and Attempt Fix logic live in HtmlContentViewer (error state, `crashDetails`, `buildModificationRequest()`, `handleAttemptFix()` payload, dispatchHtmlModificationRequested()).
- Voice session detection: use `useVoiceSession()` (preferred) or voice-session-context to read `callStatus === 'active'` and the active room/call object.
- Messaging transport: `useLLMMessaging().sendMessage()` uses Daily + `/api/bot/admin` with `roomUrl`; guard with `isReady`/roomUrl and swallow errors.
- Events to observe for dismissal: `NIA_EVENT_HTML_MODIFICATION_REQUESTED`, `NIA_EVENT_HTML_GENERATION_REQUESTED` (from DailyCall event router).

## Data/Payload to Reuse
From `handleAttemptFix()` payload (current fields):
- `appletId`
- `modificationRequest` (built from crash details)
- `aiProvider` (fallback anthropic)
- `aiModel`
- `assistantName` (agent)
- `versioningPreference: 'modify_existing'`
- `saveChoice: 'original'`
- `handledByUi: true`
- `source: 'applet-crash'`
These should be echoed in the voice message (likely as JSON) so the bot can call `bot_update_html_applet` directly.

## Behaviors to Add (high level design)
- On crash dialog mount (error set, crashDetails present): if voice session active and we have roomUrl/callObject, send one queued system message with the fix/close instructions + payload. Use a ref to avoid duplicate sends per crash instance.
- Provide a short, structured prompt template, e.g.:
  - "An applet crashed. Tell the user you can try to fix it. If they agree, call bot_update_html_applet with: <payload>. If they do not want a fix, call bot_close_applet_creation_engine."
- After any `HTML_MODIFICATION_REQUESTED` or `HTML_GENERATION_REQUESTED` event, clear `error`/`fixRequestStatus`/`crashDetails` and hide the dialog.
- Keep existing Attempt Fix button behavior unchanged; voice path is additive.

## Implementation Checklist
- HtmlContentViewer
  - Add `useVoiceSession()` (or context) to detect active voice call; read `callStatus` and room readiness.
  - Add `useLLMMessaging()` to get `sendMessage` and `isReady`.
  - Add a ref/flag to ensure the voice message fires once per crash occurrence; reset when `error` clears or new applet loads.
  - Derive the Attempt Fix payload via a shared helper (reuse existing payload object used in `handleAttemptFix()`), so voice and button stay in sync.
  - On crash dialog show + voice-active: send queued system message with instructions and serialized payload; log failures but do not block UI.
  - Listen for `NIA_EVENT_HTML_MODIFICATION_REQUESTED` and `NIA_EVENT_HTML_GENERATION_REQUESTED`; on either, clear crash state and hide dialog. Ensure listeners are added/removed in effects.
  - Preserve current retry/Attempt Fix UI; do not regress existing success/failure toasts.

## Testing Plan
- Unit/component (React Testing Library) for HtmlContentViewer:
  - When crash error set and mock voice session active + sendMessage ready => sendMessage called once with expected content/payload.
  - When voice not active or no roomUrl => no sendMessage call.
  - Attempt Fix still dispatches modification event and uses same payload.
  - Receiving `HTML_MODIFICATION_REQUESTED` clears error dialog.
  - Receiving `HTML_GENERATION_REQUESTED` clears error dialog.
- Integration/regression: manually simulate iframe crash, verify voice message appears in bot logs and dialog auto-dismisses after events.

## Open Questions / Risks
- Ensure `modificationRequest` content is safe to echo in LLM prompt (no sensitive data); consider truncation if very large.
- Confirm voice-only detection criterion: use `callStatus === 'active'` from `useVoiceSession()` plus `roomUrl` presence.
- If `sendMessage` fails or voice session drops, UI should degrade gracefully with existing Attempt Fix flow.
