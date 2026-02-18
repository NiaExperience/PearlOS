"""Flow scaffolding utilities for the Pipecat Daily Bot.

Phase 0 introduces a minimal FlowManager setup that can coexist with the
legacy event-handler pipeline while we incrementally migrate behaviors.
"""

from .core import (
    DailyBotFlowState,
    TimerSettings,
    build_flow_manager,
    collect_timer_settings,
    create_conversation_node,
    create_boot_node,
    create_wrapup_node,
    create_admin_instruction_node,
    get_flow_greeting_state,
    get_participant_snapshot,
    initialize_base_flow,
    refresh_conversation_role_messages,
    append_admin_task_message_to_context,
    enqueue_admin_instruction,
    consume_admin_instruction,
    get_pending_admin_instruction,
    transition_to_admin_node,
    record_participant_join,
    record_participant_leave,
    reset_flow_greeting_state,
    transition_to_wrapup_node,
)
from .admin import FlowMessagePollingController, get_flow_message_poller_state, handle_admin_instruction
from .dispatcher import FlowParticipantDispatcher
from .pacing import FlowPacingController

__all__ = [
    "DailyBotFlowState",
    "TimerSettings",
    "build_flow_manager",
    "collect_timer_settings",
    "create_conversation_node",
    "create_boot_node",
    "create_wrapup_node",
    "create_admin_instruction_node",
    "get_flow_greeting_state",
    "get_participant_snapshot",
    "initialize_base_flow",
    "refresh_conversation_role_messages",
    "append_admin_task_message_to_context",
    "enqueue_admin_instruction",
    "consume_admin_instruction",
    "get_pending_admin_instruction",
    "transition_to_admin_node",
    "record_participant_join",
    "record_participant_leave",
    "reset_flow_greeting_state",
    "transition_to_wrapup_node",
    "FlowMessagePollingController",
    "get_flow_message_poller_state",
    "FlowParticipantDispatcher",
    "FlowPacingController",
    "handle_admin_instruction",
]
