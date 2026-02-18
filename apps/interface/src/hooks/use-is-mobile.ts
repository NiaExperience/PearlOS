import { useEffect, useState } from 'react';

/**
 * Detects if the device is a mobile phone using both screen width and touch capability
 * 
 * Detection criteria:
 * - Screen width <= 768px (mobile breakpoint)
 * - Touch capability present
 * - Both conditions must be true to be considered a phone
 * 
 * @returns boolean - true if device is a mobile phone, false otherwise
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      // Check screen width (mobile breakpoint)
      const isNarrowScreen = window.innerWidth <= 768;
      
      // Check touch capability
      const hasTouchCapability = 
        'ontouchstart' in window || 
        navigator.maxTouchPoints > 0;
      
      // Both conditions must be true for mobile phones
      const isMobileDevice = isNarrowScreen && hasTouchCapability;
      
      setIsMobile(isMobileDevice);
    };

    // Initial check
    checkIsMobile();

    // Listen for window resize (handles orientation changes)
    window.addEventListener('resize', checkIsMobile);

    return () => {
      window.removeEventListener('resize', checkIsMobile);
    };
  }, []);

  return isMobile;
}

