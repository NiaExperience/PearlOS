"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';

export interface UIContextType {
  isBrowserWindowVisible: boolean;
  setIsBrowserWindowVisible: (isVisible: boolean) => void;
  browserWindowRect: DOMRect | null;
  setBrowserWindowRect: (rect: DOMRect | null) => void;
  isBrowserWindowMaximized: boolean;
  setIsBrowserWindowMaximized: (isMaximized: boolean) => void;
  // Content activity state - tracks if content is actively playing/interactive
  isContentActive: boolean;
  setIsContentActive: (isActive: boolean) => void;
  // Daily Call state - tracks if Daily Call is specifically active
  isDailyCallActive: boolean;
  setIsDailyCallActive: (isActive: boolean) => void;
  // Avatar control states
  isAvatarVisible: boolean;
  setIsAvatarVisible: (isVisible: boolean) => void;
  isAvatarAnimating: boolean;
  setIsAvatarAnimating: (isAnimating: boolean) => void;
  isAvatarHiding: boolean;
  setIsAvatarHiding: (isHiding: boolean) => void;
  bellButtonRect: DOMRect | null;
  setBellButtonRect: (rect: DOMRect | null) => void;
  triggerAvatarPopup: () => void;
  triggerAvatarHide: () => void;
  // Notes window state - tracks if notes/notepad window is open
  isNotesWindowOpen: boolean;
  setIsNotesWindowOpen: (isOpen: boolean) => void;
  // Fullscreen state - tracks if browser is in fullscreen mode
  isFullscreen: boolean;
  setIsFullscreen: (isFullscreen: boolean) => void;
  // Chat mode state - text-only interaction with Pearl (no voice call, no soundtrack)
  isChatMode: boolean;
  setIsChatMode: (isChatMode: boolean) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider = ({ children }: { children: ReactNode }) => {
  const log = getClientLogger('UIContext');
  const [isBrowserWindowVisible, setIsBrowserWindowVisible] = useState(false);
  const [browserWindowRect, setBrowserWindowRect] = useState<DOMRect | null>(null);
  const [isBrowserWindowMaximized, setIsBrowserWindowMaximized] = useState(false);
  
  // Content activity state - tracks if content is actively playing/interactive
  const [isContentActive, setIsContentActive] = useState(false);
  
  // Daily Call state - tracks if Daily Call is specifically active
  const [isDailyCallActive, setIsDailyCallActive] = useState(false);
  
  // Avatar state management
  const [isAvatarVisible, setIsAvatarVisible] = useState(false);
  const [isAvatarAnimating, setIsAvatarAnimating] = useState(false);
  const [isAvatarHiding, setIsAvatarHiding] = useState(false);
  const [bellButtonRect, setBellButtonRect] = useState<DOMRect | null>(null);
  
  // Notes window state
  const [isNotesWindowOpen, setIsNotesWindowOpen] = useState(false);
  
  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Chat mode state
  const [isChatMode, setIsChatMode] = useState(false);

  // Bot handoff: Track if avatar was visible before Daily Call started
  const avatarVisibleBeforeDailyCallRef = useRef(false);

  const triggerAvatarPopup = () => {
    if (!isAvatarVisible) {
      setIsAvatarHiding(false);
      setIsAvatarAnimating(true);
      setIsAvatarVisible(true);
      
      // Reset animation state after animation completes
      setTimeout(() => {
        setIsAvatarAnimating(false);
      }, 1000); // 1 second for pop-up animation
    }
  };

  const triggerAvatarHide = () => {
    if (isAvatarVisible) {
      setIsAvatarHiding(true);
      setIsAvatarAnimating(true);
      // Immediately hide avatar; animation is handled by RiveAvatar return sequence
      setIsAvatarVisible(false);
      setIsAvatarAnimating(false);
      setIsAvatarHiding(false);
    }
  };

  // Bot handoff: Listen for Daily Call session events to manage avatar visibility
  // When Daily Call (video bot) starts, hide the voice-only bot (RiveAvatar)
  // When Daily Call ends, restore the voice-only bot
  useEffect(() => {
    const handleDailyCallStart = () => {
      log.info('Daily Call started - hiding voice bot avatar');
      log.debug('Avatar visibility before Daily Call', { isAvatarVisible });
      // Remember if avatar was visible before hiding
      avatarVisibleBeforeDailyCallRef.current = isAvatarVisible;
      setIsDailyCallActive(true);
      // Hide the avatar when video call starts
      if (isAvatarVisible) {
        triggerAvatarHide();
      }
    };

    const handleDailyCallEnd = () => {
      log.info('Daily Call ended - restoring voice bot avatar');
      log.debug('Avatar visibility before Daily Call', { wasVisible: avatarVisibleBeforeDailyCallRef.current });
      setIsDailyCallActive(false);
      // Show the avatar again if it was visible before Daily Call started
      if (avatarVisibleBeforeDailyCallRef.current) {
        triggerAvatarPopup();
        // Reset the ref after restoration
        avatarVisibleBeforeDailyCallRef.current = false;
      }
    };

    // Subscribe to Daily Call session events
    window.addEventListener('dailyCall.session.start', handleDailyCallStart);
    window.addEventListener('dailyCall.session.end', handleDailyCallEnd);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('dailyCall.session.start', handleDailyCallStart);
      window.removeEventListener('dailyCall.session.end', handleDailyCallEnd);
    };
  }, [isAvatarVisible, triggerAvatarHide, triggerAvatarPopup]); // Include dependencies

  return (
    <UIContext.Provider value={{
      isBrowserWindowVisible, 
      setIsBrowserWindowVisible, 
      browserWindowRect, 
      setBrowserWindowRect,
      isBrowserWindowMaximized,
      setIsBrowserWindowMaximized,
      isContentActive,
      setIsContentActive,
      isDailyCallActive,
      setIsDailyCallActive,
      isAvatarVisible,
      setIsAvatarVisible,
      isAvatarAnimating,
      setIsAvatarAnimating,
      isAvatarHiding,
      setIsAvatarHiding,
      bellButtonRect,
      setBellButtonRect,
      triggerAvatarPopup,
      triggerAvatarHide,
      isNotesWindowOpen,
      setIsNotesWindowOpen,
      isFullscreen,
      setIsFullscreen,
      isChatMode,
      setIsChatMode
    }}>
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
}; 