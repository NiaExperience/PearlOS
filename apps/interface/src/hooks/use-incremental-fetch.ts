/**
 * useIncrementalFetch - Generic hook for incremental data fetching
 * 
 * Supports streaming responses via Server-Sent Events (SSE) or standard fetch
 * for progressive UI updates. Data arrives in batches and is merged incrementally.
 * 
 * @module hooks/use-incremental-fetch
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('[use-incremental-fetch]');

/** Batch types for resource loading */
export type BatchType = 'personal' | 'work' | 'shared-to-user' | 'shared-to-all';

/** Shape of each streamed batch from the server */
export interface IncrementalBatch<T> {
  batch: BatchType;
  items: T[];
  done: boolean;
  error?: string;
}

/** Result returned by useIncrementalFetch */
export interface IncrementalFetchResult<T> {
  /** All items merged from all batches */
  items: T[];
  /** Items organized by batch type */
  batches: {
    personal: T[];
    work: T[];
    sharedToUser: T[];
    sharedToAll: T[];
  };
  /** Which batches are currently loading */
  loadingBatches: Set<BatchType>;
  /** Whether all batches have completed */
  isComplete: boolean;
  /** Overall loading state (true until complete) */
  loading: boolean;
  /** Error message if any batch failed */
  error: string | null;
  /** Partial errors by batch (allows partial success) */
  batchErrors: Map<BatchType, string>;
  /** Trigger a refresh of all data */
  refresh: () => void;
  /** Current loading phase for UI feedback */
  loadingPhase: 'idle' | 'personal' | 'work' | 'shared' | 'complete';
}

export interface UseIncrementalFetchOptions<T> {
  /** URL to fetch from (should support SSE or return batched JSON) */
  url: string;
  /** Whether fetching is enabled */
  enabled?: boolean;
  /** Function to extract unique ID from item (for deduplication) */
  getItemId: (item: T) => string;
  /** Use SSE streaming (true) or standard fetch (false) */
  useStreaming?: boolean;
  /** Callback when a batch arrives */
  onBatch?: (batch: IncrementalBatch<T>) => void;
  /** Callback when all batches complete */
  onComplete?: (items: T[]) => void;
  /** Callback on error */
  onError?: (error: string, batch?: BatchType) => void;
}

/**
 * Hook for incrementally fetching data in batches with progressive UI updates.
 * 
 * @example
 * ```tsx
 * const { items, loading, loadingPhase, batches } = useIncrementalFetch<Note>({
 *   url: '/api/notes/incremental?agent=myAgent',
 *   enabled: true,
 *   getItemId: (note) => note._id,
 *   useStreaming: true,
 * });
 * ```
 */
