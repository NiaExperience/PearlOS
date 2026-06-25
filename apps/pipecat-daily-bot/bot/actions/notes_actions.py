"""Note management business logic.

This module handles all note-related operations including:
- CRUD operations (create, read, update, delete)
- Fuzzy search by title
- List filtering by mode (personal/work)
- Content manipulation (append, update, etc.)

All functions are tenant-scoped for security.

Architecture:
- Builds Mesh API queries (where clauses, params)
- Calls mesh_client.request() for HTTP execution
- Validates responses and transforms data
- Returns business objects
"""

import json
import logging
from pathlib import Path
from typing import Optional, Callable, Awaitable, TypeVar
from tools.sharing import utils as sharing_tools
from actions import sharing_actions
from loguru import logger
from difflib import SequenceMatcher
import sys
import os
import re

# Add parent directory to path for mesh_client import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Type variable for ensure wrapper return type
T = TypeVar('T')

_UUID_PATTERN = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
_LOCAL_ANON_USER_UUID = "00000000-0000-0000-0000-000000000099"
USER_ROOT = Path(os.getenv("PEARLOS_USER_ROOT", "/workspace/user"))
_SAFE_SCOPE_RE = re.compile(r'^[A-Za-z0-9_-]{1,128}$')

def _normalize_user_id(user_id: str) -> str:
    """Normalize user identifiers to UUIDs for storage layer compatibility.

    In local dev, some flows provide user_id="anonymous" (Daily userId). Mesh/Prism
    expects UUIDs in several places, so we map the anonymous local user to a stable UUID.
    """
    if not user_id:
        return user_id
    if _UUID_PATTERN.match(user_id):
        return user_id
    if user_id.lower() == "anonymous":
        return _LOCAL_ANON_USER_UUID
    return user_id


def _documents_dir(tenant_id: str, user_id: str) -> Path | None:
    """Resolve the tenant-scoped Documents folder for filesystem notes."""
    if not _SAFE_SCOPE_RE.fullmatch(str(tenant_id or "")):
        return None
    if not _SAFE_SCOPE_RE.fullmatch(str(user_id or "")):
        return None
    return USER_ROOT / str(tenant_id) / str(user_id) / "Documents"


def _legacy_documents_dir(user_id: str) -> Path | None:
    """Old pre-tenant note location, used only as a read compatibility fallback."""
    if not _SAFE_SCOPE_RE.fullmatch(str(user_id or "")):
        return None
    return USER_ROOT / str(user_id) / "Documents"


def _extract_note_content(note: dict) -> str:
    """Extract content string from note, handling both string and dict formats.
    
    Note content may be stored as:
    - A string: "content text"
    - A dict: {"type": "...", "content": "content text"}
    
    Args:
        note: Note dictionary
        
    Returns:
        Content as string, empty string if not found or invalid
    """
    note_content = note.get("content", "")
    if isinstance(note_content, dict):
        return note_content.get("content", "") or ""
    return str(note_content) if note_content else ""


async def create_notes_definition(tenant_id: str) -> bool:
    """Create the Notes content definition in Mesh for this tenant.
    
    Args:
        tenant_id: Tenant identifier for scoping the definition
        
    Returns:
        True if definition was created successfully, False otherwise
    """
    try:
        from nia_content_definitions import register_content_definition, NOTES_DEFINITION
        
        mesh_url = os.getenv("MESH_API_ENDPOINT", "").strip().rstrip("/")
        if not mesh_url:
            logger.error("[notes_actions] MESH_API_ENDPOINT not set, cannot create definition")
            return False
        
        mesh_secret = os.getenv("MESH_SHARED_SECRET")
        
        success = register_content_definition(
            definition=NOTES_DEFINITION,
            mesh_url=mesh_url,
            tenant=tenant_id,
            mesh_secret=mesh_secret
        )
        
        if success:
            logger.info(f"[notes_actions] Created Notes definition for tenant {tenant_id}")
        else:
            logger.error(f"[notes_actions] Failed to create Notes definition for tenant {tenant_id}")
        
        return success
        
    except ImportError as e:
        logger.error(f"[notes_actions] Cannot import nia_content_definitions: {e}")
        return False
    except Exception as e:
        logger.error(f"[notes_actions] Failed to create Notes definition: {e}", exc_info=True)
        return False


