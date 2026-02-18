from __future__ import annotations

import os
import json
from typing import Any, Literal, TYPE_CHECKING
from difflib import SequenceMatcher
import re

from pipecat.services.llm_service import FunctionCallParams

from actions import sharing_actions
from services import mesh as mesh_client
from tools.logging_utils import bind_context_logger

log = bind_context_logger(tag="[sharing_tools]")
logger = log

_LOCAL_ANON_USER_UUID = "00000000-0000-0000-0000-000000000099"

def _normalize_user_id(user_id: str | None) -> str | None:
    """Normalize local dev user identifiers.

    In local Daily sessions, participant info.userId can be the literal string "anonymous".
    The storage layer expects UUIDs, so map this to a stable UUID used across the stack.
    """
    if not user_id:
        return user_id
    if isinstance(user_id, str) and user_id.lower() == "anonymous":
        return _LOCAL_ANON_USER_UUID
    return user_id

# Lazy import helpers to avoid circular import and handle path issues
def _get_room_state():
    try:
        import room.state as state
    except ImportError:
        import bot.room.state as state
    return state

def _get_transport():
    try:
        from core.transport import get_transport
    except ImportError:
        from bot.core.transport import get_transport
    return get_transport()

async def _share_resource_with_participants(
    room_url: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration'],
    owner_user_id: str,
) -> dict[str, Any]:
    """Share a resource with all participants in a call.
    
    - Gets all participants from Daily transport
    - Extracts userId from each participant's sessionMetadata
    - Calls sharing_actions.get_or_create_call_sharing_organization()
    - For each participant, calls sharing_actions.share_resource_with_user()
    - Returns list of user IDs that were successfully shared with
    
    Args:
        room_url: Daily room URL
        resource_id: Note or HtmlGeneration _id
        content_type: 'Notes' or 'HtmlGeneration'
        owner_user_id: User ID of resource owner
        
    Returns:
        {
            "success": bool,
            "shared_with": list[str],  # User IDs successfully shared with
            "errors": list[str],  # Any errors encountered
        }
    """
    try:
        # Get tenant context
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            logger.error(f"[sharing] No tenant_id for room {room_url}")
            return {
                "success": False,
                "shared_with": [],
                "errors": ["No tenant context available"]
            }
        
        # Get or create call-level sharing organization
        org = await sharing_actions.get_or_create_call_sharing_organization(
            tenant_id=tenant_id,
            room_url=room_url,
            owner_user_id=owner_user_id
        )
        
        if not org:
            logger.error(f"[sharing] Failed to get/create organization for room {room_url}")
            return {
                "success": False,
                "shared_with": [],
                "errors": ["Failed to create sharing organization"]
            }
        
        # Get participants from transport
        transport = _get_transport()
        if not transport:
            logger.warning(f"[sharing] No transport available for room {room_url}")
            return {
                "success": False,
                "shared_with": [],
                "errors": ["No transport available"]
            }
        
        try:
            from core.transport import get_participants_from_transport
        except ImportError:
            from bot.core.transport import get_participants_from_transport
            
        participants = get_participants_from_transport(transport)
        
        shared_with = []
        errors = []
        
        # Share with each participant
        for pid, data in participants.items():
            if pid == 'local':  # Skip bot
                continue
            
            # Extract userId from participant metadata
            # Daily.co transport.participants() returns userId directly in 'info', not nested in 'userData'
            info = data.get('info', {})
            user_id = info.get('userId')
            user_name = info.get('userName', 'Unknown')
            
            if not user_id:
                logger.warning(f"[sharing] Participant {user_name} ({pid}) has no userId")
                errors.append(f"No userId for participant {user_name}")
                continue
            
            # Skip owner (they already have access)
            if user_id == owner_user_id:
                logger.info(f"[sharing] Skipping owner {user_name} ({user_id})")
                continue
            
            # Share resource with this participant
            success = await sharing_actions.share_resource_with_user(
                tenant_id=tenant_id,
                organization_id=org["_id"],
                user_id=user_id,
                resource_id=resource_id,
                content_type=content_type,
                role='member'  # Grant read-write access
            )
            
            if success:
                shared_with.append(user_id)
                logger.info(f"[sharing] Shared {content_type} {resource_id} with {user_name} ({user_id})")
            else:
                error_msg = f"Failed to share with {user_name} ({user_id})"
                errors.append(error_msg)
                logger.error(f"[sharing] {error_msg}")
        
        return {
            "success": len(shared_with) > 0 or len(errors) == 0,
            "shared_with": shared_with,
            "errors": errors
        }
        
    except Exception as e:
        logger.error(f"[sharing] Exception in _share_resource_with_participants: {e}", exc_info=True)
        return {
            "success": False,
            "shared_with": [],
            "errors": [str(e)]
        }


