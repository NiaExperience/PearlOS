"""User profile management business logic.

Handles user profile CRUD operations for storing user preferences,
settings, and metadata.

Uses Mesh content API (via mesh_client.request) for data access.
"""

import os
import sys
import json
import time
import uuid
from typing import Any, Optional

from loguru import logger

# Add parent directory to path for mesh_client import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import mesh as mesh_client


def _merge_onboarding_state(existing_state: object, incoming_state: dict) -> dict:
    """Merge deterministic onboarding state without clobbering nested flags."""
    base = existing_state if isinstance(existing_state, dict) else {}
    merged = {**base, **incoming_state}
    existing_actions = base.get("requiredActions")
    incoming_actions = incoming_state.get("requiredActions")
    if isinstance(existing_actions, dict) or isinstance(incoming_actions, dict):
        merged["requiredActions"] = {
            **(existing_actions if isinstance(existing_actions, dict) else {}),
            **(incoming_actions if isinstance(incoming_actions, dict) else {}),
        }
    if "completedBeats" in incoming_state:
        beats: list[str] = []
        for beat in [
            *(base.get("completedBeats") if isinstance(base.get("completedBeats"), list) else []),
            *(incoming_state.get("completedBeats") if isinstance(incoming_state.get("completedBeats"), list) else []),
        ]:
            value = str(beat).strip()
            if value and value not in beats:
                beats.append(value)
        merged["completedBeats"] = beats
    return merged


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


def _profile_id(profile: dict) -> str:
    value = profile.get("_id") or profile.get("page_id") or profile.get("id")
    return str(value or "")


def _is_active_discord_link(link: dict) -> bool:
    return bool(link.get("userId")) and not link.get("revokedAt")


async def get_discord_dm_link_by_discord_id(discord_user_id: str) -> Optional[dict]:
    """Fetch the active PearlOS user link for a Discord user ID."""
    discord_user_id = str(discord_user_id or "").strip()
    if not discord_user_id:
        return None

    params = {
        "where": json.dumps(
            {"indexer": {"path": "discordUserId", "equals": discord_user_id}},
            separators=(",", ":"),
        ),
        "limit": "10",
    }
    response = await mesh_client.request("GET", "/content/DiscordDmLink", params=params)
    if not response.get("success"):
        logger.debug(
            f"[profile_actions] DiscordDmLink lookup failed: {response.get('error')}"
        )
        return None

    data = response.get("data")
    links = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
    for link in links:
        if isinstance(link, dict) and _is_active_discord_link(link):
            return link
    return None


async def get_user_profile_by_discord_id(discord_user_id: str) -> Optional[dict]:
    """Resolve a Discord user ID to its linked PearlOS UserProfile."""
    link = await get_discord_dm_link_by_discord_id(discord_user_id)
    if not link:
        return None

    user_id = str(link.get("userId") or "").strip()
    if not user_id:
        return None

    profile = await get_user_profile(user_id)
    if profile:
        profile["_discordDmLink"] = link
        return profile
    return None


def build_discord_profile_context(profile: dict, *, discord_user_id: str = "") -> str:
    """Format linked UserProfile memory for injection into Discord turns."""
    if not profile:
        return ""

    lines = [
        "## Linked PearlOS User Profile",
        "This Discord speaker is linked to this PearlOS user. Apply this context only to this speaker.",
    ]
    user_id = profile.get("userId")
    email = profile.get("email")
    first_name = profile.get("first_name")
    if user_id:
        lines.append(f"- PearlOS userId: {user_id}")
    if email:
        lines.append(f"- Email: {email}")
    if first_name:
        lines.append(f"- First name: {first_name}")
    if discord_user_id:
        lines.append(f"- Discord user ID: {discord_user_id}")

    public_persona = profile.get("publicPersona")
    if isinstance(public_persona, dict) and public_persona:
        lines.append("\n### Public Persona")
        for key in ("displayName", "bio", "location", "profession"):
            value = public_persona.get(key)
            if value:
                lines.append(f"- {key}: {value}")
        interests = public_persona.get("interests")
        if isinstance(interests, list) and interests:
            lines.append("- interests: " + ", ".join(str(i) for i in interests[:12]))

    private_memory = profile.get("privateMemory")
    if isinstance(private_memory, dict) and private_memory:
        lines.append("\n### Private Memory")
        personal_notes = private_memory.get("personalNotes")
        relationship = private_memory.get("relationshipContext")
        if personal_notes:
            lines.append(f"- personalNotes: {str(personal_notes)[:1600]}")
        if relationship:
            lines.append(f"- relationshipContext: {str(relationship)[:1200]}")
        preferences = private_memory.get("preferences")
        if isinstance(preferences, dict) and preferences:
            compact = json.dumps(preferences, ensure_ascii=False, sort_keys=True)
            lines.append(f"- preferences: {compact[:1600]}")
        reminders = private_memory.get("reminders")
        if isinstance(reminders, list) and reminders:
            for reminder in reminders[-5:]:
                if isinstance(reminder, dict) and reminder.get("text"):
                    lines.append(f"- reminder: {reminder.get('text')}")

    summary = profile.get("lastConversationSummary")
    if isinstance(summary, dict) and summary.get("summary"):
        lines.append("\n### Last Conversation Summary")
        lines.append(str(summary.get("summary"))[:1200])

    return "\n".join(lines)[:7000]


