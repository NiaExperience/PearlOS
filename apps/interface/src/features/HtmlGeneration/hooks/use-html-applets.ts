import { featureFlags } from '@nia/features';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getUserSharedResources } from '@interface/features/ResourceSharing/lib';
import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('[html-generation.use-html-applets]');

export interface HtmlAppletListItem {
  page_id: string;
  title: string;
  contentType: string;
  sourceNoteId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sharedVia?: any;
  ownerEmail?: string;
  ownerName?: string;
}

interface UseHtmlAppletsOptions {
  enabled?: boolean;
  currentUserId?: string;
  selectedUserId?: string;
  isAdmin?: boolean;
  agent?: string;
  tenantId?: string;
  limit?: number;
  includeSharingMetadata?: boolean;
  /** Use incremental loading (SSE streaming) for faster perceived performance */
  useIncremental?: boolean;
}

/** Loading phase for UI feedback */
export type LoadingPhase = 'idle' | 'personal' | 'shared' | 'complete';

interface UseHtmlAppletsResult {
  applets: HtmlAppletListItem[];
  setApplets: React.Dispatch<React.SetStateAction<HtmlAppletListItem[]>>;
  sharedHtmlGenIds: Set<string>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Current loading phase for progressive UI feedback */
  loadingPhase: LoadingPhase;
  /** Applets organized by batch type */
  batches: {
    personal: HtmlAppletListItem[];
    sharedToUser: HtmlAppletListItem[];
    sharedToAll: HtmlAppletListItem[];
  };
}

type BatchType = 'personal' | 'shared-to-user' | 'shared-to-all';

interface AppletBatch {
  batch: BatchType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[];
  done: boolean;
  error?: string;
}

/**
 * Convert raw API item to HtmlAppletListItem
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAppletListItem(item: any): HtmlAppletListItem | null {
  if (!item) return null;
  const pageId = (item.page_id || item._id || item.id || '').toString();
  if (!pageId) return null;
  
  return {
    page_id: pageId,
    title: item.title,
    contentType: item.contentType,
    ...(item.sourceNoteId ? { sourceNoteId: item.sourceNoteId } : {}),
    ...(item.sharedVia ? { sharedVia: item.sharedVia } : {}),
    ...(item.ownerEmail || item.sharedVia?.ownerEmail 
      ? { ownerEmail: item.ownerEmail || item.sharedVia?.ownerEmail } 
      : {}),
    ...(item.ownerName ? { ownerName: item.ownerName } : {}),
  };
}

/**
 * Shared hook for fetching HTML applets for both the Creation Engine and desktop experiences.
 *
 * Supports incremental loading via SSE for faster perceived performance:
 * - Personal applets load first
 * - Shared applets load progressively
 * - UI updates as each batch arrives
 * - Loading spinner stays active until all batches complete
 */
