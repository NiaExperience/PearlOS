"""
MSAM Core -- Multi-Stream Adaptive Memory
Proof of Concept Implementation

Storage, retrieval, and activation scoring for memory atoms.
"""

import sqlite3
import json
import math
import time
import hashlib
import os
import struct
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Ensure msam/ is on the path so config is importable when called directly
from .config import get_config as _get_config, get_data_dir as _get_data_dir
_cfg = _get_config()
DB_PATH = _get_data_dir() / _cfg('storage', 'db_path', 'msam.db')
EMBEDDING_DIM = _cfg('embedding', 'dimensions', 1024)

# ─── Schema ───────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS atoms (
    id TEXT PRIMARY KEY,
    schema_version INTEGER DEFAULT 1,
    profile TEXT CHECK(profile IN ('lightweight', 'standard', 'full')) DEFAULT 'standard',
    stream TEXT CHECK(stream IN ('working', 'episodic', 'semantic', 'procedural')) DEFAULT 'semantic',
    
    -- Content
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    
    -- Temporal
    created_at TEXT NOT NULL,
    last_accessed_at TEXT,
    access_count INTEGER DEFAULT 0,
    
    -- Stability (spaced repetition)
    stability REAL DEFAULT 1.0,
    retrievability REAL DEFAULT 1.0,
    
    -- Encoding Context Annotations
    arousal REAL DEFAULT 0.5,           -- 0.0 (calm) to 1.0 (intense)
    valence REAL DEFAULT 0.0,           -- -1.0 (negative) to 1.0 (positive)
    topics TEXT DEFAULT '[]',           -- JSON array of topic strings
    encoding_confidence REAL DEFAULT 0.7,
    provisional INTEGER DEFAULT 0,      -- boolean: 1 = not yet calibrated
    source_type TEXT DEFAULT 'conversation',  -- conversation|inference|correction|external
    
    -- Lifecycle
    state TEXT CHECK(state IN ('active', 'fading', 'dormant', 'tombstone')) DEFAULT 'active',
    
    -- Embedding (stored as blob for efficiency)
    embedding BLOB,
    
    -- Metadata
    metadata TEXT DEFAULT '{}',         -- JSON for extensible fields

    -- Multi-agent
    agent_id TEXT DEFAULT 'default',

    -- Embedding provenance
    embedding_provider TEXT,

    -- Denormalized columns (Phase 1C)
    is_pinned INTEGER DEFAULT 0,
    session_id TEXT,
    working_expires_at REAL
);

CREATE TABLE IF NOT EXISTS atom_topics (
    atom_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    PRIMARY KEY(atom_id, topic),
    FOREIGN KEY (atom_id) REFERENCES atoms(id)
);
CREATE INDEX IF NOT EXISTS idx_atom_topics_topic ON atom_topics(topic);

CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atom_id TEXT NOT NULL,
    accessed_at TEXT NOT NULL,
    activation_score REAL,
    retrieval_mode TEXT,  -- 'task' or 'companion'
    contributed INTEGER DEFAULT -1,  -- -1=unknown, 0=no, 1=yes
    FOREIGN KEY (atom_id) REFERENCES atoms(id)
);

CREATE TABLE IF NOT EXISTS corrections (
    id TEXT PRIMARY KEY,
    original_atom_id TEXT NOT NULL,
    correction_content TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (original_atom_id) REFERENCES atoms(id)
);