async def ensure_notes_definition(
    operation: Callable[[], Awaitable[T]],
    tenant_id: str
) -> T:
    """Ensure Notes definition exists before executing an operation.
    
    If the operation fails due to missing definition, creates the definition
    and retries the operation once.
    
    Args:
        operation: Async function to execute that requires the Notes definition
        tenant_id: Tenant identifier for creating the definition if needed
        
    Returns:
        Result of the operation
        
    Raises:
        Exception: If the operation fails even after ensuring definition exists
    """
    try:
        result = await operation()
        return result
    except Exception as e:
        error_msg = str(e)
        # Check if the error is due to missing content definition
        # The error can come in various formats from mesh_client
        is_missing_definition = (
            'Content definition for type "Notes" not found' in error_msg or
            'CONTENT_CREATE_ERR' in error_msg or
            '"Notes" not found' in error_msg
        )
        
        if is_missing_definition:
            logger.warning(
                f"[notes_actions] Notes definition not found for tenant {tenant_id}, creating it..."
            )
            
            # Create the definition
            created = await create_notes_definition(tenant_id)
            
            if not created:
                logger.error("[notes_actions] Failed to create Notes definition, cannot retry operation")
                raise
            
            # Retry the operation
            logger.info("[notes_actions] Retrying operation after creating Notes definition")
            result = await operation()
            return result
        else:
            # Not a definition error, re-raise
            raise


