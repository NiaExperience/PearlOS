# MSAM

**Multi-Stream Adaptive Memory** -- a production-grade cognitive memory architecture for AI agents.

MSAM gives agents persistent, structured memory that self-regulates what it stores, how it retrieves, and when it forgets. Knowledge lives as discrete atoms across semantic, episodic, procedural, and working memory streams, scored using ACT-R activation theory, and retrieved through a hybrid pipeline combining embedding similarity, keyword matching, and a knowledge graph of subject-predicate-object triples. A REST API exposes the full system for language-agnostic integration, and a multi-agent protocol lets multiple agents share or isolate memories.

When MSAM knows something, it delivers. When it doesn't, it says so. Output volume is proportional to confidence -- not padded with noise.

Built for production. Running in production. 675+ atoms, 1,500+ triples, 99.3% startup compression, 89% session savings vs. flat files. 24 modules, 56 CLI commands, 20 API endpoints, 437 tests.

## Benchmark Highlights

Measured on production hardware (Hetzner CAX11, 2 vCPU ARM64, 4GB RAM).

| Scenario | MD Baseline | Output | vs MD | Shannon Eff | Tier | Latency |
|---|---|---|---|---|---|---|
| Startup (delta) | 7,327t | 51t | **99.3%** | 51.0% | -- | 2,477ms |
| Known query | 7,327t | 91t | **98.8%** | 14.3% | medium | 1,082ms |
| Unknown query | 7,327t | 33t | **99.5%** | 57.6% | low | 1,082ms |
| No data | 7,327t | 0t | **100%** | -- | none | 1,064ms |

### Session Economics (startup + 10 queries)

| Metric | Flat Files (selective) | MSAM | Savings |
|---|---|---|---|
| Tokens per session | ~12,000t | ~1,351t | **89%** |
| Cost (Opus @ $15/MTok) | ~$0.18 | $0.02 | **$0.16** |
| Context window usage | ~30% of 40K | 0.3% of 40K | ~30% freed |

Note: file baseline assumes selective loading (only relevant files per query). Naive full-reload systems see 98%+ savings.

Full benchmark data: [BENCHMARKS.md](BENCHMARKS.md)

## Why MSAM

Most agent memory systems are vector stores with a retrieval wrapper. MSAM is different:

- **Adaptive output.** Confidence-gated retrieval: high confidence returns full results, low returns minimal context, none returns nothing. The system doesn't hallucinate -- it admits gaps.

- **Multi-stream architecture.** Semantic (facts), episodic (events), procedural (how-to), and working (session-scoped) streams. Each has different retrieval behavior, decay characteristics, and promotion rules.

- **Shannon-compressed startup.** Session context uses subatom extraction, codebook compression, delta encoding, and semantic deduplication to reach 51 tokens from a 7,327-token markdown baseline. 51% of Shannon's theoretical minimum.

- **Cognitive scoring.** ACT-R activation model: base-level activation (frequency + recency) x sigmoid similarity x annotation bonuses x stability. Not just "closest vector."

- **Adaptive scaling.** Multi-beam retrieval sleeps until the database is large enough to benefit. Compression only runs where it earns its compute. The pipeline doesn't pay scale-tax before scale arrives.

- **Forgetting as a feature.** Intentional forgetting with four signal types (low activation, redundancy, staleness, contradiction). Exponential decay based on retrievability. Atoms transition through active, fading, dormant, and tombstone states. Nothing is deleted -- everything is auditable.

- **Self-improving retrieval.** Contribution tracking marks which atoms influenced agent responses. Over-retrieved noise gets dampened. High-value atoms get boosted. The feedback loop runs every decay cycle.

- **Temporal awareness.** Queries about "right now" or "today" require recent atoms. Stale data is demoted regardless of similarity score.

- **Knowledge graph with contradiction detection.** Subject-predicate-object triples extracted from atoms, traversable via graph queries, with semantic contradiction detection across negation, temporal supersession, value conflicts, and antonyms.

- **Multi-agent memory.** Agent isolation via namespaced atoms, selective sharing between agents, per-agent statistics. Multiple agents can share a single MSAM instance without interference.

- **Predictive prefetch.** Three-strategy prediction engine (temporal patterns, co-retrieval history, topic momentum) anticipates what atoms an agent will need before it asks. Predictive Context Assembly pre-loads atoms into session context based on time-of-day and co-retrieval patterns, with a configurable warmup gate.

