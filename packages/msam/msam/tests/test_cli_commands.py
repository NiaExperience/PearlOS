"""Comprehensive CLI command tests for msam/remember.py.

Tests every cmd_* function that was previously untested.
Pattern: call function directly, capture stdout via capsys, parse JSON output.
"""

import json
import os
import sys
import time

import numpy as np
import pytest


# ─── Shared Fixture ──────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Isolate every test to a fresh SQLite database with fake embeddings."""
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("msam.core.DB_PATH", db_path)
    monkeypatch.setattr("msam.triples.DB_PATH", db_path)

    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)

    # Ensure all schemas are ready (many CLI commands touch triples/outcomes)
    from msam.core import get_db, run_migrations
    from msam.triples import init_triples_schema
    conn = get_db()
    run_migrations(conn)
    init_triples_schema(conn)
    conn.close()

    yield db_path


@pytest.fixture
def metrics_db(monkeypatch, tmp_path):
    """Separate metrics DB for commands that touch metrics."""
    mdb = tmp_path / "test_metrics.db"
    monkeypatch.setattr("msam.metrics.METRICS_DB", mdb)
    return mdb


def _store_one(content="Test atom content"):
    """Helper to store a single atom and return its ID."""
    from msam.core import store_atom
    return store_atom(content)


# ─── Tier 1: Simple commands ─────────────────────────────────────────────────


class TestTripleStats:
    def test_triple_stats_output(self, capsys, monkeypatch):
        from msam.triples import init_triples_schema
        from msam.core import get_db
        conn = get_db()
        init_triples_schema(conn)
        conn.close()
        monkeypatch.setattr("msam.remember.log_triple_store_snapshot", lambda: None)
        from msam.remember import cmd_triple_stats
        cmd_triple_stats()
        data = json.loads(capsys.readouterr().out)
        assert "total_triples" in data


