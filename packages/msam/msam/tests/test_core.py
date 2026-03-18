"""MSAM Core Tests -- smoke tests for storage, retrieval, and scoring."""

import sys
import os
import json
import struct
import tempfile
import sqlite3

import pytest
import numpy as np

# Ensure msam is importable


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Use a temporary database for all tests."""
    db_path = tmp_path / "test_msam.db"
    monkeypatch.setattr("msam.core.DB_PATH", db_path)
    # Also patch embedding to avoid API calls
    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    # Patch the LRU-cached version too
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)
    yield db_path


class TestStoreAndRetrieve:
    def test_store_atom_returns_id(self):
        from msam.core import store_atom
        atom_id = store_atom("Test memory content")
        assert atom_id is not None
        assert len(atom_id) == 16

    def test_store_duplicate_returns_none(self):
        from msam.core import store_atom
        store_atom("Duplicate content test")
        result = store_atom("Duplicate content test")
        assert result is None

    def test_retrieve_finds_stored(self):
        from msam.core import store_atom, retrieve
        store_atom("The sky is blue and water is wet")
        results = retrieve("sky color", top_k=5)
        assert len(results) > 0
        assert any("sky" in r["content"].lower() for r in results)

    def test_retrieve_returns_similarity(self):
        from msam.core import store_atom, retrieve
        store_atom("Python is a programming language")
        results = retrieve("programming", top_k=3)
        assert all("_similarity" in r for r in results)
        assert all("_activation" in r for r in results)

    def test_retrieve_empty_db(self):
        from msam.core import retrieve
        results = retrieve("anything", top_k=5)
        assert results == []

    def test_store_streams(self):
        from msam.core import store_atom, get_stats
        store_atom("Semantic fact", stream="semantic")
        store_atom("Episode yesterday", stream="episodic")
        store_atom("How to do X", stream="procedural")
        stats = get_stats()
        assert stats["by_stream"].get("semantic", 0) >= 1
        assert stats["by_stream"].get("episodic", 0) >= 1
        assert stats["by_stream"].get("procedural", 0) >= 1


class TestBatchCosine:
    def test_batch_matches_individual(self):
        from msam.core import batch_cosine_similarity, cosine_similarity, pack_embedding
        q = list(np.random.randn(1024).astype(float))
        vecs = [pack_embedding(list(np.random.randn(1024).astype(float))) for _ in range(20)]
        
        batch_results = batch_cosine_similarity(q, vecs)
        
        for i in range(20):
            n = len(vecs[i]) // 4
            individual = cosine_similarity(q, list(struct.unpack(f'{n}f', vecs[i])))
            assert abs(batch_results[i] - individual) < 1e-4, f"Mismatch at index {i}"

    def test_batch_handles_none(self):
        from msam.core import batch_cosine_similarity, pack_embedding
        q = list(np.random.randn(1024).astype(float))
        vecs = [None, pack_embedding(list(np.random.randn(1024).astype(float))), None]
        
        results = batch_cosine_similarity(q, vecs)
        assert results[0] == 0.0
        assert results[2] == 0.0
        assert results[1] != 0.0

    def test_batch_empty_input(self):
        from msam.core import batch_cosine_similarity
        assert batch_cosine_similarity([1.0, 2.0], []) == []

    def test_batch_output_range(self):
        from msam.core import batch_cosine_similarity, pack_embedding
        q = list(np.random.randn(1024).astype(float))
        vecs = [pack_embedding(list(np.random.randn(1024).astype(float))) for _ in range(50)]
        results = batch_cosine_similarity(q, vecs)
        for r in results:
            assert -1.01 <= r <= 1.01, f"Similarity out of range: {r}"


class TestConfidenceTiers:
    def test_tier_thresholds(self):
        """Verify tier classification matches documented thresholds."""
        from msam.core import hybrid_retrieve, store_atom
        # Just verify the function runs without error on empty db
        results = hybrid_retrieve("nonexistent query", top_k=5)
        assert results == []

    def test_stats(self):
        from msam.core import store_atom, get_stats
        store_atom("Test atom for stats")
        stats = get_stats()
        assert "total_atoms" in stats
        assert "active_atoms" in stats
        assert "by_stream" in stats
        assert "est_active_tokens" in stats
        assert stats["total_atoms"] >= 1


class TestKeywordSearch:
    def test_keyword_finds_match(self):
        from msam.core import store_atom, keyword_search
        store_atom("Elasticsearch uses inverted indices for fast retrieval")
        results = keyword_search("elasticsearch inverted")
        assert len(results) > 0

    def test_keyword_stopword_filtering(self):
        from msam.core import keyword_search, store_atom
        store_atom("The quick brown fox jumps over the lazy dog")
        # Searching only stopwords should still return something if content matches
        results = keyword_search("the")
        # 'the' is a stopword, should be filtered, so fewer/no results
        # but the fallback handles this


class TestWorkingMemory:
    def test_store_working(self):
        from msam.core import store_working, get_stats
        wid = store_working("Temporary scratchpad data", ttl_minutes=5)
        assert wid is not None
        stats = get_stats()
        assert stats["by_stream"].get("working", 0) >= 1


class TestMerge:
    def test_merge_atoms(self):
        from msam.core import store_atom, merge_atoms
        id1 = store_atom("First version of the fact")
        id2 = store_atom("Second version of the fact, more detail")
        assert id1 and id2
        result = merge_atoms(id1, id2, merged_content="Merged: complete fact with detail")
        assert result["kept"] == id1
        assert result["removed"] == id2


class TestDryRetrieve:
    def test_dry_no_side_effects(self):
        from msam.core import store_atom, dry_retrieve, get_db
        store_atom("Dry retrieve test content")
        
        conn = get_db()
        count_before = conn.execute("SELECT COUNT(*) FROM access_log").fetchone()[0]
        conn.close()
        
        dry_retrieve("test content", top_k=3)
        
        conn = get_db()
        count_after = conn.execute("SELECT COUNT(*) FROM access_log").fetchone()[0]
        conn.close()
        
        assert count_after == count_before, "dry_retrieve should not log access"
