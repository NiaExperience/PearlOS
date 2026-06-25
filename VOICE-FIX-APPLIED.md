# Voice Latency Fix - APPLIED
**Date:** 2026-02-22  
**Status:** ✅ DEPLOYED AND TESTED

## Changes Made

**File:** `apps/pipecat-daily-bot/.env` (not in git - contains API keys)

**Change:**
```diff
- BOT_FAST_MODEL=anthropic/claude-sonnet-4.5
+ BOT_FAST_MODEL=groq/llama-3.1-8b-instant

- # GROQ_API_KEY removed — using OpenRouter only
+ GROQ_API_KEY='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'
```

## Results

**Before:**
- TTFB: 5-15 seconds
- Fast model fell back to OpenClaw gateway
- 9,350 tokens of context overhead per turn
- Anthropic Sonnet 4.5 (slow, expensive for simple chat)

**After:**
- TTFB: ~300ms (confirmed in live test with Blair)
- Direct API bypass via Groq
- Minimal context overhead
- Llama 3.1 8B (fast, open source)

**Performance improvement: 30-50x faster**

## Known Issues

⚠️ **Tool access not working in fast path** - Agent `groq-tool-access-fix` investigating

Background tool execution shows "no tools called" even when router detects tools are needed. Fast path may not be passing tool schemas to Groq API.

## Notes

- Groq API key is production key from Blair
- Llama 3.1 8B is Meta's open source model (can run locally via Ollama if needed)
- Fast voice quality is good for conversational responses
- Main model (Haiku via OpenClaw) still handles complex reasoning + tools
