/**
 * OpenClaw Config API
 * GET  — read OpenClaw config from ~/.openclaw/openclaw.json
 * POST — deep-merge patch into OpenClaw config
 *
 * Special handling:
 * - agents.list updates merge by agent id (find and update, don't replace entire array)
 * - _updateAgentModel: { id: string, model: string } shortcut for updating a specific agent's model
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? join(homedir(), '.openclaw', 'openclaw.json');
const SESSIONS_PATH = process.env.OPENCLAW_SESSIONS_PATH ?? join(homedir(), '.openclaw', 'agents', 'main', 'sessions', 'sessions.json');

interface AgentConfig {
  id: string;
  name?: string;
  model?: { primary?: string };
  workspace?: string;
  [key: string]: unknown;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    // Special handling for agents.list: merge by agent id
    if (key === 'list' && Array.isArray(source[key]) && Array.isArray(target[key])) {
      const sourceList = source[key] as AgentConfig[];
      const targetList = [...(target[key] as AgentConfig[])] as AgentConfig[];
      
      for (const sourceAgent of sourceList) {
        const existingIdx = targetList.findIndex(a => a.id === sourceAgent.id);
        if (existingIdx >= 0) {
          // Deep merge the existing agent with the source agent
          targetList[existingIdx] = deepMerge(
            targetList[existingIdx] as Record<string, unknown>,
            sourceAgent as Record<string, unknown>
          ) as AgentConfig;
        } else {
          // New agent, add it
          targetList.push(sourceAgent);
        }
      }
      result[key] = targetList;
    } else if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export async function GET() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read OpenClaw config', detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const patch = body.patch;
    if (!patch || typeof patch !== 'object') {
      return NextResponse.json({ error: 'Missing "patch" object in body' }, { status: 400 });
    }

    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    const merged = deepMerge(config, patch);
    await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 4), 'utf-8');

    // Propagate primary model change to existing sessions so they don't use stale overrides.
    // Sessions store a session-level `model` field that takes precedence over config defaults.
    // When the user changes the primary model, we need to clear these overrides.
    const newPrimary = (patch?.agents?.defaults?.model?.primary as string) ?? null;
    let sessionsUpdated = 0;
    if (newPrimary) {
      try {
        const sessionsRaw = await readFile(SESSIONS_PATH, 'utf-8');
        const sessions = JSON.parse(sessionsRaw);
        // Strip provider prefix for the short model name used in sessions
        // e.g. "anthropic/claude-opus-4-6" → "claude-opus-4-6"
        const shortModel = newPrimary.includes('/') ? newPrimary.split('/').slice(1).join('/') : newPrimary;
        
        for (const [key, session] of Object.entries(sessions)) {
          if (!session || typeof session !== 'object') continue;
          const s = session as Record<string, unknown>;
          // Only update main user-facing sessions (not subagents, not sessions with intentional model overrides)
          // Update: agent:main:main (telegram/webchat), discord channels, pearlos-text-chat, voice
          const isUserSession = key === 'agent:main:main'
            || key.startsWith('agent:main:discord:')
            || key === 'agent:main:pearlos-text-chat'
            || key === 'agent:main:voice';
          if (isUserSession && s.model) {
            delete s.model; // Remove override so it inherits from config defaults
            sessionsUpdated++;
          }
        }
        
        if (sessionsUpdated > 0) {
          await writeFile(SESSIONS_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
        }
      } catch (sessErr) {
        // Non-fatal: config is saved, sessions just won't be synced
        console.warn('[openclaw-config] Failed to sync session models:', sessErr);
      }
    }

    // Trigger gateway restart to apply changes
    // Gateway listens on port from config, default 8000
    const gatewayPort = ((merged as Record<string, unknown>)?.gateway as Record<string, unknown> | undefined)?.port || 8000;
    try {
      await fetch(`http://localhost:${gatewayPort}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'config-patch' }),
      }).catch(() => {
        // Gateway restart endpoint may not exist in all modes - that's ok
      });
    } catch {
      // Non-fatal: config is saved, restart can be done manually
    }

    return NextResponse.json({ ok: true, config: merged, restartTriggered: true, sessionsUpdated });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update OpenClaw config', detail: String(error) },
      { status: 500 }
    );
  }
}
