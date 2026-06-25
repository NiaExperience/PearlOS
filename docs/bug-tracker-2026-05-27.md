# PearlOS Bug Tracker — 2026-05-27 QA Session
>
> QA testing by Stephanie Riggs & Angel Cheng on production (app.pearlos.org)
> Reported in #qa channel | Compiled by Pearl

---

## BUG-001 — Duplicate Task Completion Notifications
- **Environment:** Production
- **Priority:** P1
- **Reported by:** Stephanie Riggs
- **Description:** Task completion messages fire multiple times. "The Architecture & Design task is done" appeared 3x consecutively. Additional task notification for Tetris also appeared. Users get spammed with repeated completion messages.
- **Root Cause:** pearl-worker in 401 auth loop (can't poll/SSE from task API). Reconnection chaos causes duplicate notification dispatch.
- **Status:** Open

---

## BUG-002 — Studio Creations All Show "Not Found"
- **Environment:** Production
- **Priority:** P0
- **Reported by:** Stephanie Riggs
- **Description:** Every creation in Studio shows `{"error": "Not found"}` when trying to open. The Studio/creation-launchpad applet opens but none of the generated creations load.
- **Root Cause:** `/opt/pearlos/creations/` directory does not exist on production. The creation static file server at `/api/creation/[id]/[...path]` serves from `/opt/pearlos/creations/` but the directory was never created. Builds complete but have nowhere to write output files.
- **Fix:** Create `/opt/pearlos/creations/` directory on production with appropriate permissions for the interface process.
- **Status:** Open

---

## BUG-003 — Creations Show Raw Base64 Asset URLs in Description
- **Environment:** Production
- **Priority:** P1
- **Reported by:** Stephanie Riggs
- **Description:** "Build Instructions for the Picking-up Agent" creation renders the pixel art illustration but the embedded content shows raw base64 data URL blobs dumped into the task description text instead of loading the actual built creation.
- **Root Cause:** Related to BUG-002 — creations directory missing. Without the output directory, the applet falls back to rendering the raw task description with unresolved asset URLs.
- **Status:** Open (dependent on BUG-002 fix)

---

## BUG-004 — Notes Not Appearing in Notes App
- **Environment:** Production
- **Priority:** P1
- **Reported by:** Stephanie Riggs
- **Description:** When using webchat to save content as a note ("Turn this into a note"), the webchat confirms it was saved, but the note never appears in the Notes app. Example: "niaxp-website-strategy.md" was confirmed saved but doesn't show up.
- **Root Cause:** Path mismatch. The note creation tool (`file_ops.py`, used by voice/webchat) writes to `/workspace/user/Documents/` (shared flat directory), but the Notes API (`/api/notes/files/`) resolves to `/workspace/user/{userId}/Documents/` (per-user directory).
- **Fix:** Align the save path in `file_ops.py` to use the same per-user Documents directory that the Notes app reads from (`/workspace/user/{userId}/Documents/`).
- **Status:** Open

---

## BUG-005 — Webchat "Couldn't Connect" / Pipecat Runner Instability
- **Environment:** Production
- **Priority:** P1
- **Reported by:** Stephanie Riggs
- **Description:** Webchat returns "Hmm, I couldn't connect right now. Try again?" message. Voice/webchat sessions fail to start.
- **Root Cause:** Pipecat-runner has 1,409 restarts over 16 hours. Last successful session was at 05:55 UTC, ended at 06:00 UTC with idle timeout. STUN binding timeouts occurring on both eth0 and eth1 interfaces. Interface getting "WebRTC not supported or suppressed" errors. Runner shows online but no new sessions are being created.
- **Status:** Open

---

## BUG-006 — Voice Chat Cuts Off Mid-Sentence (Staging)
- **Environment:** Staging
- **Priority:** P2
- **Reported by:** Angel Cheng
- **Description:** During voice chat on staging, Pearl stops speaking mid-sentence and goes silent. Requires page refresh and restarting Pearl to recover, then happens again later.
- **Root Cause:** OpenClaw gateway's Discord WebSocket cycles hourly (code 1005 disconnects from Discord side), briefly disrupting the LLM stream that the voice pipeline depends on for response generation.
- **Status:** Open

---

## BUG-007 — Missing Cancel Button for Agency Actions
- **Environment:** Production
- **Priority:** P2
- **Reported by:** Stephanie Riggs
- **Description:** There is no longer an option to cancel an Agency action once started. Users cannot stop a running creation/task build.
- **Status:** Open (needs investigation into UI/API for task cancellation)

---

## Summary — Production
| Bug | Priority | Impact |
|-----|----------|--------|
| BUG-002 — Studio creations all broken | P0 | All creations unusable |
| BUG-001 — Duplicate task notifications | P1 | Spam/confusion |
| BUG-003 — Raw base64 in creation descriptions | P1 | Unusable creations |
| BUG-004 — Notes path mismatch | P1 | Notes feature broken |
| BUG-005 — Webchat connection failures | P1 | Voice/webchat unreliable |
| BUG-007 — Missing cancel button | P2 | Can't stop builds |

## Summary — Staging
| Bug | Priority | Impact |
|-----|----------|--------|
| BUG-006 — Voice cuts mid-sentence | P2 | Annoying but recoverable with refresh |
