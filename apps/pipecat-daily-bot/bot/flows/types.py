from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, Any
from pipecat_flows.types import NodeConfig

DEFAULT_SUMMARY_PROMPT = (
    "Summarize the conversation briefly, focusing on key points and participant names. "
    "Keep it under 100 words so we preserve token budget."
)

WRAPUP_NODE_NAME = "wrapup"
ADMIN_NODE_NAME = "admin_instruction"


@dataclass(slots=True)
class TimerSettings:
    """Snapshot of the timers that legacy handlers currently manage."""

    wrapup_after_secs: float
    beat_repeat_interval: float

    def as_dict(self) -> Dict[str, float | int]:
        return {
            "wrapup_after_secs": self.wrapup_after_secs,
            "beat_repeat_interval": self.beat_repeat_interval,
        }


@dataclass(slots=True)
class DailyBotFlowState:
    """Flow-centric state scaffold we can extend in later phases."""

    timers: Dict[str, float | int] = field(default_factory=dict)
    nodes: Dict[str, NodeConfig] = field(default_factory=dict)
    next_node_after_boot: str = "conversation"
    participants: list[str] = field(default_factory=list)
    participant_contexts: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    stealth_participants: set[str] = field(default_factory=set)
    last_joined_participant: Optional[str] = None
    greeting_rooms: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    wrapup_prompt: Optional[str] = None
    room: Optional[str] = None
    admin_state: Dict[str, Any] = field(default_factory=dict)
    opening_prompt: Optional[str] = None
