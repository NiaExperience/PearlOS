'use client';

import type { DailyCall } from '@daily-co/daily-js';
import {
  useAudioTrack,
  useDaily,
  useLocalSessionId,
  useVideoTrack,
  useScreenShare,
  useParticipantIds,
  useDailyEvent
} from "@daily-co/daily-react";
import { ResourceShareRole, ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { useToast } from '@interface/hooks/use-toast';
import { getClientLogger } from '@interface/lib/client-logger';

import { 
  isScreenShareSupported, 
  isSecureContext, 
  getScreenShareErrorMessage,
  SCREEN_SHARE_OPTIONS 
} from '../lib/screenShare';



import Chat from './Chat';
import ParticipantsPanel from './ParticipantsPanel';
import SettingsPanel from './SettingsPanel';

const ShareIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 48 48"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="4"
    strokeLinecap="square"
    strokeLinejoin="miter"
    shapeRendering="crispEdges"
    style={{ imageRendering: 'pixelated' }}
  >
    <rect x="8" y="22" width="8" height="8" fill="currentColor" />
    <rect x="32" y="10" width="8" height="8" fill="currentColor" />
    <rect x="32" y="30" width="8" height="8" fill="currentColor" />
    <path d="M16 26 L32 14" />
    <path d="M16 26 L32 34" />
  </svg>
);

interface DailyPrebuiltStyleProps {
  layoutMode: 'grid' | 'speaker' | 'sidebar';
  onLayoutChange: (mode: 'grid' | 'speaker' | 'sidebar') => void;
  onLeave: () => void;
  controlsVisible?: boolean;
  onControlsVisibilityChange?: (visible: boolean) => void;
  roomUrl?: string; // Room URL for chat history sharing
  stealth?: boolean; // When true, hide all controls except leave button
  isAdmin?: boolean; // Admin status for enhanced chat features
  tenantId?: string; // Tenant ID for admin access validation
  assistantName?: string; // Assistant subdomain for share links
}

