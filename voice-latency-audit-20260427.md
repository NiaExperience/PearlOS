# Voice Pipeline Latency Audit — 2026-04-27

Task: disp-b8ebf11bd2 (Pearl auto-dispatch). Investigation of why Blair experienced 30-45 second delays on voice calls.

## TL;DR
Three compounding causes:
1. **Voxtral TTS averages 3-8 seconds per utterance** (it's the default).
2. **Tool-call path through openclaw-gateway → DeepSeek V4 Flash is timing out repeatedly today** (many `reason=timeout` and `400 reasoning_content` errors). When voice triggers `bot_openclaw_task`, that delay goes straight to the user.
3. **pipecat-runner spent the last 4 days in a crash loop** (242 restarts, 78 ImportError occurrences for `VOICE_TTS_NOTE`). Fix is now in place but instability is recent.

## Evidence

### TTFB measurements (pipecat-runner-error.log)
First-token times logged historically:
- 4029 ms "FAST TTFB" (turn 1, 2026-04-18)
- 5897 ms (turn 1, 2026-04-18)
- 12006 ms "SIMPLE TTFB" (turn 2, 2026-04-18)
- 13977 ms (turn 1, 2026-04-20)
- 23111 ms (turn 1, 2026-04-21)

No live TTFB samples for today — runner has been online 2h with no completed user turns recorded (all sessions show empty rooms that left after 30s idle).

### Voxtral per-request timing (voxtral-tts-out.log, 2026-04-27)
```
10:30:04 → 10:30:08  4 s   "I'm feeling quite refined today..."
10:30:13 → 10:30:21  8 s   "Oh, I've been exploring new ideas..."
10:30:24 → 10:30:30  6 s   "Did you know honey never spoils..."
10:00:23 → 10:00:26  3 s   "Did you know octopuses..."
```
Per-utterance latency 3-8 s. PocketTTS (port 8766) is healthy with sub-second response by contrast.

### LLM/tool failures (openclaw-gateway-error.log, last 24 h)
Repeated:
- `LLM request failed: provider rejected the request schema or tool payload. rawError=400 The reasoning_content in the thinking mode must be passed back to the API.`
- `embedded run failover decision: ... reason=timeout from=pearl-llm/deepseek-v4-flash`
- `incomplete turn detected: ... stopReason=stop payloads=0`
- `lane task error: ... AbortError: This operation was aborted`

Schema rejection means pearl-llm isn't echoing `reasoning_content` from prior turns when DeepSeek is in thinking mode → 400. Each rejection triggers retry/failover, adding seconds. Multiple `reason=timeout` events today (10:28, 10:33, 10:36, 10:41, 12:02, 12:24, 12:44, 12:50, 13:29, 13:32, 13:56, 14:01, 14:04 UTC).

### pipecat-runner crash loop (recent)
- `ImportError: cannot import name 'VOICE_TTS_NOTE' from 'core.prompts'` — 78 occurrences
- Last occurrence: 2026-04-26 14:34 UTC
- `VOICE_TTS_NOTE` is now defined in both `/opt/pearlos/.../core/prompts.py` and `/workspace/nia-universal/.../core/prompts.py` — fix is shipped
- 242 PM2 restarts in 4 days; current uptime 2h
- Each restart re-loads 91 toolbox tools, 56 mesh prompts (~21 KB), 14 KB workspace context per session

### Service health (snapshot 14:05 UTC)
| Service        | Port  | Status     | Latency |
|----------------|-------|------------|---------|
| PocketTTS      | 8766  | 200 OK     | ~1 ms   |
| Voxtral TTS    | 8100  | 200 OK     | ~1 ms   |
| Mesh           | 2000  | 200 OK     | ~1 ms   |
| OpenClaw       | 18789 | 200 OK (/) | ~10 ms  |
| Pipecat-gw     | 4444  | 200 OK     | fast    |
| openclaw-gw    | -     | 1335 PM2 restarts | -      |

### Other anomalies
- 404 on `POST /api/voice/start` and `GET /api/model-preference?channel=voice` — endpoints not implemented; benign log noise but indicates frontend/backend version drift.
- `/opt/pearlos/HEARTBEAT.md` is 5 days stale (last update 2026-04-22 13:24 UTC), referencing an old crash-loop count.
- Active voice TTS provider is `BOT_TTS_PROVIDER=voxtral` (set in `/opt/pearlos/apps/pipecat-daily-bot/.env`).

## Recommendations (in priority order)

1. **Switch default TTS to PocketTTS for the voice channel.** Edit `/opt/pearlos/apps/pipecat-daily-bot/.env`: `BOT_TTS_PROVIDER=pocket`. Saves ~3-7 s per turn. Voxtral can remain as opt-in for specific voice IDs. This is the single biggest win.

2. **Fix the DeepSeek V4 Flash `reasoning_content` echo bug.** In whatever pearl-llm shim talks to DeepSeek thinking mode, when an assistant turn returns `reasoning_content`, that block must be passed back as part of the next request's assistant message. Failure to do so produces the recurring 400 and triggers failover delays.

3. **Cap or lazy-route `bot_openclaw_task` from voice path.** When voice triggers it, it should either (a) hard-cap at ~3 s with a "let me think about that — give me a moment" filler from Pearl, or (b) be disabled entirely on short voice turns. Currently a bridge tool call can stall the pipeline 20+ s if DeepSeek hangs.

4. **Confirm the VOICE_TTS_NOTE fix is sticking.** Last crash was Apr 26; verify by tailing `pipecat-runner-error.log` during a live Blair test call. If the runner restart count climbs beyond ~245 in the next 24 h, the import path is regressing.

5. **Refresh HEARTBEAT.md.** The current file references state from 5 days ago; rewrite with today's actual restart counts and current voice/LLM stack.

6. **Reduce per-session boot work.** Each new voice session re-loads 91 tools + ~35 KB of context. Worth investigating a warm-pool of pre-initialized runners so voice connect feels instant — every call today eats this overhead because the runner restarts per session.

7. **Investigate openclaw-gateway 1335 restart count.** Separate audit warranted; even if voice can route around it, that level of churn is corrupting tool-call reliability across the whole stack.
