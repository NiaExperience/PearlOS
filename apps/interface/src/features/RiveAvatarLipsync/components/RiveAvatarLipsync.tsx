/**
 * RiveAvatarLipsync - Main component for sophisticated lip-sync animation
 * 
 * This component provides:
 * - Rive state machine-based animation control
 * - Intelligent mouth movement based on speech detection
 * - Voice confusion prevention
 * - Multi-stage animation system (relaxed, browser explanation, etc.)
 */

/* eslint-disable max-lines-per-function */
/* eslint-disable complexity */
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRive, useStateMachineInput } from 'rive-react';

import { useUI } from '@interface/contexts/ui-context';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { CALL_STATUS } from '@interface/hooks/useVoiceSession';
import { getClientLogger } from '@interface/lib/client-logger';

import { useAnimationControl } from '../lib/useAnimationControl';
import type { RiveAnimationConfig } from '../types/lipsync-types';

const DEBUG_LOGGING = process.env.NODE_ENV === 'development';
const log = getClientLogger('RiveAvatarLipsync');

// Rive configuration based on documentation
const RIVE_CONFIG: RiveAnimationConfig = {
  src: '/master_pearl3.riv',
  stateMachineName: 'Avatar Transition',
  stages: {
    STARTING: 0,
    RELAXED_SPEAKING: 1,
    BROWSER_EXPLANATION: 2,
    CALL_ENDING: 3
  },
  relaxedStageValues: {
    IDLE: 0.33,      // Changed from 0 to 0.33 to use a better idle animation
    SMILE_BASIC: 0.5, // Adjusted to avoid conflicts
    RELAX_TALK: 0.66,
    TALKING: 1
  },
  browserStageValues: {
    IDLE: 0,
    RELAX_TALK: 0.33,
    LOOKS_LEFT: 0.66,
    TALKS_WHILE_LOOKING_LEFT: 1
  }
};

interface RiveAvatarLipsyncProps {
  className?: string;
  width?: number;
  height?: number;
  enableDebug?: boolean;
}

