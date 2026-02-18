import hashlib

def get_room_hash(room_url: str) -> str:
    """Generate deterministic room hash for consistent file naming across processes.

    Uses SHA256 instead of Python's hash() to ensure server and bot processes
    generate identical hash values for the same room URL.
    """
    return hashlib.sha256(room_url.encode('utf-8')).hexdigest()[:12]
