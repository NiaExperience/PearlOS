"""MSAM Triples Tests -- knowledge graph triple layer."""

import struct
import hashlib
from datetime import datetime, timezone

import pytest
import numpy as np


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Use a temporary database for all tests."""
    db_path = tmp_path / "test_msam.db"
    monkeypatch.setattr("msam.core.DB_PATH", db_path)
    # Also patch the triples module DB_PATH
    monkeypatch.setattr("msam.triples.DB_PATH", db_path)
    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)
    yield db_path


def _setup_db():
    """Initialize DB with atoms and triples schemas."""
    from msam.core import get_db, run_migrations
    from msam.triples import init_triples_schema
    conn = get_db()
    run_migrations(conn)
    init_triples_schema(conn)
    conn.commit()
    return conn


class TestClassifyQuery:
    def test_factual(self):
        from msam.triples import classify_query
        qtype, ratio = classify_query("What is the user's profession?")
        assert qtype == "factual"
        assert ratio > 0.3

    def test_contextual(self):
        from msam.triples import classify_query
        qtype, ratio = classify_query("How does the relationship feel?")
        assert qtype == "contextual"
        assert ratio < 0.3

    def test_mixed(self):
        from msam.triples import classify_query
        qtype, ratio = classify_query("Tell me something")
        assert qtype == "mixed"


class TestGenerateTripleId:
    def test_deterministic(self):
        from msam.triples import generate_triple_id
        id1 = generate_triple_id("a1", "User", "has_profession", "developer")
        id2 = generate_triple_id("a1", "User", "has_profession", "developer")
        assert id1 == id2
        assert len(id1) == 16

    def test_different_inputs(self):
        from msam.triples import generate_triple_id
        id1 = generate_triple_id("a1", "User", "has_profession", "developer")
        id2 = generate_triple_id("a1", "User", "has_profession", "designer")
        assert id1 != id2


class TestStoreAndRetrieveTriple:
    def test_round_trip(self):
        from msam.triples import store_triple, retrieve_by_entity
        conn = _setup_db()

        # Store an atom for the foreign key
        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a1', 'User is a developer', 'hash1', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        tid = store_triple("a1", "User", "has_profession", "developer", embed=False)
        assert tid is not None

        results = retrieve_by_entity("User")
        assert len(results) >= 1
        assert any(r["predicate"] == "has_profession" for r in results)

    def test_batch_dedup(self):
        from msam.triples import store_triples_batch
        conn = _setup_db()

        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a2', 'Some content', 'hash2', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        triples = [
            {"atom_id": "a2", "subject": "User", "predicate": "likes", "object": "Python"},
            {"atom_id": "a2", "subject": "User", "predicate": "likes", "object": "Python"},  # dup
            {"atom_id": "a2", "subject": "User", "predicate": "likes", "object": "Rust"},
        ]

        count = store_triples_batch(triples, embed=False)
        assert count == 2  # one duplicate skipped

    def test_retrieve_by_entity(self):
        from msam.triples import store_triple, retrieve_by_entity
        conn = _setup_db()

        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a3', 'Facts', 'hash3', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        store_triple("a3", "Alice", "knows", "Bob", embed=False)
        store_triple("a3", "Bob", "works_at", "Acme", embed=False)

        # Alice as subject
        results = retrieve_by_entity("Alice")
        assert len(results) >= 1

        # Bob as both subject and object
        results = retrieve_by_entity("Bob")
        assert len(results) >= 2


class TestFormatTriples:
    def test_format(self):
        from msam.triples import format_triples_for_context
        triples = [
            {"subject": "User", "predicate": "has_profession", "object": "developer"},
            {"subject": "User", "predicate": "likes", "object": "Python"},
        ]
        text = format_triples_for_context(triples)
        assert "(User, has_profession, developer)" in text
        assert "(User, likes, Python)" in text


class TestEstimateTokens:
    def test_reasonable_estimate(self):
        from msam.triples import estimate_triple_tokens
        triples = [
            {"subject": "User", "predicate": "has_profession", "object": "software developer"},
        ]
        tokens = estimate_triple_tokens(triples)
        assert 3 <= tokens <= 20


class TestGraphTraversal:
    def test_finds_neighbors(self):
        from msam.triples import store_triple, graph_traverse
        conn = _setup_db()

        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a4', 'Graph test', 'hash4', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        store_triple("a4", "User", "has_profession", "developer", embed=False)
        store_triple("a4", "User", "likes", "Python", embed=False)

        result = graph_traverse("User", max_hops=1)
        assert result["total_triples"] >= 2
        assert result["start_entity"] == "User"
        assert 0 in result["hops"]


class TestGraphPath:
    def test_finds_route(self):
        from msam.triples import store_triple, graph_path
        conn = _setup_db()

        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a5', 'Path test', 'hash5', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        store_triple("a5", "User", "works_on", "ProjectX", embed=False)
        store_triple("a5", "ProjectX", "uses", "Python", embed=False)

        result = graph_path("User", "Python", max_hops=3)
        assert result["found"] is True
        assert result["hops"] == 2

    def test_no_path(self):
        from msam.triples import graph_path
        _setup_db()

        result = graph_path("Nonexistent", "AlsoNope", max_hops=2)
        assert result["found"] is False


class TestDetectContradictions:
    def test_same_predicate(self):
        from msam.triples import store_triple, detect_contradictions
        conn = _setup_db()

        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a6', 'Contradiction test', 'hash6', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        store_triple("a6", "User", "has_profession", "developer", embed=False)

        # Check pre-write contradiction
        contradictions = detect_contradictions("User", "has_profession", "designer")
        assert len(contradictions) >= 1
        assert contradictions[0]["type"] == "value_conflict"
        assert contradictions[0]["existing_value"] == "developer"
        assert contradictions[0]["new_value"] == "designer"


class TestGetTripleStats:
    def test_returns_expected_keys(self):
        from msam.triples import store_triple, get_triple_stats
        conn = _setup_db()

        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a7', 'Stats test', 'hash7', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        store_triple("a7", "User", "likes", "Python", embed=False)

        stats = get_triple_stats()
        assert "total_triples" in stats
        assert "unique_subjects" in stats
        assert "unique_predicates" in stats
        assert "unique_objects" in stats
        assert "top_subjects" in stats
        assert "top_predicates" in stats
        assert stats["total_triples"] >= 1


class TestRetrieveTriples:
    def test_keyword_fallback(self):
        from msam.triples import store_triple, retrieve_triples
        conn = _setup_db()

        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a8', 'Retrieve test', 'hash8', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        store_triple("a8", "User", "has_profession", "developer", embed=False)
        store_triple("a8", "User", "likes", "Python", embed=False)

        results = retrieve_triples("User profession")
        assert isinstance(results, list)
        # Should find triples via keyword/entity matching
        if results:
            assert "subject" in results[0]
            assert "predicate" in results[0]
            assert "object" in results[0]


class TestResolveContradictions:
    def test_manual_strategy_noop(self):
        from msam.triples import resolve_contradictions
        contradictions = [{"type": "value_conflict"}]
        resolved = resolve_contradictions(contradictions, strategy="manual")
        assert resolved == 0

    def test_newest_strategy_tombstones_old(self):
        from msam.triples import store_triple, resolve_contradictions
        conn = _setup_db()

        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('a9', 'Resolve test', 'hash9', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        store_triple("a9", "User", "has_profession", "developer", embed=False)
        store_triple("a9", "User", "has_profession", "designer", embed=False)

        # Get actual triple IDs to build the contradiction dict
        from msam.triples import _get_db
        conn = _get_db()
        rows = conn.execute(
            "SELECT id, object, created_at FROM triples WHERE subject='User' AND predicate='has_profession' AND state='active'"
        ).fetchall()
        conn.close()

        if len(rows) >= 2:
            contradiction = {
                "type": "multi_value_on_unique_pred",
                "subject": "User",
                "predicate": "has_profession",
                "values": [
                    {"id": r[0], "value": r[1], "date": r[2]} for r in rows
                ]
            }
            resolved = resolve_contradictions([contradiction], strategy="newest")
            assert resolved >= 1


# ─── Extract and Store ─────────────────────────────────────────────────────


class TestExtractAndStore:
    def test_extract_and_store_no_api_key(self, monkeypatch):
        """Without NVIDIA_NIM_API_KEY, extract_and_store returns 0."""
        monkeypatch.delenv("NVIDIA_NIM_API_KEY", raising=False)
        conn = _setup_db()
        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('ext1', 'The sky is blue', 'hashext1', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        from msam.triples import extract_and_store
        count = extract_and_store("ext1", "The sky is blue")
        assert count == 0

    def test_extract_and_store_with_mock_llm(self, monkeypatch):
        """With mocked LLM, extract_and_store stores triples."""
        conn = _setup_db()
        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, state,
                embedding, topics, metadata, encoding_confidence)
            VALUES ('ext2', 'Jaden lives in Oakland', 'hashext2', datetime('now'), 'active',
                ?, '[]', '{}', 0.7)
        """, (emb,))
        conn.commit()
        conn.close()

        # Mock extract_triples_llm to return triples directly
        monkeypatch.setattr("msam.triples.extract_triples_llm", lambda c, aid="": [
            {"atom_id": aid, "subject": "Jaden", "predicate": "lives_in", "object": "Oakland"},
        ])

        from msam.triples import extract_and_store
        count = extract_and_store("ext2", "Jaden lives in Oakland")
        assert count == 1


class TestExtractTriplesLlm:
    def test_no_api_key_returns_empty(self, monkeypatch):
        """Without API key, returns empty list."""
        monkeypatch.delenv("NVIDIA_NIM_API_KEY", raising=False)
        from msam.triples import extract_triples_llm
        result = extract_triples_llm("The sky is blue")
        assert result == []

    def test_with_mocked_api(self, monkeypatch):
        """With mocked API response, extracts triples."""
        monkeypatch.setenv("NVIDIA_NIM_API_KEY", "test-key")

        import requests

        class MockResponse:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"choices": [{"message": {"content": "(Jaden, lives_in, Oakland)"}}]}

        monkeypatch.setattr(requests, "post", lambda *a, **kw: MockResponse())
        from msam.triples import extract_triples_llm
        result = extract_triples_llm("Jaden lives in Oakland", atom_id="test1")
        assert len(result) >= 1
        assert result[0]["subject"] == "Jaden"
