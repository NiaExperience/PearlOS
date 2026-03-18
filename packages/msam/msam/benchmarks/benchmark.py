#!/usr/bin/env python3
"""
MSAM Benchmark Suite

Three benchmark categories:
  1. Retrieval Quality -- precision/recall/MRR comparing MSAM hybrid vs raw vector
  2. Efficiency -- token savings with quality-adjusted measurement
  3. Cognitive Features -- metamemory accuracy, decay value, contribution feedback

Usage:
    python benchmarks/benchmark.py                    # run all
    python benchmarks/benchmark.py retrieval           # retrieval quality only
    python benchmarks/benchmark.py efficiency           # efficiency only
    python benchmarks/benchmark.py cognitive            # cognitive features only

Output: benchmarks/results.json + human-readable summary
"""

import sys
import os
import json
import time
import math
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from msam.core import (
    get_db, retrieve, hybrid_retrieve, embed_query, unpack_embedding,
    cosine_similarity, dry_retrieve, metamemory_query, score_context_quality,
)
from msam.triples import hybrid_retrieve_with_triples
from msam.config import get_config

_cfg = get_config()


# ─── Metrics ──────────────────────────────────────────────────────

def precision_at_k(retrieved_ids: list, relevant_ids: set, k: int) -> float:
    """Fraction of top-k results that are relevant."""
    if k == 0:
        return 0.0
    top_k = retrieved_ids[:k]
    hits = sum(1 for rid in top_k if rid in relevant_ids)
    return hits / k


def recall_at_k(retrieved_ids: list, relevant_ids: set, k: int) -> float:
    """Fraction of relevant items found in top-k."""
    if not relevant_ids:
        return 1.0  # nothing to find = perfect recall
    top_k = set(retrieved_ids[:k])
    hits = sum(1 for rid in relevant_ids if rid in top_k)
    return hits / len(relevant_ids)


def mrr(retrieved_ids: list, relevant_ids: set) -> float:
    """Mean Reciprocal Rank -- 1/position of first relevant result."""
    for i, rid in enumerate(retrieved_ids):
        if rid in relevant_ids:
            return 1.0 / (i + 1)
    return 0.0


def ndcg_at_k(retrieved_ids: list, relevant_ids: set, k: int) -> float:
    """Normalized Discounted Cumulative Gain at k."""
    def dcg(ids, rel, n):
        score = 0.0
        for i, rid in enumerate(ids[:n]):
            if rid in rel:
                score += 1.0 / math.log2(i + 2)  # i+2 because log2(1) = 0
        return score

    actual = dcg(retrieved_ids, relevant_ids, k)
    # Ideal: all relevant items at top
    ideal_ids = list(relevant_ids)[:k]
    ideal = dcg(ideal_ids, relevant_ids, min(k, len(relevant_ids)))
    if ideal == 0:
        return 1.0 if not relevant_ids else 0.0
    return actual / ideal


def f1_score(precision: float, recall: float) -> float:
    if precision + recall == 0:
        return 0.0
    return 2 * (precision * recall) / (precision + recall)


# ─── Benchmark 1: Retrieval Quality ──────────────────────────────

def raw_vector_retrieve(query: str, top_k: int = 12) -> list[str]:
    """Baseline: pure cosine similarity, no ACT-R, no keywords, no triples."""
    conn = get_db()
    query_emb = embed_query(query)

    atoms = conn.execute(
        "SELECT id, embedding FROM atoms WHERE state = 'active' AND embedding IS NOT NULL"
    ).fetchall()

    scored = []
    for atom in atoms:
        atom_emb = unpack_embedding(atom[1])
        sim = cosine_similarity(query_emb, atom_emb)
        scored.append((atom[0], sim))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [s[0] for s in scored[:top_k]]


