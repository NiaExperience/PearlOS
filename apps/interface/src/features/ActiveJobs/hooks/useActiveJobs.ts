'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type TaskQueueStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived';
export type TaskQueueUrgency = 'normal' | 'urgent';

export interface TaskNote {
  ts: string;
  text: string;
  kind?: string;
}

/** Live per-agent activity entry from /api/swarm/update. */
export interface SwarmAgentActivity {
  status?: 'running' | 'done' | 'failed' | string;
  thought?: string;
  updatedAt?: string;
}

export interface ActiveJob {
  id: string;
  key: string;
  label: string;
  fullTitle?: string;
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
  agents: string[];
  fadingOut?: boolean;
  // Task-queue fields surfaced to the widget
  assignee?: string;
  urgency?: TaskQueueUrgency;
  /**
   * True only when the user explicitly promoted this task with the EMERGENCY
   * action. Routine `urgency: 'urgent'` (e.g. set by manual "start now")
   * does NOT imply emergency.
   */
  emergency?: boolean;
  rawStatus?: TaskQueueStatus;
  /** User-relevant notes from the backend. Internal worker/retry notes are filtered out. */
  notes?: TaskNote[];
  /** Final agent output (set once terminal). Useful alongside notes for failed-task review. */
  result?: string | null;
  /** Note filename if auto-delivered to user workspace Documents folder */
  noteFilename?: string | null;
  /** Direct PearlOS URL for runnable task artifacts such as generated apps. */
  artifactUrl?: string | null;
  /** FileSpace folder path for file-producing tasks. */
  fileSpacePath?: string | null;
  /** Number of retry attempts the backend has made before giving up. */
  retryCount?: number;
  /**
   * Swarm category label (e.g. 'Legal', 'Creative'). Derived from backend
   * metadata if present; otherwise inferred from task text at display time.
   * Single-agent / CLI tasks collapse to "The Agency".
   */
  swarmCategory?: string;
  /**
   * Live per-agent activity for swarm tasks. Keys are agent model ids; values
   * carry status + partial "thought" text that pearl-swarm-dispatch posts as
   * agents run. Drives the emoji row + thinking bubbles in the widget.
   */
  agentActivity?: Record<string, SwarmAgentActivity>;
  /** Launchpad execution mode. fast_draft renders as a compact, short-lived card. */
  executionMode?: 'fast_draft' | 'full_build' | string;
}

export interface CompletedJob extends Omit<ActiveJob, 'status' | 'fadingOut'> {
  status: 'complete';
  completedAt: number;
}

const POLL_INTERVAL = 5000;
const MAX_COMPLETED_HISTORY = 50;

/**
 * Internal/system jobs that shouldn't appear in the user-facing widget.
 * These are cron heartbeats, scheduled checks, and other infrastructure
 * tasks that would confuse end users.
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
  if (job.kind === 'cron') return true;
  const text = `${job.label} ${job.displayName} ${job.description}`.toLowerCase();
  return INTERNAL_JOB_PATTERNS.some((pattern) => pattern.test(text));
}

function isFastDraftJob(job: ActiveJob): boolean {
  return job.executionMode === 'fast_draft';
}

function isUserVisibleTaskNote(note: TaskNote): boolean {
  const text = (note.text || '').trim();
  if (!text) return false;
  if (note.kind === 'internal' || note.kind === 'internal_retry') return false;
  if (/^Claimed by pearl-worker@/i.test(text)) return false;
  if (/^worker (?:reconciled|detected|handled|direct|failed|exception)/i.test(text)) return false;
  if (/^\[REAPER\]/i.test(text)) return false;
  if (/^executor:\s/i.test(text)) return false;
  if (/^manual trigger\s/i.test(text)) return false;
  if (/^Attempt #\d+ failed: .*Auto-requeued as pending for retry\.?$/i.test(text)) return false;
  return true;
}

/** Map pipecat task-queue status to the widget's job status domain. */
function mapStatus(s: TaskQueueStatus): ActiveJob['status'] {
  switch (s) {
    case 'in_progress':
      return 'running';
    case 'completed':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'complete';
    case 'archived':
      // Archived is a pseudo-terminal state — callers never render archived
      // jobs in the active pool, but if one slips through it should look
      // complete rather than idle (prevents phantom "pending" dots).
      return 'complete';
    case 'pending':
    default:
      return 'idle';
  }
}