const DailyPrebuiltStyle: React.FC<DailyPrebuiltStyleProps> = ({ 
  layoutMode, 
  onLayoutChange,
  onLeave,
  controlsVisible: externalControlsVisible,
  onControlsVisibilityChange,
  roomUrl,
  stealth = false,
  isAdmin = false,
  tenantId,
  assistantName,
}) => {
  const log = getClientLogger('[daily_call]');
  const { toast } = useToast();

  log.debug('DailyPrebuiltStyle props received', {
    event: 'daily_call_prebuilt_props',
    stealth,
    isAdmin,
    roomUrl,
  });

  // Find the browser window container to portal panels into
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  
  useEffect(() => {
    // Find the browser window container (the one with overflow: hidden)
    const findBrowserWindow = () => {
      // Look for the browser window container
      const browserWindow = document.querySelector('[class*="border"][class*="rounded-xl"][class*="overflow-hidden"]');
      if (browserWindow) {
        setPortalContainer(browserWindow as HTMLElement);
      } else {
        // Fallback to body if browser window not found
        setPortalContainer(document.body);
      }
    };
    
    findBrowserWindow();
    
    // Set up observer to detect when browser window is added/removed
    const observer = new MutationObserver(findBrowserWindow);
    observer.observe(document.body, { childList: true, subtree: true });
    
    return () => observer.disconnect();
  }, []);
  const daily = useDaily();
  const localId = useLocalSessionId();
  const camTrack = useVideoTrack(localId);
  const micTrack = useAudioTrack(localId);
  const { isSharingScreen, startScreenShare, stopScreenShare } = useScreenShare();
  const participantIds = useParticipantIds();
  const recordingAttemptRef = useRef(false);

  // State management
  const [showParticipants, setShowParticipants] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [sharePending, setSharePending] = useState(false);
  const canShare = Boolean(roomUrl);
  // Mobile utilities
  const [isMobile, setIsMobile] = useState(false);
  const [showQuickPanel, setShowQuickPanel] = useState(false);

  // Autohide functionality
  const [internalControlsVisible, setInternalControlsVisible] = useState(true);
  const controlsVisible = externalControlsVisible !== undefined ? externalControlsVisible : internalControlsVisible;
  const setControlsVisible = onControlsVisibilityChange || setInternalControlsVisible;
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const HIDE_DELAY = 5000; // 5 seconds

  // Track viewport for mobile behavior
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 1024);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Reset hide timer function
  const resetHideTimer = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    
    // Show controls immediately
    setControlsVisible(true);
    
    // Set new timer to hide controls after delay
    hideTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, HIDE_DELAY);
  }, [HIDE_DELAY]);

  // Handle mouse movement and window focus/blur
  useEffect(() => {
    // Find the daily call root container
    const dailyCallRoot = document.querySelector('.nia-daily-call-root');
    if (!dailyCallRoot) return;

    const handleMouseMove = () => {
      // Mouse is moving - show controls and reset timer
      resetHideTimer();
    };

    const handleMouseLeave = () => {
      // Mouse left the daily call area - hide controls immediately
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      setControlsVisible(false);
    };

    const handleMouseEnter = () => {
      // Mouse entered the daily call area - show controls immediately
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      setControlsVisible(true);
      // Start timer for auto-hide after 5 seconds of inactivity
      hideTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, HIDE_DELAY);
    };

    const handleWindowBlur = () => {
      // Window lost focus - hide controls
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      setControlsVisible(false);
    };

    const handleWindowFocus = () => {
      // Window gained focus - show controls and start timer
      resetHideTimer();
    };

    // Add event listeners to the daily call root container
    dailyCallRoot.addEventListener('mousemove', handleMouseMove);
    dailyCallRoot.addEventListener('mouseleave', handleMouseLeave);
    dailyCallRoot.addEventListener('mouseenter', handleMouseEnter);
    
    // Window focus/blur for when user switches windows/apps
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    
    // Start initial timer
    resetHideTimer();

    // Cleanup
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      dailyCallRoot.removeEventListener('mousemove', handleMouseMove);
      dailyCallRoot.removeEventListener('mouseleave', handleMouseLeave);
      dailyCallRoot.removeEventListener('mouseenter', handleMouseEnter);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [resetHideTimer, HIDE_DELAY, setControlsVisible]);

  // Handle mute/unmute microphone
  const handleToggleMic = useCallback(() => {
    if (daily && !stealth) { // Prevent mic toggle in stealth mode
      daily.setLocalAudio(micTrack.isOff);
    } else if (stealth) {
      log.warn('Microphone toggle blocked in stealth mode', {
        event: 'daily_call_stealth_mic_block',
      });
    }
  }, [daily, micTrack.isOff, stealth, log]);

  // Handle start/stop video  
  const handleToggleVideo = useCallback(() => {
    if (daily && !stealth) { // Prevent video toggle in stealth mode
      daily.setLocalVideo(camTrack.isOff);
    } else if (stealth) {
      log.warn('Video toggle blocked in stealth mode', {
        event: 'daily_call_stealth_video_block',
      });
    }
  }, [daily, camTrack.isOff, stealth, log]);

  // Handle participants panel
  const handleToggleParticipants = useCallback(() => {
    if (showParticipants) {
      setShowParticipants(false);
    } else {
      // Close other panels first
      setShowChat(false);
      setShowSettings(false);
      setShowParticipants(true);
    }
  }, [showParticipants, showChat, showSettings]);

  // Handle screen share with comprehensive error handling
  const handleToggleScreenShare = useCallback(async () => {
    if (!daily) return;
    
    // Pre-flight checks
    if (!isScreenShareSupported()) {
      return;
    }
    
    if (!isSecureContext()) {
      return;
    }
    
    try {
      if (isSharingScreen) {
        await stopScreenShare();
      } else {
        // Request screen share with audio support
        await startScreenShare();
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      log.error('Screen share error', {
        event: 'daily_call_screen_share_error',
        error,
      });
      const errorMessage = getScreenShareErrorMessage(error);
    }
  }, [daily, isSharingScreen, startScreenShare, stopScreenShare, log]);

  // Handle chat toggle
  const handleToggleChat = useCallback(() => {
    if (showChat) {
      setShowChat(false);
    } else {
      // Close other panels first
      setShowParticipants(false);
      setShowSettings(false);
      setShowChat(true);
      // Reset unread count when opening chat
      setChatUnreadCount(0);
    }
  }, [showChat, showParticipants, showSettings]);

  // Handle chat unread count changes
  const handleChatUnreadCountChange = useCallback((count: number) => {
    setChatUnreadCount(count);
  }, []);

  const resolveShareLink = useCallback(async () => {
    if (!roomUrl) return { link: '', error: 'Missing room URL' };

    try {
      setSharePending(true);
      const response = await fetch('/api/share/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: roomUrl,
          contentType: ResourceType.DailyCallRoom,
          role: ResourceShareRole.VIEWER,
          assistantName: assistantName || 'pearlos',
          mode: layoutMode,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.link) {
        const message = data?.error || 'Failed to create share link';
        return { link: '', error: message };
      }

      return { link: data.link as string, error: '' };
    } catch (error) {
      log.warn('Share link generation failed', {
        event: 'daily_call_share_generate_failed',
        error,
      });
      return { link: '', error: 'Unable to generate share link' };
    } finally {
      setSharePending(false);
    }
  }, [assistantName, layoutMode, roomUrl, log]);

  const handleShareLink = useCallback(async () => {
    const { link, error } = await resolveShareLink();

    if (!link) {
      toast({
        title: 'Share failed',
        description: error || 'A shareable link is not available right now.',
        variant: 'destructive',
      });
      return;
    }

    let copied = false;

    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch (copyError) {
        log.warn('Clipboard write failed; falling back', {
          event: 'daily_call_share_copy_fallback',
          error: copyError,
        });
      }
    }

    if (!copied && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = link;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (fallbackError) {
        log.warn('Legacy copy fallback failed', {
          event: 'daily_call_share_copy_failed',
          error: fallbackError,
        });
      }
    }

    if (copied) {
      toast({
        title: 'Link copied',
        description: 'Invite others via this Daily call link.',
        duration: 3500,
      });
    } else {
      toast({
        title: 'Copy failed',
        description: link,
        variant: 'destructive',
      });
    }
  }, [resolveShareLink, toast, log]);

  // Listen for chat messages to update notification badge even when chat is closed
  useDailyEvent(
    'app-message',
    useCallback(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (event: any) => {
        if (event?.data?.type === 'chat-message' && event.fromId !== localId && !showChat) {
          const senderName = event.data.senderName || 'Unknown';
          
          // SECURITY: Filter out stealth users from chat display
          if (senderName.startsWith('stealth-user')) {
            return; // Don't display stealth user messages in regular chat
          }
          
          // Store the message in localStorage so Chat component can load it later
          const message = {
            id: Date.now() + Math.random().toString(),
            text: event.data.message,
            sender: event.fromId,
            senderName,
            timestamp: new Date(),
            isLocal: false, // Always false since it's from another participant
          };
          
          // Get room-specific storage key (matching Chat.tsx format)
          const getStorageKey = (roomUrl?: string, sessionId?: string | null) => {
            const CHAT_STORAGE_BASE_KEY = 'daily-chat-messages';
            const sessionKey = sessionId ? sessionId.slice(-8) : 'default';
            
            if (roomUrl) {
              try {
                const url = new URL(roomUrl);
                const roomName = url.pathname.split('/').pop() || url.hostname;
                return `${CHAT_STORAGE_BASE_KEY}-${roomName}-${sessionKey}`;
              } catch {
                return `${CHAT_STORAGE_BASE_KEY}-${sessionKey}`;
              }
            }
            return `${CHAT_STORAGE_BASE_KEY}-${sessionKey}`;
          };
          
          const storageKey = getStorageKey(roomUrl, localId);
          const MAX_STORED_MESSAGES = 100;
          
          try {
            const existingMessages = JSON.parse(localStorage.getItem(storageKey) || '[]');
            const updatedMessages = [...existingMessages, message].slice(-MAX_STORED_MESSAGES);
            localStorage.setItem(storageKey, JSON.stringify(updatedMessages));
          } catch (error) {
            log.error('Failed to store chat message', {
              event: 'daily_call_chat_store_error',
              error,
            });
          }
          
          setChatUnreadCount(prev => {
            const newCount = prev + 1;
            return newCount;
          });

          // Show browser notification if permission granted
          if (Notification.permission === 'granted') {
            new Notification(`New message from ${event.data.senderName || 'Someone'}`, {
              body: event.data.message.substring(0, 100),
              icon: '/favicon.ico'
            });
          }
        }
      },
      [localId, showChat, roomUrl]
    )
  );

  // Handle settings
  const handleToggleSettings = useCallback(() => {
    if (showSettings) {
      setShowSettings(false);
    } else {
      // Close other panels first
      setShowParticipants(false);
      setShowChat(false);
      setShowSettings(true);
    }
  }, [showSettings, showParticipants, showChat]);

  // Handle layout toggle between grid and sidebar
  const handleToggleLayout = useCallback(() => {
    const newLayout = layoutMode === 'grid' ? 'sidebar' : 'grid';
    onLayoutChange(newLayout);
  }, [onLayoutChange, layoutMode]);

  // Handle leave call
  const handleLeave = useCallback(() => {
    if (daily) {
      daily.leave();
      onLeave();
    }
  }, [daily, onLeave]);



  // Handle recording
  const handleToggleRecording = useCallback(async () => {
    if (!daily) return;
    try {
      if (isRecording) {
        await daily.stopRecording();
        setIsRecording(false);
      } else {
        await daily.startRecording();
        setIsRecording(true);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      log.error('Recording error', {
        event: 'daily_call_recording_error',
        error,
      });
    }
  }, [daily, isRecording, log]);

  // Listen for recording events
  const getRecordingState = useCallback((meetingState: ReturnType<DailyCall['meetingState']> | undefined) => {
    if (meetingState && typeof meetingState === 'object' && 'recording' in meetingState) {
      const recording = (meetingState as { recording?: { state?: string } }).recording;
      return recording?.state;
    }
    return undefined;
  }, []);

  const requestAutoRecording = useCallback(async () => {
    if (!daily || recordingAttemptRef.current) {
      return;
    }

    recordingAttemptRef.current = true;
    try {
      const meetingState = typeof daily.meetingState === 'function' ? daily.meetingState() : undefined;
      const recordingState = getRecordingState(meetingState);
      if (recordingState === 'recording' || recordingState === 'starting') {
        return;
      }

      await daily.startRecording();
      log.info('Auto-started cloud recording', {
        event: 'daily_call_recording_autostart',
      });
    } catch (error: any) {
      recordingAttemptRef.current = false;
      const msg = error?.message || String(error);
      if (msg.includes('Switch to soup failed')) {
        log.warn('Recording start suppressed (SFU switch timing)', {
          event: 'daily_call_recording_autostart_suppressed',
          error: msg,
        });
      } else {
        log.error('Failed to auto-start recording', {
          event: 'daily_call_recording_autostart_error',
          error,
        });
      }
    }
  }, [daily, getRecordingState, log]);

  useDailyEvent('joined-meeting', requestAutoRecording);
  useDailyEvent('recording-started', () => setIsRecording(true));
  useDailyEvent('recording-stopped', () => {
    setIsRecording(false);
    recordingAttemptRef.current = false;
  });
  useDailyEvent('left-meeting', () => {
    recordingAttemptRef.current = false;
    setIsRecording(false);
  });

  return (
    <div className="daily-prebuilt-container">
      {/* Bottom Toolbar - Exact replica of the image layout */}
      <div className={`bottom-toolbar ${controlsVisible ? 'visible' : 'hidden'}`}>
        <div className="toolbar-section left-section">
          {/* Microphone control - hidden in stealth mode */}
          {!stealth && (
          <button 
            className={`toolbar-btn ${micTrack.isOff ? 'btn-muted' : 'btn-active'}`}
            onClick={handleToggleMic}
            title={micTrack.isOff ? "Unmute" : "Mute"}
          >
            <div className="btn-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={micTrack.isOff ? "/socialicon/micoff.png" : "/socialicon/micon.png"} 
                alt={micTrack.isOff ? "Mic off" : "Mic on"}
                width="48" 
                height="48"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          </button>
          )}
        </div>

        <div className="toolbar-section center-section">
          {/* Most center controls hidden in stealth mode, but keep chat for admin messaging */}
          {!stealth && (
          <>
          {/* Video control */}
          <button 
            className={`toolbar-btn ${camTrack.isOff ? 'btn-muted' : 'btn-active'}`}
            onClick={handleToggleVideo}
            title={camTrack.isOff ? "Start Video" : "Stop Video"}
          >
            <div className="btn-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={camTrack.isOff ? "/socialicon/videocalloff.png" : "/socialicon/videocallon.png"} 
                alt={camTrack.isOff ? "Video off" : "Video on"}
                width="48" 
                height="48"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          </button>
          {/* Participants / Share / Chat moved into quick panel on mobile */}
          {!isMobile && (
            <>
              <button 
                className={`toolbar-btn ${showParticipants ? 'btn-active' : 'btn-secondary'}`}
                onClick={handleToggleParticipants}
                title="Participants"
              >
                <div className="btn-icon">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src="/socialicon/participant.png" 
                    alt="Participants"
                    width="48" 
                    height="48"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
              </button>

              {/* Screen Share Button (hidden on mobile; moved to quick panel) */}
              <button 
                className={`toolbar-btn ${isSharingScreen ? 'btn-sharing' : 'btn-secondary'}`}
                onClick={handleToggleScreenShare}
                title={isSharingScreen ? "Stop Sharing" : "Share Screen"}
                disabled={!isScreenShareSupported() || !isSecureContext()}
              >
                <div className="btn-icon">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src="/socialicon/sharescreen.png" 
                    alt="Share screen"
                    width="48" 
                    height="48"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
              </button>
            </>
          )}

          </>
          )}

          {/* Chat Button - Always available, even in stealth mode for admin messaging (hidden on mobile; moved to quick panel) */}
          {!isMobile && (
            <>
              <button 
                className={`toolbar-btn ${showChat ? 'btn-active' : 'btn-secondary'} ${chatUnreadCount > 0 ? 'has-notification' : ''}`}
                onClick={handleToggleChat}
                title="Chat"
                style={{ position: 'relative' }}
              >
                <div className="btn-icon">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src="/socialicon/chat.png" 
                    alt="Chat"
                    width="48" 
                    height="48"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
                {chatUnreadCount > 0 && (
                  <span className="notification-badge">
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </span>
                )}
              </button>
              <button 
                className="toolbar-btn btn-secondary"
                onClick={handleShareLink}
                title="Share call link"
                disabled={!canShare || sharePending}
              >
                <div className="btn-icon">
                  <ShareIcon />
                </div>
                {sharePending && (
                  <span className="ml-2 text-[10px] uppercase tracking-[0.08em] opacity-80">
                    ...
                  </span>
                )}
              </button>
            </>
          )}

          {/* Recording Button - Available for admins even in stealth mode */}
          {!isMobile && (!stealth || isAdmin) && (
            <button 
              className={`toolbar-btn ${isRecording ? 'btn-recording' : 'btn-secondary'}`}
              onClick={handleToggleRecording}
              title={isRecording ? 'Stop Recording' : 'Start Recording'}
            >
              <div className="btn-icon">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={isRecording ? "/socialicon/recordingon.png" : "/socialicon/recordingoff.png"} 
                  alt={isRecording ? "Recording on" : "Recording off"}
                  width="32" 
                  height="32"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            </button>
          )}

          {/* Layout Toggle - Hidden in stealth mode unless admin */}
          {(!stealth || isAdmin) && (
            <button 
              className={`toolbar-btn ${layoutMode === 'sidebar' ? 'btn-active' : 'btn-secondary'}`}
              onClick={handleToggleLayout}
              title={layoutMode === 'grid' ? 'Switch to Sidebar Layout' : 'Switch to Grid Layout'}
            >
              <div className="btn-icon">
                {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src="/socialicon/gridlayout.png" 
                alt="Layout toggle"
                width="48" 
                height="48"
                style={{ imageRendering: 'pixelated' }}
              />
              </div>
            </button>
          )}

        </div>

        <div className="toolbar-section right-section">
          {/* Mobile quick actions toggle - available for admins even in stealth mode */}
          {isMobile && (!stealth || isAdmin) && (
            <button 
              className={`toolbar-btn ${showQuickPanel ? 'btn-active' : 'btn-secondary'} quick-toggle-btn`}
              onClick={() => setShowQuickPanel(v => !v)}
              title="More controls"
            >
              <div className="btn-icon">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className={`chevron-icon ${showQuickPanel ? 'open' : ''}`}
                >
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>
          )}
          {/* Settings - hidden in stealth mode and on mobile */}
          {!stealth && !isMobile && (
          <button 
            className={`toolbar-btn ${showSettings ? 'btn-active' : 'btn-secondary'}`}
            onClick={handleToggleSettings}
            title="Settings"
          >
            <div className="btn-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src="/socialicon/setting.png" 
                alt="Settings"
                width="48" 
                height="48"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          </button>
          )}

          {/* Leave Call */}
          <button 
            className="toolbar-btn btn-danger"
            onClick={handleLeave}
            title="Leave Call"
          >
            <div className="btn-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src="/socialicon/leavecall.png" 
                alt="Leave call"
                width="48" 
                height="48"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile quick actions panel - available for admins even in stealth mode */}
      {isMobile && (!stealth || isAdmin) && showQuickPanel && (
        <div className={`quick-actions-panel ${controlsVisible ? 'visible' : 'hidden'}`}>
          <div className="quick-actions-grid">
            <button 
              aria-label="Participants"
              className={`toolbar-btn ${showParticipants ? 'btn-active' : 'btn-secondary'}`}
              onClick={() => { setShowQuickPanel(false); handleToggleParticipants(); }}
              title="Participants"
            >
              <div className="btn-icon">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src="/socialicon/participant.png" 
                  alt="Participants"
                  width="48" 
                  height="48"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            </button>
            <button 
              aria-label="Share screen"
              className={`toolbar-btn ${isSharingScreen ? 'btn-sharing' : 'btn-secondary'}`}
              onClick={() => { setShowQuickPanel(false); handleToggleScreenShare(); }}
              title={isSharingScreen ? "Stop Sharing" : "Share Screen"}
              disabled={!isScreenShareSupported() || !isSecureContext()}
            >
              <div className="btn-icon">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src="/socialicon/sharescreen.png" 
                  alt="Share screen"
                  width="48" 
                  height="48"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            </button>
            <button 
              aria-label="Chat"
              className={`toolbar-btn ${showChat ? 'btn-active' : 'btn-secondary'} ${chatUnreadCount > 0 ? 'has-notification' : ''}`}
              onClick={() => { setShowQuickPanel(false); handleToggleChat(); }}
              title="Chat"
              style={{ position: 'relative' }}
            >
              <div className="btn-icon">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src="/socialicon/chat.png" 
                  alt="Chat"
                  width="48" 
                  height="48"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              {chatUnreadCount > 0 && (
                <span className="notification-badge mobile">
                  {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </span>
              )}
            </button>
            <button 
              aria-label="Share call link"
              className="toolbar-btn btn-secondary"
              onClick={() => { setShowQuickPanel(false); handleShareLink(); }}
              title="Share call link"
              disabled={!canShare || sharePending}
            >
              <div className="btn-icon">
                <ShareIcon />
              </div>
              {sharePending && (
                <span className="ml-1 text-[10px] uppercase tracking-[0.08em] opacity-80">
                  ...
                </span>
              )}
            </button>
            <button 
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              className={`toolbar-btn ${isRecording ? 'btn-recording' : 'btn-secondary'}`}
              onClick={() => { setShowQuickPanel(false); handleToggleRecording(); }}
              title={isRecording ? 'Stop Recording' : 'Start Recording'}
            >
              <div className="btn-icon">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={isRecording ? "/socialicon/recordingon.png" : "/socialicon/recordingoff.png"} 
                  alt={isRecording ? "Recording on" : "Recording off"}
                  width="48" 
                  height="48"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            </button>
          </div>
        </div>
      )}
      
      {/* Render panels using portals to browser window container */}
      {portalContainer && showParticipants && createPortal(
        <ParticipantsPanel 
          isVisible={showParticipants} 
          onClose={() => setShowParticipants(false)}
          isAdmin={isAdmin}
          tenantId={tenantId}
          roomUrl={roomUrl}
        />,
        portalContainer
      )}
      
      {portalContainer && showChat && createPortal(
        <Chat 
          isVisible={showChat} 
          onClose={() => setShowChat(false)}
          roomUrl={roomUrl}
          onUnreadCountChange={handleChatUnreadCountChange}
          isAdmin={isAdmin}
          stealth={stealth}
          tenantId={tenantId}
        />,
        portalContainer
      )}
      
      {portalContainer && showSettings && createPortal(
        <SettingsPanel 
          isVisible={showSettings} 
          onClose={() => setShowSettings(false)} 
        />,
        portalContainer
      )}
    </div>
  );
};

export default DailyPrebuiltStyle;
