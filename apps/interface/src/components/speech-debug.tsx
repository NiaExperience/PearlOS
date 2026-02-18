'use client';

import React from 'react';

import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';

export const SpeechDebug: React.FC = () => {
  const { isAssistantSpeaking, isUserSpeaking, audioLevel, assistantVolumeLevel } = useVoiceSessionContext();

  if (process.env.NODE_ENV !== 'development') {
    return null; // Only show in development
  }

  return (
    <div className="fixed top-4 left-4 z-50 bg-black/80 text-white p-3 rounded-lg text-sm font-mono">
      <div className="text-green-400 font-bold mb-2">Speech Debug</div>
      <div className="space-y-1">
        <div className={`${isAssistantSpeaking ? 'text-green-400' : 'text-gray-500'}`}>
          🤖 Assistant: {isAssistantSpeaking ? 'Speaking' : 'Silent'}
        </div>
        <div className={`${isUserSpeaking ? 'text-blue-400' : 'text-gray-500'}`}>
          🎤 User: {isUserSpeaking ? 'Speaking' : 'Silent'}
        </div>
        <div className="text-purple-400">
          🔊 Audio Level: {(audioLevel * 100).toFixed(1)}%
        </div>
        <div className="text-orange-400">
          👄 Lip Sync Level: {assistantVolumeLevel.toFixed(1)}%
        </div>
      </div>
    </div>
  );
};