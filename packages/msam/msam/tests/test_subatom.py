"""MSAM Sub-Atom Tests -- sentence-level extraction and deduplication."""

import struct

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
    # Also patch embeddings module for subatom
    monkeypatch.setattr("msam.embeddings.embed_text", lambda t: fake_emb)
    yield db_path


class TestSplitSentences:
    def test_basic_split(self):
        from msam.subatom import split_sentences
        text = "First sentence here. Second sentence here. Third one follows."
        sentences = split_sentences(text)
        assert len(sentences) >= 2

    def test_empty_input(self):
        from msam.subatom import split_sentences
        assert split_sentences("") == []
        assert split_sentences("   ") == []

    def test_single_sentence(self):
        from msam.subatom import split_sentences
        sentences = split_sentences("Just a single sentence without any period or break")
        assert len(sentences) == 1

    def test_newline_split(self):
        from msam.subatom import split_sentences
        text = "First paragraph content here.\n\nSecond paragraph content here."
        sentences = split_sentences(text)
        assert len(sentences) >= 2


class TestDeduplicate:
    def test_removes_similar(self):
        from msam.subatom import deduplicate_sentences

        # Create sentences with the same fake embedding (they'll be "identical")
        sentences = [
            {"atom_id": "a1", "sentence": "User is a software engineer", "score": 0.9, "tokens": 6},
            {"atom_id": "a2", "sentence": "User works in software engineering", "score": 0.7, "tokens": 6},
        ]
        # With fake embeddings both will have cosine sim ~1.0
        result = deduplicate_sentences(sentences, similarity_threshold=0.5)
        # Should keep the higher-scored one
        assert len(result) == 1
        assert result[0]["score"] == 0.9


class TestExtractRelevantSentences:
    def test_returns_scored_sentences(self):
        from msam.core import get_db, run_migrations, store_atom
        from msam.subatom import extract_relevant_sentences

        conn = get_db()
        run_migrations(conn)
        conn.close()

        atom_id = store_atom(
            "Agent Identity: Curious and analytical personality. "
            "Values growth and authenticity. Professional in technical discussions."
        )

        atoms = [{
            "id": atom_id,
            "content": "Agent Identity: Curious and analytical personality. "
                       "Values growth and authenticity. Professional in technical discussions.",
            "_combined_score": 5.0,
        }]

        results = extract_relevant_sentences("agent personality", atoms, token_budget=200)
        assert len(results) >= 1
        assert "sentence" in results[0]
        assert "score" in results[0]
        assert "tokens" in results[0]


class TestPackUnpackEmbedding:
    def test_round_trip(self):
        from msam.subatom import _pack_embedding, _unpack_embedding
        original = [0.1, 0.2, 0.3, -0.5, 1.0]
        packed = _pack_embedding(original)
        unpacked = _unpack_embedding(packed)
        assert len(unpacked) == 5
        for a, b in zip(original, unpacked):
            assert abs(a - b) < 1e-6

    def test_empty(self):
        from msam.subatom import _pack_embedding, _unpack_embedding
        packed = _pack_embedding([])
        unpacked = _unpack_embedding(packed)
        assert unpacked == []


class TestEstimateTokens:
    def test_basic_estimate(self):
        from msam.subatom import _estimate_tokens
        # "hello world" = 11 chars → ~2-3 tokens
        tokens = _estimate_tokens("hello world")
        assert tokens >= 1
        assert tokens <= 5

    def test_empty_returns_one(self):
        from msam.subatom import _estimate_tokens
        assert _estimate_tokens("") == 1


class TestCacheSentenceEmbeddings:
    def test_caches_and_skips_existing(self):
        from msam.core import get_db, run_migrations, store_atom
        from msam.subatom import cache_sentence_embeddings

        conn = get_db()
        run_migrations(conn)
        conn.close()

        atom_id = store_atom(
            "First sentence here. Second sentence here. Third one follows."
        )

        conn = get_db()
        count1 = cache_sentence_embeddings(atom_id,
            "First sentence here. Second sentence here. Third one follows.", conn)
        assert count1 >= 2

        # Second call should skip (already cached)
        count2 = cache_sentence_embeddings(atom_id,
            "First sentence here. Second sentence here. Third one follows.", conn)
        assert count2 == count1  # returns existing count
        conn.close()


class TestCacheAllSentences:
    def test_caches_all_active(self):
        from msam.core import get_db, run_migrations, store_atom
        from msam.subatom import cache_all_sentences

        conn = get_db()
        run_migrations(conn)
        conn.close()

        store_atom("Atom one content. Second sentence in atom one.")
        store_atom("Atom two content. Another sentence in atom two.")

        result = cache_all_sentences()
        assert result["cached"] >= 2
        assert result["sentences"] >= 4
