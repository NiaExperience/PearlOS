'use client';

import React, { useState, useEffect } from 'react';

import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';

interface GlobalHtmlGenerationStatusProps {
  className?: string;
}

const GOHUFONT_FONT_FACE = `
@font-face {
  font-family: 'Gohufont';
  src: url('/fonts/Gohu/GohuFontuni14NerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

const ensureGohufont = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gohufont-font-face')) return;
  const style = document.createElement('style');
  style.id = 'gohufont-font-face';
  style.textContent = GOHUFONT_FONT_FACE;
  document.head.appendChild(style);
};

const log = getClientLogger('[html-generation.global-status]');

const fetchActiveJobs = async (): Promise<Array<{ callId: string }> | null> => {
  try {
    const res = await fetch('/api/html-generation/status', { method: 'GET' });
    if (!res.ok) return null;
    const json = await res.json();
    const jobs = json?.data?.activeJobs;
    return Array.isArray(jobs) ? jobs : [];
  } catch (err) {
    log.warn('Failed to recover active generation jobs from server', { err });
    return null;
  }
};

const mergeRecoveredJobs = (jobs: Array<{ callId: string }>) => {
  const merged = new Set<string>();
  jobs.forEach(job => {
    if (job?.callId) {
      merged.add(job.callId);
      try {
        localStorage.setItem(`nia_pending_job_${job.callId}`, job.callId);
      } catch (err) {
        log.warn('Failed to persist recovered job to localStorage', { err, callId: job.callId });
      }
    }
  });
  return merged;
};

const GenerationBadge = ({ className }: { className: string }) => (
  <div className={`fixed top-16 right-4 z-50 ${className}`} style={{ fontFamily: 'Gohufont, monospace' }}>
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white shadow-2xl backdrop-blur-md border border-blue-300/30 transition-all duration-300 hover:shadow-blue-500/25 hover:scale-105">
      <div className="relative flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white/80 border-r-white/60 rounded-full animate-spin" 
             style={{ animationDuration: '2s' }}></div>
        <div className="absolute inset-0.5 w-4 h-4 border border-white/30 border-b-white/90 border-l-white/70 rounded-full animate-spin" 
             style={{ animationDuration: '1.5s', animationDirection: 'reverse' }}></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse shadow-lg shadow-white/50" 
               style={{ animationDuration: '1s' }}></div>
        </div>
        <div className="absolute inset-0 w-5 h-5 rounded-full bg-white/10 animate-ping" 
             style={{ animationDuration: '3s' }}></div>
      </div>
      <div className="flex flex-col space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold tracking-wide">Generating App</span>
          <div className="flex items-center space-x-0.5">
            <div className="w-0.5 h-3 bg-white/80 rounded-full animate-pulse" 
                 style={{ animationDelay: '0ms', animationDuration: '1.2s' }}></div>
          </div>
        </div>
        <span className="text-xs text-blue-100/90 font-medium">Crafting your application...</span>
      </div>
      <div className="flex items-center space-x-1 ml-1">
        <div className="w-1.5 h-1.5 bg-white rounded-full shadow-sm animate-bounce" 
             style={{ animationDelay: '0ms', animationDuration: '1.4s' }}></div>
        <div className="w-1.5 h-1.5 bg-white/90 rounded-full shadow-sm animate-bounce" 
             style={{ animationDelay: '200ms', animationDuration: '1.4s' }}></div>
        <div className="w-1.5 h-1.5 bg-white/80 rounded-full shadow-sm animate-bounce" 
             style={{ animationDelay: '400ms', animationDuration: '1.4s' }}></div>
      </div>
    </div>
    <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br from-blue-400/20 to-indigo-500/20 blur-xl scale-110 animate-pulse" 
         style={{ animationDuration: '2.5s' }}></div>
  </div>
);

// Global state management for HTML generation calls
let globalActiveGenerationCalls = new Set<string>();
const globalStateListeners = new Set<(calls: Set<string>) => void>();
const STORAGE_KEY = 'nia_active_html_generations';

const persistActiveGenerationCalls = () => {
  if (typeof window === 'undefined') return;
  try {
    if (globalActiveGenerationCalls.size === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(globalActiveGenerationCalls)));
    }
  } catch (e) {
    log.warn('Failed to save generation state to localStorage', { err: e });
  }
};

const removePendingJobStorage = (callIds: Iterable<string>) => {
  if (typeof window === 'undefined') return;
  for (const callId of callIds) {
    try {
      localStorage.removeItem(`nia_pending_job_${callId}`);
    } catch (err) {
      log.warn('Failed to remove stale pending job from localStorage', { err, callId });
    }
  }
};

const publishActiveGenerationCalls = () => {
  globalStateListeners.forEach(listener => listener(globalActiveGenerationCalls));
};

const replaceActiveGenerationCalls = (calls: Set<string>) => {
  const previous = globalActiveGenerationCalls;
  const removed = [...previous].filter(callId => !calls.has(callId));
  globalActiveGenerationCalls = new Set(calls);
  removePendingJobStorage(removed);
  persistActiveGenerationCalls();
  publishActiveGenerationCalls();
};

const sameCallSet = (left: Set<string>, right: Set<string>) => {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
};

export const addActiveGenerationCall = (callId: string) => {
  globalActiveGenerationCalls = new Set([...globalActiveGenerationCalls, callId]);
  persistActiveGenerationCalls();
  publishActiveGenerationCalls();
};

export const removeActiveGenerationCall = (callId: string) => {
  globalActiveGenerationCalls = new Set([...globalActiveGenerationCalls].filter(id => id !== callId));
  removePendingJobStorage([callId]);
  persistActiveGenerationCalls();
  publishActiveGenerationCalls();
};

export const useGlobalHtmlGenerationState = (options: { enabled?: boolean } = {}) => {
  const enabled = options.enabled ?? true;
  const [activeCalls, setActiveCalls] = useState(globalActiveGenerationCalls);
  
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!enabled) {
      return;
    }

    const hydrateFromLocal = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        const ids = JSON.parse(stored);
        if (!Array.isArray(ids) || ids.length === 0) return;
        const merged = new Set([...globalActiveGenerationCalls, ...ids]);
        if (merged.size !== globalActiveGenerationCalls.size) {
          globalActiveGenerationCalls = merged;
          setActiveCalls(new Set(merged));
        }
      } catch (e) {
        log.error('Failed to hydrate generation state', { err: e });
      }
    };

    const recoverFromServer = async () => {
      const jobs = await fetchActiveJobs();
      if (jobs === null) return;
      if (jobs.length === 0) {
        if (globalActiveGenerationCalls.size > 0) {
          replaceActiveGenerationCalls(new Set());
          setActiveCalls(new Set());
        }
        return;
      }
      const recovered = mergeRecoveredJobs(jobs);
      if (!sameCallSet(recovered, globalActiveGenerationCalls)) {
        replaceActiveGenerationCalls(recovered);
        setActiveCalls(new Set(recovered));
      }
    };

    hydrateFromLocal();
    void recoverFromServer();

    const listener = (calls: Set<string>) => setActiveCalls(new Set(calls));
    globalStateListeners.add(listener);
    
    return () => {
      globalStateListeners.delete(listener);
    };
  }, [enabled]);
  
  return { activeCalls, addActiveGenerationCall, removeActiveGenerationCall };
};

export const GlobalHtmlGenerationStatus: React.FC<GlobalHtmlGenerationStatusProps> = ({ 
  className = '' 
}) => {
  const { status } = useResilientSession();
  const { activeCalls } = useGlobalHtmlGenerationState({ enabled: status === 'authenticated' });
  
  useEffect(() => {
    ensureGohufont();
  }, []);
  
  if (activeCalls.size === 0) {
    return null;
  }

  return <GenerationBadge className={className} />;
};
