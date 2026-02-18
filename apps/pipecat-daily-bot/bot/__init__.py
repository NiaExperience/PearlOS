"""Pipecat Daily Bot package.

Exposes selected internal utilities and runtime helpers for tests.
"""

# Explicit re-exports needed by tests
from core.context import MultiUserContextAggregator
from providers.daily import create_daily_room_token
from session.orchestrator import run_pipeline_session
from core.transport import get_session_user_id_from_participant
from .bot import bot
from .room.state import (
    get_active_note_id,
    set_active_note_id,
    get_active_note_owner,
    get_room_tenant_id,
    set_room_tenant_id,
    _room_tenants,
)
from session.participant_data import (  # re-export for tests
    derive_name_and_context,
    extract_raw_name,
    first_token,
)


async def build_pipeline(*args, **kwargs):  # pragma: no cover - passthrough
    from .pipeline.builder import build_pipeline as _bp
    return await _bp(*args, **kwargs)

__all__ = [
    "first_token",
    "extract_raw_name",
    "derive_name_and_context",
    "build_pipeline",
    "run_pipeline_session",
    "MultiUserContextAggregator",
    "create_daily_room_token",
    # Collaborative notes functions
    "get_active_note_id",
    "set_active_note_id",
    "get_active_note_owner",
    "get_room_tenant_id",
    "set_room_tenant_id",
    "get_session_user_id_from_participant",
    "_active_notes",
    "_room_tenants",
]
