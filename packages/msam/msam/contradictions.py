"""
MSAM Contradictions -- Semantic Contradiction Detection

Finds contradictions that share meaning but use different words,
going beyond the existing string-based predicate matching in triples.py.

Uses embedding similarity to find semantically related atoms, then
applies heuristic checks (negation, temporal supersession, value
conflict, antonym detection) to surface likely contradictions.
"""

import re
import json
from datetime import datetime, timezone

from .core import get_db, embed_query, unpack_embedding, cosine_similarity, pack_embedding
from .config import get_config

# ─── Antonym Pairs ────────────────────────────────────────────────

ANTONYM_PAIRS = [
    ("love", "hate"),
    ("start", "stop"),
    ("begin", "end"),
    ("join", "leave"),
    ("accept", "reject"),
    ("agree", "disagree"),
    ("allow", "forbid"),
    ("approve", "disapprove"),
    ("arrive", "depart"),
    ("attach", "detach"),
    ("build", "destroy"),
    ("buy", "sell"),
    ("connect", "disconnect"),
    ("create", "destroy"),
    ("enable", "disable"),
    ("enter", "exit"),
    ("expand", "contract"),
    ("gain", "lose"),
    ("give", "take"),
    ("happy", "sad"),
    ("help", "hinder"),
    ("hire", "fire"),
    ("include", "exclude"),
    ("increase", "decrease"),
    ("install", "uninstall"),
    ("like", "dislike"),
    ("open", "close"),
    ("pass", "fail"),
    ("positive", "negative"),
    ("promote", "demote"),
    ("push", "pull"),
    ("raise", "lower"),
    ("remember", "forget"),
    ("rise", "fall"),
    ("safe", "dangerous"),
    ("save", "spend"),
    ("show", "hide"),
    ("success", "failure"),
    ("support", "oppose"),
    ("true", "false"),
    ("trust", "distrust"),
    ("win", "lose"),
]

# Build a lookup set for O(1) checking
_ANTONYM_SET = set()
for a, b in ANTONYM_PAIRS:
    _ANTONYM_SET.add((a.lower(), b.lower()))
    _ANTONYM_SET.add((b.lower(), a.lower()))

# ─── Negation Patterns ────────────────────────────────────────────

NEGATION_PATTERN = re.compile(
    r"\b(not|no longer|don't|doesn't|isn't|wasn't|weren't|aren't|"
    r"stopped|quit|never|can't|won't|couldn't|wouldn't|shouldn't|"
    r"haven't|hasn't|hadn't|didn't|cannot|nor|neither)\b",
    re.IGNORECASE,
)

DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")

RELATIVE_TIME_WORDS = re.compile(
    r"\b(now|currently|recently|today|yesterday|formerly|previously|"
    r"used to|no longer|anymore|at this point)\b",
    re.IGNORECASE,
)

# ─── Internal Detection Helpers ───────────────────────────────────


def _detect_negation(text_a: str, text_b: str) -> bool:
    """Check if one text negates the other.

    Returns True when one text contains negation markers and the other
    does not, while both discuss overlapping words (same topic signal).
    """
    neg_a = bool(NEGATION_PATTERN.search(text_a))
    neg_b = bool(NEGATION_PATTERN.search(text_b))

    # One must negate, the other must not
    if neg_a == neg_b:
        return False

    # Check for overlapping content words (at least 2 shared words of length >= 3)
    words_a = set(re.findall(r"\b[a-zA-Z]{3,}\b", text_a.lower()))
    words_b = set(re.findall(r"\b[a-zA-Z]{3,}\b", text_b.lower()))

    # Remove common stop words and negation words from overlap check
    stop_words = {
        "the", "and", "for", "are", "but", "not", "you", "all", "can",
        "had", "her", "was", "one", "our", "out", "has", "his", "how",
        "its", "may", "who", "did", "get", "got", "him", "let", "say",
        "she", "too", "use", "that", "this", "with", "have", "from",
        "they", "been", "said", "each", "which", "their", "will",
        "other", "about", "many", "then", "them", "these", "some",
        "would", "make", "like", "into", "could", "time", "very",
        "when", "what", "your", "just", "know", "take", "people",
        "come", "than", "does", "doesn", "isn", "wasn", "don",
        "didn", "won", "can", "couldn", "wouldn", "shouldn",
    }
    words_a -= stop_words
    words_b -= stop_words

    overlap = words_a & words_b
    return len(overlap) >= 2


