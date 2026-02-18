/**
 * WebSocket Event Bridge
 *
 * Connects to the bot gateway's `/ws/events` endpoint and feeds incoming
 * nia.event envelopes into the same niaEventRouter used by the Daily.co
 * app-message bridge.  This allows PearlOS UI tools (notes, YouTube,
 * windows, etc.) to work even when there is no active Daily.co room.
 *
 * Usage:
 *   import { startWsEventBridge, stopWsEventBridge } from './wsEventBridge';
 *   startWsEventBridge('ws://localhost:4444/ws/events');
 *   // later:
 *   stopWsEventBridge();
 */

import { getClientLogger } from '@interface/lib/client-logger';
import { isDuplicateEvent } from '@interface/lib/event-dedup';

import type { AppMessageEnvelope } from './appMessageBridge';
import { routeNiaEvent } from './niaEventRouter';

const log = getClientLogger('[ws_event_bridge]');

let _ws: WebSocket | null = null;
let _url: string | null = null;
let _sessionId: string | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _stopped = false;

const RECONNECT_INTERVAL_MS = 3000;
const MAX_RECONNECT_INTERVAL_MS = 30000;
let _reconnectDelay = RECONNECT_INTERVAL_MS;

function isNiaEnvelope(obj: unknown): obj is AppMessageEnvelope {
  return (
    !!obj &&
    typeof obj === 'object' &&
    (obj as Record<string, unknown>).kind === 'nia.event' &&
    typeof (obj as Record<string, unknown>).event === 'string'
  );
}

function connect(url: string) {
  if (_stopped) return;

  try {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      log.info('Connected to bot gateway WebSocket', { url, sessionId: _sessionId });
      _reconnectDelay = RECONNECT_INTERVAL_MS; // reset backoff
      // Send session scoping message if a session ID is set
      if (_sessionId) {
        try {
          ws.send(JSON.stringify({ session_id: _sessionId }));
          log.info('Sent session_id to gateway WebSocket', { sessionId: _sessionId });
        } catch (err) {
          log.warn('Failed to send session_id', { error: String(err) });
        }
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);

        // Filter by sessionUserId if targeted
        if (data.targetSessionUserId) {
          const currentSessionUserId = sessionStorage.getItem('sessionUserId');
          if (currentSessionUserId !== data.targetSessionUserId) {
            return; // not for this user
          }
        }

        if (isNiaEnvelope(data)) {
          if (!isDuplicateEvent(data.seq, data.ts, data.event)) {
            routeNiaEvent(data);
          }
        }
        // Also handle nia.tool_invoke envelopes (pass through to router as-is)
        if (data.kind === 'nia.tool_invoke') {
          // Tool invocations are handled by the bot process; we just
          // observe them for debugging. No routing needed on the frontend.
          log.debug('Received tool_invoke via WS', { tool: data.tool_name });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      log.info('WebSocket disconnected, scheduling reconnect', {
        delay: _reconnectDelay,
      });
      _ws = null;
      scheduleReconnect(url);
    };

    ws.onerror = (err) => {
      log.warn('WebSocket error', { error: String(err) });
      // onclose will fire after onerror
    };

    _ws = ws;
  } catch (err) {
    log.warn('Failed to create WebSocket', { error: String(err) });
    scheduleReconnect(url);
  }
}

function scheduleReconnect(url: string) {
  if (_stopped) return;
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    connect(url);
  }, _reconnectDelay);
  // Exponential backoff
  _reconnectDelay = Math.min(_reconnectDelay * 1.5, MAX_RECONNECT_INTERVAL_MS);
}

/**
 * Start the WebSocket event bridge.
 *
 * @param url  Full WebSocket URL, e.g. `ws://localhost:4444/ws/events`
 *             If omitted, derives from `window.location` + the bot gateway port.
 * @param sessionId  Optional session ID (e.g. Daily room name) to scope events.
 *                   If provided, only events for this session will be received.
 */
export function updateWsSessionId(sessionId: string | undefined) {
  _sessionId = sessionId ?? null;
  // If already connected, re-send session scoping
  if (_ws && _ws.readyState === WebSocket.OPEN && _sessionId) {
    try {
      _ws.send(JSON.stringify({ session_id: _sessionId }));
    } catch { /* ignore */ }
  }
}

export function startWsEventBridge(url?: string, sessionId?: string) {
  // If already running, just update session ID if needed
  if (_ws) {
    if (sessionId && sessionId !== _sessionId) {
      updateWsSessionId(sessionId);
    }
    return;
  }

  _stopped = false;
  _sessionId = sessionId ?? null;

  if (!url) {
    // Derive from env or current host
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gatewayPort =
      (typeof process !== 'undefined' &&
        (process as any).env?.NEXT_PUBLIC_BOT_GATEWAY_WS_URL) ||
      null;
    if (gatewayPort) {
      url = gatewayPort;
    } else {
      // Default: same host, port 4444
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      // RunPod proxy: rewrite port-based hostname (e.g. xxx-3000.proxy.runpod.net → xxx-4444.proxy.runpod.net)
      const runpodMatch = host.match(/^(.+)-\d+(\.proxy\.runpod\.net)$/);
      if (runpodMatch) {
        url = `${proto}//${runpodMatch[1]}-4444${runpodMatch[2]}/ws/events`;
      } else if (host !== 'localhost' && host !== '127.0.0.1') {
        // Non-localhost (e.g. Cloudflare tunnel): use same-origin rewrite path
        url = `${proto}//${window.location.host}/gateway-ws/events`;
      } else {
        url = `${proto}//${host}:4444/ws/events`;
      }
    }
  }

  _url = url ?? null;
  log.info('Starting WebSocket event bridge', { url });
  connect(url!);
}

/**
 * Stop the WebSocket event bridge and prevent reconnects.
 */
export function stopWsEventBridge() {
  _stopped = true;
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.close();
    _ws = null;
  }
  _url = null;
  _sessionId = null;
  _reconnectDelay = RECONNECT_INTERVAL_MS;
}

/**
 * Check if the WebSocket bridge is currently connected.
 */
export function isWsBridgeConnected(): boolean {
  return _ws !== null && _ws.readyState === WebSocket.OPEN;
}
