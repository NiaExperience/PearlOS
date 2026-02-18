/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable import/order */
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import redis from '@interface/lib/redis';
import { getLogger, setLogContext } from '@interface/lib/logger';

import { NextRequest, NextResponse } from 'next/server';

import { findHtmlContentByJobId } from '@interface/features/HtmlGeneration/actions/html-generation-actions';

const STATUS_PREFIX = 'html-gen:status:';
const USER_JOBS_PREFIX = 'html-gen:user:';
const STATUS_TTL = 60 * 60; // 1 hour
const TEST_FALLBACK_USER_ID = '00000000-0000-0000-0000-000000000099';

type SessionLike = Awaited<ReturnType<typeof getSessionSafely>>;

function isHtmlGenerationTestMode(request: NextRequest): boolean {
  if (process.env.NODE_ENV === 'production') return false;

  return (
    process.env.NODE_ENV === 'test' ||
    process.env.CYPRESS === 'true' ||
    process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true' ||
    process.env.TEST_MODE === 'true' ||
    request.headers.get('X-Test-Mode') === 'true' ||
    request.headers.get('x-test-mode') === 'true'
  );
}

async function getHtmlGenerationSession(request: NextRequest): Promise<SessionLike> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (session?.user?.id) return session;
  } catch {
    // ignore and fall through to fallback
  }

  if (!isHtmlGenerationTestMode(request)) return null;

  return {
    user: {
      id: TEST_FALLBACK_USER_ID,
      name: 'Test Guest',
      email: null,
      image: null,
      is_anonymous: true,
      sessionId: 'html-gen-test-session'
    } as any,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  } as any;
}

const log = getLogger('[html-generation][status-route]');
const LOG_PREFIX = '[sprite-test] ';

interface GenerationStatus {
  isComplete: boolean;
  progress: number;
  phase: string;
  startTime: number;
  userId?: string;
  contentId?: string;
  title?: string;
  error?: string;
  htmlGeneration?: any;
  tenantId?: string; // Added for recovery
  lastRecoveryCheck?: number;
}

// In-memory storage for generation status tracking (Primary)
// Redis is used as a secondary persistent store for resilience
const generationStatus = new Map<string, GenerationStatus>();

// Ensure we have a connected Redis client before performing operations
async function getRedisClient() {
  if (!redis) return null;
  if (redis.status === 'ready') return redis;
  if (redis.status === 'connecting') return redis;
  try {
    log.warn(`${LOG_PREFIX}Redis client reconnect attempt`, { status: redis.status });
    await redis.connect();
  } catch (e) {
    log.warn(`${LOG_PREFIX}Failed to connect Redis client`, {
      err: e,
      redisStatus: redis.status
    });
    return null;
  }
  return redis.status === 'reconnecting' || redis.status === 'connect' ? redis : null;
}

// Helper to sync status to Redis (fire-and-forget)
async function syncToRedis(callId: string, status: GenerationStatus) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.set(`${STATUS_PREFIX}${callId}`, JSON.stringify(status), 'EX', STATUS_TTL);
    log.info(`${LOG_PREFIX}Redis status set`, { callId });
  } catch (e) {
    log.warn(`${LOG_PREFIX}Failed to sync status to Redis`, {
      err: e,
      callId,
      redisStatus: client?.status
    });
  }
}

async function getUserJobs(userId: string): Promise<string[]> {
  const client = await getRedisClient();
  if (!client) return [];
  try {
    const jobIds = await client.smembers(`${USER_JOBS_PREFIX}${userId}:jobs`);
    return Array.isArray(jobIds) ? jobIds : [];
  } catch (e) {
    log.warn(`${LOG_PREFIX}Failed to list jobs for user`, { err: e, userId });
    return [];
  }
}

