# TOOLBOX build plan

Branch: `toolbox-build` (forked from RADIANT line, parent commit `ef6d7be9`).
Source of truth: `/workspace/nia-universal`. Deploy target: `/opt/pearlos`.
Companion doc: [`tool-fire-pipeline.md`](./tool-fire-pipeline.md).

This is the central planning document for the TOOLBOX build. Phase 2 is
plan-only — no implementation lands on this commit. Subsequent phases
will reference fix items by their ID below (e.g. `T-01`, `M-02`).

---

## 1. Build goal (acceptance bar)

A user — on desktop, tablet, mobile portrait, or mobile landscape, in
chat mode or voice mode — can:

1. Ask Pearl to do anything that triggers a tool, and the tool's window
   or canvas tile appears within ~2 seconds, every time.
2. Toggle between chat mode and voice mode without losing the current
   canvas view, open windows, or split-screen layout.
3. See Terminal, Notes, and Weather render correctly and remain usable
   after layout changes (resize, mode switch, orientation flip).

If any of those three predicates fails on any of the four form factors,
TOOLBOX is not done.

---

## 2. Architecture: tool call → screen

The end-to-end pipeline currently has two transports to the browser.
Voice mode masks bugs in the chat-mode transport because Daily's WebRTC
data channel delivers the same envelope through a different path.

```
                       LLM emits tool_call
                              │
                              ▼
        ┌──────────────────────────────────────────────┐
        │ pipecat-gateway (FastAPI, port 4444)         │
        │  bot_gateway.py                              │
        │   _broadcast_tool_event_best_effort()        │
        │   ├─ ws_broadcast(envelope)             ◀────┼── gateway WS
        │   ├─ AppMessageForwarder.emit_tool_event ◀───┼── Daily REST
        │   └─ daily_rest /send-app-message       ◀────┼── Daily REST
        └──────────────────────────────────────────────┘
            │                                │
            │ WebSocket (chat mode only)     │ Daily app-message
            │                                │ (voice mode only)
            ▼                                ▼
   ┌──────────────────────┐         ┌────────────────────────┐
   │ useGatewaySocket.ts  │         │ event-bridge (Daily)   │
   │ /ws/events           │         │ in-call client         │
   └──────────┬───────────┘         └────────────┬───────────┘
              │                                  │
              └────────────────┬─────────────────┘
                               ▼
                    niaEventRouter.ts
                  (dispatch by event kind)
                               │
                  ┌────────────┼────────────────┐
                  ▼            ▼                ▼
        WindowManagerContext  WonderCanvasRenderer  Tool-specific
        (Terminal, Notes, …)  (weather, news, …)    side-effects
```

Key envelope kinds (see `niaEventRouter.ts`):

- `nia.tool_result` — tool finished, optional payload.
- `nia.event` of kind `wonder.scene` — rendered HTML for canvas tile.
- `nia.event.windowOpen` / `windowClose` / `windowCloseAll`.
- `nia.event.desktopModeSwitch` — chat ↔ voice mode toggle.
- `nia.event.viewClose` — split-screen view dismissal.

---

## 3. Known issues (current state)

Pulled from `tool-fire-pipeline.md` and from a Phase 2 source survey.
Severity: P0 = blocks build, P1 = breaks acceptance bar, P2 = polish.

### T-01 (P0) — Chat-mode tool fires never reach the browser

`useGatewaySocket.ts` opens `${origin}/ws/events`. Two things break it
on the live interface:

1. `middleware.ts` treats the first path segment as an assistant name
   and 307-redirects unauthenticated requests to `/login`, so
   `/ws/events` becomes "assistant=ws" and never reaches a handler.
2. Even with a matching rewrite, Next.js `rewrites()` is HTTP-only and
   does not pass the `Upgrade: websocket` handshake. The
   `/gateway-ws/:path*` rewrite in `next.config.mjs` cannot proxy WS.

Net effect: in chat mode, no tool fire reaches the browser. Voice mode
hides this because Daily app-message delivers the same envelope.

The companion doc describes a same-origin SSE bridge fix at
`/api/gateway-events`, but **it has not landed in source**:

