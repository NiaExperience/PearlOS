/**
 * useGatewayWebSocket
 *
 * Connects to the bot gateway's `/ws/events` WebSocket endpoint and routes
 * incoming nia.event envelopes through the existing `routeNiaEvent` system.
 *
 * This allows PearlOS UI tools to work WITHOUT an active Daily.co room —
 * the gateway broadcasts events over both Daily app-messages and this
 * WebSocket channel, and the frontend accepts from whichever is available.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff (1s → 30s)
 *   - Deduplication by (seq, ts) to avoid double-processing when both
 *     Daily and WebSocket are active simultaneously
 *   - Cleans up on unmount
 */

import { useEffect, useRef } from 'react';

import { routeNiaEvent } from '@interface/features/DailyCall/events/niaEventRouter';
import type { AppMessageEnvelope } from '@interface/features/DailyCall/events/appMessageBridge';
import { isDuplicateEvent } from '@interface/lib/event-dedup';

const BRIDGE_KIND = 'nia.event';

function isNiaEnvelope(obj: unknown): obj is AppMessageEnvelope {
  return !!obj && typeof obj === 'object' && (obj as any).kind === BRIDGE_KIND && typeof (obj as any).event === 'string';
}

export interface UseGatewayWebSocketOptions {
  /** Full URL to the gateway, e.g. "http://localhost:4444". Derived from NEXT_PUBLIC_BOT_CONTROL_BASE_URL by default. */
  gatewayUrl?: string;
  /** Disable the WebSocket entirely */
  disabled?: boolean;
  /** Optional session ID (e.g. Daily room name) to scope events to a specific session. */
  sessionId?: string;
}

export function useGatewayWebSocket(options: UseGatewayWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const unmountedRef = useRef(false);

  useEffect(() => {
    if (options.disabled) return;
    unmountedRef.current = false;

    let baseUrl =
      options.gatewayUrl ||
      process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL ||
      '';

    if (!baseUrl) return;

    // If the env var points to localhost but the page is loaded from a remote
    // host, derive the gateway URL from the page's origin.  This handles
    // RunPod-style proxies where the port is encoded in the hostname
    // (e.g. {pod}-4444.proxy.runpod.net) as well as standard deployments.
    if (typeof window !== 'undefined') {
      try {
        const envUrl = new URL(baseUrl);
        const pageHost = window.location.hostname;
        if (
          (envUrl.hostname === 'localhost' || envUrl.hostname === '127.0.0.1') &&
          pageHost !== 'localhost' &&
          pageHost !== '127.0.0.1'
        ) {
          const gatewayPort = envUrl.port || '4444';
          // RunPod proxy: hostname contains port like "{pod}-{port}.proxy.runpod.net"
          const runpodMatch = pageHost.match(/^(.+)-\d+\.(proxy\.runpod\.net)$/);
          if (runpodMatch) {
            const proto = window.location.protocol === 'https:' ? 'https' : 'http';
            baseUrl = `${proto}://${runpodMatch[1]}-${gatewayPort}.${runpodMatch[2]}`;
          } else {
            envUrl.hostname = pageHost;
            baseUrl = envUrl.toString().replace(/\/$/, '');
          }
        }
      } catch {
        // leave baseUrl as-is
      }
    }

    // Convert http(s) to ws(s)
    const wsUrl = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/events';

    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (unmountedRef.current) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.error('[gateway-ws] Failed to construct WebSocket (mixed content?)', wsUrl, err);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retriesRef.current = 0;
        console.log('[gateway-ws] connected to', wsUrl);
        // Send session scoping message if a session ID is available
        if (options.sessionId) {
          try {
            ws.send(JSON.stringify({ session_id: options.sessionId }));
            console.log('[gateway-ws] sent session_id', options.sessionId);
          } catch (err) {
            console.warn('[gateway-ws] failed to send session_id', err);
          }
        }
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (!isNiaEnvelope(data)) return;

          // Dedup: skip if we already saw this event via Daily
          if (isDuplicateEvent(data.seq, data.ts, data.event)) return;

          routeNiaEvent(data);
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (unmountedRef.current) return;
        const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
        retriesRef.current++;
        console.log(`[gateway-ws] disconnected, reconnecting in ${delay}ms`);
        timer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (timer) clearTimeout(timer);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [options.gatewayUrl, options.disabled, options.sessionId]);
}
