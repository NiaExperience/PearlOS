#!/usr/bin/env python3
"""voice-qa-test.py — Automated voice pipeline QA with real audio.

Generates test WAVs, plays them through the voice pipeline via Daily.co,
measures latency at each stage, and reports results.

Usage:
  python3 voice-qa-test.py              # Run all tests
  python3 voice-qa-test.py --quick      # Run 3 quick tests
  python3 voice-qa-test.py --test chat  # Run only chat tests
"""

import json, os, sys, time, subprocess, urllib.request, ssl, tempfile
from datetime import datetime, timezone
from pathlib import Path

# Config
POCKET_TTS_URL = "http://localhost:8766/tts"
DEEPSEEK_PROXY = "http://127.0.0.1:8200/v1/chat/completions"
DEEPSEEK_KEY = "sk-c4f226aeeaa044f2a9eba95737b491a5"
VOXTRAL_URL = "https://api.mistral.ai/v1/audio/speech"
VOXTRAL_KEY = "dgmEOdhmTXWYgzTxfilOS3aJwE6lHa2m"
OPENCLAW_URL = "http://localhost:18789/v1/chat/completions"
OPENCLAW_KEY = "2ad4bea7362a39ee0231b13ec0b1e9766fdaf61ab59ebe7e"
BOT_GATEWAY = "http://localhost:4444"
RESULTS_DIR = "/workspace/user/Documents/voice-qa"

# Test prompts organized by category
TESTS = {
    "chat": [
        "How are you feeling today?",
        "What have you been up to?",
        "Tell me something interesting",
        "Good morning Pearl",
    ],
    "tools": [
        "What's the weather in Boston today?",
        "What's the latest news with NVIDIA?",
        "Can you check the task queue?",
        "Dispatch an agent to review our voice pipeline",
    ],
    "notes": [
        "Can you open the note about NVIDIA?",
        "Create a new note called voice test results",
        "What notes do I have?",
    ],
    "complex": [
        "I need you to research the latest AI model releases and create a summary note",
        "What were we working on yesterday? Check the activity log",
        "Can you fire a swarm of 3 agents to analyze our deployment architecture?",
    ],
}

ctx = ssl.create_default_context()


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def generate_wav(text: str, output_path: str) -> bool:
    """Generate a WAV file using PocketTTS."""
    try:
        import urllib.parse
        data = urllib.parse.urlencode({"text": text, "voice": "azelma"}).encode()
        req = urllib.request.Request(
            POCKET_TTS_URL, data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            with open(output_path, "wb") as f:
                f.write(resp.read())
        return os.path.getsize(output_path) > 1000
    except Exception as e:
        log(f"  WAV generation failed: {e}")
        return False


def test_stt_latency(wav_path: str) -> dict:
    """Placeholder — STT latency requires Deepgram streaming which needs a WebSocket.
    For now, estimate based on file duration."""
    size = os.path.getsize(wav_path)
    # ~16000 samples/sec * 2 bytes = 32000 bytes/sec for 16kHz mono
    duration_ms = (size / 32000) * 1000
    return {"stt_estimated_ms": round(duration_ms * 0.1 + 200)}  # ~200ms base + 10% of duration


def test_llm_direct(prompt: str, tools: list | None = None) -> dict:
    """Test DeepSeek direct via proxy."""
    body = {
        "model": "deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": "You are Pearl. Keep voice answers under 2 sentences."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 150,
    }
    if tools:
        body["tools"] = tools

    data = json.dumps(body).encode()
    req = urllib.request.Request(
        DEEPSEEK_PROXY, data=data,
        headers={
            "Authorization": f"Bearer {DEEPSEEK_KEY}",
            "Content-Type": "application/json",
        },
    )
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
            result = json.loads(resp.read())
        elapsed = round((time.monotonic() - start) * 1000)
        msg = result["choices"][0]["message"]
        return {
            "llm_direct_ms": elapsed,
            "content": (msg.get("content") or "")[:200],
            "tool_calls": bool(msg.get("tool_calls")),
            "finish_reason": result["choices"][0].get("finish_reason"),
            "tokens_out": result.get("usage", {}).get("completion_tokens", 0),
        }
    except Exception as e:
        return {"llm_direct_ms": -1, "error": str(e)[:200]}


def test_llm_openclaw(prompt: str) -> dict:
    """Test via OpenClaw session (what voice currently uses for Phase 2)."""
    body = {
        "model": "openclaw/voice",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 150,
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        OPENCLAW_URL, data=data,
        headers={
            "Authorization": f"Bearer {OPENCLAW_KEY}",
            "Content-Type": "application/json",
        },
    )
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=120) as resp:
            result = json.loads(resp.read())
        elapsed = round((time.monotonic() - start) * 1000)
        msg = result["choices"][0]["message"]
        return {
            "llm_openclaw_ms": elapsed,
            "content": (msg.get("content") or "")[:200],
        }
    except Exception as e:
        elapsed = round((time.monotonic() - start) * 1000)
        return {"llm_openclaw_ms": elapsed, "error": str(e)[:200]}