def _detect_temporal_supersession(atom_a: dict, atom_b: dict) -> bool:
    """Check if atoms have dates and one is newer, suggesting supersession.

    Compares explicit dates in content and falls back to created_at timestamps.
    Returns True if the atoms appear to be about the same topic but from
    different times, indicating the newer one may supersede the older.
    """
    content_a = atom_a.get("content", "")
    content_b = atom_b.get("content", "")

    # Look for explicit dates in content
    dates_a = DATE_PATTERN.findall(content_a)
    dates_b = DATE_PATTERN.findall(content_b)

    # Also check for relative time words indicating temporal context
    has_temporal_a = bool(RELATIVE_TIME_WORDS.search(content_a))
    has_temporal_b = bool(RELATIVE_TIME_WORDS.search(content_b))

    # If both have explicit dates and they differ, temporal supersession
    if dates_a and dates_b:
        latest_a = max(dates_a)
        latest_b = max(dates_b)
        if latest_a != latest_b:
            return True

    # If one has temporal markers suggesting currency ("now", "currently")
    # and the other doesn't, possible supersession
    if has_temporal_a != has_temporal_b:
        return True

    # Fall back to created_at comparison -- if atoms were created on
    # different dates, the newer one may supersede
    created_a = atom_a.get("created_at", "")
    created_b = atom_b.get("created_at", "")
    if created_a and created_b and created_a != created_b:
        try:
            dt_a = datetime.fromisoformat(created_a.replace("Z", "+00:00"))
            dt_b = datetime.fromisoformat(created_b.replace("Z", "+00:00"))
            # Only flag if created more than 1 day apart
            diff = abs((dt_a - dt_b).total_seconds())
            if diff > 86400:
                return True
        except (ValueError, TypeError):
            pass

    return False


def _detect_value_conflict(text_a: str, text_b: str) -> bool:
    """Check if texts assign different values to the same property.

    Detects patterns where both texts mention the same subject but pair it
    with different objects, e.g. "lives in NYC" vs "lives in LA".
    """
    # Extract "verb + preposition + value" patterns
    pattern = re.compile(
        r"\b(is|are|was|were|lives?\s+in|works?\s+at|works?\s+for|"
        r"located\s+in|moved\s+to|based\s+in|uses?|prefers?|"
        r"weighs?|costs?|earns?|makes?|has|have|had)\s+(.+?)(?:\.|,|;|$)",
        re.IGNORECASE,
    )

    matches_a = pattern.findall(text_a)
    matches_b = pattern.findall(text_b)

    if not matches_a or not matches_b:
        return False

    # Check if same verb/property is used with different values
    for verb_a, value_a in matches_a:
        verb_a_norm = verb_a.strip().lower()
        for verb_b, value_b in matches_b:
            verb_b_norm = verb_b.strip().lower()
            if verb_a_norm == verb_b_norm:
                val_a = value_a.strip().lower()
                val_b = value_b.strip().lower()
                if val_a and val_b and val_a != val_b:
                    return True

    return False


def _detect_antonyms(text_a: str, text_b: str) -> bool:
    """Check for antonym pairs across the two texts.

    Returns True if text_a contains one word of an antonym pair and
    text_b contains its opposite.
    """
    words_a = set(re.findall(r"\b[a-zA-Z]+\b", text_a.lower()))
    words_b = set(re.findall(r"\b[a-zA-Z]+\b", text_b.lower()))

    for word_a in words_a:
        for word_b in words_b:
            if (word_a, word_b) in _ANTONYM_SET:
                return True

    return False


