/**
 * Soundtrack Feature - Frontend CustomEvent Documentation
 * 
 * This file documents the CustomEvents used for cross-component communication
 * in the Soundtrack feature. These events follow the frontend event patterns
 * described in .github/instructions/FRONTEND_EVENTS.reference.md
 */

/**
 * Detail type for soundtrackControl event
 */
export interface SoundtrackControlDetail {
  action: 'play' | 'stop' | 'next' | 'volume' | 'adjustVolume';
  source?: 'settings' | 'ui' | 'bot' | 'system' | 'voice_tool';
  persistPreference?: boolean;
  overridePreference?: boolean;
  volume?: number; // For 'volume' action: target volume (0.0 to 1.0)
  direction?: 'increase' | 'decrease'; // For 'adjustVolume' action
  step?: number; // For 'adjustVolume' action: step size (default 0.05)
}

/**
 * Event Catalog for Soundtrack Feature
 * =====================================
 * 
 * ### soundtrackControl
 * 
 * **Emitted by**: browser-window.tsx (tool function handlers)
 * **Listened by**: SoundtrackProvider component
 * 
 * **Detail**: SoundtrackControlDetail
 * - `action: 'play' | 'stop' | 'next' | 'volume' | 'adjustVolume'` - Control action to perform
 * - `source?: 'settings' | 'ui' | 'bot' | 'system' | 'voice_tool'` - Origin of the control event
 * - `persistPreference?: boolean` - Whether the event may update the saved startup preference
 * - `overridePreference?: boolean` - Whether a play event may override a saved off preference for this session only
 * - `volume?: number` - For 'volume' action: target volume (0.0 to 1.0)
 * - `direction?: 'increase' | 'decrease'` - For 'adjustVolume' action
 * - `step?: number` - For 'adjustVolume' action: step size (default 0.3)
 * 
 * **Trigger**: When AI assistant invokes soundtrack control tool functions:
 * - playSoundtrack → action: 'play'
 * - stopSoundtrack → action: 'stop'
 * - nextSoundtrackTrack → action: 'next'
 * - setSoundtrackVolume → action: 'volume', volume: number
 * - adjustSoundtrackVolume → action: 'adjustVolume', direction: 'increase'|'decrease', step: number
 * 
 * **Purpose**: Decoupled communication between browser-window tool handlers
 * and the SoundtrackProvider component to control playback without direct
 * component coupling.
 * 
 * **Example emission** (from browser-window.tsx):
 * ```typescript
 * window.dispatchEvent(
 *   new CustomEvent<SoundtrackControlDetail>('soundtrackControl', {
 *     detail: { action: 'play', source: 'bot' }
 *   })
 * );
 * ```
 * 
 * **Example listener** (in SoundtrackProvider.tsx):
 * ```typescript
 * useEffect(() => {
 *   const handleSoundtrackControl = (event: Event) => {
 *     const customEvent = event as CustomEvent<SoundtrackControlDetail>;
 *     const { action } = customEvent.detail;
 *     // Handle play/stop/next...
 *   };
 *   window.addEventListener('soundtrackControl', handleSoundtrackControl);
 *   return () => {
 *     window.removeEventListener('soundtrackControl', handleSoundtrackControl);
 *   };
 * }, []);
 * ```
 */
export const SOUNDTRACK_EVENTS = {
  CONTROL: 'soundtrackControl',
} as const;
