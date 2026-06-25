'use client';

import React, { useEffect, useState } from 'react';
import DesktopBackgroundWork from '@interface/components/desktop-background-work';
import { useUI } from '@interface/contexts/ui-context';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode } from '@interface/types/desktop-modes';
import {
  NIA_EVENT_WONDER_SCENE,
  NIA_EVENT_WONDER_CLEAR,
} from '@interface/features/DailyCall/events/niaEventRouter';

interface ChatModeDesktopProps {
  supportedFeatures: string[];
  assistantName?: string;
  tenantId?: string;
  isAdmin?: boolean;
}

/**
 * Renders the DESKTOP background + icons when chat mode is active.
 * This layer sits behind the ChatMode overlay so icons are visible
 * when the chat panel is minimized.
 *
 * When Wonder Canvas is active, this layer drops to z-index -1 so the
 * canvas (inside Stage at z-0) is visible above the desktop icons. Otherwise
 * the icons layer at z-25 would paint on top and hide the canvas.
 */
const ChatModeDesktop: React.FC<ChatModeDesktopProps> = ({
  supportedFeatures,
  assistantName,
  tenantId,
  isAdmin,
}) => {
  const { isChatMode, setIsChatMode } = useUI();
  const { currentMode } = useDesktopMode();
  const [wonderCanvasActive, setWonderCanvasActive] = useState(false);
  const isDesktopMode = currentMode === DesktopMode.DESKTOP;

  useEffect(() => {
    const handleWonderScene = () => setWonderCanvasActive(true);
    const handleWonderClear = () => setWonderCanvasActive(false);
    window.addEventListener(NIA_EVENT_WONDER_SCENE, handleWonderScene);
    window.addEventListener(NIA_EVENT_WONDER_CLEAR, handleWonderClear);
    return () => {
      window.removeEventListener(NIA_EVENT_WONDER_SCENE, handleWonderScene);
      window.removeEventListener(NIA_EVENT_WONDER_CLEAR, handleWonderClear);
    };
  }, []);

  // Show desktop icons when chat mode is active OR when in DESKTOP mode
  if (!isChatMode && !isDesktopMode) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0"
      data-desktop-mode="desktop"
      style={{
        zIndex: wonderCanvasActive ? -1 : 25,
        opacity: 1,
        visibility: 'visible',
        transition: 'opacity 300ms ease-in-out, z-index 0s',
      }}
    >
      <DesktopBackgroundWork
        supportedFeatures={supportedFeatures}
        assistantName={assistantName}
        tenantId={tenantId}
        isAdmin={isAdmin}
      />

      {/* Home button — top-left corner, navigates back to Pearl home screen */}
      <button
        onClick={() => setIsChatMode(false)}
        aria-label="Go to home"
        className="pearl-nav-button"
        style={{
          position: 'fixed',
          top: '12px',
          left: '12px',
          zIndex: 50,
          width: '36px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '10px',
          background: 'var(--pearl-nav-button-bg, rgba(255, 255, 255, 0.12))',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid var(--pearl-nav-button-border, rgba(255, 255, 255, 0.18))',
          cursor: 'pointer',
          pointerEvents: 'auto',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          transition: 'background 0.2s ease, transform 0.1s ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--pearl-nav-button-hover-bg, rgba(255, 255, 255, 0.22))';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--pearl-nav-button-bg, rgba(255, 255, 255, 0.12))';
        }}
        onTouchStart={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)';
        }}
        onTouchEnd={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </button>
    </div>
  );
};

export default ChatModeDesktop;
