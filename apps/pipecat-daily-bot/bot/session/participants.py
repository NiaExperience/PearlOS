import asyncio
from typing import Any, Set, Optional, Dict

from tools.logging_utils import bind_context_logger
from core.config import BOT_PID

log = bind_context_logger(tag="[participants]").bind(botPid=BOT_PID)

class ParticipantManager:
    """Manages participant tracking and metadata lookup."""

    def __init__(self):
        self.active_participants: Set[str] = set()
        self.stealth_participants: Set[str] = set()
        self.active_participants_lock = asyncio.Lock()
        self.local_bot_id: Optional[str] = None
        self._transport = None

    def set_transport(self, transport):
        """Set the transport instance for metadata lookup."""
        self._transport = transport

    def get_active_participants(self) -> Set[str]:
        """Get a copy of active participant IDs."""
        return self.active_participants.copy()

    async def add_participant(self, pid: str):
        """Add a participant to the active set."""
        async with self.active_participants_lock:
            self.active_participants.add(pid)
            if pid == "local" and not self.local_bot_id:
                self.local_bot_id = pid
                log.info("detected local bot id=%s" % self.local_bot_id)

    async def remove_participant(self, pid: str):
        """Remove a participant from the active set."""
        async with self.active_participants_lock:
            self.active_participants.discard(pid)
            self.stealth_participants.discard(pid)

    def human_count(self) -> int:
        """Count active human participants (excluding bot)."""
        count = len(self.active_participants)
        if self.local_bot_id and self.local_bot_id in self.active_participants:
            count -= 1
        return count

    def stealth_count(self) -> int:
        """Count stealth participants."""
        return len(self.stealth_participants)

    async def add_stealth_participant(self, pid: str):
        """Add a participant to the stealth set."""
        async with self.active_participants_lock:
            self.stealth_participants.add(pid)

    def lookup_participant_meta(self, pid: str) -> Dict[str, Any] | None:
        """Fetch participant metadata by ID from the transport if available."""
        if not self._transport:
            return None
            
        try:
            from core.transport import get_participants_from_transport
            participants = get_participants_from_transport(self._transport)
            if isinstance(participants, dict) and pid in participants and isinstance(participants[pid], dict):
                return participants[pid]
        except Exception:
            pass
            
        return None

    # Static utilities for scrubbing
    SENSITIVE_KEYS = (
        'token', 'secret', 'password', 'auth', 'authorization', 
        'jwt', 'bearer', 'apikey', 'api_key'
    )

    @staticmethod
    def _mask_email(s: str) -> str:
        try:
            if '@' in s:
                local, domain = s.split('@', 1)
                if not local:
                    return s
                head = local[0]
                return head + '***@' + domain
        except Exception:
            pass
        return s

    @classmethod
    def scrub_value(cls, k: str | None, v: Any, depth: int = 2) -> Any:
        try:
            if depth < 0:
                return str(type(v).__name__)
            if isinstance(v, dict):
                out: Dict[str, Any] = {}
                for kk, vv in v.items():
                    if any(sk in str(kk).lower() for sk in cls.SENSITIVE_KEYS):
                        out[str(kk)] = '[redacted]'
                    else:
                        out[str(kk)] = cls.scrub_value(str(kk), vv, depth - 1)
                return out
            if isinstance(v, (list, tuple, set)):
                arr = list(v)
                return [cls.scrub_value(k, x, depth - 1) for x in arr[:50]]
            if isinstance(v, str):
                vv = v
                if k and any(sk in k.lower() for sk in cls.SENSITIVE_KEYS):
                    return '[redacted]'
                if '@' in vv:
                    return cls._mask_email(vv)
                if len(vv) > 500:
                    return vv[:500] + '…'
                return vv
            return v
        except Exception:
            return str(v)
