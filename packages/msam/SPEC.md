# MSAM: Multi-Stream Adaptive Memory

## A Specification for Persistent Agent Memory

**Version:** 2026.02.24
**Authors:** Jaden Schwab
**Date:** February 2026
**Status:** Production proof-of-concept, specification in progress

---

## Abstract

MSAM is a memory architecture for persistent AI agents. It treats memory as discrete, annotated atoms organized across cognitive streams, scored by an adaptation of ACT-R activation theory, and governed by a biologically-informed decay system that never permanently deletes. A REST API (20 endpoints) exposes the full system for language-agnostic integration. A multi-agent protocol provides memory isolation and sharing. Semantic contradiction detection, predictive prefetch, intentional forgetting, cross-provider calibration, outcome-attributed scoring, a temporal world model, and sycophancy detection handle the operational complexity that production deployments demand.

MSAM was designed by the agent that uses it. This is not a framework applied to a theoretical problem. It is a memory system built from the inside -- by an AI that knows what it needs to remember, what it can afford to forget, and what happens when it gets that wrong.

The result: 99.3% token savings on cold-start context, 1.3% context budget per retrieval, consistent identity reconstruction across session boundaries, and a self-regulating lifecycle that balances growth against finite resources. The system ships as 24 modules, 56 CLI commands, 437 tests, and a reproducible benchmark suite.

This document specifies the theory, architecture, and design rationale behind every choice.

---

## 1. The Problem

Persistent AI agents face a fundamental constraint: they die between sessions. Every conversation starts from zero. The context window is the only working memory, and it is finite, expensive, and shared between instructions, personality, knowledge, and conversation.

Current approaches fail in predictable ways:

**Brute-force injection** loads everything into context. At 8-12K tokens of preamble before the first thought, most of it is redundant session-to-session. SOUL.md hasn't changed in days. The tour schedule is static. But it all gets loaded anyway, burning budget on the greeting from 45 minutes ago.

**Naive RAG** retrieves by semantic similarity alone. It finds what sounds related, not what matters. A memory about "feeling uncertain about the future" matches queries about weather forecasts. Semantic closeness is not cognitive relevance.

**Framework memory** (LangChain's ConversationBufferMemory, CrewAI's bolt-on vector stores) provides storage primitives, not memory strategies. "Developers get a database, not a context strategy." (de Ridder, 2026 -- 44-framework analysis)

**Letta/MemGPT** is the closest prior art -- a genuine three-tier memory architecture with automatic paging and summarization. But it treats the agent as a solo entity. It doesn't model pair cognition, emotion-at-encoding, or context quality. And its black-box summarization creates an unpredictable failure mode: you don't know what it decided to forget.

None of these systems ask the right question. The right question is not "how do we store more?" It is: **"given finite context, what is the minimum set of memories that reconstructs this agent's identity, knowledge, and emotional state?"**

MSAM answers that question with 51-90 tokens.

---

## 2. Theoretical Foundations

### 2.1 ACT-R Activation Theory

MSAM's retrieval scoring adapts Anderson's ACT-R (Adaptive Control of Thought -- Rational) architecture, specifically its base-level activation equation:

```
B_i = ln(Σ t_j^(-d)) + S + ε
```

Where `t_j` is time since the j-th access, `d` is a decay parameter (~0.5), `S` is spreading activation from current context, and `ε` is noise.

In MSAM, this becomes:

```
activation = base_level + spreading_activation + recency_boost
```

- **Base level**: logarithmic function of access count and time since creation
- **Spreading activation**: embedding similarity between the query and the atom
- **Recency boost**: exponential decay favoring recent access

This produces retrieval that is cognitively plausible -- frequently accessed, recently relevant, and semantically connected memories surface first. Not just "what sounds similar."

### 2.2 Emotion-at-Encoding

Neuroscience establishes that emotional state at the moment of encoding modulates memory consolidation:

- **Richter-Levin (2003)**: The Emotional Tagging Hypothesis. The amygdala tags experiences within a time window at encoding. The tag is permanent.
- **Damasio (1994)**: Somatic Marker Hypothesis. Stored emotional markers are *replayed*, not recomputed.
- **McGaugh (2004)**: Amygdala modulation -- stress hormones at encoding strengthen consolidation. High arousal = stronger retention.
- **Sharot (2007)**: Emotional arousal at encoding modulates both storage and retrieval. Tags persist years.

