"""Integration tests for sharing_actions.py with real Mesh server.

These tests validate sharing organization and role management operations
against the Mesh server running with an in-memory PostgreSQL database (pg-mem).

Test Scenarios:
- Create/get call sharing organizations
- Share resources with users (assign roles)
- Check resource write permissions (owner, member, viewer roles)
- Get user role for a resource
- Update user organization role

Prerequisites:
- Mesh test server is started automatically by conftest.py
- Content definitions are auto-registered for all test tenants
"""

from uuid import uuid5
import uuid
import pytest
from actions import sharing_actions, notes_actions


@pytest.mark.asyncio
async def test_get_or_create_call_sharing_organization_creates_new(
    mesh_test_server, unique_tenant_id, unique_user_id
):
    """Test creating a new sharing organization for a call."""
    room_url = "https://example.daily.co/test-room-create"
    
    # First call should create the organization
    org1 = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=unique_user_id
    )
    
    assert org1 is not None, "Organization creation should succeed"
    assert org1.get("_id"), "Should have _id assigned"
    assert org1.get("name") == f"DailyCall:{room_url}", "Name should match pattern"
    assert org1.get("tenantId") == unique_tenant_id, "Tenant ID should match"
    assert org1.get("settings", {}).get("resourceOwnerUserId") == unique_user_id, "Owner ID should match"
    assert org1.get("settings", {}).get("resourceSharing") is True, "Resource sharing flag should be enabled"
    shared_resources = org1.get("sharedResources") or {}
    assert isinstance(shared_resources, dict), "Shared resources should be a mapping keyed by resource id"
    assert shared_resources == {}, "New organization should start with no shared resources"


@pytest.mark.asyncio
async def test_get_or_create_call_sharing_organization_returns_existing(
    mesh_test_server, unique_tenant_id, unique_user_id
):
    """Test returning existing sharing organization for a call."""
    room_url = "https://example.daily.co/test-room-existing"
    
    # First call creates
    org1 = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=unique_user_id
    )
    assert org1 is not None, "First call should create organization"
    org1_id = org1.get("_id")
    
    # Second call should return the same organization
    org2 = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=unique_user_id
    )
    
    assert org2 is not None, "Second call should return organization"
    assert org2.get("_id") == org1_id, "Should return same organization ID"
    assert org2.get("name") == org1.get("name"), "Name should match"


@pytest.mark.asyncio
async def test_check_resource_write_permission_owner(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test write permission check for resource owner."""
    
    # Create a note (user is the owner)
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Test Note for Owner Permission",
        content="Owner should have write access",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    
    assert note is not None, "Note creation should succeed"
    note_id = note.get("_id")

    room_url = "https://example.daily.co/test-room-existing"
    org1 = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=unique_user_id
    )
    assert org1 is not None, "Organization creation should succeed"

    namespace = uuid.UUID('12345678-1234-5678-1234-567812345678')
    test_user_id = str(uuid5(namespace, "test-user-owner-permission"))
    
    # Share the note with test user (need organization first)
    share_result = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org1.get("_id"),
        user_id=test_user_id,
        resource_id=note_id,
        content_type="Notes",
        role="viewer"
    )
    assert share_result is True, "Sharing with self should succeed"
    
    # Owner should always have write permission without checking roles
    has_permission = await sharing_actions.check_resource_write_permission(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        resource_id=note_id,
        content_type="Notes"
    )
    
    assert has_permission is True, "Owner should have write permission"


@pytest.mark.asyncio
async def test_check_resource_write_permission_member(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test write permission check for member role."""
    import uuid
    
    # Create owner and member users
    owner_id = unique_user_id
    member_id = str(uuid.uuid4())
    
    # Owner creates a note
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Shared Note for Member",
        content="Member should have write access",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    
    assert note is not None, "Note creation should succeed"
    note_id = note.get("_id")
    
    # Create organization for sharing
    room_url = "https://example.daily.co/test-member-access"
    org = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=owner_id
    )
    assert org is not None, "Organization creation should succeed"
    
    # Share the note with member user
    success = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org.get("_id"),
        user_id=member_id,
        resource_id=note_id,
        content_type="Notes",
        role="member"
    )
    
    assert success is True, "Sharing should succeed"
    
    # Member should have write permission
    has_permission = await sharing_actions.check_resource_write_permission(
        tenant_id=unique_tenant_id,
        user_id=member_id,
        resource_id=note_id,
        content_type="Notes"
    )
    
    assert has_permission is True, "member should have write permission"


