"""MSAM Retrieval v2 Tests -- advanced retrieval pipeline."""

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
    monkeypatch.setattr("msam.triples.DB_PATH", db_path)
    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)
    yield db_path


class TestExtractQueryEntities:
    def test_extracts_capitalized(self):
        from msam.retrieval_v2 import extract_query_entities
        entities = extract_query_entities("What does Alice think about Python?")
        assert "Alice" in entities

    def test_extracts_known_entities(self):
        from msam.retrieval_v2 import extract_query_entities
        entities = extract_query_entities("what does the user like?")
        assert "User" in entities

    def test_skips_stopwords(self):
        from msam.retrieval_v2 import extract_query_entities
        entities = extract_query_entities("What is this?")
        assert "What" not in entities
        assert "This" not in entities


class TestDetectTemporalScope:
    def test_today(self):
        from msam.retrieval_v2 import detect_temporal_scope
        days = detect_temporal_scope("What happened today?")
        assert days == 1

    def test_last_week(self):
        from msam.retrieval_v2 import detect_temporal_scope
        days = detect_temporal_scope("Events from last week")
        assert days == 7

    def test_none(self):
        from msam.retrieval_v2 import detect_temporal_scope
        days = detect_temporal_scope("Tell me about Python")
        assert days is None


class TestApplyTemporalFilter:
    def test_filters_old(self):
        from msam.retrieval_v2 import apply_temporal_filter
        now = datetime.now(timezone.utc)
        atoms = [
            {"created_at": now.isoformat(), "_combined_score": 1.0, "content": "new"},
            {"created_at": (now - timedelta(days=30)).isoformat(), "_combined_score": 1.0, "content": "old"},
        ]
        filtered = apply_temporal_filter(atoms, max_age_days=7)
        assert len(filtered) == 1
        assert "new" in filtered[0]["content"]


class TestComputeAtomQuality:
    def test_short_content_low(self):
        from msam.retrieval_v2 import compute_atom_quality
        rich_quality = compute_atom_quality(
            "Agent Identity: Curious, analytical, warm personality. "
            "Values: growth, authenticity, depth."
        )
        short_quality = compute_atom_quality("Hi")
        assert short_quality < rich_quality, "Short content should score lower than rich content"

    def test_rich_content_high(self):
        from msam.retrieval_v2 import compute_atom_quality
        content = (
            "Agent Identity: Core Traits - Curious, analytical, warm. "
            "Values authenticity and growth. Professional in tech discussions, "
            "casual in personal conversations. Key interests: AI systems, "
            "music theory, cognitive science."
        )
        quality = compute_atom_quality(content)
        assert quality > 0.5

    def test_empty_returns_zero(self):
        from msam.retrieval_v2 import compute_atom_quality
        assert compute_atom_quality("") == 0.0


class TestRewriteQuery:
    def test_applies_entity_mappings(self):
        from msam.retrieval_v2 import rewrite_query
        result = rewrite_query("what does the user like?")
        # Should replace "user" with "User" (capitalized entity)
        assert "User" in result


class TestPrecomputeAtomQuality:
    def test_updates_atoms(self):
        from msam.core import get_db, run_migrations, store_atom
        from msam.retrieval_v2 import precompute_atom_quality

        conn = get_db()
        run_migrations(conn)
        conn.close()

        store_atom("Agent Identity: Curious, analytical, warm. Values authenticity.")
        store_atom("Short")

        updated = precompute_atom_quality()
        assert updated >= 2

        conn = get_db()
        rows = conn.execute("SELECT quality FROM atoms WHERE state = 'active'").fetchall()
        conn.close()
        assert all(r[0] is not None for r in rows)


class TestFeedbackPipeline:
    def test_init_feedback_table(self):
        from msam.core import get_db, run_migrations
        from msam.retrieval_v2 import init_feedback_table

        conn = get_db()
        run_migrations(conn)
        conn.close()

        init_feedback_table()
        # Verify table exists
        conn = get_db()
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='retrieval_feedback'"
        ).fetchall()
        conn.close()
        assert len(tables) == 1

    def test_log_and_get_usefulness(self):
        from msam.core import get_db, run_migrations
        from msam.retrieval_v2 import log_retrieval_feedback, get_atom_usefulness

        conn = get_db()
        run_migrations(conn)
        conn.close()

        # Not enough data → neutral
        assert get_atom_usefulness("atom_x") == 0.5

        # Log 5 retrievals: 3 used, 2 not
        for i in range(3):
            log_retrieval_feedback("test query", "atom_x", i, True, 0.8)
        for i in range(2):
            log_retrieval_feedback("test query", "atom_x", i, False, 0.3)

        usefulness = get_atom_usefulness("atom_x")
        assert usefulness == pytest.approx(0.6, abs=0.01)  # 3/5


class TestExpandQuery:
    def test_returns_query_without_triples(self):
        from msam.core import get_db, run_migrations
        from msam.retrieval_v2 import expand_query
        from msam.triples import init_triples_schema

        conn = get_db()
        run_migrations(conn)
        init_triples_schema(conn)
        conn.commit()
        conn.close()

        # No triples stored → returns original query unchanged
        result = expand_query("What does Alice like?")
        assert "Alice" in result

    def test_expands_with_triples(self):
        from msam.core import get_db, run_migrations
        from msam.retrieval_v2 import expand_query
        from msam.triples import init_triples_schema, store_triple

        conn = get_db()
        run_migrations(conn)
        init_triples_schema(conn)
        conn.commit()

        # Need a source atom for FK
        _store_test_atom(conn, "src1", "User is a developer")
        conn.close()

        store_triple("src1", "User", "has_profession", "developer", embed=False)

        result = expand_query("What is the user's profession?")
        # Should include the original query
        assert "profession" in result


class TestRetrieveV2:
    def test_returns_results(self):
        from msam.core import get_db, run_migrations, store_atom
        from msam.retrieval_v2 import retrieve_v2
        from msam.triples import init_triples_schema

        conn = get_db()
        run_migrations(conn)
        init_triples_schema(conn)
        conn.commit()
        conn.close()

        store_atom("Agent Identity: curious and analytical personality")
        store_atom("User Profession: software engineer at tech company")

        results = retrieve_v2("Who is the agent?", top_k=5)
        assert isinstance(results, list)
        # Should have pipeline metadata
        if results:
            assert results[0].get('_retrieval_version') == 'v2'
            assert '_latency_ms' in results[0]


def _store_test_atom(conn, atom_id, content):
    """Insert a test atom for triple FK requirements."""
    import hashlib
    content_hash = hashlib.sha256(content.encode()).hexdigest()[:32]
    emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
    conn.execute("""
        INSERT OR IGNORE INTO atoms (id, content, content_hash, created_at, state,
            embedding, topics, metadata, encoding_confidence, stream)
        VALUES (?, ?, ?, datetime('now'), 'active', ?, '[]', '{}', 0.7, 'semantic')
    """, (atom_id, content, content_hash, emb))
    conn.commit()
