/**
 * Sophisticated speech detection hook for lipsync control
 * 
 * This hook implements the core speech detection logic with:
 * - Transcript-based triggering (prevents voice confusion)
 * - Multi-factor confidence scoring
 * - User priority enforcement (RULE 6)
 * - Enhanced signal processing hierarchy
 */

import { useEffect, useState, useCallback, useRef } from 'react';

import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { getClientLogger } from '@interface/lib/client-logger';

import type { SpeechDetectionState, LlmMessage } from '../types/lipsync-types';

const DEBUG_LOGGING = process.env.NODE_ENV === 'development';
const log = getClientLogger('RiveAvatarLipsync');

/**
 * Signal reliability hierarchy (from documentation):
 * 1. Most Reliable: transcript messages with role: 'assistant'
 * 2. Very Reliable: conversation-update with transcriptType: 'final'
 * 3. Reliable: model-output messages
 * 4. Moderately Reliable: assistant-speech-start/end
 * 5. Less Reliable: Volume-based detection
 * 6. Avoid: speech-update events (prone to feedback loops)
 */
export const useLipsyncSpeechDetection = () => {
  const speechContext = useVoiceSessionContext();
  
  // Enhanced speech detection state
  const [speechState, setSpeechState] = useState<SpeechDetectionState>({
    isAssistantSpeaking: false,
    isUserSpeaking: false,
    assistantVolumeLevel: 0,
    audioLevel: 0,
    isAssistantGeneratingText: false,
    lastAssistantMessage: '',
    assistantSpeechConfidence: 0,
    transcriptQuality: 'none',
    speechTimestamp: 0,
    canAssistantAnimate: false
  });

  // Refs for cleanup and debouncing
  const speechEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const confidenceDecayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTranscriptTimeRef = useRef<number>(0);

  /**
   * Multi-factor confidence calculation for animation quality
   * Based on the enhanced algorithm from the documentation
   */
  const calculateConfidence = useCallback((
    transcriptText: string,
    transcriptType: 'partial' | 'final' | undefined,
    currentTime: number
  ): number => {
    let confidence = 0;
    
    // Factor 1: Has actual content (40% weight)
    if (transcriptText.length > 0) confidence += 0.4;
    
    // Factor 2: Final transcript (30% weight)
    if (transcriptType === 'final') confidence += 0.3;
    
    // Factor 3: Substantial content (20% weight)
    if (transcriptText.length > 10) confidence += 0.2;
    
    // Factor 4: Recent speech activity (10% weight)
    if (currentTime - speechState.speechTimestamp < 5000) confidence += 0.1;

    if (DEBUG_LOGGING) {
      log.debug('Confidence calculation', {
        transcriptLength: transcriptText.length,
        transcriptType,
        hasContent: transcriptText.length > 0,
        isFinal: transcriptType === 'final',
        isSubstantial: transcriptText.length > 10,
        isRecent: currentTime - speechState.speechTimestamp < 5000,
        calculatedConfidence: confidence
      });
    }

    return Math.min(confidence, 1.0);
  }, [speechState.speechTimestamp]);

  /**
   * Enhanced animation permission logic
   * Implements user priority rules and confidence thresholds
   */
  const determineAnimationPermission = useCallback((
    confidence: number,
    isUserSpeaking: boolean,
    isAssistantGenerating: boolean
  ): boolean => {
    // RULE 6: User speech ALWAYS overrides assistant animations
    if (isUserSpeaking) {
      if (DEBUG_LOGGING) {
        log.debug('Rule 6 enforced: user speaking - blocking animations');
      }
      return false;
    }

    // High confidence threshold
    if (confidence > 0.5 && isAssistantGenerating) {
      if (DEBUG_LOGGING) {
        log.debug('High confidence: allowing animation', { confidence });
      }
      return true;
    }

    // Medium confidence with caution
    if (confidence > 0.3 && isAssistantGenerating) {
      if (DEBUG_LOGGING) {
        log.debug('Medium confidence: cautious animation', { confidence });
      }
      return true;
    }

    // Low confidence - block animation
    if (DEBUG_LOGGING) {
      log.debug('Low confidence: blocking animation', { 
        confidence, 
        isAssistantGenerating 
      });
    }
    return false;
  }, []);

  /**
   * Process messages using signal reliability hierarchy
   * This is the core of the voice confusion prevention system
   */
  const processLlmMessage = useCallback((message: LlmMessage) => {
    const currentTime = Date.now();

    if (DEBUG_LOGGING) {
      log.debug('LLM message processing', {
        type: message.type,
        role: message.role,
        transcriptType: message.transcriptType
      });
    }

    // MOST RELIABLE: Transcript messages with assistant role
    if (message.type === 'transcript' && message.role === 'assistant') {
      const transcriptText = message.transcript || '';
      const confidence = calculateConfidence(
        transcriptText, 
        message.transcriptType, 
        currentTime
      );

      if (DEBUG_LOGGING) {
        log.debug('Assistant transcript detected', {
          transcript: transcriptText.substring(0, 50) + '...',
          transcriptType: message.transcriptType,
          confidence,
          length: transcriptText.length
        });
      }

      setSpeechState(prev => ({
        ...prev,
        isAssistantGeneratingText: true,
        isAssistantSpeaking: true,
        lastAssistantMessage: transcriptText,
        assistantSpeechConfidence: confidence,
        transcriptQuality: message.transcriptType === 'final' ? 'final' : 'partial',
        speechTimestamp: currentTime,
        canAssistantAnimate: determineAnimationPermission(
          confidence, 
          prev.isUserSpeaking, 
          true
        )
      }));

      lastTranscriptTimeRef.current = currentTime;

      // Set timeout for confidence decay and animation cleanup
      if (confidenceDecayTimeoutRef.current) {
        clearTimeout(confidenceDecayTimeoutRef.current);
      }

      const cleanupDelay = confidence > 0.7 ? 1500 : 1000;
      confidenceDecayTimeoutRef.current = setTimeout(() => {
        setSpeechState(prev => ({
          ...prev,
          isAssistantGeneratingText: false,
          isAssistantSpeaking: false,
          canAssistantAnimate: false,
          assistantSpeechConfidence: 0,
          transcriptQuality: 'none'
        }));

        if (DEBUG_LOGGING) {
          log.debug('Transcript cleanup: animation permission revoked');
        }
      }, cleanupDelay);
    }

    // VERY RELIABLE: Conversation update with final transcript
    else if (message.type === 'conversation-update' && 
             message.role === 'assistant' && 
             message.transcriptType === 'final') {
      
      if (DEBUG_LOGGING) {
        log.debug('Conversation end: final transcript detected');
      }

      const cleanupDelay = speechState.assistantSpeechConfidence > 0.7 ? 800 : 500;
      setTimeout(() => {
        setSpeechState(prev => ({
          ...prev,
          isAssistantGeneratingText: false,
          isAssistantSpeaking: false,
          canAssistantAnimate: false,
          assistantVolumeLevel: 0,
          assistantSpeechConfidence: 0,
          transcriptQuality: 'none'
        }));
      }, cleanupDelay);
    }

    // LESS RELIABLE: Volume-based detection (use with caution)
    else if (message.type === 'speech-update') {
      // Only use this as a fallback when no transcript data is available
      const speaking = message.status === 'started';
      
      if (DEBUG_LOGGING) {
        log.debug('Volume-based detection', { 
          speaking, 
          hasRecentTranscript: currentTime - lastTranscriptTimeRef.current < 2000 
        });
      }

      // Don't override transcript-based detection if we have recent transcript data
      if (currentTime - lastTranscriptTimeRef.current > 2000) {
        setSpeechState(prev => ({
          ...prev,
          isAssistantSpeaking: speaking,
          assistantVolumeLevel: speaking ? prev.assistantVolumeLevel : 0
        }));
      }
    }
  }, [calculateConfidence, determineAnimationPermission, speechState.assistantSpeechConfidence]);

  /**
   * Handle user speech events with ULTRA STRICT animation control
   * RULE 6 ENFORCEMENT: User speech ALWAYS overrides assistant animations
   */
  const handleUserSpeechStart = useCallback(() => {
    if (DEBUG_LOGGING) {
      log.debug('Rule 6 triggered: user speech start - freezing animations');
    }

    setSpeechState(prev => ({
      ...prev,
      isUserSpeaking: true,
      canAssistantAnimate: false, // IMMEDIATELY block all animations
      assistantVolumeLevel: 0, // Cut assistant volume display
      isAssistantSpeaking: false, // Force stop assistant speech detection
      assistantSpeechConfidence: 0 // Reset confidence
    }));

    // Clear any pending timeouts - user priority is absolute
    if (speechEndTimeoutRef.current) {
      clearTimeout(speechEndTimeoutRef.current);
    }
    if (confidenceDecayTimeoutRef.current) {
      clearTimeout(confidenceDecayTimeoutRef.current);
    }
    
    // Reset last transcript time to prevent volume-based detection override
    lastTranscriptTimeRef.current = 0;
  }, []);

  const handleUserSpeechEnd = useCallback(() => {
    if (DEBUG_LOGGING) {
      log.debug('User speech end: initiating safety delay before allowing animations');
    }

    setSpeechState(prev => ({
      ...prev,
      isUserSpeaking: false
    }));

    // Safety delay to ensure user really stopped speaking (prevents false positives)
    speechEndTimeoutRef.current = setTimeout(() => {
      setSpeechState(prev => {
        // Triple check: User must still be NOT speaking and assistant must be active
        if (!prev.isUserSpeaking && 
            (prev.isAssistantGeneratingText || prev.isAssistantSpeaking)) {
          if (DEBUG_LOGGING) {
            log.debug('User definitively stopped: allowing assistant animations to resume');
          }
          return {
            ...prev,
            canAssistantAnimate: true
          };
        } else {
          if (DEBUG_LOGGING) {
            log.debug('Not resuming animations', {
              userSpeaking: prev.isUserSpeaking,
              assistantGenerating: prev.isAssistantGeneratingText,
              assistantSpeaking: prev.isAssistantSpeaking
            });
          }
        }
        return prev;
      });
    }, 200); // Reduced timeout for faster response
  }, []);

  /**
   * Sync with speech context changes
   */
  useEffect(() => {
    if (speechContext.isUserSpeaking !== speechState.isUserSpeaking) {
      if (speechContext.isUserSpeaking) {
        handleUserSpeechStart();
      } else {
        handleUserSpeechEnd();
      }
    }

    // Update other speech context values
    setSpeechState(prev => ({
      ...prev,
      audioLevel: speechContext.audioLevel || 0,
      assistantVolumeLevel: speechContext.assistantVolumeLevel || 0
    }));
  }, [
    speechContext.isUserSpeaking, 
    speechContext.audioLevel, 
    speechContext.assistantVolumeLevel,
    speechState.isUserSpeaking,
    handleUserSpeechStart,
    handleUserSpeechEnd
  ]);

  /**
   * Cleanup timeouts on unmount
   */
  useEffect(() => {
    return () => {
      if (speechEndTimeoutRef.current) {
        clearTimeout(speechEndTimeoutRef.current);
      }
      if (confidenceDecayTimeoutRef.current) {
        clearTimeout(confidenceDecayTimeoutRef.current);
      }
    };
  }, []);

  return {
    speechState,
    processLlmMessage,
    calculateConfidence,
    determineAnimationPermission,
    forceStopAnimations: handleUserSpeechStart,
    resumeAnimations: handleUserSpeechEnd
  };
};
