# Assistant Self-Close Plan

## Objective

Enable assistants to end voice-only sessions on their own via a new `assistantSelfClose` feature flag. Gate dashboard controls, backend tooling, and interface listeners so the capability is enabled only when the assistant explicitly allows it.

## Scope

- Extend shared feature flag definitions with `assistantSelfClose` and align Prism fallbacks.
- Surface assistant-level enablement through the Dashboard (Advanced tab + Model tab) using the existing `endCall` boolean and voice settings.
- Introduce a `bot_end_call` Pipecat tool that emits a dedicated event and ensure the interface reacts by ending active voice sessions.

## Implementation Outline

1. **Feature Flag Wiring**
   - Add `assistantSelfClose` to `@nia/features` (`FeatureKey` union, registry defaults, manifest fallbacks).
   - Update Prism `Assistant` fallback feature keys to keep schema parity.
   - Adjust dashboard feature normalization so `assistantSelfClose` mirrors the assistant's `endCall` value.
2. **Dashboard Experience**
   - Sync Advanced tab feature selection with the `endCall` boolean (toggle updates both).
   - Disable the Model tab "Enable End Call" switch unless `assistantSelfClose` is enabled; show tooltip guidance.
   - Auto-clear `voice.endCallFunctionEnabled` when the feature is disabled to avoid stale state.
   - Expand unit coverage for normalization and UI toggle behavior.
3. **Runtime + Bot Integration**
   - Define a new event descriptor (e.g., `call.end`) in `@nia/events` and regenerate artifacts.
   - Implement the `bot_end_call` tool (flagged by `assistantSelfClose`) that emits the new event via the forwarder.
   - Regenerate the bot tools manifest to expose the tool to feature prompts.
   - Extend the interface event router/constants and `useVoiceSession` to listen for the new event and invoke `stop()` safely.

## Checkpoints

- **Checkpoint 1:** Feature flag definitions + normalization updates (`packages/features`, Prism fallback, dashboard normalization) validated via lint/type checks.
- **Checkpoint 2:** Dashboard UI synchronization (Advanced tab + Model tab) with accompanying Jest tests for normalization and switch disablement.
- **Checkpoint 3:** Event + runtime integration (events descriptor/codegen, Pipecat tool, manifest refresh, interface listener) verified with targeted unit tests where applicable.

## Testing Strategy

- `npm run test:js -- --runTestsByPath apps/dashboard/__tests__/feature-normalization.test.ts`
- `npm run test:js -- --runTestsByPath apps/dashboard/src/components/__tests__/assistant-model-tab.test.tsx` (new or updated)
- Interface hook/unit test additions as needed (e.g., `useVoiceSession`).
- Manual smoke via local voice session (if feasible) after automated coverage.

## Risks & Mitigations

- **Event propagation mismatch:** Ensure event enum names align across generator outputs; run codegen immediately after descriptor edits.
- **Form state drift:** Watchers must avoid stale toggles—reset voice flag when feature disabled.
- **Manifest staleness:** Regenerate bot manifest post tool addition to keep registry consistent.
- **Test fragility:** UI tests relying on tooltip/switch should use roles/text instead of brittle DOM traversal.
