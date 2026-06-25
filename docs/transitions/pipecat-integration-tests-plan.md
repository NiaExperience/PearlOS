# Pipecat Integration Tests Plan

## Objective

Stand up a repeatable integration harness that can launch a Pipecat bot session, feed deterministic input (audio or text), capture its transcription output, and assert against expectations. This provides the foundation for broader end-to-end coverage.

## Scope

- Build reusable test utilities to spin up the bot in runner mode within a test process (no Kubernetes required).
- Stub or simulate Daily transport to deliver scripted STT frames without real audio.
- Capture LLM/TTS output via event bus or transcript frames for assertions.
- Implement an initial “hello world” integration test proving the path end-to-end.
- Expose test commands via npm/poetry for local execution and CI.

### Out of Scope

- Real audio injection or media file playback (can be added later).
- Load/perf testing of multiple concurrent sessions.
- Kubernetes job orchestration.

## Deliverables

1. New integration test module(s) under `apps/pipecat-daily-bot/tests/integration/`.
2. Harness utilities for launching runner sessions and mocking transports.
3. Initial test verifying that a canned user utterance produces an expected bot response.
4. Updated documentation (`README` or dedicated doc) describing how to run the integration suite.

## Approach & Checkpoints

1. **Harness Design**
   - Review existing test fixtures in `bot/tests` (Daily transport mocks, toolbox utilities).
   - Decide between in-process runner vs control server for the harness (prefer runner for isolation).
   - Outline test utilities (async context manager, fake transport, event capture).
   - *Checkpoint A*: Confirm harness architecture before implementation.
2. **Implementation**
   - Create utilities to boot a runner session with canned persona/prompts.
   - Implement fake Daily transport emitting scripted transcription frames.
   - Capture bot output (transcriptions or event bus envelopes) for assertions.
   - *Checkpoint B*: Land initial integration test.
      - ✅ Implemented scripted harness (`tests/integration/harness.py`) plus `test_hello_world` smoke proving round-trip transcript capture.
3. **Chorus Autostart & Tooling**
   - Add pytest session fixture that launches the bundled `scripts/start-chorus-tts.sh` helper whenever `BOT_TTS_PROVIDER=kokoro` or `PIPECAT_AUTOSTART_CHORUS=1`.
   - Respect opt-out flag so standard unit/integration suites stay lightweight when Kokoro isn’t required.
   - Surface last log lines on startup failures and document prerequisites (uv CLI + Kokoro assets).
   - Generate collision-free Daily rooms per run via `PIPECAT_UNIQUE_DAILY_ROOMS` + `DAILY_TEST_ROOM_PREFIX` so multiple engineers/CI jobs can run in parallel without cross-talk.
   - *Checkpoint C*: Live harness can synthesize audio with zero manual prep.
      - ✅ `tests/integration/conftest.py` now autostarts Chorus, waits for `/healthz`, and tears it down automatically.
4. **Documentation & Commands**
   - Add scripts (`npm run`, `poetry run pytest` target) for integration suite.
   - Document usage and future extension points.
   - *Checkpoint D*: Self-review and handoff notes.

## Files & References

- `apps/pipecat-daily-bot/bot/tests/` (existing unit test fixtures).
- `apps/pipecat-daily-bot/bot/runner_main.py` (target entrypoint).
- `apps/pipecat-daily-bot/bot/bot.py` (`build_pipeline`, `run_pipeline_session`).
- `apps/pipecat-daily-bot/bot/toolbox.py` (tool registration).
- `docs/pipecat-architecture.md` for architectural context.

## Test Strategy

- Integration tests executed via pytest.
- Use async test support (pytest-asyncio).
- Ensure deterministic stubs so tests run without external API calls (mock OpenAI/TTS).

## Risks & Mitigations

- **External dependency noise**: Mock OpenAI/TTS clients to avoid network calls. *Mitigation*: patch services in `build_pipeline`.
- **Complex transport stubbing**: Fake Daily transport might require deep hooks. *Mitigation*: leverage existing mocks or create simplified test pipeline bypassing actual audio.
- **Async race conditions**: Integration tests may be flaky without proper synchronization. *Mitigation*: await expected events with timeouts and explicit assertions.

## Success Criteria

- A test suite that can be run locally (`pytest`) without external services, verifying bot response to a scripted utterance.
- Clear path for adding additional integration scenarios (admin prompts, note creation, etc.).
- Documentation explaining execution and extension.
