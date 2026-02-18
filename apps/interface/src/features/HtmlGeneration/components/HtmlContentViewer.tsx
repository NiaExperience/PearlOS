/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
// Moved from components/html-content-viewer.tsx into HtmlGeneration feature (Option A)
import { featureFlags } from '@nia/features';
import { AlertTriangle, ChevronDown, Loader2, Maximize2, Minimize2, RefreshCw, Share, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { usePostHog } from 'posthog-js/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DeleteAppletModal } from '@interface/components/delete-applet-modal';
import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@interface/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@interface/components/ui/dropdown-menu';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { NIA_EVENT_APPLET_OPEN, NIA_EVENT_APPLET_SHARE_OPEN, NIA_EVENT_HTML_MODIFICATION_REQUESTED, NIA_EVENT_HTML_GENERATION_REQUESTED } from '@interface/features/DailyCall/events/niaEventRouter';
import { SharedByBadge, SharedIndicator, SharingModal } from '@interface/features/ResourceSharing/components';
import { createSharingOrganization, getUserSharedResources } from '@interface/features/ResourceSharing/lib';
import { useToast } from '@interface/hooks/use-toast';
import { getClientLogger } from '@interface/lib/client-logger';
import { useLLMMessaging } from '@interface/lib/daily/hooks/useLLMMessaging';
import { trackSessionHistory } from '@interface/lib/session-history';
import { cn } from '@interface/lib/utils';

import '../styles/html-content-viewer.css';

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

const log = getClientLogger('[html-generation.html-content-viewer]');

interface HtmlContentViewerProps {
  // title: string;
  htmlContent: string;
  contentType: 'game' | 'app' | 'tool' | 'interactive';
  cssContent?: string;
  jsContent?: string;
  onClose: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  isGenerating?: boolean;
  generationError?: string | null;
  onRetryGenerate?: () => void;
  showDebugPanel?: boolean;
  /** When provided, enables the Applet selector header */
  enableAppletSelector?: boolean;
  /** Current applet id (page_id) */
  appletId?: string;
  /** Current applet title (displayed in badge) */
  appletTitle?: string;
  /** Callback when user selects a different applet */
  onRequestAppletChange?: (appletId: string) => void;
  /** Admin only: show user selector */
  isAdmin?: boolean;
  /** Currently selected user whose applets are shown (for admins) */
  selectedUserId?: string;
  /** Callback when admin selects different user */
  onSelectUser?: (userId: string) => void;
  /** The current session user's id (fallback when no admin user override) */
  currentUserId?: string;
  /** The current session user's display name */
  currentUserName?: string;
  /** Assistant / agent name to forward for backend filtering */
  agent?: string;
  /** Explicit tenant id (optional alternative to agent for /api/users) */
  tenantId?: string;
  /** Optional diagnostics data to display on error (admin only) */
  diagnostics?: Array<any>;
  /** Optional correlation id for diagnostics (admin only) */
  opId?: string;
  /** Optional provider/model context (admin only) */
  aiProvider?: string;
  aiModel?: string;
  /** Optional trigger to force refresh of applet list */
  refreshTrigger?: number;
  /** Optional sharing metadata if the applet is shared */
  sharedVia?: {
    ownerEmail?: string;
    permission?: string;
    sharedAt?: string;
  };
}

type CrashDetails = {
  message?: string;
  kind?: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  timestamp: string;
  appletId?: string;
  appletTitle?: string;
  contentType: string;
  agent?: string;
  tenantId?: string;
  opId?: string;
  aiProvider?: string;
  aiModel?: string;
  diagnosticsSummary?: string;
  htmlBytes?: number;
  cssBytes?: number;
  jsBytes?: number;
};

export function HtmlContentViewer(props: HtmlContentViewerProps) {
  const {
    // title,
    htmlContent,
    contentType,
    cssContent,
    jsContent,
    onClose,
    isFullscreen = false,
    onToggleFullscreen,
    isGenerating = false,
    generationError = null,
    onRetryGenerate,
    showDebugPanel = false,
    enableAppletSelector = false,
    appletId,
    appletTitle,
    onRequestAppletChange,
    isAdmin,
    selectedUserId,
    onSelectUser,
    currentUserId,
    currentUserName,
    agent,
    tenantId,
    diagnostics,
    opId,
    aiProvider,
    aiModel,
    refreshTrigger = 0,
    sharedVia,
  } = props;
  
  const posthog = usePostHog();
  const { data: session } = useSession();
  const { sendMessage, isReady: isLLMReady } = useLLMMessaging();
  const resolvedSessionId = (session as any)?.sessionId ?? (session?.user as any)?.sessionId;
  const { roomUrl: voiceRoomUrl, callStatus: voiceCallStatus } = useVoiceSessionContext();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [injectedBytes, setInjectedBytes] = useState(0);
  const [applets, setApplets] = useState<
    Array<{ page_id: string; title: string; contentType: string, sourceNoteId?: string; sharedVia?: any }>
  >([]);
  // Counter to force refetch (e.g. after deletion) by changing effect dependency
  const [appletsRefreshCounter, setAppletsRefreshCounter] = useState(0);
  const [deletingAppletId, setDeletingAppletId] = useState<string | null>(null);
  const [appletsLoading, setAppletsLoading] = useState(false);
  const [appletsError, setAppletsError] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const { toast } = useToast();
  const crashHandledRef = useRef(false);
  const [crashDetails, setCrashDetails] = useState<CrashDetails | null>(null);
  const [isAttemptingFix, setIsAttemptingFix] = useState(false);
  const [fixRequestStatus, setFixRequestStatus] = useState<string | null>(null);
  const voiceCrashNotifiedRef = useRef(false);

  // Ensure custom font is available once on mount
  useEffect(() => {
    ensureGohufont();
  }, []);

  // Listen for crash signals from the iframe and surface a soft error instead of reloading the page
  useEffect(() => {
    const handleAppletMessage = (event: MessageEvent) => {
      if (!event?.data || typeof event.data !== 'object') return;
      const { type, message, kind, stack, source, lineno, colno } = event.data as any;
      if (type === 'nia-applet-error') {
        crashHandledRef.current = true;
        setIsLoading(false);
        setError(message ? `Creation ${appletTitle} crashed: ${message}` : `Creation ${appletTitle} crashed`);
        const details = {
          message: message || 'Unknown crash',
          kind,
          stack,
          source,
          lineno,
          colno,
          timestamp: new Date().toISOString(),
          appletId,
          appletTitle,
          contentType,
          agent,
          tenantId,
          opId,
          aiProvider,
          aiModel,
          diagnosticsSummary: Array.isArray(diagnostics) && diagnostics.length > 0
            ? JSON.stringify(diagnostics.slice(0, 2))
            : undefined,
          htmlBytes: htmlContent?.length,
          cssBytes: cssContent?.length,
          jsBytes: jsContent?.length,
        } as CrashDetails;
        log.info('Captured applet crash', { appletId: details.appletId, appletTitle: details.appletTitle, kind: details.kind, source: details.source, lineno: details.lineno, colno: details.colno });
        setCrashDetails(details);
      }
    };
    window.addEventListener('message', handleAppletMessage);
    return () => window.removeEventListener('message', handleAppletMessage);
  }, [appletId, appletTitle, contentType, agent, tenantId, opId, aiProvider, aiModel, diagnostics, htmlContent, cssContent, jsContent]);

  // Sharing state
  const [showSharingModal, setShowSharingModal] = useState(false);
  const [sharingOrganization, setSharingOrganization] = useState<any>(null);
  const [sharedHtmlGenIds, setSharedHtmlGenIds] = useState<Set<string>>(new Set());
  const [isCreatingSharingOrg, setIsCreatingSharingOrg] = useState(false);
  
  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [appletToDelete, setAppletToDelete] = useState<{ id: string; title: string; sourceNoteId?: string; isCurrent: boolean } | null>(null);

  // Header auto-hide state (similar to ManeuverableWindowControls)
  const [headerVisible, setHeaderVisible] = useState(true);
  const [isAppletDropdownOpen, setIsAppletDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const HIDE_DELAY = 3000; // 3 seconds
  
  const handleShareClick = async () => {
    if (!appletId || !currentUserId || !tenantId) return;
    
    setIsCreatingSharingOrg(true);
    try {
      // Create or get sharing organization for this HTML generation
      const org = await createSharingOrganization(
        appletId,
        'HtmlGeneration',
        displayAppletTitle,
        tenantId,
        currentUserId
      );
      
      setSharingOrganization(org);
      posthog?.capture('applet_shared', { appletId });
      setShowSharingModal(true);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to open sharing settings',
        variant: 'destructive',
      } as any);
    } finally {
      setIsCreatingSharingOrg(false);
    }
  };

  const handleDeleteApplet = (pageId: string, title: string, sourceNoteId: string | undefined, isCurrent: boolean) => {
    setAppletToDelete({ id: pageId, title, sourceNoteId, isCurrent });
    setDeleteModalOpen(true);
    setIsAppletDropdownOpen(false); // Close dropdown when delete modal opens
  };

  const confirmDeleteApplet = useCallback(async () => {
    if (!appletToDelete) return;
    
    const { id: pageId, title, sourceNoteId, isCurrent } = appletToDelete;
    
    try {
      setDeletingAppletId(pageId);
      const res = await fetch(`/api/html-generation/${encodeURIComponent(pageId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || 'Failed to delete');
      }
      
      const refs: { type: string; id: string; description?: string }[] = [
        { type: 'HtmlGeneration', id: pageId, description: `Title: ${title}` }
      ];
      if (sourceNoteId) {
        refs.push({ type: 'Notes', id: sourceNoteId, description: `This is the Note from which the applet was created` });
      }
      await trackSessionHistory('Deleted HTML applet', refs);
      posthog?.capture('applet_deleted', { appletId: pageId });
      
      setApplets(prev => {
        const removedIndex = prev.findIndex(p => p.page_id === pageId);
        const newArr = prev.filter(p => p.page_id !== pageId);
        
        // If no applets left at all, close the viewer
        if (newArr.length === 0) {
          onClose?.();
          return newArr;
        }
        
        // If we deleted the currently open applet, auto-select a neighbor
        if (isCurrent) {
          const fallback =
            newArr[removedIndex] ||
            newArr[removedIndex - 1] ||
            newArr[0];
          // Request parent to load the fallback applet
          if (fallback && fallback.page_id !== appletId) {
            onRequestAppletChange?.(fallback.page_id);
          }
        }
        
        return newArr;
      });
      
      setAppletsRefreshCounter(c => c + 1);
      setDeleteModalOpen(false);
      setAppletToDelete(null);
      setIsAppletDropdownOpen(false); // Close dropdown after deletion
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
  }, [appletToDelete, appletId, onClose, onRequestAppletChange, posthog, toast]);

  const cancelDelete = useCallback(() => {
    setDeleteModalOpen(false);
    setAppletToDelete(null);
  }, []);

  const resetHideTimer = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    setHeaderVisible(true);
    // Don't auto-hide if any dropdown is open
    if (isAppletDropdownOpen || isUserDropdownOpen) return;
    hideTimeoutRef.current = setTimeout(() => {
      setHeaderVisible(false);
    }, HIDE_DELAY);
  }, [isAppletDropdownOpen, isUserDropdownOpen]);

  // Title fallbacks to avoid empty headings causing layout issues
  // const displayTitle = title && title.trim() ? title.trim() : 'Untitled';
  const displayAppletTitle =
    appletTitle && appletTitle.trim() ? appletTitle.trim() : 'Untitled Applet';

  // Keyboard shortcuts: ESC exits fullscreen; Ctrl/Cmd+Shift+F toggles fullscreen
  useEffect(() => {
    if (!onToggleFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      // Exit on Escape when currently fullscreen
      if (e.key === 'Escape' && isFullscreen) {
        e.preventDefault();
        onToggleFullscreen();
        return;
      }
      // Toggle with Ctrl+Shift+F or Cmd+Shift+F
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen, onToggleFullscreen]);

  // Bot event listener: Handle APPLET_OPEN events from bot
  useEffect(() => {
    const handleAppletOpen = (event: CustomEvent) => {
      const { appletId: eventAppletId, sharedWith } = event.detail?.payload || {};
      
      if (!eventAppletId) return;
      
      // If we have a callback to change applets, use it
      if (onRequestAppletChange) {
        onRequestAppletChange(eventAppletId);
      }
      
      // If applet was shared with current user, show shared indicator
      if (sharedWith && currentUserId && sharedWith.includes(currentUserId)) {
        // Refresh applets list to pick up new sharing info
        setAppletsRefreshCounter((prev) => prev + 1);
      }
    };
    
    window.addEventListener(NIA_EVENT_APPLET_OPEN, handleAppletOpen as EventListener);
    return () => window.removeEventListener(NIA_EVENT_APPLET_OPEN, handleAppletOpen as EventListener);
  }, [onRequestAppletChange, currentUserId]);

  // Bot event listener: Handle APPLET_SHARE_OPEN events from bot to trigger share dialog
  useEffect(() => {
    const handleAppletShareOpen = () => {
      // Trigger the share button click if we have the required context
      if (appletId && currentUserId && tenantId) {
        log.info('Bot triggered share dialog for applet', { appletId, tenantId, currentUserId });
        handleShareClick();
      } else {
        log.warn('Cannot open share dialog - missing context', {
          hasAppletId: !!appletId,
          hasCurrentUserId: !!currentUserId,
          hasTenantId: !!tenantId
        });
      }
    };
    
    window.addEventListener(NIA_EVENT_APPLET_SHARE_OPEN, handleAppletShareOpen as EventListener);
    return () => window.removeEventListener(NIA_EVENT_APPLET_SHARE_OPEN, handleAppletShareOpen as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appletId, currentUserId, tenantId]);

  // PostMessage listener: Respond to iframe config requests
  useEffect(() => {
    if (!iframeRef.current || !appletId) return;
    
    const handleMessage = (event: MessageEvent) => {
      // Respond to config requests from iframe
      if (event.data && event.data.type === 'REQUEST_APPLET_CONFIG') {
        log.info('Iframe requested applet config', { appletId, currentUserId, tenantId });
        
        // Send configuration to iframe
        const targetOrigin = typeof window !== 'undefined' && window.location ? window.location.origin : '*';
        iframeRef.current?.contentWindow?.postMessage({
          type: 'APPLET_CONFIG',
          appletId: appletId,
          userId: currentUserId,
          userName: currentUserName,
          tenantId: tenantId
        }, targetOrigin);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [appletId, currentUserId, tenantId]);

  // When dropdown closes, restart the hide timer
  useEffect(() => {
    if (!isAppletDropdownOpen && !isUserDropdownOpen && enableAppletSelector) {
      resetHideTimer();
    }
  }, [isAppletDropdownOpen, isUserDropdownOpen, enableAppletSelector, resetHideTimer]);

  // Notify ManeuverableWindowControls about dropdown state changes
  useEffect(() => {
    if (!enableAppletSelector) return;
    
    const anyDropdownOpen = isAppletDropdownOpen || isUserDropdownOpen;
    
    // When any dropdown opens, force header to be visible
    if (anyDropdownOpen) {
      setHeaderVisible(true);
      // Clear any pending hide timer
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    }
    
    // Dispatch custom event to inform window controls about dropdown state
    window.dispatchEvent(
      new CustomEvent('htmlViewer.dropdownStateChange', {
        detail: { isDropdownOpen: anyDropdownOpen }
      })
    );
  }, [isAppletDropdownOpen, isUserDropdownOpen, enableAppletSelector]);

  // Handle mouse movement and window focus/blur for header auto-hide
  useEffect(() => {
    if (!enableAppletSelector) return;
    
    // Find the window container (parent of both header and ManeuverableWindowControls)
    const windowContainer = document.querySelector('[class*="border"][class*="rounded-xl"][class*="overflow-hidden"]');
    if (!windowContainer) return;

    const handleMouseMove = (e: Event) => {
      const mouseEvent = e as MouseEvent;
      // Show header if mouse is in top 120px (area where header and window controls are)
      const rect = windowContainer.getBoundingClientRect();
      const mouseY = mouseEvent.clientY - rect.top;
      const mouseX = mouseEvent.clientX - rect.left;
      const containerWidth = rect.width;
      
      // Check if mouse is in top 120px OR in top-right corner (where window controls are)
      const isInTopArea = mouseY < 120;
      const isInTopRightCorner = mouseY < 150 && mouseX > containerWidth - 200;
      
      if (isInTopArea || isInTopRightCorner) {
        // Mouse is near top or near controls - keep header visible
        setHeaderVisible(true);
        resetHideTimer();
      } else {
        // Mouse is lower - normal behavior
        resetHideTimer();
      }
    };

    const handleMouseLeave = () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      // Don't hide if any dropdown is open
      if (isAppletDropdownOpen || isUserDropdownOpen) return;
      setHeaderVisible(false);
    };

    const handleMouseEnter = () => {
      resetHideTimer();
    };

    const handleWindowBlur = () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      // Don't hide if any dropdown is open
      if (isAppletDropdownOpen || isUserDropdownOpen) return;
      setHeaderVisible(false);
    };

    const handleWindowFocus = () => {
      resetHideTimer();
    };

    // Add event listeners to the window container (same as ManeuverableWindowControls uses)
    windowContainer.addEventListener('mousemove', handleMouseMove);
    windowContainer.addEventListener('mouseleave', handleMouseLeave);
    windowContainer.addEventListener('mouseenter', handleMouseEnter);
    
    // Window focus/blur for when user switches windows/apps
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    
    // Start initial timer
    resetHideTimer();

    return () => {
      windowContainer.removeEventListener('mousemove', handleMouseMove);
      windowContainer.removeEventListener('mouseleave', handleMouseLeave);
      windowContainer.removeEventListener('mouseenter', handleMouseEnter);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [enableAppletSelector, resetHideTimer, isAppletDropdownOpen, isUserDropdownOpen]);

  // Fetch list of saved HtmlGeneration applets for selector
  useEffect(() => {
    if (!enableAppletSelector) return;
    let aborted = false;
    (async () => {
      const hasUserContext = !!(currentUserId || (isAdmin && selectedUserId));
      // If we're in the middle of signing out (session gone) skip fetch silently
      if (!hasUserContext) {
        setApplets([]);
        setAppletsLoading(false);
        setAppletsError(null);
        return;
      }
      setAppletsLoading(true);
      setAppletsError(null);
      try {
        // Build query params: always include userId (admin-selected or current) and agent when available
        const qp = new URLSearchParams({ limit: '50' });
        if (isAdmin && selectedUserId) qp.set('userId', selectedUserId);
        else if (currentUserId) qp.set('userId', currentUserId);
        if (agent) qp.set('agent', agent);
        const res = await fetch(`/api/get-html-content?${qp.toString()}`);
        if (!res.ok) {
          // Suppress toast for auth-related failures likely caused by sign-out race
          if (res.status === 401 || res.status === 403) return;
          throw new Error('Failed to load applets');
        }
        const json = await res.json();
        log.debug('Applets response received', { responseCount: Array.isArray(json?.data) ? json.data.length : 0 });
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
          
          // Deduplicate applets by page_id to prevent "same key" errors
          const uniqueApplets = fetchedApplets.filter((applet: any, index: number, self: any[]) =>
            index === self.findIndex((t: any) => (
              t.page_id === applet.page_id
            ))
          );
          
          // Reverse to show latest first (newest on top, oldest at bottom)
          const reversedApplets = [...uniqueApplets].reverse();
          
          setApplets(reversedApplets);
          
          // Fetch shared HTML generations if resource sharing is enabled
          log.debug('Checking resource sharing', { enabled: featureFlags.resourceSharing, currentUserId, tenantId });
          if (featureFlags.resourceSharing && currentUserId && tenantId) {
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
              setSharedHtmlGenIds(sharedIds);
            } catch (error) {
              // Silently fail - sharing is optional feature
              log.warn('Failed to fetch shared HTML generations', { error });
            }
          }
        }
      } catch (e: any) {
        if (!aborted) {
          // Don't surface toast if no user context (sign-out) or aborted
          if (currentUserId || (isAdmin && selectedUserId)) {
            const msg = e.message || 'Error loading applets';
            setAppletsError(msg);
            toast({
              title: 'Failed to Load Applets',
              description: msg,
              variant: 'destructive',
            } as any);
          }
        }
      } finally {
        if (!aborted) setAppletsLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [enableAppletSelector, selectedUserId, isAdmin, currentUserId, agent, appletsRefreshCounter, refreshTrigger]);

  // Admin user list
  const [users, setUsers] = useState<Array<{ id: string; email: string }>>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let aborted = false;
    (async () => {
      setUsersLoading(true);
      setUsersError(null);
      try {
        // /api/users requires either tenantId or agent per backend route implementation
        const query: string[] = [];
        if (tenantId) query.push(`tenantId=${encodeURIComponent(tenantId)}`);
        else if (agent) query.push(`agent=${encodeURIComponent(agent)}`);
        else {
          // Missing required context, abort gracefully
          setUsersError('Missing tenant or agent context');
          setUsersLoading(false);
          return;
        }
        const res = await fetch(`/api/users?${query.join('&')}`);
        if (!res.ok) throw new Error('Failed to load users');
        const json = await res.json();
        // Backend returns a raw array (route implementation returns users directly) OR possibly wrapped
        const list = Array.isArray(json) ? json : json.data || json.users || json.items || [];
        log.info('Fetched users list', { userCount: Array.isArray(list) ? list.length : 0 });
        if (!aborted) {
          const mappedUsers = Array.isArray(list)
            ? list.map((u: any) => ({ id: u.id || u._id, email: u.email || u.name || 'unknown' }))
            : [];
            
          // Deduplicate users by id
          const uniqueUsers = mappedUsers.filter((user: any, index: number, self: any[]) =>
            index === self.findIndex((t: any) => (
              t.id === user.id
            ))
          );
          
          setUsers(uniqueUsers);
        }
      } catch (e: any) {
        if (!aborted) {
          const msg = e.message || 'Error loading users';
          setUsersError(msg);
          toast({ title: 'Failed to Load Users', description: msg, variant: 'destructive' } as any);
        }
      } finally {
        if (!aborted) setUsersLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [isAdmin, agent, tenantId]);

  useEffect(() => {
    if (!iframeRef.current || !htmlContent) return;
    setIsLoading(true);
    setError(null);
    try {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      // Applet Configuration Bridge Script - MUST come first
      const appletConfigScript = `
(function() {
  try {
    log.info('Initializing applet configuration bridge');
    
    // Request configuration from parent window
    let appletConfig = null;
    let configPromise = null;
    let configResolve = null;
    
    // Create promise that resolves when config arrives
    configPromise = new Promise(function(resolve) {
      configResolve = resolve;
    });
    
    // Listen for config from parent
    window.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'APPLET_CONFIG') {
        appletConfig = {
          appletId: event.data.appletId,
          userId: event.data.userId,
          userName: event.data.userName,
          tenantId: event.data.tenantId
        };
        log.info('Applet configured', { appletConfig });
        
        // Resolve the promise
        if (configResolve) {
          configResolve(appletConfig);
        }
        
        // Notify applet that config is ready
        window.dispatchEvent(new CustomEvent('appletConfigReady', { detail: appletConfig }));
      }
    });
    
    // Request config from parent
    if (window.parent !== window) {
      log.info('Requesting applet config from parent');
      window.parent.postMessage({ type: 'REQUEST_APPLET_CONFIG' }, '*');
    }
    
    // Expose config getter for applet code
    window.getAppletConfig = function() {
      if (!appletConfig) {
        log.warn('Applet config not yet loaded. Wait for appletConfigReady event.');
      }
      return appletConfig;
    };
    
    // Enhanced fetch wrapper that auto-injects appletId
    const originalFetch = window.fetch;
    window.fetch = async function(url, options) {
      if (typeof url === 'string') {
        const isApiEndpoint = url.includes('/api/');
        const isApprovedEndpoint = url.includes('/api/applet-api');
        if (isApiEndpoint && !isApprovedEndpoint) {
          log.warn('Blocked fetch to non-approved /api/ endpoint', { url });
          return Promise.reject(new Error('Blocked fetch to non-approved /api/ endpoint'));
        }
      }
      if (typeof url === 'string' && url.includes('/api/applet-api')) {
        // Wait for config to be ready before proceeding
        if (!appletConfig) {
          log.info('Waiting for applet config before making API call');
          await configPromise;
          log.info('Config ready, proceeding with API call');
        }
        
        options = options || {};
        const method = (options.method || 'GET').toUpperCase();
        
        // Inject appletId based on HTTP method
        if (appletConfig && appletConfig.appletId) {
          if (method === 'GET' || method === 'HEAD') {
            // For GET/HEAD, add appletId as query parameter
            const separator = url.includes('?') ? '&' : '?';
            url = url + separator + 'appletId=' + encodeURIComponent(appletConfig.appletId);
            log.info('Auto-injected appletId into query string', { appletId: appletConfig.appletId });
          } else {
            // For POST/PUT/PATCH/DELETE, add to body
            let body = {};
            if (options.body) {
              try {
                body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
              } catch (e) {
                log.warn('Could not parse request body, creating new object');
              }
            }
            
            body.appletId = appletConfig.appletId;
            options.body = JSON.stringify(body);
            log.info('Auto-injected appletId into request body', { appletId: appletConfig.appletId });
            
            // Ensure content-type header for body requests
            options.headers = options.headers || {};
            const hasContentType = Object.keys(options.headers).some(k => k.toLowerCase() === 'content-type');
            if (!hasContentType) {
              options.headers['Content-Type'] = 'application/json';
            }
          }
        } else {
          log.warn('Making applet-api call without appletId - data may not be properly scoped');
        }
      }
      
      return originalFetch.call(this, url, options);
    };
    
    log.info('Applet configuration bridge initialized');
  } catch(err) {
    log.error('Applet configuration bridge error', { err });
  }
})();
`;

      // Universal Button Activation Script
      const universalScript = `
(function(){
  try {
    const logMessage = function(level, message, extra) {
      try {
        parent?.postMessage({
          type: 'html-generation-universal-log',
          level: level || 'info',
          message,
          extra
        }, '*');
      } catch (_) {}
    };
    
    logMessage('info', 'Initializing universal HTML content viewer');
    
    // Safety: Prevent external navigation but allow internal functionality
    document.addEventListener('click', function(e) {
      if (e.target.tagName === 'A' && e.target.href && !e.target.href.startsWith('#')) {
        e.preventDefault();
        logMessage('warn', 'Blocked external navigation', { href: e.target.href });
      }
    });

    // Universal Button Activation: Make non-functional buttons functional
    document.addEventListener('DOMContentLoaded', function() {
      logMessage('info', 'Activating universal button functionality');
      var buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
      
      buttons.forEach(function(btn) {
        if (btn.onclick || btn.hasAttribute('data-activated')) return;
        
        var text = (btn.textContent || btn.value || '').toLowerCase();
        // Create generic functionality based on button text
        btn.onclick = function() {
          logMessage('info', 'Button clicked', { text });
          // Generic actions for common button types
          if (text.includes('start') || text.includes('play')) {
            logMessage('info', 'Starting game/activity', { text });
            btn.textContent = btn.textContent.replace('Start', 'Starting...');
            setTimeout(() => {
              btn.textContent = btn.textContent.replace('Starting...', 'Reset');
            }, 1000);
          } else if (text.includes('add')) {
            logMessage('info', 'Adding item', { text });
            // Add item functionality
          } else if (text.includes('reset') || text.includes('clear')) {
            logMessage('info', 'Resetting', { text });
            // Reset functionality  
          } else if (text.includes('save')) {
            logMessage('info', 'Saving content', { text });
            alert('Saved successfully!');
          } else {
            logMessage('info', 'Generic button action performed', { text });
          }
        };
        btn.setAttribute('data-activated', 'true');
        logMessage('info', 'Activated button', { text });
      });
      
      logMessage('info', 'Universal button activation complete');
    });
  } catch(err) {
    logMessage('error', 'Universal script error', { errMessage: err?.message || String(err) });
  }
})();
`;

      const crashGuardScript = `(() => {
  function report(kind, payload) {
    try {
      parent?.postMessage({ type: 'nia-applet-error', kind, ...payload }, '*');
    } catch (_) {}
  }
  window.onerror = function(msg, source, lineno, colno, error) {
    report('error', {
      message: error?.message || msg,
      stack: error?.stack,
      source,
      lineno,
      colno,
    });
    return true;
  };
  window.onunhandledrejection = function(event) {
    var reason = event?.reason;
    var reasonMessage = typeof reason === 'string' ? reason : (reason && reason.message) ? reason.message : 'Unhandled rejection';
    report('unhandledrejection', {
      message: reasonMessage,
      stack: reason && reason.stack,
    });
    return true;
  };
})();`;

      let finalHtml = htmlContent;

      // Inject applet configuration bridge FIRST (before any other scripts)
      if (finalHtml.includes('<head>')) {
        finalHtml = finalHtml.replace('<head>', `<head><script>${appletConfigScript}</script>`);
      } else if (finalHtml.includes('<body')) {
        finalHtml = `<script>${appletConfigScript}</script>` + finalHtml;
      } else {
        finalHtml = `<script>${appletConfigScript}</script>` + finalHtml;
      }

      // Merge optional CSS/JS into provided HTML (enhanced)
      if (cssContent) {
        if (finalHtml.includes('</head>')) {
          finalHtml = finalHtml.replace('</head>', `<style>${cssContent}</style></head>`);
        } else if (finalHtml.includes('<body')) {
          finalHtml = finalHtml.replace('<body', `<style>${cssContent}</style><body`);
        } else {
          finalHtml = `<style>${cssContent}</style>` + finalHtml;
        }
      }
      if (jsContent) {
        if (finalHtml.includes('</body>')) {
          finalHtml = finalHtml.replace('</body>', `<script>${jsContent}</script></body>`);
        } else if (finalHtml.includes('</html>')) {
          finalHtml = finalHtml.replace('</html>', `<script>${jsContent}</script></html>`);
        } else {
          finalHtml += `<script>${jsContent}</script>`;
        }
      }

      // Inject universal script
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `<script>${crashGuardScript}</script><script>${universalScript}</script></body>`);
      } else if (finalHtml.includes('</html>')) {
        finalHtml = finalHtml.replace('</html>', `<script>${crashGuardScript}</script><script>${universalScript}</script></html>`);
      } else {
        finalHtml += `<script>${crashGuardScript}</script><script>${universalScript}</script>`;
      }

      log.info(
        'HTML content enhanced with universal functionality',
        { characters: finalHtml.length }
      );

      // Use srcDoc instead of Blob URLs for better security
      if (iframeRef.current) {
        iframeRef.current.srcdoc = finalHtml;
      }
      setInjectedBytes(finalHtml.length);
      const handleLoad = () => {
        setIsLoading(false);
        log.info('HTML content loaded successfully', { length: finalHtml.length });
        posthog?.capture('applet_viewed', { 
          appletId, 
          contentType, 
          length: finalHtml.length 
        });
      };
      const handleError = () => {
        setIsLoading(false);
        setError('Failed to load content');
        log.error('Failed to load HTML content');
      };
      iframeRef.current.addEventListener('load', handleLoad);
      iframeRef.current.addEventListener('error', handleError);
      return () => {
        iframeRef.current?.removeEventListener('load', handleLoad);
        iframeRef.current?.removeEventListener('error', handleError);
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    } catch {
      setIsLoading(false);
      setError('Failed to prepare content');
    }
  }, [htmlContent, cssContent, jsContent]);

  const refreshContent = () => {
    if (!iframeRef.current) return;
    setIsLoading(true);
    setError(null);
    setCrashDetails(null);
    // Force reload when using srcdoc; fallback to blob URL when present
    const currentSrcDoc = (iframeRef.current as any).srcdoc as string | undefined;
    if (currentSrcDoc !== undefined) {
      (iframeRef.current as any).srcdoc = currentSrcDoc;
    } else if (blobUrlRef.current) {
      iframeRef.current.src = blobUrlRef.current;
    }
  };

  const buildModificationRequest = useCallback(() => {
    if (!crashDetails) return '';
    const lines = [
      `Fix a crashing HTML applet titled "${crashDetails.appletTitle || 'Untitled Applet'}" (${crashDetails.contentType}).`,
      `Crash message: ${crashDetails.message || 'unknown'}. Kind: ${crashDetails.kind || 'n/a'}.`,
      `Stack: ${crashDetails.stack || 'n/a'}. Source: ${crashDetails.source || 'n/a'} ${crashDetails.lineno ? `@${crashDetails.lineno}:${crashDetails.colno || ''}` : ''}`.trim(),
      `Applet context: appletId=${crashDetails.appletId || 'n/a'}, agent=${crashDetails.agent || 'n/a'}, tenant=${crashDetails.tenantId || 'n/a'}, opId=${crashDetails.opId || 'n/a'}, ai=${crashDetails.aiProvider || 'anthropic'}${crashDetails.aiModel ? `:${crashDetails.aiModel}` : ''}.`,
      `Payload sizes: htmlBytes=${crashDetails.htmlBytes ?? 'n/a'}, cssBytes=${crashDetails.cssBytes ?? 'n/a'}, jsBytes=${crashDetails.jsBytes ?? 'n/a'}.`,
    ];
    if (crashDetails.diagnosticsSummary) {
      lines.push(`Diagnostics: ${crashDetails.diagnosticsSummary}`);
    }
    return lines.join('\n');
  }, [crashDetails]);

  const buildAttemptFixPayload = useCallback(() => {
    if (!crashDetails) return null;
    const modificationRequest = buildModificationRequest();
    if (!modificationRequest.trim()) return null;

    const targetAppletId = crashDetails.appletId || appletId;

    return {
      appletId: targetAppletId,
      appletTitle: crashDetails.appletTitle,
      modificationRequest,
      aiProvider: crashDetails.aiProvider || aiProvider || 'anthropic',
      aiModel: crashDetails.aiModel || aiModel,
      assistantName: crashDetails.agent || agent,
      versioningPreference: 'modify_existing',
      saveChoice: 'original',
      handledByUi: true,
      source: 'applet-crash',
    } as Record<string, unknown>;
  }, [agent, aiModel, aiProvider, appletId, buildModificationRequest, crashDetails]);

  const dispatchHtmlModificationRequested = useCallback((payload: Record<string, unknown>) => {
    try {
      window.dispatchEvent(
        new CustomEvent(NIA_EVENT_HTML_MODIFICATION_REQUESTED, {
          detail: { payload },
        })
      );
      log.info('Dispatched HTML modification request event', { payloadSource: payload?.source });
    } catch (err) {
      log.error('Failed to dispatch HTML modification request event', { err });
    }
  }, []);

  const handleAttemptFix = useCallback(async () => {
    if (!appletId) {
      toast({
        title: 'Cannot attempt fix',
        description: 'Applet ID is missing so the fix cannot be requested.',
        variant: 'destructive',
      } as any);
      return;
    }
    if (!crashDetails) {
      toast({
        title: 'No crash details',
        description: 'Crash context was not captured; please retry.',
        variant: 'destructive',
      } as any);
      return;
    }
    if (isAttemptingFix) return;

    const payload = buildAttemptFixPayload();
    if (!payload || typeof payload.modificationRequest !== 'string' || !payload.modificationRequest.trim()) {
      toast({
        title: 'Missing crash summary',
        description: 'Could not build a crash summary for the fix request.',
        variant: 'destructive',
      } as any);
      return;
    }

    setIsAttemptingFix(true);
    setFixRequestStatus('Submitting crash context to generate a fix…');

    try {
      log.info('Attempting fix-crash via modify-applet', { appletId, modificationRequest: payload.modificationRequest });
      const response = await fetch('/api/modify-applet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Fix request failed: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result?.success) {
        throw new Error(result?.error || 'Fix request was not successful');
      }

      log.info('Fix-crash request succeeded', {
        appletId,
        modificationId: result?.modificationId,
        updatedTitle: result?.data?.title,
      });

      // When a new/updated applet is returned, clear crash UI and emit an open event so the viewer reloads it
      const newAppletId = result?.data?._id || result?.data?.page_id || result?.data?.id;
      if (newAppletId) {
        setError(null);
        setCrashDetails(null);
        setIsLoading(true);
        window.dispatchEvent(
          new CustomEvent(NIA_EVENT_APPLET_OPEN, {
            detail: { payload: { appletId: newAppletId, source: 'attempt-fix' } }
          })
        );
        onRequestAppletChange?.(newAppletId);
      }

      setFixRequestStatus(
        result?.data?.title
          ? `Fix requested. Updated as “${result.data.title}”.`
          : 'Fix requested. We will refresh once the update is ready.'
      );
      toast({
        title: 'Fix requested',
        description:
          result?.data?.title
            ? `Updated as “${result.data.title}”. Reload the applet to try the fixed version.`
            : 'We sent crash details to generate a fixed version.',
      } as any);
    } catch (err: any) {
      log.error('Fix-crash request failed', { err: err?.message || String(err) });
      setFixRequestStatus('Fix request failed. Please retry.');
      toast({
        title: 'Fix request failed',
        description: err?.message || 'Unable to request a fix right now.',
        variant: 'destructive',
      } as any);
    } finally {
      dispatchHtmlModificationRequested(payload);
      setIsAttemptingFix(false);
    }
  }, [appletId, crashDetails, isAttemptingFix, buildAttemptFixPayload, dispatchHtmlModificationRequested, toast]);

  useEffect(() => {
    // Reset voice notification gate when crash context changes or clears
    if (!crashDetails) {
      voiceCrashNotifiedRef.current = false;
      return;
    }
    voiceCrashNotifiedRef.current = false;
  }, [crashDetails?.timestamp]);

  useEffect(() => {
    if (!error || !crashDetails) return;
    if (voiceCrashNotifiedRef.current) return;

    const voiceActive = voiceCallStatus === 'active';
    const hasRoom = Boolean(voiceRoomUrl);
    if (!voiceActive || !hasRoom || !isLLMReady) return;

    const payload = buildAttemptFixPayload();
    if (!payload) return;

    const appletTitle = typeof (payload as any)?.appletTitle === 'string' ? (payload as any).appletTitle : undefined;
    const payloadJson = JSON.stringify(payload, null, 2);
    const message = [
      `A creation crashed in the Creation Studio: ${appletTitle || 'Untitled Creation'}.`,
      'Tell the user you can try to fix it automatically.',
      'If they agree, call bot_update_html_applet with the payload below.',
      'If they decline, call bot_close_applet_creation_engine.',
      'Payload:',
      payloadJson,
    ].join('\n');

    (async () => {
      try {
        log.info('Sending voice crash notification', { appletId: (payload as any)?.appletId, appletTitle, roomUrl: voiceRoomUrl });
        await sendMessage({ content: message, role: 'system', mode: 'queued' });
        voiceCrashNotifiedRef.current = true;
        try {
          await trackSessionHistory('HTML applet crash (voice notification)', [
            {
              type: 'HtmlGeneration',
              id: (payload as any)?.appletId || 'unknown',
              description: appletTitle || 'Untitled applet',
            },
          ]);
        } catch (logErr) {
          log.warn('Failed to track crash notification history', { logErr });
        }
      } catch (err) {
        log.warn('Failed to send crash context to voice bot', { err });
      }
    })();
  }, [buildAttemptFixPayload, crashDetails, error, isLLMReady, sendMessage, voiceCallStatus, voiceRoomUrl]);

  useEffect(() => {
    const clearCrashState = () => {
      setError(null);
      setFixRequestStatus(null);
      setCrashDetails(null);
      voiceCrashNotifiedRef.current = false;
    };

    window.addEventListener(NIA_EVENT_HTML_MODIFICATION_REQUESTED, clearCrashState as EventListener);
    window.addEventListener(NIA_EVENT_HTML_GENERATION_REQUESTED, clearCrashState as EventListener);
    return () => {
      window.removeEventListener(NIA_EVENT_HTML_MODIFICATION_REQUESTED, clearCrashState as EventListener);
      window.removeEventListener(NIA_EVENT_HTML_GENERATION_REQUESTED, clearCrashState as EventListener);
    };
  }, []);
  const getContentTypeIcon = () =>
    (({ game: '🎮', app: '📱', tool: '🛠️', interactive: '✨' }) as any)[contentType] || '📄';
  const containerClass = isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'w-full h-full';
  const iframeClass = 'w-full h-full border-0 ' + (isFullscreen ? '' : 'rounded-lg');
  const showOverlay = isGenerating || generationError;

  const crashBackdropStyle = {
    backgroundImage:
      'linear-gradient(rgba(58,252,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(58,252,255,0.05) 1px, transparent 1px), radial-gradient(circle at 20% 20%, rgba(58,252,255,0.12), transparent 28%), radial-gradient(circle at 80% 0%, rgba(255,93,196,0.18), transparent 32%)',
    backgroundSize: '20px 20px, 20px 20px, 100% 100%, 100% 100%',
    backgroundColor: '#050810',
  } as const;

  const crashPanelStyle = {
    boxShadow:
      '0 0 0 2px rgba(58,252,255,0.4), 0 10px 40px rgba(0,0,0,0.7), inset 0 0 40px rgba(58,252,255,0.12)',
  } as const;

  const retroButtonBase =
    'uppercase tracking-[0.14em] font-semibold text-[12px] px-4 py-2 rounded-md transition-all duration-150 ease-out shadow-[0_0_0_1px_rgba(58,252,255,0.25),0_12px_30px_rgba(0,0,0,0.55)] border border-[#3afcff]/50 bg-[#0b1424]/90 text-[#d8f3ff] hover:-translate-y-[1px] hover:shadow-[0_0_0_1px_rgba(58,252,255,0.35),0_16px_38px_rgba(0,0,0,0.7)] focus:ring-2 focus:ring-[#3afcff]/50 focus:outline-none';

  const retroButtonPrimary =
    'bg-[#14d4ff] text-[#03101f] border-[#3afcff] hover:bg-[#3afcff] active:translate-y-[0px]';

  return (
    <div
      className={containerClass}
      data-component="HtmlContentViewer"
      style={{ fontFamily: 'Gohufont, monospace' }}
    >
      <Card className={cn(
        "relative flex h-full flex-col border-0 shadow-none",
        isFullscreen ? 'rounded-none' : ''
      )}>
        {enableAppletSelector && (
          <>
            {/* Actual header */}
            <div
              className={cn(
                'absolute top-0 left-0 right-0 z-20 bg-muted/80 backdrop-blur-sm flex items-center justify-between gap-2 border-b px-4 py-1 transition-all duration-300 ease-in-out',
                isFullscreen ? 'pt-2' : '',
                headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full',
                'creative-mode-header'
              )}
              style={{
                pointerEvents: headerVisible ? 'auto' : 'none'
              }}
            >
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground uppercase tracking-wide">Applet</span>
              <DropdownMenu open={isAppletDropdownOpen} onOpenChange={(open) => setIsAppletDropdownOpen(open)}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="bg-primary/10 hover:bg-primary/20 text-primary focus:ring-primary/40 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2"
                    aria-label="Select applet"
                  >
                    <span className="max-w-[180px] truncate">{displayAppletTitle}</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className={cn('max-h-72 w-64 overflow-auto z-[100]', 'creative-mode-menu')} align="start">
                  <DropdownMenuLabel>Saved Applets</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {appletsLoading && (
                    <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <RefreshCw className="h-3 w-3 animate-spin" /> Loading…
                    </div>
                  )}
                  {appletsError && (
                    <div className="px-2 py-1.5 text-xs text-red-500">{appletsError}</div>
                  )}
                  {!appletsLoading && !appletsError && applets.length === 0 && (
                    <div className="text-muted-foreground px-2 py-1.5 text-xs">No applets yet</div>
                  )}
                  {applets.map(a => {
                    const canDelete =
                      !a.sharedVia && // Disable delete for shared applets
                      ((!!currentUserId && !isAdmin) || // normal user
                      (isAdmin && selectedUserId) || // admin viewing a specific user
                      (isAdmin && !selectedUserId)); // superadmin / global
                    const isCurrent = a.page_id === appletId;
                    const isDeletingThis = deletingAppletId === a.page_id;
                    return (
                      <DropdownMenuItem
                        key={a.page_id}
                        onSelect={e => {
                          e.preventDefault();
                          if (isDeletingThis) return; // ignore while deleting
                          if (a.page_id !== appletId) {
                            onRequestAppletChange?.(a.page_id);
                            setIsAppletDropdownOpen(false); // Close dropdown after selection
                          }
                        }}
                        className={cn(
                          'flex items-start gap-2 px-2 py-1.5',
                          isCurrent ? 'bg-accent/60' : ''
                        )}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex items-center gap-1">
                            <span className="flex-1 truncate text-sm font-medium leading-tight">
                              {a.title && a.title.trim() ? a.title.trim() : 'Untitled'}
                            </span>
                            {featureFlags.resourceSharing && (sharedHtmlGenIds.has(a.page_id) || a.sharedVia) && (
                              <SharedIndicator size="sm" />
                            )}
                          </div>
                          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                            {a.contentType}
                          </span>
                        </div>
                        {canDelete && (
                          <button
                            type="button"
                            aria-label={isDeletingThis ? 'Deleting applet' : 'Delete applet'}
                            title="Delete applet"
                            disabled={isDeletingThis}
                            onClick={ev => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              if (isDeletingThis) return;
                              handleDeleteApplet(a.page_id, a.title, a.sourceNoteId, isCurrent);
                            }}
                            className={cn(
                              'inline-flex items-center justify-center rounded-md border border-red-500/40 bg-red-600/90 text-white transition-colors hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400/40 disabled:opacity-50',
                              'mt-0.5 h-5 w-5'
                            )}
                          >
                            {isDeletingThis ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* Share button between applet selector and admin user selector */}
              {featureFlags.resourceSharing && (() => {
                if (!appletId || !currentUserId || !tenantId) {
                  return null;
                }

                // Find the current applet to check if it's shared
                const currentApplet = applets.find(a => a.page_id === appletId);
                
                // If this applet is shared with us (has sharedVia), show SharedByBadge
                // Check both the applet list and the direct prop
                const effectiveSharedVia = currentApplet?.sharedVia || sharedVia;
                
                if (effectiveSharedVia) {
                  return (
                    <div className="ml-2">
                      <SharedByBadge 
                        ownerName={effectiveSharedVia.ownerEmail || 'Unknown'} 
                      />
                    </div>
                  );
                }
                
                // Otherwise, show Share icon button for the owner
                return (
                  <button
                    onClick={handleShareClick}
                    disabled={isCreatingSharingOrg}
                    className="text-muted-foreground hover:bg-accent ml-2 rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    title="Share Applet"
                  >
                    {isCreatingSharingOrg ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share className="h-4 w-4" />
                    )}
                  </button>
                );
              })()}
              
              {isAdmin && (
                <DropdownMenu open={isUserDropdownOpen} onOpenChange={(open) => setIsUserDropdownOpen(open)}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="focus:ring-primary/40 inline-flex items-center gap-1 rounded-md border bg-gray-900/80 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 dark:bg-gray-700 dark:hover:bg-gray-600"
                      aria-label="Select user"
                    >
                      <span className="max-w-[140px] truncate">
                        {users.find(u => u.id === selectedUserId)?.email || 'Select User'}
                      </span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className={cn('max-h-72 w-72 overflow-auto z-[100]', 'creative-mode-menu')} align="start">
                    <DropdownMenuLabel>Users</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {usersLoading && (
                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
                        <RefreshCw className="h-3 w-3 animate-spin" /> Loading…
                      </div>
                    )}
                    {usersError && (
                      <div className="px-2 py-1.5 text-xs text-red-500">{usersError}</div>
                    )}
                    {!usersLoading && !usersError && users.length === 0 && (
                      <div className="text-muted-foreground px-2 py-1.5 text-xs">No users</div>
                    )}
                    {users.map(u => (
                      <DropdownMenuItem
                        key={u.id}
                        onSelect={e => {
                          e.preventDefault();
                          onSelectUser?.(u.id);
                          setIsUserDropdownOpen(false); // Close dropdown after selection
                        }}
                        className={cn(
                          'flex flex-col items-start gap-0.5',
                          u.id === selectedUserId ? 'bg-accent/60' : ''
                        )}
                      >
                        <span className="w-full truncate text-xs font-medium leading-tight">
                          {u.email}
                        </span>
                        <span className="text-muted-foreground text-[9px] uppercase tracking-wide">
                          {u.id.slice(0, 8)}…
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {/* Header delete button removed; deletion now inline per dropdown entry */}
            </div>
            {/* Right side controls */}
            <div className="flex items-center gap-2">
              {/* Share button moved to left side between dropdowns */}
            </div>
            {/* Applet ID removed per request */}
          </div>
          </>
        )}
        {/* Header overlays content with auto-hide */}
        
        <CardContent className="relative flex-1 p-0 h-full w-full">
          {isLoading && !generationError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 text-sm">
                <RefreshCw className="h-5 w-5 animate-spin" />
                {/* <span>Loading {displayTitle}…</span> */}
              </div>
            </div>
          )}
          {showOverlay && (
            <div className="bg-background/70 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-4 text-center backdrop-blur-sm">
              {isGenerating && !generationError && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <RefreshCw className="h-5 w-5 animate-spin" /> 
                    {/* <span>Generating {title}…</span> */}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Preparing interactive {contentType} code
                  </p>
                </>
              )}
              {generationError && (
                <div className="flex w-full max-w-2xl flex-col items-center gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-6 w-6 text-red-500" />
                    <p className="text-sm text-red-600">{generationError}</p>
                  </div>
                  {onRetryGenerate && (
                    <Button size="sm" variant="outline" onClick={onRetryGenerate}>
                      Retry Generation
                    </Button>
                  )}
                  {isAdmin && (
                    <div className="border-border bg-background mt-2 w-full rounded border text-left">
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="text-muted-foreground text-xs">
                          Diagnostics {opId ? `(opId ${opId.slice(0, 8)}…)` : ''}{' '}
                          {aiProvider ? `• ${aiProvider}${aiModel ? `:${aiModel}` : ''}` : ''}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowDiagnostics(v => !v)}
                        >
                          {showDiagnostics ? 'Hide details' : 'Show details'}
                        </Button>
                      </div>
                      {showDiagnostics && (
                        <div className="max-h-64 overflow-auto px-3 pb-3">
                          {Array.isArray(diagnostics) && diagnostics.length > 0 ? (
                            <ul className="space-y-2 font-mono text-[11px]">
                              {diagnostics.map((d, idx) => (
                                <li key={idx} className="bg-muted/40 rounded p-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                                      {new Date(d.timestamp || Date.now()).toISOString()}
                                    </span>
                                    <span className="bg-accent/60 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]">
                                      {d.phase || 'unknown'}
                                    </span>
                                    {d.provider && (
                                      <span className="text-[10px]">
                                        {d.provider}
                                        {d.model ? `:${d.model}` : ''}
                                      </span>
                                    )}
                                    {(typeof d.promptLength === 'number' ||
                                      typeof d.responseLength === 'number') && (
                                      <span className="text-muted-foreground text-[10px]">
                                        PL:{d.promptLength ?? '-'} RL:{d.responseLength ?? '-'}
                                      </span>
                                    )}
                                  </div>
                                  {d.error && (
                                    <div className="mt-1 break-words text-[11px] text-red-600">
                                      {d.error.message}
                                      {d.error.code ? ` [${d.error.code}]` : ''}
                                      {typeof d.error.status === 'number'
                                        ? ` (status ${d.error.status})`
                                        : ''}
                                    </div>
                                  )}
                                  {d.environment && (
                                    <div className="text-muted-foreground mt-1 text-[10px]">
                                      env: NODE_ENV={d.environment.nodeEnv || '-'} NEXT_RUNTIME=
                                      {d.environment.nextRuntime || '-'} VERCEL=
                                      {d.environment.vercel ? 'yes' : 'no'} REGION=
                                      {d.environment.region || '-'} KEYS: openai=
                                      {d.environment.hasOpenAIKey ? '✓' : '×'} anthropic=
                                      {d.environment.hasAnthropicKey ? '✓' : '×'} gemini=
                                      {d.environment.hasGeminiKey ? '✓' : '×'}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-muted-foreground text-[11px]">
                              No diagnostics captured for this run.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {error && !showOverlay && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center px-4"
              style={crashBackdropStyle}
            >
              <div
                className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-[#3afcff]/40 bg-[#060a13]/95 p-6 text-center"
                style={crashPanelStyle}
              >
                <div
                  className="pointer-events-none absolute inset-0 opacity-40"
                  style={{
                    backgroundImage:
                      'linear-gradient(135deg, rgba(58,252,255,0.15) 0%, rgba(255,130,224,0.12) 100%)',
                    mixBlendMode: 'screen',
                  }}
                />
                <div className="pointer-events-none absolute inset-0 border border-[#3afcff]/20" />
                <div className="relative flex flex-col items-center gap-4">
                  <div className="flex items-center gap-3 text-[#eaf7ff]">
                    <AlertTriangle className="h-7 w-7 text-[#ff82e0] drop-shadow-[0_0_14px_rgba(255,130,224,0.35)]" />
                    <div className="text-left">
                      <div className="text-[11px] uppercase tracking-[0.28em] text-[#3afcff]">
                        Anomaly detected...
                      </div>
                      <div className="text-2xl font-bold leading-tight text-[#f7fbff]">
                        Creation halted
                      </div>
                    </div>
                  </div>
                  <p className="max-w-xl text-sm leading-relaxed text-[#cfe8ff]">
                    {error}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={refreshContent}
                      className={retroButtonBase}
                    >
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleAttemptFix}
                      disabled={isAttemptingFix}
                      className={cn(retroButtonBase, retroButtonPrimary)}
                    >
                      {isAttemptingFix ? 'Requesting Fix…' : 'Attempt Fix'}
                    </Button>
                  </div>
                  {fixRequestStatus && (
                    <p className="max-w-xl text-xs leading-relaxed text-[#8fd5ff]">
                      {fixRequestStatus}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            className={iframeClass}
            // title={title}
            sandbox="allow-scripts allow-same-origin allow-forms"
            style={{ 
              visibility: isLoading || error || showOverlay ? 'hidden' : 'visible',
              pointerEvents: (isAppletDropdownOpen || isUserDropdownOpen) ? 'none' : 'auto'
            }}
            // Using srcDoc instead of src for enhanced security
          />
          {showDebugPanel && process.env.NODE_ENV === 'development' && (
            <div className="bg-background/80 absolute bottom-0 right-0 m-2 rounded p-2 text-xs shadow">
              <div>Injected bytes: {injectedBytes}</div>
              <div>Loading: {String(isLoading)}</div>
              <div>Blob URL: {blobUrlRef.current ? 'yes' : 'no'}</div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Sharing Modal */}
      {featureFlags.resourceSharing && showSharingModal && sharingOrganization && appletId && currentUserId && tenantId && (
        <SharingModal
          isOpen={showSharingModal}
          onClose={async () => {
            setShowSharingModal(false);
            
            // Notify bot that share dialog was closed
            const roomUrl = voiceRoomUrl || (typeof window !== 'undefined' ? sessionStorage.getItem('dailyRoomUrl') : null);
            if (roomUrl && tenantId) {
              try {
                await fetch('/api/bot/admin', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-room-url': roomUrl,
                  },
                  body: JSON.stringify({
                    message: 'Share dialog closed.',
                    mode: 'queued',
                    tenantId,
                    roomUrl: roomUrl,
                    sessionId: resolvedSessionId,
                  }),
                });
              } catch (error) {
                // Silently fail - not critical if bot notification fails
                log.warn('Failed to notify bot about share dialog close', { error });
              }
            }
          }}
          organization={sharingOrganization}
          tenantId={tenantId}
          currentUserId={currentUserId}
          assistantName={agent}
          resource={{
            title: displayAppletTitle,
            type: 'HtmlGeneration',
          }}
          onSharingUpdated={() => {
            // Toast removed per user request
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteAppletModal
        isOpen={deleteModalOpen}
        onConfirm={confirmDeleteApplet}
        onCancel={cancelDelete}
        isDeleting={deletingAppletId === appletToDelete?.id}
        appletTitle={appletToDelete?.title}
      />
    </div>
  );
}

export function useHtmlContentViewer() {
  const [content, setContent] = useState<{
    title: string;
    html: string;
    css?: string;
    js?: string;
    type: 'game' | 'app' | 'tool' | 'interactive';
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const showContent = (c: {
    title: string;
    html: string;
    css?: string;
    js?: string;
    type: 'game' | 'app' | 'tool' | 'interactive';
  }) => {
    setContent(c);
    setIsFullscreen(false);
  };
  const closeContent = () => setContent(null);
  const toggleFullscreen = () => setIsFullscreen(f => !f);
  return { content, isFullscreen, showContent, closeContent, toggleFullscreen };
}
