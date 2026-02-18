/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useDaily, useDailyEvent, useParticipantIds, useScreenShare } from '@daily-co/daily-react';
import { isFeatureEnabled } from '@nia/features';
import { signOut } from 'next-auth/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { useUserProfile } from '@interface/contexts/user-profile-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import {
  coerceFeatureKeyList,
} from '@interface/lib/assistant-feature-sync';
import { getClientLogger } from '@interface/lib/client-logger';
import { isBotParticipant } from '@interface/lib/daily/participant-manager';
import { DesktopMode } from '@interface/types/desktop-modes';

import { isDuplicateEvent } from '@interface/lib/event-dedup';

import { initAppMessageBridge } from '../events/appMessageBridge';
import { routeNiaEvent } from '../events/niaEventRouter';
import {
  getParticipantsSnapshot,
  recordParticipantJoin,
  recordParticipantLeave,
} from '../events/participantsAggregator';
import {
  emitCallError,
  emitCallStateChange,
  emitParticipantJoin,
  emitParticipantLeave,
  emitParticipantUpdate,
} from '../events/publisher';
import { joinRoom } from '../lib/botClient';
import { BOT_CONTROL_BASE_URL } from '../lib/config';
import {
  getMeetingModeState,
  onMeetingModeChange,
  startMeetingMode,
  stopMeetingMode,
  showMeetingNotes,
  type MeetingModeState,
} from '../lib/meetingMode';
// import { requestDevRoomDeletion } from '../lib/devRoomClient';
import { setupGlobalErrorHandling } from '../lib/errorHandler';
import { logConn, scheduleStatePoll } from '../lib/instrumentation';
import {
  ProfileGateReason,
  evaluateRequireUserProfileGate,
} from '../lib/requireUserProfileGate';
import { clearTokenCache, requestDailyJoinToken } from '../lib/tokenClient';

import DailyPrebuiltStyle from './DailyPrebuiltStyle';
import Tile from './Tile';

// Nia event envelope type (mirrors server forwarder format)
interface NiaEventEnvelope<P = any> {
  v: 1; // version (currently 1)
  kind: 'nia.event'; // bridge kind discriminator
  seq: number; // monotonically increasing sequence
  ts: number; // epoch ms timestamp (server side)
  event: string; // event topic, e.g. 'daily.call.state'
  payload: P; // arbitrary payload object
}

interface CallProps {
  username: string;
  roomUrl: string;
  onLeave: () => void;
  onProfileGate: (reason: ProfileGateReason) => void;
  assistantName: string;
  session?: {
    user?: {
      id?: string;
      name?: string;
      email?: string;
    };
  } | null;
  // When true, join with mic/cam off and hide local tile from UI
  stealth?: boolean;
  // Admin status for enhanced features
  isAdmin?: boolean;
  // Tenant ID for admin access validation
  tenantId?: string;
  // Bot control parameters
  personalityId?: string;
  persona?: string;
  voiceId?: string;
  voiceParameters?: any;
  supportedFeatures?: string[] | null;
  voiceProvider?: string;
  modePersonalityVoiceConfig?: Record<string, any>;
  dailyCallPersonalityVoiceConfig?: Record<string, any>;
  sessionOverride?: Record<string, any>;
}

function makeDebugTraceId(roomUrl: string): string {
  const shortRoom = roomUrl.split('/').filter(Boolean).pop() || 'room';
  return `forum:${shortRoom}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function getStableAnonymousSessionUserId(): string {
  if (typeof window === 'undefined') {
    return `anon:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }
  const key = 'dailyCall.anonymousSessionUserId';
  try {
    const existing = window.sessionStorage.getItem(key)?.trim();
    if (existing) return existing;
    const generated = `anon:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(key, generated);
    return generated;
  } catch {
    return `anon:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }
}

