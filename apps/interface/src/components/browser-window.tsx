'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * BrowserWindow Component
 *
 * This component manages the display of various views (activities, services, speakers, etc.)
 * and includes view state persistence functionality.
 *
 * View State Persistence:
 * - Automatically saves the current view state to sessionStorage when a view is active
 * - Restores the view state when the component mounts (e.g., after sign-in)
 * - Clears saved state when the call ends or user intentionally closes a view
 * - Includes a 30-minute expiration for saved state
 * - Provides keyboard shortcut Ctrl+Shift+C to clear saved state (for testing)
 *
 * Available Views:
 * - photos, speakers, agenda, exhibitors, eventMap, registration, guests, map
 * - roomService, excursions, cruiseActivity, spaService, activity, services
 * - orderHistory, showIndividualSpeaker, showIndividualAgenda, showIndividualExhibitor
 * - showSpecificAlbum, iframeKeyword, youtube, googleDrive, gmail, notes, terminal, miniBrowser, htmlContent
 */

import { isFeatureEnabled, guardFeature } from '@nia/features';
import { DynamicContentDetailView } from '@nia/prism/core/components/DynamicContentDetailView';
import { DynamicContentListView } from '@nia/prism/core/components/DynamicContentListView';
import { Square, X } from 'lucide-react';
import { usePostHog } from 'posthog-js/react';
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';

import { useUI } from '@interface/contexts/ui-context';
import { useUserProfile } from '@interface/contexts/user-profile-context';
import {
  NIA_EVENT_ALL,
  NIA_EVENT_WINDOW_MAXIMIZE,
  NIA_EVENT_WINDOW_MINIMIZE,
  NIA_EVENT_WINDOW_RESET,
  NIA_EVENT_WINDOW_RESTORE,
  NIA_EVENT_WINDOW_SNAP_LEFT,
  NIA_EVENT_WINDOW_SNAP_RIGHT,
  NIA_EVENT_APP_OPEN,
  NIA_EVENT_APPS_CLOSE,
  NIA_EVENT_BROWSER_OPEN,
  NIA_EVENT_BROWSER_CLOSE,
  NIA_EVENT_VIEW_CLOSE,
  NIA_EVENT_DESKTOP_MODE_SWITCH,
  NIA_EVENT_HTML_GENERATION_REQUESTED,
  NIA_EVENT_HTML_MODIFICATION_REQUESTED,
  NIA_EVENT_HTML_ROLLBACK_REQUESTED,
  NIA_EVENT_HTML_UPDATED,
  NIA_EVENT_YOUTUBE_SEARCH,
  NIA_EVENT_NOTE_OPEN,
  NIA_EVENT_NOTES_LIST,
  NIA_EVENT_APPLET_OPEN,
  NIA_EVENT_APPLET_REFRESH,
  NIA_EVENT_ONBOARDING_COMPLETE,
  NIA_EVENT_SPRITE_OPEN,
  NIA_EVENT_CANVAS_RENDER,
  NIA_EVENT_CANVAS_CLEAR,
  type NiaEventDetail,
} from '@interface/features/DailyCall/events/niaEventRouter';
import { getDailyRoomUrl } from '@interface/features/DailyCall/lib/config';
import GmailViewWithAuth from '@interface/features/Gmail/components/GmailViewWithAuth';
import GoogleDriveView from '@interface/features/GoogleDrive/components/GoogleDriveView';
// HtmlContentViewer moved into HtmlGeneration feature
import { AppletNameConfirmationModal } from '@interface/features/HtmlGeneration/components/AppletNameConfirmationModal';
import { renderCreativeModePlaceholder } from '@interface/features/HtmlGeneration/components/CreativeModePlaceholder';
import { addActiveGenerationCall, removeActiveGenerationCall, useGlobalHtmlGenerationState } from '@interface/features/HtmlGeneration/components/GlobalHtmlGenerationStatus';
import { HtmlContentViewer } from '@interface/features/HtmlGeneration/components/HtmlContentViewer';
import {
  ManeuverableWindowControls,
  registerManeuverableWindowShortcuts,
  WindowLayout,
} from '@interface/features/ManeuverableWindow';
import {
  requestWindowOpen,
  requestWindowClose,
  WINDOW_OPEN_EVENT,
  WINDOW_CLOSE_EVENT,
  type WindowOpenRequest,
  type WindowCloseRequest,
} from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import EnhancedMiniBrowserView from '@interface/features/MiniBrowser/components/EnhancedMiniBrowserView';
import MiniBrowserView from '@interface/features/MiniBrowser/components/MiniBrowserView';
import { UniversalCanvas } from '@interface/components/canvas';
import { ErrorBoundary } from '@interface/components/ErrorBoundary';
import NotesView from '@interface/features/Notes/components/notes-view-next';
import PhotoMagicView from '@interface/features/PhotoMagic/components/PhotoMagicView';
import FilesView from '@interface/features/Files/components/FilesView';
import SpritesApp from '@interface/features/Sprites/SpritesApp';
import TerminalView from '@interface/features/Terminal/components/TerminalView';
import YouTubeViewWrapper from '@interface/features/YouTube/components/YouTubeViewWrapper';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { useToast } from '@interface/hooks/use-toast';
import { getClientLogger } from '@interface/lib/client-logger';
import { useLLMMessaging } from '@interface/lib/daily/hooks/useLLMMessaging';
import { trackSessionHistory } from '@interface/lib/session-history';
import type { VoiceParametersInput } from '@interface/lib/voice/kokoro';
import { DesktopMode, type DesktopModeSwitchResponse } from '@interface/types/desktop-modes';


type VoiceParameters = VoiceParametersInput & {
  maxCallDuration?: number;
  participantLeftTimeout?: number;
  participantAbsentTimeout?: number;
  enableRecording?: boolean;
  enableTranscription?: boolean;
  applyGreenscreen?: boolean;
};

interface BrowserWindowProps {
  assistantName: string;
  tenantId: string;
  isAdmin?: boolean;
  voiceId?: string;
  voiceProvider?: string;
  personalityId?: string;
  persona?: string;
  voiceParameters?: VoiceParameters;
  supportedFeatures: string[];
  initialRoomUrl?: string;
  modePersonalityVoiceConfig?: Record<string, any>;
  dailyCallPersonalityVoiceConfig?: Record<string, any>;
  sessionOverride?: Record<string, any>;
}

// Controls whether the assistant sends verbal acknowledgements for window actions.
// Keep this conservative to avoid chatter in normal flows.
const SEND_ACKNOWLEDGEMENT = false;

type WindowAutomationAction = 'minimize' | 'maximize' | 'restore' | 'snapLeft' | 'snapRight' | 'reset';

const WINDOW_DISABLED_MESSAGE = 'Window automation feature is currently disabled.';

const WINDOW_ACK_MESSAGES: Record<WindowAutomationAction, string> = {
  minimize: 'Window minimized.',
  maximize: 'Window maximized.',
  restore: 'Window restored.',
  snapLeft: 'Snapped window to the left.',
  snapRight: 'Snapped window to the right.',
  reset: 'Window centered.',
};

const DEFAULT_YOUTUBE_QUERY = 'lofi hip hop radio - beats to relax/study to';

const CREATION_ENGINE_PLACEHOLDER_HTML = renderCreativeModePlaceholder();

const logger = getClientLogger('[browser_window]');

const toMeta = (items: unknown[]): Record<string, unknown> | undefined => {
  if (!items.length) return undefined;
  if (items.length === 1) {
    const [only] = items;
    if (only && typeof only === 'object') {
      return only as Record<string, unknown>;
    }
    return { value: only };
  }
  return { values: items };
};

const log = {
  debug: (message: string, ...meta: unknown[]) => logger.debug(message, toMeta(meta)),
  info: (message: string, ...meta: unknown[]) => logger.info(message, toMeta(meta)),
  warn: (message: string, ...meta: unknown[]) => logger.warn(message, toMeta(meta)),
  error: (message: string, ...meta: unknown[]) => logger.error(message, toMeta(meta)),
};

