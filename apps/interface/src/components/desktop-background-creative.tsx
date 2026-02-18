'use client';

import { featureFlags } from '@nia/features';
import { RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { NIA_EVENT_APPLET_REFRESH } from '@interface/features/DailyCall/events/niaEventRouter';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import { SharedIndicator } from '@interface/features/ResourceSharing/components';
import { getUserSharedResources } from '@interface/features/ResourceSharing/lib';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { useToast } from '@interface/hooks/use-toast';
import { trackSessionHistory } from '@interface/lib/session-history';
import { getClientLogger } from '@interface/lib/client-logger';
import { cn } from '@interface/lib/utils';

import { DeleteAppletModal } from './delete-applet-modal';

interface DesktopBackgroundCreativeProps {
  assistantName?: string;
}

const CACHE_TTL_MS = 30_000;

type CachedApplets = {
  data: Array<{ page_id: string; title: string; contentType: string; sourceNoteId?: string; sharedVia?: any }>;
  cachedAt: number;
};

const cacheKeyForUser = (userId: string | undefined, assistantName: string | undefined) =>
  `creative-applets:${assistantName || 'unknown'}:${userId || 'anon'}`;

const readCachedApplets = (key: string): CachedApplets | null => {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedApplets;
    if (!parsed?.cachedAt || !parsed?.data) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch (_err) {
    return null;
  }
};

const writeCachedApplets = (key: string, data: CachedApplets['data']) => {
  try {
    if (typeof window === 'undefined') return;
    const payload: CachedApplets = { data, cachedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (_err) {
    // Ignore cache write failures
  }
};

const DesktopBackgroundCreative = ({ assistantName: propAssistantName }: DesktopBackgroundCreativeProps) => {
  const logger = getClientLogger('[desktop_background_creative]');
  const { data: session } = useResilientSession();
  const { toast } = useToast();
  const [applets, setApplets] = useState<
    Array<{ page_id: string; title: string; contentType: string; sourceNoteId?: string; sharedVia?: any }>
  >([]);
  const [appletsLoading, setAppletsLoading] = useState(false);
  const [appletsError, setAppletsError] = useState<string | null>(null);
  const currentUserId = session?.user?.id;
  const isOwner = (applet: any) =>
    !applet.sharedVia ||
    applet.sharedVia?.ownerId === currentUserId ||
    applet.sharedVia?.owner?.id === currentUserId ||
    (applet as any).ownerId === currentUserId;
  const [deletingAppletId, setDeletingAppletId] = useState<string | null>(null);
  const [appletsRefreshCounter, setAppletsRefreshCounter] = useState(0);
  const [sharedHtmlGenIds, setSharedHtmlGenIds] = useState<Set<string>>(new Set());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [appletToDelete, setAppletToDelete] = useState<{ id: string; title: string; sourceNoteId?: string } | null>(null);
  const identityKeyRef = useRef<string | null>(null);
  const hasFetchedOnceRef = useRef(false);
  const lastFetchedAtRef = useRef<number>(0);
  const lastRefreshEventAtRef = useRef<number>(0);
  const resolvedAssistantName = propAssistantName || (session as any)?.user?.assistantName;

  useEffect(() => {
    logger.info('Creative background is active');
  }, []);

  // Refresh menu when applets change elsewhere (bot or other clients)
  useEffect(() => {
    const handleRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshEventAtRef.current < 2_000) return; // throttle noisy window events
      lastRefreshEventAtRef.current = now;
      setAppletsRefreshCounter(counter => counter + 1);
    };
    window.addEventListener(NIA_EVENT_APPLET_REFRESH, handleRefresh as EventListener);
    return () => {
      window.removeEventListener(NIA_EVENT_APPLET_REFRESH, handleRefresh as EventListener);
    };
  }, []);

  // Fetch applets
  useEffect(() => {
    let aborted = false;
    const currentUserId = session?.user?.id;
    const assistantName = resolvedAssistantName;
    const identityKey = `${currentUserId || 'anon'}|${assistantName || 'unknown'}`;

    if (identityKeyRef.current !== identityKey) {
      identityKeyRef.current = identityKey;
      hasFetchedOnceRef.current = false;
    }

    const cacheKey = cacheKeyForUser(currentUserId, assistantName);
    const shouldUseCache = appletsRefreshCounter === 0;
    const isRefreshEvent = appletsRefreshCounter > 0;

    // Avoid refetching on routine re-renders once we've fetched for this identity unless a refresh event fired.
    if (!isRefreshEvent && hasFetchedOnceRef.current) {
      return;
    }

    if (!currentUserId) {
      setApplets([]);
      setAppletsLoading(false);
      setAppletsError(null);
      return;
    }

    if (!assistantName) {
      setAppletsError('Assistant name not found');
      setAppletsLoading(false);
      return;
    }

    const now = Date.now();
    const withinCacheWindow = now - lastFetchedAtRef.current < CACHE_TTL_MS;
    if (appletsRefreshCounter > 0 && withinCacheWindow) {
      // Ignore bursty refresh events when we already fetched recently.
      setAppletsLoading(false);
      setAppletsError(null);
      return;
    }

    (async () => {
      setAppletsLoading(true);
      setAppletsError(null);
      if (shouldUseCache) {
        const cached = readCachedApplets(cacheKey);
        if (cached && !aborted) {
          setApplets(cached.data);
          setAppletsLoading(false);
          return;
        }
      }
      try {
        const qp = new URLSearchParams({ limit: '50' });
        if (currentUserId) qp.set('userId', currentUserId);
        if (assistantName) qp.set('agent', assistantName);
        
        logger.info('Fetching applets', { currentUserId, assistantName });

        // Skip fetch attempts when the browser is offline to avoid noisy console errors.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          logger.warn('Skipping applet fetch because navigator reports offline state');
          if (!aborted) {
            setAppletsError('Offline - reconnect to load applets');
            setAppletsLoading(false);
          }
          lastFetchedAtRef.current = Date.now();
          return;
        }
        const res = await fetch(`/api/get-html-content?${qp.toString()}`);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            if (!aborted) {
              setAppletsError('Unauthorized - please sign in');
              setAppletsLoading(false);
            }
            return;
          }
          const errorText = await res.text();
          let errorMsg = 'Failed to load applets';
          try {
            const errorJson = JSON.parse(errorText);
            errorMsg = errorJson.message || errorMsg;
          } catch {
            errorMsg = errorText || errorMsg;
          }
          throw new Error(errorMsg);
        }
        const json = await res.json();
        logger.info('Applets response received', { success: json?.success, count: Array.isArray(json?.data) ? json.data.length : 0 });
        if (!aborted && json?.success) {
          const fetchedApplets = Array.isArray(json.data)
            ? json.data.map((i: any) => ({
                page_id: i.page_id || i._id || i.id,
                title: i.title,
                contentType: i.contentType,
                ...(i.sourceNoteId ? { sourceNoteId: i.sourceNoteId } : {}),
                ...(i.sharedVia ? { sharedVia: i.sharedVia } : {}),
              }))
            : [];

          // Deduplicate applets by page_id
          const uniqueApplets = fetchedApplets.filter((applet: any, index: number, self: any[]) =>
            index === self.findIndex((t: any) => t.page_id === applet.page_id)
          );
          
          // Reverse to show latest first (newest on top, oldest at bottom)
          const reversedApplets = [...uniqueApplets].reverse();
          
          setApplets(reversedApplets);
          writeCachedApplets(cacheKey, reversedApplets);
          setAppletsError(null);
          hasFetchedOnceRef.current = true;
          
          // Fetch shared HTML generations if resource sharing is enabled
          if (featureFlags.resourceSharing && currentUserId && assistantName) {
            // Get tenantId from assistant
            (async () => {
              try {
                const res = await fetch(`/api/assistant/meta?agent=${encodeURIComponent(assistantName)}`);
                if (res.ok) {
                  const meta = await res.json();
                  const tenantId = meta?.tenantId;
                  if (tenantId) {
                    try {
                      const sharedResources = await getUserSharedResources(
                        currentUserId,
                        tenantId,
                        'HtmlGeneration'
                      );
                      // Only mark as "shared" if there are other members besides the owner (memberCount > 1)
                      const sharedIds = new Set(
                        sharedResources
                          .filter(r => r.memberCount > 1)
                          .map(r => r.resourceId)
                      );
                      logger.info('Shared applet IDs resolved', { sharedCount: sharedIds.size });
                      if (!aborted) {
                        setSharedHtmlGenIds(sharedIds);
                      }
                    } catch (error) {
                      // Silently fail - sharing is optional feature
                      logger.warn('Failed to fetch shared HTML generations', {
                        error: error instanceof Error ? error.message : String(error),
                      });
                    }
                  }
                }
              } catch (error) {
                // Silently fail - sharing is optional feature
                logger.warn('Failed to fetch tenantId for sharing', {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            })();
          }
        } else if (!aborted) {
          setAppletsError(json?.message || 'Failed to load applets');
        }
      } catch (e: any) {
        if (!aborted && currentUserId) {
          const msg = e.message || 'Error loading applets';
          logger.error('Error fetching applets', {
            message: msg,
            error: e instanceof Error ? e.message : String(e),
          });
          setAppletsError(msg);
        }
      } finally {
        if (!aborted) {
          lastFetchedAtRef.current = Date.now();
          setAppletsLoading(false);
        }
      }
    })();

    return () => {
      aborted = true;
    };
  }, [session?.user?.id, resolvedAssistantName, appletsRefreshCounter]);

  const handleAppletClick = useCallback(async (appletId: string, appletTitle: string) => {
    try {
      const assistantName = propAssistantName || (session as any)?.user?.assistantName;
      
      if (!assistantName) {
        toast({
          title: 'Failed to Open Applet',
          description: 'Assistant name not found',
          variant: 'destructive',
        } as any);
        return;
      }

      // Fetch applet using assistantName (required by API) - exactly like BrowserWindow does
      const response = await fetch(`/api/get-html-content?id=${appletId}&assistantName=${assistantName}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch applet: ${response.statusText}`);
      }
      
      const result = await response.json();
      if (!result.success || !result.data) {
        throw new Error('Applet not found');
      }
      
      const applet = result.data;
      logger.info('Fetched applet data', { title: applet.title });
      
      // Open the applet window with full data - exactly like BrowserWindow does
      requestWindowOpen({
        viewType: 'htmlContent',
        source: 'desktop:creative-menu',
        viewState: {
          htmlContentData: {
            id: applet._id || applet.page_id || appletId,
            title: applet.title,
            htmlContent: applet.htmlContent,
            contentType: applet.contentType || 'app',
          },
          isHtmlContentFullscreen: false,
        },
      });
      
      const refs: { type: string; id: string; description?: string }[] = [
        { type: 'HtmlGeneration', id: applet._id || appletId, description: `Title: ${applet.title}` },
      ];
      if (applet.sourceNoteId) {
        refs.push({
          type: 'Notes',
          id: applet.sourceNoteId,
          description: 'This is the Note from which the applet was created',
        });
      }
      await trackSessionHistory('Opened HTML applet from creative menu', refs);
    } catch (e: any) {
      logger.error('Failed to open applet', {
        error: e instanceof Error ? e.message : String(e),
      });
      toast({
        title: 'Failed to Open Applet',
        description: e?.message || 'Unable to load applet',
        variant: 'destructive',
      } as any);
    }
  }, [session, toast, propAssistantName]);

  const handleDeleteApplet = useCallback((appletId: string, appletTitle: string, sourceNoteId?: string) => {
    setAppletToDelete({ id: appletId, title: appletTitle, sourceNoteId });
    setDeleteModalOpen(true);
  }, []);

  const confirmDeleteApplet = useCallback(async () => {
    if (!appletToDelete) return;
    
    const { id: appletId, title: appletTitle, sourceNoteId } = appletToDelete;
    
    try {
      setDeletingAppletId(appletId);
      const res = await fetch(`/api/html-generation/${encodeURIComponent(appletId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || 'Failed to delete');
      }
      
      const refs: { type: string; id: string; description?: string }[] = [
        { type: 'HtmlGeneration', id: appletId, description: `Title: ${appletTitle}` },
      ];
      if (sourceNoteId) {
        refs.push({ type: 'Notes', id: sourceNoteId, description: 'This is the Note from which the applet was created' });
      }
      await trackSessionHistory('Deleted HTML applet', refs);
      
      setApplets(prev => prev.filter(p => p.page_id !== appletId));
      setAppletsRefreshCounter(c => c + 1);
      window.dispatchEvent(
        new CustomEvent(NIA_EVENT_APPLET_REFRESH, {
          detail: { payload: { appletId } },
        })
      );
      setDeleteModalOpen(false);
      setAppletToDelete(null);
      toast({
        title: 'Applet Deleted',
        description: 'The applet was removed.',
      } as any);
    } catch (e: any) {
      toast({
        title: 'Delete Failed',
        description: e?.message || 'Unable to delete applet',
        variant: 'destructive',
      } as any);
    } finally {
      setDeletingAppletId(null);
    }
  }, [appletToDelete, toast]);

  const cancelDelete = useCallback(() => {
    setDeleteModalOpen(false);
    setAppletToDelete(null);
  }, []);

  return (
    <div className="creative-mode-container pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
      <div className="creative-mode-background absolute inset-0" />

      {/* Hanging light glows */}
      <div className="creative-light creative-light--left" />
      <div className="creative-light creative-light--center" />
      <div className="creative-light creative-light--sconce" />

      {/* Mug steam */}
      <div className="creative-steam">
        <span />
        <span />
      </div>

      {/* Plant sway */}
      <div className="creative-plant-glow" />

      {/* Scrollable Applet Menu */}
      <div className="creative-applet-menu pointer-events-auto" style={{ zIndex: 1 }}>
        <div className="creative-applet-menu-header">
          <h3 className="creative-applet-menu-title">My Applets</h3>
          {appletsLoading && <RefreshCw className="h-4 w-4 animate-spin" />}
        </div>
        <div className="creative-applet-menu-content">
          {appletsError && (
            <div className="creative-applet-menu-error">
              {appletsError}
            </div>
          )}
          {!appletsLoading && !appletsError && applets.length === 0 && (
            <div className="creative-applet-menu-empty">
              No applets yet
            </div>
          )}
          {applets.map(applet => {
            const isShared = featureFlags.resourceSharing && (sharedHtmlGenIds.has(applet.page_id) || !!applet.sharedVia);
            return (
            <div
              key={applet.page_id}
              className="creative-applet-menu-item"
              onClick={() => handleAppletClick(applet.page_id, applet.title)}
            >
              <div className="creative-applet-menu-item-content">
                <div className="flex items-center gap-1">
                  <div className="creative-applet-menu-item-title">
                    {applet.title && applet.title.trim() ? applet.title.trim() : 'Untitled'}
                  </div>
                  {isShared && (
                    <SharedIndicator size="sm" />
                  )}
                </div>
                <div className="creative-applet-menu-item-type">
                  {applet.contentType}
                </div>
              </div>
                {isOwner(applet) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteApplet(applet.page_id, applet.title, applet.sourceNoteId);
                    }}
                    disabled={deletingAppletId === applet.page_id}
                    className={cn(
                      'creative-applet-menu-item-delete',
                      deletingAppletId === applet.page_id && 'opacity-50'
                    )}
                    aria-label="Delete applet"
                  >
                    {deletingAppletId === applet.page_id ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
            </div>
          );
          })}
        </div>
      </div>

      <DeleteAppletModal
        isOpen={deleteModalOpen}
        onConfirm={confirmDeleteApplet}
        onCancel={cancelDelete}
        isDeleting={deletingAppletId === appletToDelete?.id}
        appletTitle={appletToDelete?.title}
      />

      <style jsx global>{`
        @keyframes creativeLightPulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }

        @keyframes creativeLightFlicker {
          0%, 100% { opacity: 0.8; }
          45% { opacity: 0.55; }
          50% { opacity: 1; }
          60% { opacity: 0.6; }
        }

        .creative-mode-container {
          background: radial-gradient(ellipse at center, rgba(24, 18, 34, 0.65) 0%, rgba(10, 8, 14, 0.92) 100%);
        }

        .creative-mode-background {
          background-image: url('/createbg.png');
          background-size: cover;
          background-position: center;
          filter: brightness(1.05);
        }

        .creative-light {
          position: absolute;
          width: 140px;
          height: 140px;
          background: radial-gradient(circle, rgba(255, 192, 88, 0.4) 0%, rgba(255, 147, 31, 0.05) 70%, transparent 100%);
          mix-blend-mode: screen;
          animation: creativeLightPulse 3.6s ease-in-out infinite;
        }

        .creative-light--left {
          top: 20%;
          left: 17%;
        }

        .creative-light--center {
          top: 9%;
          left: 40%;
          animation-duration: 4.1s;
        }

        .creative-light--sconce {
          top: 28%;
          right: 16%;
          width: 110px;
          height: 110px;
          animation: creativeLightFlicker 2.8s linear infinite;
        }

        /* Applet Menu Styles - Pixel Art Aesthetic */
        .creative-applet-menu {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 400px;
          height: 500px;
          max-width: calc(100vw - 40px);
          max-height: calc(100vh - 40px);
          background: linear-gradient(135deg, 
            rgba(101, 67, 33, 0.95) 0%, 
            rgba(139, 90, 43, 0.95) 50%,
            rgba(101, 67, 33, 0.95) 100%);
          border: 3px solid rgba(69, 45, 22, 0.9);
          border-radius: 8px;
          box-shadow: 
            0 4px 12px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 192, 88, 0.2),
            inset 0 -1px 0 rgba(69, 45, 22, 0.3);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          backdrop-filter: blur(4px);
        }

        .creative-applet-menu-header {
          padding: 12px 16px;
          border-bottom: 2px solid rgba(69, 45, 22, 0.6);
          background: linear-gradient(180deg, 
            rgba(139, 90, 43, 0.8) 0%, 
            rgba(101, 67, 33, 0.8) 100%);
          display: flex;
          align-items: center;
          justify-content: space-between;
          box-shadow: inset 0 1px 0 rgba(255, 192, 88, 0.15);
        }

        .creative-applet-menu-title {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          color: rgba(255, 220, 150, 0.95);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-shadow: 
            1px 1px 0 rgba(69, 45, 22, 0.8),
            0 0 4px rgba(255, 192, 88, 0.3);
        }

        .creative-applet-menu-content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 8px;
          min-height: 0;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 192, 88, 0.4) rgba(69, 45, 22, 0.2);
        }

        .creative-applet-menu-content::-webkit-scrollbar {
          width: 8px;
        }

        .creative-applet-menu-content::-webkit-scrollbar-track {
          background: rgba(69, 45, 22, 0.2);
          border-radius: 4px;
        }

        .creative-applet-menu-content::-webkit-scrollbar-thumb {
          background: rgba(255, 192, 88, 0.4);
          border-radius: 4px;
          border: 1px solid rgba(69, 45, 22, 0.3);
        }

        .creative-applet-menu-content::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 192, 88, 0.6);
        }

        .creative-applet-menu-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          margin-bottom: 6px;
          background: linear-gradient(135deg, 
            rgba(139, 90, 43, 0.6) 0%, 
            rgba(101, 67, 33, 0.6) 100%);
          border: 2px solid rgba(69, 45, 22, 0.5);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 
            0 2px 4px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 192, 88, 0.1);
        }

        .creative-applet-menu-item:hover {
          background: linear-gradient(135deg, 
            rgba(160, 110, 55, 0.75) 0%, 
            rgba(120, 80, 40, 0.75) 100%);
          border-color: rgba(255, 192, 88, 0.4);
          box-shadow: 
            0 3px 6px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 192, 88, 0.2),
            0 0 8px rgba(255, 192, 88, 0.2);
          transform: translateY(-1px);
        }

        .creative-applet-menu-item:active {
          transform: translateY(0);
          box-shadow: 
            0 1px 2px rgba(0, 0, 0, 0.2),
            inset 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .creative-applet-menu-item-content {
          flex: 1;
          min-width: 0;
        }

        .creative-applet-menu-item-title {
          font-size: 13px;
          font-weight: 600;
          color: rgba(255, 220, 150, 0.95);
          margin-bottom: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-shadow: 1px 1px 0 rgba(69, 45, 22, 0.6);
        }

        .creative-applet-menu-item-type {
          font-size: 10px;
          color: rgba(255, 192, 88, 0.7);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 500;
        }

        .creative-applet-menu-item-delete {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139, 50, 30, 0.7);
          border: 1px solid rgba(100, 30, 20, 0.8);
          border-radius: 4px;
          color: rgba(255, 200, 150, 0.9);
          cursor: pointer;
          transition: all 0.15s ease;
          margin-left: 8px;
          box-shadow: 
            0 1px 2px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 150, 100, 0.2);
        }

        .creative-applet-menu-item-delete:hover {
          background: rgba(160, 60, 35, 0.85);
          border-color: rgba(120, 40, 25, 0.9);
          color: rgba(255, 220, 180, 1);
          box-shadow: 
            0 2px 4px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 150, 100, 0.3),
            0 0 6px rgba(200, 80, 50, 0.4);
        }

        .creative-applet-menu-item-delete:active {
          transform: scale(0.95);
          box-shadow: 
            0 1px 1px rgba(0, 0, 0, 0.3),
            inset 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        .creative-applet-menu-item-delete:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .creative-applet-menu-error,
        .creative-applet-menu-empty {
          padding: 16px;
          text-align: center;
          color: rgba(255, 200, 150, 0.8);
          font-size: 12px;
          text-shadow: 1px 1px 0 rgba(69, 45, 22, 0.6);
        }

        .creative-applet-menu-error {
          color: rgba(255, 150, 120, 0.9);
        }

        /* Mobile Responsive */
        @media (max-width: 768px) {
          .creative-applet-menu {
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: calc(100vw - 20px);
            height: 450px;
            max-width: 90vw;
            max-height: calc(100vh - 20px);
          }

          .creative-applet-menu-header {
            padding: 10px 12px;
          }

          .creative-applet-menu-title {
            font-size: 12px;
          }

          .creative-applet-menu-item {
            padding: 8px 10px;
            margin-bottom: 4px;
          }

          .creative-applet-menu-item-title {
            font-size: 12px;
          }

          .creative-applet-menu-item-type {
            font-size: 9px;
          }
        }

        @media (max-width: 480px) {
          .creative-applet-menu {
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: calc(100vw - 10px);
            height: 400px;
            max-width: 95vw;
            max-height: calc(100vh - 10px);
          }

          .creative-applet-menu-header {
            padding: 8px 10px;
          }

          .creative-applet-menu-title {
            font-size: 11px;
          }

          .creative-applet-menu-item {
            padding: 6px 8px;
          }

          .creative-applet-menu-item-title {
            font-size: 11px;
          }
        }
      `}</style>
    </div>
  );
};

export default DesktopBackgroundCreative;