def _clean_context_text(value: object, *, max_chars: int = 1200) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    return text[:max_chars].rstrip()


def _metadata_display_name(profile: dict) -> str:
    metadata = profile.get("metadata")
    if not isinstance(metadata, dict):
        return ""
    return _clean_context_text(metadata.get("name"), max_chars=180)


def build_web_profile_context(
    profile: dict,
    *,
    session_user_id: str = "",
    session_email: str = "",
    session_name: str = "",
) -> str:
    """Format the authenticated web user's profile for Pearl's prompt.

    This includes public persona and safe private memory fields for the
    current signed-in user only. It intentionally excludes
    privateMemory.sensitiveData, sessionHistory, and arbitrary metadata.
    """
    if not profile:
        return ""

    lines = [
        "## Current Authenticated PearlOS User Profile",
        (
            "This block is the authoritative identity and memory for the person "
            "in this web chat. Prefer it over global memory, old transcripts, "
            "session display names, or any other user's profile. Apply it only "
            "to this authenticated user."
        ),
    ]

    user_id = _clean_context_text(profile.get("userId") or session_user_id, max_chars=180)
    email = _clean_context_text(profile.get("email") or session_email, max_chars=240).lower()
    first_name = _clean_context_text(profile.get("first_name"), max_chars=180)
    full_name = _metadata_display_name(profile)
    clean_session_name = _clean_context_text(session_name, max_chars=180)

    if user_id:
        lines.append(f"- PearlOS userId: {user_id}")
    if email:
        lines.append(f"- Email: {email}")
    if first_name:
        lines.append(f"- First name: {first_name}")
    if full_name and full_name != first_name:
        lines.append(f"- Full name: {full_name}")
    if clean_session_name and clean_session_name not in {first_name, full_name}:
        lines.append(f"- Lower-priority session display name: {clean_session_name}")

    public_persona = profile.get("publicPersona")
    if isinstance(public_persona, dict) and public_persona:
        lines.append("\n### Public Persona")
        is_public = public_persona.get("isPublic")
        if isinstance(is_public, bool):
            lines.append(f"- isPublic: {str(is_public).lower()}")
        for key in ("displayName", "bio", "location", "profession", "avatarUrl"):
            value = _clean_context_text(public_persona.get(key), max_chars=1200)
            if value:
                lines.append(f"- {key}: {value}")
        interests = public_persona.get("interests")
        if isinstance(interests, list) and interests:
            clean_interests = [
                _clean_context_text(item, max_chars=120)
                for item in interests
            ]
            clean_interests = [item for item in clean_interests if item]
            if clean_interests:
                lines.append("- interests: " + ", ".join(clean_interests[:12]))
        social_links = public_persona.get("socialLinks")
        if isinstance(social_links, dict) and social_links:
            clean_links = {
                key: _clean_context_text(value, max_chars=300)
                for key, value in social_links.items()
                if key in {"twitter", "bluesky", "github", "website"}
            }
            clean_links = {key: value for key, value in clean_links.items() if value}
            if clean_links:
                lines.append(
                    "- socialLinks: "
                    + json.dumps(clean_links, ensure_ascii=False, sort_keys=True)
                )

    private_memory = profile.get("privateMemory")
    if isinstance(private_memory, dict) and private_memory:
        lines.append("\n### Private Memory")
        personal_notes = _clean_context_text(private_memory.get("personalNotes"), max_chars=1800)
        relationship = _clean_context_text(private_memory.get("relationshipContext"), max_chars=1400)
        if personal_notes:
            lines.append(f"- personalNotes: {personal_notes}")
        if relationship:
            lines.append(f"- relationshipContext: {relationship}")
        preferences = private_memory.get("preferences")
        if isinstance(preferences, dict) and preferences:
            compact = json.dumps(preferences, ensure_ascii=False, sort_keys=True)
            lines.append(f"- preferences: {compact[:1800]}")
        reminders = private_memory.get("reminders")
        if isinstance(reminders, list) and reminders:
            for reminder in reminders[-5:]:
                if not isinstance(reminder, dict):
                    continue
                text = _clean_context_text(reminder.get("text"), max_chars=300)
                if text:
                    due = _clean_context_text(reminder.get("dueDate"), max_chars=80)
                    lines.append(f"- reminder: {text}" + (f" (due {due})" if due else ""))

    summary = profile.get("lastConversationSummary")
    if isinstance(summary, dict):
        summary_text = _clean_context_text(summary.get("summary"), max_chars=1400)
        if summary_text:
            lines.append("\n### Last Conversation Summary")
            lines.append(summary_text)

    return "\n".join(lines)[:8000]


