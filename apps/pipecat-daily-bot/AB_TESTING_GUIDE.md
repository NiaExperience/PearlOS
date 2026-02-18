# A/B Testing Guide: Model Selection

## Quick Start

Switch between LLM models by editing `.env` and restarting the bot gateway.

## Available Models

| Model | Provider | Speed | Quality | Cost | Tool Calling |
|-------|----------|-------|---------|------|--------------|
| **gpt-4o-mini** | OpenAI | Fast (~2s) | Good | $$ | ✅ Excellent |
| **llama-4-scout** | Groq | Fastest (<1s) | Basic | $ | ⚠️ Limited |
| **llama-3.3-70b** | Groq | Fast (~2s) | Excellent | $ | ✅ Good |
| **hermes-4-70b** | OpenRouter | Medium (~4s) | Excellent | $$ | ✅ Best uncensored |

## How to Test

### 1. Edit `.env` File

Open `/workspace/nia-universal/apps/pipecat-daily-bot/.env` and change:

```bash
BOT_MODEL_SELECTION=gpt-4o-mini
```

To one of:
- `gpt-4o-mini` (default, baseline)
- `llama-4-scout` (fastest, cheapest)
- `llama-3.3-70b` (proven, recommended)
- `hermes-4-70b` (best uncensored + tool calling)

### 2. Restart Bot Gateway

```bash
cd /workspace/nia-universal/apps/pipecat-daily-bot
python -m bot.bot_gateway
```

**Look for this log line to confirm the model loaded:**
```
🧪 A/B TEST MODE: BOT_MODEL_SELECTION=llama-3.3-70b
```

### 3. Test Tool Calls

For each model, test these scenarios:

**Quick Tools (1-2 calls):**
- ✅ "Create a note about testing"
- ✅ "Play a YouTube video about cats"
- ✅ "What windows are open?"

**Complex Tools (3+ calls):**
- ✅ "Research AI agents and create a note with the top 5 findings"
- ✅ "Find a video about cooking pasta and summarize the recipe in a note"

**Conversation Quality:**
- ✅ Natural back-and-forth dialogue
- ✅ Context retention across turns
- ✅ Personality consistency

### 4. Metrics to Track

| Metric | How to Measure |
|--------|----------------|
| **Latency** | Time from request to first audio response |
| **Tool Success** | Did the tool call work correctly? |
| **Quality** | Natural language, context awareness |
| **Cost** | Tokens used (check provider dashboard) |

### Example Test Matrix

```
Model: gpt-4o-mini
├─ Create note: ✅ 2.1s, perfect
├─ Play YouTube: ✅ 2.3s, found right video
├─ List windows: ✅ 1.8s, accurate
└─ Complex research: ✅ 8.5s, 3 tools chained well

Model: llama-4-scout
├─ Create note: ⚠️ 0.8s, formatting issues
├─ Play YouTube: ❌ Failed to parse tool call
└─ ...

Model: llama-3.3-70b
├─ Create note: ✅ 1.9s, excellent
├─ Play YouTube: ✅ 2.1s, perfect
└─ Complex research: ✅ 7.2s, great quality
```

## Troubleshooting

### Model Won't Load

**Error:** `GROQ_API_KEY is required for llama-4-scout`

**Fix:** Verify API key is set in `.env`:
```bash
GROQ_API_KEY='your-key-here'
```

### Tool Calls Fail

**Issue:** Model not calling tools correctly

**Test:** Some models (especially llama-4-scout) have weaker function calling. Try:
1. Llama 3.3 70B (best Groq option)
2. Hermes 4 70B (best OpenRouter option)
3. GPT-4o-mini (most reliable baseline)

### High Latency

**Issue:** Model is too slow

**Check:**
- Network latency to provider
- Model size (70B models are slower than 8B)
- Provider infrastructure (Groq LPU is fastest)

## Recommended Testing Order

1. **Baseline:** Start with `gpt-4o-mini` — establish expected behavior
2. **Speed:** Try `llama-4-scout` — test fastest option
3. **Quality:** Try `llama-3.3-70b` — best balance of speed + quality
4. **Advanced:** Try `hermes-4-70b` — uncensored, best tool calling

## Quick Model Comparison

```bash
# Fastest (but basic tool calling)
BOT_MODEL_SELECTION=llama-4-scout

# Best balance (speed + quality + tool calling)
BOT_MODEL_SELECTION=llama-3.3-70b

# Most reliable (proven baseline)
BOT_MODEL_SELECTION=gpt-4o-mini

# Best uncensored (advanced users)
BOT_MODEL_SELECTION=hermes-4-70b
```

## Notes

- **Tool calling quality varies significantly** — GPT-4o-mini and Llama 3.3 70B are most reliable
- **Latency depends on provider infrastructure** — Groq's LPU is faster than OpenRouter
- **Cost per token varies** — Groq is cheapest, OpenAI is mid-range, OpenRouter varies by model
- **You can hot-swap models anytime** — just restart the gateway, no code changes needed

## Friend's Testing Checklist

- [ ] Baseline with gpt-4o-mini (confirm tools work)
- [ ] Test llama-4-scout (speed check)
- [ ] Test llama-3.3-70b (quality check)
- [ ] Test hermes-4-70b (advanced features)
- [ ] Document latency for each model
- [ ] Document tool success rate for each model
- [ ] Pick winner for production deployment

**Target:** Find the model with best latency + quality balance for your use case.

**ETA:** 15-20 minutes to test all 4 models with 3-5 tool calls each.
