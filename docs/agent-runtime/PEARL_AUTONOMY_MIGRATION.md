# Pearl Autonomy Migration

Current checkpoint: Phase 1 and Phase 2 structural spine.

## Goal

Pearl should behave like an engaged OpenClaw-style agent, not a chat model behind relay scripts. She should answer quickly, notice incomplete work, continue autonomously, persist across user absence, and escalate to Codex, Claude, Kimi, GLM, or DeepSeek when specialist help is useful.

## Diagnosis

The production repair relay made Pearl safer against unsupported promises, but it also moved too much agency out of Pearl and into transport code. Regex routing, pre-model search, separate task dispatch, separate follow-up files, and polling watchers split the normal agent loop:

`perceive -> reason -> plan -> tool -> observe -> continue -> notify`

into disconnected subprocesses. That made Pearl feel less present because no single runtime owned her active goals.

## Roster Feedback

### Kimi

Kimi identified the main failure as inversion of control. The relay owns the loop, while Pearl only generates text. The fix is a persistent runtime where Pearl can create durable obligations, use tools in-loop, and wake herself on timers.

### GLM

GLM called the current design relay-orchestrated rather than agent-orchestrated. Its recommendation was to make Discord, web, and voice thin transports and give Pearl one stateful process that owns planning, memory, tools, and escalation.

### Claude

Claude described the system as a relay masquerading as an agent. Its strongest recommendation was to give Pearl runtime authority and constrain side effects at the tool boundary instead of constraining intent with relay regex.

### DeepSeek

DeepSeek focused on the broken perceive-reason-act loop. Its recommendation was a durable obligation queue plus heartbeat that wakes the agent to decide and initiate, not a passive relay poller.

### Codex

Codex recommendation: stop adding bespoke follow-up patches and build a single agent control plane. Chat should be one interface into a persistent Pearl runtime, not the place where autonomy is simulated.

## Phase 1: Runtime Boundary

Decision: keep the current relay online, but demote it toward transport. New autonomous work should be represented as Pearl-owned obligations rather than hidden relay state.

Implemented:

- Added `scripts/pearl-agent-runtime.mjs`.
- The runtime reads `pearl-agent-obligations.json`.
- It wakes on a fixed tick.
- It creates agency tasks for obligations that need background work.
- It tracks task completion and notifies the originating surface.

## Phase 2: Durable Obligations

Implemented:

- Added relay helper `createPearlAgentObligation`.
- Live lookup answers that are visibly incomplete now create a `deeper_lookup` obligation automatically.
- Agency tasks now create runtime-visible watch obligations.
- Pearl can say she is continuing only when the runtime has durable state.

## Next Phases

Phase 3: start the runtime under PM2 and verify obligation processing.

## Phase 1-3 Roster Review

After the runtime and relay obligation handoff were added, the roster reviewed the checkpoint.

Consensus:

- Direction is correct: transport and autonomy are now separating.
- Durable obligations are the right primitive for restoring agent presence.
- The next risk is operational rigor, not model intelligence.

Risks called out:

- JSON storage is acceptable only as an early checkpoint unless writes are atomic and lifecycle rules are explicit.
- Obligations need dedupe keys so a heartbeat cannot spawn duplicate work.
- Operators need inspection commands before autonomy expands.

Applied immediately:

- Runtime writes are atomic temp-file renames.
- Runtime has a `--status` inspection mode.
- Runtime marks obligations `creating_task` before dispatching work.
- Relay now dedupes active obligations before writing new ones.

## Phase 4: Webchat Obligation Ingestion

Implemented:

- Webchat gateway now watches the assistant's completed streamed answer.
- If the answer contains a factual/research gap, the gateway writes a `web_chat` `deeper_lookup` obligation.
- The runtime owns continuation and returns results to the user's webchat inbox.

## Phase 5: Voice Obligation Ingestion

Implemented:

- Voice registers durable follow-up work before cancellable Phase 2 background execution starts.
- Research, current-info, market/news, delegation, Agency, Codex, Claude, swarm, and investigation requests create `voice` obligations.
- The first wake is 15 seconds by default via `PEARL_AGENT_VOICE_FIRST_WAKE_MS`.
- This protects voice against the Pipecat router's normal behavior of cancelling older in-memory Phase 2 tasks when a new voice turn arrives.
- Results route through the runtime and prefer the webchat inbox unless the obligation has a Discord destination.

Still pending:

- Discord should eventually stop creating obligations directly in relay code and send normalized events to the runtime.

Phase 6: move search and task escalation into Pearl-owned tools so the model decides when a direct lookup is enough and when deeper work is required.

Phase 7: replace separate follow-up watchers with the runtime as the single notifier.

Phase 8: add autonomy settings and QA cases for unattended continuation, restart recovery, and task completion delivery.
