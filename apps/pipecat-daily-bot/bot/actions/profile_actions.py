"""User profile management business logic.

Handles user profile CRUD operations for storing user preferences,
settings, and metadata.

Uses Mesh content API (via mesh_client.request) for data access.
"""

import os
import sys
import json
import uuid
from typing import Optional

from loguru import logger

# Add parent directory to path for mesh_client import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import mesh as mesh_client


async def _fetch_profile(where: dict) -> Optional[dict]:
    """Execute a profile lookup using the provided where clause."""
    params = {
        "where": json.dumps(where, separators=(",", ":")),
        "limit": "1",
    }

    response = await mesh_client.request("GET", "/content/UserProfile", params=params)

    if not response.get("success"):
        logger.debug(
            f"[profile_actions] Profile lookup failed: {response.get('error')}"
        )
        return None

    data = response.get("data")
    if isinstance(data, list) and data:
        return data[0]
    if isinstance(data, dict) and data:
        return data
    return None


async def _fetch_user(user_id: str) -> Optional[dict]:
    """Fetch User record by user ID."""
    # Mesh "User" content maps to a Postgres UUID `page_id`.
    # In local Daily sessions we may see literal strings like "anonymous" which would
    # cause Postgres to error when used as a UUID filter. Since User enrichment is
    # optional, skip lookup when user_id is not a valid UUID.
    try:
        uuid.UUID(user_id)
    except Exception:
        logger.debug(f"[profile_actions] Skipping User lookup for non-UUID userId {user_id!r}")
        return None

    params = {
        "where": json.dumps({"page_id": user_id}, separators=(",", ":")),
        "limit": "1",
    }

    response = await mesh_client.request("GET", "/content/User", params=params)

    if not response.get("success"):
        logger.debug(
            f"[profile_actions] User lookup failed: {response.get('error')}"
        )
        return None

    data = response.get("data")
    if isinstance(data, list) and data:
        return data[0]
    if isinstance(data, dict) and data:
        return data
    return None


async def _enrich_profile_with_user_data(profile: dict, user_id: str) -> dict:
    """Enrich UserProfile with data from User record.
    
    UserProfile typically only has first_name, email, and optional metadata.
    User record may have additional fields like name, phone_number, etc.
    This function merges User data into the profile for richer bot context.
    """
    try:
        user = await _fetch_user(user_id)
        if not user:
            logger.debug(f"[profile_actions] No User record found for userId {user_id}")
            return profile
        
        # Create enriched profile with merged data
        enriched = dict(profile)  # Copy original profile
        
        # Merge User fields into metadata if not already present
        if "metadata" not in enriched or not isinstance(enriched["metadata"], dict):
            enriched["metadata"] = {}
        
        metadata = enriched["metadata"]
        
        # Add User fields to metadata if not already present
        # This preserves UserProfile metadata while adding User data
        if user.get("name") and "name" not in metadata:
            metadata["name"] = user["name"]
        if user.get("phone_number") and "phone" not in metadata:
            metadata["phone"] = user["phone_number"]
        
        # Also add User record metadata if it exists
        if user.get("metadata") and isinstance(user["metadata"], dict):
            for key, value in user["metadata"].items():
                if key not in metadata:
                    metadata[key] = value
        
        logger.debug(f"[profile_actions] Enriched profile for user {user_id} with User record data")
        return enriched
        
    except Exception as e:
        logger.error(f"[profile_actions] Error enriching profile: {e}")
        return profile  # Return original on error


async def get_user_profile(user_id: str) -> Optional[dict]:
    """Fetch user profile by user ID, enriched with User record data if available."""
    if not user_id or not user_id.strip():
        return None

    profile = await _fetch_profile({"indexer": {"path": "userId", "equals": user_id}})

    if profile:
        logger.debug(f"[profile_actions] Found profile for user {user_id}")
        # Enrich profile with User record data
        profile = await _enrich_profile_with_user_data(profile, user_id)
    else:
        logger.debug(f"[profile_actions] No profile found for user {user_id}")

    return profile


