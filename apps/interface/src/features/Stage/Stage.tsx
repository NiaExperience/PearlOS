'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';
import ExperienceRenderer, { type ExperienceContent } from './ExperienceRenderer';
import WonderCanvasRenderer from './WonderCanvas/WonderCanvasRenderer';
import UniversalCanvas from '@interface/components/canvas/UniversalCanvas';
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
 *   2 — Pearl avatar (rendered by parent — DailyCall/RiveAvatar)
 *   3 — Input bar (rendered by parent)
 */
export default function Stage() {
  const [experience, setExperience] = useState<ExperienceContent | null>(null);

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
    <div className="stage" data-testid="pearl-stage">
      {/* Wonder Canvas layer — behind experience and Pearl avatar */}
      <WonderCanvasRenderer />

      {/* Experience layer */}
      <ExperienceRenderer
        content={experience}
        onDismiss={handleDismiss}
      />

      {/* Universal Canvas layer — renders structured content (markdown, charts, etc.) */}
      <UniversalCanvas className="stage__canvas" />

      {/* Pearl avatar layer — the avatar itself is rendered by the parent
          (RiveAvatar lives in DailyCall). This div reserves the z-index layer. */}
      <div className="stage__pearl" />
    </div>
  );
}
