'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useIsMobileDevice } from '@interface/hooks/use-is-mobile-device';

export type LayoutMode = 'auto' | 'desktop' | 'mobile';

interface LayoutModeContextType {
  /** Current layout override setting */
  layoutMode: LayoutMode;
  /** Resolved value: auto uses device detection, otherwise forced */
  effectiveIsMobile: boolean;
  /** Set the layout override */
  setLayoutMode: (mode: LayoutMode) => void;
}

// Exported so useIsMobile can read it without the throwing hook
export const LayoutModeContext = createContext<LayoutModeContextType | undefined>(undefined);

export const LayoutModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>('auto');
  const deviceIsMobile = useIsMobileDevice();

  const effectiveIsMobile = useMemo(() => {
    switch (layoutMode) {
      case 'desktop':
        return false;
      case 'mobile':
        return true;
      case 'auto':
      default:
        return deviceIsMobile;
    }
  }, [layoutMode, deviceIsMobile]);

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setLayoutModeState(mode);
  }, []);

  return (
    <LayoutModeContext.Provider value={{ layoutMode, effectiveIsMobile, setLayoutMode }}>
      {children}
    </LayoutModeContext.Provider>
  );
};

export const useLayoutMode = () => {
  const context = useContext(LayoutModeContext);
  if (context === undefined) {
    throw new Error('useLayoutMode must be used within a LayoutModeProvider');
  }
  return context;
};
