/**
 * useGatewaySocket.ts
 *
 * Connects to the bot gateway WebSocket (/ws/events) so nia.event envelopes
 * (wonder canvas, view close, window open, etc.) reach the frontend even when
 * Daily.co is not active (e.g. text-only chat mode).
 *
 * Events received are forwarded to niaEventRouter via the nia:app-message
 * CustomEvent that the router listens for.
 */

import { useEffect, useRef } from 'react';

import {
  gatewaySubscriptionScope,
  shouldAcceptGatewayEnvelope,
} from '@interface/features/DailyCall/lib/gateway-event-scope';
import { isDuplicateEvent } from '@interface/lib/event-dedup';
import { getGatewayWsAuth } from '@interface/lib/gateway-ws-auth';

const GATEWAY_WS_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/gateway-ws/events`
    : '';

// Fallback: try localhost:4444 (bot gateway dev server)
const GATEWAY_WS_FALLBACK = 'ws://localhost:4444/ws/events';

interface UseGatewaySocketOptions {
  /** Active tenant ID for tenant-scoped event filtering */
  tenantId?: string | null;
  /** Daily room/session ID for scoping events */
  sessionId?: string;
  /** Authenticated session user ID for targeted event filtering */
  userId?: string | null;
}

export function useGatewaySocket({ tenantId, sessionId, userId }: UseGatewaySocketOptions = {}): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectionIdRef = useRef(0);

  useEffect(() => {
    const subscriptionScope = gatewaySubscriptionScope({ sessionId, userId });
    if (!subscriptionScope) return;

    mountedRef.current = true;
    connectionIdRef.current += 1;
    const connectionId = connectionIdRef.current;

    async function connect(url: string, isFallback = false) {
      if (!mountedRef.current) return;
      if (typeof window === 'undefined') return;
      if (connectionId !== connectionIdRef.current) return;

      try {
        const auth = await getGatewayWsAuth(url, { tenantId, sessionId: subscriptionScope });
        if (!mountedRef.current) return;
        if (connectionId !== connectionIdRef.current) return;

        const ws = new WebSocket(auth.url, auth.protocols);
        wsRef.current = ws;

        ws.onopen = () => {
          console.info(`[useGatewaySocket] Connected to ${isFallback ? 'fallback ' : ''}${url}`);
          ws.send(JSON.stringify({ session_id: subscriptionScope, user_id: userId || undefined }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Drop replays/duplicates BEFORE dispatching: the gateway
            // re-broadcasts queued events when the WS reconnects (a
            // common mobile pattern when iOS suspends the tab), and a
            // parallel bridge (WsEventBridgeManager) feeds the same
            // /ws/events stream. Without this gate, every reconnect
            // re-fires past app.open events as ghost windows.
            if (typeof data?.seq === 'number' && typeof data?.ts === 'number' && typeof data?.event === 'string') {
              if (isDuplicateEvent(data.seq, data.ts, data.event)) return;
            }

            if (!shouldAcceptGatewayEnvelope(data, { tenantId, sessionId: subscriptionScope, userId })) return;

            // Forward nia.event envelopes to the event router
            if (data.kind === 'nia.event' || data.kind === 'nia.tool_result') {
              window.dispatchEvent(
                new CustomEvent('nia:app-message', { detail: data }),
              );
            }

            // Also handle tool_result with window actions
            if (data.kind === 'nia.tool_result' && data.payload) {
              const p = data.payload;
              if (p.action === 'close' || p.action === 'hide') {
                window.dispatchEvent(
                  new CustomEvent('nia:tool-result', { detail: p }),
                );
              }
              if (p.action === 'open' || p.action === 'present') {
                window.dispatchEvent(
                  new CustomEvent('nia:tool-result', { detail: p }),
                );
              }
            }
          } catch {
            // Non-JSON message, ignore
          }
        };

        ws.onclose = () => {
          if (connectionId !== connectionIdRef.current) return;
          console.info('[useGatewaySocket] Disconnected');
          if (wsRef.current === ws) wsRef.current = null;
          // Reconnect after delay
          if (mountedRef.current) {
            reconnectTimer.current = setTimeout(() => {
              if (mountedRef.current && connectionId === connectionIdRef.current) connect(url, isFallback);
            }, 3000);
          }
        };

        ws.onerror = () => {
          // If primary URL failed and we haven't tried fallback yet
          if (!isFallback && url !== GATEWAY_WS_FALLBACK) {
            console.info('[useGatewaySocket] Primary failed, trying fallback...');
            ws.onclose = null;
            ws.close();
            connect(GATEWAY_WS_FALLBACK, true);
          }
        };
      } catch (err) {
        console.warn('[useGatewaySocket] Failed to create authenticated WebSocket', err);
        if (mountedRef.current && connectionId === connectionIdRef.current) {
          reconnectTimer.current = setTimeout(() => {
            if (mountedRef.current && connectionId === connectionIdRef.current) connect(url, isFallback);
          }, 3000);
        }
      }
    }

    connect(GATEWAY_WS_URL);

    return () => {
      mountedRef.current = false;
      connectionIdRef.current += 1;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [sessionId, tenantId, userId]);
}
