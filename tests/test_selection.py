"""Phase 2C: Template selection smoke tests (nightly — uses LLM tokens)."""
import json
import pytest
import httpx

GATEWAY_URL = "http://localhost:4444"


def _gateway_reachable() -> bool:
    try:
        r = httpx.get(f"{GATEWAY_URL}/health", timeout=2)
        return r.status_code == 200
    except Exception:
        return False


gateway_up = pytest.mark.skipif(
    not _gateway_reachable(), reason="Gateway not reachable on :4444"
)


def _chat(prompt: str) -> str:
    """Send a prompt to /api/chat (SSE streaming) and return full text."""
    with httpx.stream(
        "POST",
        f"{GATEWAY_URL}/api/chat",
        json={"messages": [{"role": "user", "content": prompt}]},
        timeout=60,
    ) as resp:
        resp.raise_for_status()
        chunks = []
        for line in resp.iter_lines():
            if line.startswith("data: ") and line != "data: [DONE]":
                try:
                    d = json.loads(line[6:])
                    content = d.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if content:
                        chunks.append(content)
                except json.JSONDecodeError:
                    pass
        return "".join(chunks)


def _passes_n_of_m(fn, n=2, m=3) -> bool:
    """Run fn m times, return True if it passes at least n times."""
    passes = 0
    for _ in range(m):
        try:
            fn()
            passes += 1
        except (AssertionError, Exception):
            pass
    return passes >= n


@pytest.mark.nightly
class TestTemplateSelection:
    @gateway_up
    def test_weather_query(self):
        """'what's the weather in Tokyo' should trigger weather-related content."""
        def _check():
            text = _chat("what's the weather in Tokyo").lower()
            assert any(w in text for w in ["weather", "temperature", "degrees", "forecast", "tokyo"]), \
                f"Response doesn't seem weather-related: {text[:200]}"

        assert _passes_n_of_m(_check), "Weather query failed 2/3 attempts"

    @gateway_up
    def test_person_bio_query(self):
        """'tell me about Albert Einstein' should trigger bio-related content."""
        def _check():
            text = _chat("tell me about Albert Einstein").lower()
            assert any(w in text for w in ["einstein", "physics", "relativity", "scientist"]), \
                f"Response doesn't seem bio-related: {text[:200]}"

        assert _passes_n_of_m(_check), "Person bio query failed 2/3 attempts"
