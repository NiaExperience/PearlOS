"""Utilities that mirror participant event-bus traffic into Flow-managed state.

Phase 1 keeps the legacy event handlers in place while gradually introducing
Flow-managed conversation state. The dispatcher centralizes the bridge between
Daily participant events and the FlowManager so we can migrate call sites
incrementally without sprinkling Flow-specific mutations throughout the legacy
handlers.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Mapping, Optional

from loguru import logger

from pipecat_flows import FlowManager

from .core import (
    get_flow_greeting_state,
    record_participant_join,
    record_participant_leave,
    refresh_conversation_role_messages,
)


class FlowParticipantDispatcher:
    """Translate participant lifecycle events into Flow state updates."""

    __slots__ = ("_flow_manager",)

    def __init__(self, flow_manager: Optional[FlowManager]) -> None:
        self._flow_manager = flow_manager

    @property
    def enabled(self) -> bool:
        return True

    def handle_join(
        self,
        *,
        room: str,
        participant_id: Optional[str],
        display_name: Optional[str],
        context: Optional[Dict[str, Any]],
        stealth: bool,
    ) -> None:
        if not self.enabled or not participant_id:
            return

        record_participant_join(
            self._flow_manager,
            participant_id,
            display_name,
            context,
            stealth=stealth,
        )

        # Mirror the roster into the greeting state layer that legacy handlers read.
        greeting_state = get_flow_greeting_state(self._flow_manager, room)
        if stealth:
            greeting_state["participants"].discard(participant_id)
            greeting_state["participant_contexts"].pop(participant_id, None)
            greeting_state["grace_participants"].pop(participant_id, None)
        else:
            greeting_state["participants"].add(participant_id)
            greeting_state["participant_contexts"][participant_id] = context

        self._refresh_role_messages()

    def handle_leave(
        self,
        *,
        room: str,
        participant_id: Optional[str],
    ) -> None:
        if not self.enabled or not participant_id:
            return

        record_participant_leave(self._flow_manager, participant_id)

        greeting_state = get_flow_greeting_state(self._flow_manager, room)
        greeting_state["participants"].discard(participant_id)
        greeting_state["participant_contexts"].pop(participant_id, None)
        greeting_state["grace_participants"].pop(participant_id, None)
        self._refresh_role_messages()

    def handle_snapshot(
        self,
        *,
        room: str,
        participants: Iterable[str],
    ) -> None:
        if not self.enabled:
            return

        greeting_state = get_flow_greeting_state(self._flow_manager, room)
        incoming = {pid for pid in participants if pid}
        greeting_state["participants"] = incoming
        self._sync_flow_roster(incoming)
        self._refresh_role_messages()

    def handle_identity(
        self,
        *,
        room: str,
        participant_id: Optional[str],
        payload: Mapping[str, Any] | None,
    ) -> None:
        if not self.enabled or not participant_id:
            return

        identity_payload, display_name = self._normalize_identity_payload(payload)

        greeting_state = get_flow_greeting_state(self._flow_manager, room)
        self._update_greeting_identity(
            greeting_state=greeting_state,
            participant_id=participant_id,
            identity_payload=identity_payload,
            display_name=display_name,
        )
        self._update_flow_state_identity(
            participant_id=participant_id,
            identity_payload=identity_payload,
            display_name=display_name,
        )
        self._refresh_role_messages()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _sync_flow_roster(self, incoming: set[str]) -> None:
        try:
            flow_state = self._flow_manager.state
            if isinstance(flow_state, dict):
                stealth = flow_state.get("stealth_participants") or set()
                roster = [pid for pid in incoming if pid not in stealth]
                flow_state["participants"] = roster
        except Exception:  # pragma: no cover - defensive guardrail
            logger.exception("[flow.dispatcher] Failed to sync snapshot into Flow state")

    def _normalize_identity_payload(
        self, payload: Mapping[str, Any] | None
    ) -> tuple[Dict[str, str], Optional[str]]:
        identity_payload = dict(payload or {})

        normalized_identity: Dict[str, str] = {}
        for key in ("sessionUserId", "sessionUserName", "sessionUserEmail"):
            raw = identity_payload.get(key)
            if isinstance(raw, str):
                stripped = raw.strip()
                if stripped:
                    normalized_identity[key] = stripped

        display_name: Optional[str] = normalized_identity.get("sessionUserName")
        if not display_name:
            alt_name = identity_payload.get("displayName")
            if isinstance(alt_name, str) and alt_name.strip():
                display_name = alt_name.strip()

        return normalized_identity, display_name

    def _update_greeting_identity(
        self,
        *,
        greeting_state: Dict[str, Any],
        participant_id: str,
        identity_payload: Dict[str, str],
        display_name: Optional[str],
    ) -> None:
        grace_participants = greeting_state.setdefault("grace_participants", {})
        participant_contexts = greeting_state.setdefault("participant_contexts", {})

        existing_ctx = participant_contexts.get(participant_id)
        if not isinstance(existing_ctx, dict):
            existing_ctx = {} if existing_ctx is None else {"value": existing_ctx}

        identity_ctx = existing_ctx.setdefault("identity", {})
        identity_ctx.update(identity_payload)
        participant_contexts[participant_id] = existing_ctx

        if display_name:
            grace_participants[participant_id] = display_name

    def _update_flow_state_identity(
        self,
        *,
        participant_id: str,
        identity_payload: Dict[str, str],
        display_name: Optional[str],
    ) -> None:
        flow_state = self._flow_manager.state
        if not isinstance(flow_state, dict):
            return

        flow_contexts = flow_state.setdefault("participant_contexts", {})
        flow_entry = flow_contexts.get(participant_id)
        if not isinstance(flow_entry, dict):
            flow_entry = {}

        if display_name:
            flow_entry["display_name"] = display_name

        stored_context = flow_entry.get("context")
        if not isinstance(stored_context, dict):
            stored_context = {} if stored_context is None else {"value": stored_context}

        identity_ctx = stored_context.setdefault("identity", {})
        identity_ctx.update(identity_payload)
        flow_entry["context"] = stored_context
        flow_entry.setdefault("stealth", False)

        flow_contexts[participant_id] = flow_entry
        self._refresh_role_messages()

    def _refresh_role_messages(self) -> None:
        try:
            # Debounce: coalesce rapid refresh calls within a short window
            import time

            flow_state = getattr(self._flow_manager, "state", None)
            if not isinstance(flow_state, dict):
                refresh_conversation_role_messages(self._flow_manager)
                return

            debounced = flow_state.setdefault("_role_refresh", {})
            now = time.monotonic()
            window = 0.2  # seconds
            next_allowed = debounced.get("next_allowed", 0.0)
            if now < next_allowed:
                # Already within debounce window; mark pending and exit.
                debounced["pending"] = True
                return

            # We are outside the window; schedule the refresh and set the next window.
            debounced["next_allowed"] = now + window
            debounced["pending"] = False
            refresh_conversation_role_messages(self._flow_manager)

            # If more refresh requests came in during the call, do one more trailing refresh.
            if debounced.get("pending"):
                debounced["pending"] = False
                debounced["next_allowed"] = now + window
                refresh_conversation_role_messages(self._flow_manager)
        except Exception:  # pragma: no cover - defensive guardrail
            logger.exception("[flow.dispatcher] Failed to refresh role messages")
