import { NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ActiveJob {
  id: string;
  key: string;
  label: string;
  description: string;
  status: 'running' | 'complete' | 'idle';
  channel: string;
  model: string;
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  displayName: string;
  totalTokens: number;
  kind: string;
}

// Dynamically discover all agent session stores
const AGENTS_DIR = path.join(process.env.HOME || '/root', '.openclaw/agents');

async function getSessionStorePaths(): Promise<string[]> {
  try {
    const agents = await readdir(AGENTS_DIR);
    return agents.map((agent) =>
      path.join(AGENTS_DIR, agent, 'sessions/sessions.json')
    );
  } catch {
    // Fallback to known paths if readdir fails
    return [
      path.join(AGENTS_DIR, 'main/sessions/sessions.json'),
      path.join(AGENTS_DIR, 'voice/sessions/sessions.json'),
      path.join(AGENTS_DIR, 'opus/sessions/sessions.json'),
      path.join(AGENTS_DIR, 'sonnet/sessions/sessions.json'),
      path.join(AGENTS_DIR, 'haiku/sessions/sessions.json'),
    ];
  }
}

// Sidecar file with human-readable task descriptions keyed by label
const DESCRIPTIONS_FILE = path.join(process.env.HOME || '/root', '.openclaw/workspace/job-descriptions.json');

// Only show sessions active in the last N minutes
const ACTIVE_MINUTES = 30;

/** Extract a short 1-line summary from a potentially huge task prompt */
function extractTaskSummary(task: string): string {
  if (!task) return '';
  const lines = task.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('---')) continue;
    if (trimmed.startsWith('```')) continue;
    // Found a meaningful line — truncate to 100 chars
    return trimmed.length > 100 ? trimmed.slice(0, 97) + '...' : trimmed;
  }
  return '';
}

async function loadDescriptions(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(DESCRIPTIONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    // Dynamically discover and read all agent session stores
    const sessionStorePaths = await getSessionStorePaths();
    const allSessions: Record<string, Record<string, unknown>> = {};
    for (const storePath of sessionStorePaths) {
      try {
        const raw = await readFile(storePath, 'utf-8');
        const store = JSON.parse(raw) as Record<string, Record<string, unknown>>;
        Object.assign(allSessions, store);
      } catch {
        // File might not exist, skip
      }
    }

    const descriptions = await loadDescriptions();
    const now = Date.now();
    const cutoff = now - ACTIVE_MINUTES * 60 * 1000;

    const jobs: ActiveJob[] = [];

    for (const [key, session] of Object.entries(allSessions)) {
      // Only show subagent and cron sessions (skip cron run duplicates)
      if (!key.includes('subagent') && !key.includes('cron')) continue;
      if (key.includes(':run:')) continue; // skip individual cron run entries, show parent only

      const updatedAt = Number(session.updatedAt) || 0;
      if (updatedAt < cutoff) continue;

      const ageMs = now - updatedAt;
      const isRunning = ageMs < 2 * 60 * 1000;   // updated in last 2 min = running
      const isComplete = ageMs >= 2 * 60 * 1000;  // no updates for 2+ min = complete

      // Don't return jobs that completed more than 5 minutes ago
      if (isComplete && ageMs > 5 * 60 * 1000) continue;

      const jobLabel = String(session.label || session.displayName || key.split(':').pop() || 'Job');

      // Try to find a human-readable description:
      // 1. Exact match on the label (e.g. "pre-release-health-monitor")
      // 2. Label with "Cron: " prefix stripped (e.g. "Cron: voice-pipeline-healthcheck" → "voice-pipeline-healthcheck")
      // 3. Partial match: try each description key to see if the label contains it
      // 4. Fall back to the session's own task/description field
      const strippedLabel = jobLabel.replace(/^Cron:\s*/, '');
      let resolvedDescription = descriptions[jobLabel]
        || descriptions[strippedLabel]
        || extractTaskSummary(String(session.task || ''))
        || String(session.description || '');

      // Partial-match fallback: find the longest description key that appears in the label
      if (!resolvedDescription) {
        let bestMatch = '';
        for (const descKey of Object.keys(descriptions)) {
          if (strippedLabel.includes(descKey) && descKey.length > bestMatch.length) {
            bestMatch = descKey;
          }
        }
        if (bestMatch) resolvedDescription = descriptions[bestMatch];
      }

      jobs.push({
        id: key,
        key,
        label: jobLabel,
        description: resolvedDescription,
        status: isRunning ? 'running' : 'complete',
        channel: String(session.channel || session.lastChannel || ''),
        model: String(session.model || ''),
        startedAt: Number(session.createdAt || session.updatedAt) || now,
        updatedAt,
        elapsedMs: now - updatedAt,
        displayName: String(session.displayName || session.label || ''),
        totalTokens: Number(session.totalTokens) || 0,
        kind: key.includes('subagent') ? 'subagent' : key.includes('cron') ? 'cron' : 'other',
      });
    }

    // Sort by most recently updated
    jobs.sort((a, b) => b.updatedAt - a.updatedAt);

    return NextResponse.json({ jobs, ts: now });
  } catch (err) {
    console.error('[openclaw/sessions] Failed:', err);
    return NextResponse.json({ jobs: [], ts: Date.now() });
  }
}
