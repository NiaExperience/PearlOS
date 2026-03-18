"""MSAM Annotation Tests -- heuristic, classification, and LLM annotation."""

import sys
import os
import json

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from msam.annotate import (
    heuristic_annotate,
    classify_profile,
    classify_stream,
    smart_annotate,
    llm_annotate,
)


class TestHeuristicAnnotate:
    def test_returns_valid_structure(self):
        result = heuristic_annotate("A simple test sentence.")
        assert "arousal" in result
        assert "valence" in result
        assert "topics" in result
        assert "encoding_confidence" in result
        assert 0.0 <= result["arousal"] <= 1.0
        assert -1.0 <= result["valence"] <= 1.0
        assert isinstance(result["topics"], list)
        assert 0.0 <= result["encoding_confidence"] <= 1.0

    def test_high_arousal_content(self):
        result = heuristic_annotate("URGENT!! This is a CRITICAL emergency, I'm terrified!!")
        assert result["arousal"] > 0.5

    def test_positive_valence(self):
        result = heuristic_annotate("I love this amazing wonderful day, feeling happy and grateful")
        assert result["valence"] > 0.0

    def test_negative_valence(self):
        result = heuristic_annotate("I hate this terrible horrible situation, feeling sad and frustrated")
        assert result["valence"] < 0.0

    def test_topic_detection(self):
        result = heuristic_annotate("I need to fix the bug in the server code and deploy the database")
        assert "technology" in result["topics"]

    def test_max_five_topics(self):
        result = heuristic_annotate(
            "I feel sad about work at the hotel, watching anime and coding a game while remembering"
        )
        assert len(result["topics"]) <= 5


class TestClassifyProfile:
    def test_short_content_lightweight(self):
        assert classify_profile("User likes sushi") == "lightweight"

    def test_medium_content_standard(self):
        text = " ".join(["word"] * 50)
        assert classify_profile(text) == "standard"

    def test_long_content_full(self):
        text = " ".join(["word"] * 100)
        assert classify_profile(text) == "full"


class TestClassifyStream:
    def test_procedural_how_to(self):
        assert classify_stream("how to install the package") == "procedural"

    def test_procedural_rule(self):
        assert classify_stream("always use HTTPS, never send plain text") == "procedural"

    def test_episodic_time_reference(self):
        assert classify_stream("yesterday we talked about the project") == "episodic"

    def test_episodic_date_pattern(self):
        assert classify_stream("meeting on 2025-01-15 at 10:00") == "episodic"

    def test_semantic_default(self):
        assert classify_stream("The capital of France is Paris") == "semantic"


class TestSmartAnnotate:
    def test_heuristic_path(self):
        result = smart_annotate("A simple test.", use_llm=False)
        assert "arousal" in result
        assert "valence" in result
        assert "topics" in result
        assert "encoding_confidence" in result

    def test_llm_path_fallback_no_api_key(self, monkeypatch):
        monkeypatch.delenv("NVIDIA_NIM_API_KEY", raising=False)
        result = smart_annotate("A simple test.", use_llm=True)
        # Should fall back to heuristic when no API key is set
        assert "arousal" in result
        assert "valence" in result
        assert "topics" in result
        assert "encoding_confidence" in result
        assert result["encoding_confidence"] == 0.5  # heuristic default


class TestLlmAnnotate:
    def test_fallback_when_no_api_key(self, monkeypatch):
        monkeypatch.delenv("NVIDIA_NIM_API_KEY", raising=False)
        result = llm_annotate("Testing fallback behavior.")
        # Should return heuristic result
        assert "arousal" in result
        assert "valence" in result
        assert "topics" in result
        assert "encoding_confidence" in result
        assert result["encoding_confidence"] == 0.5  # heuristic confidence
