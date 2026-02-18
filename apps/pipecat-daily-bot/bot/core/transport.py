from typing import Any, Optional
from loguru import logger
from .config import BOT_PID

# Global transport reference
_transport: Any = None
_managers: Any = None

def get_transport() -> Any | None:
    return _transport

def set_transport(transport: Any) -> None:
    global _transport
    _transport = transport

def get_managers() -> Any | None:
    return _managers

def set_managers(managers: Any) -> None:
    global _managers
    _managers = managers

def get_participants_from_transport(transport: Any = None) -> dict:
    """Safely get participants from transport, handling different method names."""
    if transport is None:
        transport = get_transport()
    
    if not transport:
        return {}

    # Try standard Pipecat/Daily method
    if hasattr(transport, 'participants') and callable(transport.participants):
        try:
            return transport.participants()
        except Exception:
            pass
            
    # Try legacy/custom method
    if hasattr(transport, 'get_participants') and callable(transport.get_participants):
        try:
            return transport.get_participants()
        except Exception:
            pass
            
    return {}

def get_session_user_id_from_participant(participant_id: str) -> str | None:
    """Get the sessionUserId for a participant using their metadata.
    
    Args:
        participant_id: The Daily participant ID
    
    Returns:
        The sessionUserId if found, None otherwise
    """
    try:
        transport = get_transport()
        if not transport:
            logger.warning(f"[{BOT_PID}] [notes] No transport available to lookup participant {participant_id}")
            return None
        
        # Get participant metadata from transport
        participant_meta = None
        participants = get_participants_from_transport(transport)
        if isinstance(participants, dict) and participant_id in participants:
            participant_meta = participants[participant_id]
        
        if not participant_meta:
            logger.warning(f"[{BOT_PID}] [notes] No metadata found for participant {participant_id}")
            return None
        
        # Debug logging to inspect structure
        logger.info(f"[{BOT_PID}] [transport] Inspecting participant_meta keys: {list(participant_meta.keys())}")
        
        # Helper to normalize user_data (handle stringified JSON)
        def normalize(ud: Any) -> dict | None:
            if isinstance(ud, dict):
                return ud
            if isinstance(ud, str):
                try:
                    parsed = json.loads(ud)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    pass
            return None

        # 1. Try info.userData (standard Daily)
        info = participant_meta.get('info')
        if isinstance(info, dict):
            user_data = normalize(info.get('userData'))
            if user_data:
                uid = user_data.get('sessionUserId')
                if uid:
                    logger.info(f"[{BOT_PID}] [notes] Found sessionUserId={uid} in info.userData for participant {participant_id}")
                    return uid
        
        # 2. Try top-level userData (some clients)
        user_data = normalize(participant_meta.get('userData'))
        if user_data:
            uid = user_data.get('sessionUserId')
            if uid:
                logger.info(f"[{BOT_PID}] [notes] Found sessionUserId={uid} in top-level userData for participant {participant_id}")
                return uid

        # 3. Try IdentityManager (resolved identities)
        try:
            managers = get_managers()
            if managers and hasattr(managers, 'identity_manager'):
                mapped = managers.identity_manager.participant_identity_map.get(participant_id)
                if mapped and isinstance(mapped, dict):
                    uid = mapped.get('sessionUserId')
                    if uid:
                        logger.info(f"[{BOT_PID}] [notes] Found sessionUserId={uid} in IdentityManager for participant {participant_id}")
                        return uid
        except Exception as e:
            logger.warning(f"[{BOT_PID}] [notes] Error checking IdentityManager: {e}")

        logger.warning(f"[{BOT_PID}] [notes] No sessionUserId found in metadata for participant {participant_id}")
        return None
    except Exception as e:
        logger.error(f"[{BOT_PID}] [notes] Error getting sessionUserId for participant {participant_id}: {e}")
        return None