export function useIncrementalFetch<T>(
  options: UseIncrementalFetchOptions<T>
): IncrementalFetchResult<T> {
  const {
    url,
    enabled = false,
    getItemId,
    useStreaming = true,
    onBatch,
    onComplete,
    onError,
  } = options;

  // State
  const [items, setItems] = useState<T[]>([]);
  const [batches, setBatches] = useState<IncrementalFetchResult<T>['batches']>({
    personal: [],
    work: [],
    sharedToUser: [],
    sharedToAll: [],
  });
  const [loadingBatches, setLoadingBatches] = useState<Set<BatchType>>(new Set());
  const [isComplete, setIsComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchErrors, setBatchErrors] = useState<Map<BatchType, string>>(new Map());
  const [loadingPhase, setLoadingPhase] = useState<IncrementalFetchResult<T>['loadingPhase']>('idle');
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Refs for deduplication and cleanup
  const seenIdsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const refresh = useCallback(() => {
    setRefreshCounter((prev) => prev + 1);
  }, []);

  // Reset state helper
  const resetState = useCallback(() => {
    setItems([]);
    setBatches({ personal: [], work: [], sharedToUser: [], sharedToAll: [] });
    setLoadingBatches(new Set(['personal', 'work', 'shared-to-user', 'shared-to-all']));
    setIsComplete(false);
    setLoading(true);
    setError(null);
    setBatchErrors(new Map());
    setLoadingPhase('personal');
    seenIdsRef.current = new Set();
  }, []);

  // Process a batch and merge into state
  const processBatch = useCallback(
    (batch: IncrementalBatch<T>) => {
      log.debug('Processing batch', { batch: batch.batch, itemCount: batch.items.length, done: batch.done });

      // Handle batch error
      if (batch.error) {
        setBatchErrors((prev) => new Map(prev).set(batch.batch, batch.error!));
        onError?.(batch.error, batch.batch);
      }

      // Deduplicate and add new items
      const newItems: T[] = [];
      for (const item of batch.items) {
        const id = getItemId(item);
        if (!seenIdsRef.current.has(id)) {
          seenIdsRef.current.add(id);
          newItems.push(item);
        }
      }

      if (newItems.length > 0) {
        // Update items list
        setItems((prev) => [...prev, ...newItems]);

        // Update batch-specific list
        setBatches((prev) => {
          const key = batchTypeToKey(batch.batch);
          return {
            ...prev,
            [key]: [...prev[key], ...newItems],
          };
        });
      }

      // Update loading state
      setLoadingBatches((prev) => {
        const next = new Set(prev);
        next.delete(batch.batch);
        return next;
      });

      // Update loading phase
      if (batch.batch === 'personal') {
        setLoadingPhase('work');
      } else if (batch.batch === 'work') {
        setLoadingPhase('shared');
      }

      onBatch?.(batch);

      // Check if all done
      if (batch.done) {
        setIsComplete(true);
        setLoading(false);
        setLoadingPhase('complete');
      }
    },
    [getItemId, onBatch, onError]
  );

  // SSE streaming fetch
  const fetchWithSSE = useCallback(() => {
    log.info('Starting SSE fetch', { url });
    resetState();

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const batch: IncrementalBatch<T> = JSON.parse(event.data);
        processBatch(batch);

        if (batch.done) {
          eventSource.close();
          eventSourceRef.current = null;
        }
      } catch (err) {
        log.error('Failed to parse SSE batch', { err, data: event.data });
      }
    };

    eventSource.onerror = (err) => {
      log.error('SSE connection error', { err });
      setError('Connection error while loading data');
      setLoading(false);
      setIsComplete(true);
      setLoadingPhase('complete');
      eventSource.close();
      eventSourceRef.current = null;
      onError?.('Connection error');
    };
  }, [url, resetState, processBatch, onError]);

  // Standard fetch (fallback)
  const fetchWithStandard = useCallback(async () => {
    log.info('Starting standard fetch', { url });
    resetState();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(url, {
        signal: abortController.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Handle streamed batches format
      if (Array.isArray(data.batches)) {
        for (const batch of data.batches) {
          processBatch(batch);
        }
      } else if (data.items) {
        // Handle simple items array (legacy format)
        processBatch({
          batch: 'personal',
          items: data.items,
          done: true,
        });
      }

      setIsComplete(true);
      setLoading(false);
      setLoadingPhase('complete');
      onComplete?.(items);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        log.debug('Fetch aborted');
        return;
      }
      log.error('Fetch error', { err });
      setError(err.message || 'Failed to load data');
      setLoading(false);
      setIsComplete(true);
      setLoadingPhase('complete');
      onError?.(err.message);
    }
  }, [url, resetState, processBatch, onComplete, onError, items]);

  // Main effect
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setBatches({ personal: [], work: [], sharedToUser: [], sharedToAll: [] });
      setLoadingBatches(new Set());
      setIsComplete(false);
      setLoading(false);
      setError(null);
      setLoadingPhase('idle');
      return;
    }

    if (useStreaming) {
      fetchWithSSE();
    } else {
      fetchWithStandard();
    }

    // Cleanup
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [enabled, url, refreshCounter, useStreaming, fetchWithSSE, fetchWithStandard]);

  return {
    items,
    batches,
    loadingBatches,
    isComplete,
    loading,
    error,
    batchErrors,
    refresh,
    loadingPhase,
  };
}

// Helper to convert batch type to state key
function batchTypeToKey(batch: BatchType): keyof IncrementalFetchResult<unknown>['batches'] {
  switch (batch) {
    case 'personal':
      return 'personal';
    case 'work':
      return 'work';
    case 'shared-to-user':
      return 'sharedToUser';
    case 'shared-to-all':
      return 'sharedToAll';
  }
}

export default useIncrementalFetch;