- `apps/interface/src/app/api/gateway-events/route.ts` — does not exist.
- `useGatewaySocket.ts` — no `EventSource` fallback present.
- `apps/pipecat-daily-bot/bot/scripts/tool-fire-smoketest.sh` — missing.

T-01 is the first thing TOOLBOX has to fix.

### T-02 (P1) — Mode-switch loses view state

`nia.event.desktopModeSwitch` toggles chat ↔ voice but the handlers in
`WindowManagerContext` and `WonderCanvasRenderer` re-mount on the
transition, dropping open windows and the active canvas tile.
Symptom: Pearl says "switching to chat mode" and the weather card
disappears. Acceptance bar #2 fails.

### T-03 (P1) — Split-screen view state is fragile

Split-screen views render through `WonderCanvasRenderer` plus
`ChatModeLayout`. Today, a `viewClose` while a second pane is loading
can wedge the layout into a half-split state until a hard reload.

### T-04 (P1) — Mobile portrait/landscape regressions

`ChatModeLayout` has desktop and mobile branches but no orientation
handling beyond CSS media queries. Tool windows opened in portrait
overflow on rotate to landscape; canvas tile sizing assumes desktop
viewport when first painted.

### T-05 (P1) — Voice / chat parity gaps

Daily app-message arrives only in voice; SSE bridge only in chat.
Right now the same tool call can render twice if a user toggles mode
mid-fire (voice already delivered, chat re-receives via SSE).
De-duplication keyed by envelope `id` is not present in
`niaEventRouter`.

### T-06 (P2) — Tool surface coverage

Terminal, Notes, and Weather features exist but lack a single, common
test that exercises them through the live pipeline. The smoketest in
the doc covers `weather`, `notes`, `news` — Terminal is missing from
the harness.

### T-07 (P2) — Bot-side broadcast paths drift

`bot_gateway.py` has multiple call sites that emit envelopes
(`ws_broadcast`, `emit_tool_event`, raw `daily_rest`). They have grown
slightly inconsistent: a few code paths emit `app.open` directly while
others go through `_broadcast_tool_event_best_effort`. Risk of one
transport silently losing a payload during refactor.

---

## 4. Prioritized fix items

Stage order matters — earlier stages unblock later ones.

| ID | Stage | Title | Depends on | Engine |
|----|-------|-------|------------|--------|
| F-01 | Foundation | SSE bridge route `/api/gateway-events` | — | Claude `Agent` (single file) |
| F-02 | Foundation | `useGatewaySocket` EventSource fallback + envelope dedup | F-01 | Claude `Agent` |
| F-03 | Foundation | `tool-fire-smoketest.sh` lands in `apps/pipecat-daily-bot/bot/scripts/` with `weather`, `notes`, `news`, `terminal` | F-01 | direct shell |
| F-04 | Foundation | Bot-side broadcast consolidation (T-07) — single call site | — | `the_agency` swarm (touches bot) |
| L-01 | Layout | Mode-switch state preservation (T-02) — promote window + canvas state into a context that survives `desktopModeSwitch` | F-02 | Claude `Agent` |
| L-02 | Layout | Split-screen state machine (T-03) — replace ad-hoc booleans with reducer keyed on view IDs | F-02 | Claude `Agent` |
| L-03 | Layout | Mobile portrait/landscape (T-04) — orientation listener, percentage-based tile sizing | L-01, L-02 | Claude `Agent` |
| Q-01 | QA | Live regression sweep across Terminal, Notes, Weather on desktop/mobile/portrait/landscape, both modes | all above | manual + Playwright |
| Q-02 | QA | Mode-switch parity test: same prompt in voice and chat must render identical canvas state | F-02, L-01 | manual |

Out of scope for TOOLBOX (deferred):

- New tool surfaces beyond Terminal/Notes/Weather.
- Cross-device session restore (laptop → phone) — separate build.
- Rewriting the Daily app-message channel to share code with SSE — only
  align envelope shapes, do not collapse transports.

---

## 5. Test plan

### 5.1 Unit / integration

- `niaEventRouter.test.ts` — extend with envelope dedup cases (same
  `id` arriving via WS and Daily must render once).