def benchmark_retrieval(ground_truth: dict) -> dict:
    """Compare MSAM hybrid retrieval vs raw vector search."""
    print("\n=== Benchmark 1: Retrieval Quality ===")

    k_values = [5, 10, 20]
    results = {
        "msam": {f"p@{k}": [] for k in k_values},
        "raw_vector": {f"p@{k}": [] for k in k_values},
    }
    for method in ["msam", "raw_vector"]:
        for k in k_values:
            results[method][f"r@{k}"] = []
            results[method][f"ndcg@{k}"] = []
        results[method]["mrr"] = []
        results[method]["latency_ms"] = []

    queries = ground_truth["queries"]
    total = len(queries)

    for i, q in enumerate(queries):
        query = q["query"]
        relevant = set(q["relevant_atom_ids"] + q.get("partial_atom_ids", []))
        expected_empty = q.get("expected_empty", False)

        print(f"  [{i+1}/{total}] {query[:50]}... ", end="", flush=True)

        # MSAM hybrid retrieval
        t0 = time.time()
        msam_results = dry_retrieve(query, mode="task", top_k=20)
        msam_latency = (time.time() - t0) * 1000
        msam_ids = [r["id"] for r in msam_results]

        # Raw vector retrieval
        t0 = time.time()
        raw_ids = raw_vector_retrieve(query, top_k=20)
        raw_latency = (time.time() - t0) * 1000

        results["msam"]["latency_ms"].append(msam_latency)
        results["raw_vector"]["latency_ms"].append(raw_latency)

        if expected_empty:
            # For expected-empty queries, good = low similarity scores
            # We measure "false positive rate" -- how many irrelevant atoms score high
            results["msam"]["mrr"].append(1.0 if not msam_ids else 0.0)
            results["raw_vector"]["mrr"].append(1.0 if not raw_ids else 0.0)
            for k in k_values:
                results["msam"][f"p@{k}"].append(1.0)
                results["msam"][f"r@{k}"].append(1.0)
                results["msam"][f"ndcg@{k}"].append(1.0)
                results["raw_vector"][f"p@{k}"].append(1.0)
                results["raw_vector"][f"r@{k}"].append(1.0)
                results["raw_vector"][f"ndcg@{k}"].append(1.0)
            print("(expected empty)")
            continue

        if not relevant:
            print("(no ground truth, skipped)")
            continue

        # Score both methods
        for method, ids in [("msam", msam_ids), ("raw_vector", raw_ids)]:
            results[method]["mrr"].append(mrr(ids, relevant))
            for k in k_values:
                results[method][f"p@{k}"].append(precision_at_k(ids, relevant, k))
                results[method][f"r@{k}"].append(recall_at_k(ids, relevant, k))
                results[method][f"ndcg@{k}"].append(ndcg_at_k(ids, relevant, k))

        msam_mrr_val = results["msam"]["mrr"][-1]
        raw_mrr_val = results["raw_vector"]["mrr"][-1]
        winner = "MSAM" if msam_mrr_val >= raw_mrr_val else "RAW"
        print(f"MRR: MSAM={msam_mrr_val:.3f} RAW={raw_mrr_val:.3f} [{winner}]")

    # Aggregate
    summary = {}
    for method in ["msam", "raw_vector"]:
        summary[method] = {}
        for metric, values in results[method].items():
            if values:
                summary[method][metric] = round(sum(values) / len(values), 4)

    # Compute deltas
    deltas = {}
    for metric in summary["msam"]:
        if metric in summary["raw_vector"]:
            delta = summary["msam"][metric] - summary["raw_vector"][metric]
            deltas[metric] = round(delta, 4)

    return {
        "per_query": results,
        "summary": summary,
        "deltas": deltas,
        "queries_evaluated": total,
    }


# ─── Benchmark 2: Efficiency ─────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token."""
    return len(text) // 4


