"""Onboarding Tool Functions.

Tools for managing the onboarding process.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import profile_actions
from room.state import get_desktop_mode
from services.redis import RedisClient
from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
from tools import events

# Built-in fallback descriptions
DEFAULT_ONBOARDING_TOOL_PROMPTS: dict[str, str] = {
    'bot_onboarding_progress': (
        "Record deterministic onboarding progress after each beat or required action. "
        "Use this to set currentBeat, completedBeat, and required actions such as "
        "profileUpdated or welcomeNoteCreated. This tool keeps voice and text onboarding "
        "in the same persisted state."
    ),
    'bot_onboarding_complete': (
        "CRITICAL: Call this tool only when onboarding has reached its final completion step "
        "and required actions are done, or when the user asks to skip, stop, or says onboarding "
        "is already done. Pass reason='completed', 'skip', 'stop', or 'already_done'. "
        "This is the ONLY way to exit onboarding mode. Do not just say you are done; "
        "you MUST call this function."
    ),
}

REQUIRED_ONBOARDING_ACTIONS = ("profileUpdated", "welcomeNoteCreated")
SKIP_REASONS = {"skip", "stop", "already_done", "already-done", "already done"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _context_user_id(context: Any) -> str | None:
    user_id = context.user_id() if context and hasattr(context, 'user_id') else None
    if not user_id:
        user_id = os.environ.get('BOT_SESSION_USER_ID')
    return str(user_id).strip() if user_id else None


def _context_source(context: Any, fallback: str = "voice") -> str:
    if context and hasattr(context, "channel"):
        channel = context.channel()
        if channel:
            return str(channel)
    return fallback


def _profile_onboarding_state(profile: dict | None) -> dict:
    state = (profile or {}).get("onboardingState")
    return state if isinstance(state, dict) else {}


def _merge_onboarding_state(existing: dict, incoming: dict) -> dict:
    merged = {**existing, **incoming}
    existing_actions = existing.get("requiredActions")
    incoming_actions = incoming.get("requiredActions")
    if isinstance(existing_actions, dict) or isinstance(incoming_actions, dict):
        merged["requiredActions"] = {
            **(existing_actions if isinstance(existing_actions, dict) else {}),
            **(incoming_actions if isinstance(incoming_actions, dict) else {}),
        }

    completed_beats: list[str] = []
    for beat in [
        *(existing.get("completedBeats") if isinstance(existing.get("completedBeats"), list) else []),
        *(incoming.get("completedBeats") if isinstance(incoming.get("completedBeats"), list) else []),
    ]:
        value = str(beat).strip()
        if value and value not in completed_beats:
            completed_beats.append(value)
    if completed_beats:
        merged["completedBeats"] = completed_beats

    merged["promptFeatureKey"] = "onboarding"
    merged["updatedAt"] = _utc_now()
    return merged


def _missing_required_actions(state: dict) -> list[str]:
    actions = state.get("requiredActions")
    actions = actions if isinstance(actions, dict) else {}
    return [key for key in REQUIRED_ONBOARDING_ACTIONS if actions.get(key) is not True]


def _completion_reason(arguments: dict | None) -> str:
    raw = (arguments or {}).get("reason") or "completed"
    return str(raw).strip().lower()


async def _persist_onboarding_state(user_id: str, incoming: dict) -> dict | None:
    existing_profile = await profile_actions.get_user_profile(user_id)
    existing_state = _profile_onboarding_state(existing_profile)
    state = _merge_onboarding_state(existing_state, incoming)
    return await profile_actions.upsert_user_profile(
        user_id=user_id,
        data={"onboardingState": state}
    )


async def _emit_completion_event(forwarder: Any) -> None:
    if not forwarder:
        return
    await events.emit_nia_event(
        forwarder,
        "onboarding.complete",
        {}
    )


async def _trigger_personality_update(forwarder: Any, log: Any) -> None:
    if not forwarder or not hasattr(forwarder, "room_url") or not forwarder.room_url:
        return
    try:
        room_url = forwarder.room_url
        current_mode = await get_desktop_mode(room_url)
        log.bind(mode=current_mode).info("Onboarding complete. Triggering personality update")

        redis_client = RedisClient()
        client = await redis_client._get_redis()
        channel = f"bot:config:room:{room_url}"

        await client.publish(channel, json.dumps({
            "mode": current_mode,
            "source": "onboarding_complete"
        }))
    except Exception:
        log.error("Failed to trigger personality update after onboarding", exc_info=True)


# ============================================================================
# Onboarding Tool Handlers (Decorated)
# ============================================================================


@bot_tool(
    name="bot_onboarding_progress",
    description=DEFAULT_ONBOARDING_TOOL_PROMPTS["bot_onboarding_progress"],
    feature_flag="onboarding",
    parameters={
        "type": "object",
        "properties": {
            "currentBeat": {"type": "number", "description": "The current onboarding beat number."},
            "completedBeat": {"type": "string", "description": "The beat just completed, such as beat_1."},
            "action": {
                "type": "string",
                "enum": list(REQUIRED_ONBOARDING_ACTIONS),
                "description": "A required onboarding action that was just completed."
            },
            "source": {"type": "string", "enum": ["voice", "text"]},
        },
        "required": []
    }
)
async def bot_onboarding_progress(
    params: FunctionCallParams
) -> FunctionCallResultProperties:
    """Persist onboarding beat/action progress without completing onboarding."""
    arguments = params.arguments or {}
    context = getattr(params, 'handler_context', params.context)
    log = bind_tool_logger(params, tag="[onboarding]").bind(arguments=arguments)

    user_id = _context_user_id(context)
    if not user_id:
        await params.result_callback({
            "success": False,
            "error": "user_id_required",
            "user_message": "User ID is required to record onboarding progress"
        }, properties=FunctionCallResultProperties(run_llm=False))
        return

    incoming: dict[str, Any] = {
        "source": str(arguments.get("source") or _context_source(context)).strip() or "voice",
    }

    current_beat = arguments.get("currentBeat")
    if isinstance(current_beat, (int, float)):
        incoming["currentBeat"] = int(current_beat)

    completed_beat = str(arguments.get("completedBeat") or "").strip()
    if completed_beat:
        incoming["completedBeats"] = [completed_beat]

    action = str(arguments.get("action") or "").strip()
    if action in REQUIRED_ONBOARDING_ACTIONS:
        incoming["requiredActions"] = {action: True}

    profile = await _persist_onboarding_state(user_id, incoming)
    if not profile:
        await params.result_callback({
            "success": False,
            "error": "persist_failed",
            "user_message": "Failed to record onboarding progress"
        }, properties=FunctionCallResultProperties(run_llm=False))
        return

    log.bind(userId=user_id).info("Recorded onboarding progress")
    await params.result_callback({
        "success": True,
        "onboardingState": profile.get("onboardingState"),
        "user_message": "Onboarding progress recorded"
    }, properties=FunctionCallResultProperties(run_llm=False))
    return


@bot_tool(
    name="bot_onboarding_complete",
    description=DEFAULT_ONBOARDING_TOOL_PROMPTS["bot_onboarding_complete"],
    feature_flag="onboarding",
    parameters={
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "enum": ["completed", "skip", "stop", "already_done"],
                "description": "Why onboarding should end."
            }
        },
        "required": []
    }
)
async def bot_onboarding_complete(
    params: FunctionCallParams
) -> FunctionCallResultProperties:
    """Signal that onboarding is complete."""
    arguments = params.arguments or {}
    log = bind_tool_logger(params, tag="[onboarding]")
    reason = _completion_reason(arguments)
    log.bind(reason=reason).info("Onboarding complete signal received")
    
    # Extract forwarder from params (injected by toolbox wrapper)
    forwarder = getattr(params, "forwarder", None)
    context = getattr(params, 'handler_context', params.context)
    
    if not forwarder:
        log.warning("AppMessageForwarder missing in bot_onboarding_complete params")

    user_id = _context_user_id(context)
    if not user_id:
        log.warning("No user_id found in context, cannot persist onboarding status")
        await params.result_callback({
            "success": False,
            "error": "user_id_required",
            "user_message": "User ID is required to complete onboarding"
        }, properties=FunctionCallResultProperties(run_llm=False))
        return

    try:
        profile = await profile_actions.get_user_profile(user_id)
        if profile and profile.get("onboardingComplete") is True:
            await _emit_completion_event(forwarder)
            await _trigger_personality_update(forwarder, log)
            await params.result_callback({
                "success": True,
                "alreadyComplete": True,
                "user_message": "Onboarding was already complete"
            }, properties=FunctionCallResultProperties(run_llm=False))
            return

        state = _profile_onboarding_state(profile)
        missing = _missing_required_actions(state)
        if reason not in SKIP_REASONS and missing:
            log.bind(userId=user_id, missingActions=missing).warning(
                "Blocked onboarding completion because required actions are missing"
            )
            await params.result_callback({
                "success": False,
                "error": "required_actions_missing",
                "missingActions": missing,
                "user_message": (
                    "Onboarding is not complete yet. Finish the missing required actions "
                    f"first: {', '.join(missing)}"
                )
            }, properties=FunctionCallResultProperties(run_llm=True))
            return

        final_state = _merge_onboarding_state(state, {
            "completedBeats": ["complete"],
            "source": _context_source(context),
        })
        log.bind(userId=user_id, reason=reason).info("Marking onboarding as complete")
        await profile_actions.upsert_user_profile(
            user_id=user_id,
            data={
                "onboardingComplete": True,
                "onboardingState": final_state,
            }
        )
    except Exception:
        log.error("Failed to update onboarding status in DB", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": "persist_failed",
            "user_message": "Failed to persist onboarding completion"
        }, properties=FunctionCallResultProperties(run_llm=False))
        return

    await _emit_completion_event(forwarder)

    # Trigger personality update based on current desktop mode
    # This ensures that if we are in a specific mode (e.g. Work) but were using default personality
    # during onboarding, we now switch to the correct personality for that mode.
    await _trigger_personality_update(forwarder, log)

    await params.result_callback({
        "success": True,
        "reason": reason,
        "user_message": "Onboarding marked as complete"
    }, properties=FunctionCallResultProperties(run_llm=False))
    return
