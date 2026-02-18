"""HTML content management business logic.

This module handles HTML generation (creation engine) operations:
- CRUD for HTML applets/generations
- Fuzzy search by title
- Link to source notes

Uses mesh_client.request() for all HTTP operations to /content/HtmlGeneration endpoint.
"""

import logging
from typing import Optional, Callable, Awaitable, TypeVar
from loguru import logger
from difflib import SequenceMatcher
from tools.sharing import utils as sharing_tools
from actions import sharing_actions
import json
import sys
import os

# Add parent directory to path for mesh_client import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import mesh as mesh_client

# Type variable for ensure wrapper return type
T = TypeVar('T')


async def create_html_generation_definition(tenant_id: str) -> bool:
    """Create the HtmlGeneration content definition in Mesh for this tenant.
    
    Args:
        tenant_id: Tenant identifier for scoping the definition
        
    Returns:
        True if definition was created successfully, False otherwise
    """
    try:
        from nia_content_definitions import register_content_definition, HTMLGENERATION_DEFINITION
        
        mesh_url = os.getenv("MESH_API_ENDPOINT", "").strip().rstrip("/")
        if not mesh_url:
            logger.error("[html_actions] MESH_API_ENDPOINT not set, cannot create definition")
            return False
        
        mesh_secret = os.getenv("MESH_SHARED_SECRET")
        
        success = register_content_definition(
            definition=HTMLGENERATION_DEFINITION,
            mesh_url=mesh_url,
            tenant=tenant_id,
            mesh_secret=mesh_secret
        )
        
        if success:
            logger.info(f"[html_actions] Created HtmlGeneration definition for tenant {tenant_id}")
        else:
            logger.error(f"[html_actions] Failed to create HtmlGeneration definition for tenant {tenant_id}")
        
        return success
        
    except ImportError as e:
        logger.error(f"[html_actions] Cannot import nia_content_definitions: {e}")
        return False
    except Exception as e:
        logger.error(f"[html_actions] Failed to create HtmlGeneration definition: {e}", exc_info=True)
        return False


