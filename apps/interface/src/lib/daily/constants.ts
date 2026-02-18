/**
 * Shared constants for Daily.co audio and participant detection
 */

/**
 * Audio level detection constants
 * Used by useBotSpeakingDetection hook and components
 */
export const AUDIO_DETECTION = {
  /** Threshold above which audio is considered "speaking" (0-1 range) */
  SPEAKING_THRESHOLD: 0.012,
  
  /** Debounce delay before marking speaking as stopped (milliseconds) */
  DEBOUNCE_MS: 500,
  
  /** Throttle for audio level callbacks to reduce CPU load (milliseconds) */
  THROTTLE_MS: 200,
  
  /** Update frequency for smooth lipsync animations (milliseconds) */
  LIPSYNC_UPDATE_MS: 100,
} as const;

/**
 * Username label display constants
 * Used for participant name display timing
 */
export const USERNAME_LABEL = {
  /** Duration to show username label after participant joins (milliseconds) */
  SHOW_DURATION_MS: 30000,
  
  /** Delay before fading in the label (milliseconds) */
  FADE_DELAY_MS: 200,
} as const;
