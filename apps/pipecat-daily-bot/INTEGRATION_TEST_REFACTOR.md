# Integration Test Infrastructure Refactoring

**Date:** 2025-01-20  
**Status:** ✅ Complete  
**Related:** Preparation for bot.py DDD refactoring (REFACTOR_PLAN.md Option 2)

## Objective

Simplify integration test infrastructure by removing external API dependencies and adding tool call verification capabilities.

## Changes Made

### 1. Removed ElevenLabs Auto-Synthesis ✅

**File:** `apps/pipecat-daily-bot/bot/tests/integration/harness.py`

**Before:**

- `_load_or_generate_clip()` would call ElevenLabs API if fixture didn't exist
- Required `ELEVEN_LABS_API_KEY` environment variable
- Added external dependency and network latency to tests

**After:**

- Renamed to `_load_audio_fixture()`
- Only loads existing wav files from `resources/` directory
- Raises `FileNotFoundError` if fixture missing
- All fixtures must be pre-recorded and version-controlled

**Benefits:**

- No external API dependencies during test runs
- Faster test execution (no network calls)
- Deterministic test behavior (same audio every time)
- Fixtures are versioned with code changes

### 2. Made Audio Fixtures Configurable ✅

**File:** `apps/pipecat-daily-bot/bot/tests/integration/harness.py`

**Enhancement:**

- `LiveSessionConfig.audio_fixture_name` field already existed
- Updated default from `"user_clip.wav"` to `"hello_how_are_you.wav"`
- Tests can now specify different fixtures per scenario

**Usage:**

```python
config = LiveSessionConfig.from_env()
config.audio_fixture_name = "open_notepad.wav"  # Custom fixture
config.enable_user_audio = True
result = await run_live_session(config)
```

### 3. Added Tool Call Tracking ✅

**File:** `apps/pipecat-daily-bot/bot/tests/integration/harness.py`

**Changes:**

- Added `tool_calls` field to `SessionResult` dataclass
- Extracts tool calls from assistant messages in `run_live_session()`
- Tool call format:

  ```python
  {
      "id": "call_xyz123",
      "name": "bot_open_notes",
      "arguments": "{...}"
  }
  ```

**Benefits:**

- Tests can verify bot behavior beyond just text responses
- Enables testing of function calling and tool invocation
- Critical for testing features like notes, reminders, etc.

### 4. Updated test_conversation.py ✅

**File:** `apps/pipecat-daily-bot/bot/tests/integration/test_conversation.py`

**Removed:**

- `config.user_message = "Hi there..."`
- `config.synthesize_text = config.user_message`

**Added:**

- `config.audio_fixture_name = "hello_how_are_you.wav"`

**Result:**

- Simpler, more explicit configuration
- Removed ElevenLabs synthesis dependency
- Uses pre-recorded fixture

### 5. Created test_notepad.py ✅

**File:** `apps/pipecat-daily-bot/bot/tests/integration/test_notepad.py`

**Purpose:**

- Verify bot correctly invokes `bot_open_notes` tool
- Uses `open_notepad.wav` fixture (user saying "open notepad")

**Assertions:**

```python
assert result.tool_calls, "bot should have made at least one tool call"
tool_names = [tc["name"] for tc in result.tool_calls]
assert "bot_open_notes" in tool_names
```

**Benefits:**

- Tests end-to-end tool calling behavior
- Validates Daily transcription → LLM → tool invocation flow
- Complements existing conversation tests

## Audio Fixtures

### hello_how_are_you.wav (134KB)

- **Purpose:** General conversation test
- **Content:** User greeting and question
- **Used by:** `test_conversation.py`
- **Formerly:** `user_clip.wav`

### open_notepad.wav (193KB)

- **Purpose:** Tool invocation test
- **Content:** User requesting to open notepad
- **Used by:** `test_notepad.py`
- **Expected:** Bot calls `bot_open_notes` tool

## Migration Guide

### For Test Authors

**Old Pattern (DON'T USE):**

```python
config = LiveSessionConfig.from_env()
config.user_message = "Some text to synthesize"
config.synthesize_text = config.user_message  # Calls ElevenLabs
config.enable_user_audio = True
```

**New Pattern (USE THIS):**

```python
config = LiveSessionConfig.from_env()
config.audio_fixture_name = "your_fixture.wav"  # Pre-recorded file
config.enable_user_audio = True
```

### Creating New Fixtures

1. Record audio or use existing recordings
2. Convert to 16kHz mono wav format
3. Save in `apps/pipecat-daily-bot/bot/tests/integration/resources/`
4. Use descriptive filename (e.g., `ask_about_weather.wav`)
5. Reference in test via `config.audio_fixture_name`

### Tool Call Verification

Access tool calls via `SessionResult`:

```python
result = await run_live_session(config)

# Check if any tools were called
assert result.tool_calls

# Verify specific tool
tool_names = [tc["name"] for tc in result.tool_calls]
assert "bot_open_notes" in tool_names

# Check tool arguments
notes_calls = [tc for tc in result.tool_calls if tc["name"] == "bot_open_notes"]
assert notes_calls[0]["arguments"]  # Verify arguments passed
```

## Quality Gates

All changes passed:

- ✅ Codacy analysis (no issues)
- ✅ File structure validated
- ✅ Fixtures renamed and present
- ✅ Test discovery working

## Next Steps

With this infrastructure in place, we're ready to:

1. Begin Option 2 (DDD) refactoring of `bot.py`
2. Extract domain logic into focused modules
3. Add integration tests for each domain capability
4. Use tool call tracking to verify behavior during refactoring

## Related Documents

- `REFACTOR_PLAN.md` - DDD refactoring plan (Option 2)
- `README.testing.md` - Testing guidelines
- `apps/pipecat-daily-bot/bot/tests/integration/README.md` - Integration test docs
