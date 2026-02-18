# OpenClaw Bridge

Delegates complex tasks from the Nia voice assistant to an [OpenClaw](https://github.com/nichochar/OpenClaw) agent, streaming results back into the interface.

## Architecture

```
User speaks → Pipecat bot LLM → bot_openclaw_task tool
                                       ↓
                        Daily app-message (nia.event)
                        event: "openclaw.task.trigger"
                                       ↓
                        niaEventRouter (browser)
                        dispatches NIA_EVENT_OPENCLAW_TASK
                                       ↓
                        OpenClawEventBridge (React component)
                        calls triggerOpenClawTask()
                                       ↓
                        Bridge Server (localhost:3100)
                        POST /api/v1/chat/stream → SSE
                                       ↓
                        OpenClaw Gateway
                                       ↓ (streamed response)
                        OpenClawResponse overlay (bottom-right)
```

## Components

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript types for bridge messages |
| `events.ts` | Custom event names and helpers |
| `client.ts` | HTTP client for bridge server SSE |
| `triggerOpenClawTask.ts` | Tool handler + window dispatch helper |
| `components/OpenClawEventBridge.tsx` | Headless listener wiring Daily events → bridge |
| `components/OpenClawStatus.tsx` | Connection status indicator |
| `components/OpenClawResponse.tsx` | Streamed response overlay |

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `OPENCLAW_API_URL` | Interface server | Bridge server URL (default `http://localhost:3100`) |
| `OPENCLAW_API_KEY` | Interface server | Optional bearer token for bridge auth |
| `NEXT_PUBLIC_FEATURE_OPENCLAW_BRIDGE` | Interface client | Feature flag (`true` to enable) |
| `BRIDGE_API_KEY` | Bridge server | Shared secret matching `OPENCLAW_API_KEY` |

## Enabling

1. Start the bridge server:
   ```bash
   cd /workspace/OpenClaw/workspace
   BRIDGE_API_KEY=your-secret npx tsx openclaw-bridge-server.ts
   ```

2. Start OpenClaw gateway:
   ```bash
   openclaw gateway start
   ```

3. Set feature flag:
   ```bash
   NEXT_PUBLIC_FEATURE_OPENCLAW_BRIDGE=true
   ```

4. Ensure `openclawBridge` is in the bot's `supportedFeatures` list so `bot_openclaw_task` is available to the LLM.

## Pipecat Bot Tool

The bot tool lives at `apps/pipecat-daily-bot/bot/tools/openclaw_tools.py`:

- Decorated with `@bot_tool(name="bot_openclaw_task", feature_flag="openclawBridge")`
- Accepts `task` (string) and optional `urgency` (low/normal/high)
- Emits `openclaw.task.trigger` via `emit_nia_event()` through the Daily app-message forwarder
- Returns immediately with a session key; results stream asynchronously

## Prism Content Type

`OpenClawTask` is defined in `packages/features/descriptors/content-definitions.json` for task persistence. Fields: `task`, `status`, `response`, `sessionKey`, `urgency`, `createdBy`, `tenantId`, timestamps.

## Event Flow Detail

1. **Bot side** (Python): `bot_openclaw_task` calls `emit_nia_event(forwarder, "openclaw.task.trigger", payload)` which sends a Daily app-message with `kind: "nia.event"`
2. **Browser side**: `niaEventRouter.ts` catches the envelope, sees `event === "openclaw.task.trigger"`, dispatches `window` CustomEvent `nia.event.openclawTask`
3. **React side**: `<OpenClawEventBridge />` listens for that CustomEvent, extracts payload, calls `triggerOpenClawTask()` which POSTs to the bridge server
4. **Bridge server**: Forwards to OpenClaw gateway, streams SSE response back
5. **UI**: `<OpenClawResponse />` renders streamed chunks as chat cards