async def list_notes(tenant_id: str, user_id: str, limit: int = 100, include_content: bool = False) -> list[dict]:
    """Fetch notes visible to one authenticated user.
    
    Args:
        tenant_id: Tenant identifier for data isolation
        user_id: User identifier for filtering personal notes
        limit: Maximum number of notes to return (default 100)
        include_content: If True, include full note content in results (default False for performance)
        
    Returns:
        List of note documents, sorted by updated_at descending
    """
    try:
        from services import mesh as mesh_client

        normalized_user_id = _normalize_user_id(user_id)
        if normalized_user_id != user_id:
            logger.warning(f"[notes_actions] Normalized non-UUID user_id '{user_id}' -> '{normalized_user_id}' for list_notes")
        user_id = normalized_user_id
        
        # Fetch DB-backed work, personal, and explicitly shared notes. Legacy
        # filesystem notes used to come from one global Documents folder; that
        # is intentionally not merged here because it is not user-isolated.
        import asyncio

        async def _fetch_work():
            where = {"AND": [
                {"indexer": {"path": "tenantId", "equals": tenant_id}},
                {"indexer": {"path": "mode", "equals": 'work'}}
            ]}
            p = {"tenant": tenant_id, "where": json.dumps(where, separators=(',', ':')), "limit": str(limit)}
            return await mesh_client.request("GET", "/content/Notes", params=p)

        async def _fetch_personal():
            # Fetch ALL notes owned by user (not filtered by mode) so we catch
            # legacy notes that have no mode field.  We filter out 'work' notes
            # in-memory afterwards since those are already returned by _fetch_work.
            # Query by BOTH parent_id and indexer.userId — notes created via the
            # bot set userId in the content body but may not have parent_id mapped
            # by Mesh, so we need both paths to surface all user notes.
            where_parent = {"AND": [
                {"indexer": {"path": "tenantId", "equals": tenant_id}},
                {"parent_id": {"eq": user_id}}
            ]}
            where_userid = {"AND": [
                {"indexer": {"path": "tenantId", "equals": tenant_id}},
                {"indexer": {"path": "userId", "equals": user_id}}
            ]}
            p_parent = {"tenant": tenant_id, "where": json.dumps(where_parent, separators=(',', ':')), "limit": str(limit)}
            p_userid = {"tenant": tenant_id, "where": json.dumps(where_userid, separators=(',', ':')), "limit": str(limit)}
            resp_parent, resp_userid = await asyncio.gather(
                mesh_client.request("GET", "/content/Notes", params=p_parent),
                mesh_client.request("GET", "/content/Notes", params=p_userid),
                return_exceptions=True,
            )
            # Merge results from both queries, dedup by _id
            merged = []
            seen = set()
            for resp in [resp_parent, resp_userid]:
                if isinstance(resp, Exception):
                    logger.warning(f"[notes_actions] Personal notes sub-query failed: {resp}")
                    continue
                if resp.get("success"):
                    for n in resp.get("data", []):
                        nid = n.get("_id")
                        if nid and nid not in seen:
                            seen.add(nid)
                            merged.append(n)
            # Filter out work-mode notes (already covered by _fetch_work)
            merged = [n for n in merged if n.get("mode") != "work"]
            return {"success": True, "data": merged}

        async def _fetch_shared():
            return await sharing_tools.get_user_shared_resources(tenant_id, user_id, content_type="Notes")

        work_resp, personal_resp, shared_resp = await asyncio.gather(
            _fetch_work(), _fetch_personal(), _fetch_shared(),
            return_exceptions=True,
        )

        notes = []

        if isinstance(work_resp, Exception):
            logger.error(f"[notes_actions] Failed to list work notes: {work_resp}")
        elif work_resp.get("success"):
            work_notes = work_resp.get("data", [])
            notes.extend(work_notes)
            logger.debug(f"[notes_actions] Listed {len(work_notes)} work notes for tenant {tenant_id}")
        else:
            logger.error(f"[notes_actions] Failed to list work notes: {work_resp.get('error')}")

        if isinstance(personal_resp, Exception):
            logger.error(f"[notes_actions] Failed to list personal notes: {personal_resp}")
        elif personal_resp.get("success"):
            personal_notes = personal_resp.get("data", [])
            notes.extend(personal_notes)
            logger.debug(f"[notes_actions] Listed {len(personal_notes)} personal notes for tenant {tenant_id}")
        else:
            logger.error(f"[notes_actions] Failed to list personal notes: {personal_resp.get('error')}")

        if isinstance(shared_resp, Exception):
            logger.error(f"[notes_actions] Failed to list shared notes: {shared_resp}")
        elif shared_resp.get("success"):
            shared_notes = shared_resp.get("resources", [])
            notes.extend(shared_notes)
            logger.debug(f"[notes_actions] Listed {len(shared_notes)} shared notes for user {user_id}")

        # iterate and create a list of note objects
        # If include_content=False, return lightweight payloads (for listing)
        # If include_content=True, return full notes with content (for fuzzy search)
        results = []
        visited = set()
        visited_titles = set()  # Track titles for dedup against file notes
        for note in notes:
            if note.get("_id") in visited:
                continue
            visited.add(note.get("_id"))
            title_key = (note.get("title") or "").strip().lower()
            visited_titles.add(title_key)
            
            if include_content:
                # Return full note with all fields including content
                results.append(note)
            else:
                # Return lightweight payload (for performance when content not needed)
                sharing_info = note.get('_sharing', {})
                # Build a short content preview so the LLM can identify notes by content
                raw_content = _extract_note_content(note)
                content_preview = raw_content[:100].strip() if raw_content else ""
                payload = {
                    "_id": note.get("_id"),
                    "title": note.get("title"),
                    "content_preview": content_preview,
                    "mode": note.get("mode"),
                    "updated_at": note.get("updated_at") or note.get("updatedAt") or note.get("created_at") or note.get("createdAt"),
                    "userId": note.get("userId"),
                    "tenantId": note.get("tenantId"),
                    "isShared": bool(sharing_info),
                    "accessLevel": sharing_info.get('role', 'owner'),
                    "isGlobal": sharing_info.get('isGlobal', False)
                }
                results.append(payload)

        # ── File-based notes (tenant + user Documents directory) ──
        # Webchat creates notes as .md files in /workspace/user/<tenantId>/<userId>/Documents/.
        # Mesh queries won't find these, so we merge them in here as a second source.
        try:
            import re as _re

            docs_dirs = [d for d in [_documents_dir(tenant_id, user_id), _legacy_documents_dir(user_id)] if d and d.is_dir()]
            for user_docs in docs_dirs:
                for f in sorted(user_docs.glob("*.md")):
                    try:
                        basename = f.stem
                        if basename in visited:
                            continue
                        stat = f.stat()
                        content = f.read_text(encoding="utf-8")
                        m = _re.search(r'^#\s+(.+)$', content, _re.MULTILINE)
                        title = m.group(1).strip() if m else basename.replace('-', ' ')
                        title_key = title.strip().lower()
                        if title_key in visited_titles:
                            continue
                        visited.add(basename)
                        visited_titles.add(title_key)

                        if include_content:
                            results.append({
                                "_id": basename,
                                "title": title,
                                "content": content,
                                "mode": "personal",
                                "userId": user_id,
                                "tenantId": tenant_id,
                                "createdAt": stat.st_ctime,
                                "updatedAt": stat.st_mtime,
                                "isShared": False,
                                "accessLevel": "owner",
                                "isGlobal": False,
                                "_source": "file",
                            })
                        else:
                            content_preview = content[:100].strip()
                            results.append({
                                "_id": basename,
                                "title": title,
                                "content_preview": content_preview,
                                "mode": "personal",
                                "updated_at": stat.st_mtime,
                                "userId": user_id,
                                "tenantId": tenant_id,
                                "isShared": False,
                                "accessLevel": "owner",
                                "isGlobal": False,
                                "_source": "file",
                            })
                    except Exception:
                        continue
        except Exception:
            pass

        logger.debug(f"[notes_actions] returning {len(results)} total notes for user scope {user_id} (mesh + file)")
        return results

    except Exception as e:
        # Log exception but don't re-raise - return empty list so caller can handle gracefully
        logger.error(f"[notes_actions] Failed to list notes: {e}", exc_info=True)
        return []