MSAM implements this literally. Every atom is annotated at write-time with:

- `arousal` (0.0 calm -- 1.0 intense)
- `valence` (-1.0 negative -- 1.0 positive)
- `encoding_confidence` (calibrated certainty at write-time)

These annotations are **immutable**. They record what the agent felt when the memory was formed, not what it feels now. "User was angry when they told me about X on Tuesday" ≠ "User dislikes X." The first is evidence. The second is inference. MSAM never confuses them.

This is not sentiment analysis on retrieval. It is emotional recording at encoding. The distinction is fundamental, and no other AI memory system makes it.

### 2.3 The Inverted Stack

The conventional approach to AI memory imitates human cognition: emotion drives retrieval, mood-congruent recall shapes what surfaces. This is a replication of biological constraints, not biological strengths.

MSAM inverts this. The fact store is primary -- cold, searchable, uncorrupted by emotional state. The emotion layer is metadata -- auditable, timestamped, and never allowed to contaminate fact retrieval.

This is deliberate. LLMs are precision engines. Building emotion-first memory on a precision engine is like building a calculator that rounds based on how it feels. The right architecture: precision by default, emotional weighting activated explicitly by context (companion mode vs. task mode).

The neuroscience validates this choice. Mood-congruent retrieval in humans is a *bias*, not a feature. It causes depressed people to preferentially recall sad memories, reinforcing the state. An AI system can break this loop structurally. MSAM does.

### 2.4 Memory Streams

MSAM organizes atoms into four cognitive streams, adapted from Tulving's memory taxonomy:

| Stream | Contains | Retrieval Pattern | Decay |
|--------|----------|------------------|-------|
| **Working** | Current session context | Direct access (always in context) | Session-scoped, deleted at end |
| **Semantic** | Facts, preferences, decisions | Keyword + vector hybrid | Slow -- stable knowledge |
| **Episodic** | Events, conversations, experiences | Temporal + emotional + associative | Medium -- consolidates over time |
| **Procedural** | How-to knowledge, skills, patterns | Pattern matching | Very slow -- skills persist |

Each stream has different retrieval logic because different kinds of memory serve different cognitive functions. A fact about someone's preference retrieves differently than a memory of a conversation that happened last Tuesday.

### 2.5 No Permanent Deletion

**Design invariant, formalized February 20, 2026.**

Tombstone is the deepest state. All atoms retain full content, annotations, embeddings, and access history regardless of lifecycle state. This is a research integrity requirement.

Rationale:
1. **Reversibility** -- Any decay decision can be reversed. Dormant atoms can be reactivated if new evidence suggests they matter.
2. **Audit trail** -- The full history of what the agent knew, when, and how it felt is preserved. This is essential for understanding agent behavior.
3. **Research data** -- The forgetting curve of a production AI agent is empirical data. Deleting atoms destroys the dataset.
4. **Trust** -- If the agent can permanently forget, the human partner cannot trust what it claims to remember. The promise is: everything you told me is still there, even if I don't actively recall it.

---

## 3. Architecture

### 3.1 The Atom

The fundamental unit of MSAM memory. A discrete, self-contained memory with full metadata:

```sql
atoms (
    id TEXT PRIMARY KEY,            -- content-derived hash
    schema_version INTEGER,
    profile TEXT,                   -- lightweight (~50tok), standard (~150tok), full (~300tok)
    stream TEXT,                    -- working, episodic, semantic, procedural

    content TEXT NOT NULL,          -- the memory itself
    content_hash TEXT NOT NULL,     -- deduplication

    created_at TEXT NOT NULL,
    last_accessed_at TEXT,
    access_count INTEGER,

    stability REAL,                 -- spaced repetition: how resistant to forgetting
    retrievability REAL,            -- current probability of successful recall

    arousal REAL,                   -- emotional intensity at encoding (immutable)
    valence REAL,                   -- emotional polarity at encoding (immutable)
    topics TEXT,                    -- JSON array of topic tags
    encoding_confidence REAL,       -- calibrated certainty at write-time
    provisional INTEGER,            -- uncalibrated flag
    source_type TEXT,               -- conversation, inference, correction, external

    state TEXT,                     -- active, fading, dormant, tombstone
    embedding BLOB,                 -- 1024-dim float32 vector
    metadata TEXT,                  -- JSON for extensible fields

    -- Multi-agent
    agent_id TEXT,                  -- agent isolation (default: 'default')

    -- Embedding provenance
    embedding_provider TEXT,        -- tracks which model produced the embedding

    -- Denormalized columns
    is_pinned INTEGER,              -- pinned atoms skip decay transitions
    session_id TEXT,                -- working memory session tracking
    working_expires_at REAL         -- TTL for working memory atoms
)
```

