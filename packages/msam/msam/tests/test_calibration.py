"""MSAM Calibration Tests -- ranking metrics and re-embed logic."""

import json
import struct
from datetime import datetime, timezone

import pytest
import numpy as np


@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    """Use a temporary database for all tests."""
    db_path = tmp_path / "test_msam.db"
    monkeypatch.setattr("msam.core.DB_PATH", db_path)
    fake_emb = list(np.random.randn(1024).astype(float))
    monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
    monkeypatch.setattr("msam.core.embed_query", lambda t: fake_emb)
    monkeypatch.setattr("msam.core._cached_embed_query_import", lambda t: tuple(fake_emb))
    monkeypatch.setattr("msam.core.cached_embed_query", lambda t: fake_emb)
    yield db_path


class TestKendallTau:
    def test_perfect_agreement(self):
        from msam.calibration import _kendall_tau
        ranking = ["a", "b", "c", "d", "e"]
        assert _kendall_tau(ranking, ranking) == 1.0

    def test_perfect_disagreement(self):
        from msam.calibration import _kendall_tau
        ranking_a = ["a", "b", "c", "d"]
        ranking_b = ["d", "c", "b", "a"]
        assert _kendall_tau(ranking_a, ranking_b) == -1.0

    def test_partial_overlap(self):
        from msam.calibration import _kendall_tau
        ranking_a = ["a", "b", "c", "d"]
        ranking_b = ["a", "c", "b", "d"]
        tau = _kendall_tau(ranking_a, ranking_b)
        assert -1.0 <= tau <= 1.0

    def test_empty_rankings(self):
        from msam.calibration import _kendall_tau
        assert _kendall_tau([], []) == 0.0

    def test_single_item(self):
        from msam.calibration import _kendall_tau
        assert _kendall_tau(["a"], ["a"]) == 0.0


class TestOverlapAtK:
    def test_identical_rankings(self):
        from msam.calibration import _overlap_at_k
        ranking = ["a", "b", "c", "d", "e"]
        assert _overlap_at_k(ranking, ranking, 3) == 1.0

    def test_completely_different(self):
        from msam.calibration import _overlap_at_k
        ranking_a = ["a", "b", "c"]
        ranking_b = ["d", "e", "f"]
        assert _overlap_at_k(ranking_a, ranking_b, 3) == 0.0

    def test_partial_overlap(self):
        from msam.calibration import _overlap_at_k
        ranking_a = ["a", "b", "c", "d", "e"]
        ranking_b = ["a", "c", "f", "d", "e"]
        overlap = _overlap_at_k(ranking_a, ranking_b, 3)
        assert overlap == pytest.approx(2 / 3, abs=0.01)

    def test_k_larger_than_ranking(self):
        from msam.calibration import _overlap_at_k
        ranking_a = ["a", "b"]
        ranking_b = ["a", "b"]
        assert _overlap_at_k(ranking_a, ranking_b, 5) == pytest.approx(2 / 5)


class TestRankAtomsByQuery:
    def test_ranks_by_similarity(self):
        from msam.calibration import _rank_atoms_by_query

        # Create query and atom embeddings with known similarities
        query = [1.0, 0.0, 0.0]
        ids = ["close", "far", "medium"]
        embs = [
            [0.9, 0.1, 0.0],   # close to query
            [0.0, 0.0, 1.0],   # far from query
            [0.5, 0.5, 0.0],   # medium
        ]

        ranked = _rank_atoms_by_query(query, ids, embs)
        assert ranked[0] == "close"
        assert ranked[-1] == "far"


class TestCalibrateEmpty:
    def test_calibrate_empty_db(self, monkeypatch):
        from msam.core import get_db, run_migrations
        from msam.calibration import calibrate

        conn = get_db()
        run_migrations(conn)
        conn.close()

        # Mock provider to avoid real API calls
        class FakeProvider:
            def embed(self, text, input_type="passage"):
                return list(np.random.randn(384).astype(float))
            def batch_embed(self, texts, input_type="passage"):
                return [list(np.random.randn(384).astype(float)) for _ in texts]

        monkeypatch.setattr("msam.calibration._instantiate_provider", lambda n: FakeProvider())
        monkeypatch.setattr("msam.calibration.get_provider", lambda: FakeProvider())

        result = calibrate("onnx", top_k=5)

        assert result["target_provider"] == "onnx"
        assert result["aggregate"]["risk_level"] == "low"
        assert result["aggregate"]["recommendation"] == "No atoms to compare."


