"""MSAM REST API Server Tests -- tests for the FastAPI-based REST API."""

import json
import os
import sys

import pytest

fastapi = pytest.importorskip("fastapi", reason="fastapi not installed")
from fastapi.testclient import TestClient

from msam.server import app


@pytest.fixture
def client():
    """Create a FastAPI test client."""
    return TestClient(app)


# ─── Health ──────────────────────────────────────────────────────────────────


class TestHealth:
    def test_health_check(self, client):
        rv = client.get("/v1/health")
        assert rv.status_code == 200
        data = rv.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert "timestamp" in data

    def test_health_no_auth_required(self, client, monkeypatch):
        """Health check should work even when API key is configured."""
        monkeypatch.setenv("MSAM_API_KEY", "test-secret")
        rv = client.get("/v1/health")
        assert rv.status_code == 200
        data = rv.json()
        assert data["status"] == "ok"


# ─── Store ───────────────────────────────────────────────────────────────────


class TestStore:
    def test_store_requires_content(self, client):
        rv = client.post("/v1/store", json={})
        assert rv.status_code == 422  # Pydantic validation error

    def test_store_success(self, client, monkeypatch):
        """Test successful store with mocked internals."""
        import msam.annotate
        monkeypatch.setattr(msam.annotate, "classify_stream", lambda c: "semantic")
        monkeypatch.setattr(msam.annotate, "classify_profile", lambda c: "standard")
        monkeypatch.setattr(msam.annotate, "smart_annotate", lambda c, use_llm=False: {
            "arousal": 0.5, "valence": 0.0,
            "topics": ["test"], "encoding_confidence": 0.7,
        })

        import msam.core
        monkeypatch.setattr(msam.core, "store_atom", lambda **kwargs: "abc123def456")

        import msam.triples
        monkeypatch.setattr(msam.triples, "extract_and_store", lambda aid, c: 2)

        rv = client.post("/v1/store", json={"content": "User prefers dark mode"})
        assert rv.status_code == 200
        data = rv.json()
        assert data["stored"] is True
        assert data["atom_id"] == "abc123def456"
        assert data["stream"] == "semantic"

    def test_store_empty_content(self, client):
        """Empty string should fail Pydantic validation or return error."""
        rv = client.post("/v1/store", json={"content": ""})
        # FastAPI/Pydantic allows empty strings; the endpoint logic handles it
        assert rv.status_code in (200, 400, 422)


# ─── Query ───────────────────────────────────────────────────────────────────


class TestQuery:
    def test_query_requires_query(self, client):
        rv = client.post("/v1/query", json={})
        assert rv.status_code == 422  # Pydantic validation error

    def test_query_success(self, client, monkeypatch):
        """Test successful query with mocked hybrid retrieval."""
        import msam.triples
        monkeypatch.setattr(msam.triples, "hybrid_retrieve_with_triples", lambda q, mode="task", token_budget=500: {
            "triples": [
                {"subject": "user", "predicate": "prefers", "object": "dark mode"},
            ],
            "atoms": [],
            "_raw_atoms": [
                {
                    "id": "abc123",
                    "content": "User prefers dark mode",
                    "stream": "semantic",
                    "_similarity": 0.85,
                    "_combined_score": 0.9,
                    "_confidence_tier": "high",
                    "_retrieval_confidence_tier": "high",
                    "topics": '["preferences"]',
                },
            ],
            "triple_tokens": 5,
            "atom_tokens": 6,
            "total_tokens": 11,
            "items_returned": 2,
            "query_type": "mixed",
            "triple_ratio": 0.4,
            "latency_ms": 10.0,
        })

        rv = client.post("/v1/query", json={"query": "user preferences"})
        assert rv.status_code == 200
        data = rv.json()
        assert data["query"] == "user preferences"
        assert data["confidence_tier"] in ("none", "low", "medium", "high")
        assert "atoms" in data
        assert "triples" in data

    def test_query_empty_query(self, client, monkeypatch):
        """Empty query should either be rejected or return empty results."""
        import msam.triples
        monkeypatch.setattr(msam.triples, "hybrid_retrieve_with_triples", lambda q, mode="task", token_budget=500: {
            "triples": [], "atoms": [], "_raw_atoms": [],
            "triple_tokens": 0, "atom_tokens": 0, "total_tokens": 0,
            "items_returned": 0, "query_type": "mixed", "triple_ratio": 0, "latency_ms": 0,
        })
        rv = client.post("/v1/query", json={"query": ""})
        assert rv.status_code == 200
        data = rv.json()
        assert data["confidence_tier"] == "none"


