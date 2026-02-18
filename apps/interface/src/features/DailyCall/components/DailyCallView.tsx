/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import '../styles/daily-call.css';

import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import { DailyProvider } from '@daily-co/daily-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  requestWindowClose,
} from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import type { VoiceParametersInput } from '@interface/lib/voice/kokoro';
import { getClientLogger } from '@interface/lib/client-logger';

import { emitLocalJoin, emitLocalLeave } from '../events/publisher';
import * as dailyConfig from '../lib/config';
import { BOT_AUTO_JOIN } from '../lib/config';
import { logConn } from '../lib/instrumentation';
import { ProfileGateReason } from '../lib/requireUserProfileGate';

import Call from './Call';
import PreJoin from './PreJoin';

type VoiceParameters = VoiceParametersInput & {
  maxCallDuration?: number;
  participantLeftTimeout?: number;
  participantAbsentTimeout?: number;
  enableRecording?: boolean;
  enableTranscription?: boolean;
  applyGreenscreen?: boolean;
};

interface DailyCallViewProps {
  roomUrl: string;
  isAdmin: boolean;
  assistantName: string;
  supportedFeatures?: string[] | null;
  voiceId?: string;
  voiceProvider?: string;
  personalityId?: string;
  persona?: string;
  voiceParameters?: VoiceParameters;
  tenantId: string;
  modePersonalityVoiceConfig?: Record<string, any>;
  dailyCallPersonalityVoiceConfig?: Record<string, any>;
  sessionOverride?: Record<string, any>;
  onLeave: () => void;
  updateDailyProviderState: (username: string, joined: boolean) => void;
}

let singletonCallObject: DailyCall | null = null;

// Singleton state to persist Daily Call join state across component mounts/unmounts
// This prevents the prejoin screen from reappearing after minimize/restore operations
const persistentDailyState = {
  localJoined: false,
  localUsername: '',
  roomUrl: '',
  stealth: false,
};

const log = getClientLogger('[daily_call]');

// Profile gate removed - no longer using ProfileGateModalState

// Explicitly stop all local media tracks (camera/mic) to release hardware.
function stopLocalMediaTracks(callObj: any, roomUrl: string, username?: string) {
  if (!callObj) return;
  try {
    const participants = callObj.participants?.();
    const local = participants?.local;
    const tracks = local?.tracks || {};
    Object.keys(tracks).forEach(k => {
      const info: any = (tracks as any)[k];
      const track: MediaStreamTrack | undefined = info?.track || info?.persistentTrack;
      if (track && typeof track.stop === 'function') {
        try {
          track.stop();
          logConn({ phase: 'leave.media.track.stop' as any, roomUrl, username });
        } catch (e: any) {
          logConn({
            phase: 'leave.media.track.stop.error' as any,
            roomUrl,
            username,
            error: String(e?.message || e),
          });
        }
      }
    });
  } catch (e: any) {
    logConn({
      phase: 'leave.media.enumerate.error' as any,
      roomUrl,
      username,
      error: String(e?.message || e),
    });
  }
  // Also disable sending (in case tracks were auto-restarted)
  try {
    callObj.setLocalVideo?.(false);
  } catch (_) {
    // ignore
  }
  try {
    callObj.setLocalAudio?.(false);
  } catch (_) {
    // ignore
  }
}