export const RiveAvatarLipsync: React.FC<RiveAvatarLipsyncProps> = ({ 
  className = '',
  width = 250,
  height = 250,
  enableDebug = false
}) => {
  // Get animation and UI states
  const { animationState, speechState } = useAnimationControl();
  const { isBrowserWindowVisible, isDailyCallActive } = useUI();
  
  // Use context directly to get the shared call status
  const { callStatus } = useVoiceSessionContext();

  // Current stage tracking
  const [currentStage, setCurrentStage] = useState<number>(RIVE_CONFIG.stages.STARTING);
  const [currentAnimation, setCurrentAnimation] = useState<string>('starting');

  // Load the Rive file with state machine
  const { rive, RiveComponent } = useRive({
    src: RIVE_CONFIG.src,
    stateMachines: RIVE_CONFIG.stateMachineName,
    autoplay: true,
  });

  // Access state machine inputs
  const stageInput = useStateMachineInput(rive, RIVE_CONFIG.stateMachineName, "stage");
  const relaxStageInput = useStateMachineInput(rive, RIVE_CONFIG.stateMachineName, "relax_stage_value");
  const lookLeftInput = useStateMachineInput(rive, RIVE_CONFIG.stateMachineName, "look_left_value");

  // Ref to track if we've initialized
  const hasInitializedRef = useRef(false);

  // Ensure avatar rests on call end: move stage to CALL_ENDING and idle inputs, briefly, then leave at idle
  useEffect(() => {
    if (!rive) return;
    if (!stageInput || !relaxStageInput || !lookLeftInput) return;

    if (callStatus === CALL_STATUS.INACTIVE || callStatus === CALL_STATUS.UNAVAILABLE) {
      try {
        // Stage: CALL_ENDING
        if (typeof stageInput.value === 'number' && stageInput.value !== RIVE_CONFIG.stages.CALL_ENDING) {
          stageInput.value = RIVE_CONFIG.stages.CALL_ENDING;
          setCurrentStage(RIVE_CONFIG.stages.CALL_ENDING);
        }
        // Relax to idle
        if (typeof relaxStageInput.value === 'number') {
          relaxStageInput.value = RIVE_CONFIG.relaxedStageValues.IDLE as number;
        }
        // Look-left to idle
        if (typeof lookLeftInput.value === 'number') {
          lookLeftInput.value = RIVE_CONFIG.browserStageValues.IDLE as number;
        }
        setCurrentAnimation('call ending');
      } catch (e) {
        if (DEBUG_LOGGING) {
          log.error('Error forcing resting state on call end', { error: e });
        }
      }
    }
  }, [rive, stageInput, relaxStageInput, lookLeftInput, callStatus]);

  /**
   * Main avatar control function - implements the sophisticated control logic
   * from the documentation with stage-based animation and lipsync integration
   */
  // eslint-disable-next-line max-lines-per-function, complexity
  const updateAvatarState = useCallback(() => {
    if (!stageInput || !relaxStageInput || !lookLeftInput) {
      if (DEBUG_LOGGING) {
        log.debug('State machine inputs not ready');
      }
      return;
    }

    let targetStage = currentStage;
    let targetRelaxValue = RIVE_CONFIG.relaxedStageValues.IDLE as number;
    let targetLookLeftValue = RIVE_CONFIG.browserStageValues.IDLE as number;
    let animationName = 'idle';

    // Stage 1: Relaxed/Normal speaking mode
    if (!isBrowserWindowVisible) {
      targetStage = RIVE_CONFIG.stages.RELAXED_SPEAKING;

      if (animationState.shouldShowTalkingAnimation && !animationState.forceStopAnimation) {
        // Use intensity to determine animation level
        if (animationState.intensity > 0.7) {
          targetRelaxValue = RIVE_CONFIG.relaxedStageValues.TALKING as number;
          animationName = 'talking (high intensity)';
        } else if (animationState.intensity > 0.4) {
          targetRelaxValue = RIVE_CONFIG.relaxedStageValues.RELAX_TALK as number;
          animationName = 'relax talk';
        } else {
          targetRelaxValue = RIVE_CONFIG.relaxedStageValues.SMILE_BASIC as number;
          animationName = 'gentle animation';
        }
      } else {
        targetRelaxValue = RIVE_CONFIG.relaxedStageValues.IDLE as number;
        animationName = 'relaxed idle';
      }
    }
    // Stage 2: Browser explanation mode
    else if (isBrowserWindowVisible) {
      targetStage = RIVE_CONFIG.stages.BROWSER_EXPLANATION;

      if (animationState.shouldShowTalkingAnimation && !animationState.forceStopAnimation) {
        targetLookLeftValue = RIVE_CONFIG.browserStageValues.TALKS_WHILE_LOOKING_LEFT as number;
        animationName = 'talking while looking left';
      } else {
        targetLookLeftValue = RIVE_CONFIG.browserStageValues.LOOKS_LEFT as number;
        animationName = 'looking left';
      }
    }

    // CRITICAL: If user is speaking, immediately freeze all mouth animations
    if (animationState.forceStopAnimation || animationState.isUserDominant) {
      if (targetStage === RIVE_CONFIG.stages.RELAXED_SPEAKING) {
        targetRelaxValue = RIVE_CONFIG.relaxedStageValues.IDLE as number;
      } else if (targetStage === RIVE_CONFIG.stages.BROWSER_EXPLANATION) {
        targetLookLeftValue = RIVE_CONFIG.browserStageValues.LOOKS_LEFT as number;
      }
      animationName = 'frozen (user priority)';

      if (DEBUG_LOGGING) {
        log.debug('Forced animation stop', {
          reason: animationState.isUserDominant ? 'user dominant' : 'force stop',
          stage: targetStage
        });
      }
    }

    // Update state machine inputs with error checking
    try {
      // Update stage input
      if (stageInput.value !== targetStage) {
        if (DEBUG_LOGGING) {
          log.debug('Updating stage', { from: stageInput.value, to: targetStage });
        }
        stageInput.value = targetStage;
        setCurrentStage(targetStage);
      }

      // Update relax stage input
      if (relaxStageInput.value !== targetRelaxValue) {
        if (DEBUG_LOGGING) {
          log.debug('Updating relax value', { from: relaxStageInput.value, to: targetRelaxValue });
        }
        relaxStageInput.value = targetRelaxValue;
      }

      // Update look left input
      if (lookLeftInput.value !== targetLookLeftValue) {
        if (DEBUG_LOGGING) {
          log.debug('Updating look left value', { from: lookLeftInput.value, to: targetLookLeftValue });
        }
        lookLeftInput.value = targetLookLeftValue;
      }
    } catch (error) {
      log.error('Error updating state machine inputs', { error });
      return;
    }

    setCurrentAnimation(animationName);

    if (DEBUG_LOGGING) {
      log.debug('Avatar state update', {
        stage: targetStage,
        relaxValue: targetRelaxValue,
        lookLeftValue: targetLookLeftValue,
        animation: animationName,
        animationState: {
          shouldShow: animationState.shouldShowTalkingAnimation,
          forceStop: animationState.forceStopAnimation,
          intensity: animationState.intensity,
          userDominant: animationState.isUserDominant
        },
        inputsReady: !!stageInput && !!relaxStageInput && !!lookLeftInput
      });
    }
  }, [
    stageInput, 
    relaxStageInput, 
    lookLeftInput, 
    currentStage, 
    animationState,
    isBrowserWindowVisible
  ]);

  /**
   * Initialize the avatar on first load
   */
  useEffect(() => {
    if (rive && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      
      if (DEBUG_LOGGING) {
      log.debug('Initializing Rive Avatar Lipsync');
      }
      
      // Small delay to ensure Rive is fully loaded
      setTimeout(() => {
        updateAvatarState();
      }, 100);
    }
  }, [rive, updateAvatarState]);

  /**
   * Update avatar state when animation or UI state changes
   */
  useEffect(() => {
    updateAvatarState();
  }, [updateAvatarState]);

  /**
   * Handle Rive component errors
   */
  const handleRiveError = useCallback((error: unknown) => {
    if (DEBUG_LOGGING) {
      log.error('Rive avatar error', { error });
    }
  }, []);

  // Hide avatar during Daily Call (video bot) handoff
  if (isDailyCallActive) {
    return null;
  }

  return (
    <div className={`rive-avatar-lipsync ${className}`}>
      <div 
        className="rive-avatar relative overflow-hidden"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {RiveComponent ? (
          <div className="w-full h-full">
            <RiveComponent
              key="rive-avatar-lipsync"
              className="w-full h-full [&>canvas]:!bg-transparent [&>canvas]:!bg-none"
              onError={handleRiveError}
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/70 text-sm">
            Loading Rive Avatar...
          </div>
        )}
      </div>

      {/* Debug panel (development only) */}
      {enableDebug && DEBUG_LOGGING && (
        <div className="mt-4 p-3 bg-black/80 text-white/90 text-xs rounded border">
          <div className="font-bold mb-2">🎭 Lipsync Debug Panel</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-yellow-400">Animation:</div>
              <div>Type: {animationState.animationType}</div>
              <div>Show: {animationState.shouldShowTalkingAnimation ? '✅' : '❌'}</div>
              <div>Force Stop: {animationState.forceStopAnimation ? '🚫' : '➡️'}</div>
              <div>Intensity: {(animationState.intensity * 100).toFixed(1)}%</div>
              <div>Current: {currentAnimation}</div>
            </div>
            <div>
              <div className="text-blue-400">Speech:</div>
              <div>User: {speechState.isUserSpeaking ? '🎤' : '🔇'}</div>
              <div>Assistant: {speechState.isAssistantSpeaking ? '🗣️' : '😐'}</div>
              <div>Confidence: {(speechState.assistantSpeechConfidence * 100).toFixed(1)}%</div>
              <div>Can Animate: {speechState.canAssistantAnimate ? '✅' : '❌'}</div>
              <div>Message Length: {speechState.lastAssistantMessage.length}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