- **Felt Consequence.** Outcome-attributed memory scoring tracks whether retrieved atoms led to good or bad outcomes. Atoms that consistently contribute to successful responses get boosted; atoms that produce poor outcomes get dampened. The feedback signal decays exponentially so recent outcomes matter more.

- **Temporal World Model.** A structured knowledge graph layer where triples carry temporal metadata (`valid_from`, `valid_until`). When facts change, the old triple auto-closes and the new one opens. Query the current state of the world, the state at a past time, or the full history of an entity.

- **Sycophancy detection.** Agreement rate tracking monitors whether the agent is over-agreeing with the user. When the agreement rate exceeds a configurable threshold across a sliding window, the system flags the pattern so the agent can self-correct.

- **REST API.** Full HTTP interface (`msam serve`) with 20 endpoints covering every subsystem -- store, query, context, feedback, decay, triples, contradictions, prediction, consolidation, forgetting, calibration, and multi-agent operations. CORS restricted to localhost by default with optional API key authentication.

- **Cross-provider calibration.** Switch embedding providers (NIM, OpenAI, ONNX, local) without losing retrieval quality. Calibration re-embeds atoms and adjusts similarity thresholds to maintain identity.

## Quick Start

### Prerequisites
- Python 3.11+ (uses `tomllib` from stdlib; macOS ships 3.9 -- install 3.11+ via `brew install python@3.13`)
- `pip install setuptools --upgrade` if pip install fails on older systems
- An embedding provider (choose one):
  - **NVIDIA NIM** (default) -- free tier, API key from [build.nvidia.com](https://build.nvidia.com)
  - **OpenAI** -- `text-embedding-3-small`, API key from OpenAI
  - **ONNX Runtime** (local) -- no API key, `pip install msam[onnx]`
  - **sentence-transformers** (local) -- no API key, `pip install msam[local]`

### Install

Download the latest release from [GitHub Releases](https://github.com/jadenschwab/msam/releases), then:

```bash
# Extract and install
tar -xzf msam-YYYY.MM.DD.tar.gz
cd msam
pip install .
```

### Configure
	
```bash
# Copy the example config to your data directory
mkdir -p ~/.msam
cp msam.example.toml ~/.msam/msam.toml
```

Edit `~/.msam/msam.toml` for your deployment. The critical section is `[embedding]`:

```toml
# Option A: NVIDIA NIM (free, recommended)
[embedding]
provider = "nvidia-nim"
# Set env: export NVIDIA_NIM_API_KEY="your-key"

# Option B: ONNX Runtime (local, no API key)
[embedding]
provider = "onnx"
model = "BAAI/bge-small-en-v1.5"    # auto-downloads 33MB model
dimensions = 384

# Option C: OpenAI
[embedding]
provider = "openai"
model = "text-embedding-3-small"
# Set env: export OPENAI_API_KEY="your-key"
```

Everything else in the config has sensible defaults. Customize entity aliases, query synonyms, retrieval thresholds, and decay rates as needed -- all documented inline.

Data is stored in `~/.msam/` by default. Override with `MSAM_DATA_DIR=/your/path`. Config location can be set explicitly with `MSAM_CONFIG=/path/to/msam.toml`.

### Initialize and Use

```bash
# Create databases (safe to re-run)
python -m msam.init_db

# Store your first memory
msam store "The user prefers dark mode and concise responses"

# Retrieve (confidence-gated output)
msam query "What are the user's preferences?"
# Returns: atoms, triples, confidence_tier, shannon metrics

# Session startup context (compressed)
msam context
# Returns: 51-90 tokens vs thousands from flat files

# See all commands
msam help
```

## Configuration

Every subsystem is configurable via `~/.msam/msam.toml` (27 sections, 160+ parameters). Copy from `msam.example.toml` for documented defaults with inline explanations.

Key sections:

| Section | Controls |
|---------|----------|
| `[embedding]` | Provider (nvidia-nim, openai, onnx, local), model, dimensions, API keys |
| `[storage]` | Token budget ceiling, auto-compact threshold, DB paths |
| `[retrieval]` | top_k, similarity threshold, sigmoid curve, semantic/keyword weights, confidence tiers |
| `[retrieval_v2]` | Beam search gate, entity roles, quality filter, temporal detection, reranking |
| `[decay]` | State transition thresholds, confidence decay rate, stability factors |
| `[working_memory]` | Session atom TTL, promotion threshold, default profile |
| `[atoms]` | Default profile, encoding confidence, arousal, valence |
| `[merge]` | Similarity threshold for merge suggestions |
| `[negative_knowledge]` | TTL for negative examples |
| `[emotional_context]` | Urgency, valence, arousal scoring bonuses |
| `[relations]` | Supersedes penalty, supports bonus |
| `[consolidation]` | Cluster similarity, min cluster size, stability reduction |
| `[annotation]` | LLM URL, model, timeout for annotation |
| `[triples]` | LLM URL and model for triple extraction |
| `[compression]` | Subatom extraction, sentence dedup, synthesis model and thresholds |
| `[prediction]` | Temporal/co-retrieval/momentum weights, lookback, warmup gate, predictive context assembly |
| `[agents]` | Default agent ID, sharing toggle |
| `[context]` | Startup queries, probe queries, token budgets |
| `[api]` | Server port, host binding, CORS allowed origins, API key auth |
| `[metrics]` | Metrics logging toggles, probe settings |
| `[entity_resolution]` | Alias mappings (nicknames to canonical names) |
| `[query_expansion]` | Synonym groups for query rewriting |
| `[predictive_retrieval]` | Context keys for predictive prefetch |
| `[world_model]` | Temporal world model: enable/disable, auto-close on conflict, temporal extraction |
| `[sycophancy]` | Agreement rate tracking: enable/disable, warning threshold, window size |

### Embedding Providers

```toml
# NVIDIA NIM (default, free tier available)
[embedding]
provider = "nvidia-nim"
model = "nvidia/nv-embedqa-e5-v5"

# OpenAI-compatible
[embedding]
provider = "openai"
model = "text-embedding-3-small"

# Local (no API, runs on CPU)
[embedding]
provider = "local"
model = "all-MiniLM-L6-v2"
```

## Architecture

```
Query
  |
  v
retrieve_v2 pipeline:
  rewrite -> temporal detect -> [beam search | single retrieve]
  -> triple augment -> entity role scoring -> quality filter -> sort
  |
  v
Confidence gating:
  high:   full results, zero-sim pruned, <=12 triples
  medium: top 3 atoms (sim > 0.15), <=8 triples
  low:    1 atom, no triples, advisory
  none:   empty, advisory only
  |
  v
Output (91-176t high, 0-33t low, 0t none)


Context startup:
  4 queries (identity/partner/recent/emotional)
  -> subatom extraction -> codebook -> delta encoding -> dedup
  -> 51 tokens (99.3% compression)
```

### Confidence Tier System

| Tier | Similarity | Output | Token Volume |
|---|---|---|---|
| High | >= 0.45 | Full results, zero-sim pruned, <=12 triples | 140-176t |
| Medium | >= 0.30 | Top 3 atoms (sim > 0.15), <=8 triples | 91-131t |
| Low | >= 0.15 | 1 atom for context, no triples, advisory | 0-33t |
| None | < 0.15 | Empty, advisory only | 0t |

Note: confidence tiers reflect similarity relative to stored atoms. Small databases (< 50 atoms) produce higher similarity scores for off-topic queries because the embedding space has fewer candidates. Discrimination improves as the database grows. Tune thresholds via `confidence_sim_high`, `confidence_sim_medium`, and `confidence_sim_low` in `msam.toml`.

### Adaptive Scaling

Multi-beam retrieval activates based on database size:

```toml
[retrieval_v2]
enable_beam_search = "auto"          # "auto" | true | false
beam_search_atom_threshold = 10000   # activates above this atom count
beam_width = 3
```

At current scale, single-beam. At 10K+, multi-beam. The code stays, the architecture scales, the pipeline doesn't pay for features it doesn't need yet.

### Storage Model

**Atoms** are discrete memory units with three profiles:

| Profile | Tokens | Use Case |
|---------|--------|----------|
| Lightweight | ~50 | Working memory, compressed facts |
| Standard | ~150 | Most knowledge |
| Full | ~300 | Rich context, important events |

**Triples** are structured subject-predicate-object facts:
- `(User, has_profession, engineer)`
- Traversable via `graph_traverse()` and `graph_path()`
- Contradiction detection across conflicting predicates

### Compression Pipeline (Context Startup)

Applied to session startup where compression earns its compute:

1. **Subatom extraction** -- sentence-level extraction from atoms
2. **Codebook compression** -- recurring entities shortened (Agent->A, User->U)
3. **Delta encoding** -- unchanged sections emit `[no_change]`
4. **Semantic dedup** -- 0.75 threshold catches overlapping sentences

Not applied to queries -- atoms are already compact (median 103 chars). Benchmarking proved query compression adds noise, not value.

### Decay Cycle

```
ACTIVE --(R < 0.3)--> FADING --(R < 0.1)--> DORMANT --(manual)--> TOMBSTONE
  ^                                                                    |
  +----------------------- (accessed: reactivate) ---------------------+
```

- Retrievability: `R(t) = e^(-t/S)` (exponential decay with stability)
- Protected atoms: recently accessed or pinned
- Confidence decay: 0.01/day after 7-day grace period
- Every state transition logged with justification

## CLI Reference

56 commands. Highlights below -- run `msam help` for the full list.

```bash
# Storage
msam store "Your memory content"
msam batch "atom1" "atom2" "atom3"  # batch store
msam negative "X is NOT Y"         # store negative knowledge

# Retrieval (confidence-gated)
msam query "search query"
msam query "search query" --mode companion --top-k 20
msam hybrid "search query"         # atoms + triples
msam explain "query"               # detailed scoring breakdown
msam diverse "query"               # diversity-optimized retrieval

# Session startup
msam context                       # compressed startup context

# Feedback and contribution tracking
msam feedback-mark <atom_ids> <response_text>
msam contribute <atom_id>          # mark atom as contributed

# Session management
msam session-clear                 # clear dedup tracking
msam session-boundary              # log session boundary

# Lifecycle
msam decay                         # run decay cycle
msam forgetting --dry-run          # preview forgetting candidates
msam consolidate                   # sleep-inspired consolidation
msam snapshot                      # log metrics

# Knowledge graph
msam contradictions                # detect conflicts
msam gaps <entity>                 # knowledge gap analysis
msam graph <entity>                # traverse relationships

# World model (temporal knowledge)
msam world <entity>                # query current world state
msam world update <s> <p> <o>      # update world fact
msam world history <entity>        # temporal history of an entity

# Analysis
msam metamemory "topic"            # coverage assessment
msam stats                         # database statistics
msam analytics                     # retrieval analytics
msam predict                       # predictive prefetch
msam outcomes <atom_id>            # outcome feedback history
msam agreement                     # sycophancy/agreement rate

# Administration
msam serve                         # start REST API server
msam calibrate                     # cross-provider calibration
msam re-embed                      # re-embed all atoms
msam export > backup.json          # export all atoms
msam import < backup.json          # import atoms
msam pin <atom_id>                 # protect atom from decay
```

## Latency Profile

### Current (API Embeddings)

| Component | Time | % |
|---|---|---|
| Embedding API (NVIDIA NIM) | 247ms | 28% |
| SQLite fetch (675+ atoms) | 3ms | <1% |
| Cosine similarity (vectorized) | 1.1ms | <1% |
| Triple retrieval + scoring | 200ms | 23% |
| Pipeline overhead (gating, compression) | 419ms | 48% |
| **Total query (full pipeline)** | **~870ms** | |
| **Core retrieve only (uncached)** | **289ms** | |
| **Core retrieve only (cached embed)** | **29ms** | |

### Local Embeddings (ONNX Runtime)

| Provider | Latency | Tradeoff |
|---|---|---|
| NVIDIA NIM (API, 1024-dim) | 247ms | Highest quality, needs API key |
| ONNX Runtime (local, 384-dim) | 445ms | Zero dependency, no API key |

ONNX is slower on ARM64 due to single-core inference. On x86_64 with AVX2/AVX-512, expect significantly lower latency.

## Project Structure

```
msam/
  core.py            # Atom storage, ACT-R retrieval, batch cosine, scoring
  remember.py        # CLI integration (56 commands, confidence gating)
  triples.py         # Knowledge graph, triple extraction, hybrid retrieval
  retrieval_v2.py    # v2 pipeline: beam search, entity roles, quality filter
  subatom.py         # Shannon compression: sentence extraction, dedup
  server.py          # REST API server (FastAPI, 20 endpoints)
  embeddings.py      # Pluggable providers: NIM, OpenAI, ONNX, local
  decay.py           # Lifecycle management, state transitions, forgetting
  metrics.py         # Time-series metrics for Grafana
  api.py             # Grafana JSON datasource API
  prediction.py      # Predictive prefetch engine (3 strategies)
  contradictions.py  # Semantic contradiction detection
  calibration.py     # Cross-provider identity calibration
  consolidation.py   # Sleep-inspired memory consolidation
  forgetting.py      # Intentional forgetting engine (4 signals)
  vector_index.py    # FAISS-backed ANN search
  entity_roles.py    # Entity-aware query scoring
  config.py          # TOML config loader (20+ sections)
  agents.py          # Multi-agent memory isolation and sharing
  annotate.py        # Heuristic annotations (arousal, valence, topics)
  session_dedup.py   # Multi-turn retrieval deduplication
  init_db.py         # Database initialization and migrations
  migrate.py         # Migration tool template
  scripts/           # CLI entrypoints (msam, msam-remember, msam-backup)
  examples/          # quickstart.py, agent_integration.py, synthetic_dataset.py
  benchmarks/        # Reproducible benchmark suite (python -m msam.benchmarks.run)
  tests/             # 437 tests across 25 test files
~/.msam/             # Data directory (created at runtime)
  msam.toml          # Configuration (copy from msam.example.toml)
  msam.db            # Main atom + triple store (SQLite)
  msam_metrics.db    # Metrics time-series (SQLite)
msam.example.toml    # Documented config template
SPEC.md              # Full specification
BENCHMARKS.md        # Production benchmark data
CONTROL-FLOW.md      # Architecture and flow reference
```

## Theoretical Foundation

- **ACT-R** (Anderson, 1993) -- activation-based memory retrieval
- **Ebbinghaus forgetting curve** (1885) -- exponential decay of retrievability
- **Shannon entropy** (1948) -- theoretical compression floor for startup context
- **Maximal Marginal Relevance** (Carbonell & Goldstein, 1998) -- diversity in retrieval
- **Dual-process theory** -- semantic vs. episodic stream separation
- **Metamemory** (Nelson & Narens, 1990) -- monitoring and control of memory

## Roadmap

### Current (2026.02.24)
- **Felt Consequence** -- outcome-attributed memory scoring. Atoms that consistently contribute to good outcomes get boosted; poor outcomes get dampened. Exponential decay on outcome signal so recent feedback matters more. Configurable via `outcome_weight`, `outcome_decay`, `min_outcomes_for_effect`.
- **Predictive Context Assembly** -- pre-loads atoms into session context based on temporal patterns and co-retrieval history. Warmup gate prevents premature predictions. Configurable via `[prediction]` section.
- **Temporal World Model** -- structured knowledge graph with temporal metadata. Triples carry `valid_from`/`valid_until` timestamps. Auto-close previous facts when updating same subject+predicate. Query current state, past state, or full history. Configurable via `[world_model]` section.
- **Sycophancy detection** -- agreement rate tracking with sliding window. Monitors whether the agent over-agrees with the user. Configurable warning threshold and window size via `[sycophancy]` section.
- **Security hardening** -- CORS restricted to localhost by default (configurable via `api.allowed_origins`). Optional API key authentication on the Grafana metrics API (`api.api_key`). FastAPI REST API retains existing `MSAM_API_KEY` env var auth.
- **437-test suite** across 25 test files covering all modules and CLI commands

### Previous (2026.02.23)
- **REST API server** -- language-agnostic HTTP interface (`msam serve`), 20 endpoints covering store/query/context/feedback/decay/stats/triples/contradictions/predict/consolidate/replay/forget/calibrate/re-embed/agents
- **Multi-agent memory protocol** -- agent isolation via `agent_id` column, atom sharing between agents, per-agent statistics
- **Semantic contradiction detection** -- embedding-based detection with negation, temporal supersession, value conflict, and antonym analysis
- **LLM-powered annotation** -- optional slow-path emotion annotation via NVIDIA NIM, graceful fallback to heuristic
- **Predictive prefetch engine** -- 3-strategy prediction (temporal patterns, co-retrieval, topic momentum) replacing the stub implementation
- **Reproducible benchmark suite** -- 100 synthetic atoms, 25 ground truth queries, one-command runner (`python msam/benchmarks/run.py`)
- Confidence-gated retrieval (honest unknown pattern)
- Shannon-compressed context startup (99.3% reduction)
- Adaptive beam search (scales with data, sleeps when small)
- Vectorized batch cosine similarity (~3.7x on ARM64 matmul)
- ONNX Runtime local embeddings (zero API dependency)
- Batch embedding API (up to 50 per request)
- 56-command CLI with help, grep, export/import, serve
- 675+ atoms, 1,500+ triples in production

### Next
- HNSW vector index for O(log n) retrieval at scale (when atom count exceeds ~10k)
- Contribution tracking closed-loop (automatic retrieval-to-decay feedback without explicit marking)
- Cross-agent knowledge discovery (agents surfacing insights from each other's memories)
- WebSocket real-time subscriptions (push notifications on store/decay events)
- Plugin system for custom retrieval strategies
- Async embedding pipeline
- Association chain visualization

## License

MIT. See [LICENSE](LICENSE).
