'use client';

import { useState, useEffect, useCallback } from 'react';

export interface ActiveJob {
  id: string;
  key: string;
  label: string;
  description: string;
  status: 'running' | 'complete' | 'idle' | 'failed';
  channel: string;
  model: string;
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  spawnedBy: string;
  displayName: string;
  totalTokens: number;
  kind: string;
  fadingOut?: boolean;
}

export interface CompletedJob extends Omit<ActiveJob, 'status' | 'fadingOut'> {
  status: 'complete';
  completedAt: number;
}

const POLL_INTERVAL = 5000;
const MAX_COMPLETED_HISTORY = 5;

/**
 * Internal/system jobs that shouldn't appear in the user-facing widget.
 * These are OpenClaw cron heartbeats, scheduled checks, and other
 * infrastructure tasks that would confuse end users.
 */
const INTERNAL_JOB_PATTERNS = [
  /heartbeat/i,
  /scheduled.?check/i,
  /health.?check/i,
  /healthcheck/i,
  /health.?monitor/i,
  /discord.?progress/i,
  /progress.?update/i,
  /sync.?protocol/i,
  /memory.?maintenance/i,
  /activity.?log/i,
  /cron.?run/i,
  /inbox.?check/i,
  /email.?check/i,
  /calendar.?check/i,
  /weather.?check/i,
];

function isInternalSystemJob(job: ActiveJob): boolean {
  // All cron jobs are internal system tasks — users don't need to see scheduled checks
  if (job.kind === 'cron') return true;

  // Check label and description against known internal patterns
  const text = `${job.label} ${job.displayName} ${job.description}`.toLowerCase();
  return INTERNAL_JOB_PATTERNS.some((pattern) => pattern.test(text));
}

export function useActiveJobs() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [completedHistory, setCompletedHistory] = useState<CompletedJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Dismiss a job from the active list (called after user confirms via thumbs up/down)
  const dismissJob = useCallback((jobId: string) => {
    setJobs((cur) => cur.filter((c) => c.id !== jobId));
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/sessions');
      if (!res.ok) {
        setError('Failed to fetch');
        return;
      }
      const data = await res.json();
      setError(null);

      // Filter out internal system jobs that shouldn't be user-facing
      const incoming: ActiveJob[] = (Array.isArray(data.jobs) ? data.jobs : []).filter(
        (job: ActiveJob) => !isInternalSystemJob(job)
      );

      setJobs((prev) => {
        const map = new Map<string, ActiveJob>();

        // Keep previously completed jobs that haven't been dismissed
        for (const j of prev) {
          if (j.status === 'complete') map.set(j.id, j);
        }

        // Update with incoming
        for (const j of incoming) {
          const existing = prev.find((p) => p.id === j.id);
          const wasRunning = existing?.status === 'running';
          const nowComplete = j.status === 'complete';

          if (nowComplete && wasRunning) {
            // Job just completed — mark it but keep it visible (no auto-removal)
            map.set(j.id, { ...j, fadingOut: false });
            
            // Add to completed history for reference
            setCompletedHistory((history) => {
              const completedJob: CompletedJob = {
                ...j,
                status: 'complete',
                completedAt: Date.now(),
              };
              const filtered = history.filter((h) => h.id !== j.id);
              return [completedJob, ...filtered].slice(0, MAX_COMPLETED_HISTORY);
            });
          } else {
            map.set(j.id, { ...j, fadingOut: existing?.fadingOut });
          }
        }

        // Mark jobs that disappeared from API as complete (keep visible)
        for (const j of prev) {
          if (!incoming.find((i) => i.id === j.id) && j.status === 'running') {
            map.set(j.id, { ...j, status: 'complete', fadingOut: false });
            
            setCompletedHistory((history) => {
              const completedJob: CompletedJob = {
                ...j,
                status: 'complete',
                completedAt: Date.now(),
              };
              const filtered = history.filter((h) => h.id !== j.id);
              return [completedJob, ...filtered].slice(0, MAX_COMPLETED_HISTORY);
            });
          }
        }

        return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      });
    } catch {
      setError('Network error');
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
    const interval = setInterval(fetchJobs, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
    };
  }, [fetchJobs]);

  return { jobs, completedHistory, error, dismissJob };
}