@pytest.mark.asyncio
async def test_check_resource_write_permission_viewer(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test write permission check for viewer role."""
    import uuid
    
    # Create owner and viewer users
    owner_id = unique_user_id
    viewer_id = str(uuid.uuid4())
    
    # Owner creates a note
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Shared Note for Viewer",
        content="Viewer should NOT have write access",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    
    assert note is not None, "Note creation should succeed"
    note_id = note.get("_id")
    
    # Create organization for sharing
    room_url = "https://example.daily.co/test-viewer-access"
    org = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=owner_id
    )
    assert org is not None, "Organization creation should succeed"
    
    # Share the note with viewer user
    success = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org.get("_id"),
        user_id=viewer_id,
        resource_id=note_id,
        content_type="Notes",
        role="viewer"
    )
    
    assert success is True, "Sharing should succeed"
    
    # Viewer should NOT have write permission
    has_permission = await sharing_actions.check_resource_write_permission(
        tenant_id=unique_tenant_id,
        user_id=viewer_id,
        resource_id=note_id,
        content_type="Notes"
    )
    
    assert has_permission is False, "viewer should NOT have write permission"


@pytest.mark.asyncio
async def test_get_user_role_for_resource(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test retrieving user's role for a resource."""
    import uuid
    
    owner_id = unique_user_id
    admin_id = str(uuid.uuid4())
    
    # Create a note
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Note for Role Check",
        content="Testing role retrieval",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    
    assert note is not None
    note_id = note.get("_id")
    
    # Create organization for sharing
    room_url = "https://example.daily.co/test-role-check"
    org = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=owner_id
    )
    assert org is not None, "Organization creation should succeed"
    
    # Share with admin role
    success = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org.get("_id"),
        user_id=admin_id,
        resource_id=note_id,
        content_type="Notes",
        role="admin"
    )
    
    assert success is True, "Sharing should succeed"
    
    # Get the user's role
    role = await sharing_actions.get_user_role_for_resource(
        tenant_id=unique_tenant_id,
        user_id=admin_id,
        resource_id=note_id,
        content_type="Notes"
    )
    
    assert role == "admin", f"Role should be admin, got {role}"


@pytest.mark.asyncio
async def test_update_user_organization_role(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test updating user's role in organization."""
    import uuid
    
    owner_id = unique_user_id
    target_id = str(uuid.uuid4())
    
    # Create a note
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Note for Role Update",
        content="Testing role changes",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    
    assert note is not None
    note_id = note.get("_id")
    
    # Create organization for sharing
    room_url = "https://example.daily.co/test-role-update"
    org = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=owner_id
    )
    assert org is not None, "Organization creation should succeed"
    
    # Share with member role
    success = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org.get("_id"),
        user_id=target_id,
        resource_id=note_id,
        content_type="Notes",
        role="member"
    )
    
    assert success is True, "Initial sharing should succeed"
    
    # Verify initial role
    initial_role = await sharing_actions.get_user_role_for_resource(
        tenant_id=unique_tenant_id,
        user_id=target_id,
        resource_id=note_id,
        content_type="Notes"
    )
    assert initial_role == "member", "Initial role should be member"
    
    # Update role to admin
    update_success = await sharing_actions.update_user_organization_role(
        tenant_id=unique_tenant_id,
        user_id=target_id,
        resource_id=note_id,
        content_type="Notes",
        new_role="admin"
    )
    
    assert update_success is True, "Role update should succeed"
    
    # Verify updated role
    updated_role = await sharing_actions.get_user_role_for_resource(
        tenant_id=unique_tenant_id,
        user_id=target_id,
        resource_id=note_id,
        content_type="Notes"
    )
    assert updated_role == "admin", f"Updated role should be admin, got {updated_role}"


@pytest.mark.asyncio
async def test_check_resource_delete_permission_owner(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test delete permission for resource owner - should succeed."""
    # Create a note owned by unique_user_id
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Test Note for Owner Delete",
        content="Owner should be able to delete",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    assert note is not None
    # Use _id like existing tests
    note_id = note.get("_id")
    assert note_id is not None, "Note must have an _id"
    
    # Owner should have delete permission
    has_permission = await sharing_actions.check_resource_delete_permission(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        resource_id=note_id,
        content_type="Notes"
    )
    assert has_permission is True, "Owner should have delete permission"


@pytest.mark.asyncio
async def test_check_resource_delete_permission_admin(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test delete permission for admin role - should succeed."""
    # Create owner and admin users
    owner_id = str(uuid.uuid4())
    admin_id = str(uuid.uuid4())
    
    # Create a note owned by owner
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Test Note for Admin Delete",
        content="Admin should be able to delete",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    assert note is not None
    note_id = note.get("_id")
    
    # Share with admin role
    room_url = f"https://example.daily.co/test-delete-admin-{uuid.uuid4()}"
    org = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=owner_id
    )
    register_mesh_record("Organization", org, unique_tenant_id)
    
    share_success = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org["_id"],
        user_id=admin_id,
        resource_id=note_id,
        content_type="Notes",
        role="admin"
    )
    assert share_success is True
    
    # Admin should have delete permission
    has_permission = await sharing_actions.check_resource_delete_permission(
        tenant_id=unique_tenant_id,
        user_id=admin_id,
        resource_id=note_id,
        content_type="Notes"
    )
    assert has_permission is True, "admin should have delete permission"


