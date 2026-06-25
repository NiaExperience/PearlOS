from bot_gateway import _auto_dispatch_build_task


def test_auto_dispatches_direct_game_build_request():
    messages = [
        {
            "role": "user",
            "content": "Build a procedurally generated pixel art forest game in Godot.",
        }
    ]

    result = _auto_dispatch_build_task(messages, messages[-1]["content"])

    assert result is not None
    task, title = result
    assert "Godot" in task
    assert "runnable result" in task
    assert title.startswith("Build a procedurally generated")


def test_auto_dispatches_affirmed_redispatch_from_prior_user_request():
    messages = [
        {
            "role": "user",
            "content": (
                "Re: A procedurally generated pixel art landscape of a thick "
                "forest. User wants to build a game. Godot can be used."
            ),
        },
        {
            "role": "assistant",
            "content": "Want me to try re-dispatching it fresh?",
        },
        {"role": "user", "content": "yes plz"},
    ]

    result = _auto_dispatch_build_task(messages, "yes plz")

    assert result is not None
    task, title = result
    assert "re-dispatched" in task
    assert "Godot" in task
    assert title.startswith("A procedurally generated")


def test_auto_dispatch_does_not_hijack_explanation_question():
    messages = [
        {
            "role": "user",
            "content": "How would I build a procedural pixel art game?",
        }
    ]

    assert _auto_dispatch_build_task(messages, messages[-1]["content"]) is None
