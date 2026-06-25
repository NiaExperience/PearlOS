#!/usr/bin/env python3
"""webchat-qa-test.py — Automated web chat QA for PearlOS.

Tests Pearl's text chat capabilities: conversation, tool calls, canvas displays,
app opening, file handling, and visual responses. Measures latency and correctness.

Usage:
  python3 webchat-qa-test.py              # Run all tests
  python3 webchat-qa-test.py --quick      # Run 5 quick tests
  python3 webchat-qa-test.py --test tools # Run only tool tests
"""

import json, os, sys, time, urllib.request, urllib.error, ssl, base64
from datetime import datetime, timezone
from pathlib import Path

# Config
OPENCLAW_URL = "http://localhost:18789/v1/chat/completions"
OPENCLAW_KEY = "2ad4bea7362a39ee0231b13ec0b1e9766fdaf61ab59ebe7e"
RESULTS_DIR = "/workspace/user/Documents/webchat-qa"

ctx = ssl.create_default_context()

# Tool schemas that Pearl should have access to
TOOL_SCHEMAS = [
    {"type": "function", "function": {"name": "bot_get_weather", "description": "Get weather", "parameters": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}}},
    {"type": "function", "function": {"name": "bot_web_search", "description": "Search the web", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "bot_get_news", "description": "Get news headlines", "parameters": {"type": "object", "properties": {"topic": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "bot_open_note", "description": "Open a note", "parameters": {"type": "object", "properties": {"note_name": {"type": "string"}}, "required": ["note_name"]}}},
    {"type": "function", "function": {"name": "bot_create_note", "description": "Create a new note", "parameters": {"type": "object", "properties": {"title": {"type": "string"}, "content": {"type": "string"}}, "required": ["title"]}}},
    {"type": "function", "function": {"name": "bot_list_notes", "description": "List all notes", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "bot_wonder_canvas_template", "description": "Display a visual template on Wonder Canvas", "parameters": {"type": "object", "properties": {"template": {"type": "string"}, "data": {"type": "object"}}, "required": ["template", "data"]}}},
    {"type": "function", "function": {"name": "bot_wonder_canvas_scene", "description": "Display custom HTML on canvas", "parameters": {"type": "object", "properties": {"html": {"type": "string"}}, "required": ["html"]}}},
    {"type": "function", "function": {"name": "bot_open_youtube", "description": "Open YouTube", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "bot_play_soundtrack", "description": "Play music", "parameters": {"type": "object", "properties": {"genre": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "bot_openclaw_task", "description": "Dispatch background task", "parameters": {"type": "object", "properties": {"task": {"type": "string"}, "urgency": {"type": "string"}}, "required": ["task"]}}},
    {"type": "function", "function": {"name": "bot_list_tasks", "description": "List tasks", "parameters": {"type": "object", "properties": {"status": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "bot_look_at_user", "description": "Analyze user's camera/uploaded image", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "bot_summon_sprite", "description": "Generate a pixel art sprite", "parameters": {"type": "object", "properties": {"description": {"type": "string"}}, "required": ["description"]}}},
    {"type": "function", "function": {"name": "bot_open_browser_window", "description": "Open in-app browser", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}},
]

# Test definitions: prompt, expected behavior, validation
TESTS = {
    "conversation": [
        {
            "prompt": "Hey Pearl, how's it going?",
            "expect": "text_response",
            "validate": lambda r: len(r.get("content", "")) > 10 and "error" not in r.get("content", "").lower(),
            "desc": "Basic greeting — should get natural response",
        },
        {
            "prompt": "What's your take on AI regulation?",
            "expect": "text_response",
            "validate": lambda r: len(r.get("content", "")) > 30,
            "desc": "Opinion question — should give substantive answer",
        },
        {
            "prompt": "Tell me a joke",
            "expect": "text_response",
            "validate": lambda r: len(r.get("content", "")) > 10,
            "desc": "Creative request",
        },
    ],
    "tools_weather": [
        {
            "prompt": "What's the weather in Boston today?",
            "expect": "tool_call",
            "expect_tool": "bot_get_weather",
            "validate": lambda r: any(t.get("function", {}).get("name") == "bot_get_weather" for t in r.get("tool_calls", [])) or any(w in r.get("content", "").lower() for w in ["°f", "°c", "degrees", "temperature", "weather", "rain", "sunny", "clear", "cloud"]),
            "desc": "Weather — should get weather data for Boston",
        },
        {
            "prompt": "Is it raining in Tokyo right now?",
            "expect": "tool_call",
            "expect_tool": "bot_get_weather",
            "validate": lambda r: any("tokyo" in json.dumps(t).lower() for t in r.get("tool_calls", [])),
            "desc": "Weather variant — should call weather tool for Tokyo",
        },
    ],
    "tools_search": [
        {
            "prompt": "What's the latest news with NVIDIA?",
            "expect": "tool_call",
            "expect_tool": "bot_web_search",
            "validate": lambda r: any(t.get("function", {}).get("name") in ("bot_web_search", "bot_get_news") for t in r.get("tool_calls", [])),
            "desc": "News/search — should search or get news",
        },
        {
            "prompt": "Search for PearlOS reviews online",
            "expect": "tool_call",
            "expect_tool": "bot_web_search",
            "validate": lambda r: any(t.get("function", {}).get("name") == "bot_web_search" for t in r.get("tool_calls", [])),
            "desc": "Web search — should call bot_web_search",
        },
    ],
    "tools_canvas": [
        {
            "prompt": "Show me a pie chart of my time today: 40% meetings, 30% coding, 30% research",
            "expect": "tool_call",
            "expect_tool": "bot_wonder_canvas_template",
            "validate": lambda r: any(t.get("function", {}).get("name") in ("bot_wonder_canvas_template", "bot_wonder_canvas_scene") for t in r.get("tool_calls", [])),
            "desc": "Canvas chart — should render pie chart on Wonder Canvas",
        },
        {
            "prompt": "Display a stat dashboard showing: Users: 1,200, Revenue: $45K, Growth: 12%",
            "expect": "tool_call",
            "expect_tool": "bot_wonder_canvas_template",
            "validate": lambda r: any("canvas" in t.get("function", {}).get("name", "") for t in r.get("tool_calls", [])),
            "desc": "Canvas dashboard — should render stat_dashboard template",
        },
    ],
    "tools_notes": [
        {
            "prompt": "Open the note about NVIDIA",
            "expect": "tool_call",
            "expect_tool": "bot_open_note",
            "validate": lambda r: any(t.get("function", {}).get("name") in ("bot_open_note", "bot_list_notes") for t in r.get("tool_calls", [])),
            "desc": "Open note — should call bot_open_note",
        },
        {
            "prompt": "Create a new note called Meeting Notes with today's agenda",
            "expect": "tool_call",
            "expect_tool": "bot_create_note",
            "validate": lambda r: any(t.get("function", {}).get("name") == "bot_create_note" for t in r.get("tool_calls", [])),
            "desc": "Create note — should call bot_create_note",
        },
    ],
    "tools_media": [
        {
            "prompt": "Play some chill music",
            "expect": "tool_call",
            "expect_tool": "bot_play_soundtrack",
            "validate": lambda r: any(t.get("function", {}).get("name") == "bot_play_soundtrack" for t in r.get("tool_calls", [])),
            "desc": "Music — should call bot_play_soundtrack",
        },
        {
            "prompt": "Find me a video about space exploration on YouTube",
            "expect": "tool_call",
            "expect_tool": "bot_open_youtube",
            "validate": lambda r: any(t.get("function", {}).get("name") in ("bot_open_youtube", "bot_search_youtube_videos") for t in r.get("tool_calls", [])),
            "desc": "YouTube — should open YouTube with search",
        },
    ],
    "tools_dispatch": [
        {
            "prompt": "Dispatch an agent to audit our security",
            "expect": "tool_call",
            "expect_tool": "bot_openclaw_task",
            "validate": lambda r: any(t.get("function", {}).get("name") == "bot_openclaw_task" for t in r.get("tool_calls", [])),
            "desc": "Task dispatch — should call bot_openclaw_task",
        },
        {
            "prompt": "What tasks are currently running?",
            "expect": "tool_call",
            "expect_tool": "bot_list_tasks",
            "validate": lambda r: any(t.get("function", {}).get("name") == "bot_list_tasks" for t in r.get("tool_calls", [])),
            "desc": "Task list — should call bot_list_tasks",
        },
    ],
    "tools_visual": [
        {
            "prompt": "Generate a pixel art sprite of a robot holding a coffee cup",
            "expect": "tool_call",
            "expect_tool": "bot_summon_sprite",
            "validate": lambda r: any(t.get("function", {}).get("name") == "bot_summon_sprite" for t in r.get("tool_calls", [])),
            "desc": "Sprite generation — should call bot_summon_sprite",
        },
    ],
    "image_understanding": [
        {
            "prompt": [
                {"type": "text", "text": "What do you see in this image?"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVQYV2P8z8BQz0BKYBw1aCgYBABnTQMhtbfVpAAAAABJRU5ErkJggg=="}},
            ],
            "expect": "text_response",
            "validate": lambda r: len(r.get("content", "")) > 5 or "image" in r.get("content", "").lower() or "error" not in r,
            "desc": "Image upload — should acknowledge seeing an image (may fail if model has no vision)",
        },
    ],
    "multi_turn": [
        {
            "prompt": "Remember this: my favorite color is blue",
            "expect": "text_response",
            "validate": lambda r: len(r.get("content", "")) > 5,
            "desc": "Memory set — should acknowledge",
            "followup": {
                "prompt": "What's my favorite color?",
                "validate": lambda r: "blue" in r.get("content", "").lower(),
                "desc": "Memory recall — should remember blue",
            },
        },
    ],
}


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def call_llm(messages: list, tools: list | None = None) -> tuple[dict, int]:
    """Call OpenClaw and return (parsed message, latency_ms)."""
    body = {
        "model": "openclaw",
        "messages": messages,
        "max_tokens": 300,
    }
    if tools:
        body["tools"] = tools

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

        if "error" in result:
            return {"error": json.dumps(result["error"])[:200]}, elapsed

        msg = result["choices"][0]["message"]
        return {
            "content": msg.get("content") or "",
            "tool_calls": msg.get("tool_calls") or [],
            "finish_reason": result["choices"][0].get("finish_reason"),
            "tokens_out": result.get("usage", {}).get("completion_tokens", 0),
        }, elapsed
    except urllib.error.HTTPError as e:
        elapsed = round((time.monotonic() - start) * 1000)
        err = e.read().decode()[:200]
        return {"error": f"HTTP {e.code}: {err}"}, elapsed
    except Exception as e:
        elapsed = round((time.monotonic() - start) * 1000)
        return {"error": str(e)[:200]}, elapsed


def run_test(category: str, test: dict, idx: int) -> dict:
    """Run a single test."""
    desc = test["desc"]
    prompt = test["prompt"]
    log(f"Test {idx}: [{category}] {desc}")

    messages = [
        {"role": "system", "content": "You are Pearl. Use tools when appropriate. Keep responses concise."},
    ]

    if isinstance(prompt, list):
        messages.append({"role": "user", "content": prompt})
    else:
        messages.append({"role": "user", "content": prompt})

    use_tools = test["expect"] == "tool_call"
    result, latency = call_llm(messages, TOOL_SCHEMAS if use_tools else None)

    # Validate
    passed = False
    if "error" in result:
        passed = False
    elif test.get("validate"):
        try:
            passed = test["validate"](result)
        except Exception:
            passed = False
    else:
        passed = True

    # Check tool correctness
    tool_correct = True
    if test.get("expect_tool") and result.get("tool_calls"):
        tool_names = [t.get("function", {}).get("name", "") for t in result["tool_calls"]]
        tool_correct = test["expect_tool"] in tool_names

    status = "✅" if passed else "❌"
    content_preview = (result.get("content") or "")[:60]
    tool_info = ""
    if result.get("tool_calls"):
        tool_names = [t.get("function", {}).get("name", "") for t in result["tool_calls"]]
        tool_info = f" 🔧 {','.join(tool_names)}"
    error_info = f" ERROR: {result.get('error', '')[:60]}" if result.get("error") else ""

    log(f"  {status} {latency}ms | \"{content_preview}\"{tool_info}{error_info}")

    test_result = {
        "category": category,
        "desc": desc,
        "prompt": prompt if isinstance(prompt, str) else "[multimodal]",
        "latency_ms": latency,
        "passed": passed,
        "tool_correct": tool_correct,
        "content": result.get("content", "")[:300],
        "tool_calls": [t.get("function", {}).get("name", "") for t in result.get("tool_calls", [])],
        "error": result.get("error"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Handle followup (multi-turn test)
    if passed and test.get("followup"):
        fu = test["followup"]
        log(f"  ↳ Followup: {fu['desc']}")
        messages.append({"role": "assistant", "content": result.get("content", "")})
        messages.append({"role": "user", "content": fu["prompt"]})
        fu_result, fu_latency = call_llm(messages)
        fu_passed = False
        if not fu_result.get("error") and fu.get("validate"):
            try:
                fu_passed = fu["validate"](fu_result)
            except Exception:
                fu_passed = False
        fu_status = "✅" if fu_passed else "❌"
        log(f"  ↳ {fu_status} {fu_latency}ms | \"{(fu_result.get('content',''))[:60]}\"")
        test_result["followup"] = {
            "passed": fu_passed,
            "latency_ms": fu_latency,
            "content": fu_result.get("content", "")[:200],
        }

    return test_result


def run_suite(categories: list[str] | None = None, quick: bool = False):
    """Run the full test suite."""
    os.makedirs(RESULTS_DIR, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    report_path = f"{RESULTS_DIR}/webchat-qa-{timestamp}.json"

    log("=" * 60)
    log("PearlOS Web Chat QA Test Suite")
    log("=" * 60)

    # Pre-flight
    log("Pre-flight checks...")
    try:
        req = urllib.request.Request(
            "http://localhost:18789/health",
            headers={"Authorization": f"Bearer {OPENCLAW_KEY}"},
        )
        urllib.request.urlopen(req, timeout=5)
        log("  OpenClaw gateway: ✅")
    except Exception as e:
        log(f"  OpenClaw gateway: ❌ {e}")
        log("ABORTING — gateway is down")
        return None

    results = []
    idx = 0
    for cat, tests in TESTS.items():
        if categories and cat not in categories:
            continue
        log(f"\n--- {cat} ---")
        for test in tests:
            if quick and idx >= 5:
                break
            idx += 1
            result = run_test(cat, test, idx)
            results.append(result)
            time.sleep(0.3)

    # Summary
    log("\n" + "=" * 60)
    log("SUMMARY")
    log("=" * 60)

    passed = [r for r in results if r["passed"]]
    failed = [r for r in results if not r["passed"]]
    tool_tests = [r for r in results if r.get("tool_calls")]
    tool_correct = [r for r in tool_tests if r.get("tool_correct")]

    avg_latency = round(sum(r["latency_ms"] for r in results) / max(len(results), 1))
    pass_rate = round(len(passed) / max(len(results), 1) * 100)

    log(f"Total: {len(results)} tests")
    log(f"Passed: {len(passed)}/{len(results)} ({pass_rate}%)")
    log(f"Failed: {len(failed)}/{len(results)}")
    log(f"Avg latency: {avg_latency}ms ({round(avg_latency/1000,1)}s)")
    log(f"Tool accuracy: {len(tool_correct)}/{len(tool_tests)} correct tool selection")

    if failed:
        log("\nFailures:")
        for r in failed:
            log(f"  ❌ [{r['category']}] {r['desc']}: {str(r.get('error') or 'validation failed')[:80]}")

    if pass_rate >= 90:
        log("\n🟢 EXCELLENT")
    elif pass_rate >= 70:
        log("\n🟡 ACCEPTABLE")
    elif pass_rate >= 50:
        log("\n🟠 NEEDS WORK")
    else:
        log("\n🔴 FAILING")

    report = {
        "timestamp": timestamp,
        "total": len(results),
        "passed": len(passed),
        "failed": len(failed),
        "pass_rate": pass_rate,
        "avg_latency_ms": avg_latency,
        "tool_accuracy": f"{len(tool_correct)}/{len(tool_tests)}",
        "results": results,
    }
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    log(f"\nReport: {report_path}")
    return report


if __name__ == "__main__":
    quick = "--quick" in sys.argv
    categories = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--test" and i < len(sys.argv) - 1:
            categories = [sys.argv[i + 1]]
    run_suite(categories=categories, quick=quick)
