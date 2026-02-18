/**
 * Audio management for Daily voice sessions
 * Handles mute/unmute, audio level monitoring, and audio device selection
 */

import type { DailyCall } from '@daily-co/daily-js';

import { getClientLogger } from '../client-logger';

import type { VoiceAudioState } from './types';

const log = getClientLogger('[daily_audio]');

/**
 * Get current audio state
 */
export function getAudioState(callObject: DailyCall): VoiceAudioState {
  try {
    const localParticipant = callObject.participants().local;
    
    return {
      isMuted: localParticipant?.audio === false,
      audioLevel: 0, // Will be updated by monitoring
      isSpeaking: false, // Will be updated by monitoring
    };
  } catch (error) {
    log.error('Error getting audio state', { error });
    return {
      isMuted: true,
      audioLevel: 0,
      isSpeaking: false,
    };
  }
}

/**
 * Mute local audio
 */
export async function muteAudio(callObject: DailyCall): Promise<void> {
  try {
    await callObject.setLocalAudio(false);
    log.info('Audio muted');
  } catch (error) {
    log.error('Error muting audio', { error });
    throw error;
  }
}

/**
 * Unmute local audio
 */
export async function unmuteAudio(callObject: DailyCall): Promise<void> {
  try {
    await callObject.setLocalAudio(true);
    log.info('Audio unmuted');
  } catch (error) {
    log.error('Error unmuting audio', { error });
    throw error;
  }
}

/**
 * Toggle audio mute state
 */
export async function toggleAudio(callObject: DailyCall): Promise<boolean> {
  try {
    const localParticipant = callObject.participants().local;
    const isMuted = localParticipant?.audio === false;
    
    await callObject.setLocalAudio(!isMuted);
    
    log.info('Audio toggled', { enabled: !isMuted });
    return !isMuted;
  } catch (error) {
    log.error('Error toggling audio', { error });
    throw error;
  }
}

/**
 * Get available audio devices
 */
export async function getAudioDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput');
  } catch (error) {
    log.error('Error getting audio devices', { error });
    return [];
  }
}

/**
 * Set audio input device
 */
export async function setAudioDevice(
  callObject: DailyCall,
  deviceId: string
): Promise<void> {
  try {
    await callObject.setInputDevicesAsync({
      audioDeviceId: deviceId,
    });
    log.info('Audio device set', { deviceId });
  } catch (error) {
    log.error('Error setting audio device', { error, deviceId });
    throw error;
  }
}

/**
 * Get current audio input device
 */
export async function getCurrentAudioDevice(
  callObject: DailyCall
): Promise<string | null> {
  try {
    const { mic } = await callObject.getInputDevices();
    return (mic as MediaDeviceInfo)?.deviceId || null;
  } catch (error) {
    log.error('Error getting current audio device', { error });
    return null;
  }
}

/**
 * Start audio processing (noise cancellation, echo cancellation, AGC)
 */
export async function startAudioProcessing(
  callObject: DailyCall
): Promise<void> {
  try {
    await callObject.updateInputSettings({
      audio: {
        processor: {
          type: 'noise-cancellation',
        },
      },
    });
    log.info('Audio processing started');
  } catch (error) {
    log.error('Error starting audio processing', { error });
    throw error;
  }
}

/**
 * Stop audio processing
 */
export async function stopAudioProcessing(
  callObject: DailyCall
): Promise<void> {
  try {
    await callObject.updateInputSettings({
      audio: {
        processor: {
          type: 'none',
        },
      },
    });
    log.info('Audio processing stopped');
  } catch (error) {
    log.error('Error stopping audio processing', { error });
    throw error;
  }
}
