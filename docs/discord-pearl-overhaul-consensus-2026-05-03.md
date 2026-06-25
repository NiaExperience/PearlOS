# Discord Pearl Overhaul Consensus - 2026-05-03

## Current Answer

Pearl's voice/manifesto guidance is still present in the prompt for trusted Discord channels. The active relay loads `AGENTS.md`, `PEARL.md`, `CLAUDE.md`, `USER_FACTS.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, and `MEMORY.md`, and its system prompt says Pearl should be human, emotionally intelligent, warm, direct, and Blair's companion rather than a status bot.

The quality regression is architectural, not just prompt text:

- The Discord repair relay had no local recent-turn history in Pearl's prompt, so every restart or gateway session reset could feel like amnesia.
- The relay was pulling operational context too aggressively for trusted Discord, which pushed Pearl toward backend/status chatter even during casual conversation.
- Delegation responses exposed task machinery too often, which made Pearl sound like a ticket bot.
- Tool/Agency use is queue-based, not a true model-visible tool interface yet, so Pearl cannot naturally call tools mid-response and then synthesize the result in the same turn.

## Outside Review Snapshot

Claude CLI review was queued as `disp-e328d45e8c` on the DO staging task system for a full Discord Pearl architecture audit.

GLM 5.1 via OpenRouter completed a review. Its strongest recommendations:

- Add explicit recent conversation history per Discord channel immediately.
- Split context into tiers: small identity core always, relevant memory/history when needed, operational status only when asked.
- Stop dumping every memory file into every message long-term; move toward retrieval.
- Add real tool calls for `dispatch_task`, `web_search`, `save_user_fact`, and `read_task_detail`.
- Keep fast chat on a single quick model call; use slower paths only for live lookup or work dispatch.
- Do not rely on regex cleanup or canned response rules as the primary quality mechanism.

DeepSeek v4 Pro direct completed on DO but the terminal output was not captured to a file before the local session lost SSH access. Rerun it with output redirected before treating it as recorded consensus.

Kimi direct failed because the Moonshot account reported insufficient balance. Try Kimi through OpenRouter before marking Kimi unavailable.

## Immediate Patch Applied

The relay now:

- Stores a short Discord conversation ring buffer in `discord-history.json`.
- Injects recent Discord turns into Pearl's prompt for continuity.
- Clears that buffer on `/reset`.
- Stops building live operational context unless the message actually asks about ops, staging, build, URLs, backend, or tasks.
- Replies to Agency dispatches more naturally without exposing task IDs by default.

Source and deploy-target files updated locally:

- `/workspace/nia-universal/scripts/production-repair-chat-relays.mjs`
- `/opt/pearlos/scripts/production-repair-chat-relays.mjs`

## Deployment Commands For DO

Run from a machine with SSH access to the staging droplet:

```bash
scp /workspace/nia-universal/scripts/production-repair-chat-relays.mjs root@134.209.76.227:/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs
ssh root@134.209.76.227 'node --check /home/deploy/pearlos/scripts/production-repair-chat-relays.mjs && pm2 restart pearl-chat-relays-production-repair --update-env && pm2 logs pearl-chat-relays-production-repair --lines 40 --nostream'
```

Then test in Discord:

- `Hey Pearl how's it going`
- `What's the latest with Ukraine`
- `What did I just ask you?`
- `Send that to the Agency to rewrite casually`

Expected behavior:

- Pearl greets like a companion, not a status report.
- Pearl does not answer current news from stale memory; she dispatches lookup naturally.
- Pearl remembers the immediately previous turn.
- Pearl can resolve "that" from recent history when dispatching work.

## Next Architecture Step

Replace queue-only delegation with a real tool loop in the relay:

1. Model receives small tool definitions.
2. Model returns a structured tool call when it needs search, Agency, memory write, or task status.
3. Relay executes the tool.
4. Relay calls the model again with the tool result.
5. Pearl replies in her own voice without exposing backend mechanics unless Blair asks.

That is the durable fix for keeping Pearl fast while making her capable, coherent, and emotionally present.
