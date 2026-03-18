"""MSAM Decay Tests -- lifecycle management, retrievability, state transitions."""

import struct
import hashlib
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
                       stability=1.0, retrievability=1.0, created_at=None,
                       profile="standard", access_count=0, embedding=None):
    """Insert an atom directly into the DB for testing."""
    now = created_at or datetime.now(timezone.utc).isoformat()
    content_hash = hashlib.sha256(content.encode()).hexdigest()[:32]
    emb = embedding or struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
    conn.execute("""
        INSERT OR IGNORE INTO atoms (id, content, content_hash, created_at, state,
            is_pinned, stability, retrievability, embedding, topics, metadata,
            profile, access_count, last_accessed_at, encoding_confidence, stream)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, ?, ?, 0.7, 'semantic')
    """, (atom_id, content, content_hash, now, state, is_pinned, stability,
          retrievability, emb, profile, access_count, now))
    conn.commit()


class TestComputeRetrievability:
    def test_updates_atoms(self):
        from msam.core import get_db, run_migrations
        from msam.decay import compute_all_retrievability

        conn = get_db()
        run_migrations(conn)
        _store_atom_direct(conn, "atom_r1", "Test retrievability")
        conn.close()

        updated = compute_all_retrievability()
        assert updated >= 1

    def test_retrievability_decreases_with_age(self):
        from msam.core import get_db, run_migrations
        from msam.decay import compute_all_retrievability

        conn = get_db()
        run_migrations(conn)

        recent = datetime.now(timezone.utc).isoformat()
        old = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

        _store_atom_direct(conn, "atom_new", "New atom", created_at=recent)
        _store_atom_direct(conn, "atom_old", "Old atom", created_at=old)
        conn.close()

        compute_all_retrievability()

        conn = get_db()
        r_new = conn.execute("SELECT retrievability FROM atoms WHERE id = 'atom_new'").fetchone()[0]
        r_old = conn.execute("SELECT retrievability FROM atoms WHERE id = 'atom_old'").fetchone()[0]
        conn.close()

        assert r_new > r_old, f"New atom R={r_new} should be > old atom R={r_old}"


class TestTransitionStates:
    def test_active_to_fading(self):
        from msam.core import get_db, run_migrations
        from msam.decay import transition_states

        conn = get_db()
        run_migrations(conn)
        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        _store_atom_direct(conn, "atom_fade", "Should fade",
                           retrievability=0.2, created_at=old_date)
        conn.close()

        result = transition_states()
        assert result["faded"] >= 1

        conn = get_db()
        state = conn.execute("SELECT state FROM atoms WHERE id = 'atom_fade'").fetchone()[0]
        conn.close()
        assert state == "fading"

    def test_fading_to_dormant(self):
        from msam.core import get_db, run_migrations
        from msam.decay import transition_states

        conn = get_db()
        run_migrations(conn)
        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        _store_atom_direct(conn, "atom_dorm", "Should go dormant",
                           state="fading", retrievability=0.05, created_at=old_date)
        conn.close()

        result = transition_states()
        assert result["dormanted"] >= 1

        conn = get_db()
        state = conn.execute("SELECT state FROM atoms WHERE id = 'atom_dorm'").fetchone()[0]
        conn.close()
        assert state == "dormant"

    def test_protects_recently_accessed(self):
        from msam.core import get_db, run_migrations
        from msam.decay import transition_states

        conn = get_db()
        run_migrations(conn)
        now = datetime.now(timezone.utc).isoformat()
        _store_atom_direct(conn, "atom_prot", "Recently accessed",
                           retrievability=0.2, created_at=now)
        # Insert a recent access log entry
        conn.execute(
            "INSERT INTO access_log (atom_id, accessed_at, contributed) VALUES (?, ?, 0)",
            ("atom_prot", now)
        )
        conn.commit()
        conn.close()

        result = transition_states()

        conn = get_db()
        state = conn.execute("SELECT state FROM atoms WHERE id = 'atom_prot'").fetchone()[0]
        conn.close()
        assert state == "active", "Recently accessed atom should be protected"

    def test_protects_pinned(self):
        from msam.core import get_db, run_migrations
        from msam.decay import transition_states

        conn = get_db()
        run_migrations(conn)
        old_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        _store_atom_direct(conn, "atom_pin", "Pinned atom",
                           retrievability=0.05, is_pinned=1, created_at=old_date)
        conn.close()

        transition_states()

        conn = get_db()
        state = conn.execute("SELECT state FROM atoms WHERE id = 'atom_pin'").fetchone()[0]
        conn.close()
        assert state == "active", "Pinned atom should never transition"


class TestCompactProfiles:
    def test_compact_old_low_access(self):
        from msam.core import get_db, run_migrations
        from msam.decay import compact_profiles

        conn = get_db()
        run_migrations(conn)
        old_date = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()
        # Content much longer than target to trigger compaction
        long_content = "A" * 500
        _store_atom_direct(conn, "atom_comp", long_content,
                           profile="full", access_count=1, created_at=old_date)
        conn.close()

        result = compact_profiles()
        assert result["total_compacted"] >= 1
        assert result["tokens_freed"] > 0


class TestBudgetCheck:
    def test_budget_ok(self):
        from msam.core import get_db, run_migrations
        from msam.decay import budget_check

        conn = get_db()
        run_migrations(conn)
        conn.close()

        result = budget_check()
        assert "total_tokens" in result
        assert "budget_pct" in result
        assert "recommendation" in result
        assert result["recommendation"].startswith("OK")

    def test_budget_levels(self):
        from msam.core import get_db, run_migrations, store_atom
        from msam.decay import budget_check

        conn = get_db()
        run_migrations(conn)
        conn.close()

        result = budget_check()
        assert result["budget_pct"] >= 0
        assert result["budget_ceiling"] > 0


class TestRunDecayCycle:
    def test_returns_summary(self, monkeypatch):
        from msam.core import get_db, run_migrations
        from msam.decay import run_decay_cycle

        # Disable intentional forgetting for clean test
        monkeypatch.setattr("msam.decay._cfg",
                           lambda s, k, d=None: False if k == "intentional_forgetting_enabled" else d)

        conn = get_db()
        run_migrations(conn)
        _store_atom_direct(conn, "atom_cycle", "Decay cycle test atom")
        conn.close()

        summary = run_decay_cycle()
        expected_keys = [
            "timestamp", "elapsed_seconds", "atoms_retrievability_updated",
            "atoms_faded", "atoms_dormanted", "atoms_protected",
            "atoms_compacted", "tokens_freed",
            "budget_before_pct", "budget_after_pct",
            "total_active", "total_fading", "total_dormant",
            "budget_recommendation",
        ]
        for key in expected_keys:
            assert key in summary, f"Missing key: {key}"
