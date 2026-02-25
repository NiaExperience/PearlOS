'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { DesktopMode } from '../types/desktop-modes';

// --- Launch Mode Preference ---
// Stored in localStorage as 'pearlos-launch-mode-preference'
// Values: 'auto' (default) | 'home' | 'work'
// When 'auto': remembers last mode used (stored as 'pearlos-last-desktop-mode')
// When 'home'/'work': always launches into that mode

const LAUNCH_PREF_KEY = 'pearlos-launch-mode-preference';
const LAST_MODE_KEY = 'pearlos-last-desktop-mode';

export type LaunchModePreference = 'auto' | 'home' | 'work';

function getStoredLaunchPreference(): LaunchModePreference {
  if (typeof window === 'undefined') return 'auto';
  const val = localStorage.getItem(LAUNCH_PREF_KEY);
  if (val === 'home' || val === 'work' || val === 'auto') return val;
  return 'auto';
}

function getStoredLastMode(): DesktopMode | null {
  if (typeof window === 'undefined') return null;
  const val = localStorage.getItem(LAST_MODE_KEY);
  if (val && Object.values(DesktopMode).includes(val as DesktopMode)) {
    return val as DesktopMode;
  }
  return null;
}

function resolveInitialMode(fallback: DesktopMode): DesktopMode {
  const pref = getStoredLaunchPreference();
  switch (pref) {
    case 'home':
      return DesktopMode.HOME;
    case 'work':
      return DesktopMode.WORK;
    case 'auto':
    default:
      return getStoredLastMode() || fallback;
  }
}

interface DesktopModeContextType {
  currentMode: DesktopMode;
  setMode: (mode: DesktopMode) => void;
  launchPreference: LaunchModePreference;
  setLaunchPreference: (pref: LaunchModePreference) => void;
}

const DesktopModeContext = createContext<DesktopModeContextType | undefined>(undefined);

export const DesktopModeProvider: React.FC<{ 
  initialMode?: DesktopMode; 
  children: React.ReactNode 
}> = ({ initialMode = DesktopMode.HOME, children }) => {
  const [currentMode, setCurrentMode] = useState<DesktopMode>(() => resolveInitialMode(initialMode));
  const [launchPreference, setLaunchPrefState] = useState<LaunchModePreference>(() => getStoredLaunchPreference());

  const setMode = useCallback((mode: DesktopMode) => {
    console.log(`[DesktopModeContext] setMode called: ${mode}`);
    setCurrentMode(mode);
    // Persist last mode for auto-restore
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAST_MODE_KEY, mode);
    }
  }, []);

  const setLaunchPreference = useCallback((pref: LaunchModePreference) => {
    setLaunchPrefState(pref);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAUNCH_PREF_KEY, pref);
    }
  }, []);

  return (
    <DesktopModeContext.Provider value={{ currentMode, setMode, launchPreference, setLaunchPreference }}>
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
