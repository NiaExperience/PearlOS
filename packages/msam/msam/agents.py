"""
MSAM Multi-Agent Memory Management

Agent isolation and sharing for memory atoms.
Each agent gets its own namespace of atoms, with explicit sharing between agents.

Usage:
    from msam.agents import register_agent, share_atom, agent_stats
    register_agent("agent-1", name="Research Agent")
    share_atom(atom_id, from_agent="agent-1", to_agent="agent-2")
    stats = agent_stats("agent-1")
"""

import json
import hashlib
from datetime import datetime, timezone

from .core import get_db
from .config import get_config

_cfg = get_config()

# ─── Schema ───────────────────────────────────────────────────────

AGENTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT NOT NULL,
    metadata TEXT
);
"""


# ─── Internal Helpers ─────────────────────────────────────────────

def _ensure_agents_table(conn=None):
    """Create agents table if not exists."""
    close = False
    if conn is None:
        conn = get_db()
        close = True
    conn.executescript(AGENTS_SCHEMA)
    if close:
        conn.commit()
        conn.close()


# ─── Agent Registration ──────────────────────────────────────────

def register_agent(agent_id: str, name: str = None, metadata: dict = None) -> dict:
    """Register a new agent. Returns agent info dict.
    If agent already exists, returns existing info.

    Args:
        agent_id: Unique identifier for the agent.
        name: Human-readable name (defaults to agent_id).
        metadata: Optional dict of agent metadata.

    Returns:
        Dict with id, name, created_at, metadata, already_existed.
    """
    conn = get_db()
    _ensure_agents_table(conn)

    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT OR IGNORE INTO agents (id, name, created_at, metadata) VALUES (?, ?, ?, ?)",
        (agent_id, name or agent_id, now, json.dumps(metadata or {})),
    )

    if cursor.rowcount == 0:
        # Already existed -- fetch and return existing record
        existing = conn.execute(
            "SELECT * FROM agents WHERE id = ?", (agent_id,)
        ).fetchone()
        conn.close()
        return {
            "id": existing["id"],
            "name": existing["name"],
            "created_at": existing["created_at"],
            "metadata": json.loads(existing["metadata"] or "{}"),
            "already_existed": True,
        }

    conn.commit()
    conn.close()
    return {
        "id": agent_id,
        "name": name or agent_id,
        "created_at": now,
        "metadata": metadata or {},
        "already_existed": False,
    }


def list_agents() -> list[dict]:
    """List all registered agents.

    Returns:
        List of agent info dicts, ordered by creation time.
    """
    conn = get_db()
    _ensure_agents_table(conn)
    rows = conn.execute("SELECT * FROM agents ORDER BY created_at").fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "created_at": r["created_at"],
            "metadata": json.loads(r["metadata"] or "{}"),
        }
        for r in rows
    ]


# ─── Atom Sharing ────────────────────────────────────────────────

def share_atom(atom_id: str, from_agent: str, to_agent: str) -> bool:
    """Share an atom from one agent to another by copying it.
    Creates a new atom with the target agent_id and source_type='shared'.

    Args:
        atom_id: ID of the atom to share.
        from_agent: Agent ID that owns the atom.
        to_agent: Agent ID to share the atom with.

    Returns:
        True if successful (or already shared), False if source atom not found.
    """
    conn = get_db()

    # Verify source atom exists and belongs to from_agent
    atom = conn.execute(
        "SELECT * FROM atoms WHERE id = ? AND agent_id = ?",
        (atom_id, from_agent),
    ).fetchone()
    if not atom:
        conn.close()
        return False

    # Check if already shared (same content hash for target agent)
    existing = conn.execute(
        "SELECT id FROM atoms WHERE content_hash = ? AND agent_id = ?",
        (atom["content_hash"], to_agent),
    ).fetchone()
    if existing:
        conn.close()
        return True  # Already shared

    # Create a copy for the target agent
    new_id = hashlib.sha256(
        f"{atom['content']}{to_agent}{datetime.now(timezone.utc).isoformat()}".encode()
    ).hexdigest()[:16]
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """
        INSERT INTO atoms (id, schema_version, profile, stream, content, content_hash,
                          created_at, last_accessed_at, access_count, stability, retrievability,
                          arousal, valence, topics, encoding_confidence, provisional,
                          source_type, state, embedding, metadata, agent_id)
        SELECT ?, schema_version, profile, stream, content, content_hash,
               ?, ?, 0, stability, retrievability,
               arousal, valence, topics, encoding_confidence, provisional,
               'shared', state, embedding, ?, ?
        FROM atoms WHERE id = ?
        """,
        (
            new_id,
            now,
            now,
            json.dumps({"shared_from": from_agent, "original_atom_id": atom_id}),
            to_agent,
            atom_id,
        ),
    )
    conn.commit()
    conn.close()
    return True


def get_shared_atoms(agent_id: str) -> list[dict]:
    """Get atoms shared with this agent (source_type = 'shared').

    Args:
        agent_id: Agent ID to get shared atoms for.

    Returns:
        List of shared atom dicts with id, content, stream, metadata.
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT id, content, stream, source_type, metadata FROM atoms "
        "WHERE agent_id = ? AND source_type = 'shared'",
        (agent_id,),
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "content": r["content"],
            "stream": r["stream"],
            "metadata": json.loads(r["metadata"] or "{}"),
        }
        for r in rows
    ]


# ─── Agent Statistics ────────────────────────────────────────────

def agent_stats(agent_id: str) -> dict:
    """Per-agent statistics.

    Args:
        agent_id: Agent ID to get stats for.

    Returns:
        Dict with agent_id, total_atoms, active_atoms, streams breakdown, shared_atoms.
    """
    conn = get_db()

    total = conn.execute(
        "SELECT COUNT(*) FROM atoms WHERE agent_id = ?", (agent_id,)
    ).fetchone()[0]
    active = conn.execute(
        "SELECT COUNT(*) FROM atoms WHERE agent_id = ? AND state = 'active'",
        (agent_id,),
    ).fetchone()[0]

    # Stream breakdown
    streams = {}
    for row in conn.execute(
        "SELECT stream, COUNT(*) as cnt FROM atoms WHERE agent_id = ? GROUP BY stream",
        (agent_id,),
    ).fetchall():
        streams[row["stream"]] = row["cnt"]

    # Shared atoms count
    shared = conn.execute(
        "SELECT COUNT(*) FROM atoms WHERE agent_id = ? AND source_type = 'shared'",
        (agent_id,),
    ).fetchone()[0]

    conn.close()
    return {
        "agent_id": agent_id,
        "total_atoms": total,
        "active_atoms": active,
        "streams": streams,
        "shared_atoms": shared,
    }
