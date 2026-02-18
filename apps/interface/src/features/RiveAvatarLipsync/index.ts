/**
 * RiveAvatarLipsync Feature
 * Export server side bits only here, do not include client components
 */

// Feature definition
export { definition } from './definition';

// Types
export * from './types/lipsync-types';

// Actions
export * from './actions/lipsync-actions';

// Services
export { LipsyncService, lipsyncService } from './services/LipsyncService';

// NOTE: Client-side UI components (RiveAvatarLipsync, LipsyncDebugPanel) and hooks
// (useAnimationControl, useLipsyncSpeechDetection) should be imported directly
// from their paths to avoid server/client mixing issues.
