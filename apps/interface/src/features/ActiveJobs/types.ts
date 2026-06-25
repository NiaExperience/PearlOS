/**
 * ActiveJobs Feature — Type Definitions
 *
 * Tasks can require acknowledgment (agent-decided). Tasks that require it
 * persist in the UI until manually dismissed. Others auto-dismiss.
 */

export type TaskStatus = "running" | "done" | "failed";

export interface Task {
  id: string;
  /** Display name shown in the clean card view */
  name: string;
  /** Two-sentence description: what the agent is doing + what it's investigating/building */
  description?: string;
  status: TaskStatus;
  /**
   * Agent decides whether the task needs human review.
   *
   * true  → task persists until user manually dismisses (code changes, UI work, bug fixes, config)
   * false → task auto-dismisses after completion (reads, searches, status checks, info retrieval)
   *
   * Default: true (safer — assume review needed unless explicitly marked otherwise)
   */
  requiresAcknowledgment: boolean;

  // ── Metadata (shown behind ℹ️ info panel) ──
  model?: string;
  startedAt: string; // ISO timestamp
  source?: string; // e.g. "Discord", "Voice", "Web"
  tokens?: number;
  sessionId?: string;
  /** Any extra key-value metadata the agent wants to surface */
  meta?: Record<string, string>;
}

/** Duration helper — returns human-readable duration from ISO start time */
export function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/** Format token count with commas */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}
