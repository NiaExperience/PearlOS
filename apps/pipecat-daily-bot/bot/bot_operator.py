import asyncio
import json
import os
import sys
import signal
import time
import uuid
from typing import Dict, Any, Optional
from loguru import logger
import redis.asyncio as redis
import aiohttp
from dotenv import load_dotenv
from kubernetes import client, config

# Load environment
load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
QUEUE_KEY = "bot:launch:queue"
REDIS_AUTH_REQUIRED = os.getenv('REDIS_AUTH_REQUIRED', 'false').lower() == 'true'
REDIS_SHARED_SECRET = os.getenv('REDIS_SHARED_SECRET')
USE_REDIS = os.getenv('USE_REDIS', 'false').lower() == 'true'
BOT_IMAGE = os.getenv("BOT_IMAGE")
NAMESPACE = os.getenv("POD_NAMESPACE", "default")

# Keepalive sanity limits
STALE_KEEPALIVE_SECONDS = 30
PENDING_GRACE_SECONDS = 180
# Cold-started bots need extra time to pull image, start container, and initialize
# Don't check keepalive until after this grace period for cold jobs
COLD_START_GRACE_SECONDS = 90

class BotOperator:
    """
    Kubernetes Operator for Pipecat Bots.
    Watches a Redis queue for launch requests and spawns Kubernetes Jobs.
    """
    def __init__(self):
        self.redis: redis.Redis | None = None
        self.shutdown_event = asyncio.Event()
        self.reconcile_task: asyncio.Task | None = None
        self.owner_reference: client.V1OwnerReference | None = None
        
        # Initialize Kubernetes client
        try:
            config.load_incluster_config()
            logger.info("[operator] Loaded in-cluster config")
        except config.ConfigException:
            try:
                config.load_kube_config()
                logger.info("[operator] Loaded local kube config")
            except config.ConfigException:
                logger.error("[operator] Could not load Kubernetes config")
                sys.exit(1)
                
        self.batch_v1 = client.BatchV1Api()
        self.core_v1 = client.CoreV1Api()
        self.owner_reference = self._resolve_owner_reference()

    def _resolve_owner_reference(self) -> client.V1OwnerReference | None:
        pod_name = os.getenv("HOSTNAME")
        if not pod_name:
            return None
        try:
            pod = self.core_v1.read_namespaced_pod(pod_name, NAMESPACE)
            meta = pod.metadata
            if not meta or not meta.uid:
                return None
            logger.info("[operator] Using operator pod as ownerRef for Jobs")
            return client.V1OwnerReference(
                api_version=pod.api_version or "v1",
                kind=pod.kind or "Pod",
                name=meta.name,
                uid=meta.uid,
                controller=False,
                block_owner_deletion=False,
            )
        except Exception as exc:
            logger.warning(f"[operator] Failed to resolve owner reference: {exc}")
            return None

    def _resolve_bot_image(self):
        # If BOT_IMAGE is set and looks like a full registry path (contains / or :), use it.
        # If it's just "nia-pipecat-bot" (Tilt placeholder), try to resolve from self.
        if BOT_IMAGE and ("/" in BOT_IMAGE or ":" in BOT_IMAGE):
            return BOT_IMAGE
            
        try:
            pod_name = os.getenv("HOSTNAME")
            if pod_name:
                pod = self.core_v1.read_namespaced_pod(pod_name, NAMESPACE)
                # Assuming operator is the first container or the one named 'operator'
                for container in pod.spec.containers:
                    if container.name == "operator":
                        logger.info(f"[operator] Resolved bot image from self: {container.image}")
                        return container.image
                # Fallback to first container
                image = pod.spec.containers[0].image
                logger.info(f"[operator] Resolved bot image from self: {image}")
                return image
        except Exception as e:
            logger.warning(f"[operator] Failed to resolve image from self: {e}")
            
        return BOT_IMAGE

    async def connect(self):
        if not USE_REDIS:
            logger.warning("[operator] USE_REDIS not true; skipping Redis connection")
            return
        password = REDIS_SHARED_SECRET if REDIS_AUTH_REQUIRED else None
        self.redis = redis.from_url(
            REDIS_URL, 
            password=password, 
            decode_responses=True
        )
        logger.info(f"[operator] Connected to Redis at {REDIS_URL}")

    async def _is_job_active(self, job_name: str) -> bool:
        """Check if a Kubernetes Job is still active."""
        try:
            # Run in thread because K8s client is synchronous
            job = await asyncio.to_thread(
                self.batch_v1.read_namespaced_job_status,
                name=job_name,
                namespace=NAMESPACE
            )
            
            # Check completion status
            if job.status.succeeded and job.status.succeeded > 0:
                return False
            if job.status.failed and job.status.failed > 0:
                return False
            
            # If active > 0, it's running
            if job.status.active and job.status.active > 0:
                return True
                
            # If we are here, it might be pending or in an unknown state. 
            # Assume active to be safe.
            return True
            
        except client.ApiException as e:
            if e.status == 404:
                # Job not found, so it's definitely not active
                return False
            logger.error(f"[operator] K8s API error checking job {job_name}: {e}")
            # Assume active on error to avoid accidental deletion
            return True

    async def _delete_job(self, job_name: str, reason: str | None = None):
        """Delete a namespaced Job and its pods (foreground)."""
        try:
            await asyncio.to_thread(
                self.batch_v1.delete_namespaced_job,
                name=job_name,
                namespace=NAMESPACE,
                propagation_policy="Foreground"
            )
            logger.info(f"[operator] Deleted job {job_name} ({reason or 'cleanup'})")
        except client.ApiException as e:
            if e.status == 404:
                logger.info(f"[operator] Job {job_name} already absent ({reason or 'cleanup'})")
            else:
                logger.error(f"[operator] Failed to delete job {job_name}: {e}")

    async def _cleanup_stale_jobs(self):
        """Scan Redis for stale room locks and remove stuck jobs/pods when keepalives stop."""
        if not self.redis:
            return

        try:
            # Use scan_iter to avoid blocking
            async for key in self.redis.scan_iter(match="room_active:*"):
                room_url = None
                data = {}
                try:
                    data_str = await self.redis.get(key)
                    if not data_str:
                        logger.info(f"[operator] No active data for key {key}, deleting")
                        await self.redis.delete(key)
                        continue
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        logger.warning(f"[operator] Invalid JSON in key {key}, deleting")
                        await self.redis.delete(key)
                        continue

                    room_url = key.split(":", 1)[1] if ":" in key else None
                    state_logger = logger.bind(roomUrl=room_url, sessionId=data.get("session_id"))
                    state_logger.info(f"[operator] Checking active room key: {key}")

                    job_name = data.get("job_name")
                    job_type = data.get("type")

                    keepalive_key = f"room_keepalive:{room_url}" if room_url else None
                    keepalive_raw = await self.redis.get(keepalive_key) if keepalive_key else None
                    keepalive_stale = False
                    keepalive_age = None
                    if keepalive_raw:
                        try:
                            keepalive = json.loads(keepalive_raw)
                            ts = float(keepalive.get("timestamp", 0))
                            keepalive_age = time.time() - ts
                            if keepalive_age > STALE_KEEPALIVE_SECONDS:
                                keepalive_stale = True
                        except Exception as e:
                            keepalive_stale = True
                            state_logger.warning(f"[operator] Invalid keepalive for {key}: {e}")
                    else:
                        keepalive_stale = True

                    if not keepalive_stale:
                        state_logger.info(f"[operator] Keepalive healthy for key {key} age={keepalive_age:.1f}s")

                    # Clean up "cold" jobs managed by K8s
                    if job_type == "cold" and job_name:
                        # If the pod never started (Pending) and no keepalive ever appeared, consider it stuck
                        job_age = None
                        try:
                            pods = await asyncio.to_thread(
                                self.core_v1.list_namespaced_pod,
                                namespace=NAMESPACE,
                                label_selector=f"job-name={job_name}"
                            )
                            pending_pods = [p for p in pods.items if p.status and p.status.phase in ("Pending", "ContainerCreating")]
                            all_pods = pods.items
                            
                            # Calculate job age from oldest pod
                            if all_pods:
                                oldest_ts = min((p.metadata.creation_timestamp for p in all_pods if p.metadata and p.metadata.creation_timestamp), default=None)
                                if oldest_ts:
                                    job_age = time.time() - oldest_ts.timestamp()
                            
                            if pending_pods:
                                oldest = min((p.metadata.creation_timestamp for p in pending_pods if p.metadata and p.metadata.creation_timestamp), default=None)
                                if oldest:
                                    age = time.time() - oldest.timestamp()
                                    if age > PENDING_GRACE_SECONDS:
                                        state_logger.info(f"[operator] Pending job {job_name} exceeds grace ({age:.1f}s); deleting")
                                        await self._delete_job(job_name, reason="pending too long")
                                        await self.redis.delete(key)
                                        if keepalive_key:
                                            await self.redis.delete(keepalive_key)
                                        continue
                        except Exception as e:
                            state_logger.warning(f"[operator] Failed to inspect pods for job {job_name}: {e}")

                        # For cold jobs, don't check keepalive until after the cold start grace period
                        # This gives time for image pull, container start, and bot initialization
                        if keepalive_stale:
                            if job_age is not None and job_age < COLD_START_GRACE_SECONDS:
                                state_logger.info(
                                    f"[operator] Cold job {job_name} still in startup grace period (age={job_age:.1f}s < {COLD_START_GRACE_SECONDS}s); skipping keepalive check"
                                )
                            else:
                                state_logger.info(
                                    f"[operator] Keepalive stale/missing for cold job {job_name} age={keepalive_age or -1:.1f}s job_age={job_age or -1:.1f}s; deleting job"
                                )
                                await self._delete_job(job_name, reason="stale keepalive")
                                await self.redis.delete(key)
                                if keepalive_key:
                                    await self.redis.delete(keepalive_key)
                                continue

                        # If keepalive is healthy but K8s shows job finished, clean the lock
                        is_active = await self._is_job_active(job_name)
                        if not is_active:
                            state_logger.info(f"[operator] Cleaning up stale session {key} for finished job {job_name}")
                            await self.redis.delete(key)
                            if keepalive_key:
                                await self.redis.delete(keepalive_key)
                    
                    # Clean up "warm" jobs managed by runners
                    elif job_type == "warm":
                        runner_url = data.get("runner_url")
                        session_id = data.get("session_id")

                        if not runner_url:
                            state_logger.warning(f"[operator] Warm session {key} missing runner_url, deleting")
                            await self.redis.delete(key)
                            if keepalive_key:
                                await self.redis.delete(keepalive_key)
                            continue

                        if keepalive_stale:
                            state_logger.info(
                                f"[operator] Warm session {key} keepalive stale/missing age={keepalive_age or -1:.1f}s (runner={runner_url}, sid={session_id})"
                            )
                            await self.redis.delete(key)
                            if keepalive_key:
                                await self.redis.delete(keepalive_key)
                        
                            
                except Exception as e:
                    logger.warning(f"[operator] Error checking key {key}: {e}")
        except Exception as e:
            logger.error(f"[operator] Error during stale job cleanup: {e}")

    async def _reconcile_loop(self):
        """Periodically check for stale locks."""
        logger.info("[operator] Starting reconciliation loop")
        while not self.shutdown_event.is_set():
            try:
                logger.debug("[operator] Running reconciliation pass")
                await self._cleanup_stale_jobs()
            except Exception as e:
                logger.error(f"[operator] Error in reconciliation loop: {e}")
            
            # Sleep for 30 seconds, respecting shutdown
            try:
                await asyncio.wait_for(self.shutdown_event.wait(), timeout=30)
            except asyncio.TimeoutError:
                pass

    async def run(self):
        if not USE_REDIS:
            logger.warning("[operator] USE_REDIS not true; operator will not run")
            return
        await self.connect()
        logger.info(f"[operator] Watching queue: {QUEUE_KEY}")
        
        # Start reconciliation task
        self.reconcile_task = asyncio.create_task(self._reconcile_loop())
        
        # Handle graceful shutdown
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda: asyncio.create_task(self.shutdown()))

        while not self.shutdown_event.is_set():
            try:
                result = await self.redis.blpop(QUEUE_KEY, timeout=1)
                
                if not result:
                    continue
                    
                _, payload_str = result
                
                try:
                    job = json.loads(payload_str)
                    job_logger = logger.bind(
                        roomUrl=job.get("room_url"),
                        sessionId=job.get("sessionId"),
                        userId=job.get("sessionUserId"),
                        userName=job.get("sessionUserName"),
                        debugTraceId=job.get("debugTraceId"),
                    )

                    job_logger.info("[operator] Received job", {
                        "roomUrl": job.get("room_url"),
                        "sessionId": job.get("sessionId"),
                        "userId": job.get("sessionUserId"),
                        "userName": job.get("sessionUserName"),
                        "persona": job.get("persona"),
                        "personalityId": job.get("personalityId"),
                        "debugTraceId": job.get("debugTraceId"),
                    })
                    
                    # ─────────────────────────────────────────────────────────────
                    # DUPLICATE DETECTION: Check if a bot is already active for this room
                    # ─────────────────────────────────────────────────────────────
                    room_url = job.get("room_url")
                    if room_url:
                        active_bot = await self._check_active_bot(room_url, job_logger)
                        if active_bot:
                            job_logger.warning(
                                f"[operator] DUPLICATE REJECTED: Bot already active for room {room_url}",
                                existing_job=active_bot.get("job_name"),
                                existing_type=active_bot.get("type"),
                                existing_session=active_bot.get("session_id"),
                                new_session=job.get("sessionId"),
                            )
                            continue  # Skip this job - bot already running
                    
                    # Try to dispatch to warm pool first
                    dispatched = await self.dispatch_to_warm_pool(job, job_logger)
                    if not dispatched:
                        await self.spawn_bot(job, job_logger)
                except json.JSONDecodeError:
                    logger.error(f"[operator] Invalid JSON: {payload_str}")
                    
            except Exception as e:
                if not self.shutdown_event.is_set():
                    logger.error(f"[operator] Error in loop: {e}")
                    await asyncio.sleep(1)

    async def dispatch_to_warm_pool(self, job: Dict[str, Any], job_logger=None) -> bool:
        """Try to dispatch job to a standby runner."""
        # Allow callers that do not pass a logger (tests, legacy paths).
        if job_logger is None:
            job_logger = logger.bind(
                roomUrl=job.get("room_url"),
                sessionId=job.get("sessionId"),
                userId=job.get("sessionUserId"),
                userName=job.get("sessionUserName"),
            )
        try:
            # Loop until we find a working runner or the pool is empty
            while True:
                # Try to get a runner from the pool
                runner_url = await self.redis.rpop("bot:standby:pool")
                if not runner_url:
                    return False
                
                job_logger.info(f"[operator] Dispatching to warm runner at {runner_url}")
                
                async with aiohttp.ClientSession() as session:
                    try:
                        # Short timeout for connection to skip dead pods quickly
                        async with session.post(f"{runner_url}/start", json=job, timeout=1) as resp:
                            if resp.status == 200:
                                start_data = await resp.json()
                                job_logger.info(f"[operator] Successfully dispatched to {runner_url}")
                                # Mark room as active
                                await self._mark_room_active(job.get("room_url"), {
                                    "status": "running",
                                    "runner_url": runner_url,
                                    "session_id": start_data.get("sessionId"),
                                    "pid": start_data.get("botPid"), # Store the bot's PID
                                    "type": "warm",
                                    "personalityId": job.get("personalityId"),
                                    "persona": job.get("persona")
                                })
                                return True
                            else:
                                job_logger.error(f"[operator] Warm runner {runner_url} returned {resp.status}")
                                # Continue to next runner
                    except Exception as e:
                        job_logger.error(f"[operator] Failed to contact warm runner {runner_url}: {e}")
                        # Continue to next runner
        except Exception as e:
            job_logger.error(f"[operator] Error checking warm pool: {e}")
            return False

    async def _mark_room_active(self, room_url: str, details: Dict[str, Any]):
        """Update the room active lock in Redis."""
        if not room_url:
            return
        try:
            room_logger = logger.bind(roomUrl=room_url, sessionId=details.get("session_id"))
            key = f"room_active:{room_url}"
            # Add timestamp
            details["timestamp"] = time.time()
            # Set with no expiry (or long expiry like 24h to prevent infinite locks)
            await self.redis.set(key, json.dumps(details))
            # Optional: Set a safety expiry of 24 hours
            await self.redis.expire(key, 86400)
            room_logger.info(f"[operator] Marked room {room_url} as active: {details}")
        except Exception as e:
            room_logger.error(f"[operator] Failed to mark room active: {e}")

    async def _check_active_bot(self, room_url: str, job_logger=None) -> Optional[Dict[str, Any]]:
        """
        Check if there's an active bot for this room via Redis entries and keepalives.
        Returns the active bot details if one exists and is healthy, None otherwise.
        """
        if not room_url or not self.redis:
            return None

        log = job_logger or logger.bind(roomUrl=room_url)

        try:
            key = f"room_active:{room_url}"
            keepalive_key = f"room_keepalive:{room_url}"

            # Check for room_active entry
            data_str = await self.redis.get(key)
            if not data_str:
                log.debug(f"[operator] No active bot entry for {room_url}")
                return None

            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                log.warning(f"[operator] Invalid JSON in {key}, ignoring stale entry")
                return None

            job_name = data.get("job_name")
            job_type = data.get("type")
            runner_url = data.get("runner_url")

            # Check keepalive freshness
            keepalive_raw = await self.redis.get(keepalive_key)
            keepalive_healthy = False

            if keepalive_raw:
                try:
                    keepalive = json.loads(keepalive_raw)
                    ts = float(keepalive.get("timestamp", 0))
                    age = time.time() - ts
                    if age <= STALE_KEEPALIVE_SECONDS:
                        keepalive_healthy = True
                        log.info(
                            f"[operator] Found healthy keepalive for {room_url}",
                            keepalive_age=f"{age:.1f}s",
                            job_type=job_type,
                            job_name=job_name,
                        )
                    else:
                        log.info(
                            f"[operator] Keepalive stale for {room_url}",
                            keepalive_age=f"{age:.1f}s",
                            threshold=f"{STALE_KEEPALIVE_SECONDS}s",
                        )
                except Exception as e:
                    log.warning(f"[operator] Invalid keepalive for {room_url}: {e}")

            if keepalive_healthy:
                # Keepalive is fresh - bot is definitely active
                return data

            # Keepalive is stale or missing - verify via K8s/runner depending on type
            if job_type == "cold" and job_name:
                # Check if K8s job is still running
                is_active = await self._is_job_active(job_name)
                if is_active:
                    log.info(
                        f"[operator] K8s job {job_name} still active despite stale keepalive",
                        room_url=room_url,
                    )
                    return data
                else:
                    log.info(
                        f"[operator] K8s job {job_name} not active, allowing new bot",
                        room_url=room_url,
                    )
                    # Clean up stale entry
                    await self.redis.delete(key)
                    await self.redis.delete(keepalive_key)
                    return None

            elif job_type == "warm" and runner_url:
                # For warm bots, we rely on keepalive - if stale, assume dead
                log.info(
                    f"[operator] Warm bot keepalive stale for {room_url}, allowing new bot",
                    runner_url=runner_url,
                )
                # Clean up stale entry
                await self.redis.delete(key)
                await self.redis.delete(keepalive_key)
                return None

            # Unknown type or missing identifiers - clean up and allow new bot
            log.warning(
                f"[operator] Unknown bot type or missing identifiers for {room_url}, cleaning up",
                job_type=job_type,
                job_name=job_name,
                runner_url=runner_url,
            )
            await self.redis.delete(key)
            await self.redis.delete(keepalive_key)
            return None

        except Exception as e:
            log.error(f"[operator] Error checking active bot for {room_url}: {e}")
            # On error, be conservative and don't block (could be Redis issue)
            return None

    async def spawn_bot(self, job: Dict[str, Any], job_logger):
        job_logger.info("[operator] spawn_bot called - DEBUG MARKER")
        room_url = job.get("room_url")
        if not room_url:
            job_logger.error("[operator] Job missing room_url")
            return

        image = self._resolve_bot_image()
        if not image:
            job_logger.error("[operator] Could not resolve bot image")
            return

        voice_parameters = job.get("voiceParameters") or {}
        job_logger.info(
            f"[operator] Spawning bot for {room_url} with image {image}",
            personalityId=job.get("personalityId"),
            persona=job.get("persona"),
            voiceId=job.get("voice"),
            voiceProvider=job.get("voiceProvider"),
            voiceParams={
                k: voice_parameters.get(k)
                for k in ("speed", "stability", "similarityBoost", "style", "optimizeStreamingLatency")
                if voice_parameters.get(k) is not None
            } or None,
            supportedFeatures=job.get("supportedFeatures"),
        )
        
        # Generate a unique name for the job
        job_id = str(uuid.uuid4())[:8]
        job_name = f"bot-{job_id}"
        
        # Mark room as active immediately with job details
        await self._mark_room_active(room_url, {
            "status": "running",
            "job_id": job_id,
            "job_name": job_name,
            "type": "cold",
            "session_id": job.get("sessionId"),
            "personalityId": job.get("personalityId"),
            "persona": job.get("persona")
        })
        
        # Prepare environment variables
        debug_level_raw = (os.getenv("PYTHON_DEBUG_LEVEL") or os.getenv("DEBUG_BOT") or "info").strip().lower()
        debug_flag = "true" if debug_level_raw in ("1", "true", "yes", "on", "debug") else "false"

        env_vars = [
            client.V1EnvVar(name="DAILY_ROOM_URL", value=room_url),
            client.V1EnvVar(name="RUNNER_AUTO_START", value="1"),
            client.V1EnvVar(name="BOT_MUTE_LIBWEBRTC_LOGS", value="false"),
            client.V1EnvVar(name="PYTHON_DEBUG_LEVEL", value=debug_level_raw or "info"),
            client.V1EnvVar(name="DEBUG_BOT", value=debug_flag),
            client.V1EnvVar(name="REDIS_URL", value=REDIS_URL),
            client.V1EnvVar(name="USE_REDIS", value="true" if USE_REDIS else "false"),
            client.V1EnvVar(name="BOT_PID", value=job_id), # Ensure bot uses the same ID as the job
        ]
        
        # Pass through critical API keys and config from operator environment
        keys_to_pass = [
            "OPENAI_API_KEY",
            "DAILY_API_KEY",
            "MESH_API_ENDPOINT",
            "MESH_ENDPOINT",
            "MESH_SHARED_SECRET",
            "BOT_CONTROL_SHARED_SECRET",
            "BOT_CONTROL_SHARED_SECRET_PREV",
            "ELEVENLABS_API_KEY",
            "CARTESIA_API_KEY",
            "DEEPGRAM_API_KEY",
            "REDIS_AUTH_REQUIRED",
            "REDIS_SHARED_SECRET",
            "KOKORO_TTS_API_KEY",
            "KOKORO_TTS_BASE_URL",
            "KOKORO_TTS_VOICE_ID",
            "KOKORO_TTS_SAMPLE_RATE",
            "KOKORO_TTS_MODEL_ID",
            "KOKORO_TTS_LANGUAGE_CODE",
            "KOKORO_TTS_APPLY_TEXT_NORMALIZATION",
            "KOKORO_TTS_INACTIVITY_TIMEOUT",
            "KOKORO_TTS_SEED",
        ]
        
        for key in keys_to_pass:
            val = os.getenv(key)
            if val:
                job_logger.info(f"[operator] Passing env var {key}")
                env_vars.append(client.V1EnvVar(name=key, value=val))
            else:
                job_logger.warning(f"[operator] Env var {key} not found in operator environment")

        if job.get("token") is not None:
            env_vars.append(client.V1EnvVar(name="DAILY_TOKEN", value=job.get("token")))
        if job.get("personalityId") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_PERSONALITY", value=job.get("personalityId")))
        if job.get("persona") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_PERSONA", value=job.get("persona")))
        if job.get("tenantId") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_TENANT_ID", value=job.get("tenantId")))
        if job.get("voice") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_VOICE_ID", value=job.get("voice")))
        if job.get("voiceProvider") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_TTS_PROVIDER", value=job.get("voiceProvider")))
        if job.get("voiceParameters") is not None:
            parameters = job.get("voiceParameters")
            if parameters.get("speed") is not None:
                env_vars.append(client.V1EnvVar(name="BOT_VOICE_SPEED", value=str(parameters.get("speed"))))
            if parameters.get("stability") is not None:
                env_vars.append(client.V1EnvVar(name="BOT_VOICE_STABILITY", value=str(parameters.get("stability"))))
            if parameters.get("similarityBoost") is not None:
                env_vars.append(client.V1EnvVar(name="BOT_VOICE_SIMILARITY_BOOST", value=str(parameters.get("similarityBoost"))))
            if parameters.get("style") is not None:
                env_vars.append(client.V1EnvVar(name="BOT_VOICE_STYLE", value=str(parameters.get("style"))))
            if parameters.get("optimizeStreamingLatency") is not None:
                env_vars.append(client.V1EnvVar(name="BOT_VOICE_OPTIMIZE_STREAMING_LATENCY", value=str(parameters.get("optimizeStreamingLatency"))))
            if parameters.get("language") is not None:
                env_vars.append(client.V1EnvVar(name="KOKORO_TTS_LANGUAGE_CODE", value=str(parameters.get("language")).lower()))
        if job.get("sessionUserId") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_SESSION_USER_ID", value=job.get("sessionUserId")))
        if job.get("sessionUserEmail") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_SESSION_USER_EMAIL", value=job.get("sessionUserEmail")))
        if job.get("sessionUserName") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_SESSION_USER_NAME", value=job.get("sessionUserName")))
        if job.get("voiceOnly") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_VOICE_ONLY", value="1"))
        if job.get("sessionPersistence") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_SESSION_PERSISTENCE", value=str(job.get("sessionPersistence"))))
        if job.get("supportedFeatures") is not None:
            features_str = ",".join(job.get("supportedFeatures"))
            env_vars.append(client.V1EnvVar(name="BOT_SUPPORTED_FEATURES", value=features_str))
        if job.get("activeNoteId") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_ACTIVE_NOTE_ID", value=job.get("activeNoteId")))
        if job.get("sessionId") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_SESSION_ID", value=job.get("sessionId")))
        if job.get("debugTraceId") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_DEBUG_TRACE_ID", value=job.get("debugTraceId")))
        if job.get("isOnboarding") is not None:
            env_vars.append(client.V1EnvVar(name="BOT_IS_ONBOARDING", value="true" if job.get("isOnboarding") else "false"))
        if job.get("modePersonalityVoiceConfig") is not None:
            config_str = json.dumps(job.get("modePersonalityVoiceConfig"))
            env_vars.append(client.V1EnvVar(name="BOT_MODE_CONFIG_JSON", value=config_str))
        if job.get("sessionOverride") is not None:
            override_str = json.dumps(job.get("sessionOverride"))
            env_vars.append(client.V1EnvVar(name="BOT_SESSION_OVERRIDE_JSON", value=override_str))

        # Define the Job
        container = client.V1Container(
            name="bot",
            image=image,
            image_pull_policy="IfNotPresent",
            command=["python", "-m", "uvicorn", "runner_main:app", "--host", "0.0.0.0", "--port", "8080"],
            env=env_vars,
            resources=client.V1ResourceRequirements(
                requests={"cpu": "100m", "memory": "256Mi"},
                limits={"cpu": "500m", "memory": "512Mi"}
            ),
            liveness_probe=client.V1Probe(
                http_get=client.V1HTTPGetAction(path="/health", port=8080),
                initial_delay_seconds=15,
                period_seconds=20,
                timeout_seconds=2,
                failure_threshold=3,
            ),
            readiness_probe=client.V1Probe(
                http_get=client.V1HTTPGetAction(path="/health", port=8080),
                initial_delay_seconds=5,
                period_seconds=10,
                timeout_seconds=2,
                failure_threshold=3,
            )
        )
        
        template = client.V1PodTemplateSpec(
            metadata=client.V1ObjectMeta(labels={"app": "pipecat-bot", "job-name": job_name}),
            spec=client.V1PodSpec(
                restart_policy="Never",
                containers=[container]
            )
        )
        
        spec = client.V1JobSpec(
            template=template,
            backoff_limit=0,
            ttl_seconds_after_finished=300  # Auto-delete finished pods after ~5 minutes to prevent stale jobs
        )
        
        job_obj = client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=client.V1ObjectMeta(
                name=job_name,
                namespace=NAMESPACE,
                owner_references=[self.owner_reference] if self.owner_reference else None,
            ),
            spec=spec
        )
        
        try:
            await asyncio.to_thread(
                self.batch_v1.create_namespaced_job,
                namespace=NAMESPACE,
                body=job_obj
            )
            logger.info(f"[operator] Created Job {job_name}")
        except client.ApiException as e:
            logger.error(f"[operator] Failed to create Job: {e}")

    async def shutdown(self):
        logger.info("[operator] Shutting down...")
        self.shutdown_event.set()
        if self.redis:
            await self.redis.close()
        logger.info("[operator] Shutdown complete")

if __name__ == "__main__":
    try:
        asyncio.run(BotOperator().run())
    except KeyboardInterrupt:
        pass
