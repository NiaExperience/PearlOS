import os
import json
import time
import uuid
import hashlib
import asyncio
import redis
import aiohttp

# Load .env so gateway picks up DEFAULT_TENANT_ID, BOT_TTS_PROVIDER, etc.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
except ImportError:
    pass

from fastapi import FastAPI, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
from loguru import logger

from tools.logging_utils import bind_context_logger

from auth import require_auth

try:
    from room.state import (
        get_active_note_id,
        get_active_note_owner,
        get_active_applet_id,
        get_active_applet_owner,
        set_active_note_id,
        set_active_applet_id,
    )
except ImportError:
    logger.warning("Unable to import room state functions in gateway")
    async def get_active_note_id(room_url: str): return None
    async def get_active_note_owner(room_url: str): return None
    async def get_active_applet_id(room_url: str): return None
    async def get_active_applet_owner(room_url: str): return None
    async def set_active_note_id(room_url: str, note_id: str | None, owner: str | None = None): return None
    async def set_active_applet_id(room_url: str, applet_id: str | None, owner: str | None = None): return None


# ---------------------------------------------------------------------------
# Persistent default room — created/reused on startup so the bot is always
# available without the frontend needing to create a room first.
# ---------------------------------------------------------------------------
_default_room_url: str | None = None
_default_room_token: str | None = None

DAILY_API_KEY = os.getenv("DAILY_API_KEY", "")
DAILY_DOMAIN = os.getenv("DAILY_DOMAIN", "pearlos")  # e.g. "pearlos" → pearlos.daily.co
DEFAULT_ROOM_NAME = os.getenv("DEFAULT_ROOM_NAME", "pearl-default")


async def _ensure_persistent_room() -> str:
    """Create or reuse a persistent Daily room named DEFAULT_ROOM_NAME.

    Returns the full room URL (e.g. https://pearlos.daily.co/pearl-default).
    """
    if not DAILY_API_KEY:
        raise RuntimeError("DAILY_API_KEY is required for auto-room creation")

    room_url = f"https://{DAILY_DOMAIN}.daily.co/{DEFAULT_ROOM_NAME}"
    headers = {
        "Authorization": f"Bearer {DAILY_API_KEY}",
        "Content-Type": "application/json",
    }

    async with aiohttp.ClientSession() as session:
        # Check if the room already exists
        async with session.get(
            f"https://api.daily.co/v1/rooms/{DEFAULT_ROOM_NAME}",
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status == 200:
                logger.info(f"[auto-room] Persistent room already exists: {room_url}")
                return room_url

        # Create the room with no expiration (persistent)
        create_body = {
            "name": DEFAULT_ROOM_NAME,
            "privacy": "public",
            "properties": {
                "exp": None,                # never expires
                "enable_chat": True,
                "enable_screenshare": True,
                "start_video_off": True,
                "start_audio_off": True,
                "enable_transcription": "deepgram:nova-2-general",
            },
        }
        async with session.post(
            "https://api.daily.co/v1/rooms",
            headers=headers,
            json=create_body,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status in (200, 201):
                data = await resp.json()
                logger.info(f"[auto-room] Created persistent room: {data.get('url', room_url)}")
                return data.get("url", room_url)
            else:
                txt = await resp.text()
                raise RuntimeError(f"Failed to create Daily room: {resp.status} {txt}")


async def _auto_join_default_room():
    """Ensure persistent room exists, generate a token, and launch the bot."""
    global _default_room_url, _default_room_token

    try:
        _default_room_url = await _ensure_persistent_room()
        logger.info(f"[auto-room] Default room URL: {_default_room_url}")

        # Generate a bot token for the room
        from providers.daily import create_daily_room_token
        _default_room_token = await create_daily_room_token(_default_room_url)

        # Launch the bot session into the default room (direct mode)
        from runner_main import _launch_session
        body = {
            "voiceOnly": True,
            "headless": True,
            "sessionUserId": "system",
            "sessionUserName": "PearlOS",
        }
        info = await _launch_session(
            room_url=_default_room_url,
            token=_default_room_token,
            personalityId=os.getenv("BOT_PERSONALITY", "pearl").lower(),
            persona=os.getenv("BOT_PERSONA", "Pearl"),
            body=body,
        )

        # Track in active_rooms so /join and /emit-event can find it
        async with active_rooms_lock:
            active_rooms[_default_room_url] = {
                "status": "running",
                "session_id": info.id,
                "timestamp": time.time(),
                "personalityId": info.personality,
                "persona": info.persona,
                "auto_created": True,
            }

        logger.info(f"[auto-room] Bot auto-joined default room: session_id={info.id}")
    except Exception as e:
        logger.error(f"[auto-room] Failed to auto-join default room: {e}", exc_info=True)
        # Non-fatal — gateway still works, just without auto-room


from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    # Startup: auto-create persistent room and join bot
    auto_room_enabled = os.getenv("AUTO_ROOM_ENABLED", "true").lower() != "false"
    if auto_room_enabled and DAILY_API_KEY:
        # Small delay to let runner_main modules initialize
        await asyncio.sleep(1)
        await _auto_join_default_room()
    else:
        logger.info("[auto-room] Auto-room disabled (AUTO_ROOM_ENABLED=false or no DAILY_API_KEY)")
    yield
    # Shutdown: nothing special needed


app = FastAPI(lifespan=lifespan)

# ---------------------------------------------------------------------------
# Mount REST API routers (work without Daily rooms)
# ---------------------------------------------------------------------------
try:
    from api.notes_api import router as notes_router
    app.include_router(notes_router, prefix="/api/notes")
    logger.info("[gateway] Mounted /api/notes REST router")
except Exception as e:
    logger.warning(f"[gateway] Failed to mount notes API: {e}")

# CORS (development convenience). In production restrict origins via env.
ALLOWED_ORIGINS = os.getenv('BOT_CORS_ORIGINS')
if ALLOWED_ORIGINS:
    origins = [o.strip() for o in ALLOWED_ORIGINS.split(',') if o.strip()]
else:
    # Sensible localhost defaults + staging/production origins
    origins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:4000',
        'http://127.0.0.1:4000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://interface.stg.nxops.net',  # Staging interface
        'https://pearlos.org',  # Production
        'https://www.pearlos.org',  # Production www
    ]
    # Auto-add RunPod proxy origins (*.proxy.runpod.net)
    import re
    runpod_pod_id = os.getenv('RUNPOD_POD_ID', '')
    if runpod_pod_id:
        for port in [3000, 4000, 5173]:
            origins.append(f'https://{runpod_pod_id}-{port}.proxy.runpod.net')

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# ---------------------------------------------------------------------------
# WebSocket event channel — allows frontends to receive nia.event envelopes
# without an active Daily.co room.
# ---------------------------------------------------------------------------

_ws_clients: dict[WebSocket, str | None] = {}  # ws -> session_id (None = receive all)
_ws_clients_lock = asyncio.Lock()


async def ws_broadcast(envelope: dict, session_id: str | None = None):
    """Send an envelope to connected WebSocket clients.
    
    If session_id is provided, only clients subscribed to that session (or
    unscoped clients) receive the event. This prevents tool events from
    leaking to stale/other sessions.
    """
    if not _ws_clients:
        return
    payload = json.dumps(envelope)
    async with _ws_clients_lock:
        dead: list[WebSocket] = []
        for ws, client_session in _ws_clients.items():
            # Send if: no session scoping, or client is unscoped, or sessions match
            if session_id is None or client_session is None or client_session == session_id:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
        for ws in dead:
            _ws_clients.pop(ws, None)


@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    """WebSocket endpoint for receiving nia.event envelopes.

    Clients connect here to get the same events that would normally be
    delivered via Daily.co app-messages.  No authentication required for
    MVP (same trust boundary as the gateway HTTP endpoints).
    
    Session scoping: client can send a JSON message with {"session_id": "..."}
    to only receive events for that session. Without it, receives all events.
    """
    await websocket.accept()
    async with _ws_clients_lock:
        _ws_clients[websocket] = None  # Unscoped by default
    logger.info(f"[ws/events] Client connected, total={len(_ws_clients)}")
    try:
        while True:
            msg = await websocket.receive_text()
            # Allow clients to register their session scope
            try:
                data = json.loads(msg)
                if isinstance(data, dict) and "session_id" in data:
                    async with _ws_clients_lock:
                        _ws_clients[websocket] = data["session_id"]
                    logger.info(f"[ws/events] Client scoped to session={data['session_id']}")
            except (json.JSONDecodeError, Exception):
                pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        async with _ws_clients_lock:
            _ws_clients.pop(websocket, None)
        logger.info(f"[ws/events] Client disconnected, total={len(_ws_clients)}")


# ---------------------------------------------------------------------------
# Note state — tracks what note the frontend currently has open so that
# Pearl (via OpenClaw) can query it.
# ---------------------------------------------------------------------------

_current_note_state: Dict[str, Any] = {
    "noteId": None,
    "title": None,
    "content": None,
    "viewState": "library",
    "action": None,
    "updatedAt": None,
}


class NoteStateUpdate(BaseModel):
    action: str  # 'opened' | 'updated' | 'closed'
    noteId: str | None = None
    title: str | None = None
    content: str | None = None
    viewState: str | None = None


@app.post("/api/note-state")
async def post_note_state(body: NoteStateUpdate):
    """Frontend calls this when a note is opened/updated/closed."""
    global _current_note_state
    _current_note_state = {
        "noteId": body.noteId,
        "title": body.title,
        "content": body.content,
        "viewState": body.viewState or ("document" if body.noteId else "library"),
        "action": body.action,
        "updatedAt": time.time(),
    }
    logger.info(f"[gateway] Note state updated: action={body.action}, noteId={body.noteId}, title={body.title}")

    # Broadcast note state as a nia.event so running bot sessions can inject LLM context
    try:
        event_map = {"opened": "note.open", "updated": "note.updated", "closed": "note.close"}
        event_name = event_map.get(body.action)
        if event_name:
            envelope = {
                "v": 1,
                "kind": "nia.event",
                "event": event_name,
                "ts": int(time.time() * 1000),
                "payload": {
                    "noteId": body.noteId,
                    "title": body.title,
                    "content": body.content,
                    "source": "gateway",
                },
            }
            await ws_broadcast(envelope)
            logger.info(f"[gateway] Broadcasted {event_name} event via WebSocket")
    except Exception as e:
        logger.warning(f"[gateway] Failed to broadcast note event: {e}")

    return {"ok": True}


@app.get("/api/note-state")
async def get_note_state():
    """Returns the current note state (what note is open in the UI)."""
    return _current_note_state


# ---------------------------------------------------------------------------
# Chat mode — text-only interaction (no Daily call, forwards to OpenClaw)
# ---------------------------------------------------------------------------

from fastapi.responses import StreamingResponse

OPENCLAW_BASE_URL = os.getenv("OPENCLAW_BASE_URL", "http://localhost:18789")
OPENCLAW_API_KEY = os.getenv("OPENCLAW_API_KEY", "")


class ChatRequest(BaseModel):
    messages: list[dict]


@app.post("/api/chat")
async def chat_completion(body: ChatRequest):
    """Stream a chat completion from OpenClaw for text chat mode."""

    async def _stream():
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "model": "default",
                    "messages": body.messages,
                    "stream": True,
                }
                _headers = {"Content-Type": "application/json"}
                if OPENCLAW_API_KEY:
                    _headers["Authorization"] = f"Bearer {OPENCLAW_API_KEY}"
                async with session.post(
                    f"{OPENCLAW_BASE_URL}/v1/chat/completions",
                    json=payload,
                    headers=_headers,
                    timeout=aiohttp.ClientTimeout(total=120),
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        logger.error(f"[chat] OpenClaw returned {resp.status}: {error_text}")
                        yield f"data: {json.dumps({'error': 'upstream_error', 'status': resp.status})}\n\n"
                        return
                    async for chunk in resp.content.iter_any():
                        yield chunk.decode("utf-8", errors="replace")
        except Exception as e:
            logger.error(f"[chat] Streaming error: {e}", exc_info=True)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Image proxy / resolver — returns a reliable image for a given search query.
# Uses Wikipedia's REST API to find an actual matching thumbnail.
# Used by Wonder Canvas so it doesn't have to guess Unsplash photo IDs.
# ---------------------------------------------------------------------------

_image_cache: Dict[str, str] = {}  # query -> resolved image URL


def _slugify_query(q: str) -> str:
    """Convert a search query into a Wikipedia-friendly title slug."""
    import re
    # Title-case the query and replace spaces with underscores
    return "_".join(word.capitalize() for word in re.sub(r"[^a-zA-Z0-9 ]", " ", q).split())


def _make_svg_placeholder(q: str) -> str:
    """Return a simple SVG placeholder with the query text."""
    import html
    label = html.escape(q[:40])
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">'
        f'<rect width="600" height="400" fill="#1a0e2e"/>'
        f'<text x="300" y="200" font-family="Georgia" font-size="24" '
        f'fill="#FFD233" text-anchor="middle" dominant-baseline="middle">{label}</text>'
        f'</svg>'
    )
    return svg


from fastapi.responses import RedirectResponse, Response as FastAPIResponse


@app.get("/api/image")
async def image_proxy(q: str):
    """Resolve a search query to a real image URL via Wikipedia.

    Returns a redirect to the actual image (e.g. a Wikipedia thumbnail).
    Falls back to a simple SVG placeholder if no image is found.

    Usage: GET /api/image?q=sea+turtle
    """
    q_lower = q.lower().strip()

    # 1. Check cache
    if q_lower in _image_cache:
        cached = _image_cache[q_lower]
        logger.info(f"[image-proxy] Cache hit for '{q_lower}': {cached}")
        return RedirectResponse(url=cached, status_code=302)

    # 2. Try Wikipedia REST API for this query
    slug = _slugify_query(q_lower)
    wiki_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                wiki_url,
                timeout=aiohttp.ClientTimeout(total=8),
                headers={"User-Agent": "PearlOS-ImageProxy/1.0 (pearlos.org)"},
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    thumbnail = data.get("thumbnail") or {}
                    img_url = thumbnail.get("source")
                    if img_url:
                        # Prefer higher-resolution version (bump width to 600px)
                        img_url = img_url.replace("/320px-", "/600px-").replace("/200px-", "/600px-")
                        _image_cache[q_lower] = img_url
                        logger.info(f"[image-proxy] Resolved '{q_lower}' → {img_url}")
                        return RedirectResponse(url=img_url, status_code=302)
                    else:
                        logger.info(f"[image-proxy] Wikipedia summary found but no thumbnail for '{q_lower}'")
                else:
                    logger.info(f"[image-proxy] Wikipedia returned {resp.status} for slug '{slug}'")
    except Exception as e:
        logger.warning(f"[image-proxy] Wikipedia lookup failed for '{q_lower}': {e}")

    # 3. Fallback: SVG placeholder with the query text
    logger.info(f"[image-proxy] Using SVG placeholder for '{q_lower}'")
    svg_content = _make_svg_placeholder(q)
    return FastAPIResponse(content=svg_content, media_type="image/svg+xml")


