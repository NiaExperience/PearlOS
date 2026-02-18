/**
 * Lipsync Actions - Server actions and orchestration wrappers
 * 
 * These actions provide the external API for other features to interact
 * with the lipsync system in a controlled and safe manner.
 */

'use server';

import { getLogger } from '@interface/lib/logger';

import { lipsyncService } from '../services/LipsyncService';
import type { LipsyncConfig, LlmMessage } from '../types/lipsync-types';

const log = getLogger('RiveAvatarLipsync');

/**
 * Initialize the lipsync system with optional configuration
 */
export async function initializeLipsync(config?: Partial<LipsyncConfig>) {
  try {
    await lipsyncService.initialize(config);
    return { success: true };
  } catch (error) {
    log.error('Failed to initialize lipsync', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Start lipsync processing
 */
export async function startLipsync() {
  try {
    lipsyncService.start();
    return { success: true };
  } catch (error) {
    log.error('Failed to start lipsync', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Stop lipsync processing
 */
export async function stopLipsync() {
  try {
    lipsyncService.stop();
    return { success: true };
  } catch (error) {
    log.error('Failed to stop lipsync', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Update lipsync configuration
 */
export async function updateLipsyncConfig(config: Partial<LipsyncConfig>) {
  try {
    lipsyncService.updateConfig(config);
    return { success: true };
  } catch (error) {
    log.error('Failed to update lipsync config', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Process a LLM message through the lipsync system
 */
export async function processLipsyncMessage(message: LlmMessage) {
  try {
    lipsyncService.processLlmMessage(message);
    return { success: true };
  } catch (error) {
    log.error('Failed to process lipsync message', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Force stop all animations (emergency user priority)
 */
export async function forceStopLipsyncAnimations() {
  try {
    lipsyncService.forceStopAnimations();
    return { success: true };
  } catch (error) {
    log.error('Failed to force stop animations', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Resume animations after user speech ends
 */
export async function resumeLipsyncAnimations() {
  try {
    lipsyncService.resumeAnimations();
    return { success: true };
  } catch (error) {
    log.error('Failed to resume animations', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get current animation state
 */
export async function getLipsyncAnimationState() {
  try {
    const state = lipsyncService.getAnimationState();
    return { success: true, state };
  } catch (error) {
    log.error('Failed to get animation state', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get lipsync performance metrics
 */
export async function getLipsyncMetrics() {
  try {
    const metrics = lipsyncService.getMetrics();
    return { success: true, metrics };
  } catch (error) {
    log.error('Failed to get lipsync metrics', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get current lipsync configuration
 */
export async function getLipsyncConfig() {
  try {
    const config = lipsyncService.getConfig();
    return { success: true, config };
  } catch (error) {
    log.error('Failed to get lipsync config', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Enable or disable the entire lipsync feature
 */
export async function toggleLipsync(enabled: boolean) {
  try {
    await lipsyncService.updateConfig({ enabled });
    
    if (enabled) {
      lipsyncService.start();
    } else {
      lipsyncService.stop();
    }
    
    return { success: true, enabled };
  } catch (error) {
    log.error('Failed to toggle lipsync', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Enable debug mode for development
 */
export async function enableLipsyncDebug(enabled: boolean = true) {
  try {
    await lipsyncService.updateConfig({
      debug: {
        enableLogging: enabled,
        showDebugPanel: enabled,
        logStateChanges: enabled
      }
    });
    
    return { success: true, debugEnabled: enabled };
  } catch (error) {
    log.error('Failed to enable lipsync debug', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Switch between Rive animations and CSS vowel shapes
 */
export async function switchLipsyncMode(useRiveAnimations: boolean) {
  try {
    await lipsyncService.updateConfig({ useRiveAnimations });
    return { success: true, useRiveAnimations };
  } catch (error) {
    log.error('Failed to switch lipsync mode', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Test function to validate lipsync system health
 */
export async function testLipsyncSystem() {
  try {
    const metrics = lipsyncService.getMetrics();
    const config = lipsyncService.getConfig();
    const state = lipsyncService.getAnimationState();
    
    const health = {
      initialized: metrics.isInitialized,
      running: metrics.isRunning,
      enabled: config.enabled,
      messagesProcessed: metrics.messagesProcessed,
      animationStateChanges: metrics.animationStateChanges,
      rule6Violations: metrics.rule6Violations,
      currentState: state.animationType,
      lastProcessingTime: metrics.lastProcessingTime
    };
    
    return { success: true, health };
  } catch (error) {
    log.error('Failed to test lipsync system', { error });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
