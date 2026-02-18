'use client';

import {
  DEFAULT_GLOBAL_SETTINGS,
  GlobalSettings,
  InterfaceLoginSettings,
  resolveGlobalSettings,
  resolveInterfaceLoginSettings,
} from '@nia/features';
import React, { createContext, useContext, useMemo } from 'react';

interface GlobalSettingsContextValue {
  globalSettings: GlobalSettings;
  interfaceLogin: InterfaceLoginSettings;
}

const GlobalSettingsContext = createContext<GlobalSettingsContextValue>({
  globalSettings: DEFAULT_GLOBAL_SETTINGS,
  interfaceLogin: DEFAULT_GLOBAL_SETTINGS.interfaceLogin,
});

interface GlobalSettingsProviderProps {
  value?: Partial<GlobalSettings> | null;
  children: React.ReactNode;
}

export function GlobalSettingsProvider({ value, children }: GlobalSettingsProviderProps) {
  const resolved = useMemo(() => resolveGlobalSettings(value ?? undefined), [value]);
  const contextValue = useMemo<GlobalSettingsContextValue>(() => ({
    globalSettings: resolved,
    interfaceLogin: resolveInterfaceLoginSettings(resolved),
  }), [resolved]);

  return (
    <GlobalSettingsContext.Provider value={contextValue}>
      {children}
    </GlobalSettingsContext.Provider>
  );
}

export function useGlobalSettings(): GlobalSettingsContextValue {
  return useContext(GlobalSettingsContext);
}