const Call: React.FC<CallProps> = ({
  username,
  roomUrl,
  onLeave,
  onProfileGate,
  assistantName,
  session,
  stealth,
  isAdmin = false,
  tenantId,
  personalityId,
  persona,
  voiceId,
  voiceParameters,
  supportedFeatures,
  voiceProvider,
  modePersonalityVoiceConfig,
  dailyCallPersonalityVoiceConfig,
  sessionOverride,
}) => {
  const log = React.useMemo(() => getClientLogger('[daily_call]'), []);
  const { onboardingComplete } = useUserProfile();
  const { currentMode } = useDesktopMode();

  // Track whether we've logged mount info to avoid log spam on re-renders
  const hasLoggedMountRef = useRef(false);
  useEffect(() => {
    if (!hasLoggedMountRef.current) {
      hasLoggedMountRef.current = true;
      log.info('[Call] Component mounted', {
        stealth,
        isAdmin,
        roomUrl,
        supportedFeatures,
        hasModeConfig: !!modePersonalityVoiceConfig,
        hasDailyCallConfig: !!dailyCallPersonalityVoiceConfig,
        onboardingComplete,
      });
    }
  }, [
    log,
    stealth,
    isAdmin,
    roomUrl,
    supportedFeatures,
    modePersonalityVoiceConfig,
    dailyCallPersonalityVoiceConfig,
    onboardingComplete,
  ]);
  const daily = useDaily();
  const [callState, setCallState] = useState<{
    presenting: boolean;
    joining: boolean;
    leaving: boolean;
  }>({ presenting: false, joining: false, leaving: false });
  const participantIds = useParticipantIds();
  const { screens } = useScreenShare();
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);

  // Ensure window close protection is enabled if we mount while already joined
  useEffect(() => {
    if (daily && daily.meetingState() === 'joined-meeting') {
      // Add a small delay to ensure parent components (BrowserWindow) have mounted and registered listeners
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event('dailyCall.joined'));
        log.info('📞 [DAILY-CALL] Dispatched delayed dailyCall.joined event on mount');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [daily, log]);
  // Hide ALL participants marked stealth from every viewer (not just local)
  const visibleParticipantIds = React.useMemo(() => {
    try {
      const ids = participantIds || [];
      const pmap: any = (daily as any)?.participants?.() || {};
      const hidden = new Set<string>();
      // Accumulate all session_ids with userData.stealth === true
      Object.values(pmap).forEach((p: any) => {
        const sid = p?.session_id;
        if (!sid) return;
        if (p?.userData && (p.userData as any).stealth === true) {
          hidden.add(sid);
        }
      });
      // Filter out hidden participants globally and de-duplicate by session_id to prevent duplicate React keys
      const filtered = ids.filter(id => !hidden.has(id));
      const uniqueFiltered = Array.from(new Set(filtered));
      const localId = pmap?.local?.session_id || localSessionId;

      // Keep local user first, regular participants next, and bot(s) after humans.
      const ordered = uniqueFiltered.sort((a, b) => {
        if (localId && a === localId) return -1;
        if (localId && b === localId) return 1;

        const aParticipant = pmap?.[a];
        const bParticipant = pmap?.[b];
        const aIsBot = aParticipant
          ? isBotParticipant(aParticipant as any, { expectedPersonaName: persona })
          : false;
        const bIsBot = bParticipant
          ? isBotParticipant(bParticipant as any, { expectedPersonaName: persona })
          : false;

        if (aIsBot === bIsBot) return 0;
        return aIsBot ? 1 : -1;
      });

      // If for any reason local tile wasn't marked hidden yet and we're in stealth, filter it too
      if (stealth && localSessionId) {
        return ordered.filter(id => id !== localSessionId);
      }
      return ordered;
    } catch (_) {
      return participantIds;
    }
  }, [daily, participantIds, stealth, localSessionId, persona]);
  // Guard against duplicate join() calls (StrictMode double-mount or fast remounts)
  const joinAttemptedRef = useRef<boolean>(false);
  const triggerDevRoomCleanup = useCallback(() => {
    clearTokenCache();

    // Disable aggressive room deletion in dev mode to prevent 404s on reload
    /*
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    requestDevRoomDeletion({ roomUrl }).catch(error => {
      log.warn('[Call.cleanup] Failed to delete dev Daily room:', error);
    });
    */
  }, []);

  // User profile state - fetch first_name to prioritize over session.user.name
  const [profileFirstName, setProfileFirstName] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState<boolean>(false);
  const [profileGateReason, setProfileGateReason] = useState<ProfileGateReason>('complete');
  const profileGateHandledRef = useRef<boolean>(false);
  const requireProfileEvaluation = React.useMemo(
    () => evaluateRequireUserProfileGate(supportedFeatures),
    [supportedFeatures]
  );
  const requireProfile = requireProfileEvaluation.enabled;

  // User timeout state - check if user is temporarily kicked
  const [timeoutChecked, setTimeoutChecked] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [timeoutInfo, setTimeoutInfo] = useState<{
    remainingSeconds?: number;
    reason?: string;
  } | null>(null);

  // Layout management state
  const [layoutMode, setLayoutMode] = useState<'grid' | 'speaker' | 'sidebar'>('grid');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Meeting mode state
  const [meetingMode, setMeetingMode] = useState<MeetingModeState>(getMeetingModeState);
  useEffect(() => onMeetingModeChange(setMeetingMode), []);
  const handleToggleMeetingMode = useCallback(async () => {
    if (meetingMode.active) {
      await stopMeetingMode();
    } else {
      await startMeetingMode(roomUrl);
    }
  }, [meetingMode.active, roomUrl]);
  const handleShowNotes = useCallback(() => showMeetingNotes(roomUrl), [roomUrl]);
  // Removed unused state: showChat, usePrebuiltStyle (were not referenced)
  const [mainSpeakerId, setMainSpeakerId] = useState<string | null>(null);
  const [windowDimensions, setWindowDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  // Autohide controls state
  const [controlsVisible, setControlsVisible] = useState(true);
  // Nia event stream state (recent tail, last sequence, gap tracking)
  const [niaEvents, setNiaEvents] = useState<NiaEventEnvelope[]>([]);
  const niaLastSeqRef = useRef<number>(0);
  const niaGapsRef = useRef<Array<{ expected: number; got: number }>>([]);

  // Setup global error handling once
  useEffect(() => {
    setupGlobalErrorHandling();
  }, []);

  // Reset gate handled flag when profile status changes back to complete
  useEffect(() => {
    if (profileGateReason === 'complete') {
      profileGateHandledRef.current = false;
    }
  }, [profileGateReason]);

  // Fetch user profile to get first_name (prioritize over session.user.name)
  useEffect(() => {
    if (!session?.user?.id) {
      // No session means no profile to fetch - mark as loaded immediately
      log.info('[Call] No session.user.id, skipping profile fetch');
      setProfileLoaded(true);
      setProfileGateReason('complete');
      return;
    }

    const fetchProfile = async () => {
      try {
        const userId = session?.user?.id;
        if (!userId) {
          log.info('[Call] No userId, marking profile as loaded');
          setProfileLoaded(true);
          return;
        }

        log.info('[Call] Fetching profile for userId', { userId });
        const response = await fetch(`/api/userProfile?userId=${encodeURIComponent(userId)}`);
        log.info('[Call] Profile API response status', { status: response.status, ok: response.ok });

        if (response.ok) {
          const data = await response.json();
          log.info('[Call] Profile API data received', {
            total: data?.total,
            itemCount: Array.isArray(data?.items) ? data.items.length : 0,
          });

          // API returns { items: [...], total, hasMore }
          if (data?.items && Array.isArray(data.items) && data.items.length > 0) {
            const profile = data.items[0];
            log.info('[Call] Found profile record', {
              profileId: profile?.id,
              hasFirstName: !!profile?.first_name,
            });
            if (profile.first_name && typeof profile.first_name === 'string') {
              setProfileFirstName(profile.first_name.trim());
              log.info('[Call] ✅ Loaded profile first_name', { hasFirstName: true });
              setProfileGateReason('complete');
            } else {
              log.info('[Call] ⚠️ Profile has no first_name field');
              setProfileGateReason('missing-first-name');
            }
          } else {
            log.info('[Call] ⚠️ No profile data in response');
            setProfileGateReason('missing-profile');
            setProfileFirstName(null);
          }
        } else {
          log.warn('[Call] Profile API returned non-OK status', { status: response.status });
          setProfileGateReason('fetch-error');
          setProfileFirstName(null);
        }
      } catch (err) {
        log.warn('[Call] Failed to fetch user profile', { error: String((err as Error)?.message || err) });
        setProfileGateReason('fetch-error');
        setProfileFirstName(null);
      } finally {
        log.info('[Call] Setting profileLoaded = true');
        setProfileLoaded(true);
      }
    };

    fetchProfile();
  }, [session?.user?.id, log]);

  // Check if user is in timeout (kicked) before allowing join
  useEffect(() => {
    if (!session?.user?.id) {
      // Anonymous users bypass timeout check (can be kicked from room but no persistent timeout)
      setTimeoutChecked(true);
      setIsTimedOut(false);
      return;
    }

    const checkTimeout = async () => {
      try {
        const userId = session?.user?.id;
        if (!userId) {
          setTimeoutChecked(true);
          return;
        }

        log.info('[Call] Checking user timeout status', { userId });
        const params = new URLSearchParams({ userId });
        if (roomUrl) params.set('roomUrl', roomUrl);
        
        const response = await fetch(`/api/dailyCall/kick?${params}`);
        if (response.ok) {
          const data = await response.json();
          if (data.isTimedOut) {
            log.warn('[Call] User is in timeout', {
              userId,
              remainingSeconds: data.remainingSeconds,
              reason: data.reason,
            });
            setIsTimedOut(true);
            setTimeoutInfo({
              remainingSeconds: data.remainingSeconds,
              reason: data.reason,
            });
          } else {
            setIsTimedOut(false);
            setTimeoutInfo(null);
          }
        } else {
          // On error, allow join (fail open for better UX)
          log.warn('[Call] Failed to check timeout status', { status: response.status });
          setIsTimedOut(false);
        }
      } catch (err) {
        log.warn('[Call] Error checking timeout status', { error: String((err as Error)?.message || err) });
        setIsTimedOut(false);
      } finally {
        setTimeoutChecked(true);
      }
    };

    checkTimeout();
  }, [session?.user?.id, roomUrl, log]);

  // Auto-fullscreen on mobile when call starts or joins
  useEffect(() => {
    const isMobile =
      window.innerWidth <= 1024 ||
      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (
      isMobile &&
      (callState.joining || (daily && (daily as any)?.meetingState?.() === 'joined'))
    ) {
      setIsFullscreen(true);
    }
  }, [callState.joining, daily]);

  // Handle window resize for adaptive layout - OPTIMIZED with throttling
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const handleResize = () => {
      // Throttle resize events to prevent excessive re-renders
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setWindowDimensions({ width: window.innerWidth, height: window.innerHeight });
      }, 100); // 100ms throttle
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    log.info('📞 [Call] Join effect triggered', {
      event: 'daily_call_join_effect',
      hasRoomUrl: !!roomUrl,
      roomUrl,
      username,
      profileLoaded,
      timeoutChecked,
      isTimedOut,
      hasDaily: !!daily,
      meetingState: daily ? (daily as any)?.meetingState?.() : null,
    });

    if (!roomUrl) {
      log.error('📞 [Call] Missing roomUrl - closing window', {
        event: 'daily_call_missing_roomurl',
        username,
        hasDaily: !!daily,
      });
      log.error('[Daily] Missing roomUrl. Did you set NEXT_PUBLIC_DAILY_ROOM_URL?');
      logConn({ phase: 'join.error', roomUrl, username, error: 'missing roomUrl' });
      triggerDevRoomCleanup();
      onLeave();
      return;
    }

    // Profile gate removed - allow joining with just a name
    // Profile is still fetched for display purposes but doesn't block joining
    if (!profileLoaded) {
      log.info('[Call] Profile still loading, but allowing join to proceed');
      // Don't block - allow join to proceed
    } else {
      log.info('[Call] Profile loaded', {
        hasFirstName: !!profileFirstName,
        gateReason: profileGateReason,
      });
    }

    // Wait for timeout check to complete before attempting join
    if (!timeoutChecked) {
      log.info('[Call] Waiting for timeout check before join attempt');
      return;
    }

    // Gate join if user is currently in timeout (kicked)
    if (isTimedOut) {
      log.warn('[Call] User is in timeout, cannot join', {
        userId: session?.user?.id,
        remainingSeconds: timeoutInfo?.remainingSeconds,
        reason: timeoutInfo?.reason,
      });
      logConn({
        phase: 'join.timeout.gated' as any,
        roomUrl,
        username,
        remainingSeconds: timeoutInfo?.remainingSeconds,
      } as any);
      // Trigger a callback or show UI for timeout (will be handled in rendering)
      // Don't call onLeave immediately - let the UI show the timeout message
      return;
    }

    // If we already have a joined meeting (e.g. component remount without proper leave),
    // sync local state and skip duplicate join attempt.
    const existingState = (daily as any)?.meetingState?.();
    logConn({ phase: 'join.effect.enter' as any, roomUrl, username, meetingState: existingState });
    if (daily && existingState === 'joined') {
      // Reuse already joined session (skip calling join again)
      if (!callState.joining) {
        logConn({ phase: 'init.callobject.reuse', roomUrl, username, meetingState: existingState });
        setCallState(prev => ({ ...prev, joining: true }));
        emitCallStateChange(roomUrl, 'joined', username, participantIds.length || 1);
      }
      return; // IMPORTANT: prevent fall-through to join()
    }

    if (daily && !callState.joining && existingState !== 'joined' && !joinAttemptedRef.current) {
      joinAttemptedRef.current = true;
      logConn({ phase: 'join.effect.enter', roomUrl, username });
      // NOTE: Tests expect only (roomUrl, 'joining', username) signature (no participantCount arg)
      emitCallStateChange(roomUrl, 'joining', username);
      logConn({ phase: 'join.start', roomUrl, username, participantCount: participantIds.length });
      try {
        // Build userData: if stealth, do NOT include identity; only the stealth flag
        const joinUserData: Record<string, string | boolean> = stealth ? { stealth: true } : {};
        const sid = session?.user?.id && String(session.user.id).trim();
        const sname = session?.user?.name && String(session.user.name).trim();
        const semail = session?.user?.email && String(session.user.email).trim();
        const displayName = username?.trim();
        const sessionOverrideUserId =
          sessionOverride?.userId && String(sessionOverride.userId).trim();
        const stableAnonymousSessionUserId =
          !sid && !sessionOverrideUserId && !stealth
            ? getStableAnonymousSessionUserId()
            : undefined;
        const effectiveSessionUserId = sid || sessionOverrideUserId || stableAnonymousSessionUserId;
        // This is a public session (multi-user)
        (joinUserData as any).private = "false";
        // Include session identity only for non-stealth users
        if (!stealth) {
          if (effectiveSessionUserId) (joinUserData as any).sessionUserId = effectiveSessionUserId;
          // PRIORITY: Use the user-provided display name first, then profile first_name, then session.user.name
          if (displayName) {
            (joinUserData as any).sessionUserName = displayName;
          } else if (profileFirstName) {
            (joinUserData as any).sessionUserName = profileFirstName;
          } else if (sname) {
            (joinUserData as any).sessionUserName = sname;
          }
          if (semail) (joinUserData as any).sessionUserEmail = semail;
          if (tenantId) (joinUserData as any).tenantId = tenantId;
        }
        // Non-PII diagnostics to confirm userData composition
        try {
          const hasId = !!effectiveSessionUserId;
          const hasEmail = !!semail;
          const hasName = !!(sname || username);
          const hasTenant = !!tenantId;
          logConn({
            phase: 'join.userdata.build' as any,
            roomUrl,
            username,
            data: { hasId, hasEmail, hasName, hasTenant },
          });
        } catch (_) {
          // noop
        }
        const joinOpts: any = {
          url: roomUrl,
          // For stealth, use coded username prefix that bot can immediately detect
          // Otherwise, prioritize the pre-join display name, then profile first_name, then session.user.name
          userName: stealth ? 'stealth-user' : displayName || profileFirstName || sname || username,
          userData: stealth ? { stealth: true } : Object.keys(joinUserData).length > 0 ? joinUserData : undefined,
        };

        // Log the actual values being used for join
        log.info('[Call] Join options:', {
          userName: joinOpts.userName,
          profileFirstName,
          sessionName: sname,
          usernameProp: username,
          stealth,
          userDataKeys: Object.keys(joinUserData),
          userDataValues: joinUserData, // ADDED: Log actual values
        });

        if (stealth) {
          joinOpts.startAudioOff = true;
          joinOpts.startVideoOff = true;
        }

        // Prefer DailyCall-specific config when sending mode config to bot join
        const botModePersonalityVoiceConfig = dailyCallPersonalityVoiceConfig || modePersonalityVoiceConfig;

           // Resolve initial config based on DailyCall config or current mode
        let initialPersonalityId = personalityId;
        let initialVoiceId = voiceId;
        let initialVoiceProvider = voiceProvider;
        let initialVoiceParameters = voiceParameters;
        let initialPersona = persona;

        const resolvedDailyCallConfig = dailyCallPersonalityVoiceConfig
          ? (() => {
              if (dailyCallPersonalityVoiceConfig.default) return dailyCallPersonalityVoiceConfig.default;
              if (currentMode && dailyCallPersonalityVoiceConfig[currentMode]) return dailyCallPersonalityVoiceConfig[currentMode];
              const firstKey = Object.keys(dailyCallPersonalityVoiceConfig)[0];
              return firstKey ? dailyCallPersonalityVoiceConfig[firstKey] : undefined;
            })()
          : undefined;

        if (dailyCallPersonalityVoiceConfig) {
          log.info('[Call] DailyCall config candidate', {
            dailyCallConfigKeys: Object.keys(dailyCallPersonalityVoiceConfig),
            resolvedDailyCallPersona: resolvedDailyCallConfig?.personaName,
            resolvedDailyCallVoiceId: resolvedDailyCallConfig?.voice?.voiceId,
            resolvedDailyCallVoiceProvider: resolvedDailyCallConfig?.voice?.provider,
          });
        } else {
          const modeConfig = currentMode ? modePersonalityVoiceConfig?.[currentMode] : undefined;
          log.info('[Call] DailyCall config missing, falling back to mode/props', {
            currentMode,
            hasModeConfig: !!modeConfig,
            modePersona: modeConfig?.personaName,
            modeVoiceId: modeConfig?.voice?.voiceId,
            modeVoiceProvider: modeConfig?.voice?.provider,
          });
        }

        const isOnboardingEnabled = isFeatureEnabled('onboarding');
        const allowModeConfig = !(isOnboardingEnabled && !onboardingComplete);

        if (resolvedDailyCallConfig) {
          const voiceConfig = resolvedDailyCallConfig.voice || {};
          if (resolvedDailyCallConfig.personalityId) initialPersonalityId = resolvedDailyCallConfig.personalityId;
          if (voiceConfig.voiceId) initialVoiceId = voiceConfig.voiceId;
          if (voiceConfig.provider) initialVoiceProvider = voiceConfig.provider;
          if (resolvedDailyCallConfig.voiceParameters) initialVoiceParameters = resolvedDailyCallConfig.voiceParameters;
          if (resolvedDailyCallConfig.personaName) initialPersona = resolvedDailyCallConfig.personaName;
          log.info('[Call] Using dailyCall-specific config for join', { resolvedDailyCallConfig });
        } else if (allowModeConfig && modePersonalityVoiceConfig && currentMode && modePersonalityVoiceConfig[currentMode]) {
          const modeConfig = modePersonalityVoiceConfig[currentMode];
          const voiceConfig = modeConfig.voice || {};

          if (modeConfig.personalityId) initialPersonalityId = modeConfig.personalityId;
          if (voiceConfig.voiceId) initialVoiceId = voiceConfig.voiceId;
          if (voiceConfig.provider) initialVoiceProvider = voiceConfig.provider;
          if (modeConfig.voiceParameters) initialVoiceParameters = modeConfig.voiceParameters;
          if (modeConfig.personaName) initialPersona = modeConfig.personaName;

          log.info('[Call] Using mode-specific config for join', { currentMode, modeConfig });
        } else if (!allowModeConfig) {
          log.info('[Call] Onboarding active: skipping mode-specific config to use default personality');
        }

        // Filter supported features to allowed set
        const allowedSupportedFeatures = [
          'htmlContent',
          'notes',
          'onboarding',
          'resourceSharing',
          'userProfile',
          // 'smartSilence',    // DISABLED: spawns unwanted agents during pauses
          // 'lullDetection',   // DISABLED: spawns unwanted agents during pauses
          'openclawBridge',
          'youtube',
          'soundtrack',
          'summonSpriteTool',
          'wonderCanvas'];
        const filteredSupportedFeatures = (supportedFeatures || []).filter(feature => allowedSupportedFeatures.includes(feature));

        // ARCHITECTURAL FIX: Call bot /join FIRST to spawn bot (no participant ID yet)
        // Then daily.join provides userData with sessionUserId for ALL participants
        // This eliminates race condition where participant joins before identity file is created
        const debugTraceId = makeDebugTraceId(roomUrl);
        // Use assistantName (capitalized) as fallback for persona if not set or is default
        const botPersona = initialPersona && initialPersona !== 'Pearl' 
          ? initialPersona 
          : (assistantName ? assistantName.charAt(0).toUpperCase() + assistantName.slice(1).toLowerCase() : 'Pearl');
        const botJoinPayload = {
          personalityId: initialPersonalityId,
          persona: botPersona,
          tenantId,
          voice: initialVoiceId,
          voiceProvider: initialVoiceProvider,
          voiceParameters: initialVoiceParameters,
          sessionId: sessionOverride?.sessionId || (session as any)?.sessionId || (session as any)?.user?.sessionId,
          // NEW: Pass session identity for environment seeding (room-scoped pending_identity)
          // But NO participantId since we don't know it yet
          ...(!stealth && effectiveSessionUserId ? { sessionUserId: effectiveSessionUserId } : {}),
          ...(!stealth && semail ? { sessionUserEmail: semail } : {}),
          ...(!stealth && (sname || username) ? { sessionUserName: sname || username } : {}),
          supportedFeatures: filteredSupportedFeatures,
          modePersonalityVoiceConfig: botModePersonalityVoiceConfig,
          sessionOverride,
          debugTraceId,
        };

        const botVoiceConfigSource = resolvedDailyCallConfig
          ? 'dailyCall'
          : modePersonalityVoiceConfig && currentMode && modePersonalityVoiceConfig[currentMode]
            ? 'mode'
            : 'prop';

        if (BOT_CONTROL_BASE_URL && initialPersonalityId && !stealth) {
          log.info('[Call.bot] joinRoom payload (sanitized)', {
            personalityId: botJoinPayload.personalityId,
            persona: botJoinPayload.persona,
            voice: botJoinPayload.voice,
            voiceProvider: botJoinPayload.voiceProvider,
            hasVoiceParameters: !!botJoinPayload.voiceParameters,
            supportedFeatures: botJoinPayload.supportedFeatures,
            modeConfigKeys: Object.keys(botModePersonalityVoiceConfig || {}),
            hasDailyCallConfig: !!dailyCallPersonalityVoiceConfig,
            hasModeConfig: !!modePersonalityVoiceConfig,
            botVoiceConfigSource,
            resolvedDailyCallPersona: resolvedDailyCallConfig?.personaName,
            resolvedDailyCallVoiceId: resolvedDailyCallConfig?.voice?.voiceId,
            resolvedDailyCallVoiceProvider: resolvedDailyCallConfig?.voice?.provider,
            sessionId: botJoinPayload.sessionId,
            sessionUserId: botJoinPayload.sessionUserId,
            sessionUserEmail: botJoinPayload.sessionUserEmail ? 'present' : 'absent',
            sessionUserName: botJoinPayload.sessionUserName,
            sessionOverride: botJoinPayload.sessionOverride ? 'present' : 'absent',
            debugTraceId,
          });
        }

        // Check if room already has a bot before attempting to join
        // This prevents duplicate bots when multiple users join the forum
        const checkForExistingBot = async (): Promise<boolean> => {
          try {
            // Get current participants from Daily.co
            const participants = daily?.participants?.();
            if (!participants) {
              return false;
            }

            // Check if any participant is a bot
            const { isBotParticipant } = await import('@interface/lib/daily/participant-manager');
            for (const [participantId, participant] of Object.entries(participants)) {
              if (isBotParticipant(participant as any, { expectedPersonaName: botJoinPayload.persona })) {
                log.info('[Call.bot] Found existing bot in room, skipping bot join', {
                  participantId,
                  participantName: (participant as any)?.user_name,
                  roomUrl,
                  debugTraceId,
                });
                logConn({
                  phase: 'bot.join.skipped.existing' as any,
                  roomUrl,
                  username,
                });
                return true; // Bot already exists
              }
            }
            return false; // No bot found
          } catch (e: any) {
            log.warn('[Call.bot] Error checking for existing bot', {
              error: String(e?.message || e),
              roomUrl,
              debugTraceId,
            });
            return false; // On error, proceed with bot join
          }
        };

        // Fetch token first so both client and bot can join token-gated/private rooms reliably.
        // Use the username prop directly to ensure the entered name is used
        const tokenDisplayName = stealth ? undefined : (username?.trim() || joinOpts.userName);
        log.info('[Call] Requesting token with displayName', {
          tokenDisplayName,
          username,
          joinOptsUserName: joinOpts.userName,
          stealth,
          debugTraceId,
        });
        requestDailyJoinToken(roomUrl, {
          stealth: !!stealth,
          displayName: tokenDisplayName,
        })
          .then((token) => {
            joinOpts.token = token;

            const botJoinPromise = (BOT_CONTROL_BASE_URL && initialPersonalityId && !stealth)
              ? checkForExistingBot()
                  .then((hasExistingBot) => {
                    if (hasExistingBot) {
                      // Bot already exists, skip join
                      log.info('[Call.bot] Bot join skipped - existing bot in room', { roomUrl, debugTraceId });
                      return null;
                    }
                    // No existing bot, proceed with join using same room token as client
                    return joinRoom(roomUrl, { ...botJoinPayload, token });
                  })
                  .then((resp: any) => {
                    if (!resp) {
                      // Bot join was skipped (existing bot found)
                      return null;
                    }
                    log.info('[Call.bot] Bot join response received', {
                      debugTraceId,
                      roomUrl,
                      status: resp?.status,
                      pid: resp?.pid,
                      sessionId: resp?.session_id,
                      reused: resp?.reused,
                      detail: resp?.detail,
                    });
                    if (resp && typeof resp.pid === 'number') {
                      const reused = (resp as any).reused ? 'reused' : 'fresh';
                      const transitioning = (resp as any).transitioning ? 'transitioning' : 'normal';
                      logConn({
                        phase: ('bot.join.success.prejoin.' + reused) as any,
                        roomUrl,
                        username,
                      });
                      log.info('[Call.bot] Bot spawned before daily.join', {
                        pid: resp.pid,
                        reused,
                        transitioning,
                        status: resp.status,
                        debugTraceId,
                      });
                    } else if (resp?.status === 'transitioning') {
                      log.info('[Call.bot] Bot is transitioning to this room', {
                        roomUrl,
                        sessionId: resp.session_id,
                        personalityId: resp.personalityId,
                        persona: resp.persona,
                        debugTraceId,
                      });
                      logConn({
                        phase: 'bot.join.transitioning' as any,
                        roomUrl,
                        username,
                      });
                    } else if (resp?.status === 'joined_existing') {
                      log.info('[Call.bot] Joined existing bot in room', {
                        roomUrl,
                        sessionId: resp.session_id,
                        debugTraceId,
                      });
                      logConn({
                        phase: 'bot.join.joined_existing' as any,
                        roomUrl,
                        username,
                      });
                    } else {
                      logConn({
                        phase: 'bot.join.missingpid.prejoin' as any,
                        roomUrl,
                        username,
                      });
                    }
                    return resp;
                  })
                  .catch((e: any) => {
                    logConn({
                      phase: 'bot.join.error.prejoin' as any,
                      roomUrl,
                      username,
                      error: String(e?.message || e),
                    });
                    log.error('[Call.bot] Bot join failed before daily.join', {
                      error: String(e?.message || e),
                      debugTraceId,
                    });
                    // Don't throw - allow daily.join to proceed even if bot spawn fails
                    return null;
                  })
              : Promise.resolve(null);

            // Run client join and bot join in parallel after token is available.
            return Promise.allSettled([daily.join(joinOpts), botJoinPromise]).then((results) => {
              const clientJoinResult = results[0];
              if (clientJoinResult.status === 'rejected') {
                throw clientJoinResult.reason;
              }
              return null;
            });
          })
          .then(async () => {
            setCallState(prev => ({ ...prev, joining: true }));
            logConn({ phase: 'join.success', roomUrl, username });

            // Get local participant ID directly after join
            const localParticipant = daily.participants()?.local;
            const participantId = localParticipant?.session_id;
            log.info('[Call.join] Local participant ID after join', { participantId });
            log.info('[Call.join] Participant will be identified via userData.sessionUserId');

            // Match test expectation: omit participantCount
            emitCallStateChange(roomUrl, 'joined', username);

            // Enforce the intended display name immediately after join (Daily can override via token profile)
            try {
              const desired = joinOpts.userName;
              if (desired) {
                await (daily as any)?.setUserName?.(desired);
                log.info('[Call.join] setUserName applied post-join', { desired });
              }
            } catch (nameErr) {
              log.warn('[Call.join] Failed to apply setUserName post-join', { error: String(nameErr) });
            }
            // Enforce A/V off immediately after join when in stealth
            if (stealth) {
              try {
                (daily as any)?.setLocalAudio?.(false);
                (daily as any)?.setLocalVideo?.(false);
                log.info('[Call.stealth] Forced audio/video OFF after join');
              } catch (_) {
                // noop
              }
            }
          })
          .catch((error: any) => {
            const errorMessage = String(error?.message || error);
            const isTokenError = errorMessage.includes('token');

            log.error('Call: Failed to join call:', error);
            logConn({
              phase: 'join.error',
              roomUrl,
              username,
              error: errorMessage,
              data: isTokenError ? { stage: 'token' } : undefined,
            });
            emitCallError(roomUrl, errorMessage, error?.code, username);
            triggerDevRoomCleanup();
            onLeave();
            joinAttemptedRef.current = false; // allow retry on error
          });
      } catch (e: any) {
        logConn({ phase: 'join.error', roomUrl, username, error: String(e?.message || e) });
        joinAttemptedRef.current = false;
      }
      scheduleStatePoll(
        () => ({
          meetingState: (daily as any)?.meetingState?.(),
          participants: daily.participants?.(),
        }),
        roomUrl,
        username
      );
    }

    return () => {
      // Always attempt a leave if the meeting state is joining or joined to free the session.
      if (daily && !callState.leaving) {
        const state = (daily as any)?.meetingState?.();
        if (state === 'joined' || state === 'joining') {
          setCallState(prev => ({ ...prev, leaving: true }));
          logConn({ phase: 'join.cleanup.leave', roomUrl, username, meetingState: state });
          emitCallStateChange(roomUrl, 'leaving', username, participantIds.length);
          try {
            daily.leave();
          } catch (err: any) {
            logConn({
              phase: 'join.cleanup.leave',
              roomUrl,
              username,
              error: String(err?.message || err),
            });
          }
        }
      }
    };
  }, [
    daily,
    username,
    onLeave,
    onProfileGate,
    callState.joining,
    callState.leaving,
    roomUrl,
    participantIds.length,
    session,
    stealth,
    personalityId,
    persona,
    tenantId,
    voiceId,
    voiceParameters,
    profileFirstName,
    profileLoaded,
    profileGateReason,
    requireProfile,
    requireProfileEvaluation,
    requireProfileEvaluation.missing,
    requireProfileEvaluation.source,
    triggerDevRoomCleanup,
    voiceProvider,
    modePersonalityVoiceConfig,
    dailyCallPersonalityVoiceConfig,
    currentMode,
    timeoutChecked,
    isTimedOut,
    timeoutInfo,
  ]);

    // Mode-specific personality updates are intentionally disabled for DailyCall sessions
  // to prevent hot-swapping during a call. The initial personality is set at join time.
  /*
  useEffect(() => {
    if (!modePersonalityVoiceConfig || !currentMode) return;
    // ...
  }, [currentMode, modePersonalityVoiceConfig, roomUrl, daily, voiceId, voiceProvider, voiceParameters]);
  */

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Persistent stealth mode enforcement - prevent any audio/video leaks
  useEffect(() => {
    if (!daily || !stealth) return;

    const enforceStealthMode = () => {
      try {
        const localParticipant = daily.participants()?.local;
        if (localParticipant?.audio || localParticipant?.video) {
          log.info(
            '[Call][stealth] SECURITY: Audio/video detected in stealth mode, forcing OFF'
          );
          if (localParticipant?.audio) {
            daily.setLocalAudio(false);
          }
          if (localParticipant?.video) {
            daily.setLocalVideo(false);
          }
        }
      } catch (error) {
        log.warn('[Call.stealth] Error enforcing stealth mode', { error: String((error as Error)?.message || error) });
      }
    };

    // Check immediately
    enforceStealthMode();

    // Set up interval to continuously monitor and enforce stealth
    const stealthEnforcementInterval = setInterval(enforceStealthMode, 1000);

    return () => {
      clearInterval(stealthEnforcementInterval);
    };
  }, [daily, stealth]);

  // Auto-switch to speaker mode when someone shares screen
  useEffect(() => {
    if (screens.length > 0) {
      setLayoutMode('speaker');
    } else if (layoutMode === 'speaker' && screens.length === 0) {
      setLayoutMode('grid');
    }
  }, [screens.length, layoutMode]);

  // Ensure we leave the call when the browser/tab is closing or reloading.
  useEffect(() => {
    if (!daily) return;
    // Initialize app-message bridge (idempotent). Snapshot includes participants summary.
    try {
      log.info('[Call.bridge] init.enter', {
        hasDaily: !!daily,
        meetingState: (daily as any)?.meetingState?.(),
      });
      logConn({
        phase: 'bridge.init.enter' as any,
        roomUrl,
        username,
        meetingState: (daily as any)?.meetingState?.(),
      });
    } catch (_) {
      // noop
    }
    initAppMessageBridge(daily, {
      getSnapshot: getParticipantsSnapshot,
      // Disallow all outbound (forwarded) messages
      allowOutbound: () => false,
      logInbound: true,
    });

    // WebSocket event bridge is started by useGatewayWebSocket in assistant-canvas.tsx
    // (works even without an active Daily call)
    
    // Send queued note context to bot (reads from localStorage)
    // REMOVED: Legacy queuing logic
    /*
    const handleFirstEvent = async () => {
      // ... (removed)
    };
    */
    
    const contextHeaders: Record<string, string> = {
      'x-session-id': sessionOverride?.sessionId || (session as any)?.sessionId || (session as any)?.user?.sessionId || '',
      'x-user-id': sessionOverride?.userId || session?.user?.id || '',
      'x-user-name': sessionOverride?.userName || session?.user?.name || username || '',
    };

    // Sync active note state for late joiners
    const syncActiveNoteState = async () => {
      const botServerUrl = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:8080';
      
      try {
        log.info('[notes] Querying active note state as late joiner');
        const response = await fetch(
          `${botServerUrl}/api/room/active-note?room_url=${encodeURIComponent(roomUrl)}`,
          {
            signal: AbortSignal.timeout(5000), // 5 second timeout
            headers: contextHeaders,
          }
        );
        
        if (!response.ok) {
          log.info('[notes] Failed to query active note state', { status: response.status });
          return;
        }
        
        const data = await response.json();
        
        if (data.has_active_note && data.note_id) {
          log.info('[notes] Active note detected:', data.note_title);
          // Emit event to NotesView to show indicator
          window.dispatchEvent(new CustomEvent('noteActiveInCall', {
            detail: {
              noteId: data.note_id,
              noteTitle: data.note_title || 'Shared Note',
              ownerId: data.owner_id
            }
          }));
        } else {
          log.info('[notes] No active note in call');
        }
      } catch (e) {
        // Silently ignore if bot server is not available - this is a non-critical feature
        if ((e as Error).name === 'AbortError') {
          log.info('[notes] Bot server request timed out - continuing without note sync');
        } else if ((e as Error).message?.includes('Failed to fetch')) {
          log.info('[notes] Bot server not available - continuing without note sync');
        } else {
          log.error('[notes] Error querying active note state', {
            error: String((e as Error)?.message || e),
          });
        }
      }
    };

    // Sync active applet state for late joiners
    const syncActiveAppletState = async () => {
      const botServerUrl = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:8080';
      
      try {
        log.info('[applets] Querying active applet state as late joiner');
        const response = await fetch(
          `${botServerUrl}/api/room/active-applet?room_url=${encodeURIComponent(roomUrl)}`,
          {
            signal: AbortSignal.timeout(5000), // 5 second timeout
            headers: contextHeaders,
          }
        );
        
        if (!response.ok) {
          log.info('[applets] Failed to query active applet state', { status: response.status });
          return;
        }
        
        const data = await response.json();
        
        if (data.has_active_applet && data.applet_id) {
          log.info('[applets] Active applet detected:', data.applet_id);
          // Emit event to AppletView to show indicator
          window.dispatchEvent(new CustomEvent('appletActiveInCall', {
            detail: {
              appletId: data.applet_id,
              ownerId: data.owner_id
            }
          }));
        } else {
          log.info('[applets] No active applet in call');
        }
      } catch (e) {
        // Silently ignore if bot server is not available - this is a non-critical feature
        if ((e as Error).name === 'AbortError') {
          log.info('[applets] Bot server request timed out - continuing without applet sync');
        } else if ((e as Error).message?.includes('Failed to fetch')) {
          log.info('[applets] Bot server not available - continuing without applet sync');
        } else {
          log.error('[applets] Error querying active applet state', {
            error: String((e as Error)?.message || e),
          });
        }
      }
    };
    
    // Listen for 'joined-meeting' event to trigger context sync
    const joinedHandler = () => {
      log.info('[notes] joined-meeting event detected');
      // First, try to activate queued note (early joiner)
      // handleFirstEvent(); // REMOVED
      // Then, query for existing active note (late joiner)
      setTimeout(() => {
        syncActiveNoteState();
        syncActiveAppletState();
      }, 500);
    };
    
    // Handle note close request from NotesView
    const handleNoteCloseRequest = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const { noteId } = customEvent.detail;
      const botServerUrl = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:8080';
      
      try {
        log.info('[notes] Handling note close request for:', noteId);
        const response = await fetch(`${botServerUrl}/api/session/${encodeURIComponent(roomUrl)}/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'close',
            userId: session?.user?.id || 'system',
            activeNoteId: null
          }),
          signal: AbortSignal.timeout(5000), // 5 second timeout
        });
        
        if (response.ok) {
          log.info('[notes] Successfully closed note');
          window.dispatchEvent(new Event('noteInactiveInCall'));
        }
      } catch (e) {
        // Silently ignore if bot server is not available - this is a non-critical feature
        if ((e as Error).name === 'AbortError') {
          log.info('[notes] Bot server request timed out while closing note');
        } else if ((e as Error).message?.includes('Failed to fetch')) {
          log.info('[notes] Bot server not available while closing note');
        } else {
          log.error('[notes] Error closing note', { error: String((e as Error)?.message || e) });
        }
      }
    };
    
    // Handle immediate note share when call is already active
    const handleSendQueuedNoteNow = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const { noteId, noteTitle } = customEvent.detail;
      const botServerUrl = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:8080';
      
      try {
        log.info('[notes] Sending note context to bot (immediate):', noteId);
        const response = await fetch(`${botServerUrl}/api/session/${encodeURIComponent(roomUrl)}/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'open',
            userId: session?.user?.id || 'unknown',
            activeNoteId: noteId
          }),
          signal: AbortSignal.timeout(5000),
        });
        
        if (response.ok) {
          log.info('[notes] Successfully sent note context to bot');
          // Clear queue
          localStorage.removeItem('nia_queued_note');
          // Emit event to NotesView with owner ID
          window.dispatchEvent(new CustomEvent('noteActiveInCall', {
            detail: { 
              noteId, 
              noteTitle,
              ownerId: session?.user?.id
            }
          }));
        } else if (response.status === 409) {
          // Conflict: another note is already active
          log.warn('[notes] Conflict: another note is already active');
          const conflictData = await response.json();
          window.dispatchEvent(new CustomEvent('noteQueueConflict', {
            detail: {
              noteTitle: conflictData.activeNoteTitle,
              userName: conflictData.activeNoteOwnerName || 'another user'
            }
          }));
        } else {
          log.warn('[notes] Failed to send note context', { status: response.status });
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          log.info('[notes] Bot server request timed out');
        } else if ((e as Error).message?.includes('Failed to fetch')) {
          log.info('[notes] Bot server not available');
        } else {
          log.error('[notes] Error sending note context', { error: String((e as Error)?.message || e) });
        }
      }
    };
    
    daily.on('joined-meeting', joinedHandler);
    window.addEventListener('requestNoteClose', handleNoteCloseRequest);
    window.addEventListener('sendQueuedNoteNow', handleSendQueuedNoteNow);

    // REMOVED: Daily.co app-message listener for admin-prompt forwarding
    // Admin messages now use direct HTTP API calls instead of Daily.co transport
    try {
      log.info('[Call.bridge] init.after', { meetingState: (daily as any)?.meetingState?.() });
      logConn({
        phase: 'bridge.init.after' as any,
        roomUrl,
        username,
        meetingState: (daily as any)?.meetingState?.(),
      });
    } catch (_) {
      // noop
    }
    // Small delay to confirm listener registration still present
    setTimeout(() => {
      try {
        log.info('[Call.bridge] post-delay.state', {
          meetingState: (daily as any)?.meetingState?.(),
        });
        logConn({
          phase: 'bridge.init.postdelay' as any,
          roomUrl,
          username,
          meetingState: (daily as any)?.meetingState?.(),
        });
      } catch (_) {
        // noop
      }
    }, 500);
    const handleBeforeUnload = () => {
      try {
        const state = (daily as any)?.meetingState?.();
        if (state === 'joined' || state === 'joining') {
          logConn({ phase: 'join.cleanup.leave', roomUrl, username, meetingState: state });
          daily.leave();
        }
      } catch (_) {
        // noop
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('requestNoteClose', handleNoteCloseRequest);
      window.removeEventListener('sendQueuedNoteNow', handleSendQueuedNoteNow);
      // Stop WebSocket event bridge on unmount
      try {
        import('../events/wsEventBridge').then(({ stopWsEventBridge }) => stopWsEventBridge());
      } catch (_) { /* noop */ }
    };
  }, [daily, roomUrl, username, session?.user?.id]);

  useEffect(() => {
    if (daily && callState.joining && !localSessionId) {
      const id = daily.participants()?.local?.session_id;
      if (id) {
        setLocalSessionId(id);
      }
    }
  }, [daily, callState.joining, localSessionId]);

  // Capture joining & joined events explicitly for deeper debugging (mapped to existing phases)
  useDailyEvent('joining-meeting', () => {
    logConn({ phase: 'join.effect.enter' as any, roomUrl, username });
    try {
      log.info('[Call.event] joining-meeting');
    } catch (_) {
      // noop
    }
  });
  useDailyEvent('joined-meeting', () => {
    logConn({ phase: 'join.success' as any, roomUrl, username });
    try {
      log.info('[Call.event] joined-meeting');
      log.debug('[Call.debug] Waiting for participant-joined event...');
      
      // Dispatch custom event for window close protection
      window.dispatchEvent(new Event('dailyCall.joined'));
      log.info('📞 [DAILY-CALL] Dispatched dailyCall.joined event');
    } catch (_) {
      // noop
    }
    try {
      logConn({
        phase: 'bridge.status.check' as any,
        roomUrl,
        username,
        meetingState: (daily as any)?.meetingState?.(),
      });
    } catch (_) {
      // noop
    }
    // Identity event emission removed; server now emits identity via join path.
  });
  useDailyEvent('error', (ev: any) => {
    logConn({ phase: 'join.error' as any, roomUrl, username, error: String(ev?.errorMsg || ev) });
    try {
      log.info('[Call.event] error', ev);
    } catch (_) {
      // noop
    }
  });

  useDailyEvent('left-meeting', () => {
    logConn({
      phase: 'event.left-meeting',
      roomUrl,
      username,
      participantCount: participantIds.length,
    });
    triggerDevRoomCleanup();
    if (callState.leaving) {
      emitCallStateChange(roomUrl, 'left', username, participantIds.length - 1);
      // Emit event to clear active note indicators in NotesView
      window.dispatchEvent(new Event('dailyCallEnded'));
      log.info('[notes] Call ended, emitted dailyCallEnded event');
      
      // Dispatch custom event to disable window close protection
      window.dispatchEvent(new Event('dailyCall.left'));
      log.info('📞 [DAILY-CALL] Dispatched dailyCall.left event');
      
      onLeave();
    }
  });

  useDailyEvent('participant-joined', (ev: any) => {
    if (ev?.participant?.session_id) {
      const p = ev.participant;
      // Skip emitting any events or recordings for stealth participants
      const stealth = p?.userData && (p.userData as any).stealth === true;
      if (stealth) {
        try {
          log.debug('[Call.event] participant-joined (stealth suppressed)', {
            id: p.session_id,
            local: !!p.local,
          });
        } catch (_) {
          // noop
        }
      } else {
        logConn({
          phase: 'event.participant.joined',
          roomUrl,
          username,
          participantId: p.session_id,
          local: !!p.local,
          joined: true,
        });

        try {
          log.info('[Call.event] participant-joined', { id: p.session_id, local: !!p.local });
        } catch (_) {
          // noop
        }
        // Emit legacy discrete join event (tests rely on this) for non-local participants
        // SECURITY: Skip emitting join events for stealth participants to prevent bot notification
        if (!p.local && !stealth) {
          emitParticipantJoin(roomUrl, p.session_id, p.user_name);
        }

        // NOTE: Bot join moved to immediate post-join handler in daily.join().then()
        // This ensures we get the participant ID right after joining instead of waiting for events
      }
      // Identity event emission removed; server now emits identity via join path.
      recordParticipantJoin(roomUrl, p.session_id, p.user_name, !!p.local, stealth);
      if (!stealth) {
        emitParticipantUpdate({
          roomUrl,
          participantId: p.session_id,
          username: p.user_name,
          joined: true,
          local: !!p.local,
          tracks: { audio: !!p.tracks?.audio?.subscribed, video: !!p.tracks?.video?.subscribed },
        });
      }
    }
  });

  useDailyEvent('participant-left', (ev: any) => {
    if (ev?.participant?.session_id) {
      const p = ev.participant;
      // Skip emitting events for stealth participants
      if (p?.userData && (p.userData as any).stealth === true) {
        try {
          log.info('[Call.event] participant-left (stealth suppressed)', {
            id: p.session_id,
            local: !!p.local,
            reason: ev?.reason,
          });
        } catch (_) {
          // noop
        }
        return;
      }
      logConn({
        phase: 'event.participant.left',
        roomUrl,
        username,
        participantId: p.session_id,
        local: !!p.local,
        joined: false,
        reason: ev?.reason,
      });
      try {
        log.info('[Call.event] participant-left', {
          id: p.session_id,
          local: !!p.local,
          reason: ev?.reason,
        });
      } catch (_) {
        // noop
      }
      if (!p.local) {
        emitParticipantLeave(roomUrl, p.session_id, p.user_name, ev?.reason);
      }
      recordParticipantLeave(roomUrl, p.session_id);
      emitParticipantUpdate({
        roomUrl,
        participantId: p.session_id,
        username: p.user_name,
        joined: false,
        local: !!p.local,
        tracks: { audio: false, video: false },
        reason: ev?.reason,
      });
    }
  });

  // Inbound nia.event stream handler (from app-message) — canonical ingestion path
  useDailyEvent('app-message', (ev: any) => {
    try {
      const data = ev?.data;
      if (!data || typeof data !== 'object') return;

      // Handle admin-kick message - force leave the call
      if (data.type === 'admin-kick') {
        log.warn('[Call] Received admin-kick message', {
          reason: data.reason,
          duration: data.duration,
          kickedBy: data.kickedBy,
        });
        
        // If this is a permanent ban, sign them out immediately (before showing UI)
        if (data.duration === 'forever') {
          log.warn('[Call] Permanent ban detected, signing out user');
          // Force leave the call first
          if (daily) {
            try {
              daily.leave();
            } catch (leaveErr) {
              log.warn('[Call] Error leaving after kick', { error: String(leaveErr) });
            }
          }
          // Sign out and redirect - this will navigate away from the page
          void signOut({ callbackUrl: '/login?error=AccessDenied' });
          return;
        }
        
        // For temporary kicks, show the kicked UI
        setIsTimedOut(true);
        setTimeoutInfo({
          remainingSeconds: data.remainingSeconds,
          reason: data.reason || 'You have been removed from this call by an administrator.',
        });
        // Force leave the call
        if (daily) {
          try {
            daily.leave();
          } catch (leaveErr) {
            log.warn('[Call] Error leaving after kick', { error: String(leaveErr) });
          }
        }
        return;
      }

      if (data.kind !== 'nia.event') return; // ignore other app messages
      const env = data as NiaEventEnvelope;
      if (typeof env.seq !== 'number') return;
      const last = niaLastSeqRef.current;
      if (env.seq <= last) return; // already processed or out-of-order older
      if (env.seq > last + 1) {
        // gap detected
        niaGapsRef.current.push({ expected: last + 1, got: env.seq });
        try {
          log.warn('[Call.nia.gap]', { expected: last + 1, got: env.seq });
        } catch (_) {
          // noop
        }
      }
      niaLastSeqRef.current = env.seq;
      setNiaEvents(prev => {
        const next = [...prev, env];
        // Keep only last 200 for memory safety
        return next.length > 200 ? next.slice(-200) : next;
      });

  // Derive UI side-effects from certain nia events if needed
  // Dedup: skip if already processed via gateway WebSocket
  if (isDuplicateEvent(env.seq, env.ts, env.event)) return;
  routeNiaEvent(env);
      if (env.event === 'daily.call.state') {
        // Optionally map phase -> joining/leaving flags; keep lightweight for now
        try {
          log.info('[Call.nia] call.state', env.payload);
        } catch (_) {
          // noop
        }
      } else if (env.event === 'daily.participants.change') {
        try {
          log.info('[Call.nia] participants.change', env.payload);
        } catch (_) {
          // noop
        }
      }
    } catch (e) {
      try {
        log.warn('[Call.nia] handler error', { error: String((e as Error)?.message || e) });
      } catch (_) {
        // noop
      }
    }
  });

  // Expose for ad-hoc debugging in dev tools
  useEffect(() => {
    try {
      (window as any).__niaEvents = niaEvents;
      (window as any).__niaEventState = {
        lastSeq: niaLastSeqRef.current,
        gaps: niaGapsRef.current.slice(),
      };
    } catch (_) {
      // noop
    }
  }, [niaEvents]);

  // Performance monitoring - log warnings for potential issues
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const participantCount = participantIds.length;
      const eventCount = niaEvents.length;

      // Warn if too many participants (potential performance issue)
      if (participantCount > 8) {
        log.warn(
          `[Performance] High participant count: ${participantCount}. This may cause heating issues.`
        );
      }

      // Warn if too many events (potential memory leak)
      if (eventCount > 100) {
        log.warn(
          `[Performance] High event count: ${eventCount}. Consider clearing old events.`
        );
      }

      // Warn if too many gaps (potential connection issues)
      if (niaGapsRef.current.length > 10) {
        log.warn(
          `[Performance] High gap count: ${niaGapsRef.current.length}. Connection may be unstable.`
        );
      }
    }
  }, [participantIds.length, niaEvents.length]);

  /**
   * Calculate grid layout - adaptive without artificial limits
   */
  const getGridLayout = () => {
    const count = visibleParticipantIds.length;

    // Get current window dimensions for responsive behavior
    const windowWidth = windowDimensions.width;

    // Base calculations
    if (count <= 1) return { columns: 1, rows: 1, needsScrolling: false, maxVisible: count };

    // Desktop-specific handling for 3 and 4 participants
    const isDesktop = windowWidth >= 1024;
    if (isDesktop && (count === 3 || count === 4)) {
      // Desktop: 3 or 4 participants use 2 columns × 2 rows layout
      return {
        columns: 2,
        rows: 2,
        needsScrolling: false,
        maxVisible: count,
        totalParticipants: count,
      };
    }

    // Determine max columns based on screen size
    let maxColumns;

    if (windowWidth < 480) {
      // Small Mobile: 2 columns
      maxColumns = 2;
    } else if (windowWidth < 768) {
      // Mobile: 2 columns
      maxColumns = 2;
    } else if (windowWidth < 1024) {
      // Tablet: 3 columns
      maxColumns = 3;
    } else {
      // Desktop: 4 columns
      maxColumns = 4;
    }

    // Calculate layout - show ALL participants, no artificial limits
    const columns = Math.min(count, maxColumns);
    const rows = Math.ceil(count / columns);

    return {
      columns,
      rows,
      needsScrolling: false, // No scrolling needed, show all participants
      maxVisible: count, // Show all participants
      totalParticipants: count,
    };
  };

  /**
   * Get the main speaker (first screen share, manually selected, or first participant)
   */
  const getMainSpeaker = () => {
    if (screens.length > 0) {
      return screens[0].session_id;
    }
    if (mainSpeakerId && visibleParticipantIds.includes(mainSpeakerId)) {
      return mainSpeakerId;
    }
    return visibleParticipantIds[0];
  };

  /**
   * Handle tap to switch main speaker (mobile feature)
   */
  const handleTapToSwitch = (sessionId: string) => {
    const isMobile = window.innerWidth <= 1024;
    if (isMobile && sessionId !== getMainSpeaker()) {
      setMainSpeakerId(sessionId);
    }
  };

  /**
   * Render grid layout with scrolling support
   */
  const renderGridLayout = () => {
    const layout = getGridLayout();

    return (
      <div
        className={`tiles grid-layout ${layout.needsScrolling ? 'scrollable' : ''} ${(layout.totalParticipants || 0) <= 4 ? 'few-participants' : 'many-participants'}`}
        style={
          {
            '--columns': layout.columns,
            '--rows': layout.rows,
            '--max-visible': layout.maxVisible,
            '--total-participants': layout.totalParticipants,
          } as React.CSSProperties
        }
      >
        {/* Scrollable container for all participants */}
        <div className="participants-container">
          {visibleParticipantIds.map((id, index) => (
            <Tile
              key={id}
              sessionId={id}
              layoutMode={layoutMode}
              onTap={handleTapToSwitch}
              tileIndex={index}
              totalTiles={visibleParticipantIds.length}
              gridColumns={layout.columns}
              gridRows={layout.rows}
              hidePearl={false} // Hide Pearl bot in Daily call to reduce UI clutter
            />
          ))}
        </div>

        {/* Scroll indicator when there are more participants */}
        {layout.needsScrolling && (
          <div className="scroll-indicator">
            <span className="participant-count">{layout.totalParticipants} participants</span>
            {/* <div className="scroll-hint">
              ↕ Scroll to see all
            </div> */}
          </div>
        )}
      </div>
    );
  };

  /**
   * Render speaker layout (one large, others small)
   */
  const renderSpeakerLayout = () => {
    const mainSpeaker = getMainSpeaker();
    const otherParticipants = visibleParticipantIds.filter(id => id !== mainSpeaker);

    return (
      <div className="tiles speaker-layout">
        <div className="main-speaker">
          <Tile
            sessionId={mainSpeaker}
            layoutMode="speaker-main"
            onTap={handleTapToSwitch}
            tileIndex={0}
            totalTiles={visibleParticipantIds.length}
            gridColumns={1}
            gridRows={1}
            hidePearl={false}
          />
        </div>
        {otherParticipants.length > 0 && (
          <div className="speaker-sidebar">
            {otherParticipants.map((id, index) => (
              <Tile
                key={id}
                sessionId={id}
                layoutMode="speaker-small"
                onTap={handleTapToSwitch}
                tileIndex={index + 1}
                totalTiles={visibleParticipantIds.length}
                gridColumns={1}
                gridRows={otherParticipants.length}
                hidePearl={false}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  /**
   * Render sidebar layout (vertical strip of participants)
   */
  const renderSidebarLayout = () => {
    const mainSpeaker = getMainSpeaker();
    const otherParticipants = visibleParticipantIds.filter(id => id !== mainSpeaker);

    return (
      <div className="tiles sidebar-layout">
        <div className="sidebar-main">
          <Tile
            sessionId={mainSpeaker}
            layoutMode="sidebar-main"
            onTap={handleTapToSwitch}
            tileIndex={0}
            totalTiles={visibleParticipantIds.length}
            gridColumns={1}
            gridRows={1}
            hidePearl={false}
          />
        </div>
        <div className="sidebar-strip">
          {otherParticipants.map((id, index) => (
            <Tile
              key={id}
              sessionId={id}
              layoutMode="sidebar-small"
              onTap={handleTapToSwitch}
              tileIndex={index + 1}
              totalTiles={visibleParticipantIds.length}
              gridColumns={1}
              gridRows={otherParticipants.length}
              hidePearl={false}
            />
          ))}
        </div>
      </div>
    );
  };

  /**
   * Render the appropriate layout
   */
  const renderLayout = () => {
    switch (layoutMode) {
      case 'speaker':
        return renderSpeakerLayout();
      case 'sidebar':
        return renderSidebarLayout();
      case 'grid':
      default:
        return renderGridLayout();
    }
  };

  /**
   * Handle layout mode change
   */
  const handleLayoutChange = (newMode: 'grid' | 'speaker' | 'sidebar') => {
    setLayoutMode(newMode);
  };

  /**
   * Handle controls visibility change
   */
  const handleControlsVisibilityChange = useCallback((visible: boolean) => {
    setControlsVisible(visible);
  }, []);

  // Format remaining timeout time for display
  const formatTimeoutDisplay = (seconds?: number) => {
    if (!seconds || seconds <= 0) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  // Show timeout UI if user is timed out and timeout has been checked
  if (timeoutChecked && isTimedOut) {
    const remainingDisplay = formatTimeoutDisplay(timeoutInfo?.remainingSeconds);
    return (
      <div className="Call timeout-gate" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--background, #0f0f0f)',
        color: 'var(--foreground, #fff)',
        padding: '2rem',
        textAlign: 'center',
      }}>
        <div style={{
          background: 'var(--card, #1a1a1a)',
          borderRadius: '16px',
          padding: '3rem',
          maxWidth: '480px',
          width: '100%',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
        }}>
          <div style={{
            fontSize: '4rem',
            marginBottom: '1.5rem',
          }}>
            ⏱️
          </div>
          <h2 style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            marginBottom: '1rem',
            color: 'var(--foreground, #fff)',
          }}>
            Access Temporarily Restricted
          </h2>
          <p style={{
            fontSize: '1rem',
            color: 'var(--muted-foreground, #888)',
            marginBottom: '1.5rem',
            lineHeight: 1.6,
          }}>
            {timeoutInfo?.reason || 'You have been temporarily removed from this room by an administrator.'}
          </p>
          {remainingDisplay && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'var(--accent, #2a2a2a)',
              padding: '0.75rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
              color: 'var(--muted-foreground, #888)',
            }}>
              <span>Time remaining:</span>
              <span style={{ fontWeight: 600, color: 'var(--foreground, #fff)' }}>{remainingDisplay}</span>
            </div>
          )}
          <div style={{ marginTop: '2rem' }}>
            <button
              onClick={onLeave}
              style={{
                background: 'var(--primary, #3b82f6)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.75rem 2rem',
                fontSize: '1rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--primary-hover, #2563eb)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'var(--primary, #3b82f6)'}
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`Call ${layoutMode}-mode ${isFullscreen ? 'fullscreen' : ''} prebuilt-style`}>
      {/* Top Controls with Participant Count and Screen Share Indicator */}
      <div className={`top-controls ${controlsVisible ? 'visible' : 'hidden'}`}>
        <div className="top-left-controls">
          {/* Recording indicator would go here if recording */}
        </div>

        <div className="top-right-controls">
          <div className="call-status">
            {meetingMode.active && (
              <button
                className="meeting-notes-btn"
                onClick={handleShowNotes}
                title="Show meeting notes on canvas"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#FFD233', marginRight: 8 }}
              >
                📋 Notes
              </button>
            )}
            <button
              className="meeting-mode-toggle"
              onClick={handleToggleMeetingMode}
              title={meetingMode.active ? 'Stop meeting mode' : 'Start meeting mode (Pearl takes notes silently)'}
              style={{
                background: meetingMode.active ? 'rgba(255,210,51,0.2)' : 'rgba(255,255,255,0.1)',
                border: meetingMode.active ? '1px solid rgba(255,210,51,0.4)' : '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: '13px',
                color: meetingMode.active ? '#FFD233' : '#aaa',
                marginRight: 8,
                transition: 'all 0.2s',
              }}
            >
              {meetingMode.active ? '📝 Meeting Mode' : '📝'}
            </button>
            <span className="participant-count-badge">👥 {visibleParticipantIds.length}</span>
            {screens.length > 0 && <span className="sharing-indicator">🖥️ Screen sharing</span>}
          </div>
        </div>
      </div>

      {/* Main Video Area */}
      <div className="video-area-main">{renderLayout()}</div>

      {/* Bottom Toolbar - Daily.co Style */}
      <DailyPrebuiltStyle
        layoutMode={layoutMode}
        onLayoutChange={handleLayoutChange}
        onLeave={onLeave}
        controlsVisible={controlsVisible}
        onControlsVisibilityChange={handleControlsVisibilityChange}
        roomUrl={roomUrl}
        stealth={stealth}
        isAdmin={isAdmin}
        tenantId={tenantId}
        assistantName={assistantName}
      />
    </div>
  );
};

export default Call;
