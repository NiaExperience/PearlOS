#!/usr/bin/env python3
"""
MSAM Remember -- Integration layer for MSAM memory pipeline.
Replaces markdown file reads with MSAM retrieval.

Usage:
    msam query "What does the user like?"
    msam query "server config" --mode companion
    msam store "User mentioned they prefer sushi over pizza"
    msam context   # Get session startup context (replaces file loads)
    msam snapshot  # Log system metrics
    
    All commands accept --caller <name> (heartbeat|session_startup|conversation|pulse|cron|unknown)
"""

import sys
import os
import json
import time
import hashlib
from pathlib import Path


from .config import get_config
_cfg = get_config()

from .core import hybrid_retrieve, store_atom, get_stats
from .annotate import heuristic_annotate, classify_profile, classify_stream, smart_annotate
from .metrics import (
    log_system_snapshot, log_comparison, log_access_event, _compute_activation_stats
)
from .triples import (
    extract_and_store as extract_triples,
    hybrid_retrieve_with_triples,
    get_triple_stats,
    log_triple_store_snapshot,
    init_triples_schema,
)
from .session_dedup import get_served_ids, record_served, clear_session


# ─── Shannon compression codebook for recurring entities ─────────────────────
_CODEBOOK = {
    'Agent': 'A',
    'User': 'U',
    'MSAM': 'M',
    # Add your entity codebook entries here
    
    
}
_CODEBOOK_REVERSE = {v: k for k, v in _CODEBOOK.items()}


def _shannon_floor_tokens(text: str) -> int:
    """Compute Shannon entropy floor in tokens for given text."""
    import math, collections
    if not text.strip():
        return 0
    chars = text.lower()
    freq = collections.Counter(chars)
    total = len(chars)
    entropy = -sum((c / total) * math.log2(c / total) for c in freq.values())
    min_bits = entropy * total
    return int(min_bits / 8 / 4)  # bits -> bytes -> tokens


def _compress(text: str) -> str:
    """Apply codebook compression to text."""
    for full, short in _CODEBOOK.items():
        text = text.replace(full, short)
    return text


def _decompress(text: str) -> str:
    """Reverse codebook compression."""
    for short, full in _CODEBOOK_REVERSE.items():
        text = text.replace(short, full)
    return text


# ─── Delta encoding: track section hashes between startups ───────────────────
from .config import get_data_dir as _get_data_dir
_DELTA_HASH_FILE = _get_data_dir() / "last_context_hash.json"


