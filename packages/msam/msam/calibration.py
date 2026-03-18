"""
MSAM Calibration -- Cross-provider identity calibration for safe
embedding provider switching.

Provides two operations:
  1. calibrate(): Read-only comparison of current vs target provider rankings
  2. re_embed(): Destructive migration of all atom embeddings to a new provider

The calibrate step lets you measure quality impact *before* switching:
  - Overlap@K: what fraction of top-K results are shared?
  - Kendall's tau: how correlated are the full rankings?
  - Identity reconstruction score: do identity queries still surface identity atoms?

Usage:
    from msam.calibration import calibrate, re_embed

    # Compare current provider vs onnx
    report = calibrate("onnx", top_k=10)

    # Migrate all embeddings to onnx
    result = re_embed("onnx", batch_size=50, dry_run=False)
"""

import logging
import struct
from itertools import combinations

from .config import get_config
from .core import get_db, pack_embedding, unpack_embedding
from .embeddings import _PROVIDERS, get_provider

_cfg = get_config()
logger = logging.getLogger("msam.calibration")


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _instantiate_provider(name):
    """Create a fresh provider instance without affecting the singleton.

    Args:
        name: Provider name from _PROVIDERS registry (e.g. "onnx", "openai").

    Returns:
        An EmbeddingProvider instance.

    Raises:
        ValueError: If provider name is not in the registry.
    """
    provider_cls = _PROVIDERS.get(name)
    if provider_cls is None:
        raise ValueError(
            f"Unknown embedding provider: {name}. "
            f"Available: {', '.join(_PROVIDERS.keys())}"
        )
    return provider_cls()


def _get_identity_queries():
    """Pull identity-related queries from the context config section.

    These queries represent the core identity of the agent/user and are
    used to measure whether a provider switch preserves identity recall.
    """
    queries = []
    for key in ("startup_identity_query", "startup_user_query",
                "startup_emotional_query", "startup_recent_query"):
        q = _cfg('context', key, None)
        if q:
            queries.append(q)
    return queries or ["agent identity core traits personality"]


def _cosine_sim(a, b):
    """Cosine similarity between two float lists."""
    import numpy as np
    a, b = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    dot = np.dot(a, b)
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    return float(dot / norm) if norm > 0 else 0.0


def _kendall_tau(ranking_a, ranking_b):
    """Compute Kendall's tau rank correlation over shared items.

    Both rankings are lists of atom_ids ordered by rank (best first).
    Only items present in both rankings are compared.

    Returns:
        float in [-1, 1]. 1 = perfect agreement, -1 = perfect disagreement.
    """
    shared = set(ranking_a) & set(ranking_b)
    if len(shared) < 2:
        return 0.0

    # Build position maps for shared items only
    pos_a = {item: i for i, item in enumerate(ranking_a) if item in shared}
    pos_b = {item: i for i, item in enumerate(ranking_b) if item in shared}

    items = sorted(shared)
    concordant = 0
    discordant = 0

    for i, j in combinations(items, 2):
        diff_a = pos_a[i] - pos_a[j]
        diff_b = pos_b[i] - pos_b[j]
        product = diff_a * diff_b
        if product > 0:
            concordant += 1
        elif product < 0:
            discordant += 1
        # product == 0: tied, skip

    n = concordant + discordant
    if n == 0:
        return 0.0
    return (concordant - discordant) / n


def _overlap_at_k(ranking_a, ranking_b, k):
    """Compute overlap@K: fraction of top-K items shared between rankings.

    Args:
        ranking_a: List of atom_ids ordered by rank.
        ranking_b: List of atom_ids ordered by rank.
        k: Number of top items to compare.

    Returns:
        float in [0, 1]. 1 = identical top-K.
    """
    top_a = set(ranking_a[:k])
    top_b = set(ranking_b[:k])
    if not top_a or not top_b:
        return 0.0
    return len(top_a & top_b) / k


