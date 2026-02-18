# Kokoro Voice Parameters Integration Plan

## Objective *(Completed)*
Deliver Kokoro-specific text-to-speech configuration end-to-end: extend the dashboard so users can pick Kokoro voices and settings, persist those choices, surface them through Mesh/Prism, have `apps/interface` read and forward the values, and ensure the Pipecat daily bot consumes the new parameters safely.

## Scope *(Completed)*
- Dashboard: add Kokoro provider option, Kokoro voice list, and Kokoro-specific knobs in the Additional Configuration section.
- Schema/persistence: expand assistant voice schemas (Zod, Mongoose, shared block) so Kokoro data round-trips without validation errors.
- Interface: recognize Kokoro provider, pass voice settings via `/api/bot/join`.
- Pipecat bot: accept Kokoro fields in join payloads, map to config/env, and forward into `KokoroTTSService`.

Out of scope: dynamic voice fetching from Kokoro, non-English options, runtime availability checks, or broader feature flagging.

## Key Modules
- Dashboard: `assistant-voice-tab.tsx`, `assistant-tabs.tsx`, `migration/schemas/assistant.schema.ts`, `migration/models/assistant.model.ts`, `migration/types/assistant.types.ts`.
- Shared schema: `packages/prism/src/core/blocks/assistant.block.ts`.
- Interface: `app/[assistantId]/page.tsx`, `components/assistant-canvas.tsx`, `components/browser-window.tsx`, `features/DailyCall/components/Call.tsx`, `features/DailyCall/lib/botClient.ts`, `hooks/useVoiceSession.ts`.
- Pipecat bot: `bot/config.py`, `bot/kokoro_tts_service.py`, `bot/bot.py`, `bot/server.py`, `bot/tests/test_build_pipeline.py`.

## Kokoro Settings to Support (initial defaults)
- Provider: `'kokoro'`.
- Voice selection: hardcoded list restricted to English voices currently available from Chorus:
  - **American (en-US)**  
    `af_alloy`, `af_aoede`, `af_bella`, `af_heart`, `af_jessica`, `af_kore`, `af_nicole`, `af_nova`, `af_river`, `af_sarah`, `af_sky`, `am_adam`, `am_echo`, `am_eric`, `am_fenrir`, `am_liam`, `am_michael`, `am_onyx`, `am_puck`
  - **British (en-GB)**  
    `bf_alice`, `bf_emma`, `bf_isabella`, `bf_lily`, `bm_daniel`, `bm_fable`, `bm_george`, `bm_lewis`
- Additional configuration: none for the first iteration. We expose only provider + voice choice and rely on server defaults for all other Kokoro tuning values.

## Implementation Steps (Status)
1. **Shared Schemas** ✅  
   Added Kokoro to provider enums across Zod, Mongoose, TS, and the shared Assistant block.

2. **Dashboard UI** ✅  
   Provider dropdown now includes Kokoro, renders the English-only voice list, and hides ElevenLabs-only sliders.

3. **Persistence** ✅  
   No additional work required beyond schema updates.

4. **Interface Wiring** ✅  
   Kokoro provider + voice ID propagate through DailyCall voice joins and `/api/bot/join`.

5. **Pipecat Bot** ✅  
   Join payload accepts `voiceProvider`, sets `BOT_TTS_PROVIDER`, and preserves voice ID throughout pool and direct spawns.

6. **Testing** Progress  
   - Dashboard unit test for Kokoro UI: TODO  
   - Interface join tests updated to cover `voiceProvider` ✅  
   - Pipecat pipeline unit coverage for Kokoro parameters: TODO  
   - Manual end-to-end validation completed ✅

7. **Docs & Cleanup** ✅  
   Plan documented here; helper text to be revisited alongside future Kokoro controls.

## Risks & Mitigations
- **Schema drift**: ensure Zod, Mongoose, TS, and shared block all change together; run type-check + lint.
- **Mesh breakage**: regenerate codegen after schema update.
- **Env mismatch**: double-check field names align with existing `KOKORO_TTS_*` getters; write tests.
- **Provider switching**: reset stale ElevenLabs fields when toggling to Kokoro to avoid mixed data.

## Quality Gates
- Run `npm run lint`, `type-check`, `build`, `test` in dashboard and interface.
- Run bot pytest suite (`npm test` from `apps/pipecat-daily-bot` or `poetry run pytest`).
- Perform manual integration test as described in testing section.

## Suggested Next Steps (for junior engineer)
1. Update shared schemas/types first.
2. Implement dashboard UI changes.
3. Extend interface join payload + tests.
4. Update Pipecat server/bot + tests.
5. Run automated suites and manual validation.