CREATE INDEX IF NOT EXISTS idx_atoms_stream ON atoms(stream);
CREATE INDEX IF NOT EXISTS idx_atoms_state ON atoms(state);
CREATE INDEX IF NOT EXISTS idx_atoms_topics ON atoms(topics);
CREATE INDEX IF NOT EXISTS idx_atoms_created ON atoms(created_at);
CREATE INDEX IF NOT EXISTS idx_access_log_atom ON access_log(atom_id);
CREATE INDEX IF NOT EXISTS idx_atoms_agent ON atoms(agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_atoms_dedup ON atoms(content_hash, agent_id) WHERE state IN ('active', 'fading');
"""


# ─── Database ─────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    """Get database connection, creating schema if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA busy_timeout={_cfg('storage', 'db_busy_timeout_ms', 5000)}")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA_SQL)
    return conn


# ─── Embedding ────────────────────────────────────────────────────
# Embedding functions are provided by embeddings.py (pluggable provider).
# Re-exported here for backward compatibility.

from .embeddings import embed_text, embed_query, cached_embed_query as _cached_embed_query_import

# Note: embed_text, embed_query are now imported from embeddings module.
# The cached version is also available:
# cached_embed_query = _cached_embed_query_import
# (kept inline below for LRU cache scope compatibility)

# Legacy stub -- kept for any code that catches the old exception pattern
def _embed_noop():
    pass


def pack_embedding(vec: list[float]) -> bytes:
    """Pack float list to bytes for SQLite storage."""
    return struct.pack(f'{len(vec)}f', *vec)


def unpack_embedding(blob: bytes) -> list[float]:
    """Unpack bytes to float list."""
    n = len(blob) // 4
    return list(struct.unpack(f'{n}f', blob))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    import numpy as np
    a, b = np.array(a), np.array(b)
    dot = np.dot(a, b)
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    return float(dot / norm) if norm > 0 else 0.0


def batch_cosine_similarity(query_emb: list[float], embedding_blobs: list) -> list[float]:
    """Vectorized cosine similarity: one query against many atoms via matrix multiply.
    
    ~58x faster than per-atom loop (116ms -> ~2ms for 735 atoms at 1024-dim).
    None/empty blobs get 0.0 similarity.
    """
    import numpy as np
    if not embedding_blobs:
        return []
    
    q = np.array(query_emb, dtype=np.float32)
    q_norm = np.linalg.norm(q)
    if q_norm == 0:
        return [0.0] * len(embedding_blobs)
    q = q / q_norm
    
    dim = len(query_emb)
    valid_indices = []
    raw_vecs = []
    
    for i, blob in enumerate(embedding_blobs):
        if blob is not None and len(blob) >= dim * 4:
            raw_vecs.append(np.frombuffer(blob, dtype=np.float32))
            valid_indices.append(i)
    
    results = [0.0] * len(embedding_blobs)
    if not raw_vecs:
        return results
    
    # Stack into matrix and compute all similarities at once
    matrix = np.vstack(raw_vecs)  # (N, dim)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0  # avoid division by zero
    matrix = matrix / norms
    sims = matrix @ q  # (N,) -- single matmul
    
    for idx, sim in zip(valid_indices, sims):
        results[idx] = float(sim)
    
    return results


# ─── Atom Operations ─────────────────────────────────────────────

def generate_atom_id(content: str) -> str:
    """Generate deterministic atom ID from content hash + timestamp."""
    ts = datetime.now(timezone.utc).isoformat()
    raw = f"{content}:{ts}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def store_atom(
    content: str,
    stream: str = "semantic",
    profile: str = "standard",
    arousal: float = 0.5,
    valence: float = 0.0,
    topics: list[str] = None,
    encoding_confidence: float = 0.7,
    provisional: bool = False,
    source_type: str = "conversation",
    metadata: dict = None,
    embedding: list[float] = None,
    agent_id: str = "default",
) -> str:
    """Store a new atom. Returns atom ID, or None if budget exhausted."""
    if not content or not content.strip():
        return None
    content = content.strip()
    # Budget-aware storage: check token ceiling before writing
    stats = get_stats()
    _token_budget = _cfg('storage', 'token_budget_ceiling', 40000)
    _refuse_pct = _cfg('storage', 'refuse_threshold_pct', 95)
    _compact_pct = _cfg('storage', 'auto_compact_threshold_pct', 85)
    budget_pct = (stats['est_active_tokens'] / _token_budget) * 100
    if budget_pct > _refuse_pct:
        # Emergency: refuse to store. Decay cycle needed first.
        import logging
        logging.getLogger("msam.core").warning(
            f"store_atom REFUSED: token budget at {budget_pct:.1f}% (>{_refuse_pct}%). "
            f"Run decay cycle to free space."
        )
        return None
    if budget_pct > _compact_pct:
        # Auto-compact: downgrade profile to lightweight regardless of input
        import logging
        logging.getLogger("msam.core").warning(
            f"store_atom AUTO-COMPACT: token budget at {budget_pct:.1f}% (>{_compact_pct}%). "
            f"Forcing profile=lightweight (was {profile})."
        )
        profile = 'lightweight'

    conn = get_db()
    
    atom_id = generate_atom_id(content)
    content_hash = hashlib.sha256(content.encode()).hexdigest()[:32]
    now = datetime.now(timezone.utc).isoformat()
    
    # Content deduplication: atomic INSERT OR IGNORE to avoid TOCTOU race
    # We attempt the insert directly; if a duplicate exists, rowcount == 0.
    
    # Get embedding if not provided
    if embedding is None:
        embedding = embed_text(content)
    
    emb_blob = pack_embedding(embedding)
    
    # Compute denormalized columns
    meta = metadata or {}
    _is_pinned = 1 if meta.get("pinned", False) else 0
    _session_id = meta.get("session_id")
    _working_expires_at = meta.get("working_expires_at")

    _embedding_provider = _cfg('embedding', 'provider', 'nvidia-nim')

    cursor = conn.execute("""
        INSERT OR IGNORE INTO atoms (
            id, profile, stream, content, content_hash, created_at,
            arousal, valence, topics, encoding_confidence, provisional,
            source_type, embedding, metadata, agent_id,
            embedding_provider, is_pinned, session_id, working_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        atom_id, profile, stream, content, content_hash, now,
        arousal, valence, json.dumps(topics or []),
        encoding_confidence, int(provisional), source_type,
        emb_blob, json.dumps(meta), agent_id,
        _embedding_provider, _is_pinned, _session_id, _working_expires_at
    ))

    if cursor.rowcount == 0:
        # Duplicate content_hash in active/fading state -- dedup triggered
        conn.close()
        return None

    # Populate atom_topics junction table
    if topics:
        conn.executemany(
            "INSERT OR IGNORE INTO atom_topics (atom_id, topic) VALUES (?, ?)",
            [(atom_id, t) for t in topics]
        )

    # Update FTS5 index
    try:
        conn.execute(
            "INSERT INTO atoms_fts(rowid, content) SELECT rowid, content FROM atoms WHERE id = ?",
            (atom_id,)
        )
    except Exception:
        pass  # FTS5 table may not exist yet (pre-migration)

    conn.commit()
    conn.close()

    # Invalidate stats cache since atom count changed
    global _stats_cache
    _stats_cache = None

    # Log to metrics
    try:
        from .metrics import log_store
        content_tokens = len(content) // 4
        log_store(atom_id, stream, profile, arousal, valence, source_type, content_tokens)
    except Exception:
        pass  # metrics should never break storage

    # Log topic hits from newly stored atom
    if topics:
        try:
            from .metrics import log_topic_hits
            log_topic_hits(topics, source='store')
        except Exception:
            pass

    # Update FAISS vector index
    try:
        from .vector_index import on_atom_stored
        on_atom_stored(atom_id, emb_blob)
    except Exception:
        pass

    # Fire lifecycle hook
    _fire_hook('on_store', atom_id=atom_id, stream=stream, profile=profile, content_preview=content[:80])

    return atom_id


# ─── Activation Scoring (ACT-R) ──────────────────────────────────

def _sigmoid_boost(x: float, midpoint: float = None, steepness: float = None) -> float:
    """Sigmoid curve for similarity scoring. Suppresses low similarities, amplifies high ones.
    
    At midpoint (default 0.35), output = 0.5.
    Below 0.2, output approaches 0. Above 0.5, output approaches 1.0.
    """
    if midpoint is None:
        midpoint = _cfg('retrieval', 'sigmoid_midpoint', 0.35)
    if steepness is None:
        steepness = _cfg('retrieval', 'sigmoid_steepness', 15.0)
    return 1.0 / (1.0 + math.exp(-steepness * (x - midpoint)))


def compute_activation(atom: dict, query_similarity: float = 0.0, mode: str = "task") -> float:
    """
    Compute activation score using ACT-R formula + MSAM extensions.
    
    base = min(ln(access_count + 1), 3.0) - 0.5 * ln(age_hours + 1)
    similarity = sigmoid_boost(cosine_sim) * spread_weight  [threshold: 0.2]
    annotation_boost = (mode-dependent annotation weighting)
    activation = base + similarity + annotation_boost
    
    v2 changes (2026-02-21):
    - Capped base activation at 3.0 to prevent frequency dominance
    - Replaced linear similarity scaling with sigmoid curve
    - Added similarity threshold at 0.2 (below = zero contribution)
    """
    # Base activation (ACT-R) -- CAPPED to prevent hot-atom dominance
    _base_act_cap = _cfg('retrieval', 'base_activation_cap', 3.0)
    _sim_threshold = _cfg('retrieval', 'similarity_threshold', 0.2)
    access_count = atom.get("access_count", 0)
    created = datetime.fromisoformat(atom["created_at"])
    age_hours = max((datetime.now(timezone.utc) - created).total_seconds() / 3600, 0.01)
    
    base = min(math.log(access_count + 1), _base_act_cap) - 0.5 * math.log(age_hours + 1)
    
    # Similarity component -- sigmoid curve replaces linear scaling
    # Threshold: below similarity_threshold cosine, no similarity contribution (noise floor)
    # Sigmoid amplifies genuine matches (>0.35) and suppresses weak ones
    if query_similarity < _sim_threshold:
        similarity = 0.0
    else:
        similarity = _sigmoid_boost(query_similarity) * 6.0  # max contribution ~6.0
    
    # Annotation boost (mode-dependent)
    arousal = atom.get("arousal", 0.5)
    valence = atom.get("valence", 0.0)
    confidence = atom.get("encoding_confidence", 0.7)
    
    if mode == "companion":
        # Companion mode: boost high-arousal, emotionally significant atoms
        annotation_boost = arousal * 0.8 + abs(valence) * 0.4
    else:
        # Task mode: slight penalty for high arousal (precision-first)
        annotation_boost = confidence * 0.3 - arousal * 0.1
    
    # Stability factor
    stability = atom.get("stability", 1.0)
    retrievability = math.exp(-age_hours / (stability * 168))  # 168 = hours in a week
    stability_factor = retrievability * 0.3
    
    # Provisional penalty
    if atom.get("provisional"):
        annotation_boost -= 0.2

    # Outcome attribution (Felt Consequence)
    outcome_weight = _cfg('retrieval', 'outcome_weight', 0.15)
    min_outcomes = _cfg('retrieval', 'min_outcomes_for_effect', 3)
    outcome_count = atom.get("outcome_count", 0)
    outcome_score_val = atom.get("outcome_score", 0.0)
    outcome_bonus = 0.0
    if outcome_count >= min_outcomes:
        normalized = max(-5.0, min(5.0, outcome_score_val)) / max(outcome_count, 1)
        outcome_bonus = outcome_weight * normalized

    return base + similarity + annotation_boost + stability_factor + outcome_bonus


# ─── Spreading Activation ─────────────────────────────────────────

def _spread_activation(conn, initial_atoms: list[dict], top_k: int, mode: str) -> list[dict]:
    """Boost activation of co-retrieval neighbors and triple-linked atoms.

    Implements associative spreading: when atom A is retrieved, atoms
    frequently co-retrieved with A (from co_retrieval table) and atoms
    linked via atom_relations get an activation boost that decays with distance.

    Returns the expanded set of atoms (initial + spread candidates), sorted
    by activation. Does NOT modify the initial atoms' scores.
    """
    spread_decay = _cfg('retrieval', 'spread_decay_factor', 0.3)

    if not initial_atoms:
        return initial_atoms

    # Collect candidate IDs and their boost scores
    boost_map = {}  # atom_id -> boost_score

    for atom in initial_atoms[:top_k]:
        atom_id = atom["id"]
        atom_activation = atom.get("_activation", 0)

        # 1. Co-retrieval neighbors (from co_retrieval table)
        try:
            partners = conn.execute("""
                SELECT CASE WHEN atom_a = ? THEN atom_b ELSE atom_a END AS partner_id, co_count
                FROM co_retrieval WHERE (atom_a = ? OR atom_b = ?) AND co_count >= 2
                ORDER BY co_count DESC LIMIT 5
            """, (atom_id, atom_id, atom_id)).fetchall()

            for row in partners:
                partner_id = row[0]
                co_count = row[1]
                # Boost proportional to source activation, decayed
                boost = atom_activation * spread_decay * min(co_count / 10.0, 1.0)
                if partner_id not in boost_map or boost > boost_map[partner_id]:
                    boost_map[partner_id] = boost
        except Exception:
            pass

        # 2. Triple-linked atoms (from atom_relations)
        try:
            relations = conn.execute("""
                SELECT target_id FROM atom_relations
                WHERE source_id = ? AND relation_type IN ('elaborates', 'supports', 'contextualizes', 'consolidated_into')
            """, (atom_id,)).fetchall()

            for rel in relations:
                target_id = rel[0]
                boost = atom_activation * spread_decay * 0.5  # weaker than co-retrieval
                if target_id not in boost_map or boost > boost_map[target_id]:
                    boost_map[target_id] = boost
        except Exception:
            pass

    # Remove IDs already in initial set
    initial_ids = {a["id"] for a in initial_atoms}
    new_ids = [aid for aid in boost_map if aid not in initial_ids]

    if not new_ids:
        return initial_atoms

    # Load metadata for new candidates
    placeholders = ','.join(['?'] * len(new_ids))
    new_rows = conn.execute(
        f"SELECT * FROM atoms WHERE id IN ({placeholders}) AND state IN ('active', 'fading')",
        new_ids
    ).fetchall()

    expanded = list(initial_atoms)
    for row in new_rows:
        atom = dict(row)
        boost = boost_map.get(atom["id"], 0)
        # Compute base activation (no query similarity for spread atoms)
        base_activation = compute_activation(atom, query_similarity=0, mode=mode)
        atom["_activation"] = base_activation + boost
        atom["_similarity"] = 0.0
        atom["_spread_boost"] = round(boost, 3)
        atom.pop("embedding", None)
        expanded.append(atom)

    # Re-sort by activation
    expanded.sort(key=lambda x: x["_activation"], reverse=True)
    return expanded[:top_k]


# ─── Retrieval ────────────────────────────────────────────────────

def retrieve(
    query: str,
    mode: str = "task",
    top_k: int = None,
    stream: str = None,
    min_activation: float = -2.0,
    topic_filter: list[str] = None,
    since: str = None,
    before: str = None,
    explain: bool = False,
    agent_id: str = None,
) -> list[dict]:
    """
    Hybrid retrieval: embedding similarity + activation scoring.
    
    1. Get query embedding
    2. Compute cosine similarity against all active atoms
    3. Compute activation score (ACT-R + annotations + similarity)
    4. Return top-k by activation score
    
    Temporal filtering:
        since: ISO datetime string -- only atoms created after this time
        before: ISO datetime string -- only atoms created before this time
    
    Explanation:
        explain: if True, attach _explanation dict with score breakdown
    """
    if top_k is None:
        top_k = _cfg('retrieval', 'default_top_k', 12)
    conn = get_db()
    
    # Build query with temporal filters
    if topic_filter:
        # Use atom_topics junction table for efficient topic filtering
        placeholders = ','.join(['?'] * len(topic_filter))
        sql = f"""SELECT DISTINCT a.* FROM atoms a
                  JOIN atom_topics at ON a.id = at.atom_id
                  WHERE a.state IN ('active', 'fading')
                  AND at.topic IN ({placeholders})"""
        params = list(topic_filter)
    else:
        sql = "SELECT * FROM atoms WHERE state IN ('active', 'fading')"
        params = []

    if agent_id:
        sql += " AND a.agent_id IN (?, 'shared')" if topic_filter else " AND agent_id IN (?, 'shared')"
        params.append(agent_id)

    if stream:
        sql += " AND a.stream = ?" if topic_filter else " AND stream = ?"
        params.append(stream)

    if since:
        sql += " AND a.created_at >= ?" if topic_filter else " AND created_at >= ?"
        params.append(since)

    if before:
        sql += " AND a.created_at <= ?" if topic_filter else " AND created_at <= ?"
        params.append(before)

    # Get query embedding (cached)
    query_emb = cached_embed_query(query)

    # Try FAISS fast path first (when no complex SQL filters)
    _use_faiss = not topic_filter and not stream and not since and not before and not agent_id
    if _use_faiss:
        try:
            from .vector_index import faiss_search_atoms, FAISS_AVAILABLE
            if FAISS_AVAILABLE:
                candidates = faiss_search_atoms(query_emb, top_k=top_k * 3, conn=conn)
                if candidates:
                    candidate_ids = [c[0] for c in candidates]
                    sim_map = {c[0]: c[1] for c in candidates}
                    placeholders = ','.join(['?'] * len(candidate_ids))
                    rows = conn.execute(
                        f"SELECT * FROM atoms WHERE id IN ({placeholders}) AND state IN ('active', 'fading')",
                        candidate_ids
                    ).fetchall()

                    scored = []
                    for row in rows:
                        atom = dict(row)
                        sim = sim_map.get(atom["id"], 0.0)
                        activation = compute_activation(atom, query_similarity=sim, mode=mode)
                        if activation >= min_activation:
                            atom["_activation"] = activation
                            atom["_similarity"] = sim
                            if explain:
                                atom["_explanation"] = _explain_activation(atom, sim, mode)
                            atom.pop("embedding", None)
                            scored.append(atom)

                    conn.close()
                    scored.sort(key=lambda x: x["_activation"], reverse=True)
                    results = scored[:top_k]
                    _fire_hook('on_retrieve', query=query, mode=mode, result_count=len(results))
                    _log_access(results, mode)
                    return results
        except Exception:
            pass  # Fall through to brute-force

    rows = conn.execute(sql, params).fetchall()

    if not rows:
        conn.close()
        return []

    # Batch cosine similarity: vectorized matmul instead of per-atom loop
    atoms = [dict(row) for row in rows]
    embedding_blobs = [a["embedding"] for a in atoms]
    similarities = batch_cosine_similarity(query_emb, embedding_blobs)

    # Score all atoms
    scored = []
    for i, atom in enumerate(atoms):
        sim = similarities[i]

        # Activation with explanation
        activation = compute_activation(atom, query_similarity=sim, mode=mode)
        
        if activation >= min_activation:
            atom["_activation"] = activation
            atom["_similarity"] = sim
            
            # Retrieval explanation
            if explain:
                atom["_explanation"] = _explain_activation(atom, sim, mode)
            
            # Don't return embedding blob
            atom.pop("embedding", None)
            scored.append(atom)
    
    # Sort by activation, return top-k
    scored.sort(key=lambda x: x["_activation"], reverse=True)
    results = scored[:top_k]

    # Spreading activation: boost co-retrieved and linked atoms
    if _cfg('retrieval', 'spreading_activation_enabled', True) and results:
        try:
            results = _spread_activation(conn, results, top_k, mode)
        except Exception:
            pass  # spreading activation should never break retrieval

    conn.close()

    # Fire lifecycle hook
    _fire_hook('on_retrieve', query=query, mode=mode, result_count=len(results))

    # Log access
    _log_access(results, mode)

    return results


# ─── Retrieval Explanation ─────────────────────────────────────────

def _explain_activation(atom: dict, query_similarity: float, mode: str) -> dict:
    """Break down why this atom scored the way it did.
    
    Returns a human-readable explanation of each scoring factor.
    The agent uses this for debugging retrieval quality.
    """
    access_count = atom.get("access_count", 0)
    created = datetime.fromisoformat(atom["created_at"])
    age_hours = max((datetime.now(timezone.utc) - created).total_seconds() / 3600, 0.01)
    
    # Base
    base_raw = math.log(access_count + 1)
    base_capped = min(base_raw, 3.0)
    age_penalty = 0.5 * math.log(age_hours + 1)
    base = base_capped - age_penalty
    
    # Similarity
    if query_similarity < 0.2:
        sim_contribution = 0.0
        sim_note = f"below threshold (raw={query_similarity:.3f}, threshold=0.2)"
    else:
        sigmoid_val = _sigmoid_boost(query_similarity)
        sim_contribution = sigmoid_val * 6.0
        sim_note = f"raw={query_similarity:.3f} -> sigmoid={sigmoid_val:.3f} -> weighted={sim_contribution:.3f}"
    
    # Annotation
    arousal = atom.get("arousal", 0.5)
    valence = atom.get("valence", 0.0)
    confidence = atom.get("encoding_confidence", 0.7)
    
    if mode == "companion":
        annotation = arousal * 0.8 + abs(valence) * 0.4
        annotation_note = f"companion: arousal({arousal:.2f})*0.8 + |valence({valence:.2f})|*0.4"
    else:
        annotation = confidence * 0.3 - arousal * 0.1
        annotation_note = f"task: confidence({confidence:.2f})*0.3 - arousal({arousal:.2f})*0.1"
    
    # Stability
    stability = atom.get("stability", 1.0)
    retrievability = math.exp(-age_hours / (stability * 168))
    stability_factor = retrievability * 0.3
    
    return {
        "total": round(base + sim_contribution + annotation + stability_factor, 3),
        "base": {"value": round(base, 3), 
                 "detail": f"min(ln({access_count}+1), 3.0)={base_capped:.2f} - 0.5*ln({age_hours:.1f}h+1)={age_penalty:.2f}"},
        "similarity": {"value": round(sim_contribution, 3), "detail": sim_note},
        "annotation": {"value": round(annotation, 3), "detail": annotation_note},
        "stability": {"value": round(stability_factor, 3),
                      "detail": f"retrievability={retrievability:.3f} (stability={stability:.1f}, age={age_hours:.1f}h)"},
    }


# ─── Lifecycle Hooks ──────────────────────────────────────────────

_lifecycle_hooks = {
    'on_store': [],
    'on_retrieve': [],
    'on_decay': [],
    'on_expire': [],
    'on_correct': [],
    'on_promote': [],
}
_hooks_lock = threading.Lock()


def register_hook(event: str, callback):
    """Register a callback for a lifecycle event. Thread-safe.

    Events: on_store, on_retrieve, on_decay, on_expire, on_correct, on_promote
    Callback receives **kwargs with event-specific data.

    The agent uses this to react to MSAM events without polling.
    """
    with _hooks_lock:
        if event not in _lifecycle_hooks:
            raise ValueError(f"Unknown event: {event}. Available: {list(_lifecycle_hooks.keys())}")
        _lifecycle_hooks[event].append(callback)


def unregister_hook(event: str, callback):
    """Remove a lifecycle hook. Thread-safe."""
    with _hooks_lock:
        if event in _lifecycle_hooks and callback in _lifecycle_hooks[event]:
            _lifecycle_hooks[event].remove(callback)


def _fire_hook(event: str, **kwargs):
    """Fire all registered hooks for an event. Failures are logged but don't propagate."""
    with _hooks_lock:
        callbacks = list(_lifecycle_hooks.get(event, []))
    for cb in callbacks:
        try:
            cb(**kwargs)
        except Exception as e:
            import logging
            logging.getLogger("msam.hooks").warning(f"Hook {event} failed: {e}")


def _log_access(atoms: list[dict], mode: str):
    """Log retrieval access for stability updates."""
    conn = get_db()
    now = datetime.now(timezone.utc).isoformat()
    
    for atom in atoms:
        conn.execute(
            "INSERT INTO access_log (atom_id, accessed_at, activation_score, retrieval_mode) VALUES (?, ?, ?, ?)",
            (atom["id"], now, atom.get("_activation", 0), mode)
        )
        # Update access count and last_accessed (cap stability to prevent runaway)
        _access_boost = _cfg('decay', 'stability_boost_factor', 1.1)
        _max_stability = _cfg('decay', 'max_stability', 10.0)
        conn.execute(
            "UPDATE atoms SET access_count = access_count + 1, last_accessed_at = ?, stability = MIN(stability * ?, ?) WHERE id = ?",
            (now, _access_boost, _max_stability, atom["id"])
        )
    
    conn.commit()
    conn.close()


# ─── Keyword Search (BM25-lite) ──────────────────────────────────

_STOPWORDS = frozenset({
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
    'its', 'it', 'he', 'she', 'they', 'we', 'you', 'i', 'me', 'my',
    'your', 'his', 'her', 'our', 'their', 'this', 'that', 'these', 'those',
    'what', 'which', 'who', 'whom', 'whose', 'any', 'also', 'get', 'got',
})


def _fts5_query(text: str) -> str:
    """Convert natural language text to FTS5 OR-joined query with stopword removal."""
    raw_terms = text.lower().split()
    terms = [t for t in raw_terms if t not in _STOPWORDS and len(t) > 2]
    if not terms:
        terms = [t for t in raw_terms if len(t) > 2]
    if not terms:
        return text.lower()
    # Escape special FTS5 characters and join with OR
    safe_terms = []
    for t in terms:
        # Remove FTS5 operators/special chars
        t = t.replace('"', '').replace('*', '').replace('-', '').replace('+', '')
        if t:
            safe_terms.append(f'"{t}"')
    return " OR ".join(safe_terms) if safe_terms else text.lower()


def keyword_search(query: str, top_k: int = None) -> list[dict]:
    """Keyword matching using FTS5 BM25 scoring, falling back to Python TF-IDF."""
    if top_k is None:
        top_k = _cfg('retrieval', 'keyword_top_k', 10)
    conn = get_db()

    # Try FTS5 first (fast path)
    fts_query = _fts5_query(query)
    try:
        rows = conn.execute("""
            SELECT a.*, bm25(atoms_fts) as _bm25
            FROM atoms_fts f JOIN atoms a ON a.rowid = f.rowid
            WHERE atoms_fts MATCH ? AND a.state IN ('active', 'fading')
            ORDER BY bm25(atoms_fts) LIMIT ?
        """, (fts_query, top_k)).fetchall()

        scored = []
        for row in rows:
            atom = dict(row)
            # BM25 returns negative scores (lower = better match), normalize
            atom["_keyword_score"] = -atom.pop("_bm25", 0) * 100
            atom.pop("embedding", None)
            scored.append(atom)
        conn.close()
        return scored
    except Exception:
        pass  # FTS5 table may not exist yet -- fall back to Python TF-IDF

    # Fallback: Python TF-IDF (for pre-migration DBs)
    raw_terms = query.lower().split()
    terms = [t for t in raw_terms if t not in _STOPWORDS and len(t) > 2]
    if not terms:
        terms = [t for t in raw_terms if len(t) > 2]

    rows = conn.execute(
        "SELECT * FROM atoms WHERE state IN ('active', 'fading')"
    ).fetchall()

    doc_count = len(rows)
    term_doc_freq = {}
    for term in terms:
        count = 0
        for row in rows:
            if term in dict(row)["content"].lower():
                count += 1
        term_doc_freq[term] = count

    term_idf = {}
    for term in terms:
        df = term_doc_freq.get(term, 0)
        term_idf[term] = math.log(doc_count / (df + 1)) + 1.0 if df > 0 else 0

    scored = []
    for row in rows:
        atom = dict(row)
        content_lower = atom["content"].lower()
        topics = json.loads(atom.get("topics", "[]"))
        topics_lower = " ".join(topics).lower()

        score = 0
        content_words = max(len(content_lower.split()), 20)
        matched_terms = 0
        for term in terms:
            tf = content_lower.count(term)
            if tf > 0:
                tf_norm = 1 + math.log(tf)
                score += tf_norm * term_idf.get(term, 1.0)
                matched_terms += 1
            if term in topics_lower:
                score += 2 * term_idf.get(term, 1.0)

        if len(terms) > 1 and matched_terms > 1:
            coverage = matched_terms / len(terms)
            score *= (1 + coverage * 0.5)

        score = (score / content_words) * 100

        if score > 0:
            atom["_keyword_score"] = score
            atom.pop("embedding", None)
            scored.append(atom)

    conn.close()
    scored.sort(key=lambda x: x["_keyword_score"], reverse=True)
    return scored[:top_k]


# ─── Hybrid Retrieval ────────────────────────────────────────────

def hybrid_retrieve(
    query: str,
    mode: str = "task",
    top_k: int = 12,
    stream: str = None,
    topic_filter: list[str] = None,
    agent_id: str = None,
) -> list[dict]:
    """
    Combine semantic retrieval + keyword search.
    Semantic results weighted 0.7, keyword results weighted 0.3.
    Deduplicate by atom ID, take highest combined score.
    """
    start_time = time.time()

    if not query or not query.strip():
        return []

    _sem_weight = _cfg('retrieval', 'semantic_weight', 0.7)
    _kw_weight = 1.0 - _sem_weight
    _quality_threshold = _cfg('retrieval', 'quality_threshold', 2.0)
    semantic_results = retrieve(query, mode=mode, top_k=top_k * 2, stream=stream, topic_filter=topic_filter, agent_id=agent_id)
    kw_results = keyword_search(query, top_k=top_k)
    
    combined = {}
    
    # Score semantic results at full activation (not downweighted)
    for atom in semantic_results:
        aid = atom["id"]
        combined[aid] = atom
        combined[aid]["_combined_score"] = atom.get("_activation", 0)
    
    # Keyword results get a bonus on top if they overlap, or standalone score if not
    for atom in kw_results:
        aid = atom["id"]
        kw_bonus = atom.get("_keyword_score", 0) * _kw_weight
        if aid in combined:
            # Multi-signal bonus: found by both semantic AND keyword
            combined[aid]["_combined_score"] += kw_bonus
        else:
            combined[aid] = atom
            combined[aid]["_combined_score"] = kw_bonus
    
    results = sorted(combined.values(), key=lambda x: x["_combined_score"], reverse=True)
    results = results[:top_k]

    # Confidence tier classification
    # Uses TWO signals: max semantic similarity (primary) and combined score (secondary)
    # Similarity is the strongest signal -- keyword-only hits with zero similarity = noise
    # Temporal queries get stricter thresholds -- "right now" needs recent atoms
    _sim_high = _cfg('retrieval', 'confidence_sim_high', 0.45)
    _sim_medium = _cfg('retrieval', 'confidence_sim_medium', 0.30)
    _sim_low = _cfg('retrieval', 'confidence_sim_low', 0.15)
    _score_high = _cfg('retrieval', 'confidence_score_high', 40.0)
    _score_medium = _cfg('retrieval', 'confidence_score_medium', 10.0)

    # Temporal query detection: if query asks about "now/today/currently/this session",
    # demote results that aren't from the last 24 hours
    _temporal_markers = {'right now', 'today', 'currently', 'this session', 'just now',
                         'this morning', 'tonight', 'earlier today', 'recent'}
    query_lower = query.lower()
    is_temporal_query = any(marker in query_lower for marker in _temporal_markers)

    if is_temporal_query and results:
        now = datetime.now(timezone.utc)
        recent_cutoff_hours = _cfg('retrieval', 'temporal_recency_hours', 24)
        has_recent = False
        for r in results[:5]:  # check top 5
            try:
                created = datetime.fromisoformat(r['created_at'])
                age_hours = (now - created).total_seconds() / 3600
                if age_hours <= recent_cutoff_hours and r.get('_similarity', 0) >= _sim_medium:
                    has_recent = True
                    break
            except (ValueError, KeyError):
                pass
        if not has_recent:
            # Temporal query but no recent relevant atoms -- cap at low
            for r in results:
                r['_temporal_demoted'] = True

    if not results:
        confidence_tier = "none"
    else:
        max_sim = max(r.get('_similarity', 0) for r in results)
        top_score = results[0].get('_combined_score', 0)

        # Similarity is authoritative. Score-only tiers require minimum similarity
        # to prevent keyword-only noise from inflating confidence.
        has_semantic_signal = max_sim >= 0.20
        temporal_capped = is_temporal_query and results[0].get('_temporal_demoted', False)

        if temporal_capped:
            # Temporal query with no recent relevant atoms -- cap at low
            confidence_tier = "low"
        elif max_sim >= _sim_high or (has_semantic_signal and top_score >= _score_high):
            confidence_tier = "high"
        elif max_sim >= _sim_medium or (has_semantic_signal and top_score >= _score_medium):
            confidence_tier = "medium"
        elif max_sim >= _sim_low:
            confidence_tier = "low"
        else:
            confidence_tier = "none"

    # Attach tier to each result
    for r in results:
        sim = r.get('_similarity', 0)
        score = r.get('_combined_score', 0)
        has_sig = sim >= 0.20
        if r.get('_temporal_demoted', False):
            r['_confidence_tier'] = 'low'  # temporal query, stale atom
        elif sim >= _sim_high or (has_sig and score >= _score_high):
            r['_confidence_tier'] = 'high'
        elif sim >= _sim_medium or (has_sig and score >= _score_medium):
            r['_confidence_tier'] = 'medium'
        else:
            r['_confidence_tier'] = 'low'

    # Store top-level tier on first result
    if results:
        results[0]['_retrieval_confidence_tier'] = confidence_tier
    
    # Retrieval miss detection
    if results:
        top_score = results[0].get('_combined_score', 0)
        if top_score < _quality_threshold:
            try:
                from .metrics import log_retrieval_miss
                log_retrieval_miss(query, mode, top_score)
            except Exception:
                pass

    # Topic hit logging
    all_topics = set()
    for r in results:
        topics = json.loads(r.get('topics', '[]')) if isinstance(r.get('topics'), str) else r.get('topics', [])
        all_topics.update(topics)
    if all_topics:
        try:
            from .metrics import log_topic_hits
            log_topic_hits(list(all_topics), source='retrieval')
        except Exception:
            pass

    # Track temporal patterns for predictive context
    try:
        from .prediction import track_temporal_pattern
        result_ids = [r["id"] for r in results[:8]]
        track_temporal_pattern(result_ids)
    except Exception:
        pass

    # Log metrics
    latency_ms = (time.time() - start_time) * 1000
    try:
        from .metrics import log_retrieval
        log_retrieval(query, mode, results, latency_ms)
    except Exception:
        pass  # metrics logging should never break retrieval

    return results


# ─── Stats ────────────────────────────────────────────────────────

_stats_cache = None
_stats_cache_time = 0
_STATS_CACHE_TTL = 5  # seconds


def get_stats() -> dict:
    """Get database statistics. Cached with 5-second TTL."""
    global _stats_cache, _stats_cache_time
    now = time.time()
    if _stats_cache is not None and (now - _stats_cache_time) < _STATS_CACHE_TTL:
        return _stats_cache

    conn = get_db()

    total = conn.execute("SELECT COUNT(*) FROM atoms").fetchone()[0]
    active = conn.execute("SELECT COUNT(*) FROM atoms WHERE state = 'active'").fetchone()[0]
    by_stream = {
        row[0]: row[1]
        for row in conn.execute("SELECT stream, COUNT(*) FROM atoms GROUP BY stream").fetchall()
    }
    by_profile = {
        row[0]: row[1]
        for row in conn.execute("SELECT profile, COUNT(*) FROM atoms GROUP BY profile").fetchall()
    }
    total_accesses = conn.execute("SELECT COUNT(*) FROM access_log").fetchone()[0]
    avg_activation = conn.execute("SELECT AVG(activation_score) FROM access_log").fetchone()[0]

    # Token estimation
    total_content_chars = conn.execute("SELECT COALESCE(SUM(LENGTH(content)), 0) FROM atoms WHERE state = 'active'").fetchone()[0]
    est_tokens = total_content_chars // 4  # rough chars-to-tokens

    conn.close()

    result = {
        "total_atoms": total,
        "active_atoms": active,
        "by_stream": dict(by_stream),
        "by_profile": dict(by_profile),
        "total_accesses": total_accesses,
        "avg_activation": round(avg_activation, 3) if avg_activation else 0,
        "est_active_tokens": est_tokens,
        "db_size_kb": round(DB_PATH.stat().st_size / 1024, 1) if DB_PATH.exists() else 0,
    }
    _stats_cache = result
    _stats_cache_time = now
    return result


# ─── Feature: Working Memory Tier ────────────────────────────────

def store_working(content: str, session_id: str = None, ttl_minutes: int = None,
                  **kwargs) -> str:
    """Store a working memory atom (session-scoped, auto-expires).
    
    Working atoms live for the duration of a session or ttl_minutes,
    whichever comes first. They are automatically tombstoned by
    expire_working_memory().
    
    Use for: conversation state, retrieved context tracking, 
    temporary scratchpad, in-flight task state.
    """
    if ttl_minutes is None:
        ttl_minutes = _cfg('working_memory', 'default_ttl_minutes', 120)
    metadata = kwargs.pop('metadata', {}) or {}
    metadata['session_id'] = session_id or f"session_{int(time.time())}"
    metadata['ttl_minutes'] = ttl_minutes
    metadata['working_expires_at'] = (
        datetime.now(timezone.utc).timestamp() + (ttl_minutes * 60)
    )
    
    return store_atom(
        content=content,
        stream='working',
        profile='lightweight',  # working memory is always lightweight
        metadata=metadata,
        **kwargs,
    )


def expire_working_memory(session_id: str = None) -> dict:
    """Tombstone expired working memory atoms.

    If session_id is provided, expire all working atoms for that session.
    Otherwise, expire all working atoms past their TTL.

    Atoms with high access counts (>3) are promoted to episodic instead
    of tombstoned -- they proved useful enough to keep.
    """
    conn = get_db()
    now = datetime.now(timezone.utc).timestamp()

    if session_id:
        # Expire all atoms for this session -- use denormalized session_id column
        rows = conn.execute("""
            SELECT id, content, access_count, metadata FROM atoms
            WHERE stream = 'working' AND state = 'active' AND session_id = ?
        """, (session_id,)).fetchall()
        targets = [dict(r) for r in rows]
    else:
        # Expire atoms past TTL -- use denormalized working_expires_at column
        rows = conn.execute("""
            SELECT id, content, access_count, metadata FROM atoms
            WHERE stream = 'working' AND state = 'active'
              AND working_expires_at IS NOT NULL AND working_expires_at < ?
        """, (now,)).fetchall()
        targets = [dict(r) for r in rows]

    tombstoned = 0
    promoted = 0

    _promotion_threshold = _cfg('working_memory', 'promotion_threshold', 3)
    for atom in targets:
        if atom['access_count'] > _promotion_threshold:
            # Promote to episodic -- this working memory proved valuable
            meta = json.loads(atom['metadata'] or '{}')
            meta['promoted_from'] = 'working'
            conn.execute(
                "UPDATE atoms SET stream = 'episodic', metadata = ? WHERE id = ?",
                (json.dumps(meta), atom['id'])
            )
            _fire_hook('on_promote', atom_id=atom['id'], from_stream='working', to_stream='episodic')
            promoted += 1
        else:
            conn.execute("UPDATE atoms SET state = 'tombstone' WHERE id = ?", (atom['id'],))
            _fire_hook('on_expire', atom_id=atom['id'], stream='working')
            tombstoned += 1

    conn.commit()
    conn.close()

    return {"tombstoned": tombstoned, "promoted_to_episodic": promoted}


# ─── Feature: Metamemory ─────────────────────────────────────────

def metamemory_query(topic: str) -> dict:
    """'What do I know about X, and how confident am I?'
    
    Returns a coverage assessment, not atoms. The agent uses this to decide:
    retrieve (high coverage) vs search (low coverage) vs ask (no coverage).
    
    Output:
    {
        "topic": "anime",
        "coverage": "high",           # high/medium/low/none
        "confidence": 0.82,           # weighted by evidence + recency
        "atom_count": 12,
        "triple_count": 34,
        "newest": "2026-02-21T...",
        "oldest": "2026-02-20T...",
        "avg_age_hours": 24.5,
        "streams": {"semantic": 8, "episodic": 3, "procedural": 1},
        "sources": {"conversation": 10, "external": 2},
        "recommendation": "retrieve"  # retrieve/search/ask
    }
    """
    conn = get_db()
    
    topic_lower = topic.lower()
    
    # Find atoms matching this topic via semantic similarity + keyword fallback
    all_atoms = conn.execute("""
        SELECT id, content, topics, stream, source_type, encoding_confidence,
               created_at, access_count, arousal, valence, embedding
        FROM atoms WHERE state IN ('active', 'fading') AND embedding IS NOT NULL
    """).fetchall()
    
    # Semantic matching: embed the topic query and find similar atoms
    _sim_threshold = _cfg('retrieval', 'similarity_threshold', 0.2)
    metamemory_threshold = max(_sim_threshold + 0.12, 0.32)  # above retrieval threshold, balanced to avoid false positives
    
    try:
        topic_emb = embed_query(topic)
        use_semantic = True
    except Exception:
        topic_emb = None
        use_semantic = False
    
    matching = []
    for a in all_atoms:
        topics_list = json.loads(a['topics']) if a['topics'] else []
        topic_match = any(topic_lower in t.lower() for t in topics_list)
        content_match = topic_lower in a['content'].lower()
        
        # Semantic similarity check
        semantic_match = False
        if use_semantic and a['embedding']:
            atom_emb = unpack_embedding(a['embedding'])
            sim = cosine_similarity(topic_emb, atom_emb)
            semantic_match = sim >= metamemory_threshold
        
        if topic_match or content_match or semantic_match:
            matching.append(dict(a))
    
    # Find matching triples
    try:
        import sqlite3 as _sql
        triple_count = conn.execute("""
            SELECT COUNT(*) FROM triples WHERE state = 'active'
            AND (LOWER(subject) LIKE ? OR LOWER(object) LIKE ? OR LOWER(predicate) LIKE ?)
        """, (f"%{topic_lower}%", f"%{topic_lower}%", f"%{topic_lower}%")).fetchone()[0]
    except Exception:
        triple_count = 0
    
    conn.close()
    
    if not matching:
        return {
            "topic": topic,
            "coverage": "none",
            "confidence": 0.0,
            "atom_count": 0,
            "triple_count": triple_count,
            "recommendation": "ask",
        }
    
    # Compute confidence: weighted by encoding_confidence, recency, and evidence count
    now = datetime.now(timezone.utc)
    total_confidence = 0
    ages_hours = []
    streams = {}
    sources = {}
    
    for a in matching:
        # Recency weight: atoms from today worth more than week-old
        created = datetime.fromisoformat(a['created_at'])
        age_hours = max((now - created).total_seconds() / 3600, 0.01)
        ages_hours.append(age_hours)
        recency_weight = 1.0 / (1.0 + math.log(1 + age_hours / 24))  # decays with days
        
        # Evidence weight: accessed more = more confirmed
        evidence_weight = min(1.0, 0.5 + a['access_count'] * 0.1)
        
        atom_conf = a['encoding_confidence'] * recency_weight * evidence_weight
        total_confidence += atom_conf
        
        streams[a['stream']] = streams.get(a['stream'], 0) + 1
        sources[a['source_type']] = sources.get(a['source_type'], 0) + 1
    
    avg_confidence = total_confidence / len(matching)
    
    # Coverage classification
    # Uses atom count AND confidence, but confidence thresholds are calibrated
    # to production reality: atoms 1-7 days old with 0.5-0.7 encoding_confidence
    # produce avg_confidence of 0.10-0.20. Thresholds reflect this.
    atom_count = len(matching)
    if atom_count >= 8 and avg_confidence > 0.12:
        coverage = "high"
    elif atom_count >= 3 and avg_confidence > 0.08:
        coverage = "medium"
    elif atom_count >= 1 and avg_confidence > 0.03:
        coverage = "low"
    else:
        coverage = "none"
    
    # Recommendation for the agent
    if coverage == "high":
        recommendation = "retrieve"  # enough knowledge, just retrieve
    elif coverage == "medium":
        recommendation = "retrieve"  # retrieve, sufficient for most uses
    elif coverage == "low":
        recommendation = "search"  # not enough knowledge, search externally
    else:
        recommendation = "ask"  # no knowledge, ask the user
    
    dates = [a['created_at'] for a in matching]
    
    return {
        "topic": topic,
        "coverage": coverage,
        "confidence": round(avg_confidence, 3),
        "atom_count": atom_count,
        "triple_count": triple_count,
        "newest": max(dates),
        "oldest": min(dates),
        "avg_age_hours": round(sum(ages_hours) / len(ages_hours), 1),
        "streams": streams,
        "sources": sources,
        "recommendation": recommendation,
    }


# ─── Feature: Emotional Drift Detection ──────────────────────────

def emotional_drift(entity_or_topic: str, window_days: int = 7) -> dict:
    """Detect how emotional associations with an entity/topic have changed over time.
    
    Compares emotional annotations across time windows for atoms 
    mentioning the given entity or topic.
    
    Returns:
    {
        "entity": "sub-agents",
        "windows": [
            {"period": "early", "avg_arousal": 0.3, "avg_valence": -0.2, "count": 4},
            {"period": "recent", "avg_arousal": 0.6, "avg_valence": 0.4, "count": 6},
        ],
        "drift": {
            "arousal_delta": +0.3,
            "valence_delta": +0.6,
            "direction": "warming",  # warming/cooling/intensifying/calming/stable
        }
    }
    """
    conn = get_db()
    topic_lower = entity_or_topic.lower()
    
    all_atoms = conn.execute("""
        SELECT content, topics, arousal, valence, created_at
        FROM atoms WHERE state IN ('active', 'fading')
        ORDER BY created_at ASC
    """).fetchall()
    conn.close()
    
    # Filter to matching atoms
    matching = []
    for a in all_atoms:
        topics_list = json.loads(a['topics']) if a['topics'] else []
        topic_match = any(topic_lower in t.lower() for t in topics_list)
        content_match = topic_lower in a['content'].lower()
        if topic_match or content_match:
            matching.append(dict(a))
    
    if len(matching) < 2:
        return {
            "entity": entity_or_topic,
            "windows": [],
            "drift": {"arousal_delta": 0, "valence_delta": 0, "direction": "insufficient_data"},
            "atom_count": len(matching),
        }
    
    # Split into early half and recent half
    mid = len(matching) // 2
    early = matching[:mid]
    recent = matching[mid:]
    
    def window_stats(atoms, label):
        if not atoms:
            return {"period": label, "avg_arousal": 0, "avg_valence": 0, "count": 0}
        avg_a = sum(a['arousal'] for a in atoms) / len(atoms)
        avg_v = sum(a['valence'] for a in atoms) / len(atoms)
        return {
            "period": label,
            "avg_arousal": round(avg_a, 3),
            "avg_valence": round(avg_v, 3),
            "count": len(atoms),
            "date_range": f"{atoms[0]['created_at'][:10]} to {atoms[-1]['created_at'][:10]}",
        }
    
    early_stats = window_stats(early, "early")
    recent_stats = window_stats(recent, "recent")
    
    arousal_delta = recent_stats['avg_arousal'] - early_stats['avg_arousal']
    valence_delta = recent_stats['avg_valence'] - early_stats['avg_valence']
    
    # Classify the drift direction
    if abs(arousal_delta) < 0.05 and abs(valence_delta) < 0.05:
        direction = "stable"
    elif valence_delta > 0.1 and arousal_delta > 0.05:
        direction = "warming"  # more positive, more engaged
    elif valence_delta < -0.1 and arousal_delta > 0.05:
        direction = "souring"  # more negative, more intense
    elif valence_delta > 0.1:
        direction = "warming"
    elif valence_delta < -0.1:
        direction = "cooling"
    elif arousal_delta > 0.1:
        direction = "intensifying"
    elif arousal_delta < -0.1:
        direction = "calming"
    else:
        direction = "stable"
    
    return {
        "entity": entity_or_topic,
        "windows": [early_stats, recent_stats],
        "drift": {
            "arousal_delta": round(arousal_delta, 3),
            "valence_delta": round(valence_delta, 3),
            "direction": direction,
        },
        "atom_count": len(matching),
    }


# ─── Feature: Confidence Gradient ────────────────────────────────

def update_confidence_from_evidence(conn=None) -> dict:
    """Update triple confidence based on evidence accumulation.
    
    A fact confirmed by multiple atoms has higher confidence.
    A fact from a single atom retains its source confidence.
    
    Evidence sources:
    1. Same triple extracted from multiple atoms -> confidence boost
    2. Triple's source atom has high access_count -> slightly higher
    3. Triple's source atom is 'correction' type -> highest confidence
    
    Called during decay cycle or on-demand.
    """
    close = False
    if conn is None:
        conn = get_db()
        close = True
    
    # Get all active triples with their source atom info
    rows = conn.execute("""
        SELECT t.id, t.subject, t.predicate, t.object, t.confidence, t.atom_id,
               a.access_count, a.source_type, a.encoding_confidence
        FROM triples t
        JOIN atoms a ON t.atom_id = a.id
        WHERE t.state = 'active'
    """).fetchall()
    
    # Group by normalized content (same fact from different atoms)
    from collections import defaultdict
    fact_groups = defaultdict(list)
    for row in rows:
        norm_key = f"{row[1].lower()}:{row[2].lower()}:{row[3].lower()}"
        fact_groups[norm_key].append(dict(row))
    
    updated = 0
    for norm_key, triples in fact_groups.items():
        # Evidence count: how many distinct atoms support this fact
        unique_atoms = len(set(t['atom_id'] for t in triples))
        
        # Base confidence from source atoms
        avg_encoding_conf = sum(t['encoding_confidence'] for t in triples) / len(triples)
        
        # Evidence multiplier: more sources = higher confidence (diminishing returns)
        evidence_mult = min(1.5, 0.7 + 0.2 * unique_atoms)
        
        # Correction boost: if any source is a correction, boost
        correction_boost = 0.1 if any(t['source_type'] == 'correction' for t in triples) else 0
        
        # Access boost: frequently accessed atoms suggest confirmed knowledge
        max_access = max(t['access_count'] for t in triples)
        access_boost = min(0.1, max_access * 0.005)
        
        new_confidence = min(1.0, avg_encoding_conf * evidence_mult + correction_boost + access_boost)
        
        # Update all triples in this group
        for t in triples:
            if abs(t['confidence'] - new_confidence) > 0.01:
                conn.execute("UPDATE triples SET confidence = ? WHERE id = ?",
                           (round(new_confidence, 3), t['id']))
                updated += 1
    
    if close:
        conn.commit()
        conn.close()
    else:
        conn.commit()
    
    return {
        "triples_updated": updated,
        "fact_groups": len(fact_groups),
        "multi_source_facts": sum(1 for v in fact_groups.values() if len(set(t['atom_id'] for t in v)) > 1),
    }


# ─── Feature: Batch Operations ───────────────────────────────────

def batch_retrieve(queries: list[dict]) -> list[dict]:
    """Execute multiple retrievals in one round-trip.
    
    Each query dict: {"query": str, "mode": str, "top_k": int, "since": str, "before": str}
    Returns list of result sets, one per query.
    
    Shares a single embedding API call batch where possible.
    The agent uses this for context assembly: startup + topic + episodic + emotional in one call.
    """
    results = []
    for q in queries:
        r = retrieve(
            query=q.get("query", ""),
            mode=q.get("mode", "task"),
            top_k=q.get("top_k", 10),
            stream=q.get("stream"),
            since=q.get("since"),
            before=q.get("before"),
            explain=q.get("explain", False),
        )
        results.append({
            "query": q.get("query", ""),
            "atoms": r,
            "count": len(r),
        })
    return results


def batch_query(queries: list[dict]) -> list[dict]:
    """Execute multiple hybrid queries (triples + atoms) in one call.
    
    Each query dict: {"query": str, "mode": str, "budget": int}
    Returns list of hybrid results.
    """
    from .triples import hybrid_retrieve_with_triples
    
    results = []
    for q in queries:
        r = hybrid_retrieve_with_triples(
            query=q.get("query", ""),
            mode=q.get("mode", "task"),
            token_budget=q.get("budget", 500),
        )
        results.append(r)
    return results


# ─── Feature: Negative Knowledge ─────────────────────────────────

NEGATIVE_KNOWLEDGE_SCHEMA = """
CREATE TABLE IF NOT EXISTS negative_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    domain TEXT,
    result TEXT CHECK(result IN ('empty', 'low_confidence', 'contradictory')) DEFAULT 'empty',
    searched_at TEXT NOT NULL,
    expires_at TEXT,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_neg_query ON negative_knowledge(query);
"""


def _ensure_negative_knowledge_table(conn):
    conn.executescript(NEGATIVE_KNOWLEDGE_SCHEMA)


def record_negative(query: str, domain: str = None, result: str = "empty",
                    ttl_hours: int = None, notes: str = None) -> int:
    """Record that a search for this query returned nothing useful.
    
    Prevents repeated failed searches. Default TTL: 1 week.
    
    result types:
    - 'empty': no results at all
    - 'low_confidence': results found but below confidence threshold
    - 'contradictory': results found but contradicted each other
    """
    if ttl_hours is None:
        ttl_hours = _cfg('negative_knowledge', 'default_ttl_hours', 168)
    conn = get_db()
    _ensure_negative_knowledge_table(conn)
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(hours=ttl_hours)).isoformat()
    
    conn.execute("""
        INSERT INTO negative_knowledge (query, domain, result, searched_at, expires_at, notes)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (query, domain, result, now.isoformat(), expires, notes))
    conn.commit()
    row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return row_id


def check_negative(query: str) -> dict:
    """Check if we already know this query returns nothing.
    
    Returns None if no negative record exists or it's expired.
    Otherwise returns the negative knowledge record.
    The agent calls this BEFORE searching externally.
    """
    conn = get_db()
    _ensure_negative_knowledge_table(conn)
    now = datetime.now(timezone.utc).isoformat()
    
    # Check for exact or fuzzy match (LIKE with first 3 words)
    words = query.lower().split()[:3]
    pattern = f"%{'%'.join(words)}%" if words else query
    
    row = conn.execute("""
        SELECT query, domain, result, searched_at, expires_at, notes
        FROM negative_knowledge
        WHERE (LOWER(query) = ? OR LOWER(query) LIKE ?)
        AND expires_at > ?
        ORDER BY searched_at DESC LIMIT 1
    """, (query.lower(), pattern, now)).fetchone()
    
    conn.close()
    
    if row:
        return {
            "known_negative": True,
            "original_query": row[0],
            "domain": row[1],
            "result": row[2],
            "searched_at": row[3],
            "expires_at": row[4],
            "notes": row[5],
        }
    return {"known_negative": False}


def expire_negatives() -> int:
    """Remove expired negative knowledge records. Called during decay cycle."""
    conn = get_db()
    _ensure_negative_knowledge_table(conn)
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute("DELETE FROM negative_knowledge WHERE expires_at < ?", (now,))
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted


# ─── Feature: Source Provenance ───────────────────────────────────

PROVENANCE_SCHEMA = """
CREATE TABLE IF NOT EXISTS provenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    parent_type TEXT,
    parent_id TEXT,
    action TEXT NOT NULL,
    source TEXT,
    timestamp TEXT NOT NULL,
    metadata TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_prov_entity ON provenance(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_prov_parent ON provenance(parent_type, parent_id);
"""


def _ensure_provenance_table(conn):
    conn.executescript(PROVENANCE_SCHEMA)


def log_provenance(entity_type: str, entity_id: str, action: str,
                   parent_type: str = None, parent_id: str = None,
                   source: str = None, metadata: dict = None):
    """Log a provenance event for any entity (atom, triple, correction).
    
    Example chain:
    1. web_search("user hometown") -> log_provenance("search", search_id, "executed")
    2. store_atom(result) -> log_provenance("atom", atom_id, "created", parent=("search", search_id))
    3. extract_triple(atom) -> log_provenance("triple", triple_id, "extracted", parent=("atom", atom_id))
    """
    conn = get_db()
    _ensure_provenance_table(conn)
    conn.execute("""
        INSERT INTO provenance (entity_type, entity_id, parent_type, parent_id, 
                               action, source, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (entity_type, entity_id, parent_type, parent_id, action, source,
          datetime.now(timezone.utc).isoformat(), json.dumps(metadata or {})))
    conn.commit()
    conn.close()


def get_provenance(entity_type: str, entity_id: str) -> list[dict]:
    """Get the full provenance chain for an entity.
    
    Walks up the parent chain to find the original source.
    """
    conn = get_db()
    _ensure_provenance_table(conn)
    
    chain = []
    current_type, current_id = entity_type, entity_id
    visited = set()
    
    while current_type and current_id:
        key = f"{current_type}:{current_id}"
        if key in visited:
            break
        visited.add(key)
        
        rows = conn.execute("""
            SELECT entity_type, entity_id, parent_type, parent_id, action, source, timestamp, metadata
            FROM provenance WHERE entity_type = ? AND entity_id = ?
            ORDER BY timestamp ASC
        """, (current_type, current_id)).fetchall()
        
        for row in rows:
            chain.append({
                "entity_type": row[0], "entity_id": row[1],
                "action": row[4], "source": row[5],
                "timestamp": row[6], "metadata": json.loads(row[7] or '{}'),
            })
        
        if rows:
            current_type = rows[0][2]  # parent_type
            current_id = rows[0][3]    # parent_id
        else:
            break
    
    conn.close()
    return chain


# ─── Feature: Atom Merging ────────────────────────────────────────

def find_merge_candidates(similarity_threshold: float = None, top_k: int = None) -> list[dict]:
    """Find atoms that are semantically similar enough to merge.

    Uses FAISS per-atom k-NN when available, falls back to O(n^2) pairwise.
    Skips atoms in different streams (semantic + episodic shouldn't merge).
    """
    if similarity_threshold is None:
        similarity_threshold = _cfg('merge', 'similarity_threshold', 0.85)
    if top_k is None:
        top_k = _cfg('merge', 'max_candidates', 20)
    conn = get_db()
    rows = conn.execute("""
        SELECT id, content, stream, embedding, access_count, encoding_confidence
        FROM atoms WHERE state = 'active' AND embedding IS NOT NULL
    """).fetchall()

    atoms = [dict(r) for r in rows]
    candidates = []

    # Try FAISS per-atom k-NN (much faster than O(n^2))
    try:
        from .vector_index import get_atoms_index, FAISS_AVAILABLE
        if FAISS_AVAILABLE:
            idx = get_atoms_index(conn=conn)
            if idx is not None and idx._built:
                atom_map = {a['id']: a for a in atoms}
                seen_pairs = set()
                for atom in atoms:
                    if len(candidates) >= top_k:
                        break
                    vec = unpack_embedding(atom['embedding'])
                    neighbors = idx.search(vec, top_k=10)
                    for neighbor_id, sim in neighbors:
                        if neighbor_id == atom['id']:
                            continue
                        if sim < similarity_threshold:
                            continue
                        pair_key = tuple(sorted((atom['id'], neighbor_id)))
                        if pair_key in seen_pairs:
                            continue
                        seen_pairs.add(pair_key)
                        neighbor = atom_map.get(neighbor_id)
                        if not neighbor or neighbor['stream'] != atom['stream']:
                            continue
                        candidates.append({
                            "atom_a": {"id": atom['id'], "content": atom['content'][:100],
                                      "access_count": atom['access_count']},
                            "atom_b": {"id": neighbor['id'], "content": neighbor['content'][:100],
                                      "access_count": neighbor['access_count']},
                            "similarity": round(sim, 4),
                            "stream": atom['stream'],
                        })
                        if len(candidates) >= top_k:
                            break
                conn.close()
                return sorted(candidates, key=lambda c: -c['similarity'])
    except Exception:
        pass

    conn.close()

    # Fallback: O(n^2) pairwise comparison
    for i in range(len(atoms)):
        for j in range(i + 1, len(atoms)):
            a, b = atoms[i], atoms[j]
            if a['stream'] != b['stream']:
                continue
            vec_a = unpack_embedding(a['embedding'])
            vec_b = unpack_embedding(b['embedding'])
            sim = cosine_similarity(vec_a, vec_b)
            if sim >= similarity_threshold:
                candidates.append({
                    "atom_a": {"id": a['id'], "content": a['content'][:100],
                              "access_count": a['access_count']},
                    "atom_b": {"id": b['id'], "content": b['content'][:100],
                              "access_count": b['access_count']},
                    "similarity": round(sim, 4),
                    "stream": a['stream'],
                })
                if len(candidates) >= top_k:
                    return sorted(candidates, key=lambda c: -c['similarity'])

    return sorted(candidates, key=lambda c: -c['similarity'])


def merge_atoms(atom_id_keep: str, atom_id_remove: str, merged_content: str = None) -> dict:
    """Merge two atoms. Keeps one, tombstones the other.
    
    The kept atom gets:
    - Combined access count
    - Higher confidence
    - Merged content (if provided) or keeps its own content
    - Re-embedded if content changed
    
    The removed atom is tombstoned (not deleted).
    Triples from the removed atom are reassigned to the kept atom.
    """
    conn = get_db()
    
    keep = conn.execute("SELECT * FROM atoms WHERE id = ?", (atom_id_keep,)).fetchone()
    remove = conn.execute("SELECT * FROM atoms WHERE id = ?", (atom_id_remove,)).fetchone()
    
    if not keep or not remove:
        conn.close()
        return {"error": "One or both atoms not found"}
    
    keep = dict(keep)
    remove = dict(remove)
    
    # Merge access counts
    new_access = keep['access_count'] + remove['access_count']
    new_confidence = max(keep['encoding_confidence'], remove['encoding_confidence'])
    
    # Merge content if provided
    new_content = merged_content or keep['content']
    
    # Re-embed if content changed
    new_embedding = None
    if merged_content:
        try:
            new_embedding = pack_embedding(embed_text(new_content))
        except Exception:
            pass
    
    # Update kept atom
    update_sql = """UPDATE atoms SET access_count = ?, encoding_confidence = ?"""
    params = [new_access, new_confidence]
    
    if merged_content:
        update_sql += ", content = ?, content_hash = ?"
        params.extend([new_content, hashlib.sha256(new_content.encode()).hexdigest()[:32]])
    if new_embedding:
        update_sql += ", embedding = ?"
        params.append(new_embedding)
    
    update_sql += " WHERE id = ?"
    params.append(atom_id_keep)
    conn.execute(update_sql, params)
    
    # Tombstone removed atom
    conn.execute("UPDATE atoms SET state = 'tombstone' WHERE id = ?", (atom_id_remove,))
    
    # Reassign triples
    try:
        conn.execute("UPDATE triples SET atom_id = ? WHERE atom_id = ?", 
                    (atom_id_keep, atom_id_remove))
    except Exception:
        pass
    
    conn.commit()
    conn.close()
    
    # Log provenance
    log_provenance("atom", atom_id_keep, "merged", 
                   parent_type="atom", parent_id=atom_id_remove,
                   metadata={"removed_content": remove['content'][:200]})
    
    _fire_hook('on_correct', atom_id=atom_id_keep, action='merge', removed_id=atom_id_remove)
    
    return {
        "kept": atom_id_keep,
        "removed": atom_id_remove,
        "new_access_count": new_access,
        "new_confidence": new_confidence,
        "content_updated": merged_content is not None,
    }


# ─── Feature: Schema Migration ───────────────────────────────────

SCHEMA_VERSION = 8  # Increment when schema changes

MIGRATIONS = {
    1: [
        "CREATE TABLE IF NOT EXISTS co_retrieval (id INTEGER PRIMARY KEY AUTOINCREMENT, atom_a TEXT NOT NULL, atom_b TEXT NOT NULL, co_count INTEGER DEFAULT 1, last_co_retrieval TEXT NOT NULL, session_id TEXT, UNIQUE(atom_a, atom_b))",
        "CREATE INDEX IF NOT EXISTS idx_co_ret_a ON co_retrieval(atom_a)",
        "CREATE INDEX IF NOT EXISTS idx_co_ret_b ON co_retrieval(atom_b)",
        "CREATE TABLE IF NOT EXISTS negative_knowledge (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, domain TEXT, result TEXT DEFAULT 'empty', searched_at TEXT NOT NULL, expires_at TEXT, notes TEXT)",
        "CREATE INDEX IF NOT EXISTS idx_neg_query ON negative_knowledge(query)",
        "CREATE TABLE IF NOT EXISTS provenance (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, parent_type TEXT, parent_id TEXT, action TEXT NOT NULL, source TEXT, timestamp TEXT NOT NULL, metadata TEXT DEFAULT '{}')",
        "CREATE INDEX IF NOT EXISTS idx_prov_entity ON provenance(entity_type, entity_id)",
        "CREATE INDEX IF NOT EXISTS idx_prov_parent ON provenance(parent_type, parent_id)",
    ],
    2: [
        "CREATE TABLE IF NOT EXISTS forgetting_log (id INTEGER PRIMARY KEY AUTOINCREMENT, atom_id TEXT NOT NULL, previous_state TEXT NOT NULL, new_state TEXT NOT NULL, reason TEXT NOT NULL, factors TEXT DEFAULT '{}', timestamp TEXT NOT NULL)",
        "CREATE INDEX IF NOT EXISTS idx_forget_atom ON forgetting_log(atom_id)",
        "CREATE INDEX IF NOT EXISTS idx_forget_ts ON forgetting_log(timestamp)",
        "CREATE TABLE IF NOT EXISTS atom_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, atom_id TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL, changed_by TEXT, change_reason TEXT, timestamp TEXT NOT NULL, metadata TEXT DEFAULT '{}')",
        "CREATE INDEX IF NOT EXISTS idx_versions_atom ON atom_versions(atom_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_unique ON atom_versions(atom_id, version)",
        "CREATE TABLE IF NOT EXISTS atom_relations (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relation_type TEXT NOT NULL, confidence REAL DEFAULT 0.8, created_at TEXT NOT NULL, metadata TEXT DEFAULT '{}', UNIQUE(source_id, target_id, relation_type))",
        "CREATE INDEX IF NOT EXISTS idx_rel_source ON atom_relations(source_id)",
        "CREATE INDEX IF NOT EXISTS idx_rel_target ON atom_relations(target_id)",
        "CREATE INDEX IF NOT EXISTS idx_rel_type ON atom_relations(relation_type)",
    ],
    3: [
        # Phase 1C: Denormalization -- atom_topics junction table, is_pinned, session_id, working_expires_at
        "CREATE TABLE IF NOT EXISTS atom_topics (atom_id TEXT NOT NULL, topic TEXT NOT NULL, PRIMARY KEY(atom_id, topic))",
        "CREATE INDEX IF NOT EXISTS idx_atom_topics_topic ON atom_topics(topic)",
        "ALTER TABLE atoms ADD COLUMN is_pinned INTEGER DEFAULT 0",
        "ALTER TABLE atoms ADD COLUMN session_id TEXT",
        "ALTER TABLE atoms ADD COLUMN working_expires_at REAL",
        "CREATE INDEX IF NOT EXISTS idx_triples_subject_lower ON triples(LOWER(subject))",
        "CREATE INDEX IF NOT EXISTS idx_triples_object_lower ON triples(LOWER(object))",
        "CREATE INDEX IF NOT EXISTS idx_triples_predicate_lower ON triples(LOWER(predicate))",
        # Backfill atom_topics from atoms.topics JSON
        """INSERT OR IGNORE INTO atom_topics (atom_id, topic)
           SELECT a.id, t.value FROM atoms a, json_each(a.topics) t
           WHERE a.topics IS NOT NULL AND a.topics != '[]'""",
        # Backfill is_pinned from metadata JSON
        "UPDATE atoms SET is_pinned = 1 WHERE metadata LIKE '%\"pinned\": true%'",
        # Backfill session_id and working_expires_at from metadata JSON
        """UPDATE atoms SET
               session_id = json_extract(metadata, '$.session_id'),
               working_expires_at = json_extract(metadata, '$.working_expires_at')
           WHERE stream = 'working' AND metadata IS NOT NULL AND metadata != '{}'""",
    ],
    4: [
        # Phase 1B: FTS5 full-text search virtual tables
        "CREATE VIRTUAL TABLE IF NOT EXISTS atoms_fts USING fts5(content, content='atoms', content_rowid='rowid')",
        "CREATE VIRTUAL TABLE IF NOT EXISTS triples_fts USING fts5(subject, predicate, object, content='triples', content_rowid='rowid')",
        # Backfill FTS indexes from existing data
        "INSERT INTO atoms_fts(atoms_fts) VALUES('rebuild')",
        "INSERT INTO triples_fts(triples_fts) VALUES('rebuild')",
    ],
    5: [
        # Phase 2B: Consolidation -- no structural changes needed,
        # atom_relations.relation_type already accepts any TEXT.
        # This migration just documents the version bump.
        "SELECT 1",  # no-op
    ],
    6: [
        # Phase 1D: Partial unique index for atomic dedup (TOCTOU fix).
        # Prevents duplicate content_hash in active/fading states without SELECT-then-INSERT.
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_atoms_dedup ON atoms(content_hash, agent_id) WHERE state IN ('active', 'fading')",
    ],
    7: [
        # Cross-provider identity calibration: track which provider created each embedding.
        "ALTER TABLE atoms ADD COLUMN embedding_provider TEXT",
    ],
    8: [
        # Feature 1: Felt Consequence -- outcome-attributed memory
        "ALTER TABLE atoms ADD COLUMN outcome_score REAL DEFAULT 0.0",
        "ALTER TABLE atoms ADD COLUMN outcome_count INTEGER DEFAULT 0",
        "ALTER TABLE atoms ADD COLUMN last_outcome_at TEXT",
        """CREATE TABLE IF NOT EXISTS retrieval_outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            atom_ids TEXT NOT NULL,
            query TEXT,
            feedback TEXT CHECK(feedback IN ('positive','negative','neutral','silence')),
            feedback_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )""",
        "CREATE INDEX IF NOT EXISTS idx_outcomes_session ON retrieval_outcomes(session_id)",
        "CREATE INDEX IF NOT EXISTS idx_outcomes_feedback ON retrieval_outcomes(feedback)",

        # Feature 2: Predictive Context -- temporal_patterns table
        """CREATE TABLE IF NOT EXISTS temporal_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            atom_id TEXT NOT NULL,
            hour_of_day INTEGER,
            day_of_week INTEGER,
            retrieval_count INTEGER DEFAULT 1,
            last_retrieved_at TEXT DEFAULT (datetime('now')),
            UNIQUE(atom_id, hour_of_day, day_of_week)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_temporal_atom ON temporal_patterns(atom_id)",
        "CREATE INDEX IF NOT EXISTS idx_temporal_time ON temporal_patterns(hour_of_day, day_of_week)",

        # Feature 3: Temporal World Model -- extend triples table
        "ALTER TABLE triples ADD COLUMN valid_from TEXT",
        "ALTER TABLE triples ADD COLUMN valid_until TEXT",
        "ALTER TABLE triples ADD COLUMN source_atom_id TEXT",
        "CREATE INDEX IF NOT EXISTS idx_triples_temporal ON triples(valid_from, valid_until)",
        "CREATE INDEX IF NOT EXISTS idx_triples_subject_temporal ON triples(subject, valid_from, valid_until)",

        # Feature 4: Agreement Rate -- in metrics DB, handled separately
    ],
}


def get_schema_version(conn=None) -> int:
    """Get current schema version from DB."""
    close = False
    if conn is None:
        conn = get_db()
        close = True
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
        version = row[0] if row[0] is not None else 0
    except Exception:
        version = 0
    if close:
        conn.close()
    return version


def run_migrations(conn=None) -> dict:
    """Run pending schema migrations."""
    close = False
    if conn is None:
        conn = get_db()
        close = True
    
    current = get_schema_version(conn)
    applied = []
    
    for version in sorted(MIGRATIONS.keys()):
        if version > current:
            for sql in MIGRATIONS[version]:
                try:
                    conn.execute(sql)
                except Exception as e:
                    pass  # IF NOT EXISTS handles most cases
            conn.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
            applied.append(version)

    # Post-migration hooks
    if 7 in applied:
        # Backfill embedding_provider with current configured provider
        try:
            provider_name = _cfg('embedding', 'provider', 'nvidia-nim')
            conn.execute(
                "UPDATE atoms SET embedding_provider = ? WHERE embedding_provider IS NULL",
                (provider_name,)
            )
        except Exception:
            pass

    conn.commit()
    if close:
        conn.close()
    
    return {
        "previous_version": current,
        "current_version": max(applied) if applied else current,
        "migrations_applied": applied,
    }


# ─── Feature: Contribution Tracking ──────────────────────────────

def mark_contributions(retrieved_atom_ids: list[str], response_text: str,
                       session_id: str = None) -> dict:
    """Mark which retrieved atoms contributed to a response.
    
    Two signals:
    1. Content overlap: atom phrases appearing in the response text
    2. Explicit marking: caller can pass atom_ids that were directly used
    
    Updates the access_log.contributed field and stores co-retrieval data
    for association chain building.
    
    Called by the agent after generating a response.
    """
    conn = get_db()
    response_lower = response_text.lower()
    response_words = set(response_lower.split())
    
    contributed_ids = []
    not_contributed_ids = []
    
    for atom_id in retrieved_atom_ids:
        row = conn.execute("SELECT content FROM atoms WHERE id = ?", (atom_id,)).fetchone()
        if not row:
            continue
        
        content = row['content']
        content_lower = content.lower()
        
        # Signal 1: Phrase overlap (3+ word sequences from atom found in response)
        atom_words = content_lower.split()
        phrase_hits = 0
        for i in range(len(atom_words) - 2):
            trigram = f"{atom_words[i]} {atom_words[i+1]} {atom_words[i+2]}"
            if trigram in response_lower:
                phrase_hits += 1
        
        # Signal 2: Key term overlap (significant words, not stopwords)
        stopwords = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
                     'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
                     'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of',
                     'in', 'for', 'on', 'with', 'at', 'by', 'from', 'this', 'that',
                     'it', 'its', 'not', 'but', 'and', 'or', 'if', 'as', 'no', 'so'}
        atom_key_words = {w for w in atom_words if len(w) > 3 and w not in stopwords}
        overlap = atom_key_words & response_words
        overlap_ratio = len(overlap) / max(len(atom_key_words), 1)
        
        # Classify: contributed if phrase hit OR >30% key word overlap
        contributed = phrase_hits >= 1 or overlap_ratio > 0.3
        
        if contributed:
            contributed_ids.append(atom_id)
        else:
            not_contributed_ids.append(atom_id)
        
        # Update most recent access_log entry for this atom
        conn.execute("""
            UPDATE access_log SET contributed = ?
            WHERE atom_id = ? AND id = (
                SELECT id FROM access_log WHERE atom_id = ? ORDER BY accessed_at DESC LIMIT 1
            )
        """, (1 if contributed else 0, atom_id, atom_id))
    
    # Store co-retrieval record for association chains
    if len(contributed_ids) > 1:
        _log_co_retrieval(conn, contributed_ids, session_id)
    
    conn.commit()
    conn.close()
    
    return {
        "total_retrieved": len(retrieved_atom_ids),
        "contributed": len(contributed_ids),
        "not_contributed": len(not_contributed_ids),
        "contributed_ids": contributed_ids,
        "contribution_rate": round(len(contributed_ids) / max(len(retrieved_atom_ids), 1), 3),
    }


# ─── Feature: Felt Consequence (Outcome Attribution) ─────────────

def record_outcome(atom_ids, feedback, session_id=None, query=None):
    """Record outcome feedback for retrieved atoms.

    Score deltas: positive=+1, negative=-1, neutral=+0.1, silence=0.
    Applies exponential decay to existing score before adding new delta.
    Clamps outcome_score to [-5.0, 5.0].
    """
    if not atom_ids:
        return {"updated": 0}

    delta_map = {
        "positive": 1.0,
        "negative": -1.0,
        "neutral": 0.1,
        "silence": 0.0,
    }
    delta = delta_map.get(feedback, 0.0)
    decay = _cfg('retrieval', 'outcome_decay', 0.95)
    now = datetime.now(timezone.utc).isoformat()

    conn = get_db()
    updated = 0

    if isinstance(atom_ids, str):
        atom_ids = [atom_ids]

    for atom_id in atom_ids:
        row = conn.execute(
            "SELECT outcome_score, outcome_count FROM atoms WHERE id = ?",
            (atom_id,),
        ).fetchone()
        if not row:
            continue

        old_score = row["outcome_score"] if row["outcome_score"] is not None else 0.0
        old_count = row["outcome_count"] if row["outcome_count"] is not None else 0

        # Decay existing score, then add new delta
        new_score = old_score * decay + delta
        new_score = max(-5.0, min(5.0, new_score))
        new_count = old_count + 1

        conn.execute(
            "UPDATE atoms SET outcome_score = ?, outcome_count = ?, last_outcome_at = ? WHERE id = ?",
            (new_score, new_count, now, atom_id),
        )
        updated += 1

    # Log to retrieval_outcomes table
    conn.execute(
        """INSERT INTO retrieval_outcomes (session_id, atom_ids, query, feedback, feedback_at)
           VALUES (?, ?, ?, ?, ?)""",
        (session_id, json.dumps(atom_ids), query, feedback, now),
    )

    conn.commit()
    conn.close()

    return {"updated": updated, "feedback": feedback, "atom_ids": atom_ids}


def get_outcome_history(atom_id=None, limit=50):
    """Get outcome feedback history, optionally filtered by atom_id."""
    conn = get_db()
    if atom_id:
        rows = conn.execute(
            """SELECT * FROM retrieval_outcomes
               WHERE atom_ids LIKE ? ORDER BY created_at DESC LIMIT ?""",
            (f'%"{atom_id}"%', limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM retrieval_outcomes ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Feature: Association Chains ─────────────────────────────────

# Schema for co-retrieval tracking
CO_RETRIEVAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS co_retrieval (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atom_a TEXT NOT NULL,
    atom_b TEXT NOT NULL,
    co_count INTEGER DEFAULT 1,
    last_co_retrieval TEXT NOT NULL,
    session_id TEXT,
    UNIQUE(atom_a, atom_b)
);
CREATE INDEX IF NOT EXISTS idx_co_ret_a ON co_retrieval(atom_a);
CREATE INDEX IF NOT EXISTS idx_co_ret_b ON co_retrieval(atom_b);
"""


def _ensure_co_retrieval_table(conn):
    """Create co-retrieval table if it doesn't exist."""
    conn.executescript(CO_RETRIEVAL_SCHEMA)


def _log_co_retrieval(conn, atom_ids: list[str], session_id: str = None):
    """Log that these atoms were retrieved and used together."""
    _ensure_co_retrieval_table(conn)
    now = datetime.now(timezone.utc).isoformat()
    
    # Create pairs (order-independent: always smaller id first)
    for i in range(len(atom_ids)):
        for j in range(i + 1, len(atom_ids)):
            a, b = sorted([atom_ids[i], atom_ids[j]])
            conn.execute("""
                INSERT INTO co_retrieval (atom_a, atom_b, co_count, last_co_retrieval, session_id)
                VALUES (?, ?, 1, ?, ?)
                ON CONFLICT(atom_a, atom_b) DO UPDATE SET
                    co_count = co_count + 1,
                    last_co_retrieval = ?,
                    session_id = ?
            """, (a, b, now, session_id, now, session_id))


def get_associations(atom_id: str, min_co_count: int = 2, top_k: int = 10) -> list[dict]:
    """Get atoms that frequently co-occur with the given atom.
    
    'These memories always surface together.' Returns associated atoms
    ranked by co-retrieval frequency.
    """
    conn = get_db()
    _ensure_co_retrieval_table(conn)
    
    rows = conn.execute("""
        SELECT 
            CASE WHEN atom_a = ? THEN atom_b ELSE atom_a END as partner_id,
            co_count, last_co_retrieval
        FROM co_retrieval
        WHERE (atom_a = ? OR atom_b = ?) AND co_count >= ?
        ORDER BY co_count DESC
        LIMIT ?
    """, (atom_id, atom_id, atom_id, min_co_count, top_k)).fetchall()
    
    associations = []
    for row in rows:
        partner = conn.execute("SELECT id, content, stream, topics FROM atoms WHERE id = ?",
                              (row[0],)).fetchone()
        if partner:
            associations.append({
                "atom_id": partner['id'],
                "content_preview": partner['content'][:100],
                "stream": partner['stream'],
                "co_count": row[1],
                "last_together": row[2],
            })
    
    conn.close()
    return associations


def get_association_clusters(min_co_count: int = 3, min_cluster_size: int = 3) -> list[dict]:
    """Find clusters of atoms that frequently appear together.
    
    Uses connected components on the co-retrieval graph.
    Returns clusters sorted by size (largest first).
    """
    conn = get_db()
    _ensure_co_retrieval_table(conn)
    
    edges = conn.execute("""
        SELECT atom_a, atom_b, co_count FROM co_retrieval
        WHERE co_count >= ?
    """, (min_co_count,)).fetchall()
    
    if not edges:
        conn.close()
        return []
    
    # Build adjacency list
    from collections import defaultdict
    adj = defaultdict(set)
    for a, b, _ in edges:
        adj[a].add(b)
        adj[b].add(a)
    
    # Find connected components via BFS
    visited = set()
    clusters = []
    
    for node in adj:
        if node in visited:
            continue
        # BFS
        component = set()
        queue = [node]
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            component.add(current)
            queue.extend(adj[current] - visited)
        
        if len(component) >= min_cluster_size:
            # Get atom previews
            atoms = []
            for aid in component:
                row = conn.execute("SELECT id, content, stream FROM atoms WHERE id = ?", (aid,)).fetchone()
                if row:
                    atoms.append({"id": row['id'], "preview": row['content'][:80], "stream": row['stream']})
            clusters.append({"size": len(atoms), "atoms": atoms})
    
    conn.close()
    clusters.sort(key=lambda c: c['size'], reverse=True)
    return clusters


# ─── Feature: Context Quality Scoring ────────────────────────────

def score_context_quality(atoms: list[dict], query: str) -> list[dict]:
    """Estimate marginal value of each atom BEFORE injecting into context.
    
    The agent calls this after retrieval, before context assembly.
    Returns atoms annotated with quality scores and a recommendation
    to include or skip.
    
    Scoring factors:
    1. Relevance: activation score (already computed)
    2. Confidence: from confidence gradient
    3. Novelty: does this atom add information not already in the set?
    4. Contribution history: has this atom been useful in past retrievals?
    5. Diminishing returns: if we already have 3 atoms on this topic, #4 is less valuable
    
    Returns atoms with _quality_score and _include recommendation.
    """
    if not atoms:
        return []
    
    conn = get_db()
    _ensure_co_retrieval_table(conn)
    
    # Get contribution history for each atom
    contribution_rates = {}
    for atom in atoms:
        aid = atom.get('id', '')
        rows = conn.execute("""
            SELECT contributed, COUNT(*) as cnt FROM access_log
            WHERE atom_id = ? AND contributed != -1
            GROUP BY contributed
        """, (aid,)).fetchall()
        
        total = sum(r[1] for r in rows)
        positive = sum(r[1] for r in rows if r[0] == 1)
        contribution_rates[aid] = positive / max(total, 1) if total > 0 else 0.5  # default: neutral
    
    # Track topics already covered for diminishing returns
    topics_covered = {}
    scored_atoms = []
    
    for i, atom in enumerate(atoms):
        aid = atom.get('id', '')
        content = atom.get('content', '')
        
        # Factor 1: Relevance (from activation/combined score)
        relevance = atom.get('_combined_score', atom.get('_activation', 0))
        relevance_norm = min(1.0, relevance / 8.0)  # normalize to 0-1
        
        # Factor 2: Confidence
        confidence = atom.get('encoding_confidence', 0.7)
        
        # Factor 3: Novelty (word overlap with already-selected atoms)
        atom_words = set(content.lower().split())
        already_words = set()
        for prev in scored_atoms:
            if prev.get('_include', False):
                already_words.update(prev.get('content', '').lower().split())
        
        if already_words:
            overlap = len(atom_words & already_words) / max(len(atom_words), 1)
            novelty = 1.0 - overlap
        else:
            novelty = 1.0  # first atom is always novel
        
        # Factor 4: Contribution history
        contrib_rate = contribution_rates.get(aid, 0.5)
        
        # Factor 5: Diminishing returns per topic
        atom_topics = json.loads(atom['topics']) if isinstance(atom.get('topics'), str) else atom.get('topics', [])
        topic_penalty = 0
        for t in atom_topics:
            count = topics_covered.get(t, 0)
            if count >= 2:
                topic_penalty += 0.15 * (count - 1)  # increasing penalty
            topics_covered[t] = count + 1
        
        # Weighted quality score
        quality = (
            relevance_norm * 0.30 +
            confidence * 0.15 +
            novelty * 0.25 +
            contrib_rate * 0.20 -
            topic_penalty * 0.10
        )
        
        atom['_quality_score'] = round(quality, 3)
        atom['_include'] = quality > _cfg('retrieval', 'context_quality_floor', 0.15)
        atom['_quality_factors'] = {
            'relevance': round(relevance_norm, 3),
            'confidence': round(confidence, 3),
            'novelty': round(novelty, 3),
            'contribution_rate': round(contrib_rate, 3),
            'topic_penalty': round(topic_penalty, 3),
        }
        scored_atoms.append(atom)
    
    conn.close()
    return scored_atoms


# ─── Feature: Self-Improving Retrieval ────────────────────────────

def compute_retrieval_adjustments() -> dict:
    """Analyze contribution history to identify retrieval patterns that need adjustment.
    
    Looks at the access_log's contributed field to find:
    1. Atoms that are frequently retrieved but never contribute (over-retrieved)
    2. Atoms that always contribute when retrieved (high-value)
    3. Query patterns that produce low contribution rates
    
    Returns adjustment recommendations. The agent uses these to:
    - Boost high-value atoms in future scoring
    - Dampen over-retrieved atoms
    - Flag problematic query patterns
    
    Called during decay cycle.
    """
    conn = get_db()
    
    # Get per-atom contribution stats
    rows = conn.execute("""
        SELECT atom_id, 
               COUNT(*) as total_retrievals,
               SUM(CASE WHEN contributed = 1 THEN 1 ELSE 0 END) as contributed_count,
               SUM(CASE WHEN contributed = 0 THEN 1 ELSE 0 END) as not_contributed_count,
               SUM(CASE WHEN contributed = -1 THEN 1 ELSE 0 END) as unknown_count
        FROM access_log
        GROUP BY atom_id
        HAVING total_retrievals >= 3
    """).fetchall()
    
    over_retrieved = []  # frequently retrieved, rarely contributes
    high_value = []      # always contributes
    adjustments_made = 0
    _dampen_factor = _cfg('decay', 'stability_dampen_factor', 0.9)
    _boost_factor = _cfg('decay', 'stability_boost_factor', 1.1)
    
    for row in rows:
        atom_id = row[0]
        total = row[1]
        contributed = row[2]
        not_contributed = row[3]
        
        known = contributed + not_contributed
        if known == 0:
            continue
        
        rate = contributed / known
        
        if rate < 0.2 and known >= 5:
            # Over-retrieved: dampen by reducing stability slightly
            over_retrieved.append({
                "atom_id": atom_id,
                "retrievals": total,
                "contribution_rate": round(rate, 3),
            })
            # Apply dampening
            conn.execute(
                "UPDATE atoms SET stability = MAX(0.5, stability * ?) WHERE id = ?",
                (_dampen_factor, atom_id,)
            )
            adjustments_made += 1
            
        elif rate > 0.8 and known >= 3:
            # High-value: boost stability
            high_value.append({
                "atom_id": atom_id,
                "retrievals": total,
                "contribution_rate": round(rate, 3),
            })
            # Apply boost
            conn.execute(
                "UPDATE atoms SET stability = MIN(stability * ?, ?) WHERE id = ?",
                (_boost_factor, _cfg('decay', 'max_stability', 10.0), atom_id,)
            )
            adjustments_made += 1
    
    conn.commit()
    conn.close()
    
    return {
        "atoms_analyzed": len(rows),
        "over_retrieved": over_retrieved,
        "high_value": high_value,
        "adjustments_made": adjustments_made,
        "over_retrieved_count": len(over_retrieved),
        "high_value_count": len(high_value),
    }


# ─── Feature: Retrieval Dry Run ──────────────────────────────────

def dry_retrieve(query: str, mode: str = "task", top_k: int = 10,
                 stream: str = None, since: str = None, before: str = None,
                 agent_id: str = None) -> list[dict]:
    """Retrieve without side effects. No access logging, no hooks, no activation updates.

    Used by metamemory, quality scoring, and debugging.
    'What WOULD I remember?' without actually remembering.
    """
    conn = get_db()
    query_emb = cached_embed_query(query)

    # Try FAISS fast path (when no filters)
    _use_faiss = not stream and not since and not before and not agent_id
    if _use_faiss:
        try:
            from .vector_index import faiss_search_atoms, FAISS_AVAILABLE
            if FAISS_AVAILABLE:
                candidates = faiss_search_atoms(query_emb, top_k=top_k * 3, conn=conn)
                if candidates:
                    candidate_ids = [c[0] for c in candidates]
                    sim_map = {c[0]: c[1] for c in candidates}
                    placeholders = ','.join(['?'] * len(candidate_ids))
                    rows = conn.execute(
                        f"SELECT * FROM atoms WHERE id IN ({placeholders}) AND state IN ('active', 'fading')",
                        candidate_ids
                    ).fetchall()
                    scored = []
                    for row in rows:
                        atom = dict(row)
                        sim = sim_map.get(atom["id"], 0.0)
                        activation = compute_activation(atom, query_similarity=sim, mode=mode)
                        atom["_activation"] = activation
                        atom["_similarity"] = sim
                        atom["_explanation"] = _explain_activation(atom, sim, mode)
                        atom.pop("embedding", None)
                        scored.append(atom)
                    conn.close()
                    scored.sort(key=lambda x: x["_activation"], reverse=True)
                    return scored[:top_k]
        except Exception:
            pass

    sql = "SELECT * FROM atoms WHERE state IN ('active', 'fading')"
    params = []
    if agent_id:
        sql += " AND agent_id IN (?, 'shared')"; params.append(agent_id)
    if stream:
        sql += " AND stream = ?"; params.append(stream)
    if since:
        sql += " AND created_at >= ?"; params.append(since)
    if before:
        sql += " AND created_at <= ?"; params.append(before)

    rows = conn.execute(sql, params).fetchall()
    if not rows:
        conn.close()
        return []

    # Batch cosine similarity
    atoms = [dict(row) for row in rows]
    embedding_blobs = [a["embedding"] for a in atoms]
    similarities = batch_cosine_similarity(query_emb, embedding_blobs)

    scored = []
    for i, atom in enumerate(atoms):
        sim = similarities[i]
        activation = compute_activation(atom, query_similarity=sim, mode=mode)
        atom["_activation"] = activation
        atom["_similarity"] = sim
        atom["_explanation"] = _explain_activation(atom, sim, mode)
        atom.pop("embedding", None)
        scored.append(atom)

    conn.close()
    scored.sort(key=lambda x: x["_activation"], reverse=True)
    return scored[:top_k]


# ─── Feature: Query Rewriting ────────────────────────────────────

# Entity aliases for resolution -- loaded from config, with hardcoded defaults
_ENTITY_ALIASES_DEFAULT = {
    "user_nick": "user",
    "agent_nick": "agent",
    "team": "user and agent",
}
_ENTITY_ALIASES = _cfg('entity_resolution', 'aliases', _ENTITY_ALIASES_DEFAULT) or _ENTITY_ALIASES_DEFAULT

# Synonym expansions for common queries -- loaded from config, with hardcoded defaults
_QUERY_EXPANSIONS_DEFAULT = {
    "profession": ["job", "career", "work", "occupation"],
    "show": ["performance", "tour", "concert"],
    "anime": ["manga", "japanese animation"],
    "music": ["songs", "playlist", "listening"],
    "schedule": ["routine", "calendar", "plan", "timetable"],
    "home": ["hometown", "residence", "where lives", "based"],
    "family": ["parents", "siblings", "relatives"],
    "feelings": ["emotions", "mood", "emotional state"],
    "memory": ["remember", "recall", "memories", "msam"],
}
_QUERY_EXPANSIONS = _cfg('query_expansion', 'synonyms', _QUERY_EXPANSIONS_DEFAULT) or _QUERY_EXPANSIONS_DEFAULT


def rewrite_query(query: str) -> dict:
    """Expand and normalize a query for better retrieval recall.
    
    Three passes:
    1. Entity resolution: 'user_nick' → 'user'
    2. Synonym expansion: 'profession' adds 'job', 'career', 'work'
    3. Normalization: lowercase, deduplicate terms
    
    Returns both the rewritten query and metadata about what changed.
    """
    original = query
    query_lower = query.lower()
    
    # Pass 1: Entity resolution
    entities_resolved = []
    for alias, canonical in _ENTITY_ALIASES.items():
        if alias in query_lower:
            query_lower = query_lower.replace(alias, canonical)
            entities_resolved.append(f"{alias} → {canonical}")
    
    # Pass 2: Synonym expansion
    expansions_added = []
    extra_terms = []
    for term, synonyms in _QUERY_EXPANSIONS.items():
        if term in query_lower:
            extra_terms.extend(synonyms)
            expansions_added.append(f"{term} + {synonyms}")
    
    # Pass 3: Combine and deduplicate
    words = query_lower.split() + extra_terms
    seen = set()
    deduped = []
    for w in words:
        if w not in seen:
            seen.add(w)
            deduped.append(w)
    
    rewritten = " ".join(deduped)
    
    return {
        "original": original,
        "rewritten": rewritten,
        "entities_resolved": entities_resolved,
        "expansions_added": expansions_added,
        "changed": rewritten != original.lower(),
    }


def retrieve_with_rewrite(query: str, mode: str = "task", top_k: int = 10,
                          **kwargs) -> list[dict]:
    """Retrieve with automatic query rewriting.
    
    Runs both the original and rewritten query, merges results,
    deduplicates by atom ID, re-ranks by best score.
    """
    rewrite = rewrite_query(query)
    
    # Always run original
    original_results = retrieve(query, mode=mode, top_k=top_k, **kwargs)
    
    if not rewrite["changed"]:
        return original_results
    
    # Also run rewritten query
    rewritten_results = retrieve(rewrite["rewritten"], mode=mode, top_k=top_k, **kwargs)
    
    # Merge by atom ID, keep best score
    seen = {}
    for atom in original_results + rewritten_results:
        aid = atom["id"]
        if aid not in seen or atom["_activation"] > seen[aid]["_activation"]:
            seen[aid] = atom
    
    merged = sorted(seen.values(), key=lambda x: x["_activation"], reverse=True)
    return merged[:top_k]


# ─── Feature: Forgetting Justification ───────────────────────────

FORGETTING_LOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS forgetting_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atom_id TEXT NOT NULL,
    previous_state TEXT NOT NULL,
    new_state TEXT NOT NULL,
    reason TEXT NOT NULL,
    factors TEXT DEFAULT '{}',
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forget_atom ON forgetting_log(atom_id);
CREATE INDEX IF NOT EXISTS idx_forget_ts ON forgetting_log(timestamp);
"""


def _ensure_forgetting_log(conn):
    conn.executescript(FORGETTING_LOG_SCHEMA)


def log_forgetting(conn, atom_id: str, previous_state: str, new_state: str,
                   reason: str, factors: dict = None):
    """Record why an atom changed state. Called from decay cycle.
    
    factors dict example:
    {
        "days_since_access": 14,
        "access_count": 2,
        "stability": 0.3,
        "retrievability": 0.05,
        "contribution_rate": 0.0,
        "triggered_by": "decay_cycle"
    }
    """
    _ensure_forgetting_log(conn)
    conn.execute("""
        INSERT INTO forgetting_log (atom_id, previous_state, new_state, reason, factors, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (atom_id, previous_state, new_state, reason,
          json.dumps(factors or {}), datetime.now(timezone.utc).isoformat()))


def get_forgetting_history(atom_id: str) -> list[dict]:
    """Get the forgetting history for an atom. 'Why did I forget this?'"""
    conn = get_db()
    _ensure_forgetting_log(conn)
    rows = conn.execute("""
        SELECT previous_state, new_state, reason, factors, timestamp
        FROM forgetting_log WHERE atom_id = ? ORDER BY timestamp ASC
    """, (atom_id,)).fetchall()
    conn.close()
    return [{"previous": r[0], "new": r[1], "reason": r[2],
             "factors": json.loads(r[3]), "timestamp": r[4]} for r in rows]


def get_recent_forgetting(hours: int = 24, limit: int = 20) -> list[dict]:
    """Get recently forgotten atoms across the system."""
    conn = get_db()
    _ensure_forgetting_log(conn)
    cutoff = datetime.now(timezone.utc)
    from datetime import timedelta
    cutoff = (cutoff - timedelta(hours=hours)).isoformat()
    
    rows = conn.execute("""
        SELECT f.atom_id, a.content, f.previous_state, f.new_state, f.reason, f.factors, f.timestamp
        FROM forgetting_log f
        LEFT JOIN atoms a ON f.atom_id = a.id
        WHERE f.timestamp > ?
        ORDER BY f.timestamp DESC LIMIT ?
    """, (cutoff, limit)).fetchall()
    conn.close()
    
    return [{"atom_id": r[0], "content": (r[1] or "")[:100], "previous": r[2],
             "new": r[3], "reason": r[4], "factors": json.loads(r[5]),
             "timestamp": r[6]} for r in rows]


# ─── Feature: Atom Versioning ────────────────────────────────────

ATOM_VERSIONS_SCHEMA = """
CREATE TABLE IF NOT EXISTS atom_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atom_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    changed_by TEXT,
    change_reason TEXT,
    timestamp TEXT NOT NULL,
    metadata TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_versions_atom ON atom_versions(atom_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_unique ON atom_versions(atom_id, version);
"""


def _ensure_versions_table(conn):
    conn.executescript(ATOM_VERSIONS_SCHEMA)


def save_atom_version(atom_id: str, content: str, changed_by: str = "system",
                      change_reason: str = None, metadata: dict = None) -> int:
    """Save a version snapshot of an atom's content before modification.
    
    Called automatically before any content update (correction, merge, summarization).
    Returns the version number.
    """
    conn = get_db()
    _ensure_versions_table(conn)
    
    # Get next version number
    row = conn.execute("SELECT MAX(version) FROM atom_versions WHERE atom_id = ?",
                      (atom_id,)).fetchone()
    next_version = (row[0] or 0) + 1
    
    conn.execute("""
        INSERT INTO atom_versions (atom_id, version, content, changed_by, change_reason, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (atom_id, next_version, content, changed_by, change_reason,
          datetime.now(timezone.utc).isoformat(), json.dumps(metadata or {})))
    conn.commit()
    conn.close()
    return next_version


def get_atom_versions(atom_id: str) -> list[dict]:
    """Get all historical versions of an atom. 'What did I USED to think?'"""
    conn = get_db()
    _ensure_versions_table(conn)
    
    # Current version
    current = conn.execute("SELECT content FROM atoms WHERE id = ?", (atom_id,)).fetchone()
    
    # Historical versions
    rows = conn.execute("""
        SELECT version, content, changed_by, change_reason, timestamp
        FROM atom_versions WHERE atom_id = ? ORDER BY version ASC
    """, (atom_id,)).fetchall()
    conn.close()
    
    versions = [{"version": r[0], "content": r[1], "changed_by": r[2],
                 "reason": r[3], "timestamp": r[4]} for r in rows]
    
    if current:
        versions.append({"version": len(versions) + 1, "content": current[0],
                        "changed_by": "current", "reason": None, "timestamp": "now"})
    return versions


# ─── Feature: Atom Summarization ─────────────────────────────────

def summarize_atom(atom_id: str, target_tokens: int = 80) -> dict:
    """Compress an atom's content while preserving core meaning.
    
    Uses extractive summarization (key sentence selection) rather than
    generative (no LLM call needed). Preserves the sentences with highest
    information density based on entity count and uniqueness.
    
    Saves version before summarizing. Triples remain intact.
    """
    conn = get_db()
    row = conn.execute("SELECT content, profile FROM atoms WHERE id = ?", (atom_id,)).fetchone()
    if not row:
        conn.close()
        return {"error": "Atom not found"}
    
    content = row[0]
    original_words = len(content.split())
    target_words = target_tokens  # rough 1:1 approximation
    
    if original_words <= target_words:
        conn.close()
        return {"atom_id": atom_id, "action": "skip", "reason": "already within target"}
    
    # Save version before modifying
    save_atom_version(atom_id, content, changed_by="summarizer",
                      change_reason=f"compression from {original_words} to ~{target_words} words")
    
    # Extractive: split into sentences, score by information density
    import re
    sentences = re.split(r'[.!?\n]+', content)
    sentences = [s.strip() for s in sentences if s.strip()]
    
    if len(sentences) <= 1:
        conn.close()
        return {"atom_id": atom_id, "action": "skip", "reason": "single sentence"}
    
    # Score sentences: longer + more capitalized words (entities) = more important
    scored_sentences = []
    for s in sentences:
        words = s.split()
        entity_count = sum(1 for w in words if w[0].isupper()) if words else 0
        length_score = min(len(words) / 20, 1.0)
        entity_score = entity_count / max(len(words), 1)
        score = length_score * 0.4 + entity_score * 0.6
        scored_sentences.append((s, score, len(words)))
    
    # Select top sentences until target word count
    scored_sentences.sort(key=lambda x: x[1], reverse=True)
    selected = []
    word_count = 0
    for s, score, wc in scored_sentences:
        if word_count + wc <= target_words:
            selected.append(s)
            word_count += wc
    
    # Reorder selected sentences by original position
    ordered = [s for s in sentences if s in selected]
    summarized = ". ".join(ordered)
    if summarized and not summarized.endswith("."):
        summarized += "."
    
    # Update atom
    new_hash = hashlib.sha256(summarized.encode()).hexdigest()[:32]
    
    # Re-embed
    try:
        new_emb = pack_embedding(embed_text(summarized))
        conn.execute("UPDATE atoms SET content = ?, content_hash = ?, embedding = ? WHERE id = ?",
                    (summarized, new_hash, new_emb, atom_id))
    except Exception:
        conn.execute("UPDATE atoms SET content = ?, content_hash = ? WHERE id = ?",
                    (summarized, new_hash, atom_id))
    
    conn.commit()
    conn.close()
    
    _fire_hook('on_correct', atom_id=atom_id, action='summarize')
    
    return {
        "atom_id": atom_id,
        "action": "summarized",
        "original_words": original_words,
        "new_words": word_count,
        "compression_ratio": round(word_count / original_words, 2),
        "sentences_kept": len(selected),
        "sentences_total": len(sentences),
    }


# ─── Feature: Atom Importance Estimation ─────────────────────────

def estimate_importance(content: str, existing_atoms: list[dict] = None) -> dict:
    """Estimate upfront importance of new content before/at storage time.
    
    Scoring factors:
    1. Entity density: more named entities = more important
    2. Uniqueness: how different from existing atoms
    3. Relationship richness: potential for triple extraction
    4. Specificity: concrete facts > vague statements
    
    Returns importance score 0-1 and factor breakdown.
    """
    words = content.split()
    word_count = len(words)
    
    if word_count == 0:
        return {"importance": 0.0, "factors": {}}
    
    # Factor 1: Entity density (capitalized words not at sentence start)
    entities = 0
    for i, w in enumerate(words):
        if i > 0 and w[0].isupper() and len(w) > 1:
            entities += 1
    entity_density = min(entities / max(word_count, 1) * 10, 1.0)
    
    # Factor 2: Specificity (numbers, dates, proper nouns indicate concrete facts)
    import re
    numbers = len(re.findall(r'\d+', content))
    quotes = content.count('"') // 2
    specifics = numbers + quotes
    specificity = min(specifics / 5, 1.0)
    
    # Factor 3: Relationship indicators (verbs of state/action suggest extractable triples)
    relation_words = {'is', 'are', 'was', 'were', 'has', 'have', 'had', 'works', 'lives',
                      'loves', 'likes', 'hates', 'created', 'built', 'started', 'joined',
                      'moved', 'born', 'married', 'from', 'located', 'based'}
    relation_hits = sum(1 for w in words if w.lower() in relation_words)
    relationship_richness = min(relation_hits / 5, 1.0)
    
    # Factor 4: Uniqueness (if existing atoms provided, check overlap)
    uniqueness = 1.0
    if existing_atoms:
        max_overlap = 0
        content_words = set(w.lower() for w in words)
        for atom in existing_atoms[:50]:  # cap comparison
            atom_words = set(atom.get('content', '').lower().split())
            if atom_words:
                overlap = len(content_words & atom_words) / max(len(content_words), 1)
                max_overlap = max(max_overlap, overlap)
        uniqueness = 1.0 - max_overlap
    
    # Weighted importance
    importance = (
        entity_density * 0.25 +
        specificity * 0.25 +
        relationship_richness * 0.25 +
        uniqueness * 0.25
    )
    
    return {
        "importance": round(importance, 3),
        "factors": {
            "entity_density": round(entity_density, 3),
            "specificity": round(specificity, 3),
            "relationship_richness": round(relationship_richness, 3),
            "uniqueness": round(uniqueness, 3),
        },
        "recommendation": "high_priority" if importance > 0.6 else "normal" if importance > 0.3 else "low_priority",
    }


# ─── Feature: Emotional Context Windows ──────────────────────────

def retrieve_with_emotion(query: str, query_emotion: dict = None,
                          mode: str = "task", top_k: int = 10, **kwargs) -> list[dict]:
    """Retrieve with emotional context from the query side.
    
    query_emotion: {"arousal": 0-1, "valence": -1 to 1, "urgency": "low"|"normal"|"high"}
    
    When urgency is high: boost recent atoms, prefer high-confidence.
    When arousal is high: boost emotionally-rich atoms (companion-like scoring).
    When valence is negative: surface supportive/positive atoms.
    
    Same question, different emotional context, different results.
    """
    # Default: neutral
    if not query_emotion:
        return retrieve(query, mode=mode, top_k=top_k, **kwargs)
    
    urgency = query_emotion.get("urgency", "normal")
    q_arousal = query_emotion.get("arousal", 0.5)
    q_valence = query_emotion.get("valence", 0.0)
    
    # Adjust mode based on emotion
    if q_arousal > 0.7:
        mode = "companion"  # high emotional intensity → companion retrieval
    
    # Get base results
    results = retrieve(query, mode=mode, top_k=top_k * 2, **kwargs)
    
    # Re-score with emotional context
    for atom in results:
        bonus = 0.0
        
        # Urgency: boost recent atoms
        _urgency_bonus = _cfg('emotional_context', 'urgency_recency_bonus', 1.0)
        _neg_valence_bonus = _cfg('emotional_context', 'negative_valence_support_bonus', 0.5)
        if urgency == "high":
            created = datetime.fromisoformat(atom["created_at"])
            hours_old = (datetime.now(timezone.utc) - created).total_seconds() / 3600
            if hours_old < 24:
                bonus += _urgency_bonus
            elif hours_old < 168:
                bonus += _urgency_bonus * 0.5
        
        # Emotional resonance: atoms matching query emotion score higher
        atom_arousal = atom.get("arousal", 0.5)
        atom_valence = atom.get("valence", 0.0)
        
        # Arousal alignment
        arousal_diff = abs(q_arousal - atom_arousal)
        bonus += (1.0 - arousal_diff) * 0.3
        
        # Valence: if query is negative, boost positive atoms (supportive)
        if q_valence < -0.3 and atom_valence > 0.3:
            bonus += _neg_valence_bonus  # surface comforting memories
        # If query is positive, boost positive atoms (celebrate together)
        elif q_valence > 0.3 and atom_valence > 0.3:
            bonus += _neg_valence_bonus * 0.6
        
        atom["_activation"] += bonus
        atom["_emotional_bonus"] = round(bonus, 3)
    
    results.sort(key=lambda x: x["_activation"], reverse=True)
    return results[:top_k]


# ─── Feature: Atom Relationship Types ────────────────────────────

ATOM_RELATIONS_SCHEMA = """
CREATE TABLE IF NOT EXISTS atom_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK(relation_type IN (
        'contradicts', 'elaborates', 'supersedes', 'depends_on',
        'supports', 'refines', 'contextualizes'
    )),
    confidence REAL DEFAULT 0.8,
    created_at TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    UNIQUE(source_id, target_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON atom_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON atom_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON atom_relations(relation_type);
"""


def _ensure_relations_table(conn):
    conn.executescript(ATOM_RELATIONS_SCHEMA)


def add_atom_relation(source_id: str, target_id: str, relation_type: str,
                      confidence: float = 0.8, metadata: dict = None) -> dict:
    """Add a typed relationship between two atoms.
    
    Types:
    - contradicts: atoms assert conflicting facts
    - elaborates: target adds detail to source
    - supersedes: source replaces target (newer/better info)
    - depends_on: source requires target for context
    - supports: source provides evidence for target
    - refines: source is a more precise version of target
    - contextualizes: source provides context for interpreting target
    """
    conn = get_db()
    _ensure_relations_table(conn)
    
    try:
        conn.execute("""
            INSERT INTO atom_relations (source_id, target_id, relation_type, confidence, created_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, target_id, relation_type) DO UPDATE SET
                confidence = ?, metadata = ?
        """, (source_id, target_id, relation_type, confidence,
              datetime.now(timezone.utc).isoformat(), json.dumps(metadata or {}),
              confidence, json.dumps(metadata or {})))
        conn.commit()
    finally:
        conn.close()
    
    return {"source": source_id, "target": target_id, "type": relation_type, "confidence": confidence}


def get_atom_relations(atom_id: str, direction: str = "both") -> list[dict]:
    """Get all typed relationships for an atom.
    
    direction: 'outgoing' (source), 'incoming' (target), 'both'
    """
    conn = get_db()
    _ensure_relations_table(conn)
    
    results = []
    
    if direction in ("outgoing", "both"):
        rows = conn.execute("""
            SELECT r.target_id, r.relation_type, r.confidence, a.content
            FROM atom_relations r
            LEFT JOIN atoms a ON r.target_id = a.id
            WHERE r.source_id = ?
        """, (atom_id,)).fetchall()
        for r in rows:
            results.append({"direction": "outgoing", "partner_id": r[0],
                          "type": r[1], "confidence": r[2],
                          "partner_content": (r[3] or "")[:80]})
    
    if direction in ("incoming", "both"):
        rows = conn.execute("""
            SELECT r.source_id, r.relation_type, r.confidence, a.content
            FROM atom_relations r
            LEFT JOIN atoms a ON r.source_id = a.id
            WHERE r.target_id = ?
        """, (atom_id,)).fetchall()
        for r in rows:
            results.append({"direction": "incoming", "partner_id": r[0],
                          "type": r[1], "confidence": r[2],
                          "partner_content": (r[3] or "")[:80]})
    
    conn.close()
    return results


def retrieve_with_relations(query: str, mode: str = "task",
                            top_k: int = 10, **kwargs) -> list[dict]:
    """Retrieve atoms, then adjust based on relationships.
    
    - If atom A supersedes atom B, prefer A
    - If atom A contradicts atom B, surface both
    - If atom A elaborates atom B, boost A if B is retrieved
    """
    results = retrieve(query, mode=mode, top_k=top_k * 2, **kwargs)
    if not results:
        return results
    
    conn = get_db()
    _ensure_relations_table(conn)
    
    result_ids = {r["id"] for r in results}
    
    # Check for supersedes relationships among results
    superseded = set()
    for atom in results:
        rows = conn.execute("""
            SELECT target_id FROM atom_relations
            WHERE source_id = ? AND relation_type = 'supersedes'
        """, (atom["id"],)).fetchall()
        for r in rows:
            if r[0] in result_ids:
                superseded.add(r[0])  # demote superseded atom
    
    # Check for elaboration relationships
    elaboration_boost = set()
    for atom in results:
        rows = conn.execute("""
            SELECT source_id FROM atom_relations
            WHERE target_id = ? AND relation_type = 'elaborates'
        """, (atom["id"],)).fetchall()
        for r in rows:
            if r[0] in result_ids:
                elaboration_boost.add(r[0])
    
    conn.close()
    
    # Adjust scores
    _supersedes_demotion = _cfg('relations', 'supersedes_demotion', 2.0)
    _supports_bonus = _cfg('relations', 'supports_bonus', 0.5)
    for atom in results:
        if atom["id"] in superseded:
            atom["_activation"] -= _supersedes_demotion  # strong demotion
            atom["_relation_note"] = "superseded"
        if atom["id"] in elaboration_boost:
            atom["_activation"] += _supports_bonus
            atom["_relation_note"] = "elaborates_retrieved"
    
    results.sort(key=lambda x: x["_activation"], reverse=True)
    return results[:top_k]


# ─── Feature: Retrieval Diversity (MMR) ──────────────────────────

def retrieve_diverse(query: str, mode: str = "task", top_k: int = 10,
                     lambda_param: float = None, **kwargs) -> list[dict]:
    """Maximal Marginal Relevance retrieval.
    
    Balances relevance with diversity. lambda_param controls the tradeoff:
    - 1.0 = pure relevance (same as standard retrieve)
    - 0.5 = balanced
    - 0.0 = pure diversity
    
    Proven technique from information retrieval (Carbonell & Goldstein, 1998).
    """
    if lambda_param is None:
        lambda_param = _cfg('retrieval', 'mmr_lambda', 0.7)
    # Get more candidates than needed
    candidates = retrieve(query, mode=mode, top_k=top_k * 3, **kwargs)
    
    if len(candidates) <= top_k:
        return candidates
    
    # Need embeddings for diversity calculation
    conn = get_db()
    candidate_embs = {}
    for atom in candidates:
        row = conn.execute("SELECT embedding FROM atoms WHERE id = ?", (atom["id"],)).fetchone()
        if row and row[0]:
            candidate_embs[atom["id"]] = unpack_embedding(row[0])
    conn.close()
    
    # MMR selection
    selected = [candidates[0]]  # always include top result
    remaining = candidates[1:]
    
    while len(selected) < top_k and remaining:
        best_score = -float('inf')
        best_idx = 0
        
        for i, candidate in enumerate(remaining):
            # Relevance score (normalized)
            relevance = candidate["_activation"] / max(candidates[0]["_activation"], 0.01)
            
            # Max similarity to already-selected atoms
            max_sim = 0.0
            c_emb = candidate_embs.get(candidate["id"])
            if c_emb:
                for s in selected:
                    s_emb = candidate_embs.get(s["id"])
                    if s_emb:
                        sim = cosine_similarity(c_emb, s_emb)
                        max_sim = max(max_sim, sim)
            
            # MMR score
            mmr = lambda_param * relevance - (1 - lambda_param) * max_sim
            
            if mmr > best_score:
                best_score = mmr
                best_idx = i
        
        selected.append(remaining.pop(best_idx))
    
    return selected


# ─── Feature: Cross-Session Continuity ────────────────────────────

def store_session_boundary(session_id: str, summary: str,
                           topics_discussed: list[str] = None,
                           decisions_made: list[str] = None,
                           unfinished: list[str] = None,
                           emotional_state: str = None) -> str:
    """Store a session boundary atom when a session ends.
    
    Creates a structured episodic atom capturing:
    - What was discussed
    - What was decided
    - What was left unfinished
    - Emotional state at close
    
    The agent calls this at session end. Next session can query for continuity:
    'What were we doing last time?'
    """
    boundary_content = f"Session Boundary [{session_id}]: {summary}"
    
    if topics_discussed:
        boundary_content += f"\nTopics: {', '.join(topics_discussed)}"
    if decisions_made:
        boundary_content += f"\nDecisions: {'; '.join(decisions_made)}"
    if unfinished:
        boundary_content += f"\nUnfinished: {'; '.join(unfinished)}"
    if emotional_state:
        boundary_content += f"\nMood at close: {emotional_state}"
    
    # Store as episodic with high confidence
    atom_id = store_atom(
        content=boundary_content,
        stream="episodic",
        profile="standard",
        arousal=0.3,
        valence=0.0,
        topics=topics_discussed or ["session_boundary"],
        source_type="inference",
        encoding_confidence=0.9,
    )
    
    # Log provenance
    log_provenance("atom", atom_id, "session_boundary",
                   metadata={"session_id": session_id,
                            "unfinished_count": len(unfinished or [])})
    
    return atom_id


def get_last_sessions(count: int = 3) -> list[dict]:
    """Get the most recent session boundary atoms. 'What were we doing?'"""
    conn = get_db()
    rows = conn.execute("""
        SELECT id, content, created_at, topics
        FROM atoms WHERE content LIKE 'Session Boundary%' AND state = 'active'
        ORDER BY created_at DESC LIMIT ?
    """, (count,)).fetchall()
    conn.close()
    
    return [{"id": r[0], "content": r[1], "timestamp": r[2],
             "topics": json.loads(r[3] or '[]')} for r in rows]


# ─── Feature: Knowledge Gap Detection ────────────────────────────

def detect_knowledge_gaps(entity: str, expected_relations: list[str] = None) -> dict:
    """Detect what we SHOULD know about an entity but don't.
    
    Compares this entity's knowledge graph to a template of expected relations.
    Uses both triples and atoms.
    
    Default expected relations for a person:
    ['profession', 'location', 'age', 'interests', 'relationships', 'origin', 'schedule']
    """
    if expected_relations is None:
        expected_relations = [
            "profession", "occupation", "job", "career",
            "location", "lives", "based", "hometown",
            "age", "born", "birthday",
            "interests", "likes", "loves", "hobbies",
            "relationships", "partner", "family", "friends",
            "origin", "from", "grew_up",
            "schedule", "routine", "daily",
        ]
    
    conn = get_db()
    
    # Get triples for this entity
    entity_lower = entity.lower()
    triples = conn.execute("""
        SELECT subject, predicate, object FROM triples
        WHERE LOWER(subject) = ? OR LOWER(object) = ?
    """, (entity_lower, entity_lower)).fetchall()
    
    # Get atoms mentioning this entity
    atoms = conn.execute("""
        SELECT content FROM atoms 
        WHERE state = 'active' AND LOWER(content) LIKE ?
    """, (f"%{entity_lower}%",)).fetchall()
    
    conn.close()
    
    # Collect all known predicates/topics
    known_predicates = set()
    for t in triples:
        known_predicates.add(t[1].lower())
    
    # Also scan atom content for relation words
    all_atom_text = " ".join(r[0].lower() for r in atoms)
    
    # Check coverage
    covered = []
    gaps = []
    for rel in expected_relations:
        found = False
        # Check triples
        for pred in known_predicates:
            if rel in pred or pred in rel:
                found = True
                break
        # Check atom text
        if not found and rel in all_atom_text:
            found = True
        
        if found:
            covered.append(rel)
        else:
            gaps.append(rel)
    
    # Deduplicate by concept group
    gap_groups = {}
    concept_map = {
        "profession": ["profession", "occupation", "job", "career"],
        "location": ["location", "lives", "based", "hometown"],
        "age": ["age", "born", "birthday"],
        "interests": ["interests", "likes", "loves", "hobbies"],
        "relationships": ["relationships", "partner", "family", "friends"],
        "origin": ["origin", "from", "grew_up"],
        "schedule": ["schedule", "routine", "daily"],
    }
    
    for group_name, terms in concept_map.items():
        group_covered = any(t in covered for t in terms)
        if not group_covered:
            gap_groups[group_name] = terms
    
    return {
        "entity": entity,
        "triple_count": len(triples),
        "atom_count": len(atoms),
        "covered_relations": list(set(covered)),
        "knowledge_gaps": list(gap_groups.keys()),
        "gap_details": gap_groups,
        "coverage_ratio": round(1 - len(gap_groups) / len(concept_map), 2),
        "recommendation": "comprehensive" if not gap_groups else f"missing: {', '.join(gap_groups.keys())}",
    }


# ─── Feature: Predictive Pre-Retrieval ───────────────────────────

def predict_needed_atoms(context: dict) -> list[dict]:
    """Predict which atoms will be needed before a query arrives.

    Delegates to PredictiveEngine which uses 3 strategies:
    1. Temporal patterns (access_log time correlations)
    2. Co-retrieval patterns (atoms frequently retrieved together)
    3. Topic momentum (recent topics predict next topics)

    Falls back to simple query-based prediction if PredictiveEngine fails.
    """
    try:
        from .prediction import PredictiveEngine
        engine = PredictiveEngine()
        return engine.predict(context, top_k=20)
    except Exception:
        # Fallback to simple prediction
        return _simple_predict(context)


def _simple_predict(context: dict) -> list[dict]:
    """Original simple prediction as fallback.

    Uses hardcoded query construction based on time-of-day and topics
    to run dry retrievals. This is the pre-PredictiveEngine behavior.
    """
    predictions = []
    queries = []

    time_of_day = context.get("time_of_day", "")
    day_type = context.get("day_type", "")
    recent_topics = context.get("recent_topics", [])
    _default_user_active = _cfg('predictive_retrieval', 'user_active', False)
    user_active = context.get("user_active", _default_user_active)

    # Time-based predictions
    if time_of_day in ("evening", "night") and day_type == "show_day":
        queries.append("post-show check-in how was the show")
        queries.append("user's current emotional state")

    if time_of_day == "morning":
        queries.append("user's schedule today")
        queries.append("active tasks and unfinished work")

    # Topic continuation
    for topic in recent_topics[:3]:
        queries.append(topic)

    # User presence
    if user_active:
        queries.append("recent conversations with user")
        queries.append("user's current interests and preferences")

    # Run dry retrievals (no side effects)
    seen_ids = set()
    for q in queries:
        results = dry_retrieve(q, mode="companion" if user_active else "task", top_k=5)
        for atom in results:
            if atom["id"] not in seen_ids:
                seen_ids.add(atom["id"])
                predictions.append({
                    "id": atom["id"],
                    "content": atom["content"][:100],
                    "predicted_by": q,
                    "activation": atom["_activation"],
                })

    # Sort by activation and cap
    predictions.sort(key=lambda x: x["activation"], reverse=True)
    return predictions[:20]


def pre_warm_context(context: dict) -> dict:
    """Run predictive pre-retrieval and store results as working memory.
    
    Called at session start by the agent. Predicted atoms go into working memory
    for instant access. If not used, they expire naturally.
    """
    predictions = predict_needed_atoms(context)
    
    warmed = 0
    for pred in predictions[:10]:  # cap at 10 pre-warmed atoms
        try:
            store_working(
                content=f"[pre-warmed] {pred['content']}",
                ttl_minutes=30,
                metadata={"predicted_by": pred["predicted_by"], "source_atom": pred["id"]},
            )
            warmed += 1
        except Exception:
            pass
    
    return {
        "predicted": len(predictions),
        "pre_warmed": warmed,
        "queries_used": [p["predicted_by"] for p in predictions[:10]],
    }


# ─── Feature: Episodic Replay ─────────────────────────────────────

def episodic_replay(entity_or_topic: str, since: str = None,
                    before: str = None, max_events: int = 50) -> list[dict]:
    """Retrieve episodic atoms as a structured timeline with episode boundaries.

    Returns chronologically sorted atoms grouped into episodes. An episode
    boundary is detected when the gap between consecutive atoms exceeds
    4 hours.

    Args:
        entity_or_topic: Topic string or entity name to search for.
        since: ISO datetime lower bound (optional).
        before: ISO datetime upper bound (optional).
        max_events: Maximum atoms to return.

    Returns:
        List of episode dicts, each with start, end, and atoms.
    """
    conn = get_db()

    # Try FTS5 first for topic matching, then fall back to atom_topics + LIKE
    atom_rows = []
    try:
        fts_query = _fts5_query(entity_or_topic)
        sql = """
            SELECT a.id, a.content, a.created_at, a.stream, a.topics, a.arousal, a.valence
            FROM atoms_fts f JOIN atoms a ON a.rowid = f.rowid
            WHERE atoms_fts MATCH ? AND a.stream = 'episodic' AND a.state IN ('active', 'fading')
        """
        params = [fts_query]
        if since:
            sql += " AND a.created_at >= ?"
            params.append(since)
        if before:
            sql += " AND a.created_at <= ?"
            params.append(before)
        sql += " ORDER BY a.created_at ASC LIMIT ?"
        params.append(max_events)
        atom_rows = conn.execute(sql, params).fetchall()
    except Exception:
        pass

    # Fallback: atom_topics JOIN + content LIKE
    if not atom_rows:
        topic_lower = entity_or_topic.lower()
        sql = """
            SELECT DISTINCT a.id, a.content, a.created_at, a.stream, a.topics, a.arousal, a.valence
            FROM atoms a
            LEFT JOIN atom_topics at ON a.id = at.atom_id
            WHERE a.stream = 'episodic' AND a.state IN ('active', 'fading')
              AND (at.topic LIKE ? OR a.content LIKE ?)
        """
        params = [f"%{topic_lower}%", f"%{topic_lower}%"]
        if since:
            sql += " AND a.created_at >= ?"
            params.append(since)
        if before:
            sql += " AND a.created_at <= ?"
            params.append(before)
        sql += " ORDER BY a.created_at ASC LIMIT ?"
        params.append(max_events)
        atom_rows = conn.execute(sql, params).fetchall()

    conn.close()

    if not atom_rows:
        return []

    # Build chronological list
    atoms = []
    for row in atom_rows:
        atoms.append({
            "id": row["id"],
            "content": row["content"],
            "timestamp": row["created_at"],
            "stream": row["stream"],
            "topics": json.loads(row["topics"]) if isinstance(row["topics"], str) else (row["topics"] or []),
        })

    # Detect episode boundaries (gap > 4 hours)
    EPISODE_GAP_HOURS = 4
    episodes = []
    current_episode = {"episode_id": 1, "atoms": [atoms[0]],
                       "start": atoms[0]["timestamp"]}

    for i in range(1, len(atoms)):
        prev_ts = atoms[i - 1]["timestamp"]
        curr_ts = atoms[i]["timestamp"]
        try:
            prev_dt = datetime.fromisoformat(prev_ts)
            curr_dt = datetime.fromisoformat(curr_ts)
            gap_hours = (curr_dt - prev_dt).total_seconds() / 3600
        except (ValueError, TypeError):
            gap_hours = 0

        if gap_hours > EPISODE_GAP_HOURS:
            # Close current episode
            current_episode["end"] = atoms[i - 1]["timestamp"]
            episodes.append(current_episode)
            # Start new episode
            current_episode = {
                "episode_id": len(episodes) + 1,
                "atoms": [atoms[i]],
                "start": atoms[i]["timestamp"],
            }
        else:
            current_episode["atoms"].append(atoms[i])

    # Close last episode
    current_episode["end"] = atoms[-1]["timestamp"]
    episodes.append(current_episode)

    return episodes


# ─── Feature: Atom Pinning ───────────────────────────────────────

def pin_atom(atom_id: str, reason: str = None) -> dict:
    """Pin an atom so it never decays. Foundational facts should be pinned."""
    conn = get_db()
    row = conn.execute("SELECT metadata, content FROM atoms WHERE id = ?", (atom_id,)).fetchone()
    if not row:
        conn.close()
        return {"error": "Atom not found"}

    meta = json.loads(row[0] or '{}')
    meta["pinned"] = True
    meta["pinned_at"] = datetime.now(timezone.utc).isoformat()
    if reason:
        meta["pin_reason"] = reason

    conn.execute("UPDATE atoms SET metadata = ?, is_pinned = 1 WHERE id = ?",
                 (json.dumps(meta), atom_id))
    conn.commit()
    conn.close()

    return {"atom_id": atom_id, "pinned": True, "reason": reason,
            "content_preview": row[1][:80]}


def unpin_atom(atom_id: str) -> dict:
    """Remove pin from an atom, allowing normal decay."""
    conn = get_db()
    row = conn.execute("SELECT metadata FROM atoms WHERE id = ?", (atom_id,)).fetchone()
    if not row:
        conn.close()
        return {"error": "Atom not found"}

    meta = json.loads(row[0] or '{}')
    meta.pop("pinned", None)
    meta.pop("pinned_at", None)
    meta.pop("pin_reason", None)

    conn.execute("UPDATE atoms SET metadata = ?, is_pinned = 0 WHERE id = ?",
                 (json.dumps(meta), atom_id))
    conn.commit()
    conn.close()
    return {"atom_id": atom_id, "pinned": False}


def list_pinned() -> list[dict]:
    """List all pinned atoms."""
    conn = get_db()
    rows = conn.execute("""
        SELECT id, content, metadata FROM atoms
        WHERE state = 'active' AND is_pinned = 1
    """).fetchall()
    conn.close()

    results = []
    for r in rows:
        meta = json.loads(r[2] or '{}')
        results.append({
            "id": r[0], "content": r[1][:100],
            "pinned_at": meta.get("pinned_at", ""),
            "reason": meta.get("pin_reason", ""),
        })
    return results


def is_pinned(atom: dict) -> bool:
    """Check if an atom is pinned. Uses denormalized is_pinned column."""
    if "is_pinned" in atom:
        return bool(atom["is_pinned"])
    # Fallback for dicts without the column
    meta = atom.get("metadata", "{}")
    if isinstance(meta, str):
        meta = json.loads(meta)
    return meta.get("pinned", False)


# ─── Feature: Retrieval Caching ──────────────────────────────────

class EmbeddingCache:
    """Session-scoped LRU cache for query embeddings.
    
    Same query in the same session shouldn't hit the API twice.
    Saves latency and API calls.
    """
    
    def __init__(self, max_size: int = 64):
        self._cache = {}  # query_text -> embedding vector
        self._order = []  # LRU order
        self._max_size = max_size
        self._hits = 0
        self._misses = 0
        self._lock = threading.Lock()

    def get(self, query: str) -> list[float]:
        """Get cached embedding or None. Thread-safe."""
        with self._lock:
            if query in self._cache:
                self._hits += 1
                # Move to end (most recent)
                self._order.remove(query)
                self._order.append(query)
                return self._cache[query]
            self._misses += 1
            return None

    def put(self, query: str, embedding: list[float]):
        """Cache an embedding. Thread-safe."""
        with self._lock:
            if query in self._cache:
                self._order.remove(query)
            elif len(self._cache) >= self._max_size:
                # Evict oldest
                oldest = self._order.pop(0)
                del self._cache[oldest]

            self._cache[query] = embedding
            self._order.append(query)

    def stats(self) -> dict:
        with self._lock:
            total = self._hits + self._misses
            return {
                "size": len(self._cache),
                "max_size": self._max_size,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(self._hits / max(total, 1), 3),
            }

    def clear(self):
        with self._lock:
            self._cache.clear()
            self._order.clear()
            self._hits = 0
            self._misses = 0


# Global cache instance
_embedding_cache = EmbeddingCache()


def cached_embed_query(query: str) -> list[float]:
    """Embed a query with caching. Drop-in replacement for embed_query."""
    cached = _embedding_cache.get(query)
    if cached is not None:
        return cached
    
    emb = embed_query(query)
    _embedding_cache.put(query, emb)
    return emb


def get_cache_stats() -> dict:
    """Get embedding cache statistics."""
    return _embedding_cache.stats()


def clear_cache():
    """Clear the embedding cache (e.g., at session end)."""
    _embedding_cache.clear()


# ─── Feature: Atom Splitting ─────────────────────────────────────

def split_atom(atom_id: str, segments: list[str]) -> dict:
    """Split one atom into multiple focused atoms.
    
    Inverse of merge. The parent atom is tombstoned.
    Each segment becomes a new atom inheriting the parent's stream,
    arousal, valence, and source_type. Triples are NOT reassigned
    (new triples will be extracted from the children).
    
    segments: list of content strings for each new atom.
    """
    conn = get_db()
    parent = conn.execute("SELECT * FROM atoms WHERE id = ?", (atom_id,)).fetchone()
    if not parent:
        conn.close()
        return {"error": "Atom not found"}
    
    parent = dict(parent)
    conn.close()
    
    # Save version before splitting
    save_atom_version(atom_id, parent["content"], changed_by="splitter",
                      change_reason=f"split into {len(segments)} atoms")
    
    # Create child atoms
    children = []
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        
        child_id = store_atom(
            content=seg,
            stream=parent["stream"],
            profile=parent["profile"],
            arousal=parent["arousal"],
            valence=parent["valence"],
            topics=json.loads(parent["topics"] or "[]"),
            encoding_confidence=parent["encoding_confidence"],
            source_type=parent["source_type"],
        )
        
        if child_id:
            children.append({"id": child_id, "content": seg[:80]})
            # Log provenance
            log_provenance("atom", child_id, "split_from",
                          parent_type="atom", parent_id=atom_id)
    
    # Tombstone parent
    conn = get_db()
    conn.execute("UPDATE atoms SET state = 'tombstone' WHERE id = ?", (atom_id,))
    conn.commit()
    conn.close()
    
    _fire_hook('on_correct', atom_id=atom_id, action='split',
               children=[c["id"] for c in children])
    
    return {
        "parent_id": atom_id,
        "parent_tombstoned": True,
        "children": children,
        "child_count": len(children),
    }


# ─── Feature: Confidence Decay ───────────────────────────────────

def decay_confidence(max_age_days: int = 90, decay_rate: float = None) -> dict:
    """Time-based confidence decay for unconfirmed facts.
    
    Facts lose confidence slowly if not reconfirmed.
    Rate: decay_rate per day since last confirmation.
    
    Pinned atoms and atoms confirmed in the last 7 days are exempt.
    Floor: 0.1 (never reaches zero -- tombstone handles that).
    
    Called during decay cycle.
    """
    if decay_rate is None:
        decay_rate = _cfg('decay', 'confidence_decay_rate', 0.01)
    _grace_days = _cfg('decay', 'confidence_decay_grace_days', 7)
    _conf_floor = _cfg('decay', 'confidence_floor', 0.1)
    conn = get_db()
    now = datetime.now(timezone.utc)
    
    rows = conn.execute("""
        SELECT id, encoding_confidence, last_accessed_at, created_at, is_pinned
        FROM atoms WHERE state = 'active'
    """).fetchall()

    decayed = 0
    exempt_pinned = 0
    exempt_recent = 0

    for row in rows:
        atom_id = row[0]
        confidence = row[1]
        last_access = row[2] or row[3]

        # Skip pinned -- use denormalized is_pinned column
        if row[4]:
            exempt_pinned += 1
            continue
        
        # Calculate days since last access/confirmation
        try:
            last_dt = datetime.fromisoformat(last_access)
            days_since = (now - last_dt).total_seconds() / 86400
        except (ValueError, TypeError):
            days_since = 30  # default if timestamp is bad
        
        # Exempt if accessed within grace period
        if days_since < _grace_days:
            exempt_recent += 1
            continue
        
        # Decay: confidence -= decay_rate * (days_since - grace_days)
        # Only decay the days BEYOND the grace period
        decay_amount = decay_rate * (days_since - _grace_days)
        new_confidence = max(_conf_floor, confidence - decay_amount)
        
        if new_confidence < confidence:
            conn.execute("UPDATE atoms SET encoding_confidence = ? WHERE id = ?",
                        (round(new_confidence, 4), atom_id))
            decayed += 1
    
    conn.commit()
    conn.close()
    
    return {
        "atoms_checked": len(rows),
        "decayed": decayed,
        "exempt_pinned": exempt_pinned,
        "exempt_recent": exempt_recent,
        "decay_rate": decay_rate,
        "grace_period_days": _grace_days,
    }


# ─── Feature: Access Analytics ───────────────────────────────────

def analyze_access_patterns(days: int = 30) -> dict:
    """Analyze retrieval patterns from access_log.
    
    Returns:
    - Top retrieved atoms (most popular)
    - Topic frequency (what gets asked about most)
    - Time-of-day distribution
    - Contribution rates by topic
    - Zero-contribution queries (retrieval waste)
    """
    conn = get_db()
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    # Top retrieved atoms
    top_atoms = conn.execute("""
        SELECT a.atom_id, COUNT(*) as cnt, 
               SUM(CASE WHEN a.contributed = 1 THEN 1 ELSE 0 END) as contributed,
               at.content, at.topics
        FROM access_log a
        LEFT JOIN atoms at ON a.atom_id = at.id
        WHERE a.accessed_at > ?
        GROUP BY a.atom_id
        ORDER BY cnt DESC LIMIT 20
    """, (cutoff,)).fetchall()
    
    top_atom_list = []
    for r in top_atoms:
        total = r[1]
        contrib = r[2]
        rate = contrib / max(total, 1)
        top_atom_list.append({
            "atom_id": r[0],
            "retrievals": total,
            "contributions": contrib,
            "contribution_rate": round(rate, 3),
            "content": (r[3] or "")[:80],
            "topics": json.loads(r[4] or "[]"),
        })
    
    # Time-of-day distribution
    hour_dist = conn.execute("""
        SELECT CAST(SUBSTR(accessed_at, 12, 2) AS INTEGER) as hour, COUNT(*) as cnt
        FROM access_log WHERE accessed_at > ?
        GROUP BY hour ORDER BY hour
    """, (cutoff,)).fetchall()
    
    hourly = {r[0]: r[1] for r in hour_dist}
    
    # Topic frequency from retrieved atoms
    topic_counts = {}
    for row in top_atoms:
        topics = json.loads(row[4] or "[]")
        for t in topics:
            topic_counts[t] = topic_counts.get(t, 0) + row[1]
    
    top_topics = sorted(topic_counts.items(), key=lambda x: -x[1])[:15]
    
    # Overall stats
    total_retrievals = conn.execute(
        "SELECT COUNT(*) FROM access_log WHERE accessed_at > ?", (cutoff,)
    ).fetchone()[0]
    
    total_contributed = conn.execute(
        "SELECT COUNT(*) FROM access_log WHERE accessed_at > ? AND contributed = 1", (cutoff,)
    ).fetchone()[0]
    
    total_not_contributed = conn.execute(
        "SELECT COUNT(*) FROM access_log WHERE accessed_at > ? AND contributed = 0", (cutoff,)
    ).fetchone()[0]
    
    conn.close()
    
    known = total_contributed + total_not_contributed
    
    return {
        "period_days": days,
        "total_retrievals": total_retrievals,
        "contribution_rate": round(total_contributed / max(known, 1), 3) if known > 0 else "unknown",
        "top_atoms": top_atom_list[:10],
        "top_topics": [{"topic": t, "retrievals": c} for t, c in top_topics],
        "hourly_distribution": hourly,
        "peak_hour": max(hourly, key=hourly.get) if hourly else None,
        "unique_atoms_retrieved": len(top_atoms),
    }
