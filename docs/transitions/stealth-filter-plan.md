Objective
- Ensure Daily stealth participants using session_user_id `nia-stealth-user` are excluded from roster/system prompts and do not trigger greetings.

Scope
- Update stealth detection logic in bot session handling to treat the shared stealth session_user_id as stealth even without an explicit flag or username prefix.
- Keep changes limited to pipecat-daily-bot participant detection and related tests.

Files To Touch
- apps/pipecat-daily-bot/bot/session/participant_data.py
- apps/pipecat-daily-bot/bot/session/events.py
- apps/pipecat-daily-bot/bot/tests/test_participants.py
- apps/pipecat-daily-bot/bot/tests/test_local_bot_greeting_exclusion.py (if needed for behavior coverage)

Test Strategy
- Targeted pytest for updated modules (new/adjusted unit tests).
- Focus on scenarios where session_user_id is the stealth sentinel with no explicit stealth flag and a non-stealth-looking name.

Risks
- Missing another stealth identifier shape beyond the sentinel ID.
- Over-matching legitimate users if detection is too broad.

Checkpoints
- Detection logic updated and centralized for stealth ID.
- Unit/regression tests added for stealth ID without flag.
- Tests executed and passing.