function DailyCallView({
  roomUrl: initialRoomUrl,
  isAdmin,
  assistantName,
  supportedFeatures,
  tenantId,
  voiceId,
  voiceProvider,
  personalityId,
  persona,
  voiceParameters,
  modePersonalityVoiceConfig,
  dailyCallPersonalityVoiceConfig,
  sessionOverride,
  onLeave,
  updateDailyProviderState,
}: DailyCallViewProps) {
  // DIAGNOSTIC: Log component mount with all props
  useEffect(() => {
    log.info('🪟 [DailyCallView] Component mounted', {
      event: 'daily_call_view_mount',
      hasInitialRoomUrl: !!initialRoomUrl,
      initialRoomUrl,
      isAdmin,
      assistantName,
      tenantId,
      supportedFeaturesCount: Array.isArray(supportedFeatures) ? supportedFeatures.length : null,
      hasDailyCallFeature: Array.isArray(supportedFeatures) ? supportedFeatures.includes('dailyCall') : null,
      hasRequireUserProfile: Array.isArray(supportedFeatures) ? supportedFeatures.includes('requireUserProfile') : null,
      voiceId,
      voiceProvider,
      personalityId,
      persona,
    });
    logConn({ phase: 'init.view.mount' as any, roomUrl: initialRoomUrl, username: '' });
  }, []); // Only on mount

  // In dev mode, fetch room URL async if not provided
  const [roomUrl, setRoomUrl] = useState(initialRoomUrl);
  const [roomUrlLoading, setRoomUrlLoading] = useState(false);

  useEffect(() => {
    log.info('🪟 [DailyCallView] Room URL effect triggered', {
      event: 'daily_call_room_url_effect',
      hasInitialRoomUrl: !!initialRoomUrl,
      initialRoomUrl,
      currentRoomUrl: roomUrl,
      roomUrlLoading,
    });

    if (initialRoomUrl) {
      log.info('🪟 [DailyCallView] Using provided initial room URL', {
        event: 'daily_call_using_initial_room_url',
        initialRoomUrl,
      });
      setRoomUrl(current => (current === initialRoomUrl ? current : initialRoomUrl));
      return;
    }

    // If no room URL provided, try to fetch dev room
    const fetchDevRoom = async () => {
      log.info('🪟 [DailyCallView] Fetching dev room URL', {
        event: 'daily_call_fetch_dev_room_start',
      });
      setRoomUrlLoading(true);
      try {
        const res = await fetch('/api/dailyCall/devRoom');
        log.info('🪟 [DailyCallView] Dev room fetch response', {
          event: 'daily_call_fetch_dev_room_response',
          status: res.status,
          ok: res.ok,
        });
        if (res.ok) {
          const data = await res.json();
          log.info('🪟 [DailyCallView] Dev room fetch success', {
            event: 'daily_call_fetch_dev_room_success',
            hasRoomUrl: !!data.roomUrl,
            roomUrl: data.roomUrl,
          });
          if (data.roomUrl) {
            setRoomUrl(data.roomUrl);
          } else {
            log.error('🪟 [DailyCallView] Dev room response missing roomUrl', {
              event: 'daily_call_fetch_dev_room_missing_url',
              data,
            });
          }
        } else {
          const errorText = await res.text().catch(() => '');
          log.error('🪟 [DailyCallView] Failed to fetch dev room', {
            event: 'daily_call_fetch_dev_room_failed',
            status: res.status,
            statusText: res.statusText,
            errorText,
          });
        }
      } catch (e) {
        log.error('🪟 [DailyCallView] Error fetching dev room', {
          event: 'daily_call_fetch_dev_room_error',
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
      } finally {
        setRoomUrlLoading(false);
      }
    };

    fetchDevRoom();
  }, [initialRoomUrl]);

  // Initialize state from persistent singleton state to survive component unmounts during minimize/restore
  const [localUsername, setLocalUsername] = useState(() => {
    // If we have persistent state for the same room, restore it
    if (persistentDailyState.roomUrl === roomUrl && persistentDailyState.localUsername) {
      return persistentDailyState.localUsername;
    }
    return '';
  });

  const [localJoined, setLocalJoined] = useState(() => {
    // If we have persistent state for the same room, restore it
    if (persistentDailyState.roomUrl === roomUrl) {
      return persistentDailyState.localJoined;
    }
    return false;
  });
  const { data: session } = useResilientSession();
  const [callObjectState, setCallObjectState] = useState<DailyCall | null>(
    () => singletonCallObject
  );
  // Forum entry should always be explicit (name required), so stealth/autojoin is disabled here.
  const stealthEnabled = false;

  // Profile gate removed - no longer blocking joins
  // Keep a simple callback for compatibility (won't be called)
  const notifyProfileGate = useCallback(
    (reason: ProfileGateReason) => {
      log.info('🪟 [DailyCallView] Profile gate callback called (ignored)', {
        event: 'daily_call_profile_gate_ignored',
        reason,
      });
      // No-op: profile gate removed, just log for debugging
    },
    []
  );

  const endCall = React.useCallback(
    (reason?: string) => {
      if (cleanupRanRef.current) {
        log.warn('🪟 [DailyCallView] endCall called but cleanup already ran', {
          event: 'daily_call_endcall_duplicate',
          reason,
        });
        return;
      }
      cleanupRanRef.current = true;
      const prior = localUsername;
      const leaveReason = reason ?? 'manual';

      log.info('🪟 [DailyCallView] endCall triggered', {
        event: 'daily_call_endcall',
        reason: leaveReason,
        priorUsername: prior,
        roomUrl,
        hasCallObject: !!singletonCallObject,
      });
      logConn({ phase: 'leave.user', roomUrl, username: prior, reason: leaveReason } as any);

      const finalize = () => {
        try {
          window.dispatchEvent(new CustomEvent('dailyCall.session.end'));
          requestWindowClose({ viewType: 'dailyCall', source: 'nia.event:apps.close'});
        } catch (_) {
          // ignore
        }
        emitLocalLeave(roomUrl, prior || undefined, leaveReason);
        if (typeof updateDailyProviderState === 'function') {
          updateDailyProviderState('', false);
        }
        persistentDailyState.localJoined = false;
        persistentDailyState.localUsername = '';
        persistentDailyState.roomUrl = '';
        persistentDailyState.stealth = false;
        try {
          onLeave();
        } catch (_) {
          // ignore
        }
      };

      const destroyCallObject = () => {
        if (!singletonCallObject) return;
        try {
          stopLocalMediaTracks(singletonCallObject, roomUrl, prior);
        } catch (_) {
          // ignore
        }
        try {
          logConn({
            phase: 'leave.callobject.destroy.start' as any,
            roomUrl,
            username: prior,
            reason: leaveReason,
          });
          singletonCallObject.destroy?.();
          logConn({
            phase: 'leave.callobject.destroy.success' as any,
            roomUrl,
            username: prior,
            reason: leaveReason,
          });
        } catch (e: any) {
          logConn({
            phase: 'leave.callobject.destroy.error' as any,
            roomUrl,
            username: prior,
            reason: leaveReason,
            error: String(e?.message || e),
          });
        } finally {
          singletonCallObject = null;
        }
      };

      const performLeave = () => {
        if (!singletonCallObject) return Promise.resolve();
        const state = (singletonCallObject as any)?.meetingState?.();
        if (state === 'joined' || state === 'joining') {
          try {
            singletonCallObject.leave?.();
          } catch (e: any) {
            logConn({
              phase: 'leave.user.error' as any,
              roomUrl,
              username: prior,
              reason: leaveReason,
              error: String(e?.message || e),
            });
          }
        }
        return Promise.resolve();
      };

      Promise.resolve()
        .then(() => performLeave())
        .finally(() => {
          destroyCallObject();
          finalize();
        });
    },
    [localUsername, onLeave, roomUrl, updateDailyProviderState]
  );

  // Profile gate handlers removed - no longer needed

  // Diagnostics: track voice resolution changes for this view
  useEffect(() => {
    if (!assistantName) return;
    // Log whenever the resolved voiceId changes so we can trace what gets used for joins
    logConn({
      phase: 'voice.resolved' as any,
      roomUrl,
      username: localUsername,
      // Extra diagnostic fields not in LogPayload
      assistantName,
      tenantId,
      voiceId: voiceId,
    } as any);
  }, [assistantName, tenantId, voiceId, roomUrl, localUsername]);

  useEffect(() => {
    try {
      const key = `daily.personality.${persona}`;
      window.localStorage.setItem(key, persona || 'Pearl');
      const key2 = `daily.personality.${persona}.id`;
      window.localStorage.setItem(key2, personalityId || 'some-id');
    } catch (_) {
      // ignore
    }
  }, [assistantName, personalityId, persona]);
  // Guard to ensure we don't run cleanup twice (explicit leave + unmount)
  const cleanupRanRef = React.useRef(false);
  // Bot lifecycle state removed: interface now only triggers a /join; /leave handled server-side.
  // Root element ref for DOM visibility/removal detection (in case React unmount is bypassed)
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  // Fetch dev room URL if needed
  useEffect(() => {
    // If room URL provided or already fetched, nothing to do
    if (roomUrl || roomUrlLoading) return;

    // Only fetch in dev mode when room URL is missing
    if (process.env.NODE_ENV === 'development' && !initialRoomUrl) {
      setRoomUrlLoading(true);
      dailyConfig.getDailyRoomUrl().then(url => {
        setRoomUrl(url);
        setRoomUrlLoading(false);
      }).catch(err => {
        log.error('Failed to fetch dev room URL', {
          event: 'daily_call_fetch_dev_room_url_error',
          error: err,
        });
        setRoomUrlLoading(false);
      });
    }
  }, [roomUrl, initialRoomUrl, roomUrlLoading]);

  useEffect(() => {
    logConn({ phase: 'init.view.mount', roomUrl, username: localUsername });

    // Clear persistent state if room URL changes (different room)
    if (persistentDailyState.roomUrl && persistentDailyState.roomUrl !== roomUrl) {
      persistentDailyState.localJoined = false;
      persistentDailyState.localUsername = '';
      persistentDailyState.roomUrl = '';
      logConn({ phase: 'init.room.changed', roomUrl, username: localUsername });
    }

    if (!roomUrl) {
      logConn({ phase: 'init.env.roomurl.missing' as any, roomUrl, username: localUsername });
    }
  }, [roomUrl, localUsername]);

  // Prefill username from authenticated session once (if user has not typed yet)
  useEffect(() => {
    if (!localUsername && session?.user?.name) {
      const prefill = String(session.user.name).trim();
      if (prefill) {
        setLocalUsername(prefill);
        // Update persistent state
        persistentDailyState.localUsername = prefill;
        persistentDailyState.roomUrl = roomUrl;
        logConn({ phase: 'prejoin.username.prefill', roomUrl, username: prefill });
      }
    }
  }, [session, localUsername, roomUrl]);

  const handleNameChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const v = ev.target.value.trim();
    setLocalUsername(v);
    // Update persistent state
    persistentDailyState.localUsername = v;
    persistentDailyState.roomUrl = roomUrl;
    logConn({ phase: 'prejoin.username.change', roomUrl, username: v });
  };

  const handlePreJoin = async (overrideName?: string) => {
    const effectiveName = (overrideName ?? localUsername).trim();
    log.info('🪟 [DailyCallView] Pre-join initiated', {
      event: 'daily_call_prejoin_start',
      effectiveName,
      overrideName,
      localUsername,
      roomUrl,
      hasSession: !!session,
      userId: session?.user?.id ?? null,
    });
    logConn({ phase: 'prejoin.join.click', roomUrl, username: effectiveName });
    
    // Simple validation: just require a name
    if (!effectiveName) {
      log.warn('🪟 [DailyCallView] Pre-join blocked: no effective name', {
        event: 'daily_call_prejoin_no_name',
        overrideName,
        localUsername,
      });
      return;
    }

    // No profile gate - just join with the entered name
    log.info('🪟 [DailyCallView] Joining without profile gate', {
      event: 'daily_call_prejoin_no_gate',
      effectiveName,
      roomUrl,
    });

    if (effectiveName !== localUsername) {
      setLocalUsername(effectiveName);
      persistentDailyState.localUsername = effectiveName;
    }
    setLocalJoined(true);
    // Update persistent state
    persistentDailyState.localJoined = true;
    persistentDailyState.roomUrl = roomUrl;
    if (typeof updateDailyProviderState === 'function') {
      updateDailyProviderState(effectiveName, true);
    }
    emitLocalJoin(effectiveName, roomUrl);
    try {
      // Signal broader app layer that a Daily call session is starting so it can pause/mute assistant (pipecat)
      window.dispatchEvent(new CustomEvent('dailyCall.session.start'));
    } catch (_) {
      // ignore
    }
    // ARCHITECTURAL FIX: Bot /join endpoint now called from Call.tsx after getting real participant ID
    // This ensures identity files are created with actual PID for proper bot mapping
  };

  // Auto-join: always skip PreJoin screen and join immediately
  // (PreJoin / "Early Access" screen disabled for now — will revisit later)
  const autoJoinFiredRef = useRef(false);
  useEffect(() => {
    if (localJoined || autoJoinFiredRef.current) return;
    // Use session username or fallback to 'anonymous'
    const name = localUsername || session?.user?.name || 'anonymous';
    if (!roomUrl) return;
    autoJoinFiredRef.current = true;
    log.info('[DailyCallView] Auto-join triggered', {
      event: 'daily_call_auto_join',
      username: name,
      roomUrl,
    });
    // Defer slightly to let other effects settle
    const timer = setTimeout(() => {
      void handlePreJoin(String(name).trim());
    }, 100);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localJoined, localUsername, session, roomUrl]);

  useEffect(() => {
    if (!roomUrl) return;
    let changed = false;
    if (singletonCallObject) {
      try {
        const existingUrl = (singletonCallObject as any)?.properties?.url;
        if (existingUrl && existingUrl !== roomUrl) {
          logConn({ phase: 'init.callobject.reuse', roomUrl: existingUrl });
          try {
            singletonCallObject.leave?.();
          } catch (_) {
            // ignore
          }
          try {
            singletonCallObject.destroy?.();
          } catch (_) {
            // ignore
          }
          singletonCallObject = null;
          changed = true;
        } else {
          logConn({ phase: 'init.callobject.reuse', roomUrl: existingUrl || roomUrl });

          // Ensure noise cancellation is enabled for reused call object
          try {
            singletonCallObject.updateInputSettings({
              audio: { processor: { type: 'noise-cancellation' } },
            });
            logConn({
              phase: 'init.reuse.noise-cancellation.enabled',
              roomUrl: existingUrl || roomUrl,
            });
          } catch (error) {
            logConn({
              phase: 'init.reuse.noise-cancellation.error',
              roomUrl: existingUrl || roomUrl,
              error: String(error),
            });
          }
        }
      } catch (e: any) {
        logConn({ phase: 'init.callobject.reuse', roomUrl, error: String(e) });
      }
    }
    if (!singletonCallObject) {
      logConn({ phase: 'init.callobject.create.start', roomUrl });
      try {
        singletonCallObject = DailyIframe.createCallObject({
          url: roomUrl,
          allowMultipleCallInstances: true,
        });
        logConn({ phase: 'init.callobject.create.success', roomUrl });

        // Configure audio input: disable Daily's noise-cancellation processor
        // and Chrome's built-in audio processing to prevent distortion of
        // TTS playback audio when the microphone activates.
        try {
          singletonCallObject.updateInputSettings({
            audio: {
              processor: { type: 'none' },
            },
          });
          logConn({ phase: 'init.audio-processing.configured', roomUrl });
        } catch (error) {
          logConn({ phase: 'init.audio-processing.error', roomUrl, error: String(error) });
        }
        // Attach listeners immediately after creation (valid phases mapped to existing ones)
        try {
          const co: any = singletonCallObject;
          const events: Array<[string, any]> = [
            ['joining-meeting', () => logConn({ phase: 'join.effect.enter' as any, roomUrl })],
            ['joined-meeting', () => logConn({ phase: 'join.success' as any, roomUrl })],
            ['left-meeting', () => logConn({ phase: 'leave.user' as any, roomUrl })],
            [
              'error',
              (ev: any) =>
                logConn({ phase: 'join.error' as any, roomUrl, error: String(ev?.errorMsg || ev) }),
            ],
            [
              'camera-error',
              (ev: any) =>
                logConn({
                  phase: 'join.error' as any,
                  roomUrl,
                  error: 'camera-error:' + String(ev?.errorMsg || ev),
                }),
            ],
            // Diagnostics: app-message data channel events from bot/pipeline
            [
              'app-message',
              (ev: any) => {
                try {
                  const d = ev?.data || {};
                  logConn({
                    phase: 'diag.appmessage.inbound' as any,
                    roomUrl,
                    meta: {
                      seq: typeof d.seq === 'number' ? d.seq : undefined,
                      event: d.event,
                      kind: d.kind,
                    },
                  } as any);
                } catch (_) {
                  // ignore
                }
              },
            ],
          ];
          // Additional broad diagnostic events (best-effort; duplicates ignored)
          const extraCandidates = [
            'track-started',
            'track-stopped',
            'participant-updated',
            'participant-left',
            'participant-joined',
            'inputs-updated',
            'started-camera',
            'camera-error',
            'error',
            'network-quality-change',
            'active-speaker-change',
            'network-connection',
            'recording-started',
            'recording-stopped',
            'transcription-started',
            'transcription-stopped',
            'live-streaming-started',
            'live-streaming-stopped',
            'meeting-session-updated',
            'app-message:raw',
            'device-change',
          ];
          extraCandidates.forEach(name => {
            try {
              events.push([
                name,
                (_ev: any) => {
                  // Additional diagnostics are intentionally suppressed from console; rely on logConn hooks above
                },
              ]);
            } catch (_) {
              // ignore
            }
          });
          try {
            logConn({
              phase: 'diag.daily.subscribe',
              roomUrl,
              events: events.map(e => e[0]),
            } as any);
          } catch (_) {
            // ignore
          }
          events.forEach(([evt, fn]) => {
            try {
              co.off(evt, fn);
            } catch (_) {
              // ignore
            }
            try {
              co.on(evt, fn);
            } catch (_) {
              // ignore
            }
          });
        } catch (e: any) {
          logConn({
            phase: 'init.callobject.create.error',
            roomUrl,
            error: 'listener:' + String(e?.message || e),
          });
        }
        changed = true;
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        if (/Duplicate DailyIframe instances/i.test(msg)) {
          // Attempt to locate an existing instance from Daily's global registry if available
          try {
            const w: any = window as any;
            const instMap = w?._daily?.instances;
            if (instMap && typeof instMap === 'object') {
              const first = Object.values(instMap)[0] as any;
              // Heuristic: look for a call object reference
              const maybe = first?._callObject || first?.callObject || first;
              if (maybe) {
                singletonCallObject = maybe;
                logConn({ phase: 'init.callobject.duplicate', roomUrl, error: msg });
                changed = true;
              }
            }
          } catch (_) {
            /* ignore */
          }
        } else {
          logConn({ phase: 'init.callobject.create.error', roomUrl, error: msg });
          singletonCallObject = null;
        }
      }
    }
    if (changed) setCallObjectState(singletonCallObject);
  }, [roomUrl, personalityId, persona]);

  // Listen for a global forced close event dispatched by window controls to ensure proper leave
  useEffect(() => {
    const handler = () => {
      endCall();
    };
    window.addEventListener('dailyCall.forceClose', handler);
    return () => window.removeEventListener('dailyCall.forceClose', handler);
  }, [endCall]);

  // Auto-cleanup ONLY on actual window close / hard navigation (not on mere window moves or focus changes).
  // Previously we also listened to 'pagehide', which in some embedding contexts (or certain browser window
  // management events) was firing when the parent window was merely moved/resized, causing unintended disconnects.
  // Requirement: keep the call active unless the tab/window is truly closing or component unmounts.
  useEffect(() => {
    // Only clean up on actual page unload/navigation away (NOT on mere React unmount which can
    // happen when the assistant session minimizes or React StrictMode remounts). Previously we
    // also invoked cleanup on unmount which caused the Daily call to end as soon as the assistant
    // minimized. We now retain the call object across unmounts and rely on explicit user leave or
    // real page unload.
    const autoCleanup = (reason: string) => {
      if (cleanupRanRef.current) return;
      const state = (singletonCallObject as any)?.meetingState?.();
      const shouldCleanup = localJoined || state === 'joined' || state === 'joining';
      if (!shouldCleanup) return;
      logConn({
        phase: 'leave.autocleanup.start' as any,
        roomUrl,
        username: localUsername,
        reason,
        meetingState: state,
      });
      try {
        if (singletonCallObject) {
          try {
            singletonCallObject.leave?.();
          } catch (e: any) {
            logConn({
              phase: 'leave.autocleanup.leave.error' as any,
              roomUrl,
              username: localUsername,
              error: String(e?.message || e),
            });
          }
          stopLocalMediaTracks(singletonCallObject, roomUrl, localUsername);
          try {
            singletonCallObject.destroy?.();
            logConn({
              phase: 'leave.autocleanup.destroy.success' as any,
              roomUrl,
              username: localUsername,
            });
          } catch (e: any) {
            logConn({
              phase: 'leave.autocleanup.destroy.error' as any,
              roomUrl,
              username: localUsername,
              error: String(e?.message || e),
            });
          } finally {
            singletonCallObject = null;
          }
        }
      } finally {
        cleanupRanRef.current = true;
        // Clear persistent state during auto cleanup
        persistentDailyState.localJoined = false;
        persistentDailyState.localUsername = '';
        persistentDailyState.roomUrl = '';
        if (typeof updateDailyProviderState === 'function') {
          updateDailyProviderState('', false);
        }
        emitLocalLeave(roomUrl, localUsername || undefined, reason);
        try {
          window.dispatchEvent(new CustomEvent('dailyCall.session.end'));
        } catch (_) {
          // ignore
        }
      }
    };

    const handleBeforeUnload = () => autoCleanup('beforeunload');
    // NOTE: Intentionally NOT listening to 'pagehide' anymore to prevent disconnects
    // when the window is merely moved or temporarily backgrounded. If future mobile
    // Safari support needs deterministic cleanup, consider a guarded pagehide with
    // additional heuristics (visibilityState === 'hidden' && !document.hasFocus()).
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      // IMPORTANT: Do NOT auto-clean on unmount to preserve call during assistant minimize.
      // Fire lightweight UI hidden event so avatar can restore size if needed.
      if (!cleanupRanRef.current) {
        logConn({ phase: 'leave.user' as any, roomUrl, username: localUsername });
      }
      try {
        window.dispatchEvent(new CustomEvent('dailyCall.ui.hidden'));
      } catch (_) {
        // ignore
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [roomUrl, localJoined, localUsername, updateDailyProviderState]);

  // NOTE: We intentionally do NOT destroy the singleton on unmount to avoid
  // 'Use after destroy' errors caused by React 18 StrictMode double-mount behavior.
  // Destruction should be handled explicitly after a confirmed leave if desired.
  const prejoin = !localJoined;

  // eslint-disable-next-line no-console
  log.debug('Render mode decision', {
    event: 'daily_call_render_mode',
    localJoined,
    prejoin,
    isAdmin,
    stealthEnabled,
  });

  // Show loading state while fetching dev room URL
  if (process.env.NODE_ENV === 'development' && !initialRoomUrl && roomUrlLoading) {
    return <div className="p-6 text-sm text-gray-500">Setting up dev room...</div>;
  }

  return (
    <div className="nia-daily-call-root" ref={rootRef} data-role="daily-call-root">
      <div className={`daily-call-view ${prejoin ? 'prejoin-align' : ''}`}>
        <DailyProvider callObject={callObjectState || undefined}>
          {localJoined ? (
            <Call
              username={localUsername}
              roomUrl={roomUrl}
              onLeave={endCall}
              onProfileGate={notifyProfileGate}
              assistantName={assistantName}
              session={session}
              stealth={stealthEnabled}
              isAdmin={isAdmin}
              tenantId={tenantId}
              personalityId={personalityId}
              persona={persona}
              voiceId={voiceId}
              voiceProvider={voiceProvider}
              voiceParameters={voiceParameters}
              supportedFeatures={supportedFeatures}
              modePersonalityVoiceConfig={modePersonalityVoiceConfig}
              dailyCallPersonalityVoiceConfig={dailyCallPersonalityVoiceConfig}
              sessionOverride={sessionOverride}
            />
          ) : prejoin ? (
            /* PreJoin / "Early Access" screen disabled — auto-join handles entry.
               Show minimal loading state while waiting for auto-join to fire. */
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '14px' }}>
              Connecting…
            </div>
          ) : null}
        </DailyProvider>
      </div>
    </div>
  );
}

export default DailyCallView;

// Side-effect observer restoration (UI hidden detection)
if (typeof window !== 'undefined') {
  queueMicrotask(() => {
    try {
      const candidate = document.querySelector(
        '[data-role="daily-call-root"]'
      ) as HTMLElement | null;
      if (!candidate) return;
      const attr = 'data-daily-hidden-observed';
      if (candidate.getAttribute(attr) === '1') return;
      candidate.setAttribute(attr, '1');
      let hiddenDispatched = false;
      const dispatchHidden = (reason: string) => {
        if (hiddenDispatched) return;
        hiddenDispatched = true;
        try {
          window.dispatchEvent(new CustomEvent('dailyCall.ui.hidden', { detail: { reason } }));
        } catch {
          // ignore
        }
      };
      const mo = new MutationObserver(() => {
        if (!candidate.isConnected) {
          dispatchHidden('dom-removed');
          mo.disconnect();
          clearInterval(interval);
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      const interval = window.setInterval(() => {
        if (!candidate.isConnected) {
          dispatchHidden('interval-not-connected');
          clearInterval(interval);
          mo.disconnect();
          return;
        }
        const style = window.getComputedStyle(candidate);
        const isElementHidden =
          style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        const isDocumentVisible = !document.hidden;
        const hasWindowFocus = document.hasFocus();
        if (isElementHidden && isDocumentVisible && hasWindowFocus) {
          dispatchHidden('style-hidden');
        }
      }, 1500);
      window.addEventListener('beforeunload', () => {
        if (!hiddenDispatched) dispatchHidden('beforeunload');
        try {
          mo.disconnect();
        } catch {
          // ignore
        }
        clearInterval(interval);
      });
    } catch (_) {
      // ignore
    }
  });
}
