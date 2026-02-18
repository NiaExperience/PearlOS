/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEnum } from '@nia/events';

import { getClientLogger } from '@interface/lib/client-logger';

// Envelope for app-message forwarded events
export interface AppMessageEnvelope<T = any> {
  v: 1;
  kind: 'nia.event';
  seq: number;
  ts: number;
  event: EventEnum;
  payload: T;
  targetSessionUserId?: string; // Optional field to target specific session user
}

export interface BridgeOptions {
  // Optional snapshot provider for sync responses
  getSnapshot?: () => any;
  // Optional custom filter for outbound events
  allowOutbound?: (event: EventEnum, payload: any) => boolean;
  // Enable verbose inbound envelope logging
  logInbound?: boolean;
}

type Listener = (env: AppMessageEnvelope) => void;

let _daily: any | null = null;
let _seq = 0;
const _listeners: Set<Listener> = new Set();
let _opts: BridgeOptions = {};
let _inited = false;

const log = getClientLogger('[daily_call]');

const BRIDGE_KIND = 'nia.event';
const SYNC_REQUEST = 'nia.sync.request';
const SYNC_SNAPSHOT = 'nia.sync.snapshot';

type InternalSyncMsg = { kind: typeof SYNC_REQUEST | typeof SYNC_SNAPSHOT; ts: number; snapshot?: any };

function isEnvelope(obj: any): obj is AppMessageEnvelope {
  return !!obj && obj.kind === BRIDGE_KIND && typeof obj.event === 'string';
}

function summarizePayload(payload: any) {
  try {
    if (payload == null) return payload;
    if (Array.isArray(payload)) return payload.length > 5 ? `Array(len=${payload.length})` : payload;
    if (typeof payload === 'object') {
      // Shallow copy & redact obvious sensitive keys
      const clone: Record<string, any> = {};
      const SENSITIVE = ['email', 'token', 'authorization'];
      Object.keys(payload).slice(0, 8).forEach(k => {
        if (SENSITIVE.includes(k.toLowerCase())) clone[k] = '[redacted]';
        else if (Array.isArray((payload as any)[k])) clone[k] = `Array(len=${(payload as any)[k].length})`;
        else if (typeof (payload as any)[k] === 'object') clone[k] = '[object]';
        else clone[k] = (payload as any)[k];
      });
      return clone;
    }
    return payload;
  } catch { return '[uninspectable]'; }
}

export function initAppMessageBridge(daily: any, options: BridgeOptions = {}) {
  if (!daily || _inited) return; // idempotent
  _daily = daily;
  _opts = options;
  _inited = true;
  try {
    daily.on('app-message', (ev: any) => {
      const data = ev?.data;
      if (!data) return;
      // Handle sync request
      if (data.kind === SYNC_REQUEST) {
        if (_opts.getSnapshot) {
          safeSend({ kind: SYNC_SNAPSHOT, ts: Date.now(), snapshot: _opts.getSnapshot() });
        }
        if (_opts.logInbound) {
          log.debug('Inbound sync request', {
            event: 'daily_app_bridge_sync_request',
          });
        }
        return;
      }
      if (data.kind === SYNC_SNAPSHOT) {
        // Treat snapshot as synthetic events for consumer convenience (optional: could emit dedicated callback later)
        if (_opts.logInbound) {
          log.debug('Inbound snapshot', {
            event: 'daily_app_bridge_sync_snapshot',
            ts: data.ts,
            hasSnapshot: !!data.snapshot,
          });
        }
        return; // currently ignoring; consumer can extend
      }
      if (isEnvelope(data)) {
        // Filter based on targetSessionUserId if present
        if (data.targetSessionUserId) {
          const currentSessionUserId = sessionStorage.getItem('sessionUserId');
          if (currentSessionUserId !== data.targetSessionUserId) {
            if (_opts.logInbound) {
              log.debug('Dropping targeted event (not for this user)', {
                event: 'daily_app_bridge_drop_target',
                seq: data.seq,
                payloadEvent: data.event,
                targetSessionUserId: data.targetSessionUserId,
                currentSessionUserId,
              });
            }
            return; // Drop event - not targeted to this user
          }
          if (_opts.logInbound) {
            log.debug('Accepting targeted event (matches session user)', {
              event: 'daily_app_bridge_accept_target',
              seq: data.seq,
              payloadEvent: data.event,
              targetSessionUserId: data.targetSessionUserId,
            });
          }
        }
        
        if (_opts.logInbound) {
          log.debug('Inbound event', {
            event: 'daily_app_bridge_inbound',
            seq: data.seq,
            payloadEvent: data.event,
            payload: summarizePayload(data.payload)
          });
        }
        _listeners.forEach(l => { try { l(data); } catch {/* ignore listener errors */} });
      }
    });
  } catch {
    // swallow - if event binding fails we still allow forward attempts (they'll be no-ops)
  }
}

export function forwardAppEvent(event: EventEnum, payload: any) {
  if (_opts.allowOutbound && !_opts.allowOutbound(event, payload)) return;
  const env: AppMessageEnvelope = { v: 1, kind: BRIDGE_KIND, seq: ++_seq, ts: Date.now(), event, payload };
  safeSend(env);
  return env;
}

export function requestSnapshot() {
  safeSend({ kind: SYNC_REQUEST, ts: Date.now() });
}

function safeSend(obj: any) {
  if (!_daily || typeof _daily.sendAppMessage !== 'function') return;
  try { _daily.sendAppMessage(obj); } catch { /* ignore */ }
}

export function addAppMessageListener(listener: Listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

// For tests / diagnostics
export function __resetBridge() { _daily = null; _seq = 0; _listeners.clear(); _opts = {}; _inited = false; }