class TestMetamemory:
    def test_metamemory_no_args(self, capsys):
        from msam.remember import cmd_metamemory
        cmd_metamemory([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_metamemory_with_topic(self, capsys):
        _store_one("User prefers dark mode")
        from msam.remember import cmd_metamemory
        cmd_metamemory(["dark mode"])
        data = json.loads(capsys.readouterr().out)
        # metamemory_query returns a dict with coverage info
        assert isinstance(data, dict)


class TestDrift:
    def test_drift_no_args(self, capsys):
        from msam.remember import cmd_drift
        cmd_drift([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_drift_with_entity(self, capsys):
        _store_one("Jaden felt happy today")
        from msam.remember import cmd_drift
        cmd_drift(["Jaden"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestConfidenceDecay:
    def test_confidence_decay_runs(self, capsys):
        _store_one("Some content for confidence decay")
        from msam.remember import cmd_confidence_decay
        cmd_confidence_decay([])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestSessionClear:
    def test_session_clear_runs(self, capsys):
        from msam.remember import cmd_session_clear
        cmd_session_clear()
        data = json.loads(capsys.readouterr().out)
        assert data.get("cleared") is True


class TestCache:
    def test_cache_stats(self, capsys):
        from msam.remember import cmd_cache
        cmd_cache([])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)

    def test_cache_clear(self, capsys):
        from msam.remember import cmd_cache
        cmd_cache(["clear"])
        data = json.loads(capsys.readouterr().out)
        assert data.get("cleared") is True


class TestAnalytics:
    def test_analytics_runs(self, capsys, metrics_db):
        from msam.remember import cmd_analytics
        cmd_analytics([])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestMigrate:
    def test_migrate_runs(self, capsys):
        from msam.remember import cmd_migrate
        cmd_migrate([])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestForgettingCmd:
    def test_forgetting_no_args(self, capsys):
        from msam.remember import cmd_forgetting
        cmd_forgetting([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_forgetting_recent(self, capsys):
        from msam.remember import cmd_forgetting
        cmd_forgetting(["recent"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, (dict, list))


class TestGaps:
    def test_gaps_no_args(self, capsys):
        from msam.remember import cmd_gaps
        cmd_gaps([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_gaps_with_entity(self, capsys):
        _store_one("The sky is blue")
        from msam.remember import cmd_gaps
        cmd_gaps(["sky"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestVersions:
    def test_versions_no_args(self, capsys):
        from msam.remember import cmd_versions
        cmd_versions([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_versions_with_atom_id(self, capsys):
        aid = _store_one("Versioned atom")
        from msam.remember import cmd_versions
        cmd_versions([aid])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, (dict, list))


class TestOutcomesCmd:
    def test_outcomes_summary(self, capsys):
        from msam.remember import cmd_outcomes
        cmd_outcomes(["--summary"])
        data = json.loads(capsys.readouterr().out)
        assert "recent_outcomes" in data

    def test_outcomes_for_atom(self, capsys):
        aid = _store_one("Outcome test atom")
        from msam.remember import cmd_outcomes
        cmd_outcomes([aid])
        data = json.loads(capsys.readouterr().out)
        assert data["atom_id"] == aid


# ─── Tier 2: Query-like commands ─────────────────────────────────────────────


class TestHybrid:
    def test_hybrid_retrieval(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.remember.hybrid_retrieve_with_triples", lambda q, mode="task", token_budget=500: {
            "triples": [{"subject": "user", "predicate": "likes", "object": "dark mode"}],
            "atoms": [{"id": "a1", "content": "User likes dark mode", "_combined_score": 0.9}],
            "triple_tokens": 5, "atom_tokens": 10, "total_tokens": 15,
            "items_returned": 2, "latency_ms": 5.0,
        })
        from msam.remember import cmd_hybrid
        cmd_hybrid(["user", "preferences"])
        data = json.loads(capsys.readouterr().out)
        assert data["query"] == "user preferences"
        assert data["triple_count"] == 1
        assert data["atom_count"] == 1


class TestEmotional:
    def test_emotional_file_not_found(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.remember.WORKSPACE", "/nonexistent")
        from msam.remember import cmd_emotional
        cmd_emotional([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_emotional_parses_file(self, capsys, monkeypatch, tmp_path):
        # Create a fake emotional state file
        ws = str(tmp_path)
        monkeypatch.setattr("msam.remember.WORKSPACE", ws)
        emo_dir = tmp_path / "memory" / "context"
        emo_dir.mkdir(parents=True)
        emo_file = emo_dir / "emotional-state.md"
        emo_file.write_text("Primary: confident\nIntensity: 7/10\nWarmth: 8/10\n")
        monkeypatch.setattr("msam.metrics.log_emotional_state",
                            lambda a, v, p, s, i, w: None)
        from msam.remember import cmd_emotional
        cmd_emotional([])
        data = json.loads(capsys.readouterr().out)
        assert data["logged"] is True
        assert data["primary"] == "confident"


class TestDryCmd:
    def test_dry_no_args(self, capsys):
        from msam.remember import cmd_dry
        cmd_dry([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_dry_with_query(self, capsys):
        _store_one("User prefers dark mode")
        from msam.remember import cmd_dry
        cmd_dry(["dark", "mode"])
        data = json.loads(capsys.readouterr().out)
        assert "results" in data


class TestRewriteCmd:
    def test_rewrite_no_args(self, capsys):
        from msam.remember import cmd_rewrite
        cmd_rewrite([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_rewrite_with_query(self, capsys):
        _store_one("User prefers dark mode")
        from msam.remember import cmd_rewrite
        cmd_rewrite(["dark", "mode"])
        data = json.loads(capsys.readouterr().out)
        assert "rewrite" in data
        assert "results" in data


class TestDiverse:
    def test_diverse_no_args(self, capsys):
        from msam.remember import cmd_diverse
        cmd_diverse([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_diverse_with_query(self, capsys):
        _store_one("User prefers dark mode")
        from msam.remember import cmd_diverse
        cmd_diverse(["dark", "mode"])
        data = json.loads(capsys.readouterr().out)
        assert "results" in data


class TestEmotionRetrieve:
    def test_emotion_retrieve_no_args(self, capsys):
        from msam.remember import cmd_emotion_retrieve
        cmd_emotion_retrieve([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_emotion_retrieve_with_query(self, capsys):
        _store_one("User feels happy about the project")
        from msam.remember import cmd_emotion_retrieve
        cmd_emotion_retrieve(["happy", "project", "--arousal", "0.8"])
        data = json.loads(capsys.readouterr().out)
        assert "results" in data
        assert data["emotion"].get("arousal") == 0.8


class TestNegative:
    def test_negative_no_args(self, capsys):
        from msam.remember import cmd_negative
        cmd_negative([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_negative_record_and_check(self, capsys):
        from msam.remember import cmd_negative
        cmd_negative(["record", "Who is the president?"])
        data = json.loads(capsys.readouterr().out)
        assert data["recorded"] is True

        cmd_negative(["check", "Who is the president?"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)

    def test_negative_expire(self, capsys):
        from msam.remember import cmd_negative
        cmd_negative(["expire"])
        data = json.loads(capsys.readouterr().out)
        assert "expired" in data


class TestAssociations:
    def test_associations_no_args(self, capsys):
        from msam.remember import cmd_associations
        cmd_associations([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_associations_with_atom_id(self, capsys):
        aid = _store_one("Test associations atom")
        from msam.remember import cmd_associations
        cmd_associations([aid])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, (dict, list))

    def test_associations_clusters(self, capsys):
        from msam.remember import cmd_associations
        cmd_associations(["clusters"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, (dict, list))


class TestRelations:
    def test_relations_no_args(self, capsys):
        from msam.remember import cmd_relations
        cmd_relations([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_relations_add_and_get(self, capsys):
        aid1 = _store_one("Source atom")
        aid2 = _store_one("Target atom")
        from msam.remember import cmd_relations
        cmd_relations(["add", aid1, aid2, "related_to"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)

        cmd_relations(["get", aid1])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, (dict, list))

    def test_relations_retrieve(self, capsys):
        _store_one("Relations retrieve test")
        from msam.remember import cmd_relations
        cmd_relations(["retrieve", "test"])
        captured = capsys.readouterr().out
        data = json.loads(captured)
        assert isinstance(data, list)


class TestQuality:
    def test_quality_no_args(self, capsys):
        from msam.remember import cmd_quality
        cmd_quality([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_quality_with_query(self, capsys):
        _store_one("Quality scoring test content")
        from msam.remember import cmd_quality
        cmd_quality(["quality", "test"])
        data = json.loads(capsys.readouterr().out)
        assert "query" in data
        assert "total" in data


class TestGraph:
    def test_graph_no_args(self, capsys):
        from msam.remember import cmd_graph
        cmd_graph([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_graph_entity(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.triples.graph_traverse",
                            lambda e, max_hops=2: {"entity": e, "nodes": [e], "edges": []})
        from msam.remember import cmd_graph
        cmd_graph(["user"])
        data = json.loads(capsys.readouterr().out)
        assert data["entity"] == "user"

    def test_graph_path(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.triples.graph_path",
                            lambda a, b, max_hops=4: {"from": a, "to": b, "path": [a, b]})
        from msam.remember import cmd_graph
        cmd_graph(["path", "user", "agent"])
        data = json.loads(capsys.readouterr().out)
        assert data["from"] == "user"


class TestConfidence:
    def test_confidence_runs(self, capsys):
        _store_one("Confidence test atom")
        from msam.remember import cmd_confidence
        cmd_confidence([])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


# ─── Tier 3: Mutation commands ────────────────────────────────────────────────


class TestWorking:
    def test_working_store(self, capsys):
        from msam.remember import cmd_working
        cmd_working(["store", "temporary", "working", "memory"])
        data = json.loads(capsys.readouterr().out)
        assert "stored" in data

    def test_working_expire(self, capsys):
        from msam.remember import cmd_working
        cmd_working([])  # default is expire
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestContribute:
    def test_contribute_no_args(self, capsys):
        from msam.remember import cmd_contribute
        cmd_contribute([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_contribute_with_args(self, capsys):
        aid = _store_one("Contribute test")
        from msam.remember import cmd_contribute
        cmd_contribute([aid, "The", "response", "text"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestFeedbackMark:
    def test_feedback_mark_no_args(self, capsys):
        from msam.remember import cmd_feedback_mark
        cmd_feedback_mark([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_feedback_mark_with_args(self, capsys):
        aid = _store_one("Feedback mark test")
        from msam.remember import cmd_feedback_mark
        cmd_feedback_mark([aid, "The", "response"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestSessionBoundary:
    def test_session_boundary_list(self, capsys):
        from msam.remember import cmd_session_boundary
        cmd_session_boundary([])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, (dict, list))

    def test_session_boundary_store(self, capsys):
        from msam.remember import cmd_session_boundary
        cmd_session_boundary(["store", "Session ended successfully"])
        data = json.loads(capsys.readouterr().out)
        assert data.get("stored") is True


class TestPin:
    def test_pin_list(self, capsys):
        from msam.remember import cmd_pin
        cmd_pin([])
        data = json.loads(capsys.readouterr().out)
        assert "pinned" in data

    def test_pin_add_and_remove(self, capsys):
        aid = _store_one("Pinnable atom")
        from msam.remember import cmd_pin
        cmd_pin(["add", aid, "important"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)

        cmd_pin(["remove", aid])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestMerge:
    def test_merge_candidates(self, capsys):
        _store_one("Merge test atom A")
        _store_one("Merge test atom B")
        from msam.remember import cmd_merge
        cmd_merge(["candidates"])
        data = json.loads(capsys.readouterr().out)
        assert "candidates" in data

    def test_merge_execute(self, capsys):
        aid1 = _store_one("Keep this atom")
        aid2 = _store_one("Remove this atom")
        from msam.remember import cmd_merge
        cmd_merge(["execute", aid1, aid2, "Merged content"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestImportance:
    def test_importance_no_args(self, capsys):
        from msam.remember import cmd_importance
        cmd_importance([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_importance_with_content(self, capsys):
        from msam.remember import cmd_importance
        cmd_importance(["User prefers dark mode"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestForget:
    def test_forget_dry_run(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.forgetting.identify_forgetting_candidates",
                            lambda dry_run=True: {"candidates": [], "dry_run": dry_run})
        from msam.remember import cmd_forget
        cmd_forget(["--dry-run"])
        data = json.loads(capsys.readouterr().out)
        assert data["dry_run"] is True

    def test_forget_auto(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.forgetting.identify_forgetting_candidates",
                            lambda dry_run=True: {"candidates": [], "dry_run": dry_run})
        from msam.remember import cmd_forget
        cmd_forget(["--auto"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestSplit:
    def test_split_no_args(self, capsys):
        from msam.remember import cmd_split
        cmd_split([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_split_too_few_segments(self, capsys):
        aid = _store_one("Splittable atom")
        from msam.remember import cmd_split
        cmd_split([aid, "only one segment"])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_split_with_segments(self, capsys):
        aid = _store_one("First part and second part")
        from msam.remember import cmd_split
        cmd_split([aid, "First part", "|||", "Second part"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


# ─── Tier 4: Complex commands ────────────────────────────────────────────────


class TestBatch:
    def test_batch_queries(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.core.batch_query", lambda qs: [
            {"query_type": "mixed", "triples": [], "atoms": [], "total_tokens": 10}
            for _ in qs
        ])
        from msam.remember import cmd_batch
        cmd_batch(["query one", "|||", "query two"])
        data = json.loads(capsys.readouterr().out)
        assert data["batch_size"] == 2


class TestExplain:
    def test_explain_no_args(self, capsys):
        from msam.remember import cmd_explain
        cmd_explain([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_explain_with_query(self, capsys):
        _store_one("Explainable atom content")
        from msam.remember import cmd_explain
        cmd_explain(["explainable"])
        data = json.loads(capsys.readouterr().out)
        assert "query" in data
        assert "results" in data


class TestProvenance:
    def test_provenance_no_args(self, capsys):
        from msam.remember import cmd_provenance
        cmd_provenance([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_provenance_with_args(self, capsys):
        aid = _store_one("Provenance test")
        from msam.remember import cmd_provenance
        cmd_provenance(["atom", aid])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, (dict, list))


class TestSummarize:
    def test_summarize_no_args(self, capsys):
        from msam.remember import cmd_summarize
        cmd_summarize([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_summarize_with_atom(self, capsys):
        aid = _store_one("A long content that should be summarized into something shorter for efficiency")
        from msam.remember import cmd_summarize
        cmd_summarize([aid])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)


class TestSnapshot:
    def test_snapshot_runs(self, capsys, monkeypatch, metrics_db):
        # Mock out external calls that snapshot makes
        monkeypatch.setattr("msam.remember.log_system_snapshot", lambda: None)
        monkeypatch.setattr("msam.remember.log_access_event",
                            lambda **kw: None)
        monkeypatch.setattr("msam.remember.log_comparison",
                            lambda **kw: None)
        monkeypatch.setattr("msam.remember.hybrid_retrieve_with_triples",
                            lambda q, mode="task", token_budget=200: {
                                "triples": [], "atoms": [], "triple_tokens": 0,
                                "atom_tokens": 0, "total_tokens": 0,
                                "items_returned": 0, "latency_ms": 0,
                            })
        from msam.remember import cmd_snapshot
        cmd_snapshot()
        data = json.loads(capsys.readouterr().out)
        assert data["snapshot"] == "ok"
        assert "stats" in data


class TestCalibrate:
    def test_calibrate_no_args(self, capsys):
        from msam.remember import cmd_calibrate
        cmd_calibrate([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_calibrate_with_provider(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.calibration.calibrate",
                            lambda provider, top_k=10: {"provider": provider, "top_k": top_k, "results": []})
        from msam.remember import cmd_calibrate
        cmd_calibrate(["test-provider"])
        data = json.loads(capsys.readouterr().out)
        assert data["provider"] == "test-provider"


class TestReembed:
    def test_reembed_no_args(self, capsys):
        from msam.remember import cmd_reembed
        cmd_reembed([])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_reembed_dry_run(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.calibration.re_embed",
                            lambda provider, batch_size=50, dry_run=False: {
                                "provider": provider, "dry_run": dry_run, "re_embedded": 0
                            })
        from msam.remember import cmd_reembed
        cmd_reembed(["test-provider", "--dry-run"])
        data = json.loads(capsys.readouterr().out)
        assert data["dry_run"] is True


class TestWorldCmd:
    def test_world_show_all(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.triples.query_world", lambda **kw: [])
        from msam.remember import cmd_world
        cmd_world([])
        data = json.loads(capsys.readouterr().out)
        assert "triples" in data
        assert data["count"] == 0

    def test_world_entity_query(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.triples.query_world",
                            lambda **kw: [{"subject": "Jaden", "predicate": "is_in", "object": "Oakland"}])
        from msam.remember import cmd_world
        cmd_world(["Jaden"])
        data = json.loads(capsys.readouterr().out)
        assert data["entity"] == "Jaden"
        assert data["count"] == 1

    def test_world_set(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.triples.update_world",
                            lambda s, p, o, **kw: {"updated": True, "subject": s})
        from msam.remember import cmd_world
        cmd_world(["--set", "Jaden", "is_in", "Oakland"])
        data = json.loads(capsys.readouterr().out)
        assert data["updated"] is True

    def test_world_history(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.triples.world_history",
                            lambda s, p: [{"object": "SF", "valid_from": "2025-01-01"},
                                          {"object": "Oakland", "valid_from": "2026-01-01"}])
        from msam.remember import cmd_world
        cmd_world(["--history", "Jaden", "is_in"])
        data = json.loads(capsys.readouterr().out)
        assert data["count"] == 2

    def test_world_set_no_args(self, capsys):
        from msam.remember import cmd_world
        cmd_world(["--set"])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_world_history_no_args(self, capsys):
        from msam.remember import cmd_world
        cmd_world(["--history"])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data


class TestAgreementCmd:
    def test_agreement_show(self, capsys, metrics_db):
        from msam.remember import cmd_agreement
        cmd_agreement([])
        data = json.loads(capsys.readouterr().out)
        assert "rate" in data

    def test_agreement_record(self, capsys, metrics_db):
        from msam.remember import cmd_agreement
        cmd_agreement(["record", "agree"])
        data = json.loads(capsys.readouterr().out)
        assert data["recorded"] == "agree"

    def test_agreement_invalid_signal(self, capsys, metrics_db):
        from msam.remember import cmd_agreement
        cmd_agreement(["record", "invalid_signal"])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data

    def test_agreement_with_agent(self, capsys, metrics_db):
        from msam.remember import cmd_agreement
        cmd_agreement(["--agent", "test-agent", "--window", "10"])
        data = json.loads(capsys.readouterr().out)
        assert "rate" in data


class TestPredictCmd:
    def test_predict_context_mode(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.prediction.PredictiveEngine.predict_context",
                            lambda self, hour=None, day_of_week=None, top_k=8: [])
        from msam.remember import cmd_predict
        cmd_predict(["--format", "context", "--hour", "14"])
        data = json.loads(capsys.readouterr().out)
        assert data["mode"] == "predict_context"
        assert data["hour"] == 14

    def test_predict_learn(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.prediction.PredictiveEngine.learn_from_session",
                            lambda self, ids: None)
        from msam.remember import cmd_predict
        cmd_predict(["--learn", "atom1", "atom2"])
        data = json.loads(capsys.readouterr().out)
        assert data["learned"] is True
        assert data["atom_count"] == 2

    def test_predict_default(self, capsys, monkeypatch):
        monkeypatch.setattr("msam.core.predict_needed_atoms", lambda ctx: [])
        from msam.remember import cmd_predict
        cmd_predict(["--time", "morning", "--active"])
        data = json.loads(capsys.readouterr().out)
        assert "predictions" in data


class TestFeedbackCmd:
    def test_feedback_analyze(self, capsys):
        from msam.remember import cmd_feedback
        cmd_feedback(["--analyze"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)

    def test_feedback_outcome(self, capsys):
        aid = _store_one("Feedback outcome test")
        from msam.remember import cmd_feedback
        cmd_feedback([aid, "positive"])
        data = json.loads(capsys.readouterr().out)
        assert isinstance(data, dict)

    def test_feedback_invalid_type(self, capsys):
        from msam.remember import cmd_feedback
        cmd_feedback(["atom123", "badtype"])
        data = json.loads(capsys.readouterr().out)
        assert "error" in data
