# Voice ↔ OpenClaw Integration: PearlOS Tool Bridge

**Status:** Implementation Plan + Code  
**Date:** 2026-02-16  
**Author:** Opus subagent (voice-integration task)

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌────────────────────┐     ┌──────────────────┐
│  User Voice │────▶│  Deepseek    │────▶│  bot_openclaw_task │────▶│  OpenClaw Gateway │
│  "open notes"│    │  (fast LLM)  │     │  (pipecat tool)    │     │  (Claude agent)   │
└─────────────┘     └──────────────┘     └────────────────────┘     └────────┬─────────┘
                                                                             │
                                                                    ┌────────▼─────────┐
                                                                    │  pearlos skill    │
                                                                    │  (SKILL.md)       │
                                                                    └────────┬─────────┘
                                                                             │
                                                                    uses exec or web_fetch
                                                                             │
                                                                    ┌────────▼─────────┐
                                                                    │  Bot Gateway API  │
                                                                    │  localhost:4444   │
                                                                    │  /api/tools/*     │
                                                                    └──────────────────┘
                                                                             │
                                                                    ┌────────▼─────────┐
                                                                    │  PearlOS UI      │
                                                                    │  (WebSocket +    │
                                                                    │   Daily events)  │
                                                                    └──────────────────┘
```

### Current State (one-way bridge)

1. Voice → Deepseek → `bot_openclaw_task` emits `openclaw.task.trigger` via Daily app-message
2. Interface `OpenClawEventBridge` listens → calls OpenClaw Gateway `/v1/chat/completions`
3. OpenClaw (Claude) can do web research, code, etc. but **cannot** call PearlOS tools

### After Integration (bidirectional)

4. OpenClaw gets a `pearlos` skill with `SKILL.md` that teaches it to use `pearlos-tool`
5. `pearlos-tool` CLI calls bot gateway REST API at `localhost:4444`
6. Bot gateway executes tools (direct Mesh for notes, relay for UI tools)
7. Results flow back through OpenClaw → bridge → voice

---

## What Already Works

| Component | Status | Details |
|-----------|--------|---------|
| Bot gateway `/api/tools/list` | ✅ Working | Returns 71 tools with metadata |
| Bot gateway `/api/tools/invoke` | ✅ Working | Relay via Daily + WebSocket |
| Bot gateway `/api/tools/execute` | ✅ Working | Direct Mesh execution (notes) |
| `pearlos-tool` CLI | ✅ Working | Installed at `/usr/local/bin/pearlos-tool` |
| `pearlos-tool exec` | ✅ Working | Calls `/api/tools/execute` |
| `pearlos-tool invoke` | ✅ Working | Calls `/api/tools/invoke` |
| OpenClaw `exec` tool | ✅ Available | Can run shell commands |
| OpenClaw `web_fetch` tool | ✅ Available | Can call HTTP APIs |
| `bot_openclaw_task` | ✅ Working | Voice → OpenClaw delegation |
| `OpenClawEventBridge` | ✅ Working | Interface bridges events → OpenClaw API |

---

## Implementation

### Deliverable 1: PearlOS Skill for OpenClaw

Create `/usr/lib/node_modules/openclaw/skills/pearlos/SKILL.md` — teaches OpenClaw how to use PearlOS tools.

**Key insight:** OpenClaw already has the `exec` tool. The `pearlos-tool` CLI is already installed. We just need a SKILL.md that teaches the agent when/how to use it.

See: `skills/pearlos/SKILL.md` (created alongside this doc)

### Deliverable 2: Test Script

```bash
#!/bin/bash
# test-openclaw-pearlos.sh — verify OpenClaw can call PearlOS tools

echo "=== Test 1: List tools ==="
pearlos-tool list

echo ""
echo "=== Test 2: Direct execute (list notes) ==="
pearlos-tool exec bot_list_notes

echo ""
echo "=== Test 3: Invoke (open notes app) ==="
pearlos-tool invoke bot_open_notes

echo ""
echo "=== Test 4: Gateway health ==="
curl -s http://localhost:4444/health | python3 -m json.tool
```

### Deliverable 3: bot_openclaw_task Integration

The existing `bot_openclaw_task` already passes the task prompt to OpenClaw. When OpenClaw receives "open notes" as a task, the `pearlos` skill will guide it to run `pearlos-tool invoke bot_open_notes`.

**No code changes needed** in `openclaw_tools.py` — the skill approach means OpenClaw figures out the right tool call from the natural language task description.

However, we should pass **session context** (tenant_id, user_id) through the event payload so OpenClaw can use them with direct execution:

See: Updated `openclaw_tools.py` below.

### Deliverable 4: Error Handling

The `pearlos-tool` CLI already handles gateway-down scenarios:
- `urllib.error.URLError` → returns `{"ok": false, "error": "..."}`
- 15-second timeout prevents hanging
- OpenClaw sees the error in exec output and can tell the user

The SKILL.md includes guidance on error handling.

---

## Files Created/Modified

### NEW: `/usr/lib/node_modules/openclaw/skills/pearlos/SKILL.md`

The OpenClaw skill definition. Teaches Claude:
- What PearlOS tools are available
- When to use `pearlos-tool exec` (data ops, no room needed) vs `invoke` (UI commands)
- Common tool names and parameters
- Error handling patterns

### MODIFIED: `bot/tools/openclaw_tools.py` (optional enhancement)

Add session context to the event payload so OpenClaw can pass tenant_id/user_id through to pearlos-tool.

### NEW: `scripts/test-openclaw-pearlos.sh`

Quick verification script.

---

## Test Flow Walkthrough

### Flow: "Pearl, send a Discord message to Friend"

1. **Voice input** → STT → "send a Discord message to Friend"
2. **Deepseek** evaluates: this needs web/external capabilities → calls `bot_openclaw_task`
3. **bot_openclaw_task** emits `openclaw.task.trigger` with `{ task: "send a Discord message to Friend" }`
4. **Interface** `OpenClawEventBridge` receives event → calls OpenClaw Gateway `/v1/chat/completions`
5. **OpenClaw (Claude)** reads the task, recognizes it needs Discord → uses the built-in `message` tool directly (Discord is already an OpenClaw channel!)
6. **Message sent** → OpenClaw responds with confirmation
7. **Interface** streams response back → TTS → voice output to user

> **Note:** Discord messages don't need `pearlos-tool` at all — OpenClaw has native Discord support via the `message` tool. The `pearlos` skill is for PearlOS-specific tools (notes, YouTube, window management, etc.)

### Flow: "Pearl, open my notes" (via OpenClaw delegation)

1. **Voice** → Deepseek → usually handles directly with `bot_open_notes`
2. But if delegated to OpenClaw → `bot_openclaw_task`
3. **OpenClaw** reads pearlos skill → runs `pearlos-tool invoke bot_open_notes`
4. Bot gateway receives → broadcasts `nia.event` `app.open` via WebSocket + Daily
5. PearlOS UI opens notes app
6. OpenClaw responds "Notes are now open" → streamed back to voice

### Flow: "Pearl, create a note called Meeting Minutes"

1. **Voice** → Deepseek → delegates complex note creation to OpenClaw
2. **OpenClaw** → `pearlos-tool exec bot_create_note '{"title":"Meeting Minutes","content":""}'`
3. Bot gateway → Mesh API → note created
4. OpenClaw responds "Created note 'Meeting Minutes'" → back to voice

---

## Known Limitations & Future Work

1. **Latency**: Voice → Deepseek → OpenClaw → bot gateway adds ~3-5s. For simple commands, Deepseek should handle directly (which it already does for most tools).

2. **No streaming tool results**: When OpenClaw calls `pearlos-tool`, it gets results via stdout. No real-time streaming of partial results back to voice.

3. **Session context isolation**: OpenClaw runs in a container. It can call `localhost:4444` because the bot gateway runs on the same host network. If deployed separately, needs network config.

4. **Two-way result flow**: Currently OpenClaw → voice results flow through the interface bridge. A more direct path (OpenClaw → WebSocket → bot → TTS) would reduce latency.

5. **Tool deduplication**: Both Deepseek and OpenClaw can handle notes/YouTube. The `bot_openclaw_task` description already tells Deepseek to NOT delegate simple tool calls. The pearlos skill tells OpenClaw when these tools ARE needed (when it's already handling a task).

---

## Quick Start

After skill is installed:

```bash
# 1. Verify bot gateway is running
curl -s http://localhost:4444/health

# 2. Verify pearlos-tool works
pearlos-tool list
pearlos-tool exec bot_list_notes

# 3. Test from OpenClaw (in a session)
# Ask: "List my PearlOS notes"
# OpenClaw should run: pearlos-tool exec bot_list_notes
```
