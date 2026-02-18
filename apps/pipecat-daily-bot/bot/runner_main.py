"""Custom lightweight Pipecat runner wrapper with per-session control.

We do not use the stock `pipecat.runner.run` main so we can implement:
  - Explicit POST /start (does NOT auto-start on GET /)
  - Session registry with IDs
  - POST /sessions/{id}/leave to cancel an active bot task
  - GET /sessions to list current sessions

Container entrypoint (MODE=runner) launches this file.
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from loguru import logger
from pipecat.runner.types import DailyRunnerArguments
import redis.asyncio as redis
from core.config import BOT_PID

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
  sys.path.insert(0, str(ROOT_DIR))

USE_REDIS = os.getenv("USE_REDIS", "false").lower() == "true"

# Lazy import of configure to avoid requiring Daily creds until /start invoked
configure = None  # type: ignore

try:
  # Try importing as a module within the package
  from bot.bot import bot
except ImportError:
  try:
    # Try importing as a sibling module
    from bot import bot
  except ImportError as e:
    logger.error(f"Unable to import bot function: {e}")
    raise

try:
  from bot.room.state import (
      cleanup_room_state, 
      get_active_note_id, 
      get_active_note_owner,
      get_active_applet_id,
      get_active_applet_owner
  )
except ImportError:
  try:
    from room.state import (
        cleanup_room_state, 
        get_active_note_id, 
        get_active_note_owner,
        get_active_applet_id,
        get_active_applet_owner
    )
  except ImportError:
    logger.warning("Unable to import room state functions, state features will be disabled")
    def cleanup_room_state(room_url: str): pass
    async def get_active_note_id(room_url: str): return None
    async def get_active_note_owner(room_url: str): return None
    async def get_active_applet_id(room_url: str): return None
    async def get_active_applet_owner(room_url: str): return None

try:
  from bot.eventbus.bus import reset_bus
except ImportError:
  try:
    from eventbus.bus import reset_bus
  except ImportError:
    logger.warning("Unable to import reset_bus, event bus cleanup will be skipped")
    def reset_bus():
      pass

async def _register_in_pool():
  """Register this runner in the Redis standby pool."""
  if not USE_REDIS:
    logger.info("[pool] USE_REDIS not true; skipping standby pool registration")
    return None
  redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
  pod_ip = os.getenv("POD_IP")
  if pod_ip:
    try:
      password = os.getenv("REDIS_SHARED_SECRET") if os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true" else None
      r = redis.from_url(redis_url, password=password, decode_responses=True)
      # Register this runner's internal URL
      runner_url = f"http://{pod_ip}:8080"
      await r.lpush("bot:standby:pool", runner_url)
      logger.info(f"[pool] Registered in standby pool: {runner_url}")
      await r.aclose()
      return runner_url
    except Exception as e:
      logger.error(f"[pool] Failed to register in standby pool: {e}")
  else:
    logger.warning("[pool] Standby mode but POD_IP not set; cannot register in pool")
  return None

async def _remove_from_pool(runner_url: str):
  """Remove this runner from the Redis standby pool."""
  if not USE_REDIS:
    return
  try:
      redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
      password = os.getenv("REDIS_SHARED_SECRET") if os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true" else None
      r = redis.from_url(redis_url, password=password, decode_responses=True)
      await r.lrem("bot:standby:pool", 0, runner_url)
      logger.info(f"[pool] Removed from standby pool: {runner_url}")
      await r.aclose()
  except Exception as e:
      logger.error(f"[pool] Failed to remove from standby pool: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
  """Lifespan replaces deprecated @app.on_event hooks.

  Startup: optionally auto-start a session (RUNNER_AUTO_START)
  Shutdown: cancel any remaining session tasks cleanly.
  """
  logger.info(f"DEBUG: runner_main startup. BOT_VOICE_ID={os.getenv('BOT_VOICE_ID')}")

  # NOTE: Use try/finally so that pool deregistration and cleanup run even if
  # startup is cancelled or errors before reaching the yield.
  runner_url = None
  try:
    # Startup
    if os.getenv("RUNNER_AUTO_START", "1") != "0":
      room = os.getenv("DAILY_ROOM_URL")
      if room:
        personalityId = (os.getenv("BOT_PERSONALITY") or "").lower()
        persona = os.getenv("BOT_PERSONA") or "Pearl"
        token = os.getenv("DAILY_TOKEN")

        body = {}
        mode_config_json = os.getenv("BOT_MODE_CONFIG_JSON")
        if mode_config_json:
          try:
            body["modePersonalityVoiceConfig"] = json.loads(mode_config_json)
          except Exception as e:
            logger.error(f"Failed to parse BOT_MODE_CONFIG_JSON: {e}")

        session_override_json = os.getenv("BOT_SESSION_OVERRIDE_JSON")
        if session_override_json:
          try:
            body["sessionOverride"] = json.loads(session_override_json)
          except Exception as e:
            logger.error(f"Failed to parse BOT_SESSION_OVERRIDE_JSON: {e}")

        try:
          await _launch_session(room, token, personalityId, persona, body=body)  # type: ignore[arg-type]
          logger.info(f"[lifespan] auto-start session room={room}")
        except Exception as e:  # pragma: no cover
          logger.error(f"[lifespan] auto-start failed: {e}")
    else:
      # Standby mode: Register in Redis pool
      runner_url = await _register_in_pool()

    yield
  finally:
    # Shutdown: Remove from pool if registered
    if runner_url:
      try:
        await asyncio.shield(_remove_from_pool(runner_url))
      except Exception as e:
        logger.error(f"[lifespan] Failed to remove from standby pool: {e}")

    # Connect to Redis for cleanup
    redis_client = None
    if USE_REDIS:
      try:
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        password = os.getenv("REDIS_SHARED_SECRET") if os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true" else None
        redis_client = redis.from_url(redis_url, password=password, decode_responses=True)
      except Exception as e:
        logger.error(f"[lifespan] Failed to connect to Redis for cleanup: {e}")

    # Shutdown: cancel any active session tasks
    for sid, info in list(sessions.items()):
      # Stop keepalive heartbeat
      if info.keepalive_task:
        info.keepalive_task.cancel()
        try:
          await asyncio.wait_for(info.keepalive_task, timeout=3)
        except Exception:
          pass

      # Clear Redis lock for this room
      if info.room_url:
        await _clear_room_state(info.room_url)

      if not info.task.done():
        info.task.cancel()
        try:
          await asyncio.wait_for(info.task, timeout=3)
        except Exception:
          pass
      sessions.pop(sid, None)

    if redis_client:
      try:
        await redis_client.aclose()
      except Exception:
        pass

class SessionInfo:
  __slots__ = (
    "id",
    "task",
    "keepalive_task",
    "room_url",
    "token",
    "personality",
    "persona",
    "created_ts",
    "launch_body",
  )
  def __init__(
    self,
    session_id: str,
    task: asyncio.Task,
    keepalive_task: asyncio.Task | None,
    room_url: str,
    token: str | None,
    personality: str,
    persona: str,
    launch_body: dict[str, Any] | None = None,
  ):
    self.id = session_id
    self.task = task
    self.keepalive_task = keepalive_task
    self.room_url = room_url
    self.token = token
    self.personality = personality
    self.persona = persona
    self.created_ts = time.time()
    self.launch_body = dict(launch_body or {})

sessions: dict[str, SessionInfo] = {}
_transitioning_sessions: set[str] = set()

# Index room_url -> session ids (one-to-many safeguard though we expect one)
def _sessions_for_room(room_url: str):
  return [s for s in sessions.values() if s.room_url == room_url]

def _first_session_for_room(room_url: str):
  arr = _sessions_for_room(room_url)
  return arr[0] if arr else None


async def _clear_room_state(room_url: str) -> None:
  """Remove active/keepalive keys for a room, forgiving on errors."""
  if not USE_REDIS or not room_url:
    return

  redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
  password = os.getenv("REDIS_SHARED_SECRET") if os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true" else None
  try:
    client = redis.from_url(redis_url, password=password, decode_responses=True)
    await client.delete(f"room_active:{room_url}")
    await client.delete(f"room_keepalive:{room_url}")
    logger.info(f"[cleanup] Cleared room state for {room_url}")
    await client.aclose()
  except Exception as e:
    logger.error(f"[cleanup] Failed to clear room state for {room_url}: {e}")


# CORS: restrict to known origins; override via BOT_CORS_ORIGINS
ALLOWED_ORIGINS = os.getenv("BOT_CORS_ORIGINS")
if ALLOWED_ORIGINS:
  origins = [o.strip() for o in ALLOWED_ORIGINS.split(',') if o.strip()]
else:
  origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4000",
    "http://127.0.0.1:4000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://interface.stg.nxops.net",
    "https://pearlos.org",
    "https://www.pearlos.org",
  ]

app = FastAPI(lifespan=lifespan)
app.add_middleware(
  CORSMiddleware,
  allow_origins=origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

class ContextUpdate(BaseModel):
    activeNoteId: Optional[str] = None
    activeAppletId: Optional[str] = None


class TransitionRequest(BaseModel):
    new_room_url: str
    new_token: Optional[str] = None
    personalityId: Optional[str] = None
    persona: Optional[str] = None
    debugTraceId: Optional[str] = None
    # Optional identity/session metadata overrides.
    sessionUserId: Optional[str] = None
    sessionUserName: Optional[str] = None
    sessionUserEmail: Optional[str] = None

@app.get("/health")
async def health():
  """Readiness/liveness probe.

  Checks Redis (when enabled) and verifies active session tasks/keepalives.
  Returns 200 only when dependencies are healthy.
  """
  # Base payload
  status = {
    "status": "ok",
    "sessions": len(sessions),
  }

  # Redis check when enabled
  if USE_REDIS:
    try:
      redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
      password = os.getenv("REDIS_SHARED_SECRET") if os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true" else None
      r = redis.from_url(redis_url, password=password, decode_responses=True)
      await r.ping()
      await r.aclose()
      status["redis"] = "ok"
    except Exception as exc:
      logger.error(f"[health] Redis check failed: {exc}")
      return JSONResponse({"status": "error", "redis": "unreachable"}, status_code=503)

  # If sessions exist, ensure their tasks are alive
  for sid, info in sessions.items():
    if info.task.done():
      return JSONResponse({"status": "error", "session": sid, "reason": "task-finished"}, status_code=503)
    if info.keepalive_task and info.keepalive_task.done():
      return JSONResponse({"status": "error", "session": sid, "reason": "keepalive-stopped"}, status_code=503)

  return status

@app.get("/debug/sessions")
async def debug_sessions():
  return {
    "active_sessions": [
      {
        "id": s.id,
        "room_url": s.room_url,
        "personality": s.personality,
        "created_ts": s.created_ts
      }
      for s in sessions.values()
    ]
  }

@app.get("/")
async def root():
  return {"status": "runner-ready", "sessions": len(sessions)}

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

@app.post("/api/room/context")
async def update_session_context(room_url: str, update: ContextUpdate):
    """Update session context (active note, applet, etc)."""
    # This endpoint is a placeholder for future context updates pushed from frontend
    # Currently context is updated via Daily App Messages, but this allows HTTP fallback
    return {"status": "ok", "updated": True}

async def _launch_session(room_url: str, token: str | None, personalityId: str, persona: str, body: dict[str, Any] | None = None) -> SessionInfo:
  # Pass the full body to DailyRunnerArguments so the bot can access tenantId, voice, etc.
  body = body or {}
  provided_session_id = body.get("sessionId") or os.getenv("BOT_SESSION_ID")
  generated_session_id = False
  if not provided_session_id:
    provided_session_id = uuid.uuid4().hex[:12]
    generated_session_id = True

  canonical_session_id = provided_session_id
  body["sessionId"] = canonical_session_id
  debug_trace_id = body.get("debugTraceId") or os.getenv("BOT_DEBUG_TRACE_ID")
  if debug_trace_id:
    body["debugTraceId"] = debug_trace_id

  logger.bind(roomUrl=room_url, sessionId=canonical_session_id).info(
    "[runner] Canonical sessionId prepared (generated=%s, debugTraceId=%s)" % (generated_session_id, debug_trace_id)
  )

  # Ensure downstream modules relying on env vars see the canonical session/user identity
  os.environ["BOT_SESSION_ID"] = str(canonical_session_id)
  session_user_id = body.get("sessionUserId")
  session_user_name = body.get("sessionUserName")
  session_user_email = body.get("sessionUserEmail")
  if session_user_id:
    os.environ["BOT_SESSION_USER_ID"] = str(session_user_id)
  if session_user_name:
    os.environ["BOT_SESSION_USER_NAME"] = str(session_user_name)
  if session_user_email:
    os.environ["BOT_SESSION_USER_EMAIL"] = str(session_user_email)

  runner_args = DailyRunnerArguments(room_url=room_url, token=token, body=body)  # type: ignore[arg-type]
  session_logger = logger.bind(
    roomUrl=room_url,
    sessionId=canonical_session_id,
    userId=session_user_id,
    userName=session_user_name,
    debugTraceId=debug_trace_id,
  )
  session_logger.info(
    "[runner] Launch request (hasToken=%s, personality=%s, persona=%s)" %
    (bool(token), personalityId, persona)
  )

  if generated_session_id:
    session_logger.warning("[runner] No sessionId provided; generated fallback %s" % canonical_session_id)

  async def _keepalive(room: str, session_id: str):
    if not USE_REDIS:
      return
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    password = os.getenv("REDIS_SHARED_SECRET") if os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true" else None
    keepalive_key = f"room_keepalive:{room}"
    payload: dict[str, Any] = {"session_id": session_id}
    r = redis.from_url(redis_url, password=password, decode_responses=True)
    try:
      # Emit an initial keepalive immediately so the operator does not reap a freshly spawned job before the loop runs.
      payload["timestamp"] = time.time()
      await r.set(keepalive_key, json.dumps(payload))
      await r.expire(keepalive_key, 40)
      while True:
        payload["timestamp"] = time.time()
        await r.set(keepalive_key, json.dumps(payload))
        await r.expire(keepalive_key, 40)  # TTL slightly above stale threshold
        await asyncio.sleep(5)
    except asyncio.CancelledError:
      raise
    except Exception as e:  # pragma: no cover
      session_logger.error(f"[keepalive] Failed to publish keepalive for {room}: {e}")
    finally:
      try:
        await _clear_room_state(room)
      finally:
        try:
          await r.aclose()
        except Exception:
          pass
  
  async def _run():
    keepalive_task_local: asyncio.Task | None = keepalive_task
    ended_session_id: str | None = None
    try:
      # Ensure downstream logs inherit session context (room/session/user) for correlation.
      session_logger.info("[runner] Starting pipeline")
      await bot(runner_args)
    except asyncio.CancelledError:
      session_logger.info("Session task cancelled")
      raise
    except Exception as e:  # pragma: no cover
      session_logger.error(f"Session error: {e}")
    finally:
      # remove from registry
      for sid, info in list(sessions.items()):
        if info.task is task:
          ended_session_id = sid
          keepalive_task_local = info.keepalive_task
          sessions.pop(sid, None)
          break

      # Stop keepalive heartbeat before deleting keys
      if keepalive_task_local:
        keepalive_task_local.cancel()
        try:
          await asyncio.wait_for(keepalive_task_local, timeout=3)
        except Exception:
          pass

      # Clear Redis lock for this room (always runs even when task was found)
      await _clear_room_state(room_url)
      
      # Terminate the runner when the session ends (one-shot lifecycle)
      # This applies to both auto-started jobs and warm-pool runners.
      session_logger.info("Session ended")

      # Transition requests deliberately cancel and relaunch the session on this same runner.
      # In that path, skip normal process termination and keep runner alive.
      if ended_session_id and ended_session_id in _transitioning_sessions:
        _transitioning_sessions.discard(ended_session_id)
        session_logger.info("Session ended for transition handoff; keeping runner alive")
        try:
          cleanup_room_state(room_url)
        except Exception:
          pass
        return
      
      # In direct runner mode (USE_REDIS=false), we're called from gateway and should NOT kill the process
      # The gateway needs to stay alive to handle future join requests
      if not USE_REDIS:
        session_logger.info("Direct runner mode: Session ended, keeping gateway alive for future requests")
        # Just clean up session state, don't kill the process
        cleanup_room_state(room_url)
        return
      
      # If this is a warm pool runner (RUNNER_AUTO_START=0), re-register in pool instead of killing
      if os.getenv("RUNNER_AUTO_START", "1") == "0":
        session_logger.info("Warm pool runner: re-registering in standby pool")
        # Clear any session-specific state if needed
        cleanup_room_state(room_url)
        reset_bus()
        await _register_in_pool()
      else:
        # One-shot lifecycle for auto-started jobs
        session_logger.info("Auto-start runner: shutting down")
        # Allow a brief moment for logs/cleanup
        await asyncio.sleep(0.5)
        os.kill(os.getpid(), signal.SIGTERM)

  keepalive_task: asyncio.Task | None = asyncio.create_task(_keepalive(room_url, canonical_session_id)) if USE_REDIS else None
  task = asyncio.create_task(_run(), name=f"pipecat-session:{room_url}")
  info = SessionInfo(
    canonical_session_id,
    task,
    keepalive_task,
    room_url,
    token,
    personalityId,
    persona,
    body,
  )
  sessions[canonical_session_id] = info
  return info

@app.post("/start")
async def start_session(body: dict[str, Any] | None = None):
  """Start a bot session.

  Body options:
    personality: optional personality name
    room_url: (optional) existing Daily room to join (skip automatic provisioning)
    token: (optional) token for that existing room
  If room_url is omitted, a new room + token are provisioned automatically.
  """
  global configure
  body = body or {}
  personality = (body.get("personality") or os.getenv("BOT_PERSONALITY") or "pearl").lower()
  persona = os.getenv("BOT_PERSONA") or "Pearl"
  room_url = body.get("room_url")
  token = body.get("token")
  provisioned = False
  if not room_url:
    # Import configure only when needed
    if configure is None:  # type: ignore
      from pipecat.runner.daily import configure as _configure  # type: ignore
      configure = _configure  # type: ignore
    import aiohttp  # type: ignore
    async with aiohttp.ClientSession() as session:
      try:
        room_url, token = await configure(session)  # type: ignore
        provisioned = True
      except Exception as e:  # pragma: no cover
        logger.error(f"Failed to configure Daily resources: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
  info = await _launch_session(room_url, token, personality, persona, body)  # type: ignore[arg-type]
  return {
    "dailyRoom": info.room_url,
    "dailyToken": info.token,
    "sessionId": info.id,
    "botPid": BOT_PID,
    "personality": info.personality,
    "persona": info.persona,
    "provisioned": provisioned,
  }

@app.get("/sessions")
async def list_sessions():
  return [
    {
      "id": s.id,
      "room_url": s.room_url,
      "personality": s.personality,
      "running": not s.task.done(),
      "created_ts": s.created_ts,
    }
    for s in sessions.values()
  ]

@app.post("/sessions/{session_id}/leave")
async def leave_session(session_id: str):
  info = sessions.get(session_id)
  if not info:
    raise HTTPException(status_code=404, detail="Session not found")
  if info.task.done():
    sessions.pop(session_id, None)
    return {"sessionId": session_id, "status": "already-finished"}
  info.task.cancel()
  try:
    await asyncio.wait_for(info.task, timeout=5)
  except asyncio.TimeoutError:  # pragma: no cover
    logger.warning(f"Session {session_id} did not cancel within timeout")
    sessions.pop(session_id, None)
  return {"sessionId": session_id, "status": "terminated"}


@app.post("/sessions/{session_id}/transition")
async def transition_session(session_id: str, body: TransitionRequest):
  """Transition an active session to a new room while preserving session identity."""
  info = sessions.get(session_id)
  if not info:
    raise HTTPException(status_code=404, detail="Session not found")
  if info.task.done():
    sessions.pop(session_id, None)
    raise HTTPException(status_code=409, detail="Session already finished")

  debug_trace_id = body.debugTraceId or (info.launch_body or {}).get("debugTraceId")
  transition_logger = logger.bind(
    sessionId=session_id,
    roomUrl=info.room_url,
    debugTraceId=debug_trace_id,
  )
  new_room_url = (body.new_room_url or "").strip()
  transition_logger.info(
    "[transition] Request received (new_room_url=%s, has_token=%s)" %
    (new_room_url, bool(body.new_token))
  )
  if not new_room_url:
    raise HTTPException(status_code=400, detail="new_room_url is required")
  if new_room_url == info.room_url:
    transition_logger.info("[transition] No-op transition (same room)")
    return {
      "status": "noop",
      "session_id": session_id,
      "room_url": info.room_url,
      "personalityId": info.personality,
      "persona": info.persona,
      "debugTraceId": debug_trace_id,
    }

  existing_target = _first_session_for_room(new_room_url)
  if existing_target and existing_target.id != session_id and not existing_target.task.done():
    transition_logger.warning(
      "[transition] Rejected: target room already has active session %s" % existing_target.id
    )
    raise HTTPException(
      status_code=409,
      detail={
        "error": "target_room_already_has_session",
        "room_url": new_room_url,
        "existing_session_id": existing_target.id,
      },
    )

  # Cancel old task but keep process alive for relaunch in the same runner.
  _transitioning_sessions.add(session_id)
  transition_logger.info("[transition] Cancelling old task for handoff")
  info.task.cancel()
  try:
    await asyncio.wait_for(info.task, timeout=8)
  except (asyncio.TimeoutError, asyncio.CancelledError):
    pass
  except Exception as exc:
    logger.warning("[transition] Old session shutdown warning: %s" % exc)

  # Build relaunch body from original launch metadata to preserve identity/config.
  relaunch_body: dict[str, Any] = dict(info.launch_body or {})
  relaunch_body["sessionId"] = session_id
  if debug_trace_id:
    relaunch_body["debugTraceId"] = debug_trace_id
  if body.sessionUserId:
    relaunch_body["sessionUserId"] = body.sessionUserId
  if body.sessionUserName:
    relaunch_body["sessionUserName"] = body.sessionUserName
  if body.sessionUserEmail:
    relaunch_body["sessionUserEmail"] = body.sessionUserEmail

  personality_id = body.personalityId or info.personality
  persona_name = body.persona or info.persona

  try:
    transition_logger.info("[transition] Relaunching into new room")
    new_info = await _launch_session(
      new_room_url,
      body.new_token,
      personality_id,
      persona_name,
      relaunch_body,
    )
    return {
      "status": "transitioned",
      "session_id": new_info.id,
      "old_room_url": info.room_url,
      "room_url": new_info.room_url,
      "personalityId": new_info.personality,
      "persona": new_info.persona,
      "debugTraceId": debug_trace_id,
    }
  except Exception as exc:
    _transitioning_sessions.discard(session_id)
    logger.error("[transition] Failed to relaunch transitioned session: %s" % exc)
    raise HTTPException(status_code=500, detail=f"transition_failed: {exc}") from exc

# ---------------------------------------------------------------------------
# Daily Webhook Auto-Spawn (optional)
# ---------------------------------------------------------------------------
@app.post("/daily/webhook")
async def daily_webhook(req: Request):
  """Handle Daily webhook events to auto-spawn / teardown bot sessions.

  Enabled when AUTOSPAWN_WEBHOOK != "0". Expects JSON payload with at minimum:
    { "event": "participant-joined" | "participant-left" | "room-ended", "room": {"url": ...} }
  
  Minimal logic implemented:
    - On participant-joined: spawn if none running for room
    - On room-ended: terminate all sessions bound to room
  (Refinements: signature validation, last-participant detection, concurrency caps.)
  """
  if os.getenv("AUTOSPAWN_WEBHOOK", "1") == "0":
    return {"status": "disabled"}

  try:
    body = await req.json()
  except Exception as exc:
    raise HTTPException(status_code=400, detail="invalid json") from exc
  
  event_type = body.get("event") or body.get("type")
  room = body.get("room") or {}
  room_url = room.get("url") or room.get("domain_name") or None
  if not room_url and room.get("name"):
    # Fallback construction (may not match exact Daily URL shape if custom domain used)
    room_url = f"{os.getenv('DAILY_BASE_URL', '').rstrip('/')}/{room.get('name')}" if os.getenv('DAILY_BASE_URL') else None
  
  if not room_url:
    # Can't act without room URL
    return {"status": "ignored", "reason": "no-room-url", "event": event_type}
  
  # Simple allowlist regex (optional)
  import re
  allow_re = os.getenv("AUTOSPAWN_ALLOWED_ROOM_REGEX", ".*")
  if not re.match(allow_re, room_url):
    return {"status": "ignored", "reason": "room-not-allowed", "event": event_type}
  
  # Concurrency cap
  max_conc = int(os.getenv("AUTOSPAWN_MAX_CONCURRENCY", "5"))
  if len(sessions) >= max_conc and not _first_session_for_room(room_url):
    return {"status": "rejected", "reason": "max-concurrency", "event": event_type}
  
  if event_type == "participant-joined":
    # Avoid duplicate spawn
    if _first_session_for_room(room_url):
      return {"status": "ok", "already": True}
    personalityId = (os.getenv("BOT_PERSONALITY") or "").lower()
    persona = os.getenv("BOT_PERSONA") or "Pearl"
    info = await _launch_session(room_url, token=None, personalityId=personalityId, persona=persona)
    return {"status": "spawned", "sessionId": info.id, "room": room_url}
  
  if event_type in ("room-ended", "room-destroyed"):
    # Terminate all sessions for this room
    removed = []
    for s in list(sessions.values()):
      if s.room_url == room_url:
        s.task.cancel()
        removed.append(s.id)
    return {"status": "terminated", "sessions": removed, "room": room_url}
  
  # Participant-left handling could look at body["participants"] for emptiness (if provided)
  return {"status": "ignored", "event": event_type}

def main():  # pragma: no cover
  host = os.getenv("RUNNER_HOST", "0.0.0.0")
  port = int(os.getenv("RUNNER_PORT", "7860"))
  logger.info(f"Starting custom Pipecat runner host={host} port={port}")
  uvicorn.run(app, host=host, port=port)
  logger.info("Uvicorn stopped. Exiting runner with code 0.")
  sys.exit(0)


if __name__ == "__main__":
  main()
