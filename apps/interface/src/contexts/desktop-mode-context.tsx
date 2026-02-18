'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { DesktopMode } from '../types/desktop-modes';

interface DesktopModeContextType {
  currentMode: DesktopMode;
  setMode: (mode: DesktopMode) => void;
}

const DesktopModeContext = createContext<DesktopModeContextType | undefined>(undefined);

export const DesktopModeProvider: React.FC<{ 
  initialMode?: DesktopMode; 
  children: React.ReactNode 
}> = ({ initialMode = DesktopMode.WORK, children }) => {
  const [currentMode, setCurrentMode] = useState<DesktopMode>(initialMode);

  const setMode = useCallback((mode: DesktopMode) => {
    setCurrentMode(mode);
  }, []);

  return (
    <DesktopModeContext.Provider value={{ currentMode, setMode }}>
      {children}
    </DesktopModeContext.Provider>
  );
};

export const useDesktopMode = () => {
  const context = useContext(DesktopModeContext);
  if (context === undefined) {
    throw new Error('useDesktopMode must be used within a DesktopModeProvider');
  }
  return context;
};
