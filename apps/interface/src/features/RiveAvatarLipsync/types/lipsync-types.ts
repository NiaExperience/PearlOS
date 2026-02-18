/**
 * Type definitions for RiveAvatarLipsync feature
 */

export type AnimationType = 'talking' | 'listening' | 'idle' | 'frozen';
export type TranscriptQuality = 'none' | 'partial' | 'final';
export type VowelShape = 'a' | 'e' | 'i' | 'o' | 'u' | 'wide_a' | 'thin_e' | 'narrow_i' | 'big_o' | 'tiny_u' | 'ellipse_h' | 'ellipse_v' | 'oval_wide' | 'slit' | 'round_big' | 'closed' | 'neutral' | 'open' | 'wide';
export type AvatarMood = 'neutral' | 'happy' | 'surprised' | 'angry' | 'curious';

/**
 * Core animation state interface for controlling avatar mouth movements
 */
export interface AnimationState {
  /** Controls whether talking animations should be shown */
  shouldShowTalkingAnimation: boolean;
  
  /** Force stop any mouth movement (user priority enforcement) */
  forceStopAnimation: boolean;
  
  /** Current animation type being displayed */
  animationType: AnimationType;
  
  /** Animation intensity (0-1) based on confidence and volume */
  intensity: number;
  
  /** True when user is speaking and has priority */
  isUserDominant: boolean;
  
  /** Exact Rive animation name to use */
  animationName: string;
}

/**
 * Speech detection and confidence scoring interface
 */
export interface SpeechDetectionState {
  /** Whether assistant is currently speaking */
  isAssistantSpeaking: boolean;
  
  /** Whether user is currently speaking */
  isUserSpeaking: boolean;
  
  /** Assistant's perceived volume level (0-100) */
  assistantVolumeLevel: number;
  
  /** User's audio level (0-1) */
  audioLevel: number;
  
  /** Whether assistant is generating text content */
  isAssistantGeneratingText: boolean;
  
  /** Last message content from assistant */
  lastAssistantMessage: string;
  
  /** Confidence score for speech detection (0-1) */
  assistantSpeechConfidence: number;
  
  /** Quality of current transcript */
  transcriptQuality: TranscriptQuality;
  
  /** Timestamp when speech activity last started */
  speechTimestamp: number;
  
  /** Whether assistant is allowed to animate */
  canAssistantAnimate: boolean;
}

/**
 * Rive-specific animation configuration
 */
export interface RiveAnimationConfig {
  /** Path to the Rive animation file */
  src: string;
  
  /** State machine name within the Rive file */
  stateMachineName: string;
  
  /** Animation stages mapping */
  stages: {
    STARTING: number;
    RELAXED_SPEAKING: number;
    BROWSER_EXPLANATION: number;
    CALL_ENDING: number;
  };
  
  /** Relaxed stage animation values */
  relaxedStageValues: {
    IDLE: number;
    SMILE_BASIC: number;
    RELAX_TALK: number;
    TALKING: number;
  };
  
  /** Browser stage animation values */
  browserStageValues: {
    IDLE: number;
    RELAX_TALK: number;
    LOOKS_LEFT: number;
    TALKS_WHILE_LOOKING_LEFT: number;
  };
}

/**
 * Alternative vowel-based mouth shapes configuration
 */
export interface VowelShapeConfig {
  /** Mapping of vowel shapes to dimensions */
  shapes: Record<VowelShape, { width: number; height: number }>;
  
  /** Available vowel sequence for animation cycling */
  vowelSequence: VowelShape[];
  
  /** Animation timing configuration */
  timing: {
    /** Interval between vowel shape changes (ms) */
    changeInterval: number;
    
    /** Transition duration between shapes (ms) */
    transitionDuration: number;
  };
}

/**
 * Lipsync configuration interface
 */
export interface LipsyncConfig {
  /** Enable/disable lipsync functionality */
  enabled: boolean;
  
  /** Use Rive animations vs CSS vowel shapes */
  useRiveAnimations: boolean;
  
  /** Rive animation configuration */
  riveConfig: RiveAnimationConfig;
  
  /** Vowel-based animation configuration */
  vowelConfig: VowelShapeConfig;
  
  /** Voice confusion prevention settings */
  voiceConfusion: {
    /** Enable transcript-only triggering */
    transcriptOnlyTriggers: boolean;
    
    /** User speech response time (ms) */
    userSpeechResponseTime: number;
    
    /** Assistant speech end detection timeout (ms) */
    speechEndTimeout: number;
  };
  
  /** Confidence scoring weights */
  confidenceWeights: {
    /** Weight for transcript content length */
    contentLength: number;
    
    /** Weight for transcript finality */
    transcriptFinality: number;
    
    /** Weight for substantial content */
    substantialContent: number;
    
    /** Weight for recent activity */
    recentActivity: number;
  };
  
  /** Debug and logging settings */
  debug: {
    /** Enable console logging */
    enableLogging: boolean;
    
    /** Show debug UI panel */
    showDebugPanel: boolean;
    
    /** Log animation state changes */
    logStateChanges: boolean;
  };
}

/**
 * LLM message types for speech detection
 */
export interface LlmMessage {
  type: 'transcript' | 'speech-update' | 'conversation-update' | 'model-output' | 'assistant-message-part';
  role?: 'assistant' | 'user';
  transcript?: string;
  transcriptType?: 'partial' | 'final';
  text?: string;
  status?: 'started' | 'stopped';
  isSpeaking?: boolean;
}

/**
 * Lipsync service interface for external orchestration
 */
export interface ILipsyncService {
  /** Initialize the lipsync service */
  initialize(config: LipsyncConfig): Promise<void>;
  
  /** Start lipsync processing */
  start(): void;
  
  /** Stop lipsync processing */
  stop(): void;
  
  /** Update configuration */
  updateConfig(config: Partial<LipsyncConfig>): void;
  
  /** Get current animation state */
  getAnimationState(): AnimationState;
  
  /** Process LLM message for speech detection */
  processLlmMessage(message: LlmMessage): void;
  
  /** Force stop all animations (emergency user priority) */
  forceStopAnimations(): void;
  
  /** Resume animations after user speech ends */
  resumeAnimations(): void;
}
