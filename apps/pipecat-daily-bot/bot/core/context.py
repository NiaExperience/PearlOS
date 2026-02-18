import copy
from typing import Any, List, Optional
from loguru import logger
from pipecat.processors.aggregators.llm_response import LLMUserContextAggregator
from pipecat.frames.frames import Frame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection
from .types import ContextSyncCallback
from .config import BOT_PID

class MultiUserContextAggregator(LLMUserContextAggregator):
    """Multi-user context aggregator that adds user_id information to transcriptions.

    This aggregator extends the standard LLMUserContextAggregator to handle
    multiple users by adding user_id information to the aggregated text before
    it's sent to the LLM.
    """

    def __init__(self, context, **kwargs):
        # Initialize the parent class
        super().__init__(context, **kwargs)

        self._participant_names = {}  # Map participant IDs to usernames
        self._context_sync_callback: ContextSyncCallback | None = None
        self._context_ref = context
        self._last_rendered_summary: str | None = None

    def register_context_sync_callback(self, callback: ContextSyncCallback) -> None:
        """Register a callback used to refresh the shared LLM context."""

        self._context_sync_callback = callback

    def _invoke_context_sync(self) -> None:
        callback = self._context_sync_callback
        if callback is None:
            return
        try:
            callback()
        except Exception:
            logger.exception('[context-sync] Failed to refresh LLM context via aggregator callback')

    def set_participant_name(self, participant_id: str, username: str):
        """Set the username for a participant ID."""
        self._participant_names[participant_id] = username
        logger.info(f"[{BOT_PID}] Mapped participant {participant_id} to username: {username}")

    def get_participant_name(self, participant_id: str) -> str:
        """Get the username for a participant ID, fallback to ID if not found."""
        return self._participant_names.get(participant_id, participant_id)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Process incoming frames, intercepting TranscriptionFrame.

        NOTE: We do NOT manually call _handle_transcription here.
        super().process_frame() already dispatches TranscriptionFrame to
        self._handle_transcription (which resolves to our override via MRO).
        Calling it here *and* in super() caused every transcript to be
        appended twice → duplicate messages in LLM context.
        """
        await super().process_frame(frame, direction)

    def snapshot_messages(self) -> list[dict[str, Any]]:
        """Return a copy of the current LLM context messages for inspection/logging."""

        context = self._context_ref
        if context is None:
            return []

        messages = getattr(context, "messages", None)
        if isinstance(messages, list):
            return copy.deepcopy(messages)

        getter = getattr(context, "get_messages", None)
        if callable(getter):
            try:
                data = getter()
                if isinstance(data, list):
                    return copy.deepcopy(data)
            except Exception:  # pragma: no cover - defensive guard
                logger.exception('[context-snapshot] Failed to read messages via get_messages')
        return []

    def render_text_summary(self, *, max_messages: int = 12, max_chars: int = 800) -> str:
        """Create a lightweight textual summary of recent conversation messages."""

        snapshot = self.snapshot_messages()
        if not snapshot:
            self._last_rendered_summary = ""
            return ""

        relevant_roles = {"user", "assistant", "system"}
        lines: list[str] = []
        for message in snapshot[-max_messages:]:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role", "unknown"))
            if role not in relevant_roles:
                continue
            content = message.get("content")
            if not isinstance(content, str):
                continue
            trimmed = " ".join(content.strip().split())
            if not trimmed:
                continue
            prefix = role[0].upper()
            lines.append(f"{prefix}: {trimmed}")
            if sum(len(part) for part in lines) >= max_chars:
                break

        summary = " ".join(lines)
        if len(summary) > max_chars:
            summary = summary[: max_chars - 1].rstrip() + "…"

        self._last_rendered_summary = summary
        return summary

    @property
    def last_rendered_summary(self) -> str | None:
        """Expose the most recent rendered summary (primarily for tests)."""

        return self._last_rendered_summary

    async def _handle_transcription(self, frame):
        """Override to add user_id information to transcriptions."""
        # Store the current user_id
        logger.info(f"[{BOT_PID}] HANDLE TRANSCRIPTION Frame: {frame}")
        
        # Pipecat's TranscriptionFrame uses 'user_id' to store the participant ID
        participant_id = getattr(frame, "user_id", None)

        text = frame.text

        if not text.strip():
            return

        if participant_id:
            # Use the mapped username if available, otherwise use the ID
            display_name = self.get_participant_name(participant_id)
            logger.info(f"[{BOT_PID}] Mapped participant {participant_id} to username: {display_name}")
            # Only add user prefix in multi-user rooms (>1 human participant)
            # In single-user voice sessions, the prefix confuses OpenClaw's session API
            human_participants = {pid for pid in self._participant_names if pid != BOT_PID}
            if len(human_participants) > 1:
                text = f"[User {display_name}, pid: {participant_id}]: {text}"

        self._aggregation += f"\n{text}" if self._aggregation else text
        self._seen_interim_results = False
        self._aggregation_event.set()

    async def handle_aggregation(self, aggregation: str):
        """Add the aggregated user text to the context."""

        self._invoke_context_sync()
        await super().handle_aggregation(aggregation)