async def get_user_profile_by_email(email: str) -> Optional[dict]:
    """Fetch user profile by email, enriched with User record data if available."""
    if not email or not email.strip():
        return None

    profile = await _fetch_profile({"indexer": {"path": "email", "equals": email}})

    if profile:
        logger.debug(f"[profile_actions] Found profile for email {email}")
        # Enrich with User data if userId is available
        user_id = profile.get("userId")
        if user_id:
            profile = await _enrich_profile_with_user_data(profile, user_id)
    else:
        logger.debug(f"[profile_actions] No profile found for email {email}")

    return profile


async def upsert_user_profile(
    user_id: str,
    data: dict
) -> Optional[dict]:
    """Create or update user profile (upsert pattern).
    
    If profile exists, merges new data with existing profile.
    If profile doesn't exist, creates a new one.
    Maps to POST /api/content/UserProfile (create) or PATCH (update) with dual-secret auth.
    UserProfile is a platform-level definition, always uses tenant="any".
    
    Args:
        user_id: User ID
        data: Profile data (first_name, last_name, email, phone, metadata, etc.)
        
    Returns:
        Created or updated profile document or None
    """
    try:
        if not user_id or not user_id.strip():
            logger.error("[profile_actions] user_id cannot be empty")
            return None
        
        # Check if profile already exists
        existing = await get_user_profile(user_id)
        
        if existing:
            # Profile exists - update it with PATCH
            logger.info(f"[profile_actions] Profile exists for user {user_id}, updating")
            
            profile_id = existing.get("_id")
            if not profile_id:
                logger.error(f"[profile_actions] Profile missing _id field")
                return None
            
            # PATCH performs partial update - only send fields we're changing
            # Special handling for metadata: merge instead of replace
            update_payload = {}
            for key, value in data.items():
                if key == "metadata" and isinstance(value, dict):
                    # Merge new metadata with existing metadata
                    existing_metadata = existing.get("metadata", {})
                    if isinstance(existing_metadata, dict):
                        # Deep merge: if value has nested 'metadata', flatten it
                        metadata_to_merge = value
                        
                        # BUGFIX: Prevent metadata.metadata nesting
                        # If incoming metadata has a 'metadata' key, flatten it
                        if "metadata" in value and isinstance(value["metadata"], dict):
                            logger.warning("[profile_actions] Detected nested metadata.metadata, flattening")
                            # Extract the nested metadata and merge at top level
                            nested = value.pop("metadata")
                            metadata_to_merge = {**value, **nested}
                        
                        merged_metadata = {**existing_metadata, **metadata_to_merge}
                        update_payload["metadata"] = merged_metadata
                        logger.debug(f"[profile_actions] Merged metadata: {merged_metadata}")
                    else:
                        update_payload["metadata"] = value
                else:
                    update_payload[key] = value
            
            # DO NOT manually update indexer - Mesh will rebuild it automatically
            # from the indexer field definitions (first_name, email, userId)
            
            # PATCH to /content/UserProfile/:id with partial update
            payload = {"content": update_payload}
            params = {"tenant": "any"}
            
            response = await mesh_client.request(
                "PATCH",
                f"/content/UserProfile/{profile_id}",
                params=params,
                json_body=payload
            )
            
            if response["success"]:
                logger.info(f"[profile_actions] Updated profile for user {user_id}")
                # Fetch and return updated profile
                return await get_user_profile(user_id)
            
            logger.error(f"[profile_actions] Failed to update profile: {response.get('error')}")
            return None
        
        # Profile doesn't exist - create it with POST
        logger.info(f"[profile_actions] Creating new profile for user {user_id}")
        
        # Build profile payload following Mesh content API pattern
        # UserProfile is platform-level, no tenantId in content
        # Note: Mesh will automatically:
        #   - Build indexer from indexer fields (first_name, email, userId)
        #   - Set parent_id based on parent config (if defined in content model)
        #   - Generate _id if not provided
        profile_content = {
            "userId": user_id,
            **data,  # Spread user data (metadata, etc.)
            # DO NOT include indexer here - Mesh builds it automatically
            # DO NOT include _id/page_id - Mesh generates it
        }
        
        payload = {"content": profile_content}
        params = {"tenant": "any"}
        
        response = await mesh_client.request(
            "POST",
            "/content/UserProfile",
            params=params,
            json_body=payload
        )
        
        if response["success"]:
            profile_data = response["data"]
            if profile_data:
                logger.info(f"[profile_actions] Created profile for user {user_id}")
                return profile_data
        
        logger.error(f"[profile_actions] Failed to create profile: {response.get('error')}")
        return None
        
    except Exception as e:
        # Log exception but don't re-raise - return None so caller can handle gracefully
        logger.error(f"[profile_actions] Failed to upsert user profile: {e}", exc_info=True)
        return None