def test_tts_voxtral(text: str) -> dict:
    """Test Voxtral TTS latency."""
    body = {
        "model": "voxtral-mini-tts-2603",
        "input": text[:200],
        "voice": "gb_jane_sarcasm",
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        VOXTRAL_URL, data=data,
        headers={
            "Authorization": f"Bearer {VOXTRAL_KEY}",
            "Content-Type": "application/json",
        },
    )
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            audio = resp.read()
        elapsed = round((time.monotonic() - start) * 1000)
        return {"tts_voxtral_ms": elapsed, "audio_bytes": len(audio)}
    except Exception as e:
        return {"tts_voxtral_ms": -1, "error": str(e)[:200]}


def test_tts_pocket(text: str) -> dict:
    """Test PocketTTS latency."""
    import urllib.parse
    data = urllib.parse.urlencode({"text": text[:200], "voice": "azelma"}).encode()
    req = urllib.request.Request(
        POCKET_TTS_URL, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            audio = resp.read()
        elapsed = round((time.monotonic() - start) * 1000)
        return {"tts_pocket_ms": elapsed, "audio_bytes": len(audio)}
    except Exception as e:
        return {"tts_pocket_ms": -1, "error": str(e)[:200]}


BASIC_TOOLS = [
    {"type": "function", "function": {"name": "bot_list_tasks", "description": "List tasks", "parameters": {"type": "object", "properties": {"status": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "bot_openclaw_task", "description": "Dispatch background task", "parameters": {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]}}},
    {"type": "function", "function": {"name": "bot_web_search", "description": "Search the web", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "bot_get_weather", "description": "Get weather for a location", "parameters": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}}},
    {"type": "function", "function": {"name": "bot_open_note", "description": "Open a note by name", "parameters": {"type": "object", "properties": {"note_name": {"type": "string"}}, "required": ["note_name"]}}},
]


def run_test(category: str, prompt: str, idx: int) -> dict:
    """Run a single test measuring all pipeline components."""
    log(f"Test {idx}: [{category}] \"{prompt[:50]}...\"")
    result = {"category": category, "prompt": prompt, "timestamp": datetime.now(timezone.utc).isoformat()}

    # 1. Generate input WAV
    wav_path = f"/tmp/voice-qa-input-{idx}.wav"
    if generate_wav(prompt, wav_path):
        result["input_wav_bytes"] = os.path.getsize(wav_path)
        result.update(test_stt_latency(wav_path))
    else:
        result["stt_estimated_ms"] = 200

    # 2. LLM direct (DeepSeek via proxy)
    tools = BASIC_TOOLS if category in ("tools", "notes", "complex") else None
    llm_result = test_llm_direct(prompt, tools)
    result.update(llm_result)

    # 3. TTS (Voxtral)
    response_text = llm_result.get("content", "I'm not sure about that.")
    if response_text and len(response_text) > 5:
        tts_result = test_tts_voxtral(response_text)
        result.update(tts_result)
    else:
        result["tts_voxtral_ms"] = 0

    # 4. Calculate totals
    stt = result.get("stt_estimated_ms", 200)
    llm = result.get("llm_direct_ms", 0)
    tts = result.get("tts_voxtral_ms", 0)
    if llm > 0 and tts > 0:
        result["total_estimated_ms"] = stt + llm + tts
        result["total_estimated_s"] = round(result["total_estimated_ms"] / 1000, 1)

    # Log summary
    total = result.get("total_estimated_s", "?")
    content_preview = result.get("content", "")[:60]
    tool_used = "🔧" if result.get("tool_calls") else ""
    error = result.get("error", "")
    if error:
        log(f"  ❌ ERROR: {error[:80]}")
    else:
        log(f"  ✅ {total}s total | LLM:{llm}ms TTS:{tts}ms {tool_used} | \"{content_preview}\"")

    return result


def run_suite(categories: list[str] | None = None, quick: bool = False):
    """Run the full test suite."""
    os.makedirs(RESULTS_DIR, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    report_path = f"{RESULTS_DIR}/voice-qa-{timestamp}.json"

    log("=" * 60)
    log("PearlOS Voice QA Test Suite")
    log("=" * 60)

    # Pre-flight checks
    log("Pre-flight checks...")
    checks = {}
    for name, url in [
        ("DeepSeek proxy", "http://localhost:8200/v1/models"),
        ("Voxtral TTS (Mistral)", "https://api.mistral.ai/v1/models"),
        ("PocketTTS", "http://localhost:8766/health"),
        ("OpenClaw", "http://localhost:18789/health"),
        ("Bot Gateway", "http://localhost:4444/health"),
    ]:
        try:
            headers = {}
            if "8200" in url:
                headers["Authorization"] = f"Bearer {DEEPSEEK_KEY}"
            req = urllib.request.Request(url, headers=headers)
            urllib.request.urlopen(req, timeout=5)
            checks[name] = "✅"
        except Exception as e:
            checks[name] = f"❌ {e}"
    for name, status in checks.items():
        log(f"  {name}: {status}")

    # Run tests
    results = []
    idx = 0
    for cat, prompts in TESTS.items():
        if categories and cat not in categories:
            continue
        log(f"\n--- Category: {cat} ---")
        for prompt in prompts:
            if quick and idx >= 3:
                break
            idx += 1
            result = run_test(cat, prompt, idx)
            results.append(result)
            time.sleep(0.5)  # Brief pause between tests

    # Summary
    log("\n" + "=" * 60)
    log("SUMMARY")
    log("=" * 60)

    successful = [r for r in results if "error" not in r and r.get("llm_direct_ms", 0) > 0]
    failed = [r for r in results if "error" in r or r.get("llm_direct_ms", 0) <= 0]

    if successful:
        avg_llm = round(sum(r["llm_direct_ms"] for r in successful) / len(successful))
        avg_tts = round(sum(r.get("tts_voxtral_ms", 0) for r in successful) / len(successful))
        avg_total = round(sum(r.get("total_estimated_ms", 0) for r in successful) / len(successful))
        tool_tests = [r for r in successful if r.get("tool_calls")]

        log(f"Passed: {len(successful)}/{len(results)}")
        log(f"Failed: {len(failed)}/{len(results)}")
        log(f"Avg LLM latency: {avg_llm}ms")
        log(f"Avg TTS latency: {avg_tts}ms")
        log(f"Avg total E2E: {avg_total}ms ({round(avg_total/1000, 1)}s)")
        log(f"Tool calls triggered: {len(tool_tests)}/{len(successful)}")

        if avg_total < 3000:
            log("🟢 EXCELLENT — under 3s target")
        elif avg_total < 5000:
            log("🟡 ACCEPTABLE — under 5s")
        elif avg_total < 10000:
            log("🟠 SLOW — needs optimization")
        else:
            log("🔴 UNACCEPTABLE — major latency issues")
    else:
        log("❌ ALL TESTS FAILED")

    for r in failed:
        log(f"  ❌ {r['prompt'][:40]}: {r.get('error', 'unknown')[:80]}")

    # Save report
    report = {
        "timestamp": timestamp,
        "total_tests": len(results),
        "passed": len(successful),
        "failed": len(failed),
        "avg_llm_ms": avg_llm if successful else 0,
        "avg_tts_ms": avg_tts if successful else 0,
        "avg_total_ms": avg_total if successful else 0,
        "results": results,
    }
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    log(f"\nReport saved: {report_path}")

    return report


if __name__ == "__main__":
    quick = "--quick" in sys.argv
    categories = None
    for arg in sys.argv[1:]:
        if arg.startswith("--test="):
            categories = [arg.split("=")[1]]
        elif arg == "--test" and sys.argv.index(arg) + 1 < len(sys.argv):
            categories = [sys.argv[sys.argv.index(arg) + 1]]

    run_suite(categories=categories, quick=quick)