- `useGatewaySocket.ts` — mock `WebSocket` failure → assert
  `EventSource` fallback fires within retry budget.
- `WindowManagerContext` — assert state survives a simulated
  `desktopModeSwitch` event.

### 5.2 Smoke (post-deploy)

```
# Bot is broadcasting (run on bot host)
./apps/pipecat-daily-bot/bot/scripts/tool-fire-smoketest.sh weather ws

# SSE bridge delivers to the public URL
./apps/pipecat-daily-bot/bot/scripts/tool-fire-smoketest.sh weather sse
./apps/pipecat-daily-bot/bot/scripts/tool-fire-smoketest.sh notes sse
./apps/pipecat-daily-bot/bot/scripts/tool-fire-smoketest.sh terminal sse
```

A pass = at least one `nia.event` or `nia.tool_result` envelope arrives
within the timeout. A fail = zero envelopes; start with
`pm2 logs pipecat-gateway` and look for `[tools] Broadcast nia.event`.

### 5.3 Behavioral matrix (manual)

For each cell, ask "what's the weather in Paris?", confirm card
renders, then say "switch to chat mode" / "switch to voice mode" and
confirm the card stays visible.

| Form factor       | Chat → Voice | Voice → Chat | Split open | Split close |
|-------------------|:------------:|:------------:|:----------:|:-----------:|
| Desktop           | ☐            | ☐            | ☐          | ☐           |
| Tablet            | ☐            | ☐            | ☐          | ☐           |
| Mobile portrait   | ☐            | ☐            | ☐          | ☐           |
| Mobile landscape  | ☐            | ☐            | ☐          | ☐           |

### 5.4 Regression scan

- `/api/health/build` returns the TOOLBOX codename after deploy.
- `pm2 logs interface --lines 200` shows no `assistantId="ws"` 307s.
- Browser network panel: an open `/api/gateway-events` connection in
  `eventsource` mode while in chat mode.

---

## 6. Rollout checklist

Pre-deploy:

- [ ] All F-* and L-* fix items merged to `toolbox-build`.
- [ ] `npm run build --prefix apps/interface` clean (no type errors).
- [ ] Unit tests green (`apps/interface` + bot scripts).
- [ ] Smoketest 5.2 green against staging bot.
- [ ] Manual matrix 5.3 fully checked on staging URL.
- [ ] `BUILD_CODENAME` bumped to `TOOLBOX` in
      `apps/interface/src/build-info.json` and bot health endpoint.

Deploy (requires fresh Blair approval — staging-protection rules
apply; no implicit reuse of prior blanket windows):

- [ ] Announce in `#pearl-omega` 1 minute ahead via
      `/opt/pearlos/scripts/announce-restart.sh`.
- [ ] Build from source: `cd /workspace/nia-universal && npm run build --prefix apps/interface`.
- [ ] `rsync -a --delete apps/interface/.next/ /opt/pearlos/apps/interface/.next/`.
- [ ] `cp` any changed source files (route handlers, hooks, scripts) to
      the matching path under `/opt/pearlos`.
- [ ] `pm2 restart interface pipecat-gateway` (only with approval).
- [ ] `/opt/pearlos/scripts/verify-build.sh TOOLBOX`.

Post-deploy:

- [ ] Re-run 5.2 smoketests against the public URL.
- [ ] Re-run 5.3 matrix on real devices (desktop, phone portrait, phone
      landscape).
- [ ] 24-hour soak — watch `pm2 logs pipecat-gateway` for tool-fire
      failures and `pm2 logs interface` for SSE disconnect storms.
- [ ] If any acceptance predicate fails, roll back to RADIANT codename
      and re-open this doc.

---

## 7. Open questions

1. Should the SSE bridge be the only chat-mode transport, or should we
   keep the direct-WS fast path for dev? (Doc says "try WS first, fall
   back to SSE" — keep that, but confirm.)
2. Do we want envelope dedup keyed on `id` alone, or on `(id, kind)` to
   tolerate retransmits that change kind?
3. Mode-switch state preservation — context-level, or persist through
   URL params so deep-link survives a refresh?

These are open for design review during stage L-01 / L-02.