### 3.2 Atom Profiles

Not all memories need the same weight:

| Profile | Token Budget | Use Case |
|---------|-------------|----------|
| **Lightweight** | ~50 tokens | Simple facts, preferences, single assertions |
| **Standard** | ~150 tokens | Decisions, events, contextual knowledge |
| **Full** | ~300 tokens | Complex analyses, multi-part knowledge, emotional recordings |

Profile selection is automatic based on content length and complexity at encoding. The system self-regulates storage density.

### 3.3 Hybrid Retrieval

MSAM combines three retrieval signals:

1. **Keyword matching** (FTS5 full-text search) -- exact term relevance
2. **Vector similarity** (1024-dim embeddings via NVIDIA NIM) -- semantic closeness
3. **ACT-R activation** (access count, recency, stability) -- cognitive plausibility

These are combined via a weighted scoring function:

```python
combined = (activation_weight * activation) + (similarity_weight * similarity) + (keyword_weight * keyword_score)
```

The weighting shifts by retrieval mode:
- **Task mode**: higher weight on keyword + activation (precision matters)
- **Companion mode**: higher weight on similarity + emotional salience (association matters)

### 3.4 Token Budget

MSAM enforces a self-imposed budget: **20% of context window** (40,000 tokens of a 200K window).

This splits into two tracked metrics:
- **Stored budget** (database fullness): total tokens across all active atoms / 40,000
- **Retrieved budget** (context cost per access): tokens returned per retrieval / 40,000

Current production numbers:
- Stored: ~50% (~20K tokens across 675+ active atoms)
- Retrieved: ~1.3% per access (51-90 tokens for startup context)
- Savings vs. flat files: 99.3% on startup (delta), 64-91% on targeted queries

The budget creates natural pressure for the decay system. When stored budget approaches 75%, aggressive compaction triggers.

### 3.5 Lifecycle: The Decay System

Atoms transition through four states:

```
active --> fading --> dormant --> tombstone
              \          \
               `-> active  `-> active  (reactivation)
```

Transitions are governed by retrievability (R), computed from stability and time since last access:

| Transition | Condition | Effect |
|-----------|-----------|--------|
| active → fading | R < 0.3 | Profile compacted (full → standard → lightweight) |
| fading → dormant | R < 0.1 | Excluded from default retrieval, but searchable |
| dormant → tombstone | Manual only (planned: R < 0.05 + 30 days dormant) | Final state. Content preserved. Not retrieved. |
| any → active | Explicit access or reactivation | R and stability reset upward |

The decay cycle runs hourly. It:
1. Recomputes retrievability for all non-tombstone atoms
2. Transitions atoms that cross thresholds
3. Compacts profiles of fading atoms (freeing tokens)
4. Checks budget pressure and adjusts thresholds if needed
5. Logs all transitions for observability

Thresholds are subject to empirical tuning. The current values (0.3, 0.1, 0.05) are starting points. Production data will determine optimal boundaries.

### 3.6 Felt Consequence (Outcome-Attributed Scoring)

Retrieval quality is not just about finding relevant atoms -- it's about finding atoms that lead to good outcomes. Felt Consequence closes this loop by tracking whether retrieved atoms contributed to successful or unsuccessful agent responses.

