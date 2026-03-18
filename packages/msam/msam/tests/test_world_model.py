"""Tests for Temporal World Model (Feature 3)."""

import json
import sqlite3
import numpy as np
import pytest
from datetime import datetime, timezone, timedelta


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Use a temporary database for all tests."""
    db_path = tmp_path / "test_msam.db"
    monkeypatch.setattr("msam.core.DB_PATH", db_path)
    monkeypatch.setattr("msam.triples.DB_PATH", db_path)
    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)
    # Initialize main DB + triples schema + run migrations
    from msam.core import get_db, run_migrations
    from msam.triples import init_triples_schema
    conn = get_db()
    init_triples_schema(conn)
    conn.close()
    run_migrations()
    yield db_path


class TestWorldQueryCurrent:
    def test_world_query_current(self):
        from msam.triples import update_world, query_world
        update_world("Jaden", "lives_in", "Oakland")
        result = query_world()
        assert len(result) >= 1
        assert any(r["subject"] == "Jaden" and r["object"] == "Oakland" for r in result)


class TestWorldQueryExpired:
    def test_world_query_expired(self):
        from msam.triples import update_world, query_world
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        expired = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        update_world("Jaden", "is_at", "cafe", valid_from=past, valid_until=expired)

        # Current query should NOT show expired
        current = query_world(entity="Jaden", predicate="is_at")
        assert not any(r["object"] == "cafe" for r in current)

        # include_expired should show it
        all_triples = query_world(entity="Jaden", predicate="is_at", include_expired=True)
        assert any(r["object"] == "cafe" for r in all_triples)


class TestWorldQueryPointInTime:
    def test_world_query_point_in_time(self):
        from msam.triples import update_world, query_world
        t0 = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        t1 = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
        t2 = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

        # First fact: valid from t0 to t1
        update_world("Jaden", "reads", "book_a", valid_from=t0, valid_until=t1)
        # Second fact: valid from t1 onwards
        update_world("Jaden", "reads", "book_b", valid_from=t1)

        # Query at a time between t0 and t1 should return book_a
        query_time = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        result = query_world(entity="Jaden", predicate="reads", at_time=query_time)
        objects = [r["object"] for r in result]
        assert "book_a" in objects

        # Query at t2 should return book_b
        result2 = query_world(entity="Jaden", predicate="reads", at_time=t2)
        objects2 = [r["object"] for r in result2]
        assert "book_b" in objects2


class TestWorldUpdateClosesOld:
    def test_world_update_closes_old(self):
        from msam.triples import update_world, query_world
        update_world("Agent", "mood", "happy")
        update_world("Agent", "mood", "curious")

        # Current query should show only the latest
        current = query_world(entity="Agent", predicate="mood")
        assert len(current) == 1
        assert current[0]["object"] == "curious"


class TestWorldEntityFilter:
    def test_world_entity_filter(self):
        from msam.triples import update_world, query_world
        update_world("Alice", "likes", "tea")
        update_world("Bob", "likes", "coffee")

        result = query_world(entity="Alice")
        assert all(r["subject"] == "Alice" for r in result)


class TestWorldPredicateFilter:
    def test_world_predicate_filter(self):
        from msam.triples import update_world, query_world
        update_world("Agent", "skill", "coding")
        update_world("Agent", "hobby", "music")

        result = query_world(entity="Agent", predicate="skill")
        assert all(r["predicate"] == "skill" for r in result)


class TestWorldHistory:
    def test_world_history(self):
        from msam.triples import update_world, world_history
        update_world("Agent", "location", "home")
        update_world("Agent", "location", "office")
        update_world("Agent", "location", "park")

        history = world_history("Agent", "location")
        # Should include all versions
        objects = [h["object"] for h in history]
        assert "home" in objects
        assert "office" in objects
        assert "park" in objects
        assert len(history) >= 3
