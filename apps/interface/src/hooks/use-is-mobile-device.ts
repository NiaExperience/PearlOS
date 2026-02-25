import { useEffect, useState } from 'react';

/**
 * Raw device detection — detects if the physical device is mobile.
 * Used internally by LayoutModeProvider. Most consumers should use useIsMobile() instead,
 * which respects the layout override context.
 */
export function useIsMobileDevice(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      const isNarrowScreen = window.innerWidth <= 768;
      const hasTouchCapability =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0;
      setIsMobile(isNarrowScreen && hasTouchCapability);
    };

    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  return isMobile;
}
