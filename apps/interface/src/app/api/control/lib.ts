/**
 * PearlOS Control API — lightweight command queue for agent/QA automation
 * Stores commands in a JSON file so Playwright and the frontend can both access.
 */

import { promises as fs } from 'fs';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('ControlAPI');

// Single shared queue file (sufficient for single-node staging)
const QUEUE_PATH = process.env.CONTROL_QUEUE_PATH || '/workspace/nia-universal/qa/command-queue.json';

export interface ControlCommand {
  id: string;
  action: string;
  payload?: Record<string, unknown>;
  issuedAt: string;
  executedAt?: string;
  error?: string;
}

interface QueueState {
  commands: ControlCommand[];
  maxSize: number;
}

const DEFAULT_STATE: QueueState = { commands: [], maxSize: 100 };

async function readQueue(): Promise<QueueState> {
  try {
    const raw = await fs.readFile(QUEUE_PATH, 'utf-8');
    return JSON.parse(raw) as QueueState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function writeQueue(state: QueueState): Promise<void> {
  await fs.writeFile(QUEUE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

export async function enqueue(command: Omit<ControlCommand, 'id' | 'issuedAt'>): Promise<ControlCommand> {
  const state = await readQueue();
  const full: ControlCommand = {
    ...command,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    issuedAt: new Date().toISOString(),
  };
  state.commands.push(full);
  // Trim old commands
  if (state.commands.length > state.maxSize) {
    state.commands = state.commands.slice(-state.maxSize);
  }
  await writeQueue(state);
  log.info('Control command enqueued', { id: full.id, action: full.action });
  return full;
}

export async function pollPending(limit = 10): Promise<ControlCommand[]> {
  const state = await readQueue();
  return state.commands
    .filter(c => !c.executedAt)
    .slice(0, limit);
}

export async function markExecuted(id: string, error?: string): Promise<void> {
  const state = await readQueue();
  const cmd = state.commands.find(c => c.id === id);
  if (cmd) {
    cmd.executedAt = new Date().toISOString();
    if (error) cmd.error = error;
    await writeQueue(state);
  }
}

export async function clearQueue(): Promise<void> {
  await writeQueue({ ...DEFAULT_STATE });
}
