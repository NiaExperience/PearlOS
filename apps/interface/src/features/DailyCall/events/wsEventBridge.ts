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
import { getGatewayWsAuth } from '@interface/lib/gateway-ws-auth';

import type { AppMessageEnvelope } from './appMessageBridge';
import { routeNiaEvent } from './niaEventRouter';

const log = getClientLogger('[ws_event_bridge]');

let _ws: WebSocket | null = null;
let _url: string | null = null;
let _sessionId: string | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _stopped = false;
let _connectionGeneration = 0;

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

function clearReconnectTimer() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

function closeCurrentSocket() {
  if (!_ws) return;
  const ws = _ws;
  _ws = null;
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.onerror = null;
  try {
    ws.close();
  } catch {
    // ignore close errors
  }
}

function reconnectCurrentUrl() {
  if (!_url) return;
  clearReconnectTimer();
  _connectionGeneration += 1;
  closeCurrentSocket();
  _reconnectDelay = RECONNECT_INTERVAL_MS;
  void connect(_url);
}

function resolveBridgeUrl(url?: string): string {
  if (url) return url;

  // Derive from env or current host
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gatewayPort =
    (typeof process !== 'undefined' &&
      (process as any).env?.NEXT_PUBLIC_BOT_GATEWAY_WS_URL) ||
    null;
  if (gatewayPort) {
    return gatewayPort;
  }

  // Default: same host, port 4444
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  // Non-localhost (RunPod proxy, Cloudflare tunnel, etc.):
  // Always use same-origin rewrite path (/gateway-ws/events).
  // Next.js rewrites proxy this to localhost:4444/ws/events.
  // Direct port-based connections (e.g. {pod}-4444.proxy.runpod.net)
  // fail because RunPod doesn't expose port 4444 externally.
  if (host !== 'localhost' && host !== '127.0.0.1') {
    return `${proto}//${window.location.host}/gateway-ws/events`;
  }
  return `${proto}//${host}:4444/ws/events`;
}

async function connect(url: string) {
  if (_stopped) return;
  const generation = ++_connectionGeneration;
  const requestedSessionId = _sessionId;

  try {
    const auth = await getGatewayWsAuth(url, { sessionId: requestedSessionId });
    if (_stopped || generation !== _connectionGeneration) return;

    const ws = new WebSocket(auth.url, auth.protocols);
    const authorizedSessionId = requestedSessionId || auth.sessionId;

    ws.onopen = () => {
      if (generation !== _connectionGeneration || _ws !== ws) {
        try { ws.close(); } catch { /* noop */ }
        return;
      }
      log.info('Connected to bot gateway WebSocket', { url, sessionId: authorizedSessionId });
      _reconnectDelay = RECONNECT_INTERVAL_MS; // reset backoff
      // Send session scoping message if a session ID is set
      if (authorizedSessionId) {
        try {
          ws.send(JSON.stringify({ session_id: authorizedSessionId }));
          log.info('Sent session_id to gateway WebSocket', { sessionId: authorizedSessionId });
        } catch (err) {
          log.warn('Failed to send session_id', { error: String(err) });
        }
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (generation !== _connectionGeneration || _ws !== ws) return;
      try {
        const data = JSON.parse(ev.data);

        // Handle keepalive pings from server
        if (data.type === 'ping') {
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch { /* noop */ }
          return;
        }

        // Filter by sessionUserId if targeted
        if (data.targetSessionUserId) {
          const currentSessionUserId = sessionStorage.getItem('sessionUserId');
          if (currentSessionUserId !== data.targetSessionUserId) {
            return; // not for this user
          }
        }

        if (isNiaEnvelope(data)) {
          if (!isDuplicateEvent(data.seq, data.ts, data.event)) {
            // routeNiaEvent expects (eventType, payload). Passing the raw
            // envelope made every event from this bridge silently no-op,
            // which masked the duplicate-bridge issue and caused mobile
            // reconnects to leak old window opens through the other bridge.
            routeNiaEvent(data.event as unknown as string, (data as { payload?: Record<string, unknown> }).payload || {});
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
      if (generation !== _connectionGeneration) return;
      log.info('WebSocket disconnected, scheduling reconnect', {
        delay: _reconnectDelay,
      });
      if (_ws === ws) _ws = null;
      scheduleReconnect(url);
    };

    ws.onerror = (err) => {
      log.warn('WebSocket error', { error: String(err) });
      // onclose will fire after onerror
    };

    _ws = ws;
  } catch (err) {
    if (generation !== _connectionGeneration) return;
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
  const nextSessionId = sessionId ?? null;
  if (nextSessionId === _sessionId) return;

  _sessionId = nextSessionId;
  if (_url && _ws) {
    // Gateway tokens are scoped. Changing from user scope to Daily room scope
    // requires a fresh token; re-sending session_id over the old socket is
    // rejected by the gateway as scope_forbidden.
    reconnectCurrentUrl();
  }
}

export function startWsEventBridge(url?: string, sessionId?: string) {
  const resolvedUrl = resolveBridgeUrl(url);
  const nextSessionId = sessionId ?? null;

  // If already running, reconnect when the scoped session changes so auth is
  // refreshed for the new Daily room/user scope.
  if (_ws) {
    if (resolvedUrl !== _url) {
      _url = resolvedUrl;
      _sessionId = nextSessionId;
      reconnectCurrentUrl();
    } else if (nextSessionId !== _sessionId) {
      updateWsSessionId(nextSessionId ?? undefined);
    }
    return;
  }

  _stopped = false;
  _sessionId = nextSessionId;
  _url = resolvedUrl;
  clearReconnectTimer();
  log.info('Starting WebSocket event bridge', { url: resolvedUrl, sessionId: _sessionId });
  connect(resolvedUrl);
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
  _connectionGeneration += 1;
  closeCurrentSocket();
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
