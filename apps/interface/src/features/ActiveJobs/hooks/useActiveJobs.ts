'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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

const POLL_INTERVAL = 5000;
const FADE_OUT_DELAY = 10000;

export function useActiveJobs() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fadeTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/sessions');
      if (!res.ok) {
        setError('Failed to fetch');
        return;
      }
      const data = await res.json();
      setError(null);

      const incoming: ActiveJob[] = Array.isArray(data.jobs) ? data.jobs : [];

      setJobs((prev) => {
        // Merge: keep fading-out jobs, update existing, add new
        const map = new Map<string, ActiveJob>();

        // Keep previously fading-out items
        for (const j of prev) {
          if (j.fadingOut) map.set(j.id, j);
        }

        // Update with incoming
        for (const j of incoming) {
          const existing = prev.find((p) => p.id === j.id);
          const wasRunning = existing?.status === 'running';
          const nowComplete = j.status === 'complete';

          // If job just transitioned to complete, start fade-out
          if (nowComplete && wasRunning && !existing?.fadingOut) {
            map.set(j.id, { ...j, fadingOut: true });
            if (!fadeTimers.current.has(j.id)) {
              const timer = setTimeout(() => {
                setJobs((cur) => cur.filter((c) => c.id !== j.id));
                fadeTimers.current.delete(j.id);
              }, FADE_OUT_DELAY);
              fadeTimers.current.set(j.id, timer);
            }
          } else {
            map.set(j.id, { ...j, fadingOut: existing?.fadingOut });
          }
        }

        // Mark jobs that disappeared from API for fade-out
        for (const j of prev) {
          if (!incoming.find((i) => i.id === j.id) && !j.fadingOut && j.status === 'running') {
            map.set(j.id, { ...j, status: 'complete', fadingOut: true });

            if (!fadeTimers.current.has(j.id)) {
              const timer = setTimeout(() => {
                setJobs((cur) => cur.filter((c) => c.id !== j.id));
                fadeTimers.current.delete(j.id);
              }, FADE_OUT_DELAY);
              fadeTimers.current.set(j.id, timer);
            }
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
      fadeTimers.current.forEach((t) => clearTimeout(t));
    };
  }, [fetchJobs]);

  return { jobs, error };
}
