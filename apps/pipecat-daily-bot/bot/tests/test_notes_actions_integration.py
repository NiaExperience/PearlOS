"""Integration tests for Notes actions with real Mesh server.

These tests validate Notes CRUD operations against the Mesh server
running with an in-memory PostgreSQL database (pg-mem).

Test Scenarios:
- Create note (work/personal modes)
- List notes (all, filtered by mode)
- Get note by ID
- Update note content
- Append to note
- Update note title
- Delete note
- Fuzzy search by title
- Edge cases (not found, empty results)

Prerequisites:
- Mesh test server is started automatically by conftest.py
- Content definitions are auto-registered for all test tenants
"""

from urllib import request
import pytest
from actions import notes_actions, sharing_actions


@pytest.mark.asyncio
async def test_create_note_integration(mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record):
    """Test creating a note with real DB operations."""
    
    # Create a work note
    result = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Project Plan",
        content="1. Design\n2. Develop\n3. Test",
        mode="work"
    )
    register_mesh_record("Notes", result, unique_tenant_id)
    
    assert result is not None, "Note creation should succeed"
    assert result.get("title") == "Project Plan", "Title should match"
    assert result.get("content") == "1. Design\n2. Develop\n3. Test", "Content should match"
    assert result.get("_id"), "Should have _id assigned"


@pytest.mark.asyncio
async def test_create_personal_note_integration(mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record):
    """Test creating a personal note."""
    
    result = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Personal Todo",
        content="Buy groceries",
        mode="personal"
    )
    register_mesh_record("Notes", result, unique_tenant_id)
    
    assert result is not None, "Personal note creation should succeed"
    assert result.get("mode") == "personal", "Mode should be personal"


@pytest.mark.asyncio
async def test_list_notes_integration(mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record):
    """Test listing all notes for a tenant."""
    
    # Create two notes owned by the test user
    work_note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Work Note",
        content="Work content",
        mode="work"
    )
    register_mesh_record("Notes", work_note, unique_tenant_id)
    assert work_note is not None, "Work note creation should succeed"
    
    personal_note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Personal Note",
        content="Personal content",
        mode="personal"
    )
    register_mesh_record("Notes", personal_note, unique_tenant_id)
    assert personal_note is not None, "Personal note creation should succeed"

    # Create a note by a third party user that should not appear in the test user's list
    import uuid
    # Generate a deterministic UUID based on test name for reproducibility
    namespace = uuid.UUID('12345678-1234-5678-1234-567812345678')
    third_party_user_id = str(uuid.uuid5(namespace, f"third-party-user"))
    third_party_personal_note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=third_party_user_id,
        title="Some Other Guy's Personal Note",
        content="Private thoughts",
        mode="personal"
    )
    register_mesh_record("Notes", third_party_personal_note, unique_tenant_id)
    assert third_party_personal_note is not None, "Third party personal note creation should succeed"

    # Create another note by the third party user that is tenant-wide (work)
    third_party_work_note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=third_party_user_id,
        title="Some Other Guy's Work Note",
        content="Work tasks",
        mode="work"
    )
    register_mesh_record("Notes", third_party_work_note, unique_tenant_id)
    assert third_party_work_note is not None, "Third party work note creation should succeed"

    # Create a note by a third party user that is to be shared with the test user
    third_party_shared_note = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=third_party_user_id,
        title="Some Other Guy's Shared Note",
        content="Company party list",
        mode="personal"
    )
    register_mesh_record("Notes", third_party_shared_note, unique_tenant_id)
    assert third_party_shared_note is not None, "Third party shared note creation should succeed"

    # Share the note with the test user
    sharing_org = await sharing_actions.get_or_create_call_sharing_organization(unique_tenant_id, 'sharing-room', third_party_user_id)
    assert sharing_org is not None, "Sharing organization should be created"

    shared_ok = await sharing_actions.share_resource_with_user(
        tenant_id=unique_tenant_id,
        organization_id=sharing_org["_id"],
        user_id=unique_user_id,
        resource_id=third_party_shared_note["_id"],
        content_type="Notes"
    )
    assert shared_ok is True, "Sharing the note should succeed"

    # List all notes
    all_notes = await notes_actions.list_notes(unique_tenant_id, unique_user_id)
    assert isinstance(all_notes, list), "Should return a list"
    assert len(all_notes) == 4, f"Should have exactly 3 notes, got {len(all_notes)}"
    
    # Verify both notes are in the list
    titles = [note.get("title") for note in all_notes]
    assert "Work Note" in titles, "Work note should be in results"
    assert "Personal Note" in titles, "Personal note should be in results"
    assert "Some Other Guy's Shared Note" in titles, "Shared note should be in results"
    assert "Some Other Guy's Work Note" in titles, "Work note should be in results"
    assert "Some Other Guy's Personal Note" not in titles, "Third party personal note should not be in results"


