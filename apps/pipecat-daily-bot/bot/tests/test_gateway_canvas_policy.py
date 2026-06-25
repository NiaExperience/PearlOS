import importlib


def fresh_gateway_module():
    if "bot_gateway" in list(importlib.sys.modules.keys()):
        del importlib.sys.modules["bot_gateway"]
    import bot_gateway

    importlib.reload(bot_gateway)
    if hasattr(bot_gateway._should_skip_gateway_canvas_call, "_cache"):
        delattr(bot_gateway._should_skip_gateway_canvas_call, "_cache")
    return bot_gateway


def test_canvas_policy_blocks_vague_game_template():
    gateway = fresh_gateway_module()

    should_skip, reason = gateway._should_skip_gateway_canvas_call(
        "bot_wonder_canvas_template",
        {"template": "fact_card", "data": {"title": "game"}},
        "https://pearlos.daily.co/test-room",
    )

    assert should_skip is True
    assert "vague canvas topic" in reason


def test_canvas_policy_allows_loading_then_final_but_blocks_immediate_replacement():
    gateway = fresh_gateway_module()
    room_url = "https://pearlos.daily.co/test-room"

    loading_skip, _ = gateway._should_skip_gateway_canvas_call(
        "bot_wonder_canvas_template",
        {"template": "loading_card", "data": {"title": "Loading Hades strategy"}},
        room_url,
    )
    final_skip, _ = gateway._should_skip_gateway_canvas_call(
        "bot_wonder_canvas_template",
        {"template": "timeline", "data": {"title": "Hades speedrun strategy"}},
        room_url,
    )
    replacement_skip, reason = gateway._should_skip_gateway_canvas_call(
        "bot_wonder_canvas_template",
        {"template": "fact_card", "data": {"title": "Hades fanbase"}},
        room_url,
    )

    assert loading_skip is False
    assert final_skip is False
    assert replacement_skip is True
    assert reason == "non-loading canvas replacement too soon"


def test_canvas_policy_force_allows_replacement():
    gateway = fresh_gateway_module()
    room_url = "https://pearlos.daily.co/test-room"

    first_skip, _ = gateway._should_skip_gateway_canvas_call(
        "bot_wonder_canvas_template",
        {"template": "timeline", "data": {"title": "Hades strategy"}},
        room_url,
    )
    forced_skip, _ = gateway._should_skip_gateway_canvas_call(
        "bot_wonder_canvas_template",
        {"template": "fact_card", "data": {"title": "Hades fanbase"}, "force": True},
        room_url,
    )

    assert first_skip is False
    assert forced_skip is False
