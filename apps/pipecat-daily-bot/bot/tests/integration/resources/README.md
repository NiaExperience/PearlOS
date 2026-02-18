# Test Audio Fixtures

This directory contains cached audio clips used in integration tests.

## Purpose

Audio fixtures are generated manually and committed to the repository for use by other developers and [possibly] CI environments.

## Files

- `hello_how_are_you.wav` - Cached audio of the default test utterance ("Hello, how are you?")

## Git Behavior

**These fixtures ARE committed to the repository.** This ensures:

- ✅ CI environments run tests without requiring API credentials
- ✅ Consistent test audio across all environments
- ✅ Faster test execution (no synthesis delay)



## File Size

Each `.wav` file is typically ~100-300KB, making it acceptable to commit to the repository.
