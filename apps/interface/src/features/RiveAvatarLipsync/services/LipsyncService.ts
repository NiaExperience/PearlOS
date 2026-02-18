/**
 * LipsyncService - Central orchestration service for avatar lipsync
 * 
 * This service provides:
 * - Centralized lipsync configuration management
 * - LLM message processing orchestration
 * - Performance monitoring and telemetry
 * - External API for other features to interact with lipsync
 */

import type { 
  LipsyncConfig, 
  AnimationState, 
  LlmMessage, 
  ILipsyncService,
  VowelShapeConfig,
  RiveAnimationConfig
} from '../types/lipsync-types';
import { getLogger } from '@interface/lib/logger';

const DEBUG_LOGGING = process.env.NODE_ENV === 'development';
const log = getLogger('RiveAvatarLipsync');

/**
 * Default configuration for the lipsync system
 */
const DEFAULT_CONFIG: LipsyncConfig = {
  enabled: true,
  useRiveAnimations: true,
  
  riveConfig: {
    src: '/master_pearl3.riv',
    stateMachineName: 'Avatar Transition',
    stages: {
      STARTING: 0,
      RELAXED_SPEAKING: 1,
      BROWSER_EXPLANATION: 2,
      CALL_ENDING: 3
    },
    relaxedStageValues: {
      IDLE: 0.33,
      SMILE_BASIC: 0.5,
      RELAX_TALK: 0.66,
      TALKING: 1
    },
    browserStageValues: {
      IDLE: 0,
      RELAX_TALK: 0.33,
      LOOKS_LEFT: 0.66,
      TALKS_WHILE_LOOKING_LEFT: 1
    }
  },
  
  vowelConfig: {
    shapes: {
      a: { width: 35, height: 30 },
      e: { width: 25, height: 18 },
      i: { width: 55, height: 22 },
      o: { width: 60, height: 50 },
      u: { width: 40, height: 40 },
      wide_a: { width: 85, height: 60 },
      thin_e: { width: 70, height: 28 },
      narrow_i: { width: 50, height: 20 },
      big_o: { width: 70, height: 60 },
      tiny_u: { width: 35, height: 35 },
      ellipse_h: { width: 80, height: 38 },
      ellipse_v: { width: 50, height: 65 },
      oval_wide: { width: 90, height: 45 },
      slit: { width: 65, height: 18 },
      round_big: { width: 75, height: 65 },
      closed: { width: 0, height: 0 },
      neutral: { width: 40, height: 15 },
      open: { width: 50, height: 30 },
      wide: { width: 60, height: 25 }
    },
    vowelSequence: ['neutral', 'open', 'wide', 'closed'],
    timing: {
      changeInterval: 200,
      transitionDuration: 100
    }
  },
  
  voiceConfusion: {
    transcriptOnlyTriggers: true,
    userSpeechResponseTime: 50, // 50ms for ultra-fast response
    speechEndTimeout: 1500
  },
  
  confidenceWeights: {
    contentLength: 0.4,
    transcriptFinality: 0.3,
    substantialContent: 0.2,
    recentActivity: 0.1
  },
  
  debug: {
    enableLogging: DEBUG_LOGGING,
    showDebugPanel: DEBUG_LOGGING,
    logStateChanges: DEBUG_LOGGING
  }
};

/**
 * Central lipsync service implementation
 */
export class LipsyncService implements ILipsyncService {
  private config: LipsyncConfig;
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  private currentAnimationState: AnimationState;
  private messageProcessor?: (message: LlmMessage) => void;
  