def _load_hashes():
    try:
        return json.loads(_DELTA_HASH_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_hashes(hashes):
    _DELTA_HASH_FILE.write_text(json.dumps(hashes))


def _section_hash(atoms):
    content = "|".join(a.get("content", "") for a in atoms)
    return hashlib.sha256(content.encode()).hexdigest()[:16]


_last_snapshot_time = 0

def _snapshot_safe():
    """Log system snapshot -- throttled to once per 5 minutes."""
    global _last_snapshot_time
    import time as _time
    now = _time.time()
    if now - _last_snapshot_time < 300:
        return
    _last_snapshot_time = now
    try:
        log_system_snapshot()
    except Exception:
        pass


WORKSPACE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

# Markdown files that session startup would load (the old approach).
# Configure these for your deployment to measure token savings vs flat files.
# If files don't exist, token comparison gracefully returns 0.
STARTUP_FILES = _cfg('comparison', 'startup_files', [])

# Minimum file a query would need to load
QUERY_FILES = _cfg('comparison', 'query_files', [])


def _measure_markdown_tokens(files):
    """Measure actual token cost of loading markdown files (~4 chars/token)."""
    total_chars = 0
    for f in files:
        path = os.path.join(WORKSPACE, f)
        try:
            total_chars += os.path.getsize(path)
        except OSError:
            pass
    return total_chars // 4


def _measure_markdown_startup_tokens():
    return _measure_markdown_tokens(STARTUP_FILES)


def _measure_markdown_query_tokens():
    return _measure_markdown_tokens(QUERY_FILES)


def _extract_caller(args):
    """Extract --caller flag from args list. Returns (caller, cleaned_args)."""
    caller = "unknown"
    if "--caller" in args:
        idx = args.index("--caller")
        if idx + 1 < len(args):
            caller = args[idx + 1]
            args = args[:idx] + args[idx + 2:]
        else:
            args = args[:idx]
    return caller, list(args)


def cmd_query(args):
    """Retrieve via hybrid pipeline (triples + atoms). Default path for all queries."""
    caller, args = _extract_caller(args)

    query = " ".join(args)
    mode = "task"
    top_k = _cfg('context', 'default_top_k', 10)
    budget = _cfg('context', 'default_token_budget', 500)

    # Parse flags
    if "--mode" in args:
        idx = args.index("--mode")
        if idx + 1 < len(args):
            mode = args[idx + 1]
            args = args[:idx] + args[idx+2:]
            query = " ".join(args)

    if "--top-k" in args:
        idx = args.index("--top-k")
        if idx + 1 < len(args):
            top_k = int(args[idx + 1])
            budget = top_k * 44  # scale budget with top_k
            args = args[:idx] + args[idx+2:]
            query = " ".join(args)

    if "--budget" in args:
        idx = args.index("--budget")
        if idx + 1 < len(args):
            budget = int(args[idx + 1])
            args = args[:idx] + args[idx+2:]
            query = " ".join(args)

    t0 = time.time()

    # Single hybrid retrieval: triples for facts, atoms for context
    result = hybrid_retrieve_with_triples(query, mode=mode, token_budget=budget)
    latency_ms = (time.time() - t0) * 1000

    _snapshot_safe()

    # Use atoms from the hybrid result (budget-aware, query-type-routed)
    atom_results = result.get("_raw_atoms", [])

    # Determine confidence tier from raw atoms -- use BEST tier across all results
    raw_atoms = result.get("_raw_atoms", [])
    _tier_rank = {"none": 0, "low": 1, "medium": 2, "high": 3}
    if not raw_atoms and not result["triples"]:
        confidence_tier = "none"
    elif raw_atoms:
        best_tier = "none"
        for a in raw_atoms:
            t = a.get("_confidence_tier", "low")
            if _tier_rank.get(t, 0) > _tier_rank.get(best_tier, 0):
                best_tier = t
        # Also check the top-level tier set by hybrid_retrieve
        top_tier = raw_atoms[0].get("_retrieval_confidence_tier", best_tier)
        confidence_tier = best_tier if _tier_rank.get(best_tier, 0) >= _tier_rank.get(top_tier, 0) else top_tier
    elif result["triples"]:
        # Triples-only (no atom matches) -- triples lack similarity scores,
        # so we can't confirm relevance. Temporal queries always low.
        _temporal_markers = {'right now', 'today', 'currently', 'this session',
                            'just now', 'this morning', 'tonight', 'earlier today'}
        query_lower = query.lower()
        is_temporal = any(m in query_lower for m in _temporal_markers)
        if is_temporal:
            confidence_tier = "low"
        else:
            confidence_tier = "low" if len(result["triples"]) < 10 else "medium"
    else:
        confidence_tier = "none"

    # Build output with both triples and atoms
    output = {
        "query": query,
        "mode": mode,
        "confidence_tier": confidence_tier,
        "triples": [
            {"subject": t["subject"], "predicate": t["predicate"], "object": t["object"]}
            for t in result["triples"]
        ],
        "atoms": [],
        "triple_tokens": result["triple_tokens"],
        "atom_tokens": result["atom_tokens"],
        "total_tokens": result["total_tokens"],
        "items_returned": result["items_returned"],
        "query_type": result.get("query_type", "mixed"),
        "triple_ratio": result.get("triple_ratio", 0.4),
        "latency_ms": round(latency_ms, 2),
    }

    # Shannon efficiency calculated after compression (placeholder, updated below)
    output["shannon"] = {}

    # Add advisory text for low/none confidence
    if confidence_tier == "none":
        output["confidence_advisory"] = "[NO_DATA] No reliable memory on this topic."
    elif confidence_tier == "low":
        output["confidence_advisory"] = "[LOW_CONFIDENCE] Results exist but confidence is below threshold. Treat with caution."

    # ── Confidence-gated output volume ──
    # When MSAM doesn't know something, output should approach zero, not pad with noise.
    # Gate: none → empty, low → top 1 atom only (for context), medium/high → full results
    if confidence_tier == "none":
        # No data: return nothing. The advisory IS the response.
        result["triples"] = []
        atom_results = []
        output["triples"] = []
        output["triple_tokens"] = 0
        output["atom_tokens"] = 0
        output["total_tokens"] = 0
        output["items_returned"] = 0
        output["gated"] = True
        output["gated_reason"] = "no data -- output suppressed"
    elif confidence_tier == "low":
        # Low confidence: return minimal context (top 1 atom, no triples)
        # Just enough to see what MSAM partially matched, but not noise
        atom_results = atom_results[:1] if atom_results else []
        result["triples"] = []
        output["triples"] = []
        output["triple_tokens"] = 0
        trimmed_tokens = sum(len(a["content"]) // 4 for a in atom_results)
        output["atom_tokens"] = trimmed_tokens
        output["total_tokens"] = trimmed_tokens
        output["items_returned"] = len(atom_results)
        output["gated"] = True
        output["gated_reason"] = "low confidence -- output minimized (1 atom, no triples)"
    elif confidence_tier == "medium":
        # Medium confidence: prune noise, keep signal
        # 1. Drop zero-similarity atoms (pulled in by keyword/triple augment, not semantic match)
        _sim_low = _cfg('retrieval', 'confidence_sim_low', 0.15)
        atom_results = [a for a in atom_results if a.get("_similarity", 0) > _sim_low] or atom_results[:2]
        # 2. Cap atoms at 3 (diminishing returns beyond that at medium confidence)
        atom_results = atom_results[:3]
        # 3. Cap triples at 8 (covers unique facts without tangential noise)
        result["triples"] = result["triples"][:8]
        output["triples"] = [
            {"subject": t["subject"], "predicate": t["predicate"], "object": t["object"]}
            for t in result["triples"]
        ]
        output["gated"] = True
        output["gated_reason"] = "medium confidence -- pruned zero-sim atoms, capped triples at 8"
    elif confidence_tier == "high":
        # High confidence: still prune zero-similarity atoms (noise from augmentation)
        good_atoms = [a for a in atom_results if a.get("_similarity", 0) > 0.10]
        if good_atoms:
            atom_results = good_atoms
        # Cap triples at 12 for high (more generous than medium)
        result["triples"] = result["triples"][:12]
        output["triples"] = [
            {"subject": t["subject"], "predicate": t["predicate"], "object": t["object"]}
            for t in result["triples"]
        ]
        output["gated"] = True
        output["gated_reason"] = "high confidence -- pruned zero-sim atoms, capped triples at 12"

    # Query output: no compression pipeline. Atoms are already compact (median 103 chars).
    # Subatom extraction and codebook add noise at this scale (3.3% savings, not worth compute).
    # Compression is reserved for context startup where it matters (7,327 → 51 tokens).
    tokens_total = 0
    all_topics = set()
    served_ids = get_served_ids()
    for r in atom_results:
        atom = {
            "id": r["id"],
            "content": r["content"],
            "stream": r.get("stream", "semantic"),
            "profile": r.get("profile", "standard"),
            "arousal": r.get("arousal", 0.5),
            "valence": r.get("valence", 0.0),
            "topics": json.loads(r["topics"]) if isinstance(r.get("topics"), str) else r.get("topics", []),
            "score": round(r.get("_combined_score", r.get("_activation", 0)), 3),
            "similarity": round(r.get("_similarity", 0), 3),
            "confidence_tier": r.get("_confidence_tier", "unknown"),
        }
        if r["id"] in served_ids:
            atom["previously_served"] = True
        tokens = len(r["content"]) // 4
        tokens_total += tokens
        output["atoms"].append(atom)
        topics = json.loads(r.get("topics", "[]")) if isinstance(r.get("topics"), str) else r.get("topics", [])
        all_topics.update(topics)

    # Shannon metrics for query -- computed AFTER confidence gating
    all_text = ' '.join(a['content'] for a in output['atoms'])
    actual_tokens = tokens_total + sum(
        len(f'{t["subject"]} {t["predicate"]} {t["object"]}') // 4 for t in output["triples"]
    )
    raw_pre_gate = result["total_tokens"]  # what pipeline produced before gating
    shannon_floor = _shannon_floor_tokens(all_text) if all_text.strip() else 0
    output["total_tokens"] = actual_tokens
    output["shannon"] = {
        "raw_tokens": actual_tokens,
        "pre_gate_tokens": raw_pre_gate,
        "compressed_tokens": actual_tokens,
        "compression_pct": round((1 - actual_tokens / raw_pre_gate) * 100, 1) if raw_pre_gate > 0 else 0,
        "shannon_floor_tokens": shannon_floor,
        "shannon_efficiency_pct": round(shannon_floor / actual_tokens * 100, 1) if actual_tokens > 0 else 0,
    }

    # Record served atom IDs and annotate output with dedup count
    returned_ids = [r["id"] for r in atom_results]
    output["_last_retrieval"] = returned_ids
    previously_served_count = sum(1 for aid in returned_ids if aid in served_ids)
    output["previously_served_count"] = previously_served_count
    try:
        record_served(returned_ids)
    except Exception:
        pass  # dedup tracking should never break retrieval

    # Compute activation stats from atom results
    act_min, act_max, act_p50, act_p90, sim_min, sim_max = _compute_activation_stats(atom_results)

    # Log access event
    try:
        log_access_event(
            event_type="query",
            caller=caller,
            query=query,
            mode=mode,
            atoms_accessed=result["items_returned"],
            tokens_used=result["total_tokens"],
            latency_ms=latency_ms,
            activation_min=act_min,
            activation_max=act_max,
            activation_p50=act_p50,
            activation_p90=act_p90,
            similarity_min=sim_min,
            similarity_max=sim_max,
            topics_hit=list(all_topics),
        )
    except Exception:
        pass

    # Log comparison metrics (hybrid vs markdown)
    try:
        md_estimate = _measure_markdown_query_tokens()
        log_comparison(
            query=query,
            msam_tokens=result["total_tokens"],
            msam_latency_ms=latency_ms,
            msam_atoms=result["items_returned"],
            md_tokens=md_estimate,
            md_latency_ms=0,
            md_results=0,
        )
    except Exception:
        pass

    print(json.dumps(output, indent=2))


def cmd_store(args):
    """Store a new memory atom from conversation."""
    caller, args = _extract_caller(args)

    # Check for --llm-annotate flag
    use_llm = False
    if "--llm-annotate" in args:
        use_llm = True
        args = [a for a in args if a != "--llm-annotate"]

    content = " ".join(args)
    if not content:
        print(json.dumps({"error": "No content provided"}))
        return

    t0 = time.time()
    stream = classify_stream(content)
    profile = classify_profile(content)
    annotations = smart_annotate(content, use_llm=use_llm)
    
    atom_id = store_atom(
        content=content,
        stream=stream,
        profile=profile,
        **annotations,
        source_type="conversation",
    )
    latency_ms = (time.time() - t0) * 1000

    # Update system metrics
    _snapshot_safe()

    # Log access event
    try:
        tokens = len(content) // 4
        log_access_event(
            event_type="store",
            caller=caller,
            query=None,
            mode=None,
            atoms_accessed=1,
            tokens_used=tokens,
            latency_ms=latency_ms,
            detail=json.dumps({"atom_id": atom_id, "stream": stream, "profile": profile}),
        )
    except Exception:
        pass
    
    # Extract triples from newly stored atom (async-safe, never blocks store)
    triples_extracted = 0
    try:
        if stream == "semantic":  # Only extract from semantic atoms
            triples_extracted = extract_triples(atom_id, content)
    except Exception:
        pass  # Triple extraction should never break storage

    print(json.dumps({
        "stored": True,
        "atom_id": atom_id,
        "stream": stream,
        "profile": profile,
        "annotations": annotations,
        "triples_extracted": triples_extracted,
    }, indent=2))


def cmd_context(args=None):
    """
    Generate session startup context from MSAM.
    Replaces loading SOUL.md, USER.md, MEMORY.md, and context files.
    Retrieves the most relevant atoms for a general session start.

    Shannon-limit optimizations applied:
      1. Triple-only format for identity/partner (compact S|predicate|object lines)
      2. Codebook compression on all section content (entity shortening)
      3. Delta encoding: identity/partner emit [no_change] if unchanged since last run
      4. Tighter semantic dedup threshold (0.75) for startup context
    """
    if args is None:
        args = []
    caller, _ = _extract_caller(list(args))

    t0 = time.time()

    # Update system metrics
    _snapshot_safe()

    identity_query = _cfg('context', 'startup_identity_query', "agent identity core traits personality")
    user_query = _cfg('context', 'startup_user_query', "user preferences relationship current situation")
    recent_query = _cfg('context', 'startup_recent_query', "what happened today recent activity")
    emotional_query = _cfg('context', 'startup_emotional_query', "emotional state mood current feeling")
    probe_top_k = _cfg('context', 'probe_top_k', 5)

    # Core identity atoms (used for delta hash and subatom fallback)
    identity = hybrid_retrieve(identity_query, mode="task", top_k=probe_top_k)

    # User context atoms
    partner = hybrid_retrieve(user_query, mode="companion", top_k=probe_top_k)

    # Recent activity
    recent = hybrid_retrieve(recent_query, mode="task", top_k=probe_top_k)

    # Emotional state
    emotional = hybrid_retrieve(emotional_query, mode="companion", top_k=3)

    latency_ms = (time.time() - t0) * 1000

    total_tokens = 0
    all_results = identity + partner + recent + emotional
    all_topics = set()
    seen_ids = set()
    global_budget = _cfg('context', 'default_token_budget', 500)
    enable_subatom = _cfg('compression', 'enable_subatom', False)
    subatom_budget_per_section = _cfg('compression', 'subatom_section_budget', 30)

    output = {"sections": {}, "total_tokens": 0}

    # ── Load stored hashes for delta encoding ────────────────────────────────
    stored_hashes = _load_hashes()
    new_hashes = {}

    # ── Opt 1 + 2 + 3: identity and partner via triples + codebook + delta ───
    STABLE_SECTIONS = {
        "identity": (identity, identity_query, "task"),
        "partner": (partner, user_query, "companion"),
    }

    for section_name, (atoms, query, mode) in STABLE_SECTIONS.items():
        section_atoms = []

        # Opt 3: delta encoding — hash the raw atoms
        section_h = _section_hash(atoms)
        new_hashes[section_name] = section_h

        if stored_hashes.get(section_name) == section_h and atoms:
            # No change since last startup — emit marker (saves tokens)
            output["sections"][section_name] = [{"content": "[no_change]", "delta": True}]
            total_tokens += 1  # marker costs ~1 token
            for a in atoms:
                seen_ids.add(a.get("id", a.get("content_hash", "")))
            continue

        # Opt 1: try triple-only format first
        try:
            triple_result = hybrid_retrieve_with_triples(query, mode=mode, token_budget=60)
            triples = triple_result.get("triples", [])
            if len(triples) >= 2:
                for t in triples:
                    subj = t.get("subject", "")
                    pred = t.get("predicate", "")
                    obj = t.get("object", "")
                    raw_line = f"{subj}|{pred}|{obj}"
                    # Opt 2: codebook compress
                    line = _compress(raw_line)
                    tok = max(1, len(line) // 4)
                    if total_tokens + tok > global_budget:
                        break
                    total_tokens += tok
                    section_atoms.append({
                        "content": line,
                        "stream": "triple",
                        "score": 1.0,
                    })
                for a in atoms:
                    seen_ids.add(a.get("id", a.get("content_hash", "")))
                    topics = json.loads(a.get("topics", "[]")) if isinstance(a.get("topics"), str) else a.get("topics", [])
                    all_topics.update(topics)
                output["sections"][section_name] = section_atoms
                continue
        except Exception:
            pass  # fall through to subatom

        # Fallback: subatom extraction (Opt 4: tighter dedup threshold)
        if enable_subatom:
            try:
                from .subatom import extract_relevant_sentences, deduplicate_sentences
                unseen = [a for a in atoms if a.get("id", a.get("content_hash", "")) not in seen_ids]
                for a in unseen:
                    seen_ids.add(a.get("id", a.get("content_hash", "")))
                sentences = extract_relevant_sentences(query, unseen, token_budget=subatom_budget_per_section)
                # Opt 4: tighter dedup (0.75 vs default 0.85)
                sentences = deduplicate_sentences(sentences, similarity_threshold=0.75)
                for s in sentences:
                    raw_content = s['sentence']
                    content = _compress(raw_content)  # Opt 2
                    tok = s.get('tokens', max(1, len(content) // 4))
                    if total_tokens + tok > global_budget:
                        continue
                    total_tokens += tok
                    section_atoms.append({
                        "content": content,
                        "score": round(s.get('score', 0), 3),
                        "stream": "subatom",
                        "source_atom": s.get('atom_id', ''),
                    })
                    for a in unseen:
                        if a.get("id") == s.get('atom_id'):
                            topics = json.loads(a.get("topics", "[]")) if isinstance(a.get("topics"), str) else a.get("topics", [])
                            all_topics.update(topics)
                            break
            except ImportError:
                enable_subatom = False

        if not enable_subatom or not section_atoms:
            # Whole-atom fallback
            for a in atoms:
                atom_id = a.get("id", a.get("content_hash", ""))
                if atom_id in seen_ids:
                    continue
                seen_ids.add(atom_id)
                raw_content = a["content"]
                content = _compress(raw_content)  # Opt 2
                tok = max(1, len(content) // 4)
                if total_tokens + tok > global_budget:
                    continue
                total_tokens += tok
                section_atoms.append({
                    "content": content,
                    "score": round(a.get("_combined_score", 0), 3),
                    "stream": a["stream"],
                })
                topics = json.loads(a.get("topics", "[]")) if isinstance(a.get("topics"), str) else a.get("topics", [])
                all_topics.update(topics)

        output["sections"][section_name] = section_atoms

    # ── recent + emotional: always fresh (no delta, use subatom if enabled) ──
    DYNAMIC_SECTIONS = {
        "recent": (recent, recent_query),
        "emotional": (emotional, emotional_query),
    }

    for section_name, (atoms, query) in DYNAMIC_SECTIONS.items():
        section_atoms = []

        if enable_subatom:
            try:
                from .subatom import extract_relevant_sentences, deduplicate_sentences
                unseen = [a for a in atoms if a.get("id", a.get("content_hash", "")) not in seen_ids]
                for a in unseen:
                    seen_ids.add(a.get("id", a.get("content_hash", "")))
                sentences = extract_relevant_sentences(query, unseen, token_budget=subatom_budget_per_section)
                # Opt 4: tighter dedup threshold for startup
                sentences = deduplicate_sentences(sentences, similarity_threshold=0.75)
                for s in sentences:
                    raw_content = s['sentence']
                    content = _compress(raw_content)  # Opt 2
                    tok = s.get('tokens', max(1, len(content) // 4))
                    if total_tokens + tok > global_budget:
                        continue
                    total_tokens += tok
                    section_atoms.append({
                        "content": content,
                        "score": round(s.get('score', 0), 3),
                        "stream": "subatom",
                        "source_atom": s.get('atom_id', ''),
                    })
                    for a in unseen:
                        if a.get("id") == s.get('atom_id'):
                            topics = json.loads(a.get("topics", "[]")) if isinstance(a.get("topics"), str) else a.get("topics", [])
                            all_topics.update(topics)
                            break
            except ImportError:
                enable_subatom = False

        if not enable_subatom or not section_atoms:
            for a in atoms:
                atom_id = a.get("id", a.get("content_hash", ""))
                if atom_id in seen_ids:
                    continue
                seen_ids.add(atom_id)
                raw_content = a["content"]
                content = _compress(raw_content)  # Opt 2
                tok = max(1, len(content) // 4)
                if total_tokens + tok > global_budget:
                    continue
                total_tokens += tok
                section_atoms.append({
                    "content": content,
                    "score": round(a.get("_combined_score", 0), 3),
                    "stream": a["stream"],
                })
                topics = json.loads(a.get("topics", "[]")) if isinstance(a.get("topics"), str) else a.get("topics", [])
                all_topics.update(topics)

        output["sections"][section_name] = section_atoms

    # ── Predicted atoms (Predictive Context Assembly) ─────────────────────────
    if _cfg('prediction', 'enabled', True):
        try:
            from .prediction import PredictiveEngine
            engine = PredictiveEngine()
            predicted = engine.predict_context(
                top_k=_cfg('prediction', 'max_predicted_atoms', 8)
            )
            predicted_atoms = []
            for p in predicted:
                pid = p.get("id", "")
                if pid in seen_ids:
                    continue
                seen_ids.add(pid)
                content = _compress(p.get("content", ""))
                tok = max(1, len(content) // 4)
                if total_tokens + tok > global_budget:
                    continue
                total_tokens += tok
                predicted_atoms.append({
                    "content": content,
                    "score": round(p.get("score", 0), 3),
                    "stream": "predicted",
                    "predicted_by": p.get("predicted_by", "unknown"),
                })
            if predicted_atoms:
                output["sections"]["predicted"] = predicted_atoms
        except Exception:
            pass

    # ── Persist updated hashes for next run (delta encoding state) ────────────
    try:
        # Merge: keep hashes for sections we didn't touch this run
        merged_hashes = dict(stored_hashes)
        merged_hashes.update(new_hashes)
        _save_hashes(merged_hashes)
    except Exception:
        pass  # hash persistence should never break retrieval

    output["total_tokens"] = total_tokens
    output["atom_count"] = sum(len(v) for v in output["sections"].values())
    output["method"] = "shannon_optimized"
    output["codebook"] = _CODEBOOK  # Opt 2: consumer needs this to decompress

    # Compare to current approach -- measure REAL markdown cost
    md_tokens = _measure_markdown_startup_tokens()
    savings_pct = round((1 - total_tokens / md_tokens) * 100, 1) if md_tokens > 0 else 0
    # Shannon efficiency analysis
    all_content = ' '.join(
        a['content'] for s in output['sections'].values()
        for a in s if a.get('content', '') != '[no_change]'
    )
    shannon_floor = _shannon_floor_tokens(all_content) if all_content.strip() else 0
    shannon_eff = round(shannon_floor / total_tokens * 100, 1) if total_tokens > 0 else 0

    output["comparison"] = {
        "current_startup_tokens": md_tokens,
        "msam_startup_tokens": total_tokens,
        "savings_pct": savings_pct,
        "raw_markdown_tokens": md_tokens,
        "compressed_tokens": total_tokens,
        "compression_pct": savings_pct,
        "shannon_floor_tokens": shannon_floor,
        "shannon_efficiency_pct": shannon_eff,
    }

    # Sycophancy warning check
    if _cfg('sycophancy', 'tracking_enabled', True):
        try:
            from .metrics import get_agreement_rate
            agreement = get_agreement_rate()
            if agreement.get("warning"):
                output["_sycophancy_warning"] = agreement.get("warning_message", "High agreement rate detected")
        except Exception:
            pass

    # Compute activation stats across all atoms
    act_min, act_max, act_p50, act_p90, sim_min, sim_max = _compute_activation_stats(all_results)

    # Log access event
    try:
        log_access_event(
            event_type="context",
            caller=caller,
            query="session_startup_context",
            mode="task+companion",
            atoms_accessed=output["atom_count"],
            tokens_used=total_tokens,
            latency_ms=latency_ms,
            activation_min=act_min,
            activation_max=act_max,
            activation_p50=act_p50,
            activation_p90=act_p90,
            similarity_min=sim_min,
            similarity_max=sim_max,
            topics_hit=list(all_topics),
        )
    except Exception:
        pass

    # Log comparison to metrics DB for Grafana
    try:
        log_comparison(
            query="session_startup_context",
            msam_tokens=total_tokens,
            msam_latency_ms=latency_ms,
            msam_atoms=output["atom_count"],
            md_tokens=md_tokens,
            md_latency_ms=0,
            md_results=0,
        )
    except Exception:
        pass  # metrics logging should never break retrieval

    print(json.dumps(output, indent=2))


def cmd_snapshot(args=None):
    """Take a system metrics snapshot."""
    if args is None:
        args = []
    caller, _ = _extract_caller(list(args))

    t0 = time.time()
    log_system_snapshot()
    latency_ms = (time.time() - t0) * 1000
    stats = get_stats()

    # Log age distribution
    try:
        from .metrics import log_age_distribution
        log_age_distribution()
    except Exception:
        pass

    # Log emotional state (inlined to avoid cmd_emotional's print output)
    try:
        emotional_file = os.path.join(WORKSPACE, _cfg('context', 'emotional_state_file', 'memory/context/emotional-state.md'))
        if os.path.exists(emotional_file):
            with open(emotional_file) as f:
                content = f.read()
            primary = 'unknown'
            intensity = _cfg('metrics', 'default_emotional_intensity', 0.5)
            warmth = _cfg('metrics', 'default_emotional_warmth', 0.5)
            for line in content.split('\n'):
                ll = line.lower().strip()
                if 'primary:' in ll or 'primary state:' in ll:
                    primary = line.split(':', 1)[1].strip().strip('*').strip()
                elif 'intensity:' in ll:
                    try:
                        val = line.split(':', 1)[1].strip().strip('*').strip()
                        intensity = float(val.split('/')[0]) / float(val.split('/')[1]) if '/' in val else float(val)
                    except Exception:
                        pass
                elif 'warmth:' in ll:
                    try:
                        val = line.split(':', 1)[1].strip().strip('*').strip()
                        warmth = float(val.split('/')[0]) / float(val.split('/')[1]) if '/' in val else float(val)
                    except Exception:
                        pass
            from .metrics import log_emotional_state
            log_emotional_state(0.5, 0.0, primary, None, intensity, warmth)
    except Exception:
        pass

    # Log access event
    try:
        log_access_event(
            event_type="snapshot",
            caller=caller,
            latency_ms=latency_ms,
            detail=json.dumps({"total_atoms": stats.get("total_atoms", 0)}),
        )
    except Exception:
        pass

    # Hybrid probe: run a sample triple+atom retrieval to keep efficiency metrics fresh
    try:
        probe_queries = _cfg('context', 'probe_queries', ["agent current situation", "identity personality traits"])
        import random
        probe_q = random.choice(probe_queries)
        hybrid_retrieve_with_triples(probe_q, mode="task", token_budget=_cfg('context', 'probe_token_budget', 200))
    except Exception:
        pass

    # Triple store stats snapshot
    try:
        from .triples import log_triple_store_snapshot
        log_triple_store_snapshot()
    except Exception:
        pass

    # Comparison metrics (token savings vs markdown baseline)
    try:
        probe_atom_queries = _cfg('context', 'probe_atom_queries', ["What is the user's profession?", "Who is the agent?"])
        probe_q2 = random.choice(probe_atom_queries)
        probe_atoms = hybrid_retrieve(probe_q2, mode="task", top_k=_cfg('context', 'probe_top_k', 5))
        probe_tokens = sum(len(a.get("content", "")) // 4 for a in probe_atoms)
        md_tokens = _measure_markdown_startup_tokens()
        log_comparison(
            query=probe_q2,
            msam_tokens=probe_tokens,
            msam_latency_ms=0,
            msam_atoms=len(probe_atoms),
            md_tokens=md_tokens,
            md_latency_ms=0,
            md_results=0,
        )
    except Exception:
        pass

    print(json.dumps({"snapshot": "ok", "stats": stats}, indent=2))


def cmd_hybrid(args):
    """Hybrid retrieval using triples + atoms (polymorphic memory)."""
    caller, args = _extract_caller(args)

    query = " ".join(args)
    mode = "task"
    budget = _cfg('context', 'default_token_budget', 500)

    if "--mode" in args:
        idx = args.index("--mode")
        mode = args[idx + 1]
        args = args[:idx] + args[idx+2:]
        query = " ".join(args)

    if "--budget" in args:
        idx = args.index("--budget")
        budget = int(args[idx + 1])
        args = args[:idx] + args[idx+2:]
        query = " ".join(args)

    result = hybrid_retrieve_with_triples(query, mode=mode, token_budget=budget)

    output = {
        "query": query,
        "mode": mode,
        "triple_count": len(result["triples"]),
        "triple_tokens": result["triple_tokens"],
        "atom_count": len(result["atoms"]),
        "atom_tokens": result["atom_tokens"],
        "total_tokens": result["total_tokens"],
        "items_returned": result["items_returned"],
        "latency_ms": result["latency_ms"],
        "triples": [
            {"subject": t["subject"], "predicate": t["predicate"], "object": t["object"]}
            for t in result["triples"]
        ],
        "atoms": [
            {"id": a["id"], "content": a["content"][:200], "score": round(a.get("_combined_score", 0), 3)}
            for a in result["atoms"]
        ],
    }

    print(json.dumps(output, indent=2))


def cmd_triple_stats(args=None):
    """Show triple store statistics."""
    stats = get_triple_stats()
    log_triple_store_snapshot()
    print(json.dumps(stats, indent=2))


def cmd_emotional(args):
    """Parse emotional-state.md and log current state to metrics."""
    emotional_file = os.path.join(WORKSPACE, _cfg('context', 'emotional_state_file', 'memory/context/emotional-state.md'))
    try:
        with open(emotional_file) as f:
            content = f.read()

        # Parse header values (format varies, be flexible)
        arousal = 0.5
        valence = 0.0
        primary = 'unknown'
        secondary = None
        intensity = 0.5
        warmth = 0.5

        for line in content.split('\n'):
            line_lower = line.lower().strip()
            if 'primary:' in line_lower or 'primary state:' in line_lower:
                primary = line.split(':', 1)[1].strip().strip('*').strip()
            elif 'secondary:' in line_lower or 'secondary state:' in line_lower:
                secondary = line.split(':', 1)[1].strip().strip('*').strip()
            elif 'intensity:' in line_lower:
                try:
                    val = line.split(':', 1)[1].strip().strip('*').strip()
                    if '/' in val:
                        parts = val.split('/')
                        intensity = float(parts[0]) / float(parts[1])
                    else:
                        intensity = float(val)
                except (ValueError, IndexError, ZeroDivisionError):
                    pass
            elif 'warmth:' in line_lower:
                try:
                    val = line.split(':', 1)[1].strip().strip('*').strip()
                    if '/' in val:
                        parts = val.split('/')
                        warmth = float(parts[0]) / float(parts[1])
                    else:
                        warmth = float(val)
                except (ValueError, IndexError, ZeroDivisionError):
                    pass

        # Map primary state to arousal/valence heuristically
        state_map = {
            'confident': (0.6, 0.7),
            'engaged': (0.7, 0.6),
            'cautious': (0.4, -0.1),
            'irritated': (0.7, -0.5),
            'protective': (0.8, 0.3),
            'dismissive': (0.3, -0.3),
            'proud': (0.6, 0.8),
            'satisfied': (0.4, 0.7),
            'curious': (0.6, 0.4),
            'complete': (0.3, 0.6),
        }
        primary_lower = primary.lower().split('+')[0].strip()
        if primary_lower in state_map:
            arousal, valence = state_map[primary_lower]

        from .metrics import log_emotional_state
        log_emotional_state(arousal, valence, primary, secondary, intensity, warmth)

        print(json.dumps({
            'logged': True,
            'primary': primary,
            'secondary': secondary,
            'arousal': arousal,
            'valence': valence,
            'intensity': intensity,
            'warmth': warmth
        }, indent=2))
    except FileNotFoundError:
        print(json.dumps({'error': 'emotional-state.md not found'}))
    except Exception as e:
        print(json.dumps({'error': str(e)}))


def cmd_graph(args):
    """Graph traversal or path finding on the knowledge graph."""
    from .triples import graph_traverse, graph_path

    if len(args) >= 3 and args[0] == "path":
        # msam graph path <entity_a> <entity_b>
        result = graph_path(args[1], args[2], max_hops=int(args[3]) if len(args) > 3 else 4)
    elif args:
        # msam graph <entity> [--hops N]
        entity = args[0]
        max_hops = 2
        if "--hops" in args:
            idx = args.index("--hops")
            max_hops = int(args[idx + 1])
        result = graph_traverse(entity, max_hops=max_hops)
    else:
        print(json.dumps({"error": "Usage: graph <entity> [--hops N] | graph path <a> <b>"}))
        return

    print(json.dumps(result, indent=2))


def cmd_contradictions(args):
    """Detect or resolve contradictions in the knowledge graph."""
    from .triples import detect_contradictions, resolve_contradictions

    if args and args[0] == "resolve":
        # First detect, then resolve
        contradictions = detect_contradictions()
        resolved = resolve_contradictions(contradictions, strategy="newest")
        print(json.dumps({"contradictions_found": len(contradictions), "resolved": resolved}))
    elif args and args[0] == "check":
        # Pre-write check: contradictions check <subject> <predicate> <object>
        if len(args) >= 4:
            conflicts = detect_contradictions(args[1], args[2], args[3])
            print(json.dumps({"conflicts": conflicts}, indent=2))
        else:
            print(json.dumps({"error": "Usage: contradictions check <subject> <predicate> <object>"}))
    elif args and args[0] == "semantic":
        from .contradictions import find_semantic_contradictions
        threshold = 0.85
        if len(args) > 1:
            try:
                threshold = float(args[1])
            except ValueError:
                pass
        results = find_semantic_contradictions(threshold=threshold)
        print(json.dumps({"semantic_contradictions": results, "count": len(results)}, indent=2, default=str))
    elif args and args[0] == "precheck":
        from .contradictions import check_before_store
        content = " ".join(args[1:])
        if not content:
            print(json.dumps({"error": "Usage: contradictions precheck <content>"}))
            return
        results = check_before_store(content)
        print(json.dumps({"potential_contradictions": results, "count": len(results)}, indent=2, default=str))
    else:
        # Full scan
        contradictions = detect_contradictions()
        print(json.dumps({"contradictions": contradictions}, indent=2))


def cmd_decay(args):
    """Run the decay cycle."""
    import logging
    logging.getLogger("msam.decay").setLevel(logging.WARNING)
    from .decay import run_decay_cycle
    result = run_decay_cycle()
    print(json.dumps(result, indent=2))


def cmd_working(args):
    """Store or manage working memory atoms."""
    from .core import store_working, expire_working_memory

    if not args or args[0] == "expire":
        session_id = args[1] if len(args) > 1 else None
        result = expire_working_memory(session_id=session_id)
        print(json.dumps(result, indent=2))
    elif args[0] == "store":
        content = " ".join(args[1:])
        session_id = None
        if "--session" in args:
            idx = args.index("--session")
            session_id = args[idx + 1]
            content = " ".join(a for i, a in enumerate(args[1:]) if i not in (idx-1, idx))
        atom_id = store_working(content, session_id=session_id)
        print(json.dumps({"stored": atom_id}))
    else:
        print(json.dumps({"error": "Usage: working store <content> | working expire [session_id]"}))


def cmd_metamemory(args):
    """Query what the system knows about a topic and how confident it is."""
    from .core import metamemory_query
    if not args:
        print(json.dumps({"error": "Usage: metamemory <topic>"}))
        return
    topic = " ".join(args)
    result = metamemory_query(topic)
    print(json.dumps(result, indent=2))


def cmd_drift(args):
    """Detect emotional drift for an entity or topic."""
    from .core import emotional_drift
    if not args:
        print(json.dumps({"error": "Usage: drift <entity_or_topic> [--days N]"}))
        return
    days = 7
    if "--days" in args:
        idx = args.index("--days")
        days = int(args[idx + 1])
        args = args[:idx] + args[idx+2:]
    entity = " ".join(args)
    result = emotional_drift(entity, window_days=days)
    print(json.dumps(result, indent=2))


def cmd_confidence(args):
    """Update confidence gradient from evidence accumulation."""
    from .core import update_confidence_from_evidence
    result = update_confidence_from_evidence()
    print(json.dumps(result, indent=2))


def cmd_contribute(args):
    """Mark atom contributions from a response."""
    from .core import mark_contributions
    if len(args) < 2:
        print(json.dumps({"error": "Usage: contribute <atom_ids_comma_sep> <response_text>"}))
        return
    atom_ids = args[0].split(",")
    response_text = " ".join(args[1:])
    result = mark_contributions(atom_ids, response_text)
    print(json.dumps(result, indent=2))


def cmd_feedback_mark(args):
    """
    Mark atom contributions after a response (feedback loop wire-up).

    Usage:
        msam feedback-mark <atom_ids_comma_sep> <response_text>

    Example:
        msam feedback-mark abc123,def456 "The user liked the recommendation"

    Calls mark_contributions() which updates contribution_score and retrieval
    adjustment data used by compute_retrieval_adjustments() during decay cycles.
    """
    from .core import mark_contributions
    if len(args) < 2:
        print(json.dumps({"error": "Usage: feedback-mark <atom_ids_comma_sep> <response_text>"}))
        return
    atom_ids = [aid.strip() for aid in args[0].split(",") if aid.strip()]
    if not atom_ids:
        print(json.dumps({"error": "No valid atom IDs provided"}))
        return
    response_text = " ".join(args[1:])
    result = mark_contributions(atom_ids, response_text)
    print(json.dumps(result, indent=2))


def cmd_associations(args):
    """View association chains for an atom or find clusters."""
    from .core import get_associations, get_association_clusters
    if args and args[0] == "clusters":
        min_co = int(args[1]) if len(args) > 1 else 3
        result = get_association_clusters(min_co_count=min_co)
        print(json.dumps(result, indent=2))
    elif args:
        atom_id = args[0]
        min_co = int(args[1]) if len(args) > 1 else 2
        result = get_associations(atom_id, min_co_count=min_co)
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps({"error": "Usage: associations <atom_id> [min_co_count] | associations clusters [min_co_count]"}))


def cmd_quality(args):
    """Score context quality for retrieved atoms."""
    from .core import hybrid_retrieve, score_context_quality
    if not args:
        print(json.dumps({"error": "Usage: quality <query>"}))
        return
    query = " ".join(args)
    atoms = hybrid_retrieve(query, mode="task", top_k=10)
    scored = score_context_quality(atoms, query)
    output = []
    for a in scored:
        output.append({
            "id": a["id"],
            "content": a["content"][:80],
            "quality_score": a["_quality_score"],
            "include": a["_include"],
            "factors": a["_quality_factors"],
        })
    included = sum(1 for a in scored if a["_include"])
    print(json.dumps({"query": query, "total": len(scored), "included": included,
                       "filtered": len(scored) - included, "atoms": output}, indent=2))


def cmd_feedback(args):
    """Record outcome feedback or run retrieval analysis.

    Usage:
        msam feedback <atom_id> positive|negative|neutral   -- record outcome
        msam feedback --analyze                             -- run retrieval analysis
    """
    if not args or "--analyze" in args:
        from .core import compute_retrieval_adjustments
        result = compute_retrieval_adjustments()
        print(json.dumps(result, indent=2))
        return

    # Outcome recording mode
    from .core import record_outcome
    atom_id = args[0]
    feedback_type = args[1] if len(args) > 1 else "neutral"
    if feedback_type not in ("positive", "negative", "neutral", "silence"):
        print(json.dumps({"error": f"Invalid feedback type: {feedback_type}. Use positive|negative|neutral|silence"}))
        return
    result = record_outcome([atom_id], feedback_type)
    print(json.dumps(result, indent=2))


def cmd_outcomes(args):
    """Show outcome feedback history.

    Usage:
        msam outcomes <atom_id>    -- history for specific atom
        msam outcomes --summary    -- summary of all outcomes
    """
    from .core import get_outcome_history, get_db
    if args and args[0] != "--summary":
        atom_id = args[0]
        history = get_outcome_history(atom_id)
        # Also get current atom scores
        conn = get_db()
        row = conn.execute(
            "SELECT outcome_score, outcome_count, last_outcome_at FROM atoms WHERE id = ?",
            (atom_id,),
        ).fetchone()
        conn.close()
        atom_info = dict(row) if row else {}
        print(json.dumps({"atom_id": atom_id, "current": atom_info,
                           "history": history}, indent=2, default=str))
    else:
        history = get_outcome_history(limit=20)
        print(json.dumps({"recent_outcomes": history}, indent=2, default=str))


def cmd_explain(args):
    """Retrieve with full scoring explanation."""
    from .core import retrieve
    if not args:
        print(json.dumps({"error": "Usage: explain <query>"}))
        return
    
    # Parse flags
    mode = "task"
    since = before = None
    query_parts = []
    i = 0
    while i < len(args):
        if args[i] == "--mode" and i + 1 < len(args):
            mode = args[i + 1]; i += 2
        elif args[i] == "--since" and i + 1 < len(args):
            since = args[i + 1]; i += 2
        elif args[i] == "--before" and i + 1 < len(args):
            before = args[i + 1]; i += 2
        else:
            query_parts.append(args[i]); i += 1
    
    query = " ".join(query_parts)
    results = retrieve(query, mode=mode, top_k=5, explain=True, since=since, before=before)
    
    output = []
    for r in results:
        exp = r.get("_explanation", {})
        output.append({
            "id": r["id"],
            "content": r["content"][:80],
            "total_score": exp.get("total", 0),
            "breakdown": {
                "base": exp.get("base", {}),
                "similarity": exp.get("similarity", {}),
                "annotation": exp.get("annotation", {}),
                "stability": exp.get("stability", {}),
            }
        })
    print(json.dumps({"query": query, "mode": mode, "since": since, "before": before,
                       "results": output}, indent=2))


def cmd_batch(args):
    """Execute multiple queries in one call."""
    from .core import batch_query
    # Read queries from stdin as JSON
    import sys as _sys
    if args and args[0] == "--json":
        raw = _sys.stdin.read()
        queries = json.loads(raw)
    else:
        # Simple mode: multiple queries as args separated by |||
        query_str = " ".join(args)
        queries = [{"query": q.strip(), "mode": "task", "budget": 500} 
                   for q in query_str.split("|||") if q.strip()]
    
    results = batch_query(queries)
    output = []
    for r in results:
        output.append({
            "query": r.get("query_type", ""),
            "triples": len(r.get("triples", [])),
            "atoms": len(r.get("atoms", [])),
            "total_tokens": r.get("total_tokens", 0),
        })
    print(json.dumps({"batch_size": len(queries), "results": output}, indent=2))


def cmd_negative(args):
    """Manage negative knowledge (failed searches)."""
    from .core import record_negative, check_negative, expire_negatives
    
    if not args:
        print(json.dumps({"error": "Usage: negative check <query> | negative record <query> | negative expire"}))
        return
    
    if args[0] == "check":
        query = " ".join(args[1:])
        result = check_negative(query)
        print(json.dumps(result, indent=2))
    elif args[0] == "record":
        query = " ".join(args[1:])
        row_id = record_negative(query)
        print(json.dumps({"recorded": True, "id": row_id, "query": query}))
    elif args[0] == "expire":
        deleted = expire_negatives()
        print(json.dumps({"expired": deleted}))
    else:
        print(json.dumps({"error": f"Unknown subcommand: {args[0]}"}))


def cmd_provenance(args):
    """View provenance chain for an entity."""
    from .core import get_provenance
    if len(args) < 2:
        print(json.dumps({"error": "Usage: provenance <entity_type> <entity_id>"}))
        return
    chain = get_provenance(args[0], args[1])
    print(json.dumps(chain, indent=2))


def cmd_merge(args):
    """Find merge candidates or merge two atoms."""
    from .core import find_merge_candidates, merge_atoms
    
    if not args or args[0] == "candidates":
        threshold = float(args[1]) if len(args) > 1 else 0.85
        candidates = find_merge_candidates(similarity_threshold=threshold)
        print(json.dumps({"candidates": len(candidates), "pairs": candidates}, indent=2))
    elif args[0] == "execute" and len(args) >= 3:
        result = merge_atoms(args[1], args[2], merged_content=" ".join(args[3:]) if len(args) > 3 else None)
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps({"error": "Usage: merge candidates [threshold] | merge execute <keep_id> <remove_id> [merged_content]"}))


def cmd_migrate(args):
    """Run schema migrations."""
    from .core import run_migrations
    result = run_migrations()
    print(json.dumps(result, indent=2))


def cmd_dry(args):
    """Dry run retrieval (no side effects)."""
    from .core import dry_retrieve
    if not args:
        print(json.dumps({"error": "Usage: dry <query>"}))
        return
    results = dry_retrieve(" ".join(args), top_k=5)
    output = [{"id": r["id"], "content": r["content"][:80],
               "activation": round(r["_activation"], 3)} for r in results]
    print(json.dumps({"results": output, "count": len(output)}, indent=2))


def cmd_rewrite(args):
    """Rewrite a query and show expansions."""
    from .core import rewrite_query, retrieve_with_rewrite
    if not args:
        print(json.dumps({"error": "Usage: rewrite <query>"}))
        return
    query = " ".join(args)
    rw = rewrite_query(query)
    results = retrieve_with_rewrite(query, top_k=5)
    output = [{"id": r["id"], "content": r["content"][:80],
               "activation": round(r["_activation"], 3)} for r in results]
    print(json.dumps({"rewrite": rw, "results": output}, indent=2))


def cmd_forgetting(args):
    """View forgetting history."""
    from .core import get_forgetting_history, get_recent_forgetting
    if args and args[0] == "recent":
        hours = int(args[1]) if len(args) > 1 else 24
        result = get_recent_forgetting(hours=hours)
        print(json.dumps(result, indent=2))
    elif args:
        result = get_forgetting_history(args[0])
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps({"error": "Usage: forgetting <atom_id> | forgetting recent [hours]"}))


def cmd_versions(args):
    """View atom version history."""
    from .core import get_atom_versions
    if not args:
        print(json.dumps({"error": "Usage: versions <atom_id>"}))
        return
    result = get_atom_versions(args[0])
    print(json.dumps(result, indent=2))


def cmd_summarize(args):
    """Summarize/compress an atom."""
    from .core import summarize_atom
    if not args:
        print(json.dumps({"error": "Usage: summarize <atom_id> [target_tokens]"}))
        return
    target = int(args[1]) if len(args) > 1 else 80
    result = summarize_atom(args[0], target_tokens=target)
    print(json.dumps(result, indent=2))


def cmd_importance(args):
    """Estimate importance of content."""
    from .core import estimate_importance
    if not args:
        print(json.dumps({"error": "Usage: importance <content>"}))
        return
    result = estimate_importance(" ".join(args))
    print(json.dumps(result, indent=2))


def cmd_emotion_retrieve(args):
    """Retrieve with emotional context."""
    from .core import retrieve_with_emotion
    if not args:
        print(json.dumps({"error": "Usage: emotion-retrieve <query> [--urgency high|normal|low] [--arousal 0-1] [--valence -1 to 1]"}))
        return
    
    query_parts = []
    emotion = {}
    i = 0
    while i < len(args):
        if args[i] == "--urgency" and i + 1 < len(args):
            emotion["urgency"] = args[i+1]; i += 2
        elif args[i] == "--arousal" and i + 1 < len(args):
            emotion["arousal"] = float(args[i+1]); i += 2
        elif args[i] == "--valence" and i + 1 < len(args):
            emotion["valence"] = float(args[i+1]); i += 2
        else:
            query_parts.append(args[i]); i += 1
    
    results = retrieve_with_emotion(" ".join(query_parts), query_emotion=emotion or None, top_k=5)
    output = [{"id": r["id"], "content": r["content"][:80],
               "activation": round(r["_activation"], 3),
               "emotional_bonus": r.get("_emotional_bonus", 0)} for r in results]
    print(json.dumps({"query": " ".join(query_parts), "emotion": emotion, "results": output}, indent=2))


def cmd_relations(args):
    """Manage atom relationships."""
    from .core import add_atom_relation, get_atom_relations, retrieve_with_relations
    if not args:
        print(json.dumps({"error": "Usage: relations add <src> <tgt> <type> | relations get <atom_id> | relations retrieve <query>"}))
        return
    
    if args[0] == "add" and len(args) >= 4:
        result = add_atom_relation(args[1], args[2], args[3])
        print(json.dumps(result, indent=2))
    elif args[0] == "get" and len(args) >= 2:
        result = get_atom_relations(args[1])
        print(json.dumps(result, indent=2))
    elif args[0] == "retrieve":
        results = retrieve_with_relations(" ".join(args[1:]), top_k=5)
        output = [{"id": r["id"], "content": r["content"][:80],
                   "activation": round(r["_activation"], 3),
                   "relation_note": r.get("_relation_note", "")} for r in results]
        print(json.dumps(output, indent=2))
    else:
        print(json.dumps({"error": "Unknown subcommand"}))


def cmd_diverse(args):
    """MMR diverse retrieval."""
    from .core import retrieve_diverse
    if not args:
        print(json.dumps({"error": "Usage: diverse <query> [lambda 0-1]"}))
        return
    
    lam = 0.7
    query_parts = []
    i = 0
    while i < len(args):
        if args[i] == "--lambda" and i + 1 < len(args):
            lam = float(args[i+1]); i += 2
        else:
            query_parts.append(args[i]); i += 1
    
    results = retrieve_diverse(" ".join(query_parts), lambda_param=lam, top_k=7)
    output = [{"id": r["id"], "content": r["content"][:80],
               "activation": round(r["_activation"], 3)} for r in results]
    print(json.dumps({"query": " ".join(query_parts), "lambda": lam, "results": output}, indent=2))


def cmd_session_boundary(args):
    """Store or view session boundaries."""
    from .core import store_session_boundary, get_last_sessions
    if not args or args[0] == "list":
        result = get_last_sessions(count=int(args[1]) if len(args) > 1 else 3)
        print(json.dumps(result, indent=2))
    elif args[0] == "store":
        summary = " ".join(args[1:]) if len(args) > 1 else "Session ended"
        atom_id = store_session_boundary(session_id="manual", summary=summary)
        print(json.dumps({"stored": True, "atom_id": atom_id}))
    else:
        print(json.dumps({"error": "Usage: session-boundary list [count] | session-boundary store <summary>"}))


def cmd_gaps(args):
    """Detect knowledge gaps for an entity."""
    from .core import detect_knowledge_gaps
    if not args:
        print(json.dumps({"error": "Usage: gaps <entity>"}))
        return
    result = detect_knowledge_gaps(" ".join(args))
    print(json.dumps(result, indent=2))


def cmd_pin(args):
    """Pin/unpin atoms or list pinned."""
    from .core import pin_atom, unpin_atom, list_pinned
    if not args or args[0] == "list":
        result = list_pinned()
        print(json.dumps({"pinned": len(result), "atoms": result}, indent=2))
    elif args[0] == "add" and len(args) >= 2:
        reason = " ".join(args[2:]) if len(args) > 2 else None
        result = pin_atom(args[1], reason=reason)
        print(json.dumps(result, indent=2))
    elif args[0] == "remove" and len(args) >= 2:
        result = unpin_atom(args[1])
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps({"error": "Usage: pin list | pin add <atom_id> [reason] | pin remove <atom_id>"}))


def cmd_split(args):
    """Split an atom into multiple focused atoms."""
    from .core import split_atom
    if len(args) < 2:
        print(json.dumps({"error": "Usage: split <atom_id> <segment1> ||| <segment2> ||| ..."}))
        return
    atom_id = args[0]
    segments_str = " ".join(args[1:])
    segments = [s.strip() for s in segments_str.split("|||") if s.strip()]
    if len(segments) < 2:
        print(json.dumps({"error": "Need at least 2 segments separated by |||"}))
        return
    result = split_atom(atom_id, segments)
    print(json.dumps(result, indent=2))


def cmd_cache(args):
    """View or clear embedding cache stats."""
    from .core import get_cache_stats, clear_cache
    if args and args[0] == "clear":
        clear_cache()
        print(json.dumps({"cleared": True}))
    else:
        print(json.dumps(get_cache_stats(), indent=2))


def cmd_analytics(args):
    """View access pattern analytics."""
    from .core import analyze_access_patterns
    days = int(args[0]) if args else 30
    result = analyze_access_patterns(days=days)
    print(json.dumps(result, indent=2))


def cmd_confidence_decay(args):
    """Run confidence decay cycle."""
    from .core import decay_confidence
    result = decay_confidence()
    print(json.dumps(result, indent=2))


def cmd_session_clear(args=None):
    """Clear session-scoped retrieval deduplication tracking."""
    try:
        clear_session()
        print(json.dumps({"cleared": True}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def cmd_predict(args):
    """Run predictive pre-retrieval.

    Flags:
      --learn         Learn from provided atom IDs
      --time          Time bucket (morning|afternoon|evening|night)
      --day           Day type (weekday|weekend|show_day)
      --topics        Comma-separated topics
      --active        User is active
      --warm          Pre-warm context
      --hour N        Specific hour (0-23) for predict_context
      --day-of-week D Day name (monday..sunday) for predict_context
      --format context Use predict_context instead of predict_needed_atoms
    """
    from .core import predict_needed_atoms, pre_warm_context

    if "--learn" in args:
        from .prediction import PredictiveEngine
        atom_ids = [a for a in args if a != "--learn" and not a.startswith("--")]
        engine = PredictiveEngine()
        engine.learn_from_session(atom_ids)
        print(json.dumps({"learned": True, "atom_count": len(atom_ids)}))
        return

    # Build context from args or defaults
    context = {}
    use_predict_context = False
    predict_hour = None
    predict_dow = None
    i = 0
    while i < len(args):
        if args[i] == "--time" and i + 1 < len(args):
            context["time_of_day"] = args[i+1]; i += 2
        elif args[i] == "--day" and i + 1 < len(args):
            context["day_type"] = args[i+1]; i += 2
        elif args[i] == "--topics" and i + 1 < len(args):
            context["recent_topics"] = args[i+1].split(","); i += 2
        elif args[i] == "--active":
            context["user_active"] = True; i += 1
        elif args[i] == "--warm":
            result = pre_warm_context(context)
            print(json.dumps(result, indent=2))
            return
        elif args[i] == "--format" and i + 1 < len(args):
            if args[i+1] == "context":
                use_predict_context = True
            i += 2
        elif args[i] == "--hour" and i + 1 < len(args):
            predict_hour = int(args[i+1])
            use_predict_context = True
            i += 2
        elif args[i] == "--day-of-week" and i + 1 < len(args):
            day_names = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
                         "friday": 4, "saturday": 5, "sunday": 6}
            predict_dow = day_names.get(args[i+1].lower())
            use_predict_context = True
            i += 2
        else:
            i += 1

    if use_predict_context:
        from .prediction import PredictiveEngine
        engine = PredictiveEngine()
        predicted = engine.predict_context(hour=predict_hour, day_of_week=predict_dow)
        print(json.dumps({"mode": "predict_context", "hour": predict_hour,
                           "day_of_week": predict_dow, "predictions": len(predicted),
                           "atoms": predicted}, indent=2))
        return

    predictions = predict_needed_atoms(context)
    print(json.dumps({"context": context, "predictions": len(predictions),
                       "atoms": predictions[:10]}, indent=2))


def cmd_consolidate(args):
    """Run sleep-based memory consolidation."""
    from .consolidation import ConsolidationEngine

    dry_run = "--dry-run" in args
    max_clusters = None
    if "--max-clusters" in args:
        idx = args.index("--max-clusters")
        if idx + 1 < len(args):
            max_clusters = int(args[idx + 1])

    engine = ConsolidationEngine()
    result = engine.consolidate(dry_run=dry_run, max_clusters=max_clusters)
    print(json.dumps(result, indent=2))


def cmd_replay(args):
    """Episodic replay -- walk through past events chronologically."""
    from .core import episodic_replay

    topic = " ".join([a for a in args if not a.startswith("--")])
    since = None
    before = None
    max_events = 50

    if "--since" in args:
        idx = args.index("--since")
        if idx + 1 < len(args):
            since = args[idx + 1]
    if "--before" in args:
        idx = args.index("--before")
        if idx + 1 < len(args):
            before = args[idx + 1]
    if "--max" in args:
        idx = args.index("--max")
        if idx + 1 < len(args):
            max_events = int(args[idx + 1])

    result = episodic_replay(topic, since=since, before=before, max_events=max_events)
    print(json.dumps(result, indent=2, default=str))


def cmd_forget(args):
    """Identify atoms that should be forgotten (intentional forgetting engine).

    Usage:
        msam forget [--dry-run] [--auto]
        msam forget --dry-run               # Just report candidates (default)
        msam forget --auto                   # Apply transitions automatically
    """
    from .forgetting import identify_forgetting_candidates

    dry_run = "--auto" not in args
    if "--dry-run" in args:
        dry_run = True

    result = identify_forgetting_candidates(dry_run=dry_run)
    print(json.dumps(result, indent=2, default=str))


def cmd_calibrate(args):
    """Compare embedding rankings between current and target provider.

    Usage:
        msam calibrate <provider> [--top-k N]
    """
    from .calibration import calibrate

    if not args:
        print(json.dumps({"error": "Usage: calibrate <provider> [--top-k N]"}))
        return

    provider = args[0]
    top_k = 10

    remaining = args[1:]
    if "--top-k" in remaining:
        idx = remaining.index("--top-k")
        if idx + 1 < len(remaining):
            top_k = int(remaining[idx + 1])

    result = calibrate(provider, top_k=top_k)
    print(json.dumps(result, indent=2, default=str))


def cmd_reembed(args):
    """Re-embed all active atoms with a new provider.

    Usage:
        msam re-embed <provider> [--batch-size N] [--dry-run]
    """
    from .calibration import re_embed

    if not args:
        print(json.dumps({"error": "Usage: re-embed <provider> [--batch-size N] [--dry-run]"}))
        return

    provider = args[0]
    batch_size = 50
    dry_run = "--dry-run" in args

    remaining = args[1:]
    if "--batch-size" in remaining:
        idx = remaining.index("--batch-size")
        if idx + 1 < len(remaining):
            batch_size = int(remaining[idx + 1])

    result = re_embed(provider, batch_size=batch_size, dry_run=dry_run)
    print(json.dumps(result, indent=2, default=str))


def cmd_serve(args):
    """Start the MSAM REST API server."""
    from .server import run_server
    host = None
    port = None
    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1]); i += 2
        elif args[i] == "--host" and i + 1 < len(args):
            host = args[i + 1]; i += 2
        else:
            i += 1
    run_server(host=host, port=port)


def cmd_world(args):
    """World model query/update -- temporal knowledge graph.

    Usage:
        msam world                              Show all currently-valid triples
        msam world "Jaden"                      Show current state for entity
        msam world "Jaden" --at "2026-02-20"    Point-in-time query
        msam world --set "Jaden" "is_in" "Oakland" [--from ...] [--until ...]
        msam world --history "Jaden" ["is_in"]  Show all values over time
    """
    from .triples import query_world, update_world, world_history

    if not args:
        # Show all currently-valid triples
        result = query_world()
        print(json.dumps({"triples": result, "count": len(result)}, indent=2, default=str))
        return

    if args[0] == "--set":
        # Update mode: --set subject predicate object [--from ...] [--until ...]
        if len(args) < 4:
            print(json.dumps({"error": "Usage: world --set <subject> <predicate> <object> [--from <ts>] [--until <ts>]"}))
            return
        subject = args[1]
        predicate = args[2]
        obj = args[3]
        valid_from = None
        valid_until = None
        source_atom_id = None
        i = 4
        while i < len(args):
            if args[i] == "--from" and i + 1 < len(args):
                valid_from = args[i + 1]; i += 2
            elif args[i] == "--until" and i + 1 < len(args):
                valid_until = args[i + 1]; i += 2
            elif args[i] == "--source" and i + 1 < len(args):
                source_atom_id = args[i + 1]; i += 2
            else:
                i += 1
        result = update_world(subject, predicate, obj,
                              valid_from=valid_from, valid_until=valid_until,
                              source_atom_id=source_atom_id)
        print(json.dumps(result, indent=2, default=str))
        return

    if args[0] == "--history":
        # History mode
        if len(args) < 2:
            print(json.dumps({"error": "Usage: world --history <subject> [<predicate>]"}))
            return
        subject = args[1]
        predicate = args[2] if len(args) > 2 else None
        result = world_history(subject, predicate)
        print(json.dumps({"subject": subject, "predicate": predicate,
                           "history": result, "count": len(result)}, indent=2, default=str))
        return

    # Entity query mode
    entity = args[0]
    at_time = None
    predicate = None
    i = 1
    while i < len(args):
        if args[i] == "--at" and i + 1 < len(args):
            at_time = args[i + 1]; i += 2
        elif args[i] == "--predicate" and i + 1 < len(args):
            predicate = args[i + 1]; i += 2
        else:
            i += 1
    result = query_world(entity=entity, predicate=predicate, at_time=at_time)
    print(json.dumps({"entity": entity, "at_time": at_time,
                       "triples": result, "count": len(result)}, indent=2, default=str))


def cmd_agreement(args):
    """Agreement rate tracking -- detect sycophancy.

    Usage:
        msam agreement                              Show current agreement rate
        msam agreement record agree|disagree|...    Record a signal
        msam agreement --agent <id>                 Check specific agent
    """
    from .metrics import record_agreement, get_agreement_rate

    if not args:
        result = get_agreement_rate()
        print(json.dumps(result, indent=2, default=str))
        return

    if args[0] == "record":
        signal = args[1] if len(args) > 1 else "neutral"
        if signal not in ("agree", "disagree", "neutral", "challenge"):
            print(json.dumps({"error": f"Invalid signal: {signal}. Use agree|disagree|neutral|challenge"}))
            return
        context = args[2] if len(args) > 2 else None
        result = record_agreement(signal, context=context)
        print(json.dumps(result, indent=2, default=str))
        return

    agent_id = "default"
    window = 20
    i = 0
    while i < len(args):
        if args[i] == "--agent" and i + 1 < len(args):
            agent_id = args[i + 1]; i += 2
        elif args[i] == "--window" and i + 1 < len(args):
            window = int(args[i + 1]); i += 2
        else:
            i += 1
    result = get_agreement_rate(agent_id=agent_id, window=window)
    print(json.dumps(result, indent=2, default=str))


def cmd_help(args=None):
    """Print grouped command reference."""
    help_text = """MSAM CLI -- Multi-Stream Adaptive Memory

Storage:
  store <content>              Store a new memory atom
  batch <file>                 Batch store from JSONL file
  working <content>            Store working memory (session-scoped)

Retrieval:
  query <query>                Confidence-gated retrieval
  context                      Session startup context (Shannon-compressed)
  hybrid <query>               Hybrid retrieve (atoms + triples)
  diverse <query>              MMR diverse retrieval
  dry <query>                  Dry-run retrieve (no side effects)
  emotion-retrieve <query>     Emotion-aware retrieval
  grep <pattern>               Search atom content by text

Analysis:
  explain <query>              Detailed scoring breakdown
  metamemory <topic>           Coverage assessment
  confidence <atom_id>         Atom confidence details
  importance <content>         Estimate content importance
  quality <query>              Context quality scoring
  analytics                    Access pattern analysis
  cache                        Embedding cache stats

Knowledge Graph:
  contradictions               Detect conflicting triples
  gaps <entity>                Knowledge gap analysis
  graph <entity>               Traverse relationships
  triple-stats                 Triple statistics
  relations <atom_id>          Atom typed relationships

Lifecycle:
  decay                        Run decay cycle
  confidence-decay             Time-based confidence decay
  forgetting [hours]           Recent forgetting log
  forget [--dry-run] [--auto]  Intentional forgetting engine
  pin <atom_id> [reason]       Pin atom (prevent decay)

Calibration:
  calibrate <provider>         Compare embedding provider rankings
  re-embed <provider>          Re-embed atoms with new provider

Session:
  session-clear                Clear dedup tracking
  session-boundary             Record session boundary
  predict [--warm]             Predictive pre-retrieval

Feedback:
  feedback-mark <ids> <text>   Mark atom contributions
  feedback                     Retrieval adjustments
  contribute <ids> <text>      Legacy contribution tracking

Server:
  serve [--host H] [--port P]   Start the REST API server

Maintenance:
  snapshot                     Log metrics to Grafana
  export <file>                Export atoms to JSONL
  import <file>                Import atoms from JSONL
  merge <keep_id> <remove_id>  Merge two atoms
  split <atom_id> <segments>   Split atom into parts
  summarize <atom_id>          Compress atom content
  versions <atom_id>           View atom version history
  migrate                      Run schema migrations
  rewrite <query>              Preview query rewriting
  drift <entity>               Emotional drift detection
  negative <query>             Check/record negative knowledge
  provenance <atom_id>         View provenance chain
  associations <atom_id>       Co-retrieval associations

  help                         This message"""
    print(help_text)


def cmd_grep(args):
    """Search atom content by text pattern."""
    if not args:
        print("Usage: msam grep <pattern>")
        return
    from .core import get_db
    pattern = " ".join(args)
    conn = get_db()
    rows = conn.execute(
        "SELECT id, content, stream, state, created_at FROM atoms WHERE content LIKE ? ORDER BY created_at DESC LIMIT 50",
        (f"%{pattern}%",)
    ).fetchall()
    conn.close()
    results = [{"id": r[0], "content": r[1][:200], "stream": r[2], "state": r[3], "created_at": r[4]} for r in rows]
    print(json.dumps({"pattern": pattern, "count": len(results), "results": results}, indent=2))


def cmd_export(args):
    """Export active/fading atoms to JSONL."""
    if not args:
        print("Usage: msam export <file.jsonl>")
        return
    from .core import get_db
    filepath = args[0]
    conn = get_db()
    rows = conn.execute(
        "SELECT id, content, stream, profile, arousal, valence, topics, encoding_confidence, "
        "source_type, created_at, state, access_count FROM atoms WHERE state IN ('active', 'fading')"
    ).fetchall()
    conn.close()
    
    count = 0
    with open(filepath, 'w') as f:
        for r in rows:
            atom = {
                "id": r[0], "content": r[1], "stream": r[2], "profile": r[3],
                "arousal": r[4], "valence": r[5], "topics": json.loads(r[6] or "[]"),
                "encoding_confidence": r[7], "source_type": r[8],
                "created_at": r[9], "state": r[10], "access_count": r[11],
            }
            f.write(json.dumps(atom) + "\n")
            count += 1
    print(json.dumps({"exported": count, "file": filepath}))


def cmd_import(args):
    """Import atoms from JSONL file."""
    if not args:
        print("Usage: msam import <file.jsonl>")
        return
    filepath = args[0]
    imported = 0
    skipped = 0
    failed = 0
    
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                atom = json.loads(line)
                result = store_atom(
                    content=atom["content"],
                    stream=atom.get("stream", "semantic"),
                    profile=atom.get("profile", "standard"),
                    arousal=atom.get("arousal", 0.5),
                    valence=atom.get("valence", 0.0),
                    topics=atom.get("topics", []),
                    encoding_confidence=atom.get("encoding_confidence", 0.7),
                    source_type=atom.get("source_type", "external"),
                )
                if result:
                    imported += 1
                else:
                    skipped += 1  # duplicate
            except Exception as e:
                failed += 1
    print(json.dumps({"imported": imported, "skipped_dupes": skipped, "failed": failed, "file": filepath}))


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("help", "--help", "-h"):
        cmd_help()
        return
    
    command = sys.argv[1]
    args = sys.argv[2:]
    
    def cmd_stats(args=None):
        """Print database statistics."""
        print(json.dumps(get_stats(), indent=2, default=str))

    commands = {
        "stats": cmd_stats,
        "query": cmd_query,
        "store": cmd_store,
        "context": cmd_context,
        "snapshot": cmd_snapshot,
        "emotional": cmd_emotional,
        "hybrid": cmd_hybrid,
        "triple-stats": cmd_triple_stats,
        "graph": cmd_graph,
        "contradictions": cmd_contradictions,
        "decay": cmd_decay,
        "working": cmd_working,
        "metamemory": cmd_metamemory,
        "drift": cmd_drift,
        "confidence": cmd_confidence,
        "contribute": cmd_contribute,
        "feedback-mark": cmd_feedback_mark,
        "associations": cmd_associations,
        "quality": cmd_quality,
        "feedback": cmd_feedback,
        "explain": cmd_explain,
        "batch": cmd_batch,
        "negative": cmd_negative,
        "provenance": cmd_provenance,
        "merge": cmd_merge,
        "migrate": cmd_migrate,
        "dry": cmd_dry,
        "rewrite": cmd_rewrite,
        "forgetting": cmd_forgetting,
        "versions": cmd_versions,
        "summarize": cmd_summarize,
        "importance": cmd_importance,
        "emotion-retrieve": cmd_emotion_retrieve,
        "relations": cmd_relations,
        "diverse": cmd_diverse,
        "session-boundary": cmd_session_boundary,
        "session-clear": cmd_session_clear,
        "gaps": cmd_gaps,
        "predict": cmd_predict,
        "serve": cmd_serve,
        "consolidate": cmd_consolidate,
        "replay": cmd_replay,
        "pin": cmd_pin,
        "split": cmd_split,
        "cache": cmd_cache,
        "analytics": cmd_analytics,
        "confidence-decay": cmd_confidence_decay,
        "help": cmd_help,
        "grep": cmd_grep,
        "export": cmd_export,
        "import": cmd_import,
        "forget": cmd_forget,
        "calibrate": cmd_calibrate,
        "re-embed": cmd_reembed,
        "outcomes": cmd_outcomes,
        "world": cmd_world,
        "agreement": cmd_agreement,
    }
    
    if command in commands:
        try:
            commands[command](args)
        except RuntimeError as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(json.dumps({"error": f"{type(e).__name__}: {e}"}), file=sys.stderr)
            sys.exit(1)
    else:
        print(f"Unknown command: {command}. Available: {', '.join(sorted(commands.keys()))}")


if __name__ == "__main__":
    main()
