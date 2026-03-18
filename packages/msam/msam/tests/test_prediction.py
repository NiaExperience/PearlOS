"""Tests for the MSAM Predictive Prefetch Engine."""

import json
import sqlite3
import tempfile
from unittest.mock import patch, MagicMock

import pytest


# ─── Helpers ──────────────────────────────────────────────────────


def _make_in_memory_db():
    """Create an in-memory SQLite DB with the minimal schema needed for tests."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS atoms (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_accessed_at TEXT,
            access_count INTEGER DEFAULT 0,
            state TEXT DEFAULT 'active',
            topics TEXT DEFAULT '[]',
            embedding BLOB,
            metadata TEXT DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS access_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            atom_id TEXT NOT NULL,
            accessed_at TEXT NOT NULL,
            activation_score REAL,
            retrieval_mode TEXT,
            contributed INTEGER DEFAULT -1
        );
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
    """)
    return conn


# ─── Tests ────────────────────────────────────────────────────────


class TestPredictiveEngineInit:
    def test_instantiation_without_conn(self):
        from msam.prediction import PredictiveEngine
        engine = PredictiveEngine()
        assert engine._conn is None

    def test_instantiation_with_conn(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        engine = PredictiveEngine(conn=conn)
        assert engine._conn is conn


class TestMergeCandidates:
    def test_deduplication(self):
        from msam.prediction import PredictiveEngine
        list_a = [{"id": "a1", "content": "hello", "score": 1.0, "predicted_by": "temporal"}]
        list_b = [{"id": "a1", "content": "hello", "score": 0.8, "predicted_by": "co_retrieval"}]

        merged = PredictiveEngine._merge_candidates(list_a, list_b, weights=[1.0, 1.0])
        assert len(merged) == 1
        assert merged[0]["id"] == "a1"
        # Score should be sum of both
        assert merged[0]["score"] == pytest.approx(1.8)
        assert "temporal" in merged[0]["predicted_by"]
        assert "co_retrieval" in merged[0]["predicted_by"]

    def test_weighted_scoring(self):
        from msam.prediction import PredictiveEngine
        list_a = [{"id": "a1", "content": "x", "score": 1.0, "predicted_by": "s1"}]
        list_b = [{"id": "a2", "content": "y", "score": 1.0, "predicted_by": "s2"}]

        merged = PredictiveEngine._merge_candidates(list_a, list_b, weights=[0.4, 0.6])
        scores = {m["id"]: m["score"] for m in merged}
        assert scores["a1"] == pytest.approx(0.4)
        assert scores["a2"] == pytest.approx(0.6)

    def test_sort_order(self):
        from msam.prediction import PredictiveEngine
        list_a = [
            {"id": "low", "content": "lo", "score": 0.2, "predicted_by": "s"},
            {"id": "high", "content": "hi", "score": 0.9, "predicted_by": "s"},
        ]
        merged = PredictiveEngine._merge_candidates(list_a, weights=[1.0])
        assert merged[0]["id"] == "high"
        assert merged[1]["id"] == "low"

    def test_empty_lists(self):
        from msam.prediction import PredictiveEngine
        merged = PredictiveEngine._merge_candidates([], [], weights=[1.0, 1.0])
        assert merged == []


class TestTimeBuckets:
    def test_morning_bucket(self):
        from msam.prediction import _hour_in_bucket
        assert _hour_in_bucket(6, "morning") is True
        assert _hour_in_bucket(11, "morning") is True
        assert _hour_in_bucket(5, "morning") is False
        assert _hour_in_bucket(12, "morning") is False

    def test_night_bucket_wraps(self):
        from msam.prediction import _hour_in_bucket
        assert _hour_in_bucket(22, "night") is True
        assert _hour_in_bucket(23, "night") is True
        assert _hour_in_bucket(0, "night") is True
        assert _hour_in_bucket(5, "night") is True
        assert _hour_in_bucket(6, "night") is False
        assert _hour_in_bucket(21, "night") is False

    def test_bucket_hour_range(self):
        from msam.prediction import _bucket_hour_range
        assert _bucket_hour_range("morning") == [(6, 11)]
        assert _bucket_hour_range("afternoon") == [(12, 16)]
        # Night wraps around
        ranges = _bucket_hour_range("night")
        assert len(ranges) == 2
        assert (22, 23) in ranges
        assert (0, 5) in ranges

    def test_invalid_bucket(self):
        from msam.prediction import _hour_in_bucket
        assert _hour_in_bucket(10, "nonexistent") is False


class TestTemporalPatterns:
    def test_returns_candidates_for_known_bucket(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        # Insert an atom and access log entries during morning hours
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('t1', 'morning thought', 'active')")
        for hour in [7, 8, 9, 10]:
            conn.execute(
                "INSERT INTO access_log (atom_id, accessed_at) VALUES (?, ?)",
                ("t1", f"2026-02-20 {hour:02d}:00:00"),
            )
        conn.commit()

        engine = PredictiveEngine(conn=conn)
        result = engine._temporal_patterns({"time_of_day": "morning"}, top_k=5)
        assert len(result) >= 1
        assert result[0]["id"] == "t1"
        assert result[0]["predicted_by"] == "temporal"

    def test_empty_for_missing_time(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        engine = PredictiveEngine(conn=conn)
        assert engine._temporal_patterns({}, top_k=5) == []


class TestTopicMomentum:
    def test_overlapping_topics_scored(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        conn.execute(
            "INSERT INTO atoms (id, content, state, topics) VALUES (?, ?, 'active', ?)",
            ("m1", "music theory basics", json.dumps(["music", "theory"])),
        )
        conn.execute(
            "INSERT INTO atoms (id, content, state, topics) VALUES (?, ?, 'active', ?)",
            ("m2", "cooking recipes", json.dumps(["cooking"])),
        )
        conn.commit()

        engine = PredictiveEngine(conn=conn)
        result = engine._topic_momentum(
            {"recent_topics": ["music"], "last_session_topics": ["theory"]},
            top_k=10,
        )
        assert len(result) == 1
        assert result[0]["id"] == "m1"
        assert result[0]["predicted_by"] == "topic_momentum"

    def test_no_topics_returns_empty(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        engine = PredictiveEngine(conn=conn)
        assert engine._topic_momentum({}, top_k=5) == []


class TestPredict:
    def test_returns_valid_structure(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        conn.execute(
            "INSERT INTO atoms (id, content, state, topics) VALUES (?, ?, 'active', ?)",
            ("p1", "predicted atom", json.dumps(["alpha"])),
        )
        conn.commit()

        engine = PredictiveEngine(conn=conn)
        # Patch dry_retrieve to avoid full retrieval stack
        with patch("msam.prediction.dry_retrieve", return_value=[]):
            result = engine.predict(
                {"time_of_day": "morning", "recent_topics": ["alpha"]},
                top_k=10,
            )
        # Results should be a list of dicts with required keys
        for item in result:
            assert "id" in item
            assert "content" in item
            assert "score" in item
            assert "predicted_by" in item


class TestLearnFromSession:
    def test_records_co_retrieval_pairs(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('s1', 'atom 1', 'active')")
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('s2', 'atom 2', 'active')")
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('s3', 'atom 3', 'active')")
        conn.commit()

        engine = PredictiveEngine(conn=conn)

        # Patch where the function is looked up (core module), not where it's used
        with patch("msam.core._ensure_co_retrieval_table"):
            with patch("msam.core._log_co_retrieval") as mock_log:
                engine.learn_from_session(["s1", "s2", "s3"])
                mock_log.assert_called_once_with(conn, ["s1", "s2", "s3"])

    def test_skip_single_atom(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        engine = PredictiveEngine(conn=conn)
        # Should not error or call _log_co_retrieval with < 2 atoms
        engine.learn_from_session(["only_one"])
        # No error means success -- function returns early for < 2 atoms

    def test_skip_empty(self):
        from msam.prediction import PredictiveEngine
        conn = _make_in_memory_db()
        engine = PredictiveEngine(conn=conn)
        engine.learn_from_session([])
        # No error means success -- function returns early for empty list


def _make_temporal_db():
    """Create an in-memory DB with temporal_patterns table for Feature 2 tests."""
    conn = _make_in_memory_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS temporal_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            atom_id TEXT NOT NULL,
            hour_of_day INTEGER,
            day_of_week INTEGER,
            retrieval_count INTEGER DEFAULT 1,
            last_retrieved_at TEXT DEFAULT (datetime('now')),
            UNIQUE(atom_id, hour_of_day, day_of_week)
        );
        CREATE INDEX IF NOT EXISTS idx_temporal_atom ON temporal_patterns(atom_id);
        CREATE INDEX IF NOT EXISTS idx_temporal_time ON temporal_patterns(hour_of_day, day_of_week);
    """)
    return conn


class TestTemporalTracking:
    def test_temporal_tracking(self):
        from msam.prediction import track_temporal_pattern
        conn = _make_temporal_db()
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('tt1', 'tracked atom', 'active')")
        conn.commit()

        track_temporal_pattern(["tt1"], conn=conn)

        row = conn.execute(
            "SELECT retrieval_count FROM temporal_patterns WHERE atom_id = 'tt1'"
        ).fetchone()
        assert row is not None
        assert row[0] >= 1

    def test_temporal_tracking_increments(self):
        from msam.prediction import track_temporal_pattern
        conn = _make_temporal_db()
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('tt2', 'tracked atom 2', 'active')")
        conn.commit()

        track_temporal_pattern(["tt2"], conn=conn)
        track_temporal_pattern(["tt2"], conn=conn)

        row = conn.execute(
            "SELECT retrieval_count FROM temporal_patterns WHERE atom_id = 'tt2'"
        ).fetchone()
        assert row is not None
        assert row[0] >= 2


class TestCoRetrievalTracking:
    def test_co_retrieval_tracking(self):
        from msam.prediction import track_co_retrievals
        conn = _make_temporal_db()
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('cr1', 'co atom 1', 'active')")
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('cr2', 'co atom 2', 'active')")
        conn.commit()

        track_co_retrievals(["cr1", "cr2"], conn=conn)

        row = conn.execute(
            "SELECT co_count FROM co_retrieval WHERE atom_a = 'cr1' AND atom_b = 'cr2'"
        ).fetchone()
        # Should have a co-retrieval record (order may vary)
        if row is None:
            row = conn.execute(
                "SELECT co_count FROM co_retrieval WHERE atom_a = 'cr2' AND atom_b = 'cr1'"
            ).fetchone()
        assert row is not None


class TestPredictContext:
    @pytest.fixture(autouse=True)
    def disable_warmup(self, monkeypatch):
        """Disable warmup guard so predict_context doesn't require session boundaries."""
        import msam.prediction as pred_mod
        orig_cfg = pred_mod._cfg
        def _patched_cfg(section, key, default=None):
            if section == 'prediction' and key == 'warmup_sessions':
                return 0
            return orig_cfg(section, key, default)
        monkeypatch.setattr(pred_mod, '_cfg', _patched_cfg)

    def test_predict_returns_temporal_matches(self):
        from msam.prediction import PredictiveEngine
        conn = _make_temporal_db()
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('pc1', 'morning routine', 'active')")
        # Insert temporal pattern for hour 9, day 0 (Monday), with high count
        conn.execute(
            "INSERT INTO temporal_patterns (atom_id, hour_of_day, day_of_week, retrieval_count) VALUES (?, ?, ?, ?)",
            ("pc1", 9, 0, 10),
        )
        conn.commit()

        engine = PredictiveEngine(conn=conn)
        result = engine.predict_context(hour=9, day_of_week=0, top_k=5)
        assert len(result) >= 1
        assert result[0]["id"] == "pc1"

    def test_predict_expands_co_retrievals(self):
        from msam.prediction import PredictiveEngine
        conn = _make_temporal_db()
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('pce1', 'base atom', 'active')")
        conn.execute("INSERT INTO atoms (id, content, state) VALUES ('pce2', 'co-atom', 'active')")
        # Temporal pattern for pce1
        conn.execute(
            "INSERT INTO temporal_patterns (atom_id, hour_of_day, day_of_week, retrieval_count) VALUES (?, ?, ?, ?)",
            ("pce1", 14, 2, 10),
        )
        # Co-retrieval link
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO co_retrieval (atom_a, atom_b, co_count, last_co_retrieval) VALUES (?, ?, ?, ?)",
            ("pce1", "pce2", 5, now),
        )
        conn.commit()

        engine = PredictiveEngine(conn=conn)
        result = engine.predict_context(hour=14, day_of_week=2, top_k=10)
        ids = [r["id"] for r in result]
        assert "pce1" in ids
        assert "pce2" in ids

    def test_predict_empty_db(self):
        from msam.prediction import PredictiveEngine
        conn = _make_temporal_db()
        engine = PredictiveEngine(conn=conn)
        result = engine.predict_context(hour=12, day_of_week=3)
        assert result == []
