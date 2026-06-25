type JsonRecord = Record<string, unknown>;

const STORAGE_PREFIX = 'pearl-chat-tool-idempotency-v1';
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const RUNNING_TTL_MS = 30 * 1000;
const CHANNEL_NAME = 'pearl-chat-tool-idempotency';

type StoredEntry =
  | { status: 'running'; owner: string; updatedAt: number }
  | { status: 'completed'; result: string; updatedAt: number };

interface ToolKeyInput {
  userId?: string | null;
  sessionId?: string | null;
  turnKey: string;
  toolName: string;
  args: Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item as object)) return '[Circular]';
    seen.add(item as object);
    if (Array.isArray(item)) return item.map(normalize);
    const record = item as JsonRecord;
    return Object.keys(record).sort().reduce<JsonRecord>((acc, key) => {
      acc[key] = normalize(record[key]);
      return acc;
    }, {});
  };
  return JSON.stringify(normalize(value));
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}:${key}`;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readEntry(key: string): StoredEntry | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredEntry;
    if (!parsed || typeof parsed.updatedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEntry(key: string, entry: StoredEntry): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Idempotency is best-effort if storage is unavailable or full.
  }
}

function freshCompleted(entry: StoredEntry | null, ttlMs: number): string | null {
  if (!entry || entry.status !== 'completed') return null;
  return Date.now() - entry.updatedAt <= ttlMs ? entry.result : null;
}

function notifyCompleted(key: string): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ key });
    channel.close();
  } catch {
    // ignore
  }
}

function waitForCompletion(key: string, timeoutMs: number): Promise<string | null> {
  const immediate = freshCompleted(readEntry(key), DEFAULT_TTL_MS);
  if (immediate != null || typeof window === 'undefined') return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let done = false;
    let channel: BroadcastChannel | null = null;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (poller) clearInterval(poller);
      window.removeEventListener('storage', onStorage);
      try { channel?.close(); } catch {}
      resolve(result);
    };
    const check = () => {
      const result = freshCompleted(readEntry(key), DEFAULT_TTL_MS);
      if (result != null) finish(result);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey(key)) check();
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const poller = setInterval(check, 250);
    window.addEventListener('storage', onStorage);
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (event) => {
          if ((event.data as { key?: string } | null)?.key === key) check();
        };
      } catch {
        channel = null;
      }
    }
  });
}

async function withWebLock<T>(key: string, runner: () => Promise<T>, ttlMs: number): Promise<T | undefined> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return undefined;
  return locks.request(`pearl-chat-tool:${key}`, async () => {
    const existing = freshCompleted(readEntry(key), ttlMs);
    if (existing != null) return existing as T;
    writeEntry(key, { status: 'running', owner: 'web-lock', updatedAt: Date.now() });
    const result = await runner();
    writeEntry(key, { status: 'completed', result: String(result), updatedAt: Date.now() });
    notifyCompleted(key);
    return result;
  });
}

export function buildChatToolIdempotencyKey(input: ToolKeyInput): string {
  return hashString(stableStringify({
    userId: input.userId || 'anonymous',
    sessionId: input.sessionId || '',
    turnKey: input.turnKey,
    toolName: input.toolName,
    args: input.args,
  }));
}

export function buildChatToolTurnKey(parts: unknown): string {
  return hashString(stableStringify(parts));
}

export async function runIdempotentChatTool(
  key: string,
  runner: () => Promise<string>,
  options: { ttlMs?: number } = {},
): Promise<string> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const existing = freshCompleted(readEntry(key), ttlMs);
  if (existing != null) return existing;

  const locked = await withWebLock(key, runner, ttlMs);
  if (locked !== undefined) return String(locked);

  const owner = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = readEntry(key);
    const completed = freshCompleted(current, ttlMs);
    if (completed != null) return completed;

    if (current?.status === 'running' && Date.now() - current.updatedAt < RUNNING_TTL_MS) {
      const waited = await waitForCompletion(key, RUNNING_TTL_MS);
      if (waited != null) return waited;
      continue;
    }

    writeEntry(key, { status: 'running', owner, updatedAt: Date.now() });
    const claimed = readEntry(key);
    if (claimed?.status === 'running' && claimed.owner === owner) {
      const result = await runner();
      writeEntry(key, { status: 'completed', result, updatedAt: Date.now() });
      notifyCompleted(key);
      return result;
    }
  }

  const result = await runner();
  writeEntry(key, { status: 'completed', result, updatedAt: Date.now() });
  notifyCompleted(key);
  return result;
}
