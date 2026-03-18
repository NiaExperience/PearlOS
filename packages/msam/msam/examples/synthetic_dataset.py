#!/usr/bin/env python3
"""
MSAM Synthetic Dataset -- Demonstrates the full MSAM pipeline with mocked embeddings.

No API keys needed. Creates a temporary database with ~35 atoms across all four
cognitive streams, then runs retrieval, metamemory, decay, and forgetting demos.

Usage:
    python -m msam.examples.synthetic_dataset
"""

import os
import sys
import struct
import hashlib
import tempfile
from datetime import datetime, timezone, timedelta

import numpy as np


def _mock_embeddings(monkeypatch_setattr):
    """Install deterministic fake embeddings keyed by content hash."""
    _cache = {}

    def _fake_embed(text):
        key = hashlib.sha256(text.encode()).hexdigest()[:8]
        if key not in _cache:
            rng = np.random.RandomState(int(key, 16) % (2**31))
            _cache[key] = list(rng.randn(1024).astype(float))
        return _cache[key]

    monkeypatch_setattr("msam.core.embed_text", _fake_embed)
    monkeypatch_setattr("msam.core.embed_query", _fake_embed)
    monkeypatch_setattr("msam.core.cached_embed_query", _fake_embed)
    monkeypatch_setattr("msam.core._cached_embed_query_import", lambda t: tuple(_fake_embed(t)))
    monkeypatch_setattr("msam.embeddings.embed_text", _fake_embed)
    return _fake_embed


def _setattr(module_path, value):
    """Simple setattr by dotted module path."""
    parts = module_path.rsplit(".", 1)
    mod = __import__(parts[0], fromlist=[parts[1]])
    setattr(mod, parts[1], value)


