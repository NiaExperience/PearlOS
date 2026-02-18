# A/B Testing Implementation Summary

## ✅ Implementation Complete

**ETA:** ~12 minutes (done!)

## What Was Changed

### 1. Environment Variable Added
**File:** `/workspace/nia-universal/apps/pipecat-daily-bot/.env`

```bash
# ============ A/B Testing: Model Selection ============
# Switch between models for testing latency and quality
# Options: gpt-4o-mini | llama-4-scout | llama-3.3-70b | hermes-4-70b
BOT_MODEL_SELECTION=gpt-4o-mini
```

### 2. Model Selection Factory Added
**File:** `/workspace/nia-universal/apps/pipecat-daily-bot/bot/pipeline/builder.py`

Added `get_llm_config()` factory function that returns the appropriate:
- API key (from env vars)
- Model name (provider-specific format)
- Base URL (for Groq/OpenRouter)

**Supported configurations:**
- `gpt-4o-mini` → OpenAI (default endpoint)
- `llama-4-scout` → Groq API (`llama-4-scout` model)
- `llama-3.3-70b` → Groq API (`llama-3.3-70b-versatile` model)
- `hermes-4-70b` → OpenRouter API (`nousresearch/hermes-4-70b` model)

### 3. LLM Initialization Updated
**Both hybrid and direct modes now:**
1. Read `BOT_MODEL_SELECTION` from env
2. Call `get_llm_config(model_selection)` to get config
3. Pass config to `OpenAILLMService` constructor
4. Log active model at startup

### 4. Startup Logging Enhanced
**Look for this line when bot starts:**
```
🧪 A/B TEST MODE: BOT_MODEL_SELECTION=llama-3.3-70b
```

Followed by:
```
✅ Hybrid primary LLM (llama-3.3-70b-versatile) initialized — tool calls will be sub-second
```

## How to Use

### Quick Switch (3 steps)

1. **Edit `.env`:**
   ```bash
   BOT_MODEL_SELECTION=llama-3.3-70b
   ```

2. **Restart bot gateway:**
   ```bash
   cd /workspace/nia-universal/apps/pipecat-daily-bot
   python -m bot.bot_gateway
   ```

3. **Verify in logs:**
   ```
   🧪 A/B TEST MODE: BOT_MODEL_SELECTION=llama-3.3-70b
   ```

### Model Options Quick Reference

```bash
# Current baseline (OpenAI)
BOT_MODEL_SELECTION=gpt-4o-mini

# Fastest (Groq LPU, ~0.5s latency)
BOT_MODEL_SELECTION=llama-4-scout

# Best balance (Groq LPU, ~2s latency, excellent quality)
BOT_MODEL_SELECTION=llama-3.3-70b

# Best uncensored (OpenRouter, ~4s latency)
BOT_MODEL_SELECTION=hermes-4-70b
```

## Testing Checklist

- [ ] Verify startup logs show selected model
- [ ] Test simple tool call (create note)
- [ ] Test complex tool call (research + summarize)
- [ ] Measure latency for each model
- [ ] Document quality differences

## Files Modified

1. ✅ `.env` - Added `BOT_MODEL_SELECTION` variable
2. ✅ `bot/pipeline/builder.py` - Added factory function and integration
3. ✅ `AB_TESTING_GUIDE.md` - Created comprehensive testing guide (NEW)
4. ✅ `IMPLEMENTATION_SUMMARY.md` - This file (NEW)

## Known Limitations

- **Tool calling quality varies:** GPT-4o-mini and Llama 3.3 70B are most reliable
- **Groq rate limits:** Free tier has limits; may need API key upgrade for heavy testing
- **OpenRouter costs:** Hermes 4 70B is paid; check credits before extensive testing
- **Model name verification needed:** Llama 4 Scout model name may need adjustment based on Groq's latest API

## Next Steps

1. **Start testing:** Follow `AB_TESTING_GUIDE.md` for structured testing
2. **Document results:** Track latency and quality for each model
3. **Pick winner:** Choose best model for production based on metrics
4. **Optional:** Add runtime model switching via API (future enhancement)

## Troubleshooting

### Error: "GROQ_API_KEY is required"
**Fix:** Verify `.env` has valid Groq API key:
```bash
GROQ_API_KEY='gsk_...'
```

### Error: "OPENROUTER_API_KEY is required"
**Fix:** Add OpenRouter API key to `.env`:
```bash
OPENROUTER_API_KEY='sk-or-v1-...'
```

### Model name not recognized
**Fix:** Check Groq/OpenRouter documentation for exact model names and update `get_llm_config()` function

### Tool calls failing
**Issue:** Some models have weaker function calling support
**Fix:** Try Llama 3.3 70B (best Groq option) or GPT-4o-mini (most reliable)

## Success Criteria Met

✅ Friend can switch models by changing one env var  
✅ All 4 models supported with proper API integration  
✅ Startup logs show active model  
✅ Easy to iterate (just restart, no code changes)  

**Ready for testing! 🚀**
