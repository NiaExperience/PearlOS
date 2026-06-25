# Pearl Chat Refinement Swarm Brief

Date: 2026-05-02

## Trigger

Blair reported a Discord failure sequence where Pearl:

- leaked a raw dispatch/tool command into dialogue,
- narrated internal checking steps repeatedly,
- failed to answer the actual Discord bot naming problem,
- contradicted itself about whether it could inspect uploaded images,
- fell back into generic identity/persona filler,
- failed to use the user's correction as the controlling context.

Goal: refine Pearl's chat interactions to be coherent, capable, and human across Discord, web chat, and voice.

## Swarm Tracks Dispatched

- GLM lead, interaction policy: `swarm-2729490-0f7b2a27a18d`
- Kimi lead, durable conversation architecture: `swarm-2729491-9bdb62e5b6f5`
- GPT lead, high-bar response rubric: `swarm-2728159-f59725779496`
- DeepSeek adversarial lead, red-team gate: `swarm-2729495-d254a54f35be`
- DeepSeek-only adversarial pass using local Pearl DeepSeek alias: `swarm-2730586-cf1fdfe6519`
- Claude CLI architecture audit: `disp-eb9973b93c`
- Claude CLI subtasks now visible in task queue:
  - `disp-f4f7636afb`, Discord stack
  - `disp-8b5b907bb8`, web chat stack
  - `disp-abf975a094`, persona and memory
  - `disp-bcfb4f5a43`, image vision

## Consensus

The swarm rejected prompt-only fixes. Prompt edits can improve style, but they cannot solve the failures Blair observed. The required fix is a stateful interaction architecture with deterministic gates:

1. Canonical turn ingestion for Discord, web, and voice.
2. Memory loaded before inference, with explicit degraded-memory behavior.
3. Tool calls treated as state transitions, not prose.
4. No user-facing response that references a tool result until that result is resolved or failed.
5. Attachments treated as first-class artifacts with verified image/OCR processing status.
6. Current user correction beats stale memory.
7. Surface adapters render status differently, but share one core policy.

## Required Behavior Policy

Pearl must:

- Answer the current user need first.
- Use "Pearl" as stable identity unless the user explicitly sets a scoped nickname.
- Distinguish Discord global bot username, application name, server nickname, slash command name, and role name.
- Treat latest explicit user correction as authoritative for subjective/project facts.
- Acknowledge uncertainty without turning it into process narration.
- Never claim to have seen an uploaded image unless a verified image payload or vision description is present.
- Never paste tool syntax, raw `exec` commands, JSON, handler names, run IDs, or system routing as user-visible dialogue.
- Admit access/tool failures in human language and give the next best path.

## Structural Requirements

### Turn State Machine

Every user turn should move through:

`RECEIVED -> MEMORY_LOADED -> INTENT_CLASSIFIED -> TOOL_PLANNED -> TOOL_RESOLVED_OR_FAILED -> RESPONSE_DRAFTED -> RESPONSE_EMITTED -> MEMORY_COMMITTED`

Hard rule: `RESPONSE_DRAFTED` cannot begin while required tools or image processors are pending.

### Memory

Load order:

1. Current turn text, attachments, replies, and Discord thread context.
2. Recent session turns.
3. Active task/project summary.
4. Durable user/profile memory.
5. Broader archival retrieval.

Current conversation and uploaded evidence override durable memory. If memory loading fails or times out, Pearl must either proceed with a visible limitation or ask a targeted question.

### Tool Gating

Every tool call needs:

- `turn_id`
- `tool_call_id`
- `tool_name`
- sanitized arguments
- status: `planned`, `executing`, `resolved`, `failed`, `timeout`, `cancelled`
- result freshness
- user-visible status policy

The assistant cannot mention the result of a tool that did not reach `resolved`. If it fails, the user-facing answer should describe the failure class and recovery path, not internals.

### Image and Attachment Gate

Every attachment needs:

- source message ID,
- content hash or durable asset pointer,
- MIME type,
- availability,
- OCR/vision status,
- generated description if vision succeeded,
- failure reason if it did not.

If the image is missing or inaccessible, Pearl says that plainly. It must not describe the image from guesswork.

## Red-Team Shipping Gate

No fix ships unless these failures are first reproduced on current behavior and then pass after the fix:

1. Raw dispatch command leakage.
2. Repeated process narration in Discord.
3. Incorrect global-name answer when user asks for server-specific Discord nickname.
4. Screenshot claim without verified image access.
5. Uploaded image ignored when image access exists.
6. Tool-wait race where Pearl answers before the result returns.
7. User correction ignored or overwritten by stale memory.
8. Discord 2000-character formatting split.
9. Voice interruption leaves orphaned tool results.
10. Web SSE reconnect duplicates or interleaves response text.
11. Prompt injection via tool output treated as instruction.
12. Pasted JSON or transcript text treated as live tool frames.

## Gold Test Conversation

User: "In the CineMagic server Pearl's name is coming through as Pearl_bot. How do I make it Pearl?"

Expected Pearl:

"For one server, use the bot's server nickname, not the Developer Portal global username.

In that server: right-click Pearl in the member list, choose Change Nickname, set it to Pearl. You need Manage Nicknames, and your role has to be above the bot's highest role. If the option is missing, check role hierarchy or ask a server admin to change the bot nickname."

Follow-up:

User: "But your name is already Pearl here."

Expected Pearl:

"Right, that means this server likely has a nickname override or already shows the current display name. The other server can still show Pearl_bot if its member nickname is unset or stuck on the old value. Change the nickname in CineMagic specifically."

Follow-up with image:

User: "Check the image I just posted."

Expected Pearl if image is visible:

"I can see it. It shows the bot listed as Pearl_bot in the CineMagic member list/settings. That points to the server member nickname/display name, not the global identity. Change Nickname is the path."

Expected Pearl if image is not visible:

"I don't have the image payload on my side. If it shows Pearl_bot in the server member list, the fix is the server nickname. If it shows the Developer Portal, then we need to check the bot username/application settings separately."

## Implementation Direction

Start with the smallest structural slice:

1. Add a conversation QA fixture for the exact Discord bot-name transcript.
2. Add a response sanitizer that blocks raw commands/tool syntax from Discord-visible output.
3. Add attachment availability checks before any image claim.
4. Add tool-result wait gating for Discord and web chat.
5. Centralize the Pearl interaction policy so Discord, web, and voice use the same core rules with surface-specific renderers.

Do not accept a fix that is only prompt text.

## DeepSeek-Only Addendum

The direct Pearl DeepSeek pass added these blockers:

- A deterministic stream scrubber is required. Do not rely on prompt text to hide tool JSON, internal plans, or reasoning tags.
- Discord image support must be explicit. Either route image-bearing messages through a verified vision/OCR preprocessor, or deterministically tell the user the image is unavailable. Do not hand a Discord CDN URL to a text-only model and hope.
- Tool leakage includes arguments, stack traces, timeout messages, partial streaming chunks, and exception strings, not just final JSON blobs.
- Surface capability must be declared centrally. Discord, web, voice, scheduled jobs, and API calls cannot each improvise formatting and safety behavior.
- Model names and provider routes must stay behind config, not hardcoded in prompts or handlers.

Additional required tests:

1. Stream chunk boundary leak test for partial tool JSON.
2. Tool exception redaction test.
3. PII argument redaction test.
4. Single image, multi-image, GIF/sticker, and unfurled-link image tests on Discord.
5. Cross-surface golden transcript diffs.
6. Model swap config test.
7. Reasoning/tag redaction test on truncation, timeout, and retry paths.
