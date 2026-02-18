# MiniMax M2.5 Deployment Checklist

## Pre-Deployment (Local Testing)

### 1. Get API Key ⏳
- [ ] Visit https://platform.minimax.io
- [ ] Sign up / log in
- [ ] Navigate to API Keys section: https://www.minimax.io/platform/user-center/basic-information
- [ ] Generate new API key
- [ ] Copy key (starts with `eyJhbGciOiJSUzI1NiIsInR5cCI6...`)

### 2. Configure Environment ⏳
- [ ] Open `/workspace/nia-universal/apps/pipecat-daily-bot/.env`
- [ ] Add API key: `MINIMAX_API_KEY=<your_key_here>`
- [ ] Verify model selection includes `minimax-m2.5` option
- [ ] **DO NOT** change `BOT_MODEL_SELECTION` yet (test first)

### 3. Run Integration Tests ⏳
```bash
cd /workspace/nia-universal/apps/pipecat-daily-bot
python test_minimax.py
```

**Expected results:**
- [ ] ✅ Connection test passes
- [ ] ✅ Tool calling test passes
- [ ] ✅ Streaming test passes
- [ ] ✅ Performance test passes (<3s latency)

**If tests fail:**
- Check API key is correct (no extra spaces)
- Verify internet connection
- Check MiniMax service status: https://platform.minimax.io

### 4. Local Voice Testing ⏳

**Enable MiniMax:**
```bash
# In .env, change:
BOT_MODEL_SELECTION=minimax-m2.5
```

**Restart bot:**
```bash
npm run restart-bot
```

**Run test cases:**

#### Test 1: Simple Tool Call (Target: <5s)
```
Voice command: "Create a note about today's meeting"
```
- [ ] Tool called: `bot_create_note`
- [ ] Latency: <5 seconds
- [ ] Note created successfully
- [ ] No errors in logs

#### Test 2: Tool Selection (Target: <5s)
```
Voice command: "Send a Discord message saying hello"
```
- [ ] Tool called: `message` (NOT `bot_open_gmail`)
- [ ] Latency: <5 seconds
- [ ] Message appears in Discord
- [ ] No tool confusion

#### Test 3: Multi-Step Task (Target: <10s)
```
Voice command: "Open YouTube and search for Python tutorials"
```
- [ ] YouTube opens
- [ ] Search executes
- [ ] Total latency: <10 seconds
- [ ] Smooth execution

### 5. Accuracy Verification ⏳

Test these commands and verify correct tool selection:

| Command | Expected Tool | Actual Tool | ✅/❌ |
|---------|--------------|-------------|-------|
| "Send a Discord message" | `message` | | |
| "Create a note" | `bot_create_note` | | |
| "Play a soundtrack" | `bot_play_soundtrack` | | |
| "Open Gmail" | `bot_open_gmail` | | |
| "Search YouTube" | `bot_open_youtube` + tool | | |

**Success criteria:** 100% accuracy (5/5 correct)

### 6. Performance Benchmarking ⏳

Measure latencies for 5 voice interactions:

| Test # | Command | Speech End → Tool Call | Tool Call → Execution | Execution → TTS | Total |
|--------|---------|------------------------|----------------------|-----------------|-------|
| 1 | Simple note | | | | |
| 2 | Discord message | | | | |
| 3 | YouTube search | | | | |
| 4 | Calculator | | | | |
| 5 | Read note | | | | |

**Success criteria:**
- Simple tools: <5s average
- Complex tools: <10s average
- **All** faster than GPT-4o-mini baseline

### 7. Comparison Testing ⏳

Run same commands with different models:

#### GPT-4o-mini Baseline
```bash
BOT_MODEL_SELECTION=gpt-4o-mini
```
- [ ] Tool selection accuracy: ___%
- [ ] Average latency: ___s
- [ ] Error rate: ___%

#### MiniMax M2.5
```bash
BOT_MODEL_SELECTION=minimax-m2.5
```
- [ ] Tool selection accuracy: ___%
- [ ] Average latency: ___s
- [ ] Error rate: ___%

**Success criteria:** MiniMax ≥ GPT-4o-mini on all metrics

## Production Deployment

### 8. Pre-Deploy Verification ⏳
- [ ] All local tests passed
- [ ] Performance targets met
- [ ] Tool accuracy 100%
- [ ] No errors in logs during testing
- [ ] API key secured (not in git)
- [ ] Documentation updated
- [ ] Rollback plan confirmed

