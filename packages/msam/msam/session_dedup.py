"""Session-scoped retrieval deduplication.

Tracks atom IDs already served this session. On subsequent retrievals,
demotes (not removes) previously-served atoms so new information surfaces.

Uses a file-based approach since sessions don't persist in memory.
Session files are stored in the system temp directory.
"""

import json
import os
import time
import tempfile

SESSION_DIR = tempfile.gettempdir()

def _session_file():
    """Get session file path. Uses parent PID to share across subprocesses."""
    # Use a time-windowed approach: same hour = same session
    hour_key = time.strftime("%Y%m%d%H")
    return os.path.join(SESSION_DIR, f"msam_session_{hour_key}.json")

def get_served_ids() -> set:
    """Get atom IDs already served this session."""
    path = _session_file()
    try:
        with open(path) as f:
            data = json.load(f)
        # Expire if older than 2 hours
        if time.time() - data.get("created", 0) > 7200:
            os.unlink(path)
            return set()
        return set(data.get("atom_ids", []))
    except (FileNotFoundError, json.JSONDecodeError):
        return set()

def record_served(atom_ids: list[str]):
    """Record that these atom IDs were served."""
    path = _session_file()
    existing = get_served_ids()
    existing.update(atom_ids)
    with open(path, "w") as f:
        json.dump({"atom_ids": list(existing), "created": time.time()}, f)

def clear_session():
    """Clear session tracking."""
    path = _session_file()
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