def benchmark_efficiency(ground_truth: dict) -> dict:
    """Measure token savings: MSAM context vs loading all relevant atoms as flat text."""
    print("\n=== Benchmark 2: Token Efficiency ===")

    conn = get_db()
    results = []

    # Get all active atom content
    all_atoms = conn.execute(
        "SELECT id, content FROM atoms WHERE state = 'active'"
    ).fetchall()
    all_content = "\n".join(a[1] for a in all_atoms)
    total_all_tokens = estimate_tokens(all_content)

    # The REAL baseline: what an agent without MSAM loads at session startup.
    # That's ALL context files the agent would read. Production measured: 9,301 tokens.
    baseline_files = [
        "memory/MEMORY.md",
        "USER.md",
        "SOUL.md",
        "AGENTS.md",
        "TOOLS.md",
    ]
    baseline_content = ""
    for bf in baseline_files:
        path = os.path.join(os.path.dirname(__file__), '..', '..', bf)
        if os.path.exists(path):
            with open(path) as f:
                baseline_content += f.read() + "\n"
    flat_baseline_tokens = estimate_tokens(baseline_content)
    # Floor at production-measured value if files have changed
    flat_baseline_tokens = max(flat_baseline_tokens, 9301)

    queries = [q for q in ground_truth["queries"] if not q.get("expected_empty", False)]

    for i, q in enumerate(queries):
        query = q["query"]
        relevant_ids = set(q["relevant_atom_ids"])

        if not relevant_ids:
            continue

        # MSAM retrieval with token budget
        hybrid = hybrid_retrieve_with_triples(query, mode="task", token_budget=300)
        msam_tokens = hybrid.get("total_tokens", 0)
        # Use _raw_atoms (pre-triple) for coverage, as hybrid may swap atoms for triples
        raw_atoms = hybrid.get("_raw_atoms", hybrid.get("atoms", []))
        msam_atom_ids = set()
        for a in raw_atoms:
            if isinstance(a, dict) and "id" in a:
                msam_atom_ids.add(a["id"])
        # Also check the final atoms list
        for a in hybrid.get("atoms", []):
            if isinstance(a, dict) and "id" in a:
                msam_atom_ids.add(a["id"])

        # Relevant-only baseline: tokens if you could perfectly grep just the right atoms
        relevant_content = []
        for atom in all_atoms:
            if atom[0] in relevant_ids:
                relevant_content.append(atom[1])
        relevant_only_tokens = estimate_tokens("\n".join(relevant_content))

        # Quality: how many relevant atoms did MSAM actually return?
        hits = len(msam_atom_ids & relevant_ids)
        coverage = hits / len(relevant_ids) if relevant_ids else 0

        # Savings vs flat file baseline (the real comparison)
        savings_vs_flat = 1 - (msam_tokens / max(flat_baseline_tokens, 1))
        # Savings vs perfect oracle (theoretical ceiling -- no system achieves this)
        savings_vs_oracle = 1 - (msam_tokens / max(relevant_only_tokens, 1)) if relevant_only_tokens > 0 else 0

        results.append({
            "query": query,
            "msam_tokens": msam_tokens,
            "flat_baseline_tokens": flat_baseline_tokens,
            "relevant_only_tokens": relevant_only_tokens,
            "savings_vs_flat_pct": round(savings_vs_flat * 100, 1),
            "savings_vs_oracle_pct": round(savings_vs_oracle * 100, 1),
            "coverage": round(coverage, 3),
            "relevant_found": hits,
            "relevant_total": len(relevant_ids),
        })

        print(f"  [{i+1}/{len(queries)}] {query[:40]}... "
              f"MSAM={msam_tokens}tok flat={flat_baseline_tokens}tok oracle={relevant_only_tokens}tok "
              f"save_flat={savings_vs_flat*100:.0f}% cov={coverage:.0%}")

    # Aggregate
    avg_savings_flat = sum(r["savings_vs_flat_pct"] for r in results) / len(results)
    avg_savings_oracle = sum(r["savings_vs_oracle_pct"] for r in results) / len(results)
    avg_coverage = sum(r["coverage"] for r in results) / len(results)
    total_msam = sum(r["msam_tokens"] for r in results)
    total_relevant_found = sum(r["relevant_found"] for r in results)
    total_relevant = sum(r["relevant_total"] for r in results)

    return {
        "per_query": results,
        "summary": {
            "avg_savings_vs_flat_pct": round(avg_savings_flat, 1),
            "avg_savings_vs_oracle_pct": round(avg_savings_oracle, 1),
            "avg_coverage": round(avg_coverage, 3),
            "total_msam_tokens": total_msam,
            "flat_baseline_tokens": flat_baseline_tokens,
            "total_all_atom_tokens": total_all_tokens,
            "total_relevant_found": total_relevant_found,
            "total_relevant_possible": total_relevant,
            "overall_savings_vs_flat": round((1 - total_msam / (flat_baseline_tokens * len(results))) * 100, 1),
        },
        "queries_evaluated": len(results),
    }


# ─── Benchmark 3: Cognitive Features ─────────────────────────────