async function listActiveJobsForUser(userId: string): Promise<Array<{ callId: string; status: GenerationStatus }>> {
  const client = await getRedisClient();
  if (!client) return [];
  const jobIds = await getUserJobs(userId);

  const activeJobs: Array<{ callId: string; status: GenerationStatus }> = [];

  for (const callId of jobIds) {
    let status = generationStatus.get(callId) || null;
    if (!status) {
      status = await getFromRedis(callId);
    }

    if (status?.isComplete) {
      void removeUserJob(userId, callId);
      continue;
    }

    if (!status) {
      void removeUserJob(userId, callId);
      continue;
    }

    activeJobs.push({ callId, status });
  }

  return activeJobs;
}

// Helper to get status from Redis
async function getFromRedis(callId: string): Promise<GenerationStatus | null> {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    const data = await client.get(`${STATUS_PREFIX}${callId}`);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    log.warn(`${LOG_PREFIX}Failed to get status from Redis`, {
      err: e,
      callId,
      redisStatus: client?.status
    });
    return null;
  }
}

// Helper to add job to user's active list
async function addUserJob(userId: string, callId: string) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const added = await client.sadd(`${USER_JOBS_PREFIX}${userId}:jobs`, callId);
    // Set expiry on the set itself to avoid infinite growth if not cleaned up?
    // No, sets don't expire per member. We should rely on explicit removal.
    // But we can set a long expiry on the key if we want.
    await client.expire(`${USER_JOBS_PREFIX}${userId}:jobs`, 60 * 60 * 24); // 24 hours
    log.info(`${LOG_PREFIX}Redis add job for user`, { userId, callId, added });
  } catch (e) {
    log.warn(`${LOG_PREFIX}Failed to add job to user list`, {
      err: e,
      userId,
      callId,
      redisStatus: client?.status
    });
  }
}

// Helper to remove job from user's active list
async function removeUserJob(userId: string, callId: string) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.srem(`${USER_JOBS_PREFIX}${userId}:jobs`, callId);
  } catch (e) {
    log.warn(`${LOG_PREFIX}Failed to remove job from user list`, {
      err: e,
      userId,
      callId,
      redisStatus: client?.status
    });
  }
}

/**
 * Attempts to recover a stale job by checking if the content was actually created in the DB.
 * This handles cases where the server crashed after DB save but before Redis update.
 */
async function recoverStaleJob(callId: string, status: GenerationStatus): Promise<GenerationStatus | null> {
  if (!status.tenantId) return null;
  
  try {
    const now = Date.now();
    if (status.lastRecoveryCheck && now - status.lastRecoveryCheck < 15000) {
      return null; // Throttle DB hits when polling rapidly
    }
    status.lastRecoveryCheck = now;
    log.info(`${LOG_PREFIX}Attempting to recover stale job from DB`, { callId });
    const content = await findHtmlContentByJobId(callId, status.tenantId);
    
    if (content) {
      log.info(`${LOG_PREFIX}Recovered job content from DB`, { callId });
      const newStatus: GenerationStatus = {
        ...status,
        isComplete: true,
        progress: 100,
        phase: 'Generation complete (recovered)',
        contentId: content._id,
        htmlGeneration: content
      };
      // Update local and Redis
      generationStatus.set(callId, newStatus);
      await syncToRedis(callId, newStatus);
      if (status.userId) await removeUserJob(status.userId, callId);
      return newStatus;
    } else {
      log.warn(`${LOG_PREFIX}Recovery failed - no content in DB`, { callId });
      // If it's very old (> 5 mins) and not in DB, mark as failed
      if (Date.now() - status.startTime > 5 * 60 * 1000) {
        const newStatus: GenerationStatus = {
          ...status,
          isComplete: true,
          progress: 100,
          phase: 'Generation failed (timeout)',
          error: 'Generation timed out or server restarted during processing.'
        };
        generationStatus.set(callId, newStatus);
        await syncToRedis(callId, newStatus);
        if (status.userId) await removeUserJob(status.userId, callId);
        return newStatus;
      }
    }
  } catch (e) {
    log.error(`${LOG_PREFIX}Error recovering stale job`, { err: e, callId });
  }
  return null;
}

