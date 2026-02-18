#!/usr/bin/env python3
"""Live test of OpenClawSessionProcessor — no Daily.co needed.

Monkey-patches push_frame to capture output directly.
"""

import asyncio
import sys
import os
import traceback
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipecat.frames.frames import (
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMMessagesFrame,
    TextFrame,
)
from pipecat.processors.frame_processor import FrameDirection

try:
    from pipecat.frames.frames import LLMContextFrame
except ImportError:
    LLMContextFrame = None

try:
    from pipecat.services.openai.llm import OpenAILLMContextFrame
except ImportError:
    OpenAILLMContextFrame = None

try:
    from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
except ImportError:
    OpenAILLMContext = None

from processors.openclaw_session import OpenClawSessionProcessor

SYSTEM_PROMPT = "You are Pearl, a helpful AI assistant. Keep responses to 1 sentence max."
RESULTS = {"frame_types_available": {}, "tests": {}}


async def test_frame_type(name: str, frame: Frame):
    """Create a fresh processor, monkey-patch push_frame, send frame, collect output."""
    print(f"\n{'='*60}")
    print(f"TEST: {name} ({type(frame).__name__})")
    print(f"{'='*60}")

    collected: list[Frame] = []
    processor = OpenClawSessionProcessor(system_prompt=SYSTEM_PROMPT)

    # Monkey-patch push_frame to capture output
    original_push = processor.push_frame
    async def capturing_push(f, direction=FrameDirection.DOWNSTREAM):
        collected.append(f)
    processor.push_frame = capturing_push

    try:
        await processor.process_frame(frame, FrameDirection.DOWNSTREAM)
        # Wait for streaming to finish (the method is awaited directly, so should be done)
    except Exception as e:
        print(f"  ERROR: {e}")
        traceback.print_exc()
        RESULTS["tests"][name] = {"status": "error", "error": str(e)}
        return

    text_frames = [f for f in collected if isinstance(f, TextFrame)]
    start_frames = [f for f in collected if isinstance(f, LLMFullResponseStartFrame)]
    end_frames = [f for f in collected if isinstance(f, LLMFullResponseEndFrame)]
    full_text = "".join(f.text for f in text_frames)

    print(f"  Total frames: {len(collected)}")
    print(f"  TextFrames: {len(text_frames)}")
    print(f"  Start/End: {len(start_frames)}/{len(end_frames)}")
    print(f"  Response: {full_text[:200]!r}")

    produced = len(text_frames) > 0 and len(full_text.strip()) > 0
    RESULTS["tests"][name] = {
        "status": "success" if produced else "no_output",
        "text_frames": len(text_frames),
        "full_text": full_text[:500],
        "total_frames": len(collected),
        "frame_types": [type(f).__name__ for f in collected],
    }
    print(f"  {'✅ PRODUCED OUTPUT' if produced else '❌ NO OUTPUT'}")


async def main():
    print("OpenClaw Session Processor — Live Runtime Test")
    print(f"API URL: {os.getenv('OPENCLAW_API_URL', 'NOT SET')}")
    print(f"API Key: {'SET' if os.getenv('OPENCLAW_API_KEY') else 'NOT SET'}")

    RESULTS["frame_types_available"] = {
        "LLMMessagesFrame": True,
        "OpenAILLMContextFrame": OpenAILLMContextFrame is not None,
        "LLMContextFrame": LLMContextFrame is not None,
        "OpenAILLMContext": OpenAILLMContext is not None,
    }
    print(f"Available: {RESULTS['frame_types_available']}")

    # Test 1: LLMMessagesFrame
    msgs = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "What is 2 plus 2?"},
    ]
    await test_frame_type("LLMMessagesFrame", LLMMessagesFrame(messages=msgs))

    # Test 2: OpenAILLMContextFrame
    if OpenAILLMContextFrame and OpenAILLMContext:
        ctx = OpenAILLMContext(messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "What color is the sky?"},
        ])
        await test_frame_type("OpenAILLMContextFrame", OpenAILLMContextFrame(context=ctx))
    else:
        print("\n⚠️ OpenAILLMContextFrame not available")
        RESULTS["tests"]["OpenAILLMContextFrame"] = {"status": "skipped", "reason": "not importable"}

    # Test 3: LLMContextFrame
    if LLMContextFrame and OpenAILLMContext:
        ctx2 = OpenAILLMContext(messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "Say the word banana."},
        ])
        await test_frame_type("LLMContextFrame", LLMContextFrame(context=ctx2))
    else:
        print("\n⚠️ LLMContextFrame not available")
        RESULTS["tests"]["LLMContextFrame"] = {"status": "skipped", "reason": "not importable"}

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for name, r in RESULTS["tests"].items():
        s = r.get("status")
        t = r.get("full_text", "")[:80]
        print(f"  {name}: {s} — {t!r}")

    # Write report
    report_path = "/root/.openclaw/workspace/memory/voice-runtime-test.md"
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w") as f:
        f.write("# Voice Runtime Test Results\n\n")
        f.write(f"**Date:** {datetime.now().isoformat()}\n\n")
        f.write("## Frame Types Available\n\n")
        for ft, avail in RESULTS["frame_types_available"].items():
            f.write(f"- `{ft}`: {'✅' if avail else '❌'}\n")
        f.write("\n## Test Results\n\n")
        for name, r in RESULTS["tests"].items():
            s = r.get("status", "unknown")
            emoji = "✅" if s == "success" else "❌" if s == "error" else "⚠️"
            f.write(f"### {emoji} {name}\n\n")
            f.write(f"- **Status:** {s}\n")
            if "full_text" in r:
                f.write(f"- **Text frames:** {r.get('text_frames', 0)}\n")
                f.write(f"- **Response:** `{r['full_text'][:300]}`\n")
            if "frame_types" in r:
                f.write(f"- **Output frame sequence:** {', '.join(r['frame_types'])}\n")
            if "error" in r:
                f.write(f"- **Error:** {r['error']}\n")
            if "reason" in r:
                f.write(f"- **Reason:** {r['reason']}\n")
            f.write("\n")
        successes = sum(1 for r in RESULTS["tests"].values() if r.get("status") == "success")
        total = len(RESULTS["tests"])
        f.write(f"## Conclusion\n\n**{successes}/{total} frame types produced actual LLM output.**\n\n")
        if successes > 0:
            f.write("The OpenClawSessionProcessor successfully receives context frames and streams real LLM responses as TextFrames.\n")
        else:
            f.write("⚠️ No output produced. Check API connectivity and frame compatibility.\n")
    print(f"\nReport: {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
