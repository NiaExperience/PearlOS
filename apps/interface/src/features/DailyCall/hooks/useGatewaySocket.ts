/**
 * useGatewaySocket — connects to the bot gateway's WebSocket event channel
 * (/ws/events) and routes incoming nia.event envelopes through the same
 * niaEventRouter used by Daily app-messages.
 *
 * This allows tool invocations (notes, YouTube, windows, etc.) to work
 * even when no Daily.co room is active.
 */

import { useEffect, useRef } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

import { routeNiaEvent } from '../events/niaEventRouter';

const log = getClientLogger('[gateway_ws]');

/** Derive the WebSocket URL from the bot control base URL env var.
 *
 * Strategy:
 * 1. If the page is served through a tunnel/proxy (not localhost, not RunPod),
 *    use same-origin `/gateway-ws/events` path — Next.js rewrites proxy it
 *    to localhost:4444.  This avoids cross-origin and mixed-content issues.
 * 2. If the page is on a RunPod proxy host, rewrite the port segment.
 * 3. Otherwise, use the env var directly with protocol adjustment.
 */
function getWsUrl(): string | null {
  const base =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BOT_CONTROL_BASE_URL) || '';
  if (!base) return null;
  try {
    const url = new URL(base);

    if (typeof window !== 'undefined') {
      const pageHost = window.location.hostname;
      const pageProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

      // RunPod proxy: rewrite port segment in hostname
      const runpodMatch = pageHost.match(/^(.+)-\d+\.(proxy\.runpod\.net)$/);
      if (runpodMatch) {
        const gatewayPort = url.port || '4444';
        return `${pageProto}//${runpodMatch[1]}-${gatewayPort}.${runpodMatch[2]}/ws/events`;
      }

      // Non-localhost page (e.g. Cloudflare tunnel): use same-origin rewrite path
      if (pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
        return `${pageProto}//${window.location.host}/gateway-ws/events`;
      }
    }

    // Localhost or SSR: connect directly to the gateway
    const protocol =
      (typeof window !== 'undefined' && window.location.protocol === 'https:') ||
      url.protocol === 'https:'
        ? 'wss:'
        : 'ws:';
    return `${protocol}//${url.host}/ws/events`;
  } catch {
    return null;
  }
}

const RECONNECT_INTERVAL_MS = 3000;
const MAX_RECONNECT_INTERVAL_MS = 30000;

export interface UseGatewaySocketOptions {
  /** Optional session ID (e.g. Daily room name) to scope WebSocket events. */
  sessionId?: string;
}

export function useGatewaySocket(options: UseGatewaySocketOptions = {}) {
  const { sessionId } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(RECONNECT_INTERVAL_MS);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const wsUrl = getWsUrl();
    if (!wsUrl) {
      log.warn('No NEXT_PUBLIC_BOT_CONTROL_BASE_URL set; gateway WebSocket disabled');
      return;
    }

    function connect() {
      if (!mountedRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
        return;
      }

      log.info('Connecting to gateway WebSocket', { url: wsUrl, sessionId });
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl!);
      } catch (err) {
        log.error('Failed to construct WebSocket (mixed content?)', { url: wsUrl, error: String(err) });
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        log.info('Gateway WebSocket connected');
        reconnectDelay.current = RECONNECT_INTERVAL_MS; // reset backoff
        // Send session scoping message if a session ID is available
        if (sessionId) {
          try {
            ws.send(JSON.stringify({ session_id: sessionId }));
            log.info('Sent session_id to gateway WebSocket', { sessionId });
          } catch (err) {
            log.warn('Failed to send session_id', { error: String(err) });
          }
        }
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data && data.kind === 'nia.event' && typeof data.event === 'string') {
            log.debug('Gateway WS event', { event: data.event });
            routeNiaEvent(data);
          }
          // nia.tool_invoke envelopes are for the bot process, not the frontend — ignore
        } catch {
          // ignore non-JSON or malformed messages
        }
      };

      ws.onclose = () => {
        log.info('Gateway WebSocket closed, scheduling reconnect', {
          delayMs: reconnectDelay.current,
        });
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror, so reconnect happens there
      };
    }

    function scheduleReconnect() {
      if (!mountedRef.current) return;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => {
        connect();
        // Exponential backoff
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, MAX_RECONNECT_INTERVAL_MS);
      }, reconnectDelay.current);
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [sessionId]);
}
