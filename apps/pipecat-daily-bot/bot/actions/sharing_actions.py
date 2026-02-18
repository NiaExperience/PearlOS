"""Sharing organization management business logic.

This module handles organization and role operations for resource sharing:
- Organization CRUD (create, read) for call-based sharing
- UserOrganizationRole assignments
- SharedResource management
- User lookup by ID

All functions are tenant-scoped for security.

Architecture (following notes_actions.py pattern):
- Builds Mesh /content API queries with where clauses
- Calls mesh_client.request() for HTTP execution (GET/POST/PUT)
- Validates responses and transforms data
- Returns business objects

Content Types:
- /content/Organization - Organization records with sharedResources
- /content/UserOrganizationRole - User-to-organization role assignments
- /content/User - User profile data
"""

import sys
import os
import json
from typing import Dict, List, Literal
from loguru import logger

# Add parent directory to path for mesh_client import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def get_or_create_call_sharing_organization(
    tenant_id: str,
    room_url: str,
    owner_user_id: str
) -> dict | None:
    """Get or create sharing organization for this call.
    
    Organization name: "DailyCall:{room_url}"
    
    Uses /content/Organization API to query and create organizations.
    
    Args:
        tenant_id: Tenant identifier for data isolation
        room_url: Daily room URL (unique per call)
        owner_user_id: User ID of the call owner/creator
        
    Returns:
        Organization document or None on error
    """
    try:
        from services import mesh as mesh_client
        
        org_name = f"DailyCall:{room_url}"
        
        # BUILD QUERY: Find existing organization by name
        where = {
            "parent_id": {"eq": tenant_id},
            "indexer": {"path": "name", "equals": org_name}
        }

        params = {
            "tenant": "any", # Organization is a platform-level definition, use 'any'
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        
        # EXECUTE: Query existing organizations
        response = await mesh_client.request("GET", "/content/Organization", params=params)
        
        if response.get("success") and response.get("data"):
            orgs = response.get("data", [])
            if orgs:
                logger.info(f"[sharing_actions] Found existing organization: {org_name}")
                return orgs[0]
        
        # CREATE: New organization if not found
        # Start with minimal required fields only
        org_data = {
            "name": org_name,
            "tenantId": tenant_id,
            "settings": {
                "resourceSharing": True,
                "resourceOwnerUserId": owner_user_id
            },
        }
        payload = {"content": org_data}
        create_params = {
            "tenant": "any",  # Use 'any' for platform-level creation
        }

        create_response = await mesh_client.request(
            "POST",
            "/content/Organization",
            params=create_params,
            json_body=payload
        )
        
        if create_response.get("success") and create_response.get("data"):
            new_org = create_response.get("data")
            logger.info(f"[sharing_actions] Created organization: {org_name} with ID {new_org.get('_id')}")
            
            # AUTO-ASSIGN owner role to creator
            if new_org.get('_id'):
                await assign_user_to_organization(
                    tenant_id=tenant_id,
                    user_id=owner_user_id,
                    organization_id=new_org['_id'],
                    role='owner'
                )
            
            return new_org
        else:
            logger.error(f"[sharing_actions] Failed to create organization: {create_response.get('error')}")
            return None
            
    except Exception as e:
        logger.error(f"[sharing_actions] Failed in get_or_create_call_sharing_organization: {e}", exc_info=True)
        return None


async def share_resource_with_user(
    tenant_id: str,
    organization_id: str,
    user_id: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration'],
    role: str = 'viewer'
) -> bool:
    """Share resource with user by adding to org and assigning role.
    
    Steps:
    1. Get organization to check current sharedResources
    2. Add resource to organization.sharedResources (if not already present)
    3. Assign user to organization with specified role (if not already assigned)
    
    Uses /content/Organization API for updates.
    
    Args:
        tenant_id: Tenant identifier
        organization_id: Organization _id
        user_id: User _id to share with
        resource_id: Note or HtmlGeneration _id
        content_type: 'Notes' or 'HtmlGeneration'
        role: Organization role (default 'viewer' for read-only access)
        
    Returns:
        True if successful, False otherwise
    """
    try:
        from services import mesh as mesh_client
        
        # Step 1: Get organization to check current sharedResources
        where = {"page_id": {"eq": organization_id}}

        params = {
            "tenant": "any", # Platform definitions use 'any'
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        
        response = await mesh_client.request("GET", "/content/Organization", params=params)
        
        if not response.get("success") or not response.get("data"):
            logger.error(f"[sharing_actions] Organization not found: {organization_id}")
            return False
        
        org = response.get("data", [{}])[0]
        shared_resources = org.get('sharedResources', {})
        
        # Step 2: Add resource to sharedResources if not already present
        # sharedResources format: { "resourceId": "contentType", ... }
        if resource_id not in shared_resources or shared_resources[resource_id] != content_type:
            shared_resources[resource_id] = content_type
            
            # UPDATE organization
            update_data = org
            update_data["sharedResources"] = shared_resources
            update_params = {"tenant": "any"}
            payload = {"content": update_data}
            update_response = await mesh_client.request(
                "PUT",
                f"/content/Organization/{organization_id}",
                params=update_params,
                json_body=payload
            )
            
            if not update_response.get('success'):
                logger.error(f"[sharing_actions] Failed to update organization sharedResources")
                return False
            
            logger.info(f"[sharing_actions] Added {content_type} {resource_id} to organization {organization_id}")

        # Step 3: Assign user to organization with role
        success = await assign_user_to_organization(
            tenant_id=tenant_id,
            user_id=user_id,
            organization_id=organization_id,
            role=role
        )
        
        return success
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to share resource: {e}", exc_info=True)
        return False


async def assign_user_to_organization(
    tenant_id: str,
    user_id: str,
    organization_id: str,
    role: str = 'member'
) -> bool:
    """Assign user to organization with specified role.
    
    Creates UserOrganizationRole via /content/UserOrganizationRole API.
    Idempotent - returns True if role already exists.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User _id
        organization_id: Organization _id
        role: Role to assign (owner/admin/member/viewer, default member)
        
    Returns:
        True if successful (including if already exists), False on error
    """
    try:
        from services import mesh as mesh_client
        
        # Check if user already has a role in this organization
        # UserOrganizationRole has parent_id = user_id (not tenant_id)
        where = {
            "AND": [
                {"parent_id": {"eq": user_id}},
                {"indexer": {"path": "organizationId", "equals": organization_id}}
            ]
        }
        
        params = {
            "tenant": "any", # Platform definitions use 'any'
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        
        check_response = await mesh_client.request("GET", "/content/UserOrganizationRole", params=params)
        
        if check_response.get("success") and check_response.get("data"):
            existing_roles = check_response.get("data", [])
            if existing_roles:
                logger.info(f"[sharing_actions] User {user_id} already has role in org {organization_id}")
                return True
        
        # Create new UserOrganizationRole
        role_data = {
            "userId": user_id,
            "organizationId": organization_id,
            "tenantId": tenant_id,
            "role": role
        }
        
        payload = {"content": role_data}
        create_params = {"tenant": "any"}  # Use 'any' for platform-level creation
        create_response = await mesh_client.request(
            "POST",
            "/content/UserOrganizationRole",
            params=create_params,
            json_body=payload
        )
        
        if create_response.get("success") and create_response.get("data"):
            logger.info(f"[sharing_actions] Assigned user {user_id} to org {organization_id} with role {role}")
            return True
        else:
            logger.error(f"[sharing_actions] Failed to create UserOrganizationRole: {create_response.get('error')}")
            return False
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to assign user to organization: {e}", exc_info=True)
        return False


async def get_user_by_id(tenant_id: str, user_id: str) -> dict | None:
    """Query user data from Mesh by userId.
    
    Uses /content/User API.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User _id
        
    Returns:
        User document or None if not found
    """
    try:
        from services import mesh as mesh_client
        
        where = {"page_id": {"eq": user_id}}
        
        params = {
            "tenant": "any",
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        
        response = await mesh_client.request("GET", "/content/User", params=params)
        
        if response.get("success") and response.get("data"):
            users = response.get("data", [])
            if users:
                logger.debug(f"[sharing_actions] Found user: {user_id}")
                return users[0]
        
        logger.warning(f"[sharing_actions] User not found: {user_id}")
        return None
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to get user by ID: {e}", exc_info=True)
        return None


async def get_or_create_user_by_email(tenant_id: str, email: str, name: str | None = None) -> dict | None:
    """Get existing user by email or create new user if doesn't exist.
    
    Uses /content/User API.
    
    Args:
        tenant_id: Tenant identifier
        email: User's email address
        name: Optional user display name (defaults to email if not provided)
        
    Returns:
        User document with _id, email, name fields, or None on error
    """
    try:
        from services import mesh as mesh_client
        
        # Step 1: Try to find existing user by email
        where = {
            "parent_id": {"eq": tenant_id},
            "email": {"eq": email}
        }
        
        params = {
            "tenant": "any",
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        
        response = await mesh_client.request("GET", "/content/User", params=params)
        
        if response.get("success") and response.get("data"):
            users = response.get("data", [])
            if users:
                logger.info(f"[sharing_actions] Found existing user: {email}")
                return users[0]
        
        # Step 2: User doesn't exist, create new user
        logger.info(f"[sharing_actions] Creating new user: {email}")
        
        user_name = name or email.split('@')[0]  # Use email prefix as default name
        
        user_data = {
            "contentType": "User",
            "parent_id": tenant_id,
            "email": email,
            "name": user_name
        }
        
        create_params = {"tenant": "any"}
        payload = {"content": user_data}
        
        create_response = await mesh_client.request(
            "POST",
            "/content/User",
            params=create_params,
            json_body=payload
        )
        
        if not create_response.get("success"):
            logger.error(f"[sharing_actions] Failed to create user: {email}")
            return None
        
        new_user = create_response.get("data")
        logger.info(f"[sharing_actions] Created new user: {email} ({new_user.get('_id')})")
        return new_user
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to get/create user by email: {e}", exc_info=True)
        return None

async def get_resources_by_id(
    tenant_id: str,
    resource_ids: list[str],
    content_type: Literal['Notes', 'HtmlGeneration']
) -> dict | None:
    """Get resource (Notes or HtmlGeneration) by ID.
    
    Uses /content/{ContentType}/{id} API for direct ID lookup.
    
    Args:
        tenant_id: Tenant identifier
        resource_id: Resource _id
        content_type: 'Notes' or 'HtmlGeneration'
        
    Returns:
        Resource document or None if not found
    """
    try:
        from services import mesh as mesh_client
        
        # API paths: Both Notes and HtmlGeneration use their exact names (no pluralization)
        # Notes uses /content/Notes
        # HtmlGeneration uses /content/HtmlGeneration (NOT HtmlGenerations)
        api_path = f'/content/{content_type}'
        
        path = f"{api_path}"
        where = {"OR": [
                 {"page_id": {"eq": resource_id}} for resource_id in resource_ids
        ]}
        params = {
            "tenant": tenant_id,
            "where": json.dumps(where, separators=(',', ':'))
        }
        
        logger.info(
            f"[sharing_actions] 📡 FETCHING RESOURCES - "
            f"path={path}, tenant_id={tenant_id}, resource_ids={resource_ids}, content_type={content_type}"
        )
        
        response = await mesh_client.request("GET", path, params=params)
        
        if response.get("success"):
            data = response.get("data", [])
            logger.debug(f"[sharing_actions] Found {len(data)} resources")
            return data
        return None
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to get resource: {e}", exc_info=True)
        return None


async def get_resource_by_id(
    tenant_id: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration']
) -> dict | None:
    """Get resource (Notes or HtmlGeneration) by ID.
    
    Uses /content/{ContentType}/{id} API for direct ID lookup.
    
    Args:
        tenant_id: Tenant identifier
        resource_id: Resource _id
        content_type: 'Notes' or 'HtmlGeneration'
        
    Returns:
        Resource document or None if not found
    """
    try:
        from services import mesh as mesh_client
        
        # API paths: Both Notes and HtmlGeneration use their exact names (no pluralization)
        # Notes uses /content/Notes
        # HtmlGeneration uses /content/HtmlGeneration (NOT HtmlGenerations)
        api_path = f'/content/{content_type}'
        
        path = f"{api_path}/{resource_id}"

        params = {"tenant": tenant_id} # resources are defined per-tenant
        
        logger.info(
            f"[sharing_actions] 📡 FETCHING RESOURCE - "
            f"path={path}, tenant_id={tenant_id}, resource_id={resource_id}, content_type={content_type}"
        )
        
        response = await mesh_client.request("GET", path, params=params)
        
        if response.get("success") and response.get("data"):
            return response.get("data")
        
        logger.debug(f"[sharing_actions] Resource not found via {path}: {content_type} {resource_id}")

        
        return None
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to get resource: {e}", exc_info=True)
        return None


async def check_resource_owner(
    tenant_id: str,
    user_id: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration']
) -> bool:
    """Check if user owns resource.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User _id to check
        resource_id: Resource _id
        content_type: 'Notes' or 'HtmlGeneration'
        
    Returns:
        True if user owns resource, False otherwise
    """
    try:
        logger.info(
            f"[sharing_actions] 👤 CHECK RESOURCE OWNER - "
            f"tenant_id={tenant_id}, user_id={user_id}, resource_id={resource_id}, content_type={content_type}"
        )
        resource = await get_resource_by_id(tenant_id, resource_id, content_type)
        if not resource:
            logger.warning(f"[sharing_actions] ❌ RESOURCE NOT FOUND - resource_id={resource_id}, content_type={content_type}")
            return False

        # TODO: change 'createdBy' to 'userId' in HtmlGeneration for consistency
        # and migrate existing data
        # Notes uses 'userId', HtmlGeneration uses 'createdBy'
        owner_field = 'userId' if content_type == 'Notes' else 'createdBy'
        owner_id = resource.get(owner_field)

        logger.debug(f"[sharing_actions] Resource {content_type} {resource_id} owned by {owner_id}, checking against {user_id}")
        
        # Log ALL ownership-related fields for debugging
        logger.info(
            f"[sharing_actions] 📝 RESOURCE FIELDS - "
            f"userId={resource.get('userId')}, "
            f"createdBy={resource.get('createdBy')}, "
            f"owner_field={owner_field}, "
            f"owner_id={owner_id}, "
            f"checking_user_id={user_id}, "
            f"match={owner_id == user_id}"
        )
        
        is_owner = owner_id == user_id
        if is_owner:
            logger.info(f"[sharing_actions] ✅ IS OWNER - User {user_id} owns {content_type} {resource_id}")
        else:
            logger.info(f"[sharing_actions] ❌ NOT OWNER - User {user_id} does NOT own {content_type} {resource_id} (owner={owner_id})")
        
        return is_owner
        
    except Exception as e:
        logger.error(f"[sharing_actions] ⚠️ ERROR checking resource owner: {e}", exc_info=True)
        return False

async def check_resource_read_permission(
    tenant_id: str,
    user_id: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration']
) -> bool:
    """Check if user has read permission for resource.
    
    Read permission is granted if:
    - User is the resource owner, OR
    - For work notes: User is in the same tenant as the note, OR
    - User has any role (owner/admin/member/viewer) in organization that shares this resource
    
    Args:
        tenant_id: Tenant identifier
        user_id: User _id to check
        resource_id: Resource _id
        content_type: 'Notes' or 'HtmlGeneration'

    Returns:
        True if user has read permission, False otherwise
    """
    try:
        from services import mesh as mesh_client

        logger.info(
            f"[sharing_actions] 🔐 CHECK READ PERMISSION - "
            f"tenant_id={tenant_id}, user_id={user_id}, resource_id={resource_id}, content_type={content_type}"
        )
        logger.info(
            f"[sharing_actions] 📊 PERMISSION CHECK CONTEXT - "
            f"tenant_id='{tenant_id}', user_id='{user_id}', resource_id='{resource_id}'"
        )
        
        # Step 1: Check if user owns the resource (always has read access)
        is_owner = await check_resource_owner(tenant_id, user_id, resource_id, content_type)
        logger.info(f"[sharing_actions] 👤 OWNERSHIP CHECK - is_owner={is_owner}, user_id={user_id}, resource_id={resource_id}")
        
        if is_owner:
            logger.info(
                f"[sharing_actions] ✅ OWNER ACCESS - "
                f"User {user_id} is owner of {content_type} {resource_id} "
                f"(tenant_id={tenant_id})"
            )
            return True
        
        # Step 2: For Notes, check if it's a work note (tenant-scoped)
        if content_type == 'Notes':
            resource = await get_resource_by_id(tenant_id, resource_id, content_type)
            if resource:
                note_mode = resource.get('mode', 'personal')
                note_tenant_id = resource.get('tenantId')
                note_user_id = resource.get('userId')
                
                logger.info(
                    f"[sharing_actions] 📝 NOTE DETAILS - "
                    f"mode={note_mode}, note_tenant_id={note_tenant_id}, note_user_id={note_user_id}, "
                    f"user_tenant_id={tenant_id}, user_id={user_id}"
                )
                
                # Work notes: Check if user is in same tenant
                if note_mode == 'work' and note_tenant_id:
                    if note_tenant_id == tenant_id:
                        logger.info(
                            f"[sharing_actions] ✅ WORK NOTE TENANT ACCESS - "
                            f"User {user_id} is in same tenant ({tenant_id}) as work note {resource_id} "
                            f"(note_tenant_id={note_tenant_id}, user_tenant_id={tenant_id})"
                        )
                        return True
                    else:
                        logger.warning(
                            f"[sharing_actions] ❌ WORK NOTE TENANT MISMATCH - "
                            f"Note tenant ({note_tenant_id}) != user tenant ({tenant_id}) "
                            f"(user_id={user_id}, resource_id={resource_id})"
                        )
            return False

        # Step 3: See if resource is shared to all (read-only)
        # Note: The 'equals' value must be a string for the GraphQL schema, even for boolean fields
        global_where = { "AND": [
            {"indexer": {"path": "sharedToAllReadOnly", "equals": True}},
            {"indexer": {"path": "sharedResources", "contains": resource_id}}
        ]}
        global_params = {
            "tenant": "any",
            "where": json.dumps(global_where, separators=(',', ':')),
            "limit": "100" # Reasonable limit for now
        }
        global_response = await mesh_client.request("GET", "/content/Organization", params=global_params)
        if global_response.get("success") and global_response.get("data"):
            global_orgs = global_response.get("data", [])
            if global_orgs:
                logger.info(
                    f"[sharing_actions] ✅ GLOBAL SHARED ACCESS - "
                    f"Resource {content_type} {resource_id} is globally shared read-only "
                    f"(tenant_id={tenant_id})"
                )
                return True

        # Step 4: Check organization role (for personal notes or explicitly shared resources)
        logger.info(
            f"[sharing_actions] 🏢 CHECKING ORG ROLE - "
            f"tenant_id={tenant_id}, user_id={user_id}, resource_id={resource_id}"
        )
        role_result = await get_user_role_for_resource(tenant_id, user_id, resource_id, content_type)
        logger.info(
            f"[sharing_actions] 🏢 ORG ROLE RESULT - "
            f"role={role_result}, tenant_id={tenant_id}, user_id={user_id}, resource_id={resource_id}"
        )

        if not role_result:
            logger.warning(
                f"[sharing_actions] ❌ NO ACCESS - "
                f"User {user_id} has no organization role for {content_type} {resource_id} "
                f"(tenant_id={tenant_id})"
            )
            return False

        has_read = role_result in ['owner', 'admin', 'member', 'viewer']
        if has_read:
            logger.info(
                f"[sharing_actions] ✅ ORG ROLE ACCESS - "
                f"User {user_id} has role '{role_result}' for {content_type} {resource_id}, read=True "
                f"(tenant_id={tenant_id})"
            )
            return True

        logger.warning(
            f"[sharing_actions] ❌ INSUFFICIENT ROLE - "
            f"User {user_id} has role '{role_result}' but it doesn't grant read access "
            f"(tenant_id={tenant_id}, resource_id={resource_id})"
        )
        return False
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to check read permission: {e}", exc_info=True)
        return False



async def check_resource_write_permission(
    tenant_id: str,
    user_id: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration']
) -> bool:
    """Check if user has write permission for resource.
    
    Write permission is granted if:
    - User is the resource owner, OR
    - User has owner/admin/member role in organization that shares this resource
    
    viewer role grants read-only access (returns False).
    
    Note: Write permission allows editing content but NOT deletion.
    Use check_resource_delete_permission() for delete checks.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User _id to check
        resource_id: Resource _id
        content_type: 'Notes' or 'HtmlGeneration'
        
    Returns:
        True if user has write permission, False otherwise
    """
    try:
        # Step 1: Check if user owns the resource (always has write access)
        is_owner = await check_resource_owner(tenant_id, user_id, resource_id, content_type)
        if is_owner:
            logger.info(f"[sharing_actions] User {user_id} is owner of {content_type} {resource_id}")
            return True
        
        # Step 2: Check organization role
        role = await get_user_role_for_resource(tenant_id, user_id, resource_id, content_type)
        
        if not role:
            logger.info(f"[sharing_actions] User {user_id} has no access to {content_type} {resource_id}")
            return False
        
        # Step 3: viewer role = read-only, member/admin/owner = write access
        has_write = role in ['owner', 'admin', 'member']
        logger.info(f"[sharing_actions] User {user_id} has role {role} for {content_type} {resource_id}, write={has_write}")
        return has_write
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to check write permission: {e}", exc_info=True)
        return False


async def check_resource_delete_permission(
    tenant_id: str,
    user_id: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration']
) -> bool:
    """Check if user has delete permission for resource.
    
    Delete permission is granted if:
    - User is the resource owner, OR
    - User has owner/admin role in organization that shares this resource
    
    member and viewer roles cannot delete resources.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User _id to check
        resource_id: Resource _id
        content_type: 'Notes' or 'HtmlGeneration'
        
    Returns:
        True if user has delete permission, False otherwise
    """
    try:
        # Step 1: Check if user owns the resource (always has delete access)
        is_owner = await check_resource_owner(tenant_id, user_id, resource_id, content_type)
        if is_owner:
            logger.info(f"[sharing_actions] User {user_id} is owner of {content_type} {resource_id}")
            return True
        
        # Step 2: Check organization role
        role = await get_user_role_for_resource(tenant_id, user_id, resource_id, content_type)
        
        if not role:
            logger.info(f"[sharing_actions] User {user_id} has no access to {content_type} {resource_id}")
            return False
        
        # Step 3: Only owner and ADMIN roles can delete
        has_delete = role in ['owner', 'admin']
        logger.info(f"[sharing_actions] User {user_id} has role {role} for {content_type} {resource_id}, delete={has_delete}")
        return has_delete
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to check delete permission: {e}", exc_info=True)
        return False


async def check_resource_share_permission(
    tenant_id: str,
    user_id: str,
    resource_id: str,
    content_type: Literal['Notes', 'HtmlGeneration']
) -> bool:
    """Check if user can manage sharing for resource.
    
    Share permission (ability to add/remove users) requires owner role in the
    organization that shares this resource.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User _id to check
        resource_id: Resource _id
        content_type: 'Notes' or 'HtmlGeneration'
        
    Returns:
        True if user can manage sharing, False otherwise
    """
    try:
        # Step 1: Check if user owns the resource
        is_owner = await check_resource_owner(tenant_id, user_id, resource_id, content_type)
        if is_owner:
            return True
        
        # Step 2: Check if user has owner role in sharing organization
        role = await get_user_role_for_resource(tenant_id, user_id, resource_id, content_type)
        
        if role == 'owner':
            logger.info(f"[sharing_actions] User {user_id} has owner role, can manage sharing")
            return True
        
        logger.info(f"[sharing_actions] User {user_id} has role {role}, cannot manage sharing (requires owner)")
        return False
        
    except Exception as e:
        logger.error(f"[sharing_actions] Failed to check share permission: {e}", exc_info=True)
        return False


async def get_user_role_for_resource(
    tenant_id: str,
    user_id: str,
    resource_id: str,
    content_type: str
) -> str | None:
    """Get user's role for a specific resource.
    
    Queries UserOrganizationRole records where the organization's sharedResources
    contains the given resourceId + contentType.
    
    Uses /content/UserOrganizationRole API with nested where clause.
    
    Args:
        tenant_id: Tenant identifier
        user_id: User identifier
        resource_id: Resource identifier (note/applet)
        content_type: Type of content (Note/HtmlGeneration)
        
    Returns:
        Role string (owner/admin/member/viewer) or None if no role found
    """
    try:
        from services import mesh as mesh_client
        
        # Check if the user is the resource owner first
        where = {"page_id": {"eq": resource_id}, "parent_id": {"eq": user_id}}
        params = {
            "tenant": tenant_id,
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        response = await mesh_client.request("GET", f"/content/{content_type}", params=params)
        if response.get("success") and response.get("data"):
            logger.info(f"[sharing_actions] User {user_id} is owner of {content_type} {resource_id}")
            return 'owner'

        # Check if the resource is in a sharing organization
        where = {"AND": [
            {"indexer": {"path": "tenantId", "equals": tenant_id}},
            {"indexer": {"path": "sharedResources", "contains": resource_id}},
        ]}
        params = {
            "tenant": "any", # Platform definitions use 'any'
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        logger.info(f"[sharing_actions] Checking organizations sharing resource {params}")
        org_response = await mesh_client.request("GET", "/content/Organization", params=params)
        if not org_response.get("success") or not org_response.get("data"):
            logger.info(f"[sharing_actions] No organization shares resource {resource_id}")
            return None
        organizations = org_response.get("data", [])
        if not organizations:
            logger.info(f"[sharing_actions] No organization shares resource {resource_id}")
            return None
        
        if len(organizations) > 1:
            logger.warning(
                f"[sharing_actions] Multiple organizations share resource {resource_id}, "
                f"using first one: {[org.get('_id') for org in organizations]}"
            )
        
        organization = organizations[0]
        org_id = organization.get('_id')
        if not org_id:
            logger.warning(f"[sharing_actions] Organization missing _id: {organization}")
            return None
        
        # Check if the organization is sharedToAllReadOnly (implies VIEWER role)
        minimum_role = None
        if organization.get('sharedToAllReadOnly', False):
            logger.info(
                f"[sharing_actions] Organization {org_id} shares resource {resource_id} to all read-only users"
            )
            minimum_role = 'viewer'

        # Check if the user has a role in that organization, and return the role if so.
        where = {"AND": [
            {"parent_id": {"eq": user_id}},
            {"indexer": {"path": "organizationId", "equals": org_id}}
        ]}
        params = {
            "tenant": "any", # Platform definitions use 'any'
            "where": json.dumps(where, separators=(',', ':')),
            "limit": "1"
        }
        role_response = await mesh_client.request("GET", "/content/UserOrganizationRole", params=params)
        if role_response.get("success") and role_response.get("data"):
            roles = role_response.get("data", [])
            if roles:
                role_entry = roles[0]
                role = role_entry.get('role')
                logger.info(
                    f"[sharing_actions] User {user_id} has role {role} in organization {org_id} "
                    f"for resource {resource_id}"
                )
                return role
            
        # If no specific role found, return minimum_role if set
        logger.info(
            f"[sharing_actions] User {user_id} has no specific role in organization {org_id} "
            f"for resource {resource_id}, returning minimum_role={minimum_role}")
        return minimum_role
        
    except Exception as e:
        logger.error(f"[sharing] Failed to get user role: {e}", exc_info=True)
        return None


async def update_user_organization_role(
    tenant_id: str,
    user_id: str,
    resource_id: str,
    content_type: str,
    new_role: str
) -> bool:
    """Update user's role in organization for a resource.
    
    Directly updates UserOrganizationRole via Mesh.
    Maps bot role names (admin/viewer) to internal roles (admin/viewer).
    
    Args:
        tenant_id: Tenant identifier
        user_id: User identifier
        resource_id: Resource identifier (note/applet)
        content_type: Type of content (Notes/HtmlGeneration)
        new_role: New role to assign (owner/admin/member/viewer)
        
    Returns:
        True if role was updated successfully, False otherwise
    """
    try:
        from services import mesh as mesh_client
        
        # Cannot change to owner role
        if new_role == 'owner':
            logger.error("[sharing] Cannot change users to owner role via this endpoint")
            return False
        
        # Map bot role names to internal organization roles
        # admin/member → admin, viewer → viewer
        internal_role = 'admin' if new_role in ['admin', 'member'] else 'viewer'
        
        # Step 1: Find the organization that shares this resource
        # Query all user's roles to find which organization has this resource
        where = {
            "parent_id": {"eq": user_id}
        }
        
        params = {
            "tenant": "any",
            "where": json.dumps(where, separators=(',', ':'))
        }
        
        response = await mesh_client.request("GET", "/content/UserOrganizationRole", params=params)
        
        if not response.get("success") or not response.get("data"):
            logger.error(f"[sharing] No UserOrganizationRole found for user {user_id}")
            return False
        
        roles = response.get("data", [])
        
        # Find the organization that has this resource
        role_id = None
        org_id = None
        for role_entry in roles:
            potential_org_id = role_entry.get('organizationId')
            if not potential_org_id:
                continue
            
            # Check if this organization has the resource
            org_where = {"page_id": {"eq": potential_org_id}}
            org_params = {
                "tenant": "any",
                "where": json.dumps(org_where, separators=(',', ':')),
                "limit": "1"
            }
            
            org_response = await mesh_client.request("GET", "/content/Organization", params=org_params)
            
            if org_response.get("success") and org_response.get("data"):
                orgs = org_response.get("data", [])
                if orgs:
                    org = orgs[0]
                    shared_resources = org.get('sharedResources', {})
                    
                    if resource_id in shared_resources and shared_resources[resource_id] == content_type:
                        org_id = potential_org_id
                        role_id = role_entry.get('_id')
                        break
        
        if not org_id or not role_id:
            logger.error(f"[sharing] No sharing organization found for resource {resource_id}")
            return False
        
        # Step 2: Update the UserOrganizationRole directly via Mesh
        update_data = {
            "content": {
                "userId": user_id,
                "organizationId": org_id,
                "tenantId": tenant_id,
                "role": internal_role
            }
        }
        
        params = {"tenant": "any"}
        
        update_response = await mesh_client.request(
            "PUT", 
            f"/content/UserOrganizationRole/{role_id}", 
            params=params,
            json_body=update_data
        )
        
        if update_response.get("success"):
            logger.info(f"[sharing] Updated role for user {user_id} to {internal_role} (bot role: {new_role})")
            return True
        else:
            logger.error(f"[sharing] Failed to update role: {update_response.get('error')}")
            return False
        
    except Exception as e:
        logger.error(f"[sharing] Failed to update user organization role: {e}", exc_info=True)
        return False


async def get_user_shared_resources(
    tenant_id: str,
    user_id: str,
    content_type: Literal['Notes', 'HtmlGeneration'] | None = None
) -> List[Dict[str, object]]:
    """Return shared resources accessible to a user across their organization roles.
    
    Includes:
    1. Resources shared specifically with the user (via UserOrganizationRole)
    2. Resources shared to all (via sharedToAllReadOnly=true on Organization)

    Mirrors the Prism `getUserSharedResources` helper so bot tooling can discover
    existing resource shares. Each entry includes the resource identifier, its
    content type, the full organization document, and the role granted to the
    user within that organization.

    Args:
        tenant_id: Tenant context for scoping Mesh queries.
        user_id: Identifier of the user whose access should be enumerated.
        content_type: Optional filter restricted to 'Notes' or 'HtmlGeneration'.

    Returns:
        List of dictionaries describing shared resources. Empty list if none
        found or errors occur.
    """
    if not user_id:
        logger.warning("[sharing] get_user_shared_resources called without user_id")
        return []

    try:
        from services import mesh as mesh_client
        
        shared_resources_map = {} # Map resource_id -> resource dict

        # 1. Get resources shared specifically with the user (via roles)
        role_where = {"parent_id": {"eq": user_id}}
        role_params = {
            "tenant": "any",
            "where": json.dumps(role_where, separators=(',', ':'))
        }

        role_response = await mesh_client.request("GET", "/content/UserOrganizationRole", params=role_params)
        
        roles = []
        if role_response.get("success") and role_response.get("data"):
            roles = role_response.get("data", [])
        
        org_cache: Dict[str, dict] = {}
        org_roles: Dict[str, str] = {}

        for role_entry in roles:
            organization_id = role_entry.get('organizationId')
            if not organization_id:
                continue
            org_roles[organization_id] = role_entry.get('role', 'viewer')

        # create a where clause with an OR above the page_id (org_id entry)
        if org_roles:
            org_where = {"OR": [{"page_id": {"eq": org_id}} for org_id in org_roles.keys()]}
            org_params = {
                "tenant": "any",
                "where": json.dumps(org_where, separators=(',', ':')),
                "limit": "100"
            }

            org_response = await mesh_client.request("GET", "/content/Organization", params=org_params)
            if org_response.get("success") and org_response.get("data"):
                organizations = org_response.get("data", [])
                for org in organizations:
                    org_id = org.get('_id')
                    if org_id:
                        org_cache[org_id] = org
                        shared_map = org.get('sharedResources', {})
                        if not isinstance(shared_map, dict):
                            continue

                        for resource_id, resource_type in shared_map.items():
                            if content_type and resource_type != content_type:
                                continue

                            shared_resources_map[resource_id] = {
                                "resource_id": resource_id,
                                "content_type": resource_type,
                                "organization": org,
                                "role": org_roles.get(org_id, 'viewer')
                            }

        # 2. Get resources shared to all (read-only)
        # Note: The 'equals' value must be a string for the GraphQL schema, even for boolean fields
        global_where = {
            "indexer": {"path": "sharedToAllReadOnly", "equals": True}
        }
        global_params = {
            "tenant": "any",
            "where": json.dumps(global_where, separators=(',', ':')),
            "limit": "100" # Reasonable limit for now
        }
        
        global_response = await mesh_client.request("GET", "/content/Organization", params=global_params)
        
        if global_response.get("success") and global_response.get("data"):
            global_orgs = global_response.get("data", [])
            
            for org in global_orgs:
                shared_map = org.get('sharedResources', {})
                if not isinstance(shared_map, dict):
                    continue
                    
                for resource_id, resource_type in shared_map.items():
                    if resource_type not in ('Notes', 'HtmlGeneration'):
                        continue
                    if content_type and resource_type != content_type:
                        continue
                    
                    # Conflict resolution:
                    # If resource is already in map (from explicit role), keep it.
                    # Explicit roles (even VIEWER) take precedence.
                    # If not in map, add as VIEWER (read-only).
                    if resource_id not in shared_resources_map:
                        shared_resources_map[resource_id] = {
                            "resource_id": resource_id,
                            "content_type": resource_type,
                            "organization": org,
                            "role": 'viewer', # Global share is always read-only
                            "isGlobal": True
                        }

        return list(shared_resources_map.values())

    except Exception as exc:  # pragma: no cover - defensive logging path
        logger.error(
            "[sharing] Failed to enumerate shared resources for user %s: %s",
            user_id,
            exc,
            exc_info=True
        )
        return []