# ─── Public API ───────────────────────────────────────────────────


def find_semantic_contradictions(threshold: float = 0.85) -> list[dict]:
    """Find atoms with high embedding similarity but contradictory content.

    Strategy:
      1. Get all active atoms with embeddings from DB
      2. Group atoms by overlapping topics/entities
      3. Within each group, compute pairwise cosine similarity
      4. For pairs where similarity > threshold, check for contradiction signals
      5. Return contradictions found

    Args:
        threshold: minimum cosine similarity to consider a pair (default 0.85)

    Returns:
        List of contradiction result dicts.
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT id, content, embedding, topics, created_at, arousal, valence "
        "FROM atoms WHERE state = 'active' AND embedding IS NOT NULL"
    ).fetchall()
    conn.close()

    if not rows:
        return []

    # Build topic groups: topic -> list of atom indices
    topic_groups: dict[str, list[int]] = {}
    atoms = []
    for i, row in enumerate(rows):
        atom = {
            "id": row["id"],
            "content": row["content"],
            "embedding": row["embedding"],
            "topics": row["topics"],
            "created_at": row["created_at"],
            "arousal": row["arousal"],
            "valence": row["valence"],
        }
        atoms.append(atom)

        # Parse topics JSON
        try:
            topics = json.loads(atom["topics"]) if atom["topics"] else []
        except (json.JSONDecodeError, TypeError):
            topics = []

        if not topics:
            # Fall back to a generic group so atoms without topics
            # are still compared against each other
            topic_groups.setdefault("__no_topic__", []).append(i)
        else:
            for topic in topics:
                topic_key = topic.strip().lower()
                topic_groups.setdefault(topic_key, []).append(i)

    # Within each group, compute pairwise similarity and detect contradictions
    seen_pairs: set[tuple[str, str]] = set()
    contradictions: list[dict] = []

    for _topic, indices in topic_groups.items():
        if len(indices) < 2:
            continue

        for i in range(len(indices)):
            for j in range(i + 1, len(indices)):
                idx_a, idx_b = indices[i], indices[j]
                atom_a, atom_b = atoms[idx_a], atoms[idx_b]

                # Deduplicate across topic groups
                pair_key = tuple(sorted((atom_a["id"], atom_b["id"])))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                # Compute cosine similarity
                emb_a = unpack_embedding(atom_a["embedding"])
                emb_b = unpack_embedding(atom_b["embedding"])
                sim = cosine_similarity(emb_a, emb_b)

                if sim < threshold:
                    continue

                # Check for contradiction signals
                text_a = atom_a["content"]
                text_b = atom_b["content"]

                contradiction_type = None
                suggestion = None

                if _detect_negation(text_a, text_b):
                    contradiction_type = "negation"
                    suggestion = "One atom negates the other; consider merging or retiring the outdated one."
                elif _detect_temporal_supersession(atom_a, atom_b):
                    contradiction_type = "temporal_supersession"
                    suggestion = "Newer atom may supersede older; consider retiring the older atom."
                elif _detect_value_conflict(text_a, text_b):
                    contradiction_type = "value_conflict"
                    suggestion = "Atoms assign different values to the same property; verify which is correct."
                elif _detect_antonyms(text_a, text_b):
                    contradiction_type = "semantic_opposition"
                    suggestion = "Atoms contain semantically opposite terms; review for accuracy."

                if contradiction_type:
                    contradictions.append({
                        "atom_a": {
                            "id": atom_a["id"],
                            "content": atom_a["content"],
                            "created_at": atom_a["created_at"],
                        },
                        "atom_b": {
                            "id": atom_b["id"],
                            "content": atom_b["content"],
                            "created_at": atom_b["created_at"],
                        },
                        "similarity": round(sim, 4),
                        "contradiction_type": contradiction_type,
                        "suggestion": suggestion,
                    })

    return contradictions


def check_before_store(content: str, top_k: int = 5) -> list[dict]:
    """Pre-store contradiction check.

    Before storing a new atom, embed the content, find the top_k most
    similar existing atoms, and run contradiction detection against them.
    Uses FAISS when available for O(sqrt(n)) instead of O(n) scan.

    Args:
        content: the text content about to be stored
        top_k: number of most-similar existing atoms to check

    Returns:
        List of potential contradiction dicts (same format as
        find_semantic_contradictions).
    """
    query_emb = embed_query(content)

    # Try FAISS fast path
    top_atoms = []
    try:
        from .vector_index import faiss_search_atoms, FAISS_AVAILABLE
        if FAISS_AVAILABLE:
            candidates = faiss_search_atoms(query_emb, top_k=top_k)
            if candidates:
                conn = get_db()
                candidate_ids = [c[0] for c in candidates]
                sim_map = {c[0]: c[1] for c in candidates}
                placeholders = ','.join(['?'] * len(candidate_ids))
                rows = conn.execute(
                    f"SELECT id, content, embedding, topics, created_at, arousal, valence "
                    f"FROM atoms WHERE id IN ({placeholders})",
                    candidate_ids
                ).fetchall()
                conn.close()
                top_atoms = [(sim_map.get(row["id"], 0.0), {
                    "id": row["id"], "content": row["content"],
                    "embedding": row["embedding"], "topics": row["topics"],
                    "created_at": row["created_at"], "arousal": row["arousal"],
                    "valence": row["valence"],
                }) for row in rows]
    except Exception:
        pass

    # Fallback: brute-force scan
    if not top_atoms:
        conn = get_db()
        rows = conn.execute(
            "SELECT id, content, embedding, topics, created_at, arousal, valence "
            "FROM atoms WHERE state = 'active' AND embedding IS NOT NULL"
        ).fetchall()
        conn.close()

        if not rows:
            return []

        scored: list[tuple[float, dict]] = []
        for row in rows:
            emb = unpack_embedding(row["embedding"])
            sim = cosine_similarity(query_emb, emb)
            scored.append((sim, {
                "id": row["id"], "content": row["content"],
                "embedding": row["embedding"], "topics": row["topics"],
                "created_at": row["created_at"], "arousal": row["arousal"],
                "valence": row["valence"],
            }))
        scored.sort(key=lambda x: x[0], reverse=True)
        top_atoms = scored[:top_k]

    # Check each top atom for contradictions with the new content
    contradictions: list[dict] = []
    new_atom = {
        "id": "__pending__",
        "content": content,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    for sim, existing in top_atoms:
        text_a = content
        text_b = existing["content"]

        contradiction_type = None
        suggestion = None

        if _detect_negation(text_a, text_b):
            contradiction_type = "negation"
            suggestion = "New content negates an existing atom; consider updating instead of adding."
        elif _detect_temporal_supersession(new_atom, existing):
            contradiction_type = "temporal_supersession"
            suggestion = "New content may supersede existing atom; consider retiring the older one."
        elif _detect_value_conflict(text_a, text_b):
            contradiction_type = "value_conflict"
            suggestion = "New content assigns a different value than existing atom; verify correctness."
        elif _detect_antonyms(text_a, text_b):
            contradiction_type = "semantic_opposition"
            suggestion = "New content uses opposite terms from existing atom; review for accuracy."

        if contradiction_type:
            contradictions.append({
                "atom_a": {
                    "id": new_atom["id"],
                    "content": new_atom["content"],
                    "created_at": new_atom["created_at"],
                },
                "atom_b": {
                    "id": existing["id"],
                    "content": existing["content"],
                    "created_at": existing["created_at"],
                },
                "similarity": round(sim, 4),
                "contradiction_type": contradiction_type,
                "suggestion": suggestion,
            })

    return contradictions
