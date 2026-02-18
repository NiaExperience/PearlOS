## Objective

Expose Kokoro-specific voice controls in the dashboard so operators can tune speech speed and ensure the selected English dialect propagates through the interface into Pipecat and ultimately Chorus TTS (Kokoro), meeting the `en-us`/`en-gb` requirement.

## Scope

### In Scope
- Update `apps/dashboard` Kokoro voice UI to surface a speed slider, map Kokoro voice choices to default locale codes, and persist these values.
- Thread Kokoro `voice.speed` and `voice.language` through `apps/interface` so both voice-only and DailyCall flows send the values (lowercased) in bot join requests.
- Update `apps/pipecat-daily-bot` to honour the incoming speed/language parameters when spawning or reusing bots, including setting `KOKORO_TTS_LANGUAGE_CODE` per session.

### Out of Scope
- Supporting non-English Kokoro voices or locale discovery beyond the current American/British list.
- Refactoring broader voice configuration UX or non-Kokoro providers.
- Any changes inside Chorus TTS beyond consuming the already-supported speed/lang inputs.

## Work Breakdown

1. **Dashboard Kokoro UX**
   - Extend `assistant-voice-tab` to annotate Kokoro options with locale metadata and set `voice.language` accordingly.
   - Show a Kokoro speed slider (0.5–2.0 range, step 0.1) and clamp stored speed to valid bounds.
   - Ensure defaults apply when switching providers (e.g., fallback speed of `1.0` and relevant language).

2. **Interface Data Plumbing**
   - Expand voice parameter typings (`assistant-canvas`, `useVoiceSession`, `BrowserWindow`, etc.) to include an optional `language`.
   - When building `voiceParameters`, inject speed and language (lowercased) for Kokoro voices, both for desktop DailyCall launches and voice-session joins.
   - Reuse helper logic so future Kokoro voices can map to locale codes in a single place.

3. **Pipecat Daily Bot Integration**
   - When handling `voiceParameters`, set `KOKORO_TTS_LANGUAGE_CODE` (and continue to expose speed) for both pool-based and direct bot spawns.
   - In pooled workers (`bot.py`), set env vars prior to instantiating `KokoroTTSService` so per-session overrides stick.

4. **Validation & Cleanup**
   - Update/extend unit tests (e.g., dashboard form behaviour if feasible, or TypeScript utility tests) to confirm language lowercasing and payload composition.
   - Verify existing voice-parameter tests still pass with the updated payload expectations.

## Files / Areas
- `apps/dashboard/src/components/assistant-voice-tab.tsx`
- `apps/interface/src/app/[assistantId]/page.tsx`
- `apps/interface/src/components/assistant-canvas.tsx`
- `apps/interface/src/hooks/useVoiceSession.ts`
- `apps/interface/src/components/browser-window.tsx`
- `apps/interface/src/features/DailyCall` (selected components/tests)
- `apps/pipecat-daily-bot/bot/server.py`
- `apps/pipecat-daily-bot/bot/bot.py`
- New shared helper(s) for locale mapping if needed.

## Tests
- Dashboard: spot-check via jest/unit if practical (otherwise rely on type guards and storybook manual QA — note in risks).
- Interface: extend existing `voice-parameters` test to assert language is lowercased for Kokoro provider.
- Pipecat: add/adjust unit tests to confirm env wiring (or integration tests if existing harness allows).
- Regression: run `npm run lint`, `npm run type-check`, and targeted Jest suites (`npm run test:js -- --runTestsByPath …`) for modified areas.

## Risks & Mitigations
- **Schema mismatch**: dashboard storing lowercase codes could conflict with existing enum (`en-US`). Mitigate by storing uppercase but lowercasing only when emitting requests.
- **Missing helper coverage**: Without centralising locale mapping, duplicate logic may drift; create a single mapping utility reused by dashboard/interface.
- **Env contamination**: Forgetting to reset `KOKORO_TTS_LANGUAGE_CODE` between sessions may leak settings; ensure we overwrite per join.

## Open Questions
- None at this time.
