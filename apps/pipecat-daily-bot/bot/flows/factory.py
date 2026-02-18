from __future__ import annotations

from typing import Any, Optional
from pipecat_flows import FlowManager, ContextStrategy, ContextStrategyConfig
from core.config import BOT_WRAPUP_AFTER_SECS, BOT_BEAT_REPEAT_INTERVAL_SECS
from .types import TimerSettings


def collect_timer_settings() -> TimerSettings:
    """Mirror the legacy timer configuration so Flow state stays authoritative."""

    return TimerSettings(
        wrapup_after_secs=float(BOT_WRAPUP_AFTER_SECS()),
        beat_repeat_interval=float(BOT_BEAT_REPEAT_INTERVAL_SECS()),
    )


def build_flow_manager(
    *,
    task: Any,
    llm: Any,
    context_aggregator: Any,
    transport: Any,
    context_strategy: Optional[ContextStrategyConfig] = None,
) -> FlowManager:
    """Instantiate the FlowManager with the shared default context strategy.
    
    Using APPEND strategy to preserve tools across flow node transitions.
    """

    strategy = context_strategy or ContextStrategyConfig(
        strategy=ContextStrategy.APPEND,
    )

    return FlowManager(
        task=task,
        llm=llm,
        context_aggregator=context_aggregator,
        transport=transport,
        context_strategy=strategy,
    )
