"""File-based note operations.

Notes are stored as .md files in /workspace/user/Documents/.
This module provides low-level read/write operations used by the CRUD tools.
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

DOCUMENTS_DIR = Path("/workspace/user/Documents")


def _ensure_dir():
    DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)


def _sanitize_filename(name: str) -> str:
    """Convert a title to a safe filename (without extension)."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)
    cleaned = re.sub(r'\s+', '-', cleaned).strip('-')
    cleaned = re.sub(r'-+', '-', cleaned)
    return cleaned[:200] or f"note-{int(time.time())}"


def _file_to_note(filepath: Path) -> dict[str, Any]:
    """Read a .md file and return a note dict."""
    stat = filepath.stat()
    content = filepath.read_text(encoding="utf-8")
    basename = filepath.stem  # filename without .md

    # Extract title from first heading or use filename
    m = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
    title = m.group(1).strip() if m else basename.replace('-', ' ')

    return {
        "_id": basename,
        "title": title,
        "content": content,
        "mode": "personal",
        "filePath": str(filepath),
        "fileName": filepath.name,
        "createdAt": stat.st_ctime,
        "updatedAt": stat.st_mtime,
        "isPinned": False,
    }


def list_notes() -> list[dict[str, Any]]:
    """List all .md notes in Documents dir."""
    _ensure_dir()
    notes = []
    for f in sorted(DOCUMENTS_DIR.glob("*.md")):
        try:
            notes.append(_file_to_note(f))
        except Exception:
            continue
    return notes


def get_note(note_id: str) -> dict[str, Any] | None:
    """Get a note by its ID (filename without .md)."""
    _ensure_dir()
    filepath = DOCUMENTS_DIR / f"{note_id}.md"
    if not filepath.exists():
        return None
    return _file_to_note(filepath)


def create_note(title: str, content: str = "") -> dict[str, Any]:
    """Create a new .md note. Returns the note dict."""
    _ensure_dir()
    filename = _sanitize_filename(title)
    filepath = DOCUMENTS_DIR / f"{filename}.md"

    # Ensure unique
    counter = 1
    while filepath.exists():
        filepath = DOCUMENTS_DIR / f"{filename}-{counter}.md"
        counter += 1

    # Prepend title as H1 if not already present
    if not re.match(r'^#\s+', content):
        content = f"# {title}\n\n{content}"

    filepath.write_text(content, encoding="utf-8")
    return _file_to_note(filepath)


def update_note(note_id: str, content: str | None = None, title: str | None = None) -> dict[str, Any] | None:
    """Update a note's content and/or title. Returns updated note or None."""
    _ensure_dir()
    filepath = DOCUMENTS_DIR / f"{note_id}.md"
    if not filepath.exists():
        return None

    if content is not None:
        filepath.write_text(content, encoding="utf-8")

    # Handle rename
    final_path = filepath
    if title is not None:
        new_filename = _sanitize_filename(title)
        if new_filename and new_filename != note_id:
            new_path = DOCUMENTS_DIR / f"{new_filename}.md"
            if not new_path.exists():
                filepath.rename(new_path)
                final_path = new_path

    return _file_to_note(final_path)


def delete_note(note_id: str) -> bool:
    """Move a note to .trash. Returns True if successful."""
    _ensure_dir()
    filepath = DOCUMENTS_DIR / f"{note_id}.md"
    if not filepath.exists():
        return False

    trash_dir = DOCUMENTS_DIR / ".trash"
    trash_dir.mkdir(exist_ok=True)
    trash_path = trash_dir / f"{note_id}-{int(time.time())}.md"
    filepath.rename(trash_path)
    return True


def search_notes(query: str) -> list[dict[str, Any]]:
    """Simple fuzzy search across note titles and content."""
    _ensure_dir()
    query_lower = query.lower()
    results = []
    for note in list_notes():
        title_match = query_lower in note["title"].lower()
        content_match = query_lower in (note.get("content") or "").lower()
        if title_match or content_match:
            results.append(note)
    return results