def _rank_atoms_by_query(query_emb, atom_ids, atom_embeddings):
    """Rank atoms by cosine similarity to query embedding.

    Args:
        query_emb: Query embedding as float list.
        atom_ids: List of atom IDs parallel to atom_embeddings.
        atom_embeddings: List of embedding float lists parallel to atom_ids.

    Returns:
        List of atom_ids sorted by descending similarity.
    """
    import numpy as np
    if not atom_ids:
        return []

    q = np.array(query_emb, dtype=np.float32)
    q_norm = np.linalg.norm(q)
    if q_norm == 0:
        return list(atom_ids)
    q = q / q_norm

    matrix = np.array(atom_embeddings, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix = matrix / norms
    sims = matrix @ q

    ranked_indices = np.argsort(-sims)
    return [atom_ids[i] for i in ranked_indices]


# ─── Calibrate ───────────────────────────────────────────────────────────────


def calibrate(target_provider_name, queries=None, top_k=10):
    """Read-only comparison of current vs target embedding provider.

    For each query:
      1. Embed with current provider -> rank active atoms by cosine sim
      2. Take top-2K atoms as sample, re-embed sample with target provider
      3. Embed query with target provider -> rank sample atoms
      4. Compare: overlap@K, Kendall's tau

    Identity queries get special treatment for the identity_reconstruction
    score.

    Args:
        target_provider_name: Name of target provider (e.g. "onnx").
        queries: Custom queries. Defaults to identity queries from config.
        top_k: K for overlap@K metric.

    Returns:
        {
            "current_provider": str,
            "target_provider": str,
            "per_query": [{query, overlap_at_k, kendall_tau}, ...],
            "aggregate": {
                "mean_overlap_at_k": float,
                "mean_kendall_tau": float,
                "identity_reconstruction_score": float,
                "risk_level": "low"|"medium"|"high",
                "recommendation": str,
            }
        }
    """
    current_provider = get_provider()
    target_provider = _instantiate_provider(target_provider_name)
    current_name = _cfg('embedding', 'provider', 'nvidia-nim')

    identity_queries = set(_get_identity_queries())
    all_queries = queries or list(identity_queries)

    # Load all active/fading atoms with embeddings
    conn = get_db()
    rows = conn.execute(
        "SELECT id, content, embedding FROM atoms WHERE state IN ('active', 'fading') AND embedding IS NOT NULL"
    ).fetchall()
    conn.close()

    if not rows:
        return {
            "current_provider": current_name,
            "target_provider": target_provider_name,
            "per_query": [],
            "aggregate": {
                "mean_overlap_at_k": 0.0,
                "mean_kendall_tau": 0.0,
                "identity_reconstruction_score": 0.0,
                "risk_level": "low",
                "recommendation": "No atoms to compare.",
            },
        }

    all_atom_ids = [r["id"] for r in rows]
    all_contents = [r["content"] for r in rows]
    all_current_embs = [unpack_embedding(r["embedding"]) for r in rows]

    per_query = []
    identity_overlaps = []
    sample_size = min(len(all_atom_ids), top_k * 2)

    for query in all_queries:
        # Step 1: Embed query with current provider, rank all atoms
        try:
            current_query_emb = current_provider.embed(query, input_type="query")
        except Exception as e:
            logger.warning(f"Failed to embed query with current provider: {e}")
            continue

        current_ranking = _rank_atoms_by_query(
            current_query_emb, all_atom_ids, all_current_embs
        )

        # Step 2: Take top-2K as sample
        sample_ids = current_ranking[:sample_size]
        sample_contents = []
        sample_current_embs = []
        id_to_idx = {aid: i for i, aid in enumerate(all_atom_ids)}
        for sid in sample_ids:
            idx = id_to_idx[sid]
            sample_contents.append(all_contents[idx])
            sample_current_embs.append(all_current_embs[idx])

        # Step 3: Re-embed sample with target provider
        try:
            target_sample_embs = target_provider.batch_embed(
                sample_contents, input_type="passage"
            )
            target_query_emb = target_provider.embed(query, input_type="query")
        except Exception as e:
            logger.warning(f"Failed to embed with target provider: {e}")
            continue

        # Step 4: Rank sample with target embeddings
        target_ranking = _rank_atoms_by_query(
            target_query_emb, sample_ids, target_sample_embs
        )

        # Step 5: Compute metrics
        overlap = _overlap_at_k(current_ranking, target_ranking, top_k)
        tau = _kendall_tau(current_ranking[:sample_size], target_ranking)

        per_query.append({
            "query": query,
            "overlap_at_k": round(overlap, 4),
            "kendall_tau": round(tau, 4),
            "sample_size": len(sample_ids),
        })

        if query in identity_queries:
            identity_overlaps.append(overlap)

    # Aggregate
    if per_query:
        mean_overlap = sum(q["overlap_at_k"] for q in per_query) / len(per_query)
        mean_tau = sum(q["kendall_tau"] for q in per_query) / len(per_query)
    else:
        mean_overlap = 0.0
        mean_tau = 0.0

    identity_score = (
        sum(identity_overlaps) / len(identity_overlaps)
        if identity_overlaps else 0.0
    )

    # Risk assessment
    if mean_overlap >= 0.8:
        risk_level = "low"
        recommendation = "Safe to switch. Rankings are highly preserved."
    elif mean_overlap >= 0.5:
        risk_level = "medium"
        recommendation = "Some ranking changes expected. Review identity queries before switching."
    else:
        risk_level = "high"
        recommendation = "Significant ranking divergence. Not recommended without manual review."

    return {
        "current_provider": current_name,
        "target_provider": target_provider_name,
        "top_k": top_k,
        "per_query": per_query,
        "aggregate": {
            "mean_overlap_at_k": round(mean_overlap, 4),
            "mean_kendall_tau": round(mean_tau, 4),
            "identity_reconstruction_score": round(identity_score, 4),
            "risk_level": risk_level,
            "recommendation": recommendation,
        },
    }


# ─── Re-embed ────────────────────────────────────────────────────────────────


def re_embed(target_provider_name, batch_size=50, dry_run=False):
    """Re-embed all active/fading atoms with a new provider.

    This is a destructive operation: it replaces the embedding blob and
    updates the embedding_provider column for every atom.

    After completion, the FAISS vector index (if used) needs rebuilding.

    Args:
        target_provider_name: Name of target provider (e.g. "onnx").
        batch_size: Number of atoms to embed per API call.
        dry_run: If True, only report what would happen.

    Returns:
        {
            "target_provider": str,
            "atoms_total": int,
            "atoms_updated": int,
            "dry_run": bool,
            "index_rebuild_needed": bool,
        }
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT id, content FROM atoms WHERE state IN ('active', 'fading')"
    ).fetchall()

    atom_count = len(rows)

    if dry_run:
        conn.close()
        return {
            "target_provider": target_provider_name,
            "atoms_total": atom_count,
            "atoms_updated": 0,
            "dry_run": True,
            "index_rebuild_needed": atom_count > 0,
        }

    target_provider = _instantiate_provider(target_provider_name)
    updated = 0

    # Process in batches
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        contents = [r["content"] for r in batch]
        ids = [r["id"] for r in batch]

        try:
            embeddings = target_provider.batch_embed(contents, input_type="passage")
        except Exception as e:
            logger.error(f"Batch embed failed at offset {i}: {e}")
            continue

        for atom_id, emb in zip(ids, embeddings):
            emb_blob = pack_embedding(emb)
            conn.execute(
                "UPDATE atoms SET embedding = ?, embedding_provider = ? WHERE id = ?",
                (emb_blob, target_provider_name, atom_id),
            )
            updated += 1

        conn.commit()
        logger.info(f"re_embed: batch {i}-{i+len(batch)} complete ({updated} total)")

    conn.close()

    # Signal FAISS index rebuild
    try:
        from .vector_index import _index_dirty
        _index_dirty.set()
    except (ImportError, AttributeError):
        pass  # vector_index may not have this flag

    logger.info(
        f"re_embed complete: {updated}/{atom_count} atoms migrated to {target_provider_name}"
    )

    return {
        "target_provider": target_provider_name,
        "atoms_total": atom_count,
        "atoms_updated": updated,
        "dry_run": False,
        "index_rebuild_needed": updated > 0,
    }
