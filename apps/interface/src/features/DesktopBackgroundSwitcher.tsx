/**
 * DesktopBackgroundSwitcher.tsx
 * 
 * React component that listens for DESKTOP_MODE_SWITCH events and manages
 * the interface mode (desktop, mobile, tablet) accordingly.
 * 
 * This component:
 * 1. Listens for window.dispatchEvent('nia:desktop.mode.switch')
 * 2. Updates internal mode state
 * 3. Applies CSS classes to force layout mode
 * 4. Persists preference to localStorage
 */

import React, { useEffect, useState, useCallback } from 'react';
import { NIA_EVENT_DESKTOP_MODE_SWITCH } from './DailyCall/events/niaEventRouter';

type InterfaceMode = 'desktop' | 'mobile' | 'tablet';

interface DesktopBackgroundSwitcherProps {
  children?: React.ReactNode;
  onModeChange?: (mode: InterfaceMode) => void;
}

/**
 * Helper to validate mode value
 */
function isValidDesktopMode(mode: any): mode is InterfaceMode {
  return ['desktop', 'mobile', 'tablet'].includes(mode);
}

/**
 * Helper to get default mode based on viewport
 */
function getDefaultMode(): InterfaceMode {
  if (typeof window === 'undefined') return 'desktop';
  
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

/**
 * Apply CSS classes to document for mode-specific styling
 */
function applyModeClasses(mode: InterfaceMode): void {
  if (typeof document === 'undefined') return;

  // Remove old classes
  document.documentElement.classList.remove(
    'interface-mode-desktop',
    'interface-mode-mobile',
    'interface-mode-tablet'
  );

  // Add new class
  document.documentElement.classList.add(`interface-mode-${mode}`);

  // Also add to body if available
  if (document.body) {
    document.body.classList.remove(
      'interface-mode-desktop',
      'interface-mode-mobile',
      'interface-mode-tablet'
    );
    document.body.classList.add(`interface-mode-${mode}`);
  }

  console.debug(`[DesktopBackgroundSwitcher] Applied CSS class: interface-mode-${mode}`);
}

/**
 * DesktopBackgroundSwitcher Component
 * 
 * Provides a context wrapper that manages interface mode switching.
 * Components inside this tree can listen to mode changes via the event.
 */
export const DesktopBackgroundSwitcher: React.FC<DesktopBackgroundSwitcherProps> = ({
  children,
  onModeChange,
}) => {
  const [mode, setModeState] = useState<InterfaceMode>(() => {
    // Try to load saved preference from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pearl_interface_mode');
      if (saved && isValidDesktopMode(saved)) {
        console.debug(`[DesktopBackgroundSwitcher] Loaded saved mode from localStorage: ${saved}`);
        return saved;
      }
    }
    
    // Fall back to default based on viewport
    const defaultMode = getDefaultMode();
    console.debug(`[DesktopBackgroundSwitcher] Using default mode: ${defaultMode}`);
    return defaultMode;
  });

  const [isOverridden, setIsOverridden] = useState(false);

  /**
   * Set mode and persist preference
   */
  const setMode = useCallback((newMode: InterfaceMode) => {
    if (!isValidDesktopMode(newMode)) {
      console.warn(`[DesktopBackgroundSwitcher] Invalid mode: ${newMode}`);
      return;
    }

    console.info(`[DesktopBackgroundSwitcher] Switching to mode: ${newMode}`);
    
    setModeState(newMode);
    setIsOverridden(true);

    // Persist to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('pearl_interface_mode', newMode);
    }

    // Apply CSS classes
    applyModeClasses(newMode);

    // Call callback if provided
    if (onModeChange) {
      onModeChange(newMode);
    }
  }, [onModeChange]);

  /**
   * Listen for desktop mode switch events from the backend
   */
  useEffect(() => {
    const handleDesktopModeSwitch = (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: string; timestamp?: number }>;
      const { mode: newMode } = customEvent.detail;

      if (!newMode) {
        console.warn('[DesktopBackgroundSwitcher] Mode switch event missing mode in detail');
        return;
      }

      console.debug('[DesktopBackgroundSwitcher] Mode switch event received:', newMode);
      setMode(newMode as InterfaceMode);
    };

    // Register listener
    window.addEventListener(
      NIA_EVENT_DESKTOP_MODE_SWITCH,
      handleDesktopModeSwitch as EventListener
    );

    console.debug(`[DesktopBackgroundSwitcher] Event listener registered for: ${NIA_EVENT_DESKTOP_MODE_SWITCH}`);

    // Apply initial mode classes
    applyModeClasses(mode);

    // Cleanup
    return () => {
      window.removeEventListener(
        NIA_EVENT_DESKTOP_MODE_SWITCH,
        handleDesktopModeSwitch as EventListener
      );
      console.debug(`[DesktopBackgroundSwitcher] Event listener unregistered`);
    };
  }, [mode, setMode]);

  /**
   * Handle window resize to update mode if not overridden
   */
  useEffect(() => {
    if (isOverridden || typeof window === 'undefined') return;

    const handleResize = () => {
      const newDefaultMode = getDefaultMode();
      if (newDefaultMode !== mode) {
        console.debug(`[DesktopBackgroundSwitcher] Viewport changed, updating to: ${newDefaultMode}`);
        setModeState(newDefaultMode);
        applyModeClasses(newDefaultMode);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mode, isOverridden]);

  return (
    <div className={`desktop-background-switcher interface-mode-${mode}`}>
      {children}
    </div>
  );
};

/**
 * Hook to access current interface mode in child components
 */
export function useInterfaceMode(): InterfaceMode {
  const [mode, setMode] = useState<InterfaceMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pearl_interface_mode');
      if (saved && isValidDesktopMode(saved)) {
        return saved;
      }
    }
    return getDefaultMode();
  });

  useEffect(() => {
    const handleModeChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: string }>;
      const { mode: newMode } = customEvent.detail;
      if (newMode && isValidDesktopMode(newMode)) {
        setMode(newMode);
      }
    };

    window.addEventListener(
      NIA_EVENT_DESKTOP_MODE_SWITCH,
      handleModeChange as EventListener
    );

    return () => {
      window.removeEventListener(
        NIA_EVENT_DESKTOP_MODE_SWITCH,
        handleModeChange as EventListener
      );
    };
  }, []);

  return mode;
}

/**
 * Hook to detect if device is in mobile viewport (physical width < 768px)
 */
export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

/**
 * Hook to check if mode is currently overridden
 */
export function useModeIsOverridden(): boolean {
  const [isOverridden, setIsOverridden] = useState(() => {
    if (typeof window === 'undefined') return false;
    
    // If a saved preference exists, mode is considered overridden
    return localStorage.getItem('pearl_interface_mode') !== null;
  });

  useEffect(() => {
    const handleModeChange = () => {
      setIsOverridden(true);
    };

    window.addEventListener(
      NIA_EVENT_DESKTOP_MODE_SWITCH,
      handleModeChange as EventListener
    );

    return () => {
      window.removeEventListener(
        NIA_EVENT_DESKTOP_MODE_SWITCH,
        handleModeChange as EventListener
      );
    };
  }, []);

  return isOverridden;
}

export default DesktopBackgroundSwitcher;