async def record_discord_profile_touch(
    user_id: str,
    *,
    discord_user_id: str,
    discord_username: str = "",
    guild_id: str = "",
    channel_id: str = "",
    channel_name: str = "",
    message_preview: str = "",
) -> Optional[dict]:
    """Best-effort bidirectional sync from Discord activity into UserProfile."""
    if not user_id or not str(user_id).strip():
        return None

    profile = await get_user_profile(str(user_id))
    if not profile:
        return None

    profile_id = _profile_id(profile)
    if not profile_id:
        logger.warning(f"[profile_actions] Cannot sync Discord touch, profile has no id for user {user_id}")
        return None

    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    private_memory = profile.get("privateMemory")
    if not isinstance(private_memory, dict):
        private_memory = {}
    preferences = private_memory.get("preferences")
    if not isinstance(preferences, dict):
        preferences = {}

    discord_pref = preferences.get("discord")
    if not isinstance(discord_pref, dict):
        discord_pref = {}
    discord_pref.update(
        {
            "discordUserId": discord_user_id,
            "lastSeenAt": now,
            "lastGuildId": guild_id,
            "lastChannelId": channel_id,
            "lastChannelName": channel_name,
        }
    )
    if discord_username:
        discord_pref["username"] = discord_username
    if message_preview:
        discord_pref["lastMessagePreview"] = " ".join(message_preview.split())[:240]
    preferences["discord"] = discord_pref
    private_memory["preferences"] = preferences

    session_id = "discord"
    if guild_id or channel_id:
        session_id = f"discord:{guild_id or 'dm'}:{channel_id or 'unknown'}"
    payload = {
        "content": {
            "privateMemory": private_memory,
        }
    }
    response = await mesh_client.request(
        "PATCH",
        f"/content/UserProfile/{profile_id}",
        params={"tenant": "any"},
        json_body=payload,
    )
    if response.get("success"):
        history = profile.get("sessionHistory")
        if isinstance(history, list):
            history_entry = {
                "time": now,
                "action": "Discord message received",
                "sessionId": session_id,
                "refIds": [
                    {"type": "discordUser", "id": discord_user_id},
                    *([{"type": "discordGuild", "id": guild_id}] if guild_id else []),
                    *([{"type": "discordChannel", "id": channel_id}] if channel_id else []),
                ],
            }
            await mesh_client.request(
                "PATCH",
                f"/content/UserProfile/{profile_id}",
                params={"tenant": "any"},
                json_body={"content": {"sessionHistory": [history_entry] + history[:99]}},
            )
        return response.get("data") or profile
    logger.warning(f"[profile_actions] Discord profile sync failed: {response.get('error')}")
    return None