@pytest.mark.asyncio
async def test_get_note_by_id_integration(mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record):
    """Test retrieving a note by ID."""
    
    # Create a note
    created = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Test Note",
        content="Test content"
    )
    register_mesh_record("Notes", created, unique_tenant_id)
    
    assert created is not None, "Note creation should succeed"
    note_id = created["_id"]
    
    # Retrieve by ID
    retrieved = await notes_actions.get_note_by_id(unique_tenant_id, note_id)
    
    assert retrieved is not None, "Should retrieve the note"
    assert retrieved["_id"] == note_id, "IDs should match"
    assert retrieved["title"] == "Test Note", "Title should match"
    assert retrieved["content"] == "Test content", "Content should match"


@pytest.mark.asyncio
async def test_update_note_content_integration(mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record):
    """Test updating note content."""
    
    # Create initial note
    created = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Original Title",
        content="Original content"
    )
    register_mesh_record("Notes", created, unique_tenant_id)
    
    assert created is not None, "Note creation should succeed"
    note_id = created["_id"]
    
    # Update content
    success = await notes_actions.update_note_content(
        tenant_id=unique_tenant_id,
        note_id=note_id,
        content="Updated content",
        user_id=unique_user_id
    )
    
    assert success is True, "Update should succeed"
    
    # Verify update persisted
    updated = await notes_actions.get_note_by_id(unique_tenant_id, note_id)
    assert updated is not None, "Should retrieve updated note"
    assert updated["content"] == "Updated content", "Content should be updated"


@pytest.mark.asyncio
async def test_append_to_note_integration(mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record):
    """Test appending content to a note."""
    
    # Create note with initial content
    created = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Todo List",
        content="1. First task"
    )
    register_mesh_record("Notes", created, unique_tenant_id)
    
    assert created is not None, "Note creation should succeed"
    note_id = created["_id"]
    
    # Append new item
    success = await notes_actions.append_to_note(
        tenant_id=unique_tenant_id,
        note_id=note_id,
        item="2. Second task",
        user_id=unique_user_id
    )
    
    assert success is True, "Append should succeed"
    
    # Verify content was appended
    updated = await notes_actions.get_note_by_id(unique_tenant_id, note_id)
    assert updated is not None, "Should retrieve updated note"
    assert "1. First task" in updated["content"], "Original content should be present"
    assert "2. Second task" in updated["content"], "New content should be appended"


@pytest.mark.asyncio
async def test_update_note_title_integration(mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record):
    """Test updating note title."""
    
    # Create note
    created = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Original Title",
        content="Some content"
    )
    register_mesh_record("Notes", created, unique_tenant_id)
    
    assert created is not None, "Note creation should succeed"
    note_id = created["_id"]
    
    # Update title
    success = await notes_actions.update_note_title(
        tenant_id=unique_tenant_id,
        note_id=note_id,
        title="Updated Title",
        user_id=unique_user_id
    )
    
    assert success is True, "Title update should succeed"
    
    # Verify update persisted
    updated = await notes_actions.get_note_by_id(unique_tenant_id, note_id)
    assert updated is not None, "Should retrieve updated note"
    assert updated["title"] == "Updated Title", "Title should be updated"
    assert updated["content"] == "Some content", "Content should remain unchanged"


