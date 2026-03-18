#!/usr/bin/env python3
"""
One-command MSAM benchmark: generate synthetic data -> populate DB -> run benchmarks.

Uses deterministic content-hash embeddings (no API key required).
Texts sharing character n-grams produce correlated vectors, giving rough
semantic similarity for meaningful retrieval quality comparisons.

Usage:
    python -m msam.benchmarks.run           # run all benchmarks
    python msam/benchmarks/run.py           # same, direct execution
"""

import hashlib
import json
import os
import sys
import tempfile
import time

import numpy as np

# ---------------------------------------------------------------------------
# 1. Set up a fresh temp DB *before* any msam imports touch DB_PATH
# ---------------------------------------------------------------------------
_tmpdir = tempfile.mkdtemp(prefix="msam_bench_")
os.environ["MSAM_DATA_DIR"] = _tmpdir

# Force config reload so data_dir picks up the new env var
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from msam.config import reload_config, get_config
reload_config()

_cfg = get_config()
_DIM = _cfg("embedding", "dimensions", 1024)


def _content_embedding(text: str) -> list:
    """Deterministic embedding from content using character n-gram hashing.

    Generates vectors where texts sharing n-grams have correlated dimensions,
    giving rough semantic similarity without any external model.
    """
    vec = np.zeros(_DIM, dtype=np.float32)
    text_lower = text.lower()
    # Hash overlapping character trigrams into vector dimensions
    for i in range(len(text_lower) - 2):
        trigram = text_lower[i:i+3]
        h = int(hashlib.md5(trigram.encode()).hexdigest(), 16)
        idx = h % _DIM
        sign = 1.0 if (h // _DIM) % 2 == 0 else -1.0
        vec[idx] += sign
    # Normalize to unit vector
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


# ---------------------------------------------------------------------------
# 2. Import all msam modules, then patch embedding functions
# ---------------------------------------------------------------------------
import msam.core
import msam.embeddings
from msam.core import get_db, run_migrations, DB_PATH
from msam.triples import init_triples_schema
from msam.benchmarks.synthetic_dataset import generate_dataset, populate_db, generate_ground_truth
import msam.benchmarks.benchmark as _bench_mod
from msam.benchmarks.benchmark import (
    benchmark_retrieval, benchmark_efficiency, benchmark_cognitive, print_summary,
)

# Patch all embedding entry points with deterministic content-hash embeddings
msam.core.embed_text = _content_embedding
msam.core.embed_query = _content_embedding
msam.core.cached_embed_query = _content_embedding
msam.embeddings.embed_text = _content_embedding
_bench_mod.embed_query = _content_embedding
# Also patch the import alias used by retrieval_v2 if present
if hasattr(msam.core, '_cached_embed_query_import'):
    msam.core._cached_embed_query_import = _content_embedding


def main():
    print("=" * 60)
    print("MSAM Synthetic Benchmark Runner")
    print("=" * 60)
    print(f"Temp data dir:  {_tmpdir}")
    print(f"DB path:        {DB_PATH}")
    print(f"Embeddings:     deterministic n-gram hash ({_DIM}-dim)")
    t0 = time.time()

    # 3. Initialize database schema
    print("\n[1/5] Initializing fresh database...")
    conn = get_db()
    conn.close()
    run_migrations()
    init_triples_schema()
    print("  Database schema ready.")

    # 4. Generate synthetic dataset
    print("\n[2/5] Generating synthetic dataset...")
    atoms = generate_dataset()
    print(f"  {len(atoms)} atoms generated across "
          f"{len(set(a['stream'] for a in atoms))} streams.")

    # 5. Populate DB with synthetic atoms
    print("\n[3/5] Populating database...")
    id_map = populate_db(atoms)
    print(f"  {len(id_map)} atoms written to DB.")

    # 6. Generate ground truth using actual DB IDs
    print("\n[4/5] Generating ground truth...")
    ground_truth = generate_ground_truth(atoms, id_map)
    gt_path = os.path.join(os.path.dirname(__file__), "ground_truth.json")
    with open(gt_path, "w") as f:
        json.dump(ground_truth, f, indent=2)
    print(f"  {len(ground_truth['queries'])} queries written to {gt_path}")

    # 7. Run all 3 benchmark suites
    print("\n[5/5] Running benchmarks...")
    results = {"timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())}
    results["data_dir"] = _tmpdir
    results["atom_count"] = len(id_map)
    results["query_count"] = len(ground_truth["queries"])
    results["embedding_mode"] = "deterministic_ngram_hash"

    results["retrieval"] = benchmark_retrieval(ground_truth)
    results["efficiency"] = benchmark_efficiency(ground_truth)
    results["cognitive"] = benchmark_cognitive(ground_truth)

    results["total_time_seconds"] = round(time.time() - t0, 1)

    # 8. Save results
    out_path = os.path.join(os.path.dirname(__file__), "results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")

    print_summary(results)

    print(f"\nTotal wall time: {results['total_time_seconds']}s")
    print(f"Temp DB at: {_tmpdir} (clean up manually or let OS handle it)")


if __name__ == "__main__":
    main()
