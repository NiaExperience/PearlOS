import { AsyncLocalStorage } from 'async_hooks';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  sessionId?: string | null;
  userId?: string | null;
  userName?: string | null;
  tag?: string | null;
};

type LogMeta = Record<string, unknown> | undefined;

const store = new AsyncLocalStorage<LogContext>();

const serverSessionId = (() => {
  const pod = process.env.POD_NAME;
  const job = process.env.JOB_ID;
  const host = process.env.HOSTNAME;
  return pod || job || host || 'server';
})();

const LOG_LEVEL = (() => {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const allowed: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  return (allowed.includes(raw as LogLevel) ? raw : 'info') as LogLevel;
})();

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const consoleObj = console;

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return undefined;
  }
};

function normalizeContext(ctx?: LogContext): Required<LogContext> {
  return {
    sessionId: ctx?.sessionId ?? `server:${serverSessionId}`,
    userId: ctx?.userId ?? null,
    userName: ctx?.userName ?? null,
    tag: ctx?.tag ?? null,
  };
}

function emit(level: LogLevel, message: string, meta?: LogMeta, tag?: string | null) {
  if (levelOrder[level] < levelOrder[LOG_LEVEL]) return;

  const ctx = normalizeContext(store.getStore());
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
  const target = consoleObj?.[level] ?? consoleObj?.log;
  target?.call(consoleObj, line);
}

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return store.run({ ...ctx }, fn);
}

export function setLogContext(ctx: LogContext): void {
  store.enterWith({ ...ctx });
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