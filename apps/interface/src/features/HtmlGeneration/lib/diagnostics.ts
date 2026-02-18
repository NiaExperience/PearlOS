/*
  Structured diagnostics for HtmlGeneration provider calls.
  - In-memory store keyed by opId (operation id)
  - Redacts secrets and user/tenant identifiers
  - Captures environment snapshot helpful for "works locally, fails in deploy"
*/

type ProviderName = 'openai' | 'anthropic' | 'gemini';

export interface GenerationDiagnostics {
  opId: string;
  timestamp: number;
  phase: 'start' | 'success' | 'error';
  provider?: ProviderName;
  model?: string;
  promptLength?: number;
  responseLength?: number;
  // HTTP tracing
  endpoint?: string;
  httpStatus?: number;
  httpHeaders?: Record<string, string>;
  durationMs?: number;
  error?: {
    message: string;
    code?: string;
    type?: string;
    status?: number;
  };
  environment: {
    nodeEnv: string | undefined;
    nextRuntime: string | undefined;
    nodeVersion: string | undefined;
    vercel: boolean;
    vercelEnv: string | undefined;
    region: string | undefined;
    hasOpenAIKey: boolean;
    hasAnthropicKey: boolean;
    hasGeminiKey: boolean;
  };
}

const store: GenerationDiagnostics[] = [];

export function generateOpId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomUUID } = require('crypto');
    return randomUUID();
  } catch {
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function envSnapshot(): GenerationDiagnostics['environment'] {
  return {
    nodeEnv: process.env.NODE_ENV,
    nextRuntime: typeof process !== 'undefined' ? process.env?.NEXT_RUNTIME : undefined,
    nodeVersion: typeof process !== 'undefined' ? process.version : undefined,
    vercel: !!process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    region: process.env.VERCEL_REGION || process.env.FLY_REGION || process.env.AWS_REGION,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
  };
}

export function recordStart(opId: string, data: { provider?: ProviderName; model?: string; promptLength?: number }) {
  store.push({
    opId,
    timestamp: Date.now(),
    phase: 'start',
    provider: data.provider,
    model: data.model,
    promptLength: data.promptLength,
    environment: envSnapshot(),
  });
}

export function recordSuccess(opId: string, data: { responseLength?: number; endpoint?: string; status?: number; headers?: Headers | Record<string, string>; startedAt?: number }) {
  const durationMs = data.startedAt ? Date.now() - data.startedAt : undefined;
  store.push({
    opId,
    timestamp: Date.now(),
    phase: 'success',
    responseLength: data.responseLength,
    endpoint: data.endpoint,
    httpStatus: data.status,
    httpHeaders: normalizeHeaders(data.headers),
    durationMs,
    environment: envSnapshot(),
  });
}

export function recordError(opId: string, data: { provider?: ProviderName; model?: string; error: unknown; endpoint?: string; startedAt?: number; headers?: Headers | Record<string, string> }) {
  const e = data.error;
  // Try to capture HTTP status if present
  const status = numProp(e, 'status') ?? numProp(e, 'statusCode');
  const durationMs = data.startedAt ? Date.now() - data.startedAt : undefined;
  store.push({
    opId,
    timestamp: Date.now(),
    phase: 'error',
    provider: data.provider,
    model: data.model,
    endpoint: data.endpoint,
    httpStatus: status,
    httpHeaders: normalizeHeaders(data.headers) || normalizeHeaders(objProp(e, 'headers')),
    durationMs,
    error: {
      message: typeof e === 'string' ? e : (strProp(e, 'message') ?? 'Unknown error'),
      code: strProp(e, 'code'),
      type: strProp(e, 'type'),
      status,
    },
    environment: envSnapshot(),
  });
}

export function getDiagnostics(opId?: string, limit = 25): GenerationDiagnostics[] {
  if (!opId) return store.slice(-limit);
  return store.filter(d => d.opId === opId).slice(-limit);
}

export function clearDiagnostics(opId?: string) {
  if (!opId) {
    store.length = 0;
    return;
  }
  for (let i = store.length - 1; i >= 0; i--) {
    if (store[i].opId === opId) store.splice(i, 1);
  }
}

// Helper to sanitize/normalize headers (drop sensitive)
function normalizeHeaders(h?: Headers | Record<string, string>): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  if (isHeaders(h)) {
    h.forEach((value: string, key: string) => {
      const k = key.toLowerCase();
      if (isSensitiveHeader(k)) return;
      out[k] = value;
    });
  } else {
    for (const [key, value] of Object.entries(h)) {
      const k = key.toLowerCase();
      if (isSensitiveHeader(k)) continue;
      out[k] = String(value);
    }
  }
  return out;
}

function isSensitiveHeader(k: string): boolean {
  return k === 'authorization' || k === 'x-api-key' || k === 'cookie' || k === 'set-cookie';
}

function isHeaders(h: unknown): h is Headers {
  return !!h && typeof (h as Headers).forEach === 'function';
}

function numProp(o: unknown, k: string): number | undefined {
  if (o && typeof o === 'object') {
    const v = (o as Record<string, unknown>)[k];
    if (typeof v === 'number') return v;
  }
  return undefined;
}

function strProp(o: unknown, k: string): string | undefined {
  if (o && typeof o === 'object') {
    const v = (o as Record<string, unknown>)[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function objProp(o: unknown, k: string): Record<string, string> | Headers | undefined {
  if (o && typeof o === 'object') {
    const v = (o as Record<string, unknown>)[k];
    if (v && (typeof v === 'object' || typeof v === 'function')) {
      return v as Headers | Record<string, string>;
    }
  }
  return undefined;
}
