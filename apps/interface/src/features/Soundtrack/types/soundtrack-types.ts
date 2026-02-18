/**
 * Soundtrack types for Pearl OS background music player
 */

export interface SoundtrackState {
  isPlaying: boolean;
  currentTrackIndex: number;
  volume: number;
  baseVolume: number;
  isSpeaking: boolean;
}

export interface SoundtrackControls {
  play: () => void;
  stop: () => void;
  next: () => void;
  getCurrentTrack: () => { title: string; artist: string } | null;
  setBaseVolume: (volume: number) => void;
}

export interface SoundtrackContextValue extends SoundtrackState, SoundtrackControls {
  // Combined state and controls
  autoplayBlocked: boolean;
}

export interface SoundtrackControlEvent {
  action: 'play' | 'stop' | 'next';
}



