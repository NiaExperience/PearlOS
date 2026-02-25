'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';
import { forwardAppEvent } from '@interface/features/DailyCall/events/appMessageBridge';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { useUI } from '@interface/contexts/ui-context';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode } from '@interface/types/desktop-modes';
import { EventEnum } from '@nia/events';
import { NIA_EVENT_CALL_START } from '@interface/features/DailyCall/events/niaEventRouter';
import './wonder-canvas.css';

const logger = getClientLogger('[wonder_canvas]');

// Wonder Canvas runtime URL — served from /api/wonder-canvas-runtime
// Using a real route (not srcdoc) so iOS Safari allows external image loading.
const WONDER_CANVAS_URL = '/api/wonder-canvas-runtime';
// ── Event name constants ──────────────────────────────────────────────
export const NIA_EVENT_WONDER_SCENE = 'nia:wonder.scene';
export const NIA_EVENT_WONDER_ADD = 'nia:wonder.add';
export const NIA_EVENT_WONDER_REMOVE = 'nia:wonder.remove';
export const NIA_EVENT_WONDER_CLEAR = 'nia:wonder.clear';
export const NIA_EVENT_WONDER_ANIMATE = 'nia:wonder.animate';

// ── Types ─────────────────────────────────────────────────────────────
export interface WonderInteraction {
  action: string;
  label: string;
  elementId: string | null;
}

interface WonderCanvasRendererProps {
  /** Called when the user interacts with a data-action element. */
  onInteraction?: (interaction: WonderInteraction) => void;
}

/**
 * WonderCanvasRenderer — persistent sandboxed iframe for Wonder Canvas.
 *
 * Sits as a layer in the Stage. Receives wonder.* events from the nia event
 * system and forwards them to the iframe runtime via postMessage. Interaction
 * events from the iframe are forwarded back to the bot via Daily app-message.
 */
