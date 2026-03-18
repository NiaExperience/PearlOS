'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
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
  const { currentMode } = useDesktopMode();
  const [experience, setExperience] = useState<ExperienceContent | null>(null);

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

  return (
    <div className={`stage stage--${currentMode}`} data-testid="pearl-stage" data-desktop-mode={currentMode}>
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
