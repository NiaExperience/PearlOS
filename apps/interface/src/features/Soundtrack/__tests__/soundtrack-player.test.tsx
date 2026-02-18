/**
 * @jest-environment jsdom
 */
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

import { SoundtrackProvider, useSoundtrack } from '@interface/features/Soundtrack';

// Mock voice session context to respond to Daily audio level events
let mockIsAssistantSpeaking = false;
const mockIsUserSpeaking = false;

jest.mock('@interface/contexts/voice-session-context', () => ({
  VoiceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useVoiceSessionContext: () => ({
    isAssistantSpeaking: mockIsAssistantSpeaking,
    isUserSpeaking: mockIsUserSpeaking,
    audioLevel: 0,
    assistantVolumeLevel: 0,
    language: 'en',
    sessionStatus: 'inactive' as const,
    reconnectAttempts: 0,
    callStatus: 'inactive' as const,
    toggleCall: null,
    setCallStatus: jest.fn(),
    setToggleCall: jest.fn(),
    isCallEnding: false,
    canAssistantAnimate: false,
    isAssistantGeneratingText: false,
    lastAssistantMessage: '',
    assistantSpeechConfidence: 0,
    transcriptQuality: 'none' as const,
    speechTimestamp: 0,
    getCallObject: jest.fn(),
    destroyCallObject: jest.fn(),
  }),
}));

// Mock Daily.co event system - simulate bot speaking by updating mock state
const mockDailyAudioLevelEvent = (level: number) => {
  const isSpeaking = level > 0.012;
  mockIsAssistantSpeaking = isSpeaking;
  
  window.dispatchEvent(
    new CustomEvent('daily:audioLevel', {
      detail: { botParticipantId: 'bot-123', level, isSpeaking },
    })
  );
};

// Mock Audio API
global.Audio = jest.fn().mockImplementation(() => ({
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn(),
  load: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  setAttribute: jest.fn(),
  volume: 0.5,
  loop: false,
  src: '',
  currentTime: 0,
})) as unknown as typeof Audio;

// Test helper component
const TestComponent: React.FC = () => {
  const soundtrack = useSoundtrack();
  const currentTrack = soundtrack.getCurrentTrack();
  return (
    <div>
      <span data-testid="is-playing">{String(soundtrack.isPlaying)}</span>
      <span data-testid="volume">{soundtrack.volume}</span>
      <span data-testid="is-speaking">{String(soundtrack.isSpeaking)}</span>
      <span data-testid="current-track">{currentTrack?.title || 'none'}</span>
      <span data-testid="current-track-index">{soundtrack.currentTrackIndex}</span>
      <button data-testid="play-btn" onClick={soundtrack.play}>Play</button>
      <button data-testid="stop-btn" onClick={soundtrack.stop}>Stop</button>
      <button data-testid="next-btn" onClick={soundtrack.next}>Next</button>
    </div>
  );
};

const setup = () => render(
  <SoundtrackProvider>
    <TestComponent />
  </SoundtrackProvider>
);

describe('Soundtrack Player', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAssistantSpeaking = false;
  });
  it('should start with default state', () => {
    const { getByTestId } = setup();
    
    expect(getByTestId('is-playing').textContent).toBe('false');
    expect(getByTestId('volume').textContent).toBe('0.1'); // DEFAULT_NORMAL_VOLUME
    expect(getByTestId('is-speaking').textContent).toBe('false');
    expect(getByTestId('current-track-index').textContent).toBe('0');
  });

  it('should start playing when play is called', () => {
    const { getByTestId } = setup();
    
    act(() => {
      getByTestId('play-btn').click();
    });
    
    expect(getByTestId('is-playing').textContent).toBe('true');
  });

  it('should stop playing when stop is called', () => {
    const { getByTestId } = setup();
    
    act(() => {
      getByTestId('play-btn').click();
    });
    
    expect(getByTestId('is-playing').textContent).toBe('true');
    
    act(() => {
      getByTestId('stop-btn').click();
    });
    
    expect(getByTestId('is-playing').textContent).toBe('false');
  });

  it('should advance to next track when next is called', () => {
    const { getByTestId } = setup();
    
    const initialIndex = Number(getByTestId('current-track-index').textContent);
    
    act(() => {
      getByTestId('next-btn').click();
    });
    
    const newIndex = Number(getByTestId('current-track-index').textContent);
    expect(newIndex).toBe(initialIndex + 1);
  });

  it('should duck volume when bot starts speaking', async () => {
    const { getByTestId } = setup();
    
    expect(getByTestId('volume').textContent).toBe('0.1'); // DEFAULT_NORMAL_VOLUME
    
    // Simulate bot speaking via Daily audio level event
    act(() => {
      mockDailyAudioLevelEvent(0.5); // Above threshold (0.012)
    });
    
    await waitFor(() => {
      expect(getByTestId('is-speaking').textContent).toBe('true');
      expect(getByTestId('volume').textContent).toBe('0.05'); // Ducked to 50% of 0.1
    });
  });

  it('should restore volume when bot stops speaking', async () => {
    const { getByTestId } = setup();
    
    // Start bot speaking
    act(() => {
      mockDailyAudioLevelEvent(0.5);
    });
    
    await waitFor(() => {
      expect(getByTestId('volume').textContent).toBe('0.05'); // Ducked
    });
    
    // Stop bot speaking
    act(() => {
      mockDailyAudioLevelEvent(0); // Below threshold
    });
    
    await waitFor(() => {
      expect(getByTestId('is-speaking').textContent).toBe('false');
      expect(getByTestId('volume').textContent).toBe('0.1'); // Restored
    });
  });

  it('should handle continuous bot speech detection', async () => {
    const { getByTestId } = setup();
    
    // Simulate bot speaking with varying levels
    act(() => {
      mockDailyAudioLevelEvent(0.3);
    });
    
    await waitFor(() => {
      expect(getByTestId('is-speaking').textContent).toBe('true');
      expect(getByTestId('volume').textContent).toBe('0.05'); // Ducked
    });
    
    // Bot continues speaking
    act(() => {
      mockDailyAudioLevelEvent(0.6);
    });
    
    await waitFor(() => {
      expect(getByTestId('is-speaking').textContent).toBe('true');
      expect(getByTestId('volume').textContent).toBe('0.05'); // Still ducked
    });
  });

  it('should respond to soundtrackControl events', async () => {
    const { getByTestId } = setup();
    
    // Test play control
    act(() => {
      window.dispatchEvent(new CustomEvent('soundtrackControl', {
        detail: { action: 'play' }
      }));
    });
    
    await waitFor(() => {
      expect(getByTestId('is-playing').textContent).toBe('true');
    });
    
    // Test stop control
    act(() => {
      window.dispatchEvent(new CustomEvent('soundtrackControl', {
        detail: { action: 'stop' }
      }));
    });
    
    await waitFor(() => {
      expect(getByTestId('is-playing').textContent).toBe('false');
    });
    
    // Test next control
    const initialIndex = Number(getByTestId('current-track-index').textContent);
    
    act(() => {
      window.dispatchEvent(new CustomEvent('soundtrackControl', {
        detail: { action: 'next' }
      }));
    });
    
    await waitFor(() => {
      const newIndex = Number(getByTestId('current-track-index').textContent);
      expect(newIndex).toBe(initialIndex + 1);
    });
  });
});