async def remember_user_profile_fact(
    user_id: str,
    text: str,
    *,
    source: str = "manual",
) -> Optional[dict]:
    """Append a durable fact to UserProfile.privateMemory.personalNotes."""
    user_id = str(user_id or "").strip()
    content = " ".join(str(text or "").split()).strip()
    if not user_id or not content:
        return None

    profile = await get_user_profile(user_id)
    if not profile:
        return None

    profile_id = _profile_id(profile)
    if not profile_id:
        logger.warning(f"[profile_actions] Cannot remember fact, profile has no id for user {user_id}")
        return None

    private_memory = profile.get("privateMemory")
    if not isinstance(private_memory, dict):
        private_memory = {}

    existing_notes = str(private_memory.get("personalNotes") or "").strip()
    if content.lower() not in existing_notes.lower():
        dated_line = f"- {time.strftime('%Y-%m-%d', time.gmtime())} [{source}] {content}"
        private_memory["personalNotes"] = (
            f"{existing_notes}\n{dated_line}".strip() if existing_notes else dated_line
        )

    payload = {
        "content": {
            "privateMemory": private_memory,
        }
    }
    response = await mesh_client.request(
        "PATCH",
        f"/content/UserProfile/{profile_id}",
        params={"tenant": "any"},
        json_body=payload,
    )
    if response.get("success"):
        return response.get("data") or profile
    logger.warning(f"[profile_actions] Remember fact failed: {response.get('error')}")
    return None


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
                elif key == "onboardingState" and isinstance(value, dict):
                    update_payload["onboardingState"] = _merge_onboarding_state(
                        existing.get("onboardingState"),
                        value,
                    )
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
                # Return response data directly instead of re-fetching (saves 2 API calls)
                return response.get("data") or existing
            
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


# Configurable via BOT_MAX_SESSION_HISTORY environment variable (default: 20)
MAX_SESSION_HISTORY = int(os.getenv("BOT_MAX_SESSION_HISTORY", "20"))

# Max chars for summary text stored in sessionHistory refIds
MAX_HISTORY_SUMMARY_CHARS = int(os.getenv("BOT_MAX_HISTORY_SUMMARY_CHARS", "200"))

# Max chars for the current conversation summary stored directly on UserProfile.
MAX_LAST_CONVERSATION_SUMMARY_CHARS = int(
    os.getenv("BOT_MAX_LAST_CONVERSATION_SUMMARY_CHARS", "4000")
)