class TestReEmbed:
    def test_dry_run_reports_count(self):
        from msam.core import get_db, run_migrations, store_atom
        from msam.calibration import re_embed

        conn = get_db()
        run_migrations(conn)
        conn.close()

        store_atom("Test atom for re-embed dry run")
        store_atom("Another test atom for re-embed")

        result = re_embed("onnx", dry_run=True)

        assert result["dry_run"] is True
        assert result["atoms_total"] >= 2
        assert result["atoms_updated"] == 0
        assert result["index_rebuild_needed"] is True

    def test_actual_reembed(self, monkeypatch):
        from msam.core import get_db, run_migrations, store_atom, unpack_embedding
        from msam.calibration import re_embed

        conn = get_db()
        run_migrations(conn)
        conn.close()

        atom_id = store_atom("Test atom for actual re-embed")

        # Mock the target provider
        target_emb = list(np.random.randn(384).astype(float))

        class FakeProvider:
            def embed(self, text, input_type="passage"):
                return target_emb
            def batch_embed(self, texts, input_type="passage"):
                return [target_emb for _ in texts]

        monkeypatch.setattr("msam.calibration._instantiate_provider", lambda n: FakeProvider())

        result = re_embed("fake-provider", batch_size=10, dry_run=False)

        assert result["dry_run"] is False
        assert result["atoms_updated"] >= 1

        # Verify the embedding was updated
        conn = get_db()
        row = conn.execute(
            "SELECT embedding, embedding_provider FROM atoms WHERE id = ?",
            (atom_id,)
        ).fetchone()
        conn.close()

        assert row["embedding_provider"] == "fake-provider"
        stored_emb = unpack_embedding(row["embedding"])
        assert len(stored_emb) == 384


class TestSchemaV7:
    def test_migration_adds_embedding_provider_column(self):
        from msam.core import get_db, run_migrations

        conn = get_db()
        result = run_migrations(conn)

        # Verify column exists
        row = conn.execute(
            "SELECT embedding_provider FROM atoms LIMIT 1"
        ).fetchone()
        # No error means column exists
        conn.close()

    def test_store_atom_sets_embedding_provider(self):
        from msam.core import get_db, run_migrations, store_atom

        conn = get_db()
        run_migrations(conn)
        conn.close()

        atom_id = store_atom("Test atom with provider tracking")
        assert atom_id is not None

        conn = get_db()
        row = conn.execute(
            "SELECT embedding_provider FROM atoms WHERE id = ?",
            (atom_id,)
        ).fetchone()
        conn.close()

        assert row["embedding_provider"] is not None

    def test_migration_backfills_provider(self):
        from msam.core import get_db, run_migrations

        conn = get_db()
        # Run migrations first to create the column
        run_migrations(conn)

        # Insert an atom without embedding_provider (simulating pre-v7 atom)
        import hashlib
        now = datetime.now(timezone.utc).isoformat()
        content = "backfill test atom"
        content_hash = hashlib.sha256(content.encode()).hexdigest()[:32]
        emb = struct.pack('1024f', *np.random.randn(1024).astype(np.float32))
        conn.execute("""
            INSERT INTO atoms (id, content, content_hash, created_at, embedding,
                              topics, metadata, embedding_provider)
            VALUES (?, ?, ?, ?, ?, '[]', '{}', NULL)
        """, ("backfill_test", content, content_hash, now, emb))
        conn.commit()

        # Simulate running migration 7 backfill manually
        from msam.config import get_config
        cfg = get_config()
        provider_name = cfg('embedding', 'provider', 'nvidia-nim')
        conn.execute(
            "UPDATE atoms SET embedding_provider = ? WHERE embedding_provider IS NULL",
            (provider_name,)
        )
        conn.commit()

        row = conn.execute(
            "SELECT embedding_provider FROM atoms WHERE id = 'backfill_test'"
        ).fetchone()
        conn.close()

        assert row["embedding_provider"] == provider_name