# ─── Stats ───────────────────────────────────────────────────────────────────


class TestStats:
    def test_stats_endpoint(self, client, monkeypatch):
        """Test stats endpoint with mocked get_stats."""
        import msam.core
        monkeypatch.setattr(msam.core, "get_stats", lambda: {
            "total_atoms": 42,
            "active": 30,
            "fading": 10,
            "dormant": 2,
        })

        rv = client.get("/v1/stats")
        assert rv.status_code == 200
        data = rv.json()
        assert data["total_atoms"] == 42


# ─── Context ────────────────────────────────────────────────────────────────


class TestContext:
    def test_context_endpoint(self, client, monkeypatch):
        """Test context endpoint with mocked dry_retrieve."""
        import msam.core
        monkeypatch.setattr(msam.core, "dry_retrieve", lambda q, mode="task", top_k=5: [
            {"id": "ctx1", "content": "I am an AI agent", "stream": "semantic", "_activation": 0.9},
        ])

        rv = client.post("/v1/context", json={})
        assert rv.status_code == 200
        data = rv.json()
        assert "sections" in data
        assert "identity" in data["sections"]
        assert "user" in data["sections"]
        assert "recent" in data["sections"]
        assert "emotional" in data["sections"]


# ─── Feedback ────────────────────────────────────────────────────────────────


class TestFeedback:
    def test_feedback_requires_atom_ids(self, client):
        rv = client.post("/v1/feedback", json={"response_text": "some text"})
        assert rv.status_code == 422

    def test_feedback_requires_response_text(self, client):
        rv = client.post("/v1/feedback", json={"atom_ids": ["abc"]})
        assert rv.status_code == 422

    def test_feedback_success(self, client, monkeypatch):
        import msam.core
        monkeypatch.setattr(msam.core, "mark_contributions", lambda ids, text: {
            "contributed": ids, "not_contributed": [],
        })

        rv = client.post("/v1/feedback", json={
            "atom_ids": ["abc123"],
            "response_text": "The user prefers dark mode",
        })
        assert rv.status_code == 200
        data = rv.json()
        assert "contributed" in data


# ─── API Key Auth ────────────────────────────────────────────────────────────


class TestApiKey:
    def test_api_key_rejection(self, client, monkeypatch):
        """Requests without API key should be rejected when key is configured."""
        monkeypatch.setenv("MSAM_API_KEY", "test-secret")
        rv = client.get("/v1/stats")
        assert rv.status_code == 401

    def test_api_key_wrong_key(self, client, monkeypatch):
        """Requests with wrong API key should be rejected."""
        monkeypatch.setenv("MSAM_API_KEY", "test-secret")
        rv = client.get("/v1/stats", headers={"X-API-Key": "wrong-key"})
        assert rv.status_code == 401

    def test_api_key_success(self, client, monkeypatch):
        """Requests with correct API key should succeed."""
        monkeypatch.setenv("MSAM_API_KEY", "test-secret")

        import msam.core
        monkeypatch.setattr(msam.core, "get_stats", lambda: {"total_atoms": 0})

        rv = client.get("/v1/stats", headers={"X-API-Key": "test-secret"})
        assert rv.status_code == 200

    def test_no_api_key_configured(self, client, monkeypatch):
        """When no MSAM_API_KEY is set, all requests should be allowed."""
        monkeypatch.delenv("MSAM_API_KEY", raising=False)

        import msam.core
        monkeypatch.setattr(msam.core, "get_stats", lambda: {"total_atoms": 0})

        rv = client.get("/v1/stats")
        assert rv.status_code == 200


# ─── Decay ───────────────────────────────────────────────────────────────────


class TestDecay:
    def test_decay_endpoint(self, client, monkeypatch):
        import msam.decay
        monkeypatch.setattr(msam.decay, "run_decay_cycle", lambda: {
            "processed": 10, "transitioned": 2,
        })

        rv = client.post("/v1/decay", json={})
        assert rv.status_code == 200
        data = rv.json()
        assert "processed" in data


# ─── Triples ────────────────────────────────────────────────────────────────