async def _share_resource_with_single_user(
    room_url: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration'],
    user_id: str,
    owner_user_id: str,
) -> bool:
    """Share resource with a single user (for late joiners).
    
    Args:
        room_url: Daily room URL
        resource_id: Note or HtmlGeneration _id
        content_type: 'Notes' or 'HtmlGeneration'
        user_id: User ID to share with
        owner_user_id: User ID of resource owner
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Get tenant context
        tenant_id = _get_room_state().get_room_tenant_id(room_url)
        if not tenant_id:
            logger.error(f"[sharing] No tenant_id for room {room_url}")
            return False
        
        # Skip owner (they already have access)
        if user_id == owner_user_id:
            logger.info(f"[sharing] Skipping owner {user_id}")
            return True
        
        # Get or create call-level sharing organization
        org = await sharing_actions.get_or_create_call_sharing_organization(
            tenant_id=tenant_id,
            room_url=room_url,
            owner_user_id=owner_user_id
        )
        
        if not org:
            logger.error(f"[sharing] Failed to get/create organization for room {room_url}")
            return False
        
        # Share resource with this user
        success = await sharing_actions.share_resource_with_user(
            tenant_id=tenant_id,
            organization_id=org["_id"],
            user_id=user_id,
            resource_id=resource_id,
            content_type=content_type,
            role='member'  # Grant read-write access
        )
        
        if success:
            logger.info(f"[sharing] Shared {content_type} {resource_id} with user {user_id}")
        else:
            logger.error(f"[sharing] Failed to share {content_type} {resource_id} with user {user_id}")
        
        return success
        
    except Exception as e:
        logger.error(f"[sharing] Exception in _share_resource_with_single_user: {e}", exc_info=True)
        return False


async def get_user_shared_resources(
    tenant_id: str,
    user_id: str,
    content_type: Literal['Notes', 'HtmlGeneration'] | None = None
) -> dict[str, Any]:
    """Fetch shared resources accessible to a user within the call's tenant context.

    Wraps the actions-layer helper so bot flows can discover whether a note or
    applet has already been shared with a participant before attempting
    additional sharing.
    """
    try:
        if not tenant_id:
            logger.error("[sharing] get_user_shared_resources missing tenant_id")
            return {
                "success": False,
                "error": "No tenant context available"
            }

        shared_resources = await sharing_actions.get_user_shared_resources(
            tenant_id=tenant_id,
            user_id=user_id,
            content_type=content_type
        )
        # create a map of resource ID to the shared_resource entries
        resource_index = {res['resource_id']: res for res in shared_resources if 'resource_id' in res}
        logger.debug(f"[sharing] Found {len(shared_resources)} shared resources for user {user_id} in tenant {tenant_id}: indexed {len(resource_index)} items")
        raw_resources = []
    
        resources = await sharing_actions.get_resources_by_id(tenant_id, list(resource_index.keys()), content_type=content_type)
        for resource in resources:
            if resource:
                # Inject sharing metadata so consumers know context
                resource['_sharing'] = {
                    'role': resource_index.get(resource['_id'], {}).get('role'),
                    'organizationId': resource_index.get(resource['_id'], {}).get('organization', {}).get('_id'),
                    'isGlobal': resource_index.get(resource['_id'], {}).get('isGlobal', False)
                }
                raw_resources.append(resource)

        logger.debug(f"[sharing] Loaded {len(raw_resources)} raw shared resources for user {user_id} in tenant {tenant_id}")
        return {
            "success": True,
            "resources": raw_resources
        }

    except Exception as exc:  # pragma: no cover - defensive logging path
        logger.error(
            f"[sharing] Failed to load shared resources for user {user_id} and tenant {tenant_id}: {exc}",
            exc_info=True
        )
        return {
            "success": False,
            "error": str(exc)
        }


def _is_private_single_user_session(room_url: str, params: FunctionCallParams) -> bool:
    """Check if this is a private single-user session.
    
    Returns True if:
    - There is only one human participant in the call (excluding bot)
    - OR session metadata explicitly marks it as private
    
    Args:
        room_url: Daily room URL
        
    Returns:
        True if private/single-user session, False if multi-user group session
    """
    if os.getenv("BOT_SESSION_PRIVATE") == "1":
        logger.debug(f"[sharing] BOT_SESSION_PRIVATE env var set, treating as private session for room {room_url}")
        return True

    try:
        # Get participants from transport
        transport = params.forwarder.transport if params.forwarder else None
        if not transport:
            logger.debug(f"[sharing] No transport available for room {room_url}, assuming multi-user")
            return False

        if not hasattr(transport, 'participants') or not callable(transport.participants):
            logger.debug(f"[sharing] Transport does not support participants(), assuming multi-user")
            return False
        
        participants = transport.participants()
        
        # Count human participants (exclude 'local' which is the bot)
        human_count = sum(1 for pid in participants.keys() if pid != 'local')
        
        # Check if any participant has session metadata marking this as private
        logger.debug(
            f"[sharing] Session privacy probe: human_count={human_count}, participant_ids={[pid for pid in participants.keys() if pid != 'local']}"
        )

        for pid, data in participants.items():
            if pid == 'local':
                continue

            info = data.get('info', {})
            user_data = info.get('userData', {})
            session_metadata = user_data.get('session_metadata', {})

            def _coerce_bool(val: Any) -> bool:
                if isinstance(val, bool):
                    return val
                if isinstance(val, str):
                    return val.strip().lower() in ("1", "true", "yes", "on")
                return False

            private_flag = _coerce_bool(user_data.get('private')) or (
                isinstance(session_metadata, dict) and _coerce_bool(session_metadata.get('private'))
            )

            logger.debug(
                f"[sharing] Participant {pid} info_keys={list(info.keys()) if isinstance(info, dict) else 'n/a'} "
                f"userData_keys={list(user_data.keys()) if isinstance(user_data, dict) else 'n/a'} "
                f"session_metadata_keys={list(session_metadata.keys()) if isinstance(session_metadata, dict) else 'n/a'} "
                f"private_flag={private_flag}"
            )
            logger.debug(f"[sharing] Participant {pid} info: {info}, userData: {user_data}")
            logger.debug(f"[sharing] Participant {pid} session_metadata: {session_metadata}")
            
            if human_count == 1 and private_flag:
                logger.debug(f"[sharing] Private session flag detected in participant {pid}")
                return True

        logger.debug(f"[sharing] Multi-user group session detected: {human_count} human participants")
        return False
        
    except Exception as e:
        logger.error(f"[sharing] Error checking session type: {e}", exc_info=True)
        # Default to multi-user (allow group sharing) on error
        return False


async def _resolve_user_id(
    params: FunctionCallParams, 
    room_url: str
) -> tuple[str | None, str]:
    """Resolve userId using multiple strategies (fallback chain).
    
    Tries strategies in order:
    1. LLM provided userId explicitly in arguments
    2. Parse from LLM context (system prompt includes participant info)
    3. Single-user assumption (most common case)
    4. Most recent speaker (if VAD available - future)
    
    Returns:
        (user_id, error_message) - user_id is None if error
    """
    forwarder_present = params.forwarder is not None
    transport = getattr(params.forwarder, "transport", None) if forwarder_present else None
    participants_cached: dict[str, Any] | None = None
    participants_snapshot: dict[str, Any] | None = None

    if transport and hasattr(transport, "participants") and callable(transport.participants):
        try:
            participants_cached = transport.participants()
            human_participant_ids = [pid for pid in participants_cached.keys() if pid != 'local']
            participants_snapshot = {
                "total": len(participants_cached),
                "human_count": len(human_participant_ids),
                "human_ids": human_participant_ids,
            }
        except Exception as exc:  # pragma: no cover - defensive logging
            participants_snapshot = {"error": str(exc)}
    else:
        participants_snapshot = {"error": "participants_unavailable"}

    metadata_snapshot = {
        "room": room_url,
        "tool_name": getattr(params, "function_name", "unknown"),
        "argument_keys": list(params.arguments.keys()),
        "has_user_id_argument": bool(params.arguments.get("userId")),
        "context_type": type(params.context).__name__ if params.context is not None else None,
        "forwarder_present": forwarder_present,
        "transport_available": bool(transport),
        "participants_snapshot": participants_snapshot,
    }
    logger.info(f"[sharing.debug] _resolve_user_id metadata snapshot: {metadata_snapshot}")

    # Strategy 1: Check if LLM provided userId explicitly
    if user_id := params.arguments.get("userId"):
        logger.info(f"[sharing] userId from LLM argument: {user_id}")
        return _normalize_user_id(user_id), ""
    
    # Strategy 1.5: Check HandlerContext (injected by toolbox)
    handler_context = getattr(params, 'handler_context', None)
    if handler_context and hasattr(handler_context, 'user_id'):
        user_id = handler_context.user_id()
        if user_id:
            logger.info(f"[sharing] userId from HandlerContext: {user_id}")
            return _normalize_user_id(user_id), ""

    # Strategy 2: Parse from LLM context
    if params.context:
        user_id = _extract_user_from_context(params.context)
        if user_id:
            logger.info(f"[sharing] userId from LLM context: {user_id}")
            return _normalize_user_id(user_id), ""
    
    # Strategy 2.5: Parse participant_id from LLM context messages (most recent speaker)
    if params.context and isinstance(params.context, list):
        # Iterate backwards through messages to find the most recent user message
        for msg in reversed(params.context):
            if isinstance(msg, dict) and msg.get('role') == 'user':
                content = msg.get('content', '')
                # Look for [User ..., pid: <id>] pattern injected by context aggregator
                # Regex captures the ID after 'pid: '
                pid_pattern = r'\[User [^\]]+, pid: ([^\]]+)\]'
                matches = re.findall(pid_pattern, content)
                
                if matches:
                    # Use the last match in the message (most recent utterance in that turn)
                    participant_id = matches[-1]
                    logger.info(f"[sharing] Found participant_id in message history: {participant_id}")
                    
                    # Resolve to user_id using transport
                    # Get transport from forwarder if not already available
                    current_transport = transport or (params.forwarder.transport if params.forwarder else None)
                    
                    if current_transport and hasattr(current_transport, "participants"):
                        try:
                            # Use cached participants if available, otherwise fetch
                            current_participants = participants_cached if participants_cached is not None else current_transport.participants()
                            
                            if participant_id in current_participants:
                                p_data = current_participants[participant_id]
                                info = p_data.get('info', {})
                                # Try direct userId first, then sessionUserId
                                found_user_id = info.get('userId') or info.get('userData', {}).get('sessionUserId')
                                
                                if found_user_id:
                                    logger.info(f"[sharing] Resolved participant_id {participant_id} to user_id {found_user_id}")
                                    return _normalize_user_id(found_user_id), ""
                                else:
                                    logger.warning(f"[sharing] Participant {participant_id} found but has no userId in metadata")
                            else:
                                logger.warning(f"[sharing] Participant {participant_id} from context not found in current participants list")
                        except Exception as e:
                            logger.error(f"[sharing] Error resolving participant_id {participant_id}: {e}")
                    break

    # Strategy 3: Single-user assumption
    # Get transport from forwarder which has the transport reference
    transport = transport or (params.forwarder.transport if params.forwarder else None)
    if not transport:
        return None, "No transport available"
    
    participants = participants_cached if participants_cached is not None else transport.participants()
    logger.info(f"[sharing.debug] transport.participants() returned: {participants}")
    human_participants = []
    
    for pid, data in participants.items():
        if pid == 'local':  # Skip bot
            continue
        
        logger.info(f"[sharing.debug] Participant {pid}: data = {data}")
        # Daily.co transport.participants() structure: info.userId (primary) or info.userData.sessionUserId (fallback)
        info = data.get('info', {})
        
        # Try direct userId first (most common)
        user_id = info.get('userId')
        
        # Fallback to userData.sessionUserId if available
        if not user_id:
            user_data = info.get('userData', {})
            user_id = user_data.get('sessionUserId')
        
        user_name = info.get('userName') or info.get('userData', {}).get('sessionUserName', 'Unknown')
        logger.info(f"[sharing.debug] Extracted user_id: {user_id}, user_name: {user_name}")
        
        if user_id:
            human_participants.append((pid, user_id, user_name))
    
    if len(human_participants) == 0:
        return None, "No human participants found in call"
    
    if len(human_participants) == 1:
        logger.info(f"[sharing] userId from single-user: {human_participants[0][1]}")
        return human_participants[0][1], ""
    
    # Multi-user ambiguity
    user_names = [name for _, _, name in human_participants]
    return None, f"Multiple participants detected ({', '.join(user_names)}). Please specify whose resources to access."


def _extract_user_from_context(context: Any) -> str | None:
    """Extract userId from LLM conversation context.
    
    Parses system prompt or recent messages for userId references.
    Looks for patterns like:
    - "userId: <uuid>"
    - User mentions in system prompt
    
    Args:
        context: LLM conversation context (messages, system prompt, etc.)
        
    Returns:
        userId string if found, None otherwise
    """
    import re
    
    if not context:
        return None
    
    # Convert context to string for parsing
    context_str = str(context)
    
    # Pattern 1: "userId: <uuid>" or "sessionUserId: <uuid>"
    user_id_pattern = r'(?:userId|sessionUserId):\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
    match = re.search(user_id_pattern, context_str, re.IGNORECASE)
    if match:
        user_id = match.group(1)
        logger.info(f"[sharing] Extracted userId from context: {user_id}")
        return user_id
    
    # Pattern 2: Check if context is a dict/object with nested user data
    if isinstance(context, dict):
        # Try common paths where userId might be stored
        paths_to_check = [
            ['user', 'id'],
            ['user', 'userId'],
            ['participant', 'userId'],
            ['participant', 'info', 'userData', 'sessionUserId'],
            ['userData', 'sessionUserId'],
            ['sessionUserId'],
            ['userId']
        ]
        
        for path in paths_to_check:
            obj = context
            for key in path:
                if isinstance(obj, dict) and key in obj:
                    obj = obj[key]
                else:
                    obj = None
                    break

            # Check if we found a valid UUID
            if obj and isinstance(obj, str):
                uuid_pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                if re.match(uuid_pattern, obj, re.IGNORECASE):
                    logger.info(f"[sharing] Extracted userId from context path {'.'.join(path)}: {obj}")
                    return obj
    
    return None

async def _find_sharing_organization_for_resource(
    tenant_id: str,
    owner_user_id: str,
    resource_id: str,
    content_type: str
) -> dict | None:
    """Find the sharing organization that contains a specific resource.
    
    Looks for organizations where:
    - The owner has an owner role
    - The resource is in the organization's sharedResources map
    
    This prevents creating duplicate organizations - the Interface creates
    organizations named "Share:{contentType}:{resourceId}" when sharing is
    first initiated.
    
    Args:
        tenant_id: Tenant identifier
        owner_user_id: Owner's user ID
        resource_id: Resource ID (note or applet)
        content_type: 'Notes' or 'HtmlGeneration'
        
    Returns:
        Organization dict or None if not found
    """
    try:
        
        # Step 1: Get all organizations where owner has owner role
        role_where = {
            "AND": [
                {"parent_id": {"eq": owner_user_id}},
                {"indexer": {"path": "role", "equals": "owner"}}
            ]
        }
        
        role_params = {
            "tenant": "any",
            "where": json.dumps(role_where, separators=(',', ':')),
        }
        
        role_response = await mesh_client.request("GET", "/content/UserOrganizationRole", params=role_params)
        
        if not role_response.get("success") or not role_response.get("data"):
            logger.warning(f"[sharing] No owner roles found for user {owner_user_id}")
            return None
        
        owner_roles = role_response.get("data", [])
        
        # Step 2: For each organization, check if it contains the resource
        for role in owner_roles:
            org_id = role.get('organizationId')
            if not org_id:
                continue
            
            # Get the organization
            org_where = {"page_id": {"eq": org_id}}
            org_params = {
                "tenant": "any",
                "where": json.dumps(org_where, separators=(',', ':')),
                "limit": "1"
            }
            
            org_response = await mesh_client.request("GET", "/content/Organization", params=org_params)
            
            if not org_response.get("success") or not org_response.get("data"):
                continue
            
            orgs = org_response.get("data", [])
            if not orgs:
                continue
            
            org = orgs[0]
            shared_resources = org.get('sharedResources', {})
            
            # Check if this organization has the resource
            if resource_id in shared_resources and shared_resources[resource_id] == content_type:
                logger.info(f"[sharing] Found sharing organization {org_id} for {content_type} {resource_id}")
                return org
        
        logger.warning(f"[sharing] No sharing organization found for {content_type} {resource_id}")
        return None
        
    except Exception as e:
        logger.error(f"[sharing] Failed to find sharing organization: {e}", exc_info=True)
        return None


async def _create_sharing_organization(
    tenant_id: str,
    owner_user_id: str,
    resource_id: str,
    content_type: str,
    resource_title: str
) -> dict | None:
    """Create a new sharing organization for a resource.
    
    Creates an organization with:
    - Name: "Share:{contentType}:{resourceId}"
    - sharedResources containing the resource
    - Owner role assigned to the creator
    
    Args:
        tenant_id: Tenant identifier
        owner_user_id: Owner's user ID
        resource_id: Resource ID (note or applet)
        content_type: 'Notes' or 'HtmlGeneration'
        resource_title: Resource title for description
        
    Returns:
        Organization dict or None if creation failed
    """
    try:
        
        # Create organization with Share: prefix (matching Interface naming)
        org_name = f"Share:{content_type}:{resource_id}"
        
        org_data = {
            "name": org_name,
            "tenantId": tenant_id,
            "description": f"Sharing organization for {content_type}: {resource_title}",
            "settings": {
                "resourceSharing": True,
                "resourceOwnerUserId": owner_user_id
            },
            "sharedResources": {
                resource_id: content_type
            }
        }
        
        payload = {"content": org_data}
        create_params = {"tenant": "any"}
        
        create_response = await mesh_client.request(
            "POST",
            "/content/Organization",
            params=create_params,
            json_body=payload
        )
        
        if not create_response.get("success") or not create_response.get("data"):
            logger.error(f"[sharing] Failed to create organization: {create_response.get('error')}")
            return None
        
        new_org = create_response.get("data")
        logger.info(f"[sharing] Created sharing organization: {org_name} with ID {new_org.get('_id')}")
        
        # Assign owner role to creator
        if new_org.get('_id'):
            await sharing_actions.assign_user_to_organization(
                tenant_id=tenant_id,
                user_id=owner_user_id,
                organization_id=new_org['_id'],
                role='owner'
            )
        
        return new_org
        
    except Exception as e:
        logger.error(f"[sharing] Failed to create sharing organization: {e}", exc_info=True)
        return None


async def _fuzzy_find_user(
    room_url: str,
    user_email: str | None = None,
    user_name: str | None = None,
    resource_id: str | None = None,
    content_type: str | None = None,
    tenant_id: str | None = None
) -> tuple[str | None, str]:
    """Find a user using 4-strategy fallback approach.
    
    Strategies (in order):
    0. Organization members (if resource_id provided) - allows single name match
    1. Email database lookup (fuzzy match)
    2. Name in call participants (exact match)
    3. Name across all users (requires full name for fuzzy, or exact match for single name)
    
    Args:
        room_url: Daily room URL for participant lookup
        user_email: Optional email to search
        user_name: Optional name to search
        resource_id: Optional resource ID to check sharing organization members first
        content_type: Optional content type ('Notes' or 'HtmlGeneration') for resource lookup
        tenant_id: Optional tenant ID for resource lookup
        
    Returns:
        (user_id, error_message) - user_id is None if not found
    """
    
    target_user_id = None
    
    # Strategy 0: Check organization members first if we have a resource context
    # This allows single-name matches since we're searching within a small known group
    if resource_id and content_type and tenant_id and user_name:
        logger.info(f"[sharing] Strategy 0: Searching organization members for resource {resource_id}")
        
        # First, find the organization for this resource
        try:
            # Find organization that contains this resource
            org_where = {
                "indexer": {
                    "path": f"sharedResources.{resource_id}",
                    "equals": content_type
                }
            }
            org_params = {
                "tenant": "any",
                "where": json.dumps(org_where, separators=(',', ':')),
                "limit": "1"
            }
            
            org_response = await mesh_client.request("GET", "/content/Organization", params=org_params)
            
            if org_response.get("success") and org_response.get("data"):
                org = org_response["data"][0] if org_response["data"] else None
                
                if org:
                    org_id = org.get('_id')
                    logger.info(f"[sharing] Found organization {org_id} for resource")
                    
                    # Get all UserOrganizationRole records for this organization
                    role_where = {
                        "indexer": {
                            "path": "organization_id",
                            "equals": org_id
                        }
                    }
                    role_params = {
                        "tenant": "any",
                        "where": json.dumps(role_where, separators=(',', ':')),
                        "limit": "100"
                    }
                    
                    role_response = await mesh_client.request("GET", "/content/UserOrganizationRole", params=role_params)
                    
                    if role_response.get("success") and role_response.get("data"):
                        roles = role_response["data"]
                        logger.info(f"[sharing] Found {len(roles)} organization members")
                        
                        # Get user details for each role
                        search_term = user_name.lower().strip()
                        
                        for role in roles:
                            user_id = role.get('parent_id')  # parent_id is the user_id
                            if not user_id:
                                continue
                            
                            # Fetch user details
                            user_response = await mesh_client.request("GET", f"/content/User/{user_id}", params={"tenant": "any"})
                            if user_response.get("success") and user_response.get("data"):
                                user = user_response["data"]
                                user_name_field = user.get('name', '').lower()
                                
                                # Exact match
                                if user_name_field == search_term:
                                    logger.info(f"[sharing] Found exact name match in organization: {user_name} → {user_id}")
                                    return user_id, ""
                        
                        # Second pass: fuzzy match (allows single names here since we're in a known group)
                        best_match = None
                        best_similarity = 0.0
                        best_user_id = None
                        
                        for role in roles:
                            user_id = role.get('parent_id')
                            if not user_id:
                                continue
                            
                            user_response = await mesh_client.request("GET", f"/content/User/{user_id}", params={"tenant": "any"})
                            if user_response.get("success") and user_response.get("data"):
                                user = user_response["data"]
                                user_name_field = user.get('name', '').lower()
                                similarity = SequenceMatcher(None, search_term, user_name_field).ratio()
                                
                                if similarity > best_similarity and similarity >= 0.6:
                                    best_similarity = similarity
                                    best_match = user_name_field
                                    best_user_id = user_id
                        
                        if best_user_id:
                            logger.info(f"[sharing] Found fuzzy match in organization: {user_name} → {best_match} → {best_user_id} (similarity: {best_similarity:.2f})")
                            return best_user_id, ""
                        
                        logger.info(f"[sharing] No match found in organization members")
        except Exception as e:
            logger.warning(f"[sharing] Error searching organization members: {e}")
        
        logger.info(f"[sharing] Falling back to broader search")
    
    # Strategy 1: Look up by email in database if provided
    if user_email:
        users = await _fuzzy_search_user_by_email(user_email, limit=5)
        if users:
            target_user_id = users[0].get('_id')
            logger.info(f"[sharing] Found user by email: {user_email} → {target_user_id}")
            return target_user_id, ""
        else:
            logger.warning(f"[sharing] No user found by email: {user_email}")
    
    # Strategy 2: Look up by name in call participants (if email lookup failed)
    if not target_user_id and user_name:
        transport = _get_transport()
        if transport and hasattr(transport, 'participants'):
            participants = transport.participants()
            
            for pid, data in participants.items():
                if pid == 'local':
                    continue
                
                info = data.get('info', {})
                if info.get('userName') == user_name:
                    target_user_id = info.get('userId')
                    logger.info(f"[sharing] Found user by name in call: {user_name} → {target_user_id}")
                    return target_user_id, ""
    
    # Strategy 3: If still not found and we have a name, try searching all users by name
    if not target_user_id and user_name:
        user_where = {}
        user_params = {
            "tenant": "any",
            "where": json.dumps(user_where, separators=(',', ':')),
            "limit": "200"
        }
        
        user_response = await mesh_client.request("GET", "/content/User", params=user_params)
        
        if user_response.get("success") and user_response.get("data"):
            users = user_response.get("data", [])
            search_term = user_name.lower().strip()
            
            # Check for exact match first
            exact_match = None
            for user in users:
                user_name_field = user.get('name', '').lower()
                if user_name_field == search_term:
                    exact_match = user
                    break
            
            if exact_match:
                target_user_id = exact_match.get('_id')
                logger.info(f"[sharing] Found user by exact name match: {user_name} → {target_user_id}")
                return target_user_id, ""
            
            # No exact match - require first and last name for fuzzy search
            # to avoid matching on common single names like "Bill" or "John"
            if ' ' not in search_term.strip():
                logger.warning(f"[sharing] Name '{user_name}' appears to be a single name without exact match. Require first and last name for fuzzy search.")
                return None, f"Please provide both first and last name for '{user_name}', or use their email address."
            
            # Fuzzy search with first and last name
            best_match = None
            best_similarity = 0.0
            
            for user in users:
                user_name_field = user.get('name', '').lower()
                similarity = SequenceMatcher(None, search_term, user_name_field).ratio()
                
                if similarity > best_similarity and similarity >= 0.6:
                    best_similarity = similarity
                    best_match = user
            
            if best_match:
                target_user_id = best_match.get('_id')
                logger.info(f"[sharing] Found user by fuzzy name search: {user_name} → {target_user_id} (similarity: {best_similarity:.2f})")
                return target_user_id, ""
    
    # Not found
    user_identifier = user_email or user_name or "user"
    return None, f"User not found: {user_identifier}. Try providing their email address."


async def _fuzzy_search_user_by_email(
    email_query: str,
    limit: int = 5
) -> list[dict]:
    """Fuzzy search for users by email address using SequenceMatcher.
    
    Uses the same fuzzy matching logic as fuzzy_search_notes:
    - SequenceMatcher calculates similarity ratio
    - Only returns matches with similarity >= 0.6
    - Results sorted by similarity (best first)
    
    Note: Users are platform-wide (tenant='any'), not tenant-scoped.
    The tenant_id parameter is kept for future filtering needs.
    
    Args:
        email_query: Email to search (e.g., "bill@niaxp.com")
        limit: Maximum results to return
        
    Returns:
        List of user dicts with _id, email, name fields, sorted by similarity
    """
    try:
        
        # Query all users - users are platform-wide, not tenant-scoped
        where = {}
        
        params = {
            "tenant": "any",  # User definitions are platform-wide
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "200"  # Get all users to calculate similarity
        }
        
        response = await mesh_client.request("GET", "/content/User", params=params)
        
        if not response.get("success") or not response.get("data"):
            logger.info(f"[sharing] No users found in platform")
            return []
        
        users = response.get("data", [])
        logger.info(f"[sharing] Found {len(users)} platform users, matching against '{email_query}'")
        
        # Normalize search term
        search_term = email_query.lower().strip()
        
        # Calculate similarity scores for each user (same as fuzzy_search_notes)
        matches = []
        for user in users:
            email = user.get('email', '').lower().strip()
            
            # Calculate similarity using SequenceMatcher (same as notes)
            similarity = SequenceMatcher(None, search_term, email).ratio()
            
            # Only include matches above threshold (0.6, same as notes)
            if similarity >= 0.6:
                matches.append({
                    'similarity': similarity,
                    '_id': user.get('_id'),
                    'email': user.get('email'),
                    'name': user.get('name', 'Unknown')
                })
                logger.debug(
                    f"[sharing] User '{email}' similarity: {similarity:.2f} "
                    f"(threshold: 0.6)"
                )
        
        # Sort by similarity descending (best match first)
        matches.sort(key=lambda u: u['similarity'], reverse=True)
        
        # Log best matches
        if matches:
            logger.info(
                f"[sharing] Best match for '{email_query}': "
                f"'{matches[0]['email']}' (similarity: {matches[0]['similarity']:.2f})"
            )
        else:
            logger.info(f"[sharing] No users matched '{email_query}' above threshold 0.6")
        
        # Remove similarity from results before returning
        results = [
            {'_id': m['_id'], 'email': m['email'], 'name': m['name']}
            for m in matches[:limit]
        ]
        
        return results
        
    except Exception as e:
        logger.error(f"[sharing] Failed to search users: {e}", exc_info=True)
        return []
