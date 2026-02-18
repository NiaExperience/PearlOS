'use client';

import { useDaily, useParticipant, useParticipantIds, useLocalSessionId } from '@daily-co/daily-react';
import React, { useState, useCallback } from 'react';

import { useToast } from '@interface/hooks/use-toast';
import { getClientLogger } from '@interface/lib/client-logger';

import type { TimeoutDuration } from '../lib/userTimeout';

const log = getClientLogger('[daily_call:participants]');

interface ParticipantsPanelProps {
  isVisible: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  tenantId?: string;
  roomUrl?: string;
}

const ParticipantsPanel: React.FC<ParticipantsPanelProps> = ({ 
  isVisible, 
  onClose,
  isAdmin = false,
  tenantId,
  roomUrl,
}) => {
  const participantIds = useParticipantIds();
  const localSessionId = useLocalSessionId();
  const uniqueParticipantIds = React.useMemo(
    () => Array.from(new Set(participantIds || [])),
    [participantIds]
  );

  // Handle backdrop click to close on mobile
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isVisible) return null;

  return (
    <div 
      className={`participants-overlay ${isVisible ? 'visible' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="participants-container">
        {/* Participants Header */}
        <div className="participants-header">
          <h3>Participants ({uniqueParticipantIds.length})</h3>
          <button
            onClick={onClose}
            className="participants-close-btn"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Participants List */}
        <div className="participants-content">
          <div className="participants-list">
            {uniqueParticipantIds.map((id) => (
              <ParticipantItem 
                key={id} 
                participantId={id}
                isAdmin={isAdmin}
                isLocalParticipant={id === localSessionId}
                tenantId={tenantId}
                roomUrl={roomUrl}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Duration options for kick
const KICK_DURATION_OPTIONS: { value: TimeoutDuration; label: string }[] = [
  { value: '5m', label: '5 minutes' },
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '60m', label: '1 hour' },
  { value: 'forever', label: '⚠️ FOREVER (Ban)' },
];

// Individual participant item component
interface ParticipantItemProps {
  participantId: string;
  isAdmin?: boolean;
  isLocalParticipant?: boolean;
  tenantId?: string;
  roomUrl?: string;
}

const ParticipantItem: React.FC<ParticipantItemProps> = ({ 
  participantId,
  isAdmin = false,
  isLocalParticipant = false,
  tenantId,
  roomUrl,
}) => {
  const daily = useDaily();
  const participant = useParticipant(participantId);
  const { toast } = useToast();
  const [showKickMenu, setShowKickMenu] = useState(false);
  const [isKicking, setIsKicking] = useState(false);
  
  const handleKick = useCallback(async (duration: TimeoutDuration) => {
    if (!participant || !daily) return;
    
    // Extract user data from participant
    // Note: Call.tsx sets sessionUserId, sessionUserEmail (not userId, email)
    const userData = participant.userData as { sessionUserId?: string; sessionUserEmail?: string } | undefined;
    const targetUserId = userData?.sessionUserId;
    const targetEmail = userData?.sessionUserEmail;
    
    if (!targetUserId) {
      log.warn('Cannot kick participant: no sessionUserId in userData', { participantId, userData });
      toast({
        title: 'Cannot kick user',
        description: 'User identity not available. Anonymous users cannot be kicked.',
        variant: 'destructive',
      });
      return;
    }
    
    // Warn about forever ban requiring email
    if (duration === 'forever' && !targetEmail) {
      toast({
        title: 'Cannot permanently ban',
        description: 'User email not available. Use a timed kick instead.',
        variant: 'destructive',
      });
      return;
    }
    
    setIsKicking(true);
    setShowKickMenu(false);
    
    try {
      const response = await fetch('/api/dailyCall/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId,
          targetEmail,
          duration,
          roomUrl,
          tenantId,
          reason: `Kicked by admin`,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      log.info('User kicked successfully', {
        targetUserId,
        duration,
        isForever: result.isForever,
      });
      
      // Eject the user from the Daily room
      try {
        await daily.sendAppMessage({
          type: 'admin-kick',
          targetUserId,
          targetSessionId: participantId,
          duration,
          reason: 'You have been removed from this call by an administrator.',
        }, participantId);
      } catch (msgError) {
        log.warn('Failed to send kick notification to user', { error: msgError });
      }
      
      toast({
        title: duration === 'forever' ? 'User Banned' : 'User Kicked',
        description: result.message,
      });
      
    } catch (error) {
      log.error('Failed to kick user', { error, targetUserId, duration });
      toast({
        title: 'Kick Failed',
        description: error instanceof Error ? error.message : 'Failed to kick user',
        variant: 'destructive',
      });
    } finally {
      setIsKicking(false);
    }
  }, [daily, participant, participantId, roomUrl, tenantId, toast]);
  
  if (!participant) return null;

  const isLocal = participant.local;
  const username = participant.user_name || 'Guest';
  const isAudioOn = participant.audio;
  const isVideoOn = participant.video;
  
  // Check if this is a bot (don't show kick for bots)
  const isBot = username.toLowerCase().includes('pearl') || 
                username.toLowerCase().includes('bot') ||
                (participant.userData as { isBot?: boolean } | undefined)?.isBot;

  return (
    <div className="participant-item">
      <div className="participant-avatar">
        <span className="participant-initial">
          {username.charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="participant-info">
        <div className="participant-name">
          {username} {isLocal && '(You)'}
        </div>
        <div className="participant-status">
          <span className={`status-indicator ${isAudioOn ? 'active' : 'inactive'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={isAudioOn ? "/socialicon/micon.png" : "/socialicon/micoff.png"} 
              alt={isAudioOn ? "Mic on" : "Mic off"}
              width="18" 
              height="18"
              style={{ imageRendering: 'pixelated' }}
            />
          </span>
          <span className={`status-indicator ${isVideoOn ? 'active' : 'inactive'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={isVideoOn ? "/socialicon/videocallon.png" : "/socialicon/videocalloff.png"} 
              alt={isVideoOn ? "Video on" : "Video off"}
              width="18" 
              height="18"
              style={{ imageRendering: 'pixelated' }}
            />
          </span>
        </div>
      </div>
      
      {/* Admin Kick Button - only show for admins, non-local participants, and non-bots */}
      {isAdmin && !isLocalParticipant && !isBot && (
        <div className="participant-admin-actions">
          <button
            className={`kick-button ${showKickMenu ? 'active' : ''}`}
            onClick={() => setShowKickMenu(!showKickMenu)}
            disabled={isKicking}
            title="Kick user"
          >
            {isKicking ? '⏳' : '🚫'}
          </button>
          
          {showKickMenu && (
            <div className="kick-menu">
              <div className="kick-menu-header">Kick Duration</div>
              {KICK_DURATION_OPTIONS.map(option => (
                <button
                  key={option.value}
                  className={`kick-menu-item ${option.value === 'forever' ? 'danger' : ''}`}
                  onClick={() => handleKick(option.value)}
                >
                  {option.label}
                </button>
              ))}
              <button
                className="kick-menu-item cancel"
                onClick={() => setShowKickMenu(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ParticipantsPanel;
