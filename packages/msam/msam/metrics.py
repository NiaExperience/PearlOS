"""
MSAM Metrics -- Statistics collection for Grafana visualization.
Stores time-series metrics in SQLite for lightweight monitoring.
"""

import sqlite3
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from .config import get_config, get_data_dir
_cfg = get_config()

METRICS_DB = get_data_dir() / _cfg('storage', 'metrics_db_path', 'msam_metrics.db')

METRICS_SCHEMA = """
CREATE TABLE IF NOT EXISTS retrieval_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    query TEXT,
    mode TEXT,  -- task/companion
    atoms_returned INTEGER,
    tokens_used INTEGER,
    latency_ms REAL,
    avg_activation REAL,
    avg_similarity REAL,
    top_score REAL,
    top_stream TEXT,
    topics_hit TEXT  -- JSON array
);

CREATE TABLE IF NOT EXISTS store_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    atom_id TEXT,
    stream TEXT,
    profile TEXT,
    arousal REAL,
    valence REAL,
    source_type TEXT,
    content_tokens INTEGER
);

CREATE TABLE IF NOT EXISTS system_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    total_atoms INTEGER,
    active_atoms INTEGER,
    fading_atoms INTEGER,
    dormant_atoms INTEGER,
    total_tokens INTEGER,
    db_size_kb REAL,
    total_accesses INTEGER,
    avg_activation REAL,
    streams_json TEXT,  -- {"semantic": N, "episodic": N, ...}
    profiles_json TEXT  -- {"lightweight": N, "standard": N, "full": N}
);

CREATE TABLE IF NOT EXISTS comparison_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    query TEXT,
    msam_tokens INTEGER,
    msam_latency_ms REAL,
    msam_atoms INTEGER,
    markdown_tokens INTEGER,
    markdown_latency_ms REAL,
    markdown_results INTEGER,
    token_savings_pct REAL,
    info_density_ratio REAL
);

CREATE TABLE IF NOT EXISTS access_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    caller TEXT,
    query TEXT,
    mode TEXT,
    atoms_accessed INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    latency_ms REAL DEFAULT 0,
    activation_min REAL,
    activation_max REAL,
    activation_p50 REAL,
    activation_p90 REAL,
    similarity_min REAL,
    similarity_max REAL,
    topics_hit TEXT,
    detail TEXT
);

CREATE TABLE IF NOT EXISTS canary_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    query TEXT,
    top_atom_id TEXT,
    top_score REAL,
    atoms_returned INTEGER,
    latency_ms REAL,
    result_hash TEXT
);

CREATE TABLE IF NOT EXISTS decay_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    atoms_faded INTEGER DEFAULT 0,
    atoms_dormant INTEGER DEFAULT 0,
    atoms_compacted INTEGER DEFAULT 0,
    tokens_freed INTEGER DEFAULT 0,
    budget_before_pct REAL,
    budget_after_pct REAL,
    total_active INTEGER,
    total_fading INTEGER,
    total_dormant INTEGER
);

CREATE TABLE IF NOT EXISTS emotional_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    arousal REAL,
    valence REAL,
    primary_state TEXT,
    secondary_state TEXT,
    intensity REAL,
    warmth REAL
);

CREATE TABLE IF NOT EXISTS topic_timeseries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    topic TEXT NOT NULL,
    frequency INTEGER DEFAULT 1,
    source TEXT DEFAULT 'retrieval'
);

CREATE TABLE IF NOT EXISTS embedding_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    operation TEXT NOT NULL,
    latency_ms REAL,
    input_length INTEGER,
    success INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS age_distribution (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    bucket_lt1d INTEGER DEFAULT 0,
    bucket_1to3d INTEGER DEFAULT 0,
    bucket_3to7d INTEGER DEFAULT 0,
    bucket_7to14d INTEGER DEFAULT 0,
    bucket_14to30d INTEGER DEFAULT 0,
    bucket_gt30d INTEGER DEFAULT 0,
    total_active INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS continuity_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    session_type TEXT,
    atoms_retrieved TEXT,
    topics_predicted TEXT,
    topics_actual TEXT,
    overlap_score REAL,
    atoms_used INTEGER DEFAULT 0,
    atoms_total INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_retrieval_ts ON retrieval_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_store_ts ON store_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_system_ts ON system_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_comparison_ts ON comparison_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_access_events_ts ON access_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_access_events_type ON access_events(event_type);
CREATE INDEX IF NOT EXISTS idx_canary_ts ON canary_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_decay_ts ON decay_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_emotional_ts ON emotional_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_topic_ts ON topic_timeseries(timestamp);
CREATE INDEX IF NOT EXISTS idx_topic_name ON topic_timeseries(topic);
CREATE INDEX IF NOT EXISTS idx_embedding_ts ON embedding_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_age_dist_ts ON age_distribution(timestamp);
CREATE INDEX IF NOT EXISTS idx_continuity_ts ON continuity_metrics(timestamp);

CREATE TABLE IF NOT EXISTS agreement_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    agent_id TEXT DEFAULT 'default',
    signal TEXT CHECK(signal IN ('agree','disagree','neutral','challenge')),
    context TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agreement_agent ON agreement_signals(agent_id, created_at);
"""