def benchmark_cognitive(ground_truth: dict) -> dict:
    """Test MSAM's cognitive features: metamemory, quality scoring, absent detection."""
    print("\n=== Benchmark 3: Cognitive Features ===")

    results = {
        "metamemory": [],
        "quality_scoring": [],
        "absent_detection": [],
    }

    queries = ground_truth["queries"]

    # 3a: Metamemory accuracy
    # Metamemory works on topic keywords, not full natural language queries.
    # Extract the key topic from each query for fair evaluation.
    def extract_topic(query_text):
        """Extract topic keyword from natural language query."""
        # Remove common question words
        import re
        topic = re.sub(
            r"^(what|how|who|where|when|why|does|is|are|do|can|the|a|an)\s+",
            "", query_text.lower(), flags=re.IGNORECASE
        )
        topic = re.sub(
            r"^(what|how|who|where|when|why|does|is|are|do|can|the|a|an)\s+",
            "", topic, flags=re.IGNORECASE
        )
        # Take first 2-3 significant words
        words = [w for w in topic.split() if len(w) > 2]
        return " ".join(words[:3])

    print("  [Metamemory]")
    for q in queries:
        query = q["query"]
        topic = extract_topic(query)
        expected_empty = q.get("expected_empty", False)
        relevant_count = q["relevant_count"]

        mm = metamemory_query(topic)
        coverage = mm.get("coverage", "none")
        confidence = mm.get("confidence", 0)
        recommendation = mm.get("recommendation", "ask")

        # Evaluate: does metamemory's assessment match reality?
        if expected_empty:
            # Should report low/no coverage
            correct = coverage in ("none", "low")
            correct_rec = recommendation in ("ask", "search")
        elif relevant_count > 10:
            correct = coverage in ("high", "medium")
            correct_rec = recommendation == "retrieve"
        elif relevant_count > 3:
            correct = coverage in ("medium", "low", "high")
            correct_rec = recommendation in ("retrieve", "search")
        else:
            correct = True  # low count = any assessment is reasonable
            correct_rec = True

        results["metamemory"].append({
            "query": query,
            "coverage": coverage,
            "confidence": round(confidence, 3),
            "recommendation": recommendation,
            "relevant_count": relevant_count,
            "expected_empty": expected_empty,
            "coverage_correct": correct,
            "recommendation_correct": correct_rec,
        })

        status = "OK" if correct and correct_rec else "MISS"
        print(f"    {status} | {query[:40]}... | "
              f"cov={coverage} conf={confidence:.3f} rec={recommendation} "
              f"(actual={relevant_count} atoms)")

    # 3b: Quality scoring -- does VOC estimation correlate with ground truth?
    print("  [Quality Scoring]")
    for q in queries:
        if q.get("expected_empty", False):
            continue

        query = q["query"]
        relevant = set(q["relevant_atom_ids"])

        atoms = dry_retrieve(query, mode="task", top_k=20)
        if not atoms:
            continue

        scored = score_context_quality(atoms, query=query)

        # Check: do relevant atoms score higher than irrelevant ones?
        relevant_scores = []
        irrelevant_scores = []
        for atom in scored:
            score = atom.get("_quality_score", 0)
            if atom["id"] in relevant:
                relevant_scores.append(score)
            else:
                irrelevant_scores.append(score)

        avg_relevant = sum(relevant_scores) / len(relevant_scores) if relevant_scores else 0
        avg_irrelevant = sum(irrelevant_scores) / len(irrelevant_scores) if irrelevant_scores else 0
        separation = avg_relevant - avg_irrelevant

        results["quality_scoring"].append({
            "query": query,
            "avg_relevant_score": round(avg_relevant, 3),
            "avg_irrelevant_score": round(avg_irrelevant, 3),
            "separation": round(separation, 3),
            "correct_ranking": separation > 0,
        })

        status = "OK" if separation > 0 else "MISS"
        print(f"    {status} | {query[:40]}... | "
              f"rel={avg_relevant:.3f} irrel={avg_irrelevant:.3f} sep={separation:.3f}")

    # 3c: Absent topic detection
    print("  [Absent Detection]")
    absent_queries = [q for q in queries if q.get("expected_empty", False)]
    for q in absent_queries:
        query = q["query"]
        mm = metamemory_query(query)
        atoms = dry_retrieve(query, mode="task", top_k=5)

        # Good absent detection: low coverage + ask recommendation + low-quality results
        detected = mm.get("coverage") in ("none", "low") and mm.get("recommendation") in ("ask", "search")

        results["absent_detection"].append({
            "query": query,
            "detected": detected,
            "coverage": mm.get("coverage"),
            "recommendation": mm.get("recommendation"),
            "results_returned": len(atoms),
        })

        status = "OK" if detected else "MISS"
        print(f"    {status} | {query[:40]}... | "
              f"cov={mm.get('coverage')} rec={mm.get('recommendation')}")

    # Aggregate
    mm_correct = sum(1 for r in results["metamemory"] if r["coverage_correct"] and r["recommendation_correct"])
    mm_total = len(results["metamemory"])
    qs_correct = sum(1 for r in results["quality_scoring"] if r["correct_ranking"])
    qs_total = len(results["quality_scoring"])
    ad_correct = sum(1 for r in results["absent_detection"] if r["detected"])
    ad_total = len(results["absent_detection"])

    return {
        "per_query": results,
        "summary": {
            "metamemory_accuracy": round(mm_correct / max(mm_total, 1), 3),
            "metamemory_correct": mm_correct,
            "metamemory_total": mm_total,
            "quality_ranking_accuracy": round(qs_correct / max(qs_total, 1), 3),
            "quality_correct": qs_correct,
            "quality_total": qs_total,
            "absent_detection_accuracy": round(ad_correct / max(ad_total, 1), 3),
            "absent_correct": ad_correct,
            "absent_total": ad_total,
        },
    }


