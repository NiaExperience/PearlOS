"""
MSAM Triples -- Knowledge Graph Triple Layer
Extracts, stores, and retrieves factual triples from atoms.

Architecture:
  - Triples stored in same SQLite DB as atoms
  - Extraction via LLM (async, at store time or batch)
  - Hybrid retrieval: triples for facts, atoms for context
  - Full metrics logging for Grafana
"""

import sqlite3
import json
import os
import time
import re
import hashlib
from datetime import datetime, timezone
from pathlib import Path

from .config import get_config as _get_config, get_data_dir as _get_data_dir
_cfg = _get_config()
DB_PATH = _get_data_dir() / _cfg('storage', 'db_path', 'msam.db')

# ─── Schema ───────────────────────────────────────────────────────

TRIPLES_SCHEMA = """
CREATE TABLE IF NOT EXISTS triples (
    id TEXT PRIMARY KEY,
    atom_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    state TEXT CHECK(state IN ('active', 'tombstone')) DEFAULT 'active',
    embedding BLOB,
    created_at TEXT NOT NULL,
    FOREIGN KEY (atom_id) REFERENCES atoms(id)
);

CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
CREATE INDEX IF NOT EXISTS idx_triples_atom ON triples(atom_id);
CREATE INDEX IF NOT EXISTS idx_triples_state ON triples(state);
"""

# ─── Query Classification ────────────────────────────────────────

FACTUAL_SIGNALS = {
    'what', 'which', 'who', 'when', 'where', 'how many', 'how much',
    'rating', 'rate', 'score', 'name', 'list', 'time', 'date',
    'profession', 'job', 'age', 'genre', 'show', 'movie', 'anime',
    'music', 'song', 'track', 'schedule', 'address', 'number',
}

CONTEXTUAL_SIGNALS = {
    'why', 'how does', 'what does it mean', 'relationship', 'feel',
    'emotion', 'think', 'believe', 'value', 'identity', 'who is',
    'personality', 'philosophy', 'meaning', 'important', 'matter',
    'growth', 'evolve', 'change', 'improve', 'learn',
}


def classify_query(query: str) -> tuple[str, float]:
    """Classify query as factual or contextual. Returns (type, triple_ratio).
    
    factual queries get more triples (0.7 ratio)
    contextual queries get more atoms (0.15 ratio)
    mixed queries get balanced (0.4 ratio)
    """
    q_lower = query.lower()
    
    factual_score = sum(1 for s in FACTUAL_SIGNALS if s in q_lower)
    contextual_score = sum(1 for s in CONTEXTUAL_SIGNALS if s in q_lower)
    
    if factual_score > contextual_score:
        return "factual", 0.5   # was 0.7 -- triples were crowding out atoms
    elif contextual_score > factual_score:
        return "contextual", 0.15
    else:
        return "mixed", 0.3     # was 0.4


def init_triples_schema(conn=None):
    """Create triples table if it doesn't exist."""
    close = False
    if conn is None:
        conn = sqlite3.connect(str(DB_PATH))
        close = True
    conn.executescript(TRIPLES_SCHEMA)
    if close:
        conn.commit()
        conn.close()


def _get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    init_triples_schema(conn)
    return conn


# ─── Triple ID ────────────────────────────────────────────────────

def generate_triple_id(atom_id: str, subject: str, predicate: str, obj: str) -> str:
    raw = f"{atom_id}:{subject}:{predicate}:{obj}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ─── Storage ──────────────────────────────────────────────────────

def _triple_text(subject: str, predicate: str, obj: str) -> str:
    """Create embeddable text from a triple."""
    pred_readable = predicate.replace('_', ' ')
    return f"{subject} {pred_readable} {obj}"


def _embed_triple_safe(subject: str, predicate: str, obj: str) -> bytes:
    """Embed a triple, return packed bytes or None on failure."""
    try:
        from .core import embed_text, pack_embedding
        vec = embed_text(_triple_text(subject, predicate, obj))
        return pack_embedding(vec)
    except Exception:
        return None


