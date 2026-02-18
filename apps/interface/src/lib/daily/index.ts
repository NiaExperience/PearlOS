/**
 * Shared Daily.co library for voice sessions
 * Centralized utilities for room management, events, audio, and participants
 */

// Core types
export type {
  VoiceRoom,
  VoiceRoomConfig,
  VoiceSessionConfig,
  ParticipantIdentity,
  SpeechEvent,
  TranscriptEvent,
  AudioLevelEvent,
  VoiceEventCallbacks,
  DailyTokenConfig,
  VoiceAudioState,
  DailyCall,
  DailyEventObject,
} from './types';

// Configuration
export {
  DEFAULT_VOICE_CONFIG,
  VOICE_SESSION_CONFIG,
  DAILY_API_CONFIG,
  getVoiceRoomName,
  validateVoiceConfig,
  getVoiceRoomProperties,
} from './config';

// Room management
export {
  getOrCreateVoiceRoom,
  leaveVoiceRoom,
  deleteVoiceRoom,
  getActiveRooms,
  cleanupExpiredRooms,
} from './room-manager';

// Token service
export {
  generateVoiceRoomToken,
  validateTokenFormat,
  getTokenExpiration,
} from './token-service';

// Participant management
export {
  setParticipantIdentity,
  getParticipantIdentity,
  getAllParticipantIdentities,
  clearParticipantIdentity,
  clearAllParticipantIdentities,
  extractParticipantInfo,
  getLocalParticipant,
  getRemoteParticipants,
  isBotParticipant,
  getBotParticipant,
  setParticipantMetadata,
  type BotParticipantOptions,
} from './participant-manager';

// Event bridge
export {
  setupVoiceSessionEventBridge,
  startAudioLevelMonitoring,
} from './event-bridge';

// Audio management
export {
  getAudioState,
  muteAudio,
  unmuteAudio,
  toggleAudio,
  getAudioDevices,
  setAudioDevice,
  getCurrentAudioDevice,
  startAudioProcessing,
  stopAudioProcessing,
} from './audio-manager';

// Hooks
export { useBotParticipant } from './hooks/useBotParticipant';
export { useBotSpeakingDetection } from './hooks/useBotSpeakingDetection';
export { useLLMMessaging } from './hooks/useLLMMessaging';
export type { UseBotParticipantReturn } from './hooks/useBotParticipant';
export type { 
  BotSpeakingOptions, 
  UseBotSpeakingDetectionReturn 
} from './hooks/useBotSpeakingDetection';

// LLM Messaging
export {
  sendLLMMessage,
  createMessageDispatcher,
  type SendLLMMessageOptions,
  type LLMContextMessagePayload,
} from './llm-messaging';

// Constants
export { AUDIO_DETECTION, USERNAME_LABEL } from './constants';
