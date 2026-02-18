"""OpenClaw ↔ PearlOS Mesh Bridge — push files and content into the Notes system.

Provides async functions to create, read, update, and delete Notes via the
Mesh REST API.  Designed to be called from OpenClaw tool handlers.

Environment:
    MESH_API_ENDPOINT   — Base URL (default: http://localhost:2000/api)
    MESH_SHARED_SECRET  — Service secret for x-mesh-secret header
"""
from __future__ import annotations

import base64
import logging
import mimetypes
import os
from pathlib import Path
from typing import Any, Optional

import aiohttp

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "http://localhost:2000/api"
TENANT = os.getenv("PEARLOS_TENANT_ID", "00000000-0000-0000-0000-000000000001")
ANONYMOUS_USER_ID = "00000000-0000-0000-0000-000000000099"
TIMEOUT = aiohttp.ClientTimeout(total=15)

TEXT_EXTENSIONS = {
    ".md", ".txt", ".py", ".json", ".yaml", ".yml", ".csv",
    ".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".scss",
    ".sh", ".bash", ".zsh", ".toml", ".ini", ".cfg", ".conf",
    ".xml", ".sql", ".rs", ".go", ".java", ".kt", ".c", ".cpp",
    ".h", ".hpp", ".rb", ".lua", ".r", ".swift", ".dockerfile",
    ".env", ".gitignore", ".makefile",
}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
VIDEO_EXTENSIONS = {".mov", ".mp4", ".webm"}

# Map extensions → markdown language hints
_LANG_MAP = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".tsx": "tsx", ".jsx": "jsx", ".json": "json", ".yaml": "yaml",
    ".yml": "yaml", ".html": "html", ".css": "css", ".scss": "scss",
    ".sh": "bash", ".bash": "bash", ".zsh": "zsh", ".sql": "sql",
    ".rs": "rust", ".go": "go", ".java": "java", ".kt": "kotlin",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".rb": "ruby", ".lua": "lua", ".r": "r", ".swift": "swift",
    ".toml": "toml", ".xml": "xml", ".md": "markdown",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base_url() -> str:
    return (os.getenv("MESH_API_ENDPOINT") or DEFAULT_BASE_URL).rstrip("/")


def _secret() -> str:
    s = os.getenv("MESH_SHARED_SECRET", "")
    if not s:
        raise RuntimeError("MESH_SHARED_SECRET not set")
    return s.strip()


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-mesh-secret": _secret(),
    }


def _url(path: str = "", note_id: str | None = None) -> str:
    base = f"{_base_url()}/content/Notes"
    if note_id:
        base = f"{base}/{note_id}"
    return f"{base}?tenant={TENANT}"


def _file_to_markdown(file_path: Path) -> str:
    """Convert a file to nicely-formatted markdown content."""
    ext = file_path.suffix.lower()

    # --- Text files ---
    if ext in TEXT_EXTENSIONS or ext == "":
        text = file_path.read_text(errors="replace")
        lang = _LANG_MAP.get(ext, "")
        if ext == ".md":
            return text  # Already markdown
        return f"```{lang}\n{text}\n```"

    # --- Images ---
    if ext in IMAGE_EXTENSIONS:
        data = file_path.read_bytes()
        mime = mimetypes.guess_type(file_path.name)[0] or "image/png"
        b64 = base64.b64encode(data).decode()
        return f"![{file_path.name}](data:{mime};base64,{b64})"

    # --- Videos ---
    if ext in VIDEO_EXTENSIONS:
        # Point to a local-served URL; caller can override if needed
        return (
            f'<video controls width="100%" preload="metadata">\n'
            f'  <source src="/files/{file_path.name}" type="video/{ext.lstrip(".")}">\n'
            f"  Your browser does not support the video tag.\n"
            f"</video>"
        )

    # --- Fallback: treat as text ---
    try:
        text = file_path.read_text(errors="replace")
        return f"```\n{text}\n```"
    except Exception:
        return f"*Binary file: {file_path.name}*"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def push_file_to_notes(
    file_path: str | Path,
    title: Optional[str] = None,
    mode: str = "work",
) -> dict[str, Any]:
    """Read a file from disk and create a Note with its contents.

    Returns the created note's JSON response from Mesh.
    """
    p = Path(file_path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {p}")

    content_md = _file_to_markdown(p)
    note_title = title or p.name
    return await push_content_to_notes(note_title, content_md, mode=mode)


async def push_content_to_notes(
    title: str,
    content: str,
    mode: str = "work",
) -> dict[str, Any]:
    """Create a Note with arbitrary markdown content."""
    payload = {
        "content": {
            "userId": ANONYMOUS_USER_ID,
            "title": title,
            "content": content,
            "mode": mode,
            "tenantId": TENANT,
        }
    }
    async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
        async with session.post(_url(), headers=_headers(), json=payload) as resp:
            body = await resp.json()
            if resp.status >= 400:
                logger.error("push_content_to_notes failed: %s %s", resp.status, body)
                raise RuntimeError(f"Mesh API error {resp.status}: {body}")
            logger.info("Created note: %s", body.get("id", "?"))
            return body


async def update_note_content(
    note_id: str,
    content: str,
    title: Optional[str] = None,
) -> dict[str, Any]:
    """Update an existing note's content (and optionally title)."""
    fields: dict[str, Any] = {"content": content}
    if title is not None:
        fields["title"] = title

    payload = {"content": fields}
    async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
        async with session.patch(
            _url(note_id=note_id), headers=_headers(), json=payload
        ) as resp:
            body = await resp.json()
            if resp.status >= 400:
                logger.error("update_note_content failed: %s %s", resp.status, body)
                raise RuntimeError(f"Mesh API error {resp.status}: {body}")
            logger.info("Updated note %s", note_id)
            return body


async def list_notes() -> list[dict[str, Any]]:
    """List all Notes for the tenant."""
    async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
        async with session.get(_url(), headers=_headers()) as resp:
            body = await resp.json()
            if resp.status >= 400:
                logger.error("list_notes failed: %s %s", resp.status, body)
                raise RuntimeError(f"Mesh API error {resp.status}: {body}")
            # Mesh typically wraps in {"items": [...]} or returns a list
            if isinstance(body, list):
                return body
            return body.get("items", body.get("data", [body]))


async def delete_note(note_id: str) -> bool:
    """Delete a note by ID. Returns True on success."""
    async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
        async with session.delete(
            _url(note_id=note_id), headers=_headers()
        ) as resp:
            if resp.status >= 400:
                body = await resp.text()
                logger.error("delete_note failed: %s %s", resp.status, body)
                raise RuntimeError(f"Mesh API error {resp.status}: {body}")
            logger.info("Deleted note %s", note_id)
            return True