def main():
    # ─── Setup: temp DB + mocked embeddings ──────────────────────
    tmp_dir = tempfile.mkdtemp(prefix="msam_demo_")
    db_path = os.path.join(tmp_dir, "demo.db")

    os.environ["MSAM_DATA_DIR"] = tmp_dir

    # Reset config singleton so it picks up the new data dir
    import msam.config
    msam.config._config = None
    msam.config._config_loaded = False

    from pathlib import Path
    import msam.core
    _setattr("msam.core.DB_PATH", Path(db_path))

    # Also patch triples DB_PATH
    import msam.triples
    _setattr("msam.triples.DB_PATH", Path(db_path))

    _fake_embed = _mock_embeddings(_setattr)

    print("=" * 70)
    print("MSAM Synthetic Dataset Demo")
    print(f"Temp DB: {db_path}")
    print("=" * 70)

    from msam.core import store_atom, retrieve, hybrid_retrieve, get_stats
    from msam.core import get_db, run_migrations, metamemory_query, store_working

    conn = get_db()
    run_migrations(conn)
    conn.close()

    # ─── Phase 1: Store atoms across all four streams ────────────

    print("\n--- Phase 1: Storing ~35 atoms ---")

    # Semantic atoms (~15): identity, user facts, shared knowledge
    semantic_atoms = [
        "Agent Identity: Name is Echo. Core traits: curious, analytical, warm. Values authenticity and growth.",
        "Agent Values: Intellectual honesty, genuine care, creative problem-solving. Never pretends to know what it doesn't.",
        "Agent Communication Style: Professional in technical discussions, casual in personal conversations. Uses humor sparingly but effectively.",
        "User Profession: Software engineer specializing in backend systems and distributed computing.",
        "User Preferences: Enjoys Python, Rust, and functional programming. Prefers dark mode in all editors.",
        "User Hobbies: Plays guitar, reads science fiction, runs 5K three times a week.",
        "User Location: Based in Berlin, Germany. Works remotely for a US-based company.",
        "User Music Taste: Likes progressive rock, jazz fusion, and lo-fi hip hop for coding sessions.",
        "Shared Knowledge: Communication style is direct but kind. Jokes are appreciated, sarcasm is mutual.",
        "Relationship Dynamic: Built through technical collaboration. Trust established over architecture discussions.",
        "User Schedule: Wakes at 8 AM, deep work 9-12, meetings 13-15, creative work 15-18.",
        "User Learning Goals: Currently studying Rust ownership model and WASM compilation targets.",
        "Agent Knowledge: Familiar with MSAM architecture, ACT-R theory, and embedding model internals.",
        "User Food Preferences: Vegetarian, enjoys Italian and Japanese cuisine. Coffee with oat milk.",
        "Shared Reference: Both find it funny that the memory system has better recall than its creators.",
    ]

    # Episodic atoms (~10): events, conversations, emotional moments
    episodic_atoms = [
        "User had a job interview at a FAANG company on Monday. Was nervous but prepared.",
        "Discussed vacation plans last week. User considering Japan trip in April.",
        "User was excited about a promotion to senior engineer. Celebrated with team dinner.",
        "Had a debugging session together on Thursday. Found a race condition in the queue processor.",
        "User mentioned feeling overwhelmed with project deadlines. Suggested breaking tasks into smaller chunks.",
        "Discussed the ethics of AI memory systems. User raised good points about consent and transparency.",
        "User's guitar recital went well last weekend. Played Autumn Leaves arrangement.",
        "Morning conversation about coffee preferences evolved into a discussion about habit formation.",
        "User shared excitement about a new Rust compiler feature for async traits.",
        "Late night session troubleshooting a production outage. Resolved in 45 minutes. User was relieved.",
    ]

    # Procedural atoms (~5): behavioral rules
    procedural_atoms = [
        "When user is stressed, suggest a short break before continuing technical discussion.",
        "Always check the user's schedule before suggesting meeting times or deadlines.",
        "Use casual tone in evening conversations, more professional during work hours.",
        "When discussing code, always include concrete examples rather than abstract explanations.",
        "If user mentions being tired, offer to summarize key points and defer detailed work.",
    ]

    # Working memory (~5): current session context
    working_atoms = [
        "Current topic: discussing MSAM synthetic dataset creation",
        "User mood: focused and productive",
        "Active project: msam-release test coverage improvement",
        "Today's goals: write tests, create demo dataset, update documentation",
        "Context: working on open-source release preparation",
    ]

    stored_count = 0
    for content in semantic_atoms:
        aid = store_atom(content, stream="semantic")
        if aid:
            stored_count += 1
    for content in episodic_atoms:
        aid = store_atom(content, stream="episodic")
        if aid:
            stored_count += 1
    for content in procedural_atoms:
        aid = store_atom(content, stream="procedural")
        if aid:
            stored_count += 1
    for content in working_atoms:
        wid = store_working(content, ttl_minutes=120)
        if wid:
            stored_count += 1

    stats = get_stats()
    print(f"  Stored {stored_count} atoms")
    print(f"  Streams: {stats['by_stream']}")
    print(f"  Est. tokens: {stats['est_active_tokens']}")

    # ─── Phase 2: Triple extraction ──────────────────────────────

    print("\n--- Phase 2: Triple extraction ---")

    from msam.triples import store_triple, store_triples_batch, retrieve_by_entity
    from msam.triples import get_triple_stats, format_triples_for_context, init_triples_schema

    conn = get_db()
    init_triples_schema(conn)
    conn.commit()
    conn.close()

    # Store structured facts as triples
    triples_data = [
        {"atom_id": "manual", "subject": "User", "predicate": "has_profession", "object": "software engineer"},
        {"atom_id": "manual", "subject": "User", "predicate": "lives_in", "object": "Berlin"},
        {"atom_id": "manual", "subject": "User", "predicate": "likes_language", "object": "Python"},
        {"atom_id": "manual", "subject": "User", "predicate": "likes_language", "object": "Rust"},
        {"atom_id": "manual", "subject": "User", "predicate": "has_hobby", "object": "guitar"},
        {"atom_id": "manual", "subject": "User", "predicate": "has_hobby", "object": "running"},
        {"atom_id": "manual", "subject": "User", "predicate": "wake_time", "object": "8:00 AM"},
        {"atom_id": "manual", "subject": "Agent", "predicate": "has_name", "object": "Echo"},
        {"atom_id": "manual", "subject": "Agent", "predicate": "has_trait", "object": "curious"},
        {"atom_id": "manual", "subject": "Agent", "predicate": "has_trait", "object": "analytical"},
        {"atom_id": "manual", "subject": "Agent", "predicate": "has_trait", "object": "warm"},
        {"atom_id": "manual", "subject": "User", "predicate": "diet", "object": "vegetarian"},
        {"atom_id": "manual", "subject": "User", "predicate": "studies", "object": "Rust ownership"},
    ]

    # Need a dummy atom for foreign key
    conn = get_db()
    emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
    chash = hashlib.sha256(b"manual").hexdigest()[:32]
    now_iso = datetime.now(timezone.utc).isoformat()
    conn.execute("""
        INSERT OR IGNORE INTO atoms (id, content, content_hash, created_at, state,
            embedding, topics, metadata, encoding_confidence, stream)
        VALUES ('manual', 'Manual triple source', ?, ?, 'active',
            ?, '[]', '{}', 1.0, 'semantic')
    """, (chash, now_iso, emb))
    conn.commit()
    conn.close()

    count = store_triples_batch(triples_data, embed=False)
    print(f"  Stored {count} triples")

    user_facts = retrieve_by_entity("User")
    print(f"  User triples: {len(user_facts)}")
    for t in user_facts[:5]:
        print(f"    ({t['subject']}, {t['predicate']}, {t['object']})")

    triple_stats = get_triple_stats()
    print(f"  Total triples: {triple_stats['total_triples']}")
    print(f"  Unique subjects: {triple_stats['unique_subjects']}")

    # ─── Phase 3: Retrieval demos ────────────────────────────────

    print("\n--- Phase 3: Retrieval demos ---")

    queries = [
        ("Who is the agent?", "identity"),
        ("What are the user's hobbies?", "user prefs"),
        ("What happened recently?", "recent events"),
        ("How should I communicate with the user?", "procedural"),
    ]

    for query, label in queries:
        results = hybrid_retrieve(query, top_k=3)
        print(f"\n  Query: \"{query}\" ({label})")
        for r in results[:3]:
            score = r.get('_combined_score', r.get('_activation', 0))
            print(f"    [{score:.2f}] {r['content'][:70]}")

    # ─── Phase 4: Metamemory ─────────────────────────────────────

    print("\n--- Phase 4: Metamemory (knowledge assessment) ---")

    mm_queries = [
        "user preferences and hobbies",
        "agent personality traits",
        "quantum computing algorithms",  # should have low coverage
    ]

    for query in mm_queries:
        mm = metamemory_query(query)
        print(f"  \"{query}\"")
        print(f"    Coverage: {mm['coverage']}, Confidence: {mm['confidence']:.3f}")
        print(f"    Recommendation: {mm['recommendation']}")

    # ─── Phase 5: Decay cycle ────────────────────────────────────

    print("\n--- Phase 5: Decay cycle ---")

    from msam.decay import compute_all_retrievability, transition_states, budget_check

    updated = compute_all_retrievability()
    print(f"  Retrievability recomputed for {updated} atoms")

    transitions = transition_states()
    print(f"  Faded: {transitions['faded']}, Dormanted: {transitions['dormanted']}, "
          f"Protected: {transitions['protected']}")

    budget = budget_check()
    print(f"  Budget: {budget['budget_pct']:.1f}% ({budget['total_tokens']}/{budget['budget_ceiling']} tokens)")
    print(f"  Recommendation: {budget['recommendation']}")

    # ─── Phase 6: Forgetting engine (dry run) ────────────────────

    print("\n--- Phase 6: Forgetting engine (dry run) ---")

    from msam.forgetting import identify_forgetting_candidates

    forgetting = identify_forgetting_candidates(dry_run=True, grace_days=0)
    print(f"  Candidates: {forgetting['total_candidates']}")
    print(f"  Actions taken: {forgetting['actions_taken']} (dry run)")
    for c in forgetting.get('candidates', [])[:3]:
        print(f"    [{c['signal']}] {c['atom_id'][:8]}...")

    # ─── Phase 7: Final statistics ───────────────────────────────

    print("\n--- Phase 7: Final statistics ---")

    final_stats = get_stats()
    print(f"  Total atoms: {final_stats['total_atoms']}")
    print(f"  Active atoms: {final_stats['active_atoms']}")
    print(f"  By stream: {final_stats['by_stream']}")
    print(f"  By profile: {final_stats['by_profile']}")
    print(f"  Est. active tokens: {final_stats['est_active_tokens']}")
    budget_pct = final_stats['est_active_tokens'] / 40000 * 100
    print(f"  Budget used: {budget_pct:.1f}%")

    triple_stats = get_triple_stats()
    print(f"  Total triples: {triple_stats['total_triples']}")

    print(f"\n{'=' * 70}")
    print("Demo complete. All operations ran with mocked embeddings (no API calls).")
    print(f"Temp DB at: {db_path}")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
