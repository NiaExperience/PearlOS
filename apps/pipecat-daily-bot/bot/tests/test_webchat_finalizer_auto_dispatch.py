from bot_gateway import _auto_dispatch_build_task


def test_auto_dispatch_does_not_hijack_tool_result_finalizer():
    messages = [
        {
            "role": "system",
            "content": "Turn tool results into a concise final answer.",
        },
        {
            "role": "user",
            "content": (
                "Answer my last request using these tool results as private context.\n"
                "Do not repeat the raw tool output.\n\n"
                "Tool result 1:\n"
                "Four 128x128 pixel-art icons were generated successfully for a web app."
            ),
        },
    ]

    assert _auto_dispatch_build_task(messages, messages[-1]["content"]) is None