class TestTriples:
    def test_extract_requires_fields(self, client):
        rv = client.post("/v1/triples/extract", json={"atom_id": "abc"})
        assert rv.status_code == 422

        rv = client.post("/v1/triples/extract", json={"content": "hello"})
        assert rv.status_code == 422

    def test_extract_success(self, client, monkeypatch):
        import msam.triples
        monkeypatch.setattr(msam.triples, "extract_and_store", lambda aid, c: 3)

        rv = client.post("/v1/triples/extract", json={
            "atom_id": "abc123", "content": "The sky is blue",
        })
        assert rv.status_code == 200
        data = rv.json()
        assert data["triples_extracted"] == 3

    def test_graph_traversal(self, client, monkeypatch):
        import msam.triples
        monkeypatch.setattr(msam.triples, "graph_traverse", lambda e, max_hops=3: {
            "entity": e, "nodes": [e], "edges": [],
        })

        rv = client.get("/v1/triples/graph/user")
        assert rv.status_code == 200
        data = rv.json()
        assert data["entity"] == "user"


# ─── Contradictions ─────────────────────────────────────────────────────────


class TestContradictions:
    def test_contradictions_triples_mode(self, client, monkeypatch):
        import msam.triples
        monkeypatch.setattr(msam.triples, "detect_contradictions", lambda: [
            {"pair": ["triple1", "triple2"]},
        ])

        rv = client.post("/v1/contradictions", json={"mode": "triples"})
        assert rv.status_code == 200
        data = rv.json()
        assert data["count"] == 1

    def test_contradictions_default_mode(self, client, monkeypatch):
        """Default mode should be triples."""
        import msam.triples
        monkeypatch.setattr(msam.triples, "detect_contradictions", lambda: [])

        rv = client.post("/v1/contradictions", json={})
        assert rv.status_code == 200
        data = rv.json()
        assert "contradictions" in data


# ─── Predict ────────────────────────────────────────────────────────────────


class TestPredict:
    def test_predict_endpoint(self, client, monkeypatch):
        import msam.core
        monkeypatch.setattr(msam.core, "predict_needed_atoms", lambda ctx: [
            {"id": "pred1", "content": "Predicted atom", "confidence": 0.8},
        ])

        rv = client.post("/v1/predict", json={
            "time_of_day": "morning",
            "user_active": True,
        })
        assert rv.status_code == 200
        data = rv.json()
        assert data["count"] == 1
        assert len(data["predictions"]) == 1

    def test_predict_empty_body(self, client, monkeypatch):
        """Predict should work with empty body."""
        import msam.core
        monkeypatch.setattr(msam.core, "predict_needed_atoms", lambda ctx: [])

        rv = client.post("/v1/predict", json={})
        assert rv.status_code == 200
        data = rv.json()
        assert data["count"] == 0


# ─── Consolidate ─────────────────────────────────────────────────────────────


class TestConsolidate:
    def test_consolidate_dry_run(self, client, monkeypatch):
        from msam import consolidation
        monkeypatch.setattr(consolidation, "ConsolidationEngine", type(
            "MockEngine", (), {
                "__init__": lambda self: None,
                "consolidate": lambda self, dry_run=False, max_clusters=None: {
                    "clusters_found": 2, "dry_run": dry_run,
                },
            }
        ))

        rv = client.post("/v1/consolidate", json={"dry_run": True})
        assert rv.status_code == 200
        data = rv.json()
        assert data["dry_run"] is True


# ─── Replay ──────────────────────────────────────────────────────────────────


class TestReplay:
    def test_replay_endpoint(self, client, monkeypatch):
        import msam.core
        monkeypatch.setattr(msam.core, "episodic_replay", lambda **kwargs: {
            "episodes": [], "total_atoms": 0,
        })

        rv = client.post("/v1/replay", json={"topic": "meetings"})
        assert rv.status_code == 200
        data = rv.json()
        assert "episodes" in data

    def test_replay_requires_topic(self, client):
        rv = client.post("/v1/replay", json={})
        assert rv.status_code == 422


# ─── 404 / Method Errors ────────────────────────────────────────────────────


class TestErrorHandling:
    def test_not_found(self, client):
        rv = client.get("/v1/nonexistent")
        assert rv.status_code == 404

    def test_method_not_allowed(self, client):
        rv = client.get("/v1/store")  # store requires POST
        assert rv.status_code == 405
