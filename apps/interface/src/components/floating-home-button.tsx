'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';

import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode, type DesktopModeSwitchResponse } from '../types/desktop-modes';

/**
 * FloatingHomeButton — Always-visible home button for touch/mobile views.
 * Renders in the top-right corner so users can escape any canvas/app back to the desktop.
 * Hidden when already on the home screen.
 */
const FloatingHomeButton: React.FC = () => {
  const { currentMode, setMode } = useDesktopMode();
  const [isPressed, setIsPressed] = useState(false);

  const isHome = currentMode === DesktopMode.HOME || currentMode === DesktopMode.DEFAULT;

  const handleClick = useCallback(() => {
    if (isHome) return;

    // Dispatch the desktop mode switch event (same pattern as taskbar)
    const switchResponse: DesktopModeSwitchResponse = {
      success: true,
      mode: DesktopMode.HOME,
      message: 'Switching to home desktop mode',
      userRequest: null,
      timestamp: new Date().toISOString(),
      action: 'SWITCH_DESKTOP_MODE',
      payload: {
        targetMode: DesktopMode.HOME,
        previousMode: currentMode,
        switchReason: 'user_click_floating_home',
      },
    };

    window.dispatchEvent(
      new CustomEvent<DesktopModeSwitchResponse>('desktopModeSwitch', {
        detail: switchResponse,
      })
    );

    setMode(DesktopMode.HOME);
  }, [currentMode, isHome, setMode]);

  // Don't render when on home screen
  if (isHome) return null;

  return (
    <button
      onClick={handleClick}
      onPointerDown={() => setIsPressed(true)}
      onPointerUp={() => setIsPressed(false)}
      onPointerLeave={() => setIsPressed(false)}
      aria-label="Go to Home"
      title="Home"
      className="pointer-events-auto"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 500, // Above canvas content, below modals
        width: 44,
        height: 44,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(30, 58, 138, 0.45)',
        backdropFilter: 'blur(12px) saturate(180%)',
        WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        border: '1px solid rgba(147, 197, 253, 0.3)',
        boxShadow: isPressed
          ? '0 2px 8px rgba(30, 64, 175, 0.4)'
          : '0 4px 16px rgba(30, 64, 175, 0.3), 0 0 0 0 rgba(147, 197, 253, 0)',
        transform: isPressed ? 'scale(0.92)' : 'scale(1)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <Image
        src="/HomeTB.png"
        alt="Home"
        width={28}
        height={28}
        className="object-contain drop-shadow-sm"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(255,255,255,0.2))' }}
      />
    </button>
  );
};

export default FloatingHomeButton;
