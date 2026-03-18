#!/usr/bin/env python3
"""
Entity-Role Awareness for MSAM Retrieval.

Solves the core quality problem: embeddings can't distinguish WHO an atom is ABOUT
from WHO is MENTIONED in it. "Things Agent Knows: professional performer" is ABOUT
User, not Agent -- but embedding similarity pulls it for "Agent's personality?"

Three components:
  1. about_entity tagger: classifies each atom's primary subject
  2. query intent classifier: detects who/what the query is asking ABOUT
  3. entity-aware scoring: boosts/penalizes based on match

Configure entity patterns in msam.toml [entity_roles] or override ENTITY_PATTERNS below.
"""

import re
import sqlite3
from typing import Optional
from .config import get_config

_cfg = get_config()

# --- Entity definitions ---
# Customize these for your deployment. Each entity has:
#   title_signals:   first-line patterns that strongly indicate the atom is ABOUT this entity
#   content_signals: regex patterns in body text (weighted lower)
#   negative_signals: patterns that look like this entity but are actually about another

ENTITY_PATTERNS = {
    'user': {
        'title_signals': [
            'Things Agent Knows',   # These are ABOUT the user despite mentioning agent
            'Schedule',
            'Preferences',
        ],
        'content_signals': [
            r'\b(user|User)\b',
            r'\b(profession|career|hobby|preference)\b',
        ],
        'negative_signals': [
            r'^(Who Agent Is|Core Traits|Agent Identity)',
        ],
    },
    'agent': {
        'title_signals': [
            'Agent Identity',
            'Core Traits',
            'Values',
        ],
        'content_signals': [
            r'\b(agent|Agent)\b.*\b(is|was|has|thinks)\b',
            r'\b(personality|identity|voice|traits)\b',
        ],
        'negative_signals': [
            r'^Things Agent Knows',  # About user despite the name
        ],
    },
    'system': {
        'title_signals': [
            'Infrastructure',
            'Configuration',
        ],
        'content_signals': [
            r'\b(MSAM|retrieval|atoms|embedding|pipeline)\b',
            r'\b(server|gateway|config|infrastructure)\b',
            r'\b(model routing|sub-agent|worker)\b',
        ],
        'negative_signals': [],
    },
    'relationship': {
        'title_signals': [
            'Shared References',
        ],
        'content_signals': [
            r'\b(partner|together|trust|relationship|bond)\b',
        ],
        'negative_signals': [],
    },
}

# Query intent patterns: what entity is the query asking ABOUT?
QUERY_INTENT_PATTERNS = {
    'user': [
        r"\b(user|User)\b.*\b(profession|job|career|work|birthday|age|schedule)\b",
        r"\b(user|User)\b.*\b(is|like|prefer|watch)\b",
        r"\bwho is (the user|User)\b",
        r"\b(user's|User's)\b",
        r"\bwhat does (the user|User)\b",
    ],
    'agent': [
        r"\b(agent|Agent)\b.*\b(personalit|trait|identity|voice|value)\b",
        r"\bwho is (the agent|Agent)\b",
        r"\b(agent's|Agent's)\b.*\b(personalit|trait|identity)\b",
        r"\bwhat is (the agent|Agent)\b",
    ],
    'agent_internal': [
        r"\b(emotional|emotion|feelings|mood|boundar)\b",
        r"\b(agent's?) (state|mood|feelings)\b",
    ],
    'system': [
        r"\b(MSAM|memory system|retrieval|pipeline)\b",
        r"\b(server|system|infrastructure|config)\b",
        r"\bhow does .* work\b",
    ],
    'temporal': [
        r"\b(today|yesterday|recent|latest|this week|last week|earlier|just now)\b",
        r"\bwhat happened\b",
    ],
}


