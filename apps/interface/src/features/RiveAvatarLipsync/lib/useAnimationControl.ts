/**
 * Advanced animation control hook for Rive avatar lipsync
 * 
 * This hook implements sophisticated animation control logic with:
 * - Multi-factor confidence scoring for animation intensity
 * - Dynamic animation intensity calculation
 * - User priority enforcement (RULE 6: User speech ALWAYS overrides)
 * - Enhanced combined detection with transcript analysis
 */

import { useEffect, useState, useCallback } from 'react';
import { useLipsyncSpeechDetection } from './useLipsyncSpeechDetection';
import type { AnimationState } from '../types/lipsync-types';
import { getClientLogger } from '@interface/lib/client-logger';

const DEBUG_LOGGING = process.env.NODE_ENV === 'development';
const log = getClientLogger('RiveAvatarLipsync');

/**
 * Hook for controlling avatar animation state based on speech detection
 */
export const useAnimationControl = () => {
  const { speechState } = useLipsyncSpeechDetection();
  
  const [animationState, setAnimationState] = useState<AnimationState>({
    shouldShowTalkingAnimation: false,
    forceStopAnimation: false,
    animationType: 'idle',
    intensity: 0,
    isUserDominant: false,
    animationName: 'Pearl Animation'
  });

  /**
   * Enhanced mouth animation decision logic
   * CRITICAL: Only animate when assistant is ACTUALLY speaking
   */
  const shouldAnimateMouth = useCallback(() => {
    const hasContent = speechState.lastAssistantMessage.length > 0;
    const isHighConfidence = speechState.assistantSpeechConfidence > 0.5;
    const hasRecentActivity = Date.now() - speechState.speechTimestamp < 10000; // 10 seconds
    const isQualityTranscript = speechState.transcriptQuality === 'final' || 
                                speechState.transcriptQuality === 'partial';
    
    // ENHANCED: Stricter conditions - assistant MUST be speaking or generating
    const shouldAnimate = (speechState.isAssistantGeneratingText || speechState.isAssistantSpeaking) &&  // Assistant is active
                         !speechState.isUserSpeaking &&                                                  // User is NOT speaking
                         speechState.canAssistantAnimate &&                                              // Animations are permitted
                         hasContent &&                                                                    // There's actual transcript content
                         (isHighConfidence || isQualityTranscript) &&                                     // High confidence OR quality transcript
                         hasRecentActivity;                                                               // Recent speech activity

    // COMPREHENSIVE LOGGING: Track all animation decisions
    if (DEBUG_LOGGING) {
      const reasons = [];
      if (!speechState.isAssistantGeneratingText && !speechState.isAssistantSpeaking) reasons.push('assistant not active');
      if (speechState.isUserSpeaking) reasons.push('user speaking');
      if (!speechState.canAssistantAnimate) reasons.push('animation blocked');
      if (!hasContent) reasons.push('no content');
      if (!isHighConfidence && !isQualityTranscript) reasons.push('low confidence/quality');
      if (!hasRecentActivity) reasons.push('no recent activity');

      if (shouldAnimate) {
        log.debug('Mouth animation approved', {
          generating: speechState.isAssistantGeneratingText,
          speaking: speechState.isAssistantSpeaking,
          userSilent: !speechState.isUserSpeaking,
          permitted: speechState.canAssistantAnimate,
          hasContent,
          isHighConfidence,
          isQualityTranscript,
          hasRecentActivity,
          transcriptPreview: speechState.lastAssistantMessage.substring(0, 30) + '...'
        });
      } else if (reasons.length > 0) {
        log.debug('Mouth animation denied', {
          reasons,
          state: {
            generating: speechState.isAssistantGeneratingText,
            speaking: speechState.isAssistantSpeaking,
            userSpeaking: speechState.isUserSpeaking,
            canAnimate: speechState.canAssistantAnimate,
            hasContent,
            confidence: speechState.assistantSpeechConfidence,
            quality: speechState.transcriptQuality,
            lastActivity: hasRecentActivity ? `${Math.round((Date.now() - speechState.speechTimestamp) / 1000)}s ago` : 'none'
          }
        });
      }
    }

    return shouldAnimate;
  }, [speechState]);

  /**
   * Check if we're processing speech without transcript (fallback mode)
   */
  const isProcessingWithoutTranscript = useCallback(() => {
    return speechState.isAssistantSpeaking && 
           speechState.lastAssistantMessage.length === 0 &&
           speechState.assistantVolumeLevel > 20;
  }, [speechState]);

  /**
   * Calculate dynamic animation intensity based on multiple factors
   * Enhanced algorithm from documentation with confidence scoring
   */
  const calculateAnimationIntensity = useCallback(() => {
    const baseIntensity = speechState.assistantVolumeLevel / 100;
    const confidenceBoost = speechState.assistantSpeechConfidence * 0.3;
    const lengthBoost = Math.min(speechState.lastAssistantMessage.length / 50, 0.4);
    const qualityBoost = speechState.transcriptQuality === 'final' ? 0.2 : 0.1;
    
    const calculatedIntensity = Math.max(
      baseIntensity + confidenceBoost + lengthBoost + qualityBoost,
      0.4 // Minimum intensity for visible animation
    );

    if (DEBUG_LOGGING) {
      log.debug('Animation intensity calculation', {
        baseIntensity,
        confidenceBoost,
        lengthBoost,
        qualityBoost,
        calculatedIntensity: Math.min(calculatedIntensity, 1.0),
        factors: {
          volume: speechState.assistantVolumeLevel,
          confidence: speechState.assistantSpeechConfidence,
          messageLength: speechState.lastAssistantMessage.length,
          quality: speechState.transcriptQuality
        }
      });
    }

    return Math.min(calculatedIntensity, 1.0); // Cap at 1.0
  }, [speechState]);

  /**
   * Main animation state update logic
   * Implements the core decision tree from the documentation
   */
  useEffect(() => {
    const userSpeaking = speechState.isUserSpeaking;
    const shouldAnimate = shouldAnimateMouth();
    const isProcessing = isProcessingWithoutTranscript();
    
    let newState: AnimationState;

    // LOG ALL DECISION INPUTS
    if (DEBUG_LOGGING) {
      log.debug('Animation decision cycle', {
        userSpeaking,
        shouldAnimate,
        isProcessing,
        assistantSpeaking: speechState.isAssistantSpeaking,
        assistantGenerating: speechState.isAssistantGeneratingText,
        canAnimate: speechState.canAssistantAnimate,
        currentAnimationType: animationState.animationType,
        currentlyAnimating: animationState.shouldShowTalkingAnimation
      });
    }

    if (userSpeaking) {
      // 🚫 ABSOLUTE PRIORITY: User is speaking - FREEZE everything immediately (RULE 6)
      newState = {
        shouldShowTalkingAnimation: false,
        forceStopAnimation: true,
        animationType: 'frozen',
        intensity: 0,
        isUserDominant: true,
        animationName: 'Avatar Transition'
      };
      
      if (DEBUG_LOGGING) {
        log.debug('Rule 6 enforced: user dominant - freezing animations', {
          userSpeaking,
          assistantWasSpeaking: speechState.isAssistantSpeaking,
          canAssistantAnimate: speechState.canAssistantAnimate,
          previousState: animationState.animationType
        });
      }
      
    } else if (shouldAnimate && speechState.canAssistantAnimate) {
      // ✅ OPTIMAL: All conditions met for enhanced mouth animation AND user permits it
      const calculatedIntensity = calculateAnimationIntensity();
      
      newState = {
        shouldShowTalkingAnimation: true,
        forceStopAnimation: false,
        animationType: 'talking',
        intensity: calculatedIntensity,
        isUserDominant: false,
        animationName: 'Relax Talk Basic 1'
      };
      
      if (DEBUG_LOGGING) {
        log.debug('Mouth animation starting', {
          reason: 'All conditions met',
          intensity: calculatedIntensity,
          assistantSpeaking: speechState.isAssistantSpeaking,
          assistantGenerating: speechState.isAssistantGeneratingText,
          transcriptPreview: speechState.lastAssistantMessage.substring(0, 30) + '...',
          confidence: speechState.assistantSpeechConfidence,
          quality: speechState.transcriptQuality,
          canAnimate: speechState.canAssistantAnimate,
          previousState: animationState.animationType
        });
      }
      
    } else if (isProcessing && speechState.canAssistantAnimate && !userSpeaking) {
      // 🔶 FALLBACK: Processing without transcript (use with caution) - only if user permits
      const fallbackIntensity = Math.max(speechState.assistantVolumeLevel / 150, 0.3);
      
      newState = {
        shouldShowTalkingAnimation: true,
        forceStopAnimation: false,
        animationType: 'talking',
        intensity: fallbackIntensity,
        isUserDominant: false,
        animationName: 'Pearl Animation'
      };
      
      if (DEBUG_LOGGING) {
        log.debug('Fallback animation starting (volume-based)', {
          reason: 'Processing without transcript',
          volume: speechState.assistantVolumeLevel,
          intensity: fallbackIntensity,
          canAnimate: speechState.canAssistantAnimate,
          userSpeaking,
          assistantSpeaking: speechState.isAssistantSpeaking,
          previousState: animationState.animationType
        });
      }
      
    } else {
      // 😐 IDLE: Default state when no speech activity or user blocks animation
      newState = {
        shouldShowTalkingAnimation: false,
        forceStopAnimation: false,
        animationType: 'idle',
        intensity: 0,
        isUserDominant: false,
        animationName: 'Pearl Animation'
      };
      
      if (DEBUG_LOGGING) {
        const reasons = [];
        if (!shouldAnimate) reasons.push('conditions not met');
        if (!speechState.canAssistantAnimate) reasons.push('animation blocked');
        if (userSpeaking) reasons.push('user speaking');
        if (!isProcessing) reasons.push('not processing');

        // Log when transitioning TO idle or when something changes
        if (animationState.shouldShowTalkingAnimation || 
            animationState.animationType !== 'idle' ||
            speechState.isAssistantSpeaking || 
            speechState.isAssistantGeneratingText) {
          log.debug('Animation stopping: transitioning to idle', {
            reasons,
            previouslyAnimating: animationState.shouldShowTalkingAnimation,
            previousState: animationState.animationType,
            shouldAnimate,
            isProcessing,
            canAnimate: speechState.canAssistantAnimate,
            userSpeaking,
            assistantSpeaking: speechState.isAssistantSpeaking,
            assistantGenerating: speechState.isAssistantGeneratingText
          });
        }
      }
    }

    // CRITICAL: Multiple safety checks to ensure RULE 6 is never violated
    if (userSpeaking && newState.shouldShowTalkingAnimation) {
      log.error('Rule 6 safety: preventing animation while user speaking');
      newState.shouldShowTalkingAnimation = false;
      newState.forceStopAnimation = true;
      newState.animationType = 'frozen';
      newState.animationName = 'Avatar Transition';
    }

    // Log state changes for debugging
    if (animationState.shouldShowTalkingAnimation !== newState.shouldShowTalkingAnimation ||
        animationState.forceStopAnimation !== newState.forceStopAnimation ||
        animationState.animationType !== newState.animationType) {
      
      if (DEBUG_LOGGING) {
        log.debug('Animation state change', {
          from: {
            talking: animationState.shouldShowTalkingAnimation,
            forceStop: animationState.forceStopAnimation,
            type: animationState.animationType
          },
          to: {
            talking: newState.shouldShowTalkingAnimation,
            forceStop: newState.forceStopAnimation,
            type: newState.animationType
          },
          conditions: {
            userSpeaking,
            shouldAnimate,
            isProcessing,
            assistantSpeaking: speechState.isAssistantSpeaking,
            canAnimate: speechState.canAssistantAnimate
          }
        });
      }
    }

    setAnimationState(newState);
  }, [
    speechState,
    shouldAnimateMouth,
    isProcessingWithoutTranscript,
    calculateAnimationIntensity,
    animationState.shouldShowTalkingAnimation,
    animationState.forceStopAnimation,
    animationState.animationType
  ]);

  /**
   * Force stop animations (emergency user priority)
   */
  const forceStopAnimations = useCallback(() => {
    setAnimationState(prev => ({
      ...prev,
      shouldShowTalkingAnimation: false,
      forceStopAnimation: true,
      animationType: 'frozen',
      isUserDominant: true,
      animationName: 'Avatar Transition'
    }));
  }, []);

  /**
   * Resume animations after user speech ends
   */
  const resumeAnimations = useCallback(() => {
    setAnimationState(prev => ({
      ...prev,
      forceStopAnimation: false,
      isUserDominant: false
    }));
  }, []);

  return {
    animationState,
    speechState,
    forceStopAnimations,
    resumeAnimations,
    shouldAnimateMouth,
    calculateAnimationIntensity
  };
};
