'use client';

import { useEffect } from 'react';

/**
 * Component that disables keyboard tab navigation globally.
 * Prevents the Tab key from cycling through focusable elements.
 */
export function DisableTabNavigation() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent Tab and Shift+Tab from working
      if (e.key === 'Tab') {
        const target = e.target;
        if (
          target instanceof Element &&
          target.closest('[data-pearl-terminal="true"], [data-pearl-terminal-input="true"]')
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Add event listener to window
    window.addEventListener('keydown', handleKeyDown, true); // Use capture phase to catch early

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  return null; // This component doesn't render anything
}
