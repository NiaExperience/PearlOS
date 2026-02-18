from __future__ import annotations

import json
from typing import Any, Callable

from loguru import logger

from core.config import BOT_PID
from session.participants import ParticipantManager
from session.identity import IdentityManager
from room.state import set_forwarder, remove_forwarder

class SessionManagers:
    def __init__(
        self,
        room_url: str,
        transport: Any,
        forwarder_ref: dict | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        user_name: str | None = None,
    ):
        self.room_url = room_url
        self.transport = transport
        self.forwarder_ref = forwarder_ref
        self.log = logger.bind(
            tag="[managers]",
            botPid=BOT_PID,
            roomUrl=room_url,
            sessionId=session_id,
            userId=user_id,
            userName=user_name,
        )
        
        self.participant_manager = ParticipantManager()
        self.identity_manager = IdentityManager(room_url, self.participant_manager)
        self.forwarder: Any | None = None
        self.forwarder_stop: Callable[[], None] | None = None

    async def start(self):
        """Initialize and start all managers."""
        # Start identity manager
        self.identity_manager.start()
        
        # Start app-message forwarder
        await self._start_forwarder()

    async def stop(self):
        """Stop all managers and cleanup."""
        self.identity_manager.stop()
        
        if self.forwarder:
            try:
                await self.forwarder.shutdown()
            except Exception:
                pass
        
        if self.forwarder_stop:
            try:
                self.forwarder_stop()
            except Exception:
                pass
                
        try:
            remove_forwarder(self.room_url)
            log.info('Removed forwarder from registry for room: %s' % self.room_url)
        except Exception:
            pass

    async def _start_forwarder(self):
        try:
            try:
                from services.app_message_forwarder import AppMessageForwarder
            except ImportError:
                from bot.services.app_message_forwarder import AppMessageForwarder

            def _snapshot_provider():
                return {
                    "room": self.room_url,
                    "participants": sorted(list(self.participant_manager.get_active_participants())),
                }

            self.forwarder = AppMessageForwarder(
                self.transport, snapshot_provider=_snapshot_provider, room_url=self.room_url
            )
            self.forwarder_stop = self.forwarder.start()
            
            # Register forwarder in global registry
            set_forwarder(self.room_url, self.forwarder)
            self.log.info('Registered forwarder for room: %s' % self.room_url)
            
            # Set forwarder reference for note tools
            if self.forwarder_ref is not None:
                self.log.info('Setting forwarder instance for note tools')
                self.forwarder_ref['instance'] = self.forwarder

            # Register inbound app-message handler if event is supported
            # Note: In the original code, this logic was a bit complex, checking for transport events.
            # We'll keep the core logic here.
            
            self.log.info(
                "[app-message-forwarder] ✅ Using frame-based message processing in on_frame_reached_upstream handler"
            )

        except Exception as e:
            self.log.warning("[app-message-forwarder] init failed: %s" % e)
            self.forwarder = None
            self.forwarder_stop = None

    def _decode_message(self, message: Any) -> dict | None:
        """Decode incoming message payloads to a dict, rejecting obviously invalid inputs."""
        if isinstance(message, (bytes, bytearray)):
            try:
                message = message.decode("utf-8", "ignore")
            except Exception:
                return None
        if isinstance(message, str):
            if len(message) <= 2:
                return None
            try:
                message = json.loads(message)
            except Exception:
                return None
        if not isinstance(message, dict):
            return None
        return message

    def _process_incoming_kind(self, message_obj: dict):
        kind = message_obj.get("kind")
        self.log.debug(
            "[app-message-handler] Received message with kind='%s': %s" % (kind, message_obj)
        )
        if kind in ("req", "gap"):
            self.log.info("[app-message-handler] Processing message of kind='%s'" % kind)
            self.forwarder.handle_incoming(message_obj)
        elif kind == "nia.tool_invoke":
            self.log.info("[app-message-handler] 🔧 Received tool invoke request: %s" % message_obj)
            self._handle_tool_invoke(message_obj)
        elif kind == "nia.event":
            self.log.info("[app-message-handler] 📨 Received nia.event: event=%s" % message_obj.get("event"))
            self._handle_nia_event(message_obj)
        else:
            self.log.debug(
                "[app-message-handler] Ignoring message with unhandled kind='%s'" % kind
            )

    def _handle_tool_invoke(self, message_obj: dict):
        """Handle nia.tool_invoke app-messages by injecting intent into LLM context.

        Rather than calling tools directly (which requires complex pipeline
        context), we inject a system message describing the desired tool call
        and trigger an LLM run.  The LLM then calls the tool naturally through
        the existing tool-calling pipeline.
        """
        import asyncio

        tool_name = message_obj.get("tool_name") or message_obj.get("toolName", "")
        params = message_obj.get("params") or {}

        if not tool_name:
            self.log.warning("[tool_invoke] Missing tool_name in message: %s" % message_obj)
            return

        self.log.info(
            "[tool_invoke] 🔧 Dispatching tool_name=%s params=%s" % (tool_name, params)
        )

        # Build a system message that instructs the LLM to call the tool
        params_desc = ""
        if params:
            params_desc = " with parameters: %s" % json.dumps(params)

        system_content = (
            "TOOL INVOCATION REQUEST: The user (via the UI) wants you to call the "
            "'%s' tool%s. Call it now — do not ask for confirmation." % (tool_name, params_desc)
        )

        try:
            from flows.registry import get_flow_manager
            from pipecat.frames.frames import LLMMessagesAppendFrame

            flow_manager = get_flow_manager(self.room_url)
            if not flow_manager:
                self.log.warning("[tool_invoke] No flow_manager for room %s" % self.room_url)
                return

            task = getattr(flow_manager, "task", None)
            if not task or not hasattr(task, "queue_frames"):
                self.log.warning("[tool_invoke] No task/queue_frames on flow_manager")
                return

            async def _inject_and_run():
                from pipecat.frames.frames import LLMRunFrame

                await task.queue_frames([
                    LLMMessagesAppendFrame(messages=[{
                        "role": "system",
                        "content": system_content,
                    }]),
                    LLMRunFrame(),
                ])
                self.log.info("[tool_invoke] ✅ Injected system message and triggered LLM run for '%s'" % tool_name)

            # Schedule on running loop
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(_inject_and_run())
            else:
                loop.run_until_complete(_inject_and_run())

        except Exception as e:
            self.log.error("[tool_invoke] ❌ Failed to dispatch tool invoke: %s" % e, exc_info=True)

    def _handle_nia_event(self, message_obj: dict):
        """Handle nia.event messages from the frontend/OpenClaw.

        Publishes the event onto the internal event bus so that handlers,
        tools, and other subsystems can react to frontend-originated events
        (e.g., note.open, note.updated, app.open).
        """
        import asyncio

        event = message_obj.get("event", "")
        payload = message_obj.get("payload") or {}

        if not event:
            self.log.warning("[nia.event] Missing 'event' field in message: %s" % message_obj)
            return

        self.log.info(
            "[nia.event] 📨 Processing event=%s payload_keys=%s" % (event, list(payload.keys()))
        )

        # Publish to internal event bus so subscribers can react
        try:
            from eventbus.bus import publish
            publish(event, {"event": event, "payload": payload, "room_url": self.room_url})
            self.log.info("[nia.event] ✅ Published '%s' to event bus" % event)
        except Exception as e:
            self.log.error("[nia.event] ❌ Failed to publish '%s': %s" % (event, e))

        # For note-related events, update room state AND inject LLM context
        if event in ("note.open", "note.opened"):
            note_id = payload.get("noteId") or payload.get("note_id")
            owner = payload.get("owner") or payload.get("userId")
            title = payload.get("title") or "Untitled"
            content = payload.get("content") or ""
            if note_id:
                try:
                    from room.state import set_active_note_id
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.ensure_future(
                            set_active_note_id(self.room_url, note_id, owner=owner)
                        )
                    self.log.info("[nia.event] Updated active note: %s (owner=%s)" % (note_id, owner))
                except Exception as e:
                    self.log.error("[nia.event] Failed to update active note state: %s" % e)

                # Inject note context into LLM so Pearl knows what's on screen
                self._inject_note_context(note_id, title, content)

        elif event in ("note.close", "note.closed"):
            try:
                from room.state import set_active_note_id
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.ensure_future(
                        set_active_note_id(self.room_url, None)
                    )
                self.log.info("[nia.event] Cleared active note")
            except Exception as e:
                self.log.error("[nia.event] Failed to clear active note state: %s" % e)

            # Clear note context from LLM
            self._inject_note_context(None, None, None)

        elif event in ("note.updated",):
            note_id = payload.get("noteId") or payload.get("note_id")
            title = payload.get("title")
            content = payload.get("content")
            if note_id and (title or content):
                self._inject_note_context(note_id, title, content)

        elif event == "wonder.interaction":
            self._handle_wonder_interaction(payload)

    # ─── Wonder Canvas interaction injection ──────────────────────────────

    def _handle_wonder_interaction(self, payload: dict):
        """Inject a Wonder Canvas interaction event into the LLM context.

        When the user taps a data-action element on the Wonder Canvas, the
        frontend sends a wonder.interaction event. We inject a system message
        so Pearl can respond naturally with the next scene.
        """
        import asyncio

        action = payload.get("action", "")
        label = payload.get("label", "")
        if not action:
            self.log.warning("[wonder] Interaction event missing 'action': %s" % payload)
            return

        context_msg = "[Wonder Canvas interaction: user selected \"%s\"]" % action
        if label:
            context_msg = "[Wonder Canvas interaction: user selected \"%s\" (label: \"%s\")]" % (action, label)

        self.log.info("[wonder] 🎯 %s" % context_msg)

        try:
            from flows.registry import get_flow_manager
            from pipecat.frames.frames import LLMMessagesAppendFrame, LLMRunFrame

            flow_manager = get_flow_manager(self.room_url)
            if not flow_manager:
                return
            task = getattr(flow_manager, "task", None)
            if not task or not hasattr(task, "queue_frames"):
                return

            async def _inject():
                await task.queue_frames([
                    LLMMessagesAppendFrame(messages=[{
                        "role": "system",
                        "content": context_msg,
                    }]),
                    LLMRunFrame(),
                ])

            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(_inject())
            else:
                loop.run_until_complete(_inject())
        except Exception as e:
            self.log.error("[wonder] Failed to inject interaction: %s" % e)

    # ─── Note context marker for LLM messages ─────────────────────────────
    _NOTE_CONTEXT_MARKER = "## 📝 ACTIVE NOTE CONTEXT"

    def _inject_note_context(self, note_id: str | None, title: str | None, content: str | None):
        """Inject or update a system message in the LLM context with the active note info.

        This allows Pearl to know what note the user is looking at without needing
        to call bot_read_current_note. When note_id is None, the context message
        is removed (note was closed).
        """
        import asyncio

        try:
            from flows.registry import get_flow_manager
            from pipecat.frames.frames import LLMMessagesAppendFrame

            flow_manager = get_flow_manager(self.room_url)
            if not flow_manager:
                self.log.debug("[note_context] No flow_manager for room %s" % self.room_url)
                return

            task = getattr(flow_manager, "task", None)
            if not task or not hasattr(task, "queue_frames"):
                self.log.debug("[note_context] No task/queue_frames on flow_manager")
                return

            # Build or clear the context message
            if note_id:
                # Truncate content for context window efficiency
                preview = (content or "")[:3000]
                if content and len(content) > 3000:
                    preview += "\n... (content truncated, use bot_read_current_note for full text)"

                context_content = (
                    "%s\n"
                    "The user currently has this note open on screen:\n"
                    "- **Note ID:** %s\n"
                    "- **Title:** %s\n"
                    "- **Content:**\n%s\n\n"
                    "If the user says 'edit this note', 'add to the note', etc., "
                    "you already know which note they mean. Use the note tools directly "
                    "without asking which note." % (self._NOTE_CONTEXT_MARKER, note_id, title or "Untitled", preview)
                )
                self.log.info("[note_context] 📝 Injecting note context: id=%s title=%s content_len=%d" % (note_id, title, len(content or "")))
            else:
                context_content = (
                    "%s\n"
                    "No note is currently open. The user closed or navigated away from the note view."
                    % self._NOTE_CONTEXT_MARKER
                )
                self.log.info("[note_context] 📝 Clearing note context (note closed)")

            async def _inject():
                # Remove any previous note context message from the context
                try:
                    context = getattr(task, "_context", None) or getattr(flow_manager, "context", None)
                    if context and hasattr(context, "messages"):
                        messages = context.messages
                        context.messages = [
                            m for m in messages
                            if not (isinstance(m, dict) and isinstance(m.get("content"), str)
                                    and self._NOTE_CONTEXT_MARKER in m["content"])
                        ]
                except Exception as e:
                    self.log.debug("[note_context] Could not clean old context: %s" % e)

                await task.queue_frames([
                    LLMMessagesAppendFrame(messages=[{
                        "role": "system",
                        "content": context_content,
                    }]),
                ])
                self.log.info("[note_context] ✅ Note context injected into LLM")

            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(_inject())
            else:
                loop.run_until_complete(_inject())

        except Exception as e:
            self.log.warning("[note_context] Failed to inject note context: %s" % e)

    def handle_app_message(self, message: Any):
        """Handle incoming app message via forwarder."""
        if not self.forwarder:
            return

        try:
            message_obj = self._decode_message(message)
            if not message_obj:
                return
            self._process_incoming_kind(message_obj)
        except Exception as e:
            try:
                self.log.error("[app-message-forwarder] inbound parse error: %s" % e)
            except Exception:
                pass
