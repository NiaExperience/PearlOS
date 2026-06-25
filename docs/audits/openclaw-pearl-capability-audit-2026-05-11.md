# PearlOS OpenClaw Capability Audit

Date: 2026-05-11
Host: pearl-staging-private-omega
Source tree: `/workspace/nia-universal`
Deploy tree: `/home/deploy/pearlos`

## Audit Roster

- Kimi: direct Moonshot was blocked by account quota; rerouted through OpenRouter with `moonshotai/kimi-k2.5`.
- GLM: OpenRouter `z-ai/glm-5-turbo`.
- Claude CLI: local `claude` CLI, direct repo sweep.
- Codex CLI: local `codex exec`, read-only repo sweep.
- DeepSeek v4 Pro: `deepseek-v4-pro`.

## Consensus

PearlOS is moving in the right direction, but the system is not yet structurally guaranteed to keep Pearl in the primary position across every surface.

The strongest consensus findings were:

1. OpenClaw must be the only normal user-facing route.
2. Any non-OpenClaw model path must be explicit degraded mode, logged, and bounded.
3. Per-user memory isolation is now structurally present, but learning and skill evolution are still shallow.
4. Refusal resistance is still mostly prompt-based; it needs an enforcement loop that reroutes failures into tools, delegation, or a precise blocker.
5. Swarm capability is configured, but not proven as a first-class runtime path with role selection, parallel execution, aggregation, and user/tenant-scoped state.
6. Legacy relay/task follow-up machinery remains the main duplicate-speaker and ghosting risk.

## Applied During This Audit

- Added scoped per-user markdown files alongside the scoped event log:
  - `USER.md`
  - `USER_FACTS.md`
  - `MEMORY.md`
  - `activity-log.md`
  - `skills.md`
- Kept memory reads and writes scoped to `PEARL_USER_MEMORY_DIR/<tenant>/<user>/`.
- Preserved legacy scoped JSONL reads for migration compatibility.
- Updated voice/OpenClaw prompt wiring so remembered user facts and activity notes go to the scoped per-user files, not global workspace memory.
- Hard-disabled the relay's global private memory context/write switches in code.
- Disabled the webchat local Ollama fast path by default so OpenClaw remains the normal chat route.
- Compiled and deployed the Python changes to staging.
- Restarted `pipecat-gateway`, `pipecat-runner`, and `pearl-chat-relays-production-repair`.

## Remaining Critical Risks

### 1. OpenClaw Bypass Paths Still Exist

Evidence:

- Voice defaults to OpenClaw session and blocks direct LLM unless `PEARL_ALLOW_DIRECT_LLM=true`.
- Webchat still has an optional `CHAT_FAST_PATH_ENABLED`, but it now defaults off.
- Relay has explicit modes and fallbacks: `PEARL_RELAY_OPENCLAW_MODE`, `PEARL_RELAY_DIRECT_MODEL_FALLBACK`, direct vision route, and legacy/shadow behavior.

Risk:

Pearl can silently stop being OpenClaw-native under latency, config drift, or operator overrides.

Priority:

Make OpenClaw primary for every normal turn. Keep fallbacks only as explicit degraded mode with route telemetry.

### 2. Global Memory Kill Switches Were Removed From Runtime Control

Evidence:

- `PEARL_ENABLE_GLOBAL_MEMORY_CONTEXT`
- `PEARL_ENABLE_GLOBAL_MEMORY_WRITES`

Status:

These were present when the auditors ran. They are now hard-disabled in code rather than controlled by env.

Priority:

Remove the dead global-memory helper code in a follow-up cleanup.

### 3. Swarm Capability Is Not Yet Proven End-To-End

Evidence:

- `config/agency-swarm.json` defines role/model preferences.
- The gateway mounts `/api/swarm`.
- Auditors did not find a clear user-turn path proving Pearl can spawn, supervise, merge, and report a multi-agent swarm through OpenClaw/OpenRouter without exposing internal IDs.

Risk:

Pearl may answer as one model or dispatch a task queue item instead of orchestrating a real swarm.

Priority:

Add a canonical OpenClaw tool path for `swarm_dispatch`, role-to-model selection, budget control, result aggregation, and per-user/tenant ownership.

### 4. Learning Is Still Mostly Explicit Memory Capture

Evidence:

- Scoped memory works for explicit remembered facts.
- `skills.md` is created and loaded, but no runtime loop updates it from repeated corrections, task outcomes, or user preferences.
- Feedback files exist elsewhere but are not clearly fed back into future behavior.

Risk:

Pearl can remember facts but does not reliably evolve skills or preferences from experience.

Priority:

Create a learning loop that summarizes completed tasks, user corrections, repeated preferences, and successful strategies into scoped `skills.md` and scoped memory.

### 5. Refusal Resistance Needs Enforcement

Evidence:

- Prompts say "do it" and "check tools first."
- Auditors did not find a refusal detector, retry/reroute gate, or policy that converts a failed first answer into a tool call, swarm dispatch, or concrete blocker before the user sees it.

Risk:

A model can still leak a helpless refusal if it misses tools or sees an upstream failure.

Priority:

Add an output guard before final delivery: detect helpless refusal language, re-ask Pearl through OpenClaw with available tools/context, and only surface a blocker after tool/delegation attempts fail.

### 6. Ghosting Can Still Happen On Slow OpenClaw Turns

Evidence:

- Voice intentionally removed repeated filler and waits for OpenClaw first token.
- OpenClaw TTFB can be several seconds.
- Background notifications are not immediate enough for user trust in Discord-style task work.

Risk:

Pearl can feel silent even when a request is technically still running.

Priority:

Add route-level heartbeat/typing telemetry and a bounded timeout/circuit breaker. Do not reintroduce canned task language.

## Acceptance Tests

- Webchat user A stores a memory; user B in same tenant cannot retrieve it.
- Same email in two tenants must not share OpenClaw sessions, memory files, tasks, inbox items, or swarm runs.
- Voice explicit "remember..." creates entries only under the authenticated user's scoped directory.
- Discord `#qa` and `#bot-tasks-1` simple status questions produce one natural Pearl answer, no task IDs, no duplicate follow-ups.
- A Discord tool request routes through OpenClaw primary, not stateless fallback.
- A forced OpenClaw outage produces one explicit degraded route, logged with route name, and does not silently use a different brain.
- A swarm request starts multiple OpenRouter-backed agents in parallel, merges results, and reports in Pearl's voice without internal IDs.
- A model refusal is intercepted and retried with tool/delegation context before the user sees it.
- A completed task or user correction updates scoped memory or scoped `skills.md`.

## Immediate Next Work

1. Remove the dead relay global-memory helper code.
2. Add route telemetry for every Pearl response: surface, session key, OpenClaw/legacy/degraded route, fallback reason.
3. Build refusal-reroute middleware.
4. Prove `swarm_dispatch` end-to-end from Discord, webchat, and voice.
5. Standardize task API auth so the runtime and external checks use one shared secret source.
