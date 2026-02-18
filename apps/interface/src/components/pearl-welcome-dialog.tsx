'use client';

import * as React from 'react';

import { useUserProfileOptional } from '@interface/contexts/user-profile-context';
import { getClientLogger } from '@interface/lib/client-logger';

const DISMISS_EVENT_NAME = 'pearl-welcome-dismiss';
const logger = getClientLogger('[pearl_welcome_dialog]');

export default function PearlWelcomeDialog() {
  const profile = useUserProfileOptional();
  const [visible, setVisible] = React.useState(false);
  const hasDismissedRef = React.useRef(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  // Keep a ref to the latest profile to avoid stale closure issues
  const profileRef = React.useRef(profile);
  
  // Update the ref whenever profile changes
  React.useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Show overlay only if profile is loaded and overlay has NOT been dismissed
  React.useEffect(() => {
    // Wait until profile finishes loading
    if (profile?.loading) return;
    
    // If user has previously dismissed the overlay, don't show it
    if (profile?.overlayDismissed) {
      setVisible(false);
      return;
    }

    // Show the welcome dialog for users who haven't dismissed it
    setVisible(true);
  }, [profile?.loading, profile?.overlayDismissed]);

  // Handle dismiss event and persist to backend
  React.useEffect(() => {
    const handleDismiss = () => {
      logger.info('Dismiss event received', { 
        hasDismissedRef: hasDismissedRef.current,
        hasProfile: !!profileRef.current,
        hasDismissOverlay: !!profileRef.current?.dismissOverlay,
        profileLoading: profileRef.current?.loading
      });
      setVisible(false);
      
      // Persist dismissal to backend (only once per mount)
      // Use ref to get latest profile and avoid stale closure
      const currentProfile = profileRef.current;
      if (!hasDismissedRef.current && currentProfile?.dismissOverlay) {
        hasDismissedRef.current = true;
        logger.info('Calling dismissOverlay');
        currentProfile.dismissOverlay();
      } else {
        logger.warn('Cannot dismiss overlay', {
          hasDismissedRef: hasDismissedRef.current,
          hasProfile: !!currentProfile,
          hasDismissOverlay: !!currentProfile?.dismissOverlay
        });
      }
    };

    window.addEventListener(DISMISS_EVENT_NAME, handleDismiss);
    return () => {
      window.removeEventListener(DISMISS_EVENT_NAME, handleDismiss);
    };
  }, []); // Empty deps since we use ref for profile

  // Set data attribute on body to signal welcome dialog visibility
  React.useEffect(() => {
    if (visible) {
      document.body.setAttribute('data-pearl-welcome-visible', 'true');
    } else {
      document.body.removeAttribute('data-pearl-welcome-visible');
    }
    return () => {
      document.body.removeAttribute('data-pearl-welcome-visible');
    };
  }, [visible]);

  // Global click listener to dismiss on any interactive element click
  React.useEffect(() => {
    if (!visible) return;

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Check if click is inside the dialog
      if (dialogRef.current?.contains(target)) {
        return;
      }

      // Check if the clicked element is interactive
      // Check for semantic interactive elements
      const isSemanticInteractive = 
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'LABEL';
      
      // Check for ARIA interactive roles
      const role = target.getAttribute('role');
      const isAriaInteractive = 
        role === 'button' ||
        role === 'link' ||
        role === 'tab' ||
        role === 'menuitem' ||
        role === 'option';
      
      // Check if element has tabindex (indicating it's focusable/interactive)
      const hasTabIndex = target.getAttribute('tabindex') !== null;
      
      // Check if element is inside an interactive container
      const isInsideInteractive = target.closest('button, a, [role="button"], [role="link"], [role="tab"], [tabindex]') !== null;
      
      const isInteractive = isSemanticInteractive || isAriaInteractive || hasTabIndex || isInsideInteractive;

      if (isInteractive) {
        logger.info('Interactive element clicked outside dialog, dismissing welcome dialog', {
          tagName: target.tagName,
          role: target.getAttribute('role'),
        });
        window.dispatchEvent(new Event(DISMISS_EVENT_NAME));
      }
    };

    // Use capture phase to catch clicks before they bubble
    document.addEventListener('click', handleGlobalClick, true);
    return () => {
      document.removeEventListener('click', handleGlobalClick, true);
    };
  }, [visible]);

  const handleBackdropClick = React.useCallback(() => {
    logger.info('Backdrop clicked, dismissing welcome dialog');
    window.dispatchEvent(new Event(DISMISS_EVENT_NAME));
  }, []);

  const handleDialogClick = React.useCallback((e: React.MouseEvent) => {
    // Prevent clicks on the dialog from propagating to the backdrop
    e.stopPropagation();
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="pointer-events-none">
      <div 
        className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8 pointer-events-auto"
        onClick={handleBackdropClick}
      >
        <div 
          ref={dialogRef}
          className="pointer-events-auto relative flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-white/15 bg-blue p-6 text-center text-white shadow-[0_24px_80px_rgba(59,130,246,0.4)] backdrop-blur-xl sm:max-w-lg sm:p-8"
          onClick={handleDialogClick}
        >
          <div className="space-y-3 sm:space-y-4">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome to PearlOS</h1>
            <p className="text-sm text-white/70 sm:text-base">The human-first intelligent platform.</p>
          </div>

        <div className="mt-0.5 space-y-0.5 text-[10px] uppercase tracking-[0.05em] text-emerald-200/80 sm:space-y-1 sm:text-[12px]">
          <p className="text-[13px] leading-[1.15] sm:text-[14px]">Early Access</p>
          <p className="text-[11px] leading-[1.1] normal-case text-white/60 sm:text-[12px]">
            Bugs may appear. Please don&apos;t feed them.
          </p>
          <p className="text-[11px] leading-[1.1] normal-case text-white/60 sm:text-[12px]">
            They get confident.
          </p>
        </div>

          <div className="space-y-4 text-white sm:space-y-5">
            <p className="text-sm font-medium sm:text-lg">
            To begin: click Pearl below
            </p>
          </div>

          <div className="pointer-events-none absolute left-1/2 top-full h-24 w-[2px] -translate-x-1/2 bg-gradient-to-b from-emerald-300/60 via-emerald-300/10 to-transparent" aria-hidden />
        </div>
      </div>
    </div>
  );
}