async def fuzzy_search_notes(tenant_id: str, title: str, user_id: str) -> Optional[list[dict]]:
    """Find note by fuzzy title match.
    
    Uses SequenceMatcher to find the best match for the given title.
    Returns None if no reasonable match is found (similarity < 0.6).
    
    Args:
        tenant_id: Tenant identifier
        title: Title to search for (case-insensitive)
        
    Returns:
        Best matching note or None
    """
    try:
        user_id = _normalize_user_id(user_id)
        # Fetch lightweight metadata only (no content) for fast title matching
        notes = await list_notes(tenant_id, user_id, include_content=False)
        
        if not notes:
            return None
        
        logger.debug(f"[notes_actions] Fuzzy searching for title '{title}' among {len(notes)} notes (metadata only)")
        
        # Normalize search term
        search_term = title.lower().strip()
        
        # Calculate similarity scores using only titles (no content fetched yet)
        matches = []
        for note in notes:
            note_title = note.get('title') or ''
            if note_title.lower().strip():
                similarity = SequenceMatcher(None, search_term, note_title.lower().strip()).ratio()
                matches.append((similarity, note))
        
        # Sort by similarity (descending)
        matches.sort(key=lambda x: x[0], reverse=True)
        
        if not matches:
            return None
        
        best_score, best_note = matches[0]
        runner_up_score, runner_up_note = matches[1] if len(matches) > 1 else (0, None)
        
        # Only return if similarity is reasonable
        if best_score >= 0.5:
            logger.info(
                f"[notes_actions] Fuzzy matched '{title}' to '{best_note.get('title')}' "
                f"(similarity: {best_score:.2f})"
            )
            # Now fetch full content ONLY for the matched note(s)
            matched_ids = [best_note.get('_id')]
            if runner_up_score == best_score and runner_up_note:
                logger.debug(
                    f"[notes_actions] Tie in fuzzy match for '{title}': "
                    f"'{best_note.get('title')}' and '{runner_up_note.get('title')}' "
                    f"both at {best_score:.2f}"
                )
                matched_ids.append(runner_up_note.get('_id'))

            # Fetch full content for matched notes in parallel
            import asyncio
            full_notes = await asyncio.gather(
                *[get_note_by_id(tenant_id, note_id, user_id=user_id) for note_id in matched_ids]
            )
            results = [n for n in full_notes if n is not None]
            return results if results else None

        logger.debug(
            f"[notes_actions] No fuzzy match for '{title}' "
            f"(best: '{best_note.get('title')}' at {best_score:.2f})"
        )
        return None
    except Exception:
        logging.exception("[notes_actions] Fuzzy search failed")
        return None


