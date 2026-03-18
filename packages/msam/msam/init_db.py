#!/usr/bin/env python3
"""
Initialize MSAM databases.

Creates empty msam.db and msam_metrics.db with the correct schema.
Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS).

Usage:
    python -m msam.init_db
    # or
    python msam/init_db.py
"""

import sys
import os


from .config import get_config, get_data_dir
from pathlib import Path


def init_databases():
    """Create databases with empty schema."""
    cfg = get_config()
    data_dir = get_data_dir()

    print(f"Data directory: {data_dir}")

    # Initialize main database (creates atoms, access_log, corrections tables)
    print("Initializing main database...")
    from .core import get_db, run_migrations
    conn = get_db()
    conn.close()
    print("  Core schema created (atoms, access_log, corrections)")

    # Run migrations for additional tables
    result = run_migrations()
    print(f"  Migrations applied: {result['migrations_applied'] or 'already current'}")

    # Add agent_id column migration
    try:
        conn = get_db()
        # Check if column exists
        cols = [row[1] for row in conn.execute("PRAGMA table_info(atoms)").fetchall()]
        if "agent_id" not in cols:
            conn.execute("ALTER TABLE atoms ADD COLUMN agent_id TEXT DEFAULT 'default'")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_atoms_agent ON atoms(agent_id)")
            conn.commit()
            print("  Added agent_id column to atoms table")
        conn.close()
    except Exception as e:
        print(f"  Agent migration note: {e}")

    # Initialize triples schema
    from .triples import init_triples_schema
    init_triples_schema()
    print("  Triples schema initialized")

    # Initialize metrics database
    print("\nInitializing metrics database...")
    from .metrics import get_metrics_db, METRICS_SCHEMA
    conn = get_metrics_db()
    conn.close()
    print("  Metrics schema created")

    # Initialize sentence cache (for Shannon compression)
    try:
        from .subatom import _ensure_sentence_table as _ensure_cache_table
        from .core import get_db as _gdb
        c = _gdb()
        _ensure_cache_table(c)
        c.close()
        print("  Sentence cache table initialized")
    except Exception:
        pass  # subatom may not exist in minimal installs

    print(f"\nDone. MSAM is ready.")
    print(f"  Store:    msam store \"Your first memory\"")
    print(f"  Retrieve: msam query \"What do I know?\"")
    print(f"  Help:     msam help")


if __name__ == "__main__":
    init_databases()
