"""
MSAM Predictive Prefetch Engine -- Real prediction based on access patterns.

Replaces the stub in core.py with three complementary prediction strategies:
  1. Temporal patterns -- mine access_log for time-of-day correlations
  2. Co-retrieval patterns -- atoms frequently retrieved together
  3. Topic momentum -- recent topics predict next topics

Usage:
    from msam.prediction import PredictiveEngine
    engine = PredictiveEngine()
    predictions = engine.predict(context, top_k=20)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from itertools import combinations

from .config import get_config
from .core import get_db, dry_retrieve

logger = logging.getLogger("msam.prediction")

# ─── Configuration ────────────────────────────────────────────────

_cfg = get_config()

# Strategy weights (must sum to ~1.0 for interpretable scores)
TEMPORAL_WEIGHT = _cfg('prediction', 'temporal_weight', 0.4)
CORETRIEVAL_WEIGHT = _cfg('prediction', 'coretrieval_weight', 0.4)
MOMENTUM_WEIGHT = _cfg('prediction', 'momentum_weight', 0.2)

# How far back to look in access_log
LOOKBACK_DAYS = _cfg('prediction', 'lookback_days', 30)

# Minimum combined score to include in results
MIN_CONFIDENCE = _cfg('prediction', 'min_confidence', 0.3)

# ─── Time Bucket Definitions ─────────────────────────────────────

TIME_BUCKETS = {
    "morning": (6, 11),
    "afternoon": (12, 16),
    "evening": (17, 21),
    "night": (22, 5),  # wraps around midnight
}


def _hour_in_bucket(hour: int, bucket_name: str) -> bool:
    """Check whether an hour falls within a named time bucket.

    Handles the 'night' bucket which wraps around midnight (22-23, 0-5).
    """
    if bucket_name not in TIME_BUCKETS:
        return False
    start, end = TIME_BUCKETS[bucket_name]
    if start <= end:
        return start <= hour <= end
    # Wrapping bucket (night: 22..23, 0..5)
    return hour >= start or hour <= end


def _bucket_hour_range(bucket_name: str) -> list[tuple[int, int]]:
    """Return one or two (start, end) inclusive ranges for a time bucket.

    The 'night' bucket wraps around midnight so it returns two ranges:
    [(22, 23), (0, 5)].  All other buckets return a single range.
    """
    if bucket_name not in TIME_BUCKETS:
        return [(0, 23)]
    start, end = TIME_BUCKETS[bucket_name]
    if start <= end:
        return [(start, end)]
    return [(start, 23), (0, end)]


# ─── Temporal Tracking Functions ────────────────────────────────


def track_temporal_pattern(atom_ids, conn=None):
    """Track atom access patterns by hour and day of week.

    Inserts/updates the temporal_patterns table for each atom_id
    with the current hour and day of week.
    """
    if not atom_ids:
        return
    close = False
    if conn is None:
        conn = get_db()
        close = True

    now = datetime.now(timezone.utc)
    hour = now.hour
    dow = now.weekday()

    for atom_id in atom_ids:
        try:
            conn.execute(
                """INSERT INTO temporal_patterns (atom_id, hour_of_day, day_of_week, retrieval_count, last_retrieved_at)
                   VALUES (?, ?, ?, 1, ?)
                   ON CONFLICT(atom_id, hour_of_day, day_of_week)
                   DO UPDATE SET retrieval_count = retrieval_count + 1, last_retrieved_at = ?""",
                (atom_id, hour, dow, now.isoformat(), now.isoformat()),
            )
        except Exception:
            pass  # table may not exist yet (pre-migration 8)
    try:
        conn.commit()
    except Exception:
        pass
    if close:
        conn.close()


def track_co_retrievals(atom_ids, conn=None):
    """Track co-retrieval patterns using existing co_retrieval table."""
    if not atom_ids or len(atom_ids) < 2:
        return
    close = False
    if conn is None:
        conn = get_db()
        close = True

    try:
        from .core import _log_co_retrieval, _ensure_co_retrieval_table
        _ensure_co_retrieval_table(conn)
        _log_co_retrieval(conn, atom_ids[:8])
        conn.commit()
    except Exception:
        pass
    if close:
        conn.close()


# ─── PredictiveEngine ────────────────────────────────────────────


class PredictiveEngine:
    """Combine multiple prediction strategies to anticipate needed atoms."""

    def __init__(self, conn=None):
        """Initialize with an optional DB connection.

        If *conn* is None a fresh connection is obtained via ``get_db()``.
        """
        self._conn = conn

    # -- connection helper --------------------------------------------------

    def _get_conn(self):
        """Return the active connection, opening one if needed."""
        if self._conn is None:
            self._conn = get_db()
        return self._conn

    # -- public API ---------------------------------------------------------

    def predict(self, context: dict, top_k: int = 20) -> list[dict]:
        """Combine all strategies with configurable weights.

        Parameters
        ----------
        context : dict
            Keys understood by the engine::

                {
                    "time_of_day": "morning|afternoon|evening|night",
                    "day_type": "weekday|weekend|show_day",
                    "recent_topics": ["topic1", "topic2"],
                    "last_session_topics": ["topic3"],
                    "user_active": True/False,
                }

        top_k : int
            Maximum number of predictions to return.

        Returns
        -------
        list[dict]
            Each dict contains ``id``, ``content``, ``score``, and
            ``predicted_by`` (strategy name).
        """
        temporal = self._temporal_patterns(context, top_k=top_k)
        coret = self._co_retrieval_patterns(context, top_k=top_k)
        momentum = self._topic_momentum(context, top_k=top_k)

        merged = self._merge_candidates(
            temporal, coret, momentum,
            weights=[TEMPORAL_WEIGHT, CORETRIEVAL_WEIGHT, MOMENTUM_WEIGHT],
        )

        # Apply minimum confidence filter
        merged = [c for c in merged if c["score"] >= MIN_CONFIDENCE]

        return merged[:top_k]

    # -- Strategy 1: Temporal Patterns --------------------------------------

    def _temporal_patterns(self, context: dict, top_k: int = 20) -> list[dict]:
        """Mine access_log for time-of-day correlations.

        Looks at which atoms are most frequently accessed during the current
        time bucket (morning/afternoon/evening/night) within the lookback
        window and returns them scored by frequency.
        """
        time_of_day = context.get("time_of_day", "")
        if not time_of_day or time_of_day not in TIME_BUCKETS:
            return []

        conn = self._get_conn()
        ranges = _bucket_hour_range(time_of_day)

        candidates: dict[str, dict] = {}

        for start_h, end_h in ranges:
            rows = conn.execute(
                """
                SELECT al.atom_id, COUNT(*) as freq, a.content
                FROM access_log al
                JOIN atoms a ON a.id = al.atom_id
                WHERE CAST(strftime('%H', al.accessed_at) AS INTEGER)
                      BETWEEN ? AND ?
                  AND al.accessed_at > datetime('now', ? || ' days')
                  AND a.state IN ('active', 'fading')
                GROUP BY al.atom_id
                ORDER BY freq DESC
                LIMIT ?
                """,
                (start_h, end_h, f"-{LOOKBACK_DAYS}", top_k),
            ).fetchall()

            for row in rows:
                atom_id = row[0]
                freq = row[1]
                content = row[2]
                if atom_id in candidates:
                    candidates[atom_id]["score"] += freq
                else:
                    candidates[atom_id] = {
                        "id": atom_id,
                        "content": content[:100] if content else "",
                        "score": float(freq),
                        "predicted_by": "temporal",
                    }

        # Normalize scores to 0-1 range
        if candidates:
            max_score = max(c["score"] for c in candidates.values())
            if max_score > 0:
                for c in candidates.values():
                    c["score"] /= max_score

        result = sorted(candidates.values(), key=lambda x: x["score"], reverse=True)
        return result[:top_k]

    # -- Strategy 2: Co-retrieval Patterns ----------------------------------

    def _co_retrieval_patterns(self, context: dict, top_k: int = 20) -> list[dict]:
        """Find atoms frequently retrieved together with recent ones.

        If ``recent_topics`` are provided, first resolves them to atom IDs
        via dry retrieval, then looks up the co_retrieval table for partner
        atoms.  Also considers session-grouped access (atoms accessed within
        the same minute).
        """
        recent_topics = context.get("recent_topics", [])
        if not recent_topics:
            return []

        conn = self._get_conn()

        # Resolve topics to seed atom IDs via dry_retrieve
        seed_ids: list[str] = []
        for topic in recent_topics[:3]:
            try:
                results = dry_retrieve(topic, mode="task", top_k=3)
                seed_ids.extend(r["id"] for r in results)
            except Exception:
                pass

        if not seed_ids:
            return []

        # De-duplicate seed IDs
        seed_ids = list(dict.fromkeys(seed_ids))

        # Ensure co_retrieval table exists
        from .core import _ensure_co_retrieval_table
        _ensure_co_retrieval_table(conn)

        candidates: dict[str, dict] = {}

        for seed_id in seed_ids:
            rows = conn.execute(
                """
                SELECT
                    CASE WHEN atom_a = ? THEN atom_b ELSE atom_a END as partner,
                    co_count
                FROM co_retrieval
                WHERE atom_a = ? OR atom_b = ?
                ORDER BY co_count DESC
                LIMIT ?
                """,
                (seed_id, seed_id, seed_id, top_k),
            ).fetchall()

            for row in rows:
                partner_id = row[0]
                co_count = row[1]
                if partner_id in candidates:
                    candidates[partner_id]["score"] += co_count
                else:
                    # Fetch content snippet
                    atom_row = conn.execute(
                        "SELECT content FROM atoms WHERE id = ? AND state IN ('active', 'fading')",
                        (partner_id,),
                    ).fetchone()
                    if atom_row:
                        candidates[partner_id] = {
                            "id": partner_id,
                            "content": atom_row[0][:100] if atom_row[0] else "",
                            "score": float(co_count),
                            "predicted_by": "co_retrieval",
                        }

        # Normalize
        if candidates:
            max_score = max(c["score"] for c in candidates.values())
            if max_score > 0:
                for c in candidates.values():
                    c["score"] /= max_score

        result = sorted(candidates.values(), key=lambda x: x["score"], reverse=True)
        return result[:top_k]

    # -- Strategy 3: Topic Momentum -----------------------------------------

    def _topic_momentum(self, context: dict, top_k: int = 20) -> list[dict]:
        """Predict atoms at the intersection of recent and last-session topics.

        Atoms whose stored ``topics`` JSON array overlaps with both
        ``recent_topics`` and ``last_session_topics`` score highest.  Atoms
        overlapping with only one set still receive a partial score.
        """
        recent_topics = context.get("recent_topics", [])
        last_topics = context.get("last_session_topics", [])
        all_topics = list(dict.fromkeys(recent_topics + last_topics))

        if not all_topics:
            return []

        conn = self._get_conn()

        rows = conn.execute(
            """
            SELECT id, content, topics
            FROM atoms
            WHERE state = 'active' AND topics IS NOT NULL AND topics != '[]'
            """
        ).fetchall()

        candidates: list[dict] = []

        recent_set = set(t.lower() for t in recent_topics)
        last_set = set(t.lower() for t in last_topics)
        all_set = recent_set | last_set

        for row in rows:
            atom_id = row[0]
            content = row[1]
            try:
                atom_topics = json.loads(row[2]) if row[2] else []
            except (json.JSONDecodeError, TypeError):
                continue

            atom_topic_set = set(t.lower() for t in atom_topics if isinstance(t, str))
            overlap = atom_topic_set & all_set

            if not overlap:
                continue

            # Score: 1 point per recent overlap, 0.5 per last-session overlap
            score = 0.0
            for t in overlap:
                if t in recent_set:
                    score += 1.0
                if t in last_set:
                    score += 0.5

            candidates.append({
                "id": atom_id,
                "content": content[:100] if content else "",
                "score": score,
                "predicted_by": "topic_momentum",
            })

        # Normalize
        if candidates:
            max_score = max(c["score"] for c in candidates)
            if max_score > 0:
                for c in candidates:
                    c["score"] /= max_score

        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates[:top_k]

    # -- Learning -----------------------------------------------------------

    def learn_from_session(self, session_atoms: list[str]):
        """Record co-retrieval pairs for future prediction.

        Called at session end to teach the engine which atoms appeared
        together.  Delegates to the existing ``_log_co_retrieval`` helper
        in core.py so the co_retrieval table is updated consistently.
        """
        if not session_atoms or len(session_atoms) < 2:
            return

        conn = self._get_conn()
        from .core import _log_co_retrieval, _ensure_co_retrieval_table
        _ensure_co_retrieval_table(conn)
        _log_co_retrieval(conn, session_atoms)
        conn.commit()

    # -- Merge Utility ------------------------------------------------------

    def predict_context(self, hour=None, day_of_week=None, top_k=None):
        """Predict atoms likely needed based on temporal patterns and co-retrieval.

        Parameters
        ----------
        hour : int, optional
            Hour of day (0-23). Defaults to current hour.
        day_of_week : int, optional
            Day of week (0=Monday, 6=Sunday). Defaults to current day.
        top_k : int, optional
            Max atoms to return. Defaults from config.

        Returns
        -------
        list[dict]
            Predicted atoms with id, content, score, predicted_by.
        """
        if top_k is None:
            top_k = _cfg('prediction', 'max_predicted_atoms', 8)

        # Warmup guard: require minimum session count before predictions activate
        warmup = _cfg('prediction', 'warmup_sessions', 50)
        if warmup > 0:
            conn = self._get_conn()
            try:
                session_count = conn.execute(
                    "SELECT COUNT(*) FROM atoms WHERE source_type = 'session_boundary'"
                ).fetchone()[0]
            except Exception:
                session_count = 0
            if session_count < warmup:
                return []

        now = datetime.now(timezone.utc)
        if hour is None:
            hour = now.hour
        if day_of_week is None:
            day_of_week = now.weekday()

        conn = self._get_conn()
        temporal_window = _cfg('prediction', 'temporal_window_hours', 2)
        min_pattern_count = _cfg('prediction', 'min_pattern_count', 5)
        co_threshold = _cfg('prediction', 'co_retrieval_threshold', 3)

        # Step 1: Query temporal_patterns for matching hour (+/- window) and day
        hour_min = (hour - temporal_window) % 24
        hour_max = (hour + temporal_window) % 24

        if hour_min <= hour_max:
            hour_clause = "hour_of_day BETWEEN ? AND ?"
            hour_params = (hour_min, hour_max)
        else:
            # Wraps around midnight
            hour_clause = "(hour_of_day >= ? OR hour_of_day <= ?)"
            hour_params = (hour_min, hour_max)

        try:
            rows = conn.execute(
                f"""SELECT atom_id, SUM(retrieval_count) as total_count
                    FROM temporal_patterns
                    WHERE {hour_clause}
                      AND (day_of_week = ? OR day_of_week IS NULL)
                      AND retrieval_count >= ?
                    GROUP BY atom_id
                    ORDER BY total_count DESC
                    LIMIT ?""",
                hour_params + (day_of_week, min_pattern_count, top_k * 2),
            ).fetchall()
        except Exception:
            rows = []

        candidates = {}
        for row in rows:
            atom_id = row[0]
            count = row[1]
            # Fetch content
            atom_row = conn.execute(
                "SELECT content FROM atoms WHERE id = ? AND state IN ('active', 'fading')",
                (atom_id,),
            ).fetchone()
            if atom_row:
                candidates[atom_id] = {
                    "id": atom_id,
                    "content": atom_row[0][:100] if atom_row[0] else "",
                    "score": float(count),
                    "predicted_by": "temporal_pattern",
                }

        # Step 2: Expand with co-retrieval partners
        seed_ids = list(candidates.keys())[:top_k]
        if seed_ids:
            try:
                from .core import _ensure_co_retrieval_table
                _ensure_co_retrieval_table(conn)
            except Exception:
                pass

            for seed_id in seed_ids:
                try:
                    co_rows = conn.execute(
                        """SELECT
                            CASE WHEN atom_a = ? THEN atom_b ELSE atom_a END as partner,
                            co_count
                        FROM co_retrieval
                        WHERE (atom_a = ? OR atom_b = ?) AND co_count >= ?
                        ORDER BY co_count DESC
                        LIMIT ?""",
                        (seed_id, seed_id, seed_id, co_threshold, top_k),
                    ).fetchall()
                except Exception:
                    co_rows = []

                for co_row in co_rows:
                    partner_id = co_row[0]
                    co_count = co_row[1]
                    if partner_id not in candidates:
                        atom_row = conn.execute(
                            "SELECT content FROM atoms WHERE id = ? AND state IN ('active', 'fading')",
                            (partner_id,),
                        ).fetchone()
                        if atom_row:
                            candidates[partner_id] = {
                                "id": partner_id,
                                "content": atom_row[0][:100] if atom_row[0] else "",
                                "score": float(co_count) * 0.5,
                                "predicted_by": "co_retrieval",
                            }

        # Normalize and return top_k
        if candidates:
            max_score = max(c["score"] for c in candidates.values())
            if max_score > 0:
                for c in candidates.values():
                    c["score"] /= max_score

        result = sorted(candidates.values(), key=lambda x: x["score"], reverse=True)
        return result[:top_k]

    @staticmethod
    def _merge_candidates(
        *candidate_lists: list[dict],
        weights: list[float] | None = None,
    ) -> list[dict]:
        """Merge scored candidates from multiple strategies.

        Each candidate list is scaled by its corresponding weight.
        Candidates appearing in multiple lists receive the weighted sum of
        their scores.  The result is deduplicated by ``id`` and sorted by
        combined score descending.

        Parameters
        ----------
        *candidate_lists :
            Variable number of ``list[dict]`` where each dict has at least
            ``id``, ``content``, ``score``, and ``predicted_by``.
        weights :
            Per-list weight factors.  Defaults to equal weights.
        """
        if weights is None:
            weights = [1.0] * len(candidate_lists)

        # Ensure we have matching lengths (pad with 1.0 if needed)
        while len(weights) < len(candidate_lists):
            weights.append(1.0)

        merged: dict[str, dict] = {}

        for candidates, weight in zip(candidate_lists, weights):
            for c in candidates:
                atom_id = c.get("id", "")
                if not atom_id:
                    continue
                weighted_score = c.get("score", 0.0) * weight

                if atom_id in merged:
                    merged[atom_id]["score"] += weighted_score
                    # Track all contributing strategies
                    existing_by = merged[atom_id]["predicted_by"]
                    new_by = c.get("predicted_by", "unknown")
                    if new_by not in existing_by:
                        merged[atom_id]["predicted_by"] = f"{existing_by}+{new_by}"
                else:
                    merged[atom_id] = {
                        "id": atom_id,
                        "content": c.get("content", ""),
                        "score": weighted_score,
                        "predicted_by": c.get("predicted_by", "unknown"),
                    }

        result = sorted(merged.values(), key=lambda x: x["score"], reverse=True)
        return result
