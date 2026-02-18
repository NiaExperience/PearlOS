import pytest
import json
import uuid
from actions import sharing_actions, notes_actions
from services import mesh as mesh_client

@pytest.mark.asyncio
async def test_get_user_shared_resources_global_read_only(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test that resources in a sharedToAllReadOnly organization are visible to any user."""
    
    # 1. Create a resource (Note) owned by the test user (known to work)
    owner_id = unique_user_id
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Global Shared Note",
        content="Everyone can see this",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    note_id = note.get("_id")

    # 2. Create an Organization with sharedToAllReadOnly=True
    org_data = {
        "name": "Global Shared Org",
        "tenantId": unique_tenant_id,
        "sharedToAllReadOnly": True,
        "sharedResources": {
            note_id: "Notes"
        }
    }
    org_payload = {"content": org_data}
    
    response = await mesh_client.request("POST", "/content/Organization", json_body=org_payload, params={"tenant": unique_tenant_id})
    assert response.get("success"), f"Failed to create org: {response.get('error')}"
    org = response.get("data")
    register_mesh_record("Organization", org, unique_tenant_id)

    # 3. Call get_user_shared_resources for a DIFFERENT user
    # viewer_id has NO explicit role in this org
    viewer_id = str(uuid.uuid4())
    
    # Mock the global query response because the test server might not have the updated indexer
    from unittest.mock import patch
    import services.mesh
    
    original_request = services.mesh.request
    
    async def mock_request(method, path, params=None, json_body=None):
        # Check if this is the global query
        if path == "/content/Organization" and method == "GET":
            if params and 'indexer' in params.get('where', ''):
                # This is likely the global query for sharedToAllReadOnly
                return {
                    "success": True,
                    "data": [org] # Return the org we created
                }
        return await original_request(method, path, params, json_body)

    with patch('services.mesh.request', side_effect=mock_request):
        shared_resources = await sharing_actions.get_user_shared_resources(
            tenant_id=unique_tenant_id,
            user_id=viewer_id,
            content_type="Notes"
        )

    # 4. Verify visibility
    assert len(shared_resources) == 1
    resource = shared_resources[0]
    assert resource["resource_id"] == note_id
    assert resource["role"] == "viewer"
    assert resource.get("isGlobal") is True

@pytest.mark.asyncio
async def test_get_user_shared_resources_conflict_resolution(
    mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record
):
    """Test that explicit roles override global read-only access."""
    
    # 1. Create a resource owned by a random owner
    owner_id = str(uuid.uuid4())
    note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=owner_id,
        title="Conflict Note",
        content="I am an admin here",
        mode="work"
    )
    register_mesh_record("Notes", note, unique_tenant_id)
    note_id = note.get("_id")

    # 2. Create an Organization with sharedToAllReadOnly=True
    org_data = {
        "name": "Global Shared Org with Explicit Role",
        "tenantId": unique_tenant_id,
        "sharedToAllReadOnly": True,
        "sharedResources": {
            note_id: "Notes"
        }
    }
    org_payload = {"content": org_data}
    
    response = await mesh_client.request("POST", "/content/Organization", json_body=org_payload, params={"tenant": unique_tenant_id})
    assert response.get("success")
    org = response.get("data")
    org_id = org.get("_id")
    register_mesh_record("Organization", org, unique_tenant_id)

    # 3. Grant unique_user_id an ADMIN role in this org
    role_data = {
        "organizationId": org_id,
        "userId": unique_user_id,
        "role": "admin",
        "tenantId": unique_tenant_id
    }
    role_payload = {"content": role_data}
    response = await mesh_client.request("POST", "/content/UserOrganizationRole", json_body=role_payload, params={"tenant": unique_tenant_id})
    assert response.get("success")
    role = response.get("data")
    register_mesh_record("UserOrganizationRole", role, unique_tenant_id)

    # 4. Call get_user_shared_resources for unique_user_id (who has explicit role)
    shared_resources = await sharing_actions.get_user_shared_resources(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        content_type="Notes"
    )

    # 5. Verify explicit role wins
    assert len(shared_resources) == 1
    resource = shared_resources[0]
    assert resource["resource_id"] == note_id
    assert resource["role"] == "admin" # Should be admin, not viewer
    assert resource.get("isGlobal", False) is False 