  // Performance metrics
  private metrics = {
    messagesProcessed: 0,
    animationStateChanges: 0,
    rule6Violations: 0,
    confidenceScores: [] as number[],
    lastProcessingTime: 0
  };

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.currentAnimationState = {
      shouldShowTalkingAnimation: false,
      forceStopAnimation: false,
      animationType: 'idle',
      intensity: 0,
      isUserDominant: false,
      animationName: 'Pearl Animation'
    };
  }

  /**
   * Initialize the lipsync service with configuration
   */
  async initialize(config?: Partial<LipsyncConfig>): Promise<void> {
    if (config) {
      this.config = { 
        ...DEFAULT_CONFIG, 
        ...config,
        // Deep merge nested objects
        riveConfig: { ...DEFAULT_CONFIG.riveConfig, ...config.riveConfig },
        vowelConfig: { ...DEFAULT_CONFIG.vowelConfig, ...config.vowelConfig },
        voiceConfusion: { ...DEFAULT_CONFIG.voiceConfusion, ...config.voiceConfusion },
        confidenceWeights: { ...DEFAULT_CONFIG.confidenceWeights, ...config.confidenceWeights },
        debug: { ...DEFAULT_CONFIG.debug, ...config.debug }
      };
    }

    this.isInitialized = true;

    if (this.config.debug.enableLogging) {
      log.info('LipsyncService initialized', {
        enabled: this.config.enabled,
        useRiveAnimations: this.config.useRiveAnimations,
        transcriptOnlyTriggers: this.config.voiceConfusion.transcriptOnlyTriggers
      });
    }
  }

  /**
   * Start lipsync processing
   */
  start(): void {
    if (!this.isInitialized) {
      throw new Error('LipsyncService must be initialized before starting');
    }

    if (!this.config.enabled) {
      if (this.config.debug.enableLogging) {
        log.info('LipsyncService start requested but feature is disabled');
      }
      return;
    }

    this.isRunning = true;
    this.metrics.messagesProcessed = 0;
    this.metrics.animationStateChanges = 0;

    if (this.config.debug.enableLogging) {
      log.info('LipsyncService started');
    }
  }

  /**
   * Stop lipsync processing
   */
  stop(): void {
    this.isRunning = false;

    // Reset animation state
    this.currentAnimationState = {
      shouldShowTalkingAnimation: false,
      forceStopAnimation: false,
      animationType: 'idle',
      intensity: 0,
      isUserDominant: false,
      animationName: 'Pearl Animation'
    };

    if (this.config.debug.enableLogging) {
      log.info('LipsyncService stopped', {
        metrics: this.getMetrics()
      });
    }
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<LipsyncConfig>): void {
    const oldEnabled = this.config.enabled;
    
    this.config = { 
      ...this.config, 
      ...newConfig,
      // Deep merge nested objects
      riveConfig: { ...this.config.riveConfig, ...newConfig.riveConfig },
      vowelConfig: { ...this.config.vowelConfig, ...newConfig.vowelConfig },
      voiceConfusion: { ...this.config.voiceConfusion, ...newConfig.voiceConfusion },
      confidenceWeights: { ...this.config.confidenceWeights, ...newConfig.confidenceWeights },
      debug: { ...this.config.debug, ...newConfig.debug }
    };

    // If disabled, force stop animations
    if (oldEnabled && !this.config.enabled) {
      this.forceStopAnimations();
    }

    if (this.config.debug.enableLogging) {
      log.info('LipsyncService config updated', { newConfig });
    }
  }

  /**
   * Get current animation state
   */
  getAnimationState(): AnimationState {
    return { ...this.currentAnimationState };
  }

  /**
   * Process LLM message for speech detection
   */
  processLlmMessage(message: LlmMessage): void {
    if (!this.isRunning || !this.config.enabled) {
      return;
    }

    const startTime = Date.now();
    this.metrics.messagesProcessed++;

    try {
      // Use the message processor if available (from hooks)
      if (this.messageProcessor) {
        this.messageProcessor(message);
      }

      // Track processing performance
      this.metrics.lastProcessingTime = Date.now() - startTime;

      if (this.config.debug.enableLogging && this.config.debug.logStateChanges) {
        log.debug('LLM message processed', {
          type: message.type,
          role: message.role,
          processingTime: this.metrics.lastProcessingTime,
          totalProcessed: this.metrics.messagesProcessed
        });
      }
    } catch (error) {
      log.error('Error processing LLM message', { error });
    }
  }

  /**
   * Force stop all animations (emergency user priority)
   */
  forceStopAnimations(): void {
    const oldState = { ...this.currentAnimationState };
    
    this.currentAnimationState = {
      ...this.currentAnimationState,
      shouldShowTalkingAnimation: false,
      forceStopAnimation: true,
      animationType: 'frozen',
      isUserDominant: true,
      animationName: 'Avatar Transition'
    };

    this.trackStateChange(oldState, this.currentAnimationState);

    if (this.config.debug.enableLogging) {
      log.warn('Force stop: all animations halted');
    }
  }

  /**
   * Resume animations after user speech ends
   */
  resumeAnimations(): void {
    const oldState = { ...this.currentAnimationState };
    
    this.currentAnimationState = {
      ...this.currentAnimationState,
      forceStopAnimation: false,
      isUserDominant: false,
      animationType: 'idle'
    };

    this.trackStateChange(oldState, this.currentAnimationState);

    if (this.config.debug.enableLogging) {
      log.info('Resume: animations can continue');
    }
  }

  /**
   * Set message processor (used by hooks)
   */
  setMessageProcessor(processor: (message: LlmMessage) => void): void {
    this.messageProcessor = processor;
  }

  /**
   * Update animation state (called by hooks)
   */
  updateAnimationState(newState: AnimationState): void {
    const oldState = { ...this.currentAnimationState };
    this.currentAnimationState = { ...newState };
    
    this.trackStateChange(oldState, newState);
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      averageConfidence: this.metrics.confidenceScores.length > 0 
        ? this.metrics.confidenceScores.reduce((a, b) => a + b) / this.metrics.confidenceScores.length 
        : 0,
      isRunning: this.isRunning,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Track animation state changes for metrics
   */
  private trackStateChange(oldState: AnimationState, newState: AnimationState): void {
    if (oldState.shouldShowTalkingAnimation !== newState.shouldShowTalkingAnimation ||
        oldState.forceStopAnimation !== newState.forceStopAnimation ||
        oldState.animationType !== newState.animationType) {
      
      this.metrics.animationStateChanges++;

      // Track RULE 6 violations
      if (newState.isUserDominant && newState.shouldShowTalkingAnimation) {
        this.metrics.rule6Violations++;
        log.warn('Rule 6 violation tracked', {
          violation: this.metrics.rule6Violations,
          state: newState
        });
      }

      if (this.config.debug.logStateChanges) {
        log.debug('Animation state change tracked', {
          from: oldState.animationType,
          to: newState.animationType,
          totalChanges: this.metrics.animationStateChanges
        });
      }
    }
  }

  /**
   * Add confidence score for tracking
   */
  addConfidenceScore(score: number): void {
    this.metrics.confidenceScores.push(score);
    
    // Keep only last 100 scores for performance
    if (this.metrics.confidenceScores.length > 100) {
      this.metrics.confidenceScores = this.metrics.confidenceScores.slice(-100);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): LipsyncConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const lipsyncService = new LipsyncService();