# ---------------------------------------------------------------------------
# Photo Magic — image generation / editing via ComfyUI
# ---------------------------------------------------------------------------

from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse

PHOTO_MAGIC_OUTPUT_DIR = os.getenv("PHOTO_MAGIC_OUTPUT_DIR", "/tmp/photo-magic")


class PhotoMagicGenerateRequest(BaseModel):
    prompt: str


@app.post("/api/photo-magic/generate")
async def photo_magic_generate(body: PhotoMagicGenerateRequest):
    """Generate an image from a text prompt (no input photo)."""
    from comfyui_client import generate_image
    try:
        path = await generate_image(body.prompt, output_dir=PHOTO_MAGIC_OUTPUT_DIR)
        filename = os.path.basename(path)
        return {
            "image_path": path,
            "image_url": f"/api/photo-magic/result/{filename}",
            "filename": filename,
        }
    except Exception as e:
        logger.error(f"[photo-magic] Generate failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/photo-magic/edit")
async def photo_magic_edit(
    prompt: str = Form(...),
    file: UploadFile = File(...),
):
    """Edit an uploaded image using a text prompt."""
    from comfyui_client import edit_image
    try:
        # Save upload to temp file
        os.makedirs(PHOTO_MAGIC_OUTPUT_DIR, exist_ok=True)
        tmp_path = os.path.join(PHOTO_MAGIC_OUTPUT_DIR, f"upload_{uuid.uuid4().hex}_{file.filename}")
        with open(tmp_path, "wb") as f:
            f.write(await file.read())

        path = await edit_image(prompt, tmp_path, output_dir=PHOTO_MAGIC_OUTPUT_DIR)
        filename = os.path.basename(path)
        return {
            "image_path": path,
            "image_url": f"/api/photo-magic/result/{filename}",
            "filename": filename,
        }
    except Exception as e:
        logger.error(f"[photo-magic] Edit failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/photo-magic/inpaint")
async def photo_magic_inpaint(
    prompt: str = Form(...),
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
):
    """Inpaint: edit masked areas of an image using a text prompt."""
    from comfyui_client import inpaint_image
    try:
        os.makedirs(PHOTO_MAGIC_OUTPUT_DIR, exist_ok=True)
        img_path = os.path.join(PHOTO_MAGIC_OUTPUT_DIR, f"upload_{uuid.uuid4().hex}_{file.filename}")
        with open(img_path, "wb") as f:
            f.write(await file.read())

        mask_path = os.path.join(PHOTO_MAGIC_OUTPUT_DIR, f"mask_{uuid.uuid4().hex}_{mask.filename}")
        with open(mask_path, "wb") as f:
            f.write(await mask.read())

        path = await inpaint_image(prompt, img_path, mask_path, output_dir=PHOTO_MAGIC_OUTPUT_DIR)
        filename = os.path.basename(path)
        return {
            "image_path": path,
            "image_url": f"/api/photo-magic/result/{filename}",
            "filename": filename,
        }
    except Exception as e:
        logger.error(f"[photo-magic] Inpaint failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/photo-magic/edit-multi")
async def photo_magic_edit_multi(
    prompt: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """Multi-image composition (up to 3 images) with a text prompt."""
    from comfyui_client import edit_multi_image
    try:
        os.makedirs(PHOTO_MAGIC_OUTPUT_DIR, exist_ok=True)
        paths = []
        for f in files[:3]:
            tmp_path = os.path.join(PHOTO_MAGIC_OUTPUT_DIR, f"upload_{uuid.uuid4().hex}_{f.filename}")
            with open(tmp_path, "wb") as out:
                out.write(await f.read())
            paths.append(tmp_path)

        path = await edit_multi_image(prompt, paths, output_dir=PHOTO_MAGIC_OUTPUT_DIR)
        filename = os.path.basename(path)
        return {
            "image_path": path,
            "image_url": f"/api/photo-magic/result/{filename}",
            "filename": filename,
        }
    except Exception as e:
        logger.error(f"[photo-magic] Multi-edit failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/photo-magic/status/{prompt_id}")
async def photo_magic_status(prompt_id: str):
    """Check generation status for a prompt_id."""
    from comfyui_client import get_status
    return await get_status(prompt_id)


@app.get("/api/photo-magic/result/{filename}")
async def photo_magic_result(filename: str):
    """Serve a generated image file."""
    # Sanitize filename to prevent path traversal
    safe_name = os.path.basename(filename)
    path = os.path.join(PHOTO_MAGIC_OUTPUT_DIR, safe_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path, media_type="image/png")


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
QUEUE_KEY = "bot:launch:queue"
REDIS_AUTH_REQUIRED = os.getenv('REDIS_AUTH_REQUIRED', 'false').lower() == 'true'
REDIS_SHARED_SECRET = os.getenv('REDIS_SHARED_SECRET')
USE_REDIS = os.getenv('USE_REDIS', 'false').lower() == 'true'
TEST_BYPASS_REDIS = os.getenv('TEST_BYPASS_REDIS', 'false').lower() == 'true'

# Direct runner configuration (used when USE_REDIS=false)
RUNNER_URL = os.getenv("RUNNER_URL", "http://localhost:7860")

# In-memory room locks for direct runner mode (replaces Redis when disabled)
# Structure: { room_url: { "status": "running", "session_id": "...", "timestamp": ... } }
active_rooms: Dict[str, Dict[str, Any]] = {}
active_rooms_lock = asyncio.Lock()

# Track bots by user/session for forum transition feature in direct mode.
# Structure: { user_bot_key: { "session_id": "...", "room_url": "...", "personalityId": "...", "persona": "...", "timestamp": ... } }
user_bots: Dict[str, Dict[str, Any]] = {}
user_bots_lock = asyncio.Lock()

# Initialize Redis
r = None
if USE_REDIS:
    try:
        password = REDIS_SHARED_SECRET if REDIS_AUTH_REQUIRED else None
        r = redis.Redis.from_url(REDIS_URL, password=password, decode_responses=True)
        logger.info(f"[gateway] Connected to Redis at {REDIS_URL}")
    except Exception as e:
        logger.error(f"[gateway] Failed to connect to Redis: {e}")
        r = None
else:
    logger.info("[gateway] USE_REDIS not true; skipping Redis client initialization")


def _user_bot_key(session_user_id: str, tenant_id: str | None) -> str:
    """Build a tenant-scoped user bot key to avoid cross-tenant collisions."""
    tenant_scope = (tenant_id or "global").strip() or "global"
    return f"user_bot:{tenant_scope}:{session_user_id}"


def _room_lock_key(room_url: str) -> str:
    return f"room_active:{room_url}"


def _safe_json_loads(raw: Any) -> Dict[str, Any]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _cleanup_user_bot_mappings_for_room(redis_client: Any, room_url: str) -> int:
    """Delete any user_bot mappings that currently point at a room."""
    deleted = 0
    try:
        for key in redis_client.scan_iter(match="user_bot:*"):
            payload = _safe_json_loads(redis_client.get(key))
            if payload.get("room_url") == room_url:
                redis_client.delete(key)
                deleted += 1
    except Exception as exc:
        logger.warning(f"[gateway] Failed cleaning user_bot mappings for {room_url}: {exc}")
    return deleted


async def _cleanup_direct_user_bot_mappings_for_room(room_url: str) -> int:
    """Delete in-memory user_bot mappings that currently point at a room."""
    deleted = 0
    async with user_bots_lock:
        for key, payload in list(user_bots.items()):
            if (payload or {}).get("room_url") == room_url:
                user_bots.pop(key, None)
                deleted += 1
    return deleted

class VoiceParameters(BaseModel):
    speed: float | None = None
    stability: float | None = None
    similarityBoost: float | None = None
    style: float | None = None
    optimizeStreamingLatency: float | None = None
    maxCallDuration: int | None = None
    participantLeftTimeout: int | None = None
    participantAbsentTimeout: int | None = None
    enableRecording: bool | None = None
    enableTranscription: bool | None = None
    applyGreenscreen: bool | None = None
    language: str | None = None

class JoinRequest(BaseModel):
    room_url: str | None = None
    personalityId: str | None = None
    persona: str | None = None
    tenantId: str | None = None
    voice: str | None = None
    voiceParameters: VoiceParameters | None = None
    voiceProvider: str | None = None
    token: str | None = None  # Daily room token for bot authorization
    # Voice-only session support
    voiceOnly: bool = False  # If true, bot joins with video off
    sessionPersistence: int | None = None  # Seconds to keep room alive after leave (default from env)
    # Deterministic identity mapping (optional)
    participantId: str | None = None  # Real Daily.co participant ID for accurate mapping
    sessionUserId: str | None = None
    sessionUserEmail: str | None = None
    sessionUserName: str | None = None
    sessionId: str | None = None  # Real Daily.co session ID (for accurate session history tracking)
    isOnboarding: bool = False
    sessionOverride: Dict[str, Any] | None = None
    # Feature flags for conditional tool registration
    supportedFeatures: list[str] | None = None  # e.g., ['notes', 'youtube', 'gmail'] - filters tools by feature_flag
    # Static path configuration for mode switching
    modePersonalityVoiceConfig: Dict[str, Any] | None = None
    debugTraceId: str | None = None

class JoinResponse(BaseModel):
    pid: int
    room_url: str
    personalityId: str
    persona: str
    reused: bool = False

class AdminMessage(BaseModel):
    room_url: Optional[str] = None
    message: str
    mode: Optional[str] = 'queued'
    sender_id: Optional[str] = 'system'
    sender_name: Optional[str] = 'System'
    timestamp: Optional[float] = None

class ConfigRequest(BaseModel):
    room_url: str
    personalityId: str | None = None
    voice: str | None = None
    voiceProvider: str | None = None
    voiceParameters: VoiceParameters | None = None
    mode: str | None = None
    supportedFeatures: list[str] | None = None
    sessionId: str | None = None
    sessionUserId: str | None = None
    sessionUserEmail: str | None = None
    sessionUserName: str | None = None


class ActiveAppletRequest(BaseModel):
    room_url: str
    applet_id: str | None = None
    owner: str | None = None


class ActiveNoteRequest(BaseModel):
    room_url: str
    note_id: str | None = None
    owner: str | None = None

async def _direct_runner_start(body: dict, session_id: str, req_logger) -> dict:
    """Start a bot session by calling the runner function directly (no Redis, no HTTP).
    
    This is used when USE_REDIS=false for simpler local development.
    Imports and calls _launch_session directly to avoid needing a separate runner process.
    """
    room_url = body.get("room_url")
    session_user_id = (body.get("sessionUserId") or "").strip() or None
    tenant_id = body.get("tenantId")
    user_bot_key = _user_bot_key(session_user_id, tenant_id) if session_user_id else None
    debug_trace_id = body.get("debugTraceId")
    
    # Log initial state
    try:
        from runner_main import sessions as runner_sessions, _first_session_for_room
        runner_session = _first_session_for_room(room_url)
        runner_session_info = {
            "id": runner_session.id,
            "room_url": runner_session.room_url,
            "task_done": runner_session.task.done(),
        } if runner_session else None
        req_logger.info(
            f"[gateway] JOIN REQUEST START: room_url={room_url}, session_id={session_id}, "
            f"active_rooms_count={len(active_rooms)}, runner_sessions_count={len(runner_sessions)}, "
            f"runner_session_for_room={runner_session_info}, debug_trace_id={debug_trace_id}"
        )
    except Exception as e:
        req_logger.info(
            f"[gateway] JOIN REQUEST START: room_url={room_url}, session_id={session_id}, "
            f"active_rooms_count={len(active_rooms)}, cannot_check_runner_sessions: {e}, debug_trace_id={debug_trace_id}"
        )

    # Direct-mode forum transition support:
    # If this user already has a live bot in another room, move that same bot session into this room.
    if user_bot_key:
        try:
            from runner_main import _first_session_for_room, transition_session, TransitionRequest
            async with user_bots_lock:
                existing_user_bot = dict(user_bots.get(user_bot_key) or {})
            existing_room = existing_user_bot.get("room_url")
            existing_session_id = existing_user_bot.get("session_id")

            # If target room already has a running bot, reuse it and skip transition/spawn.
            target_session = _first_session_for_room(room_url)
            if target_session and not target_session.task.done():
                req_logger.info(
                    "[gateway] Direct mode: target room already has live bot; reusing",
                    targetRoom=room_url,
                    sessionId=target_session.id,
                )
                async with user_bots_lock:
                    user_bots[user_bot_key] = {
                        "session_id": target_session.id,
                        "room_url": room_url,
                        "personalityId": target_session.personality,
                        "persona": target_session.persona,
                        "tenantId": tenant_id,
                        "timestamp": time.time(),
                    }
                return {
                    "status": "joined_existing",
                    "session_id": target_session.id,
                    "room_url": room_url,
                    "personalityId": target_session.personality,
                    "persona": target_session.persona,
                    "reused": True,
                    "detail": "Target room already has a bot",
                    "debugTraceId": debug_trace_id,
                }

            # Attempt in-process transition when we have a known previous user bot in a different room.
            if existing_room and existing_session_id and existing_room != room_url:
                req_logger.info(
                    "[gateway] Direct mode: transitioning existing user bot",
                    existingRoom=existing_room,
                    targetRoom=room_url,
                    transitionSessionId=existing_session_id,
                )
                transition_req = TransitionRequest(
                    new_room_url=room_url,
                    new_token=body.get("token"),
                    personalityId=existing_user_bot.get("personalityId") or body.get("personalityId"),
                    persona=existing_user_bot.get("persona") or body.get("persona"),
                    debugTraceId=debug_trace_id,
                    sessionUserId=session_user_id,
                    sessionUserName=body.get("sessionUserName"),
                    sessionUserEmail=body.get("sessionUserEmail"),
                )
                transition_resp = await transition_session(existing_session_id, transition_req)
                transitioned_session_id = transition_resp.get("session_id") or existing_session_id
                transitioned_personality = (
                    transition_resp.get("personalityId")
                    or existing_user_bot.get("personalityId")
                    or body.get("personalityId")
                )
                transitioned_persona = (
                    transition_resp.get("persona")
                    or existing_user_bot.get("persona")
                    or body.get("persona")
                )
                async with active_rooms_lock:
                    active_rooms.pop(existing_room, None)
                    active_rooms[room_url] = {
                        "status": "running",
                        "session_id": transitioned_session_id,
                        "timestamp": time.time(),
                        "personalityId": transitioned_personality,
                        "persona": transitioned_persona,
                        "transitioned_from": existing_room,
                    }
                async with user_bots_lock:
                    user_bots[user_bot_key] = {
                        "session_id": transitioned_session_id,
                        "room_url": room_url,
                        "personalityId": transitioned_personality,
                        "persona": transitioned_persona,
                        "tenantId": tenant_id,
                        "timestamp": time.time(),
                        "transitioned_at": time.time(),
                    }
                return {
                    "status": "transitioned",
                    "session_id": transitioned_session_id,
                    "room_url": room_url,
                    "personalityId": transitioned_personality,
                    "persona": transitioned_persona,
                    "reused": True,
                    "detail": f"Transitioned bot from {existing_room} to {room_url}",
                    "debugTraceId": debug_trace_id,
                }
        except Exception as transition_err:
            req_logger.warning(
                f"[gateway] Direct mode: transition probe failed, falling back to normal launch: {transition_err}"
            )
    
    # Check in-memory room locks with better concurrent request handling
    async with active_rooms_lock:
        existing = active_rooms.get(room_url)
        req_logger.info(
            f"[gateway] Checking active_rooms for {room_url}: existing={existing}, "
            f"all_active_rooms={dict(active_rooms)}"
        )
        if existing:
            existing_status = existing.get("status")
            existing_age = time.time() - existing.get("timestamp", 0)
            
            # If pending and recent (< 30s), wait for it to complete instead of returning immediately
            if existing_status == "pending" and existing_age < 30:
                req_logger.info(
                    f"[gateway] Direct mode: Found pending bot for {room_url} (age: {existing_age:.1f}s), waiting for completion"
                )
                # Release lock and wait for pending request to complete
                # Poll every 0.5s for up to 30s
                max_wait = 30.0
                poll_interval = 0.5
                waited = 0.0
                while waited < max_wait:
                    await asyncio.sleep(poll_interval)
                    waited += poll_interval
                    async with active_rooms_lock:
                        current = active_rooms.get(room_url)
                        if not current:
                            # Entry was removed (likely failed), break and proceed with new launch
                            req_logger.info(
                                f"[gateway] Direct mode: Pending entry removed after {waited:.1f}s, proceeding with new launch"
                            )
                            break
                        current_status = current.get("status")
                        if current_status == "running":
                            # First request completed successfully
                            req_logger.info(
                                f"[gateway] Direct mode: Pending request completed after {waited:.1f}s"
                            )
                            return {
                                "status": "running",
                                "session_id": current.get("session_id"),
                                "room_url": room_url,
                                "personalityId": current.get("personalityId") or body.get("personalityId"),
                                "persona": current.get("persona") or body.get("persona"),
                                "reused": True,
                                "detail": "Bot launch completed by concurrent request"
                            }
                        elif current_status != "pending":
                            # Status changed to something else (shouldn't happen, but handle it)
                            break
                
                # If we get here, either timeout or entry was removed
                async with active_rooms_lock:
                    current = active_rooms.get(room_url)
                    if current and current.get("status") == "pending":
                        # Still pending after timeout - remove stale entry and proceed
                        req_logger.warning(
                            f"[gateway] Direct mode: Pending request timed out after {waited:.1f}s, removing stale entry"
                        )
                        active_rooms.pop(room_url, None)
                    elif current and current.get("status") == "running":
                        # Completed while we were checking
                        return {
                            "status": "running",
                            "session_id": current.get("session_id"),
                            "room_url": room_url,
                            "personalityId": current.get("personalityId") or body.get("personalityId"),
                            "persona": current.get("persona") or body.get("persona"),
                            "reused": True,
                                "detail": "Bot launch completed by concurrent request",
                                "debugTraceId": debug_trace_id,
                            "detail": "Bot launch completed by concurrent request",
                            "debugTraceId": debug_trace_id,
                        }
            
            # If running and recent (< 2 minutes), verify session exists and reuse it
            if existing_status == "running" and existing_age < 120:
                # Verify the session actually exists in runner_main
                try:
                    from runner_main import sessions
                    existing_session_id = existing.get("session_id")
                    if existing_session_id and existing_session_id in sessions:
                        req_logger.info(
                            f"[gateway] Direct mode: Found existing bot for {room_url} (age: {existing_age:.1f}s)"
                        )
                        return {
                            "status": "running",
                            "session_id": existing_session_id,
                            "room_url": room_url,
                            "personalityId": existing.get("personalityId") or body.get("personalityId"),
                            "persona": existing.get("persona") or body.get("persona"),
                            "reused": True,
                            "detail": "Bot already active for this room",
                            "debugTraceId": debug_trace_id,
                        }
                    else:
                        # Session doesn't exist - stale entry
                        req_logger.warning(
                            f"[gateway] Direct mode: Running entry found but session {existing_session_id} not found, removing stale entry"
                        )
                        active_rooms.pop(room_url, None)
                except ImportError:
                    # Can't verify, but assume it's valid if recent
                    req_logger.info(
                        f"[gateway] Direct mode: Found existing bot for {room_url} (age: {existing_age:.1f}s, cannot verify session)"
                    )
                    return {
                        "status": "running",
                        "session_id": existing.get("session_id"),
                        "room_url": room_url,
                        "personalityId": existing.get("personalityId") or body.get("personalityId"),
                        "persona": existing.get("persona") or body.get("persona"),
                        "reused": True,
                        "detail": "Bot already active for this room",
                        "debugTraceId": debug_trace_id,
                    }
            
            # Stale entry (pending > 30s or running > 2min), remove it
            req_logger.info(
                f"[gateway] Direct mode: Removing stale room lock for {room_url} "
                f"(status={existing_status}, age={existing_age:.1f}s)"
            )
            active_rooms.pop(room_url, None)
        
        # Set pending state to prevent concurrent launches
        active_rooms[room_url] = {
            "status": "pending",
            "session_id": session_id,
            "timestamp": time.time(),
            "personalityId": body.get("personalityId"),
            "persona": body.get("persona"),
        }
        req_logger.info(
            f"[gateway] Set active_rooms[{room_url}] to pending: {active_rooms[room_url]}"
        )
    
    # Before launching, check for and clean up any stale sessions for this room
    req_logger.info(f"[gateway] Checking for stale sessions before launch for room {room_url}")
    try:
        from runner_main import sessions, _first_session_for_room
        req_logger.info(
            f"[gateway] Runner sessions state: total={len(sessions)}, "
            f"session_ids={list(sessions.keys())}"
        )
        existing_session = _first_session_for_room(room_url)
        if existing_session:
            req_logger.warning(
                f"[gateway] STALE SESSION FOUND: session_id={existing_session.id}, "
                f"room_url={existing_session.room_url}, task_done={existing_session.task.done()}, "
                f"terminating before new launch"
            )
            if not existing_session.task.done():
                req_logger.info(f"[gateway] Cancelling task for session {existing_session.id}")
                existing_session.task.cancel()
                try:
                    await asyncio.wait_for(existing_session.task, timeout=5)
                    req_logger.info(f"[gateway] Session {existing_session.id} cancelled successfully")
                except (asyncio.TimeoutError, asyncio.CancelledError) as e:
                    req_logger.warning(
                        f"[gateway] Session {existing_session.id} did not cancel cleanly: {e}, removing anyway"
                    )
            sessions.pop(existing_session.id, None)
            req_logger.info(
                f"[gateway] Cleared stale session {existing_session.id} for room {room_url}, "
                f"remaining_sessions={len(sessions)}"
            )
        else:
            req_logger.info(f"[gateway] No existing session found for room {room_url}")
    except ImportError as e:
        req_logger.warning(f"[gateway] Cannot import runner_main to check stale sessions: {e}")
    except Exception as e:
        req_logger.error(
            f"[gateway] Error checking for stale sessions: {e}",
            exc_info=True
        )
    
    req_logger.info(
        "[gateway] Direct mode: Importing and calling _launch_session directly",
        personalityId=body.get("personalityId"),
    )
    
    try:
        # Dynamically import _launch_session from runner_main
        # This avoids circular imports and allows the gateway to work standalone
        try:
            from runner_main import _launch_session
        except ImportError:
            # Try alternative import path
            import sys
            from pathlib import Path
            runner_path = Path(__file__).parent / "runner_main.py"
            if runner_path.exists():
                import importlib.util
                spec = importlib.util.spec_from_file_location("runner_main", runner_path)
                runner_module = importlib.util.module_from_spec(spec)
                sys.modules["runner_main"] = runner_module
                spec.loader.exec_module(runner_module)
                _launch_session = runner_module._launch_session
            else:
                raise ImportError("Could not find runner_main.py")
        
        # Call _launch_session directly
        req_logger.info(
            f"[gateway] Calling _launch_session for room_url={room_url}, "
            f"session_id={session_id}, active_rooms_before={dict(active_rooms)}"
        )
        info = await _launch_session(
            room_url=body.get("room_url"),
            token=body.get("token"),
            personalityId=body.get("personalityId") or "pearl",
            persona=body.get("persona") or "Pearl",
            body=body
        )
        
        req_logger.info(
            f"[gateway] _launch_session returned: session_id={info.id}, room_url={info.room_url}, "
            f"personality={info.personality}, persona={info.persona}"
        )
        
        # Verify session was actually created
        try:
            from runner_main import sessions as runner_sessions
            if info.id not in runner_sessions:
                req_logger.error(
                    f"[gateway] CRITICAL: Session {info.id} not found in runner_sessions after launch! "
                    f"runner_sessions={list(runner_sessions.keys())}"
                )
            else:
                req_logger.info(
                    f"[gateway] Verified session {info.id} exists in runner_sessions"
                )
        except Exception as e:
            req_logger.warning(f"[gateway] Could not verify session in runner_sessions: {e}")
        
        # Update room state to running
        async with active_rooms_lock:
            old_state = active_rooms.get(room_url, {}).copy()
            active_rooms[room_url] = {
                "status": "running",
                "session_id": info.id,
                "timestamp": time.time(),
                "personalityId": info.personality,
                "persona": info.persona,
            }
            req_logger.info(
                f"[gateway] Updated active_rooms[{room_url}]: old={old_state}, new={active_rooms[room_url]}"
            )

        if user_bot_key:
            async with user_bots_lock:
                user_bots[user_bot_key] = {
                    "session_id": info.id,
                    "room_url": info.room_url,
                    "personalityId": info.personality,
                    "persona": info.persona,
                    "tenantId": tenant_id,
                    "timestamp": time.time(),
                }
        
        return {
            "status": "running",
            "session_id": info.id,
            "room_url": info.room_url,
            "personalityId": info.personality,
            "persona": info.persona,
            "reused": False,
            "message": "Bot started via direct function call",
            "debugTraceId": debug_trace_id,
        }
                
    except Exception as e:
        req_logger.error(
            f"[gateway] FAILED to launch session: room_url={room_url}, session_id={session_id}, "
            f"error={e}, active_rooms_before_cleanup={dict(active_rooms)}",
            exc_info=True
        )
        async with active_rooms_lock:
            removed = active_rooms.pop(room_url, None)
            req_logger.info(
                f"[gateway] Removed failed entry from active_rooms: room_url={room_url}, "
                f"removed={removed}, remaining_active_rooms={dict(active_rooms)}"
            )
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to launch bot session: {str(e)}"
        )