def _trim_conversation_summary(value: Any, max_chars: int = MAX_LAST_CONVERSATION_SUMMARY_CHARS) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "..."


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
            # Truncate description fields to prevent bloat
            trimmed_refs = []
            for ref in ref_ids:
                ref_copy = dict(ref)
                desc = ref_copy.get("description", "")
                if isinstance(desc, str) and len(desc) > MAX_HISTORY_SUMMARY_CHARS:
                    ref_copy["description"] = desc[:MAX_HISTORY_SUMMARY_CHARS] + "..."
                trimmed_refs.append(ref_copy)
            new_entry["refIds"] = trimmed_refs
        
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
    
    Performs a SINGLE fetch + SINGLE PATCH to avoid redundant API calls.
    Archives any existing lastConversationSummary to sessionHistory,
    then sets the new summary — all in one PATCH operation.
    
    Args:
        user_id: User ID
        summary: Conversation summary text
        session_id: Session/room identifier
        room_id: Room identifier for reference
        assistant_name: Name of the assistant/personality
        participant_count: Number of participants in conversation
        duration_seconds: Duration of conversation in seconds
        
    Returns:
        True if save succeeded, False otherwise
    """
    try:
        from datetime import datetime, timezone
        summary_text = _trim_conversation_summary(summary)

        # === SINGLE FETCH: get existing profile ===
        existing = await _fetch_profile({"indexer": {"path": "userId", "equals": user_id}})
        if not existing:
            logger.warning(f"[profile_actions] No profile found for userId {user_id}, cannot save summary")
            return False
        
        profile_id = existing.get("_id")
        if not profile_id:
            logger.error(f"[profile_actions] Profile missing _id for userId {user_id}")
            return False
        
        def _valid_history_entry(entry: Any) -> dict | None:
            if not isinstance(entry, dict):
                return None
            time_value = str(entry.get("time") or "").strip()
            action = str(entry.get("action") or "").strip()
            entry_session_id = str(entry.get("sessionId") or "").strip()
            if not time_value or not action or not entry_session_id:
                return None
            try:
                datetime.fromisoformat(time_value.replace("Z", "+00:00"))
            except Exception:
                return None

            cleaned = {
                "time": time_value,
                "action": action,
                "sessionId": entry_session_id,
            }
            ref_ids = entry.get("refIds")
            if isinstance(ref_ids, list):
                cleaned_refs = []
                for ref in ref_ids:
                    if not isinstance(ref, dict):
                        continue
                    ref_type = str(ref.get("type") or "").strip()
                    ref_id = str(ref.get("id") or "").strip()
                    if not ref_type or not ref_id:
                        continue
                    cleaned_ref = {"type": ref_type, "id": ref_id}
                    description = str(ref.get("description") or "").strip()
                    if description:
                        cleaned_ref["description"] = description[:MAX_HISTORY_SUMMARY_CHARS]
                    cleaned_refs.append(cleaned_ref)
                if cleaned_refs:
                    cleaned["refIds"] = cleaned_refs
            return cleaned

        # Build the combined update payload (sessionHistory + lastConversationSummary)
        update_content = {}
        
        # --- Archive previous summary to sessionHistory ---
        raw_existing_history = existing.get("sessionHistory", [])
        if not isinstance(raw_existing_history, list):
            raw_existing_history = []
        existing_history = [
            cleaned
            for cleaned in (_valid_history_entry(entry) for entry in raw_existing_history)
            if cleaned is not None
        ]
        
        prev_summary = existing.get("lastConversationSummary")
        if prev_summary and isinstance(prev_summary, dict):
            prev_timestamp = prev_summary.get("timestamp")
            prev_session_id = prev_summary.get("sessionId")
            
            if prev_timestamp and prev_session_id:
                # Truncate summary description to avoid bloat
                prev_desc = _trim_conversation_summary(
                    prev_summary.get("summary", ""),
                    MAX_HISTORY_SUMMARY_CHARS
                )

                archive_entry = {
                    "time": prev_timestamp,
                    "action": "session-summary",
                    "sessionId": prev_session_id,
                    "refIds": [
                        {"type": "conversation-summary", "id": room_id, "description": prev_desc}
                    ]
                }
                existing_history = [archive_entry] + existing_history
        
        # Cap sessionHistory to MAX_SESSION_HISTORY
        if len(existing_history) > MAX_SESSION_HISTORY:
            existing_history = existing_history[:MAX_SESSION_HISTORY]
        
        update_content["sessionHistory"] = existing_history
        
        # --- Set new conversation summary ---
        update_content["lastConversationSummary"] = {
            "summary": summary_text,
            "sessionId": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "assistantName": assistant_name,
            "participantCount": participant_count,
            "durationSeconds": duration_seconds
        }
        
        # === SINGLE PATCH: update both fields at once ===
        params = {"tenant": "any"}
        payload = {"content": update_content}
        
        response = await mesh_client.request(
            "PATCH",
            f"/content/UserProfile/{profile_id}",
            params=params,
            json_body=payload
        )
        
        if response.get("success"):
            logger.info(
                f"[profile_actions] Saved conversation summary for user {user_id} "
                f"(session: {session_id}, {len(summary_text)} chars, history: {len(existing_history)} entries)"
            )
            return True

        logger.warning(
            f"[profile_actions] Combined summary/history save failed, retrying summary-only: {response.get('error')}"
        )
        summary_only_response = await mesh_client.request(
            "PATCH",
            f"/content/UserProfile/{profile_id}",
            params=params,
            json_body={"content": {"lastConversationSummary": update_content["lastConversationSummary"]}}
        )
        if summary_only_response.get("success"):
            logger.info(
                f"[profile_actions] Saved conversation summary without sessionHistory for user {user_id} "
                f"(session: {session_id}, {len(summary_text)} chars)"
            )
            return True
        
        logger.error(f"[profile_actions] Failed to save conversation summary: {response.get('error')}")
        return False
        
    except Exception as e:
        logger.error(f"[profile_actions] Failed to save conversation summary: {e}", exc_info=True)
        return False
