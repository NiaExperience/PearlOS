import asyncio
import os
from typing import Any, Dict

from loguru import logger

from core.config import BOT_PID
from eventbus import emit_participant_join, events as _eb_events
from eventbus.bus import subscribe as _eb_subscribe
from services.redis import get_redis_client
from session.participant_data import derive_name_and_context_enhanced

log = logger.bind(tag="[identity]", botPid=BOT_PID)

class IdentityManager:
    """Manages identity reconciliation and cross-process identity sharing."""

    def __init__(self, room_url: str, participant_manager):
        self.room_url = room_url
        self.participant_manager = participant_manager
        self.participant_identity_map: Dict[str, Dict[str, str]] = {}
        self.session_identity_map: Dict[str, Dict[str, str]] = {}
        self.pending_identity: Dict[str, str] = {}
        self._unsub_identity = None
        self._unsub_participants_change = None

    def start(self):
        """Initialize identity manager and subscriptions."""
        self._seed_pending_identity()
        self._subscribe_events()

    def stop(self):
        """Cleanup subscriptions."""
        if self._unsub_identity:
            self._unsub_identity()
            self._unsub_identity = None
        if self._unsub_participants_change:
            self._unsub_participants_change()
            self._unsub_participants_change = None

    def _seed_pending_identity(self):
        """Seed pending identity from environment variables."""
        try:
            eid = os.getenv("BOT_SESSION_USER_ID")
            ename = os.getenv("BOT_SESSION_USER_NAME")
            eemail = os.getenv("BOT_SESSION_USER_EMAIL")
            tmp: Dict[str, str] = {}
            if isinstance(eid, str) and eid.strip():
                tmp["sessionUserId"] = eid.strip()
            if isinstance(ename, str) and ename.strip():
                tmp["sessionUserName"] = ename.strip()
            if isinstance(eemail, str) and eemail.strip():
                tmp["sessionUserEmail"] = eemail.strip()
            if tmp:
                self.pending_identity.update(tmp)
                log.info(
                    "[identity.env] seeded pending identity has_id=%s"
                    % ("1" if "sessionUserId" in tmp else "0",)
                )
        except Exception:
            pass

    def _subscribe_events(self):
        """Subscribe to identity-related events."""
        try:
            self._unsub_identity = _eb_subscribe(
                _eb_events.DAILY_PARTICIPANT_IDENTITY, self._on_identity_event
            )
            self._unsub_participants_change = _eb_subscribe(
                _eb_events.DAILY_PARTICIPANTS_CHANGE, self._on_participants_change
            )
        except Exception as e:
            log.warning("[identity] Failed to subscribe to events: %s" % e)

    def _on_identity_event(self, _topic: str, data: Dict[str, Any]):
        """Handle identity events from the event bus."""
        try:
            if not isinstance(data, dict):
                return
            room = data.get("room")
            if room and room != self.room_url:
                return
            pid = data.get("participant")
            sid = data.get("sessionUserId")
            sname = data.get("sessionUserName")
            semail = data.get("sessionUserEmail")
            mapped: Dict[str, str] = {}
            if isinstance(sid, str) and sid.strip():
                mapped["sessionUserId"] = sid.strip()
            if isinstance(sname, str) and sname.strip():
                mapped["sessionUserName"] = sname.strip()
            if isinstance(semail, str) and semail.strip():
                mapped["sessionUserEmail"] = semail.strip()
            if not mapped:
                return
            if isinstance(pid, str) and pid and pid != "unknown":
                self.participant_identity_map[pid] = mapped
                log.info("[identity.bus] received mapping pid=%s" % pid)
            else:
                self.pending_identity.update(mapped)
                log.info("[identity.bus] cached pending identity (no pid yet)")
        except Exception:
            pass

    def _on_participants_change(self, topic: str, data: dict) -> None:
        """Handle participants change events to re-scan identities."""
        asyncio.create_task(self._process_participants_change(data))

    async def _process_participants_change(self, data: dict) -> None:
        try:
            room = data.get("room", "")
            participants = data.get("participants", [])
            if room != self.room_url:
                return

            log.debug(
                "[participants.change] Re-scanning identities for %s participants"
                % len(participants)
            )

            active_participants = self.participant_manager.get_active_participants()
            for participant_id in participants:
                if participant_id in active_participants:
                    existing_meta = self.participant_manager.lookup_participant_meta(
                        participant_id
                    )

                    if (
                        existing_meta
                        and existing_meta.get("profile_data")
                        and isinstance(existing_meta.get("profile_data"), dict)
                        and existing_meta["profile_data"].get("user_profile")
                    ):
                        continue

                    user_identity = await self.scan_identity(participant_id)
                    if user_identity:
                        self._apply_identity(participant_id, user_identity, existing_meta)

        except Exception as e:
            log.warning("[participants.change] Error re-scanning identities: %s" % e)

    async def scan_identity(self, participant_id: str) -> Dict | None:
        """Scan identity storage (Redis) for cross-process identity sharing."""
        try:
            client = await get_redis_client()
            identity_data = await client.read_identity(self.room_url, participant_id)
            if identity_data:
                log.info(
                    "[redis-identity] Found identity for participant %s" % participant_id
                )
                return identity_data
        except Exception as e:
            log.warning(
                "[redis-identity] Failed to scan Redis identity for %s: %s"
                % (participant_id, e)
            )
        return None

    async def resolve_identity(
        self, pid: str, participant_data: Dict[str, Any]
    ) -> Dict[str, str] | None:
        """Resolve identity for a participant using multiple strategies."""
        info = participant_data.get("info", {})
        user_data = info.get("userData", {}) if isinstance(info, dict) else {}
        mapped: Dict[str, str] | None = None

        if isinstance(user_data, dict) and user_data.get("sessionUserId"):
            mapped = {
                "sessionUserId": user_data.get("sessionUserId"),
                "sessionUserName": user_data.get("sessionUserName"),
                "sessionUserEmail": user_data.get("sessionUserEmail"),
            }
            mapped = {k: v for k, v in mapped.items() if v}
            if mapped:
                log.info("[identity] Extracted from userData for pid=%s" % pid)

        if not mapped and isinstance(info, dict) and info.get("userId"):
            uid = info.get("userId")
            if isinstance(uid, str) and uid.strip():
                mapped = {
                    "sessionUserId": uid.strip(),
                    "sessionUserName": info.get("userName"),
                }
                log.info(
                    "[identity] Extracted sessionUserId from info.userId for pid=%s"
                    % pid
                )

        if not mapped:
            mapped = self.participant_identity_map.get(pid)
            if mapped:
                log.info("[identity] Using cached mapping for pid=%s" % pid)

        if not mapped and isinstance(user_data, dict):
            session_user_id = user_data.get("sessionUserId")
            if isinstance(session_user_id, str) and session_user_id.strip():
                mapped = self.session_identity_map.get(session_user_id.strip())
                if mapped:
                    log.info(
                        "[identity] matched pid=%s via sessionUserId=%s"
                        % (pid, session_user_id)
                    )

        if not mapped and self.pending_identity:
            mapped = self.pending_identity.copy()
            log.info("[identity] Using room-scoped pending identity for pid=%s" % pid)

        if not mapped:
            mapped = await self.scan_identity(pid)
            if mapped:
                log.info("[identity] matched pid=%s via Redis" % pid)

        if mapped:
            self.participant_identity_map[pid] = mapped

        return mapped

    def _apply_identity(
        self, participant_id: str, identity: Dict, existing_meta: Dict | None
    ):
        """Apply identity data to a participant and emit update."""
        session_user_id = identity.get("sessionUserId")
        if session_user_id:
            self.session_identity_map[session_user_id] = identity
            log.info(
                "[identity] Mapped session user %s to participant %s"
                % (session_user_id, participant_id)
            )

        participant_name = None
        if existing_meta:
            participant_name = existing_meta.get("info", {}).get("userName")

        async def _process_reconcile_async(pid, pmeta, fidentity, suid, pname, room):
            try:
                if pmeta and fidentity:
                    info = pmeta.get("info")
                    if not isinstance(info, dict):
                        info = {}
                        pmeta["info"] = info
                    user_data = info.get("userData")
                    if not isinstance(user_data, dict):
                        user_data = {}
                        info["userData"] = user_data
                    for k in ("sessionUserId", "sessionUserName", "sessionUserEmail"):
                        v = fidentity.get(k)
                        if isinstance(v, str) and v.strip():
                            user_data[k] = v.strip()

                result = await derive_name_and_context_enhanced(
                    pid, pmeta, self.participant_manager.lookup_participant_meta
                )
                if result:
                    display_name, profile_context = result
                    enhanced_context = {
                        "profile_data": (
                            profile_context.get("user_profile") if profile_context else None
                        ),
                        "has_user_profile": (
                            profile_context.get("has_user_profile", False)
                            if profile_context
                            else False
                        ),
                        "session_metadata": {
                            "session_user_id": suid,
                            "session_user_name": fidentity.get("sessionUserName"),
                            "session_user_email": fidentity.get("sessionUserEmail"),
                        },
                    }

                    log.info(
                        "[identity] Re-emitting participant join for %s with profile data"
                        % pid
                    )
                    emit_participant_join(
                        room, pid, pname or display_name, enhanced_context
                    )
            except Exception as e:
                log.warning(
                    "[identity] Error processing async identity for %s: %s"
                    % (pid, e)
                )

        asyncio.create_task(
            _process_reconcile_async(
                pid=participant_id,
                pmeta=existing_meta,
                fidentity=identity,
                suid=session_user_id,
                pname=participant_name,
                room=self.room_url,
            )
        )
