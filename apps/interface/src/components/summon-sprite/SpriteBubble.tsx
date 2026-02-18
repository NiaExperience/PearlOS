'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { SpriteAnimationState } from './useSpriteState';

interface SpriteBubbleProps {
  text: string;
  state: SpriteAnimationState;
  maxWidth?: number;
}

/**
 * Pixel art styled chat bubble with typewriter effect.
 * 9-slice pixel border via box-shadow technique.
 */
export default function SpriteBubble({ text, state, maxWidth = 240 }: SpriteBubbleProps) {
  const [displayedText, setDisplayedText] = useState(text);
  const [isTyping, setIsTyping] = useState(false);
  const prevTextRef = useRef(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef = useRef(0);

  // Typewriter effect when text changes
  useEffect(() => {
    if (text === prevTextRef.current) return;
    prevTextRef.current = text;

    // Clear any existing typewriter
    if (timerRef.current) clearTimeout(timerRef.current);

    // Skip typewriter for very long text (performance) or during summoning
    if (text.length > 200 || state === 'summoning') {
      setDisplayedText(text);
      setIsTyping(false);
      return;
    }

    // Check reduced motion
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      setDisplayedText(text);
      setIsTyping(false);
      return;
    }

    // Start typewriter
    setIsTyping(true);
    indexRef.current = 0;
    setDisplayedText('');

    const type = () => {
      indexRef.current++;
      setDisplayedText(text.slice(0, indexRef.current));
      if (indexRef.current < text.length) {
        timerRef.current = setTimeout(type, 18 + Math.random() * 12);
      } else {
        setIsTyping(false);
      }
    };

    timerRef.current = setTimeout(type, 80);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, state]);

  const bubbleClass = useMemo(() => {
    const classes = ['bubble-appear'];
    if (state === 'idle' && !isTyping) classes.push('bubble-idle');
    return classes.join(' ');
  }, [state, isTyping]);

  return (
    <div
      className={bubbleClass}
      style={{
        maxWidth,
        fontFamily: 'Gohufont, monospace',
        position: 'relative',
      }}
    >
      {/* Pixel art border using layered box-shadows */}
      <div
        className="relative rounded-none px-3 py-2"
        style={{
          background: 'rgba(15, 23, 42, 0.9)',
          border: '2px solid rgba(129, 140, 248, 0.4)',
          boxShadow: `
            inset 2px 2px 0 rgba(129, 140, 248, 0.1),
            inset -2px -2px 0 rgba(0, 0, 0, 0.2),
            0 0 0 1px rgba(129, 140, 248, 0.15),
            0 4px 12px rgba(0, 0, 0, 0.3)
          `,
          imageRendering: 'pixelated' as const,
        }}
      >
        {/* Corner pixels for that authentic pixel-art feel */}
        <div className="absolute -top-[1px] -left-[1px] w-[3px] h-[3px] bg-indigo-400/60" />
        <div className="absolute -top-[1px] -right-[1px] w-[3px] h-[3px] bg-indigo-400/60" />
        <div className="absolute -bottom-[1px] -left-[1px] w-[3px] h-[3px] bg-indigo-400/60" />
        <div className="absolute -bottom-[1px] -right-[1px] w-[3px] h-[3px] bg-indigo-400/60" />

        <p className="text-[12px] leading-relaxed text-slate-100 text-center">
          {displayedText}
          {isTyping && (
            <span className="inline-block w-[6px] h-[12px] bg-indigo-400 ml-[2px] animate-pulse" 
              style={{ imageRendering: 'pixelated' }} />
          )}
        </p>
      </div>

      {/* Speech bubble tail */}
      <div className="flex justify-center">
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid rgba(129, 140, 248, 0.4)',
          }}
        />
      </div>
    </div>
  );
}
