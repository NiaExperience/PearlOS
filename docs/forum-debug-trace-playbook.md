# Forum Bot Join Debug Trace Playbook

Use this when the forum opens but the bot does not appear in-room.

## 1) Get a single `debugTraceId` from the browser

Open browser console and find one of these logs from `Call.tsx`:

- `[Call] Requesting token with displayName`
- `[Call.bot] Bot join response received`
- `[Call.bot] Bot join failed before daily.join`

Copy the `debugTraceId` (format is usually `forum:<room>:<ts>:<rand>`).

## 2) Trace the same id through every hop

Follow the same id across services in this order:

1. Interface client (`Call.tsx`, `botClient.ts`)
2. Interface API proxy (`/api/bot/join` in `joinImpl.ts`)
3. Bot gateway (`bot_gateway.py`)
4. Bot operator (`bot_operator.py`, queue mode only)
5. Bot runner (`runner_main.py`)

If the trace id disappears at any step, the failure point is the previous hop.

## 3) Fast grep patterns (copy/paste)

Replace `<TRACE_ID>` with the exact id.

### Interface / Next.js logs

```bash
rg "<TRACE_ID>|Call\.bot|Bot proxy join|bot_proxy_join" apps/interface -S
```

Expected:
- `Bot proxy join dispatch`
- `Bot proxy join payload (sanitized)`
- `Bot proxy join upstream success` or `Bot proxy join upstream error`

### Gateway logs

```bash
rg "<TRACE_ID>|\[gateway\]|join_room|transition|room_active|room_keepalive" apps/pipecat-daily-bot/bot -S
```

Expected in healthy flow:
- `[/join] Request`
- direct mode: reuse/transition/spawn decision log
- queue mode: enqueue or joined-existing decision log

### Operator logs (queue mode)

```bash
rg "<TRACE_ID>|\[operator\]|Received job|BOT_DEBUG_TRACE_ID" apps/pipecat-daily-bot/bot -S
```

Expected:
- `[operator] Received job` with matching `debugTraceId`
- job env includes `BOT_DEBUG_TRACE_ID`

### Runner logs

```bash
rg "<TRACE_ID>|\[runner\]|\[transition\]|launch_session|session_id|Daily" apps/pipecat-daily-bot/bot -S
```

Expected:
- launch log with room and trace id
- transition logs (if handoff path)
- no join token/room mismatch errors

## 4) Decision tree for common failure signatures

### A) Token/room mismatch

Symptom:
- runner logs show room/token mismatch or join denied

Check:
- same `room_url` slug is preserved end-to-end
- token is present in payload from `Call.tsx` to `joinImpl.ts` to gateway/runner

Fix direction:
- verify token requested before both `daily.join` and `joinRoom`
- verify `getRoomNameFromUrl` is not altering room slug

### B) Proxy accepted request but upstream failed

Symptom:
- `Bot proxy join upstream error` in `joinImpl.ts` logs

Check:
- status code/body from upstream
- whether auth secret mismatch or payload validation failed

Fix direction:
- align auth secret and required fields (`personalityId`, `persona`, `room_url`, token for gated rooms)

### C) Gateway says reused/joined_existing but bot not actually alive

Symptom:
- response has `reused: true` or `joined_existing`, but no in-room bot

Check:
- `room_keepalive` freshness and stale lock cleanup path
- direct mode `active_rooms` and `user_bots` mapping correctness

Fix direction:
- stale `room_active` should be cleared when keepalive is stale
- fallback to fresh launch when liveness check fails

### D) Transition path selected but no relaunch

Symptom:
- gateway logs show `transitioning`, but runner never logs relaunch

Check:
- runner `transition_session` request received with same `debugTraceId`
- transition cancellation/relaunch logs and final status

Fix direction:
- validate transition endpoint availability and payload (`new_room_url`, `new_token`)

### E) Second user path spawns duplicate bot

Symptom:
- multiple bots appear or repeated bot join requests

Check:
- frontend existing-bot participant check
- gateway room lock/idempotency branch selection

Fix direction:
- skip join when bot participant already exists
- enforce room-level active session guard

## 5) What a healthy sequence looks like

1. Client logs token request and `debugTraceId`.
2. `/api/bot/join` proxy logs dispatch and upstream success with same trace id.
3. Gateway logs one clear decision: joined_existing OR transitioned OR new launch.
4. (Queue mode) Operator logs consumed job with same trace id.
5. Runner logs launch/transition with same trace id and joins room successfully.
6. UI receives bot participant in Daily participants list.

## 6) Minimal triage checklist

- Trace id exists in browser logs.
- Trace id appears in proxy logs.
- Trace id appears in gateway logs.
- If queue mode: trace id appears in operator logs.
- Trace id appears in runner launch/transition logs.
- Bot participant appears in Daily room after join.

If one checkbox fails, that boundary is your root-cause location.

