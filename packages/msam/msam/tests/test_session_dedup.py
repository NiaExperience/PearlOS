"""MSAM Session Dedup Tests -- multi-turn deduplication tracking."""

import json
import os
import time

import pytest


@pytest.fixture(autouse=True)
def temp_session(monkeypatch, tmp_path):
    """Use a temporary directory for session files."""
    monkeypatch.setattr("msam.session_dedup.SESSION_DIR", str(tmp_path))
    yield tmp_path


class TestRecordAndGetServed:
    def test_round_trip(self):
        from msam.session_dedup import record_served, get_served_ids
        record_served(["atom_1", "atom_2", "atom_3"])
        served = get_served_ids()
        assert "atom_1" in served
        assert "atom_2" in served
        assert "atom_3" in served


class TestClearSession:
    def test_clear(self):
        from msam.session_dedup import record_served, get_served_ids, clear_session
        record_served(["atom_1"])
        assert len(get_served_ids()) >= 1
        clear_session()
        assert len(get_served_ids()) == 0


class TestDedupAcrossCalls:
    def test_accumulates(self):
        from msam.session_dedup import record_served, get_served_ids
        record_served(["atom_1", "atom_2"])
        record_served(["atom_3", "atom_4"])
        served = get_served_ids()
        assert len(served) >= 4
        assert "atom_1" in served
        assert "atom_4" in served


class TestSessionExpiry:
    def test_expires_old_data(self, tmp_path):
        from msam.session_dedup import get_served_ids, _session_file

        # Write a session file with old timestamp
        path = _session_file()
        old_data = {
            "atom_ids": ["old_atom_1", "old_atom_2"],
            "created": time.time() - 8000,  # > 7200 seconds ago
        }
        with open(path, "w") as f:
            json.dump(old_data, f)

        served = get_served_ids()
        assert len(served) == 0, "Expired session data should return empty set"
