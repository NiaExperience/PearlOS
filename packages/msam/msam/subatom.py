#!/usr/bin/env python3
"""
MSAM Sub-Atom Extraction (Phase 1: Shannon Compression)

Instead of retrieving whole atoms (~25 tokens each), extract the relevant
SENTENCE from each atom. Reduces token output by ~60% with minimal quality loss.

Architecture:
  Query → hybrid_retrieve (existing) → sub-atom extraction → compressed output

The sentence embeddings are computed lazily and cached in the database.
"""

import re
import time
import json
import struct
import sqlite3
from typing import Optional

from .config import get_config

_cfg = get_config()


# ─── Sentence Splitting ──────────────────────────────────────────

# Regex: split on sentence boundaries (. ! ? followed by space/newline/end)
# Also split on numbered list items, markdown headers, bullet points
_SENT_SPLIT = re.compile(
    r'(?<=[.!?])\s+(?=[A-Z])'       # Period/excl/question + space + capital
    r'|(?<=\n)\s*(?=\d+[.):]\s)'     # Numbered list items
    r'|(?<=\n)\s*(?=[-*•]\s)'        # Bullet points
    r'|(?<=\n)\s*(?=#{1,6}\s)'       # Markdown headers
    r'|\n{2,}'                        # Double newlines (paragraph breaks)
)


def split_sentences(text: str) -> list[str]:
    """Split atom content into sentences/segments."""
    if not text or not text.strip():
        return []
    
    segments = _SENT_SPLIT.split(text.strip())
    result = []
    for seg in segments:
        seg = seg.strip()
        if len(seg) >= 8:  # Min 8 chars to be meaningful
            result.append(seg)
    
    # If no splits found, return the whole text
    if not result and text.strip():
        result = [text.strip()]
    
    return result


# ─── Sentence Embedding Cache ────────────────────────────────────

def _ensure_sentence_table(conn):
    """Create sentence embedding cache table if not exists."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sentence_embeddings (
            atom_id TEXT NOT NULL,
            sentence_idx INTEGER NOT NULL,
            sentence TEXT NOT NULL,
            embedding BLOB,
            token_count INTEGER,
            PRIMARY KEY (atom_id, sentence_idx)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_sentence_atom 
        ON sentence_embeddings(atom_id)
    """)
    conn.commit()


def _pack_embedding(emb: list[float]) -> bytes:
    """Pack float list to binary blob."""
    return struct.pack(f'{len(emb)}f', *emb)


