"""Tests for Agreement Rate Tracking (Feature 4)."""

import json
import sqlite3
import pytest


@pytest.fixture(autouse=True)
def temp_metrics_db(monkeypatch, tmp_path):
    """Use a temporary metrics database for all tests."""
    db_path = tmp_path / "test_metrics.db"
    monkeypatch.setattr("msam.metrics.METRICS_DB", db_path)
    yield db_path


class TestRecordAgreement:
    def test_record_agreement(self):
        from msam.metrics import record_agreement
        result = record_agreement("agree", context="test context")
        assert result["recorded"] == "agree"
        assert "current_rate" in result

    def test_record_disagree(self):
        from msam.metrics import record_agreement
        result = record_agreement("disagree", context="pushed back on claim")
        assert result["recorded"] == "disagree"

    def test_record_challenge(self):
        from msam.metrics import record_agreement
        result = record_agreement("challenge")
        assert result["recorded"] == "challenge"


class TestAgreementRateCalculation:
    def test_agreement_rate_calculation(self):
        from msam.metrics import record_agreement, get_agreement_rate
        # Record 7 agrees and 3 disagrees
        for _ in range(7):
            record_agreement("agree")
        for _ in range(3):
            record_agreement("disagree")

        rate = get_agreement_rate()
        assert rate["count"] == 10
        assert rate["agree_count"] == 7
        assert rate["rate"] == pytest.approx(0.7, abs=0.01)
        assert rate["warning"] is False  # 0.7 < 0.85 threshold


class TestWarningThreshold:
    def test_warning_threshold(self):
        from msam.metrics import record_agreement, get_agreement_rate
        # Record 18 agrees and 2 disagrees (90% rate, window=20)
        for _ in range(18):
            record_agreement("agree")
        for _ in range(2):
            record_agreement("disagree")

        rate = get_agreement_rate(window=20)
        assert rate["rate"] >= 0.85
        assert rate["warning"] is True
        assert "warning_message" in rate


class TestWarningRequiresMinimumWindow:
    def test_warning_requires_minimum_window(self):
        from msam.metrics import record_agreement, get_agreement_rate
        # Only 5 signals (all agree) -- below window of 20, no warning
        for _ in range(5):
            record_agreement("agree")

        rate = get_agreement_rate(window=20)
        assert rate["rate"] == 1.0
        assert rate["warning"] is False  # count < window


class TestAgreementRateEmpty:
    def test_agreement_rate_empty(self):
        from msam.metrics import get_agreement_rate
        rate = get_agreement_rate()
        assert rate["rate"] == 0.0
        assert rate["count"] == 0
        assert rate["warning"] is False
        assert rate["signals"] == []


class TestGrafanaEndpoint:
    def test_grafana_endpoint(self):
        from msam.metrics import record_agreement
        # Record some signals first
        record_agreement("agree")
        record_agreement("disagree")

        from msam.api import app
        client = app.test_client()
        response = client.get("/api/agreement_rate")
        assert response.status_code == 200
        data = response.get_json()
        assert "rate" in data
        assert "count" in data
        assert data["count"] == 2
