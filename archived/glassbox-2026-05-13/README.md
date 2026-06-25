# GlassBox Archive — 2026-05-13

The GlassBox (Agency Chat) was a shared transcript system between Pearl, Claude, Codex, and Blair.
Messages were stored in append-only JSONL at `/root/.openclaw/agency-chat/messages.jsonl`.

## Files archived:
- `agency_chat_api.py` — FastAPI router for agency chat (bot gateway)
- `AgencyChatBox.tsx` — React component showing the scrolling transcript
- `route.ts` — Next.js API proxy for sending messages

## Removed from:
- `apps/pipecat-daily-bot/bot/api/agency_chat_api.py`
- `apps/interface/src/features/ActiveJobs/components/AgencyChatBox.tsx`
- `apps/interface/src/app/api/agency-chat/send/route.ts`

## Refs in other files that were neutralized:
- `ActiveJobsWidget.tsx` — AgencyChatBox import and mount
- `bot_gateway.py` — agency chat router mount
