from typing import Any

import pytest
from eventbus import events
from core.config import BOT_PARTICIPANT_REFRESH_MESSAGE
from flows import (
    FlowMessagePollingController,
    TimerSettings,
    collect_timer_settings,
    consume_admin_instruction,
    create_boot_node,
    create_conversation_node,
    create_admin_instruction_node,
    create_wrapup_node,
    enqueue_admin_instruction,
    get_flow_message_poller_state,
    get_flow_greeting_state,
    get_pending_admin_instruction,
    get_participant_snapshot,
    initialize_base_flow,
    record_participant_join,
    record_participant_leave,
    refresh_conversation_role_messages,
    reset_flow_greeting_state,
    transition_to_admin_node,
    transition_to_wrapup_node,
)
from pipecat_flows import ContextStrategy
from flows.core import (
    _build_participant_summary_message,
    _summarize_single_participant,
    _admin_instruction_post_action,
    _wrapup_post_action,
)


class DummyFlowManager:
    def __init__(self):
        self.state = {}
        self.current_node = None
        self.initialize_calls = 0

    async def initialize(self, *, initial_node=None):  # noqa: D401 - test stub
        self.initialize_calls += 1
        # Capture the last node for inspection in tests
        self.last_initial_node = initial_node

    async def set_node_from_config(self, node_config):  # noqa: D401 - test stub
        self.last_set_node = node_config
        if isinstance(node_config, dict):
            self.current_node = node_config.get("name")


class DummyResetFlowManager(DummyFlowManager):
    def __init__(self, base_personality: dict[str, Any]):
        super().__init__()
        conversation_node = create_conversation_node(personality_message=base_personality)
        self.state = {
            "nodes": {
                "conversation": conversation_node,
            },
            "next_node_after_boot": "conversation",
        }
        self.reset_calls = 0

    async def set_node_from_config(self, node_config):  # noqa: D401 - test stub
        await super().set_node_from_config(node_config)
        self.reset_calls += 1


