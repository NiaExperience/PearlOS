/**
 * Shared TypeScript types for Daily.co voice session management
 */

import type { DailyCall, DailyEventObject } from '@daily-co/daily-js';

export interface VoiceRoom {
  roomUrl: string;
  roomName: string;
  token: string;
  reused: boolean;
  expiresAt: Date;
  createdAt: Date;
}

export interface VoiceRoomConfig {
  userId: string;
  roomName: string;
  persistAfterLeave: number; // seconds
  created: Date;
  lastActivity: Date;
}

export interface DailyRoomProperties {
  privacy: 'public' | 'private';
  enable_knocking: boolean;
  enable_prejoin_ui: boolean;
  max_participants: number;
  enable_network_ui: boolean;
  enable_screenshare: boolean;
  enable_chat: boolean;
  enable_recording: boolean | 'cloud' | 'local' | 'rtp';
  start_cloud_recording?: boolean;
  exp?: number; // Unix timestamp
}

export interface VoiceSessionConfig {
  // Audio settings
  noiseCancellation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  
  // Session settings
  audioOnly: boolean;
  maxDuration: number; // seconds
  defaultPersistence: number; // seconds
  reconnectWindow: number; // seconds
  
  // Daily.co settings
  dailyConfig: {
    subscribeToTracksAutomatically: boolean;
    receiveSettings: {
      video: 'off';
      audio: 'on';
    };
    inputSettings?: {
      audio?: {
        processor?: {
          type: 'noise-cancellation' | 'none';
        };
      };
    };
  };
  
  // Room settings
  roomPrivacy: 'private' | 'public';
  maxParticipants: number;
  enableKnocking: boolean;
  enableScreenshare: boolean;
}

export interface ParticipantIdentity {
  userId: string;
  username: string;
  email?: string;
  participantId?: string; // Daily participant ID
  sessionId?: string; // Daily session ID
}

export interface SpeechEvent {
  type: 'start' | 'end';
  timestamp: number;
  participantId?: string;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  timestamp: number;
  participantId?: string;
  /** Source of the transcript: 'user' for user speech recognition, 'bot' for bot TTS transcripts */
  source?: 'user' | 'bot';
}

export interface AudioLevelEvent {
  level: number; // 0-1
  timestamp: number;
  participantId?: string;
}

export interface VoiceEventCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onTranscript?: (event: TranscriptEvent) => void;
  onMessage?: (message: unknown) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  onParticipantJoined?: (participant: unknown) => void;
  onParticipantLeft?: (participant: unknown) => void;
}

export interface DailyTokenConfig {
  roomName: string;
  userId: string;
  userName?: string;
  isOwner?: boolean;
  expiresInSeconds?: number;
}

export interface VoiceAudioState {
  isMuted: boolean;
  audioLevel: number;
  isSpeaking: boolean;
}

// Re-export Daily types for convenience
export type { DailyCall, DailyEventObject };
