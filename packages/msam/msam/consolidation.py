"""
MSAM Consolidation Engine -- Sleep-inspired memory consolidation.

Clusters similar atoms, synthesizes abstractions via LLM, and reduces
source atom stability. This is how human memory works during sleep:
50 similar atoms become 1 abstraction.

Also a critical scaling strategy -- keeps the active atom count bounded
regardless of ingestion rate.

Usage:
    from msam.consolidation import ConsolidationEngine
    engine = ConsolidationEngine()
    result = engine.consolidate(dry_run=True)
"""

import json
import logging
import hashlib
from datetime import datetime, timezone

from .config import get_config
from .core import get_db, store_atom, embed_text, pack_embedding, unpack_embedding

logger = logging.getLogger("msam.consolidation")

_cfg = get_config()

# ─── Configuration ──────────────────────────────────────────────

DEFAULT_SIMILARITY_THRESHOLD = _cfg('consolidation', 'similarity_threshold', 0.80)
DEFAULT_MIN_CLUSTER_SIZE = _cfg('consolidation', 'min_cluster_size', 3)
DEFAULT_MAX_CLUSTERS = _cfg('consolidation', 'max_clusters_per_run', 50)
DEFAULT_STABILITY_REDUCTION = _cfg('consolidation', 'stability_reduction_factor', 0.5)