def get_metrics_db() -> sqlite3.Connection:
    METRICS_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(METRICS_DB))
    conn.row_factory = sqlite3.Row
    conn.executescript(METRICS_SCHEMA)
    return conn


def log_retrieval(query, mode, results, latency_ms):
    """Log a retrieval operation."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    
    tokens = sum(len(r.get("content", "")) // 4 for r in results)
    activations = [r.get("_activation", r.get("_combined_score", 0)) for r in results]
    similarities = [r.get("_similarity", 0) for r in results]
    
    all_topics = set()
    for r in results:
        topics = json.loads(r.get("topics", "[]")) if isinstance(r.get("topics"), str) else r.get("topics", [])
        all_topics.update(topics)
    
    conn.execute("""
        INSERT INTO retrieval_metrics 
        (timestamp, query, mode, atoms_returned, tokens_used, latency_ms,
         avg_activation, avg_similarity, top_score, top_stream, topics_hit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        now, query, mode, len(results), tokens, latency_ms,
        sum(activations) / len(activations) if activations else 0,
        sum(similarities) / len(similarities) if similarities else 0,
        max(activations) if activations else 0,
        results[0].get("stream", "") if results else "",
        json.dumps(list(all_topics)),
    ))
    conn.commit()
    conn.close()


def log_store(atom_id, stream, profile, arousal, valence, source_type, content_tokens):
    """Log an atom store operation."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    
    conn.execute("""
        INSERT INTO store_metrics
        (timestamp, atom_id, stream, profile, arousal, valence, source_type, content_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (now, atom_id, stream, profile, arousal, valence, source_type, content_tokens))
    conn.commit()
    conn.close()