/**
 * POST /api/html-generation/status
 * Handles status polling for HTML generation progress
 */
export async function POST_impl(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getHtmlGenerationSession(request);
    if (!session || !session.user) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const sessionId = typeof (session.user as any)?.sessionId === 'string' ? (session.user as any).sessionId : session.user.id;
    setLogContext({
      sessionId: sessionId ?? undefined,
      userId: session.user.id ?? undefined,
      userName:
        'name' in session.user && typeof session.user.name === 'string'
          ? session.user.name
          : 'email' in session.user && typeof session.user.email === 'string'
            ? session.user.email
            : undefined,
      tag: '[html-generation.status-route]',
    });

    const body = await request.json();
    const { callId } = body;

    if (!callId) {
      return NextResponse.json({ 
        success: false, 
        message: 'callId is required' 
      }, { status: 400 });
    }

    // log.debug({ callId }, 'Status check');

    // 1. Try In-Memory Map
    let status = generationStatus.get(callId);
    
    // 2. If missing, Try Redis (Resilience)
    if (!status) {
      const redisStatus = await getFromRedis(callId);
      if (redisStatus) {
        log.info(`${LOG_PREFIX}Restored status from Redis`, { callId });
        status = redisStatus;
        
        // Check if stale (processing but not in memory map implies restart)
        if (!status.isComplete) {
           const recovered = await recoverStaleJob(callId, status);
           if (recovered) status = recovered;
        }
        
        generationStatus.set(callId, status);
      }
    }

    // 3. If still missing, Initialize New
    if (!status) {
      // Initialize new generation status
      status = {
        isComplete: false,
        progress: 0,
        phase: 'Starting content generation...',
        startTime: Date.now(),
        userId: session.user.id,
        tenantId: session.user.id // Capture tenantId for recovery
      };
      generationStatus.set(callId, status);
      await syncToRedis(callId, status);
      // Also track for user
      if (session.user.id) {
        await addUserJob(session.user.id, callId);
      }
      log.info(`${LOG_PREFIX}Initialized status for call`, { callId, userId: session.user.id });
    }

    // Opportunistic recovery: if DB already has the content, mark complete and prune user job
    if (!status.isComplete) {
      const recovered = await recoverStaleJob(callId, status);
      if (recovered) {
        status = recovered;
      }
    }

      // Simulate progress based on elapsed time (demo). In production we would
      // update this map from real generation phases. Because the creation POST
      // no longer marks completion synchronously, the UI now relies on this
      // endpoint to drive readiness and will not announce ready until
      // isComplete=true here.
  const elapsedTime = Date.now() - status.startTime;
  // Allow complex apps up to ~5 minutes. We keep simulated progress <100 until
  // a completion signal arrives, or we hard-cap at 5 minutes to avoid hanging.
  const estimatedDuration = 540000; // 9 minutes for progress curve

    if (!status.isComplete) {
  // Cap simulated progress to 99% to avoid premature "done" perception.
  const progressPercentage = Math.min(Math.floor((elapsedTime / estimatedDuration) * 100), 99);
      
      // Update phase based on progress
      let currentPhase = 'Starting content generation...';
      if (progressPercentage >= 80) {
        currentPhase = 'Almost done, putting finishing touches...';
      } else if (progressPercentage >= 60) {
        currentPhase = 'Finalizing styling and scripts...';
      } else if (progressPercentage >= 40) {
        currentPhase = 'Adding interactive features...';
      } else if (progressPercentage >= 20) {
        currentPhase = 'Generating HTML structure...';
      } else if (progressPercentage >= 10) {
        currentPhase = 'Analyzing your requirements...';
      }

      // Only update if changed
      if (progressPercentage > status.progress || currentPhase !== status.phase) {
        status.progress = progressPercentage;
        status.phase = currentPhase;

        // If we pass a hard 10 minute window, finalize to avoid indefinite spinners.
        if (elapsedTime >= 600000) { // 10 minutes
          status.isComplete = true;
          status.progress = 100;
          status.phase = status.phase?.toLowerCase().includes('failed') ? status.phase : 'Generation complete (time cap)';
          log.info(`${LOG_PREFIX}Auto-finalized status after time cap`, { callId });
          
          // Try one last recovery check before giving up
          const recovered = await recoverStaleJob(callId, status);
          if (recovered) {
             status = recovered;
          }
        }

        generationStatus.set(callId, status);
        await syncToRedis(callId, status);
      }
    }

    // FIX: Clean up old entries (older than 10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    for (const [key, value] of generationStatus.entries()) {
      if (value.startTime < tenMinutesAgo) {
        generationStatus.delete(key);
        log.info(`${LOG_PREFIX}Cleaned up old status entry`, { callId: key });
      }
    }

    // If job completed, ensure we prune the user's Redis set for hygiene
    if (status.isComplete && status.userId) {
      await removeUserJob(status.userId, callId);
    }

    return NextResponse.json({
      success: true,
      data: {
        isComplete: status.isComplete,
        progress: status.progress,
        phase: status.phase,
        contentId: status.contentId,
        title: status.title,
        error: status.error,
        htmlGeneration: status.htmlGeneration
      }
    });

  } catch (error) {
    log.error(`${LOG_PREFIX}Error checking generation status`, { err: error });
    return NextResponse.json({
      success: false,
      message: 'Failed to check generation status',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET_impl(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getHtmlGenerationSession(request);
    if (!session || !session.user?.id) {
      const host = request.headers.get('host') || request.headers.get('x-forwarded-host') || '';
      const isLocal =
        process.env.NODE_ENV !== 'production' &&
        (host.includes('localhost') || host.includes('127.0.0.1'));

      // Local/demo: this endpoint is polled by a global UI widget. Returning 401 here
      // trips the app error boundary, so we gracefully return an empty job list.
      if (isLocal) {
        return NextResponse.json({ success: true, data: { activeJobs: [] } });
      }

      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const sessionId = typeof (session.user as any)?.sessionId === 'string' ? (session.user as any).sessionId : session.user.id;
    setLogContext({
      sessionId: sessionId ?? undefined,
      userId: session.user.id ?? undefined,
      userName:
        'name' in session.user && typeof session.user.name === 'string'
          ? session.user.name
          : 'email' in session.user && typeof session.user.email === 'string'
            ? session.user.email
            : undefined,
      tag: '[html-generation.status-route]',
    });

    // If Redis is disabled/unavailable, return empty list gracefully
    if (!redis) {
      return NextResponse.json({ success: true, data: { activeJobs: [] } });
    }

    const activeJobs = await listActiveJobsForUser(session.user.id);

    return NextResponse.json({
      success: true,
      data: {
        activeJobs
      }
    });
  } catch (error) {
    log.error(`${LOG_PREFIX}Error listing active generation jobs`, { err: error });
    return NextResponse.json({ success: false, message: 'Failed to list active jobs' }, { status: 500 });
  }
}

/**
 * Helper function to manually mark a generation as complete
 * This would be called when the actual generation finishes
 */
export async function markGenerationComplete(callId: string, tenantId?: string): Promise<void> {
  let status = generationStatus.get(callId);
  if (!status) {
    // If we haven't seen this callId yet (e.g. synchronous generation finished
    // before any polling began), create an entry already completed so subsequent
    // polls do NOT trigger the simulated-progress path that would later emit an
    // additional "Generation complete" phase causing duplicate readiness UI.
    status = {
      isComplete: true,
      progress: 100,
      phase: 'Generation complete',
      startTime: Date.now(),
      tenantId,
      userId: tenantId
    };
    generationStatus.set(callId, status);
    await syncToRedis(callId, status);
    if (status.userId) await removeUserJob(status.userId, callId);
    log.info(`${LOG_PREFIX}Created and marked generation complete for new callId`, { callId, tenantId });
    return;
  }
  if (!status.isComplete || status.progress !== 100 || status.phase !== 'Generation complete') {
    status.isComplete = true;
    status.progress = 100;
    status.phase = 'Generation complete';
    if (tenantId) status.tenantId = tenantId;
    if (!status.userId && tenantId) status.userId = tenantId;
    generationStatus.set(callId, status);
    await syncToRedis(callId, status);
    if (status.userId) await removeUserJob(status.userId, callId);
    log.info(`${LOG_PREFIX}Manually marked generation complete for existing callId`, { callId, tenantId: status.tenantId });
  }
}

/**
 * Initialize generation status for a new job
 */
export async function setGenerationStarted(callId: string, title: string, tenantId?: string, userId?: string): Promise<void> {
  const status = {
    isComplete: false,
    progress: 0,
    phase: 'Starting content generation...',
    startTime: Date.now(),
    title,
    userId: userId || tenantId,
    tenantId,
    lastRecoveryCheck: Date.now()
  };
  generationStatus.set(callId, status);
  await syncToRedis(callId, status);
  if (status.userId) await addUserJob(status.userId, callId);
  log.info(`${LOG_PREFIX}Initialized status for call`, { callId, tenantId, userId: status.userId, title });
}

/**
 * Mark generation as completed with results
 */
export async function setGenerationCompleted(callId: string, contentId: string, title: string, tenantId?: string, htmlGeneration?: any, userId?: string): Promise<void> {
  const status = generationStatus.get(callId) || {
    isComplete: false,
    progress: 0,
    phase: 'Starting content generation...',
    startTime: Date.now(),
    userId: userId || tenantId,
    tenantId
  };
  status.isComplete = true;
  status.progress = 100;
  status.phase = 'Generation complete';
  status.contentId = contentId;
  status.title = title;
  status.tenantId = tenantId || status.tenantId;
  status.userId = userId || status.userId;
  if (htmlGeneration) status.htmlGeneration = htmlGeneration;
  generationStatus.set(callId, status);
  await syncToRedis(callId, status);
  if (status.userId) await removeUserJob(status.userId, callId);
  const recordId = (htmlGeneration && (htmlGeneration._id || htmlGeneration.id)) || contentId;
  const recordTenantId = (htmlGeneration && htmlGeneration.tenantId) || status.tenantId;
  const recordOwnerId = htmlGeneration?.createdBy || htmlGeneration?.parentId || htmlGeneration?.parent_id || status.userId;

  log.info(`${LOG_PREFIX}Marked generation complete`, {
    callId,
    contentId: recordId,
    tenantId: recordTenantId,
    userId: status.userId,
    recordOwnerId,
    createdBy: htmlGeneration?.createdBy,
    title,
  });
}

/**
 * Mark generation as failed
 */
export async function setGenerationFailed(callId: string, error: string, tenantId?: string, userId?: string): Promise<void> {
  const status = generationStatus.get(callId);
  if (status) {
    status.isComplete = true;
    status.progress = 100;
    status.phase = 'Generation failed';
    status.error = error;
    status.tenantId = tenantId || status.tenantId;
    status.userId = userId || status.userId;
    generationStatus.set(callId, status);
    await syncToRedis(callId, status);
    if (status.userId) await removeUserJob(status.userId, callId);
    log.warn(`${LOG_PREFIX}Marked generation failed`, { callId, tenantId: status.tenantId, userId: status.userId, error });
  }
}

/**
 * Helper function to update generation progress
 * This would be called during the actual generation process
 */
export async function updateGenerationProgress(callId: string, progress: number, phase: string): Promise<void> {
  const status = generationStatus.get(callId);
  if (status) {
    status.progress = Math.min(progress, 100);
    status.phase = phase;
    if (progress >= 100) {
      status.isComplete = true;
    }
    generationStatus.set(callId, status);
    await syncToRedis(callId, status);
    log.info(`${LOG_PREFIX}Updated generation progress`, { callId, progress, phase });
  }
}