export default function WonderCanvasRenderer({ onInteraction }: WonderCanvasRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  // ── Avatar state awareness ────────────────────────────────────────
  const { isAssistantSpeaking } = useVoiceSessionContext();
  const { isChatMode } = useUI();
  const { currentMode } = useDesktopMode();
  const avatarState = isAssistantSpeaking ? 'speaking' : 'idle';

  // Queue messages until iframe is ready
  const pendingRef = useRef<Array<Record<string, unknown>>>([]);

  // Use ref-based ready check to avoid stale closures
  const postToIframe = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (!readyRef.current) {
      pendingRef.current.push(msg);
      return;
    }
    win.postMessage(msg, '*');
  }, []);

  // Flush pending messages when iframe signals ready
  const flushPending = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    for (const msg of pendingRef.current) {
      win.postMessage(msg, '*');
    }
    pendingRef.current = [];
  }, []);

  useEffect(() => {
    if (!ready) return;
    flushPending();
  }, [ready, flushPending]);

  // ── Forward avatar state to iframe ───────────────────────────────────
  useEffect(() => {
    if (!active || !ready) return;
    postToIframe({ type: 'wonder.avatarState', state: avatarState });
  }, [avatarState, active, ready, postToIframe]);

  // ── Send parent-side orientation to iframe ───────────────────────────
  // The parent page has access to the real device orientation and window size;
  // posting it into the iframe lets the iframe apply body classes without
  // relying solely on its own inner dimensions (which can differ in iframes).
  const sendOrientation = useCallback(() => {
    const isPortrait = typeof window !== 'undefined'
      ? window.matchMedia('(orientation: portrait)').matches
      : false;
    postToIframe({ type: 'wonder.orientation', portrait: isPortrait });
  }, [postToIframe]);

  // Send once when the iframe first becomes ready
  useEffect(() => {
    if (!ready) return;
    sendOrientation();
  }, [ready, sendOrientation]);

  // Re-send on every viewport resize / orientation change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: portrait)');
    const onMqChange = () => sendOrientation();
    const onResize = () => sendOrientation();
    mq.addEventListener('change', onMqChange);
    window.addEventListener('resize', onResize);
    return () => {
      mq.removeEventListener('change', onMqChange);
      window.removeEventListener('resize', onResize);
    };
  }, [sendOrientation]);

  // ── Helper: clear Wonder Canvas and notify all listeners ──────────
  // Centralises the clear-and-broadcast pattern used by multiple effects.
  const clearWonderCanvas = useCallback(
    (source: string) => {
      logger.info(`Clearing Wonder Canvas (source: ${source})`);
      postToIframe({ type: 'wonder.clear', layer: undefined });
      setActive(false);
      // Notify other components (e.g. ChatModeDesktop, GIF avatar)
      window.dispatchEvent(
        new CustomEvent(NIA_EVENT_WONDER_CLEAR, {
          detail: { payload: { layer: undefined, _source: source } },
        })
      );
    },
    [postToIframe]
  );

  // ── Listen for wonder.* nia events ──────────────────────────────────
  useEffect(() => {
    // Dedup: ignore rapid scene pushes within 3s window (server-side dedup is primary,
    // this is a safety net for race conditions or duplicate WebSocket deliveries)
    let lastSceneTs = 0;
    const SCENE_DEDUP_MS = 3000;

    const handleScene = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      if (!payload?.html) return;
      const now = Date.now();
      if (now - lastSceneTs < SCENE_DEDUP_MS) {
        logger.info('Wonder scene DEDUPED on frontend', { age: now - lastSceneTs });
        return;
      }
      lastSceneTs = now;
      logger.info('Wonder scene received', { layer: payload.layer, chars: payload.html.length });
      setActive(true);
      postToIframe({ type: 'wonder.scene', ...payload });
    };

    const handleAdd = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      if (!payload?.html) return;
      postToIframe({ type: 'wonder.add', ...payload });
    };

    const handleRemove = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      postToIframe({ type: 'wonder.remove', ...payload });
    };

    const handleClear = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      // Skip if this event was self-dispatched (close button, session reset, etc.)
      // — we already sent the clear to the iframe in those paths.
      if (payload?._source) return;
      logger.info('Wonder canvas clear');
      postToIframe({ type: 'wonder.clear', ...payload });
      // Don't set active=false yet — wait for iframe to confirm clear
    };

    const handleAnimate = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      if ((!payload?.elementId && !payload?.selector) || !payload?.animation) return;
      postToIframe({ type: 'wonder.animate', ...payload });
    };

    window.addEventListener(NIA_EVENT_WONDER_SCENE, handleScene);
    window.addEventListener(NIA_EVENT_WONDER_ADD, handleAdd);
    window.addEventListener(NIA_EVENT_WONDER_REMOVE, handleRemove);
    window.addEventListener(NIA_EVENT_WONDER_CLEAR, handleClear);
    window.addEventListener(NIA_EVENT_WONDER_ANIMATE, handleAnimate);

    return () => {
      window.removeEventListener(NIA_EVENT_WONDER_SCENE, handleScene);
      window.removeEventListener(NIA_EVENT_WONDER_ADD, handleAdd);
      window.removeEventListener(NIA_EVENT_WONDER_REMOVE, handleRemove);
      window.removeEventListener(NIA_EVENT_WONDER_CLEAR, handleClear);
      window.removeEventListener(NIA_EVENT_WONDER_ANIMATE, handleAnimate);
    };
  }, [postToIframe]);

  // ── Clear Wonder Canvas on new voice session ───────────────────────
  // Prevents stale canvas content from a previous session leaking into the
  // next one (Bug C: canvas-leak).
  useEffect(() => {
    const handleNewSession = () => {
      clearWonderCanvas('new-session');
    };

    window.addEventListener(NIA_EVENT_CALL_START, handleNewSession);
    return () => window.removeEventListener(NIA_EVENT_CALL_START, handleNewSession);
  }, [clearWonderCanvas]);

  // ── Clear Wonder Canvas when exiting chat mode (going home) ────────
  // When the user leaves the WORK desktop (chat mode), clear any active
  // Wonder Canvas content so it doesn't block clicks on the home screen.
  const prevChatModeRef = useRef(isChatMode);
  useEffect(() => {
    if (prevChatModeRef.current && !isChatMode && active) {
      clearWonderCanvas('chat-mode-exit');
    }
    prevChatModeRef.current = isChatMode;
  }, [isChatMode, active, clearWonderCanvas]);

  // ── Clear Wonder Canvas when desktop mode leaves WORK ──────────────
  // If the user navigates away from WORK mode (e.g. pressing the Home
  // nav button) while Wonder Canvas is active, clear it so returning to
  // WORK doesn't show a stale black screen.  This also prevents an
  // invisible Wonder Canvas overlay from blocking clicks in other modes.
  const prevDesktopModeRef = useRef(currentMode);
  useEffect(() => {
    const prev = prevDesktopModeRef.current;
    prevDesktopModeRef.current = currentMode;

    // Only act when leaving WORK mode while canvas is active
    if (prev === DesktopMode.WORK && currentMode !== DesktopMode.WORK && active) {
      clearWonderCanvas('desktop-mode-exit');
    }
  }, [currentMode, active, clearWonderCanvas]);

  // ── Listen for messages FROM the iframe ─────────────────────────────
  // Register this listener early (empty deps) so it can't miss wonder.ready
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // Only accept messages from our iframe
      if (e.source !== iframeRef.current?.contentWindow) return;

      if (e.data?.type === 'wonder.ready') {
        // Ack the iframe so it stops retrying
        try { (e.source as Window)?.postMessage({ type: 'wonder.ready.ack' }, '*'); } catch (_) { /* noop */ }
        if (!readyRef.current) {
          logger.info('Wonder Canvas runtime ready');
          readyRef.current = true;
          setReady(true);
        }
        return;
      }

      if (e.data?.type === 'wonder.cleared') {
        setActive(false);
        return;
      }

      if (e.data?.type === 'wonder.interaction') {
        const interaction: WonderInteraction = {
          action: e.data.action ?? '',
          label: e.data.label ?? '',
          elementId: e.data.elementId ?? null,
        };
        logger.info('Wonder interaction', { action: interaction.action, label: interaction.label });

        // Handle close action — dismiss the Wonder Canvas scene
        if (interaction.action === 'close') {
          clearWonderCanvas('close-button');
          return;
        }

        // Forward to bot via Daily app-message
        try {
          forwardAppEvent('wonder.canvas.interaction' as unknown as EventEnum, interaction);
        } catch (err) {
          logger.warn('Failed to forward wonder interaction via app-message', { error: String(err) });
        }

        // Also call the prop handler
        onInteraction?.(interaction);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onInteraction, clearWonderCanvas]);

  // ── React-level close button handler ─────────────────────────────
  // This is rendered outside the iframe as a reliable fallback. The iframe
  // has its own close button (injected via closeButtonHTML) but on some
  // mobile browsers inline onclick handlers inside innerHTML-injected full
  // HTML documents can fail to fire. This React-level button guarantees
  // the user can always dismiss the Wonder Canvas.
  const handleCloseClick = useCallback(() => {
    clearWonderCanvas('react-close-button');
  }, [clearWonderCanvas]);

  return (
    <div
      className={`wonder-canvas ${active ? 'wonder-canvas--active' : 'wonder-canvas--inactive'}`}
      data-testid="wonder-canvas"
    >
      <iframe
        ref={iframeRef}
        className="wonder-canvas__frame"
        src={WONDER_CANVAS_URL}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        title="Wonder Canvas"
      />
      {/* React-rendered close button — always accessible when canvas is active.
          Positioned top-right but offset to avoid overlapping PersistentNavButtons (top-left).
          z-index 10 within the wonder-canvas container so it's above the iframe. */}
      {active && (
        <button
          onClick={handleCloseClick}
          aria-label="Close Wonder Canvas"
          className="wonder-canvas__close-btn"
        >
          ✕
        </button>
      )}
    </div>
  );
}
