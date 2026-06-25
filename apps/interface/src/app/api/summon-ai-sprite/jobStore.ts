/**
 * Server-side in-memory sprite-job tracker.
 *
 * The summon flow streams progress over an ndjson response. If the user
 * closes the panel/tab mid-generation the streaming reader dies, the
 * client-side `pending` state expires, and the finished sprite is lost
 * even though the backend still produced it. This module gives the
 * server a place to record the lifecycle so a remounted client can
 * GET /api/summon-ai-sprite/job/:id and rehydrate.
 *
 * In-memory only on purpose — the lifecycle is short (≤ 60s typical) and
 * Next dev/runtime restarts are rare during a summon. Old jobs are
 * pruned after JOB_TTL_MS so the map can never grow unboundedly. See
 * SPECTRUM bug #4.
 */
import { randomUUID } from 'crypto';

export type JobStatus = 'pending' | 'generating' | 'complete' | 'error';

export interface SpriteJob {
  jobId: string;
  status: JobStatus;
  prompt: string;
  bubbleLine: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: Record<string, unknown>;
  error?: string;
}

// Survive Next.js dev hot-reload by parking the map on globalThis. Each
// route module reload would otherwise spin up a fresh empty Map, which
// breaks /job/:id polling immediately after a code change.
const GLOBAL_KEY = Symbol.for('pearl.spriteJobStore.v1');
type GlobalScope = { [GLOBAL_KEY]?: Map<string, SpriteJob> };
const g = globalThis as unknown as GlobalScope;
const jobs: Map<string, SpriteJob> = (g[GLOBAL_KEY] ??= new Map<string, SpriteJob>());

const JOB_TTL_MS = 10 * 60 * 1000; // 10 min — long enough that polling on a slow reopen still finds the result

function pruneExpired(now: number): void {
  for (const [id, j] of jobs) {
    const last = j.completedAt ?? j.updatedAt;
    if (now - last > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createJob(prompt: string): SpriteJob {
  const now = Date.now();
  pruneExpired(now);
  const job: SpriteJob = {
    jobId: randomUUID(),
    status: 'pending',
    prompt,
    bubbleLine: 'Summoning…',
    startedAt: now,
    updatedAt: now,
  };
  jobs.set(job.jobId, job);
  return job;
}

export function getJob(jobId: string): SpriteJob | null {
  pruneExpired(Date.now());
  return jobs.get(jobId) ?? null;
}

export function updateJob(jobId: string, patch: Partial<SpriteJob>): SpriteJob | null {
  const existing = jobs.get(jobId);
  if (!existing) return null;
  const next: SpriteJob = { ...existing, ...patch, updatedAt: Date.now() };
  if ((patch.status === 'complete' || patch.status === 'error') && !next.completedAt) {
    next.completedAt = next.updatedAt;
  }
  jobs.set(jobId, next);
  return next;
}
