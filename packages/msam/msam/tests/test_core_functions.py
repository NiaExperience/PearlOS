"""Comprehensive tests for untested core.py public functions.

Covers: associations, relations, advanced retrieval, knowledge management,
negative knowledge, session/working memory, provenance, hooks, pins,
forgetting, cache, confidence, schema, and access patterns.
"""

import json
import sqlite3
import time

import numpy as np
import pytest


# ─── Shared Fixture ──────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Isolate every test to a fresh SQLite database with fake embeddings."""
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("msam.core.DB_PATH", db_path)
    monkeypatch.setattr("msam.triples.DB_PATH", db_path)

    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)

    # Run all migrations + init triples schema
    from msam.core import get_db, run_migrations
    from msam.triples import init_triples_schema
    conn = get_db()
    run_migrations(conn)
    init_triples_schema(conn)
    conn.close()

    yield db_path


@pytest.fixture
def metrics_db(monkeypatch, tmp_path):
    """Separate metrics DB for functions that touch metrics."""
    mdb = tmp_path / "test_metrics.db"
    monkeypatch.setattr("msam.metrics.METRICS_DB", mdb)
    return mdb


def _store(content="Test atom content"):
    from msam.core import store_atom
    return store_atom(content)


# ─── Schema & Migrations ─────────────────────────────────────────────────────


class TestSchemaMigrations:
    def test_get_schema_version(self):
        from msam.core import get_db, get_schema_version
        # Trigger DB init by storing
        _store("Schema version test")
        version = get_schema_version()
        assert isinstance(version, int)
        assert version >= 1

    def test_run_migrations(self):
        from msam.core import run_migrations
        _store("Migration test")
        result = run_migrations()
        assert isinstance(result, dict)
        assert "previous_version" in result
        assert "current_version" in result


# ─── Associations & Relations ─────────────────────────────────────────────────


class TestAssociations:
    def test_get_associations_empty(self):
        from msam.core import get_associations
        aid = _store("Association test")
        result = get_associations(aid)
        assert isinstance(result, list)

    def test_get_association_clusters(self):
        from msam.core import get_association_clusters
        _store("Cluster test A")
        _store("Cluster test B")
        result = get_association_clusters(min_co_count=1)
        assert isinstance(result, list)


class TestRelations:
    def test_add_and_get_atom_relations(self):
        from msam.core import add_atom_relation, get_atom_relations
        aid1 = _store("Source atom for relation")
        aid2 = _store("Target atom for relation")
        result = add_atom_relation(aid1, aid2, "elaborates")
        assert result["source"] == aid1
        assert result["target"] == aid2
        assert result["type"] == "elaborates"

        rels = get_atom_relations(aid1)
        assert isinstance(rels, list)
        assert len(rels) >= 1

    def test_get_atom_relations_direction(self):
        from msam.core import add_atom_relation, get_atom_relations
        aid1 = _store("Relation direction A")
        aid2 = _store("Relation direction B")
        add_atom_relation(aid1, aid2, "supports")

        outgoing = get_atom_relations(aid1, direction="outgoing")
        incoming = get_atom_relations(aid2, direction="incoming")
        assert len(outgoing) >= 1
        assert len(incoming) >= 1

    def test_retrieve_with_relations(self):
        from msam.core import retrieve_with_relations
        _store("Relation retrieval test content")
        results = retrieve_with_relations("relation retrieval", top_k=3)
        assert isinstance(results, list)


# ─── Advanced Retrieval ───────────────────────────────────────────────────────


