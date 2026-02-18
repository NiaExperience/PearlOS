import copy

from flows.core import create_boot_node, create_conversation_node


def _personality():
    return {"role": "system", "content": "You are upbeat and encouraging."}


def test_conversation_node_places_personality_in_role_messages():
    personality = _personality()
    node = create_conversation_node(personality_message=copy.deepcopy(personality))

    assert node["role_messages"] == [personality]
    assert personality not in node["task_messages"]
    assert node["task_messages"], "conversation node should define task guidance"


def test_boot_node_role_messages_optional():
    node = create_boot_node()
    assert node["role_messages"] == []
    assert node["task_messages"], "boot node should define boot instructions"


def test_boot_node_includes_personality_when_given():
    personality = _personality()
    node = create_boot_node(personality_message=copy.deepcopy(personality))

    assert node["role_messages"] == [personality]
    assert personality not in node["task_messages"]