/** Convert a TaskRecord from /api/tasks into the ActiveJob shape the widget expects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function taskToActiveJob(t: any): ActiveJob {
  const id = String(t.id || t.taskId || '');
  const createdIso = t.createdAt || t.timestamp_created || new Date().toISOString();
  const updatedIso = t.updatedAt || t.timestamp_updated || createdIso;
  const startedAt = new Date(createdIso).getTime();
  const updatedAt = new Date(updatedIso).getTime();
  const rawStatus: TaskQueueStatus = (t.status as TaskQueueStatus) || 'pending';
  const assignee: string | undefined = t.assignee || t.agentName || undefined;
  const urgency: TaskQueueUrgency = (t.urgency as TaskQueueUrgency) || 'normal';
  const emergency: boolean = t.emergency === true;
  const notes: TaskNote[] = Array.isArray(t.notes)
    ? (t.notes as TaskNote[]).filter((n) => n && typeof n.text === 'string').filter(isUserVisibleTaskNote)
    : [];
  const retryCount: number = typeof t.retryCount === 'number'
    ? t.retryCount
    : typeof t.retry_count === 'number'
      ? t.retry_count
      : 0;
  const rawAgents: string[] = Array.isArray(t.agents)
    ? (t.agents as unknown[]).map((a) => String(a)).filter(Boolean)
    : assignee
      ? [assignee]
      : [];
  const swarmCategory: string | undefined =
    t.swarmCategory || t.swarm_category || t.category || undefined;
  // Backend uses `kind` ('task' | 'swarm'). Fall back to 'swarm' when we see a
  // multi-agent task with no explicit kind so older records render correctly.
  const backendKind: string | undefined =
    typeof t.kind === 'string' && t.kind.trim() ? t.kind.trim() : undefined;
  const jobKind = backendKind || (rawAgents.length > 1 ? 'swarm' : 'task');
  // agent_activity (snake) or agentActivity (camel) — accept both.
  const rawActivity: Record<string, unknown> | undefined =
    (t.agentActivity && typeof t.agentActivity === 'object' ? t.agentActivity : undefined) ||
    (t.agent_activity && typeof t.agent_activity === 'object' ? t.agent_activity : undefined);
  let agentActivity: Record<string, SwarmAgentActivity> | undefined;
  if (rawActivity) {
    agentActivity = {};
    for (const [agentId, activity] of Object.entries(rawActivity)) {
      if (activity && typeof activity === 'object') {
        const a = activity as Record<string, unknown>;
        agentActivity[agentId] = {
          status: typeof a.status === 'string' ? (a.status as string) : undefined,
          thought: typeof a.thought === 'string' ? (a.thought as string) : undefined,
          updatedAt:
            typeof a.updated_at === 'string'
              ? (a.updated_at as string)
              : typeof a.updatedAt === 'string'
                ? (a.updatedAt as string)
                : undefined,
        };
      }
    }
  }
  return {
    id,
    key: id,
    label: t.title || id,
    fullTitle: t.fullTitle || t.full_title || t.title || undefined,
    description: t.description || t.task || '',
    status: mapStatus(rawStatus),
    channel: t.source || '',
    model: '',
    startedAt,
    updatedAt,
    elapsedMs: Math.max(0, updatedAt - startedAt),
    spawnedBy: t.createdBy || t.created_by || '',
    displayName: assignee || '',
    totalTokens: 0,
    kind: jobKind,
    agents: rawAgents,
    assignee,
    urgency,
    emergency,
    rawStatus,
    notes,
    result: (t.result as string | null) ?? null,
    noteFilename:
      (t.noteFilename as string | null) ??
      (t.note_filename as string | null) ??
      null,
    artifactUrl:
      (t.artifactUrl as string | null) ??
      (t.artifact_url as string | null) ??
      null,
    fileSpacePath:
      (t.fileSpacePath as string | null) ??
      (t.file_space_path as string | null) ??
      null,
    retryCount,
    swarmCategory,
    agentActivity,
    executionMode: t.executionMode || t.execution_mode || undefined,
  };
}

/** Controls for mutating tasks from the widget. */
export interface TaskActions {
  startTask: (taskId: string) => Promise<boolean>;
  emergencyTask: (taskId: string) => Promise<boolean>;
  cancelTask: (taskId: string) => Promise<boolean>;
  pauseTask: (taskId: string) => Promise<boolean>;
  stopTask: (taskId: string) => Promise<boolean>;
  prioritizeTask: (taskId: string) => Promise<boolean>;
  deprioritizeTask: (taskId: string) => Promise<boolean>;
  askAgent: (taskId: string, question: string) => Promise<boolean>;
  askPearlAboutTask: (taskId: string, question: string) => Promise<boolean>;
  clearFinished: (opts?: { includeCancelled?: boolean }) => Promise<number>;
  restoreTask: (taskId: string) => Promise<boolean>;
  archiveTask: (taskId: string) => Promise<boolean>;
  requeueTask: (taskId: string, note: string) => Promise<boolean>;
  refreshJobs: () => Promise<void>;
  fetchArchived: () => Promise<ActiveJob[]>;
  fetchFailed: () => Promise<ActiveJob[]>;
}