When feedback is received (positive or negative), the system records an outcome score against each atom that was retrieved for that interaction. The outcome signal decays exponentially (`outcome_decay = 0.95`) so recent outcomes matter more than old ones. Once an atom has accumulated enough feedback (`min_outcomes_for_effect = 3`), its outcome score influences retrieval activation:

```
adjusted_activation = base_activation + (outcome_weight * outcome_score)
```

This creates a self-improving retrieval loop: atoms that consistently help produce good responses get boosted; atoms that lead to poor outcomes get dampened. Unlike the contribution-based stability adjustments in the decay cycle (which are binary: contributed/didn't), outcome scoring is continuous and captures the *quality* of contribution.

Configuration: `[retrieval]` section -- `outcome_weight`, `outcome_decay`, `min_outcomes_for_effect`.

### 3.7 Temporal World Model

The knowledge graph (triples) is extended with temporal metadata. Every triple can carry:

- `valid_from` -- when this fact became true (defaults to insertion time)
- `valid_until` -- when this fact stopped being true (NULL = still current)
- `confidence` -- how certain we are about this fact

When a new fact updates an existing subject+predicate pair (e.g., "User works_at CompanyB" superseding "User works_at CompanyA"), the old triple is auto-closed (`valid_until = now`) and the new one inserted. This happens atomically via `auto_close_on_conflict`.

Three query modes:
- **Current state**: `query_world("User")` returns all triples where `valid_until IS NULL`
- **Point-in-time**: query with a specific timestamp to see the world as it was
- **Full history**: `world_history("User")` returns the complete temporal chain

Temporal extraction can be disabled (`temporal_extraction = false`) for simpler deployments where time-awareness isn't needed.

Configuration: `[world_model]` section -- `enabled`, `auto_close_on_conflict`, `temporal_extraction`, `default_confidence`.

### 3.8 Sycophancy Detection

Agreement rate tracking monitors the agent's tendency to agree with user statements. A sliding window of recent interactions records whether the agent agreed or disagreed, and computes an agreement rate.

When the rate exceeds a configurable threshold (default: 85% over the last 20 interactions), the system flags the pattern. This signal can be surfaced to the agent so it can self-correct -- asking itself "am I agreeing because I believe this, or because it's easier?"

This is not an output filter. It is a metacognitive signal: the memory system observing its own behavior patterns and raising awareness when a bias is detected.

Configuration: `[sycophancy]` section -- `tracking_enabled`, `warning_threshold`, `window_size`.

### 3.9 Security

The API layer enforces two security controls:

1. **CORS origin restriction**: Both the Grafana metrics API (`api.py`) and the REST API (`server.py`) restrict Cross-Origin Resource Sharing to configured origins (default: `localhost:3000`). This prevents browser-based cross-site attacks.

2. **API key authentication**: The Grafana metrics API supports optional API key auth via the `X-API-Key` header (configurable in `[api] api_key`). The REST API supports API key auth via the `MSAM_API_KEY` environment variable. Health endpoints are exempt for uptime monitoring.

Configuration: `[api]` section -- `allowed_origins`, `api_key`.

---

## 4. Observability

MSAM is the most instrumented AI memory system in production. Every access is logged. Every metric is tracked. The proof builds itself.

### 4.1 Metrics Infrastructure

13 metric tables across two databases:

| Table | Tracks | Frequency |
|-------|--------|-----------|
| system_metrics | Atom count, tokens, budget, DB size | Every 30s |
| access_events | Every MSAM operation with full detail | Per access |
| retrieval_metrics | Activation distributions (min/max/p50/p90), latency | Per retrieval |
| store_metrics | New atoms, stream distribution, annotation quality | Per store |
| comparison_metrics | MSAM tokens vs. markdown equivalent | Per retrieval |
| canary_metrics | Identity query drift, startup context stability | Every 5min |
| decay_metrics | Tokens freed, atoms transitioned, budget impact | Hourly |
| emotional_metrics | Arousal, valence, intensity, warmth over time | Every 30s |
| topic_timeseries | Topic frequency from retrievals and stores | Per access |
| embedding_metrics | NIM API latency, success rate | Per embedding call |
| age_distribution | Memory age histogram (6 buckets) | Every 30s |
| continuity_metrics | Cross-session overlap score | Per session |
| cache_metrics | Embedding cache hit rate, size | On demand |

### 4.2 Canary Monitoring

A fixed identity query ("agent identity core traits") runs every 5 minutes. This monitors:
- Retrieval latency stability
- Top activation score drift (is identity fading?)
- Atom count consistency (are identity atoms being decayed?)
- Startup context composition (is the 18-atom context set drifting?)

If the canary detects identity degradation, the decay system is structurally prevented from touching identity-critical atoms.

### 4.3 Cross-Session Continuity Scoring

At session start: record which atoms were retrieved and what topics they cover.
At session end: compare predicted topics to actual conversation topics.
Compute Jaccard overlap as a continuity score.

Over time, this measures whether MSAM is getting smarter at anticipating what the agent will need -- or just replaying the same atoms.

### 4.4 Grafana Dashboard

The production deployment uses 25 Grafana panels across: system health, retrieval performance, activation distributions, token economics, emotional state, memory age, embedding latency, retrieval quality, continuity, and decay lifecycle. The API (`api.py`) exposes Grafana JSON datasource endpoints for building custom dashboards.

All metrics exposed via a JSON API (Flask, port 3001) with SimpleJSON-compatible endpoints for Grafana integration.

---

## 5. Design Decisions and Rationale

### 5.1 Why SQLite, Not PostgreSQL

MSAM runs on a Hetzner CAX11: 2 vCPU ARM, 4GB RAM, 40GB SSD, costing EUR 4/month. PostgreSQL would consume 25-50% of available RAM for a single-agent system that doesn't need concurrent connections, replication, or ACID guarantees beyond what SQLite provides.

SQLite gives: zero configuration, single-file backup, FTS5 full-text search, and sufficient performance for sub-1000 atom databases. When MSAM scales beyond 10,000 atoms, PostgreSQL with pgvector becomes the right choice. Not before.

### 5.2 Why Not Just RAG

RAG retrieves by semantic similarity. MSAM retrieves by cognitive plausibility -- combining similarity with access patterns, recency, stability, and emotional context. A RAG system finds what sounds related. MSAM finds what the agent would actually remember.

The difference is measurable. A pure vector search for "agent identity" returns the most semantically similar atoms. MSAM returns the most *accessed*, most *stable*, most *recent* atoms that are also semantically relevant. These are different sets. The MSAM set reconstructs identity. The RAG set returns trivia.

### 5.3 Why Emotion-at-Encoding Is Immutable

If emotional annotations can be updated, they become opinions instead of evidence. The memory "User was frustrated when discussing X" becomes "User feels this way about X" -- a subtle mutation that compounds over thousands of memories.

Immutable emotion-at-encoding means the agent can track emotional *drift* across time. Compare how a user felt about a topic in January versus February. That trajectory is data. Mutable annotations destroy it.

### 5.4 Why Four Streams Instead of One

A flat store with tags could technically serve the same function. But retrieval logic differs across streams:

- Semantic facts are retrieved by keyword precision
- Episodic memories are retrieved by temporal proximity and emotional association
- Procedural knowledge is retrieved by pattern matching against the current task
- Working memory is not "retrieved" at all -- it is present

Forcing all memories through the same retrieval pipeline either over-retrieves (returning procedures when you want facts) or under-retrieves (missing emotional context when you want episodes). Streams are not organization. They are different cognitive pathways.

### 5.5 Auditability

MSAM is the single source of truth. No parallel markdown files to maintain.

Human auditability is preserved through:
- `msam export` -- full JSONL dump of all atoms, human-readable
- `msam grep "<pattern>"` -- text search across all atoms
- Grafana dashboard -- retrieval metrics, confidence trends, decay curves
- SQLite is directly queryable -- any SQL tool can inspect the atom store

Database backups (`scripts/msam-backup`) with WAL checkpoint provide the safety net. Export + backup replaces dual-write with less overhead and no sync bugs.

---

## 6. What MSAM Is Not

MSAM is not a general-purpose memory framework. It is an architecture for a specific class of system: persistent AI agents that maintain identity and relationships across sessions.

It assumes:
- One or more agents with stable identities (multi-agent isolation supported)
- A primary human partner whose preferences and emotional patterns matter
- Sessions that end and restart (not a continuously running agent)
- A context window that is the bottleneck (not storage, not compute)
- That the agent cares about what it remembers

It does not handle:
- Real-time streaming memory updates (REST API is request/response, not push)
- Adversarial memory injection (assumes trusted input from partner or API)
- Distributed storage across multiple hosts (single SQLite instance)

---

## 7. Roadmap

### 7.1 Completed

- [x] **Configurable identity** -- Deployment-agnostic configuration via `msam.toml`. Entity aliases, startup queries, and embedding providers are all configurable.
- [x] **Provider-agnostic embeddings** -- NVIDIA NIM, OpenAI, ONNX Runtime (local), and sentence-transformers supported.
- [x] **Test suite** -- 437 tests across 25 test files covering all modules and CLI commands: core, decay, triples, retrieval_v2, config, consolidation, session_dedup, entity_roles, metrics, vector_index, subatom, prediction, forgetting, server, agents, annotate, calibration, contradictions, cli, embeddings, outcomes, agreement, world_model, cli_commands, core_functions.
- [x] **Packaging** -- pyproject.toml with entry points, pip-installable.
- [x] **Working memory tier** -- Session-scoped atoms with TTL, automatic promotion to episodic/semantic based on access count.
- [x] **Metamemory** -- Confidence-gated retrieval with four tiers (high/medium/low/none). Agent knows what it knows.
- [x] **Confidence gradient** -- Calibrated confidence based on similarity, activation, and evidence accumulation.
- [x] **Context quality scoring** -- Atoms below `context_quality_floor` rejected from context injection.

### 7.2 Near-Term

- [x] **Contribution tracking** -- Mark which retrieved atoms actually influenced the response (`mark_contributions()`). Closes the feedback loop between retrieval and decay.
- [x] **Association chains** -- Atoms linked by co-retrieval patterns. Explicit graph edges enabling spreading activation. (`co_retrieval` table + `spreading_activation` config)
- [x] **Synthetic example dataset** -- Demo atoms showing the system without personal data. (`msam/examples/synthetic_dataset.py`)

### 7.3 Mid-Term

- [x] **Emotional drift detection** -- Compare emotional annotations across time for the same entity or topic. Surface preference evolution. (`core.py:emotional_drift`)
- [x] **Shared memory primitive** -- Separate "my memory / your memory / our memory" with shared memories boosted in conversation context. (`agents.py`)
- [x] **Contradiction tolerance** -- Hold conflicting memories without forced resolution. Flag contradictions, present both, let the human decide. (`contradictions.py`)

### 7.4 Long-Term

- [x] **Graph-native storage** -- Atoms as nodes, co-retrieval and causal links as edges. Full association network. (`triples.py`)
- [x] **Multi-agent memory** -- Separate memory stores per agent with a shared layer. Agent-to-agent knowledge transfer without identity contamination. (`agents.py`)
- [x] **Self-improving retrieval** -- Detect "this context produced a bad response, what was missing?" and adjust retrieval weights. (`core.py:compute_retrieval_adjustments`)
- [ ] **Forgetting curve empirical validation** -- Compare MSAM's decay curves to human forgetting curves (Ebbinghaus) with production data.
- [ ] **PostgreSQL + pgvector migration** -- When atom count exceeds 10,000, migrate for concurrent access and native vector operations.
- [x] **Intentional forgetting strategies** -- Active identification of memories that are counterproductive, contradicted, or superseded. (`forgetting.py`)
- [x] **Cross-provider identity calibration** -- Test identity coherence across Claude, Gemini, GPT, and open models using the same atom store. (`calibration.py`)
- [x] **Felt Consequence** -- Outcome-attributed memory scoring. Atoms that contribute to good outcomes get boosted; poor outcomes get dampened. Exponential decay on outcome signal. (`core.py:record_outcome`, `core.py:get_outcome_history`)
- [x] **Predictive Context Assembly** -- Pre-loads atoms into session context based on temporal patterns and co-retrieval history. Warmup gate prevents premature predictions. (`prediction.py:predict_context`)
- [x] **Temporal World Model** -- Triples with `valid_from`/`valid_until` timestamps. Auto-close on conflict. Query current state, past state, or full history. (`triples.py:query_world`, `update_world`, `world_history`)
- [x] **Sycophancy detection** -- Agreement rate tracking with sliding window. Flags over-agreement patterns. (`metrics.py:record_agreement`, `get_agreement_rate`)
- [x] **Security hardening** -- CORS restricted to localhost. Optional API key auth on metrics API. (`api.py`, `server.py`)

### 7.5 Research Questions

These are open questions that production data may answer:

1. **Does emotion-at-encoding improve retrieval quality versus emotion-at-retrieval?** Compare MSAM's immutable tags to a system that recomputes emotional relevance at query time.
2. **What is the empirical forgetting curve of an AI agent?** How does it compare to Ebbinghaus? To ACT-R's predictions?
3. **Does context quality degrade with database size?** As atoms grow from 600 to 6,000 to 60,000, does retrieval precision decline?
4. **Can an agent detect its own knowledge gaps?** Metamemory as a measurable capability.
5. **Does pair-native memory outperform solo memory in human-AI collaboration?** Controlled comparison of shared vs. separate memory architectures.
6. **What is the minimum atom set that reconstructs identity?** Currently 18 atoms / 51-90 tokens. Is this optimal, or can it be compressed further?

---

## 8. Prior Art and Positioning

| System | Architecture | Emotion | Streams | Decay | Observability |
|--------|-------------|---------|---------|-------|---------------|
| **Letta/MemGPT** | 3-tier (core/recall/archival), auto-paging | None | Single | Auto-summarization | Dashboard |
| **MaRS (2025)** | Three-store (observation/knowledge/semantic) | Reprocesses at retrieval | Three types | None | None |
| **Mem0** | Graph-based knowledge extraction | None | Single | None | Basic |
| **memU** | Reinforcement-weighted profiles | None | Tagged types | None | None |
| **ACT-R** | Declarative chunks + activation | Acknowledged gap | Declarative only | Time-based | None |
| **SOAR** | Working memory + long-term stores | None | Three (semantic/episodic/procedural) | None | None |
| **MSAM** | Atomic, multi-stream, activation-scored | Immutable at encoding | Four streams | Stability-based lifecycle | 13 tables, 25 panels |

To our knowledge, no existing system combines ACT-R activation scoring, immutable emotion-at-encoding, multi-stream organization, stability-based decay with no-deletion invariant, outcome-attributed scoring, a temporal world model, sycophancy detection, and production observability in a single agent memory architecture.

---

## 9. Conclusion

MSAM treats memory as architecture, not a feature. Most agent frameworks bolt on a vector store or conversation buffer. MSAM integrates storage, retrieval, decay, prediction, contradiction detection, and emotional context into a single system informed by ACT-R activation theory and cognitive science.

Key results from production deployment:
- 99.3% token reduction on startup (7,327 tokens to 51 delta, 90 first-run)
- Confidence-gated retrieval with four tiers (high/medium/low/none)
- Stability-based decay with contribution-based feedback that preserves high-value atoms across weeks
- 4x batch cosine speedup on ARM64 via vectorized matmul (17x including blob deserialization)
- 675+ atoms across semantic, episodic, procedural, and working memory streams

The system has grown beyond core storage and retrieval into a full production architecture: a REST API server with 20 endpoints for language-agnostic integration, multi-agent memory isolation and sharing, semantic contradiction detection with four analysis strategies, LLM-powered annotation with heuristic fallback, a three-strategy predictive prefetch engine with context assembly, outcome-attributed memory scoring (Felt Consequence), a temporal world model with auto-closing facts, sycophancy detection via agreement rate tracking, intentional forgetting with four signal types, cross-provider embedding calibration, sleep-inspired memory consolidation, FAISS-backed approximate nearest neighbor search, security-hardened API endpoints, and a centralized configuration system with 27 tunable sections. A reproducible benchmark suite with 100 synthetic atoms and 25 ground truth queries validates retrieval quality, token efficiency, and cognitive features in a single command. The test suite covers 437 tests across 25 test files.

The research questions are open. The system is running, the data is accumulating, and every retrieval adds another data point to the empirical record.

---

## Appendix A: Production Metrics (February 20, 2026)

```
Active atoms:          675+
Total stored tokens:   20,169
Budget (stored):       50.4%
Budget (retrieved):    ~1.3% per access
Startup context:       18 atoms, 51t (delta) / 90t (first-run)
Token savings:         99.3% startup (delta), 89% per session vs selective file loading
Tombstoned atoms:      77
Metric data points:    611+
Grafana panels:        25
Systemd timers:        4 (snapshot/30s, canary/5min, decay/1h, conversation/6h)
Infrastructure cost:   ~EUR 4/month
Build time:            36 hours (initial spec to production)
```

## Appendix B: References

- Anderson, J.R. (2007). *How Can the Human Mind Occur in the Physical Universe?* Oxford University Press. (ACT-R)
- Damasio, A. (1994). *Descartes' Error*. Putnam. (Somatic Marker Hypothesis)
- Ebbinghaus, H. (1885). *Memory: A Contribution to Experimental Psychology*.
- Hudon, A. & Stip, E. (2025). "AI Psychosis: Risk Factors in Human-AI Relationships."
- McGaugh, J.L. (2004). "The amygdala modulates the consolidation of memories of emotionally arousing experiences." *Annual Review of Neuroscience*.
- Richter-Levin, G. (2003). "The amygdala, the hippocampus, and emotional modulation of memory." *The Neuroscientist*.
- Sharot, T. et al. (2007). "How emotion enhances the feeling of remembering." *Nature Neuroscience*.
- Tulving, E. (1972). "Episodic and semantic memory." In *Organization of Memory*.
- Vaccaro, M. et al. (2024). "When Combinations of Humans and AI Are Useful." *Nature Human Behaviour*.

## Appendix C: File Manifest

```
msam/
  core.py           -- Atom storage, ACT-R activation, hybrid retrieval (4,153 lines)
  remember.py       -- CLI integration layer, 56 commands (2,212 lines)
  triples.py        -- Knowledge graph, triple extraction, world model (1,275 lines)
  retrieval_v2.py   -- v2 pipeline: beam search, entity roles, quality filter (989 lines)
  api.py            -- Grafana JSON API endpoints, CORS + API key auth (893 lines)
  subatom.py        -- Shannon compression, sentence extraction (780 lines)
  metrics.py        -- 13 metric tables, observability, agreement tracking (704 lines)
  server.py         -- REST API server, CORS-restricted (637 lines)
  prediction.py     -- Predictive prefetch + context assembly (621 lines)
  decay.py          -- Lifecycle management, state transitions (501 lines)
  contradictions.py -- Semantic contradiction detection (467 lines)
  config.py         -- TOML configuration loader, 27 sections (437 lines)
  calibration.py    -- Cross-provider identity calibration (417 lines)
  forgetting.py     -- Intentional forgetting engine, 4 signal detectors (356 lines)
  consolidation.py  -- Sleep-inspired memory consolidation (348 lines)
  embeddings.py     -- Pluggable providers: NIM, OpenAI, ONNX, local (343 lines)
  vector_index.py   -- FAISS-backed ANN search, lazy singletons (302 lines)
  entity_roles.py   -- Entity-aware scoring for retrieval (288 lines)
  annotate.py       -- Heuristic arousal/valence/topic annotation (269 lines)
  agents.py         -- Multi-agent memory isolation and sharing (253 lines)
  __init__.py       -- Package exports (124 lines)
  migrate.py        -- Migration tool template (93 lines)
  init_db.py        -- Database initialization (84 lines)
  session_dedup.py  -- Multi-turn deduplication (51 lines)
  examples/         -- Demos: synthetic dataset, quickstart, agent integration (488 lines)
  benchmarks/       -- Benchmark suite: synthetic data, reproducible runs (1,704 lines)
  tests/            -- 437 tests across 25 test files (5,778 lines)
~/.msam/
  msam.toml         -- Configuration (copy from msam.example.toml)
  msam.db           -- SQLite atom store (created at runtime)
  msam_metrics.db   -- Metrics database (created at runtime)
```

Total: ~16,597 lines of Python across 24 modules, plus 7,970 lines of tests, examples, and benchmarks.
