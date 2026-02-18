type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ClientLogMeta = Record<string, unknown> | undefined;

type ClientLogContext = {
  sessionId?: string | null;
  userId?: string | null;
  userName?: string | null;
};

const consoleObj = globalThis.console;
// Capture original console methods to avoid patched versions creating recursive logging loops.
const rawConsole = {
  debug: consoleObj?.debug?.bind(consoleObj) ?? consoleObj?.log?.bind(consoleObj),
  info: consoleObj?.info?.bind(consoleObj) ?? consoleObj?.log?.bind(consoleObj),
  warn: consoleObj?.warn?.bind(consoleObj) ?? consoleObj?.log?.bind(consoleObj),
  error: consoleObj?.error?.bind(consoleObj) ?? consoleObj?.log?.bind(consoleObj),
  log: consoleObj?.log?.bind(consoleObj),
};
let isEmitting = false;
let context: ClientLogContext = {};

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

const serializeValue = (val: unknown) => {
  if (val instanceof Error) {
    return { name: val.name, message: val.message, stack: val.stack };
  }

  if (typeof val !== 'object' || val === null) {
    return val;
  }

  const errorLike = val as { name?: unknown; message?: unknown; stack?: unknown };
  const normalized: Record<string, unknown> = {};
  if (typeof errorLike.name === 'string') normalized.name = errorLike.name;
  if (typeof errorLike.message === 'string') normalized.message = errorLike.message;
  if (typeof errorLike.stack === 'string') normalized.stack = errorLike.stack;

  return Object.keys(normalized).length ? { ...val, ...normalized } : val;
};

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, (_key, val) => serializeValue(val));
  } catch (_err) {
    return undefined;
  }
};

function emit(level: LogLevel, message: string, meta?: ClientLogMeta, tag?: string | null) {
  if (levelOrder[level] < levelOrder[LOG_LEVEL]) return;
  if (isEmitting) return; // prevent recursion if downstream console hooks call back here
  isEmitting = true;

  const payload = {
    level,
    message,
    tag: tag ?? null,
    sessionId: context.sessionId ?? null,
    userId: context.userId ?? null,
    userName: context.userName ?? null,
    meta: meta ?? undefined,
    timestamp: new Date().toISOString(),
  };

  const line = safeStringify(payload) ?? message;
  const target = rawConsole[level] ?? rawConsole.log;
  target?.(line);
  isEmitting = false;
}

export function setClientLogContext(ctx: ClientLogContext) {
  context = { ...context, ...ctx };
}

export function getClientLogger(defaultTag?: string | null) {
  return {
    debug: (message: string, meta?: ClientLogMeta) => emit('debug', message, meta, defaultTag ?? null),
    info: (message: string, meta?: ClientLogMeta) => emit('info', message, meta, defaultTag ?? null),
    warn: (message: string, meta?: ClientLogMeta) => emit('warn', message, meta, defaultTag ?? null),
    error: (message: string, meta?: ClientLogMeta) => emit('error', message, meta, defaultTag ?? null),
  };
}

export const clientLogger = getClientLogger();
