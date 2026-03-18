"""MSAM Vector Index Tests -- FAISS-backed approximate nearest neighbor search."""

import struct

import pytest
import numpy as np


# Check if FAISS is available
try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False


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
    # Reset index singletons between tests
    from msam.vector_index import reset_indexes
    reset_indexes()
    yield db_path
    reset_indexes()


class TestVectorIndexInit:
    def test_init_with_dimension(self):
        from msam.vector_index import VectorIndex
        idx = VectorIndex(dimension=128)
        assert idx.dimension == 128
        assert idx.total_vectors == 0
        assert idx._built is False


@pytest.mark.skipif(not FAISS_AVAILABLE, reason="FAISS not installed")
class TestBuildFromDb:
    def test_loads_embeddings(self):
        from msam.core import get_db, run_migrations
        from msam.vector_index import VectorIndex
        import hashlib

        conn = get_db()
        run_migrations(conn)

        # Store a few atoms with embeddings
        for i in range(5):
            emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
            content = f"Vector index test atom {i}"
            content_hash = hashlib.sha256(content.encode()).hexdigest()[:32]
            conn.execute("""
                INSERT INTO atoms (id, content, content_hash, created_at, state,
                    embedding, topics, metadata, encoding_confidence)
                VALUES (?, ?, ?, datetime('now'), 'active', ?, '[]', '{}', 0.7)
            """, (f"vi_{i}", content, content_hash, emb))
        conn.commit()

        idx = VectorIndex(dimension=1024)
        idx.build_from_db(conn, table="atoms", state_filter=("active", "fading"))
        conn.close()

        assert idx._built is True
        assert idx.total_vectors == 5


@pytest.mark.skipif(not FAISS_AVAILABLE, reason="FAISS not installed")
class TestAddAndSearch:
    def test_add_then_search(self):
        from msam.vector_index import VectorIndex

        idx = VectorIndex(dimension=64)
        # Build a minimal empty index first
        import faiss
        idx._index = faiss.IndexFlatIP(64)
        idx._built = True

        # Add a vector
        vec = np.random.randn(64).astype(np.float32)
        blob = struct.pack('64f', *vec)
        idx.add("test_atom_1", blob)

        # Search for the same vector
        results = idx.search(vec.tolist(), top_k=5)
        assert len(results) >= 1
        assert results[0][0] == "test_atom_1"
        assert results[0][1] > 0.9  # high similarity to itself


@pytest.mark.skipif(not FAISS_AVAILABLE, reason="FAISS not installed")
class TestRemove:
    def test_removed_excluded(self):
        from msam.vector_index import VectorIndex
        import faiss

        idx = VectorIndex(dimension=64)
        idx._index = faiss.IndexFlatIP(64)
        idx._built = True

        # Add two vectors
        vec1 = np.random.randn(64).astype(np.float32)
        vec2 = np.random.randn(64).astype(np.float32)
        idx.add("atom_keep", struct.pack('64f', *vec1))
        idx.add("atom_remove", struct.pack('64f', *vec2))

        # Remove one
        idx.remove("atom_remove")

        # Search -- removed one should not appear
        results = idx.search(vec2.tolist(), top_k=5)
        result_ids = [r[0] for r in results]
        assert "atom_remove" not in result_ids


class TestResetIndexes:
    def test_clears_state(self):
        from msam.vector_index import reset_indexes, _atoms_index, _triples_index
        import msam.vector_index as vi
        reset_indexes()
        assert vi._atoms_index is None
        assert vi._triples_index is None
