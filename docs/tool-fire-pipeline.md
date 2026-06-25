# Tool-fire pipeline (bot → frontend)

How a bot tool invocation ends up displayed as a window or canvas tile in
the PearlOS interface, and the regression that left chat-mode tool fires
silently dropped for ~4 days.

## The pipeline, end to end

```
LLM emits tool_call
    │
    ▼
┌────────────────────────────────────────────────────┐
│ pipecat-gateway (FastAPI, port 4444)              │
│   /api/tools/invoke or session-attached call      │
│                                                    │
│   bot_gateway.py:_broadcast_tool_event_best_effort│
│      ├─ ws_broadcast(envelope)                    │  ← gateway WS
│      ├─ AppMessageForwarder.emit_tool_event(...)  │  ← Daily REST
│      └─ daily_rest /send-app-message              │  ← Daily REST (raw)
└────────────────────────────────────────────────────┘
    │                            │
    │ ws                         │ Daily app-message (WebRTC data channel)
    ▼                            ▼
Browser must subscribe       In-call browser receives via Daily client
    │                            │
    ▼                            ▼
useGatewaySocket   ──>   niaEventRouter   <──   event-bridge (Daily)
                              │
                              ▼
                  WindowManagerContext / WonderCanvasRenderer
                              │
                              ▼
                       Tool window appears
```

Two transports reach the browser:

* **Daily app-message** — only available while the user is in an active
  Daily call (voice mode). Bypasses Next.js entirely; uses Daily's WebRTC
  data channel.
* **Gateway WebSocket** — the only transport in chat mode. The browser
  subscribes via `useGatewaySocket.ts`.

## The 4-day regression

`useGatewaySocket.ts` opens a WebSocket to
`${origin}/ws/events`. The Next.js server at port 3000 cannot deliver this:

1. **Middleware redirects it.** `middleware.ts` treats the first path
   segment as an assistant name and redirects unauthenticated requests
   to `/login`. `/ws/events` becomes "assistant=ws", which is not a
   public route, so the browser gets an HTTP 307 to `/login` instead of
   a WebSocket upgrade.
2. **Even with a matching rewrite, Next.js cannot proxy WebSocket.**
   `next.config.mjs` does have a `/gateway-ws/:path*` rewrite, but
   `rewrites()` is HTTP-only — it does not pass through the WebSocket
   `Upgrade` handshake. Confirmed empirically: handshake times out.

Net effect: in chat mode the gateway WS never connects, so no tool fire
ever reaches the browser. In voice mode, the Daily app-message channel
masks the bug because it delivers the same envelope through a different
transport.

The bot itself is not at fault — `tool-fire-smoketest.sh weather ws` (run
against the bot directly on `localhost:4444`) shows two envelopes per
weather call: a `nia.tool_result` and a `nia.event` of kind `wonder.scene`
carrying the rendered weather HTML.

## The fix

A same-origin SSE bridge at `/api/gateway-events` opens the bot WebSocket
server-side and re-emits each message as a `text/event-stream` event. The
browser uses `EventSource`, which works through Next.js because:

* `/api/*` is excluded from the assistant-rewriting middleware matcher,
  so the request is not redirected to `/login`.
* SSE rides on a long-lived HTTP response, so no upgrade handshake is
  required — Next.js's HTTP layer streams the body to the client.

`useGatewaySocket.ts` now tries the direct WebSocket first (still works
in dev when the browser is on the same host as the bot) and, on the
first failure, switches to the SSE bridge. Both transports go through
the same `handleEnvelope` dispatcher, so the rest of the frontend is
unchanged.

Files:

* `apps/interface/src/app/api/gateway-events/route.ts` — new SSE bridge
* `apps/interface/src/features/DailyCall/hooks/useGatewaySocket.ts` —
  added EventSource fallback

## Test harness

`apps/pipecat-daily-bot/bot/scripts/tool-fire-smoketest.sh` is the
canonical regression check. It POSTs to `/api/tools/invoke` and confirms
that envelopes arrive on the chosen transport within a few seconds.

```
# Verify the bot is still broadcasting (works on the bot host directly)
./tool-fire-smoketest.sh weather ws

# Verify the SSE bridge is delivering tool fires to a browser-reachable
# URL — the path that powers chat-mode tool windows.
./tool-fire-smoketest.sh weather sse

# Other supported tools
./tool-fire-smoketest.sh notes ws
./tool-fire-smoketest.sh news ws
```

A pass means at least one `nia.event` or `nia.tool_result` envelope
arrived. A fail (zero envelopes) means the broadcast pipeline is broken
again — start with the bot logs (`pm2 logs pipecat-gateway`) and look
for `[tools] Broadcast nia.event` lines around the invocation.

## Manual UI check

After deploy:

1. Open the interface and stay in chat mode (do NOT join the voice call).
2. Ask Pearl "what's the weather in Paris?".
3. The weather card should appear in the canvas. If the chat reply
   includes a weather summary but no canvas tile shows up, the SSE
   bridge is not being reached — check the browser network panel for an
   open `/api/gateway-events` connection in `eventsource` mode.
