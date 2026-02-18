'use client';

import { useLocalParticipant, useDaily, useScreenShare } from '@daily-co/daily-react';
import React, { useState, useEffect } from 'react';
import { requestWindowClose } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import { usePostHog } from 'posthog-js/react';

import { getClientLogger } from '@interface/lib/client-logger';
import { VoiceInputTrigger } from '@interface/features/VoiceInput';

interface CallControlsProps {
  onLeave: () => void;
  layoutMode?: string;
  onLayoutChange?: (mode: 'grid' | 'speaker' | 'sidebar') => void;
  stealth?: boolean; // Hide audio/video controls in stealth mode
}

const CallControls: React.FC<CallControlsProps> = ({ onLeave, layoutMode, onLayoutChange, stealth = false }) => {
  const daily = useDaily();
  const posthog = usePostHog();
  const localParticipant = useLocalParticipant();
  const { screens, startScreenShare, stopScreenShare } = useScreenShare();
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showMoreControls, setShowMoreControls] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'fair' | 'poor'>('good');
  const log = getClientLogger('[daily_call]');
  
  useEffect(() => {
    setIsScreenSharing(screens.length > 0);
  }, [screens]);

  const toggleCamera = async () => {
    if (daily && !stealth) {
      const newState = !localParticipant?.video;
      await daily.setLocalVideo(newState);
      posthog?.capture('call_camera_toggled', { enabled: newState });
    } else if (stealth) {
      log.warn('Video toggle blocked in stealth mode', {
        event: 'daily_call_stealth_video_block',
      });
    }
  };

  const toggleMicrophone = async () => {
    if (daily && !stealth) {
      const newState = !localParticipant?.audio;
      await daily.setLocalAudio(newState);
      posthog?.capture('call_microphone_toggled', { enabled: newState });
    } else if (stealth) {
      log.warn('Audio toggle blocked in stealth mode', {
        event: 'daily_call_stealth_audio_block',
      });
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        await stopScreenShare();
        posthog?.capture('call_screenshare_toggled', { enabled: false });
      } else {
        await startScreenShare();
        posthog?.capture('call_screenshare_toggled', { enabled: true });
      }
    } catch (error) {
      log.warn('Screen share toggle failed', {
        event: 'daily_call_screenshare_toggle_failed',
        error,
      });
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      log.warn('Fullscreen toggle failed', {
        event: 'daily_call_fullscreen_toggle_failed',
        error,
      });
    }
  };

  const leaveCall = () => {
    if (daily) {
      posthog?.capture('call_left', { duration: 0 }); // Todo: calculate duration if possible
      daily.leave();
      requestWindowClose({ viewType: 'dailyCall', source: 'nia.event:apps.close'});
      onLeave();
    }
  };

  return (
    <div className="call-controls-container">
      {/* Layout Controls (if provided) */}
      {onLayoutChange && (
        <div className="layout-controls">
          <div className="layout-buttons">
            <button 
              className={`layout-btn ${layoutMode === 'grid' ? 'active' : ''}`}
              onClick={() => onLayoutChange('grid')}
              title="Grid Layout"
            >
              <span className="layout-icon">⊞</span>
              <span className="layout-label">Grid</span>
            </button>
            
            <button 
              className={`layout-btn ${layoutMode === 'speaker' ? 'active' : ''}`}
              onClick={() => onLayoutChange('speaker')}
              title="Speaker Layout"
            >
              <span className="layout-icon">🎯</span>
              <span className="layout-label">Speaker</span>
            </button>
            
            <button 
              className={`layout-btn ${layoutMode === 'sidebar' ? 'active' : ''}`}
              onClick={() => onLayoutChange('sidebar')}
              title="Sidebar Layout"
            >
              <span className="layout-icon">⫿</span>
              <span className="layout-label">Sidebar</span>
            </button>
          </div>
        </div>
      )}
      
      {/* Main Controls */}
      <div className="call-controls-tray">
        {/* Primary Controls */}
        <div className="primary-controls">
          <button 
            onClick={toggleMicrophone} 
            className={`control-button ${!localParticipant?.audio ? 'disabled' : ''}`}
            title={localParticipant?.audio ? 'Mute microphone' : 'Unmute microphone'}
          >
            <span className="control-icon">
              {localParticipant?.audio ? '🎤' : '🔇'}
            </span>
            <span className="control-label">
              {localParticipant?.audio ? 'Mic On' : 'Mic Off'}
            </span>
          </button>
          
          <button 
            onClick={toggleCamera} 
            className={`control-button ${!localParticipant?.video ? 'disabled' : ''}`}
            title={localParticipant?.video ? 'Turn off camera' : 'Turn on camera'}
          >
            <span className="control-icon">
              {localParticipant?.video ? '📹' : '🚫'}
            </span>
            <span className="control-label">
              {localParticipant?.video ? 'Camera On' : 'Camera Off'}
            </span>
          </button>
          
          <button 
            onClick={toggleScreenShare}
            className={`control-button ${isScreenSharing ? 'active' : ''}`}
            title={isScreenSharing ? 'Stop screen share' : 'Share screen'}
          >
            <span className="control-icon">
              {isScreenSharing ? '🚫' : '🖥️'}
            </span>
            <span className="control-label">
              {isScreenSharing ? 'Stop Share' : 'Share'}
            </span>
          </button>
        </div>
        
        {/* Secondary Controls */}
        <div className="secondary-controls">
          <VoiceInputTrigger />
          
          <button 
            onClick={() => setShowMoreControls(!showMoreControls)}
            className="control-button more-button"
            title="More options"
          >
            <span className="control-icon">⋮</span>
            <span className="control-label">More</span>
          </button>
          
          <button 
            onClick={toggleFullscreen}
            className="control-button"
            title="Toggle fullscreen"
          >
            <span className="control-icon">⛶</span>
            <span className="control-label">Fullscreen</span>
          </button>
        </div>
        
        {/* Leave Button */}
        <button onClick={leaveCall} className="leave-button" title="Leave call">
          <span className="control-icon">📞</span>
          <span className="control-label">Leave Call</span>
        </button>
      </div>
      
      {/* More Controls Panel */}
      {showMoreControls && (
        <div className="more-controls-panel">
          <div className="more-controls-grid">
            <button className="more-control-item" title="Settings">
              <span className="more-icon">⚙️</span>
              <span className="more-label">Settings</span>
            </button>
            <button className="more-control-item" title="Statistics">
              <span className="more-icon">📈</span>
              <span className="more-label">Stats</span>
            </button>
            <button className="more-control-item" title="Record">
              <span className="more-icon">⏺</span>
              <span className="more-label">Record</span>
            </button>
            <button className="more-control-item" title="Chat">
              <span className="more-icon">💬</span>
              <span className="more-label">Chat</span>
            </button>
          </div>
        </div>
      )}
      
      {/* Connection Quality Indicator */}
      <div className="connection-status">
        <div className={`connection-indicator ${connectionQuality}`}>
          <div className="connection-bars">
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
          </div>
          <span className="connection-label">{connectionQuality}</span>
        </div>
      </div>
    </div>
  );
};

export default CallControls;
