"""App-message event forwarder.

Listens to internal event bus topics (Daily call + participant events) and
forwards them as versioned envelopes over the Daily data channel (app-message)
using the Pipecat DailyTransport instance.

This mirrors the browser-side bridge (apps/interface/.../appMessageBridge.ts)
so that bot-originated events (join/leave/state/errors, roster changes, etc.)
arrive in the same unified envelope shape.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from typing import Any

try:
    import aiohttp  # type: ignore
except Exception:  # pragma: no cover
    aiohttp = None
from eventbus import events as evt
from eventbus.bus import subscribe
from tools.logging_utils import bind_context_logger

BRIDGE_VERSION = 1
BRIDGE_KIND = 'nia.event'  # Must match browser bridge (appMessageBridge.ts)


class AppMessageForwarder:
    def __init__(
        self,
        transport: Any,
        snapshot_provider: Callable[[], dict[str, Any]] | None = None,
        room_url: str | None = None,
    ):
        self.transport = transport
        self.seq = 0
        self._unsubs: list[Callable[[], None]] = []
        self._lock = asyncio.Lock()
        self._snapshot_provider = snapshot_provider
        try:
            loop = asyncio.get_event_loop()
            self._start_ts = loop.time() if loop.is_running() else 0.0
        except Exception:
            self._start_ts = 0.0
        self._warned_missing = False
        self._room_url = room_url or getattr(transport, 'room_url', None) or ''
        self._room_name = self._derive_room_name(self._room_url)
        self._api_key = os.getenv('DAILY_API_KEY') or ''
        self._http_sem = asyncio.Semaphore(4)
        self._warned_http_error = False
        self._log = bind_context_logger(
            room_url=self._room_url,
            tag='[app_message_forwarder]',
        )
        # Select sending mode (html|inproc) via env.
        #  html   -> use Daily REST send-app-message (browser-visible route)
        #  inproc -> direct in-process transport._client.send_message (preferred)
        self._mode = (os.getenv('BOT_EVENT_FORWARDER') or 'html').strip().lower()
        self._tasks: set[asyncio.Task[Any]] = set()
        if self._mode not in ('html', 'inproc'):
            self._log.warning(
                "unknown BOT_EVENT_FORWARDER; defaulting to html",
                mode=self._mode,
            )
            self._mode = 'html'
        try:
            self._log.info(
                "init",
                mode=self._mode,
                room=self._room_name or '?',
                roomUrl=self._room_url or '?',
            )
        except Exception:
            pass

    @staticmethod
    def _derive_room_name(room_url: str) -> str:
        if not room_url:
            return ''
        try:
            tail = room_url.rstrip('/').split('/')[-1]
            tail = tail.split('?')[0]
            return tail
        except Exception:
            return ''

    async def _send(self, envelope: dict[str, Any]):
        if self._mode == 'html':
            if not (self._api_key and self._room_name and aiohttp is not None):
                if not self._warned_missing:
                    self._log.warning(
                        'cannot send app-message (missing DAILY_API_KEY, room name, or aiohttp)'
                    )
                    self._warned_missing = True
                # Even without Daily, try WebSocket delivery
                await self._ws_broadcast(envelope)
                return
            await self._http_post_send(envelope)
        else:
            await self._inproc_send(envelope)
        # Also broadcast to WebSocket clients (for non-Daily frontends)
        await self._ws_broadcast(envelope)

    async def _ws_broadcast(self, envelope: dict[str, Any]):
        """Forward envelope to the gateway WebSocket event channel (best-effort).
        
        Scoped to this forwarder's room name so only clients in the same
        session receive the event.
        """
        try:
            from bot_gateway import ws_broadcast
            await ws_broadcast(envelope, session_id=self._room_name or None)
        except Exception:
            pass  # gateway not co-located or import failed

    async def _inproc_send(self, envelope: dict[str, Any]):
        """Send envelope via in-process Daily transport.

        Preference order:
          1. transport._client.send_app_message (raw envelope)
          2. transport.send_app_message
          3. Frame-based transport._client.send_message fallback
        """
        client = getattr(self.transport, '_client', None)
        # One-time introspection log (debug) for diagnostics
        if not getattr(self, '_logged_inproc_capabilities', False):  # type: ignore[attr-defined]
            caps = []
            if client:
                for name in ('send_app_message', 'send_message'):
                    if hasattr(client, name):
                        caps.append(f'_client.{name}')
            for name in ('send_app_message', 'send_message'):
                if hasattr(self.transport, name):
                    caps.append(f'transport.{name}')
                self._log.debug("inproc capability scan", capabilities=caps or ['<none>'])
            self._logged_inproc_capabilities = True  # type: ignore[attr-defined]

        # Try direct app-message methods first (raw envelope)
        for owner, obj in (("_client", client), ("transport", self.transport)):
            if obj and hasattr(obj, 'send_app_message'):
                try:
                    self._log.debug(
                        "sending inproc app-message",
                        path=f"{owner}.send_app_message",
                        envelope=envelope,
                    )
                    res = obj.send_app_message(envelope, None)  # type: ignore[arg-type]
                    if asyncio.iscoroutine(res):
                        await res
                        self._log.debug(
                            "inproc app-message sent",
                            path=f"{owner}.send_app_message",
                            envelope=envelope,
                        )
                    return
                except Exception as e:
                    self._log.warning(
                        "send_app_message failed; falling back",
                        path=f"{owner}.send_app_message",
                        error=str(e),
                    )
                    break  # fall through to frame path

        # Fallback: frame-based send_message
        if not client or not hasattr(client, 'send_message'):
            if not self._warned_missing:
                self._log.warning(
                    'inproc sender unavailable (no send_app_message or send_message)'
                )
                self._warned_missing = True
            return
        try:
            try:
                from pipecat.transports.daily.transport import (
                    DailyTransportMessageFrame,  # type: ignore
                )

                frame_obj = DailyTransportMessageFrame(message=envelope)
            except Exception:
                from pipecat.frames.frames import TransportMessageFrame  # type: ignore

                frame_obj = TransportMessageFrame(message=envelope)  # type: ignore
                self._log.debug(
                    'sending inproc app-message via frame fallback',
                    envelope=envelope,
                )
            res = client.send_message(frame_obj)  # type: ignore
            if asyncio.iscoroutine(res):
                await res
                self._log.debug(
                    'inproc app-message sent via frame fallback',
                    envelope=envelope,
                )
        except Exception as e:  # pragma: no cover
            if not self._warned_http_error:
                self._log.warning('inproc frame send exception', error=str(e))
                self._warned_http_error = True

    async def _http_post_send(self, envelope: dict[str, Any]):
        if not (self._api_key and self._room_name and aiohttp):
            return
        try:
            raw = json.dumps(envelope)
            if len(raw) > 49000:
                self._log.warning(
                    'envelope size exceeds Daily limit (~50KB)',
                    length=len(raw),
                )
                envelope = {
                    k: (v if k != 'payload' else {'truncated': True}) for k, v in envelope.items()
                }
        except Exception:
            pass
        url = f"https://api.daily.co/v1/rooms/{self._room_name}/send-app-message"
        body = {"data": envelope, "recipient": "*"}
        headers = {
            'Authorization': f'Bearer {self._api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        async with self._http_sem:
            try:
                async with aiohttp.ClientSession() as session:  # type: ignore
                    async with session.post(url, json=body, headers=headers, timeout=10) as resp:
                        if resp.status >= 300:
                            txt = await resp.text()
                            # Suppress 404 warnings when room is not hosting a call (common during startup/shutdown)
                            if resp.status == 404:
                                self._log.debug(
                                    'http app-message send skipped (room inactive)',
                                    status=resp.status,
                                    body=txt[:100],
                                )
                            elif not self._warned_http_error:
                                self._log.warning(
                                    'http app-message send failed',
                                    status=resp.status,
                                    body=txt[:300],
                                )
                                self._warned_http_error = True
                        else:
                            self._log.debug(
                                'http app-message sent',
                                status=resp.status,
                            )
            except Exception as e:  # pragma: no cover
                if not self._warned_http_error:
                    self._log.warning('http send exception', error=str(e))
                    self._warned_http_error = True

    async def _handle(self, topic: str, payload: dict[str, Any]):
        import time

        # Filter out stealth participants from interface events
        if topic in [evt.DAILY_PARTICIPANT_JOIN, evt.DAILY_PARTICIPANT_FIRST_JOIN, evt.DAILY_PARTICIPANT_LEAVE]:
            pid = payload.get('participant')
            pname = payload.get('name')
            pctx = payload.get('context')

            # Import stealth detection function
            try:
                from session.participant_data import is_stealth_participant
                if is_stealth_participant(pid, pname, pctx):
                    self._log.debug(
                        'filtering stealth participant',
                        participantId=pid,
                        participantName=pname,
                    )
                    return  # Don't forward stealth participant events to interface
            except Exception as e:
                # Fallback: simple username pattern check if import fails
                if pname and str(pname).startswith('stealth-user'):
                    self._log.debug(
                        'filtering stealth participant (fallback)',
                        participantId=pid,
                        participantName=pname,
                    )
                    return
                self._log.warning('stealth filtering error', error=str(e))
        try:
            async with self._lock:
                self.seq += 1
                try:
                    ts_val = payload.get('ts')
                except Exception:
                    ts_val = None
                if ts_val is None:
                    ts_val = int(time.time() * 1000)
                env = {
                    'v': BRIDGE_VERSION,
                    'kind': BRIDGE_KIND,
                    'seq': self.seq,
                    'ts': ts_val,
                    'event': topic,
                    'payload': payload,
                }
                try:
                    from eventbus import BOT_SPEAKING_STARTED as _S1  # type: ignore
                    from eventbus import BOT_SPEAKING_STOPPED as _S2
                    if topic in (_S1, _S2):
                        self._log.info(
                            'enqueue speaking event',
                            seq=self.seq,
                            event=topic,
                            payloadKeys=list(payload.keys()),
                        )
                except Exception:
                    pass
            await self._send(env)
        except (asyncio.CancelledError, GeneratorExit):  # graceful cancellation during shutdown
            raise
        except Exception as e:  # pragma: no cover
            self._log.warning('handle error', event=topic, error=str(e))

    async def _emit_snapshot(self, reason: str | None = None):
        if not self._snapshot_provider:
            return
        try:
            snapshot = self._snapshot_provider() or {}
        except Exception as e:  # pragma: no cover
            self._log.warning('snapshot provider error', error=str(e))
            return
        import time

        async with self._lock:
            self.seq += 1
            env = {
                'v': BRIDGE_VERSION,
                'kind': BRIDGE_KIND,
                'seq': self.seq,
                'ts': int(time.time() * 1000),
                'event': 'snapshot',
                'payload': {'data': snapshot, 'reason': reason},
            }
        await self._send(env)

    def handle_incoming(self, message_obj: dict[str, Any]) -> None:
        """Handle incoming messages from interface transport"""
        self._log.debug('handle_incoming', message=message_obj)
        self._track_task(self._handle_incoming_async(message_obj))

    async def _handle_incoming_async(self, message_obj: dict[str, Any]) -> None:
        """Async handler for incoming messages"""
        try:
            kind = message_obj.get("kind")
            if kind == "req":
                action = message_obj.get("req")
                if action == "snapshot":
                    # Handle snapshot request by emitting current state
                    self._log.debug('snapshot request received')
                    reason = message_obj.get("reason", "request")
                    await self._emit_snapshot(reason)
            elif kind == "gap":
                # Handle gap detection by emitting snapshot to help client resync
                self._log.debug('gap detected; emitting snapshot for resync')
                expected = message_obj.get("expected", 0)
                got = message_obj.get("got", 0)
                self._log.info('gap detected', expectedSeq=expected, gotSeq=got)
                await self._emit_snapshot("gap")
        except Exception as e:
            self._log.error('error handling incoming message', error=str(e))
            self._log.exception(e)

    async def _publish_event(self, topic: str, data: dict[str, Any]) -> None:
        """Publish event to internal event bus"""
        try:
            from eventbus.bus import publish
            publish(topic, data)
            self._log.debug('published event', topic=topic, data=data)
        except Exception as e:
            self._log.error('error publishing event', topic=topic, error=str(e))

    async def emit_tool_event(self, topic: str, data: dict[str, Any], target_session_user_id: str | None = None) -> None:
        """Public method for tools to emit events directly to browser interface.
        
        This method sends events directly via the app-message transport, bypassing
        the event bus subscription model. This ensures tool-generated events (like
        window commands) reach the browser immediately.
        
        Args:
            topic: Event topic string (e.g., events.WINDOW_MAXIMIZE)
            data: Event payload dictionary
            target_session_user_id: Optional session user ID to target this event to.
                     If set, only the client with matching sessionUserId will process this event.
                     If None, all clients will process the event (broadcast).
        """
        import time

        # Normalize payload and ensure room_url is present for downstream consumers
        payload: dict[str, Any] = dict(data) if data else {}
        if 'roomUrl' in payload:
            # Standardize to snake_case
            payload.setdefault('room_url', payload.pop('roomUrl'))
        if 'room_url' not in payload and self._room_url:
            payload['room_url'] = self._room_url
        
        # Create envelope and send directly to browser
        async with self._lock:
            self.seq += 1
            env = {
                'v': BRIDGE_VERSION,
                'kind': BRIDGE_KIND,
                'seq': self.seq,
                'ts': int(time.time() * 1000),
                'event': topic,
                'payload': payload,
            }
            # Add targetSessionUserId field if specified
            if target_session_user_id:
                env['targetSessionUserId'] = target_session_user_id
        
        if target_session_user_id:
            self._log.info(
                'emit_tool_event sending to browser',
                topic=topic,
                targetSessionUserId=target_session_user_id,
            )
        else:
            self._log.info('emit_tool_event sending to browser (broadcast)', topic=topic)
        await self._send(env)

    def start(self):
        # Import BOT_TRANSCRIPT from bus module (not in events.py since it's not in shared enum)
        from eventbus.bus import BOT_TRANSCRIPT
        
        topics = [
            evt.DAILY_CALL_STATE,
            evt.DAILY_PARTICIPANT_FIRST_JOIN,
            evt.DAILY_PARTICIPANT_JOIN,
            evt.DAILY_PARTICIPANT_LEAVE,
            evt.DAILY_PARTICIPANTS_CHANGE,
            evt.DAILY_PARTICIPANT_IDENTITY,  # Add identity mapping events
            evt.BOT_CONVO_WRAPUP,
            evt.BOT_SESSION_END,
            evt.BOT_SPEAKING_STARTED,
            evt.BOT_SPEAKING_STOPPED,
            BOT_TRANSCRIPT,  # Real-time bot transcript for chat bubble display
        ]
        for t in topics:
            self._unsubs.append(
                subscribe(t, lambda topic, data, _t=t: self._track_task(self._handle(_t, data)))
            )
        self._log.info('subscribed to topics', topicCount=len(topics))
        try:
            self._log.info(
                'start',
                mode=self._mode,
                http='yes' if (self._api_key and self._room_name) else 'no',
            )
        except Exception:
            pass
        return self.stop

    def start_joined(self):
        return self.start()

    def stop(self):
        for u in self._unsubs:
            try:
                u()
            except Exception:
                pass
        self._unsubs.clear()

    async def shutdown(self):
        """Async friendly shutdown for tests / app teardown."""
        self.stop()
        if not self._tasks:
            return
        pending = list(self._tasks)
        self._tasks.clear()
        for task in pending:
            if not task.done():
                task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    def _track_task(self, coro: Awaitable[Any]) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro)
        self._tasks.add(task)

        def _cleanup(done: asyncio.Task[Any]) -> None:
            self._tasks.discard(done)

        task.add_done_callback(_cleanup)
        return task


__all__ = ["AppMessageForwarder"]
