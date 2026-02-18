# DailyCall Event Adapter (Placeholder)

Purpose: Define the minimal event topics and payload contracts we intend to emit from the browser DailyCall feature so they can merge cleanly with the Python event bus work in `staging-pipecat-events`.

We DO NOT implement a full bus here to avoid divergence. Instead we surface a noop publish layer that mirrors the intended API.

## Intended Topics (browser -> unified bus)

| Topic | When | Payload Draft |
|-------|------|---------------|
| `daily.join` | Local user successfully joins room | `{ userId, username, roomUrl, ts }` |
| `daily.leave` | Local user leaves room | `{ userId, username, roomUrl, reason?, ts }` |
| `daily.participant.update` | Participant track/state change (debounced) | `{ participantId, username?, joined, tracks: { audio:boolean, video:boolean }, local:boolean, ts }` |
| `daily.error` | Recoverable error surfaced to UI | `{ code?, message, fatal?:boolean, ts }` |
| `daily.state` | Periodic aggregate snapshot (optional later) | `{ roomUrl, participantCount, activeSpeakerId?, ts }` |

These mirror/extend the existing builtin topic `daily.error` already present in Python bus registry. Additional schemas will be aligned with the generated registry mechanism later (see `packages/event-topics`).

## Adapter Responsibilities (future)

1. Subscribe to Daily SDK events.
2. Normalize payload (strip large objects, redact PII if needed).
3. Publish via shared JS bus (once integrated) AND optionally window `postMessage` / websocket for cross-surface analytics.
4. Provide a lightweight hook `useDailyBus()` for components.

## Redaction Notes

Fields likely to redact (depending on policy later): `error.message` (partial), any raw SDP, network stats.

## Merge Strategy

- Keep this file stable; Python side can introduce schemas first.
- After merging `staging-pipecat-events`, replace noop implementation in `adapter.ts` with real bus integration.

## Testing Plan (future)

- Mock Daily object; trigger synthetic events; assert publish calls (spy) with expected payload shape.
- Snapshot test for redaction logic.

## Open Questions

- Should we buffer join/leave during reconnection phases? (Tentatively no; emit real-time.)
- Do we emit per-track events or aggregated participant updates? (Plan: aggregated with debounce.)

---
This placeholder intentionally avoids adding dependencies or runtime side effects.
