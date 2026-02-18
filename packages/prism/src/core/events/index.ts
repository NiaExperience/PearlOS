// Prism Core Events SDK (initial scaffold)
// This provides a stable import path: @nia/prism/core/events
// Phase 1: minimal placeholder forwarding to future interface-events implementation.
// TODO: When interface-events package is created, re-export its public surface here or
// integrate shared codegen artifacts (topics, rule snapshots, etc.).

export interface PrismEventEnvelope<T = any> {
  id: string;
  ts: string; // ISO timestamp
  topic: string;
  payload: T;
  meta?: Record<string, any>;
  source?: string;
}

export type PrismEventHandler<T = any> = (e: PrismEventEnvelope<T>) => void;

export interface PrismEventBusClient {
  publish<T>(topic: string, payload: T, meta?: Record<string, any>): void;
  on<T>(topic: string, handler: PrismEventHandler<T>): () => void;
  once<T>(topic: string, handler: PrismEventHandler<T>): void;
  replay(opts?: { topic?: string; since?: string; limit?: number }): Promise<PrismEventEnvelope[]>;
  schedule(opts: { id: string; at?: string; intervalMs?: number; jitterMs?: number; topic: string; payload?: any }): () => void;
  health(): Promise<any>; // refine after shared Health shape lands
}

// In-thread fallback placeholder
export function createPrismInThreadBus(): PrismEventBusClient {
  const subs: { topic: string; handler: PrismEventHandler }[] = [];
  return {
    publish(topic, payload, meta) {
      const env: PrismEventEnvelope = { id: crypto.randomUUID(), ts: new Date().toISOString(), topic, payload, meta, source: 'prism' };
      subs.filter(s => s.topic === topic).forEach(s => safeInvoke(s.handler, env));
    },
    on(topic, handler) { subs.push({ topic, handler }); return () => off(handler); },
    once(topic, handler) { const wrap: PrismEventHandler = e => { handler(e); off(wrap); }; this.on(topic, wrap); },
    replay() { return Promise.resolve([]); },
    schedule() { return () => {}; },
    health() { return Promise.resolve({}); }
  };
  function off(h: PrismEventHandler) { const i = subs.findIndex(s => s.handler === h); if (i>=0) subs.splice(i,1); }
  function safeInvoke(fn: PrismEventHandler, e: PrismEventEnvelope) { try { fn(e); } catch {/* swallow */} }
}

export const prismEvents = createPrismInThreadBus();