def _unpack_embedding(blob: bytes) -> list[float]:
    """Unpack binary blob to float list."""
    n = len(blob) // 4
    return list(struct.unpack(f'{n}f', blob))


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: chars / 4."""
    return max(1, len(text) // 4)


def cache_sentence_embeddings(atom_id: str, content: str, conn=None):
    """Split atom into sentences, embed each, cache in DB."""
    from .core import get_db
    from .embeddings import embed_text as get_embedding
    
    if conn is None:
        conn = get_db()
    
    _ensure_sentence_table(conn)
    
    # Check if already cached
    existing = conn.execute(
        "SELECT COUNT(*) FROM sentence_embeddings WHERE atom_id = ?",
        (atom_id,)
    ).fetchone()[0]
    
    if existing > 0:
        return existing
    
    sentences = split_sentences(content)
    if not sentences:
        return 0
    
    for idx, sent in enumerate(sentences):
        emb = get_embedding(sent)
        emb_blob = _pack_embedding(emb) if emb else None
        tok_count = _estimate_tokens(sent)
        
        conn.execute(
            """INSERT OR REPLACE INTO sentence_embeddings 
               (atom_id, sentence_idx, sentence, embedding, token_count)
               VALUES (?, ?, ?, ?, ?)""",
            (atom_id, idx, sent, emb_blob, tok_count)
        )
    
    conn.commit()
    return len(sentences)


def cache_all_sentences(batch_size: int = 50):
    """Cache sentence embeddings for all active atoms."""
    from .core import get_db
    
    conn = get_db()
    _ensure_sentence_table(conn)
    
    atoms = conn.execute(
        "SELECT id, content FROM atoms WHERE state = 'active'"
    ).fetchall()
    
    total = len(atoms)
    cached = 0
    skipped = 0
    total_sentences = 0
    
    for i, (atom_id, content) in enumerate(atoms):
        existing = conn.execute(
            "SELECT COUNT(*) FROM sentence_embeddings WHERE atom_id = ?",
            (atom_id,)
        ).fetchone()[0]
        
        if existing > 0:
            skipped += 1
            continue
        
        n = cache_sentence_embeddings(atom_id, content, conn)
        total_sentences += n
        cached += 1
        
        if (i + 1) % batch_size == 0:
            print(f"  Progress: {i+1}/{total} atoms ({cached} cached, {skipped} skipped, {total_sentences} sentences)")
    
    print(f"Done: {cached} atoms cached, {skipped} already cached, {total_sentences} new sentences")
    return {"cached": cached, "skipped": skipped, "sentences": total_sentences}


# ─── Sub-Atom Retrieval ──────────────────────────────────────────

def extract_relevant_sentences(
    query: str,
    atoms: list[dict],
    token_budget: int = None,
    similarity_threshold: float = None,
) -> list[dict]:
    """
    Given retrieved atoms, extract only the most relevant sentence from each.
    
    Args:
        query: The search query
        atoms: List of atom dicts from hybrid_retrieve
        token_budget: Max tokens for output (default from config)
        similarity_threshold: Min similarity for a sentence (default from config)
    
    Returns:
        List of dicts: {atom_id, sentence, score, tokens}
    """
    from .core import get_db, cosine_similarity
    from .embeddings import embed_text as get_embedding
    
    if token_budget is None:
        token_budget = _cfg('compression', 'subatom_token_budget', 120)
    if similarity_threshold is None:
        similarity_threshold = _cfg('compression', 'sentence_similarity_threshold', 0.25)
    
    conn = get_db()
    _ensure_sentence_table(conn)
    
    query_emb = get_embedding(query)
    if not query_emb:
        # Fallback: return whole atoms truncated to budget
        return _fallback_whole_atoms(atoms, token_budget)
    
    scored_sentences = []
    
    for atom in atoms:
        atom_id = atom.get('id', atom.get('atom_id', ''))
        atom_score = atom.get('_combined_score', atom.get('_activation', 0))
        
        # Get cached sentence embeddings
        rows = conn.execute(
            """SELECT sentence_idx, sentence, embedding, token_count 
               FROM sentence_embeddings WHERE atom_id = ?
               ORDER BY sentence_idx""",
            (atom_id,)
        ).fetchall()
        
        if not rows:
            # No sentence cache -- cache now, then retry
            content = atom.get('content', '')
            if content:
                cache_sentence_embeddings(atom_id, content, conn)
                rows = conn.execute(
                    """SELECT sentence_idx, sentence, embedding, token_count 
                       FROM sentence_embeddings WHERE atom_id = ?
                       ORDER BY sentence_idx""",
                    (atom_id,)
                ).fetchall()
        
        if not rows:
            # Still nothing -- use whole atom content
            content = atom.get('content', '')
            if content:
                scored_sentences.append({
                    'atom_id': atom_id,
                    'sentence': content,
                    'score': atom_score,
                    'tokens': _estimate_tokens(content),
                    'source': 'whole_atom',
                })
            continue
        
        # Score each sentence against query
        best_sent = None
        best_score = -1
        
        for idx, sent, emb_blob, tok_count in rows:
            if emb_blob is None:
                continue
            sent_emb = _unpack_embedding(emb_blob)
            sim = cosine_similarity(query_emb, sent_emb)
            
            # Specificity penalty: short generic sentences get inflated
            # cosine similarity from embedding models. Penalize sentences
            # under 40 chars (likely fragments like "This is unique.")
            sent_len = len(sent)
            if sent_len < 40:
                specificity = sent_len / 40.0  # 0.0 to 1.0
            elif sent_len < 80:
                specificity = 1.0
            else:
                specificity = 1.0 + (sent_len - 80) / 400.0  # slight bonus for longer
            specificity = min(specificity, 1.2)
            
            # Information density: penalize sentences with few content words
            content_words = len([w for w in sent.split() if len(w) > 3])
            density = min(content_words / 5.0, 1.0)  # normalize: 5+ content words = 1.0
            
            # Query-keyword overlap: boost sentences sharing actual words with query
            query_words = set(w.lower() for w in query.split() if len(w) > 3)
            sent_words = set(w.lower() for w in sent.split() if len(w) > 3)
            overlap = len(query_words & sent_words) / max(len(query_words), 1)
            keyword_boost = 1.0 + overlap * 0.5  # up to 1.5x for full overlap
            
            # Embedding variance penalty: sentences whose embeddings are close
            # to the corpus mean are generic. Measure via embedding norm after
            # mean-centering (higher = more distinctive).
            # Approximation: use raw embedding L2 norm variance as proxy.
            # Short generic sentences cluster tightly; specific ones spread out.
            emb_norm = sum(x*x for x in sent_emb) ** 0.5
            # Typical norms: ~0.95-1.05 for normalized embeddings. Use as-is.
            # Better proxy: unique content word ratio
            total_words = len(sent.split())
            unique_ratio = len(sent_words) / max(total_words, 1)
            uniqueness = 0.5 + unique_ratio * 0.5  # 0.5 to 1.0
            
            # Atom rank bonus: sentences from higher-ranked atoms get a boost
            # This preserves the reranker's judgment through to sentence selection
            atom_rank = atom.get('_retrieval_rank', 5)
            rank_boost = 1.0 + max(0, (5 - atom_rank)) * 0.1  # top atom: 1.5x, #5+: 1.0x
            
            # Combined score:
            # - Raw similarity (weighted down to reduce embedding pathology)
            # - Specificity (length-based anti-generic filter)
            # - Density (content word count)
            # - Keyword boost (actual word overlap with query)
            # - Rank boost (higher-ranked atoms preferred)
            adjusted_sim = sim * specificity * density * keyword_boost * uniqueness * rank_boost
            combined = adjusted_sim * 0.7 + min(atom_score / 10.0, 0.3) * 0.3
            
            if adjusted_sim >= similarity_threshold and combined > best_score:
                best_score = combined
                best_sent = {
                    'atom_id': atom_id,
                    'sentence': sent,
                    'score': combined,
                    'similarity': sim,
                    'adjusted_similarity': adjusted_sim,
                    'specificity': specificity,
                    'density': density,
                    'atom_score': atom_score,
                    'tokens': tok_count,
                    'source': 'subatom',
                }
        
        if best_sent:
            scored_sentences.append(best_sent)
    
    # Sort by score, fill up to token budget
    scored_sentences.sort(key=lambda x: x['score'], reverse=True)
    
    selected = []
    tokens_used = 0
    
    for sent in scored_sentences:
        if tokens_used + sent['tokens'] > token_budget:
            # Try to fit -- if we have nothing yet, take it anyway
            if not selected:
                selected.append(sent)
                tokens_used += sent['tokens']
            break
        selected.append(sent)
        tokens_used += sent['tokens']
    
    return selected


# ─── Phase 2: Fact Deduplication ─────────────────────────────────

def deduplicate_sentences(
    sentences: list[dict],
    similarity_threshold: float = None,
) -> list[dict]:
    """
    Remove near-duplicate sentences using pairwise semantic similarity.
    
    When two sentences are >threshold similar, keep the higher-scored one.
    This catches cases like:
      "User is a software engineer" + "User works in engineering" → keep one
    
    Uses cached sentence embeddings where available, falls back to fresh embed.
    """
    from .core import cosine_similarity
    from .embeddings import embed_text as get_embedding
    
    if similarity_threshold is None:
        similarity_threshold = _cfg('compression', 'dedup_similarity_threshold', 0.85)
    
    if len(sentences) <= 1:
        return sentences
    
    # Get or compute embeddings for each sentence
    embeddings = []
    for sent in sentences:
        # Try to get from cache
        emb = _get_cached_sentence_embedding(sent)
        if emb is None:
            emb = get_embedding(sent['sentence'])
        embeddings.append(emb)
    
    # Mark duplicates (keep highest score in each cluster)
    removed = set()
    for i in range(len(sentences)):
        if i in removed:
            continue
        for j in range(i + 1, len(sentences)):
            if j in removed:
                continue
            if embeddings[i] is None or embeddings[j] is None:
                continue
            sim = cosine_similarity(embeddings[i], embeddings[j])
            if sim >= similarity_threshold:
                # Remove the lower-scored one
                if sentences[i]['score'] >= sentences[j]['score']:
                    removed.add(j)
                else:
                    removed.add(i)
                    break  # i is removed, stop comparing from i
    
    result = [s for idx, s in enumerate(sentences) if idx not in removed]
    return result


def _get_cached_sentence_embedding(sent_dict: dict) -> list[float]:
    """Try to retrieve embedding from sentence cache."""
    from .core import get_db
    
    atom_id = sent_dict.get('atom_id', '')
    sentence = sent_dict.get('sentence', '')
    
    if not atom_id:
        return None
    
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT embedding FROM sentence_embeddings WHERE atom_id = ? AND sentence = ?",
            (atom_id, sentence)
        ).fetchone()
        if row and row[0]:
            return _unpack_embedding(row[0])
    except Exception:
        pass
    return None


def _fallback_whole_atoms(atoms: list[dict], token_budget: int) -> list[dict]:
    """Fallback when embeddings unavailable."""
    selected = []
    tokens_used = 0
    for atom in atoms:
        content = atom.get('content', '')
        tok = _estimate_tokens(content)
        if tokens_used + tok > token_budget:
            if not selected:
                selected.append({
                    'atom_id': atom.get('id', ''),
                    'sentence': content,
                    'score': atom.get('_combined_score', 0),
                    'tokens': tok,
                    'source': 'fallback',
                })
            break
        selected.append({
            'atom_id': atom.get('id', ''),
            'sentence': content,
            'score': atom.get('_combined_score', 0),
            'tokens': tok,
            'source': 'fallback',
        })
        tokens_used += tok
    return selected


# ─── Phase 3: Synthesis ──────────────────────────────────────────

def synthesize_sentences(
    sentences: list[dict],
    max_tokens: int = None,
    model: str = None,
) -> dict:
    """
    Compress extracted sentences using a small LLM.
    Merges related facts, removes redundancy, produces minimal natural language.
    
    Returns:
        {
            "text": str,
            "tokens": int,
            "input_tokens": int,
            "model": str,
            "latency_ms": float,
        }
    """
    import requests
    import os
    import time
    
    if max_tokens is None:
        max_tokens = _cfg('compression', 'synthesis_max_tokens', 30)
    if model is None:
        model = _cfg('compression', 'synthesis_model', 'mistralai/mistral-large-3-675b-instruct-2512')
    
    api_key = os.environ.get('NVIDIA_NIM_API_KEY')
    if not api_key:
        # No API key -- return sentences as-is
        text = ' '.join(s['sentence'] for s in sentences)
        return {
            "text": text,
            "tokens": sum(s.get('tokens', 0) for s in sentences),
            "input_tokens": sum(s.get('tokens', 0) for s in sentences),
            "model": "passthrough",
            "latency_ms": 0,
        }
    
    input_text = '\n'.join(f'- {s["sentence"]}' for s in sentences)
    input_tokens = sum(s.get('tokens', 0) for s in sentences)
    
    t0 = time.time()
    try:
        resp = requests.post(
            'https://integrate.api.nvidia.com/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': model,
                'messages': [
                    {'role': 'system', 'content': 'Compress these facts into the shortest possible text. Merge related. Fragments OK. No filler. Preserve all unique information.'},
                    {'role': 'user', 'content': input_text},
                ],
                'max_tokens': max_tokens,
                'temperature': 0.1,
            },
            timeout=20,
        )
        latency_ms = (time.time() - t0) * 1000
        
        if resp.ok:
            output = resp.json()['choices'][0]['message']['content']
            if output:
                out_tokens = _estimate_tokens(output)
                return {
                    "text": output,
                    "tokens": out_tokens,
                    "input_tokens": input_tokens,
                    "model": model,
                    "latency_ms": latency_ms,
                }
    except Exception:
        latency_ms = (time.time() - t0) * 1000
    
    # Fallback: return concatenated sentences
    text = ' '.join(s['sentence'] for s in sentences)
    return {
        "text": text,
        "tokens": input_tokens,
        "input_tokens": input_tokens,
        "model": "fallback",
        "latency_ms": latency_ms if 'latency_ms' in dir() else 0,
    }


# ─── Compressed Retrieval (Full Pipeline) ────────────────────────

def compressed_retrieve(
    query: str,
    mode: str = "task",
    top_k: int = 12,
    token_budget: int = None,
    enable_subatom: bool = None,
    enable_dedup: bool = None,
    enable_synthesis: bool = None,
) -> dict:
    """
    Full retrieval pipeline with optional sub-atom compression.
    
    Returns:
        {
            "sentences": [...],
            "total_tokens": int,
            "atoms_retrieved": int,
            "sentences_extracted": int,
            "compression_ratio": float,
            "method": "subatom" | "whole_atom",
        }
    """
    # Use v2 retrieval if enabled
    use_v2 = _cfg('retrieval_v2', 'enabled', False)
    if use_v2:
        try:
            from .retrieval_v2 import retrieve_v2 as hybrid_retrieve
        except ImportError:
            from .core import hybrid_retrieve
    else:
        from .core import hybrid_retrieve
    
    if enable_subatom is None:
        enable_subatom = _cfg('compression', 'enable_subatom', True)
    if enable_dedup is None:
        enable_dedup = _cfg('compression', 'enable_fact_dedup', True)
    if enable_synthesis is None:
        enable_synthesis = _cfg('compression', 'enable_synthesis', False)
    
    if token_budget is None:
        token_budget = _cfg('compression', 'subatom_token_budget', 120)
    
    # Step 1: Retrieval (v2 handles rewriting/expansion internally)
    atoms = hybrid_retrieve(query, mode=mode, top_k=top_k)
    
    # For sentence extraction, use the expanded query if v2 is enabled
    # so sentence similarity matches against the enriched query
    extraction_query = query
    if use_v2:
        try:
            from .retrieval_v2 import rewrite_query, expand_query
            extraction_query = expand_query(rewrite_query(query))
        except ImportError:
            pass
    
    whole_atom_tokens = sum(_estimate_tokens(a.get('content', '')) for a in atoms)
    
    if not enable_subatom or not atoms:
        return {
            "sentences": [{"atom_id": a.get("id"), "sentence": a.get("content", ""), 
                          "tokens": _estimate_tokens(a.get("content", "")), "source": "whole_atom"}
                         for a in atoms],
            "total_tokens": whole_atom_tokens,
            "atoms_retrieved": len(atoms),
            "sentences_extracted": len(atoms),
            "compression_ratio": 1.0,
            "method": "whole_atom",
        }
    
    # Step 2: Sub-atom extraction (Phase 1) -- use expanded query for better matching
    # Pass atom rank as a signal: atoms earlier in the list are more relevant
    for rank, atom in enumerate(atoms):
        atom['_retrieval_rank'] = rank
    sentences = extract_relevant_sentences(extraction_query, atoms, token_budget=token_budget)
    
    # Step 3: Fact deduplication (Phase 2)
    pre_dedup_count = len(sentences)
    pre_dedup_tokens = sum(s['tokens'] for s in sentences)
    
    if enable_dedup and len(sentences) > 1:
        sentences = deduplicate_sentences(sentences)
    
    total_tokens = sum(s['tokens'] for s in sentences)
    
    # Step 4: Synthesis (Phase 3)
    synthesis_result = None
    if enable_synthesis and sentences:
        synthesis_result = synthesize_sentences(sentences)
        if synthesis_result['model'] != 'fallback':
            total_tokens = synthesis_result['tokens']
    
    compression_ratio = total_tokens / max(whole_atom_tokens, 1)
    
    return {
        "sentences": sentences,
        "synthesis": synthesis_result,
        "synthesized_text": synthesis_result['text'] if synthesis_result and synthesis_result['model'] != 'fallback' else None,
        "pre_dedup_count": pre_dedup_count,
        "pre_dedup_tokens": pre_dedup_tokens,
        "dedup_removed": pre_dedup_count - len(sentences),
        "total_tokens": total_tokens,
        "atoms_retrieved": len(atoms),
        "sentences_extracted": len(sentences),
        "whole_atom_tokens": whole_atom_tokens,
        "compression_ratio": compression_ratio,
        "method": "subatom",
    }


# ─── Benchmarking ────────────────────────────────────────────────

def benchmark_subatom(queries: list[str] = None):
    """Compare whole-atom vs sub-atom retrieval."""
    from .core import hybrid_retrieve
    
    if queries is None:
        queries = [
            "What is the user's profession?",
            "What server is this running on?",
            "What are the user's preferences?",
            "What happened recently?",
            "What is the agent's identity?",
            "What is the relationship dynamic?",
            "What projects are in progress?",
            "What are the emotional boundaries?",
            "What model routing decisions were made?",
            "What security rules apply?",
        ]
    
    print("=" * 70)
    print("SUB-ATOM EXTRACTION BENCHMARK")
    print("=" * 70)
    
    total_whole = 0
    total_sub = 0
    
    total_p1 = 0  # Phase 1 only (sub-atom, no dedup)
    
    for q in queries:
        # Whole atom
        whole = compressed_retrieve(q, enable_subatom=False, enable_dedup=False, token_budget=300)
        # Phase 1 only (sub-atom, no dedup)
        p1 = compressed_retrieve(q, enable_subatom=True, enable_dedup=False, token_budget=120)
        # Phase 1 + Phase 2 (sub-atom + dedup)
        p2 = compressed_retrieve(q, enable_subatom=True, enable_dedup=True, token_budget=120)
        
        total_whole += whole['total_tokens']
        total_p1 += p1['total_tokens']
        total_sub += p2['total_tokens']
        
        dedup_removed = p2.get('dedup_removed', 0)
        
        print(f"\nQuery: {q}")
        print(f"  Whole atom: {whole['total_tokens']} tokens ({whole['atoms_retrieved']} atoms)")
        print(f"  Phase 1:    {p1['total_tokens']} tokens ({p1['sentences_extracted']} sents)")
        print(f"  Phase 2:    {p2['total_tokens']} tokens ({p2['sentences_extracted']} sents, -{dedup_removed} deduped)")
        
        # Show extracted sentences
        for s in p2['sentences'][:3]:
            sim = s.get('similarity', 0)
            print(f"    [{sim:.3f}] {s['sentence'][:80]}...")
    
    overall_p1 = total_p1 / max(total_whole, 1)
    overall_p2 = total_sub / max(total_whole, 1)
    
    print(f"\n{'=' * 70}")
    print(f"OVERALL:")
    print(f"  Whole atom total:  {total_whole} tokens")
    print(f"  Phase 1 total:     {total_p1} tokens ({(1-overall_p1)*100:.0f}% saved)")
    print(f"  Phase 2 total:     {total_sub} tokens ({(1-overall_p2)*100:.0f}% saved)")
    print(f"  Phase 2 vs Phase1: {total_p1 - total_sub} tokens saved by dedup")
    print(f"  Shannon target:    ~50 tokens per query (~{50 * len(queries)} total)")
    print(f"  Gap to Shannon:    {total_sub - 50 * len(queries)} tokens")
    print(f"{'=' * 70}")
    
    return {
        "total_whole_tokens": total_whole,
        "total_p1_tokens": total_p1,
        "total_p2_tokens": total_sub,
        "compression_p1": overall_p1,
        "compression_p2": overall_p2,
        "queries": len(queries),
    }


# ─── CLI ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python subatom.py cache          # Cache all sentence embeddings")
        print("  python subatom.py benchmark       # Run compression benchmark")
        print("  python subatom.py query <text>    # Test sub-atom retrieval")
        print("  python subatom.py stats           # Show sentence cache stats")
        sys.exit(0)
    
    cmd = sys.argv[1]
    
    if cmd == "cache":
        print("Caching sentence embeddings for all active atoms...")
        result = cache_all_sentences()
        print(json.dumps(result, indent=2))
    
    elif cmd == "benchmark":
        benchmark_subatom()
    
    elif cmd == "query":
        query = " ".join(sys.argv[2:])
        result = compressed_retrieve(query, token_budget=120)
        print(f"\nQuery: {query}")
        print(f"Method: {result['method']}")
        print(f"Atoms retrieved: {result['atoms_retrieved']}")
        print(f"Sentences extracted: {result['sentences_extracted']}")
        print(f"Total tokens: {result['total_tokens']}")
        if 'whole_atom_tokens' in result:
            print(f"Whole atom tokens: {result['whole_atom_tokens']}")
            print(f"Compression: {result['compression_ratio']:.1%}")
        print(f"\nExtracted sentences:")
        for s in result['sentences']:
            sim = s.get('similarity', 0)
            print(f"  [{sim:.3f}] ({s['tokens']}tok) {s['sentence'][:100]}")
    
    elif cmd == "stats":
        from .core import get_db
        conn = get_db()
        _ensure_sentence_table(conn)
        total_atoms = conn.execute("SELECT COUNT(DISTINCT atom_id) FROM sentence_embeddings").fetchone()[0]
        total_sents = conn.execute("SELECT COUNT(*) FROM sentence_embeddings").fetchone()[0]
        total_tokens = conn.execute("SELECT SUM(token_count) FROM sentence_embeddings").fetchone()[0] or 0
        avg_per_atom = total_sents / max(total_atoms, 1)
        print(f"Sentence cache stats:")
        print(f"  Atoms cached:       {total_atoms}")
        print(f"  Total sentences:    {total_sents}")
        print(f"  Avg per atom:       {avg_per_atom:.1f}")
        print(f"  Total tokens:       {total_tokens}")
        print(f"  Avg tokens/sent:    {total_tokens / max(total_sents, 1):.1f}")
    
    else:
        print(f"Unknown command: {cmd}")