class TestAdvancedRetrieval:
    def test_retrieve_diverse(self):
        from msam.core import retrieve_diverse
        _store("Diverse retrieval atom A")
        _store("Diverse retrieval atom B")
        results = retrieve_diverse("diverse retrieval", top_k=3, lambda_param=0.7)
        assert isinstance(results, list)

    def test_retrieve_with_emotion(self):
        from msam.core import retrieve_with_emotion
        _store("Emotional retrieval test content")
        results = retrieve_with_emotion(
            "emotional test",
            query_emotion={"arousal": 0.8, "valence": 0.5, "urgency": "high"},
            top_k=3,
        )
        assert isinstance(results, list)

    def test_retrieve_with_rewrite(self):
        from msam.core import retrieve_with_rewrite
        _store("Rewrite retrieval test")
        results = retrieve_with_rewrite("rewrite test", top_k=3)
        assert isinstance(results, list)

    def test_rewrite_query(self):
        from msam.core import rewrite_query
        result = rewrite_query("What does the user prefer?")
        assert isinstance(result, dict)
        assert "original" in result
        assert "rewritten" in result
        assert "changed" in result

    def test_cached_embed_query(self):
        from msam.core import cached_embed_query
        emb = cached_embed_query("test query")
        assert isinstance(emb, list)
        assert len(emb) > 0

    def test_batch_retrieve(self):
        from msam.core import batch_retrieve
        _store("Batch retrieve test")
        queries = [
            {"query": "batch test", "mode": "task", "top_k": 3},
            {"query": "another batch", "mode": "task", "top_k": 3},
        ]
        results = batch_retrieve(queries)
        assert len(results) == 2
        for r in results:
            assert "query" in r

    def test_batch_query(self):
        from msam.core import batch_query
        from msam.triples import init_triples_schema
        from msam.core import get_db
        conn = get_db()
        init_triples_schema(conn)
        conn.close()
        _store("Batch query test")
        queries = [
            {"query": "batch query test", "mode": "task", "budget": 200},
        ]
        results = batch_query(queries)
        assert len(results) == 1


# ─── Knowledge Management ────────────────────────────────────────────────────


class TestKnowledgeManagement:
    def test_detect_knowledge_gaps(self):
        from msam.core import detect_knowledge_gaps
        from msam.triples import init_triples_schema
        from msam.core import get_db
        conn = get_db()
        init_triples_schema(conn)
        conn.close()
        _store("Jaden lives in Oakland")
        result = detect_knowledge_gaps("Jaden")
        assert isinstance(result, dict)
        assert "entity" in result
        assert result["entity"] == "Jaden"

    def test_estimate_importance(self):
        from msam.core import estimate_importance
        result = estimate_importance("Jaden's favorite color is blue and he works at Acme Corp")
        assert isinstance(result, dict)
        assert "importance" in result
        assert "factors" in result
        assert "recommendation" in result

    def test_find_merge_candidates(self):
        from msam.core import find_merge_candidates
        _store("Merge candidate alpha")
        _store("Merge candidate beta")
        result = find_merge_candidates(similarity_threshold=0.1)
        assert isinstance(result, list)

    def test_split_atom(self):
        from msam.core import split_atom
        aid = _store("First topic. Second topic.")
        result = split_atom(aid, ["First topic.", "Second topic."])
        assert isinstance(result, dict)
        assert result["parent_id"] == aid
        assert result["child_count"] == 2

    def test_summarize_atom(self):
        from msam.core import summarize_atom
        aid = _store(
            "This is a long piece of content with multiple sentences. "
            "It discusses various topics at length. "
            "The agent should be able to compress this effectively. "
            "Only the key information should survive summarization."
        )
        result = summarize_atom(aid, target_tokens=20)
        assert isinstance(result, dict)
        assert result["atom_id"] == aid

    def test_save_and_get_atom_versions(self):
        from msam.core import save_atom_version, get_atom_versions
        aid = _store("Versioned content v1")
        version = save_atom_version(aid, "Versioned content v1", changed_by="test", change_reason="initial")
        assert isinstance(version, int)

        versions = get_atom_versions(aid)
        assert isinstance(versions, list)
        assert len(versions) >= 1


# ─── Negative Knowledge ──────────────────────────────────────────────────────


class TestNegativeKnowledge:
    def test_record_negative(self):
        from msam.core import record_negative
        row_id = record_negative("Who is the president of Mars?", domain="politics")
        assert isinstance(row_id, int)

    def test_check_negative_not_found(self):
        from msam.core import check_negative
        result = check_negative("random unknown query")
        assert isinstance(result, dict)
        assert result.get("known_negative") is False

    def test_check_negative_found(self):
        from msam.core import record_negative, check_negative
        record_negative("What is the meaning of life?")
        result = check_negative("What is the meaning of life?")
        assert result.get("known_negative") is True

    def test_expire_negatives(self):
        from msam.core import expire_negatives
        count = expire_negatives()
        assert isinstance(count, int)