# Keep old function names as aliases for backward compatibility
create_user_profile = upsert_user_profile


async def update_user_profile(
    user_id: str,
    updates: dict
) -> bool:
    """Update user profile fields (legacy wrapper - returns bool instead of profile).
    
    For new code, prefer upsert_user_profile() which returns the profile document.
    
    Args:
        user_id: User ID
        updates: Dict of fields to update (first_name, last_name, metadata, etc.)
        
    Returns:
        True if update succeeded, False otherwise
    """
    result = await upsert_user_profile(user_id, updates)
    return result is not None


async def delete_profile_metadata_keys(user_id: str, keys: list[str]) -> bool:
    """Delete specific metadata keys from user profile.
    
    Args:
        user_id: User ID
        keys: List of metadata keys to delete
        
    Returns:
        True if successful, False otherwise
    """
    try:
        existing = await get_user_profile(user_id)
        if not existing:
            logger.error(f"[profile_actions] Cannot delete metadata for user {user_id}: profile not found")
            return False
        
        profile_id = existing.get("_id")
        
        if not profile_id:
            logger.error(f"[profile_actions] Profile missing _id field")
            return False
        
        # Build updated metadata with specified keys removed
        metadata = existing.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
        
        for key in keys:
            metadata.pop(key, None)
        
        # Update via PATCH with modified metadata
        # UserProfile is a platform-level definition, always use tenant="any"
        params = {"tenant": "any"}
        payload = {
            "content": {
                "metadata": metadata
            }
        }
        
        response = await mesh_client.request(
            "PATCH",
            f"/content/UserProfile/{profile_id}",
            params=params,
            json_body=payload
        )
        
        if response.get("success"):
            logger.info(f"[profile_actions] Deleted {len(keys)} metadata keys for user {user_id}")
            return True
        
        logger.error(f"[profile_actions] Failed to delete metadata keys: {response.get('error')}")
        return False
    except Exception as e:
        logger.error(f"[profile_actions] Failed to delete metadata keys: {e}", exc_info=True)
        return False


async def clear_profile_metadata(user_id: str) -> bool:
    """Clear all metadata from user profile.
    
    Args:
        user_id: User ID
        
    Returns:
        True if successful, False otherwise
    """
    try:
        existing = await get_user_profile(user_id)
        if not existing:
            logger.error(f"[profile_actions] Cannot clear metadata for user {user_id}: profile not found")
            return False
        
        profile_id = existing.get("_id")
        
        if not profile_id:
            logger.error(f"[profile_actions] Profile missing _id field")
            return False
        
        # Clear metadata via PATCH
        # UserProfile is a platform-level definition, always use tenant="any"
        params = {"tenant": "any"}
        payload = {
            "content": {
                "metadata": {}
            }
        }
        
        response = await mesh_client.request(
            "PATCH",
            f"/content/UserProfile/{profile_id}",
            params=params,
            json_body=payload
        )
        
        if response.get("success"):
            logger.info(f"[profile_actions] Cleared metadata for user {user_id}")
            return True
        
        logger.error(f"[profile_actions] Failed to clear metadata: {response.get('error')}")
        return False
    except Exception as e:
        logger.error(f"[profile_actions] Failed to clear metadata: {e}", exc_info=True)
        return False


# Configurable via BOT_MAX_SESSION_HISTORY environment variable (default: 100)
MAX_SESSION_HISTORY = int(os.getenv("BOT_MAX_SESSION_HISTORY", "100"))