def store_triple(atom_id: str, subject: str, predicate: str, obj: str,
                 confidence: float = 1.0, conn=None, embed: bool = True) -> str:
    """Store a single triple with optional embedding. Returns triple ID."""
    close = False
    if conn is None:
        conn = _get_db()
        close = True

    # Normalize for dedup: lowercase subject+predicate+object hash (atom-independent)
    norm_key = f"{subject.lower().strip()}:{predicate.lower().strip()}:{obj.lower().strip()}"
    triple_id = hashlib.sha256(norm_key.encode()).hexdigest()[:16]
    now = datetime.now(timezone.utc).isoformat()

    # Check if already exists (content-level dedup, not atom-level)
    existing = conn.execute("SELECT id FROM triples WHERE id = ?", (triple_id,)).fetchone()
    if existing:
        if close:
            conn.close()
        return triple_id

    embedding = _embed_triple_safe(subject, predicate, obj) if embed else None

    try:
        conn.execute("""
            INSERT OR IGNORE INTO triples (id, atom_id, subject, predicate, object, confidence, embedding, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (triple_id, atom_id, subject, predicate, obj, confidence, embedding, now))

        # Update FTS5 index
        try:
            conn.execute(
                "INSERT INTO triples_fts(rowid, subject, predicate, object) "
                "SELECT rowid, subject, predicate, object FROM triples WHERE id = ?",
                (triple_id,)
            )
        except Exception:
            pass  # FTS5 table may not exist yet (pre-migration)

        if close:
            conn.commit()
    except Exception as e:
        if close:
            conn.close()
        raise

    if close:
        conn.close()

    return triple_id


def store_triples_batch(triples: list[dict], conn=None, embed: bool = False) -> int:
    """Store multiple triples with content-level dedup.
    Each dict needs: atom_id, subject, predicate, object.
    Returns count of NEW triples stored (skips duplicates)."""
    close = False
    if conn is None:
        conn = _get_db()
        close = True

    count = 0
    now = datetime.now(timezone.utc).isoformat()
    for t in triples:
        # Content-level dedup hash
        norm_key = f"{t['subject'].lower().strip()}:{t['predicate'].lower().strip()}:{t['object'].lower().strip()}"
        triple_id = hashlib.sha256(norm_key.encode()).hexdigest()[:16]

        existing = conn.execute("SELECT id FROM triples WHERE id = ?", (triple_id,)).fetchone()
        if existing:
            continue

        embedding = _embed_triple_safe(t['subject'], t['predicate'], t['object']) if embed else None

        try:
            conn.execute("""
                INSERT OR IGNORE INTO triples (id, atom_id, subject, predicate, object, confidence, embedding, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (triple_id, t['atom_id'], t['subject'], t['predicate'],
                  t['object'], t.get('confidence', 1.0), embedding, now))
            count += 1
        except Exception:
            pass

    if close:
        conn.commit()
        conn.close()

    return count


# ─── Extraction ───────────────────────────────────────────────────

EXTRACTION_PROMPT = """Extract factual triples (subject, predicate, object) from this memory atom.

Rules:
- Subject must be a NAMED ENTITY (person, system, tool, show, place), max 30 chars
- Object must be a SHORT SPECIFIC VALUE, max 30 chars
- Predicate must be lowercase_snake_case
- Lists become multiple triples (one per item)
- If the atom is emotional/philosophical/meta-commentary with no concrete facts, respond: SKIP
- Implicit subjects: if about user's preferences, subject = "User"

Examples:
  "Daily Routine: Wake: 8:00-9:00 AM" → (User, wake_time, 8:00-9:00_AM)
  "9/10 (Great): Code Geass R2" → (Code_Geass_R2, has_rating, 9/10)
  "Genres: War films, musicals" → (User, likes_genre, war_films) + (User, likes_genre, musicals)

BAD (reject these patterns):
  Object is a full sentence → TOO LONG
  Subject is a section header → NOT AN ENTITY
  Predicate is a number or label → NOT A RELATIONSHIP

Atom content:
{content}

Output format (one per line, or SKIP):
(subject, predicate, object)"""


def extract_triples_llm(content: str, atom_id: str = "") -> list[dict]:
    """Extract triples from atom content using LLM.
    Returns list of {subject, predicate, object} dicts.
    Returns empty list if atom is skipped or extraction fails."""
    import requests

    api_key = os.environ.get("NVIDIA_NIM_API_KEY")
    if not api_key:
        return []

    prompt = EXTRACTION_PROMPT.format(content=content)

    _llm_url = _cfg('triples', 'llm_url', 'https://integrate.api.nvidia.com/v1/chat/completions')
    _llm_model = _cfg('triples', 'llm_model', 'mistralai/mistral-large-3-675b-instruct-2512')
    try:
        r = requests.post(
            _llm_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": _llm_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 500,
            },
            timeout=30,
        )
        r.raise_for_status()
        msg = r.json()["choices"][0]["message"]
        # Some models (e.g. step-3.5-flash) put answer in reasoning when content is null
        response_text = (msg.get("content") or msg.get("reasoning") or "").strip()
    except Exception:
        return []

    if "SKIP" in response_text.upper() and len(response_text) < 20:
        return []

    return _parse_triples(response_text, atom_id)


def _parse_triples(text: str, atom_id: str = "") -> list[dict]:
    """Parse LLM output into triple dicts with validation."""
    triples = []
    # Match (subject, predicate, object) pattern
    pattern = r'\(([^,]+),\s*([^,]+),\s*([^)]+)\)'
    matches = re.findall(pattern, text)

    for subj, pred, obj in matches:
        subj = subj.strip().strip('"\'')
        pred = pred.strip().strip('"\'')
        obj = obj.strip().strip('"\'')

        # Validation: reject if too long
        if len(subj) > 30 or len(obj) > 30:
            continue
        # Reject empty
        if len(subj) < 2 or len(obj) < 2 or len(pred) < 2:
            continue
        # Clean predicate to snake_case
        pred = re.sub(r'[^a-z0-9_]', '_', pred.lower()).strip('_')
        if not pred:
            continue

        triples.append({
            "atom_id": atom_id,
            "subject": subj,
            "predicate": pred,
            "object": obj,
        })

    return triples


def extract_and_store(atom_id: str, content: str) -> int:
    """Extract triples from an atom and store them. Returns count stored."""
    start = time.time()
    triples = extract_triples_llm(content, atom_id)

    if not triples:
        _log_extraction_metric(atom_id, 0, 0, (time.time() - start) * 1000, skipped=True)
        return 0

    count = store_triples_batch(triples)
    _log_extraction_metric(atom_id, len(triples), count, (time.time() - start) * 1000)
    return count