# ─── Session & Working Memory ─────────────────────────────────────────────────


class TestSessionWorkingMemory:
    def test_store_session_boundary(self):
        from msam.core import store_session_boundary
        aid = store_session_boundary(
            session_id="test-session-1",
            summary="Discussed project planning",
            topics_discussed=["project", "planning"],
        )
        assert isinstance(aid, str)
        assert len(aid) > 0

    def test_get_last_sessions(self):
        from msam.core import store_session_boundary, get_last_sessions
        store_session_boundary(session_id="s1", summary="First session")
        store_session_boundary(session_id="s2", summary="Second session")
        result = get_last_sessions(count=2)
        assert isinstance(result, list)

    def test_expire_working_memory(self):
        from msam.core import store_working, expire_working_memory
        store_working("Temp working memory data", session_id="wm-test")
        result = expire_working_memory(session_id="wm-test")
        assert isinstance(result, dict)
        assert "tombstoned" in result


# ─── Provenance & Hooks ───────────────────────────────────────────────────────


class TestProvenance:
    def test_log_and_get_provenance(self):
        from msam.core import log_provenance, get_provenance
        aid = _store("Provenance test atom")
        log_provenance("atom", aid, "store", source="test")
        chain = get_provenance("atom", aid)
        assert isinstance(chain, list)
        assert len(chain) >= 1

    def test_provenance_empty(self):
        from msam.core import get_provenance
        _store("Setup DB")
        chain = get_provenance("atom", "nonexistent_id")
        assert isinstance(chain, list)
        assert len(chain) == 0


class TestHooks:
    def test_register_and_unregister_hook(self):
        from msam.core import register_hook, unregister_hook

        calls = []
        def my_hook(**kwargs):
            calls.append(kwargs)

        register_hook("on_store", my_hook)
        # Store should trigger the hook
        _store("Hook test atom")
        assert len(calls) >= 1

        unregister_hook("on_store", my_hook)
        calls.clear()
        _store("Hook test atom 2")
        assert len(calls) == 0


# ─── Emotional Drift ─────────────────────────────────────────────────────────


class TestEmotionalDrift:
    def test_emotional_drift(self):
        from msam.core import emotional_drift
        _store("Jaden felt excited about the launch")
        result = emotional_drift("Jaden", window_days=30)
        assert isinstance(result, dict)
        assert "entity" in result
        assert "drift" in result


# ─── Metamemory ───────────────────────────────────────────────────────────────


class TestMetamemory:
    def test_metamemory_query(self):
        from msam.core import metamemory_query
        from msam.triples import init_triples_schema
        from msam.core import get_db
        conn = get_db()
        init_triples_schema(conn)
        conn.close()
        _store("Dark mode is the user's preference")
        result = metamemory_query("dark mode")
        assert isinstance(result, dict)
        assert "topic" in result
        assert "coverage" in result
        assert "recommendation" in result


# ─── Pin & Forgetting ─────────────────────────────────────────────────────────


class TestPinning:
    def test_pin_and_unpin_atom(self):
        from msam.core import pin_atom, unpin_atom, list_pinned, is_pinned
        aid = _store("Pinnable fact")

        pin_result = pin_atom(aid, reason="foundational")
        assert pin_result.get("pinned") is True

        pinned = list_pinned()
        assert isinstance(pinned, list)
        assert any(p["id"] == aid for p in pinned)

        unpin_result = unpin_atom(aid)
        assert unpin_result.get("pinned") is False

    def test_is_pinned(self):
        from msam.core import is_pinned
        assert is_pinned({"is_pinned": 1}) is True
        assert is_pinned({"is_pinned": 0}) is False
        assert is_pinned({}) is False

    def test_pin_nonexistent(self):
        from msam.core import pin_atom
        _store("Setup DB")
        result = pin_atom("nonexistent_atom_id")
        assert "error" in result


