// Lightweight DailyCall state bridge (pre-event-bus)
// Will be superseded by unified event bus after merging staging-pipecat-events.

import React, { createContext, useCallback, useContext, useState } from 'react';

export interface DailyCallSessionState {
  joined: boolean;
  username: string;
  roomUrl?: string;
  lastJoinTs?: number;
  lastLeaveTs?: number;
}

interface DailyCallStateContextValue extends DailyCallSessionState {
  setJoined: (username: string, roomUrl: string) => void;
  setLeft: () => void;
}

const DailyCallStateContext = createContext<DailyCallStateContextValue | undefined>(undefined);

export const DailyCallStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<DailyCallSessionState>({ joined: false, username: '' });

  const setJoined = useCallback((username: string, roomUrl: string) => {
    setState(prev => ({ joined: true, username, roomUrl, lastJoinTs: Date.now(), lastLeaveTs: prev.lastLeaveTs }));
  }, []);

  const setLeft = useCallback(() => {
    setState(prev => ({ joined: false, username: '', roomUrl: prev.roomUrl, lastJoinTs: prev.lastJoinTs, lastLeaveTs: Date.now() }));
  }, []);

  return (
    <DailyCallStateContext.Provider value={{ ...state, setJoined, setLeft }}>
      {children}
    </DailyCallStateContext.Provider>
  );
};

export function useDailyCallState() {
  const ctx = useContext(DailyCallStateContext);
  if (!ctx) throw new Error('useDailyCallState must be used within DailyCallStateProvider');
  return ctx;
}

// Placeholder to be replaced with event bus subscription logic
export function applyDailyCallEventBridge() {
  // no-op
}

// cache-bust: removed legacy store.ts (JSX in .ts) – ensure consumers compile this .tsx version
