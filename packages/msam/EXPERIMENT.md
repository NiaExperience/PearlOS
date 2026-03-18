# MSAM Experiment — Phase 1

## What is MSAM?

**Multi-Stream Adaptive Memory** is a cognitive memory architecture for AI agents by [Jaden Schwab](https://github.com/jadenschwab/msam). It provides:

- **Semantic, episodic, procedural, and working memory streams** with ACT-R activation scoring
- **Confidence-gated retrieval** — returns proportional to confidence (high/medium/low/none)
- **Knowledge graph** with subject-predicate-object triples and contradiction detection
- **REST API** with 20 endpoints for language-agnostic integration
- **99.3% token savings** on session startup vs flat file reads
- **Local embeddings** via ONNX Runtime (no API keys required)

## Why We're Trying It

Pearl currently reads memory from markdown files, consuming thousands of tokens per session. MSAM replaces this with semantic retrieval that returns only relevant atoms, saving ~89% tokens per session. If it works well, it becomes the memory backbone for all PearlOS users.

## Setup

### Installation

```bash
cd /workspace/nia-universal/packages/msam
pip install ".[onnx,dev]"
python3 -m msam.init_db
```

### Configuration

Config lives at `~/.msam/msam.toml` (copied from `msam.example.toml`).

Current setup uses **ONNX local embeddings** (BAAI/bge-small-en-v1.5, 384-dim) — no API keys needed.

### Start/Stop the Service

```bash
# Start REST API server (background)
msam serve &

# Health check
curl http://127.0.0.1:3001/v1/health

# Stop
kill $(pgrep -f "msam.server")
```

### Port & Config

| Setting | Value |
|---------|-------|
| REST API port | **3001** |
| Host binding | 127.0.0.1 (localhost only) |
| Embedding provider | ONNX (local, no API key) |
| Embedding model | BAAI/bge-small-en-v1.5 |
| Dimensions | 384 |
| Data directory | ~/.msam/ |
| Config file | ~/.msam/msam.toml |

Ports 18789, 3000, 4444, 8766, 3100, 2000 are reserved by other PearlOS services.

## Smoke Test Results (2026-02-26)

### Test Suite
- **434 passed**, 3 failed (config default mismatches from ONNX vs NIM — expected)
- Test suite covers all 24 modules

### CLI Smoke Test

| Test | Query | Result |
|------|-------|--------|
| Store + retrieve | "What are user's preferences?" | ✅ High confidence, returned "Blair prefers dark mode..." (sim: 0.511) |
| Semantic match | "What is PearlOS?" | ✅ High confidence, returned PearlOS description (sim: 0.655) |
| Entity lookup | "Who is Blair?" | ✅ High confidence, returned Blair's description (sim: 0.639) |
| Unknown topic | "Capital of France?" | ✅ Medium confidence (correctly lower — not stored) |

### REST API Smoke Test
- `GET /v1/health` → ✅ 200 OK
- `POST /v1/query` → ✅ Returns confidence-gated results
- Server starts cleanly on port 3001

### Performance
- Query latency: ~3.1-3.5s (ONNX on x86_64, includes embedding generation)
- Embedding cache brings subsequent queries down significantly
- Token output: 48-68 tokens per query vs thousands from flat files

## Phase 2 Plan — Deep PearlOS Integration

1. **Memory Bridge Service** — Replace Pearl's file-based memory reads (`MEMORY.md`, `memory/*.md`) with MSAM queries at session startup and on-demand
2. **Auto-Ingest Pipeline** — When Pearl writes to daily memory files or MEMORY.md, auto-store atoms in MSAM
3. **Context Injection** — Use `POST /v1/context` for session startup instead of loading full markdown files
4. **Feedback Loop** — When Pearl uses retrieved memories successfully, call `/v1/feedback` to strengthen those atoms
5. **Multi-Agent Support** — Each Pearl instance gets its own agent_id for memory isolation with optional sharing
6. **Decay & Forgetting** — Enable automated decay cycles to keep memory fresh and relevant
7. **Knowledge Graph** — Extract triples from conversations for structured relationship queries
8. **Predictive Prefetch** — Once enough usage patterns exist, enable predictive context assembly

### Integration Points

```
Pearl Session Start
  └→ POST /v1/context (replaces reading MEMORY.md + cross-session-state.md)
  
Pearl Query (mid-session)
  └→ POST /v1/query {"query": "relevant context needed"}
  
Pearl Memory Write
  └→ POST /v1/store {"content": "new memory atom", "agent_id": "pearl-main"}
  
Pearl Response Success
  └→ POST /v1/feedback {"atom_ids": [...], "outcome": "positive"}
```

## Files

- `packages/msam/` — MSAM source (cloned from github.com/jadenschwab/msam)
- `~/.msam/msam.toml` — Runtime configuration
- `~/.msam/db/msam.db` — Memory database (SQLite)
- `~/.msam/db/msam_metrics.db` — Metrics database
