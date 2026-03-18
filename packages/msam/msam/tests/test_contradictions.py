"""MSAM Contradictions Tests -- unit tests for semantic contradiction detection."""

import os
import sys
import json
import struct
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

import pytest

# Ensure msam is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from msam.contradictions import (
    _detect_negation,
    _detect_antonyms,
    _detect_value_conflict,
    _detect_temporal_supersession,
)


class TestDetectNegation:
    def test_negation_detected(self):
        assert _detect_negation(
            "Alice enjoys running every morning",
            "Alice does not enjoy running every morning",
        )

    def test_no_negation_when_both_positive(self):
        assert not _detect_negation(
            "Alice enjoys running every morning",
            "Alice likes running every morning",
        )

    def test_no_negation_when_both_negative(self):
        assert not _detect_negation(
            "Alice doesn't enjoy running",
            "Alice never liked running",
        )

    def test_no_negation_unrelated_texts(self):
        assert not _detect_negation(
            "The weather is sunny",
            "I bought new shoes",
        )


class TestDetectTemporalSupersession:
    def test_different_dates_in_content(self):
        atom_a = {"content": "As of 2024-01-15, the price is $100", "created_at": "2024-01-15T00:00:00+00:00"}
        atom_b = {"content": "As of 2024-06-01, the price is $120", "created_at": "2024-06-01T00:00:00+00:00"}
        assert _detect_temporal_supersession(atom_a, atom_b)

    def test_temporal_words_one_side(self):
        atom_a = {"content": "Alice currently lives in NYC", "created_at": "2024-06-01T00:00:00+00:00"}
        atom_b = {"content": "Alice lives in Boston", "created_at": "2024-01-01T00:00:00+00:00"}
        assert _detect_temporal_supersession(atom_a, atom_b)

    def test_no_temporal_supersession_same_date(self):
        atom_a = {"content": "Price is $100", "created_at": "2024-01-15T00:00:00+00:00"}
        atom_b = {"content": "Quality is high", "created_at": "2024-01-15T00:00:00+00:00"}
        assert not _detect_temporal_supersession(atom_a, atom_b)


class TestDetectValueConflict:
    def test_different_values_same_property(self):
        assert _detect_value_conflict(
            "Alice lives in New York City",
            "Alice lives in Los Angeles",
        )

    def test_same_value_no_conflict(self):
        assert not _detect_value_conflict(
            "Alice lives in New York City",
            "Alice lives in New York City",
        )

    def test_no_conflict_different_properties(self):
        # Texts with no shared verb patterns should not conflict
        assert not _detect_value_conflict(
            "The weather looks nice today",
            "I enjoy reading books at home",
        )


class TestDetectAntonyms:
    def test_antonym_pair_detected(self):
        assert _detect_antonyms(
            "I love this project",
            "I hate this project",
        )

    def test_no_antonyms(self):
        assert not _detect_antonyms(
            "The cat sat on the mat",
            "The dog played in the yard",
        )

    def test_start_stop_antonyms(self):
        assert _detect_antonyms(
            "We should start the migration",
            "We should stop the migration",
        )

    def test_accept_reject_antonyms(self):
        assert _detect_antonyms(
            "The committee will accept the proposal",
            "The committee will reject the proposal",
        )


class TestCheckBeforeStore:
    @patch("msam.contradictions.get_db")
    @patch("msam.contradictions.embed_query")
    def test_returns_empty_for_no_atoms(self, mock_embed, mock_db):
        mock_embed.return_value = [0.0] * 1024
        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchall.return_value = []
        mock_db.return_value = mock_conn

        from msam.contradictions import check_before_store
        result = check_before_store("some new content")
        assert result == []

    @patch("msam.contradictions.get_db")
    @patch("msam.contradictions.embed_query")
    @patch("msam.contradictions.unpack_embedding")
    @patch("msam.contradictions.cosine_similarity")
    def test_returns_empty_for_non_contradictory(self, mock_sim, mock_unpack, mock_embed, mock_db):
        from datetime import datetime, timezone
        mock_embed.return_value = [1.0] * 1024
        mock_unpack.return_value = [1.0] * 1024
        # Low similarity means no contradiction check triggered
        mock_sim.return_value = 0.50

        # Use current time so temporal supersession doesn't trigger
        now_iso = datetime.now(timezone.utc).isoformat()
        fake_row = {
            "id": "abc123",
            "content": "The sky is blue",
            "embedding": b"\x00" * 4096,
            "topics": "[]",
            "created_at": now_iso,
            "arousal": 0.5,
            "valence": 0.0,
        }
        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchall.return_value = [fake_row]
        mock_db.return_value = mock_conn

        from msam.contradictions import check_before_store
        # Use identical content so no detector triggers
        result = check_before_store("The sky is blue")
        assert result == []


class TestFindSemanticContradictions:
    @patch("msam.contradictions.get_db")
    def test_returns_empty_for_no_atoms(self, mock_db):
        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchall.return_value = []
        mock_db.return_value = mock_conn

        from msam.contradictions import find_semantic_contradictions
        result = find_semantic_contradictions()
        assert result == []
        assert isinstance(result, list)
