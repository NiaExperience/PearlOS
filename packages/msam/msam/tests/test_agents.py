"""
Tests for MSAM multi-agent memory management.

Covers agent registration, isolation, sharing, and statistics.
"""

import pytest
import os
import sys
import json
import sqlite3
import tempfile
import numpy as np


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Use temp database for all tests."""
    db_path = tmp_path / "test_msam.db"
    monkeypatch.setattr("msam.core.DB_PATH", db_path)
    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)
    yield db_path


class TestRegisterAgent:
    def test_register_new_agent(self):
        from msam.agents import register_agent
        result = register_agent("test-agent-1", name="Test Agent")
        assert result["id"] == "test-agent-1"
        assert result["name"] == "Test Agent"
        assert result["already_existed"] == False

    def test_register_existing_agent(self):
        from msam.agents import register_agent
        register_agent("test-agent-2")
        result = register_agent("test-agent-2")
        assert result["already_existed"] == True


class TestListAgents:
    def test_list_empty(self):
        from msam.agents import list_agents
        agents = list_agents()
        assert isinstance(agents, list)

    def test_list_after_register(self):
        from msam.agents import register_agent, list_agents
        register_agent("agent-a")
        register_agent("agent-b")
        agents = list_agents()
        assert len(agents) >= 2


class TestAgentStats:
    def test_stats_empty_agent(self):
        from msam.agents import register_agent, agent_stats
        register_agent("stats-agent")
        stats = agent_stats("stats-agent")
        assert stats["agent_id"] == "stats-agent"
        assert stats["total_atoms"] == 0


class TestShareAtom:
    def test_share_nonexistent_atom(self):
        from msam.agents import register_agent, share_atom
        register_agent("from-agent")
        register_agent("to-agent")
        result = share_atom("nonexistent", "from-agent", "to-agent")
        assert result == False


class TestAgentIsolation:
    def test_store_with_agent_id(self):
        from msam.core import store_atom, get_db
        atom_id = store_atom("Agent-specific memory", agent_id="agent-1")
        assert atom_id is not None
        conn = get_db()
        row = conn.execute("SELECT agent_id FROM atoms WHERE id = ?", (atom_id,)).fetchone()
        conn.close()
        assert row["agent_id"] == "agent-1"

    def test_default_agent_id(self):
        from msam.core import store_atom, get_db
        atom_id = store_atom("Default agent memory")
        assert atom_id is not None
        conn = get_db()
        row = conn.execute("SELECT agent_id FROM atoms WHERE id = ?", (atom_id,)).fetchone()
        conn.close()
        assert row["agent_id"] == "default"