async def add_session_history_entry(
    user_id: str,
    action: str,
    session_id: str,
    timestamp: Optional[str] = None,
    ref_ids: Optional[list] = None
) -> bool:
    """Add a session history entry to the user profile.
    
    Automatically limits to MAX_SESSION_HISTORY most recent entries.
    
    Args:
        user_id: User ID
        action: Description of the action (e.g., "session-summary")
        session_id: Session/room identifier
        timestamp: ISO timestamp (defaults to current time if not provided)
        ref_ids: Optional array of resource references [{"type": str, "id": str}]
        
    Returns:
        True if entry added successfully, False otherwise
    """
    try:
        from datetime import datetime, timezone
        
        # Fetch current profile to get existing sessionHistory
        existing = await get_user_profile(user_id)
        if not existing:
            logger.warning(f"[profile_actions] User profile not found for userId: {user_id}")
            return False
        
        profile_id = existing.get("_id")
        if not profile_id:
            logger.warning(f"[profile_actions] No profile ID for userId: {user_id}")
            return False
        
        # Create new entry
        new_entry = {
            "time": timestamp or datetime.now(timezone.utc).isoformat(),
            "action": action,
            "sessionId": session_id
        }
        
        if ref_ids and len(ref_ids) > 0:
            new_entry["refIds"] = ref_ids
        
        # Get existing history or create new array
        existing_history = existing.get("sessionHistory", [])
        
        # Add new entry at the beginning (most recent first)
        updated_history = [new_entry] + existing_history
        
        # Limit to MAX_SESSION_HISTORY most recent entries
        if len(updated_history) > MAX_SESSION_HISTORY:
            updated_history = updated_history[:MAX_SESSION_HISTORY]
        
        # Update the profile with new history using PATCH for partial update
        # UserProfile is a platform-level definition, always use tenant="any"
        params = {"tenant": "any"}
        payload = {
            "content": {
                "sessionHistory": updated_history
            }
        }
        
        response = await mesh_client.request(
            "PATCH",
            f"/content/UserProfile/{profile_id}",
            params=params,
            json_body=payload
        )
        
        if response.get("success"):
            logger.debug(f"[profile_actions] Added session history entry for userId: {user_id}", new_entry)
            return True
        
        logger.error(f"[profile_actions] Failed to add session history entry: {response.get('error')}")
        return False
        
    except Exception as e:
        logger.error(f"[profile_actions] Failed to add session history entry: {e}", exc_info=True)
        return False


async def save_conversation_summary(
    user_id: str,
    summary: str,
    session_id: str,
    room_id: str,
    assistant_name: str,
    participant_count: int = 1,
    duration_seconds: int = 0
) -> bool:
    """Save conversation summary to user profile.
    
    Before saving the new summary, archives any existing lastConversationSummary
    to sessionHistory with action 'session-summary'.
    
    Args:
        user_id: User ID
        summary: Conversation summary text
        session_id: Session/room identifier
        assistant_name: Name of the assistant/personality
        participant_count: Number of participants in conversation
        duration_seconds: Duration of conversation in seconds
        
    Returns:
        True if save succeeded, False otherwise
    """
    try:
        from datetime import datetime, timezone
        
        # Fetch current profile to check for existing conversation summary
        existing = await get_user_profile(user_id)
        if existing and existing.get("lastConversationSummary"):
            # Archive the previous summary to sessionHistory
            prev_summary = existing["lastConversationSummary"]
            prev_timestamp = prev_summary.get("timestamp")
            prev_session_id = prev_summary.get("sessionId")
            
            if prev_timestamp and prev_session_id:
                logger.debug(
                    f"[profile_actions] Archiving previous conversation summary to sessionHistory "
                    f"(session: {prev_session_id})"
                )
                ref_ids = [
                    {"type": "conversation-summary", "id": room_id, "description": prev_summary.get("summary")}
                ]
                await add_session_history_entry(
                    user_id=user_id,
                    action="session-summary",
                    session_id=prev_session_id,
                    timestamp=prev_timestamp,
                    ref_ids=ref_ids
                )
        
        # Build new conversation summary object matching IConversationSummary schema
        conversation_summary = {
            "summary": summary,
            "sessionId": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "assistantName": assistant_name,
            "participantCount": participant_count,
            "durationSeconds": duration_seconds
        }
        
        # Use update_user_profile to save the new summary
        success = await update_user_profile(
            user_id=user_id,
            updates={"lastConversationSummary": conversation_summary}
        )
        
        if success:
            logger.info(
                f"[profile_actions] Saved conversation summary for user {user_id} "
                f"(session: {session_id}, {len(summary)} chars)"
            )
        else:
            logger.error(f"[profile_actions] Failed to save conversation summary for user {user_id}")
        
        return success
        
    except Exception as e:
        logger.error(f"[profile_actions] Failed to save conversation summary: {e}", exc_info=True)
        return False
