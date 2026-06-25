/**
 * MainLayout.tsx
 * 
 * Root layout component that wraps the entire application.
 * Integrates DesktopBackgroundSwitcher to enable mode switching throughout the app.
 */

import React, { useEffect } from 'react';
import DesktopBackgroundSwitcher, { useInterfaceMode, useIsMobileViewport } from '../features/DesktopBackgroundSwitcher';
import { initializeNiaEventRouter } from '../features/DailyCall/events/niaEventRouter';
import { ActiveJobsWidgetGate } from '../features/ActiveJobs/components/ActiveJobsWidgetGate';
import { WindowManagerProvider } from '../features/ManeuverableWindow';
import { OpenClawEventBridge, OpenClawResponse } from '../features/OpenClawBridge';
import DesktopIconGrid from './DesktopIconGrid';
import ChatMode from '../features/ChatMode/components/ChatMode';
import { SpeechDebug } from './speech-debug';
import '../styles/interfaceMode.css';

interface MainLayoutProps {
  children: React.ReactNode;
}

/**
 * Internal layout content - uses hooks that depend on DesktopBackgroundSwitcher context
 */
const MainLayoutContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mode = useInterfaceMode();
  const isMobileViewport = useIsMobileViewport();

  // Log current state for debugging
  useEffect(() => {
    console.debug('[MainLayout] Current mode:', mode, 'Physical viewport mobile:', isMobileViewport);
  }, [mode, isMobileViewport]);

  // iOS Safari: scroll down then back up on mount to collapse the URL bar,
  // gaining ~50px vertical screen real estate.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    // Ensure body is tall enough to allow scrolling
    const originalMinHeight = document.body.style.minHeight;
    document.body.style.minHeight = `${window.innerHeight + 50}px`;

    // Delay to ensure layout has settled, then scroll down to trigger chrome hide
    const scrollTimer = setTimeout(() => {
      window.scrollTo({ top: 40, behavior: 'instant' as ScrollBehavior });

      // Scroll back to top after Safari collapses the URL bar
      const returnTimer = setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        document.body.style.minHeight = originalMinHeight;
      }, 150);

      // Store for cleanup
      (window as any).__pearlReturnTimer = returnTimer;
    }, 300);

    return () => {
      clearTimeout(scrollTimer);
      clearTimeout((window as any).__pearlReturnTimer);
      document.body.style.minHeight = originalMinHeight;
    };
  }, []);

  return (
    <div className={`app-shell interface-mode-${mode}`} data-mode={mode}>
      {children}

      {/* Desktop icon grid — app launchers */}
      <DesktopIconGrid />

      {/* Chat bar with Pearl avatar + text input */}
      <ChatMode />

      {/* Active Jobs Widget - Fixed position bottom-right, flush with edge */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 10,
          zIndex: 40,
          pointerEvents: 'none', // Let clicks pass through empty space
        }}
      >
        <div style={{ pointerEvents: 'auto' }}>
          <ActiveJobsWidgetGate />
        </div>
      </div>

      {/* OpenClaw bridge: headless listener for bot-triggered tasks + streamed responses overlay */}
      <OpenClawEventBridge />
      <div
        style={{
          position: 'fixed',
          bottom: 80,
          right: 10,
          maxWidth: 420,
          zIndex: 45,
          pointerEvents: 'none',
        }}
      >
        <div style={{ pointerEvents: 'auto' }}>
          <OpenClawResponse />
        </div>
      </div>

      {/* Voice debugging overlay (development only) */}
      <SpeechDebug />
    </div>
  );
};

/**
 * MainLayout Component
 * 
 * Provides:
 * - Event routing initialization
 * - DesktopBackgroundSwitcher context
 * - Global mode management
 * - CSS class application
 */
export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  // Initialize event router on mount
  useEffect(() => {
    initializeNiaEventRouter();
    console.info('[MainLayout] Event router initialized');

    // Set initial interface mode class
    const saved = typeof window !== 'undefined' ? localStorage.getItem('pearl_interface_mode') : null;
    if (saved && ['desktop', 'mobile', 'tablet'].includes(saved)) {
      document.documentElement.classList.add(`interface-mode-${saved}`);
    }

    return () => {
      // Cleanup if needed
    };
  }, []);

  return (
    <DesktopBackgroundSwitcher
      onModeChange={(newMode) => {
        console.info('[MainLayout] Mode changed:', newMode);
      }}
    >
      <WindowManagerProvider>
        <MainLayoutContent>{children}</MainLayoutContent>
      </WindowManagerProvider>
    </DesktopBackgroundSwitcher>
  );
};

/**
 * Export hooks for use in components
 */
export { useInterfaceMode, useIsMobileViewport } from '../features/DesktopBackgroundSwitcher';

export default MainLayout;
