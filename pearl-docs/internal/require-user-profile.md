# RequireUserProfile Feature Plan

## Overview
- Goal: gate DailyCall launch behind complete user profile data.
- Flag: `requireUserProfile` (dashboard label: `RequireUserProfile`, lives in `packages/features`).
- Scope: DailyCall entry flow, avatar/Vapi session orchestration, profile data capture, telemetry.

## User Flow Updates
1. **Login → DailyCall Launch Attempt**
   - Fetch profile for `session.user.id`.
   - If profile missing → trigger avatar session.
   - If profile present but `first_name` empty → trigger avatar session.
   - If profile present with `first_name` → continue DailyCall launch without delay.
2. **Avatar Session Loop**
   - Launch assistant (same pathway as assistant button).
   - Constrain conversation to gathering mandatory profile fields (first name minimum, optionally last name, pronouns).
   - On assistant close, re-run DailyCall gating logic (loop until profile passes checks or feature flag disabled).

## Technical Workstreams
| Area | Tasks |
| --- | --- |
| Feature Flag | Add `requireUserProfile` definition in `packages/features` (typed config, exposure via dashboard). |
| Backend Services | Extend user profile service to expose quick lookup endpoint (fast path for DailyCall). Ensure cache coherence after profile updates. |
| Interface App | Update DailyCall entry point to evaluate flag + profile, orchestrate avatar session loop, handle loading states and error cases. |
| Assistant/Vapi | Introduce session variant for profile collection (prompting, metadata tags, exit events). |
| Dashboard | Display new flag with `RequireUserProfile` label, tooltips documenting behavior. |
| Telemetry | Emit events for gating decisions, avatar session starts/completions, profile completion success/failure. |

## Data & APIs

- Required fields: `first_name` (hard requirement), optional future extension for other profile fields.
- Ensure profile write path triggers cache/Realtime updates so second loop sees new data.
- Consider rate limiting or cooldown to avoid rapid assistant relaunch loops.

## Edge Cases

- Network errors fetching profile → fall back to avatar session after presenting retry UI.
- Assistant cancellation without profile changes → loop should respect user opting out after N attempts (configurable).
- Feature flag disabled → DailyCall behaves as current baseline.

## Testing Strategy

- Unit tests for gating logic (with/without profile, missing fields).
- Integration tests covering avatar session loop and success path.
- End-to-end scenario: new user completes profile through assistant, DailyCall auto-relaunches.
- Telemetry assertions for emitted events.

## Rollout Plan

- Default flag off in production.
- Dogfood with internal cohorts, monitor retry loops and completion rates.
- Gradual enablement per workspace; add guardrails to disable quickly if assistant errors spike.
- Document operator runbook for troubleshooting (e.g., avatar service outages).

## Open Questions

- Additional required fields beyond first name?
- Timeouts before offering manual profile form instead of assistant?
- Analytics hooks needed by product for measuring success?
- Localization requirements for assistant prompts?