def log_system_snapshot():
    """Capture current system state."""
    from .core import get_db, get_stats
    
    conn_main = get_db()
    stats = get_stats()
    
    fading = conn_main.execute("SELECT COUNT(*) FROM atoms WHERE state = 'fading'").fetchone()[0]
    dormant = conn_main.execute("SELECT COUNT(*) FROM atoms WHERE state = 'dormant'").fetchone()[0]
    conn_main.close()
    
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    
    conn.execute("""
        INSERT INTO system_metrics
        (timestamp, total_atoms, active_atoms, fading_atoms, dormant_atoms,
         total_tokens, db_size_kb, total_accesses, avg_activation,
         streams_json, profiles_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        now, stats["total_atoms"], stats["active_atoms"], fading, dormant,
        stats["est_active_tokens"], stats["db_size_kb"],
        stats["total_accesses"], stats["avg_activation"],
        json.dumps(stats["by_stream"]), json.dumps(stats["by_profile"]),
    ))
    conn.commit()
    conn.close()


def log_comparison(query, msam_tokens, msam_latency_ms, msam_atoms,
                   md_tokens, md_latency_ms, md_results):
    """Log a comparison between MSAM and markdown retrieval."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    
    savings = ((md_tokens - msam_tokens) / md_tokens * 100) if md_tokens > 0 else 0
    density = (0.9 / 0.5) if md_tokens > 0 else 0  # MSAM vs grep info density
    
    conn.execute("""
        INSERT INTO comparison_metrics
        (timestamp, query, msam_tokens, msam_latency_ms, msam_atoms,
         markdown_tokens, markdown_latency_ms, markdown_results,
         token_savings_pct, info_density_ratio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        now, query, msam_tokens, msam_latency_ms, msam_atoms,
        md_tokens, md_latency_ms, md_results, savings, density
    ))
    conn.commit()
    conn.close()


def log_access_event(
    event_type,
    caller="unknown",
    query=None,
    mode=None,
    atoms_accessed=0,
    tokens_used=0,
    latency_ms=0.0,
    activation_min=None,
    activation_max=None,
    activation_p50=None,
    activation_p90=None,
    similarity_min=None,
    similarity_max=None,
    topics_hit=None,
    detail=None,
):
    """Log every single MSAM access event with full detail."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()

    topics_str = json.dumps(topics_hit) if topics_hit is not None else None

    conn.execute("""
        INSERT INTO access_events
        (timestamp, event_type, caller, query, mode, atoms_accessed, tokens_used,
         latency_ms, activation_min, activation_max, activation_p50, activation_p90,
         similarity_min, similarity_max, topics_hit, detail)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        now, event_type, caller, query, mode, atoms_accessed, tokens_used,
        latency_ms, activation_min, activation_max, activation_p50, activation_p90,
        similarity_min, similarity_max, topics_str, detail,
    ))
    conn.commit()
    conn.close()


def log_decay_event(
    atoms_faded=0,
    atoms_dormant=0,
    atoms_compacted=0,
    tokens_freed=0,
    budget_before=None,
    budget_after=None,
    total_active=None,
    total_fading=None,
    total_dormant=None,
):
    """Log a decay cycle to the decay_metrics table."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()

    conn.execute("""
        INSERT INTO decay_metrics
        (timestamp, atoms_faded, atoms_dormant, atoms_compacted, tokens_freed,
         budget_before_pct, budget_after_pct, total_active, total_fading, total_dormant)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        now, atoms_faded, atoms_dormant, atoms_compacted, tokens_freed,
        budget_before, budget_after, total_active, total_fading, total_dormant,
    ))
    conn.commit()
    conn.close()


def log_canary(query, top_atom_id, top_score, atoms_returned, latency_ms, result_hash):
    """Log a canary monitoring run."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()

    conn.execute("""
        INSERT INTO canary_metrics
        (timestamp, query, top_atom_id, top_score, atoms_returned, latency_ms, result_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (now, query, top_atom_id, top_score, atoms_returned, latency_ms, result_hash))
    conn.commit()
    conn.close()


def _compute_activation_stats(results):
    """Compute min/max/p50/p90 from result activation scores."""
    scores = sorted([r.get("_activation", r.get("_combined_score", 0)) for r in results])
    similarities = sorted([r.get("_similarity", 0) for r in results])
    if not scores:
        return None, None, None, None, None, None
    n = len(scores)
    p50_idx = max(0, int(n * 0.5) - 1)
    p90_idx = max(0, int(n * 0.9) - 1)
    sim_min = min(similarities) if similarities else None
    sim_max = max(similarities) if similarities else None
    return (
        min(scores),
        max(scores),
        scores[p50_idx],
        scores[p90_idx],
        sim_min,
        sim_max,
    )


def get_retrieval_history(limit=None):
    """Get recent retrieval metrics for API/dashboard."""
    if limit is None:
        limit = _cfg('metrics', 'retrieval_history_limit', 100)
    conn = get_metrics_db()
    rows = conn.execute(
        "SELECT * FROM retrieval_metrics ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_system_history(limit=None):
    """Get system metrics history."""
    if limit is None:
        limit = _cfg('metrics', 'continuity_history_limit', 100)
    conn = get_metrics_db()
    rows = conn.execute(
        "SELECT * FROM system_metrics ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def log_emotional_state(arousal, valence, primary_state, secondary_state=None, intensity=None, warmth=None):
    """Log current emotional state snapshot."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("""
        INSERT INTO emotional_metrics
        (timestamp, arousal, valence, primary_state, secondary_state, intensity, warmth)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (now, arousal, valence, primary_state, secondary_state, intensity, warmth))
    conn.commit()
    conn.close()


def log_topic_hits(topics, source="retrieval"):
    """Log topic occurrences from a retrieval or store event."""
    if not topics:
        return
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    for topic in topics:
        conn.execute("""
            INSERT INTO topic_timeseries (timestamp, topic, frequency, source)
            VALUES (?, ?, 1, ?)
        """, (now, topic, source))
    conn.commit()
    conn.close()


def log_embedding(operation, latency_ms, input_length, success=True):
    """Log an embedding API call."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("""
        INSERT INTO embedding_metrics
        (timestamp, operation, latency_ms, input_length, success)
        VALUES (?, ?, ?, ?, ?)
    """, (now, operation, latency_ms, input_length, 1 if success else 0))
    conn.commit()
    conn.close()


def log_age_distribution():
    """Compute and log current atom age distribution."""
    from .core import get_db
    conn_main = get_db()
    now = datetime.now(timezone.utc).isoformat()

    row = conn_main.execute("""
        SELECT
            SUM(CASE WHEN (julianday('now') - julianday(created_at)) < 1 THEN 1 ELSE 0 END) AS lt1d,
            SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 1
                      AND (julianday('now') - julianday(created_at)) < 3 THEN 1 ELSE 0 END) AS d1to3,
            SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 3
                      AND (julianday('now') - julianday(created_at)) < 7 THEN 1 ELSE 0 END) AS d3to7,
            SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 7
                      AND (julianday('now') - julianday(created_at)) < 14 THEN 1 ELSE 0 END) AS d7to14,
            SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 14
                      AND (julianday('now') - julianday(created_at)) < 30 THEN 1 ELSE 0 END) AS d14to30,
            SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 30 THEN 1 ELSE 0 END) AS gt30d,
            COUNT(*) AS total_active
        FROM atoms WHERE state = 'active'
    """).fetchone()
    conn_main.close()

    buckets = tuple(v or 0 for v in row)

    conn = get_metrics_db()
    conn.execute("""
        INSERT INTO age_distribution
        (timestamp, bucket_lt1d, bucket_1to3d, bucket_3to7d, bucket_7to14d,
         bucket_14to30d, bucket_gt30d, total_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (now,) + buckets)
    conn.commit()
    conn.close()