# ─── Retrieval ────────────────────────────────────────────────────

def retrieve_triples(query: str, top_k: int = 20) -> list[dict]:
    """Retrieve triples via hybrid: semantic similarity on embedded triples + keyword fallback."""
    start = time.time()
    conn = _get_db()

    results = []

    # Phase 1: Semantic search on embedded triples -- try FAISS first
    try:
        from .core import embed_query, unpack_embedding
        query_vec = embed_query(query)

        faiss_done = False
        try:
            from .vector_index import faiss_search_triples, FAISS_AVAILABLE
            if FAISS_AVAILABLE:
                candidates = faiss_search_triples(query_vec, top_k=top_k, conn=conn)
                if candidates:
                    candidate_ids = [c[0] for c in candidates]
                    sim_map = {c[0]: c[1] for c in candidates}
                    placeholders = ','.join(['?'] * len(candidate_ids))
                    rows = conn.execute(
                        f"SELECT id, atom_id, subject, predicate, object, confidence, created_at "
                        f"FROM triples WHERE id IN ({placeholders}) AND state = 'active'",
                        candidate_ids
                    ).fetchall()
                    for row in rows:
                        r = dict(row)
                        sim = sim_map.get(r['id'], 0.0)
                        r['_triple_score'] = sim * r.get('confidence', 1.0)
                        r['_similarity'] = sim
                        results.append(r)
                    results.sort(key=lambda x: x['_triple_score'], reverse=True)
                    results = results[:top_k]
                    faiss_done = True
        except Exception:
            pass

        # Fallback: brute-force cosine similarity
        if not faiss_done:
            rows = conn.execute("""
                SELECT id, atom_id, subject, predicate, object, confidence, created_at, embedding
                FROM triples WHERE state = 'active' AND embedding IS NOT NULL
            """).fetchall()

            scored = []
            for row in rows:
                r = dict(row)
                if r['embedding']:
                    try:
                        t_vec = unpack_embedding(r['embedding'])
                        dot = sum(a * b for a, b in zip(query_vec, t_vec))
                        mag_q = sum(a * a for a in query_vec) ** 0.5
                        mag_t = sum(a * a for a in t_vec) ** 0.5
                        sim = dot / (mag_q * mag_t) if mag_q and mag_t else 0
                        r['_triple_score'] = sim * r.get('confidence', 1.0)
                        r['_similarity'] = sim
                        del r['embedding']
                        scored.append(r)
                    except Exception:
                        pass

            scored.sort(key=lambda x: x['_triple_score'], reverse=True)
            results = scored[:top_k]
    except Exception:
        pass  # Fall through to keyword search

    # Phase 2: Keyword fallback -- try FTS5 first, then LIKE fallback
    if len(results) < top_k:
        seen_ids = {r['id'] for r in results}
        remaining = top_k - len(results)

        # Try FTS5 keyword search (fast path)
        fts_done = False
        try:
            from .core import _fts5_query
            fts_q = _fts5_query(query)
            fts_rows = conn.execute("""
                SELECT t.id, t.atom_id, t.subject, t.predicate, t.object, t.confidence, t.created_at,
                       bm25(triples_fts) as _bm25
                FROM triples_fts f JOIN triples t ON t.rowid = f.rowid
                WHERE triples_fts MATCH ? AND t.state = 'active'
                ORDER BY bm25(triples_fts) LIMIT ?
            """, (fts_q, remaining * 3)).fetchall()
            for row in fts_rows:
                r = dict(row)
                if r['id'] in seen_ids:
                    continue
                r['_triple_score'] = -r.pop('_bm25', 0) * 0.5 * r.get('confidence', 1.0)
                r['_similarity'] = 0.0
                results.append(r)
                seen_ids.add(r['id'])
                if len(results) >= top_k:
                    break
            fts_done = True
        except Exception:
            pass  # FTS5 table may not exist yet

        # LIKE fallback (for pre-migration DBs)
        if not fts_done and len(results) < top_k:
            terms = [t.lower() for t in query.split() if len(t) > 2]
            if terms:
                conditions = []
                params = []
                for term in terms:
                    conditions.append("(LOWER(subject) LIKE ? OR LOWER(predicate) LIKE ? OR LOWER(object) LIKE ?)")
                    params.extend([f"%{term}%", f"%{term}%", f"%{term}%"])

                sql = f"""
                    SELECT id, atom_id, subject, predicate, object, confidence, created_at
                    FROM triples
                    WHERE state = 'active' AND ({' OR '.join(conditions)})
                    LIMIT ?
                """
                params.append((top_k - len(results)) * 3)

                kw_rows = conn.execute(sql, params).fetchall()
                for row in kw_rows:
                    r = dict(row)
                    if r['id'] in seen_ids:
                        continue
                    text = f"{r['subject']} {r['predicate']} {r['object']}".lower()
                    score = sum(text.count(term) for term in terms)
                    r['_triple_score'] = score * 0.5 * r.get('confidence', 1.0)
                    r['_similarity'] = 0.0
                    results.append(r)
                    seen_ids.add(r['id'])
                    if len(results) >= top_k:
                        break

        results.sort(key=lambda x: x['_triple_score'], reverse=True)
        results = results[:top_k]

    conn.close()

    latency_ms = (time.time() - start) * 1000
    _log_retrieval_metric(query, len(results), latency_ms)

    return results