async def get_note_by_id(tenant_id: str, note_id: str, user_id: str | None = None) -> Optional[dict]:
    """Fetch note by ID.
    
    Args:
        tenant_id: Tenant identifier
        note_id: Note document ID (page_id)
        
    Returns:
        Note document or None
    """
    if not note_id:
        return None

    try:
        from services import mesh as mesh_client
        
        # BUILD QUERY
        clauses = [
            {"page_id": {"eq": note_id}},
            {"indexer": {"path": "tenantId", "equals": tenant_id}},
        ]
        if user_id:
            normalized_user_id = _normalize_user_id(user_id)
            clauses.append({"OR": [
                {"parent_id": {"eq": normalized_user_id}},
                {"indexer": {"path": "userId", "equals": normalized_user_id}},
                {"indexer": {"path": "mode", "equals": "work"}},
            ]})
        where = {"AND": clauses}
        params = {
            "tenant": tenant_id,
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        
        # EXECUTE REQUEST
        response = await mesh_client.request("GET", "/content/Notes", params=params)
        
        # VALIDATE & TRANSFORM
        if response.get("success"):
            data = response.get("data", [])
            if isinstance(data, list) and len(data) > 0:
                note = data[0]
                logger.info(f"[notes_actions] 📋 FOUND NOTE - note_id={note_id}, note_keys={list(note.keys())}, content_type={type(note.get('content')).__name__}, content_preview={repr(note.get('content'))[:200] if note.get('content') else 'None/Empty'}")
                return note
        
        # ── File-based fallback for get by ID ──
        # Webchat saves notes as .md files; check the tenant-scoped user's Documents directory.
        if user_id:
            import re as _re
            docs_dirs = [d for d in [_documents_dir(tenant_id, user_id), _legacy_documents_dir(user_id)] if d and d.is_dir()]
            for user_docs in docs_dirs:
                filepath = user_docs / f"{note_id}.md"
                if not filepath.exists():
                    continue
                try:
                    stat = filepath.stat()
                    content = filepath.read_text(encoding="utf-8")
                    m = _re.search(r'^#\s+(.+)$', content, _re.MULTILINE)
                    title = m.group(1).strip() if m else note_id.replace('-', ' ')
                    logger.info(f"[notes_actions] 📋 FOUND FILE NOTE - note_id={note_id}, title={title}")
                    return {
                        "_id": note_id,
                        "title": title,
                        "content": content,
                        "mode": "personal",
                        "userId": user_id,
                        "tenantId": tenant_id,
                        "createdAt": stat.st_ctime,
                        "updatedAt": stat.st_mtime,
                        "_source": "file",
                    }
                except Exception:
                    continue
        
        logger.debug(f"[notes_actions] Note {note_id} not found")
        return None
        
    except Exception as e:
        # Log exception but don't re-raise - return None so caller can handle gracefully
        logger.error(f"[notes_actions] Failed to get note by ID: {e}", exc_info=True)
        return None


async def create_note(
    tenant_id: str,
    user_id: str,
    title: str,
    content: str = "",
    mode: str = 'work'
) -> Optional[dict]:
    """Create new note.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User ID (note owner)
        title: Note title (required)
        content: Note content (default: empty string)
        mode: Note mode ('personal' or 'work', default: 'work')
        
    Returns:
        Created note document or None on failure
        
    Raises:
        ValueError: If title is empty or mode is invalid
    """
    async def _create_operation():
        from services import mesh as mesh_client
        
        # VALIDATE INPUT
        if not title or not title.strip():
            raise ValueError("Note title cannot be empty")
        
        if mode not in ('personal', 'work'):
            raise ValueError(f"Invalid mode: {mode}. Must be 'personal' or 'work'")

        normalized_user_id = _normalize_user_id(user_id)
        if normalized_user_id != user_id:
            logger.warning(f"[notes_actions] Normalized non-UUID user_id '{user_id}' -> '{normalized_user_id}' for note creation")
        
        # BUILD REQUEST BODY
        note_content = {
            "userId": normalized_user_id,
            "title": title.strip(),
            "content": content,
            "mode": mode,
            "tenantId": tenant_id,
        }
        
        payload = {"content": note_content}
        params = {"tenant": tenant_id}
        
        # EXECUTE REQUEST
        response = await mesh_client.request(
            "POST",
            "/content/Notes",
            params=params,
            json_body=payload
        )
        
        # VALIDATE & TRANSFORM
        if response.get("success"):
            note = response.get("data")
            if note:
                note_id = note.get('page_id', 'unknown')
                logger.info(f"[notes_actions] Created note '{title}' (id={note_id})")
                return note
        
        # Raise exception to trigger ensure wrapper if needed
        error_obj = response.get('error', {})
        if isinstance(error_obj, dict):
            error_msg = error_obj.get('message', str(error_obj))
        else:
            error_msg = str(error_obj)
        raise Exception(f"Mesh POST /content/Notes failed: {error_msg}")
    
    try:
        return await ensure_notes_definition(_create_operation, tenant_id)
    except Exception as e:
        # Log exception but don't re-raise - return None so caller can handle gracefully
        logger.error(f"[notes_actions] Failed to create note: {e}", exc_info=True)
        return None


async def update_note_content(
    tenant_id: str,
    note_id: str,
    content: str,
    user_id: str,
    title: Optional[str] = None
) -> bool:
    """Update note content and optionally title.
    
    Args:
        tenant_id: Tenant identifier
        note_id: Note document ID (page_id)
        content: New content
        user_id: User ID for permission check
        title: Optional new title
        
    Returns:
        True if update succeeded, False if note not found or permission denied
    """
    async def _update_operation():
        from services import mesh as mesh_client
        
        # SECURITY CHECK: Verify write permission
        user_id_norm = _normalize_user_id(user_id)
        if user_id_norm != user_id:
            logger.warning(f"[notes_actions] Normalized non-UUID user_id '{user_id}' -> '{user_id_norm}' for update_note_content")
        user_id_to_check = user_id_norm
        has_write = await sharing_actions.check_resource_write_permission(
            tenant_id=tenant_id,
            user_id=user_id_to_check,
            resource_id=note_id,
            content_type='Notes'
        )
        
        if not has_write:
            logger.warning(f"[notes_actions] User {user_id} does not have write permission for note {note_id}")
            return False

        # VALIDATE INPUT
        if title is not None and (not title or not title.strip()):
            raise ValueError("Note title cannot be empty")
        
        # PATCH performs partial update - no need to fetch first!
        # Build payload with only the fields we're updating
        update_payload = {"content": content}
        if title is not None:
            update_payload["title"] = title.strip()
            logger.info(f"[notes_actions] Updating note {note_id} title to: {title}")
        
        # BUILD REQUEST
        payload = {"content": update_payload}
        params = {"tenant": tenant_id}
        
        # EXECUTE REQUEST
        response = await mesh_client.request(
            "PATCH",
            f"/content/Notes/{note_id}",
            params=params,
            json_body=payload
        )
        
        # VALIDATE & TRANSFORM
        if response.get("success"):
            logger.info(f"[notes_actions] Updated note {note_id}")
            return True
        else:
            # Raise exception to trigger ensure wrapper if needed
            error_obj = response.get('error', {})
            if isinstance(error_obj, dict):
                error_msg = error_obj.get('message', str(error_obj))
            else:
                error_msg = str(error_obj)
            raise Exception(f"Mesh PUT /content/Notes/{note_id} failed: {error_msg}")
    try:
        return await ensure_notes_definition(_update_operation, tenant_id)
    except Exception as e:
        # Log exception but don't re-raise - return False so caller can handle gracefully
        logger.error(f"[notes_actions] Failed to update note content: {e}", exc_info=True)
        return False


async def append_to_note(tenant_id: str, note_id: str, item: str, user_id: str) -> bool:
    """Append item to note content as list item.
    
    Adds the item as a markdown list item (- item) to the end of the note.
    
    Args:
        tenant_id: Tenant identifier
        note_id: Note document ID
        item: Item to append
        user_id: User ID for permission check
        
    Returns:
        True if append succeeded, False if note not found or permission denied
    """
    try:
        # Fetch current note
        note = await get_note_by_id(tenant_id, note_id)
        if not note:
            return False
        
        current_content = _extract_note_content(note)
        
        # Append as list item
        if current_content:
            new_content = f"{current_content}\n- {item}"
        else:
            new_content = f"- {item}"
        
        # Update note (permission check happens in update_note_content)
        success = await update_note_content(tenant_id, note_id, new_content, user_id)
        
        if success:
            logger.info(f"[notes_actions] Appended item to note {note_id}")
        
        return success
        
    except Exception as e:
        # Log exception but don't re-raise - return False so caller can handle gracefully
        logger.error(f"[notes_actions] Failed to append to note: {e}", exc_info=True)
        return False


async def update_note_title(tenant_id: str, note_id: str, title: str, user_id: str) -> bool:
    """Update note title only.
    
    Args:
        tenant_id: Tenant identifier
        note_id: Note document ID (page_id)
        title: New title
        user_id: User ID for permission check
        
    Returns:
        True if update succeeded, False if note not found or permission denied
    """
    try:
        if not title or not title.strip():
            raise ValueError("Note title cannot be empty")
        
        # Fetch current note, then update with new title
        note = await get_note_by_id(tenant_id, note_id)
        if not note:
            logger.warning(f"[notes_actions] Note {note_id} not found for title update")
            return False
        
        # Update with existing content and new title
        current_content = _extract_note_content(note)
        return await update_note_content(tenant_id, note_id, current_content, user_id, title.strip())
        
    except Exception as e:
        # Log exception but don't re-raise - return False so caller can handle gracefully
        logger.error(f"[notes_actions] Failed to update note title: {e}", exc_info=True)
        return False


async def delete_note(tenant_id: str, note_id: str, user_id: str) -> bool:
    """Delete note by ID.
    
    Args:
        tenant_id: Tenant identifier
        note_id: Note document ID (page_id)
        user_id: User ID for permission check
        
    Returns:
        True if deletion succeeded, False if note not found or permission denied
    """
    try:
        from services import mesh as mesh_client

        user_id_norm = _normalize_user_id(user_id)
        if user_id_norm != user_id:
            logger.warning(f"[notes_actions] Normalized non-UUID user_id '{user_id}' -> '{user_id_norm}' for delete_note")
        user_id = user_id_norm
        
        # SECURITY CHECK: Verify delete permission
        has_delete = await sharing_actions.check_resource_delete_permission(
            tenant_id=tenant_id,
            user_id=user_id,
            resource_id=note_id,
            content_type='Notes'
        )
        
        if not has_delete:
            logger.warning(f"[notes_actions] User {user_id} does not have delete permission for note {note_id}")
            return False

        # BUILD REQUEST
        params = {"tenant": tenant_id}
        
        # EXECUTE REQUEST
        response = await mesh_client.request(
            "DELETE",
            f"/content/Notes/{note_id}",
            params=params
        )
        
        # VALIDATE & TRANSFORM
        if response.get("success"):
            logger.info(f"[notes_actions] Deleted note {note_id}")
            return True
        else:
            logger.warning(f"[notes_actions] Failed to delete note {note_id}: {response.get('error')}")
            return False
        
    except Exception as e:
        # Log exception but don't re-raise - return False so caller can handle gracefully
        logger.error(f"[notes_actions] Failed to delete note: {e}", exc_info=True)
        return False


async def update_note_mode(tenant_id: str, note_id: str, mode: str, user_id: str) -> bool:
    """Update note mode (work/personal).
    
    Args:
        tenant_id: Tenant identifier
        note_id: Note document ID (page_id)
        mode: Mode to set ('work' for shared, 'personal' for private)
        user_id: User ID for permission check
        
    Returns:
        True if update succeeded, False if permission denied
    """
    try:
        from services import mesh as mesh_client

        user_id_norm = _normalize_user_id(user_id)
        if user_id_norm != user_id:
            logger.warning(f"[notes_actions] Normalized non-UUID user_id '{user_id}' -> '{user_id_norm}' for update_note_mode")
        user_id = user_id_norm
        
        # SECURITY CHECK: Verify write permission
        has_write = await sharing_actions.check_resource_write_permission(
            tenant_id=tenant_id,
            user_id=user_id,
            resource_id=note_id,
            content_type='Notes'
        )
        
        if not has_write:
            logger.warning(f"[notes_actions] User {user_id} does not have write permission for note {note_id}")
            return False

        # BUILD REQUEST
        params = {"tenant": tenant_id}
        payload = {"mode": mode}
        
        # EXECUTE REQUEST
        response = await mesh_client.request(
            "PATCH",
            f"/content/Notes/{note_id}",
            params=params,
            json_body=payload
        )
        
        # VALIDATE & TRANSFORM
        if response.get("success"):
            logger.info(f"[notes_actions] Updated note {note_id} mode to {mode}")
            return True
        else:
            logger.warning(f"[notes_actions] Failed to update note mode: {response.get('error')}")
            return False
        
    except Exception as e:
        # Log exception but don't re-raise - return False so caller can handle gracefully
        logger.error(f"[notes_actions] Failed to update note mode: {e}", exc_info=True)
        return False
