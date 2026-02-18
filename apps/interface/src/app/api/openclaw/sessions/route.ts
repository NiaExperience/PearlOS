import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
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

const SESSION_STORE = process.env.OPENCLAW_SESSION_STORE 
  || path.join(process.env.HOME || '/root', '.openclaw/agents/main/sessions/sessions.json');

// Sidecar file with human-readable task descriptions keyed by label
const DESCRIPTIONS_FILE = path.join(process.env.HOME || '/root', '.openclaw/workspace/job-descriptions.json');

// Only show sessions active in the last N minutes
const ACTIVE_MINUTES = 30;

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
    const [raw, descriptions] = await Promise.all([
      readFile(SESSION_STORE, 'utf-8'),
      loadDescriptions(),
    ]);
    const store = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const now = Date.now();
    const cutoff = now - ACTIVE_MINUTES * 60 * 1000;

    const jobs: ActiveJob[] = [];

    for (const [key, session] of Object.entries(store)) {
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

      jobs.push({
        id: key,
        key,
        label: jobLabel,
        description: descriptions[jobLabel] || String(session.task || session.description || ''),
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