def retrieve_by_entity(entity: str, top_k: int = 50) -> list[dict]:
    """Get all triples for a specific entity (as subject or object)."""
    conn = _get_db()
    rows = conn.execute("""
        SELECT id, atom_id, subject, predicate, object, confidence, created_at
        FROM triples
        WHERE state = 'active' AND (LOWER(subject) = LOWER(?) OR LOWER(object) = LOWER(?))
        ORDER BY created_at DESC
        LIMIT ?
    """, (entity, entity, top_k)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def format_triples_for_context(triples: list[dict]) -> str:
    """Format triples as compact text for LLM context injection."""
    lines = []
    for t in triples:
        lines.append(f"({t['subject']}, {t['predicate']}, {t['object']})")
    return "\n".join(lines)


def estimate_triple_tokens(triples: list[dict]) -> int:
    """Estimate token count for a list of triples."""
    total = 0
    for t in triples:
        # Each triple: (subject, predicate, object) ≈ word count * 1.3
        words = len(t['subject'].split()) + len(t['predicate'].split()) + len(t['object'].split()) + 2
        total += int(words * 1.3)
    return total


# ─── Hybrid Retrieval (Triples + Atoms) ──────────────────────────

def hybrid_retrieve_with_triples(
    query: str,
    mode: str = "task",
    token_budget: int = 500,
    triple_ratio: float = None,
) -> dict:
    """
    Polymorphic retrieval: triples for facts, atoms for context.
    Auto-classifies query to determine triple/atom ratio.

    Returns:
        {
            "triples": [...],
            "atoms": [...],
            "triple_tokens": int,
            "atom_tokens": int,
            "total_tokens": int,
            "query_type": str,
            "latency_ms": float,
        }
    """
    from .core import hybrid_retrieve

    start = time.time()

    # Auto-classify query type and set ratio
    query_type, auto_ratio = classify_query(query)
    if triple_ratio is None:
        triple_ratio = auto_ratio

    # Phase 1: Get relevant triples
    triple_budget = int(token_budget * triple_ratio)
    triples = retrieve_triples(query, top_k=30)

    # Trim to budget
    triple_tokens = 0
    selected_triples = []
    for t in triples:
        t_tokens = estimate_triple_tokens([t])
        if triple_tokens + t_tokens > triple_budget:
            break
        selected_triples.append(t)
        triple_tokens += t_tokens

    # Phase 2: Fill remaining budget with atoms (use retrieve_v2 for entity-aware scoring)
    atom_budget_tokens = token_budget - triple_tokens
    # Estimate top_k from budget (avg atom ~44 tokens)
    atom_top_k = max(3, atom_budget_tokens // 44)
    
    from .config import get_config as _gc
    _c = _gc()
    if _c('retrieval_v2', 'enabled', True):
        from .retrieval_v2 import retrieve_v2
        atoms = retrieve_v2(query, mode=mode, top_k=atom_top_k)
    else:
        atoms = hybrid_retrieve(query, mode=mode, top_k=atom_top_k)

    # Trim atoms to budget
    atom_tokens = 0
    selected_atoms = []
    for a in atoms:
        a_tokens = len(a["content"]) // 4
        if atom_tokens + a_tokens > atom_budget_tokens:
            break
        selected_atoms.append(a)
        atom_tokens += a_tokens

    total_tokens = triple_tokens + atom_tokens
    latency_ms = (time.time() - start) * 1000

    # Log hybrid retrieval metric
    _log_hybrid_metric(query, mode, len(selected_triples), triple_tokens,
                       len(selected_atoms), atom_tokens, total_tokens, latency_ms)

    return {
        "triples": selected_triples,
        "atoms": selected_atoms,
        "_raw_atoms": atoms,  # Full atom dicts for remember.py output
        "triple_tokens": triple_tokens,
        "atom_tokens": atom_tokens,
        "total_tokens": total_tokens,
        "items_returned": len(selected_triples) + len(selected_atoms),
        "query_type": query_type,
        "triple_ratio": triple_ratio,
        "latency_ms": round(latency_ms, 2),
    }


# ─── Graph Traversal ─────────────────────────────────────────────

def graph_traverse(entity: str, max_hops: int = 3, max_results: int = 50) -> dict:
    """Multi-hop graph traversal starting from an entity.
    
    Follows relationships outward: entity -> predicate -> object -> predicate -> ...
    Returns the subgraph reachable within max_hops.
    
    Example: graph_traverse("User") might return:
      hop 0: User
      hop 1: (User, has_profession, developer), (User, works_on, ProjectX)
      hop 2: (ProjectX, has_milestone, v2_release), (developer, uses, python)
    """
    conn = _get_db()
    start = time.time()
    
    visited = set()
    frontier = {entity.lower()}
    hops = {}  # hop_number -> list of triples
    all_triples = []
    
    for hop in range(max_hops):
        if not frontier or len(all_triples) >= max_results:
            break
            
        hops[hop] = []
        next_frontier = set()
        
        for node in frontier:
            if node in visited:
                continue
            visited.add(node)
            
            # Find triples where this entity is subject OR object
            rows = conn.execute("""
                SELECT id, subject, predicate, object, confidence
                FROM triples WHERE state = 'active'
                AND (LOWER(subject) = ? OR LOWER(object) = ?)
            """, (node, node)).fetchall()
            
            for row in rows:
                triple = dict(row)
                triple['_hop'] = hop
                hops[hop].append(triple)
                all_triples.append(triple)
                
                # Add connected entities to next frontier
                next_frontier.add(triple['subject'].lower())
                next_frontier.add(triple['object'].lower())
                
                if len(all_triples) >= max_results:
                    break
        
        frontier = next_frontier - visited
    
    conn.close()
    latency_ms = (time.time() - start) * 1000
    
    # Build adjacency summary
    entities = set()
    predicates = set()
    for t in all_triples:
        entities.add(t['subject'])
        entities.add(t['object'])
        predicates.add(t['predicate'])
    
    return {
        "start_entity": entity,
        "hops": {k: [{"subject": t["subject"], "predicate": t["predicate"], 
                       "object": t["object"], "confidence": t.get("confidence", 1.0)}
                      for t in v] for k, v in hops.items()},
        "total_triples": len(all_triples),
        "unique_entities": len(entities),
        "unique_predicates": len(predicates),
        "max_hop_reached": max(hops.keys()) if hops else 0,
        "latency_ms": round(latency_ms, 2),
    }


def graph_path(entity_a: str, entity_b: str, max_hops: int = 4) -> dict:
    """Find the shortest path between two entities in the knowledge graph.
    
    BFS from entity_a toward entity_b. Returns the path if found.
    """
    conn = _get_db()
    start = time.time()
    
    # BFS
    queue = [(entity_a.lower(), [entity_a.lower()])]
    visited = {entity_a.lower()}
    path_triples = []
    found = False
    
    while queue:
        current, path = queue.pop(0)
        
        if current == entity_b.lower():
            found = True
            break
        
        if len(path) > max_hops:
            continue
        
        rows = conn.execute("""
            SELECT subject, predicate, object FROM triples
            WHERE state = 'active' AND (LOWER(subject) = ? OR LOWER(object) = ?)
        """, (current, current)).fetchall()
        
        for row in rows:
            s, p, o = row[0].lower(), row[1], row[2].lower()
            neighbor = o if s == current else s
            
            if neighbor not in visited:
                visited.add(neighbor)
                new_path = path + [neighbor]
                queue.append((neighbor, new_path))
    
    conn.close()
    latency_ms = (time.time() - start) * 1000
    
    if found:
        # Reconstruct the triple chain along the path
        conn = _get_db()
        chain = []
        for i in range(len(path) - 1):
            a, b = path[i], path[i + 1]
            row = conn.execute("""
                SELECT subject, predicate, object FROM triples
                WHERE state = 'active' 
                AND ((LOWER(subject) = ? AND LOWER(object) = ?)
                  OR (LOWER(subject) = ? AND LOWER(object) = ?))
                LIMIT 1
            """, (a, b, b, a)).fetchone()
            if row:
                chain.append({"subject": row[0], "predicate": row[1], "object": row[2]})
        conn.close()
        
        return {
            "found": True,
            "path": path,
            "chain": chain,
            "hops": len(path) - 1,
            "latency_ms": round(latency_ms, 2),
        }
    
    return {
        "found": False,
        "path": [],
        "chain": [],
        "hops": 0,
        "searched_entities": len(visited),
        "latency_ms": round(latency_ms, 2),
    }


# ─── Contradiction Detection ────────────────────────────────────

# Predicates that should have a single canonical value (latest wins)
UNIQUE_PREDICATES = {
    'has_profession', 'works_as', 'lives_in', 'has_status',
    'wake_time', 'has_schedule', 'has_threshold',
    'has_limit', 'tours_with', 'is_type',
}

# Predicates where multiple values are normal (no contradiction)
MULTI_PREDICATES = {
    'has_genre_preference', 'has_value', 'has_trait', 'has_capability',
    'has_hobby', 'likes', 'uses', 'has_rule', 'has_principle',
    'has_rating', 'watched', 'played', 'listened_to',
}


def detect_contradictions(subject: str = None, predicate: str = None,
                          new_object: str = None) -> list[dict]:
    """Detect contradictions in the knowledge graph.
    
    Two modes:
    1. Pre-write check: given (subject, predicate, new_object), check if 
       an existing triple contradicts it.
    2. Full scan: no args, scan entire graph for contradictions.
    
    Returns list of contradiction records with both sides and resolution hint.
    """
    conn = _get_db()
    contradictions = []
    
    if subject and predicate:
        # Pre-write check: does this conflict with existing knowledge?
        if predicate in MULTI_PREDICATES:
            conn.close()
            return []  # Multi-value predicates can't contradict
        
        existing = conn.execute("""
            SELECT id, subject, predicate, object, created_at, confidence
            FROM triples WHERE state = 'active'
            AND LOWER(subject) = ? AND LOWER(predicate) = ?
        """, (subject.lower(), predicate.lower())).fetchall()
        
        for row in existing:
            old = dict(row)
            if old['object'].lower().strip() != (new_object or '').lower().strip():
                contradictions.append({
                    "type": "value_conflict",
                    "subject": subject,
                    "predicate": predicate,
                    "existing_value": old['object'],
                    "new_value": new_object,
                    "existing_id": old['id'],
                    "existing_date": old['created_at'],
                    "resolution": "newer_wins" if predicate in UNIQUE_PREDICATES else "keep_both",
                })
    else:
        # Full scan: find all subjects with conflicting unique predicates
        for pred in UNIQUE_PREDICATES:
            rows = conn.execute("""
                SELECT subject, object, created_at, id FROM triples
                WHERE state = 'active' AND LOWER(predicate) = ?
                ORDER BY subject, created_at DESC
            """, (pred,)).fetchall()
            
            # Group by subject
            by_subject = {}
            for row in rows:
                subj = row[0].lower()
                if subj not in by_subject:
                    by_subject[subj] = []
                by_subject[subj].append({
                    "object": row[1], "created_at": row[2], "id": row[3]
                })
            
            for subj, values in by_subject.items():
                unique_vals = set(v['object'].lower().strip() for v in values)
                if len(unique_vals) > 1:
                    contradictions.append({
                        "type": "multi_value_on_unique_pred",
                        "subject": subj,
                        "predicate": pred,
                        "values": [{"value": v['object'], "date": v['created_at'], 
                                   "id": v['id']} for v in values],
                        "resolution": "keep_newest",
                    })
    
    conn.close()
    return contradictions


def resolve_contradictions(contradictions: list[dict], strategy: str = "newest") -> int:
    """Resolve detected contradictions by tombstoning old values.
    
    Strategies:
    - newest: keep the most recent triple, tombstone older ones
    - manual: return without changes (for human review)
    """
    if strategy == "manual":
        return 0
    
    conn = _get_db()
    resolved = 0
    
    for c in contradictions:
        if c['type'] == 'multi_value_on_unique_pred' and strategy == 'newest':
            values = sorted(c['values'], key=lambda v: v['date'], reverse=True)
            # Keep first (newest), tombstone rest
            for old in values[1:]:
                conn.execute("UPDATE triples SET state = 'tombstone' WHERE id = ?", (old['id'],))
                resolved += 1
    
    conn.commit()
    conn.close()
    return resolved


# ─── Stats ────────────────────────────────────────────────────────

def get_triple_stats() -> dict:
    """Get triple store statistics."""
    conn = _get_db()

    total = conn.execute("SELECT COUNT(*) FROM triples WHERE state='active'").fetchone()[0]
    unique_subjects = conn.execute("SELECT COUNT(DISTINCT subject) FROM triples WHERE state='active'").fetchone()[0]
    unique_predicates = conn.execute("SELECT COUNT(DISTINCT predicate) FROM triples WHERE state='active'").fetchone()[0]
    unique_objects = conn.execute("SELECT COUNT(DISTINCT object) FROM triples WHERE state='active'").fetchone()[0]

    # Top entities
    top_subjects = conn.execute("""
        SELECT subject, COUNT(*) as cnt FROM triples
        WHERE state='active' GROUP BY subject ORDER BY cnt DESC LIMIT 10
    """).fetchall()

    # Top predicates
    top_predicates = conn.execute("""
        SELECT predicate, COUNT(*) as cnt FROM triples
        WHERE state='active' GROUP BY predicate ORDER BY cnt DESC LIMIT 10
    """).fetchall()

    # Avg lengths
    avg_subj_len = conn.execute("SELECT AVG(LENGTH(subject)) FROM triples WHERE state='active'").fetchone()[0] or 0
    avg_obj_len = conn.execute("SELECT AVG(LENGTH(object)) FROM triples WHERE state='active'").fetchone()[0] or 0

    # Entity reuse rate
    entities_appearing_2plus = conn.execute("""
        SELECT COUNT(*) FROM (
            SELECT subject as entity, COUNT(*) as cnt FROM triples WHERE state='active' GROUP BY subject
            UNION ALL
            SELECT object as entity, COUNT(*) as cnt FROM triples WHERE state='active' GROUP BY object
        ) WHERE cnt >= 2
    """).fetchone()[0]

    conn.close()

    return {
        "total_triples": total,
        "unique_subjects": unique_subjects,
        "unique_predicates": unique_predicates,
        "unique_objects": unique_objects,
        "avg_subject_length": round(avg_subj_len, 1),
        "avg_object_length": round(avg_obj_len, 1),
        "entity_reuse_2plus": entities_appearing_2plus,
        "top_subjects": [{"entity": r[0], "count": r[1]} for r in top_subjects],
        "top_predicates": [{"predicate": r[0], "count": r[1]} for r in top_predicates],
    }


# ─── Metrics Logging ─────────────────────────────────────────────

METRICS_DB_PATH = _get_data_dir() / _cfg('storage', 'metrics_db_path', 'msam_metrics.db')


def _estimate_markdown_tokens():
    """Estimate cost of loading all startup markdown files (~4 chars/token)."""
    workspace = Path(__file__).parent.parent
    files = [
        "memory/MEMORY.md", "memory/context/emotional-state.md",
        "memory/context/agent-internal.md", "memory/context/relationship.md",
        "memory/context/opinions.md", "memory/context/followups.md",
        "memory/context/thinking-in-progress.md",
    ]
    total = 0
    for f in files:
        try:
            total += (workspace / f).stat().st_size
        except OSError:
            pass
    return total // 4

TRIPLE_METRICS_SCHEMA = """
CREATE TABLE IF NOT EXISTS triple_extraction_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    atom_id TEXT,
    triples_extracted INTEGER DEFAULT 0,
    triples_stored INTEGER DEFAULT 0,
    latency_ms REAL,
    skipped INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS triple_retrieval_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    query TEXT,
    triples_returned INTEGER DEFAULT 0,
    latency_ms REAL
);

CREATE TABLE IF NOT EXISTS triple_hybrid_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    query TEXT,
    mode TEXT,
    triples_count INTEGER DEFAULT 0,
    triple_tokens INTEGER DEFAULT 0,
    atoms_count INTEGER DEFAULT 0,
    atom_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    latency_ms REAL,
    efficiency_vs_atoms_pct REAL
);

CREATE TABLE IF NOT EXISTS triple_store_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    total_triples INTEGER,
    unique_subjects INTEGER,
    unique_predicates INTEGER,
    unique_objects INTEGER,
    entity_reuse_rate REAL,
    avg_subject_length REAL,
    avg_object_length REAL
);

CREATE INDEX IF NOT EXISTS idx_triple_extraction_ts ON triple_extraction_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_triple_retrieval_ts ON triple_retrieval_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_triple_hybrid_ts ON triple_hybrid_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_triple_store_ts ON triple_store_stats(timestamp);
"""


def _get_metrics_db():
    conn = sqlite3.connect(str(METRICS_DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(TRIPLE_METRICS_SCHEMA)
    return conn


def _log_extraction_metric(atom_id, extracted, stored, latency_ms, skipped=False):
    try:
        conn = _get_metrics_db()
        conn.execute("""
            INSERT INTO triple_extraction_metrics (timestamp, atom_id, triples_extracted, triples_stored, latency_ms, skipped)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (datetime.now(timezone.utc).isoformat(), atom_id, extracted, stored, latency_ms, int(skipped)))
        conn.commit()
        conn.close()
    except Exception:
        pass


def _log_retrieval_metric(query, count, latency_ms):
    try:
        conn = _get_metrics_db()
        conn.execute("""
            INSERT INTO triple_retrieval_metrics (timestamp, query, triples_returned, latency_ms)
            VALUES (?, ?, ?, ?)
        """, (datetime.now(timezone.utc).isoformat(), query, count, latency_ms))
        conn.commit()
        conn.close()
    except Exception:
        pass


def _log_hybrid_metric(query, mode, triples_count, triple_tokens,
                       atoms_count, atom_tokens, total_tokens, latency_ms):
    try:
        # Compare to atoms-only retrieval for the same item count
        # Each triple replaces ~44 tokens of atom context (production avg)
        # So atoms-only cost = (triples_replaced * 44) + atom_tokens
        atoms_only_est = (triples_count * 44) + atom_tokens
        efficiency = (1 - total_tokens / atoms_only_est) * 100 if atoms_only_est > 0 else 0

        # Also compute vs markdown baseline
        md_tokens = _estimate_markdown_tokens()
        efficiency_vs_md = (1 - total_tokens / md_tokens) * 100 if md_tokens > 0 else 0

        conn = _get_metrics_db()
        # Ensure column exists
        try:
            conn.execute("ALTER TABLE triple_hybrid_metrics ADD COLUMN efficiency_vs_md_pct REAL")
        except Exception:
            pass
        conn.execute("""
            INSERT INTO triple_hybrid_metrics
            (timestamp, query, mode, triples_count, triple_tokens, atoms_count, atom_tokens,
             total_tokens, latency_ms, efficiency_vs_atoms_pct, efficiency_vs_md_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (datetime.now(timezone.utc).isoformat(), query, mode, triples_count, triple_tokens,
              atoms_count, atom_tokens, total_tokens, latency_ms, efficiency, efficiency_vs_md))
        conn.commit()
        conn.close()
    except Exception:
        pass


def log_triple_store_snapshot():
    """Log current triple store statistics for time-series tracking."""
    try:
        stats = get_triple_stats()
        total = stats['total_triples']
        unique_ents = stats['unique_subjects'] + stats['unique_objects']
        reuse_rate = stats['entity_reuse_2plus'] / unique_ents * 100 if unique_ents > 0 else 0

        conn = _get_metrics_db()
        conn.execute("""
            INSERT INTO triple_store_stats
            (timestamp, total_triples, unique_subjects, unique_predicates, unique_objects,
             entity_reuse_rate, avg_subject_length, avg_object_length)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (datetime.now(timezone.utc).isoformat(), total,
              stats['unique_subjects'], stats['unique_predicates'], stats['unique_objects'],
              reuse_rate, stats['avg_subject_length'], stats['avg_object_length']))
        conn.commit()
        conn.close()
    except Exception:
        pass


# ─── Temporal World Model ────────────────────────────────────────


def query_world(entity=None, predicate=None, at_time=None, include_expired=False):
    """Query world model for current or historical state.

    Parameters
    ----------
    entity : str, optional
        Filter by subject entity.
    predicate : str, optional
        Filter by predicate.
    at_time : str, optional
        ISO timestamp for point-in-time query. If None, returns currently-valid triples.
    include_expired : bool
        If True, include triples whose valid_until has passed.

    Returns
    -------
    list[dict]
        Matching triples with temporal metadata.
    """
    if not _cfg('world_model', 'enabled', True):
        return []

    conn = _get_db()
    conditions = ["state = 'active'"]
    params = []

    if entity:
        conditions.append("LOWER(subject) = LOWER(?)")
        params.append(entity)

    if predicate:
        conditions.append("LOWER(predicate) = LOWER(?)")
        params.append(predicate)

    now_iso = datetime.now(timezone.utc).isoformat()

    if at_time:
        # Point-in-time query: valid_from <= at_time AND (valid_until IS NULL OR valid_until > at_time)
        conditions.append("(valid_from IS NULL OR valid_from <= ?)")
        params.append(at_time)
        conditions.append("(valid_until IS NULL OR valid_until > ?)")
        params.append(at_time)
    elif not include_expired:
        # Current state: valid_until IS NULL or in the future
        conditions.append("(valid_until IS NULL OR valid_until > ?)")
        params.append(now_iso)

    where = " AND ".join(conditions)
    rows = conn.execute(
        f"""SELECT id, atom_id, subject, predicate, object, confidence,
                   valid_from, valid_until, source_atom_id, created_at
            FROM triples WHERE {where}
            ORDER BY subject, predicate, created_at DESC""",
        params,
    ).fetchall()
    conn.close()

    return [dict(r) for r in rows]


def update_world(subject, predicate, object_val, valid_from=None, valid_until=None,
                 confidence=None, source_atom_id=None):
    """Update world model. Auto-closes existing active triple with same subject+predicate.

    Parameters
    ----------
    subject : str
    predicate : str
    object_val : str
        The new value for this subject+predicate.
    valid_from : str, optional
        ISO timestamp. Defaults to now.
    valid_until : str, optional
        ISO timestamp for when this fact expires.
    confidence : float, optional
        Confidence score. Defaults from config.
    source_atom_id : str, optional
        The atom that sourced this fact.

    Returns
    -------
    dict
        Result with new triple id, any closed triple ids.
    """
    if not _cfg('world_model', 'enabled', True):
        return {"error": "world_model disabled"}

    auto_close = _cfg('world_model', 'auto_close_on_conflict', True)
    temporal_extraction = _cfg('world_model', 'temporal_extraction', True)
    if confidence is None:
        confidence = _cfg('world_model', 'default_confidence', 1.0)

    conn = _get_db()
    # Disable FK checks for world updates that may not reference real atoms
    conn.execute("PRAGMA foreign_keys=OFF")
    now = datetime.now(timezone.utc).isoformat()

    # When temporal_extraction is disabled, strip temporal metadata
    if not temporal_extraction:
        valid_from = None
        valid_until = None
    elif valid_from is None:
        valid_from = now

    closed_ids = []

    # Auto-close existing active triples with same subject+predicate
    # (only when temporal_extraction is enabled — otherwise just overwrite)
    if auto_close and temporal_extraction:
        existing = conn.execute(
            """SELECT id FROM triples
               WHERE LOWER(subject) = LOWER(?) AND LOWER(predicate) = LOWER(?)
               AND state = 'active' AND (valid_until IS NULL OR valid_until > datetime('now'))""",
            (subject, predicate),
        ).fetchall()
        for row in existing:
            conn.execute(
                "UPDATE triples SET valid_until = ? WHERE id = ?",
                (now, row["id"]),
            )
            closed_ids.append(row["id"])

    # Insert new triple
    triple_id = generate_triple_id(source_atom_id or "world", subject, predicate, object_val)

    # Embed the triple text
    from .core import embed_text, pack_embedding
    triple_text = _triple_text(subject, predicate, object_val)
    try:
        emb = embed_text(triple_text)
        emb_blob = pack_embedding(emb)
    except Exception:
        emb_blob = None

    atom_id_val = source_atom_id or "world_update"
    conn.execute(
        """INSERT OR REPLACE INTO triples
           (id, atom_id, subject, predicate, object, confidence, state, embedding, created_at,
            valid_from, valid_until, source_atom_id)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)""",
        (triple_id, atom_id_val, subject, predicate, object_val,
         confidence, emb_blob, now, valid_from, valid_until, source_atom_id),
    )

    conn.commit()
    conn.execute("PRAGMA foreign_keys=ON")
    conn.close()

    return {
        "triple_id": triple_id,
        "subject": subject,
        "predicate": predicate,
        "object": object_val,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "closed_ids": closed_ids,
    }


def world_history(subject, predicate=None):
    """Show all values over time (including expired) for subject+predicate.

    Returns triples ordered by created_at descending (newest first).
    """
    if not _cfg('world_model', 'enabled', True):
        return []

    conn = _get_db()
    conditions = ["LOWER(subject) = LOWER(?)"]
    params = [subject]

    if predicate:
        conditions.append("LOWER(predicate) = LOWER(?)")
        params.append(predicate)

    where = " AND ".join(conditions)
    rows = conn.execute(
        f"""SELECT id, atom_id, subject, predicate, object, confidence,
                   valid_from, valid_until, source_atom_id, state, created_at
            FROM triples WHERE {where}
            ORDER BY predicate, created_at DESC""",
        params,
    ).fetchall()
    conn.close()

    return [dict(r) for r in rows]