@app.post("/join", dependencies=[Depends(require_auth)])
@app.post("/start", dependencies=[Depends(require_auth)])
async def join_room(request: JoinRequest):
    # Parse request body
    body = request.model_dump()
    session_id = body.get("sessionId") or uuid.uuid4().hex
    body["sessionId"] = session_id
    debug_trace_id = (body.get("debugTraceId") or f"gateway:{session_id[:8]}").strip()
    body["debugTraceId"] = debug_trace_id

    # Ensure supportedFeatures is a list
    if body.get("supportedFeatures") is None:
        body["supportedFeatures"] = []

    # Validate minimal requirements
    room_url = body.get("room_url")
    if not room_url:
         raise HTTPException(status_code=400, detail="Missing room_url")

    req_logger = logger.bind(
        roomUrl=room_url,
        sessionId=session_id,
        userId=body.get("sessionUserId"),
        userName=body.get("sessionUserName"),
        debugTraceId=debug_trace_id,
    )
    
    # Log join request received
    logger.info(
        f"[gateway] /join ENDPOINT CALLED: room_url={room_url}, session_id={session_id}, "
        f"USE_REDIS={USE_REDIS}, r_available={r is not None}, "
        f"active_rooms_count={len(active_rooms)}, debug_trace_id={debug_trace_id}"
    )

    voice_parameters = body.get("voiceParameters") or {}
    mode_config_keys = list((body.get("modePersonalityVoiceConfig") or {}).keys()) or None

    req_logger.info(
        "[gateway] Join request summary",
        personalityId=body.get("personalityId"),
        persona=body.get("persona"),
        voiceId=body.get("voice"),
        voiceProvider=body.get("voiceProvider"),
        voiceParams={
            k: voice_parameters.get(k)
            for k in ("speed", "stability", "similarityBoost", "style", "optimizeStreamingLatency")
            if voice_parameters.get(k) is not None
        } or None,
        supportedFeatures=body.get("supportedFeatures"),
        modeConfigKeys=mode_config_keys,
    )

    # =========================================================================
    # DIRECT RUNNER MODE (when USE_REDIS=false)
    # =========================================================================
    if (not USE_REDIS) or (not r):
        req_logger.info("[gateway] Direct runner mode enabled (USE_REDIS=false)")
        result = await _direct_runner_start(body, session_id, req_logger)
        req_logger.info(
            f"[gateway] /join RETURNING: room_url={room_url}, result={result}"
        )
        return result
    
    # =========================================================================
    # REDIS QUEUE MODE (production)
    # =========================================================================
    # Check for existing active bot in this room (Idempotency)
    lock_key = f"room_active:{room_url}"
    try:
        existing_state = r.get(lock_key)
        if existing_state:
            req_logger.info(f"[gateway] Found existing bot for {room_url}: {existing_state}")
            state_data = json.loads(existing_state)
            state_status = state_data.get("status")
            state_timestamp = float(state_data.get("timestamp") or 0)
            state_age = time.time() - state_timestamp if state_timestamp else None

            # Guard against stale room_active locks that can cause "join succeeds but no bot in room".
            if state_status == "running":
                keepalive_key = f"room_keepalive:{room_url}"
                keepalive_raw = r.get(keepalive_key)
                keepalive_age = None
                keepalive_fresh = False
                if keepalive_raw:
                    try:
                        keepalive_data = _safe_json_loads(keepalive_raw)
                        keepalive_ts = float(keepalive_data.get("timestamp") or 0)
                        if keepalive_ts:
                            keepalive_age = time.time() - keepalive_ts
                            keepalive_fresh = keepalive_age <= 45
                    except Exception:
                        keepalive_fresh = False

                if not keepalive_fresh:
                    req_logger.warning(
                        "[gateway] room_active running lock is stale (missing/old keepalive); clearing and launching fresh bot",
                        keepaliveAge=keepalive_age,
                        stateAge=state_age,
                    )
                    r.delete(lock_key)
                    r.delete(keepalive_key)
                    existing_state = None

            elif state_status == "pending" and state_age is not None and state_age > 90:
                req_logger.warning(
                    "[gateway] room_active pending lock is stale; clearing and launching fresh bot",
                    stateAge=state_age,
                )
                r.delete(lock_key)
                existing_state = None

            if not existing_state:
                state_data = {}
            else:
            # Return the existing state as if it were a successful join response
            # We add a 'reused' flag to indicate this wasn't a new launch
                return {
                    "status": state_data.get("status", "running"),
                    "pid": state_data.get("pid") or state_data.get("job_id"),
                    "session_id": state_data.get("session_id"),
                    "runner_url": state_data.get("runner_url"),
                    "room_url": room_url,
                    "personalityId": state_data.get("personalityId") or body.get("personalityId"),
                    "persona": state_data.get("persona") or body.get("persona"),
                    "reused": True,
                    "detail": "Bot already active or pending for this room",
                    "debugTraceId": debug_trace_id,
                }
    except Exception as e:
        req_logger.error(f"[gateway] Error checking room lock: {e}")
        # Proceed cautiously or fail? Proceeding might cause duplicates, but failing blocks access.
        # We'll proceed but log the error.

    # =========================================================================
    # FORUM TRANSITION FEATURE: Transition user's existing bot into this room
    # =========================================================================
    session_user_id = body.get("sessionUserId")
    tenant_id = body.get("tenantId")
    if session_user_id:
        user_bot_key = _user_bot_key(session_user_id, tenant_id)
        try:
            existing_user_bot = _safe_json_loads(r.get(user_bot_key))
            existing_room = existing_user_bot.get("room_url")
            existing_session_id = existing_user_bot.get("session_id")

            if existing_room and existing_room != room_url:
                existing_room_lock_key = _room_lock_key(existing_room)
                existing_room_state = _safe_json_loads(r.get(existing_room_lock_key))
                runner_url = existing_room_state.get("runner_url")
                existing_session_id = existing_session_id or existing_room_state.get("session_id")

                req_logger.info(
                    "[gateway] Found user bot in another room; attempting live transition",
                    existingRoom=existing_room,
                    targetRoom=room_url,
                    transitionSessionId=existing_session_id,
                    transitionRunnerUrl=runner_url,
                    debugTraceId=debug_trace_id,
                )

                if runner_url and existing_session_id:
                    transition_payload = {
                        "new_room_url": room_url,
                        "new_token": body.get("token"),
                        "personalityId": existing_user_bot.get("personalityId") or body.get("personalityId"),
                        "persona": existing_user_bot.get("persona") or body.get("persona"),
                        "debugTraceId": debug_trace_id,
                        "sessionUserId": session_user_id,
                        "sessionUserName": body.get("sessionUserName"),
                        "sessionUserEmail": body.get("sessionUserEmail"),
                    }
                    transition_url = f"{runner_url}/sessions/{existing_session_id}/transition"
                    try:
                        async with aiohttp.ClientSession() as session:
                            async with session.post(transition_url, json=transition_payload, timeout=10) as resp:
                                if resp.status == 200:
                                    transition_resp = await resp.json()
                                    transitioned_session_id = (
                                        transition_resp.get("session_id")
                                        or existing_session_id
                                    )
                                    transitioned_personality = (
                                        transition_resp.get("personalityId")
                                        or transition_payload.get("personalityId")
                                        or body.get("personalityId")
                                    )
                                    transitioned_persona = (
                                        transition_resp.get("persona")
                                        or transition_payload.get("persona")
                                        or body.get("persona")
                                    )

                                    new_room_state = {
                                        "status": "running",
                                        "session_id": transitioned_session_id,
                                        "runner_url": runner_url,
                                        "personalityId": transitioned_personality,
                                        "persona": transitioned_persona,
                                        "timestamp": time.time(),
                                        "transitioned_from": existing_room,
                                    }
                                    r.setex(lock_key, 86400, json.dumps(new_room_state))
                                    r.delete(existing_room_lock_key)

                                    existing_user_bot["session_id"] = transitioned_session_id
                                    existing_user_bot["room_url"] = room_url
                                    existing_user_bot["personalityId"] = transitioned_personality
                                    existing_user_bot["persona"] = transitioned_persona
                                    existing_user_bot["runner_url"] = runner_url
                                    existing_user_bot["transitioned_at"] = time.time()
                                    r.setex(user_bot_key, 86400, json.dumps(existing_user_bot))

                                    req_logger.info(
                                        "[gateway] Transition completed",
                                        oldRoom=existing_room,
                                        newRoom=room_url,
                                        transitionedSessionId=transitioned_session_id,
                                    )
                                    return {
                                        "status": "transitioned",
                                        "session_id": transitioned_session_id,
                                        "runner_url": runner_url,
                                        "room_url": room_url,
                                        "personalityId": transitioned_personality,
                                        "persona": transitioned_persona,
                                        "reused": True,
                                        "detail": f"Transitioned bot from {existing_room} to {room_url}",
                                        "debugTraceId": debug_trace_id,
                                    }

                                error_text = await resp.text()
                                req_logger.warning(
                                    "[gateway] Transition endpoint returned non-200",
                                    status=resp.status,
                                    error=error_text,
                                )
                    except Exception as e:
                        req_logger.warning(f"[gateway] Transition request failed: {e}")
                else:
                    req_logger.warning(
                        "[gateway] Cannot transition user bot; missing runner_url or session_id",
                        existingRoom=existing_room,
                        sessionId=existing_session_id,
                        runnerUrl=runner_url,
                    )
        except Exception as e:
            req_logger.warning(f"[gateway] Error checking user bot for transition: {e}")

    # Set pending state to prevent race conditions (expires in 60s)
    try:
        pending_state = {
            "status": "pending",
            "room_url": room_url,
            "session_id": session_id,
            "timestamp": time.time()
        }
        r.setex(lock_key, 60, json.dumps(pending_state))
    except Exception as e:
        req_logger.error(f"[gateway] Failed to set pending state: {e}")

    # Track user bot before queuing (for forum transition feature)
    if session_user_id:
        user_bot_key = _user_bot_key(session_user_id, tenant_id)
        user_bot_data = {
            "session_id": session_id,
            "room_url": room_url,
            "personalityId": body.get("personalityId"),
            "persona": body.get("persona"),
            "tenantId": tenant_id,
            "timestamp": time.time()
        }
        try:
            r.setex(user_bot_key, 86400, json.dumps(user_bot_data))  # 24h expiry
            req_logger.info(f"[gateway] Tracked user bot for {session_user_id}")
        except Exception as e:
            req_logger.warning(f"[gateway] Failed to track user bot: {e}")

    # Push to Redis queue
    try:
        payload = json.dumps(body)
        r.rpush(QUEUE_KEY, payload)
        req_logger.info(
            "[gateway] Queued job for room",
            personalityId=body.get("personalityId"),
            persona=body.get("persona"),
            voiceId=body.get("voice"),
            voiceProvider=body.get("voiceProvider"),
            debugTraceId=debug_trace_id,
        )
        return {"status": "queued", "message": "Bot launch requested", "debugTraceId": debug_trace_id}
    except Exception as e:
        # If queue fails, we should try to clear the pending lock
        try:
            r.delete(lock_key)
        except Exception:
            pass
        req_logger.error(f"[gateway] Redis push failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/admin", dependencies=[Depends(require_auth)])