def classify_about_entity(content: str) -> tuple[str, float]:
    """
    Classify what entity an atom is primarily ABOUT.
    Returns (entity_name, confidence).
    """
    first_line = content.split('\n')[0].strip()
    
    scores = {}
    
    for entity, patterns in ENTITY_PATTERNS.items():
        score = 0.0
        
        # Title signal match (strong)
        for title_sig in patterns['title_signals']:
            if title_sig.lower() in first_line.lower():
                score += 3.0
                break
        
        # Negative signal (disqualify)
        negated = False
        for neg in patterns['negative_signals']:
            if re.search(neg, first_line, re.IGNORECASE):
                score -= 5.0
                negated = True
                break
        
        if not negated:
            # Content signal matches
            for sig in patterns['content_signals']:
                matches = len(re.findall(sig, content, re.IGNORECASE))
                if matches:
                    score += min(matches * 0.5, 2.0)
        
        scores[entity] = score
    
    # Pick highest
    best = max(scores, key=scores.get)
    best_score = scores[best]
    
    if best_score <= 0:
        return ('unknown', 0.0)
    
    # Confidence: how much better is best vs second-best?
    sorted_scores = sorted(scores.values(), reverse=True)
    gap = sorted_scores[0] - sorted_scores[1] if len(sorted_scores) > 1 else sorted_scores[0]
    confidence = min(gap / 5.0 + 0.5, 1.0)
    
    return (best, round(confidence, 2))


def classify_query_intent(query: str) -> tuple[str, float]:
    """
    Classify what entity a query is asking ABOUT.
    Returns (target_entity, confidence).
    """
    scores = {}
    for entity, patterns in QUERY_INTENT_PATTERNS.items():
        score = 0.0
        for pat in patterns:
            if re.search(pat, query, re.IGNORECASE):
                score += 1.0
        scores[entity] = score
    
    best = max(scores, key=scores.get)
    if scores[best] <= 0:
        return ('unknown', 0.0)
    
    total = sum(scores.values())
    confidence = scores[best] / total if total > 0 else 0.0
    
    return (best, round(confidence, 2))


def entity_score_adjustment(atom_entity: str, query_entity: str, confidence: float) -> float:
    """
    Returns a multiplier for atom scoring based on entity match.
    
    Match: boost (1.0 + bonus)
    Mismatch with high confidence: penalize
    Unknown: neutral
    """
    if query_entity == 'unknown' or atom_entity == 'unknown':
        return 1.0
    
    if query_entity in ('temporal', 'agent_internal'):
        return 1.0
    
    if atom_entity == query_entity:
        return 1.0 + (0.8 * confidence)
    
    # Related entities get mild penalty
    related = {
        ('user', 'relationship'), ('agent', 'relationship'),
        ('user', 'agent'), ('agent', 'user'),
    }
    if (atom_entity, query_entity) in related or (query_entity, atom_entity) in related:
        return 1.0 - (0.15 * confidence)
    
    # Clear mismatch
    return 1.0 - (0.5 * confidence)


def tag_all_atoms():
    """Pre-compute about_entity for all active atoms. Store in DB."""
    from .core import get_db
    conn = get_db()
    
    for col in ['about_entity', 'entity_confidence']:
        try:
            conn.execute(f"ALTER TABLE atoms ADD COLUMN {col} TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass
    
    atoms = conn.execute("SELECT id, content FROM atoms WHERE state = 'active'").fetchall()
    
    counts = {}
    for atom_id, content in atoms:
        entity, confidence = classify_about_entity(content)
        conn.execute(
            "UPDATE atoms SET about_entity = ?, entity_confidence = ? WHERE id = ?",
            (entity, str(confidence), atom_id)
        )
        counts[entity] = counts.get(entity, 0) + 1
    
    conn.commit()
    
    print(f"Tagged {len(atoms)} atoms:")
    for entity, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {entity}: {count}")
    
    return counts


# --- CLI ---

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python entity_roles.py tag          # Tag all atoms")
        print("  python entity_roles.py test-query   # Test query intent")
        print("  python entity_roles.py show <entity> # Show atoms for entity")
        sys.exit(0)
    
    cmd = sys.argv[1]
    
    if cmd == "tag":
        tag_all_atoms()
    
    elif cmd == "test-query":
        queries = [
            "Who is the user?",
            "What is the agent's personality?",
            "How does model routing work?",
            "What happened today?",
            "What is the user's profession?",
            "Security rules for the system",
            "Emotional state and boundaries",
        ]
        for q in queries:
            entity, conf = classify_query_intent(q)
            print(f"  [{entity:12s} {conf:.1f}] {q}")
    
    elif cmd == "show":
        entity = sys.argv[2] if len(sys.argv) > 2 else "user"
        from .core import get_db
        conn = get_db()
        rows = conn.execute(
            "SELECT id, about_entity, content FROM atoms WHERE state='active' AND about_entity = ?",
            (entity,)
        ).fetchall()
        print(f"Atoms about '{entity}': {len(rows)}")
        for r in rows:
            print(f"  {r[0][:8]}: {r[2][:80]}")
