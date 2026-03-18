"""MSAM Entity Roles Tests -- entity-aware scoring for retrieval."""

import pytest


class TestClassifyAboutEntity:
    def test_about_user(self):
        from msam.entity_roles import classify_about_entity
        entity, confidence = classify_about_entity(
            "Things Agent Knows: User likes pizza, works as developer"
        )
        assert entity == "user"
        assert confidence > 0.5

    def test_about_agent(self):
        from msam.entity_roles import classify_about_entity
        entity, confidence = classify_about_entity(
            "Agent Identity: Curious, analytical personality with warm tone"
        )
        assert entity == "agent"
        assert confidence > 0.5

    def test_unknown_content(self):
        from msam.entity_roles import classify_about_entity
        entity, confidence = classify_about_entity("Random numbers: 42 17 99")
        # Should either return unknown or low confidence
        assert entity in ("unknown", "system", "user", "agent", "relationship")


class TestClassifyQueryIntent:
    def test_user_query(self):
        from msam.entity_roles import classify_query_intent
        entity, confidence = classify_query_intent("What does the user like?")
        assert entity == "user"
        assert confidence > 0.3

    def test_agent_query(self):
        from msam.entity_roles import classify_query_intent
        entity, confidence = classify_query_intent("What is the agent's personality?")
        assert entity == "agent"
        assert confidence > 0.3

    def test_unknown_query(self):
        from msam.entity_roles import classify_query_intent
        entity, confidence = classify_query_intent("42")
        assert entity == "unknown" or confidence < 0.3


class TestEntityScoreAdjustment:
    def test_match_boosts(self):
        from msam.entity_roles import entity_score_adjustment
        multiplier = entity_score_adjustment("user", "user", 0.8)
        assert multiplier > 1.0

    def test_mismatch_penalizes(self):
        from msam.entity_roles import entity_score_adjustment
        multiplier = entity_score_adjustment("user", "system", 0.8)
        assert multiplier < 1.0

    def test_unknown_neutral(self):
        from msam.entity_roles import entity_score_adjustment
        multiplier = entity_score_adjustment("unknown", "user", 0.8)
        assert multiplier == 1.0

    def test_temporal_neutral(self):
        from msam.entity_roles import entity_score_adjustment
        multiplier = entity_score_adjustment("user", "temporal", 0.8)
        assert multiplier == 1.0

    def test_related_entities_mild_penalty(self):
        from msam.entity_roles import entity_score_adjustment
        multiplier = entity_score_adjustment("user", "agent", 0.8)
        # Related entities get mild penalty, not full mismatch
        assert 0.8 < multiplier < 1.0


class TestTagAllAtoms:
    @pytest.fixture(autouse=True)
    def _setup_db(self, monkeypatch, tmp_path):
        import numpy as np
        db_path = tmp_path / "test_msam.db"
        monkeypatch.setattr("msam.core.DB_PATH", db_path)
        fake_emb = list(np.random.randn(1024).astype(float))
        monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
        monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
        monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
        monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)

    def test_tags_atoms_in_db(self):
        from msam.core import get_db, run_migrations, store_atom
        from msam.entity_roles import tag_all_atoms

        conn = get_db()
        run_migrations(conn)
        conn.close()

        store_atom("Things Agent Knows: User likes pizza")
        store_atom("Agent Identity: Curious personality")

        counts = tag_all_atoms()
        assert isinstance(counts, dict)
        assert sum(counts.values()) >= 2

        # Verify columns exist in DB
        conn = get_db()
        row = conn.execute(
            "SELECT about_entity, entity_confidence FROM atoms WHERE state = 'active' LIMIT 1"
        ).fetchone()
        conn.close()
        assert row is not None
        assert row[0] is not None  # about_entity populated