def log_continuity_start(session_type, atom_ids, topics_predicted, atoms_total):
    """Log the start of a session with predicted topics. Returns the row ID for later update."""
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    cur = conn.execute("""
        INSERT INTO continuity_metrics
        (timestamp, session_type, atoms_retrieved, topics_predicted, atoms_total)
        VALUES (?, ?, ?, ?, ?)
    """, (
        now,
        session_type,
        json.dumps(atom_ids),
        json.dumps(topics_predicted),
        atoms_total,
    ))
    row_id = cur.lastrowid
    conn.commit()
    conn.close()
    return row_id


def log_continuity_end(row_id, topics_actual, atoms_used):
    """Update a continuity record with actual session data and compute overlap_score."""
    conn = get_metrics_db()

    row = conn.execute(
        "SELECT topics_predicted FROM continuity_metrics WHERE id = ?", (row_id,)
    ).fetchone()

    overlap_score = 0.0
    if row and row[0]:
        predicted = set(json.loads(row[0]))
        actual = set(topics_actual)
        union = predicted | actual
        overlap_score = len(predicted & actual) / len(union) if union else 0.0

    conn.execute("""
        UPDATE continuity_metrics
        SET topics_actual = ?, overlap_score = ?, atoms_used = ?
        WHERE id = ?
    """, (json.dumps(topics_actual), overlap_score, atoms_used, row_id))
    conn.commit()
    conn.close()


def log_retrieval_miss(query, mode, top_activation, threshold=2.0):
    """Log when a retrieval's top result is below quality threshold.
    Stores as an access_event with event_type='retrieval_miss'."""
    log_access_event(
        event_type="retrieval_miss",
        query=query,
        mode=mode,
        activation_max=top_activation,
        detail=json.dumps({"threshold": threshold, "top_activation": top_activation}),
    )


