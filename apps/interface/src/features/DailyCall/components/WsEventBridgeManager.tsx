'use client';

/**
 * WsEventBridgeManager
 *
 * Automatically starts the WebSocket event bridge when no Daily call is active,
 * so PearlOS tool events (notes, YouTube, windows, soundtrack, etc.) work in
 * desktop mode without a video call.
 *
 * When a Daily call joins, the bridge is stopped (Daily app-messages take over).
 * When the call ends, the bridge restarts.
 */

import { useEffect } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

import { useDailyCallState } from '../state/store';

const log = getClientLogger('[ws_bridge_mgr]');

/** Derive a room name from a Daily room URL. */
function extractRoomName(roomUrl?: string): string | undefined {
  if (!roomUrl) return undefined;
  try {
    const url = new URL(roomUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || undefined;
  } catch {
    return undefined;
  }
}

export function WsEventBridgeManager() {
  const { joined, roomUrl } = useDailyCallState();

  useEffect(() => {
    // Always keep the WS bridge running — it provides near-instant event
    // delivery.  When a Daily call is also active, events may arrive via
    // both Daily app-message AND WebSocket; the dedup layer in
    // event-dedup.ts ensures each envelope is processed only once.
    //
    // Previously the bridge was stopped during calls, but this caused
    // 30+ second delays because the Daily HTTP REST send-app-message
    // path is slow.  Keeping both paths active means whichever arrives
    // first wins and the duplicate is silently dropped.
    const sessionId = extractRoomName(roomUrl);
    import('../events/wsEventBridge').then(({ startWsEventBridge }) => {
      log.info('Starting/ensuring WS event bridge', { sessionId, dailyJoined: joined });
      startWsEventBridge(undefined, sessionId);
    });

    return () => {
      // Cleanup on unmount
      import('../events/wsEventBridge').then(({ stopWsEventBridge }) => {
        stopWsEventBridge();
      });
    };
  }, [joined, roomUrl]);

  return null;
}
