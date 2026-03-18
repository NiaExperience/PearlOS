#!/usr/bin/env python3
"""
MSAM Quickstart -- Store, retrieve, and explore memory in 50 lines.

Prerequisites:
    1. Copy msam.example.toml to msam.toml
    2. Set your embedding API key (e.g., NVIDIA_NIM_API_KEY)
    3. Run: python msam/init_db.py
"""

from msam.core import store_atom, retrieve, hybrid_retrieve, get_stats, metamemory_query
from msam.triples import extract_and_store, hybrid_retrieve_with_triples

# ─── Store some memories ──────────────────────────────────────────

print("=== Storing atoms ===")
store_atom("The user's favorite color is blue")
store_atom("We discussed project architecture on Monday")
store_atom("The server runs on port 8080 with TLS enabled")
print(f"Stats: {get_stats()['total_atoms']} atoms stored\n")

# ─── Extract triples (structured facts) ──────────────────────────

print("=== Extracting triples ===")
from msam.triples import retrieve_by_entity
count = extract_and_store(
    atom_id="demo",
    content="The user's favorite color is blue",
)
print(f"  Extracted {count} triples")
# Retrieve triples by entity
user_triples = retrieve_by_entity("user", top_k=5)
for t in user_triples:
    print(f"  ({t['subject']}, {t['predicate']}, {t['object']})")
print()

# ─── Retrieve by semantic similarity ─────────────────────────────

print("=== Semantic retrieval ===")
results = retrieve("What color does the user like?", top_k=3)
for r in results:
    print(f"  [{r['_activation']:.2f}] {r['content'][:80]}")
print()

# ─── Hybrid retrieval (atoms + triples) ──────────────────────────

print("=== Hybrid retrieval ===")
hybrid = hybrid_retrieve_with_triples("user preferences", token_budget=200)
print(f"  Triples: {len(hybrid['triples'])}")
print(f"  Atoms: {len(hybrid['atoms'])}")
print(f"  Total tokens: {hybrid['total_tokens']}")
print()

# ─── Metamemory (do I know this?) ────────────────────────────────

print("=== Metamemory ===")
mm = metamemory_query("user preferences")
print(f"  Coverage: {mm['coverage']}")
print(f"  Confidence: {mm['confidence']:.3f}")
print(f"  Recommendation: {mm['recommendation']}")
print()

mm2 = metamemory_query("quantum physics")
print(f"  Coverage (quantum physics): {mm2['coverage']}")
print(f"  Recommendation: {mm2['recommendation']}")
