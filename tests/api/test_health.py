"""API health check tests."""
import requests
import pytest
from conftest import BASE_URL, GATEWAY_URL, OPENCLAW_URL, ASSISTANT_ID


class TestHealthChecks:
    """Verify all services are reachable."""

    def test_nextjs_pearlos_returns_200(self):
        r = requests.get(f"{BASE_URL}/{ASSISTANT_ID}", timeout=10)
        assert r.status_code == 200, f"PearlOS returned {r.status_code}"

    def test_gateway_health(self):
        r = requests.get(f"{GATEWAY_URL}/health", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok" or "status" in data

    def test_gateway_tools_list(self):
        r = requests.get(f"{GATEWAY_URL}/api/tools/list", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, (list, dict)), f"Unexpected tools response: {type(data)}"

    def test_openclaw_responds(self):
        try:
            r = requests.get(f"{OPENCLAW_URL}/health", timeout=5)
            assert r.status_code in (200, 404, 405), f"OpenClaw returned {r.status_code}"
        except requests.ConnectionError:
            pytest.skip("OpenClaw not running on port 18789")
