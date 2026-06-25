# Codex Swarm Operating System

Last updated: 2026-05-06.

This is the operating model for turning PearlOS Agency from a single CLI worker
into a professional, budget-aware, continuously improving coding swarm.

## Mission

PearlOS Agency should make frontier-level software intelligence available to
ordinary working people at sane cost. The system should coordinate diverse
models into a team whose combined output is better than any single model:
planner, implementers, reviewers, QA, adversarial critics, product judgment, and
release management.

The goal is not maximum agent count. The goal is maximum verified useful work
per dollar, per minute, and per unit of operational risk.

The first duty of the Agency is model awareness. Benchmarks matter, but they
come after discovery: Pearl must know when new state-of-the-art capabilities
appear so she can grow quickly, gain skills, and keep the affordable core model
stack current.

## Current Reality

- PearlOS task queue remains `/api/tasks`.
- `pearl-worker` is the Agency worker.
- `config/agency-boss.json` selects `codex` or `claude`.
- Codex is currently the live Agency Boss.
- OpenRouter credentials are present on staging and verified, but swarm
  orchestration must pass credentials through an allowlisted runtime env.
- Existing swarm files are prototypes, not the final orchestration layer.
- Current reliable efficient Pearl core model: `deepseek/deepseek-v4-flash`.
  Treat it as the default affordable/free-tier baseline until evidence says a
  newer model is better on quality, latency, reliability, and cost.

## Core Principles

1. Pearl stays conversational. Agency workers do the work.
2. Codex Boss decomposes and synthesizes. It should not blindly fan out.
3. Every swarm run is durable: manifest, events, outputs, final synthesis.
4. Every spawned agent has a role, model, budget, timeout, and stop condition.
5. Quality beats volume. Larger swarms require evidence that they outperform
   smaller swarms for that task type.
6. No task IDs, run IDs, or internal identifiers appear in user-facing output.
7. The source of truth remains `/workspace/nia-universal`; deploy is copied
   forward after source edits.

## Durable Run Layout

Each swarm run writes to:

```text
/workspace/nia-universal/.agency/runs/<run-id>/
  manifest.json
  events.jsonl
  prompts/
  outputs/
  artifacts/
  final.md
```

The manifest records:

- parent task id
- objective
- task class
- selected swarm profile
- budget and timeout limits
- agent roster
- model ids
- status
- timestamps
- output paths
- final synthesis path

## Role Architecture

Baseline coding swarm:

- `director`: decomposes objective, assigns work, enforces constraints.
- `architect`: maps codebase boundaries and integration risks.
- `implementer`: writes the focused patch.
- `reviewer`: checks correctness, maintainability, and regressions.
- `qa`: runs tests, checks logs, and verifies runtime behavior.
- `synthesizer`: merges findings into one actionable final result.

Scale-up roles:

- `adversary`: tries to prove the plan wrong.
- `security`: checks auth, secrets, permissions, data exposure.
- `performance`: checks latency, memory, concurrency, and cost.
- `product`: checks whether the result serves the actual user workflow.
- `historian`: searches memory/forensics for prior failures and fixes.

## Swarm Sizes

Swarm size is selected by task class and risk, not enthusiasm.

```text
1 agent:  simple read-only research, tiny edits, status checks
3 agents: normal coding: planner/implementer/reviewer
5 agents: multi-file feature or high-risk bug
8 agents: release/deploy, voice pipeline, auth, payments, data migration
13+ agents: only with explicit budget and objective; requires staged synthesis
```

Hundreds of agents must be batched into committees. No raw 100-agent fan-out.
Use multiple rounds: explore, cluster, debate, implement, review, synthesize.

## Coordination Protocol

1. Director classifies task and selects a swarm profile.
2. Historian searches docs, memory, and forensics if the task touches voice,
   tools, auth, builds, PhotoMagic, Sprites, GlassBox, Discord, or deploy.
3. Architect creates a code map and identifies files likely to change.
4. Director assigns disjoint work scopes to implementers.
5. Implementers produce patches or recommendations.
6. Reviewer and adversary critique outputs.
7. QA runs focused verification.
8. Synthesizer writes final.md and task result.
9. Worker updates `/api/tasks`.

## Continuous Improvement Cron

Cron jobs should continuously maintain:

- OpenRouter model inventory and pricing.
- Newly released model detection and capability alerts.
- Role-specific recommended model roster.
- Small benchmark tasks for coding, reasoning, review, summarization, and
  tool-use compliance.
- Cost/latency/reliability statistics by model and task class.
- Winning swarm profiles by task class.

Recommended cadence:

```text
Hourly:   refresh OpenRouter model metadata, detect new models, update radar
Daily:    run cheap smoke benchmarks across candidate models
Weekly:   run deeper benchmark suite and update recommended profiles
Monthly:  prune stale models and produce human-readable Agency report
```

Model radar outputs:

```text
/workspace/nia-universal/.agency/rosters/openrouter-models.json
/workspace/nia-universal/.agency/rosters/openrouter-models.previous.json
/workspace/nia-universal/.agency/rosters/model-radar.json
/workspace/user/Documents/Agency/model-radar.md
```

The radar should flag:

- new models from watched frontier families
- possible upgrades to `deepseek/deepseek-v4-flash`
- very cheap long-context models that could improve the free tier
- expensive frontier models that may be useful only for elite review or
  high-risk planning
- removed models that require fallback updates

## Cost Controls

Required before large swarms:

- global max active agents
- per-swarm max active agents
- per-model concurrency caps
- per-swarm dollar budget
- daily dollar budget
- timeout per role
- retry cap
- emergency pause switch
- denylist for unreliable or overpriced models

The first production cap should be conservative:

```text
max_active_swarms: 2
max_agents_per_swarm_default: 5
max_agents_per_swarm_hard: 20
daily_budget_usd: 25
single_swarm_budget_usd: 5
```

## Model Selection

Models are selected by empirical score:

```text
score = quality_weighted_score
      - cost_penalty
      - latency_penalty
      - failure_penalty
      + role_fit_bonus
```

Do not hardcode permanent winners. Frontier changes weekly. Keep a curated
default roster, but let cron jobs propose changes with evidence.

Benchmarks refine the roster; discovery keeps Pearl alive to the frontier.
Never wait for a full benchmark cycle before surfacing a potentially important
new model. Flag it, classify likely role fit, then test it.

## First Implementation Milestones

1. Load OpenRouter credentials into `pearl-worker` with an allowlisted env.
2. Add `scripts/agency-swarm-roster-refresh.py`.
3. Add durable `.agency/rosters` outputs.
4. Install hourly model-radar cron with report output.
5. Add a small 3-agent Codex/OpenRouter proof swarm.
6. Add task child-activity visibility.
7. Add Settings controls for max agents, budget, and Agency pause.
8. Add weekly benchmark report into `/workspace/user/Documents`.

## Definition Of Done

The swarm is professional when:

- every run is resumable or safely fail-able
- every result has a traceable final synthesis
- spend is bounded
- model choices are evidence-based
- failures improve future routing
- users see plain useful outcomes, not internal machinery
