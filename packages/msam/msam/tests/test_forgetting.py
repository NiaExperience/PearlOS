"""MSAM Forgetting Engine Tests -- signal detectors and candidate identification."""

import json
import struct
from datetime import datetime, timezone, timedelta

import pytest
import numpy as np


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Use a temporary database for all tests."""
    db_path = tmp_path / "test_msam.db"
    monkeypatch.setattr("msam.core.DB_PATH", db_path)
    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)
    yield db_path


def _store_atom_direct(conn, atom_id, content, state="active", is_pinned=0,
                       encoding_confidence=0.7, created_at=None, embedding=None):
    """Insert an atom directly into the DB for testing."""
    import hashlib
    now = created_at or datetime.now(timezone.utc).isoformat()
    content_hash = hashlib.sha256(content.encode()).hexdigest()[:32]
    emb = embedding or struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
    conn.execute("""
        INSERT OR IGNORE INTO atoms (id, content, content_hash, created_at, state,
            is_pinned, encoding_confidence, embedding, topics, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}')
    """, (atom_id, content, content_hash, now, state, is_pinned, encoding_confidence, emb))
    conn.commit()


class TestDetectOverRetrieved:
    def test_identifies_low_contribution_atoms(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import _detect_over_retrieved

        conn = get_db()
        run_migrations(conn)
        _store_atom_direct(conn, "atom_noise", "This is noise content")

        # Insert access_log entries: 10 retrievals, 0 contributions
        now = datetime.now(timezone.utc).isoformat()
        for _ in range(10):
            conn.execute(
                "INSERT INTO access_log (atom_id, accessed_at, contributed) VALUES (?, ?, 0)",
                ("atom_noise", now)
            )
        conn.commit()

        candidates = _detect_over_retrieved(conn, min_retrievals=5, max_contribution_rate=0.15)
        conn.close()

        assert len(candidates) == 1
        assert candidates[0]["atom_id"] == "atom_noise"
        assert candidates[0]["contribution_rate"] == 0.0
        assert candidates[0]["signal"] == "over_retrieved"

    def test_skips_pinned_atoms(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import _detect_over_retrieved

        conn = get_db()
        run_migrations(conn)
        _store_atom_direct(conn, "atom_pinned", "Pinned content", is_pinned=1)

        now = datetime.now(timezone.utc).isoformat()
        for _ in range(10):
            conn.execute(
                "INSERT INTO access_log (atom_id, accessed_at, contributed) VALUES (?, ?, 0)",
                ("atom_pinned", now)
            )
        conn.commit()

        candidates = _detect_over_retrieved(conn, min_retrievals=5, max_contribution_rate=0.15)
        conn.close()

        assert len(candidates) == 0

    def test_skips_high_contribution_atoms(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import _detect_over_retrieved

        conn = get_db()
        run_migrations(conn)
        _store_atom_direct(conn, "atom_good", "Good content")

        now = datetime.now(timezone.utc).isoformat()
        for i in range(10):
            contributed = 1 if i < 5 else 0  # 50% contribution rate
            conn.execute(
                "INSERT INTO access_log (atom_id, accessed_at, contributed) VALUES (?, ?, ?)",
                ("atom_good", now, contributed)
            )
        conn.commit()

        candidates = _detect_over_retrieved(conn, min_retrievals=5, max_contribution_rate=0.15)
        conn.close()

        assert len(candidates) == 0


class TestDetectSuperseded:
    def test_identifies_superseded_atoms(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import _detect_superseded

        conn = get_db()
        run_migrations(conn)
        _store_atom_direct(conn, "atom_old", "Old fact")
        _store_atom_direct(conn, "atom_new", "New fact")

        now = datetime.now(timezone.utc).isoformat()
        conn.execute("""
            INSERT INTO atom_relations (source_id, target_id, relation_type, created_at)
            VALUES (?, ?, 'supersedes', ?)
        """, ("atom_new", "atom_old", now))
        conn.commit()

        candidates = _detect_superseded(conn)
        conn.close()

        assert len(candidates) == 1
        assert candidates[0]["atom_id"] == "atom_old"
        assert candidates[0]["superseded_by"] == "atom_new"

    def test_skips_pinned_target(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import _detect_superseded

        conn = get_db()
        run_migrations(conn)
        _store_atom_direct(conn, "atom_old_p", "Old pinned fact", is_pinned=1)
        _store_atom_direct(conn, "atom_new_p", "New fact")

        now = datetime.now(timezone.utc).isoformat()
        conn.execute("""
            INSERT INTO atom_relations (source_id, target_id, relation_type, created_at)
            VALUES (?, ?, 'supersedes', ?)
        """, ("atom_new_p", "atom_old_p", now))
        conn.commit()

        candidates = _detect_superseded(conn)
        conn.close()

        assert len(candidates) == 0


class TestDetectConfidenceBelowFloor:
    def test_identifies_low_confidence_stale_atoms(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import _detect_confidence_below_floor

        conn = get_db()
        run_migrations(conn)
        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        _store_atom_direct(
            conn, "atom_low", "Low confidence atom",
            encoding_confidence=0.05, created_at=old_date
        )
        conn.close()

        conn = get_db()
        candidates = _detect_confidence_below_floor(conn, floor=0.1, grace_days=14)
        conn.close()

        assert len(candidates) == 1
        assert candidates[0]["atom_id"] == "atom_low"
        assert candidates[0]["signal"] == "low_confidence"

    def test_skips_recent_atoms(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import _detect_confidence_below_floor

        conn = get_db()
        run_migrations(conn)
        recent_date = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        _store_atom_direct(
            conn, "atom_recent", "Recent low confidence",
            encoding_confidence=0.05, created_at=recent_date
        )
        conn.close()

        conn = get_db()
        candidates = _detect_confidence_below_floor(conn, floor=0.1, grace_days=14)
        conn.close()

        assert len(candidates) == 0


class TestIdentifyForgettingCandidates:
    def test_dry_run_returns_candidates_no_actions(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import identify_forgetting_candidates

        conn = get_db()
        run_migrations(conn)

        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        _store_atom_direct(
            conn, "atom_stale", "Stale atom",
            encoding_confidence=0.05, created_at=old_date
        )
        conn.close()

        result = identify_forgetting_candidates(dry_run=True, confidence_floor=0.1, grace_days=14)

        assert result["total_candidates"] >= 1
        assert result["actions_taken"] == 0
        assert any(c["atom_id"] == "atom_stale" for c in result["candidates"])

    def test_deduplicates_multi_signal_atoms(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import identify_forgetting_candidates

        conn = get_db()
        run_migrations(conn)

        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        # Atom with both low confidence AND over-retrieved
        _store_atom_direct(
            conn, "atom_multi", "Multi-signal atom",
            encoding_confidence=0.05, created_at=old_date
        )
        now = datetime.now(timezone.utc).isoformat()
        for _ in range(10):
            conn.execute(
                "INSERT INTO access_log (atom_id, accessed_at, contributed) VALUES (?, ?, 0)",
                ("atom_multi", now)
            )
        conn.commit()
        conn.close()

        result = identify_forgetting_candidates(
            dry_run=True, confidence_floor=0.1,
            grace_days=14, min_retrievals=5
        )

        multi = [c for c in result["candidates"] if c["atom_id"] == "atom_multi"]
        assert len(multi) == 1  # Deduplicated
        assert multi[0]["signal_count"] >= 2  # Multiple signals

    def test_auto_mode_transitions_atoms(self, monkeypatch):
        from msam.core import get_db, run_migrations
        from msam.forgetting import identify_forgetting_candidates

        # Enable auto mode
        monkeypatch.setattr("msam.forgetting._cfg",
                           lambda s, k, d=None: "auto" if k == "intentional_forgetting_mode" else d)

        conn = get_db()
        run_migrations(conn)

        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        _store_atom_direct(
            conn, "atom_auto", "Auto transition atom",
            encoding_confidence=0.05, created_at=old_date
        )
        conn.close()

        result = identify_forgetting_candidates(
            dry_run=False, confidence_floor=0.1, grace_days=14
        )

        assert result["actions_taken"] >= 1

        # Verify atom was transitioned
        conn = get_db()
        row = conn.execute("SELECT state FROM atoms WHERE id = 'atom_auto'").fetchone()
        conn.close()
        assert row["state"] in ("dormant", "tombstone")

    def test_pinned_atoms_never_candidates(self):
        from msam.core import get_db, run_migrations
        from msam.forgetting import identify_forgetting_candidates

        conn = get_db()
        run_migrations(conn)

        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        _store_atom_direct(
            conn, "atom_pinned_safe", "Pinned atom should be safe",
            encoding_confidence=0.05, created_at=old_date, is_pinned=1
        )
        now = datetime.now(timezone.utc).isoformat()
        for _ in range(10):
            conn.execute(
                "INSERT INTO access_log (atom_id, accessed_at, contributed) VALUES (?, ?, 0)",
                ("atom_pinned_safe", now)
            )
        conn.commit()
        conn.close()

        result = identify_forgetting_candidates(
            dry_run=True, confidence_floor=0.1, grace_days=14, min_retrievals=5
        )

        assert all(c["atom_id"] != "atom_pinned_safe" for c in result["candidates"])