class TestForgetting:
    def test_log_forgetting(self):
        from msam.core import log_forgetting, get_db
        aid = _store("Soon to be forgotten")
        conn = get_db()
        log_forgetting(conn, aid, "active", "fading", "low_access",
                       factors={"days_since_access": 14})
        conn.commit()
        conn.close()

    def test_get_forgetting_history(self):
        from msam.core import log_forgetting, get_forgetting_history, get_db
        aid = _store("Forgetting history test")
        conn = get_db()
        log_forgetting(conn, aid, "active", "fading", "decay_cycle")
        conn.commit()
        conn.close()

        history = get_forgetting_history(aid)
        assert isinstance(history, list)
        assert len(history) >= 1

    def test_get_recent_forgetting(self):
        from msam.core import log_forgetting, get_recent_forgetting, get_db
        aid = _store("Recent forgetting test")
        conn = get_db()
        log_forgetting(conn, aid, "fading", "dormant", "continued_disuse")
        conn.commit()
        conn.close()

        result = get_recent_forgetting(hours=1)
        assert isinstance(result, list)


# ─── Cache ────────────────────────────────────────────────────────────────────


class TestCacheFunctions:
    def test_clear_cache(self):
        from msam.core import clear_cache, get_cache_stats, cached_embed_query
        # Populate cache
        cached_embed_query("cache test query")
        clear_cache()
        stats = get_cache_stats()
        assert stats["size"] == 0

    def test_get_cache_stats(self):
        from msam.core import get_cache_stats
        stats = get_cache_stats()
        assert isinstance(stats, dict)
        assert "size" in stats
        assert "max_size" in stats
        assert "hits" in stats


# ─── Context Quality ─────────────────────────────────────────────────────────


class TestContextQuality:
    def test_score_context_quality(self, metrics_db):
        from msam.core import score_context_quality, retrieve
        _store("Quality scoring test atom")
        atoms = retrieve("quality scoring", top_k=3)
        if atoms:
            scored = score_context_quality(atoms, "quality scoring")
            assert isinstance(scored, list)
            for a in scored:
                assert "_quality_score" in a
                assert "_include" in a

    def test_pre_warm_context(self):
        from msam.core import pre_warm_context
        result = pre_warm_context({"time_of_day": "morning", "user_active": True})
        assert isinstance(result, dict)
        assert "predicted" in result
        assert "pre_warmed" in result


# ─── Confidence ───────────────────────────────────────────────────────────────


class TestConfidence:
    def test_update_confidence_from_evidence(self):
        from msam.core import update_confidence_from_evidence
        from msam.triples import init_triples_schema
        from msam.core import get_db
        conn = get_db()
        init_triples_schema(conn)
        conn.close()
        _store("Confidence evidence test")
        result = update_confidence_from_evidence()
        assert isinstance(result, dict)
        assert "triples_updated" in result

    def test_decay_confidence(self):
        from msam.core import decay_confidence
        _store("Confidence decay test atom")
        result = decay_confidence()
        assert isinstance(result, dict)
        assert "atoms_checked" in result
        assert "decayed" in result


# ─── Retrieval Adjustments & Access Patterns ──────────────────────────────────


class TestAnalysis:
    def test_compute_retrieval_adjustments(self, metrics_db):
        from msam.core import compute_retrieval_adjustments
        _store("Retrieval adjustment test")
        result = compute_retrieval_adjustments()
        assert isinstance(result, dict)
        assert "atoms_analyzed" in result

    def test_analyze_access_patterns(self, metrics_db):
        from msam.core import analyze_access_patterns
        _store("Access pattern test")
        result = analyze_access_patterns(days=7)
        assert isinstance(result, dict)
        assert "period_days" in result
        assert "total_retrievals" in result


# ─── Outcome Functions (record_outcome, get_outcome_history) ──────────────────


class TestOutcomeFunctions:
    def test_record_outcome(self):
        from msam.core import record_outcome
        aid = _store("Outcome function test")
        result = record_outcome([aid], "positive")
        assert isinstance(result, dict)
        assert result["feedback"] == "positive"
        assert result["updated"] >= 1

    def test_get_outcome_history(self):
        from msam.core import record_outcome, get_outcome_history
        aid = _store("Outcome history test")
        record_outcome([aid], "negative")
        history = get_outcome_history(aid)
        assert isinstance(history, list)
        assert len(history) >= 1

    def test_get_outcome_history_summary(self):
        from msam.core import get_outcome_history
        history = get_outcome_history(limit=10)
        assert isinstance(history, list)
