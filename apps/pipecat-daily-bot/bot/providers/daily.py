import os
import time
import aiohttp
from loguru import logger


async def create_or_get_daily_room(room_name: str = "pearl-default") -> dict:
    """Create a persistent Daily room (or return it if it already exists).

    Returns ``{"name": ..., "url": ...}``.
    """
    daily_api_key = os.getenv("DAILY_API_KEY")
    if not daily_api_key:
        raise ValueError("DAILY_API_KEY environment variable is required")

    headers = {"Authorization": f"Bearer {daily_api_key}", "Content-Type": "application/json"}

    async with aiohttp.ClientSession() as session:
        # Check if room already exists
        async with session.get(f"https://api.daily.co/v1/rooms/{room_name}", headers=headers) as resp:
            if resp.status == 200:
                data = await resp.json()
                logger.info(f"[daily] Room already exists: {data.get('url')}")
                return {"name": data["name"], "url": data["url"]}

        # Create it
        body = {
            "name": room_name,
            "privacy": "private",
            "properties": {
                "enable_chat": False,
                "enable_screenshare": True,
                "start_video_off": True,
                "start_audio_off": False,
                "max_participants": 10,
                "enable_mesh_sfu": True,
                "enable_transcription": "deepgram:nova-2-general",
                # No exp = persistent room
            },
        }
        async with session.post("https://api.daily.co/v1/rooms", headers=headers, json=body) as resp:
            if resp.status in (200, 201):
                data = await resp.json()
                logger.info(f"[daily] Created room: {data.get('url')}")
                return {"name": data["name"], "url": data["url"]}
            # Handle "already exists" race
            if resp.status == 400:
                text = await resp.text()
                if "already exists" in text.lower():
                    async with session.get(f"https://api.daily.co/v1/rooms/{room_name}", headers=headers) as r2:
                        data = await r2.json()
                        return {"name": data["name"], "url": data["url"]}
            error = await resp.text()
            raise Exception(f"Failed to create Daily room: {resp.status} - {error}")


async def create_daily_room_token(room_url: str) -> str:
    """Generate a Daily room token for an existing room using DAILY_API_KEY.

    This function generates a token for joining an existing Daily room.
    """
    daily_api_key = os.getenv("DAILY_API_KEY")
    if not daily_api_key:
        raise ValueError("DAILY_API_KEY environment variable is required")

    # Extract room name from URL
    room_name = room_url.split("/")[-1]

    # Generate token for the existing room
    token_url = "https://api.daily.co/v1/meeting-tokens"
    headers = {"Authorization": f"Bearer {daily_api_key}", "Content-Type": "application/json"}

    token_config = {
        "properties": {
            "room_name": room_name,
            "is_owner": True,
            "exp": int(time.time()) + 3600,  # 1 hour expiration
        }
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(token_url, headers=headers, json=token_config) as response:
            if response.status not in (200, 201):
                error_text = await response.text()
                raise Exception(f"Failed to create Daily token: {response.status} - {error_text}")

            token_data = await response.json()
            return token_data["token"]
