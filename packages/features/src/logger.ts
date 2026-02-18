type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogMeta = Record<string, unknown> | undefined;

type LogContext = {
  sessionId?: string | null;
  userId?: string | null;
  userName?: string | null;
  tag?: string | null;
};

const defaultContext: Required<LogContext> = {
  sessionId: 'server:features',
  userId: null,
  userName: null,
  tag: null,
};

function normalizeContext(ctx?: LogContext): Required<LogContext> {
  return {
    sessionId: ctx?.sessionId ?? defaultContext.sessionId,
    userId: ctx?.userId ?? defaultContext.userId,
    userName: ctx?.userName ?? defaultContext.userName,
    tag: ctx?.tag ?? defaultContext.tag,
  };
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return undefined;
  }
}

function emit(level: LogLevel, message: string, meta?: LogMeta, ctx?: LogContext) {
  const context = normalizeContext(ctx);
  const payload = {
    level,
    message,
    tag: context.tag,
    sessionId: context.sessionId,
    userId: context.userId,
    userName: context.userName,
    meta: meta ?? undefined,
    timestamp: new Date().toISOString(),
  };

  const line = safeStringify(payload) ?? message;
  const target = (console as any)[level] ?? console.log;
  target.call(console, line);
}

export function getLogger(defaultTag?: string | null) {
  const baseCtx: LogContext = { tag: defaultTag ?? null };
  return {
    debug: (message: string, meta?: LogMeta) => emit('debug', message, meta, baseCtx),
    info: (message: string, meta?: LogMeta) => emit('info', message, meta, baseCtx),
    warn: (message: string, meta?: LogMeta) => emit('warn', message, meta, baseCtx),
    error: (message: string, meta?: LogMeta) => emit('error', message, meta, baseCtx),
  };
}

export const logger = getLogger();