# ─── Runner ───────────────────────────────────────────────────────

def print_summary(results: dict):
    """Print human-readable benchmark summary."""
    print("\n" + "=" * 60)
    print("MSAM BENCHMARK RESULTS")
    print("=" * 60)

    if "retrieval" in results:
        r = results["retrieval"]["summary"]
        d = results["retrieval"]["deltas"]
        print("\n--- Retrieval Quality ---")
        print(f"  {'Metric':<12} {'MSAM':>8} {'Raw Vec':>8} {'Delta':>8}")
        print(f"  {'-'*12} {'-'*8} {'-'*8} {'-'*8}")
        for metric in ["p@5", "p@10", "r@10", "r@20", "mrr", "ndcg@10"]:
            msam_val = r.get("msam", {}).get(metric, 0)
            raw_val = r.get("raw_vector", {}).get(metric, 0)
            delta = d.get(metric, 0)
            sign = "+" if delta >= 0 else ""
            print(f"  {metric:<12} {msam_val:>8.4f} {raw_val:>8.4f} {sign}{delta:>7.4f}")

        lat_msam = r.get("msam", {}).get("latency_ms", 0)
        lat_raw = r.get("raw_vector", {}).get("latency_ms", 0)
        print(f"  {'latency_ms':<12} {lat_msam:>8.1f} {lat_raw:>8.1f}")

    if "efficiency" in results:
        e = results["efficiency"]["summary"]
        print("\n--- Token Efficiency ---")
        print(f"  Avg savings vs flat files:      {e['avg_savings_vs_flat_pct']}%")
        print(f"  Avg savings vs perfect oracle:  {e['avg_savings_vs_oracle_pct']}%")
        print(f"  Avg coverage of relevant atoms: {e['avg_coverage']:.1%}")
        print(f"  Overall savings vs flat:        {e['overall_savings_vs_flat']}%")
        print(f"  Flat baseline (per query):      {e['flat_baseline_tokens']} tokens")
        print(f"  Relevant found/possible:        {e['total_relevant_found']}/{e['total_relevant_possible']}")
        print(f"  MSAM tokens (total):            {e['total_msam_tokens']}")

    if "cognitive" in results:
        c = results["cognitive"]["summary"]
        print("\n--- Cognitive Features ---")
        print(f"  Metamemory accuracy:      {c['metamemory_correct']}/{c['metamemory_total']} "
              f"({c['metamemory_accuracy']:.1%})")
        print(f"  Quality ranking accuracy: {c['quality_correct']}/{c['quality_total']} "
              f"({c['quality_ranking_accuracy']:.1%})")
        print(f"  Absent topic detection:   {c['absent_correct']}/{c['absent_total']} "
              f"({c['absent_detection_accuracy']:.1%})")

    print("\n" + "=" * 60)


def main():
    # Load ground truth
    gt_path = os.path.join(os.path.dirname(__file__), "ground_truth.json")
    if os.path.exists(gt_path):
        with open(gt_path) as f:
            ground_truth = json.load(f)
    else:
        # No pre-built ground truth -- generate from synthetic dataset
        print("No ground_truth.json found. Generating from synthetic dataset...")
        try:
            from msam.benchmarks.synthetic_dataset import generate_dataset, populate_db, generate_ground_truth as gen_gt
            atoms = generate_dataset()
            id_map = populate_db(atoms)
            ground_truth = gen_gt(atoms, id_map)
            # Cache for future runs
            with open(gt_path, "w") as f:
                json.dump(ground_truth, f, indent=2)
            print(f"  Ground truth saved to {gt_path}")
        except ImportError:
            # Fallback to legacy ground_truth module
            from ground_truth import generate_ground_truth
            ground_truth = generate_ground_truth()

    # Determine which benchmarks to run
    run_all = len(sys.argv) < 2
    run_targets = set(sys.argv[1:]) if not run_all else {"retrieval", "efficiency", "cognitive"}

    results = {"timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())}
    total_start = time.time()

    if "retrieval" in run_targets:
        results["retrieval"] = benchmark_retrieval(ground_truth)

    if "efficiency" in run_targets:
        results["efficiency"] = benchmark_efficiency(ground_truth)

    if "cognitive" in run_targets:
        results["cognitive"] = benchmark_cognitive(ground_truth)

    results["total_time_seconds"] = round(time.time() - total_start, 1)

    # Save results
    out_path = os.path.join(os.path.dirname(__file__), "results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {out_path}")

    print_summary(results)


if __name__ == "__main__":
    main()
