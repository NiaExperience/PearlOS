# Daily Bot Auto-Spawn Architecture (Webhook Driven)

## Goal

Automatically start (and stop) a Pipecat/Daily bot session when users join a Daily room, without the Interface UI explicitly calling a `/join` endpoint.

## Why

* Removes UI coupling to bot lifecycle
* Ensures bot is present consistently for eligible rooms
* Enables policy control (which rooms? max concurrency?) entirely server-side

## Components

| Component | Responsibility |
|-----------|----------------|
| Daily Video API | Emits webhooks (`participant-joined`, `participant-left`, `room-ended`) |
| Webhook Receiver (FastAPI in `runner_main.py`) | Parses events, applies policy, triggers spawn/stop |
| Session Launcher (`_launch_session`) | Starts async bot task (existing code) |
| Session Registry (`sessions` dict) | Tracks active sessions (room_url, personality, task) |
| (Optional) Signature Validator | Verifies webhook authenticity |

## Event Flow

```text
User joins room  ──▶ Daily emits `participant-joined` ──▶ Webhook POST /daily/webhook
                                                     │
                                                     ├─▶ Policy: room eligible? bot absent? start session
                                                     ▼
                                             _launch_session(room_url)

Room ends or last user leaves ─▶ Daily emits `room-ended` or `participant-left` (last) ─▶ Webhook handler
                                                                                         └─▶ Cancel matching session(s)
```

## Trigger Mechanics

`runner_main.py` now exposes a POST `/daily/webhook` route (guarded by `AUTOSPAWN_WEBHOOK=1`). That route:

1. Validates (optionally) HMAC signature.
2. Normalizes payload → `event_type`, `room_url`, participant info.
3. On `participant-joined`:
   * Ignore if participant appears to be the bot (name contains `Pipecat Bot`).
   * If no active session exists for `room_url`, spawn one via existing `_launch_session` (no provisioning; room already exists because user joined it).
4. On `room-ended` (or optional heuristic for last participant left): cancel any sessions tied to `room_url`.

## Daily Webhook Payload (Simplified)

Daily docs (abbreviated) show shapes like:

```json
{
  "event": "participant-joined",
  "room": { "name": "my-room", "url": "https://your-subdomain.daily.co/my-room" },
  "participant": { "user_id": "abc123", "user_name": "Jane", "session_id": "..." }
}
```

We rely on `room.url` for stable keying, falling back to constructing from name if missing.

## Environment Flags

| Variable | Purpose | Default |
|----------|---------|---------|
| `AUTOSPAWN_WEBHOOK` | Enable webhook-triggered spawn | `1` |
| `AUTOSPAWN_REQUIRE_SIGNATURE` | Enforce HMAC signature | `0` |
| `AUTOSPAWN_MAX_CONCURRENCY` | Hard cap on simultaneous sessions | `5` |
| `AUTOSPAWN_ALLOWED_ROOM_REGEX` | Regex filter for allowed room URLs | `.*` |

## Security Considerations

* Restrict webhook endpoint (secret path or network ACL) and/or verify `Daily-Signature` header.
* Enforce max concurrency to avoid runaway cost.
* Optional allowlist regex for room URL / name.

## Failure Modes & Mitigations

| Failure | Mitigation |
|---------|------------|
| Duplicate spawns | Check existing session keyed by `room_url` before launching |
| Orphaned bot when room emptied w/o `room-ended` | Periodic reaper scanning sessions vs. recent webhook activity (future) |
| Malicious spoof | Signature verification + regex + origin allowlist |
| Sudden burst of joins | Concurrency cap + queue or early reject |

## Extension Ideas

* Broadcast bot status to UI over WebSocket so UI can show "Bot connecting" state.
* Add `/bot/status?room=` endpoint (read-only) for polling.
* Support personality override via room metadata mapping.

## Minimal Code (Implemented Skeleton)

See `apps/pipecat-daily-bot/bot/runner_main.py` for the added `/daily/webhook` handler.

## Rollout Plan

1. Deploy new image with webhook route (keep manual start endpoints intact).
2. Configure Daily webhook URL → `https://<bot-host>/daily/webhook`.
3. Enable signature verification once tested.
4. Remove UI manual `/join` call after observing stable behavior.

## UI Impact

UI no longer POSTs to bot control; it just joins the room. Bot presence appears when runner session connects. Existing participant event logic suffices.

## Testing Strategy

* Unit test: feed synthetic webhook payloads into handler and assert spawn decision.
* Integration: spin runner in test mode, POST `participant-joined` → assert new session in `/sessions` list.
* Cleanup test: POST `room-ended` → assert session removed.

---

Questions or enhancements: open a PR referencing this doc.
