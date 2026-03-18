'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { DesktopMode } from '@interface/types/desktop-modes';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import {
  WINDOW_OPEN_EVENT,
  WINDOW_CLOSE_EVENT,
  type WindowOpenRequest,
  type WindowCloseRequest,
} from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';

const HIDE_DELAY = 3000; // 3 seconds

/**
 * Hook for auto-hiding UI elements when sprite is displayed in Quiet mode.
 * Similar behavior to ManeuverableWindowControls:
 * - Desktop: Show on mouse move, hide after 3s inactivity
 * - Mobile: Start hidden, show on touch/click
 * - Stays visible when dropdowns are open
 * - Hides on window blur, shows on focus
 */
export function useSpriteDisplayAutoHide() {
  const { currentMode } = useDesktopMode();
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isSpriteDisplayed, setIsSpriteDisplayed] = useState(false);
  const [openWindowCount, setOpenWindowCount] = useState(0);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controlsContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-hide when sprite is displayed OR when any app window is open
  const isAppWindowOpen = openWindowCount > 0;
  const shouldAutoHide = isSpriteDisplayed || isAppWindowOpen;

  // Reset visibility when auto-hide is disabled (sprite dismissed or mode changed)
  useEffect(() => {
    if (!shouldAutoHide) {
      setControlsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    }
  }, [shouldAutoHide]);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768; // Tailwind's md breakpoint
      setIsMobile(mobile);
      // On mobile, start with controls hidden when sprite is displayed
      if (mobile && shouldAutoHide) {
        setControlsVisible(false);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, [shouldAutoHide]);

  // Listen for sprite.ready event to track sprite display state
  useEffect(() => {
    const handleSpriteReady = () => {
      setIsSpriteDisplayed(true);
    };

    // Also listen for sprite dismissal (when sprite is closed)
    const handleSpriteDismissed = () => {
      setIsSpriteDisplayed(false);
      // Reset visibility when sprite is dismissed
      setControlsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };

    window.addEventListener('sprite.ready', handleSpriteReady);
    // Listen for custom event when sprite is dismissed (SummonSpritePrompt dispatches this)
    window.addEventListener('sprite.dismissed', handleSpriteDismissed);

    return () => {
      window.removeEventListener('sprite.ready', handleSpriteReady);
      window.removeEventListener('sprite.dismissed', handleSpriteDismissed);
    };
  }, []);

  // Listen for app window open/close events to trigger auto-hide
  useEffect(() => {
    const handleWindowOpen = () => {
      setOpenWindowCount(prev => prev + 1);
    };

    const handleWindowClose = () => {
      setOpenWindowCount(prev => Math.max(0, prev - 1));
    };

    window.addEventListener(WINDOW_OPEN_EVENT, handleWindowOpen);
    window.addEventListener(WINDOW_CLOSE_EVENT, handleWindowClose);

    // Also listen for the "all windows closed" scenario (close-all, browser close, etc.)
    const handleAllClosed = () => {
      setOpenWindowCount(0);
    };
    window.addEventListener('nia:all-windows-closed', handleAllClosed);

    return () => {
      window.removeEventListener(WINDOW_OPEN_EVENT, handleWindowOpen);
      window.removeEventListener(WINDOW_CLOSE_EVENT, handleWindowClose);
      window.removeEventListener('nia:all-windows-closed', handleAllClosed);
    };
  }, []);

  // Listen for dropdown state changes (from HtmlContentViewer or other dropdowns)
  useEffect(() => {
    const handleDropdownStateChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ isDropdownOpen: boolean }>;
      const newDropdownState = customEvent.detail?.isDropdownOpen ?? false;
      setIsDropdownOpen(newDropdownState);
      
      // If dropdown opens, force controls to be visible
      if (newDropdownState) {
        setControlsVisible(true);
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }
      }
    };

    window.addEventListener('htmlViewer.dropdownStateChange', handleDropdownStateChange);
    
    return () => {
      window.removeEventListener('htmlViewer.dropdownStateChange', handleDropdownStateChange);
    };
  }, []);

  const resetHideTimer = useCallback(() => {
    if (!shouldAutoHide) return;
    
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    setControlsVisible(true);
    // Don't auto-hide if dropdown is open
    if (isDropdownOpen) return;
    hideTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, HIDE_DELAY);
  }, [shouldAutoHide, isDropdownOpen]);

  // Helper function to check if an element is interactive
  const isInteractiveElement = useCallback((element: HTMLElement | null): boolean => {
    if (!element) return false;
    
    // Check if element is a button, input, select, textarea, or anchor
    const tagName = element.tagName.toLowerCase();
    if (['button', 'input', 'select', 'textarea', 'a'].includes(tagName)) {
      return true;
    }
    
    // Check if element has role="button" or other interactive roles
    const role = element.getAttribute('role');
    if (role && ['button', 'link', 'tab', 'menuitem', 'option'].includes(role)) {
      return true;
    }
    
    // Check if element has onClick handler or is clickable
    if (element.onclick || element.getAttribute('onclick')) {
      return true;
    }
    
    // Check if element has cursor: pointer style
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.cursor === 'pointer') {
      return true;
    }
    
    return false;
  }, []);

  // Handle mouse movement and window focus/blur (desktop)
  // Handle touch/click events (mobile)
  useEffect(() => {
    if (!shouldAutoHide) {
      // Reset visibility when auto-hide is disabled
      setControlsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      return;
    }

    // Find the browser window container or use document body
    const browserWindow = document.querySelector('[class*="border"][class*="rounded-xl"][class*="overflow-hidden"]') || document.body;

    const handleMouseMove = () => {
      if (!isMobile) {
        resetHideTimer();
      }
    };

    const handleMouseLeave = () => {
      if (isMobile) return; // Skip on mobile
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      // Don't hide if dropdown is open
      if (isDropdownOpen) return;
      setControlsVisible(false);
    };

    const handleMouseEnter = () => {
      if (!isMobile) {
        resetHideTimer();
      }
    };

    const handleWindowBlur = () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      // Don't hide if dropdown is open
      if (isDropdownOpen) return;
      setControlsVisible(false);
    };

    const handleWindowFocus = () => {
      if (!isMobile) {
        resetHideTimer();
      }
    };

    // Mobile: Handle touch/click events to show controls
    const handleTouchStart = (e: Event) => {
      if (isMobile) {
        const touchEvent = e as TouchEvent;
        // Don't show controls if clicking on the controls themselves
        const target = touchEvent.target as HTMLElement;
        if (controlsContainerRef.current && controlsContainerRef.current.contains(target)) {
          return;
        }
        
        // Check if target is an interactive element
        const isInteractive = isInteractiveElement(target);
        const INTERACTIVE_DELAY = 500; // 500ms delay for interactive elements
        
        if (isInteractive) {
          // Delay showing controls for interactive elements to allow their action to complete
          setTimeout(() => {
            resetHideTimer();
          }, INTERACTIVE_DELAY);
        } else {
          // Show controls immediately for non-interactive areas
          resetHideTimer();
        }
      }
    };

    const handleClick = (e: Event) => {
      if (isMobile) {
        const mouseEvent = e as MouseEvent;
        // Don't show controls if clicking on the controls themselves
        const target = mouseEvent.target as HTMLElement;
        if (controlsContainerRef.current && controlsContainerRef.current.contains(target)) {
          return;
        }
        
        // Check if target is an interactive element
        const isInteractive = isInteractiveElement(target);
        const INTERACTIVE_DELAY = 500; // 500ms delay for interactive elements
        
        if (isInteractive) {
          // Delay showing controls for interactive elements to allow their action to complete
          setTimeout(() => {
            resetHideTimer();
          }, INTERACTIVE_DELAY);
        } else {
          // Show controls immediately for non-interactive areas
          resetHideTimer();
        }
      }
    };

    // Add event listeners
    browserWindow.addEventListener('mousemove', handleMouseMove);
    browserWindow.addEventListener('mouseleave', handleMouseLeave);
    browserWindow.addEventListener('mouseenter', handleMouseEnter);
    
    // Mobile: Add touch and click listeners
    browserWindow.addEventListener('touchstart', handleTouchStart, { passive: true });
    browserWindow.addEventListener('click', handleClick);
    
    // Window focus/blur for when user switches windows/apps
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    
    // Start initial timer (only for desktop)
    if (!isMobile) {
      resetHideTimer();
    }

    return () => {
      browserWindow.removeEventListener('mousemove', handleMouseMove);
      browserWindow.removeEventListener('mouseleave', handleMouseLeave);
      browserWindow.removeEventListener('mouseenter', handleMouseEnter);
      browserWindow.removeEventListener('touchstart', handleTouchStart);
      browserWindow.removeEventListener('click', handleClick);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [resetHideTimer, isDropdownOpen, isMobile, isInteractiveElement, shouldAutoHide]);

  return {
    controlsVisible: shouldAutoHide ? controlsVisible : true, // Always visible when auto-hide is disabled
    controlsContainerRef,
  };
}