export function useHtmlApplets(options: UseHtmlAppletsOptions = {}): UseHtmlAppletsResult {
  const {
    enabled = false,
    currentUserId,
    selectedUserId,
    isAdmin,
    agent,
    tenantId,
    limit = 50,
    includeSharingMetadata = true,
    useIncremental = true, // Default to incremental loading
  } = options;

  const [applets, setApplets] = useState<HtmlAppletListItem[]>([]);
  const [batches, setBatches] = useState<UseHtmlAppletsResult['batches']>({
    personal: [],
    sharedToUser: [],
    sharedToAll: [],
  });
  const [sharedHtmlGenIds, setSharedHtmlGenIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  
  // Refs for deduplication and cleanup
  const seenIdsRef = useRef<Set<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    setRefreshCounter((prev) => prev + 1);
  }, []);

  const hasUserContext = useMemo(() => {
    return Boolean(currentUserId || (isAdmin && selectedUserId));
  }, [currentUserId, isAdmin, selectedUserId]);

  // Reset state helper
  const resetState = useCallback(() => {
    setApplets([]);
    setBatches({ personal: [], sharedToUser: [], sharedToAll: [] });
    setSharedHtmlGenIds(new Set());
    setLoading(true);
    setLoadingPhase('personal');
    setError(null);
    seenIdsRef.current = new Set();
  }, []);

  // Process a batch and merge into state
  const processBatch = useCallback((batch: AppletBatch) => {
    log.debug('Processing batch', { batch: batch.batch, itemCount: batch.items.length, done: batch.done });

    // Handle batch error
    if (batch.error) {
      log.warn('Batch error', { batch: batch.batch, error: batch.error });
    }

    // Convert and deduplicate items
    const newApplets: HtmlAppletListItem[] = [];
    const newSharedIds: string[] = [];

    if (Array.isArray(batch.items)) {
      for (const item of batch.items) {
        const applet = toAppletListItem(item);
        if (!applet) continue;
        
        if (!seenIdsRef.current.has(applet.page_id)) {
          seenIdsRef.current.add(applet.page_id);
          newApplets.push(applet);
          
          // Track shared IDs
          if (item.sharedVia) {
            newSharedIds.push(applet.page_id);
          }
        }
      }
    }

    if (newApplets.length > 0) {
      // Update main applets list
      setApplets((prev) => [...prev, ...newApplets]);

      // Update batch-specific list
      setBatches((prev) => {
        const key = batch.batch === 'personal' ? 'personal' 
          : batch.batch === 'shared-to-user' ? 'sharedToUser' 
          : 'sharedToAll';
        return {
          ...prev,
          [key]: [...prev[key], ...newApplets],
        };
      });

      // Update shared IDs
      if (newSharedIds.length > 0) {
        setSharedHtmlGenIds((prev) => {
          const next = new Set(prev);
          newSharedIds.forEach(id => next.add(id));
          return next;
        });
      }
    }

    // Update loading phase
    if (batch.batch === 'personal') {
      setLoadingPhase('shared');
    }

    // Check if all done
    if (batch.done) {
      setLoading(false);
      setLoadingPhase('complete');
    }
  }, []);

  // Incremental SSE fetch
  const fetchIncremental = useCallback(() => {
    resetState();

    const qp = new URLSearchParams({ limit: limit.toString(), stream: 'true' });
    if (isAdmin && selectedUserId) qp.set('userId', selectedUserId);
    else if (currentUserId) qp.set('userId', currentUserId);
    if (agent) qp.set('agent', agent);

    const url = `/api/html-generation/incremental?${qp.toString()}`;
    log.info('Starting incremental applets fetch (SSE)', { url });

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const batch: AppletBatch = JSON.parse(event.data);
        if (!batch || typeof batch !== 'object') return;
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
      log.error('SSE connection error, falling back to standard fetch', { err });
      eventSource.close();
      eventSourceRef.current = null;
      // Fallback to legacy fetch on SSE failure
      fetchLegacy();
    };
  }, [agent, currentUserId, isAdmin, limit, processBatch, resetState, selectedUserId]);

  // Legacy fetch (fallback and for non-incremental mode)
  const fetchLegacy = useCallback(async () => {
    resetState();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const qp = new URLSearchParams({ limit: limit.toString() });
      if (isAdmin && selectedUserId) qp.set('userId', selectedUserId);
      else if (currentUserId) qp.set('userId', currentUserId);
      if (agent) qp.set('agent', agent);

      const res = await fetch(`/api/get-html-content?${qp.toString()}`, {
        signal: abortController.signal,
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setLoading(false);
          setLoadingPhase('complete');
          return;
        }
        throw new Error('Failed to load applets');
      }

      const json = await res.json();
      if (json?.success) {
        const fetchedApplets: HtmlAppletListItem[] = (Array.isArray(json.data) ? json.data : [])
          .map(toAppletListItem)
          .filter((a: HtmlAppletListItem | null): a is HtmlAppletListItem => a !== null);

        // Deduplicate
        const seen = new Set<string>();
        const deduped = fetchedApplets.filter((applet) => {
          if (seen.has(applet.page_id)) return false;
          seen.add(applet.page_id);
          return true;
        });

        setApplets(deduped);
        setBatches({ personal: deduped, sharedToUser: [], sharedToAll: [] });

        // Fetch sharing metadata
        if (includeSharingMetadata && featureFlags.resourceSharing && currentUserId && tenantId) {
          try {
            const sharedResources = await getUserSharedResources(currentUserId, tenantId, 'HtmlGeneration');
            const sharedIds = new Set(
              sharedResources.filter((r) => r.memberCount > 1).map((r) => r.resourceId)
            );
            setSharedHtmlGenIds(sharedIds);
          } catch (sharingError) {
            log.error('Failed to fetch shared HTML generations', { err: sharingError });
          }
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err?.message || 'Error loading applets');
      }
    } finally {
      setLoading(false);
      setLoadingPhase('complete');
    }
  }, [agent, currentUserId, includeSharingMetadata, isAdmin, limit, resetState, selectedUserId, tenantId]);

  // Main effect
  useEffect(() => {
    if (!enabled) {
      setApplets([]);
      setBatches({ personal: [], sharedToUser: [], sharedToAll: [] });
      setSharedHtmlGenIds(new Set());
      setLoading(false);
      setLoadingPhase('idle');
      setError(null);
      return;
    }

    if (!agent) {
      setError('Missing assistant context');
      return;
    }

    if (!hasUserContext) {
      setApplets([]);
      setBatches({ personal: [], sharedToUser: [], sharedToAll: [] });
      setSharedHtmlGenIds(new Set());
      setLoading(false);
      setLoadingPhase('idle');
      setError(null);
      return;
    }

    // Use incremental fetch if enabled and SSE is supported
    if (useIncremental && typeof EventSource !== 'undefined') {
      fetchIncremental();
    } else {
      fetchLegacy();
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
  }, [
    agent,
    currentUserId,
    enabled,
    hasUserContext,
    isAdmin,
    selectedUserId,
    refreshCounter,
    useIncremental,
    fetchIncremental,
    fetchLegacy,
  ]);

  return {
    applets,
    setApplets,
    sharedHtmlGenIds,
    loading,
    error,
    refresh,
    loadingPhase,
    batches,
  };
}