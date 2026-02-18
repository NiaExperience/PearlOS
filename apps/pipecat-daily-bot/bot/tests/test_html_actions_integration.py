"""
Integration tests for HTML actions using real Mesh in-memory DB.

These tests use the mesh_test_server fixture from conftest.py which starts
a Mesh server on port 5002 with an in-memory PostgreSQL database (pg-mem).

No mocking - tests actual DB operations end-to-end.
"""
import pytest
from actions import html_actions


@pytest.mark.asyncio
async def test_create_html_generation_integration(mesh_test_server, unique_tenant_id, unique_user_id):
    """Test creating HTML generation with real DB operations."""
    
    # Create HTML generation (calls mesh_client → Mesh API → in-memory DB)
    result = await html_actions.create_html_generation(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Test Game",
        html_content="<html><body>Test Game Content</body></html>",
        content_type="game",
        user_request="Create a test game",
        tags=["test", "game", "integration"]
    )
    
    # Verify creation succeeded
    assert result is not None, "create_html_generation should return a result"
    assert result.get("title") == "Test Game", "Title should match"
    assert result.get("contentType") == "game", "Content type should match"
    assert result.get("htmlContent") == "<html><body>Test Game Content</body></html>", "HTML content should match"
    assert "_id" in result, "Result should include _id"
    assert isinstance(result.get("tags"), list), "Tags should be a list"
    assert "test" in result.get("tags", []), "Tags should include 'test'"
    
    # Verify we can retrieve it
    html_id = result["_id"]
    retrieved = await html_actions.get_html_generation_by_id(unique_tenant_id, html_id)
    
    assert retrieved is not None, "Should be able to retrieve created HTML generation"
    assert retrieved["title"] == "Test Game", "Retrieved title should match"
    assert retrieved["htmlContent"] == "<html><body>Test Game Content</body></html>", "Retrieved HTML should match"
    assert retrieved["_id"] == html_id, "Retrieved _id should match"


@pytest.mark.asyncio
async def test_update_html_generation_integration(mesh_test_server, unique_tenant_id, unique_user_id):
    """Test updating HTML generation with real DB operations."""
    
    # Create initial HTML generation
    created = await html_actions.create_html_generation(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Original Title",
        html_content="<html><body>Original Content</body></html>",
        content_type="app"
    )
    
    assert created is not None, "Initial creation should succeed"
    _id = created["_id"]
    
    # Update the generation
    success = await html_actions.update_html_generation(
        tenant_id=unique_tenant_id,
        gen_id=_id,
        user_id=unique_user_id,
        title="Updated Title",
        html_content="<html><body>Updated Content</body></html>",
        tags=["updated", "modified"]
    )
    
    assert success is True, "Update should succeed"
    
    # Verify update persisted
    updated = await html_actions.get_html_generation_by_id(unique_tenant_id, _id)
    assert updated is not None, "Should retrieve updated generation"
    assert updated["title"] == "Updated Title", "Title should be updated"
    assert updated["htmlContent"] == "<html><body>Updated Content</body></html>", "Content should be updated"
    assert "updated" in updated.get("tags", []), "Tags should be updated"


@pytest.mark.asyncio
async def test_list_html_generations_integration(mesh_test_server, unique_tenant_id, unique_user_id):
    """Test listing HTML generations with filtering."""
    
    # Create multiple generations
    game = await html_actions.create_html_generation(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Game 1",
        html_content="<html><body>Game 1</body></html>",
        content_type="game"
    )
    
    app = await html_actions.create_html_generation(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="App 1",
        html_content="<html><body>App 1</body></html>",
        content_type="app"
    )
    
    assert game is not None, "Game creation should succeed"
    assert app is not None, "App creation should succeed"
    
    # List all generations for tenant
    results = await html_actions.list_html_generations(unique_tenant_id, unique_user_id)
    
    assert isinstance(results, list), "Results should be a list"
    assert len(results) >= 2, f"Should have at least 2 generations, got {len(results)}"
    
    # Verify our creations are in the results
    titles = [r.get("title") for r in results]
    assert "Game 1" in titles, "Game 1 should be in results"
    assert "App 1" in titles, "App 1 should be in results"


@pytest.mark.asyncio
async def test_fuzzy_search_applets_integration(mesh_test_server, unique_tenant_id, unique_user_id):
    """Test fuzzy search with real DB operations."""
    
    # Create HTML generation with specific title
    created = await html_actions.create_html_generation(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Space Invaders Clone",
        html_content="<html><body>Space Invaders Game</body></html>",
        content_type="game",
        tags=["space", "arcade", "retro"]
    )
    
    assert created is not None, "Creation should succeed"
    print("Created generation ID:", created["_id"])
    
    # Test fuzzy search with slightly different spelling
    result = await html_actions.fuzzy_search_applets(
        unique_tenant_id,
        "space invader",  # Missing 's' at the end
        unique_user_id
    )
    print("Fuzzy search result ID:", result.get("_id"))

    assert result is not None, "Fuzzy search should find result"
    assert "Space Invaders" in result.get("title", ""), "Should match 'Space Invaders Clone'"
    assert result.get("_id") == created["_id"], "Should find the correct generation"


@pytest.mark.asyncio
async def test_get_html_generation_by_id_not_found(unique_tenant_id):
    """Test retrieving non-existent HTML generation."""
    
    # Try to get a generation that doesn't exist
    result = await html_actions.get_html_generation_by_id(
        unique_tenant_id,
        "non-existent-id-12345"
    )
    
    assert result is None, "Should return None for non-existent ID"


@pytest.mark.asyncio
async def test_update_html_generation_not_found(unique_tenant_id, unique_user_id):
    """Test updating non-existent HTML generation."""
    
    # Try to update a generation that doesn't exist
    success = await html_actions.update_html_generation(
        tenant_id=unique_tenant_id,
        gen_id="non-existent-id-12345",
        user_id=unique_user_id,
        title="New Title"
    )
    
    assert success is False, "Update should fail for non-existent ID"


@pytest.mark.asyncio
async def test_create_html_generation_with_source_note(mesh_test_server, unique_tenant_id, unique_user_id):
    """Test creating HTML generation with source note reference."""
    
    # Create HTML generation with source note ID
    result = await html_actions.create_html_generation(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="App from Note",
        html_content="<html><body>Generated from note</body></html>",
        content_type="app",
        user_request="Create app from my note",
        source_note_id="note-12345-source",
        tags=["from-note", "generated"]
    )
    
    assert result is not None, "Creation should succeed"
    assert result.get("sourceNoteId") == "note-12345-source", "Source note ID should be set"


@pytest.mark.asyncio
async def test_list_html_generations_empty_tenant(unique_tenant_id, unique_user_id):
    """Test listing HTML generations for tenant with no data."""
    
    # List generations for a tenant that has no data
    results = await html_actions.list_html_generations(f"{unique_tenant_id}-empty", unique_user_id)
    
    assert isinstance(results, list), "Results should be a list"
    assert len(results) == 0, "Should return empty list for tenant with no data"
