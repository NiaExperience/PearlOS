'use client';

import React from 'react';
import type { SpriteAnimationState } from './useSpriteState';
import SpriteParticles from './SpriteParticles';
import './sprite-animations.css';

interface SpriteStageProps {
  state: SpriteAnimationState;
  children: React.ReactNode;
}

/**
 * SpriteStage — wraps the sprite with ambient effects:
 * - Vignette/spotlight
 * - Particle system (behind and in front)
 * - Platform/ground element
 * - Animation state CSS classes
 */
export default function SpriteStage({ state, children }: SpriteStageProps) {
  const spriteAnimClass = `sprite-${state}`;

  return (
    <div className="relative flex flex-col items-center">
      {/* Spotlight glow behind sprite */}
      <div className="stage-spotlight" />

      {/* Particle layer (behind sprite via z-index) */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <SpriteParticles state={state} width={300} height={300} />
      </div>

      {/* Sprite container with animation state */}
      <div className={`relative z-10 ${spriteAnimClass}`}>
        {/* Summoning flash effect */}
        {state === 'summoning' && <div className="sprite-summon-flash" />}

        {/* Speaking ring effect */}
        {state === 'speaking' && <div className="sprite-speaking-ring" />}

        {/* Thinking orbit dots */}
        {state === 'thinking' && (
          <div className="sprite-thinking-orbit">
            <div className="sprite-thinking-dot" />
            <div className="sprite-thinking-dot" />
            <div className="sprite-thinking-dot" />
            <div className="sprite-thinking-dot" />
          </div>
        )}

        {children}
      </div>

      {/* Platform / ground effect */}
      <div className="sprite-platform z-10" />
    </div>
  );
}
