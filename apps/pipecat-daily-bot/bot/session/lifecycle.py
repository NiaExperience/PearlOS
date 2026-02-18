from __future__ import annotations

import asyncio
import os
from typing import Any

from loguru import logger

from core.config import (
    BOT_PID,
    BOT_EMPTY_INITIAL_SECS,
    BOT_EMPTY_POST_LEAVE_SECS,
    BOT_VOICE_ONLY,
)
from session.participants import ParticipantManager
from session.participant_data import extract_user_metadata
from actions import profile_actions

async def generate_conversation_summary(messages: list[dict[str, Any]]) -> str | None:
    """Generate a concise summary of conversation messages using Groq (Llama) or fallback."""
    try:
        from openai import AsyncOpenAI
        
        # Filter to user and assistant messages only
        conversation_messages = [
            msg for msg in messages
            if msg.get("role") in ("user", "assistant") and msg.get("content")
        ]
        
        if not conversation_messages:
            logger.info(f"[{BOT_PID}] No conversation messages to summarize")
            return None
        
        # Prefer Groq (no OpenAI dependency), fall back to OpenAI if no Groq key
        groq_key = os.getenv("GROQ_API_KEY")
        if groq_key:
            client = AsyncOpenAI(
                api_key=groq_key,
                base_url="https://api.groq.com/openai/v1",
            )
            model = "meta-llama/llama-4-scout-17b-16e-instruct"
        else:
            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            model = "gpt-4o-mini"
        
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Summarize the following conversation concisely."},
                {"role": "user", "content": json.dumps(conversation_messages)}
            ]
        )
        return response.choices[0].message.content
        
    except Exception as e:
        logger.error(f"[{BOT_PID}] Failed to generate summary: {e}")
        return None

import json
import os
import redis.asyncio as redis