class ConsolidationEngine:
    """Sleep-inspired memory consolidation.

    Clusters similar atoms, synthesizes abstractions via LLM,
    reduces source atom stability.
    """

    def __init__(self, similarity_threshold: float = None,
                 min_cluster_size: int = None,
                 max_clusters: int = None,
                 stability_reduction: float = None):
        self.similarity_threshold = similarity_threshold or DEFAULT_SIMILARITY_THRESHOLD
        self.min_cluster_size = min_cluster_size or DEFAULT_MIN_CLUSTER_SIZE
        self.max_clusters = max_clusters or DEFAULT_MAX_CLUSTERS
        self.stability_reduction = stability_reduction or DEFAULT_STABILITY_REDUCTION

    def consolidate(self, dry_run: bool = False, max_clusters: int = None) -> dict:
        """Main entry: cluster -> synthesize -> restructure.

        Args:
            dry_run: If True, detect clusters but don't synthesize or restructure.
            max_clusters: Override max clusters for this run.

        Returns:
            Dict with clusters_found, clusters_consolidated, atoms_affected, etc.
        """
        max_clusters = max_clusters or self.max_clusters

        # Phase 1: Cluster
        clusters = self._cluster_phase()
        clusters = clusters[:max_clusters]

        if dry_run:
            # Compute per-cluster average similarity for diagnostics
            from .core import cosine_similarity
            cluster_details = []
            total_sim = 0.0
            total_pairs = 0
            for c in clusters:
                pairs_sim = []
                vecs = [unpack_embedding(a['embedding']) for a in c if a.get('embedding')]
                for i in range(len(vecs)):
                    for j in range(i + 1, len(vecs)):
                        pairs_sim.append(cosine_similarity(vecs[i], vecs[j]))
                avg_sim = sum(pairs_sim) / len(pairs_sim) if pairs_sim else 0.0
                total_sim += sum(pairs_sim)
                total_pairs += len(pairs_sim)
                cluster_details.append({
                    "size": len(c),
                    "stream": c[0].get("stream", "semantic"),
                    "avg_similarity": round(avg_sim, 3),
                    "preview": [a["content"][:80] for a in c[:3]],
                })
            return {
                "dry_run": True,
                "clusters_found": len(clusters),
                "clusters": cluster_details,
                "total_atoms_in_clusters": sum(len(c) for c in clusters),
                "avg_similarity": round(total_sim / total_pairs, 3) if total_pairs else 0.0,
            }

        # Phase 2: Synthesize
        syntheses = self._synthesize_phase(clusters)

        # Phase 3: Restructure
        result = self._restructure_phase(syntheses)

        result["clusters_found"] = len(clusters)
        result["clusters_consolidated"] = len(syntheses)
        result["dry_run"] = False

        return result

    def _cluster_phase(self) -> list[list[dict]]:
        """Use FAISS (or brute-force) to find clusters of similar atoms.

        Filters:
        - Only active atoms with embeddings
        - Never cluster pinned atoms
        - Same stream only
        - Minimum cluster size
        """
        conn = get_db()
        rows = conn.execute("""
            SELECT id, content, stream, embedding, access_count, topics, is_pinned
            FROM atoms
            WHERE state = 'active' AND embedding IS NOT NULL AND is_pinned = 0
        """).fetchall()

        if not rows:
            conn.close()
            return []

        atoms = [dict(r) for r in rows]
        atom_map = {a['id']: a for a in atoms}

        # Group by stream
        stream_groups = {}
        for atom in atoms:
            stream_groups.setdefault(atom['stream'], []).append(atom)

        clusters = []
        for stream, group in stream_groups.items():
            if len(group) < self.min_cluster_size:
                continue
            stream_clusters = self._find_clusters_in_group(group, conn)
            clusters.extend(stream_clusters)

        conn.close()

        # Sort by cluster size (largest first)
        clusters.sort(key=len, reverse=True)
        return clusters

    def _find_clusters_in_group(self, atoms: list[dict], conn) -> list[list[dict]]:
        """Find clusters within a stream group using FAISS k-NN or brute-force."""
        # Try FAISS
        try:
            from .vector_index import get_atoms_index, FAISS_AVAILABLE
            if FAISS_AVAILABLE:
                return self._cluster_with_faiss(atoms, conn)
        except Exception:
            pass

        # Fallback: simple greedy clustering
        return self._cluster_brute_force(atoms)

    def _cluster_with_faiss(self, atoms: list[dict], conn) -> list[list[dict]]:
        """Use FAISS to find clusters via k-NN graph."""
        from .vector_index import get_atoms_index

        idx = get_atoms_index(conn=conn)
        if idx is None or not idx._built:
            return self._cluster_brute_force(atoms)

        clustered = set()
        clusters = []

        for atom in atoms:
            if atom['id'] in clustered:
                continue

            vec = unpack_embedding(atom['embedding'])
            neighbors = idx.search(vec, top_k=20)

            cluster = [atom]
            clustered.add(atom['id'])

            atom_map = {a['id']: a for a in atoms}
            for neighbor_id, sim in neighbors:
                if neighbor_id == atom['id'] or neighbor_id in clustered:
                    continue
                if sim < self.similarity_threshold:
                    continue
                neighbor = atom_map.get(neighbor_id)
                if neighbor and neighbor['stream'] == atom['stream']:
                    cluster.append(neighbor)
                    clustered.add(neighbor_id)

            if len(cluster) >= self.min_cluster_size:
                clusters.append(cluster)

        return clusters

    def _cluster_brute_force(self, atoms: list[dict]) -> list[list[dict]]:
        """Simple greedy clustering using pairwise cosine similarity."""
        from .core import cosine_similarity

        clustered = set()
        clusters = []

        for i, atom in enumerate(atoms):
            if atom['id'] in clustered:
                continue

            cluster = [atom]
            clustered.add(atom['id'])
            vec_a = unpack_embedding(atom['embedding'])

            for j in range(i + 1, len(atoms)):
                other = atoms[j]
                if other['id'] in clustered:
                    continue
                vec_b = unpack_embedding(other['embedding'])
                sim = cosine_similarity(vec_a, vec_b)
                if sim >= self.similarity_threshold:
                    cluster.append(other)
                    clustered.add(other['id'])

            if len(cluster) >= self.min_cluster_size:
                clusters.append(cluster)

        return clusters

    def _synthesize_phase(self, clusters: list[list[dict]]) -> list[dict]:
        """Call LLM to generate a synthesis atom per cluster.

        Uses same NVIDIA NIM endpoint as triples.py for consistency.
        Falls back to simple concatenation if LLM is unavailable.
        """
        import requests

        import os
        api_key = _cfg('embedding', 'api_key', None) or os.environ.get('NVIDIA_API_KEY', '')
        llm_url = _cfg('annotation', 'llm_url', 'https://integrate.api.nvidia.com/v1/chat/completions')
        llm_model = _cfg('annotation', 'llm_model', 'mistralai/mistral-large-3-675b-instruct-2512')
        timeout = _cfg('annotation', 'timeout_seconds', 15)

        syntheses = []
        for cluster in clusters:
            contents = [a['content'] for a in cluster]
            joined = "\n- ".join(contents)
            stream = cluster[0].get('stream', 'semantic')
            source_ids = [a['id'] for a in cluster]

            # Try LLM synthesis
            synthesis_content = None
            try:
                prompt = (
                    f"Synthesize the following {len(cluster)} related memory atoms into "
                    f"a single concise summary that captures the essential information. "
                    f"Output ONLY the synthesis, no explanations.\n\n"
                    f"Atoms:\n- {joined}"
                )
                resp = requests.post(
                    llm_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": llm_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 300,
                        "temperature": 0.3,
                    },
                    timeout=timeout,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    synthesis_content = data["choices"][0]["message"]["content"].strip()
            except Exception as e:
                logger.warning(f"LLM synthesis failed: {e}")

            # Fallback: take the longest content as the representative
            if not synthesis_content:
                synthesis_content = max(contents, key=len)
                synthesis_content = f"[Consolidated from {len(cluster)} atoms] {synthesis_content}"

            syntheses.append({
                "content": synthesis_content,
                "stream": stream,
                "source_ids": source_ids,
                "cluster_size": len(cluster),
            })

        return syntheses

    def _restructure_phase(self, syntheses: list[dict]) -> dict:
        """Store synthesis atoms, create atom_relations, reduce source stability."""
        conn = get_db()
        now = datetime.now(timezone.utc).isoformat()

        atoms_stored = 0
        relations_created = 0
        sources_reduced = 0

        for syn in syntheses:
            # Store synthesis atom
            syn_id = store_atom(
                content=syn["content"],
                stream=syn["stream"],
                source_type="consolidation",
                metadata={"consolidated_from": syn["source_ids"][:10],
                          "cluster_size": syn["cluster_size"]},
            )

            if syn_id is None:
                continue
            atoms_stored += 1

            # Create atom_relations (consolidated_into)
            for source_id in syn["source_ids"]:
                try:
                    conn.execute("""
                        INSERT OR IGNORE INTO atom_relations
                            (source_id, target_id, relation_type, confidence, created_at)
                        VALUES (?, ?, 'consolidated_into', 1.0, ?)
                    """, (source_id, syn_id, now))
                    relations_created += 1
                except Exception:
                    pass

            # Reduce source atom stability
            for source_id in syn["source_ids"]:
                try:
                    conn.execute(
                        "UPDATE atoms SET stability = stability * ? WHERE id = ?",
                        (self.stability_reduction, source_id)
                    )
                    sources_reduced += 1
                except Exception:
                    pass

        conn.commit()
        conn.close()

        return {
            "synthesis_atoms_stored": atoms_stored,
            "relations_created": relations_created,
            "source_atoms_reduced": sources_reduced,
        }
