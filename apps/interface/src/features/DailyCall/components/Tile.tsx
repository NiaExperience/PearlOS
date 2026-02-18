'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMediaTrack, useParticipant } from '@daily-co/daily-react';
import React, { useEffect, useRef, useState, useMemo } from 'react';

import { isBotParticipant, useBotSpeakingDetection } from '@interface/lib/daily';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { getClientLogger } from '@interface/lib/client-logger';

import { TileRiveAvatar } from './TileRiveAvatar';

interface TileProps {
  id?: string;
  sessionId?: string;
  isLocal?: boolean;
  layoutMode?: string;
  onTap?: (sessionId: string) => void;
  tileIndex?: number;
  totalTiles?: number;
  gridColumns?: number;
  gridRows?: number;
  hidePearl?: boolean; // Hide Pearl bot avatar overlay
}

const Tile: React.FC<TileProps> = ({ id, sessionId, isLocal, layoutMode, onTap, tileIndex = 0, totalTiles: _totalTiles = 1, gridColumns: _gridColumns = 2, gridRows: _gridRows = 1, hidePearl = false }) => {
  const log = getClientLogger('[daily_call]');
  
  // Get current persona name for bot detection
  const { currentPersonaName } = useVoiceSessionContext();

  const effectiveId = sessionId || id || '';
  const videoElement = useRef<HTMLVideoElement>(null);
  const audioElement = useRef<HTMLAudioElement>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  
  // Audio processing refs - needed for TileRiveAvatar lipsync visualization
  const audioLevelRef = useRef(0);
  const levelSpanRef = useRef<HTMLSpanElement>(null);
  const currentAudioLevelRef = useRef(0);
  const lastAudioUpdateRef = useRef(0);
  
  // Username label visibility state for fade-in/fade-out
  const [showUsernameLabel, setShowUsernameLabel] = useState(false);
  const usernameTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasShownUsernameRef = useRef(false);
  
  // Background images for camera-off participants - responsive puzzle images
  const backgroundImages = useMemo(() => ({
    desktop: '/images/library.png',
    mobile: '/images/calm2.jpg',
  }), []);
  
  // Calculate puzzle piece background using fixed layout approach
  const puzzleBackground = useMemo(() => {
    const isMobile = window.innerWidth <= 1024;
    const backgroundImage = isMobile ? backgroundImages.mobile : backgroundImages.desktop;
    
    // Define fixed puzzle layouts
    const puzzleLayouts = {
      mobile: { maxPieces: 8, cols: 2, rows: 4 },      // 2x4 grid
      desktop: { maxPieces: 12, cols: 4, rows: 3 },    // 4x3 grid  
      fullscreen: { maxPieces: 16, cols: 4, rows: 4 }  // 4x4 grid
    };
    
    // Determine current layout
    const windowWidth = window.innerWidth;
    const isFullscreen = document.fullscreenElement !== null;
    
    let layout;
    if (windowWidth <= 1024) {
      layout = puzzleLayouts.mobile;
    } else if (isFullscreen) {
      layout = puzzleLayouts.fullscreen;
    } else {
      layout = puzzleLayouts.desktop;
    }
    
    // Use rollover: if more participants than puzzle pieces, cycle through
    const puzzleIndex = tileIndex % layout.maxPieces;
    const row = Math.floor(puzzleIndex / layout.cols);
    const col = puzzleIndex % layout.cols;
    
    // For true puzzle effect: calculate the exact position within the scaled background
    const backgroundSizeWidth = layout.cols * 100; // e.g., 200% for 2 columns  
    const backgroundSizeHeight = layout.rows * 100; // e.g., 400% for 4 rows
    
    // Calculate position as percentage of the scaled background
    // For a 2x4 grid: col 0 = 0%, col 1 = 50%; row 0 = 0%, row 1 = 25%, etc.
    const backgroundPosX = layout.cols > 1 ? (col / (layout.cols - 1)) * 100 : 50;
    const backgroundPosY = layout.rows > 1 ? (row / (layout.rows - 1)) * 100 : 50;
    
    return {
      image: backgroundImage,
      backgroundPosition: `${backgroundPosX}% ${backgroundPosY}%`,
      backgroundSize: `${backgroundSizeWidth}% ${backgroundSizeHeight}%`,
      puzzleIndex,
      layout
    };
  }, [backgroundImages.desktop, backgroundImages.mobile, tileIndex]);
  
  const audioTrack = useMediaTrack(effectiveId, 'audio');
  const videoTrack = useMediaTrack(effectiveId, 'video');
  const screenVideoTrack = useMediaTrack(effectiveId, 'screenVideo');
  const screenAudioTrack = useMediaTrack(effectiveId, 'screenAudio');
  const participant = useParticipant(effectiveId);
  const userName = participant?.user_name;
  const effectiveIsLocal = isLocal ?? (participant?.local || false);
  
  try {
    log.debug('Tile render diagnostics', {
      event: 'daily_call_tile_render',
      participantId: effectiveId,
      userName,
      effectiveIsLocal,
      hasAudioTrack: !!audioTrack?.track,
      audioState: (audioTrack as any)?.state,
      hasVideoTrack: !!videoTrack?.track,
      videoState: (videoTrack as any)?.state,
      hasScreenVideoTrack: !!screenVideoTrack?.track,
      screenVideoState: (screenVideoTrack as any)?.state,
      hasScreenAudioTrack: !!screenAudioTrack?.track,
      screenAudioState: (screenAudioTrack as any)?.state,
    });
  } catch (_error) {
    // noop - debug logging only
  }
  
  // Pearl bot detection using shared utility
  const isPearlBot = useMemo(() => {
    if (effectiveIsLocal) return false;
    if (!participant) return false;
    
    return isBotParticipant(participant, {
      expectedPersonaName: currentPersonaName || undefined,
    });
  }, [effectiveIsLocal, participant, currentPersonaName]);

  // Enhanced speaking detection
  const participantIsSpeaking = (participant as any)?.isSpeaking || false;

  // Check if participant's audio is muted
  const isAudioMuted = participant?.audio === false;

  // Bot speaking detection using shared hook with throttling for performance
  const { isSpeaking: isBotSpeaking } = useBotSpeakingDetection(
    isPearlBot ? effectiveId : '', 
    {
      threshold: 0.012,
      debounceMs: 500,
      throttleMs: 200, // Throttle for performance with multiple tiles
      onAudioLevel: (level: number) => {
        // Update refs for TileRiveAvatar lipsync visualization
        audioLevelRef.current = level;
        
        const now = Date.now();
        if (now - lastAudioUpdateRef.current > 100) {
          currentAudioLevelRef.current = level;
          lastAudioUpdateRef.current = now;
        }
      }
    }
  );

  // Handle username label visibility when participant joins
  useEffect(() => {
    // Check if participant has joined (has audio or video track)
    const hasJoined = !!(audioTrack?.track || videoTrack?.track || screenVideoTrack?.track);
    
    if (hasJoined && !hasShownUsernameRef.current) {
      // Clear any existing timeout
      if (usernameTimeoutRef.current) {
        clearTimeout(usernameTimeoutRef.current);
        usernameTimeoutRef.current = null;
      }
      
      // Small delay to ensure smooth transition
      const showTimeout = setTimeout(() => {
        // Show username label for ALL participants (including local)
        setShowUsernameLabel(true);
        hasShownUsernameRef.current = true;
        
        // Hide after 30 seconds with smooth fade out
        usernameTimeoutRef.current = setTimeout(() => {
          setShowUsernameLabel(false);
          usernameTimeoutRef.current = null;
        }, 30000); // 30 seconds
      }, 200); // Slightly longer delay for smoother appearance
      
      return () => clearTimeout(showTimeout);
    }
    
    // Cleanup timeout on unmount
    return () => {
      if (usernameTimeoutRef.current) {
        clearTimeout(usernameTimeoutRef.current);
        usernameTimeoutRef.current = null;
      }
    };
  }, [audioTrack?.track, videoTrack?.track, screenVideoTrack?.track]);

  // UI updater for Pearl bot audio level display - OPTIMIZED for performance
  useEffect(() => {
    if (effectiveIsLocal || !isPearlBot) return;
    
    let raf = 0;
    let last = -1;
    let lastUpdate = 0;
    let isActive = true; // Add flag to prevent unnecessary updates
    
    const tick = () => {
      if (!isActive) return; // Early exit if component unmounted
      
      const now = Date.now();
      const v = audioLevelRef.current;
      
      // Only update UI every 500ms (reduced frequency) and when value changes significantly
      if (now - lastUpdate > 500 && Math.abs(v - last) > 0.05) {
        last = v;
        lastUpdate = now;
        if (levelSpanRef.current && isActive) {
          levelSpanRef.current.textContent = `lvl:${v.toFixed(3)}`;
        }
      }
      
      // Only continue RAF if still active
      if (isActive) {
        raf = requestAnimationFrame(tick);
      }
    };
    
    raf = requestAnimationFrame(tick);
    return () => {
      isActive = false; // Set flag to false
      if (raf) cancelAnimationFrame(raf);
    };
  }, [effectiveIsLocal, isPearlBot]);

  // Handle tap for mobile speaker switching
  const handleTileClick = () => {
    if (onTap && effectiveId) {
      onTap(effectiveId);
    }
  };

  // Attach video track (prioritize screen share over regular video)
  useEffect(() => {
    if (videoElement.current) {
      // Prioritize screen video over regular video
      const activeVideoTrack = screenVideoTrack?.track || videoTrack?.track;
      if (activeVideoTrack) {
        videoElement.current.srcObject = new MediaStream([activeVideoTrack]);
      }
    }
  }, [videoTrack?.track, screenVideoTrack?.track]);

  // Attach / play audio track (ALWAYS attach for remote so we can hear the bot).
  // Include screen audio if available
  useEffect(() => {
    if (audioElement.current) {
      const audioTracks = [];
      if (audioTrack?.track) audioTracks.push(audioTrack.track);
      if (screenAudioTrack?.track) audioTracks.push(screenAudioTrack.track);
      
      if (audioTracks.length > 0) {
        try {
          audioElement.current.srcObject = new MediaStream(audioTracks);
          audioElement.current.muted = effectiveIsLocal; // local stays muted to avoid echo
  const attemptPlay = (_origin: string) => {
          try {
            const p = audioElement.current?.play();
            if (p && typeof p.then === 'function') {
              p.then(() => {
                if (!effectiveIsLocal) {
                  setAutoplayBlocked(false);
                }
              }).catch(_err => {
                if (!effectiveIsLocal) {
                  setAutoplayBlocked(true);
                }
              });
            }
          } catch (err) {
            if (!effectiveIsLocal) {
              setAutoplayBlocked(true);
            }
          }
        };
        
        attemptPlay('initial');
        
        // Retry after delay if still paused
        setTimeout(() => {
          if (!effectiveIsLocal && audioElement.current && audioElement.current.paused) {
            attemptPlay('retry-delay');
          }
        }, 750);
        } catch (e) {
          log.error('Failed to attach audio track', {
            event: 'daily_call_tile_attach_audio_error',
            participantId: effectiveId,
            error: e,
          });
        }
      }
    }
  }, [audioTrack, screenAudioTrack, effectiveIsLocal, effectiveId]);

  // Global user-gesture recovery: attempt resume on any pointer interaction if blocked
  useEffect(() => {
    if (!autoplayBlocked) return;
    const handler = () => {
      if (audioElement.current && audioElement.current.paused) {
        try {
          audioElement.current
            .play()
            .then(() => setAutoplayBlocked(false))
            .catch(() => {});
        } catch (_error) {
          // noop - best effort UI update
        }
      }
    };
    window.addEventListener('pointerdown', handler, { once: true });
    return () => window.removeEventListener('pointerdown', handler);
  }, [autoplayBlocked]);

  // Tile class calculation
  const tileIsSpeaking = isPearlBot ? isBotSpeaking : participantIsSpeaking;

  const tileClass = useMemo(() => {
    let baseClass = 'tile-container';
    
    if (tileIsSpeaking) {
      baseClass += ' speaking';
    }
    
    // Add has-video class when video is present
    if (videoTrack?.track || screenVideoTrack?.track) {
      baseClass += ' has-video';
    }
    
    if (layoutMode) baseClass += ` ${layoutMode}-tile`;
    return baseClass;
  }, [tileIsSpeaking, layoutMode, videoTrack?.track, screenVideoTrack?.track]);

  return (
    <div
      className={tileClass}
      onClick={handleTileClick}
      style={{
        cursor: onTap && !effectiveIsLocal ? 'pointer' : 'default'
      }}
    >
      {(videoTrack?.track || screenVideoTrack?.track) ? (
        <video
          autoPlay
          muted={effectiveIsLocal}
          playsInline
          ref={videoElement}
          className={`tile-video ${screenVideoTrack?.track ? 'screen-share' : ''}`}
        />
      ) : (
        <div className="placeholder-video">
          {!isPearlBot && (
            <>
              {/* Background image layer with puzzle positioning */}
              <div 
                className="puzzle-background"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  backgroundImage: `url('${puzzleBackground.image}')`,
                  backgroundSize: puzzleBackground.backgroundSize,
                  backgroundPosition: puzzleBackground.backgroundPosition,
                  backgroundRepeat: 'no-repeat',
                  filter: 'blur(2px)',
                  zIndex: 0
                }}
              />
              {/* Dark overlay */}
              <div 
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  background: 'linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4))',
                  zIndex: 1
                }}
              />
              {/* Avatar placeholder removed - no longer needed */}
            </>
          )}
          {isPearlBot && (
            <div style={{ backgroundColor: '#000000', width: '100%', height: '100%' }} />
          )}
        </div>
      )}

      {/* Screen sharing indicator */}
      {screenVideoTrack?.track && (
        <div className="screen-share-indicator">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src="/socialicon/sharescreen.png" 
            alt="Sharing screen"
            width="24" 
            height="24"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )}

      {/* Muted microphone indicator */}
      {isAudioMuted && (
        <div className="muted-indicator">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src="/socialicon/micoff.png" 
            alt="Mic muted"
            width="20" 
            height="20"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )}

      {/* Hidden audio element */}
      <audio
        ref={audioElement}
        autoPlay
        playsInline
        style={{ display: 'none' }}
        data-autoplay-blocked={autoplayBlocked ? '1' : '0'}
      />

      {autoplayBlocked && !effectiveIsLocal && (
        <button
          className="resume-audio-btn"
          onClick={() => {
            if (audioElement.current) {
              try {
                audioElement.current
                  .play()
                  .then(() => setAutoplayBlocked(false))
                  .catch(() => {});
              } catch (_error) {
                // noop - user gesture retry best effort
              }
            }
          }}
          style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10 }}
        >
          Enable Audio
        </button>
      )}

      {/* Username label for non-Pearl bot participants */}
      {!isPearlBot && (
        <div 
          className={`username-label ${showUsernameLabel ? 'visible' : 'hidden'}`}
        >
          {screenVideoTrack?.track && <span className="screen-share-icon"></span>}
          {userName || 'Guest'}
        </div>
      )}

      {/* Rive Avatar Overlay for Pearl bot only - hide if hidePearl is true */}
      {isPearlBot && !hidePearl && (
        <div 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 10,
            overflow: 'hidden'
          }}
        >
          <TileRiveAvatar
            isSpeaking={isBotSpeaking}
            audioLevelRef={currentAudioLevelRef}
            userName={userName}
            className="bot-avatar-overlay"
          />
        </div>
      )}

      {/* Pearl bot username label with same styling as normal participants */}
      {isPearlBot && (
        <div 
          className={`username-label pearl-bot-label ${showUsernameLabel ? 'visible' : 'hidden'}`}
        >
          {/* {isBotSpeaking && <span className="speaking-icon">🔊 </span>} */}
          {userName || 'Pearl'}
        </div>
      )}
    </div>
  );
};

export default Tile;