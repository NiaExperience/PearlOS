"""
MSAM Vector Index -- FAISS-backed approximate nearest neighbor search.

Replaces O(n) brute-force cosine similarity with O(sqrt(n)) FAISS search.
Supports both exact (IndexFlatIP) for <50K vectors and approximate (IndexIVFFlat)
for larger collections.

Module-level singletons with lazy initialization.
"""

import logging
import struct
import threading

import numpy as np

from .config import get_config as _get_config
_cfg = _get_config()

logger = logging.getLogger("msam.vector_index")

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    logger.info("faiss-cpu not installed -- falling back to brute-force similarity")


class VectorIndex:
    """FAISS-backed ANN index with entity ID mapping."""

    # Threshold to switch from exact to approximate index
    APPROX_THRESHOLD = _cfg('vector_index', 'approx_threshold', 50_000)

    def __init__(self, dimension: int = 1024):
        self.dimension = dimension
        self._index = None
        self._id_to_pos = {}    # entity_id -> position in index
        self._pos_to_id = {}    # position -> entity_id
        self._removed = set()   # positions marked for removal
        self._next_pos = 0
        self._lock = threading.Lock()
        self._built = False

    @property
    def total_vectors(self) -> int:
        return self._next_pos - len(self._removed)

    def build_from_db(self, conn, table: str = "atoms",
                      state_filter: tuple = ("active", "fading"),
                      id_column: str = "id"):
        """Bulk load embeddings from SQLite and build FAISS index."""
        if not FAISS_AVAILABLE:
            return

        placeholders = ",".join(["?"] * len(state_filter))
        rows = conn.execute(
            f"SELECT {id_column}, embedding FROM {table} "
            f"WHERE state IN ({placeholders}) AND embedding IS NOT NULL",
            state_filter
        ).fetchall()

        if not rows:
            self._built = True
            return

        # Extract valid vectors
        ids = []
        vecs = []
        for row in rows:
            entity_id = row[0]
            blob = row[1]
            if blob is None or len(blob) < self.dimension * 4:
                continue
            vec = np.frombuffer(blob, dtype=np.float32).copy()
            if len(vec) != self.dimension:
                continue
            ids.append(entity_id)
            vecs.append(vec)

        if not vecs:
            self._built = True
            return

        matrix = np.vstack(vecs).astype(np.float32)
        # Normalize for inner product = cosine similarity
        faiss.normalize_L2(matrix)

        n = len(vecs)
        with self._lock:
            if n < self.APPROX_THRESHOLD:
                # Exact search -- fast enough for small collections
                self._index = faiss.IndexFlatIP(self.dimension)
            else:
                # Approximate search for large collections
                nlist = min(int(np.sqrt(n)), 256)
                quantizer = faiss.IndexFlatIP(self.dimension)
                self._index = faiss.IndexIVFFlat(quantizer, self.dimension, nlist,
                                                  faiss.METRIC_INNER_PRODUCT)
                self._index.train(matrix)
                self._index.nprobe = min(nlist // 4, 16)

            self._index.add(matrix)

            self._id_to_pos = {}
            self._pos_to_id = {}
            for i, entity_id in enumerate(ids):
                self._id_to_pos[entity_id] = i
                self._pos_to_id[i] = entity_id
            self._next_pos = n
            self._removed.clear()
            self._built = True

        logger.info(f"VectorIndex built: {n} vectors, dim={self.dimension}, "
                     f"type={'IVFFlat' if n >= self.APPROX_THRESHOLD else 'FlatIP'}")

    def add(self, entity_id: str, embedding_blob: bytes):
        """Incremental add after store."""
        if not FAISS_AVAILABLE or self._index is None:
            return

        if len(embedding_blob) < self.dimension * 4:
            return

        vec = np.frombuffer(embedding_blob, dtype=np.float32).copy().reshape(1, -1)
        if vec.shape[1] != self.dimension:
            return
        faiss.normalize_L2(vec)

        with self._lock:
            # For IVFFlat, we can still add vectors after training
            self._index.add(vec)
            pos = self._next_pos
            self._id_to_pos[entity_id] = pos
            self._pos_to_id[pos] = entity_id
            self._next_pos += 1

    def remove(self, entity_id: str):
        """Mark entity as removed. Will be filtered from search results."""
        with self._lock:
            pos = self._id_to_pos.pop(entity_id, None)
            if pos is not None:
                self._removed.add(pos)
                self._pos_to_id.pop(pos, None)

        # Trigger rebuild if removed count > 10% of total
        if len(self._removed) > self._next_pos * 0.1:
            self._needs_rebuild = True

    def search(self, query_vec, top_k: int = 20) -> list[tuple[str, float]]:
        """Return (entity_id, cosine_similarity) top-k results.

        Args:
            query_vec: list[float] or numpy array of query embedding
            top_k: number of results to return

        Returns:
            List of (entity_id, similarity_score) tuples, sorted by score desc.
        """
        if not FAISS_AVAILABLE or self._index is None or self._index.ntotal == 0:
            return []

        q = np.array(query_vec, dtype=np.float32).reshape(1, -1)
        faiss.normalize_L2(q)

        # Search more than top_k to account for removed entries
        search_k = min(top_k + len(self._removed) + 10, self._index.ntotal)

        with self._lock:
            scores, indices = self._index.search(q, search_k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            if idx in self._removed:
                continue
            entity_id = self._pos_to_id.get(idx)
            if entity_id is None:
                continue
            results.append((entity_id, float(score)))
            if len(results) >= top_k:
                break

        return results

    def rebuild_if_needed(self, conn, table: str = "atoms",
                          state_filter: tuple = ("active", "fading"),
                          id_column: str = "id"):
        """Rebuild index if too many removals have accumulated."""
        if len(self._removed) > self._next_pos * 0.1:
            self.build_from_db(conn, table, state_filter, id_column)


# ─── Module-level singletons ────────────────────────────────────

_atoms_index = None
_triples_index = None
_atoms_index_lock = threading.Lock()
_triples_index_lock = threading.Lock()


def get_atoms_index(conn=None, dimension: int = None) -> VectorIndex:
    """Get or lazily initialize the atoms vector index singleton."""
    global _atoms_index
    if not FAISS_AVAILABLE:
        return None

    with _atoms_index_lock:
        if _atoms_index is not None and _atoms_index._built:
            return _atoms_index

        from .config import get_config
        cfg = get_config()
        dim = dimension or cfg('embedding', 'dimensions', 1024)
        _atoms_index = VectorIndex(dimension=dim)

        close = False
        if conn is None:
            from .core import get_db
            conn = get_db()
            close = True

        _atoms_index.build_from_db(conn, table="atoms",
                                    state_filter=("active", "fading"),
                                    id_column="id")
        if close:
            conn.close()

        return _atoms_index


def get_triples_index(conn=None, dimension: int = None) -> VectorIndex:
    """Get or lazily initialize the triples vector index singleton."""
    global _triples_index
    if not FAISS_AVAILABLE:
        return None

    with _triples_index_lock:
        if _triples_index is not None and _triples_index._built:
            return _triples_index

        from .config import get_config
        cfg = get_config()
        dim = dimension or cfg('embedding', 'dimensions', 1024)
        _triples_index = VectorIndex(dimension=dim)

        close = False
        if conn is None:
            from .core import get_db
            conn = get_db()
            close = True

        _triples_index.build_from_db(conn, table="triples",
                                      state_filter=("active",),
                                      id_column="id")
        if close:
            conn.close()

        return _triples_index


def reset_indexes():
    """Reset index singletons (for testing)."""
    global _atoms_index, _triples_index
    _atoms_index = None
    _triples_index = None


def on_atom_stored(atom_id: str, embedding_blob: bytes):
    """Called after an atom is stored to update the FAISS index."""
    if _atoms_index is not None and _atoms_index._built:
        _atoms_index.add(atom_id, embedding_blob)


def on_atom_state_changed(atom_id: str, new_state: str):
    """Called when an atom transitions state (e.g., to tombstone)."""
    if new_state in ("dormant", "tombstone") and _atoms_index is not None:
        _atoms_index.remove(atom_id)


def on_triple_stored(triple_id: str, embedding_blob: bytes):
    """Called after a triple is stored to update the FAISS index."""
    if _triples_index is not None and _triples_index._built:
        _triples_index.add(triple_id, embedding_blob)


def faiss_search_atoms(query_emb, top_k: int = 20, conn=None) -> list[tuple[str, float]]:
    """Search atoms using FAISS. Returns [(atom_id, similarity), ...]."""
    idx = get_atoms_index(conn=conn)
    if idx is None:
        return []
    return idx.search(query_emb, top_k=top_k)


def faiss_search_triples(query_emb, top_k: int = 20, conn=None) -> list[tuple[str, float]]:
    """Search triples using FAISS. Returns [(triple_id, similarity), ...]."""
    idx = get_triples_index(conn=conn)
    if idx is None:
        return []
    return idx.search(query_emb, top_k=top_k)