/** Transient toast message surfaced to the widget. */
export interface WidgetToast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export function useActiveJobs() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [completedHistory, setCompletedHistory] = useState<CompletedJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<WidgetToast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fastDraftDismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const showToast = useCallback((message: string, kind: WidgetToast['kind'] = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), kind, message });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      fastDraftDismissTimersRef.current.forEach((timer) => clearTimeout(timer));
      fastDraftDismissTimersRef.current.clear();
    };
  }, []);

  const scheduleFastDraftDismiss = useCallback((jobId: string) => {
    if (fastDraftDismissTimersRef.current.has(jobId)) return;
    const timer = setTimeout(() => {
      setJobs((cur) => cur.filter((j) => j.id !== jobId));
      setCompletedHistory((history) => history.filter((j) => j.id !== jobId));
      fastDraftDismissTimersRef.current.delete(jobId);
    }, 10000);
    fastDraftDismissTimersRef.current.set(jobId, timer);
  }, []);

  // Dismiss a job from the active list (called after user confirms via thumbs up/down)
  const dismissJob = useCallback((jobId: string) => {
    setJobs((cur) => cur.filter((c) => c.id !== jobId));
  }, []);

  /** Track ids we've already announced so polling won't re-toast them. */
  const announcedIdsRef = useRef<Set<string>>(new Set());
  /** Skip the very first poll's "new" tasks — they're history, not new arrivals. */
  const firstPollRef = useRef(true);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) {
        setError('Failed to fetch');
        return;
      }
      const data = await res.json();
      setError(null);

      const rawTasks: unknown[] = Array.isArray(data.tasks) ? data.tasks : [];
      const incoming: ActiveJob[] = rawTasks
        .map(taskToActiveJob)
        .filter((job) => {
          if (!isFastDraftJob(job) || job.status !== 'complete') return true;
          return Date.now() - job.updatedAt <= 10000;
        })
        // Cancelled tasks are soft-deleted — they should disappear from the
        // active widget after DELETE rather than lingering as fake "complete"
        // entries (the backend now filters them server-side too, but we keep
        // this client-side guard so older gateway versions also behave).
        .filter((job) => job.rawStatus !== 'cancelled')
        .filter((job) => !isInternalSystemJob(job));

      // Surface a chat toast whenever a brand-new task lands — gives the user
      // visible confirmation that "I added this" landed, even when they're
      // nowhere near the widget. First poll is silent so the existing backlog
      // doesn't blast the chat with stale notifications.
      if (typeof window !== 'undefined') {
        if (firstPollRef.current) {
          for (const j of incoming) announcedIdsRef.current.add(j.id);
          firstPollRef.current = false;
        } else {
          for (const j of incoming) {
            if (announcedIdsRef.current.has(j.id)) continue;
            announcedIdsRef.current.add(j.id);
            const titleSrc = (j.label || j.description || '').trim();
            const short = titleSrc.length > 64 ? titleSrc.slice(0, 61) + '…' : titleSrc;
            const message = short ? `New task added: ${short}` : 'New task added.';
            window.dispatchEvent(new CustomEvent('pearl:task-toast', { detail: { message } }));
          }
        }
      }

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
            if (isFastDraftJob(j)) scheduleFastDraftDismiss(j.id);

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
            if (isFastDraftJob(j)) scheduleFastDraftDismiss(j.id);

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

        // Seed completedHistory from incoming completed tasks the client
        // hasn't seen yet — keeps the Completed section populated on reload
        // without having to wait for a running→complete transition.
        setCompletedHistory((history) => {
          const known = new Set(history.map((h) => h.id));
          const seeds: CompletedJob[] = incoming
            .filter((j) => j.status === 'complete' && !known.has(j.id))
            .map((j) => ({ ...j, status: 'complete' as const, completedAt: j.updatedAt || Date.now() }));
          if (seeds.length === 0) return history;
          seeds.filter(isFastDraftJob).forEach((j) => scheduleFastDraftDismiss(j.id));
          return [...history, ...seeds]
            .sort((a, b) => b.completedAt - a.completedAt)
            .slice(0, MAX_COMPLETED_HISTORY);
        });

        return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      });
    } catch {
      setError('Network error');
    }
  }, [scheduleFastDraftDismiss]);

  useEffect(() => {
    void fetchJobs();
    const interval = setInterval(fetchJobs, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
    };
  }, [fetchJobs]);

  // ── Mutation actions ────────────────────────────────────────────────
  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      try {
        const r = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (r.ok) {
          void fetchJobs();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchJobs],
  );

  const startTask = useCallback(
    (taskId: string) => postAction({ action: 'start', taskId }),
    [postAction],
  );

  const emergencyTask = useCallback(
    (taskId: string) => postAction({ action: 'emergency', taskId }),
    [postAction],
  );

  const pauseTask = useCallback(
    (taskId: string) => postAction({ action: 'pause', taskId }),
    [postAction],
  );

  const stopTask = useCallback(
    (taskId: string) => postAction({ action: 'stop', taskId }),
    [postAction],
  );

  const prioritizeTask = useCallback(
    (taskId: string) => postAction({ action: 'priority', taskId }),
    [postAction],
  );

  const deprioritizeTask = useCallback(
    (taskId: string) => postAction({ action: 'deprioritize', taskId }),
    [postAction],
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      try {
        const r = await fetch(`/api/tasks?taskId=${encodeURIComponent(taskId)}`, {
          method: 'DELETE',
        });
        if (r.ok) {
          setJobs((cur) => cur.filter((c) => c.id !== taskId));
          void fetchJobs();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchJobs],
  );

  const askAgent = useCallback(
    (taskId: string, question: string) => postAction({ action: 'ask', taskId, question }),
    [postAction],
  );

  const askPearlAboutTask = useCallback(
    (taskId: string, question: string) => postAction({ action: 'question', taskId, question }),
    [postAction],
  );

  const clearFinished = useCallback(
    async (opts?: { includeCancelled?: boolean }): Promise<number> => {
      try {
        const r = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'clear-completed',
            includeCancelled: opts?.includeCancelled !== false,
          }),
        });
        if (!r.ok) {
          showToast('Failed to clear finished tasks', 'error');
          return 0;
        }
        const data = await r.json();
        const count: number = Number(data?.archivedCount ?? 0);
        // Drop the archived tasks from the completedHistory so the widget
        // reflects the sweep immediately; the next poll will catch up on any
        // the server archived that we hadn't seen yet.
        const archivedIds = new Set<string>(
          Array.isArray(data?.archivedIds) ? data.archivedIds.map(String) : [],
        );
        if (archivedIds.size > 0) {
          setCompletedHistory((h) => h.filter((j) => !archivedIds.has(j.id)));
          setJobs((cur) => cur.filter((c) => !archivedIds.has(c.id)));
        }
        if (count > 0) {
          showToast(`${count} task${count === 1 ? '' : 's'} archived`, 'success');
        } else {
          showToast('No finished tasks to clear', 'info');
        }
        void fetchJobs();
        return count;
      } catch {
        showToast('Failed to clear finished tasks', 'error');
        return 0;
      }
    },
    [fetchJobs, showToast],
  );

  const restoreTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      try {
        const r = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'restore', taskId }),
        });
        if (!r.ok) {
          showToast('Restore failed', 'error');
          return false;
        }
        showToast('Task restored to pending', 'success');
        void fetchJobs();
        return true;
      } catch {
        showToast('Restore failed', 'error');
        return false;
      }
    },
    [fetchJobs, showToast],
  );

  const archiveTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      try {
        const r = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'archive', taskId }),
        });
        if (!r.ok) {
          showToast('Archive failed', 'error');
          return false;
        }
        setCompletedHistory((h) => h.filter((j) => j.id !== taskId));
        setJobs((cur) => cur.filter((c) => c.id !== taskId));
        void fetchJobs();
        return true;
      } catch {
        showToast('Archive failed', 'error');
        return false;
      }
    },
    [fetchJobs, showToast],
  );

  // Thumbs-down feedback path: bounce a completed task back to pending and
  // append the user's note so the agent has the rework context. Removing the
  // task from completedHistory here (in addition to jobs) is what lets the
  // newly-pending record re-emerge in the active list — activePool filters
  // out anything still listed in completedHistory.
  const requeueTask = useCallback(
    async (taskId: string, note: string): Promise<boolean> => {
      try {
        const r = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reject', taskId, note }),
        });
        if (!r.ok) {
          showToast('Failed to re-queue task', 'error');
          return false;
        }
        setCompletedHistory((h) => h.filter((j) => j.id !== taskId));
        setJobs((cur) => cur.filter((c) => c.id !== taskId));
        showToast('Task re-queued for rework', 'success');
        void fetchJobs();
        return true;
      } catch {
        showToast('Failed to re-queue task', 'error');
        return false;
      }
    },
    [fetchJobs, showToast],
  );

  const fetchArchived = useCallback(async (): Promise<ActiveJob[]> => {
    try {
      const r = await fetch('/api/tasks?status=archived&include_archived=true&limit=500');
      if (!r.ok) return [];
      const data = await r.json();
      const raw: unknown[] = Array.isArray(data.tasks) ? data.tasks : [];
      return raw.map(taskToActiveJob);
    } catch {
      return [];
    }
  }, []);

  // Failed tasks live in their own bin for QA review — preserved by the
  // backend (never bulk-archived) so we can inspect notes/retryCount to learn
  // why they failed. This fetches a fresh list (with notes) on demand.
  const fetchFailed = useCallback(async (): Promise<ActiveJob[]> => {
    try {
      const r = await fetch('/api/tasks?status=failed&limit=500');
      if (!r.ok) return [];
      const data = await r.json();
      const raw: unknown[] = Array.isArray(data.tasks) ? data.tasks : [];
      return raw.map(taskToActiveJob);
    } catch {
      return [];
    }
  }, []);

  return {
    jobs,
    completedHistory,
    error,
    toast,
    dismissToast,
    dismissJob,
    startTask,
    emergencyTask,
    pauseTask,
    stopTask,
    prioritizeTask,
    deprioritizeTask,
    cancelTask,
    askAgent,
    askPearlAboutTask,
    clearFinished,
    restoreTask,
    archiveTask,
    requeueTask,
    refreshJobs: fetchJobs,
    fetchArchived,
    fetchFailed,
  };
}