@pytest.mark.asyncio
async def test_initialize_base_flow_seeds_state_and_invokes_initialize(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    timer_settings = TimerSettings(
        wrapup_after_secs=100.0,
        beat_repeat_interval=30.0,
    )
    personality_message = {"role": "system", "content": "You are Sapphire."}
    room = "daily-room-42"

    state = await initialize_base_flow(
        manager,
        personality_message=personality_message,
        timer_settings=timer_settings,
        room=room,
    )

    assert manager.initialize_calls == 1
    assert manager.state["nodes"]["boot"]["respond_immediately"] is False
    assert manager.state["next_node_after_boot"] == "conversation"
    assert state.nodes["conversation"]["respond_immediately"] is True
    assert "wrapup" in manager.state["nodes"]
    assert manager.state["personality_message"] == personality_message
    assert state.room == room
    assert manager.state["room"] == room


@pytest.mark.asyncio
async def test_initialize_base_flow_uses_final_beat_for_wrapup_prompt(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    personality_message = {"role": "system", "content": "Persona."}
    personality_record = {
        "beats": [
            {"message": "Check-in", "start_time": 0},
            {"message": "  Time to wrap up friends!  ", "start_time": 1800},
        ]
    }

    state = await initialize_base_flow(
        manager,
        personality_message=personality_message,
        personality_record=personality_record,
    )

    wrapup_node = manager.state["nodes"]["wrapup"]
    assert wrapup_node["task_messages"][0]["content"] == "Time to wrap up friends!"
    assert manager.state["wrapup_prompt_override"] == "Time to wrap up friends!"
    assert state.wrapup_prompt == "Time to wrap up friends!"
    conversation_node = manager.state["nodes"]["conversation"]
    assert conversation_node["task_messages"][0]["content"].startswith("Engage participants naturally")
    # The opening prompt from beats is included in role messages, not as the first task message


@pytest.mark.asyncio
async def test_initialize_base_flow_defaults_without_opening_prompt(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    personality_message = {"role": "system", "content": "Persona."}
    personality_record = {
        "beats": [
            {"message": "Check-in", "start_time": 30},
        ]
    }

    await initialize_base_flow(
        manager,
        personality_message=personality_message,
        personality_record=personality_record,
    )

    conversation_node = manager.state["nodes"]["conversation"]
    assert conversation_node["task_messages"][0]["content"].startswith("Engage participants naturally")


def test_collect_timer_settings_uses_environment(monkeypatch):
    monkeypatch.setenv("BOT_WRAPUP_AFTER_SECS", "42.0")
    monkeypatch.setenv("BOT_BEAT_REPEAT_INTERVAL_SECS", "18.0")

    snapshot = collect_timer_settings()

    assert snapshot.wrapup_after_secs == 42.0
    assert snapshot.beat_repeat_interval == 18.0


def test_record_participant_join_and_leave_tracks_state():
    manager = DummyFlowManager()

    record_participant_join(manager, "p1", "Alice", {"foo": "bar"}, stealth=False)
    record_participant_join(manager, "ghost", "Ghost", None, stealth=True)

    snapshot = get_participant_snapshot(manager)

    assert snapshot["participants"] == ["p1"]
    assert snapshot["participant_contexts"]["p1"]["display_name"] == "Alice"
    assert snapshot["participant_contexts"]["p1"]["context"] == {"foo": "bar"}
    assert "ghost" in snapshot["stealth_participants"]
    assert snapshot["participant_contexts"]["ghost"]["stealth"] is True
    assert snapshot["last_joined_participant"] == "ghost"

    record_participant_leave(manager, "p1")

    snapshot = get_participant_snapshot(manager)

    assert snapshot["participants"] == []
    assert "p1" not in snapshot["participant_contexts"]


def test_record_participant_rejoin_updates_order():
    manager = DummyFlowManager()

    record_participant_join(manager, "p1", "Alpha", None)
    record_participant_join(manager, "p2", "Bravo", None)
    record_participant_join(manager, "p1", "Alpha", None)

    snapshot = get_participant_snapshot(manager)

    assert snapshot["participants"] == ["p2", "p1"]


def test_record_participant_join_refreshes_role_messages(monkeypatch):
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")
    manager = DummyFlowManager()
    base_personality = {"role": "system", "content": "Persona."}

    manager.state = {
        "nodes": {
            "boot": create_boot_node(personality_message=base_personality),
            "conversation": create_conversation_node(personality_message=base_personality),
            "wrapup": create_wrapup_node(personality_message=base_personality),
        },
        "next_node_after_boot": "conversation",
        "participants": [],
        "participant_contexts": {},
        "stealth_participants": set(),
        "personality_message": base_personality,
    }

    record_participant_join(
        manager,
        "p1",
        None,
        {
            "session_metadata": {"sessionUserName": "  Riley  "},
            "has_user_profile": True,
        },
    )

    conversation_messages = manager.state["nodes"]["conversation"]["role_messages"]
    assert len(conversation_messages) == 3
    assert any(
        BOT_PARTICIPANT_REFRESH_MESSAGE() in msg["content"]
        for msg in conversation_messages
        if msg["role"] == "system"
    )
    assert any("Riley" in msg["content"] for msg in conversation_messages if msg["role"] == "system")


def test_record_participant_leave_refreshes_role_messages(monkeypatch):
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")
    manager = DummyFlowManager()
    base_personality = {"role": "system", "content": "Persona."}

    manager.state = {
        "nodes": {
            "boot": create_boot_node(personality_message=base_personality),
            "conversation": create_conversation_node(personality_message=base_personality),
            "wrapup": create_wrapup_node(personality_message=base_personality),
        },
        "next_node_after_boot": "conversation",
        "participants": [],
        "participant_contexts": {},
        "stealth_participants": set(),
        "personality_message": base_personality,
    }

    record_participant_join(
        manager,
        "p1",
        "Riley",
        {
            "session_metadata": {"sessionUserName": "Riley"},
        },
    )
    # Ensure role messages include participant snapshot after join
    joined_messages = manager.state["nodes"]["conversation"]["role_messages"]
    assert len(joined_messages) == 3
    assert any(
        BOT_PARTICIPANT_REFRESH_MESSAGE() in msg["content"]
        for msg in joined_messages
        if msg["role"] == "system"
    )

    record_participant_leave(manager, "p1")

    conversation_messages = manager.state["nodes"]["conversation"]["role_messages"]
    assert conversation_messages == [base_personality]


def test_summarize_single_participant_enriches_metadata(monkeypatch):
    """Test that profile sanitization includes first_name, email, and metadata children."""
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")
    context = {
        "session_metadata": {
            "sessionUserId": "user-123",
            "should_drop": {"nested": True},
        },
        "identity": {
            "sessionUserName": " Alice Wonder ",
            "sessionUserEmail": "alice@example.com",
        },
        "user_profile": {
            "first_name": " Alice ",  # Will be included (trimmed)
            "email": "alice@example.com",  # Will be included
            "title": "Engineer",  # Top-level field - will be excluded
            "notes": "internal only",  # Top-level field - will be excluded
            "metadata": {
                "department": "Engineering",
                "team": "Platform"
            }
        },
        "has_user_profile": True,
    }

    entry = {
        "display_name": "  Alice  ",
        "context": context,
        "stealth": False,
    }

    summary = _summarize_single_participant("p1", entry)

    assert summary is not None
    assert summary["participant_id"] == "p1"
    assert summary["display_name"] == "Alice"
    assert summary["has_user_profile"] is True
    session = summary["session"]
    assert session["sessionUserId"] == "user-123"
    assert session["session_user_name"] == "Alice Wonder"
    assert session["session_user_email"] == "alice@example.com"
    profile = summary["profile"]
    # Should include first_name, email, and metadata children
    assert profile["first_name"] == "Alice"
    assert profile["email"] == "alice@example.com"
    assert profile["department"] == "Engineering"
    assert profile["team"] == "Platform"
    # Should NOT include other top-level fields
    assert "title" not in profile
    assert "notes" not in profile


def test_summarize_single_participant_filters_stealth_and_empty(monkeypatch):
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")

    stealth_entry = {"stealth": True, "context": {}}
    assert _summarize_single_participant("p2", stealth_entry) is None

    empty_entry = {"display_name": "", "context": {}}
    assert _summarize_single_participant("p3", empty_entry) is None


def test_summarize_single_participant_falls_back_to_session_user_name(monkeypatch):
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")
    entry = {
        "display_name": None,
        "context": {
            "session_metadata": {"sessionUserName": "  Dana Doe  "},
            "identity": {"sessionUserEmail": "dana@example.com"},
        },
        "stealth": False,
    }

    summary = _summarize_single_participant("p4", entry)

    assert summary is not None
    assert summary["display_name"] == "Dana Doe"
    assert summary["session"]["session_user_name"] == "Dana Doe"


def test_summarize_single_participant_falls_back_to_identity_display_name(monkeypatch):
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")
    entry = {
        "display_name": " ",
        "context": {
            "identity": {"displayName": "  Taylor  "},
        },
        "stealth": False,
    }

    summary = _summarize_single_participant("p5", entry)

    assert summary is not None
    assert summary["display_name"] == "Taylor"


def test_build_participant_summary_message_formats_roster(monkeypatch):
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")
    flow_state = {
        "participants": ["p1", "p2"],
        "participant_contexts": {
            "p1": {
                "display_name": "Avery",
                "context": {
                    "session_metadata": {"sessionUserId": "u-1"},
                },
                "stealth": False,
            },
            "p2": {
                "display_name": "Stealth",
                "context": {},
                "stealth": True,
            },
        },
        "last_joined_participant": "p2",
    }

    message = _build_participant_summary_message(flow_state)

    assert message is not None
    assert message["role"] == "system"
    content = message["content"]
    assert "Participant roster snapshot" in content
    assert '"participant_id": "p1"' in content
    assert '"participant_id": "p2"' not in content
    assert "Most recent arrival: p2" in content


def test_reset_flow_greeting_state_initializes_defaults_and_normalizes():
    manager = DummyFlowManager()

    state = reset_flow_greeting_state(manager, "room-123")

    assert state["participants"] == set()
    assert state["grace_participants"] == {}
    assert state["participant_contexts"] == {}
    assert state["greeted_user_ids"] == set()
    assert state["grace_task"] is None
    assert state["pair_task"] is None

    # Mutate to simulate runtime usage
    state["participants"].add("p1")
    state["greeted_user_ids"].add("u1")
    state["grace_participants"]["p1"] = "Ada"

    # Force non-normalized types and ensure helper converts them
    manager.state["greeting_rooms"]["room-123"]["participants"] = ["p2"]
    manager.state["greeting_rooms"]["room-123"]["greeted_user_ids"] = ["u2"]

    normalized = get_flow_greeting_state(manager, "room-123")

    assert normalized["participants"] == {"p2"}
    assert normalized["greeted_user_ids"] == ["u2"]
    assert isinstance(normalized["grace_participants"], dict)
    assert "room-123" in manager.state["greeting_rooms"]


def test_refresh_conversation_role_messages_builds_participant_summary(monkeypatch):
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")
    manager = DummyFlowManager()
    base_personality = {"role": "system", "content": "You are Sapphire."}

    manager.state = {
        "nodes": {
            "boot": create_boot_node(personality_message=base_personality),
            "conversation": create_conversation_node(personality_message=base_personality),
            "wrapup": create_wrapup_node(personality_message=base_personality),
        },
        "next_node_after_boot": "conversation",
        "participants": ["p1"],
        "participant_contexts": {
            "p1": {
                "display_name": "Alice",
                "context": {
                    "session_metadata": {
                        "session_user_id": "user-1",
                        "session_user_email": "alice@example.com",
                    },
                    "user_profile": {
                        "first_name": "Alice",
                        "email": "alice@example.com",
                        "title": "Software Engineer",  # Top-level, will be excluded
                        "metadata": {
                            "role": "Engineer",  # Will be included
                            "department": "Platform"
                        },
                        "irrelevant": {"should": "drop"},
                    },
                    "has_user_profile": True,
                },
                "stealth": False,
            }
        },
        "last_joined_participant": "p1",
        "personality_message": base_personality,
    }

    refresh_conversation_role_messages(manager)

    conversation_messages = manager.state["nodes"]["conversation"]["role_messages"]
    assert conversation_messages[0] == base_personality

    context_message = next(
        msg for msg in conversation_messages[1:]
        if BOT_PARTICIPANT_REFRESH_MESSAGE() in msg.get("content", "")
    )
    assert context_message["role"] == "system"
    assert "Alice" in context_message["content"]
    assert "Engineer" in context_message["content"]
    assert "should" not in context_message["content"]

    summary_message = next(
        msg for msg in conversation_messages[1:]
        if "Participant roster snapshot" in msg.get("content", "")
    )
    assert summary_message["role"] == "system"
    assert "user-1" in summary_message["content"]
    assert "Engineer" in summary_message["content"]

    boot_messages = manager.state["nodes"]["boot"]["role_messages"]
    assert boot_messages[0] == base_personality
    assert any(
        BOT_PARTICIPANT_REFRESH_MESSAGE() in msg.get("content", "")
        for msg in boot_messages[1:]
    )


def test_refresh_conversation_role_messages_reapplies_active_node(monkeypatch):
    monkeypatch.setenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", "1")
    manager = DummyFlowManager()
    base_personality = {"role": "system", "content": "Persona."}

    manager.state = {
        "nodes": {
            "boot": create_boot_node(personality_message=base_personality),
            "conversation": create_conversation_node(personality_message=base_personality),
            "wrapup": create_wrapup_node(personality_message=base_personality),
        },
        "next_node_after_boot": "conversation",
        "participants": [],
        "participant_contexts": {},
        "stealth_participants": set(),
        "personality_message": base_personality,
    }
    # Ensure role messages actually change so the active node will be re-applied
    # (new behavior only reapplies if content changes)
    manager.state["opening_prompt"] = "Welcome to the room!"
    manager.current_node = "conversation"

    refresh_conversation_role_messages(manager)

    assert getattr(manager, "last_set_node", {}).get("name") == "conversation"


def test_refresh_role_messages_without_sanitization(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    base_personality = {"role": "system", "content": "Persona."}

    manager.state = {
        "nodes": {
            "boot": create_boot_node(personality_message=base_personality),
            "conversation": create_conversation_node(personality_message=base_personality),
            "wrapup": create_wrapup_node(personality_message=base_personality),
        },
        "next_node_after_boot": "conversation",
        "participants": ["p1"],
        "participant_contexts": {
            "p1": {
                "display_name": "Alice",
                "context": {
                    "user_profile": {
                        "first_name": "Alice",
                        "title": "Engineer",
                        "metadata": {"nested": {"field": "keep"}},
                    },
                    "has_user_profile": True,
                },
                "stealth": False,
            }
        },
        "last_joined_participant": "p1",
        "personality_message": base_personality,
    }

    refresh_conversation_role_messages(manager)
    print(manager.state["nodes"]["conversation"]["role_messages"])

    conversation_messages = manager.state["nodes"]["conversation"]["role_messages"]
    assert any("\"title\"" not in msg["content"] for msg in conversation_messages)
    assert any("\"nested\"" in msg["content"] for msg in conversation_messages)


@pytest.mark.asyncio
async def test_transition_to_wrapup_node_creates_node_and_updates_role_messages(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    base_personality = {"role": "system", "content": "Persona."}

    manager.state = {
        "nodes": {
            "boot": create_boot_node(personality_message=base_personality),
            "conversation": create_conversation_node(personality_message=base_personality),
        },
        "next_node_after_boot": "conversation",
        "participants": ["p1"],
        "participant_contexts": {
            "p1": {
                "display_name": "Alice",
                "context": {
                    "user_profile": {"first_name": "Alice"},
                },
                "stealth": False,
            }
        },
        "last_joined_participant": "p1",
        "personality_message": base_personality,
    }
    manager.state["wrapup_prompt_override"] = "Friendly farewell."

    await transition_to_wrapup_node(manager)

    assert "wrapup" in manager.state["nodes"]
    wrapup_node = manager.state["nodes"]["wrapup"]
    assert wrapup_node["name"] == "wrapup"
    assert wrapup_node["role_messages"][0] == base_personality
    assert wrapup_node["task_messages"][0]["content"] == "Friendly farewell."
    assert getattr(manager, "last_set_node", {}).get("name") == "wrapup"


def test_enqueue_admin_instruction_appends_task_message(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    base_personality = {"role": "system", "content": "You are Sapphire."}
    conversation_node = create_conversation_node(personality_message=base_personality)
    manager.state = {
        "nodes": {
            "conversation": conversation_node,
            "boot": create_boot_node(personality_message=base_personality),
        },
        "next_node_after_boot": "conversation",
        "personality_message": base_personality,
    }

    instruction = enqueue_admin_instruction(
        manager,
        prompt="  Investigate the new dashboard metrics  ",
        sender_id="admin-42",
        sender_name=" Operations",
        mode="IMMEDIATE",
        timestamp="123.45",
    )

    assert instruction is not None
    assert instruction["prompt"] == "Investigate the new dashboard metrics"
    assert instruction["mode"] == "immediate"
    assert instruction["sender"]["id"] == "admin-42"
    assert instruction["sender"]["name"] == "Operations"
    assert instruction["task_message"]["role"] == "system"
    assert "ADMIN INSTRUCTION" in instruction["task_message"]["content"]

    admin_state = manager.state["admin"]
    assert len(admin_state["queue"]) == 1
    convo_messages = manager.state["nodes"]["conversation"]["task_messages"]
    assert instruction["task_message"] in convo_messages
    # Base conversation directive should still be present at index 0
    assert convo_messages[0]["content"].startswith("Engage participants")

def test_create_admin_instruction_node_appends_active_instruction(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    manager.state = {
        "nodes": {"conversation": create_conversation_node()},
        "next_node_after_boot": "conversation",
    }

    instruction = enqueue_admin_instruction(
        manager,
        prompt="Review the release checklist",
        sender_name="Admin",
        mode="queued",
        timestamp=111,
    )

    assert instruction is not None

    admin_node = create_admin_instruction_node(
        flow_state=manager.state,
        instruction=instruction,
    )

    assert admin_node["name"] == "admin_instruction"
    task_messages = admin_node["task_messages"]
    assert len(task_messages) >= 2
    assert any(
        isinstance(msg, dict)
        and msg.get("content", "").startswith("ADMIN INSTRUCTION [QUEUED")
        for msg in task_messages
    )


@pytest.mark.asyncio
async def test_transition_to_admin_node_sets_active_node(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    manager.state = {
        "nodes": {"conversation": create_conversation_node()},
        "next_node_after_boot": "conversation",
    }

    instruction = enqueue_admin_instruction(
        manager,
        prompt="Assist the user immediately",
        sender_name="Admin",
        mode="immediate",
        timestamp=222,
    )
    assert instruction is not None

    await transition_to_admin_node(manager)

    admin_node = manager.state["nodes"].get("admin_instruction")
    assert admin_node is not None
    assert admin_node["name"] == "admin_instruction"
    assert getattr(manager, "last_set_node", {}).get("name") == "admin_instruction"
    assert any(
        isinstance(msg, dict)
        and msg.get("content", "").startswith("ADMIN INSTRUCTION [IMMEDIATE")
        for msg in admin_node.get("task_messages", [])
    )
    assert len(manager.state["admin"]["queue"]) == 1


@pytest.mark.asyncio
async def test_admin_instruction_post_action_chains_and_cleans_queue(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    manager.state = {
        "nodes": {"conversation": create_conversation_node()},
        "next_node_after_boot": "conversation",
    }

    first_instruction = enqueue_admin_instruction(
        manager,
        prompt="First admin task",
        sender_name="Admin",
        mode="immediate",
        timestamp=10,
    )
    second_instruction = enqueue_admin_instruction(
        manager,
        prompt="Second admin task",
        sender_name="Admin",
        mode="queued",
        timestamp=20,
    )

    assert first_instruction is not None and second_instruction is not None
    assert len(manager.state["admin"]["queue"]) == 2

    await transition_to_admin_node(manager)
    assert manager.state["nodes"].get("admin_instruction") is not None

    await _admin_instruction_post_action({}, manager)
    assert len(manager.state["admin"]["queue"]) == 1
    assert manager.state["admin"]["queue"][0]["prompt"] == "Second admin task"
    assert getattr(manager, "last_set_node", {}).get("name") == "admin_instruction"

    await _admin_instruction_post_action({}, manager)
    assert manager.state["admin"]["queue"] == []
    assert "admin_instruction" not in manager.state["nodes"]
    conversation_messages = manager.state["nodes"]["conversation"]["task_messages"]
    assert all(
        not msg.get("content", "").startswith("ADMIN INSTRUCTION")
        for msg in conversation_messages
        if isinstance(msg, dict)
    )

def test_consume_admin_instruction_removes_task_message(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    conversation_node = create_conversation_node()
    manager.state = {
        "nodes": {"conversation": conversation_node},
        "next_node_after_boot": "conversation",
    }

    instruction = enqueue_admin_instruction(
        manager,
        prompt="Triage the incident report",
        sender_name="Admin",
        mode="queued",
        timestamp=999,
    )

    assert instruction is not None
    task_messages = manager.state["nodes"]["conversation"]["task_messages"]
    admin_message = instruction["task_message"]
    assert admin_message in task_messages

    consumed = consume_admin_instruction(manager)
    assert consumed is not None
    assert consumed["id"] == instruction["id"]
    assert consumed["prompt"] == "Triage the incident report"

    updated_messages = manager.state["nodes"]["conversation"]["task_messages"]
    assert admin_message not in updated_messages
    history = manager.state["admin"]["history"]
    assert history and history[0]["prompt"] == "Triage the incident report"


def test_get_pending_admin_instruction_returns_copy(monkeypatch):
    monkeypatch.delenv("BOT_SANITIZE_FLOW_PROFILE_FIELDS", raising=False)
    manager = DummyFlowManager()
    conversation_node = create_conversation_node()
    manager.state = {
        "nodes": {"conversation": conversation_node},
        "next_node_after_boot": "conversation",
    }

    instruction = enqueue_admin_instruction(
        manager,
        prompt="Review the latest support escalations",
        sender_id="admin-007",
        sender_name="Support Lead",
        mode="immediate",
        timestamp=321,
    )

    assert instruction is not None

    pending = get_pending_admin_instruction(manager)
    assert pending is not None
    assert pending is not instruction
    assert pending["id"] == instruction["id"]
    assert pending["prompt"] == "Review the latest support escalations"
    assert pending["mode"] == "immediate"
    assert pending["sender"]["id"] == "admin-007"
    assert pending["sender"]["name"] == "Support Lead"
    assert pending["timestamp"] == pytest.approx(321.0)

    pending["prompt"] = "mutated"
    queue_entry = manager.state["admin"]["queue"][0]
    assert queue_entry["prompt"] == "Review the latest support escalations"


def test_flow_admin_polling_controller_records_state(tmp_path):
    manager = DummyFlowManager()

    created_tasks: list[Any] = []

    def fake_create_task(coro):
        created_tasks.append(coro)
        try:
            coro.close()
        except Exception:
            pass

        class DummyTask:
            def __init__(self):
                self._cancelled = False

            def done(self):
                return self._cancelled

            def cancel(self):
                self._cancelled = True

        return DummyTask()

    controller = FlowMessagePollingController(
        flow_manager=manager,
        room_url='https://test.daily.co/test-room',
        create_task=fake_create_task
    )

    async def process_admin_message(_: dict[str, Any]) -> None:
        return None

    started = controller.start(
        bot_pid=123,
        admin_directory=tmp_path,
        process_admin_message=process_admin_message,
        redis_polling_factory=None,
    )

    assert started is True
    assert created_tasks, "Controller should schedule a polling coroutine"
    assert controller.is_running is True

    poller_state = get_flow_message_poller_state(manager)
    assert poller_state["running"] is True
    assert poller_state["source"] == "file"
    # Note: processed_count and started_at are in manager.state["admin"]["poller"], not in flow events
    # The flow events only track running status and source

    controller.stop()

    poller_state = get_flow_message_poller_state(manager)
    assert poller_state["running"] is False
    # Note: stopped_at is also not in flow events


def test_flow_admin_polling_controller_prefers_redis(tmp_path):
    manager = DummyFlowManager()

    def fake_create_task(coro):
        try:
            coro.close()
        except Exception:
            pass

        class DummyTask:
            def done(self):
                return False

            def cancel(self):
                pass

        return DummyTask()

    controller = FlowMessagePollingController(
        flow_manager=manager,
        room_url='https://test.daily.co/test-room',
        create_task=fake_create_task
    )

    async def process_admin_message(_: dict[str, Any]) -> None:
        return None

    def redis_factory(room_key: str, callback, room_url: str | None):
        assert room_key == 'https://test.daily.co/test-room'
        assert room_url == 'https://test.daily.co/test-room'

        async def _runner():
            return None

        return _runner()

    started = controller.start(
        bot_pid=456,
        admin_directory=tmp_path,
        process_admin_message=process_admin_message,
        redis_polling_factory=redis_factory,
    )

    assert started is True
    poller_state = get_flow_message_poller_state(manager)
    assert poller_state["running"] is True
    assert poller_state["source"] == "redis"


@pytest.mark.asyncio
async def test_wrapup_post_action_emits_once_with_delay_metadata(monkeypatch):
    manager = DummyFlowManager()
    manager.state = {
        "pacing": {"wrapup": {"delay": 12.5, "active": True}},
        "room": "room-flow",
        "wrapup_prompt_override": "  Flow wrap!  ",
    }
    published: list[tuple[str, dict[str, Any]]] = []

    def fake_publish(topic: str, payload: dict[str, Any]) -> None:
        published.append((topic, payload))

    monkeypatch.setattr("flows.nodes.publish", fake_publish)

    await _wrapup_post_action({}, manager)

    assert len(published) == 1
    topic, payload = published[0]
    assert topic == events.BOT_CONVO_WRAPUP
    assert payload["wrapup_prompt"] == "Flow wrap!"
    assert payload["room"] == "room-flow"
    assert payload["after_secs"] == pytest.approx(12.5)

    wrapup_state = manager.state["pacing"]["wrapup"]
    assert wrapup_state.get("published") is True
    assert wrapup_state.get("active") is False

    await _wrapup_post_action({}, manager)
    assert len(published) == 1, "Expected wrap-up event to publish only once"


@pytest.mark.asyncio
async def test_wrapup_post_action_uses_timer_delay_when_state_missing(monkeypatch):
    manager = DummyFlowManager()
    manager.state = {
        "timers": {"wrapup_after_secs": 90},
        "nodes": {
            "wrapup": {
                "task_messages": [
                    {"role": "system", "content": "Wrap politely."},
                ]
            }
        },
    }
    published: list[tuple[str, dict[str, Any]]] = []

    def fake_publish(topic: str, payload: dict[str, Any]) -> None:
        published.append((topic, payload))

    monkeypatch.setattr("flows.nodes.publish", fake_publish)

    await _wrapup_post_action({}, manager)

    assert len(published) == 1
    _, payload = published[0]
    assert payload["wrapup_prompt"] == "Wrap politely."
    assert payload["after_secs"] == pytest.approx(90.0)