@pytest.mark.asyncio
async def test_check_resource_delete_permission_member(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test delete permission for member role - should fail."""
    # Create owner and member users
    owner_id = str(uuid.uuid4())
    member_id = str(uuid.uuid4())
    
    # Create a note owned by owner
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Test Note for Member Delete",
        content="Member should NOT be able to delete",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    assert note is not None
    note_id = note.get("_id")
    
    # Share with member role
    room_url = f"https://example.daily.co/test-delete-member-{uuid.uuid4()}"
    org = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=owner_id
    )
    register_mesh_record("Organization", org, unique_tenant_id)
    
    share_success = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org["_id"],
        user_id=member_id,
        resource_id=note_id,
        content_type="Notes",
        role="member"
    )
    assert share_success is True
    
    # Member should NOT have delete permission
    has_permission = await sharing_actions.check_resource_delete_permission(
        tenant_id=unique_tenant_id,
        user_id=member_id,
        resource_id=note_id,
        content_type="Notes"
    )
    assert has_permission is False, "member should NOT have delete permission"


@pytest.mark.asyncio
async def test_check_resource_share_permission_owner(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test share permission for resource owner - should succeed."""
    # Create a note owned by unique_user_id
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Test Note for Owner Share",
        content="Owner should be able to share",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    assert note is not None
    note_id = note.get("_id")
    
    # Owner should have share permission
    has_permission = await sharing_actions.check_resource_share_permission(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        resource_id=note_id,
        content_type="Notes"
    )
    assert has_permission is True, "Owner should have share permission"


@pytest.mark.asyncio
async def test_check_resource_share_permission_admin(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test share permission for admin role - should fail (only owner can share)."""
    # Create owner and admin users
    owner_id = str(uuid.uuid4())
    admin_id = str(uuid.uuid4())
    
    # Create a note owned by owner
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Test Note for Admin Share",
        content="Admin should NOT be able to share",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    assert note is not None
    note_id = note.get("_id")
    
    # Share with admin role
    room_url = f"https://example.daily.co/test-share-admin-{uuid.uuid4()}"
    org = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=owner_id
    )
    register_mesh_record("Organization", org, unique_tenant_id)
    
    share_success = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org["_id"],
        user_id=admin_id,
        resource_id=note_id,
        content_type="Notes",
        role="admin"
    )
    assert share_success is True
    
    # Admin should NOT have share permission (only owner can share)
    has_permission = await sharing_actions.check_resource_share_permission(
        tenant_id=unique_tenant_id,
        user_id=admin_id,
        resource_id=note_id,
        content_type="Notes"
    )
    assert has_permission is False, "admin should NOT have share permission (only owner)"


@pytest.mark.asyncio
async def test_get_user_shared_resources_returns_member_note(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Shared resources helper should surface notes shared via organizations."""
    import uuid

    owner_id = unique_user_id
    member_id = str(uuid.uuid4())

    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Shared Note",
        content="Member should see this note in shared resources",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    assert note is not None
    note_id = note.get("_id")

    room_url = f"https://example.daily.co/shared-resources-{uuid.uuid4()}"
    org = await sharing_actions.get_or_create_call_sharing_organization(
        tenant_id=unique_tenant_id,
        room_url=room_url,
        owner_user_id=owner_id
    )
    register_mesh_record("Organization", org, unique_tenant_id)

    share_success = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=org["_id"],
        user_id=member_id,
        resource_id=note_id,
        content_type="Notes",
        role="member"
    )
    assert share_success is True

    shared_resources = await sharing_actions.get_user_shared_resources(
        tenant_id=unique_tenant_id,
        user_id=member_id,
        content_type="Notes"
    )

    assert len(shared_resources) == 1
    resource_entry = shared_resources[0]
    assert resource_entry["resource_id"] == note_id
    assert resource_entry["content_type"] == "Notes"
    assert resource_entry["role"] == "member"
    assert resource_entry["organization"].get("_id") == org.get("_id")

    # HtmlGeneration filter should return empty since only notes were shared
    assert await sharing_actions.get_user_shared_resources(
        tenant_id=unique_tenant_id,
        user_id=member_id,
        content_type="HtmlGeneration"
    ) == []


@pytest.mark.asyncio
async def test_get_user_shared_resources_empty_without_memberships(
    mesh_test_server, unique_tenant_id
):
    """Users without organization roles should receive an empty list."""
    import uuid

    user_without_roles = str(uuid.uuid4())

    shared_resources = await sharing_actions.get_user_shared_resources(
        tenant_id=unique_tenant_id,
        user_id=user_without_roles,
        content_type="Notes"
    )

    assert shared_resources == []

