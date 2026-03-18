"""Smoke tests for Notes CRUD via the bot gateway API."""
import requests
import pytest
import uuid
from conftest import GATEWAY_URL

API = f"{GATEWAY_URL}/api/notes"


class TestNotesCRUD:
    """Create, read, update, delete a note via REST API."""

    def test_full_crud_lifecycle(self):
        # CREATE
        note_data = {
            "title": f"Test Note {uuid.uuid4().hex[:8]}",
            "content": "This is a test note created by Playwright smoke tests.",
        }
        r = requests.post(API, json=note_data, timeout=10)
        assert r.status_code in (200, 201), f"Create failed: {r.status_code} {r.text}"
        created = r.json()
        note_obj = created.get("note", created)
        note_id = note_obj.get("id") or note_obj.get("_id") or note_obj.get("noteId") or note_obj.get("note_id")
        assert note_id, f"No note ID in response: {created}"

        try:
            # READ
            r = requests.get(f"{API}/{note_id}", timeout=10)
            assert r.status_code == 200, f"Read failed: {r.status_code}"
            fetched = r.json()
            assert note_data["title"] in str(fetched)

            # UPDATE
            update_data = {"title": note_data["title"] + " (updated)", "content": "Updated content."}
            r = requests.patch(f"{API}/{note_id}", json=update_data, timeout=10)
            assert r.status_code in (200, 204), f"Update failed: {r.status_code}"

            # Verify update
            r = requests.get(f"{API}/{note_id}", timeout=10)
            assert r.status_code == 200
            assert "updated" in r.text.lower() or "Updated" in r.text

        finally:
            # DELETE (cleanup)
            r = requests.delete(f"{API}/{note_id}", timeout=10)
            assert r.status_code in (200, 204), f"Delete failed: {r.status_code}"

    def test_list_notes(self):
        r = requests.get(API, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, (list, dict)), f"Unexpected: {type(data)}"
