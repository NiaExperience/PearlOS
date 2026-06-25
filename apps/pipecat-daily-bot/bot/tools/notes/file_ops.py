"""File-based note operations.

Notes are stored as .md files in /workspace/user/<tenantId>/<userId>/Documents/.
This module provides low-level read/write operations used by the CRUD tools.
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

USER_ROOT = Path(os.getenv("PEARLOS_USER_ROOT", "/workspace/user"))
_SAFE_ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$')
_SAFE_SCOPE_RE = re.compile(r'^[A-Za-z0-9_-]{1,128}$')


def _safe_scope_id(value: str | None, label: str) -> str:
    candidate = str(value or "").strip()
    if not _SAFE_SCOPE_RE.fullmatch(candidate):
        raise ValueError(f"valid {label} is required for file-backed notes")
    return candidate


def _get_documents_dir(tenant_id: str | None = None, user_id: str | None = None) -> Path:
    """Resolve the tenant-scoped per-user Documents directory."""
    tenant = _safe_scope_id(tenant_id, "tenant_id")
    user = _safe_scope_id(user_id, "user_id")
    return USER_ROOT / tenant / user / "Documents"


def _legacy_documents_dir(user_id: str | None = None) -> Path:
    """Old pre-tenant note location, used only as a read compatibility fallback."""
    user = _safe_scope_id(user_id, "user_id")
    return USER_ROOT / user / "Documents"


def _ensure_dir(documents_dir: Path):
    documents_dir.mkdir(parents=True, exist_ok=True)


def _sanitize_filename(name: str) -> str:
    """Convert a title to a safe filename (without extension)."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)
    cleaned = re.sub(r'\s+', '-', cleaned).strip('-')
    cleaned = re.sub(r'-+', '-', cleaned)
    return cleaned[:200] or f"note-{int(time.time())}"


def _safe_note_id(note_id: str) -> str:
    """Validate a note id before using it as a filename stem."""
    candidate = str(note_id or "").strip()
    if not _SAFE_ID_RE.fullmatch(candidate) or "/" in candidate or "\\" in candidate or ".." in candidate.split("."):
        raise ValueError("invalid note id")
    return candidate


def _note_path(documents_dir: Path, note_id: str) -> Path:
    safe_id = _safe_note_id(note_id)
    root = documents_dir.resolve()
    path = (documents_dir / f"{safe_id}.md").resolve()
    if path.parent != root:
        raise ValueError("invalid note path")
    return path


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


def list_notes(tenant_id: str | None = None, user_id: str | None = None) -> list[dict[str, Any]]:
    """List all .md notes in the user's tenant-scoped Documents dir."""
    documents_dir = _get_documents_dir(tenant_id, user_id)
    _ensure_dir(documents_dir)
    notes = []
    for f in sorted(documents_dir.glob("*.md")):
        try:
            notes.append(_file_to_note(f))
        except Exception:
            continue
    return notes


def get_note(note_id: str, tenant_id: str | None = None, user_id: str | None = None) -> dict[str, Any] | None:
    """Get a note by its ID (filename without .md)."""
    documents_dir = _get_documents_dir(tenant_id, user_id)
    _ensure_dir(documents_dir)
    filepath = _note_path(documents_dir, note_id)
    if not filepath.exists():
        legacy_path = _note_path(_legacy_documents_dir(user_id), note_id)
        if not legacy_path.exists():
            return None
        return _file_to_note(legacy_path)
    return _file_to_note(filepath)


def create_note(title: str, content: str = "", tenant_id: str | None = None, user_id: str | None = None) -> dict[str, Any]:
    """Create a new .md note. Returns the note dict."""
    documents_dir = _get_documents_dir(tenant_id, user_id)
    _ensure_dir(documents_dir)
    filename = _sanitize_filename(title)
    filepath = documents_dir / f"{filename}.md"

    # Ensure unique
    counter = 1
    while filepath.exists():
        filepath = documents_dir / f"{filename}-{counter}.md"
        counter += 1

    # Prepend title as H1 if not already present
    if not re.match(r'^#\s+', content):
        content = f"# {title}\n\n{content}"

    filepath.write_text(content, encoding="utf-8")
    return _file_to_note(filepath)


def update_note(note_id: str, content: str | None = None, title: str | None = None, tenant_id: str | None = None, user_id: str | None = None) -> dict[str, Any] | None:
    """Update a note's content and/or title. Returns updated note or None."""
    documents_dir = _get_documents_dir(tenant_id, user_id)
    _ensure_dir(documents_dir)
    filepath = _note_path(documents_dir, note_id)
    if not filepath.exists():
        return None

    if content is not None:
        filepath.write_text(content, encoding="utf-8")

    # Handle rename
    final_path = filepath
    if title is not None:
        new_filename = _sanitize_filename(title)
        if new_filename and new_filename != note_id:
            new_path = documents_dir / f"{new_filename}.md"
            if not new_path.exists():
                filepath.rename(new_path)
                final_path = new_path

    return _file_to_note(final_path)


def delete_note(note_id: str, tenant_id: str | None = None, user_id: str | None = None) -> bool:
    """Move a note to .trash. Returns True if successful."""
    documents_dir = _get_documents_dir(tenant_id, user_id)
    _ensure_dir(documents_dir)
    filepath = _note_path(documents_dir, note_id)
    if not filepath.exists():
        return False

    trash_dir = documents_dir / ".trash"
    trash_dir.mkdir(exist_ok=True)
    trash_path = trash_dir / f"{note_id}-{int(time.time())}.md"
    filepath.rename(trash_path)
    return True


def save_note_file(note_id: str, title: str, content: str, tenant_id: str | None = None, user_id: str | None = None) -> dict[str, Any]:
    """Write a DB-backed note to the user's Documents directory."""
    documents_dir = _get_documents_dir(tenant_id, user_id)
    _ensure_dir(documents_dir)
    filepath = _note_path(documents_dir, note_id)
    if not content.lstrip().startswith("#"):
        content = f"# {title}\n\n{content}"
    filepath.write_text(content, encoding="utf-8")
    return _file_to_note(filepath)


def search_notes(query: str, tenant_id: str | None = None, user_id: str | None = None) -> list[dict[str, Any]]:
    """Simple fuzzy search across note titles and content."""
    documents_dir = _get_documents_dir(tenant_id, user_id)
    _ensure_dir(documents_dir)
    query_lower = query.lower()
    results = []
    for note in list_notes(tenant_id, user_id):
        title_match = query_lower in note["title"].lower()
        content_match = query_lower in (note.get("content") or "").lower()
        if title_match or content_match:
            results.append(note)
    return results