@pytest.mark.asyncio
async def test_delete_note_integration(mesh_test_server, unique_tenant_id, unique_user_id, register_mesh_record, mesh_record_tracker):
    """Test deleting a note."""
    
    # Create note
    created = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Note to Delete",
        content="Will be deleted"
    )
    register_mesh_record("Notes", created, unique_tenant_id)
    
    assert created is not None, "Note creation should succeed"
    note_id = created["_id"]
    
    # Delete note
    success = await notes_actions.delete_note(
        tenant_id=unique_tenant_id,
        note_id=note_id,
        user_id=unique_user_id
    )
    
    assert success is True, "Delete should succeed"

    mesh_record_tracker.mark_deleted("Notes", note_id, unique_tenant_id)
    
    # Verify note is deleted
    retrieved = await notes_actions.get_note_by_id(unique_tenant_id, note_id)
    assert retrieved is None, "Note should no longer exist"


@pytest.mark.asyncio
async def test_fuzzy_search_notes_integration(unique_tenant_id, unique_user_id, register_mesh_record):
    """Test fuzzy search for notes by title."""
    
    # Create note with specific title
    created = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Meeting Notes - Q4 Planning",
        content="Discussion about Q4 goals"
    )
    register_mesh_record("Notes", created, unique_tenant_id)
    
    assert created is not None, "Note creation should succeed"
    
    # Test fuzzy search with partial match
    notes = await notes_actions.fuzzy_search_notes(
        unique_tenant_id,
        "meeting note",  # Slightly different, missing 's', lowercase
        unique_user_id
    )
    
    assert notes is not None, "Fuzzy search should find result"
    assert len(notes) == 1, "Should find exactly one matching note"
    assert "Meeting Notes" in notes[0].get("title", ""), "Should match the created note"
    assert notes[0].get("_id") == created["_id"], "Should find the correct note"


@pytest.mark.asyncio
async def test_fuzzy_search_notes_multiples(unique_tenant_id, unique_user_id, register_mesh_record):
    """Test fuzzy search for notes by title."""
    
    # Create note with specific title
    created = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Planning",
        content="Work discussion about Q4 goals",
        mode="work"
    )
    register_mesh_record("Notes", created, unique_tenant_id)

    created = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Planning",
        content="Vacation plans for the summer",
        mode="personal"
    )
    register_mesh_record("Notes", created, unique_tenant_id)
    
    assert created is not None, "Note creation should succeed"
    
    # Test fuzzy search with partial match
    notes = await notes_actions.fuzzy_search_notes(
        unique_tenant_id,
        "plan",
        unique_user_id
    )
    
    assert notes is not None, "Fuzzy search should find results"
    assert len(notes) == 2, "Should find exactly two matching notes"


@pytest.mark.asyncio
async def test_get_note_by_id_not_found(unique_tenant_id):
    """Test retrieving non-existent note."""
    
    # Try to get a note that doesn't exist
    result = await notes_actions.get_note_by_id(
        unique_tenant_id,
        "non-existent-note-id-12345"
    )
    
    assert result is None, "Should return None for non-existent note"


@pytest.mark.asyncio
async def test_list_notes_empty_tenant(unique_tenant_id, unique_user_id):
    """Test listing notes for tenant with no data."""
    
    # List notes for a tenant that has no notes
    notes = await notes_actions.list_notes(unique_tenant_id, unique_user_id)
    
    assert isinstance(notes, list), "Should return a list"
    assert len(notes) == 0, "Should return empty list for tenant with no notes"


@pytest.mark.asyncio
async def test_fuzzy_search_no_match(unique_tenant_id, unique_user_id):
    """Test fuzzy search with no reasonable match."""
    
    # Search for something that doesn't exist
    notes = await notes_actions.fuzzy_search_notes(
        unique_tenant_id,
        "xyzabc123nonexistent",
        unique_user_id
    )
    
    assert notes is None, "Should return None when no match is found"
