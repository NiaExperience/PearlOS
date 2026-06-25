import { NextRequest, NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

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
  agents: string[];
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
const ACTIVE_MINUTES = 60;

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

function clean(value: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanUnknown(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sessionTenantId(session: Record<string, unknown>): string {
  const direct =
    cleanUnknown(session.tenantId) ||
    cleanUnknown(session.tenant_id) ||
    cleanUnknown(session.requesterTenantId) ||
    cleanUnknown(session.requester_tenant_id);
  if (direct) return direct;

  const deliveryContext = session.deliveryContext;
  if (deliveryContext && typeof deliveryContext === 'object') {
    const context = deliveryContext as Record<string, unknown>;
    return cleanUnknown(context.tenantId) || cleanUnknown(context.tenant_id);
  }
  return '';
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const actorResult = await resolveInterfaceActorContext({
    requestedTenantId: clean(url.searchParams.get('tenantId')) || clean(url.searchParams.get('tenant_id')) || undefined,
    minimumRole: TenantRole.ADMIN,
  });
  if (!actorResult.ok) return actorResult.response;

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

    // Recognised job kinds — extensible. Each entry maps a key substring to the
    // "kind" label exposed to the widget. Order matters: the first match wins.
    const KIND_MATCHERS: Array<{ match: string; kind: string }> = [
      { match: 'subagent', kind: 'subagent' },
      { match: 'cron', kind: 'cron' },
      { match: 'agent:claude-code:', kind: 'claude-code' },
      { match: 'agent:codex:', kind: 'codex' },
      { match: 'agent:gemma:', kind: 'gemma' },
      { match: 'agent:qwen:', kind: 'qwen' },
      { match: 'agent:pearl-omega:', kind: 'agent' },
      { match: 'agent:pearl-exec:', kind: 'agent' },
      { match: 'agent:main:', kind: 'agent' },
      { match: 'agent:voice:', kind: 'agent' },
      { match: 'agent:claude:', kind: 'agent' },
      { match: 'agent:opus:', kind: 'agent' },
      { match: 'agent:sonnet:', kind: 'agent' },
      { match: 'agent:haiku:', kind: 'agent' },
      { match: 'agent:pearlos:', kind: 'agent' },
      { match: 'agent:gemini:', kind: 'agent' },
    ];

    function detectKind(key: string): string | null {
      for (const { match, kind } of KIND_MATCHERS) {
        if (key.includes(match)) return kind;
      }
      // Fallback: any key starting with "agent:" is a generic agent
      if (key.startsWith('agent:')) return 'agent';
      return null;
    }

    // Keys that represent chat conversations rather than tasks
    const CHAT_SESSION_PATTERNS = [
      /discord:channel:/,
      /discord:dm:/,
      /telegram:/,
      /signal:/,
      /:pearlos-text-chat$/,
      /:main$/,     // main session itself, not a task
      /:voice$/,    // voice session itself
    ];

    for (const [key, session] of Object.entries(allSessions)) {
      const tenantId = sessionTenantId(session);
      if (tenantId !== actorResult.actor.tenantId) continue;

      const kind = detectKind(key);
      if (!kind) continue;
      if (key.includes(':run:')) continue; // skip individual cron run entries, show parent only

      // Skip chat sessions — they're conversations, not tasks
      if (CHAT_SESSION_PATTERNS.some((p) => p.test(key))) continue;

      const updatedAt = Number(session.updatedAt) || 0;
      if (updatedAt < cutoff) continue;

      const ageMs = now - updatedAt;
      const isRunning = ageMs < 2 * 60 * 1000;   // updated in last 2 min = running
      const isComplete = ageMs >= 2 * 60 * 1000;  // no updates for 2+ min = complete

      // Don't return jobs that completed more than 30 minutes ago
      if (isComplete && ageMs > 30 * 60 * 1000) continue;

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

      // Build agents list from model + spawnedBy + kind info
      const agents: string[] = [];
      const modelName = String(session.model || '');
      if (modelName) agents.push(modelName);
      const spawnedBy = String(session.spawnedBy || '');
      if (spawnedBy && !agents.includes(spawnedBy)) agents.push(spawnedBy);

      jobs.push({
        id: key,
        key,
        label: jobLabel,
        description: resolvedDescription,
        status: isRunning ? 'running' : 'complete',
        channel: String(session.channel || session.lastChannel || ''),
        model: modelName,
        startedAt: Number(session.createdAt || session.updatedAt) || now,
        updatedAt,
        elapsedMs: now - updatedAt,
        displayName: String(session.displayName || session.label || ''),
        totalTokens: Number(session.totalTokens) || 0,
        kind,
        agents,
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
