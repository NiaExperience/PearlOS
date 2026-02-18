from __future__ import annotations

import asyncio
from typing import Any, Callable, Optional

from loguru import logger

from eventbus import publish
from flows import handle_admin_instruction


class AdminEventHandler:
    """Handles admin messages and note context events."""

    def __init__(
        self,
        flow_manager: Any,
        room_url: str,
        set_active_note_id: Optional[Callable[[str, str | None, str | None], None]] = None,
        get_active_note_id: Optional[Callable[[str], str | None]] = None,
    ):
        self.flow_manager = flow_manager
        self.room_url = room_url
        self.set_active_note_id = set_active_note_id
        self.get_active_note_id = get_active_note_id

    async def _process_note_context(self, note_event: dict[str, Any]):
        """Process a note context message to set the active note for this bot session."""
        try:
            logger.info(f'[notes] Processing note context message: {note_event}')
            
            if self.set_active_note_id is None:
                logger.warning('[notes] set_active_note_id callback not provided, skipping note context')
                return

            event_type = note_event.get('type', '')
            if event_type != 'note_context':
                return

            event_room = note_event.get('room_url', '')
            canonical_event_room = note_event.get('canonical_room', '')
            action = note_event.get('action', 'open')
            active_note_id = note_event.get('active_note_id')
            participant_id = note_event.get('participant_id', 'unknown')
            
            if event_room != self.room_url and canonical_event_room != self.room_url:
                logger.warning(
                    f'[notes] REJECTING note context for different room (bot room: {self.room_url}, event room: {event_room})'
                )
                return

            if action == 'close':
                if self.get_active_note_id:
                    try:
                        from bot import get_active_note_owner
                        current_owner = await get_active_note_owner(self.room_url)
                        if current_owner and current_owner != participant_id:
                            logger.warning(
                                f'[notes] Rejecting close request from {participant_id}: only owner {current_owner} can close the note'
                            )
                            return
                    except Exception as e:
                        logger.warning(f'[notes] Unable to check note owner: {e}')
                
                await self.set_active_note_id(self.room_url, None)
                return

            if action == 'open':
                if self.get_active_note_id:
                    current_note = await self.get_active_note_id(self.room_url)
                    if current_note:
                        logger.warning(
                            f'[notes] Rejecting open request: note {current_note} already active. Must close first.'
                        )
                        return

                if not active_note_id:
                    return

                import bot
                tenant_id = bot.get_room_tenant_id(self.room_url)
                forwarder = bot.get_forwarder(self.room_url)
                
                if not tenant_id:
                    logger.error(f'[notes] No tenant ID found for room {self.room_url}')
                    return
                
                try:
                    from tools.sharing.notes import _share_and_activate_note
                    result = await _share_and_activate_note(
                        room_url=self.room_url,
                        note_id=active_note_id,
                        tenant_id=tenant_id,
                        owner_user_id=participant_id,
                        forwarder=forwarder
                    )
                    
                    if result.get("success"):
                        logger.info(f'[notes] Successfully opened and shared note {active_note_id}')
                    else:
                        logger.error(f'[notes] Failed to share/activate note: {result.get("error")}')
                except Exception as e:
                    logger.error(f'[notes] Error sharing and activating note: {e}', exc_info=True)
                
                return

        except Exception as e:
            logger.error(f'[notes] Error processing note context message: {e}')

    async def process_admin_message(self, admin_event: dict[str, Any]):
        """Process an admin message or note context message based on type."""
        try:
            event_type = admin_event.get('type', '')
            if event_type == 'note_context':
                await self._process_note_context(admin_event)
                return

            prompt = admin_event.get('prompt', '').strip()
            sender_id = admin_event.get('senderId', '')
            sender_name = admin_event.get('senderName', 'Admin')
            mode = admin_event.get('mode', 'queued')

            if not prompt:
                return

            logger.info(
                f'[admin-message-poll] Processing admin prompt from {sender_name} ({sender_id}) - Mode: {mode}: {prompt[:100]}...'
            )

            ack_payload = handle_admin_instruction(
                admin_event=admin_event,
                flow_manager=self.flow_manager,
            )

            if ack_payload is None:
                return

            publish('admin.prompt.response', ack_payload)

        except Exception as e:
            logger.error(f'[admin-message-poll] Error processing admin message: {e}')
            try:
                publish(
                    'admin.prompt.response',
                    {
                        'status': 'error',
                        'message': f'Error processing admin prompt: {str(e)}',
                        'senderId': admin_event.get('senderId', ''),
                        'timestamp': admin_event.get('timestamp', 0),
                    },
                )
            except Exception:
                pass

    def on_admin_prompt(self, topic, payload):
        try:
            admin_event = {
                'prompt': (payload.get('prompt') or '').strip(),
                'mode': payload.get('mode', 'queued'),
                'senderId': payload.get('senderId', ''),
                'senderName': payload.get('senderName', 'Admin'),
                'timestamp': payload.get('timestamp', 0),
            }

            if not admin_event['prompt']:
                return

            ack = handle_admin_instruction(
                admin_event=admin_event,
                flow_manager=self.flow_manager,
            )

            if ack is None:
                return

            publish('admin.prompt.response', ack)

        except Exception as exc:
            logger.error('[admin-prompt] Error processing admin prompt: %s', exc)
            error_payload = {
                'status': 'error',
                'message': f'Error processing admin prompt: {exc}',
                'senderId': payload.get('senderId', ''),
                'timestamp': payload.get('timestamp', 0),
            }
            try:
                publish('admin.prompt.response', error_payload)
            except Exception:
                pass

    def on_llm_context_message(self, topic, payload):
        try:
            llm_event = {
                'prompt': (payload.get('content') or '').strip(),
                'mode': payload.get('mode', 'queued'),
                'senderId': payload.get('senderId', ''),
                'senderName': payload.get('senderName', 'System'),
                'timestamp': payload.get('timestamp', 0),
            }

            if not llm_event['prompt']:
                return

            handle_admin_instruction(
                admin_event=llm_event,
                flow_manager=self.flow_manager,
            )

        except Exception as exc:
            logger.error('[llm-context-message] Error processing context message: %s', exc)
