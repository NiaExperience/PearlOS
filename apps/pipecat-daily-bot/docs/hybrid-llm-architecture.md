# Hybrid LLM Architecture

## Problem
When using OpenClaw as the LLM backend, simple tool calls (load notes, YouTube, window management) take ~40 seconds due to:
- 4 network round-trips (Pipecat → OpenClaw → Anthropic → back × 2)
- 2 Claude inference cycles (tool decision + response generation)

## Solution
**Hybrid mode** uses gpt-4o-mini as the primary pipeline LLM for fast tool decisions (<2s), while keeping OpenClaw+Claude available for complex reasoning via the `bot_openclaw_task` bridge tool.

## Architecture

```
BEFORE (all through OpenClaw):
User → Pipecat → OpenClaw → Anthropic (tool decision) → Pipecat → tool
→ OpenClaw → Anthropic (response) → Pipecat → TTS  [~40s]

AFTER (hybrid):
Simple tools:
User → Pipecat → OpenAI/gpt-4o-mini (tool decision + response) → TTS  [~1-2s]

Complex tasks (via bot_openclaw_task):
User → Pipecat → gpt-4o-mini (delegates) → OpenClaw → Claude  [async, streamed]
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `BOT_HYBRID_LLM` | `true` (when OPENCLAW_API_URL set) | Enable hybrid mode |
| `BOT_HYBRID_PRIMARY_MODEL` | `gpt-4o-mini` | Primary fast LLM model |
| `OPENCLAW_API_URL` | — | OpenClaw endpoint (enables bridge tool) |
| `OPENAI_API_KEY` | — | Required for hybrid/direct mode |

## Routing Logic

**gpt-4o-mini handles directly (fast path):**
- Notes CRUD, navigation, content
- YouTube playback
- Window management
- Soundtrack control
- Sprites, views, profiles
- Calculator, misc tools
- All simple tool calls

**Delegated to OpenClaw via `bot_openclaw_task` (async path):**
- Web research
- Code execution
- Multi-step reasoning
- Deep analysis
- File manipulation
- Anything requiring external capabilities

## Reverting
Set `BOT_HYBRID_LLM=false` to route all inference through OpenClaw (original behavior).

## OSS Model Migration Path (Post-Demo)

The `BOT_HYBRID_PRIMARY_MODEL` env var makes it trivial to swap the primary LLM. Current choice is GPT-4o-mini for the Wednesday demo (proven, zero infra), but OSS models are viable for cost optimization.

### Candidates

| Model | Tool Calling | Hosting | Cost | Notes |
|-------|-------------|---------|------|-------|
| **GPT-4o-mini** (current) | Excellent | OpenAI API | $0.15/1M input | Zero infra, sub-second, demo-safe |
| **Llama 3.3 70B** | Good | RunPod vLLM | ~$0.50/hr GPU | Best OSS quality, needs A100/H100 |
| **Qwen2.5 72B** | Excellent | RunPod vLLM | ~$0.50/hr GPU | Best OSS tool calling, comparable to GPT-4o-mini |
| **Mistral 22B (Nemo)** | Decent | RunPod/existing endpoint | ~$0.25/hr GPU | Lighter, existing RunPod infra |
| **DeepSeek-V3** | Good | API or self-host | API: cheap | Strong reasoning, API available |

### Existing RunPod Infrastructure
- Ollama endpoint: `https://25wmgzhsglmhnk-11434.proxy.runpod.net` (was used for sprite LLM — may work for tool calling with Mistral/Qwen)
- ComfyUI pod already running — could add a vLLM sidecar

### How to Switch
1. Deploy model on RunPod with vLLM (OpenAI-compatible API)
2. Set env vars:
   ```
   BOT_HYBRID_PRIMARY_MODEL=qwen2.5-72b  # or whatever model name vLLM serves
   OPENAI_API_KEY=runpod-key
   OPENAI_BASE_URL=https://your-runpod-endpoint/v1
   ```
3. Test tool calling accuracy (notes, YouTube, windows) before switching production

### Recommendation
Stick with GPT-4o-mini until post-demo. Then evaluate Qwen2.5 72B on RunPod — it has the best OSS tool calling and the OpenAI-compatible API makes it a drop-in swap. At ~$0.50/hr vs pay-per-token, it pays for itself quickly with moderate usage.