const BrowserWindow = ({
  assistantName,
  tenantId,
  isAdmin,
  supportedFeatures,
  voiceId,
  voiceProvider,
  personalityId,
  persona,
  voiceParameters,
  initialRoomUrl,
  modePersonalityVoiceConfig,
  dailyCallPersonalityVoiceConfig,
  sessionOverride,
}: BrowserWindowProps) => {
  const { refresh: refreshMetadata } = useUserProfile();
  
  // Memoize DailyCallView to prevent unmounting on re-renders
  const DailyCallViewComponent = useMemo(() => {
    if (isFeatureEnabled('dailyCall', supportedFeatures)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { DailyCallView } = require('../features/DailyCall');
        return DailyCallView;
      } catch (e) {
        console.error('Failed to load DailyCallView', e);
        return null;
      }
    }
    return null;
  }, [supportedFeatures]);

  const posthog = usePostHog();

  // Listen for onboarding toggle events
  useEffect(() => {
    const handleOnboardingUpdate = () => {
      refreshMetadata();
    };

    window.addEventListener(NIA_EVENT_ONBOARDING_COMPLETE, handleOnboardingUpdate);
    return () => window.removeEventListener(NIA_EVENT_ONBOARDING_COMPLETE, handleOnboardingUpdate);
  }, [refreshMetadata]);

  const [dailyRoomUrl, setDailyRoomUrl] = useState(initialRoomUrl || '');
  const [status, setStatus] = useState<boolean>(false);
  const [wasMinimized, setWasMinimized] = useState<boolean>(false);
  const [windowLayout, setWindowLayout] = useState<WindowLayout>('normal');
  // Mobile detection: reactive to viewport resize
  const [isMobileView, setIsMobileView] = useState<boolean>(false);
  const {
    setIsBrowserWindowVisible,
    setBrowserWindowRect,
    setIsBrowserWindowMaximized,
    setIsContentActive,
    setIsDailyCallActive,
    setIsNotesWindowOpen,
    isChatMode,
    isDailyCallActive,
  } = useUI();
  const windowRef = useRef<HTMLDivElement>(null);
  const lastWindowRectRef = useRef<DOMRect | null>(null);
  const isDailyCallActiveRef = useRef(false);
  const isChatModeRef = useRef(isChatMode);
  const resolvedVoiceId = voiceId || 'P7x743VjyZEOihNNygQ9';
  const resolvedVoiceProvider = voiceProvider || '11labs';
  const { sendMessage } = useLLMMessaging();
  const [lastYoutubeQuery, setLastYoutubeQuery] = useState<string | null>(null);

  // Track mobile viewport — reactive to resize
  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!initialRoomUrl) return;
    setDailyRoomUrl(current => (current === initialRoomUrl ? current : initialRoomUrl));
  }, [initialRoomUrl]);

  useEffect(() => {
    // Pick up a shared DailyCall room URL stored during share-link redemption without
    // exposing it in the URL. Clear the markers after consumption to avoid reuse.
    try {
      const sharedAssistant = sessionStorage.getItem('dailySharedAssistant');
      const sharedRoomUrl = sessionStorage.getItem('dailySharedRoomUrl');
      if (sharedRoomUrl && sharedAssistant === assistantName) {
        setDailyRoomUrl(current => (current === sharedRoomUrl ? current : sharedRoomUrl));
      }
    } catch (_) {
      // ignore storage issues
    }
  }, [assistantName]);

  useEffect(() => {
    if (dailyRoomUrl) return;

    let cancelled = false;

    void getDailyRoomUrl().then(url => {
      if (cancelled || !url) return;
      setDailyRoomUrl(url);
    }).catch(err => {
      log.error('[BrowserWindow] Failed to resolve Daily room URL', err);
    });

    return () => {
      cancelled = true;
    };
  }, [dailyRoomUrl]);

  // Use a ref to avoid re-registering event listeners when sendMessage changes
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);
  // Sync call/chat state refs for event listener closures
  useEffect(() => { isChatModeRef.current = isChatMode; }, [isChatMode]);
  useEffect(() => { isDailyCallActiveRef.current = isDailyCallActive; }, [isDailyCallActive]);

  const [showView, setShowView] = useState<
    | 'contentList'
    | 'contentDetail'
    | 'youtube'
    | 'googleDrive'
    | 'gmail'
    | 'notes'
    | 'terminal'
    | 'files'
    | 'miniBrowser'
    | 'enhancedBrowser'
    | 'htmlContent'
    | 'canvas'
    | 'modelSelector'
    | 'dailyCall'
    | 'photoMagic'
    | 'sprites'
    | null
  >(null);

  // (Removed legacy "isContentActive" classification. Interaction is now controlled
  // solely by window visibility; see pointer-events notes.)

  useEffect(() => {
    setIsBrowserWindowVisible(status);
    setIsBrowserWindowMaximized(
      status && (windowLayout === 'maximized' || windowLayout === 'right')
    );
    if (status && windowRef.current) {
      const rect = windowRef.current.getBoundingClientRect();
      lastWindowRectRef.current = rect;
      setBrowserWindowRect(rect);
    } else {
      if (lastWindowRectRef.current) {
        setBrowserWindowRect(lastWindowRectRef.current);
      } else {
        setBrowserWindowRect(null);
      }
    }
  }, [
    status,
    windowLayout,
    setIsBrowserWindowVisible,
    setBrowserWindowRect,
    setIsBrowserWindowMaximized,
  ]);

  // Track Daily Call specific state
  useEffect(() => {
    setIsDailyCallActive(status && showView === 'dailyCall');
  }, [status, showView, setIsDailyCallActive]);

  // Legacy isContentActive updater removed. We intentionally no-op here.
  useEffect(() => {}, [status, showView, setIsContentActive]);

  const [contentType, setContentType] = useState<string | null>(null);
  const [contentId, setContentId] = useState<string | null>(null);
  const [contentQuery, setContentQuery] = useState<object | null>(null);
  const [youtubeQuery, setYoutubeQuery] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string>('https://www.google.com');

  const [enhancedBrowserUrl, setEnhancedBrowserUrl] = useState<string>('https://www.google.com');
  const [enhancedKey, setEnhancedKey] = useState<number>(0);

  // HTML Generation state
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const { activeCalls: activeHtmlGenerationCalls } = useGlobalHtmlGenerationState();
  
  // Name confirmation modal state
  const [showNameConfirmationModal, setShowNameConfirmationModal] = useState(false);
  const [pendingCreationRequest, setPendingCreationRequest] = useState<any>(null);
  const [suggestedAppletName, setSuggestedAppletName] = useState<string>('');
  
  // HTML Content state (include id for applet selector support)
  const [appletsRefreshTrigger, setAppletsRefreshTrigger] = useState(0);
  const [htmlContentData, setHtmlContentData] = useState<{
    id: string;
    title: string;
    htmlContent: string;
    contentType: 'game' | 'app' | 'tool' | 'interactive';
    cssContent?: string;
    jsContent?: string;
  } | null>(null);
  const [isHtmlContentFullscreen, setIsHtmlContentFullscreen] = useState(false);

  // Multi-window state
  const [openWindows, setOpenWindows] = useState<any[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const openWindowsRef = useRef<any[]>([]);
  const htmlContentWindowCount = React.useMemo(
    () => openWindows.filter(window => window.viewType === 'htmlContent').length,
    [openWindows]
  );
  const prevHtmlContentWindowCountRef = useRef<number>(htmlContentWindowCount);
  const creativeLoadAbortRef = useRef<AbortController | null>(null);
  const creativeLoadActiveRef = useRef(false);
  const [isSingletonActive, setIsSingletonActive] = useState(true);
  const instanceId = useRef(`browser-window-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`).current;

  const calculateGridPosition = React.useCallback((windowIndex: number, totalWindows: number): GridPosition => {
    log.info(`📐 [GRID-POSITION] Calculating position for window ${windowIndex + 1}/${totalWindows}`);
    
    if (totalWindows === 1) {
      log.info(`📐 [GRID-POSITION] → Single window: fullscreen`);
      return 'full';
    }
    
    if (totalWindows === 2) {
      const isMobile = isMobileDevice();
      const position = isMobile 
        ? (windowIndex === 0 ? 'top' : 'bottom')  // Mobile: vertical stack
        : (windowIndex === 0 ? 'left' : 'right'); // Desktop: horizontal split
      log.info(`📐 [GRID-POSITION] → 2-window grid (${isMobile ? 'mobile' : 'desktop'}): ${position} half`);
      return position;
    }
    
    if (totalWindows === 3) {
      const isMobile = isMobileDevice();
      let position: GridPosition;
      
      if (isMobile) {
        // Mobile: Stack all 3 windows vertically
        const mobilePositions: GridPosition[] = ['top-third', 'middle-third', 'bottom-third'];
        position = mobilePositions[windowIndex];
        log.info(`📐 [GRID-POSITION] → 3-window grid (mobile): ${position}`);
      } else {
        // Desktop: 1 left + 2 right stacked
        if (windowIndex === 0) {
          position = 'left-full';
          log.info(`📐 [GRID-POSITION] → 3-window grid (desktop): left full-height`);
        } else {
          position = windowIndex === 1 ? 'top-right' : 'bottom-right';
          log.info(`📐 [GRID-POSITION] → 3-window grid (desktop): ${position} quadrant`);
        }
      }
      return position;
    }
    
    if (totalWindows === 4) {
      const positions: GridPosition[] = ['top-left', 'top-right-quad', 'bottom-left', 'bottom-right-quad'];
      const position = positions[windowIndex];
      log.info(`📐 [GRID-POSITION] → 4-window grid: ${position} quadrant`);
      return position;
    }
    
    log.info(`📐 [GRID-POSITION] → Default: fullscreen`);
    return 'full';
  }, []);
  
  
  // Sync openWindows state with ref
  useEffect(() => {
    const cancelCreativeLoad = () => {
      creativeLoadActiveRef.current = false;
      if (creativeLoadAbortRef.current) {
        creativeLoadAbortRef.current.abort();
        creativeLoadAbortRef.current = null;
      }
    };
    window.addEventListener('creativeMode:cancel-loading', cancelCreativeLoad);
    return () => {
      window.removeEventListener('creativeMode:cancel-loading', cancelCreativeLoad);
    };
  }, []);

  useEffect(() => {
    openWindowsRef.current = openWindows;
  }, [openWindows]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const previousCount = prevHtmlContentWindowCountRef.current;
    if (htmlContentWindowCount > 0 && previousCount === 0) {
      window.dispatchEvent(
        new CustomEvent('creativeMode:engine-opened', {
          detail: { count: htmlContentWindowCount },
        })
      );
    } else if (htmlContentWindowCount === 0 && previousCount > 0) {
      window.dispatchEvent(
        new CustomEvent('creativeMode:engine-closed', {
          detail: { count: previousCount },
        })
      );
    }
    prevHtmlContentWindowCountRef.current = htmlContentWindowCount;
  }, [htmlContentWindowCount]);

  // Track notes window state and update UI context
  // IMPORTANT: We only treat "notes window open" as true when Notes is the *only* window.
  // In multi-view (2+ windows), the avatar/pearl button should stay in its normal position,
  // especially on mobile, so we do NOT flip the notes-open layout flags there.
  useEffect(() => {
    const notesWindows = openWindows.filter(window => window.viewType === 'notes');
    const isSingletonNotesWindow =
      notesWindows.length === 1 && openWindows.length === 1;

    setIsNotesWindowOpen(isSingletonNotesWindow);
  }, [openWindows, setIsNotesWindowOpen]);

  // Recalculate window positions on resize (only when 2+ windows)
  useEffect(() => {
    if (openWindows.length < 1) return; // Optimization: only needed for 2+ windows
    
    const handleResize = () => {
      setOpenWindows(prevWindows => {
        const recalculated = prevWindows.map((window, index) => ({
          ...window,
          gridPosition: calculateGridPosition(index, prevWindows.length),
        }));
        log.info('📱 [RESIZE] Recalculated window positions for screen size change');
        return recalculated;
      });
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [openWindows.length, calculateGridPosition]);

  // Known view types for multi-window system
  const knownViewTypes = React.useMemo(
    () =>
      new Set([
        'youtube',
        'googleDrive',
        'gmail',
        'notes',
        'terminal',
        'files',
        'miniBrowser',
        'enhancedBrowser',
        'htmlContent',
        'canvas',
        'dailyCall',
        'contentList',
        'contentDetail',
        'photoMagic',
        'sprites',
      ]),
    []
  );

  // Reset all view state
  const resetViewState = useCallback(() => {
    setContentType(null);
    setContentId(null);
    setContentQuery(null);
    setYoutubeQuery(null);
    setBrowserUrl('https://www.google.com');
    setHtmlContentData(null);
    setIsHtmlContentFullscreen(false);
  }, []);

  const handleWindowAutomation = useCallback(
    (action: WindowAutomationAction) => {
      posthog?.capture('window_automation_action', { action });
      guardFeature(
        'maneuverableWindow',
        () => {
          sendMessage({
            content: WINDOW_DISABLED_MESSAGE,
            role: 'system',
            mode: 'queued'
          });
        },
        () => {
          switch (action) {
            case 'minimize':
              setStatus(false);
              setWasMinimized(true);
              break;
            case 'maximize':
              setStatus(true);
              setWasMinimized(false);
              setWindowLayout('maximized');
              break;
            case 'restore':
              setStatus(true);
              setWasMinimized(false);
              setWindowLayout('normal');
              break;
            case 'snapLeft':
              setStatus(true);
              setWasMinimized(false);
              setWindowLayout('left');
              break;
            case 'snapRight':
              setStatus(true);
              setWasMinimized(false);
              setWindowLayout('right');
              break;
            case 'reset':
              setStatus(true);
              setWasMinimized(false);
              setWindowLayout('normal');
              break;
            default:
              break;
          }

          if (SEND_ACKNOWLEDGEMENT) {
            const ackContent = WINDOW_ACK_MESSAGES[action];
            if (ackContent) {
              sendMessage({
                content: ackContent,
                role: 'system',
                mode: 'queued'
              });
            }
          }
        },
        supportedFeatures
      );
    },
    [supportedFeatures, setStatus, setWasMinimized, setWindowLayout, sendMessage]
  );

  // Handler for name confirmation (from modal or voice)
  const handleNameConfirmation = useCallback(async (confirmedName: string) => {
    if (!pendingCreationRequest) return;
    
    log.info('✅ Name confirmed:', confirmedName);
    setShowNameConfirmationModal(false);
    
    // Show loader
    const uniqueCallId = `confirmed-creation-${Date.now()}`;
    addActiveGenerationCall(uniqueCallId);
    
    try {
      // Get current model selection
      const provider = sessionStorage.getItem('taskbar_selected_provider') || 'anthropic';
      const model = sessionStorage.getItem('taskbar_selected_model') || 'claude-opus-4-1-20250805';
      
      // Retrieve auto-linked note if available
      let sourceNoteId: string | undefined;
      let sourceNoteTitle: string | undefined;
      
      if (typeof sessionStorage !== 'undefined') {
        try {
          const lastNoteStr = sessionStorage.getItem('lastReadNote');
          if (lastNoteStr) {
            const lastNote = JSON.parse(lastNoteStr);
            const noteAge = Date.now() - (lastNote.timestamp || 0);
            if (noteAge < 30000) {
              sourceNoteId = lastNote._id;
              sourceNoteTitle = lastNote.title;
            }
          }
      } catch (_) {
          // ignore
        }
      }
      
      const payload = {
        ...pendingCreationRequest,
        title: confirmedName,
        userProvidedName: confirmedName,
        aiProvider: provider,
        aiModel: model,
        agent: assistantName,
        sourceNoteId: pendingCreationRequest.sourceNoteId || sourceNoteId,
        metadata: {
          ...(sourceNoteId ? { sourceNoteId, sourceNoteTitle } : {}),
          ...(pendingCreationRequest.metadata || {})
        }
      };
      
      const response = await fetch('/api/create-html-content', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(payload.roomUrl ? { 'x-room-url': payload.roomUrl } : {}),
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.data && result.data.jobId) {
        log.info('🎯 Starting async generation with confirmed name');
        // Persist jobId for recovery
        localStorage.setItem(`nia_pending_job_${uniqueCallId}`, result.data.jobId);
        pollForCompletion(result.data.jobId, uniqueCallId, localStorage.getItem('callId') || 'unknown');
      } else {
        throw new Error(result.message || 'Failed to start creation');
      }
    } catch (error) {
      log.error('❌ Creation with confirmed name failed:', error);
      removeActiveGenerationCall(uniqueCallId);
      sendMessage({
        content: `Sorry, I had trouble creating your ${pendingCreationRequest.contentType}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        role: 'system',
        mode: 'immediate'
      });
    } finally {
      setPendingCreationRequest(null);
    }
  }, [pendingCreationRequest, assistantName, sendMessage]);

  // Polling function for async HTML generation
  const pollForCompletion = useCallback(async (jobId: string, uniqueCallIdentifier: string, callId: string) => {
    const pollInterval = 2000; // Poll every 2 seconds
    const maxDuration = 600000; // 10 minutes max
    const startTime = Date.now();

    const poll = async () => {
      try {
        if (Date.now() - startTime > maxDuration) {
          log.warn(`⏰ Polling timeout for job ${jobId}`);
          removeActiveGenerationCall(uniqueCallIdentifier);
          localStorage.removeItem(`nia_pending_job_${uniqueCallIdentifier}`);
          return;
        }

        const response = await fetch('/api/html-generation/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId: jobId })
        });

        if (!response.ok) {
          throw new Error(`Status check failed: ${response.status}`);
        }

        const statusResult = await response.json();
        
        if (process.env.DEBUG_HTML === 'true') {
          log.info(`📊 [${callId}] Status check for job ${jobId}:`, statusResult);
        }

        if (statusResult.success && statusResult.data) {
          const { isComplete, error, htmlGeneration } = statusResult.data;

          if (isComplete) {
            if (error) {
              log.error(`❌ [${callId}] Generation failed for job ${jobId}:`, error);
              removeActiveGenerationCall(uniqueCallIdentifier);
              localStorage.removeItem(`nia_pending_job_${uniqueCallIdentifier}`);
              throw new Error(error);
            }

            if (htmlGeneration) {
              log.info(`✅ [${callId}] Generation completed for job ${jobId}`);
              const metadata = (htmlGeneration as any)?.metadata ?? {};
              const loggedProvider = metadata.aiProvider ?? 'unknown';
              const loggedModel = metadata.aiModel ?? 'unknown';
              const loggedReasoningEffort =
                metadata.reasoningEffort ?? metadata.reasoning_effort;
              const loggedFallback =
                metadata.usedFallback ?? metadata.used_fallback ?? false;
              log.info(
                `[BrowserWindow] Creation engine completed with provider=${loggedProvider}, model=${loggedModel}${
                  loggedReasoningEffort ? `, reasoning.effort=${loggedReasoningEffort}` : ''
                }${loggedFallback ? ' (fallback used)' : ''}`
              );
              
              // Set the HTML content data and show the viewer
              setHtmlContentData({
                id: htmlGeneration._id || htmlGeneration.id || 'generated',
                title: htmlGeneration.title,
                htmlContent: htmlGeneration.htmlContent,
                contentType: htmlGeneration.contentType || 'interactive',
                cssContent: htmlGeneration.cssContent,
                jsContent: htmlGeneration.jsContent,
              });
              setShowView('htmlContent');
              setStatus(true);

              // Clean up active calls
              removeActiveGenerationCall(uniqueCallIdentifier);
              localStorage.removeItem(`nia_pending_job_${uniqueCallIdentifier}`);

              return; // Stop polling
            }
          }
        }

        // Continue polling if not complete
        setTimeout(poll, pollInterval);
      } catch (error) {
        log.error(`💥 [${callId}] Polling error for job ${jobId}:`, error);
        removeActiveGenerationCall(uniqueCallIdentifier);
        localStorage.removeItem(`nia_pending_job_${uniqueCallIdentifier}`);
      }
    };

    // Start polling
    poll();
  }, [setHtmlContentData, setShowView, setStatus]);

  // HTML Content state (enhanced)
  const { toast } = useToast();
  const { data: session } = useResilientSession();
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);
  // Keep isAdmin as provided by server/state; do not override here to avoid mid-render flips.
  
  // Daily Call state - use a ref to check if call is active (safer than context in tests)
  const isDailyCallJoinedRef = useRef(false);
  
  useEffect(() => {
    const handleJoined = () => {
      isDailyCallJoinedRef.current = true;
      log.info('📞 [DAILY-CALL-PROTECTION] Call joined - close protection enabled');
    };
    const handleLeft = () => {
      isDailyCallJoinedRef.current = false;
      log.info('📞 [DAILY-CALL-PROTECTION] Call left - close protection disabled');
    };
    
    window.addEventListener('dailyCall.joined', handleJoined);
    window.addEventListener('dailyCall.left', handleLeft);
    
    return () => {
      window.removeEventListener('dailyCall.joined', handleJoined);
      window.removeEventListener('dailyCall.left', handleLeft);
    };
  }, []);

  // Listen for personality changes from PersonalitySelector
  useEffect(() => {
    const handlePersonalityChanged = (event: Event) => {
      const customEvent = event as CustomEvent;
      const config = customEvent.detail;
      log.info('🎭 [PERSONALITY] Personality changed:', config);
      
      // TODO: Phase 5 - Notify voice session of personality change
      // This will trigger voice reconfiguration during active calls
    };
    
    window.addEventListener('personalityChanged', handlePersonalityChanged);
    
    return () => {
      window.removeEventListener('personalityChanged', handlePersonalityChanged);
    };
  }, []);

  // Guard against duplicate rapid Daily call start requests (partial/final transcript triggering twice)
  const lastDailyCallStartRef = useRef<number | null>(null);

  const seatrade =
    assistantName === 'seatrade' ||
    assistantName === 'paddytest' ||
    assistantName === 'seatrade-jdx';
  // (moved session hook higher for html content admin logic)

  // handleModelSelection function removed - using session storage instead

  const resolveYoutubeQuery = React.useCallback(
    (incomingQuery?: string | null, allowDefault = false): string => {
      const trimmed = (incomingQuery ?? '').trim();
      if (trimmed) {
        // If a prior explicit query exists, avoid reverting to the default phrase.
        if (trimmed === DEFAULT_YOUTUBE_QUERY && lastYoutubeQuery) {
          return lastYoutubeQuery;
        }
        setLastYoutubeQuery(trimmed);
        return trimmed;
      }

      if (lastYoutubeQuery) return lastYoutubeQuery;

      if (allowDefault) {
        setLastYoutubeQuery(DEFAULT_YOUTUBE_QUERY);
        return DEFAULT_YOUTUBE_QUERY;
      }

      return '';
    },
    [lastYoutubeQuery]
  );

  // Handler for opening content detail view in lifecycle controller
  const handleContentClick = (item: Record<string, unknown>) => {
    requestWindowOpen({
      viewType: 'contentDetail',
      viewState: {
        contentId: item._id as string,
        contentType: contentType || undefined,
        contentQuery: undefined,
      },
      source: 'ui:content-detail-click',
      options: { allowDuplicate: false },
    });
  };

  // Add new helper function for handling feedback
  // NOTE: Currently unused but kept for future feedback system implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleAssistantFeedback = async (feedback: { description: string }) => {
    try {
      const callId = localStorage.getItem('callId');

      log.info('🎯 Logging feedback:', {
        assistant: assistantName,
        callId: callId,
        feedback: feedback.description,
      });

      // TODO: call contentDetail / contentList here instead if possible
      const response = await fetch(`/api/log-assistant-feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent: assistantName,
          description: feedback.description,
          callId: callId || 'unknown',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        log.error('Server error:', errorData);
        throw new Error(errorData.message || 'Failed to log feedback');
      }

      const data = await response.json();

      if (data.success) {
        log.info('✅ Feedback recorded:', feedback.description);
        if (SEND_ACKNOWLEDGEMENT) {
          sendMessage({
            content: "Thank you for your feedback. I'll make sure to improve.",
            role: 'system',
            mode: 'queued'
          });
        }
      }
    } catch (error) {
      log.error('❌ Error logging feedback:', error);
      if (SEND_ACKNOWLEDGEMENT) {
        sendMessage({
          content: 'Sorry, I had trouble recording your feedback.',
          role: 'system',
          mode: 'queued'
        });
      }
    }
  };

  // ============================================================================
  // MULTI-WINDOW HELPER FUNCTIONS
  // ============================================================================
  
  // Import types for clarity
  type ViewType = import('@interface/features/ManeuverableWindow/types/maneuverable-window-types').ViewType;
  type WindowInstance = import('@interface/features/ManeuverableWindow/types/maneuverable-window-types').WindowInstance;
  type GridPosition = import('@interface/features/ManeuverableWindow/types/maneuverable-window-types').GridPosition;

  // Generate unique window ID
  const generateWindowId = () => `window-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Calculate grid position based on window count and index
  // Mobile detection utility
  const isMobileDevice = (): boolean => {
    if (typeof window === 'undefined') return false;
    // Check for mobile device based on screen width (phones typically < 768px)
    return window.innerWidth < 768;
  };

  // Recalculate all window positions when windows array changes
  const recalculateWindowPositions = React.useCallback((windows: WindowInstance[]): WindowInstance[] => {
    return windows.map((window, index) => ({
      ...window,
      gridPosition: calculateGridPosition(index, windows.length),
    }));
  }, [calculateGridPosition]);

  // Add new window (with optional duplicate check)
  const focusExistingWindow = React.useCallback((windowId: string) => {
    setActiveWindowId(windowId);
    setStatus(true);
    setWasMinimized(false);
    log.info(`🎯 [FOCUS-WINDOW] Focused existing window: ${windowId}`);
  }, [setActiveWindowId, setStatus, setWasMinimized]);

  const addWindow = React.useCallback((viewType: ViewType, viewState?: WindowInstance['viewState'], options?: { allowDuplicate?: boolean }) => {
    let newWindowId: string | null = null;
    let existingWindowId: string | null = null;
    
    setOpenWindows(prevWindows => {
      log.info('🪟 [ADD-WINDOW] Attempting to add:', { viewType, viewState, currentWindowCount: prevWindows.length });
      
      // Check for existing window of same type (unless duplicates allowed)
      // Use functional update to ensure we check the most recent state
      if (!options?.allowDuplicate) {
        const existing = prevWindows.find(w => {
          // Basic type match
          if (w.viewType !== viewType) return false;
          
          // For htmlContent windows, also check if it's the same content by ID
          if (viewType === 'htmlContent' && viewState?.htmlContentData?.id && w.viewState?.htmlContentData?.id) {
            return w.viewState.htmlContentData.id === viewState.htmlContentData.id;
          }
          // For other types, just match by type
          return true;
        });
        if (existing) {
          log.info('🪟 [ADD-WINDOW] Window already exists, updating instead:', { id: existing.id, viewType });
          existingWindowId = existing.id;
          // Update the existing window's viewState instead of creating a new one
          // For enhancedBrowser, increment enhancedKey to force remount with new URL
          const updates: Partial<WindowInstance['viewState']> = { ...viewState };
          if (viewType === 'enhancedBrowser') {
            const currentKey = existing.viewState?.enhancedKey ?? 0;
            updates.enhancedKey = currentKey + 1;
          }
          return prevWindows.map(w => 
            w.id === existing.id 
              ? { ...w, viewState: { ...w.viewState, ...updates } }
              : w
          );
        }
      }
      
      // Maximum 4 windows
      if (prevWindows.length >= 4) {
        log.warn('⚠️ [ADD-WINDOW] Maximum windows reached (4/4)');
        toast({
          title: 'Maximum Windows Reached',
          description: 'You can only have 4 apps open simultaneously. Close one to open another.',
          variant: 'destructive',
        } as any);
        return prevWindows; // Return unchanged
      }
      
      const newWindow: WindowInstance = {
        id: generateWindowId(),
        viewType,
        gridPosition: 'full', // Will be recalculated
        zIndex: prevWindows.length,
        viewState: viewState || {},
      };
      
      // FIX: Capture newWindowId outside the state updater so it's accessible after
      newWindowId = newWindow.id;
      
      log.info('🪟 [ADD-WINDOW] Created new window:', newWindow);
      posthog?.capture('window_opened', { viewType, windowId: newWindowId, totalWindows: prevWindows.length + 1 });
      
      const updatedWindows = recalculateWindowPositions([...prevWindows, newWindow]);
      log.info('🪟 [ADD-WINDOW] Recalculated positions:', updatedWindows.map(w => ({ id: w.id, viewType: w.viewType, position: w.gridPosition })));
      log.info('✅ [ADD-WINDOW] Successfully added window. New count:', updatedWindows.length);
      
      return updatedWindows;
    });
    
    // Set active window ID (either new or existing)
    if (newWindowId) {
      focusExistingWindow(newWindowId);
      log.info(`✅ [ADD-WINDOW] Set status=true and activeWindowId=${newWindowId}`);
    } else if (existingWindowId) {
      focusExistingWindow(existingWindowId);
      log.info(`🪟 [ADD-WINDOW] ${viewType} already open, focusing existing window ${existingWindowId}`);
    }
  }, [focusExistingWindow, recalculateWindowPositions, toast]);

  // Remove window
  const removeWindow = React.useCallback(
    (windowId: string, options?: { suppressStandaloneReset?: boolean }) => {
    let shouldHideContainer = false;
    let newActiveId: string | null = null;
    
    setOpenWindows(prevWindows => {
      const windowToRemove = prevWindows.find(w => w.id === windowId);
      log.info('🪟 [REMOVE-WINDOW] Removing window', {
        event: 'window_remove',
        windowId,
        viewType: windowToRemove?.viewType,
        isDailyCall: windowToRemove?.viewType === 'dailyCall',
        options,
        currentWindowCount: prevWindows.length,
      });
      
      const updatedWindows = prevWindows.filter(w => w.id !== windowId);
      const recalculated = recalculateWindowPositions(updatedWindows);
      
      if (activeWindowId === windowId) {
        newActiveId = recalculated[recalculated.length - 1]?.id || null;
        log.info('🪟 [REMOVE-WINDOW] Active window removed, switching to:', {
          event: 'window_remove_active_switch',
          oldActiveId: windowId,
          newActiveId,
          viewType: windowToRemove?.viewType,
        });
      }
      
      if (recalculated.length === 0) {
        shouldHideContainer = true;
        log.info('🪟 [REMOVE-WINDOW] Last window closed, hiding container', {
          event: 'window_remove_last',
          viewType: windowToRemove?.viewType,
        });
      }
      
      if (windowToRemove?.viewType === 'dailyCall') {
        log.warn('📞 [REMOVE-WINDOW] DailyCall window being removed', {
          event: 'dailycall_window_removed',
          windowId,
          remainingWindows: recalculated.length,
          options,
        });
      }
      
      log.info('✅ [REMOVE-WINDOW] Successfully removed. Remaining windows:', recalculated.length);
      posthog?.capture('window_closed', { windowId, viewType: windowToRemove?.viewType, remainingWindows: recalculated.length });
      
      return recalculated;
    });
    
    if (newActiveId !== null || (newActiveId === null && activeWindowId === windowId)) {
      setActiveWindowId(newActiveId);
    }
    
      if (shouldHideContainer && !options?.suppressStandaloneReset) {
      setStatus(false);
      setWasMinimized(false);
        setShowView(null);
        resetViewState();
      }

      return shouldHideContainer;
    },
    [activeWindowId, recalculateWindowPositions, resetViewState]
  );

  const removeAllWindows = React.useCallback(() => {
    let removedCount = 0;
    setOpenWindows(prev => {
      removedCount = prev.length;
      return [];
    });

    if (removedCount > 0) {
      setActiveWindowId(null);
      setShowView(null);
      setStatus(false);
      setWasMinimized(false);
      resetViewState();
    }

    return removedCount;
  }, [resetViewState]);

  const removeWindowsByViewTypes = React.useCallback(
    (viewTypes: ViewType[]) => {
      if (!viewTypes || viewTypes.length === 0) return 0;

      // Use ref to get the latest openWindows state (fixes stale closure)
      const currentOpenWindows = openWindowsRef.current;

      const idsToRemove = Array.from(
        new Set(
          currentOpenWindows
            .filter(window => viewTypes.includes(window.viewType))
            .map(window => window.id)
        )
      );

      if (idsToRemove.length === 0) {
        return 0;
      }

      log.info('🗑️ [REMOVE-BY-VIEWTYPE] Removing windows:', { viewTypes, idsToRemove, totalWindows: currentOpenWindows.length });

      // If closing Daily Call, trigger force close to disconnect call properly
      if (viewTypes.includes('dailyCall')) {
        try {
          window.dispatchEvent(new Event('dailyCall.forceClose'));
          log.info('📞 [REMOVE-BY-VIEWTYPE] Dispatched dailyCall.forceClose event');
        } catch (error) {
          log.warn('⚠️ [REMOVE-BY-VIEWTYPE] Error dispatching dailyCall.forceClose:', error);
        }
      }

      // CRITICAL FIX: Remove all windows in a single atomic state update to avoid race conditions
      // Previously, calling removeWindow() in a forEach caused stale state issues when closing multiple windows
      let newActiveId: string | null = null;
      
      setOpenWindows(prevWindows => {
        const updatedWindows = prevWindows.filter(w => !idsToRemove.includes(w.id));
        const recalculated = recalculateWindowPositions(updatedWindows);
        
        // If active window was removed, switch to the last remaining window
        if (idsToRemove.includes(activeWindowId || '')) {
          newActiveId = recalculated[recalculated.length - 1]?.id || null;
          log.info('🗑️ [REMOVE-BY-VIEWTYPE] Active window removed, switching to:', newActiveId);
        }
        
        log.info('🗑️ [REMOVE-BY-VIEWTYPE] Removed', idsToRemove.length, 'windows. Remaining:', recalculated.length);
        
        // CRITICAL FIX: Update ref INSIDE the state update callback to get the actual new state
        openWindowsRef.current = recalculated;
        log.info('🗑️ [REMOVE-BY-VIEWTYPE] Synced openWindowsRef immediately:', openWindowsRef.current.map(w => w.viewType));
        
        return recalculated;
      });

      // Update active window if needed
      if (newActiveId !== null) {
        setActiveWindowId(newActiveId);
      }

      const remainingCount = currentOpenWindows.length - idsToRemove.length;

      if (remainingCount <= 0) {
        log.info('🗑️ [REMOVE-BY-VIEWTYPE] All windows closed, resetting state');
        setActiveWindowId(null);
        setShowView(null);
        setStatus(false);
        setWasMinimized(false);
        resetViewState();
      } else if (showView && viewTypes.includes(showView as ViewType)) {
        const survivingWindow = currentOpenWindows.find(window => !idsToRemove.includes(window.id));
        if (survivingWindow) {
          log.info('🗑️ [REMOVE-BY-VIEWTYPE] Switching to surviving window:', survivingWindow.viewType);
          setActiveWindowId(survivingWindow.id);
          setShowView(survivingWindow.viewType);
        }
      }

      log.info('🗑️ [REMOVE-BY-VIEWTYPE] Final state - Removed:', idsToRemove.length, 'Remaining:', remainingCount);

      return idsToRemove.length;
    },
    [
      // openWindows removed - using openWindowsRef.current instead to avoid stale closures
      // isDailyCallJoinedRef not needed in deps - it's a ref that's read, not a dependency
      activeWindowId,
      recalculateWindowPositions,
      resetViewState,
      showView
    ]
  );

  const viewTypeAliasMap = React.useMemo(() => {
    const map = new Map<string, ViewType[]>();

    const addAlias = (alias: string | null | undefined, type: ViewType) => {
      if (!alias) return;
      const key = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!key) return;
      const existing = map.get(key) ?? [];
      if (!existing.includes(type)) {
        map.set(key, [...existing, type]);
      }
    };

    knownViewTypes.forEach((type: any) => {
      if (!type) return;
      addAlias(type, type);
      addAlias(type.toLowerCase(), type);
      addAlias(type.replace(/[^a-z0-9]/g, ''), type);
    });

    const aliasPairs: Array<[string, ViewType]> = [
      ['drive', 'googleDrive'],
      ['googledrive', 'googleDrive'],
      ['gdrive', 'googleDrive'],
      ['mail', 'gmail'],
      ['email', 'gmail'],
      ['notepad', 'notes'],
      ['note', 'notes'],
      ['files', 'files'],
      ['filemanager', 'files'],
      ['filebrowser', 'files'],
      ['explorer', 'files'],
      ['cmd', 'terminal'],
      ['command', 'terminal'],
      ['console', 'terminal'],
      ['shell', 'terminal'],
      ['browser', 'enhancedBrowser'],
      ['web', 'enhancedBrowser'],
      ['internet', 'enhancedBrowser'],
      ['chrome', 'enhancedBrowser'],
      ['minibrowser', 'miniBrowser'],
      ['creationengine', 'htmlContent'],
      ['creation', 'htmlContent'],
      ['applet', 'htmlContent'],
      ['canvas', 'canvas'],
      ['universalcanvas', 'canvas'],
      ['dailyroom', 'dailyCall'],
      ['daily', 'dailyCall'],
      ['meeting', 'dailyCall'],
      ['call', 'dailyCall'],
      ['conference', 'dailyCall'],
      ['videocall', 'dailyCall'],
      ['videomeeting', 'dailyCall'],
      ['social', 'dailyCall'],
      ['socialroom', 'dailyCall'],
      ['youtube', 'youtube'],
      ['content', 'contentList'],
      ['details', 'contentDetail'],
    ];

    aliasPairs.forEach(([alias, type]) => addAlias(alias, type));

    return map;
  }, [knownViewTypes]);

  const resolveViewTypesFromIdentifier = React.useCallback(
    (identifier?: string | null): ViewType[] => {
      if (!identifier) return [];
      const key = identifier.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!key) return [];
      return viewTypeAliasMap.get(key) ?? [];
    },
    [viewTypeAliasMap]
  );

  const resolveViewTypesFromText = React.useCallback(
    (text?: string | null): ViewType[] => {
      if (!text) return [];
      const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const result = new Set<ViewType>();
      tokens.forEach(token => {
        resolveViewTypesFromIdentifier(token).forEach(type => result.add(type));
      });
      return Array.from(result);
    },
    [resolveViewTypesFromIdentifier]
  );

  const attemptCloseWindows = React.useCallback(
    (
      identifiers: Array<string | null | undefined>,
      requestText?: string | null,
      options?: { allowNotesDelegate?: boolean; fallbackToCloseAll?: boolean }
    ): boolean => {
      const allowNotesDelegate = options?.allowNotesDelegate ?? true;
      const fallbackToCloseAll = options?.fallbackToCloseAll ?? false;

      // Use ref to get the latest openWindows state (fixes stale closure)
      const currentOpenWindows = openWindowsRef.current;
      
      log.info('🎯 [ATTEMPT-CLOSE] Starting close attempt:', {
        identifiers,
        requestText,
        allowNotesDelegate,
        fallbackToCloseAll,
        currentOpenWindows: currentOpenWindows.map(w => w.viewType),
      });

      const targetedViewTypes = new Set<ViewType>();
      identifiers.forEach(identifier => {
        const resolved = resolveViewTypesFromIdentifier(identifier);
        log.info(`🎯 [ATTEMPT-CLOSE] Identifier "${identifier}" resolved to:`, resolved);
        resolved.forEach(type => targetedViewTypes.add(type));
      });
      
      const textResolved = resolveViewTypesFromText(requestText);
      log.info(`🎯 [ATTEMPT-CLOSE] Request text "${requestText}" resolved to:`, textResolved);
      textResolved.forEach(type => targetedViewTypes.add(type));

      // Check for "close all/everything" keywords
      if (requestText) {
        const lowerText = requestText.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const closeAllKeywords = ['everything', 'all apps', 'all windows', 'close all', 'all of them', 'all of it'];
        const shouldCloseAll = closeAllKeywords.some(keyword => lowerText.includes(keyword));
        
        if (shouldCloseAll) {
          log.info('🎯 [ATTEMPT-CLOSE] "Close all" keyword detected - closing all windows');
          currentOpenWindows.forEach(w => targetedViewTypes.add(w.viewType));
        }
      }

      if (targetedViewTypes.size === 0) {
        log.info('🎯 [ATTEMPT-CLOSE] No targets found yet, trying fallback strategies...');
        
        if (requestText) {
          const textMatches = resolveViewTypesFromText(requestText);
          log.info('🎯 [ATTEMPT-CLOSE] Fallback: re-parsing request text:', textMatches);
          textMatches.forEach(type => targetedViewTypes.add(type));
        }

        if (targetedViewTypes.size === 0 && activeWindowId) {
          const activeWindow = currentOpenWindows.find(window => window.id === activeWindowId);
          if (activeWindow) {
            // Protect Daily Call from implicit fallback closure when call is active
            if (activeWindow.viewType === 'dailyCall' && isDailyCallJoinedRef.current) {
              log.info('🛡️ [ATTEMPT-CLOSE] Skipping fallback close for active Daily Call');
            } else {
              log.info('🎯 [ATTEMPT-CLOSE] Fallback: using active window:', activeWindow.viewType);
              targetedViewTypes.add(activeWindow.viewType);
            }
          }
        }

        if (targetedViewTypes.size === 0) {
          if (currentOpenWindows.length === 1) {
            const onlyWindow = currentOpenWindows[0];
            if (onlyWindow.viewType === 'dailyCall' && isDailyCallJoinedRef.current) {
               log.info('🛡️ [ATTEMPT-CLOSE] Skipping fallback close for single active Daily Call');
            } else {
               log.info('🎯 [ATTEMPT-CLOSE] Fallback: only one window, targeting it:', onlyWindow.viewType);
               targetedViewTypes.add(onlyWindow.viewType);
            }
          } else if (showView && knownViewTypes.has(showView as any)) {
            if (showView === 'dailyCall' && isDailyCallJoinedRef.current) {
               log.info('🛡️ [ATTEMPT-CLOSE] Skipping fallback close for showView Daily Call');
            } else {
               log.info('🎯 [ATTEMPT-CLOSE] Fallback: using showView:', showView);
               targetedViewTypes.add(showView as any);
            }
          }
        }
      }

      log.info('🎯 [ATTEMPT-CLOSE] Final targeted view types:', Array.from(targetedViewTypes));

      // CRITICAL FIX: Handle notes cleanup regardless of whether it's the only window or one of many
      if (allowNotesDelegate && targetedViewTypes.has('notes')) {
        log.info('🎯 [ATTEMPT-CLOSE] Notes window detected in target list - dispatching unsaved check');
        
        // Dispatch event to notes handler for unsaved changes check
        // This is fire-and-forget - we still proceed with removal
        try {
          window.dispatchEvent(
            new CustomEvent('notepadCommand', { detail: { action: 'attemptClose' } })
          );
        } catch (_) {
          // no-op
        }
      }

      // Remove all targeted windows (including notes if present)
      if (targetedViewTypes.size > 0) {
        log.info('🎯 [ATTEMPT-CLOSE] Removing windows by view types:', Array.from(targetedViewTypes));
        const removed = removeWindowsByViewTypes(Array.from(targetedViewTypes));
        log.info('🎯 [ATTEMPT-CLOSE] Removed count:', removed);
        if (removed > 0) {
          return true;
        }
      }

      if (fallbackToCloseAll) {
        log.info('⚠️ [ATTEMPT-CLOSE] FALLBACK TO CLOSE ALL triggered!');
        const removed = removeAllWindows();
        if (removed > 0) {
          return true;
        }
      }

      log.info('❌ [ATTEMPT-CLOSE] Failed to close any windows');
      return false;
    },
    [
      activeWindowId,
      // openWindows removed - using openWindowsRef.current instead to avoid stale closures
      removeAllWindows,
      removeWindowsByViewTypes,
      resolveViewTypesFromIdentifier,
      resolveViewTypesFromText,
      showView,
      knownViewTypes,
    ]
  );

  // Update window state
  const updateWindowState = React.useCallback((windowId: string, updates: Partial<WindowInstance['viewState']>) => {
    setOpenWindows(prev => prev.map(window => 
      window.id === windowId 
        ? { ...window, viewState: { ...window.viewState, ...updates } }
        : window
    ));
  }, []);

  // Find window by view type (for checking if view already open)
  const findWindowByViewType = React.useCallback((viewType: ViewType): WindowInstance | undefined => {
    return openWindows.find(w => w.viewType === viewType);
  }, [openWindows]);

  type AppLaunchOptions = {
    appName: string;
    url?: string;
    useEnhanced?: boolean;
    allowDuplicate?: boolean;
    source: string;
  };

  const handleCreationEngineLaunch = React.useCallback(
    async (source: string, options?: { allowDuplicate?: boolean }) => {
      const allowDuplicate = options?.allowDuplicate ?? false;
      const queryParams = new URLSearchParams({ limit: '1' });
      const userId = (session as any)?.user?.id;
      if (userId) queryParams.set('userId', userId);
      if (assistantName) queryParams.set('agent', assistantName);

      const fromCreativeMode = Boolean(source?.includes(':creative'));
      posthog?.capture('creation_engine_launched', { source, fromCreativeMode, agent: assistantName });
      let controller: AbortController | null = null;
      if (fromCreativeMode) {
        if (creativeLoadAbortRef.current) {
          creativeLoadAbortRef.current.abort();
        }
        controller = new AbortController();
        creativeLoadAbortRef.current = controller;
        creativeLoadActiveRef.current = true;
      }
      const notifyCreativeReady = () => {
        if (!fromCreativeMode || typeof window === 'undefined') {
          return;
        }
        window.dispatchEvent(new Event('creativeMode:loading-complete'));
      };

      try {
        const response = await fetch(`/api/get-html-content?${queryParams.toString()}`, {
          signal: controller?.signal,
        });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const json = await response.json();

        if (json?.success && Array.isArray(json.data) && json.data.length > 0) {
          const item = json.data[0];
          const viewState: WindowInstance['viewState'] = {
            htmlContentData: {
              id: item._id || item.id || 'unknown',
              title: item.title,
              htmlContent: item.htmlContent,
              contentType: item.contentType || 'interactive',
            },
            isHtmlContentFullscreen: false,
          };

          const existing = findWindowByViewType('htmlContent');
          if (existing && !allowDuplicate) {
            updateWindowState(existing.id, viewState);
            focusExistingWindow(existing.id);
          } else {
            addWindow('htmlContent', viewState, { allowDuplicate });
          }

          const refs: { type: string; id: string; description?: string }[] = [
            { type: 'HtmlGeneration', id: item._id, description: `Title: ${item.title}` },
          ];
          if (item.sourceNoteId) {
            refs.push({
              type: 'Notes',
              id: item.sourceNoteId,
              description: 'This is the Note from which the applet was created',
            });
          }
          await trackSessionHistory('Loaded HTML applet', refs);
          notifyCreativeReady();
          return;
        }

        const placeholderState: WindowInstance['viewState'] = {
          htmlContentData: {
            id: 'new-applet',
            title: 'New Applet',
            htmlContent: CREATION_ENGINE_PLACEHOLDER_HTML,
            contentType: 'interactive',
          },
          isHtmlContentFullscreen: false,
        };

        const existing = findWindowByViewType('htmlContent');
        if (existing && !allowDuplicate) {
          updateWindowState(existing.id, placeholderState);
          focusExistingWindow(existing.id);
        } else {
          addWindow('htmlContent', placeholderState, { allowDuplicate });
        }

        // toast({
        //   title: 'Creation Engine Ready',
        //   description: 'Blank workspace opened. Generate your first applet!',
        // } as any);
        notifyCreativeReady();
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          log.info('[CreationEngine] Fetch aborted');
        } else {
          log.warn('Failed to load latest Creation Engine applet', error);
          toast({
            title: 'Creation Engine Error',
            description: error?.message || 'Unable to load latest applet.',
            variant: 'destructive',
          } as any);
          notifyCreativeReady();
        }
      } finally {
        if (fromCreativeMode && creativeLoadAbortRef.current === controller) {
          creativeLoadAbortRef.current = null;
          creativeLoadActiveRef.current = false;
        }
      }
    },
    [addWindow, assistantName, findWindowByViewType, focusExistingWindow, session, toast, updateWindowState]
  );

  const handleAppLaunch = React.useCallback(
    ({ appName, url, useEnhanced, allowDuplicate, source }: AppLaunchOptions) => {
      if (!appName) {
        log.warn('⚠️ handleAppLaunch called without appName', { source });
        return;
      }

      const normalized = appName.toLowerCase();
      const allowDup = allowDuplicate ?? false;

      switch (normalized) {
        case 'creation-engine':
        case 'creationengine':
        case 'creation':
          void handleCreationEngineLaunch(source, { allowDuplicate: allowDup });
          return;
        case 'googledrive':
        case 'google-drive':
        case 'drive':
          requestWindowOpen({ viewType: 'googleDrive', source, options: { allowDuplicate: allowDup } });
          return;
        case 'dailycall':
        case 'daily-call':
        case 'daily':
        case 'call':
        case 'social':
        case 'video-call':
        case 'meeting':
          requestWindowOpen({ viewType: 'dailyCall', source, options: { allowDuplicate: allowDup } });
          return;
        case 'gmail':
        case 'email':
          requestWindowOpen({ viewType: 'gmail', source, options: { allowDuplicate: allowDup } });
          return;
        case 'notes':
        case 'notepad':
        case 'text':
          requestWindowOpen({ viewType: 'notes', source, options: { allowDuplicate: allowDup } });
          return;
        case 'terminal':
        case 'cmd':
        case 'command':
          requestWindowOpen({ viewType: 'terminal', source, options: { allowDuplicate: allowDup } });
          return;
        case 'files':
        case 'file-manager':
        case 'explorer':
          requestWindowOpen({ viewType: 'files', source, options: { allowDuplicate: allowDup } });
          return;
        case 'youtube':
        case 'video':
          {
            const allowDefault = Boolean(source?.startsWith('ui:') || source?.startsWith('desktop:'));
            const youtubeQuery = resolveYoutubeQuery(url, allowDefault);
            requestWindowOpen({
              viewType: 'youtube',
              viewState: { youtubeQuery },
              source,
              options: { allowDuplicate: allowDup },
            });
          }
          return;
        case 'browser':
        case 'chrome':
        case 'web': {
          const finalUrl = url || 'https://www.google.com';
          const useEnhancedBrowser = useEnhanced !== false;
          const viewType = useEnhancedBrowser ? 'enhancedBrowser' : 'miniBrowser';
          const viewState: WindowInstance['viewState'] = useEnhancedBrowser
            ? { enhancedBrowserUrl: finalUrl }
            : { browserUrl: finalUrl };
          requestWindowOpen({ viewType, viewState, source, options: { allowDuplicate: allowDup } });
          return;
        }
        default:
          log.warn(`⚠️ Unknown desktop app name: "${appName}"`);
      }
    },
    [handleCreationEngineLaunch, resolveYoutubeQuery]
  );

  const resolveAppCloseTargets = React.useCallback((appName: string): ViewType[] => {
    if (!appName) return [];
    switch (appName.toLowerCase()) {
      case 'googledrive':
      case 'google-drive':
      case 'drive':
        return ['googleDrive'];
      case 'gmail':
      case 'email':
        return ['gmail'];
      case 'notes':
      case 'notepad':
      case 'text':
        return ['notes'];
      case 'creation-engine':
      case 'creationengine':
      case 'creation':
        return ['htmlContent'];
      case 'terminal':
      case 'cmd':
      case 'command':
        return ['terminal'];
      case 'browser':
      case 'chrome':
      case 'web':
      case 'minibrowser':
        return ['miniBrowser', 'enhancedBrowser'];
      case 'canvas':
      case 'universalcanvas':
        return ['canvas'];
      case 'dailycall':
      case 'daily-call':
      case 'daily':
      case 'call':
      case 'social':
      case 'video-call':
      case 'meeting':
        return ['dailyCall'];
      case 'youtube':
      case 'video':
        return ['youtube'];
      default:
        return [];
    }
  }, []);

  const processWindowOpenRequest = React.useCallback(
    (request?: WindowOpenRequest) => {
      if (!request) {
        log.warn('⚠️ [LIFECYCLE] Received empty window open request');
        return;
      }

      const { viewType, viewState, options, source } = request;
      if (!viewType) {
        log.warn('⚠️ [LIFECYCLE] Window open request missing viewType', request);
        return;
      }

      log.info('🪟 [LIFECYCLE] Processing window open request', {
        viewType,
        hasViewState: Boolean(viewState),
        options,
        source,
        event: 'window_open_request',
      });

      if (viewType === 'htmlContent' && source?.startsWith('desktop:creation-engine') && !viewState) {
        void handleCreationEngineLaunch(source, { allowDuplicate: options?.allowDuplicate });
        return;
      }

      if (viewType === 'dailyCall') {
        const now = Date.now();
        const lastStart = lastDailyCallStartRef.current;
        log.info('📞 [LIFECYCLE] DailyCall open request', {
          event: 'dailycall_open_request',
          now,
          lastStart,
          timeSinceLastStart: lastStart !== null ? now - lastStart : null,
          source,
        });
        if (lastStart !== null && now - lastStart < 1500) {
          log.info('📞 [DailyCall] Ignored duplicate open request (cooldown active)', {
            event: 'dailycall_duplicate_ignored',
            timeSinceLastStart: now - lastStart,
          });
          const existingDailyCall = findWindowByViewType('dailyCall');
          if (existingDailyCall) {
            focusExistingWindow(existingDailyCall.id);
          }
          return;
        }
        lastDailyCallStartRef.current = now;
      }

      let resolvedViewState = viewState ?? {};

      if (viewType === 'youtube') {
        const incomingQuery = typeof (resolvedViewState as any).youtubeQuery === 'string'
          ? (resolvedViewState as any).youtubeQuery
          : undefined;
        const allowDefault = Boolean(
          source?.startsWith('ui:') ||
          source?.startsWith('desktop:') ||
          (!source && !incomingQuery)
        );
        resolvedViewState = {
          ...(resolvedViewState as Record<string, unknown>),
          youtubeQuery: resolveYoutubeQuery(incomingQuery, allowDefault),
        } as typeof resolvedViewState;
      }

      const existing = findWindowByViewType(viewType);
      const allowDuplicate = options?.allowDuplicate ?? false;

      if (existing && !allowDuplicate) {
        const updates: Partial<WindowInstance['viewState']> = {
          ...(resolvedViewState ?? {}),
        };

        if (viewType === 'enhancedBrowser') {
          const currentKey = existing.viewState?.enhancedKey ?? 0;
          updates.enhancedKey = currentKey + 1;
        }

        if (Object.keys(updates).length > 0) {
          updateWindowState(existing.id, updates);
        }

        focusExistingWindow(existing.id);
        // Ensure the window container is visible when focusing an existing window
        setShowView(viewType as any);
        setStatus(true);
        setWasMinimized(false);
        return;
      }

      log.info('🪟 [LIFECYCLE] Adding new window', {
        event: 'window_add',
        viewType,
        hasResolvedViewState: Boolean(resolvedViewState),
        options,
        source,
      });
      addWindow(viewType, resolvedViewState, options);
      // Ensure the window container is visible when a new window is added
      setShowView(viewType as any);
      setStatus(true);
      setWasMinimized(false);
    },
    [addWindow, findWindowByViewType, focusExistingWindow, handleCreationEngineLaunch, resolveYoutubeQuery, updateWindowState]
  );

  const processWindowCloseRequest = React.useCallback(
    (request?: WindowCloseRequest) => {
      if (!request) {
        log.warn('⚠️ [LIFECYCLE] Received empty window close request');
        return;
      }

      const { windowId, viewType, options, source } = request;
      log.info('🪟 [LIFECYCLE] Processing window close request', {
        windowId,
        viewType,
        options,
        source,
      });

      if (windowId) {
        removeWindow(windowId, { suppressStandaloneReset: options?.suppressStandaloneReset });
        return;
      }

      if (viewType) {
        const removed = removeWindowsByViewTypes([viewType]);
        if (removed === 0 && options?.fallbackToCloseAll) {
          removeAllWindows();
        }
        return;
      }

      if (options?.fallbackToCloseAll) {
        removeAllWindows();
      }
    },
    [removeAllWindows, removeWindow, removeWindowsByViewTypes]
  );

  // Computed derived state for layout
  const windowCount = openWindows.length;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const currentLayout: WindowLayout = React.useMemo(() => {
    switch (windowCount) {
      case 0: return 'normal';
      case 1: return 'normal';
      case 2: return 'grid-2';
      case 3: return 'grid-3';
      case 4: return 'grid-4';
      default: return 'maximized';
    }
  }, [windowCount]);

  // Grid position CSS classes
  const getGridPositionClasses = (position: GridPosition): string => {
    const baseClasses = 'absolute border-r border-b border-gray-300/30 transition-all duration-300 ease-out';
    
    switch (position) {
      case 'full':
        return 'absolute inset-0'; // Full screen
        
      case 'left':
        return `${baseClasses} inset-y-0 left-0 right-1/2`; // Left half - fullscreen height (desktop)
        
      case 'right':
        return `${baseClasses} inset-y-0 left-1/2 right-0`; // Right half - fullscreen height (desktop)
        
      case 'top':
        return `${baseClasses} inset-x-0 top-0 bottom-1/2`; // Top half - fullscreen width (mobile)
        
      case 'bottom':
        return `${baseClasses} inset-x-0 top-1/2 bottom-0`; // Bottom half - fullscreen width (mobile)
        
      case 'left-full':
        return `${baseClasses} inset-y-0 left-0 right-1/2`; // 3-window (desktop): left half - fullscreen height
        
      case 'top-right':
        return `${baseClasses} top-0 left-1/2 right-0 bottom-1/2`; // 3-window (desktop): top right - fullscreen within quadrant
        
      case 'bottom-right':
        return `${baseClasses} top-1/2 left-1/2 right-0 bottom-0`; // 3-window (desktop): bottom right - fullscreen within quadrant
        
      case 'top-third':
        return `${baseClasses} inset-x-0 top-0 bottom-2/3`; // 3-window (mobile): top third - fullscreen width
        
      case 'middle-third':
        return `${baseClasses} inset-x-0 top-1/3 bottom-1/3`; // 3-window (mobile): middle third - fullscreen width
        
      case 'bottom-third':
        return `${baseClasses} inset-x-0 top-2/3 bottom-0`; // 3-window (mobile): bottom third - fullscreen width
        
      case 'top-left':
        return `${baseClasses} top-0 left-0 right-1/2 bottom-1/2`; // 4-window: top left - fullscreen within quadrant
        
      case 'top-right-quad':
        return `${baseClasses} top-0 left-1/2 right-0 bottom-1/2`; // 4-window: top right - fullscreen within quadrant
        
      case 'bottom-left':
        return `${baseClasses} top-1/2 left-0 right-1/2 bottom-0`; // 4-window: bottom left - fullscreen within quadrant
        
      case 'bottom-right-quad':
        return `${baseClasses} top-1/2 left-1/2 right-0 bottom-0`; // 4-window: bottom right - fullscreen within quadrant
        
      default:
        return 'absolute inset-0';
    }
  };

  // Render window content based on view type
  const renderWindowContent = (window: WindowInstance) => {
    const { viewType, viewState } = window;

    switch (viewType) {
      case 'youtube':
        if (!isFeatureEnabled('youtube', supportedFeatures)) return null;
        return (
          <ErrorBoundary name="YouTube">
            <YouTubeViewWrapper 
              query={viewState?.youtubeQuery || ''} 
              assistantName={assistantName} 
            />
          </ErrorBoundary>
        );

      case 'gmail':
        if (!isFeatureEnabled('gmail', supportedFeatures)) return null;
        return <GmailViewWithAuth />;

      case 'googleDrive':
        if (!isFeatureEnabled('googleDrive', supportedFeatures)) return null;
        return <GoogleDriveView />;

      case 'notes':
        if (!isFeatureEnabled('notes', supportedFeatures)) return null;
        return (
          <ErrorBoundary name="Notes">
            <NotesView
              assistantName={assistantName}
              supportedFeatures={supportedFeatures}
              tenantId={tenantId}
              // Allow NotesView to drive its own close flow (including unsaved-changes dialog)
              onClose={() => {
                removeWindow(window.id);
              }}
            />
          </ErrorBoundary>
        );

      case 'terminal':
        if (!isFeatureEnabled('terminal', supportedFeatures)) return null;
        return <TerminalView />;

      case 'files':
        return <FilesView />;

      case 'miniBrowser':
        if (!isFeatureEnabled('miniBrowser', supportedFeatures)) return null;
        return <MiniBrowserView initialUrl={viewState?.browserUrl || 'https://www.google.com'} />;

      case 'enhancedBrowser':
        if (!isFeatureEnabled('miniBrowser', supportedFeatures)) return null;
        return (
          <EnhancedMiniBrowserView 
            key={viewState?.enhancedKey || 0} 
            initialUrl={viewState?.enhancedBrowserUrl || 'https://www.google.com'} 
          />
        );

      case 'htmlContent':
        if (!isFeatureEnabled('htmlContent', supportedFeatures)) return null;
        if (!viewState?.htmlContentData) return null;
        return (
          <HtmlContentViewer
            // title={viewState.htmlContentData.title}
            htmlContent={viewState.htmlContentData.htmlContent}
            contentType={viewState.htmlContentData.contentType}
            cssContent={viewState.htmlContentData.cssContent}
            jsContent={viewState.htmlContentData.jsContent}
            onClose={() => removeWindow(window.id)}
            isFullscreen={viewState.isHtmlContentFullscreen || false}
            onToggleFullscreen={() => {
              updateWindowState(window.id, {
                isHtmlContentFullscreen: !viewState.isHtmlContentFullscreen,
              });
            }}
            enableAppletSelector
            appletId={viewState.htmlContentData.id}
            appletTitle={viewState.htmlContentData.title}
            refreshTrigger={appletsRefreshTrigger}
            onRequestAppletChange={async (newId) => {
              try {
                const qp = new URLSearchParams({ id: newId });
                if (isAdmin && selectedUserId) qp.set('userId', selectedUserId);
                else if (session?.user?.id) qp.set('userId', session.user.id);
                qp.set('agent', assistantName);
                const res = await fetch(`/api/get-html-content?${qp.toString()}`);
                if (!res.ok) throw new Error('Failed to load applet');
                const json = await res.json();
                if (json?.success && json?.data) {
                  const d = json.data;
                  updateWindowState(window.id, {
                    htmlContentData: {
                      id: d.page_id || d._id || d.id,
                      title: d.title,
                      htmlContent: d.htmlContent,
                      contentType: d.contentType,
                      cssContent: d.cssContent,
                      jsContent: d.jsContent,
                    }
                  });
                }
              } catch (e: any) {
                toast({
                  title: 'Applet Load Error',
                  description: e.message || 'Failed to load selected applet',
                  variant: 'destructive',
                } as any);
              }
            }}
            isAdmin={isAdmin}
            selectedUserId={selectedUserId}
            onSelectUser={(id) => setSelectedUserId(id)}
            currentUserId={session?.user?.id}
            currentUserName={session?.user?.name}
            agent={assistantName}
          />
        );

      case 'contentList':
        return (
          <DynamicContentListView
            blockType={viewState?.contentType || ''}
            assistantName={assistantName}
            query={viewState?.contentQuery || ''}
            onSelect={(item) => {
              // Update to show detail view in same window
              updateWindowState(window.id, {
                contentId: item._id as string,
                contentQuery: null,
              });
              // Change view type to detail
              setOpenWindows(prev => prev.map(w =>
                w.id === window.id ? { ...w, viewType: 'contentDetail' } : w
              ));
            }}
          />
        );

      case 'contentDetail':
        return (
          <DynamicContentDetailView
            blockType={viewState?.contentType || ''}
            assistantName={assistantName}
            contentId={viewState?.contentId}
            query={viewState?.contentQuery || ''}
          />
        );

      case 'canvas':
        return (
          <ErrorBoundary name="Canvas">
            <UniversalCanvas
              className="h-full w-full"
              onClear={() => {
                removeWindow(window.id);
              }}
            />
          </ErrorBoundary>
        );

      case 'dailyCall':
        if (!isFeatureEnabled('dailyCall', supportedFeatures)) return null;
        return (
          <React.Suspense
            fallback={<div className="p-6 text-sm text-gray-500">Loading Daily Call...</div>}
          >
            {(() => {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { DailyCallView } = require('../features/DailyCall');
              return (
                <DailyCallView
                  roomUrl={dailyRoomUrl}
                  isAdmin={isAdmin}
                  assistantName={assistantName}
                  supportedFeatures={supportedFeatures}
                  personalityId={personalityId}
                  persona={persona}
                  tenantId={tenantId}
                  voiceId={resolvedVoiceId}
                  voiceProvider={resolvedVoiceProvider}
                  voiceParameters={voiceParameters}
                  modePersonalityVoiceConfig={modePersonalityVoiceConfig}
                  dailyCallPersonalityVoiceConfig={dailyCallPersonalityVoiceConfig}
                  onLeave={() => {
                    // Support both legacy and multi-window modes
                    if (window.id) {
                      removeWindow(window.id);
                    }
                    
                    // Legacy cleanup (just in case)
                    setShowView(null);
                    setStatus(false);
                    setWasMinimized(false);
                    setWindowLayout('normal');
                  }}
                  updateDailyProviderState={() => {}}
                />
              );
            })()}
          </React.Suspense>
        );

      case 'photoMagic':
        return <PhotoMagicView />;

      case 'sprites':
        return <SpritesApp />;

      default:
        return <div className="p-4 text-gray-500">Unknown view type</div>;
    }
  };

  // LEGACY EVENT LISTENERS DISABLED: All callers migrated to lifecycle controller
  // Keeping this commented out as documentation - do not remove until fully validated
  /*
  useEffect(() => {
    const handleOpenDesktopApp = (event: CustomEvent) => {
      const { appName, url, useEnhanced, allowDuplicate } = event.detail as {
        appName: string;
        url?: string;
        useEnhanced?: boolean;
        allowDuplicate?: boolean;
      };

      if (!appName) {
        log.warn('⚠️ openDesktopApp event missing appName detail');
        return;
      }

      log.info(`🖥️ Opening desktop app via event: ${appName}`);
      handleAppLaunch({
        appName,
        url,
        useEnhanced,
        allowDuplicate,
        source: 'legacy:openDesktopApp',
      });
    };

    const handleCloseDesktopApp = (event: CustomEvent) => {
      const { appNames } = event.detail as { appNames: string[] };
      log.info('🔴 Closing desktop apps via event:', appNames);

      if (!Array.isArray(appNames) || appNames.length === 0) {
        log.warn('⚠️ closeDesktopApp called with invalid appNames');
        return;
      }

      const source = 'legacy:closeDesktopApp';
      let resolved = 0;

      appNames.forEach(appName => {
        resolveAppCloseTargets(appName).forEach(viewType => {
          resolved += 1;
          requestWindowClose({ viewType, source });
        });
      });

      if (resolved === 0) {
        log.warn('⚠️ No valid ViewTypes to close', { appNames });
      }
    };

    window.addEventListener('openDesktopApp', handleOpenDesktopApp as EventListener);
    window.addEventListener('closeDesktopApp', handleCloseDesktopApp as EventListener);

    return () => {
      window.removeEventListener('openDesktopApp', handleOpenDesktopApp as EventListener);
      window.removeEventListener('closeDesktopApp', handleCloseDesktopApp as EventListener);
    };
  }, [handleAppLaunch, resolveAppCloseTargets]);
  */

  useEffect(() => {
    // FIX: Only the active singleton should attach global event listeners
    // This prevents duplicate BrowserWindow instances from both processing the same events
    if (!isSingletonActive) return;

    const lifecycleOpenListener = (event: Event) => {
      const customEvent = event as CustomEvent<WindowOpenRequest>;
      processWindowOpenRequest(customEvent.detail);
    };

    const lifecycleCloseListener = (event: Event) => {
      const customEvent = event as CustomEvent<WindowCloseRequest>;
      processWindowCloseRequest(customEvent.detail);
    };

    window.addEventListener(WINDOW_OPEN_EVENT, lifecycleOpenListener as EventListener);
    window.addEventListener(WINDOW_CLOSE_EVENT, lifecycleCloseListener as EventListener);

    return () => {
      window.removeEventListener(WINDOW_OPEN_EVENT, lifecycleOpenListener as EventListener);
      window.removeEventListener(WINDOW_CLOSE_EVENT, lifecycleCloseListener as EventListener);
    };
  }, [isSingletonActive, processWindowCloseRequest, processWindowOpenRequest]);

  useEffect(() => {
    // FIX: Only the active singleton should attach bot/automation event listeners
    if (!isSingletonActive) return;

    const minimizeListener: EventListener = () => {
      handleWindowAutomation('minimize');
    };
    const maximizeListener: EventListener = () => {
      handleWindowAutomation('maximize');
    };
    const restoreListener: EventListener = () => {
      handleWindowAutomation('restore');
    };
    const snapLeftListener: EventListener = () => {
      handleWindowAutomation('snapLeft');
    };
    const snapRightListener: EventListener = () => {
      handleWindowAutomation('snapRight');
    };
    const resetListener: EventListener = () => {
      handleWindowAutomation('reset');
    };

    // Handle app.open events from bot
    const appOpenListener: EventListener = (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const payload: any = customEvent.detail?.payload;
      const appName = payload?.app;
      if (appName && typeof appName === 'string') {
        const url = typeof payload?.url === 'string' ? payload.url : undefined;
        const useEnhanced = typeof payload?.useEnhanced === 'boolean' ? payload.useEnhanced : undefined;
        const allowDuplicate = typeof payload?.allowDuplicate === 'boolean' ? payload.allowDuplicate : undefined;
        log.info('[BrowserWindow] Received app.open event', { appName, url, useEnhanced, allowDuplicate });

        handleAppLaunch({
          appName,
          url,
          useEnhanced,
          allowDuplicate,
          source: 'nia.event:app.open',
        });
      }
    };

    // Handle apps.close events from bot (close specific apps)
    // MIRRORS app.open → openDesktopApp flow
    const appsCloseListener: EventListener = (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const apps = customEvent.detail?.payload?.apps;
      
      log.info(`🟢 [APPS-CLOSE] Received apps.close event:`, { 
        apps, 
        appsIsArray: Array.isArray(apps),
        appsLength: Array.isArray(apps) ? apps.length : 'N/A',
        fullPayload: customEvent.detail?.payload 
      });
      
      if (apps && Array.isArray(apps) && apps.length > 0) {
        const appNames = apps.map(app => (typeof app === 'string' ? app : String(app))).filter(Boolean);
        if (appNames.length > 0) {
          const source = 'nia.event:apps.close';
          let closed = 0;
          appNames.forEach(appName => {
            resolveAppCloseTargets(appName).forEach(viewType => {
              closed += 1;
              requestWindowClose({ viewType, source });
            });
          });
          if (closed === 0) {
            log.warn('🟢 [APPS-CLOSE] No view types resolved for close request', { appNames });
          }
        }
      } else {
        log.warn('🟢 [APPS-CLOSE] No valid apps array provided');
      }
    };

    // Handle browser.close events from bot (be selective when multiple windows are open)
    const browserCloseListener: EventListener = (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const windows = openWindowsRef.current;
      const count = windows.length;
      const payload: any = customEvent.detail?.payload || {};
      log.info(`🔴 [BROWSER-CLOSE] Received browser.close`, {
        payload,
        openCount: count,
        windows: windows.map(w => ({ id: w.id, viewType: w.viewType }))
      });

      // If specific apps are provided in payload, mirror apps.close handling
      const payloadApps = Array.isArray(payload?.apps) ? payload.apps : undefined;
      const singleApp = typeof payload?.app === 'string' ? payload.app : undefined;
      if ((payloadApps && payloadApps.length > 0) || singleApp) {
        const rawNames: string[] = (payloadApps && payloadApps.length > 0)
          ? payloadApps.map((a: unknown) => (typeof a === 'string' ? a : String(a))).filter(Boolean)
          : [singleApp as string];
        if (rawNames.length > 0) {
          const source = 'nia.event:browser.close';
          let resolved = 0;
          rawNames.forEach(appName => {
            resolveAppCloseTargets(appName).forEach(viewType => {
              resolved += 1;
              requestWindowClose({ viewType, source, options: { suppressStandaloneReset: true } });
            });
          });
          if (resolved > 0) {
            log.info('🔴 [BROWSER-CLOSE] Closed view types derived from payload', { rawNames, resolved });
            return;
          }
        }
      }

      // Try targeted close via identifiers/requestText heuristics
      const requestText: string | undefined = (payload?.requestText || payload?.userRequest || payload?.text) as string | undefined;
      const identifiers: Array<string | null | undefined> = [
        payload?.target,
        payload?.view,
        payload?.viewType,
        payload?.appName,
        payload?.name,
      ];
      const targeted = attemptCloseWindows(identifiers, requestText, { fallbackToCloseAll: false });
      if (targeted) {
        return;
      }

      // Fallbacks
      if (count <= 1) {
        // Check if the single window is a joined Daily Call
        const singleWindow = windows[0];
        if (singleWindow?.viewType === 'dailyCall' && isDailyCallJoinedRef.current) {
          log.info('🛡️ [BROWSER-CLOSE] Skipping fallback close-all for active Daily Call');
          return;
        }

        log.info('🔴 [BROWSER-CLOSE] 0 or 1 window → close all');
        removeAllWindows();
        return;
      }

      // Multi-window: close only one window (prefer active if available)
      const active = windows.find(w => w.id === activeWindowId) || windows[count - 1];
      
      // Check if the target window is a joined Daily Call
      if (active?.viewType === 'dailyCall' && isDailyCallJoinedRef.current) {
        log.info('🛡️ [BROWSER-CLOSE] Skipping fallback close for active Daily Call');
        return;
      }

      log.info('🔴 [BROWSER-CLOSE] Multiple windows → closing single window:', {
        targetId: active?.id,
        targetType: active?.viewType
      });
      if (active?.id) removeWindow(active.id, { suppressStandaloneReset: true });
    };

    // Handle browser.open events from bot  
    const browserOpenListener: EventListener = (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const payload = customEvent.detail?.payload ?? {};
      const rawUrl = typeof payload?.url === 'string' ? payload.url.trim() : '';
      const enhanced = Boolean((payload as any)?.enhanced || (payload as any)?.useEnhanced);
      const allowDuplicate =
        typeof (payload as any)?.allowDuplicate === 'boolean' ? (payload as any).allowDuplicate : undefined;

      const urlToUse = rawUrl || 'https://www.google.com';

      log.info('[BrowserWindow] Received browser.open event', {
        requestedUrl: rawUrl,
        resolvedUrl: urlToUse,
        enhanced,
        allowDuplicate,
      });

      const request: WindowOpenRequest = {
        viewType: enhanced ? 'enhancedBrowser' : 'miniBrowser',
        viewState: enhanced ? { enhancedBrowserUrl: urlToUse } : { browserUrl: urlToUse },
        source: NIA_EVENT_BROWSER_OPEN,
      };

      if (typeof allowDuplicate === 'boolean') {
        request.options = { allowDuplicate };
      }

      requestWindowOpen(request);
    };

    // Handle view.close events from bot (be selective when multiple windows are open)
    const viewCloseListener: EventListener = (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const windows = openWindowsRef.current;
      const count = windows.length;
      log.info(`🔴 [VIEW-CLOSE] Received view.close`, {
        payload: customEvent.detail?.payload,
        openCount: count,
        windows: windows.map(w => ({ id: w.id, viewType: w.viewType }))
      });

      if (count <= 1) {
        // Check if the single window is a joined Daily Call
        const singleWindow = windows[0];
        if (singleWindow?.viewType === 'dailyCall' && isDailyCallJoinedRef.current) {
          log.info('🛡️ [VIEW-CLOSE] Skipping fallback close-all for active Daily Call');
          return;
        }

        log.info('🔴 [VIEW-CLOSE] 0 or 1 window → close all');
        removeAllWindows();
        return;
      }

      // Multi-window: close only one window (prefer active if available)
      const active = windows.find(w => w.id === activeWindowId) || windows[count - 1];
      
      // Check if the target window is a joined Daily Call
      if (active?.viewType === 'dailyCall' && isDailyCallJoinedRef.current) {
        log.info('🛡️ [VIEW-CLOSE] Skipping fallback close for active Daily Call');
        return;
      }

      log.info('🔴 [VIEW-CLOSE] Multiple windows → closing single window:', {
        targetId: active?.id,
        targetType: active?.viewType
      });
      if (active?.id) removeWindow(active.id, { suppressStandaloneReset: true });
    };

    // Handle desktop.mode.switch events from bot
    const desktopModeSwitchListener: EventListener = (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const mode = customEvent.detail?.payload?.mode;
      log.info(`🖥️ [BrowserWindow] Received desktop.mode.switch event for mode: ${mode}`);
      
      if (!mode || typeof mode !== 'string') {
        log.warn('⚠️ [BrowserWindow] desktop.mode.switch event missing valid mode');
        return;
      }

      // Normalize mode value to DesktopMode enum
      // The bot might send layout synonyms ('desktop', 'full', 'compact', 'minimal') or actual DesktopMode values
      // Map synonyms to DesktopMode, or use the mode directly if it's already a valid DesktopMode
      const normalizeMode = (m: string): DesktopMode => {
        const lowerMode = m.toLowerCase();
        
        // Map layout synonyms to desktop modes
        const layoutModeMap: Record<string, DesktopMode> = {
          'desktop': DesktopMode.WORK,   // "desktop mode" -> Work mode
          'full': DesktopMode.WORK,      // Full layout -> Work mode
          'compact': DesktopMode.FOCUS,  // Compact layout -> Focus mode
          'minimal': DesktopMode.FOCUS,  // Minimal layout -> Focus mode
          'calm': DesktopMode.FOCUS,     // Calm mode -> Focus mode
          'create': DesktopMode.CREATIVE
        };
        
        // If it's a layout synonym, map it
        if (layoutModeMap[lowerMode]) {
          return layoutModeMap[lowerMode];
        }
        
        // Check if it's already a valid DesktopMode (home, work, focus, creative, gaming, relaxation)
        const validModes = Object.values(DesktopMode) as string[];
        if (validModes.includes(lowerMode)) {
          return lowerMode as DesktopMode;
        }
        
        // Default to HOME if unknown (more user-friendly than WORK)
        log.warn(`⚠️ [BrowserWindow] Unknown desktop mode "${m}", defaulting to HOME`);
        return DesktopMode.HOME;
      };

      const targetMode = normalizeMode(mode);
      
      // Dispatch desktopModeSwitch event in the format DesktopBackgroundSwitcher expects
      const switchResponse: DesktopModeSwitchResponse = {
        success: true,
        mode: targetMode,
        message: `Switching to ${targetMode} desktop mode`,
        userRequest: null,
        timestamp: new Date().toISOString(),
        action: 'SWITCH_DESKTOP_MODE',
        payload: {
          targetMode: targetMode,
          previousMode: null, // Could track previous mode if needed
          switchReason: 'bot_command',
        },
      };

      log.info(`✅ [BrowserWindow] Dispatching desktopModeSwitch event:`, switchResponse);
      
      // Dispatch the event that DesktopBackgroundSwitcher listens for
      window.dispatchEvent(new CustomEvent<DesktopModeSwitchResponse>('desktopModeSwitch', {
        detail: switchResponse
      }));
    };

    // Handle sprite.summon events from bot
    const spriteSummonListener: EventListener = (event: Event) => {
      // Check if feature is enabled before processing
      if (!isFeatureEnabled('summonSpriteTool', supportedFeatures)) {
        // eslint-disable-next-line no-console
        console.log('[BrowserWindow] spriteSummonListener: feature disabled, ignoring event');
        return;
      }

      const customEvent = event as CustomEvent<NiaEventDetail>;
      const eventName = customEvent.detail?.event;
      const payload = customEvent.detail?.payload as { prompt?: string } | undefined;
      // eslint-disable-next-line no-console
      console.log('[BrowserWindow] spriteSummonListener received event', { eventName, payload, fullDetail: customEvent.detail });
      if (eventName === 'sprite.summon' && payload?.prompt) {
        log.info('[BrowserWindow] Received sprite.summon event', payload);
        // eslint-disable-next-line no-console
        console.log('[BrowserWindow] Dispatching spriteSummonRequest with prompt:', payload.prompt);
        window.dispatchEvent(new CustomEvent('spriteSummonRequest', { detail: { prompt: payload.prompt } }));
      } else {
        // eslint-disable-next-line no-console
        console.log('[BrowserWindow] spriteSummonListener: event not matched', { eventName, hasPrompt: !!payload?.prompt });
      }
    };

    // Handle youtube.search events from bot
    const youtubeSearchListener: EventListener = (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const query = customEvent.detail?.payload?.query;
      if (typeof query === 'string' && query.trim()) {
        log.info(`[BrowserWindow] Received youtube.search event for query: ${query}`);
        const resolvedQuery = resolveYoutubeQuery(query, false);
        requestWindowOpen({
          viewType: 'youtube',
          viewState: { youtubeQuery: resolvedQuery },
          source: 'nia.event:youtube.search',
          options: { allowDuplicate: false },
        });
      }
    };

    // Handle soundtrack.control events from bot
    const soundtrackControlListener: EventListener = (event: Event) => {
      // Listen for all NIA events and filter for soundtrack.control
      // The bot emits "soundtrack.control" events via emit_tool_event
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const eventName = customEvent.detail?.event;
      const payload = customEvent.detail?.payload;
      
      // Check if this is a soundtrack.control event
      if (eventName === 'soundtrack.control' && payload) {
        log.info('[BrowserWindow] Received soundtrack.control event:', payload);
        
        // Convert bot event to frontend CustomEvent
        const soundtrackEvent = new CustomEvent('soundtrackControl', {
          detail: payload
        });
        log.info('[BrowserWindow] Dispatching soundtrackControl CustomEvent:', soundtrackEvent.detail);
        window.dispatchEvent(soundtrackEvent);
      }
    };

    // Handle note.open events from bot — only during active sessions (not idle desktop)
    const noteOpenListener: EventListener = (event: Event) => {
      // Skip note.open events when no voice call is active (prevents gateway WS spam from covering desktop)
      if (!isDailyCallActiveRef.current && !isChatModeRef.current) {
        return;
      }
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const rawPayload = customEvent.detail?.payload;
      const noteIdFromPayload = typeof rawPayload?.noteId === 'string' ? rawPayload.noteId : undefined;
      const noteIdFromEmbedded = typeof (rawPayload as any)?.note?._id === 'string'
        ? (rawPayload as any).note._id
        : undefined;
      const noteId = noteIdFromPayload || noteIdFromEmbedded;

      if (noteId) {
        log.info('[BrowserWindow] Received note.open event', { noteId, payload: rawPayload });

        // Open the notes window first
        addWindow('notes', {});

        const openPayload = {
          ...(typeof rawPayload === 'object' && rawPayload ? rawPayload : {}),
          noteId,
        };

        // Small delay to ensure NotesView has mounted and registered its listener
        // The listener will queue the command if notes haven't loaded yet
        setTimeout(() => {
          log.info('[BrowserWindow] Dispatching notepadCommand to open note', { noteId });
          window.dispatchEvent(new CustomEvent('notepadCommand', {
            detail: {
              action: 'openNote',
              payload: openPayload,
            },
          }));
        }, 100); // 100ms for component mounting, then NotesView queues if not ready
      }
    };

    // Handle notes.list events from bot — only during active sessions
    const notesListListener: EventListener = (event: Event) => {
      if (!isDailyCallActiveRef.current && !isChatModeRef.current) return;
      try {
        log.info('[BrowserWindow] Received notes.list event, opening notes window');
        addWindow('notes', {});
      } catch (err) {
        log.error('[BrowserWindow] Error handling notes.list event', err);
      }
    };

    // Handle applet.open events from bot
    const appletOpenListener: EventListener = async (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const payload = customEvent.detail?.payload;

      const payloadObj = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : undefined;
      const applet = (payloadObj?.applet && typeof payloadObj.applet === 'object')
        ? (payloadObj.applet as Record<string, unknown>)
        : undefined;
      const htmlContentData = (payloadObj?.htmlContentData && typeof payloadObj.htmlContentData === 'object')
        ? (payloadObj.htmlContentData as Record<string, unknown>)
        : undefined;

      const appletId = [
        payloadObj?.applet_id,
        payloadObj?.appletId,
        applet?._id,
        applet?.page_id,
        applet?.id,
        htmlContentData?.id,
        htmlContentData?._id,
      ].find((id): id is string => typeof id === 'string' && !!id);
      
      if (!appletId) {
        log.warn('[BrowserWindow] Received applet.open event without appletId', {
          payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
        });
        return;
      }

      log.info(`[BrowserWindow] Received applet.open event for appletId: ${appletId}`);
      
      try {
        // Fetch the full applet data (assistantName is required by the API)
        const response = await fetch(`/api/get-html-content?id=${appletId}&assistantName=${assistantName}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch applet: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (!result.success || !result.data) {
          throw new Error('Applet not found');
        }
        
        const applet = result.data;
        log.info('[BrowserWindow] Fetched applet data:', applet.title);
        
        // Open the applet window with full data
        addWindow('htmlContent', {
          htmlContentData: {
            id: applet._id || applet.page_id || appletId,
            title: applet.title,
            htmlContent: applet.htmlContent,
            contentType: applet.contentType || 'interactive',
          },
          isHtmlContentFullscreen: false,
        });
        
        const refs: { type: string; id: string; description?: string }[] = [
          { type: 'HtmlGeneration', id: applet._id, description: `Title: ${applet.title}` },
        ];
        if (applet.sourceNoteId) {
          refs.push({
            type: 'Notes',
            id: applet.sourceNoteId,
            description: 'This is the Note from which the applet was created',
          });
        }
        await trackSessionHistory('Loaded HTML applet', refs);
        
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('creativeMode:loading-complete'));
        }
      } catch (error) {
        log.error('[BrowserWindow] Failed to load applet:', error);
      }
    };

    // Handle html.updated events from bot (when applet is modified)
    const htmlUpdatedListener: EventListener = async (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const payload = customEvent.detail?.payload;
      const appletId = payload?.applet_id || payload?.appletId;
      
      if (!appletId || typeof appletId !== 'string') {
        log.error('[BrowserWindow] Received html.updated event with no appletId');
        return;
      }

      log.info(`[BrowserWindow] Received html.updated event for appletId: ${appletId}`);
      
      try {
        // Fetch the updated applet data (assistantName is required by the API)
        const response = await fetch(`/api/get-html-content?id=${appletId}&assistantName=${assistantName}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch updated applet: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (!result.success || !result.data) {
          throw new Error('Updated applet not found');
        }
        
        const applet = result.data;
        log.info('[BrowserWindow] Fetched updated applet data:', applet.title);
        
        // Check if this applet is already open in a window
        const currentOpenWindows = openWindowsRef.current;
        const existingWindow = currentOpenWindows.find(
          w => w.viewType === 'htmlContent' && 
               w.viewState?.htmlContentData?.id === appletId
        );
        
        if (existingWindow) {
          // Update the existing window with new content
          setOpenWindows(prev => prev.map(window => 
            window.id === existingWindow.id
              ? {
                  ...window,
                  viewState: {
                    ...window.viewState,
                    htmlContentData: {
                      id: applet._id || applet.page_id || appletId,
                      title: applet.title,
                      htmlContent: applet.htmlContent,
                      contentType: applet.contentType,
                    },
                  },
                }
              : window
          ));
          
          log.info('[BrowserWindow] Updated existing applet window:', applet.title);
        } else {
          // Applet not open, open it automatically
          addWindow('htmlContent', {
            htmlContentData: {
              id: applet._id || applet.page_id || appletId,
              title: applet.title,
              htmlContent: applet.htmlContent,
              contentType: applet.contentType,
            },
            isHtmlContentFullscreen: false,
          });
          
          log.info('[BrowserWindow] Opened updated applet:', applet.title);
        }
      } catch (error) {
        log.error('[BrowserWindow] Failed to load updated applet:', error);
      }
    };

    // Handle html.generation.requested events from bot
    // Bot tool has already handled name confirmation using LLM's natural conversation
    const htmlGenerationRequestedListener: EventListener = async (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const payload = customEvent.detail?.payload;
      
      if (!payload) {
        log.error('[BrowserWindow] Received html.generation.requested event with no payload');
        return;
      }

      log.info('[BrowserWindow] Received html.generation.requested event:', payload);      
      // Generate unique call ID for progress tracking
      const callId = `html-gen-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Show progress indicator (using imported functions from top of file)
      addActiveGenerationCall(callId);
      
      // Bot has already confirmed the name - proceed with versioning and generation
      // NOTE: Bot tool only emits this event AFTER getting the title from user
      try {
        const userProvidedName = (payload.app_title || payload.title) as string;
        const libraryType = (payload as any)?.library_type ?? (payload as any)?.libraryType;
        const libraryTemplateId = (payload as any)?.library_template_id ?? (payload as any)?.libraryTemplateId;
        
        // Use the enhanced API route which handles versioning, naming, and context
        const roomUrlHeader = (payload as any)?.room_url ?? (payload as any)?.roomUrl;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (typeof roomUrlHeader === 'string' && roomUrlHeader.trim()) {
          headers['x-room-url'] = roomUrlHeader;
        }

        const response = await fetch('/api/create-applet', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: userProvidedName,
            description: payload.description as string,
            contentType: (payload.content_type || 'app'),
            userRequest: payload.user_request as string,
            features: (payload.features as string[]) || [],
            sourceNoteId: payload.source_note_id as string,
            assistantName: assistantName,
            userProvidedName: userProvidedName,
            library_type: libraryType,
            library_template_id: libraryTemplateId,
            // Bot already confirmed name, so we don't need suggestions unless it's empty
            requestNameSuggestion: !userProvidedName,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to create applet: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to create applet');
        }

        const appletData = result.data;
        
        log.info('[BrowserWindow] HTML generation completed:', appletData);
        
        // Hide progress indicator
        removeActiveGenerationCall(callId);
        
        // Auto-load the generated applet using multi-window system
        addWindow('htmlContent', {
          htmlContentData: {
            id: appletData._id || appletData.page_id || '',
            title: appletData.title,
            htmlContent: appletData.htmlContent,
            contentType: appletData.contentType,
          },
          isHtmlContentFullscreen: false,
        });
        
        log.info('[BrowserWindow] Applet auto-loaded:', appletData.title);
        
        // Notify creative desktop to refresh its applet list
        window.dispatchEvent(
          new CustomEvent(NIA_EVENT_APPLET_REFRESH, {
            detail: { payload: { appletId: appletData._id || appletData.page_id } },
          })
        );
      } catch (error) {
        log.error('[BrowserWindow] HTML generation failed:', error);
        // Hide progress indicator on error too
        removeActiveGenerationCall(callId);
      }
    };

    // Handle html.modification.requested events from bot
    const htmlModificationRequestedListener: EventListener = async (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const payload = customEvent.detail?.payload;
      
      if (!payload) {
        log.error('[BrowserWindow] Received html.modification.requested event with no payload');
        return;
      }

      if ((payload as any)?.handledByUi) {
        log.info('[BrowserWindow] Skipping modification event already handled upstream', payload as any);
        return;
      }

      log.info('[BrowserWindow] Received html.modification.requested event:', payload);
      
      // Generate unique call ID for progress tracking
      const callId = `html-mod-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Show progress indicator
      addActiveGenerationCall(callId);
      
      try {
        const appletId = payload.appletId as string;
        const modificationRequest = payload.modificationRequest as string;
        
        if (!appletId || !modificationRequest) {
          throw new Error('Missing required fields: appletId or modificationRequest');
        }

        // Use the API route instead of direct server action
        const roomUrlHeader = (payload as any)?.room_url ?? (payload as any)?.roomUrl;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (typeof roomUrlHeader === 'string' && roomUrlHeader.trim()) {
          headers['x-room-url'] = roomUrlHeader;
        }

        const response = await fetch('/api/modify-applet', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            appletId,
            modificationRequest,
            aiProvider: (payload.aiProvider as any) || 'anthropic',
            aiModel: (payload.aiModel as string),
            assistantName: assistantName,
            versioningPreference: (payload.versioningPreference as any) || 'modify_existing',
            saveChoice: (payload.saveChoice as any) || 'original',
            sourceNoteId: payload.noteId as string,
            sourceNoteTitle: payload.noteTitle as string,
          }),
        });

        if (!response.ok) {
          throw new Error(`Modification failed: ${response.statusText}`);
        }

        const result = await response.json();
        
        log.info('[BrowserWindow] HTML modification completed:', result);
        
        // Hide progress indicator
        removeActiveGenerationCall(callId);
        
        if (result.success && result.data) {
          // Auto-load the modified applet
          addWindow('htmlContent', {
            htmlContentData: {
              id: result.data._id || '',
              title: result.data.title,
              htmlContent: result.data.htmlContent,
              contentType: result.data.contentType,
            },
            isHtmlContentFullscreen: false,
          });
          
          log.info('[BrowserWindow] Modified applet auto-loaded:', result.data.title);
        } else {
          log.error('[BrowserWindow] Rollback failed:', result.error);
          toast({
            title: 'Rollback Failed',
            description: result.error || 'Could not restore previous version.',
            variant: 'destructive',
          } as any);
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        log.error('[BrowserWindow] HTML modification failed', {
          message: errMessage,
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Hide progress indicator on error too
        removeActiveGenerationCall(callId);
        
        toast({
          title: 'Rollback Error',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
          variant: 'destructive',
        } as any);
      }
    };

    // Handle html.rollback.requested events from bot
    const htmlRollbackRequestedListener: EventListener = async (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const payload = customEvent.detail?.payload;
      
      if (!payload) {
        log.error('[BrowserWindow] Received html.rollback.requested event with no payload');
        return;
      }

      log.info('[BrowserWindow] Received html.rollback.requested event:', payload);
      
      // Generate unique call ID for progress tracking
      const callId = `html-rollback-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Show progress indicator
      addActiveGenerationCall(callId);
      
      try {
        const appletId = payload.appletId as string;
        const steps = (payload.steps as number) || 1;
        
        if (!appletId) {
          throw new Error('Missing required field: appletId');
        }

        const response = await fetch('/api/rollback-applet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            appletId,
            steps,
          }),
        });

        if (!response.ok) {
          throw new Error(`Rollback failed: ${response.statusText}`);
        }

        const result = await response.json();
        
        log.info('[BrowserWindow] HTML rollback completed:', result);
        
        // Hide progress indicator
        removeActiveGenerationCall(callId);
        
        if (result.success && result.data) {
          // Check if window is already open
          const existingWindow = openWindowsRef.current.find(w => 
            w.viewType === 'htmlContent' && 
            w.viewState?.htmlContentData?.id === (result.data._id || result.data.id)
          );
  
          if (existingWindow) {
             updateWindowState(existingWindow.id, {
                htmlContentData: {
                  id: result.data._id || result.data.id || '',
                  title: result.data.title,
                  htmlContent: result.data.htmlContent,
                  contentType: result.data.contentType,
                  cssContent: result.data.cssContent,
                  jsContent: result.data.jsContent,
                }
             });
             log.info('[BrowserWindow] Updated existing window with rolled-back content');
          } else {
            // Auto-load the rolled-back applet
            addWindow('htmlContent', {
              htmlContentData: {
                id: result.data._id || result.data.id || '',
                title: result.data.title,
                htmlContent: result.data.htmlContent,
                contentType: result.data.contentType,
                cssContent: result.data.cssContent,
                jsContent: result.data.jsContent,
              },
              isHtmlContentFullscreen: false,
            });
            log.info('[BrowserWindow] Rolled-back applet auto-loaded in new window');
          }
          
          log.info('[BrowserWindow] Rolled-back applet processed:', result.data.title);
          
          // Notify user
          toast({
            title: 'Applet Restored',
            description: `Successfully rolled back "${result.data.title}" by ${steps} step(s).`,
          } as any);

          // Force refresh of applet list in all viewers to reflect the restored version
          setAppletsRefreshTrigger(prev => prev + 1);
        } else {
          log.error('[BrowserWindow] Rollback failed:', result.error);
          toast({
            title: 'Rollback Failed',
            description: result.error || 'Could not restore previous version.',
            variant: 'destructive',
          } as any);
        }
      } catch (error) {
        log.error('[BrowserWindow] HTML rollback failed:', error);
        // Hide progress indicator on error too
        removeActiveGenerationCall(callId);
        
        toast({
          title: 'Rollback Error',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
          variant: 'destructive',
        } as any);
      }
    };

    // Handle canvas.render events — open canvas window
    const canvasRenderListener: EventListener = () => {
      log.info('[BrowserWindow] Received canvas.render event, opening canvas window');
      requestWindowOpen({
        viewType: 'canvas',
        source: 'nia.event:canvas.render',
        options: { allowDuplicate: false },
      });
    };

    // Handle canvas.clear events — close canvas window
    const canvasClearListener: EventListener = () => {
      log.info('[BrowserWindow] Received canvas.clear event, closing canvas window');
      requestWindowClose({ viewType: 'canvas', source: 'nia.event:canvas.clear' });
    };

    const subscriptions: Array<[string, EventListener]> = [
      [NIA_EVENT_WINDOW_MINIMIZE, minimizeListener],
      [NIA_EVENT_WINDOW_MAXIMIZE, maximizeListener],
      [NIA_EVENT_WINDOW_RESTORE, restoreListener],
      [NIA_EVENT_WINDOW_SNAP_LEFT, snapLeftListener],
      [NIA_EVENT_WINDOW_SNAP_RIGHT, snapRightListener],
      [NIA_EVENT_WINDOW_RESET, resetListener],
      [NIA_EVENT_APP_OPEN, appOpenListener],
      [NIA_EVENT_APPS_CLOSE, appsCloseListener],
      [NIA_EVENT_BROWSER_OPEN, browserOpenListener],
      [NIA_EVENT_BROWSER_CLOSE, browserCloseListener],
      [NIA_EVENT_VIEW_CLOSE, viewCloseListener],
      [NIA_EVENT_DESKTOP_MODE_SWITCH, desktopModeSwitchListener],
      [NIA_EVENT_YOUTUBE_SEARCH, youtubeSearchListener],
      [NIA_EVENT_NOTE_OPEN, noteOpenListener],
      [NIA_EVENT_NOTES_LIST, notesListListener],
      [NIA_EVENT_APPLET_OPEN, appletOpenListener],
      [NIA_EVENT_HTML_UPDATED, htmlUpdatedListener],
      [NIA_EVENT_HTML_GENERATION_REQUESTED, htmlGenerationRequestedListener],
      [NIA_EVENT_HTML_MODIFICATION_REQUESTED, htmlModificationRequestedListener],
      [NIA_EVENT_HTML_ROLLBACK_REQUESTED, htmlRollbackRequestedListener],
      [NIA_EVENT_ALL, spriteSummonListener],
      [NIA_EVENT_ALL, soundtrackControlListener],
      [NIA_EVENT_CANVAS_RENDER, canvasRenderListener],
      [NIA_EVENT_CANVAS_CLEAR, canvasClearListener],
    ];

    subscriptions.forEach(([eventName, listener]) => {
      window.addEventListener(eventName, listener);
    });

    return () => {
      subscriptions.forEach(([eventName, listener]) => {
        window.removeEventListener(eventName, listener);
      });
    };
  }, [isSingletonActive, handleWindowAutomation, handleAppLaunch, resolveAppCloseTargets, attemptCloseWindows, removeAllWindows, addWindow, removeWindow, activeWindowId, assistantName, resolveYoutubeQuery]);

  // Keyboard shortcuts: Ctrl+Shift+F/M/Arrows
  useEffect(() => {
    return registerManeuverableWindowShortcuts({
      onSetVisible: v => {
        setStatus(v);
        setWasMinimized(false);
      },
      onSetLayout: l => setWindowLayout(l as any),
      onMinimize: () => {
        setStatus(false);
        setWasMinimized(true);
      },
    });
  }, []);

  const minimizedTitle = (() => {
    switch (showView) {
      case 'youtube':
        return 'YouTube';
      case 'googleDrive':
        return 'Google Drive';
      case 'gmail':
        return 'Gmail';
      case 'notes':
        return 'Notes';
      case 'terminal':
        return 'Terminal';
      case 'miniBrowser':
        return 'Browser';
      case 'htmlContent':
        return 'HTML Content';
      case 'canvas':
        return 'Canvas';
      case 'modelSelector':
        return 'Model Selector';
      case 'photoMagic':
        return 'Photo Magic';
      case 'sprites':
        return 'Sprites';
      case 'contentList':
        return 'Content';
      case 'contentDetail':
        return 'Details';
      case 'dailyCall':
        return 'Daily Call';
      default:
        return 'Window';
    }
  })();

  // Auto-maximize to fullscreen when any windows are open
  // MUST BE BEFORE ANY CONDITIONAL RETURNS (React Rules of Hooks)
  React.useEffect(() => {
    if (openWindows.length >= 1) {
      const singleWindow = openWindows.length === 1 ? openWindows[0] : null;

      if (openWindows.length === 1 && singleWindow) {
        if (singleWindow.viewType === 'notes') {
          try {
            window.dispatchEvent(
              new CustomEvent('notepadCommand', { detail: { action: 'cancelCloseAttempt' } })
            );
          } catch (_) {
            // no-op
          }
        }

        setShowView(singleWindow.viewType);
        
        if (singleWindow.viewState) {
          const state = singleWindow.viewState;
          if (state.youtubeQuery) {
            setYoutubeQuery(state.youtubeQuery);
          }
          if (state.browserUrl) {
            setBrowserUrl(state.browserUrl);
          }
          if (state.enhancedBrowserUrl) {
            setEnhancedBrowserUrl(state.enhancedBrowserUrl);
            if (state.enhancedKey !== undefined) {
              setEnhancedKey(state.enhancedKey);
            }
          }
          if (state.htmlContentData) {
            setHtmlContentData(state.htmlContentData);
            if (state.isHtmlContentFullscreen !== undefined) {
              setIsHtmlContentFullscreen(state.isHtmlContentFullscreen);
            }
          }

          if (state.contentType) {
            setContentType(state.contentType);
          }
          if (state.contentId) {
            setContentId(state.contentId);
          }
          if (state.contentQuery) {
            setContentQuery(state.contentQuery);
          }
        }

        setWindowLayout('maximized');
        setStatus(true);
        setWasMinimized(false);
      } else {
        // Multi-window: just ensure it's maximized
        setWindowLayout('maximized');
      }
    } else if (openWindows.length === 0) {
      try {
        window.dispatchEvent(
          new CustomEvent('notepadCommand', { detail: { action: 'confirmClose' } })
        );
      } catch (_) {
        // no-op
      }

      setShowView(null);
      setStatus(false);
      setWindowLayout('normal');
      setWasMinimized(false);
      resetViewState();
    }
  }, [openWindows, resetViewState]);

  // Resume polling for active jobs on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('nia_active_html_generations');
      if (stored) {
        const ids = JSON.parse(stored);
        if (Array.isArray(ids)) {
          ids.forEach(callId => {
             const jobId = localStorage.getItem(`nia_pending_job_${callId}`);
             if (jobId) {
               log.info(`🔄 Resuming polling for recovered job: ${jobId} (callId: ${callId})`);
               pollForCompletion(jobId, callId, localStorage.getItem('callId') || 'unknown');
             } else {
               // Stale call without job ID - clear it
               log.warn(`⚠️ Found stale callId ${callId} without jobId. Clearing.`);
               removeActiveGenerationCall(callId);
             }
          });
        }
      }
    } catch (e) {
      log.error('Error resuming jobs:', e);
    }
  }, [pollForCompletion]);

  // Handle session override on mount
  useEffect(() => {
    if (!sessionOverride) return;

    log.info('🔒 [BrowserWindow] Applying session override:', sessionOverride);

    // 1. Apply Mode Override
    if (sessionOverride.mode) {
      // Dispatch event to switch mode (handled by desktopModeSwitchListener)
      const modeEvent = new CustomEvent(NIA_EVENT_DESKTOP_MODE_SWITCH, {
        detail: {
          payload: {
            mode: sessionOverride.mode
          }
        }
      });
      window.dispatchEvent(modeEvent);
    }

    // 2. Open Resource Override
    if (sessionOverride.resourceId && sessionOverride.contentType) {
      // Small delay to ensure mode switch happens first/concurrently without race conditions in UI
      setTimeout(() => {
        if (sessionOverride.contentType === 'HtmlGeneration') {
          const appletEvent = new CustomEvent(NIA_EVENT_APPLET_OPEN, {
            detail: {
              payload: {
                appletId: sessionOverride.resourceId
              }
            }
          });
          window.dispatchEvent(appletEvent);
        } else if (sessionOverride.contentType === 'Notes') {
          const noteEvent = new CustomEvent(NIA_EVENT_NOTE_OPEN, {
            detail: {
              payload: {
                noteId: sessionOverride.resourceId
              }
            }
          });
          window.dispatchEvent(noteEvent);
        } else if (sessionOverride.contentType === 'Sprite') {
          const spriteEvent = new CustomEvent(NIA_EVENT_SPRITE_OPEN, {
            detail: {
              payload: {
                spriteId: sessionOverride.resourceId
              }
            }
          });
          window.dispatchEvent(spriteEvent);
        }
      }, 500);
    }
  }, [sessionOverride]);
  
  // ============================================================================
  // SINGLETON CHECK - After all hooks are declared
  // ============================================================================
  useEffect(() => {
    const globalWindow = window as any;
    
    // If an instance is already active and it's not this one, block this instance
    if (globalWindow.__browserWindowActiveInstanceId && globalWindow.__browserWindowActiveInstanceId !== instanceId) {
      log.warn(`🚨 [SINGLETON-${instanceId}] Another BrowserWindow is already active (${globalWindow.__browserWindowActiveInstanceId}). This instance will not render.`);
      setIsSingletonActive(false);
      return;
    }
    
    // Mark this instance as the active one
    log.info(`✅ [SINGLETON-${instanceId}] BrowserWindow mounting - marking as active`);
    globalWindow.__browserWindowActiveInstanceId = instanceId;
    setIsSingletonActive(true);
    
    return () => {
      // Only clear the flag if THIS instance is the active one
      if (globalWindow.__browserWindowActiveInstanceId === instanceId) {
        log.info(`🧹 [SINGLETON-${instanceId}] BrowserWindow unmounting - clearing active flag`);
        globalWindow.__browserWindowActiveInstanceId = null;
      }
    };
  }, [instanceId]);
  
  // If this instance is not the singleton, don't render anything
  if (!isSingletonActive) {
    return <div style={{ display: 'none', visibility: 'hidden', pointerEvents: 'none', opacity: 0, width: 0, height: 0 }} />;
  }
  
  // Only render when we have windows to show
  // CRITICAL FIX: Must check BEFORE rendering any containers
  const shouldRender = openWindows.length > 0;
  
  // Debug logging
  log.info('🪟 [RENDER-CHECK]', {
    openWindowsCount: openWindows.length,
    showView,
    status,
    wasMinimized,
    shouldRender,
    windowIds: openWindows.map(w => w.id),
  });
  
  // Return early if no windows to show - prevents translucent overlay bug
  if (!shouldRender) {
    log.info('🚫 [NO-RENDER] No windows to show - returning hidden div');
    return <div style={{ display: 'none', visibility: 'hidden', pointerEvents: 'none', opacity: 0, width: 0, height: 0 }} />;
  }

  // Use multi-window grid when we have 2+ windows
  // Single window (1) uses legacy rendering (but still fullscreen)
  const useMultiWindow = openWindows.length >= 2;

  return (
    <>
      {status && showView && (
        <div
          className={`mx-auto w-full ${assistantName === 'nia-ambassador' ? 'mb-6 mt-2' : 'my-10 max-w-6xl'}`}
          style={{
            zIndex: 50,
            height: seatrade ? '100dvh' : assistantName === 'nia-ambassador' ? '85dvh' : '75dvh',
            maxHeight: seatrade
              ? 'calc(100dvh - 232px)'
              : assistantName === 'nia-ambassador'
                ? '85dvh'
                : '75dvh',
            top: seatrade ? 18 : assistantName === 'nia-ambassador' ? 0 : -30,
            position: 'relative',
          }}
        >

          <div
            ref={windowRef}
            className={(() => {
              const base = 'border-muted-foreground overflow-hidden rounded-xl border';
              if (windowLayout === 'maximized') return `${base} fixed top-0 bottom-0 left-0 z-40 h-full ${isChatMode && showView !== 'dailyCall' ? 'right-[120px]' : 'right-0 w-full'}`;
          if (windowLayout === 'left')
            return `${base} fixed left-0 top-0 z-40 h-full w-full md:w-1/2`;
          if (windowLayout === 'right')
            return `${base} fixed right-0 top-0 z-40 h-full w-full md:w-1/2`;
          return `h-full w-full ${base} ${assistantName === 'nia-ambassador' ? '' : 'mx-auto max-w-6xl'} relative`;
        })()}
        style={{
          // Always allow interaction when the window is shown; previously gating by
          // isContentActive caused touch to be ignored for passive views (Gmail, Drive)
          // and Creation Engine applets on mobile.
          pointerEvents: 'auto',
          cursor: 'auto',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            cursor: 'auto',
          }}
        >
          <ManeuverableWindowControls
            layout={windowLayout}
            onLayoutChange={l => {
              if (showView) {
                setStatus(true);
                setWasMinimized(false);
              }
              setWindowLayout(l);
            }}
            onMinimize={() => {
              setStatus(false);
              setWasMinimized(true);
            }}
            onRestoreCenter={() => {
              if (showView) {
                setStatus(true);
                setWasMinimized(false);
              }
              setWindowLayout('normal');
            }}
            onClose={() => {
              const windows = openWindowsRef.current;
              const multiWindow = windows.length >= 2;
              log.info(
                `🔴 [CLOSE-BUTTON] Close clicked (useMultiWindow: ${multiWindow}, openWindows: ${windows.length})`
              );

              if (windows.length === 0) {
                log.info('🔴 [CLOSE-BUTTON] No windows available to close');
                return;
              }

              const active =
                (activeWindowId && windows.find(w => w.id === activeWindowId)) ||
                windows[windows.length - 1];

              if (!active) {
                log.warn('⚠️ [CLOSE-BUTTON] Unable to determine target window for close');
                return;
              }

              log.info(
                `🔴 [CLOSE-BUTTON] Targeting window ${active.id} (${active.viewType}) for close`
              );

              // Delegate close handling for notes so NotesView can show unsaved-changes dialog
              if (active.viewType === 'notes') {
                try {
                  window.dispatchEvent(
                    new CustomEvent('notepadCommand', {
                      detail: { action: 'attemptClose', payload: {} },
                    })
                  );
                  log.info('📝 [CLOSE-BUTTON] Dispatched notepadCommand:attemptClose for notes');
                } catch (error) {
                  log.warn(
                    '⚠️ [CLOSE-BUTTON] Error dispatching notepadCommand:attemptClose:',
                    error
                  );
                }
                return;
              }

              if (active.viewType === 'dailyCall') {
                try {
                  window.dispatchEvent(new Event('dailyCall.forceClose'));
                  log.info('📞 [CLOSE-BUTTON] Dispatched dailyCall.forceClose event');
                } catch (error) {
                  log.warn('⚠️ [CLOSE-BUTTON] Error dispatching dailyCall.forceClose:', error);
                }
              }

              removeWindow(active.id);
            }}
          />
        </div>

        {/* Multi-window grid container OR legacy single-window container */}
        {useMultiWindow ? (
          /* MULTI-WINDOW GRID RENDERING */
          <div className="relative w-full h-full">
            {(() => {
              log.info(`🎨 [RENDER-GRID] Rendering ${openWindows.length} window(s) in fullscreen grid layout`);
              return null;
            })()}
            {openWindows.map((window) => {
              // Calculate scale factor based on window count
              // 1 window: 1.0 (100%), 2 windows: 0.85 (85%), 3 windows: 0.7 (70%), 4 windows: 0.5 (50%)
              const getScaleFactor = (count: number): number => {
                switch (count) {
                  case 1: return 1.0;
                  case 2: return 0.85;
                  case 3: return 0.7;
                  case 4: return 0.5;
                  default: return 1.0;
                }
              };
              
              const scaleFactor = getScaleFactor(windowCount);
              
              log.info(`🖼️ [RENDER-WINDOW] Window ${window.id}: ${window.viewType} at position ${window.gridPosition} (scale: ${scaleFactor})`);
              
              return (
                <div
                  key={window.id}
                  className={`${getGridPositionClasses(window.gridPosition)} group`}
                  style={{
                    pointerEvents: 'auto',
                    cursor: 'auto',
                    backgroundColor: seatrade ? '#fff' : 'rgba(243, 244, 246, 0.2)',
                  }}
                  onClick={() => setActiveWindowId(window.id)}
                >
                  {/* Individual window close button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                    const windowInstance = window;

                    // Delegate close handling for notes so NotesView can show unsaved-changes dialog
                    if (windowInstance.viewType === 'notes') {
                      try {
                        if (typeof globalThis !== 'undefined' && globalThis.window) {
                          globalThis.window.dispatchEvent(
                            new CustomEvent('notepadCommand', {
                              detail: { action: 'attemptClose', payload: {} },
                            })
                          );
                          log.info(
                            '📝 [GRID-CLOSE] Dispatched notepadCommand:attemptClose for notes window'
                          );
                        }
                      } catch (error) {
                        log.warn(
                          '⚠️ [GRID-CLOSE] Error dispatching notepadCommand:attemptClose:',
                          error
                        );
                      }
                      return;
                    }
                    
                    // If closing Daily Call, trigger force close to disconnect call properly
                    if (windowInstance.viewType === 'dailyCall') {
                        try {
                          // Access global window object (loop variable shadows it)
                          if (typeof globalThis !== 'undefined' && globalThis.window) {
                            globalThis.window.dispatchEvent(new Event('dailyCall.forceClose'));
                            log.info('📞 [CLOSE-BUTTON] Dispatched dailyCall.forceClose event');
                          }
                        } catch (error) {
                          log.warn('⚠️ [CLOSE-BUTTON] Error dispatching dailyCall.forceClose:', error);
                        }
                      }
                      
                      removeWindow(windowInstance.id);
                    }}
                    className={`absolute top-1 right-1 z-10 p-1 rounded-md transition-all ${
                      isMobileDevice()
                        ? 'bg-gray-600/60 hover:bg-gray-600/80 text-white' // Mobile: always visible with gray
                        : 'bg-transparent hover:bg-red-600/90 text-gray-400 hover:text-white opacity-0 hover:opacity-100 group-hover:opacity-100' // Desktop: hidden, red on hover
                    }`}
                    title="Close this window"
                  >
                    <X className="w-3 h-3" />
                  </button>

                  {/* Render window content */}
                  <div className={`${seatrade ? 'bg-white' : 'bg-gray-100/20'} h-full w-full overflow-auto rounded-b-xl`}>
                    {renderWindowContent(window)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : showView ? (
          /* SINGLE-WINDOW LEGACY RENDERING - Only render if showView is set */
        <div
        className={`${seatrade ? 'bg-white' : 'bg-gray-100/20'} h-full w-full overflow-auto rounded-b-xl`}
          style={{
            pointerEvents: 'auto',
            cursor: 'auto',
          }}
        >
          {showView === 'youtube' && isFeatureEnabled('youtube', supportedFeatures) && (
            <ErrorBoundary name="YouTube">
              <YouTubeViewWrapper query={youtubeQuery || ''} assistantName={assistantName} />
            </ErrorBoundary>
          )}
          {showView === 'contentList' && (
            <DynamicContentListView
              blockType={contentType!}
              assistantName={assistantName}
              query={contentQuery || ''}
              onSelect={handleContentClick}
            />
          )}
          {showView === 'contentDetail' && (
            <DynamicContentDetailView
              blockType={contentType!}
              assistantName={assistantName}
              contentId={contentId || undefined}
              query={contentQuery || ''}
            />
          )}
          {showView === 'googleDrive' && isFeatureEnabled('googleDrive', supportedFeatures) && (
            <GoogleDriveView />
          )}
          {showView === 'gmail' && isFeatureEnabled('gmail', supportedFeatures) && (
            <GmailViewWithAuth />
          )}
          {showView === 'notes' && isFeatureEnabled('notes', supportedFeatures) && (
            <ErrorBoundary name="Notes">
              <NotesView
                assistantName={assistantName}
                supportedFeatures={supportedFeatures}
                tenantId={tenantId}
                // In legacy single-window mode, let NotesView control closing as well
                // FIX: Also remove from openWindows queue when closing, even in legacy mode
                onClose={() => {
                  // Find and remove the notes window from openWindows if it exists
                  const notesWindow = openWindows.find(w => w.viewType === 'notes');
                  if (notesWindow) {
                    removeWindow(notesWindow.id);
                  }
                  // Legacy cleanup
                  setShowView(null);
                  setStatus(false);
                  setWasMinimized(false);
                  setWindowLayout('normal');
                }}
              />
            </ErrorBoundary>
          )}
          {showView === 'terminal' && isFeatureEnabled('terminal', supportedFeatures) && (
            <TerminalView />
          )}
          {showView === 'files' && (
            <FilesView />
          )}
          {showView === 'miniBrowser' && isFeatureEnabled('miniBrowser', supportedFeatures) && (
            <MiniBrowserView initialUrl={browserUrl} />
          )}
          {showView === 'enhancedBrowser' && isFeatureEnabled('miniBrowser', supportedFeatures) && (
            <EnhancedMiniBrowserView key={enhancedKey} initialUrl={enhancedBrowserUrl} />
          )}
          {showView === 'dailyCall' && DailyCallViewComponent && (
            // Lazy import to avoid loading Daily SDK unless feature opened
            <React.Suspense
              fallback={<div className="p-6 text-sm text-gray-500">Loading Daily Call...</div>}
            >
              <DailyCallViewComponent
                roomUrl={dailyRoomUrl}
                isAdmin={isAdmin}
                assistantName={assistantName}
                supportedFeatures={supportedFeatures}
                personalityId={personalityId}
                persona={persona}
                tenantId={tenantId}
                voiceId={resolvedVoiceId}
                voiceProvider={resolvedVoiceProvider}
                voiceParameters={voiceParameters}
                modePersonalityVoiceConfig={modePersonalityVoiceConfig}
                dailyCallPersonalityVoiceConfig={dailyCallPersonalityVoiceConfig}
                onLeave={() => {
                  setShowView(null);
                  setStatus(false);
                  setWasMinimized(false);
                  setWindowLayout('normal');
                }}
                updateDailyProviderState={() => {}}
              />
            </React.Suspense>
          )}
          {showView === 'photoMagic' && (
            <PhotoMagicView />
          )}
          {showView === 'sprites' && (
            <SpritesApp />
          )}
          {showView === 'htmlContent' &&
            isFeatureEnabled('htmlContent', supportedFeatures) &&
            htmlContentData && (
              <HtmlContentViewer
                htmlContent={htmlContentData.htmlContent}
                contentType={htmlContentData.contentType}
                cssContent={htmlContentData.cssContent}
                jsContent={htmlContentData.jsContent}
                onClose={() => {
                  setShowView(null);
                  setStatus(false);
                  setHtmlContentData(null);
                  setIsHtmlContentFullscreen(false);
                }}
                isFullscreen={isHtmlContentFullscreen}
                onToggleFullscreen={() => setIsHtmlContentFullscreen(!isHtmlContentFullscreen)}
                enableAppletSelector
                appletId={htmlContentData.id}
                appletTitle={htmlContentData.title}
                onRequestAppletChange={async newId => {
                  try {
                    const qp = new URLSearchParams({ id: newId });
                    if (isAdmin && selectedUserId) qp.set('userId', selectedUserId);
                    else if (session?.user?.id) qp.set('userId', session.user.id);
                    qp.set('agent', assistantName);
                    const res = await fetch(`/api/get-html-content?${qp.toString()}`);
                    if (!res.ok) throw new Error('Failed to load applet');
                    const json = await res.json();
                    if (json?.success && json?.data) {
                      const d = json.data;
                      setHtmlContentData({
                        id: d._id,
                        title: d.title,
                        htmlContent: d.htmlContent,
                        contentType: d.contentType,
                        cssContent: d.cssContent,
                        jsContent: d.jsContent,
                      });
                      const refs: { type: string; id: string; description?: string }[] = [
                        { type: 'HtmlGeneration', id: d._id, description: `Title: ${d.title}` }
                      ];
                      if (d.sourceNoteId) {
                        refs.push({ type: 'Notes', id: d.sourceNoteId, description: `This is the Note from which the applet was created` });
                      }
                      await trackSessionHistory('Loaded HTML applet', refs);
                    }
                  } catch (e: any) {
                    toast({
                      title: 'Applet Load Error',
                      description: e.message || 'Failed to load selected applet',
                      variant: 'destructive',
                    } as any);
                  }
                }}
                isAdmin={isAdmin}
                selectedUserId={selectedUserId}
                onSelectUser={id => setSelectedUserId(id)}
                currentUserId={session?.user?.id}
                currentUserName={session?.user?.name}
                agent={assistantName}
                tenantId={tenantId}
              />
            )}
            {/* ModelSelectorModal has been disconnected - using session storage instead */}
        </div>
        ) : null}
      </div>
        </div>
      )}
      {wasMinimized && showView && (
        <button
          onClick={() => {
            if (showView) {
              setStatus(true);
              setWasMinimized(false);
            }
          }}
          className="fixed bottom-4 right-4 z-[100] rounded-full bg-white/90 px-3 py-2 text-gray-700 shadow-md backdrop-blur-sm hover:bg-white pointer-events-auto"
          title="Restore window"
        >
          <Square className="mr-1 inline-block h-4 w-4" />
          <span className="text-sm">{minimizedTitle}</span>
        </button>
      )}
      
      {/* Applet Name Confirmation Modal */}
      <AppletNameConfirmationModal
        isOpen={showNameConfirmationModal}
        suggestedName={suggestedAppletName}
        contentType={pendingCreationRequest?.contentType || 'app'}
        onConfirm={handleNameConfirmation}
        onCancel={() => {
          setShowNameConfirmationModal(false);
          setPendingCreationRequest(null);
          sendMessage({
            content: 'Applet creation cancelled. Let me know if you\'d like to try again with a different name!',
            role: 'assistant',
            mode: 'queued'
          });
        }}
      />
    </>
  );
};

export default BrowserWindow;
