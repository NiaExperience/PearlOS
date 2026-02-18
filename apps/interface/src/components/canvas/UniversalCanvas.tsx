'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasContent, CanvasRenderEvent } from './types';
import { NIA_EVENT_CANVAS_RENDER, NIA_EVENT_CANVAS_CLEAR } from './types';
import {
  MarkdownRenderer,
  ChartRenderer,
  ImageRenderer,
  ArticleRenderer,
  TableRenderer,
  CodeRenderer,
  HtmlRenderer,
} from './renderers';

// ─── Transition wrapper ──────────────────────────────────────────────────────

interface TransitionState {
  content: CanvasContent | null;
  phase: 'entering' | 'visible' | 'exiting' | 'hidden';
}

// ─── Content Renderer Switch ─────────────────────────────────────────────────

function ContentSwitch({ content }: { content: CanvasContent }) {
  switch (content.type) {
    case 'markdown':
      return <MarkdownRenderer content={content} />;
    case 'chart':
      return <ChartRenderer content={content} />;
    case 'image':
      return <ImageRenderer content={content} />;
    case 'article':
      return <ArticleRenderer content={content} />;
    case 'table':
      return <TableRenderer content={content} />;
    case 'code':
      return <CodeRenderer content={content} />;
    case 'html':
      return <HtmlRenderer content={content} />;
    default:
      return (
        <div className="px-6 py-4 text-slate-400">
          Unsupported content type: {(content as CanvasContent).type}
        </div>
      );
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export interface UniversalCanvasProps {
  /** Directly pass content (controlled mode). If set, ignores events. */
  content?: CanvasContent | null;
  /** Whether to listen to window custom events for content updates. Default: true */
  listenToEvents?: boolean;
  /** Optional class for the outer wrapper. */
  className?: string;
  /** Called when canvas clears. */
  onClear?: () => void;
}

export default function UniversalCanvas({
  content: controlledContent,
  listenToEvents = true,
  className,
  onClear,
}: UniversalCanvasProps) {
  const [internalContent, setInternalContent] = useState<CanvasContent | null>(null);
  const [phase, setPhase] = useState<'hidden' | 'entering' | 'visible' | 'exiting'>('hidden');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const content = controlledContent !== undefined ? controlledContent : internalContent;

  // Transition management — uses phaseRef so callback identity is stable
  const showContent = useCallback((newContent: CanvasContent, transition: string = 'fade') => {
    const currentPhase = phaseRef.current;
    if (currentPhase === 'visible' || currentPhase === 'entering') {
      // Exit current, then enter new
      setPhase('exiting');
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setInternalContent(newContent);
        setPhase('entering');
        timeoutRef.current = setTimeout(() => setPhase('visible'), 300);
      }, 200);
    } else {
      setInternalContent(newContent);
      setPhase('entering');
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setPhase('visible'), 300);
    }
  }, []);

  const clearContent = useCallback(() => {
    setPhase('exiting');
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setInternalContent(null);
      setPhase('hidden');
      onClear?.();
    }, 300);
  }, [onClear]);

  // Listen to custom events from the PearlOS event system
  useEffect(() => {
    if (!listenToEvents) return;

    const handleRender = (e: Event) => {
      const detail = (e as CustomEvent).detail as CanvasRenderEvent;
      if (detail?.content) {
        showContent(detail.content, detail.transition || 'fade');
      }
    };

    const handleClear = () => clearContent();

    window.addEventListener(NIA_EVENT_CANVAS_RENDER, handleRender);
    window.addEventListener(NIA_EVENT_CANVAS_CLEAR, handleClear);

    return () => {
      window.removeEventListener(NIA_EVENT_CANVAS_RENDER, handleRender);
      window.removeEventListener(NIA_EVENT_CANVAS_CLEAR, handleClear);
      clearTimeout(timeoutRef.current);
    };
  }, [listenToEvents, showContent, clearContent]);

  // Handle controlled content changes
  useEffect(() => {
    if (controlledContent !== undefined) {
      if (controlledContent) {
        setPhase('entering');
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setPhase('visible'), 300);
      } else if (phase !== 'hidden') {
        clearContent();
      }
    }
  }, [controlledContent]);

  if (!content || phase === 'hidden') return null;

  const accentColor = content.style?.accent || '#818cf8';

  return (
    <div
      className={`universal-canvas relative flex flex-col h-full w-full overflow-hidden ${className || ''}`}
      style={{
        '--canvas-accent': accentColor,
      } as React.CSSProperties}
    >
      {/* Content area with transition */}
      <div
        className={`flex-1 overflow-y-auto transition-all duration-300 ease-out ${
          phase === 'entering'
            ? 'opacity-0 translate-y-2'
            : phase === 'visible'
            ? 'opacity-100 translate-y-0'
            : phase === 'exiting'
            ? 'opacity-0 -translate-y-2'
            : 'opacity-0'
        }`}
        style={{
          colorScheme: content.style?.theme || 'dark',
        }}
      >
        <ContentSwitch content={content} />
      </div>
    </div>
  );
}

// ─── Helper to dispatch canvas events from anywhere ──────────────────────────

/**
 * Dispatch a canvas render event. Call from tool handlers, event routers, etc.
 */
export function dispatchCanvasRender(content: CanvasContent, transition?: 'fade' | 'slide' | 'instant') {
  window.dispatchEvent(
    new CustomEvent(NIA_EVENT_CANVAS_RENDER, {
      detail: { content, transition } satisfies CanvasRenderEvent,
    })
  );
}

/**
 * Dispatch a canvas clear event.
 */
export function dispatchCanvasClear() {
  window.dispatchEvent(new CustomEvent(NIA_EVENT_CANVAS_CLEAR));
}