class SessionLifecycle:
    def __init__(
        self,
        participant_manager: ParticipantManager,
        task: asyncio.Task,
        room_url: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        user_name: str | None = None,
        headless: bool = False,
    ):
        self.participant_manager = participant_manager
        self.task = task
        self.room_url = room_url  # Store for immediate Redis state clearing
        self.headless = headless
        self.shutdown_task: asyncio.Task | None = None
        self.log = logger.bind(
            tag="[lifecycle]",
            botPid=BOT_PID,
            roomUrl=room_url,
            sessionId=session_id,
            userId=user_id,
            userName=user_name,
        )
        
        # Headless/persistent sessions never idle-shutdown
        # BOT_HEADLESS_SESSION env var is set by the gateway for auto-created rooms
        if headless or os.getenv("BOT_HEADLESS_SESSION", "").lower() == "true":
            self.initial_idle_secs = float("inf")
            self.headless = True
        else:
            self.initial_idle_secs = float(BOT_EMPTY_INITIAL_SECS())
        
        if self.headless:
            self.post_leave_idle_secs = float("inf")
        elif BOT_VOICE_ONLY():
            self.post_leave_idle_secs = 0.1
        else:
            self.post_leave_idle_secs = float(BOT_EMPTY_POST_LEAVE_SECS())
        
        self.log.info(
            f"[{BOT_PID}] Empty-room shutdown: initial_idle={self.initial_idle_secs}s "
            f"post_leave_idle={self.post_leave_idle_secs}s (voice_only={BOT_VOICE_ONLY()})"
        )

    def cancel_pending_shutdown(self):
        if self.shutdown_task and not self.shutdown_task.done():
            try:
                self.log.info(
                    f"[{BOT_PID}] [participants] cancel_pending_shutdown count={self.participant_manager.human_count()}"
                )
            except Exception:
                pass
            self.shutdown_task.cancel()
            self.shutdown_task = None

    async def _clear_room_redis_state(self) -> None:
        """Clear Redis active/keepalive keys for this room immediately.
        
        This prevents race conditions where a new session tries to start 
        while the old bot is still in shutdown delay but marked as 'active'.
        """
        if not self.room_url:
            return
        
        use_redis = os.getenv("USE_REDIS", "true").lower() == "true"
        if not use_redis:
            return
            
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        password = os.getenv("REDIS_SHARED_SECRET") if os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true" else None
        
        try:
            client = redis.from_url(redis_url, password=password, decode_responses=True)
            await client.delete(f"room_active:{self.room_url}")
            await client.delete(f"room_keepalive:{self.room_url}")
            self.log.info(f"[{BOT_PID}] [lifecycle] Cleared room Redis state immediately on shutdown schedule")
            await client.aclose()
        except Exception as e:
            self.log.error(f"[{BOT_PID}] [lifecycle] Failed to clear room Redis state: {e}")

    async def perform_shutdown(self, origin: str):
        total_count = self.participant_manager.human_count() + self.participant_manager.stealth_count()
        if total_count == 0:
            self.log.info(
                f"[{BOT_PID}] [empty-room] No participants (origin={origin}, count={total_count}) -> cancelling bot task"
            )
            try:
                await self.task.cancel()
            except Exception as e:
                self.log.error(f"[{BOT_PID}] Error cancelling task: {e}")

    def schedule_shutdown(self, delay: float, origin: str):
        self.cancel_pending_shutdown()

        async def waiter():
            try:
                # Clear Redis state IMMEDIATELY when shutdown is scheduled
                # This prevents race conditions where new sessions see "existing bot"
                # while old bot is still in shutdown delay
                await self._clear_room_redis_state()
                
                await asyncio.sleep(delay)
                await self.perform_shutdown(origin)
            except asyncio.CancelledError:
                return

        try:
            self.log.info(
                f"[{BOT_PID}] [participants] schedule_shutdown delay={delay} origin={origin} count={self.participant_manager.human_count()}"
            )
        except Exception:
            pass
        self.shutdown_task = asyncio.create_task(waiter())

    async def save_conversation_summary(
        self,
        context_agg: Any,
        transport: Any,
        room_url: str,
        personality_record: dict[str, Any] | None,
        persona: str,
        session_id: str | None = None,
    ):
        try:
            if context_agg and transport:
                # Get messages from multi_user_aggregator
                multi_user_agg = getattr(context_agg, "_multi_user_agg", None)
                if multi_user_agg and hasattr(multi_user_agg, "snapshot_messages"):
                    messages = multi_user_agg.snapshot_messages()
                    
                    if messages and len(messages) > 1:  # At least 2 messages (system + user/assistant)
                        # HYBRID APPROACH: Write raw excerpts immediately before LLM summary
                        # This ensures we capture conversation data even if summarization fails
                        try:
                            from datetime import datetime, timezone
                            workspace_root = os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")
                            memory_dir = os.path.join(workspace_root, "memory")
                            os.makedirs(memory_dir, exist_ok=True)
                            now = datetime.now(timezone.utc)
                            
                            conv_msgs = [m for m in messages if m.get("role") in ("user", "assistant") and m.get("content")]
                            if conv_msgs:
                                # Write raw activity-log entry with topic hint from first user message
                                first_user = next((m["content"][:100] for m in conv_msgs if m["role"] == "user"), "voice session")
                                raw_entry = f"[{now.strftime('%Y-%m-%d %H:%M')}] [voice] — Voice session ({len(conv_msgs)} messages). Started with: {first_user}\n"
                                
                                raw_log_path = os.path.join(memory_dir, "activity-log.md")
                                with open(raw_log_path, 'a', encoding='utf-8') as f:
                                    f.write(raw_entry)
                                logger.info(f"[{BOT_PID}] ✅ Wrote raw voice session entry to activity log (pre-summary)")
                        except Exception as raw_err:
                            logger.warning(f"[{BOT_PID}] Failed to write raw activity entry: {raw_err}")
                        
                        logger.info(f"[{BOT_PID}] Generating conversation summary ({len(messages)} messages)...")
                        
                        # Generate summary using LLM (once for all participants)
                        summary_text = await generate_conversation_summary(messages)
                        
                        if summary_text:
                            # Extract session info
                            canonical_session_id = session_id or os.getenv('BOT_SESSION_ID')
                            if not canonical_session_id:
                                logger.warning(f"[{BOT_PID}] Missing session_id for summary; falling back to room slug")
                                canonical_session_id = room_url.split('/')[-1] if room_url else "unknown"
                            assistant_name = personality_record.get("name") if personality_record else persona
                            duration_seconds = 0  # TODO: Track actual session start/end times
                            
                            # Get all participants and their user IDs
                            try:
                                from core.transport import get_participants_from_transport
                                participants_data = get_participants_from_transport(transport)
                                if not isinstance(participants_data, dict):
                                    participants_data = {}
                                
                                participant_count = len(participants_data)
                                user_ids_to_update = []
                                
                                # Extract sessionUserId from each participant's userData
                                for participant_id, participant_info in participants_data.items():
                                    try:
                                        # Extract user metadata using the same logic as elsewhere in the bot
                                        # We need to import extract_user_metadata or pass it
                                        # It is imported at top
                                        user_metadata = extract_user_metadata(participant_info)
                                        if user_metadata and user_metadata.get('sessionUserId'):
                                            session_user_id = user_metadata['sessionUserId']
                                            if session_user_id not in user_ids_to_update:
                                                user_ids_to_update.append(session_user_id)
                                                logger.debug(
                                                    f"[{BOT_PID}] Found participant {participant_id} -> user {session_user_id}"
                                                )
                                    except Exception as e:
                                        logger.debug(f"[{BOT_PID}] Could not extract user ID for participant {participant_id}: {e}")
                                
                                # Fallback: if no users found in participants, use BOT_SESSION_USER_ID
                                if not user_ids_to_update:
                                    fallback_user_id = os.getenv('BOT_SESSION_USER_ID')
                                    if fallback_user_id:
                                        user_ids_to_update.append(fallback_user_id)
                                        logger.info(
                                            f"[{BOT_PID}] No participants with userData found, using fallback user: {fallback_user_id}"
                                        )
                                
                                # Save summary to each participant's UserProfile
                                if user_ids_to_update:
                                    logger.info(
                                        f"[{BOT_PID}] Saving conversation summary to {len(user_ids_to_update)} user profile(s)"
                                    )
                                    
                                    saved_count = 0
                                    for user_id in user_ids_to_update:
                                        try:
                                            success = await profile_actions.save_conversation_summary(
                                                user_id=user_id,
                                                summary=summary_text,
                                                session_id=canonical_session_id,
                                                room_id=room_url.split('/')[-1],
                                                assistant_name=assistant_name,
                                                participant_count=participant_count,
                                                duration_seconds=duration_seconds
                                            )
                                            
                                            if success:
                                                saved_count += 1
                                                logger.debug(f"[{BOT_PID}] ✅ Saved summary for user {user_id}")
                                            else:
                                                logger.warning(f"[{BOT_PID}] ⚠️ Failed to save summary for user {user_id}")
                                        except Exception as e:
                                            logger.error(
                                                f"[{BOT_PID}] Error saving summary for user {user_id}: {e}",
                                                exc_info=True
                                            )
                                    
                                    logger.info(
                                        f"[{BOT_PID}] ✅ Saved conversation summary to {saved_count}/{len(user_ids_to_update)} user profiles"
                                    )
                                else:
                                    logger.warning(f"[{BOT_PID}] No user IDs found to save conversation summary")
                                    
                            except Exception as e:
                                logger.error(f"[{BOT_PID}] Error extracting participant user IDs: {e}", exc_info=True)
                            
                            # Write detailed daily memory file with summary + excerpts
                            try:
                                from datetime import datetime, timezone
                                workspace_root = os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")
                                memory_dir = os.path.join(workspace_root, "memory")
                                os.makedirs(memory_dir, exist_ok=True)
                                
                                now = datetime.now(timezone.utc)
                                date_str = now.strftime("%Y-%m-%d")
                                time_str = now.strftime("%H:%M")
                                
                                daily_path = os.path.join(memory_dir, f"{date_str}.md")
                                
                                conv_messages = [
                                    msg for msg in messages
                                    if msg.get("role") in ("user", "assistant") and msg.get("content")
                                ]
                                
                                daily_entry_lines = [f"\n## Voice Session ({time_str} UTC)\n"]
                                daily_entry_lines.append(f"**Summary:** {summary_text}\n")
                                
                                if conv_messages:
                                    recent = conv_messages[-20:]
                                    daily_entry_lines.append("\n**Conversation excerpts:**\n")
                                    for msg in recent:
                                        role = msg["role"].capitalize()
                                        content = str(msg.get("content", ""))
                                        if len(content) > 300:
                                            content = content[:297] + "..."
                                        daily_entry_lines.append(f"- **{role}:** {content}\n")
                                
                                with open(daily_path, 'a', encoding='utf-8') as f:
                                    f.writelines(daily_entry_lines)
                                
                                logger.info(f"[{BOT_PID}] ✅ Wrote voice session details to {date_str}.md")
                                
                            except Exception as log_err:
                                logger.error(f"[{BOT_PID}] Failed to write daily memory file: {log_err}")
                        else:
                            logger.warning(f"[{BOT_PID}] Could not generate conversation summary")
                    else:
                        logger.info(f"[{BOT_PID}] No meaningful conversation to summarize")
                else:
                    logger.debug(f"[{BOT_PID}] multi_user_aggregator not available for summary")
            else:
                if not context_agg:
                    logger.debug(f"[{BOT_PID}] No context_agg available for conversation summary")
                if not transport:
                    logger.debug(f"[{BOT_PID}] No transport available for conversation summary")
        except Exception as e:
            logger.error(f"[{BOT_PID}] Error generating/saving conversation summary: {e}", exc_info=True)
