'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { useUI } from '@interface/contexts/ui-context';
import { DesktopMode, type DesktopModeSwitchResponse } from '@interface/types/desktop-modes';
import ExperienceRenderer, { type ExperienceContent } from './ExperienceRenderer';
import WonderCanvasRenderer from './WonderCanvas/WonderCanvasRenderer';
import CanvasTaskProgress from './WonderCanvas/CanvasTaskProgress';
// UniversalCanvas REMOVED from Stage — was causing white overlay conflict with WonderCanvas.
// Both rendered at z-index 1, position absolute inset 0. UniversalCanvas (canvas.render events)
// would mount ON TOP of WonderCanvas (wonder.scene events), creating the milky white overlay.
// All canvas content now routes through WonderCanvas templates exclusively.
// UniversalCanvas still exists in browser-window.tsx for Notes — that's fine.
import './stage.css';

const logger = getClientLogger('[stage]');

interface HomeGesturePoint {
  x: number;
  y: number;
  time: number;
  pointerType: string;
}

function isInteractiveHomeGestureTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      [
        'button',
        'a',
        'input',
        'textarea',
        'select',
        'iframe',
        '[contenteditable="true"]',
        '[role="button"]',
        '.pearl-nav-button',
        '.pearl-app-window-divider',
        '.wonder-canvas--active',
      ].join(',')
    )
  );
}

/**
 * The Stage — PearlOS's single-screen experience surface.
 *
 * Replaces the windowed desktop paradigm with a full-screen void where
 * Pearl summons experiences on demand. The avatar floats above; experiences
 * materialize beneath.
 *
 * Z-index stack:
 *   0 — Background (dark gradient + ambient particles, via CSS)
 *   1 — Experience content (ExperienceRenderer)
 *   2 — Pearl avatar (rendered by parent — DailyCall/GIF avatar)
 *   3 — Input bar (rendered by parent)
 */
export default function Stage() {
  const { currentMode, setMode } = useDesktopMode();
  const { setIsChatMode } = useUI();
  const [experience, setExperience] = useState<ExperienceContent | null>(null);
  const homeGestureStartRef = useRef<HomeGesturePoint | null>(null);
  const lastHomeTapRef = useRef<HomeGesturePoint | null>(null);

  // Log mode changes for debugging desktop mode switching
  useEffect(() => {
    logger.info(`[Stage] Desktop mode changed to: ${currentMode}`);
    console.log(`[Stage] Desktop mode is now: ${currentMode}`);
  }, [currentMode]);

  // Listen for experience.render events from the nia event system
  useEffect(() => {
    const handleExperienceRender = (event: Event) => {
      const custom = event as CustomEvent<{
        payload?: {
          html?: string;
          css?: string;
          js?: string;
          transition?: 'fade' | 'slide' | 'instant';
        };
      }>;
      const payload = custom.detail?.payload;
      if (payload?.html) {
        logger.info('Rendering experience', { transition: payload.transition });
        setExperience({
          html: payload.html,
          css: payload.css,
          js: payload.js,
          transition: payload.transition,
        });
      }
    };

    const handleExperienceDismiss = () => {
      logger.info('Dismissing experience');
      setExperience(null);
    };

    window.addEventListener('nia:experience.render', handleExperienceRender);
    window.addEventListener('nia:experience.dismiss', handleExperienceDismiss);

    return () => {
      window.removeEventListener('nia:experience.render', handleExperienceRender);
      window.removeEventListener('nia:experience.dismiss', handleExperienceDismiss);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setExperience(null);
  }, []);

  const showDesktopIconsFromHome = useCallback(
    (switchReason: string) => {
      if (currentMode !== DesktopMode.HOME) return;
      const switchResponse: DesktopModeSwitchResponse = {
        success: true,
        mode: DesktopMode.DESKTOP,
        message: 'Switching to desktop mode',
        userRequest: null,
        timestamp: new Date().toISOString(),
        action: 'SWITCH_DESKTOP_MODE',
        payload: {
          targetMode: DesktopMode.DESKTOP,
          previousMode: currentMode,
          switchReason,
        },
      };

      window.dispatchEvent(new CustomEvent<DesktopModeSwitchResponse>('desktopModeSwitch', {
        detail: switchResponse,
      }));
      setMode(DesktopMode.DESKTOP);
      setIsChatMode(true);
    },
    [currentMode, setIsChatMode, setMode]
  );

  const handleHomePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (currentMode !== DesktopMode.HOME) return;
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      if (isInteractiveHomeGestureTarget(event.target)) return;
      homeGestureStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        time: Date.now(),
        pointerType: event.pointerType,
      };
    },
    [currentMode]
  );

  const handleHomePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (currentMode !== DesktopMode.HOME) return;
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      if (isInteractiveHomeGestureTarget(event.target)) return;
      const start = homeGestureStartRef.current;
      homeGestureStartRef.current = null;
      if (!start || start.pointerType !== event.pointerType) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const elapsed = Date.now() - start.time;
      const swipeThreshold = Math.max(60, Math.min(window.innerWidth * 0.12, 120));
      const startedAtSystemBackEdge = start.x < 24;

      if (!startedAtSystemBackEdge && dx <= -swipeThreshold && absDy <= 70 && absDx > absDy * 1.4) {
        showDesktopIconsFromHome('home_swipe_left_icons');
        return;
      }

      const isTap = absDx <= 18 && absDy <= 18 && elapsed <= 280;
      if (!isTap) return;
      const now = Date.now();
      const lastTap = lastHomeTapRef.current;
      lastHomeTapRef.current = { x: event.clientX, y: event.clientY, time: now, pointerType: event.pointerType };
      if (!lastTap || now - lastTap.time > 320) return;
      const tapDx = Math.abs(event.clientX - lastTap.x);
      const tapDy = Math.abs(event.clientY - lastTap.y);
      if (tapDx <= 24 && tapDy <= 24) {
        lastHomeTapRef.current = null;
        showDesktopIconsFromHome('home_double_tap_icons');
      }
    },
    [currentMode, showDesktopIconsFromHome]
  );

  const handleHomeDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (currentMode !== DesktopMode.HOME) return;
      if (isInteractiveHomeGestureTarget(event.target)) return;
      showDesktopIconsFromHome('home_double_click_icons');
    },
    [currentMode, showDesktopIconsFromHome]
  );

  return (
    <div
      className={`stage stage--${currentMode}`}
      data-testid="pearl-stage"
      data-desktop-mode={currentMode}
      onPointerDown={handleHomePointerDown}
      onPointerUp={handleHomePointerUp}
      onDoubleClick={handleHomeDoubleClick}
    >
      {/* Wonder Canvas layer — behind experience and Pearl avatar */}
      <WonderCanvasRenderer />

      {/* Experience layer */}
      <ExperienceRenderer
        content={experience}
        onDismiss={handleDismiss}
      />

      {/* UniversalCanvas REMOVED — was causing white overlay. See comment at top. */}

      {/* Canvas task progress indicator */}
      <CanvasTaskProgress />

      {/* Pearl avatar layer — reserved for future use */}
      <div className="stage__pearl" />
    </div>
  );
}
