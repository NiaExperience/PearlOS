"""Tests for Felt Consequence (outcome-attributed memory)."""

import json
import sqlite3
import numpy as np
import pytest


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


def _store_and_migrate():
    """Store an atom and run migration 8 so outcome columns exist."""
    from msam.core import store_atom, run_migrations
    run_migrations()
    atom_id = store_atom("Test outcome atom", topics=["testing"])
    return atom_id


class TestOutcomePositiveBoostsScore:
    def test_outcome_positive_boosts_score(self):
        from msam.core import record_outcome, get_db
        atom_id = _store_and_migrate()

        record_outcome([atom_id], "positive")
        conn = get_db()
        row = conn.execute(
            "SELECT outcome_score, outcome_count FROM atoms WHERE id = ?", (atom_id,)
        ).fetchone()
        conn.close()

        assert row["outcome_score"] > 0.0
        assert row["outcome_count"] == 1


class TestOutcomeNegativeDemotesScore:
    def test_outcome_negative_demotes_score(self):
        from msam.core import record_outcome, get_db
        atom_id = _store_and_migrate()

        record_outcome([atom_id], "negative")
        conn = get_db()
        row = conn.execute(
            "SELECT outcome_score, outcome_count FROM atoms WHERE id = ?", (atom_id,)
        ).fetchone()
        conn.close()

        assert row["outcome_score"] < 0.0
        assert row["outcome_count"] == 1


class TestOutcomeDecay:
    def test_outcome_decay(self):
        from msam.core import record_outcome, get_db
        atom_id = _store_and_migrate()

        # Record positive, then another positive -- first should be decayed
        record_outcome([atom_id], "positive")
        conn = get_db()
        score_after_first = conn.execute(
            "SELECT outcome_score FROM atoms WHERE id = ?", (atom_id,)
        ).fetchone()["outcome_score"]
        conn.close()

        record_outcome([atom_id], "positive")
        conn = get_db()
        score_after_second = conn.execute(
            "SELECT outcome_score FROM atoms WHERE id = ?", (atom_id,)
        ).fetchone()["outcome_score"]
        conn.close()

        # Second score should be first * 0.95 + 1.0
        expected = score_after_first * 0.95 + 1.0
        assert abs(score_after_second - expected) < 0.01


class TestOutcomeAffectsRetrievalRanking:
    def test_outcome_affects_retrieval_ranking(self):
        from msam.core import compute_activation, run_migrations
        run_migrations()

        # Atom with positive outcomes
        atom_positive = {
            "access_count": 5,
            "created_at": "2026-02-20T12:00:00+00:00",
            "arousal": 0.5,
            "valence": 0.0,
            "encoding_confidence": 0.7,
            "stability": 1.0,
            "outcome_score": 3.0,
            "outcome_count": 5,
        }

        # Same atom without outcomes
        atom_neutral = {
            "access_count": 5,
            "created_at": "2026-02-20T12:00:00+00:00",
            "arousal": 0.5,
            "valence": 0.0,
            "encoding_confidence": 0.7,
            "stability": 1.0,
            "outcome_score": 0.0,
            "outcome_count": 5,
        }

        score_pos = compute_activation(atom_positive, query_similarity=0.5)
        score_neut = compute_activation(atom_neutral, query_similarity=0.5)
        assert score_pos > score_neut


class TestMinOutcomesThreshold:
    def test_min_outcomes_threshold(self):
        from msam.core import compute_activation, run_migrations
        run_migrations()

        # Below min_outcomes_for_effect (default 3), outcome has no effect
        atom_below = {
            "access_count": 5,
            "created_at": "2026-02-20T12:00:00+00:00",
            "arousal": 0.5,
            "valence": 0.0,
            "encoding_confidence": 0.7,
            "stability": 1.0,
            "outcome_score": 3.0,
            "outcome_count": 2,  # below threshold
        }

        atom_zero = {
            "access_count": 5,
            "created_at": "2026-02-20T12:00:00+00:00",
            "arousal": 0.5,
            "valence": 0.0,
            "encoding_confidence": 0.7,
            "stability": 1.0,
            "outcome_score": 0.0,
            "outcome_count": 0,
        }

        score_below = compute_activation(atom_below, query_similarity=0.5)
        score_zero = compute_activation(atom_zero, query_similarity=0.5)
        assert score_below == pytest.approx(score_zero, abs=0.01)


class TestRetrievalOutcomesLogged:
    def test_retrieval_outcomes_logged(self):
        from msam.core import record_outcome, get_outcome_history
        atom_id = _store_and_migrate()

        record_outcome([atom_id], "positive", session_id="sess-1", query="test query")
        history = get_outcome_history(atom_id)

        assert len(history) >= 1
        assert history[0]["feedback"] == "positive"
        assert history[0]["session_id"] == "sess-1"
