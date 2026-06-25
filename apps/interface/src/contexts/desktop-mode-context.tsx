"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { DesktopMode } from "@interface/types/desktop-modes";

interface DesktopModeContextValue {
  currentMode: DesktopMode;
  setMode: (mode: DesktopMode) => void;
}

const DesktopModeContext = createContext<DesktopModeContextValue>({
  currentMode: DesktopMode.HOME,
  setMode: () => {},
});

export const useDesktopMode = () => useContext(DesktopModeContext);

interface DesktopModeProviderProps {
  initialMode: DesktopMode;
  children: React.ReactNode;
}

export const DesktopModeProvider: React.FC<DesktopModeProviderProps> = ({
  initialMode,
  children,
}) => {
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

export default DesktopModeContext;
