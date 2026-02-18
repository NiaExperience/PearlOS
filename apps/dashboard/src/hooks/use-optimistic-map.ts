"use client";
import { useState, useCallback } from 'react';

export interface OptimisticEntry<T> {
  current: T;
  snapshot?: T;
  pending?: boolean;
}

export function useOptimisticMap<T extends Record<string, any>>(initial?: Record<string, T>) {
  const [map, setMap] = useState<Record<string, OptimisticEntry<T>>>({
    ...(initial ? Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, { current: v }])) : {})
  });

  const apply = useCallback((id: string, draft: Partial<T>) => {
    setMap(m => {
      const prev = m[id];
      if (!prev) {
        const base: T = { ...(draft as any) };
        return { ...m, [id]: { current: base, snapshot: base, pending: true } };
      }
      const snapshot = prev.snapshot ?? prev.current;
      return {
        ...m,
        [id]: {
          current: { ...prev.current, ...draft },
          snapshot,
          pending: true
        }
      };
    });
  }, []);

  const commit = useCallback((id: string, finalize?: Partial<T>) => {
    setMap(m => {
      const prev = m[id];
      if (!prev) return m;
      return {
        ...m,
        [id]: {
          current: { ...prev.current, ...finalize },
          pending: false
        }
      };
    });
  }, []);

  const revert = useCallback((id: string) => {
    setMap(m => {
      const prev = m[id];
      if (!prev) return m;
      if (!prev.snapshot) return { ...m, [id]: { ...prev, pending: false } };
      return {
        ...m,
        [id]: {
          current: prev.snapshot,
          pending: false
        }
      };
    });
  }, []);

  const setField = useCallback(<K extends keyof T>(id: string, field: K, value: T[K]) => {
    setMap(m => {
      const prev = m[id] ?? { current: {} as T };
      return { ...m, [id]: { ...prev, current: { ...prev.current, [field]: value } } };
    });
  }, []);

  return { state: map, apply, commit, revert, setField };
}
