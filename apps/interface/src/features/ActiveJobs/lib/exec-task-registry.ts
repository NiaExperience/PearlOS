/**
 * Exec task registry — automatic task tracking for shell exec calls.
 *
 * When Pearl (or any caller of the terminal exec API) runs a Claude CLI command,
 * the registry writes a session record that the ActiveJobs widget picks up via
 * `/api/openclaw/sessions`. The record uses the `agent:claude-code:pearl-exec:*`
 * key prefix so the existing KIND_MATCHERS route it to kind='claude-code'.
 *
 * Session store:   ~/.openclaw/agents/pearl-exec/sessions/sessions.json
 * Widget polls:    /api/openclaw/sessions (reads all agent dirs)
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const AGENT_NAME = 'pearl-exec';
const SESSION_STORE = path.join(
  os.homedir(),
  '.openclaw',
  'agents',
  AGENT_NAME,
  'sessions',
  'sessions.json'
);

type SessionRecord = {
  sessionId: string;
  label: string;
  displayName: string;
  task: string;
  description: string;
  channel: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  status: 'running' | 'complete' | 'failed';
  exitCode?: number;
  spawnedBy: string;
};

type SessionStore = Record<string, SessionRecord>;

/**
 * Detects whether a shell command invokes the Claude CLI.
 * Matches standalone `claude`, `claude-code`, env-prefixed (`HOME=... claude`),
 * piped (`echo x | claude`), and subshell (`$(claude ...)`) invocations.
 * Intentionally avoids false positives on paths like `claudette` or `claude.log`.
 */
export function isClaudeCliCommand(command: string): boolean {
  if (!command) return false;
  // Word-boundary match for `claude` or `claude-code` as an executable token.
  // Allowed leading contexts: line start, whitespace, `;`, `&`, `|`, `(`, `$(`,
  // backtick, or env-var assignments (letters=value pattern handled by whitespace after).
  return /(^|[\s;&|`(])(claude-code|claude)(\s|$)/.test(command);
}

/**
 * Derives a short, human-readable label from an arbitrary Claude CLI command.
 * Example:
 *   `HOME=/root claude --print "Build the project"` → `claude --print "Build the project"`
 *   trimmed to 80 chars.
 */
export function deriveLabel(command: string): string {
  const trimmed = command.trim();
  // Strip leading env-var assignments (VAR=value ...) before the binary.
  const withoutEnv = trimmed.replace(/^(\w+=[^\s]+\s+)+/, '');
  // Take up to the first redirection/pipe for the headline.
  const headline = withoutEnv.split(/[|>&;]/)[0].trim();
  return headline.length > 80 ? headline.slice(0, 77) + '...' : headline;
}

// In-process mutex chain. Serializes read-modify-write to the session store
// within a single Next.js worker. Does not protect against cross-process races,
// which are acceptable for a best-effort task registry.
let writeChain: Promise<void> = Promise.resolve();

async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readStore(): Promise<SessionStore> {
  try {
    const raw = await fs.readFile(SESSION_STORE, 'utf-8');
    return JSON.parse(raw) as SessionStore;
  } catch {
    return {};
  }
}

async function writeStore(store: SessionStore): Promise<void> {
  await fs.mkdir(path.dirname(SESSION_STORE), { recursive: true });
  const tmp = SESSION_STORE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8');
  await fs.rename(tmp, SESSION_STORE);
}

function makeTaskId(): string {
  // UUID-like id for the session key tail; short to keep keys readable.
  return crypto.randomBytes(8).toString('hex');
}

export type RegisterOptions = {
  command: string;
  spawnedBy?: string; // e.g. 'terminal-api', 'pearl-voice'
  label?: string;     // override derived label
};

export type RegisterResult = {
  taskId: string;
  sessionKey: string;
  startedAt: number;
};

/**
 * Registers a running Claude CLI exec task. Returns the session key used so
 * the caller can later mark it complete. No-op (returns null) if the command
 * does not look like a Claude CLI invocation.
 */
export async function registerClaudeExecTask(
  opts: RegisterOptions,
): Promise<RegisterResult | null> {
  if (!isClaudeCliCommand(opts.command)) return null;

  const taskId = makeTaskId();
  const sessionKey = `agent:claude-code:pearl-exec:${taskId}`;
  const now = Date.now();
  const label = opts.label || deriveLabel(opts.command);

  const record: SessionRecord = {
    sessionId: taskId,
    label,
    displayName: label,
    task: opts.command,
    description: label,
    channel: 'exec',
    model: 'claude-code',
    createdAt: now,
    updatedAt: now,
    status: 'running',
    spawnedBy: opts.spawnedBy || 'exec',
  };

  await withStoreLock(async () => {
    const store = await readStore();
    store[sessionKey] = record;
    await writeStore(store);
  });

  return { taskId, sessionKey, startedAt: now };
}

export type CompleteOptions = {
  exitCode: number;
  stderr?: string;
};

/**
 * Marks a previously-registered task as complete. The session record stays
 * visible in the widget for a few minutes (handled upstream by the sessions
 * route), then ages out.
 */
export async function completeClaudeExecTask(
  sessionKey: string,
  opts: CompleteOptions,
): Promise<void> {
  const now = Date.now();
  await withStoreLock(async () => {
    const store = await readStore();
    const record = store[sessionKey];
    if (!record) return;
    record.updatedAt = now;
    record.exitCode = opts.exitCode;
    record.status = opts.exitCode === 0 ? 'complete' : 'failed';
    await writeStore(store);
  });
}

// Exposed for tests only — do not import from feature code.
export const __internal = {
  SESSION_STORE,
  readStore,
  writeStore,
};
