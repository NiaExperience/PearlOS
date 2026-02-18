## Objective
- Add crash-handling improvements to `HtmlContentViewer` so crashes capture actionable trace context, offer an "Attempt Fix" action, close the viewer on click, call the fix-crash endpoint with an LLM-ready payload, and emit the `HTML_MODIFICATION_REQUESTED` event.

## Scope
- Update crash detection in `HtmlContentViewer` to collect trace details and surface a richer error UI.
- Add an "Attempt Fix" button that closes the viewer/error surface, triggers the fix API, and emits the modification event.
- Format the trace payload for the fix endpoint with enough context for LLM remediation.
- Wire the event emission using the existing NIA event router constants.

### Out of Scope
- Changes to backend fix-crash API semantics.
- New feature flags or event schema updates.
- Broader applet lifecycle refactors beyond the crash flow.

## Requirements / Acceptance Criteria
- On iframe crash, capture error kind/message plus a minimal trace snapshot (stack/message, content type, applet id/title, agent/tenant, generation diagnostics if present).
- Error UI shows crash text and provides "Attempt Fix" alongside existing retry.
- Clicking "Attempt Fix" closes the viewer, posts the trace payload to the fix-crash endpoint, and emits `HTML_MODIFICATION_REQUESTED`.
- API request includes LLM-ready context (crash summary, environment hints, applet metadata, html/css/js lengths) and tolerates missing optional data.
- Viewer closes/hides immediately on action (even if API fails) and surfaces toast or log for failures without blocking.

## Files / Modules
- `apps/interface/src/features/HtmlGeneration/components/HtmlContentViewer.tsx`
- `apps/interface/src/features/DailyCall/events/niaEventRouter.ts` (for constants import only)

## Implementation Plan
1) Extend crash handler to capture structured crash info (type, message, stack if provided, timestamps, applet metadata, content lengths, diagnostics/opId/agent/tenant hints) and store in state.
2) Update error UI to include an "Attempt Fix" button; ensure existing Retry remains.
3) Implement fix handler: close viewer/error overlay, build payload, call fix-crash endpoint, emit `NIA_EVENT_HTML_MODIFICATION_REQUESTED` with relevant envelope/payload, and log/notify on failures.
4) Ensure event dispatch and API call are guarded (only when appletId exists) and idempotent per crash instance.
5) Add minimal logging for observability (use existing logger) without leaking PII.

## Testing Strategy
- Manual: force iframe crash (e.g., throw in applet script) and verify crash UI shows Attempt Fix and Retry, viewer hides on fix click, API call issued with payload, event fired (can observe via listener), and retry still reloads iframe.
- Regression: quick lint/type awareness; no automated test harness in place for iframe postMessage yet.

## Risks / Mitigations
- Missing applet context could make payload sparse: guard optional fields and log when absent.
- API failure on fix request: show toast/log but avoid blocking user; keep viewer closed to prevent loop.
- Event emission without schema validation: ensure payload matches current event patterns and avoid sensitive data.

## Checkpoints
- After state/UI wiring (crash data + buttons) is coded.
- After fix handler with API + event wiring is complete.