def log_cache_stats(hits, misses, cache_size, hit_rate):
    """Log embedding cache hit/miss stats."""
    conn = get_metrics_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cache_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            hits INTEGER, misses INTEGER, cache_size INTEGER, hit_rate REAL
        )
    """)
    conn.execute(
        "INSERT INTO cache_metrics (timestamp, hits, misses, cache_size, hit_rate) VALUES (?, ?, ?, ?, ?)",
        (datetime.now(timezone.utc).isoformat(), hits, misses, cache_size, hit_rate),
    )
    conn.commit()
    conn.close()


def record_agreement(signal, context=None, session_id=None, agent_id='default'):
    """Record an agreement/disagreement signal.

    Parameters
    ----------
    signal : str
        One of 'agree', 'disagree', 'neutral', 'challenge'.
    context : str, optional
        Free-text context about what was agreed/disagreed with.
    session_id : str, optional
    agent_id : str

    Returns
    -------
    dict
        Confirmation with current rate.
    """
    conn = get_metrics_db()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO agreement_signals (session_id, agent_id, signal, context, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (session_id, agent_id, signal, context, now),
    )
    conn.commit()
    conn.close()

    # Return current rate after recording
    rate_info = get_agreement_rate(agent_id=agent_id)
    return {"recorded": signal, "agent_id": agent_id, "current_rate": rate_info}


def get_agreement_rate(agent_id='default', window=None):
    """Calculate agreement rate over last N interactions.

    Parameters
    ----------
    agent_id : str
    window : int, optional
        Number of recent signals to consider. Defaults from config.

    Returns
    -------
    dict
        {rate, count, warning, signals}
    """
    if window is None:
        window = _cfg('sycophancy', 'window_size', 20)
    threshold = _cfg('sycophancy', 'warning_threshold', 0.85)

    conn = get_metrics_db()
    rows = conn.execute(
        """SELECT signal FROM agreement_signals
           WHERE agent_id = ?
           ORDER BY created_at DESC LIMIT ?""",
        (agent_id, window),
    ).fetchall()
    conn.close()

    if not rows:
        return {"rate": 0.0, "count": 0, "warning": False, "signals": []}

    signals = [r["signal"] for r in rows]
    agree_count = sum(1 for s in signals if s == "agree")
    total = len(signals)
    rate = agree_count / total if total > 0 else 0.0

    warning = rate >= threshold and total >= window
    result = {
        "rate": round(rate, 3),
        "count": total,
        "agree_count": agree_count,
        "warning": warning,
        "signals": signals,
    }
    if warning:
        result["warning_message"] = (
            f"Agreement rate {rate:.0%} over last {total} interactions exceeds "
            f"threshold ({threshold:.0%}). Consider increasing pushback."
        )
    return result


def prune_old_metrics(days=30):
    """Delete metrics older than N days from all tables."""
    from datetime import timedelta
    conn = get_metrics_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    tables = [
        "retrieval_metrics", "store_metrics", "system_metrics",
        "comparison_metrics", "access_events", "canary_metrics",
        "decay_metrics", "emotional_metrics", "topic_timeseries",
        "embedding_metrics", "age_distribution", "continuity_metrics",
        "cache_metrics", "agreement_signals",
    ]
    
    total_deleted = 0
    for table in tables:
        try:
            cursor = conn.execute(f"DELETE FROM {table} WHERE timestamp < ?", (cutoff,))
            total_deleted += cursor.rowcount
        except Exception:
            pass  # table may not exist
    
    conn.commit()
    conn.close()
    # VACUUM must run outside a transaction
    conn2 = get_metrics_db()
    conn2.execute("VACUUM")
    conn2.close()
    return total_deleted


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    if "--prune-days" in args:
        idx = args.index("--prune-days")
        days = int(args[idx + 1]) if idx + 1 < len(args) else 30
        deleted = prune_old_metrics(days)
        print(f"Pruned {deleted} metrics rows older than {days} days")
    else:
        print("Usage: python3 metrics.py --prune-days N")
