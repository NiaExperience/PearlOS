import type { AsyncLocalStorage } from 'async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  sessionId?: string | null;
  userId?: string | null;
  userName?: string | null;
  tag?: string | null;
};

type LogMeta = Record<string, unknown> | undefined;

type Store = AsyncLocalStorage<LogContext> | null;

let store: Store | undefined;

function loadAsyncLocalStorage(): typeof import('async_hooks').AsyncLocalStorage | null {
  // AsyncLocalStorage is unavailable in edge/browser builds; skip context binding there.
  // In Node runtimes we rely on per-request logging contexts provided elsewhere.
  return null;
}

function ensureStore(): Store {
  if (store !== undefined) return store;

  const AsyncLocalStorageCtor = loadAsyncLocalStorage();
  store = AsyncLocalStorageCtor ? new AsyncLocalStorageCtor<LogContext>() : null;
  return store;
}

const consoleObj = console;

const serverSessionId = (() => {
  if (typeof process === 'undefined') return 'server';
  const pod = process.env.POD_NAME;
  const job = process.env.JOB_ID;
  const host = process.env.HOSTNAME;
  return pod || job || host || 'server';
})();

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return undefined;
  }
}

const defaultContext: Required<LogContext> = {
  sessionId: `server:${serverSessionId}`,
  userId: null,
  userName: null,
  tag: null,
};

const normalizeContext = (ctx?: LogContext): Required<LogContext> => ({
  sessionId: ctx?.sessionId ?? defaultContext.sessionId,
  userId: ctx?.userId ?? defaultContext.userId,
  userName: ctx?.userName ?? defaultContext.userName,
  tag: ctx?.tag ?? defaultContext.tag,
});

function emit(level: LogLevel, message: string, meta?: LogMeta, tag?: string | null) {
  const storeInstance = ensureStore();
  const ctx = normalizeContext(storeInstance?.getStore() ?? undefined);

  const payload = {
    level,
    message,
    tag: tag ?? ctx.tag,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    userName: ctx.userName,
    meta: meta ?? undefined,
    timestamp: new Date().toISOString(),
  };

  const line = safeStringify(payload) ?? message;
  const target = (consoleObj as any)?.[level] ?? consoleObj?.log;
  target?.call(consoleObj, line);
}

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  const storeInstance = ensureStore();
  if (!storeInstance) return fn();
  return storeInstance.run({ ...ctx }, fn);
}

export function setLogContext(ctx: LogContext): void {
  const storeInstance = ensureStore();
  if (!storeInstance) return;
  storeInstance.enterWith({ ...ctx });
}

export function getLogger(defaultTag?: string | null) {
  return {
    debug: (message: string, meta?: LogMeta) => emit('debug', message, meta, defaultTag ?? null),
    info: (message: string, meta?: LogMeta) => emit('info', message, meta, defaultTag ?? null),
    warn: (message: string, meta?: LogMeta) => emit('warn', message, meta, defaultTag ?? null),
    error: (message: string, meta?: LogMeta) => emit('error', message, meta, defaultTag ?? null),
  };
}

export const logger = getLogger();