async def ensure_html_generation_definition(
    operation: Callable[[], Awaitable[T]],
    tenant_id: str
) -> T:
    """Ensure HtmlGeneration definition exists before executing an operation.
    
    If the operation fails due to missing definition, creates the definition
    and retries the operation once.
    
    Args:
        operation: Async function to execute that requires the HtmlGeneration definition
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
            'Content definition for type "HtmlGeneration" not found' in error_msg or
            'CONTENT_CREATE_ERR' in error_msg or
            '"HtmlGeneration" not found' in error_msg
        )
        
        if is_missing_definition:
            logger.warning(
                f"[html_actions] HtmlGeneration definition not found for tenant {tenant_id}, creating it..."
            )
            
            # Create the definition
            created = await create_html_generation_definition(tenant_id)
            
            if not created:
                logger.error("[html_actions] Failed to create HtmlGeneration definition, cannot retry operation")
                raise
            
            # Retry the operation
            logger.info("[html_actions] Retrying operation after creating HtmlGeneration definition")
            result = await operation()
            return result
        else:
            # Not a definition error, re-raise
            raise


async def list_html_generations(tenant_id: str, user_id: str) -> list[dict]:
    """Fetch all HTML generations for tenant (metadata only).
    
    Returns metadata fields only (excludes htmlContent to reduce payload size).
    
    Args:
        tenant_id: Tenant identifier
        
    Returns:
        List of HTML generation metadata dicts with fields:
        _id, title, contentType, createdBy, tags, userRequest, sourceNoteId
    """
    try:
        # Aggregate all generations/applets for user
        generations = []

        # get user generations/applets
        # BUILD QUERY (actions layer responsibility)
        where = {"AND": [
            {"indexer": {"path": "tenantId", "equals": tenant_id}},
            {"parent_id": {"eq": user_id}}
        ]}
        params = {
            "tenant": tenant_id,
            "where": json.dumps(where, separators=(',', ':')),
            "limit": '100'
        }
        # EXECUTE REQUEST (mesh_client responsibility)
        response = await mesh_client.request("GET", "/content/HtmlGeneration", params=params)
        # VALIDATE & TRANSFORM (actions layer responsibility)
        if response.get("success"):
            personal_generations = response.get("data", [])
            generations.extend(personal_generations)
            logger.debug(f"[html_actions] Listed {len(personal_generations)} personal generations for tenant {tenant_id}")
        else:
            logger.error(f"[html_actions] Failed to list work generations: {response.get('error')}")

        # Now get shared generations/applets
        response = await sharing_tools.get_user_shared_resources(tenant_id, user_id, content_type="HtmlGeneration")
        if response.get("success"):
            shared_generations = response.get("resources", [])
            generations.extend(shared_generations)
            logger.debug(f"[html_actions] Listed {len(shared_generations)} shared generations for user {user_id}")
        
        if generations:
            # Extract metadata only (exclude htmlContent)
            metadata_list = []
            for gen in generations:
                sharing_info = gen.get('_sharing', {})
                
                metadata = {
                    "_id": gen.get("_id"),
                    "title": gen.get("title", ""),
                    "contentType": gen.get("contentType", "app"),
                    "createdBy": gen.get("createdBy", ""),
                    "tenantId": gen.get("tenantId", ""),
                    "tags": gen.get("tags", []),
                    "userRequest": gen.get("userRequest", ""),
                    "sourceNoteId": gen.get("sourceNoteId"),
                    "createdAt": gen.get("createdAt"),
                    "updatedAt": gen.get("updatedAt"),
                    # Add sharing metadata
                    "isShared": bool(sharing_info),
                    "accessLevel": sharing_info.get('role', 'owner'),
                    "isGlobal": sharing_info.get('isGlobal', False)
                }
                metadata_list.append(metadata)
            
            logger.info(f"[html_actions] Found {len(metadata_list)} HTML generations for tenant {tenant_id}")
            return metadata_list
        
        logger.warning(f"[html_actions] No HTML generations found for tenant {tenant_id}")
        return []
        
    except Exception as e:
        logger.error(f"[html_actions] Failed to list HTML generations: {e}", exc_info=True)
        return []


async def fuzzy_search_applets(tenant_id: str, title: str, user_id: str) -> Optional[dict]:
    """Find HTML generation by fuzzy title match.
    
    Uses SequenceMatcher to find the best match for the given title.
    Returns None if no reasonable match is found (similarity < 0.6).
    
    Args:
        tenant_id: Tenant identifier
        title: Title to search for (case-insensitive)
        
    Returns:
        Best matching generation or None
    """
    try:
        logger.info(f"[html_actions] 🔍 FUZZY SEARCH - tenant_id={tenant_id}, title='{title}', user_id={user_id}")
        generations = await list_html_generations(tenant_id, user_id)
        
        logger.info(f"[html_actions] 📊 SEARCH RESULTS - Found {len(generations)} total applets for tenant {tenant_id}")
        
        if not generations:
            logger.warning(f"[html_actions] ❌ NO APPLETS - No applets found for tenant {tenant_id}")
            return None
        
        # Log all available applets for debugging
        logger.info(f"[html_actions] 📝 AVAILABLE APPLETS:")
        for idx, gen in enumerate(generations[:10], 1):  # Log first 10
            logger.info(
                "[html_actions]   %s. '%s' (id=%s, createdBy=%s, tenantId=%s)",
                idx,
                gen.get("title"),
                gen.get("_id"),
                gen.get("createdBy"),
                gen.get("tenantId"),
            )
        
        search_term = title.lower().strip()
        
        matches = []
        for gen in generations:
            gen_title = gen.get('title', '').lower().strip()
            similarity = SequenceMatcher(None, search_term, gen_title).ratio()
            matches.append((similarity, gen))
            if similarity >= 0.6:
                logger.info(f"[html_actions] 🎯 MATCH CANDIDATE - '{gen.get('title')}' similarity={similarity:.2f}")
        
        matches.sort(key=lambda x: x[0], reverse=True)
        best_score, best_gen = matches[0]
        
        logger.info(f"[html_actions] 🏆 BEST MATCH - '{best_gen.get('title')}' similarity={best_score:.2f} (threshold=0.6)")
        
        if best_score >= 0.6:
            logger.info(
                f"[html_actions] ✅ FUZZY MATCH SUCCESS - '{title}' → '{best_gen.get('title')}' "
                f"(similarity: {best_score:.2f}, applet_id={best_gen.get('_id')}, createdBy={best_gen.get('createdBy')}, tenantId={best_gen.get('tenantId')})"
            )
            return best_gen
        else:
            logger.warning(
                f"[html_actions] ❌ NO MATCH - Best score {best_score:.2f} below threshold 0.6 "
                f"for search term '{title}'"
            )
        
        return None
        
    except Exception as e:
        # Log exception but don't re-raise - return None so caller can handle gracefully
        logger.error(f"[html_actions] ⚠️ FUZZY SEARCH ERROR: {e}", exc_info=True)
        return None


async def get_html_generation_by_id(tenant_id: str, gen_id: str) -> Optional[dict]:
    """Fetch HTML generation by ID.
    
    Args:
        tenant_id: Tenant identifier
        gen_id: Generation document ID (_id)
        
    Returns:
        Generation document or None
    """
    try:
        where = {"page_id": {"eq": gen_id}}
        params = {
            "tenant": tenant_id,
            "where": json.dumps(where),
            "limit": "1"
        }
        
        response = await mesh_client.request("GET", "/content/HtmlGeneration", params=params)
        
        if response["success"]:
            data = response["data"]
            if isinstance(data, list) and len(data) > 0:
                logger.info(f"[html_actions] Found HTML generation {gen_id}")
                return data[0]
        
        logger.warning(f"[html_actions] HTML generation {gen_id} not found")
        return None
        
    except Exception as e:
        logger.error(f"[html_actions] Failed to get HTML generation by ID: {e}", exc_info=True)
        return None


async def make_unique_title(tenant_id: str, user_id: str, base_title: str) -> str:
    """Generate a unique title by appending a number if the title already exists.
    
    Checks for existing titles matching the pattern:
    - "Title"
    - "Title 2"
    - "Title 3"
    etc.
    
    Args:
        tenant_id: Tenant identifier
        base_title: The base title to make unique
        
    Returns:
        Unique title (either original or with appended number)
    """
    try:
        # Get all existing generations to check for title conflicts
        generations = await list_html_generations(tenant_id, user_id)
        
        if not generations:
            return base_title
        
        # Extract all existing titles
        existing_titles = {gen.get('title', '').strip().lower() for gen in generations}
        
        # Check if base title exists
        if base_title.lower() not in existing_titles:
            return base_title
        
        # Find the highest number suffix for this title pattern
        # Pattern: "Title", "Title 2", "Title 3", etc.
        import re
        base_lower = base_title.lower()
        pattern = re.compile(rf"^{re.escape(base_lower)}(?: (\d+))?$")
        
        max_number = 1  # Start at 1 because base title exists
        for title in existing_titles:
            match = pattern.match(title)
            if match:
                num_str = match.group(1)
                if num_str:
                    num = int(num_str)
                    max_number = max(max_number, num)
        
        # Generate next number
        next_number = max_number + 1
        unique_title = f"{base_title} {next_number}"
        
        logger.info(f"[html_actions] Made title unique: '{base_title}' -> '{unique_title}'")
        return unique_title
        
    except Exception as e:
        logger.error(f"[html_actions] Failed to make title unique, using original: {e}", exc_info=True)
        return base_title


async def create_html_generation(
    tenant_id: str,
    user_id: str,
    title: str,
    html_content: str,
    content_type: str = "app",
    user_request: str = "",
    source_note_id: Optional[str] = None,
    tags: list[str] = None
) -> Optional[dict]:
    """Create new HTML generation.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User ID (generation owner)
        title: Generation title
        html_content: Complete HTML content (single-file with embedded CSS/JS)
        content_type: Type of HTML content (game, app, tool, interactive)
        user_request: Original user request that created this
        source_note_id: Optional link to source note
        tags: Optional tags for searchability
        
    Returns:
        Created generation document or None
        
    Raises:
        ValueError: If title or html is empty
    """
    async def _create_operation():
        if not title or not title.strip():
            raise ValueError("HTML generation title cannot be empty")
        
        if not html_content or not html_content.strip():
            raise ValueError("HTML content cannot be empty")
        
        # Make title unique by appending number if needed
        unique_title = await make_unique_title(tenant_id, user_id, title)
        
        # Build content payload following Mesh content API pattern
        generation_content = {
            "title": unique_title,
            "contentType": content_type,
            "htmlContent": html_content,
            "userRequest": user_request,
            "isAiGenerated": True,
            "createdBy": user_id,
            "tenantId": tenant_id,
            "tags": tags or [],
        }
        
        # Add source note reference if provided
        if source_note_id:
            generation_content["sourceNoteId"] = source_note_id
        
        payload = {"content": generation_content}
        params = {"tenant": tenant_id}
        
        response = await mesh_client.request("POST", "/content/HtmlGeneration", params=params, json_body=payload)
        
        if response["success"]:
            data = response["data"]
            if data:
                logger.info(f"[html_actions] Created HTML generation '{unique_title}' (id={data.get('_id')})")
                return data
        
        # Mesh API returned an error - raise exception to trigger ensure wrapper
        error_obj = response.get('error', {})
        if isinstance(error_obj, dict):
            error_msg = error_obj.get('message', str(error_obj))
        else:
            error_msg = str(error_obj)
        raise Exception(f"Mesh POST /content/HtmlGeneration failed: {error_msg}")
    
    try:
        return await ensure_html_generation_definition(_create_operation, tenant_id)
    except Exception as e:
        # Log exception but don't re-raise - return None so caller can provide user-friendly error
        logger.error(f"[html_actions] Failed to create HTML generation: {e}", exc_info=True)
        return None


async def update_html_generation(
    tenant_id: str,
    gen_id: str,
    user_id: str,
    title: Optional[str] = None,
    html_content: Optional[str] = None,
    tags: Optional[list[str]] = None
) -> bool:
    """Update HTML generation fields.
    
    Args:
        tenant_id: Tenant identifier
        gen_id: Generation document ID (_id)
        user_id: User ID for permission check
        title: Optional new title
        html_content: Optional new HTML content
        tags: Optional new tags
        
    Returns:
        True if update succeeded, False if not found or permission denied
        
    Raises:
        ValueError: If title or html would become empty
    """
    async def _update_operation():
        # SECURITY CHECK: Verify write permission
        has_write = await sharing_actions.check_resource_write_permission(
            tenant_id=tenant_id,
            user_id=user_id,
            resource_id=gen_id,
            content_type='HtmlGeneration'
        )
        
        if not has_write:
            logger.warning(f"[html_actions] User {user_id} does not have write permission for applet {gen_id}")
            return False

        # Validate updates
        if title is not None and (not title or not title.strip()):
            raise ValueError("HTML generation title cannot be empty")
        
        if html_content is not None and (not html_content or not html_content.strip()):
            raise ValueError("HTML content cannot be empty")
        
        # PATCH performs partial update - no need to fetch first!
        # Build payload with only the fields we're updating
        update_payload = {}
        if title is not None:
            update_payload["title"] = title
        if html_content is not None:
            update_payload["htmlContent"] = html_content
        if tags is not None:
            update_payload["tags"] = tags
        
        payload = {"content": update_payload}
        params = {"tenant": tenant_id}
        
        response = await mesh_client.request("PATCH", f"/content/HtmlGeneration/{gen_id}", params=params, json_body=payload)
        
        if response["success"]:
            logger.info(f"[html_actions] Updated HTML generation {gen_id}")
            return True
        
        # Raise exception to trigger ensure wrapper if needed
        error_obj = response.get('error', {})
        if isinstance(error_obj, dict):
            error_msg = error_obj.get('message', str(error_obj))
        else:
            error_msg = str(error_obj)
        raise Exception(f"Mesh PUT /content/HtmlGeneration/{gen_id} failed: {error_msg}")
    
    try:
        return await ensure_html_generation_definition(_update_operation, tenant_id)
    except Exception as e:
        # Log exception but don't re-raise - return False so caller can handle gracefully
        logger.error("[html_actions] Failed to update HTML generation: %s", str(e), exc_info=True)
        return False


async def delete_html_generation(tenant_id: str, gen_id: str, user_id: str) -> bool:
    """Delete an HTML generation by ID.
    
    Args:
        tenant_id: Tenant identifier for scoping the delete operation
        gen_id: Generation document ID (_id)
        user_id: User ID for permission check
        
    Returns:
        True if the deletion succeeded, False otherwise.
    """
    try:
        # SECURITY CHECK: Verify write permission
        has_write = await sharing_actions.check_resource_write_permission(
            tenant_id=tenant_id,
            user_id=user_id,
            resource_id=gen_id,
            content_type='HtmlGeneration'
        )
        
        if not has_write:
            logger.warning(f"[html_actions] User {user_id} does not have write permission for applet {gen_id}")
            return False

        params = {"tenant": tenant_id}
        response = await mesh_client.request(
            "DELETE",
            f"/content/HtmlGeneration/{gen_id}",
            params=params,
        )

        if response.get("success"):
            logger.info(f"[html_actions] Deleted HTML generation {gen_id}")
            return True

        logger.warning(
            "[html_actions] Failed to delete HTML generation {}: {}",
            gen_id,
            response.get("error"),
        )
        return False

    except Exception as e:
        # Log exception but don't re-raise - return False so caller can handle gracefully
        logger.error(f"[html_actions] Failed to delete HTML generation: {e}", exc_info=True)
        return False