async def send_admin_message(body: AdminMessage, request: Request):
    # Require room_url; admin messaging is room-keyed
    if not body.room_url:
        raise HTTPException(status_code=400, detail="room_url is required for admin messaging")

    header_session_id = request.headers.get("x-session-id") or None
    header_user_id = request.headers.get("x-user-id") or None
    header_user_name = request.headers.get("x-user-name") or None

    sender_id = body.sender_id or header_user_id or "system"
    sender_name = body.sender_name or header_user_name or "System"

    admin_logger = bind_context_logger(
        room_url=body.room_url,
        session_id=header_session_id,
        user_id=header_user_id or sender_id,
        user_name=header_user_name or sender_name,
        tag="[gateway]",
    )

    try:
        # Construct payload matching RedisClient format
        import datetime
        
        payload = {
            "id": f"admin_{int(datetime.datetime.now().timestamp() * 1000)}_{os.urandom(4).hex()}",
            "type": "admin_message", 
            "timestamp": datetime.datetime.now().isoformat(),
            "message": body.message,
            "mode": body.mode,
            "sender_id": sender_id,
            "sender_name": sender_name,
            "room_url": body.room_url,
            "session_id": header_session_id,
            "user_id": header_user_id or sender_id,
            "user_name": header_user_name or sender_name,
        }
        
        payload_str = json.dumps(payload)

        if USE_REDIS and r:
            # Redis path: publish + queue
            channel = f"admin:bot:{body.room_url}"
            r.publish(channel, payload_str)

            queue_key = f"admin:queue:{body.room_url}"
            r.rpush(queue_key, payload_str)
            r.expire(queue_key, 3600)
            
            admin_logger.info(f"[gateway] Sent admin message via Redis to {channel} (room: {body.room_url})")
        else:
            # File-based fallback for direct runner mode (USE_REDIS=false)
            # Write admin message as JSON file for the file-polling loop to pick up.
            # The bot polls for admin-{pid}-*.json in BOT_ADMIN_MESSAGE_DIR.
            from pathlib import Path
            from core.config import BOT_ADMIN_MESSAGE_DIR
            admin_dir = Path(BOT_ADMIN_MESSAGE_DIR()).expanduser()
            admin_dir.mkdir(parents=True, exist_ok=True)
            
            # In direct runner mode, bot runs in the same process as gateway
            bot_pid = os.getpid()
            filename = f"admin-{bot_pid}-{payload['id']}.json"
            filepath = admin_dir / filename
            filepath.write_text(payload_str)
            
            admin_logger.info(f"[gateway] Wrote admin message file {filename} (room: {body.room_url})")

        return {"status": "ok", "id": payload["id"], "room_url": body.room_url}
        
    except Exception as e:
        admin_logger.error(f"[gateway] Admin message failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class LeaveRequest(BaseModel):
    room_url: str


@app.post("/leave", dependencies=[Depends(require_auth)])
async def leave_room(body: LeaveRequest, request: Request):
    """Clean up room state when client leaves.
    
    Clears pending config from Redis to prevent stale sprite/voice config
    from affecting the next session in the same room.
    """
    # Direct runner mode - clear in-memory state and terminate actual session
    if (not USE_REDIS) or (not r):
        logger.info(
            f"[gateway] LEAVE REQUEST START: room_url={body.room_url}, "
            f"active_rooms_before={dict(active_rooms)}"
        )
        
        # Check runner sessions before cleanup
        try:
            from runner_main import sessions as runner_sessions, _first_session_for_room
            runner_session = _first_session_for_room(body.room_url)
            logger.info(
                f"[gateway] LEAVE: Runner sessions state: total={len(runner_sessions)}, "
                f"session_ids={list(runner_sessions.keys())}, "
                f"session_for_room={runner_session.id if runner_session else None}"
            )
        except Exception as e:
            logger.warning(f"[gateway] LEAVE: Could not check runner sessions: {e}")
        
        async with active_rooms_lock:
            removed = active_rooms.pop(body.room_url, None)
            logger.info(
                f"[gateway] LEAVE: Removed from active_rooms: room_url={body.room_url}, "
                f"removed={removed}, remaining_active_rooms={dict(active_rooms)}"
            )
            
            if removed:
                logger.info(
                    f"[gateway] LEAVE: Removed entry details: status={removed.get('status')}, "
                    f"session_id={removed.get('session_id')}, timestamp={removed.get('timestamp')}"
                )
                # Also terminate the actual session in runner_main if it exists
                session_id = removed.get("session_id")
                if session_id:
                    try:
                        from runner_main import sessions, _sessions_for_room
                        # Find ALL sessions for this room (not just the first one!)
                        room_sessions = _sessions_for_room(body.room_url)
                        if room_sessions:
                            logger.info(
                                f"[gateway] LEAVE: Found {len(room_sessions)} session(s) for room {body.room_url}, "
                                f"terminating all"
                            )
                            for existing_session in room_sessions:
                                logger.info(
                                    f"[gateway] LEAVE: Terminating session: id={existing_session.id}, "
                                    f"room_url={existing_session.room_url}, task_done={existing_session.task.done()}"
                                )
                                if not existing_session.task.done():
                                    logger.info(f"[gateway] LEAVE: Cancelling task for session {existing_session.id}")
                                    existing_session.task.cancel()
                                    try:
                                        await asyncio.wait_for(existing_session.task, timeout=5)
                                        logger.info(f"[gateway] LEAVE: Session {existing_session.id} cancelled successfully")
                                    except (asyncio.TimeoutError, asyncio.CancelledError) as e:
                                        logger.warning(
                                            f"[gateway] LEAVE: Session {existing_session.id} did not cancel cleanly: {e}"
                                        )
                                # Remove from sessions registry
                                sessions.pop(existing_session.id, None)
                                logger.info(
                                    f"[gateway] LEAVE: Session {existing_session.id} terminated and removed"
                                )
                            logger.info(
                                f"[gateway] LEAVE: All sessions for room {body.room_url} terminated, "
                                f"remaining_sessions={len(sessions)}, session_ids={list(sessions.keys())}"
                            )
                        else:
                            logger.warning(
                                f"[gateway] LEAVE: No sessions found for room_url={body.room_url} "
                                f"in runner_sessions"
                            )
                    except ImportError as e:
                        logger.warning(
                            f"[gateway] LEAVE: Could not import runner_main to terminate session: {e}"
                        )
                    except Exception as e:
                        logger.error(
                            f"[gateway] LEAVE: Error terminating session: {e}",
                            exc_info=True
                        )
                # Remove any in-memory user->bot mappings for this room.
                deleted_user_mappings = await _cleanup_direct_user_bot_mappings_for_room(body.room_url)
                if deleted_user_mappings:
                    logger.info(
                        f"[gateway] LEAVE: Direct mode removed {deleted_user_mappings} user_bot mappings for room {body.room_url}"
                    )
            else:
                logger.info(f"[gateway] LEAVE: No entry found in active_rooms for {body.room_url}")
                # Still try to clean up any stale sessions for this room
                try:
                    from runner_main import sessions, _first_session_for_room
                    existing_session = _first_session_for_room(body.room_url)
                    if existing_session:
                        logger.warning(
                            f"[gateway] LEAVE: Found orphaned session {existing_session.id} for room {body.room_url}, "
                            f"task_done={existing_session.task.done()}, terminating"
                        )
                        if not existing_session.task.done():
                            existing_session.task.cancel()
                            try:
                                await asyncio.wait_for(existing_session.task, timeout=5)
                            except (asyncio.TimeoutError, asyncio.CancelledError):
                                pass
                        sessions.pop(existing_session.id, None)
                        logger.info(
                            f"[gateway] LEAVE: Orphaned session {existing_session.id} removed, "
                            f"remaining_sessions={len(sessions)}"
                        )
                    else:
                        logger.info(f"[gateway] LEAVE: No orphaned session found for {body.room_url}")
                except (ImportError, Exception) as e:
                    logger.debug(f"[gateway] LEAVE: Could not check for orphaned sessions: {e}")
                # Also remove stale user_bot mappings in direct mode even if active_rooms entry was missing.
                deleted_user_mappings = await _cleanup_direct_user_bot_mappings_for_room(body.room_url)
                if deleted_user_mappings:
                    logger.info(
                        f"[gateway] LEAVE: Direct mode removed {deleted_user_mappings} stale user_bot mappings for room {body.room_url}"
                    )
        
        # Final state check
        try:
            from runner_main import sessions as runner_sessions, _first_session_for_room
            runner_session = _first_session_for_room(body.room_url)
            logger.info(
                f"[gateway] LEAVE COMPLETE: room_url={body.room_url}, "
                f"active_rooms={dict(active_rooms)}, runner_sessions_count={len(runner_sessions)}, "
                f"session_for_room={runner_session.id if runner_session else None}"
            )
        except Exception as e:
            logger.warning(f"[gateway] LEAVE COMPLETE: Could not verify final state: {e}")
            
        return {"status": "ok", "room_url": body.room_url, "message": "Direct mode cleanup"}

    header_session_id = request.headers.get("x-session-id") or None
    header_user_id = request.headers.get("x-user-id") or None

    leave_logger = bind_context_logger(
        room_url=body.room_url,
        session_id=header_session_id,
        user_id=header_user_id,
        tag="[gateway]",
    )

    try:
        # Clear pending config keys so next session starts fresh
        config_key = f"bot:config:latest:{body.room_url}"
        config_hash_key = f"bot:config:hash:{body.room_url}"
        
        # Also clear room_active and room_keepalive keys to signal operator
        # that no bot is active. This prevents "DUPLICATE REJECTED" errors
        # when user quickly starts a new session (within 3s shutdown delay).
        room_active_key = f"room_active:{body.room_url}"
        room_keepalive_key = f"room_keepalive:{body.room_url}"
        
        leave_logger.info(f"[gateway] Preparing to delete keys for leave cleanup for room {body.room_url}: {config_key}, {config_hash_key}, {room_active_key}, {room_keepalive_key}")
        deleted = r.delete(config_key, config_hash_key, room_active_key, room_keepalive_key)
        deleted_user_mappings = _cleanup_user_bot_mappings_for_room(r, body.room_url)
        
        leave_logger.info(
            f"[gateway] Leave cleanup for room, deleted {deleted}/4 keys "
            f"(config_latest, config_hash, room_active, room_keepalive), "
            f"user_bot_mappings_removed={deleted_user_mappings}"
        )
        return {
            "status": "ok",
            "room_url": body.room_url,
            "keys_deleted": deleted,
            "user_bot_mappings_deleted": deleted_user_mappings,
        }

    except Exception as e:
        leave_logger.error(f"[gateway] Leave cleanup failed: {e}")
        # Non-critical - don't fail the request
        return {"status": "ok", "room_url": body.room_url, "warning": str(e)}


@app.post("/config", dependencies=[Depends(require_auth)])
async def update_config(request: ConfigRequest):
    if not r:
        raise HTTPException(status_code=503, detail="Redis not available")
    config_logger = bind_context_logger(
        room_url=request.room_url,
        session_id=request.sessionId,
        user_id=request.sessionUserId,
        user_name=request.sessionUserName,
        tag="[gateway]",
    )
    
    # We no longer require the bot to be fully "running" to accept config.
    # We publish to a room-based channel and set a latest-config key.
    # The bot will pick this up on startup or via pubsub.
    
    # Check if room is at least known (active or pending)
    lock_key = f"room_active:{request.room_url}"
    existing_state = r.get(lock_key)
    
    if not existing_state:
        # Try with/without trailing slash
        alt_url = request.room_url.rstrip('/') if request.room_url.endswith('/') else request.room_url + '/'
        alt_key = f"room_active:{alt_url}"
        existing_state = r.get(alt_key)
        
        if existing_state:
            lock_key = alt_key
            # Update request room_url to match the one in Redis for consistency
            request.room_url = alt_url
    
    if not existing_state:
        # If the room isn't even pending, we usually can't configure a bot that doesn't exist.
        # However, to handle race conditions where /config arrives before /join is fully processed,
        # we allow persisting the config. The bot will pick it up on startup via the latest-config key.
        config_logger.warning("Received config for unknown room; persisting for startup race handling")
    
    # We don't care if status is "pending" or "running".
    # We persist the config so the bot finds it when it's ready.
    
    payload_dict = request.model_dump(mode="json", exclude_none=True)
    payload = json.dumps(payload_dict, sort_keys=True)
    
    # Deduplicate config updates - skip if identical to last published config
    config_hash = hashlib.sha256(payload.encode()).hexdigest()[:16]
    config_hash_key = f"bot:config:hash:{request.room_url}"
    last_hash = r.get(config_hash_key)
    
    # Handle both bytes and str (depends on Redis client's decode_responses setting)
    if last_hash:
        last_hash_str = last_hash.decode() if isinstance(last_hash, bytes) else last_hash
    else:
        last_hash_str = None
    
    if last_hash_str and last_hash_str == config_hash:
        config_logger.info("Config unchanged (hash match), skipping publish", hash=config_hash[:8])
        return {"status": "ok", "message": "Config unchanged, skipped"}
    
    config_logger.info("Config payload", payload=payload_dict)
    
    # Store the hash for deduplication (TTL matches config key)
    r.setex(config_hash_key, 300, config_hash)
    
    # 1. Set latest config key (TTL 5 minutes to allow for startup delays)
    config_key = f"bot:config:latest:{request.room_url}"
    r.setex(config_key, 300, payload)
    
    # 2. Publish to room-based channel
    channel = f"bot:config:room:{request.room_url}"
    r.publish(channel, payload)
    
    config_logger.info(
        "Published config update",
        channel=channel,
        configKey=config_key,
    )
    
    return {"status": "ok", "message": "Config update published/queued"}

@app.get("/api/room/active-note")
async def get_active_note(room_url: str):
    """Get the active note for a session.
    
    Returns 200 OK with has_active_note=False if no note is active,
    instead of 404, to avoid frontend errors for late joiners.
    """
    note_id = await get_active_note_id(room_url)
    owner_id = await get_active_note_owner(room_url)
    
    if note_id:
        return {
            "has_active_note": True,
            "note_id": note_id,
            "owner_id": owner_id,
            "note_title": "Shared Note" # We don't store title in Redis yet
        }
    
    return {
        "has_active_note": False,
        "note_id": None
    }


@app.post("/api/room/active-note", dependencies=[Depends(require_auth)])
async def set_active_note(body: ActiveNoteRequest):

    if not body.room_url:
        raise HTTPException(status_code=400, detail="room_url is required")

    note_logger = bind_context_logger(
        room_url=body.room_url,
        session_id=body.owner,
        user_id=body.owner,
        user_name=None,
        tag="[gateway]",
    )

    try:
        await set_active_note_id(body.room_url, body.note_id, owner=body.owner)
        note_logger.info("Updated active note", noteId=body.note_id, owner=body.owner)
        return {"status": "ok", "note_id": body.note_id}
    except Exception as e:
        note_logger.error("Failed to set active note", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/room/active-applet")
async def get_active_applet(room_url: str):
    """Get the active applet for a session.
    
    Returns 200 OK with has_active_applet=False if no applet is active,
    instead of 404, to avoid frontend errors for late joiners.
    """
    applet_id = await get_active_applet_id(room_url)
    owner_id = await get_active_applet_owner(room_url)
    
    if applet_id:
        return {
            "has_active_applet": True,
            "applet_id": applet_id,
            "owner_id": owner_id
        }
    
    return {
        "has_active_applet": False,
        "applet_id": None
    }


@app.post("/api/room/active-applet", dependencies=[Depends(require_auth)])
async def set_active_applet(body: ActiveAppletRequest):

    if not body.room_url:
        raise HTTPException(status_code=400, detail="room_url is required")

    applet_logger = bind_context_logger(
        room_url=body.room_url,
        session_id=body.owner,
        user_id=body.owner,
        user_name=None,
        tag="[gateway]",
    )

    try:
        await set_active_applet_id(body.room_url, body.applet_id, owner=body.owner)
        applet_logger.info("Updated active applet", appletId=body.applet_id, owner=body.owner)
        return {"status": "ok", "applet_id": body.applet_id}
    except Exception as e:
        applet_logger.error("Failed to set active applet", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

# ---------------------------------------------------------------------------
# OpenClaw → PearlOS UI event bridge
# ---------------------------------------------------------------------------

class EmitEventRequest(BaseModel):
    event: str                          # e.g. "youtube.search", "app.open"
    payload: Dict[str, Any] = {}        # event-specific data
    room_url: str | None = None         # optional; defaults to first active room

@app.post("/emit-event")
async def emit_event(body: EmitEventRequest):
    """Send a nia.event envelope to the PearlOS frontend via Daily REST API.
    
    This allows OpenClaw (or any external caller) to trigger PearlOS UI actions
    (open apps, play YouTube, control windows, etc.) without going through Pipecat.
    """
    import time as _time

    api_key = os.getenv("DAILY_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="DAILY_API_KEY not configured")

    # Build nia.event envelope (same shape as AppMessageForwarder)
    envelope = {
        "v": 1,
        "kind": "nia.event",
        "seq": 0,  # external events use seq=0
        "ts": int(_time.time() * 1000),
        "event": body.event,
        "payload": body.payload,
    }

    # Resolve target room (optional — Daily delivery is best-effort)
    # Prefer non-auto-created rooms (real user sessions) over the persistent default room.
    room_url = body.room_url
    if not room_url:
        async with active_rooms_lock:
            best_url = None
            best_is_auto = True
            best_ts = 0
            for url, info in active_rooms.items():
                if info.get("status") != "running":
                    continue
                is_auto = info.get("auto_created", False)
                ts = info.get("timestamp", 0)
                if best_url is None or (best_is_auto and not is_auto) or (is_auto == best_is_auto and ts > best_ts):
                    best_url = url
                    best_is_auto = is_auto
                    best_ts = ts
            room_url = best_url

    # Derive room name for session scoping
    room_name = None
    if room_url:
        room_name = room_url.rstrip("/").split("/")[-1].split("?")[0] or None

    # Broadcast to WebSocket clients scoped to this room/session
    await ws_broadcast(envelope, session_id=room_name)

    if not room_url or not room_name:
        logger.info(f"[emit-event] No active room; delivered {body.event} via WebSocket only")
        return {"ok": True, "event": body.event, "delivery": "websocket-only"}

    # Also send via Daily REST API if room is available
    url = f"https://api.daily.co/v1/rooms/{room_name}/send-app-message"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json={"data": envelope, "recipient": "*"}, headers=headers, timeout=10) as resp:
                if resp.status >= 300:
                    txt = await resp.text()
                    if resp.status == 404:
                        logger.debug(f"[emit-event] Daily room {room_name} not active (WebSocket delivered): {txt[:120]}")
                    else:
                        logger.warning(f"[emit-event] Daily API error: {resp.status} {txt[:200]}")
                logger.info(f"[emit-event] Sent {body.event} to {room_name} (Daily + WebSocket)")
                return {"ok": True, "event": body.event, "room": room_name, "delivery": "daily+websocket"}
    except Exception as e:
        logger.warning(f"[emit-event] Daily delivery failed (WebSocket still sent): {e}")
        return {"ok": True, "event": body.event, "delivery": "websocket-only", "daily_error": str(e)}


# ---------------------------------------------------------------------------
# Tool proxy bridge – OpenClaw ↔ PearlOS bot tools
# ---------------------------------------------------------------------------

class ToolInvokeRequest(BaseModel):
    tool_name: str
    params: Dict[str, Any] = {}
    room_url: str | None = None  # optional; defaults to first active room
    # Direct execution context (used when no Daily room is active)
    tenant_id: str | None = None
    user_id: str | None = None


@app.get("/api/tools/list")
async def list_tools():
    """Return all discovered bot tools with name, description, parameters, and feature_flag."""
    try:
        from tools.discovery import get_discovery
        discovery = get_discovery()
        tools = discovery.discover_tools()
        tool_list = []
        for name, meta in sorted(tools.items()):
            tool_list.append({
                "name": name,
                "description": meta.get("description", ""),
                "parameters": meta.get("parameters", {}),
                "feature_flag": meta.get("feature_flag"),
                "passthrough": meta.get("passthrough", False),
            })
        return {"tools": tool_list, "count": len(tool_list)}
    except Exception as e:
        logger.error(f"[tools] Failed to list tools: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Direct tool execution handlers (no Daily room required)
# ---------------------------------------------------------------------------

# Map of tool_name -> async handler(params, tenant_id, user_id) -> dict
# These execute data operations directly via Mesh, returning results synchronously.
_DIRECT_TOOL_HANDLERS: Dict[str, Any] = {}


def _register_direct_handlers():
    """Register direct execution handlers for notes tools."""
    from actions import notes_actions

    async def _handle_bot_list_notes(params: dict, tenant_id: str, user_id: str) -> dict:
        limit = params.get("limit", 50)
        notes = await notes_actions.list_notes(tenant_id, user_id, limit=limit)
        return {
            "success": True,
            "notes": notes,
            "count": len(notes),
            "user_message": f"Found {len(notes)} note(s).",
        }

    async def _handle_bot_create_note(params: dict, tenant_id: str, user_id: str) -> dict:
        title = params.get("title", "")
        content = params.get("content", "")
        mode = params.get("mode", "personal")
        if not title:
            return {"success": False, "error": "title is required"}
        note = await notes_actions.create_note(tenant_id, user_id, title, content, mode)
        if note:
            return {
                "success": True,
                "note": note,
                "user_message": f"Created note '{title}'.",
            }
        return {"success": False, "error": "Failed to create note via Mesh"}

    async def _handle_bot_replace_note(params: dict, tenant_id: str, user_id: str) -> dict:
        content = params.get("content", "")
        title = params.get("title")
        note_id = params.get("note_id")
        if not note_id:
            return {"success": False, "error": "note_id is required for direct invocation (no active note context)"}
        if not content:
            return {"success": False, "error": "content is required"}
        ok = await notes_actions.update_note_content(tenant_id, note_id, content, user_id, title)
        if ok:
            updated = await notes_actions.get_note_by_id(tenant_id, note_id)
            return {"success": True, "note": updated, "user_message": "Note updated."}
        return {"success": False, "error": "Failed to update note"}

    async def _handle_bot_open_note(params: dict, tenant_id: str, user_id: str) -> dict:
        note_id = params.get("note_id")
        title = params.get("title")
        if note_id:
            note = await notes_actions.get_note_by_id(tenant_id, note_id)
            if note:
                return {"success": True, "note": note, "user_message": f"Opened note: {note.get('title', 'Untitled')}"}
            return {"success": False, "error": f"Note {note_id} not found"}
        if title:
            matches = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
            if matches and len(matches) == 1:
                return {"success": True, "note": matches[0], "user_message": f"Opened note: {matches[0].get('title', 'Untitled')}"}
            if matches and len(matches) > 1:
                return {"success": False, "error": "Multiple notes match that title", "matches": [{"_id": n.get("_id"), "title": n.get("title")} for n in matches]}
            return {"success": False, "error": f"No note matching '{title}'"}
        return {"success": False, "error": "note_id or title required"}

    async def _handle_bot_read_current_note(params: dict, tenant_id: str, user_id: str) -> dict:
        note_id = params.get("note_id")
        if not note_id:
            return {"success": False, "error": "note_id is required for direct invocation (no active note context)"}
        note = await notes_actions.get_note_by_id(tenant_id, note_id)
        if not note:
            return {"success": False, "error": "Note not found"}
        return {"success": True, "note": note, "user_message": f"Here's the content of '{note.get('title', 'Untitled')}'."}

    async def _handle_bot_delete_note(params: dict, tenant_id: str, user_id: str) -> dict:
        note_id = params.get("note_id")
        title = params.get("title")
        confirm = params.get("confirm", False)
        if not confirm:
            return {"success": False, "error": "Set confirm=true to delete"}
        if not note_id and title:
            matches = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
            if matches and len(matches) == 1:
                note_id = matches[0].get("_id")
            elif matches and len(matches) > 1:
                return {"success": False, "error": "Multiple notes match that title", "matches": [{"_id": n.get("_id"), "title": n.get("title")} for n in matches]}
            else:
                return {"success": False, "error": f"No note matching '{title}'"}
        if not note_id:
            return {"success": False, "error": "note_id or title required"}
        ok = await notes_actions.delete_note(tenant_id, note_id, user_id)
        if ok:
            return {"success": True, "user_message": "Note deleted."}
        return {"success": False, "error": "Failed to delete note (not found or permission denied)"}

    async def _handle_bot_save_note(params: dict, tenant_id: str, user_id: str) -> dict:
        # Notes auto-save via Mesh; this is a no-op acknowledgement
        return {"success": True, "user_message": "Note saved (auto-persisted via Mesh)."}

    _DIRECT_TOOL_HANDLERS["bot_list_notes"] = _handle_bot_list_notes
    _DIRECT_TOOL_HANDLERS["bot_create_note"] = _handle_bot_create_note
    _DIRECT_TOOL_HANDLERS["bot_replace_note"] = _handle_bot_replace_note
    _DIRECT_TOOL_HANDLERS["bot_open_note"] = _handle_bot_open_note
    _DIRECT_TOOL_HANDLERS["bot_read_current_note"] = _handle_bot_read_current_note
    _DIRECT_TOOL_HANDLERS["bot_delete_note"] = _handle_bot_delete_note
    _DIRECT_TOOL_HANDLERS["bot_save_note"] = _handle_bot_save_note

    # Wonder Canvas tools — pure UI, no Mesh/DB needed.
    # Direct handlers just return success; the broadcast mechanism sends
    # the nia.event envelope with the HTML payload to all connected clients.
    async def _handle_wonder_passthrough(params: dict, tenant_id: str, user_id: str) -> dict:
        return {"success": True, "user_message": "Wonder Canvas updated."}

    for _wt in [
        "bot_wonder_canvas_scene",
        "bot_wonder_canvas_add",
        "bot_wonder_canvas_remove",
        "bot_wonder_canvas_clear",
        "bot_wonder_canvas_animate",
        "bot_wonder_canvas_template",
    ]:
        _DIRECT_TOOL_HANDLERS[_wt] = _handle_wonder_passthrough

    # bot_end_call — emits bot.session.end nia.event; the actual Pipecat
    # session teardown is handled by the Daily pipeline when the bot process
    # receives the event via app-message. The gateway's role is just to
    # broadcast the UI event so the frontend can react immediately.
    async def _handle_bot_end_call(params: dict, tenant_id: str, user_id: str) -> dict:
        import time as _time

        result = {"success": True, "user_message": "Closing the assistant session."}

        # Broadcast bot.session.end BEFORE returning so the frontend receives it
        # even if the Daily session is torn down immediately after.
        ui_envelope = {
            "v": 1,
            "kind": "nia.event",
            "seq": 0,
            "ts": int(_time.time() * 1000),
            "event": "bot.session.end",
            "payload": {"reason": "bot_end_call"},
        }

        # 1. WebSocket broadcast (reaches frontend even without Daily)
        try:
            await ws_broadcast(ui_envelope)
        except Exception as _ws_err:
            logger.warning(f"[bot_end_call] WS broadcast failed: {_ws_err}")

        # 2. Daily REST API broadcast (reaches in-call participants)
        _room_url = None
        async with active_rooms_lock:
            for _u, _i in active_rooms.items():
                if _i.get("status") == "running":
                    _room_url = _u
                    break

        if _room_url:
            _room_name = _room_url.rstrip("/").split("/")[-1].split("?")[0]
            _api_key = os.getenv("DAILY_API_KEY", "")
            if _room_name and _api_key:
                try:
                    async with aiohttp.ClientSession() as _sess:
                        async with _sess.post(
                            f"https://api.daily.co/v1/rooms/{_room_name}/send-app-message",
                            json={"data": ui_envelope, "recipient": "*"},
                            headers={
                                "Authorization": f"Bearer {_api_key}",
                                "Content-Type": "application/json",
                            },
                            timeout=5,
                        ) as _resp:
                            if _resp.status < 300:
                                logger.info(f"[bot_end_call] Delivered bot.session.end via Daily to {_room_name}")
                            else:
                                _txt = await _resp.text()
                                logger.warning(f"[bot_end_call] Daily broadcast error: {_resp.status} {_txt[:120]}")
                except Exception as _daily_err:
                    logger.warning(f"[bot_end_call] Daily broadcast failed: {_daily_err}")

        return result

    _DIRECT_TOOL_HANDLERS["bot_end_call"] = _handle_bot_end_call


# Register on import
try:
    _register_direct_handlers()
except Exception as _reg_err:
    logger.warning(f"[tools] Failed to register direct tool handlers (will retry on first invoke): {_reg_err}")


async def _broadcast_tool_event_best_effort(tool_name: str, params: dict, result: dict, room_url: str | None):
    """Best-effort broadcast of tool result events via Daily + WebSocket.

    Called after direct tool execution so the UI stays in sync when a room IS active.
    Emits both a nia.tool_result AND the corresponding nia.event UI envelope so
    the frontend can react to tool outcomes without a Daily room.
    """
    import time as _time

    envelope = {
        "v": 1,
        "kind": "nia.tool_result",
        "seq": 0,
        "ts": int(_time.time() * 1000),
        "tool_name": tool_name,
        "params": params,
        "result": result,
        "source": "rest-api",
    }

    # Derive room name for session scoping
    _room_name_for_scope = None
    if room_url:
        _room_name_for_scope = room_url.rstrip("/").split("/")[-1].split("?")[0] or None
    else:
        async with active_rooms_lock:
            for _url, _info in active_rooms.items():
                if _info.get("status") == "running":
                    _room_name_for_scope = _url.rstrip("/").split("/")[-1].split("?")[0] or None
                    break

    # WebSocket broadcast scoped to active room/session
    await ws_broadcast(envelope, session_id=_room_name_for_scope)

    # Emit proper nia.event UI envelopes for tools that have UI side-effects.
    # This mirrors what the in-process forwarder does during a Daily session.
    _TOOL_UI_EVENTS: dict[str, str] = {
        "bot_open_note": "note.open",
        "bot_create_note": "note.open",
        "bot_replace_note": "note.updated",
        "bot_add_note_content": "note.updated",
        "bot_remove_note_content": "note.updated",
        "bot_replace_note_content": "note.updated",
        "bot_delete_note": "note.deleted",
        "bot_save_note": "note.saved",
        "bot_list_notes": "notes.list",
        "bot_close_note": "note.close",
        "bot_search_youtube": "youtube.search",
        "bot_play_youtube": "youtube.play",
        "bot_pause_youtube": "youtube.pause",
        "bot_next_youtube": "youtube.next",
        "bot_open_app": "app.open",
        "bot_close_apps": "apps.close",
        "bot_open_browser": "browser.open",
        "bot_close_browser": "browser.close",
        "bot_minimize_window": "window.minimize",
        "bot_maximize_window": "window.maximize",
        "bot_restore_window": "window.restore",
        "bot_snap_left": "window.snap.left",
        "bot_snap_right": "window.snap.right",
        "bot_reset_window": "window.reset",
        "bot_switch_desktop_mode": "desktop.mode.switch",
        "bot_close_view": "view.close",
        "bot_notes_refresh": "notes.refresh",
        "bot_note_mode_switch": "note.mode.switch",
        "bot_note_download": "note.download",
        # App open/close tools → app.open with app name in payload
        "bot_open_notes": "app.open",
        "bot_close_notes": "apps.close",
        "bot_open_youtube": "app.open",
        "bot_close_youtube": "apps.close",
        "bot_open_gmail": "app.open",
        "bot_close_gmail": "apps.close",
        "bot_open_terminal": "app.open",
        "bot_close_terminal": "apps.close",
        "bot_open_google_drive": "app.open",
        "bot_close_google_drive": "apps.close",
        "bot_open_creation_engine": "app.open",
        "bot_close_applet_creation_engine": "apps.close",
        "bot_open_enhanced_browser": "browser.open",
        "bot_close_browser_window": "browser.close",
        "bot_search_youtube_videos": "youtube.search",
        "bot_play_youtube_video": "youtube.play",
        "bot_pause_youtube_video": "youtube.pause",
        "bot_play_next_youtube_video": "youtube.next",
        "bot_snap_window_left": "window.snap.left",
        "bot_snap_window_right": "window.snap.right",
        "bot_reset_window_position": "window.reset",
        "bot_switch_note_mode": "note.mode.switch",
        # Wonder Canvas tools
        "bot_wonder_canvas_scene": "wonder.scene",
        "bot_wonder_canvas_add": "wonder.add",
        "bot_wonder_canvas_remove": "wonder.remove",
        "bot_wonder_canvas_clear": "wonder.clear",
        "bot_wonder_canvas_animate": "wonder.animate",
        "bot_wonder_canvas_template": "wonder.scene",
        # Session control
        "bot_end_call": "bot.session.end",
    }

    # Map tool names to app names for app.open events
    _TOOL_APP_NAMES: dict[str, str] = {
        "bot_open_notes": "notes",
        "bot_open_youtube": "youtube",
        "bot_open_gmail": "gmail",
        "bot_open_terminal": "terminal",
        "bot_open_google_drive": "google-drive",
        "bot_open_creation_engine": "creation-engine",
    }

    # Map close tools to their app names (for apps.close payload.apps array)
    _TOOL_CLOSE_APP_NAMES: dict[str, str] = {
        "bot_close_notes": "notes",
        "bot_close_youtube": "youtube",
        "bot_close_gmail": "gmail",
        "bot_close_terminal": "terminal",
        "bot_close_google_drive": "google-drive",
        "bot_close_applet_creation_engine": "creation-engine",
    }

    ui_event = _TOOL_UI_EVENTS.get(tool_name)
    if ui_event and isinstance(result, dict) and result.get("success"):
        # Build payload from params + result for the UI event
        ui_payload = dict(params) if params else {}

        # Wonder Canvas template tool: render the template server-side so the
        # frontend receives ready-to-display HTML (not raw template params).
        if tool_name == "bot_wonder_canvas_template" and ui_event == "wonder.scene":
            try:
                from tools.wonder_canvas_templates import render_template as _render_wc
                _tmpl_name = (params or {}).get("template", "")
                _tmpl_data = (params or {}).get("data", {})
                _rendered_html = _render_wc(_tmpl_name, **_tmpl_data)
                ui_payload = {
                    "html": _rendered_html,
                    "css": "",
                    "transition": (params or {}).get("transition", "fade"),
                    "layer": "main",
                }
            except Exception as _tmpl_err:
                logger.warning(f"[tools] Wonder template render failed in broadcast: {_tmpl_err}")
                # Fall through with raw params — frontend will ignore (no html key)
        # Merge select result fields (note data, etc.)
        if "note" in result:
            note = result["note"]
            ui_payload.setdefault("noteId", note.get("_id") or note.get("id"))
            ui_payload.setdefault("title", note.get("title"))
            # For note.updated events, include content at top level for frontend animation
            if note.get("content") is not None:
                ui_payload.setdefault("content", note.get("content"))
            ui_payload["note"] = note  # pass full note object for immediate rendering
        if "notes" in result:
            ui_payload["notes"] = result["notes"]
        # Inject app name for open events
        open_app = _TOOL_APP_NAMES.get(tool_name)
        if open_app:
            ui_payload["app"] = open_app
        # Inject apps array for close events
        close_app = _TOOL_CLOSE_APP_NAMES.get(tool_name)
        if close_app:
            ui_payload["apps"] = [close_app]

        ui_envelope = {
            "v": 1,
            "kind": "nia.event",
            "seq": 0,
            "ts": int(_time.time() * 1000),
            "event": ui_event,
            "payload": ui_payload,
        }
        await ws_broadcast(ui_envelope, session_id=_room_name_for_scope)

        # Also deliver ui_envelope via Daily REST API so voice-session frontends
        # receive the event even when the WS bridge is stopped (Daily call active).
        # Resolve room now (before the later room_url re-resolution) so we can
        # send both ui_envelope and tool_result in the same request block below.
        _ui_room_url = room_url
        if not _ui_room_url:
            async with active_rooms_lock:
                for _u, _i in active_rooms.items():
                    if _i.get("status") == "running":
                        _ui_room_url = _u
                        break
        if _ui_room_url:
            _ui_room_name = _ui_room_url.rstrip("/").split("/")[-1].split("?")[0]
            _ui_api_key = os.getenv("DAILY_API_KEY", "")
            if _ui_room_name and _ui_api_key:
                try:
                    _ui_url = f"https://api.daily.co/v1/rooms/{_ui_room_name}/send-app-message"
                    _ui_hdrs = {"Authorization": f"Bearer {_ui_api_key}", "Content-Type": "application/json"}
                    async with aiohttp.ClientSession() as _ui_sess:
                        async with _ui_sess.post(
                            _ui_url,
                            json={"data": ui_envelope, "recipient": "*"},
                            headers=_ui_hdrs,
                            timeout=5,
                        ) as _ui_resp:
                            if _ui_resp.status >= 300 and _ui_resp.status != 404:
                                _ui_txt = await _ui_resp.text()
                                logger.debug(f"[tools] Daily ui_event error: {_ui_resp.status} {_ui_txt[:120]}")
                            else:
                                logger.info(f"[tools] Delivered nia.event '{ui_event}' via Daily to {_ui_room_name}")
                except Exception as _ui_e:
                    logger.debug(f"[tools] Daily ui_event delivery skipped: {_ui_e}")

    # Daily broadcast (best-effort, only if room active)
    if not room_url:
        async with active_rooms_lock:
            for url, info in active_rooms.items():
                if info.get("status") == "running":
                    room_url = url
                    break

    if not room_url:
        return

    room_name = room_url.rstrip("/").split("/")[-1].split("?")[0]
    api_key = os.getenv("DAILY_API_KEY", "")
    if not room_name or not api_key:
        return

    try:
        url = f"https://api.daily.co/v1/rooms/{room_name}/send-app-message"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json={"data": envelope, "recipient": "*"}, headers=headers, timeout=10) as resp:
                if resp.status >= 300:
                    txt = await resp.text()
                    logger.warning(f"[tools] Daily broadcast error: {resp.status} {txt[:200]}")
    except Exception as e:
        logger.warning(f"[tools] Daily broadcast failed (non-fatal): {e}")


@app.post("/api/tools/invoke")
async def invoke_tool(body: ToolInvokeRequest):
    """Invoke a bot tool — directly via Mesh when possible, or via Daily room relay.

    **Direct execution** (no Daily room needed):
      If the tool has a registered direct handler AND tenant_id/user_id are provided
      (or derivable), the data operation runs synchronously via the Mesh API and
      the result is returned in the response body.  A best-effort UI broadcast is
      also sent to any active Daily room / WebSocket clients.

    **Room relay** (legacy path):
      If direct execution is not available, the invocation is forwarded to the
      bot process via Daily app-message for async execution in the pipeline.
    """
    import time as _time

    # ------------------------------------------------------------------
    # 1. Try direct execution (Mesh-backed, no Daily room required)
    # ------------------------------------------------------------------
    direct_handler = _DIRECT_TOOL_HANDLERS.get(body.tool_name)

    # Lazy-retry registration if first attempt failed at import time
    if not _DIRECT_TOOL_HANDLERS and direct_handler is None:
        try:
            _register_direct_handlers()
            direct_handler = _DIRECT_TOOL_HANDLERS.get(body.tool_name)
        except Exception:
            pass

    if direct_handler:
        # Resolve tenant_id and user_id — from body, env, or room context
        tenant_id = body.tenant_id or os.getenv("DEFAULT_TENANT_ID")
        user_id = body.user_id or os.getenv("BOT_SESSION_USER_ID")

        # Pure UI tools (Wonder Canvas, etc.) don't need tenant/user context
        _UI_ONLY_TOOLS = {"bot_wonder_canvas_scene", "bot_wonder_canvas_add",
                          "bot_wonder_canvas_remove", "bot_wonder_canvas_clear",
                          "bot_wonder_canvas_animate", "bot_wonder_canvas_template",
                          "bot_end_call"}
        # Deduplication: prevent the same canvas tool from firing twice within 10s
        _CANVAS_DEDUP_TOOLS = {"bot_wonder_canvas_scene"}
        if body.tool_name in _CANVAS_DEDUP_TOOLS:
            _now = _time.monotonic()
            _dedup_key = f"{body.tool_name}:{body.room_url or 'default'}"
            _last_call = getattr(invoke_tool, '_dedup_cache', {}).get(_dedup_key, 0)
            if _now - _last_call < 10.0:
                logger.warning(f"[tools] DEDUP: Skipping duplicate {body.tool_name} call ({_now - _last_call:.1f}s since last)")
                return {
                    "ok": True,
                    "tool_name": body.tool_name,
                    "execution": "dedup_skipped",
                    "result": {"success": True, "user_message": "Wonder Canvas already updated (dedup)."},
                }
            if not hasattr(invoke_tool, '_dedup_cache'):
                invoke_tool._dedup_cache = {}
            invoke_tool._dedup_cache[_dedup_key] = _now

        if tenant_id and user_id or body.tool_name in _UI_ONLY_TOOLS:
            logger.info(f"[tools] Direct-executing {body.tool_name} (tenant={tenant_id}, user={user_id})")
            try:
                result = await direct_handler(body.params, tenant_id, user_id)
                # Best-effort UI broadcast
                asyncio.ensure_future(
                    _broadcast_tool_event_best_effort(body.tool_name, body.params, result, body.room_url)
                )
                return {
                    "ok": True,
                    "tool_name": body.tool_name,
                    "execution": "direct",
                    "result": result,
                }
            except Exception as e:
                logger.error(f"[tools] Direct execution of {body.tool_name} failed: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Direct tool execution failed: {e}")
        else:
            logger.info(
                f"[tools] Direct handler exists for {body.tool_name} but missing context "
                f"(tenant_id={tenant_id}, user_id={user_id}); falling back to room relay"
            )

    # ------------------------------------------------------------------
    # 2. Fallback: relay to bot process via Daily app-message
    # ------------------------------------------------------------------

    # Resolve tool metadata
    try:
        from tools.discovery import get_discovery
        discovery = get_discovery()
        tools = discovery.discover_tools()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tool discovery failed: {e}")

    if body.tool_name not in tools:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown tool: {body.tool_name}. Use GET /api/tools/list to see available tools.",
        )

    # Build a tool-invoke envelope that the bot process listens for
    envelope = {
        "v": 1,
        "kind": "nia.tool_invoke",
        "seq": 0,
        "ts": int(_time.time() * 1000),
        "tool_name": body.tool_name,
        "params": body.params,
        "source": "openclaw",
    }

    # Resolve room name for session scoping
    _relay_room_name = None
    _relay_room_url = body.room_url
    if _relay_room_url:
        _relay_room_name = _relay_room_url.rstrip("/").split("/")[-1].split("?")[0] or None
    else:
        async with active_rooms_lock:
            for _url, _info in active_rooms.items():
                if _info.get("status") == "running":
                    _relay_room_name = _url.rstrip("/").split("/")[-1].split("?")[0] or None
                    break

    # Broadcast to WebSocket clients scoped to active session
    await ws_broadcast(envelope, session_id=_relay_room_name)

    # For passthrough/UI tools, also emit a nia.event envelope so the
    # frontend can act on it even without a Daily room.  The _TOOL_UI_EVENTS
    # and _TOOL_APP_NAMES maps live in _broadcast_tool_event_best_effort but
    # we duplicate the lookup here for the relay path.
    _PASSTHROUGH_UI_EVENTS: dict[str, str] = {
        "bot_open_notes": "app.open",
        "bot_close_notes": "apps.close",
        "bot_open_youtube": "app.open",
        "bot_close_youtube": "apps.close",
        "bot_open_gmail": "app.open",
        "bot_close_gmail": "apps.close",
        "bot_open_terminal": "app.open",
        "bot_close_terminal": "apps.close",
        "bot_open_google_drive": "app.open",
        "bot_close_google_drive": "apps.close",
        "bot_open_creation_engine": "app.open",
        "bot_close_applet_creation_engine": "apps.close",
        "bot_open_browser": "browser.open",
        "bot_open_enhanced_browser": "browser.open",
        "bot_close_browser_window": "browser.close",
        "bot_close_view": "view.close",
        "bot_minimize_window": "window.minimize",
        "bot_maximize_window": "window.maximize",
        "bot_restore_window": "window.restore",
        "bot_snap_window_left": "window.snap.left",
        "bot_snap_window_right": "window.snap.right",
        "bot_reset_window_position": "window.reset",
        "bot_switch_desktop_mode": "desktop.mode.switch",
        "bot_search_youtube_videos": "youtube.search",
        "bot_play_youtube_video": "youtube.play",
        "bot_pause_youtube_video": "youtube.pause",
        "bot_play_next_youtube_video": "youtube.next",
        "bot_play_soundtrack": "soundtrack.control",
        "bot_stop_soundtrack": "soundtrack.control",
        "bot_next_soundtrack_track": "soundtrack.control",
        "bot_adjust_soundtrack_volume": "soundtrack.control",
        "bot_set_soundtrack_volume": "soundtrack.control",
        "bot_switch_note_mode": "note.mode.switch",
        "bot_show_share_dialog": "share.show",
        # Wonder Canvas tools
        "bot_wonder_canvas_scene": "wonder.scene",
        "bot_wonder_canvas_add": "wonder.add",
        "bot_wonder_canvas_remove": "wonder.remove",
        "bot_wonder_canvas_clear": "wonder.clear",
        "bot_wonder_canvas_animate": "wonder.animate",
        "bot_wonder_canvas_template": "wonder.scene",
        # Session control — emit bot.session.end so frontend teardown triggers
        "bot_end_call": "bot.session.end",
    }
    _PASSTHROUGH_APP_NAMES: dict[str, str] = {
        "bot_open_notes": "notes",
        "bot_open_youtube": "youtube",
        "bot_open_gmail": "gmail",
        "bot_open_terminal": "terminal",
        "bot_open_google_drive": "google-drive",
        "bot_open_creation_engine": "creation-engine",
    }

    # Map close tools to their app names (for apps.close payload.apps array)
    _PASSTHROUGH_CLOSE_APP_NAMES: dict[str, str] = {
        "bot_close_notes": "notes",
        "bot_close_youtube": "youtube",
        "bot_close_gmail": "gmail",
        "bot_close_terminal": "terminal",
        "bot_close_google_drive": "google-drive",
        "bot_close_applet_creation_engine": "creation-engine",
    }

    # Map soundtrack tools to their control actions
    _SOUNDTRACK_ACTIONS: dict[str, dict] = {
        "bot_play_soundtrack": {"action": "play"},
        "bot_stop_soundtrack": {"action": "stop"},
        "bot_next_soundtrack_track": {"action": "next"},
        "bot_adjust_soundtrack_volume": {"action": "adjustVolume"},
        "bot_set_soundtrack_volume": {"action": "volume"},
    }

    pt_event = _PASSTHROUGH_UI_EVENTS.get(body.tool_name)
    if pt_event:
        pt_payload = dict(body.params) if body.params else {}
        # Inject app name for app.open events
        app_name = _PASSTHROUGH_APP_NAMES.get(body.tool_name)
        if app_name:
            pt_payload["app"] = app_name
        # Inject apps array for apps.close events
        close_app_name = _PASSTHROUGH_CLOSE_APP_NAMES.get(body.tool_name)
        if close_app_name:
            pt_payload["apps"] = [close_app_name]
        # Inject soundtrack control action
        soundtrack_action = _SOUNDTRACK_ACTIONS.get(body.tool_name)
        if soundtrack_action:
            pt_payload.update(soundtrack_action)
        ui_envelope = {
            "v": 1,
            "kind": "nia.event",
            "seq": 0,
            "ts": int(_time.time() * 1000),
            "event": pt_event,
            "payload": pt_payload,
        }
        await ws_broadcast(ui_envelope, session_id=_relay_room_name)
        logger.info(f"[tools] Emitted nia.event '{pt_event}' via WebSocket for {body.tool_name}")

    # Resolve target room (optional — Daily delivery is best-effort)
    # Prefer non-auto-created rooms (real user sessions) over the persistent default room.
    room_url = body.room_url
    if not room_url:
        async with active_rooms_lock:
            best_url = None
            best_is_auto = True
            best_ts = 0
            for url, info in active_rooms.items():
                if info.get("status") != "running":
                    continue
                is_auto = info.get("auto_created", False)
                ts = info.get("timestamp", 0)
                # Pick first running room, then prefer non-auto over auto, then most recent
                if best_url is None or (best_is_auto and not is_auto) or (is_auto == best_is_auto and ts > best_ts):
                    best_url = url
                    best_is_auto = is_auto
                    best_ts = ts
            room_url = best_url

    if not room_url:
        logger.info(f"[tools] No active room; delivered {body.tool_name} invoke via WebSocket only")
        return {
            "ok": True,
            "tool_name": body.tool_name,
            "delivery": "websocket-only",
            "note": "Tool invocation sent via WebSocket. No active Daily room.",
        }

    # Derive room name from URL
    room_name = room_url.rstrip("/").split("/")[-1].split("?")[0]
    if not room_name:
        return {
            "ok": True,
            "tool_name": body.tool_name,
            "delivery": "websocket-only",
            "note": "Could not derive room name; sent via WebSocket only.",
        }

    api_key = os.getenv("DAILY_API_KEY", "")
    if not api_key:
        return {
            "ok": True,
            "tool_name": body.tool_name,
            "delivery": "websocket-only",
            "note": "DAILY_API_KEY not configured; sent via WebSocket only.",
        }

    # Also send via Daily REST API app-message to the room
    url = f"https://api.daily.co/v1/rooms/{room_name}/send-app-message"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json={"data": envelope, "recipient": "*"},
                headers=headers,
                timeout=10,
            ) as resp:
                if resp.status >= 300:
                    txt = await resp.text()
                    # 404 = room not hosting a call; WebSocket already delivered, not worth warning
                    if resp.status == 404:
                        logger.debug(f"[tools] Daily room {room_name} not active (WebSocket delivered): {txt[:120]}")
                    else:
                        logger.warning(f"[tools] Daily API error: {resp.status} {txt[:200]}")
                logger.info(
                    f"[tools] Invoked {body.tool_name} in room {room_name} (Daily + WebSocket)"
                )
                return {
                    "ok": True,
                    "tool_name": body.tool_name,
                    "room": room_name,
                    "delivery": "daily+websocket",
                    "note": "Tool execution is async. Results will appear in the voice session.",
                }
    except Exception as e:
        logger.warning(f"[tools] Daily delivery failed (WebSocket still sent): {e}")
        return {
            "ok": True,
            "tool_name": body.tool_name,
            "delivery": "websocket-only",
            "daily_error": str(e),
        }


@app.get("/default-room")
async def get_default_room():
    """Return the persistent default room URL and connection info.

    The frontend can call this on load to connect to the always-on room
    instead of creating a new one.
    """
    if not _default_room_url:
        raise HTTPException(status_code=503, detail="Default room not yet initialized")

    # Generate a fresh participant token for the caller
    try:
        from providers.daily import create_daily_room_token
        token = await create_daily_room_token(_default_room_url)
    except Exception as e:
        logger.warning(f"[default-room] Could not generate token: {e}")
        token = None

    room_info: Dict[str, Any] = {
        "room_url": _default_room_url,
        "room_name": DEFAULT_ROOM_NAME,
    }
    if token:
        room_info["token"] = token

    # Include bot session info if available
    async with active_rooms_lock:
        state = active_rooms.get(_default_room_url)
        if state:
            room_info["bot_session_id"] = state.get("session_id")
            room_info["bot_status"] = state.get("status")

    return room_info


# ---------------------------------------------------------------------------
# REST tool execution — direct data operations without Daily room requirement
# ---------------------------------------------------------------------------

class DirectToolRequest(BaseModel):
    """Execute a tool directly against the data layer (Mesh API).

    Unlike /api/tools/invoke which relays via Daily app-message, this endpoint
    executes data operations synchronously and returns results.  UI broadcast
    events are sent opportunistically when a Daily room / WS clients exist.
    """
    tool_name: str
    params: Dict[str, Any] = {}
    # Context for data operations (required for most tools)
    tenant_id: str | None = None
    user_id: str | None = None
    room_url: str | None = None  # optional; used for active-note state & broadcast


# Default tenant/user from env for local dev convenience
_DEFAULT_TENANT = os.getenv("PEARLOS_TENANT_ID", "00000000-0000-0000-0000-000000000001")
_DEFAULT_USER = os.getenv("BOT_SESSION_USER_ID", "00000000-0000-0000-0000-000000000099")


async def _broadcast_note_event(action: str, note_id: str, note: dict | None = None, mode: str | None = None):
    """Best-effort broadcast of note events to WS + Daily."""
    import time as _time
    payload = {
        "v": 1,
        "kind": "nia.event",
        "seq": 0,
        "event": "notes.refresh",
        "ts": int(_time.time() * 1000),
        "payload": {
            "noteId": note_id,
            "action": action,
            "mode": mode,
        },
    }
    if note:
        payload["payload"]["note"] = {
            "_id": note.get("_id") or note.get("page_id"),
            "title": note.get("title"),
            "content": note.get("content") if isinstance(note.get("content"), str) else (note.get("content", {}).get("content", "") if isinstance(note.get("content"), dict) else ""),
            "mode": note.get("mode"),
        }
    # Resolve room for scoping
    _refresh_room_name = None
    _refresh_room_url = None
    async with active_rooms_lock:
        for _url, _info in active_rooms.items():
            if _info.get("status") == "running":
                _refresh_room_url = _url
                _refresh_room_name = _url.rstrip("/").split("/")[-1].split("?")[0] or None
                break
    # WebSocket broadcast scoped to active session
    await ws_broadcast(payload, session_id=_refresh_room_name)
    # Daily broadcast (best-effort)
    try:
        api_key = os.getenv("DAILY_API_KEY", "")
        if api_key:
            room_url = _refresh_room_url
            if room_url:
                room_name = _refresh_room_name
                if room_name:
                    url = f"https://api.daily.co/v1/rooms/{room_name}/send-app-message"
                    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                    async with aiohttp.ClientSession() as session:
                        async with session.post(url, json={"data": payload, "recipient": "*"}, headers=headers, timeout=5) as resp:
                            if resp.status >= 300:
                                logger.debug(f"[rest-tools] Daily broadcast returned {resp.status}")
    except Exception as e:
        logger.debug(f"[rest-tools] Daily broadcast skipped: {e}")


@app.post("/api/tools/execute")
async def execute_tool(body: DirectToolRequest):
    """Execute a tool directly against the Mesh data layer.

    Returns the tool result synchronously.  No Daily room required.
    UI events are broadcast opportunistically to connected WS/Daily clients.
    """
    tenant_id = body.tenant_id or _DEFAULT_TENANT
    user_id = body.user_id or _DEFAULT_USER
    tool = body.tool_name
    p = body.params

    try:
        from actions import notes_actions

        # ---- Notes CRUD ----
        if tool == "bot_create_note":
            note = await notes_actions.create_note(
                tenant_id=tenant_id,
                user_id=user_id,
                title=p.get("title", "Untitled"),
                content=p.get("content", ""),
                mode=p.get("mode", "personal"),
            )
            if not note:
                raise HTTPException(status_code=500, detail="Failed to create note")
            note_id = note.get("_id") or note.get("page_id")
            await _broadcast_note_event("create", note_id, note, note.get("mode"))
            return {"ok": True, "tool_name": tool, "result": {"success": True, "note": note}}

        elif tool == "bot_replace_note":
            note_id = p.get("note_id")
            if not note_id:
                raise HTTPException(status_code=400, detail="note_id is required for direct execution")
            success = await notes_actions.update_note_content(
                tenant_id=tenant_id,
                note_id=note_id,
                content=p.get("content", ""),
                user_id=user_id,
                title=p.get("title"),
            )
            if not success:
                raise HTTPException(status_code=500, detail="Failed to update note")
            updated = await notes_actions.get_note_by_id(tenant_id, note_id)
            await _broadcast_note_event("update", note_id, updated, (updated or {}).get("mode"))
            return {"ok": True, "tool_name": tool, "result": {"success": True, "note": updated}}

        elif tool == "bot_read_current_note":
            note_id = p.get("note_id")
            if not note_id:
                raise HTTPException(status_code=400, detail="note_id is required for direct execution")
            note = await notes_actions.get_note_by_id(tenant_id, note_id)
            if not note:
                raise HTTPException(status_code=404, detail="Note not found")
            return {"ok": True, "tool_name": tool, "result": {"success": True, "note": note}}

        elif tool == "bot_delete_note":
            note_id = p.get("note_id")
            if not note_id:
                raise HTTPException(status_code=400, detail="note_id is required for direct execution")
            deleted = await notes_actions.delete_note(tenant_id, note_id, user_id)
            if not deleted:
                raise HTTPException(status_code=500, detail="Failed to delete note")
            await _broadcast_note_event("delete", note_id)
            return {"ok": True, "tool_name": tool, "result": {"success": True}}

        elif tool == "bot_list_notes":
            notes = await notes_actions.list_notes(
                tenant_id=tenant_id,
                user_id=user_id,
                limit=p.get("limit", 100),
                include_content=p.get("include_content", False),
            )
            return {"ok": True, "tool_name": tool, "result": {"success": True, "notes": notes}}

        elif tool == "bot_search_notes":
            title = p.get("title") or p.get("query", "")
            if not title:
                raise HTTPException(status_code=400, detail="title/query is required")
            notes = await notes_actions.fuzzy_search_notes(tenant_id, title, user_id)
            return {"ok": True, "tool_name": tool, "result": {"success": True, "notes": notes or []}}

        else:
            # Fall back to the relay-based invoke for non-data tools
            raise HTTPException(
                status_code=404,
                detail=f"Tool '{tool}' not supported for direct execution. Use /api/tools/invoke for relay-based execution.",
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[rest-tools] Error executing {tool}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/active-rooms")
async def get_active_rooms():
    """Return currently tracked active rooms."""
    async with active_rooms_lock:
        return {"rooms": {url: {"status": info.get("status"), "session_id": info.get("session_id")} for url, info in active_rooms.items()}}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file to the workspace. Images are saved to photo-magic dir, others to workspace uploads."""
    import mimetypes
    WORKSPACE_UPLOADS = os.path.expanduser("~/.openclaw/workspace/uploads")
    os.makedirs(WORKSPACE_UPLOADS, exist_ok=True)
    os.makedirs(PHOTO_MAGIC_OUTPUT_DIR, exist_ok=True)

    safe_name = f"{uuid.uuid4().hex[:8]}_{os.path.basename(file.filename or 'file')}"
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    is_image = content_type.startswith("image/")

    dest_dir = PHOTO_MAGIC_OUTPUT_DIR if is_image else WORKSPACE_UPLOADS
    dest_path = os.path.join(dest_dir, safe_name)

    with open(dest_path, "wb") as f:
        f.write(await file.read())

    result: dict = {
        "ok": True,
        "filename": safe_name,
        "originalName": file.filename,
        "contentType": content_type,
        "isImage": is_image,
        "path": dest_path,
        "size": os.path.getsize(dest_path),
    }
    if is_image:
        result["imageUrl"] = f"/api/photo-magic/result/{safe_name}"

    logger.info(f"[upload] Saved {file.filename} → {dest_path} (image={is_image})")
    return result


@app.post("/api/soundtrack/state")
async def soundtrack_state_update(request: Request):
    """Receive soundtrack state updates from the frontend."""
    try:
        body = await request.json()
        from tools.soundtrack_tools import update_soundtrack_state
        update_soundtrack_state(body)
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/health")
async def health():
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# Meeting Mode — Pearl as silent note-taker
# ---------------------------------------------------------------------------

_meeting_state: Dict[str, Any] = {
    "active": False,
    "room_url": None,
    "started_at": None,
    "segments": [],       # list of {speaker, text, timestamp}
    "notes_summary": None,
    "key_points": [],
    "action_items": [],
    "decisions": [],
}


class MeetingStartRequest(BaseModel):
    room_url: str | None = None


class MeetingStopRequest(BaseModel):
    room_url: str | None = None


class MeetingShowRequest(BaseModel):
    room_url: str | None = None


@app.post("/api/meeting/start")
async def meeting_start(body: MeetingStartRequest):
    """Enter meeting mode — Pearl mutes, starts accumulating transcript notes."""
    global _meeting_state
    _meeting_state = {
        "active": True,
        "room_url": body.room_url,
        "started_at": time.time(),
        "segments": [],
        "notes_summary": None,
        "key_points": [],
        "action_items": [],
        "decisions": [],
    }
    logger.info(f"[meeting] Meeting mode STARTED for room {body.room_url}")

    # Broadcast meeting mode event so the bot pipeline knows to switch prompts
    try:
        envelope = {
            "v": 1,
            "kind": "nia.event",
            "event": "meeting.mode.start",
            "ts": int(time.time() * 1000),
            "payload": {"room_url": body.room_url},
        }
        await ws_broadcast(envelope)
    except Exception as e:
        logger.warning(f"[meeting] Failed to broadcast meeting start: {e}")

    return {"ok": True, "active": True}


@app.post("/api/meeting/stop")
async def meeting_stop(body: MeetingStopRequest):
    """Exit meeting mode — generate final summary."""
    global _meeting_state
    if not _meeting_state.get("active"):
        return {"ok": True, "active": False, "summary": None}

    # Generate summary from accumulated segments using OpenClaw
    summary = None
    segments = _meeting_state.get("segments", [])
    if segments:
        try:
            transcript_text = "\n".join(
                f"{s.get('speaker', 'Unknown')}: {s.get('text', '')}"
                for s in segments
            )
            prompt = (
                "Summarize this meeting transcript concisely. Include:\n"
                "1. Key discussion points\n"
                "2. Action items (who needs to do what)\n"
                "3. Decisions made\n\n"
                f"Transcript:\n{transcript_text[:8000]}"
            )
            _oc_headers = {"Content-Type": "application/json"}
            if OPENCLAW_API_KEY:
                _oc_headers["Authorization"] = f"Bearer {OPENCLAW_API_KEY}"
            async with aiohttp.ClientSession() as session:
                resp = await session.post(
                    f"{OPENCLAW_BASE_URL}/v1/chat/completions",
                    json={
                        "model": "default",
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": False,
                    },
                    headers=_oc_headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                )
                if resp.status == 200:
                    data = await resp.json()
                    summary = data.get("choices", [{}])[0].get("message", {}).get("content")
                    _meeting_state["notes_summary"] = summary
        except Exception as e:
            logger.warning(f"[meeting] Failed to generate summary: {e}")

    result = {
        "ok": True,
        "active": False,
        "summary": summary,
        "segment_count": len(segments),
        "duration_minutes": round((time.time() - (_meeting_state.get("started_at") or time.time())) / 60, 1),
    }

    # Broadcast stop event
    try:
        envelope = {
            "v": 1,
            "kind": "nia.event",
            "event": "meeting.mode.stop",
            "ts": int(time.time() * 1000),
            "payload": {"summary": summary},
        }
        await ws_broadcast(envelope)
    except Exception:
        pass

    _meeting_state["active"] = False
    logger.info(f"[meeting] Meeting mode STOPPED. {len(segments)} segments, summary={'yes' if summary else 'no'}")
    return result


@app.get("/api/meeting/notes")
async def meeting_notes():
    """Return current accumulated meeting notes."""
    return {
        "active": _meeting_state.get("active", False),
        "segments": _meeting_state.get("segments", []),
        "notes_summary": _meeting_state.get("notes_summary"),
        "key_points": _meeting_state.get("key_points", []),
        "action_items": _meeting_state.get("action_items", []),
        "decisions": _meeting_state.get("decisions", []),
        "segment_count": len(_meeting_state.get("segments", [])),
        "started_at": _meeting_state.get("started_at"),
    }


@app.post("/api/meeting/transcript")
async def meeting_add_transcript(request: Request):
    """Add a transcript segment (called by the bot pipeline when STT produces text)."""
    body = await request.json()
    if not _meeting_state.get("active"):
        return {"ok": False, "reason": "meeting mode not active"}
    segment = {
        "speaker": body.get("speaker", "Unknown"),
        "text": body.get("text", ""),
        "timestamp": time.time(),
    }
    _meeting_state["segments"].append(segment)
    return {"ok": True, "segment_count": len(_meeting_state["segments"])}


@app.post("/api/meeting/show")
async def meeting_show(body: MeetingShowRequest):
    """Display current meeting notes on Wonder Canvas."""
    if not _meeting_state.get("segments"):
        return {"ok": False, "reason": "no notes to display"}

    # Build HTML for Wonder Canvas
    segments = _meeting_state.get("segments", [])
    summary = _meeting_state.get("notes_summary") or ""
    key_points = _meeting_state.get("key_points", [])
    action_items = _meeting_state.get("action_items", [])

    duration = round((time.time() - (_meeting_state.get("started_at") or time.time())) / 60, 1)

    kp_html = "".join(f"<li>{p}</li>" for p in key_points) if key_points else ""
    ai_html = "".join(f"<li>{a}</li>" for a in action_items) if action_items else ""
    recent = segments[-15:]
    transcript_html = "".join(
        f"<p><strong>{s.get('speaker', '?')}:</strong> {s.get('text', '')}</p>"
        for s in recent
    )

    html = f"""
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e0e0e8;padding:32px;max-width:720px;margin:0 auto;">
  <h2 style="color:#FFD233;">📝 Meeting Notes</h2>
  <p style="color:#888;font-size:13px;">{duration} min · {len(segments)} segments</p>
  {"<div style='margin:16px 0'><h3 style='color:#FFD233;font-size:15px'>Summary</h3><p style='font-size:14px'>" + summary + "</p></div>" if summary else ""}
  {"<div style='margin:16px 0'><h3 style='color:#FFD233;font-size:15px'>Key Points</h3><ul style='padding-left:20px'>" + kp_html + "</ul></div>" if kp_html else ""}
  {"<div style='margin:16px 0'><h3 style='color:#FFD233;font-size:15px'>Action Items</h3><ul style='padding-left:20px'>" + ai_html + "</ul></div>" if ai_html else ""}
  <div style="margin:16px 0"><h3 style="color:#FFD233;font-size:15px">Recent Transcript</h3>
    <div style="font-size:12px;color:#aaa">{transcript_html}</div>
  </div>
</div>"""

    # Broadcast as wonder.scene event
    envelope = {
        "v": 1,
        "kind": "nia.event",
        "event": "wonder.scene",
        "ts": int(time.time() * 1000),
        "seq": 0,
        "payload": {
            "html": html,
            "title": "Meeting Notes",
            "transition": "fadeIn",
        },
    }
    await ws_broadcast(envelope)
    logger.info(f"[meeting] Displayed meeting notes on Wonder Canvas ({len(segments)} segments)")
    return {"ok": True, "segments_shown": len(recent)}


@app.get("/api/meeting/state")
async def meeting_state():
    """Return meeting mode state (active/inactive)."""
    return {
        "active": _meeting_state.get("active", False),
        "started_at": _meeting_state.get("started_at"),
        "room_url": _meeting_state.get("room_url"),
        "segment_count": len(_meeting_state.get("segments", [])),
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def health():
    # When Redis is enabled, check it
    if USE_REDIS:
        try:
            if r and r.ping():
                return {"status": "ok"}
        except Exception as e:
            logger.error(f"Health check redis ping failed: {e}")
        return {"status": "error", "detail": "redis disconnected"}

    # Direct mode — gateway is healthy if it's running
    result: Dict[str, Any] = {"status": "ok", "mode": "direct"}
    if _default_room_url:
        result["default_room"] = _default_room_url
    return result