### 9. Deploy to Production ⏳

**Update production .env:**
```bash
# On production server
cd /workspace/nia-universal/apps/pipecat-daily-bot
nano .env  # Add MINIMAX_API_KEY
```

**Switch model:**
```bash
# In .env
BOT_MODEL_SELECTION=minimax-m2.5
```

**Deploy:**
```bash
npm run restart-bot
```

**Verify deployment:**
```bash
# Check logs for model selection
tail -f logs/bot.log | grep "MODEL_SELECTION"
# Should see: "A/B TEST MODE: BOT_MODEL_SELECTION=minimax-m2.5"
```

### 10. Production Monitoring (First Hour) ⏳

**Monitor first 10 voice sessions:**
- [ ] Session 1: ✅ No errors, good latency
- [ ] Session 2: ✅ No errors, good latency
- [ ] Session 3: ✅ No errors, good latency
- [ ] Session 4: ✅ No errors, good latency
- [ ] Session 5: ✅ No errors, good latency
- [ ] Session 6: ✅ No errors, good latency
- [ ] Session 7: ✅ No errors, good latency
- [ ] Session 8: ✅ No errors, good latency
- [ ] Session 9: ✅ No errors, good latency
- [ ] Session 10: ✅ No errors, good latency

**Check for issues:**
- [ ] No tool selection errors
- [ ] Latencies within targets
- [ ] No API rate limit errors
- [ ] Token usage reasonable

**MiniMax Dashboard:**
- [ ] Visit https://platform.minimax.io/dashboard
- [ ] Check token usage
- [ ] Verify costs tracking
- [ ] Monitor for any errors/warnings

### 11. Cost Monitoring (First 24 Hours) ⏳

**Track costs:**
- [ ] Hour 1: $____
- [ ] Hour 6: $____
- [ ] Hour 12: $____
- [ ] Hour 24: $____

**Expected:** ~$1/hour continuous operation

**If costs higher than expected:**
- Check for excessive retries
- Verify context window not bloated
- Check for streaming issues

## Post-Deployment

### 12. User Feedback Collection ⏳
- [ ] Collect feedback from first 10 users
- [ ] Compare to previous GPT-4o-mini experience
- [ ] Note any quality improvements
- [ ] Note any regressions

### 13. Performance Review (1 Week) ⏳
- [ ] Average latency: ___s (target: <5s)
- [ ] Tool accuracy: ___% (target: >95%)
- [ ] Error rate: ___% (target: <1%)
- [ ] Cost per hour: $___ (target: <$1.50)
- [ ] User satisfaction: ___/10

### 14. Decision Point ⏳
- [ ] Keep MiniMax (if metrics met)
- [ ] Roll back to GPT-4o-mini (if issues)
- [ ] Try alternative model (if needed)

## Rollback Procedure

If issues arise, immediately roll back:

```bash
# 1. Switch model in .env
BOT_MODEL_SELECTION=gpt-4o-mini

# 2. Restart bot
npm run restart-bot

# 3. Verify rollback
tail -f logs/bot.log | grep "MODEL_SELECTION"
# Should see: "A/B TEST MODE: BOT_MODEL_SELECTION=gpt-4o-mini"

# 4. Test basic functionality
# Run 3 quick voice commands to verify

# 5. Document what went wrong
# Create incident report in MINIMAX_INTEGRATION.md
```

**Common rollback triggers:**
- API errors >5% of requests
- Latency >10s average
- Tool accuracy <90%
- Cost >$2/hour
- User complaints about quality

## Success Metrics

**Integration successful if:**
- ✅ All tests passed
- ✅ Latency <5s (simple), <10s (complex)
- ✅ Tool accuracy >95%
- ✅ Cost ~$1/hour
- ✅ User satisfaction maintained/improved
- ✅ No production incidents

**Current Status:** 🔵 Code Complete, Awaiting API Key

**Next Action:** Get API key from https://platform.minimax.io

---

## Notes / Issues

_(Use this space to track any issues, observations, or decisions during deployment)_

**Date:** [YYYY-MM-DD]

**Deployed by:** 

**Issues encountered:**


**Resolution:**


**Performance observations:**


**Cost analysis:**


**User feedback:**


**Final decision:**
- [ ] Keep MiniMax
- [ ] Revert to GPT-4o-mini
- [ ] Try alternative: ___________
