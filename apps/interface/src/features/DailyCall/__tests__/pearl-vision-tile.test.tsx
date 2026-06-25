/* @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';

import Call from '../components/Call';

const mockAudioTrack = { id: 'bot-audio-track' } as MediaStreamTrack;
const mockPlay = jest.fn().mockResolvedValue(undefined);
const mockUpdateParticipant = jest.fn();

const mockParticipants = {
  local: {
    session_id: 'local-id',
    local: true,
    user_name: 'Blair',
    tracks: {},
    userData: { sessionUserId: 'user-1' },
  },
  'bot-id': {
    session_id: 'bot-id',
    local: false,
    user_name: 'Pearl',
    tracks: {
      audio: { state: 'playable', track: mockAudioTrack },
    },
    userData: { isBot: true, type: 'pearl-bot' },
  },
};

jest.mock('@daily-co/daily-react', () => ({
  useDaily: jest.fn(() => ({
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    iframe: jest.fn(() => null),
    meetingState: jest.fn(() => 'joined-meeting'),
    participants: jest.fn(() => mockParticipants),
    updateParticipant: mockUpdateParticipant,
    setLocalAudio: jest.fn(),
    setLocalVideo: jest.fn(),
    sendAppMessage: jest.fn(),
  })),
  useDailyEvent: jest.fn(),
  useParticipantIds: jest.fn(() => ['local-id', 'bot-id']),
  useLocalSessionId: jest.fn(() => 'local-id'),
  useLocalParticipant: jest.fn(() => ({ video: false, audio: false })),
  useVideoTrack: jest.fn(() => ({ isOff: true, track: null })),
  useAudioTrack: jest.fn(() => ({ isOff: false, track: null })),
  useScreenShare: jest.fn(() => ({
    isSharingScreen: false,
    screens: [],
    startScreenShare: jest.fn(),
    stopScreenShare: jest.fn(),
  })),
  DailyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@interface/hooks/use-resilient-session', () => ({
  useResilientSession: jest.fn(() => ({
    status: 'authenticated',
    data: { user: { id: 'user-1', name: 'Blair', email: 'blair@niaxp.com' } },
  })),
}));

jest.mock('@interface/contexts/desktop-mode-context', () => ({
  useDesktopMode: jest.fn(() => ({
    currentMode: 'work',
    mode: 'work',
    setMode: jest.fn(),
    isDesktop: true,
  })),
}));

jest.mock('@interface/contexts/user-profile-context', () => ({
  useUserProfile: jest.fn(() => ({
    userProfileId: 'profile-1',
    metadata: {},
    onboardingComplete: true,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })),
}));

jest.mock('@interface/contexts/voice-session-context', () => ({
  useVoiceSessionContext: jest.fn(() => ({
    isAssistantSpeaking: false,
    setAudioSpeakingState: jest.fn(),
  })),
}));

jest.mock('@interface/hooks/useAudioSpeakingDetection', () => ({
  useAudioSpeakingDetection: jest.fn(() => ({ isSpeaking: false, volumeLevel: 0 })),
}));

jest.mock('@interface/components/pearl/tile-gif-avatar', () => ({
  __esModule: true,
  default: ({ isSpeaking }: { isSpeaking: boolean }) => {
    const ReactForMock = require('react');
    return ReactForMock.createElement(
      'div',
      { 'data-testid': 'mock-pearl-avatar' },
      isSpeaking ? 'Pearl speaking' : 'Pearl idle',
    );
  },
}));

jest.mock('../events/publisher', () => ({
  emitCallStateChange: jest.fn(),
  emitCallError: jest.fn(),
  emitParticipantJoin: jest.fn(),
  emitParticipantLeave: jest.fn(),
  emitParticipantUpdate: jest.fn(),
}));

jest.mock('../lib/tokenClient', () => ({
  requestDailyJoinToken: jest.fn().mockResolvedValue('test-token'),
  clearTokenCache: jest.fn(),
}));

jest.mock('../lib/botClient', () => ({
  joinRoom: jest.fn().mockResolvedValue({ ok: true, pid: 123 }),
}));

jest.mock('../lib/config', () => ({
  BOT_CONTROL_BASE_URL: 'https://mock-bot-url',
}));

describe('Pearl Vision tile rendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: mockPlay,
    });
    Object.defineProperty(global, 'MediaStream', {
      configurable: true,
      value: jest.fn().mockImplementation((tracks) => ({ tracks })),
    });
  });

  it('renders Pearl as a visible bot avatar tile in a vision call', async () => {
    render(
      <Call
        username="Blair"
        roomUrl="https://test.daily.co/pearl-vision"
        onLeave={() => {}}
        onProfileGate={() => {}}
        assistantName="Pearl"
        session={{ user: { id: 'user-1', name: 'Blair', email: 'blair@niaxp.com' } }}
        personalityId="pearl"
        persona="Pearl"
        tenantId="tenant-1"
        supportedFeatures={['dailyCall', 'vision']}
        visionMode
      />
    );

    expect(await screen.findByTestId('pearl-vision-bot-tile')).toBeInTheDocument();
    expect(screen.getByTestId('pearl-vision-avatar')).toBeInTheDocument();
    expect(screen.getByTestId('mock-pearl-avatar')).toHaveTextContent('Pearl idle');
    expect(screen.getByText('Pearl')).toBeInTheDocument();
    expect(screen.getByTestId('daily-call-local-tile')).toBeInTheDocument();
    expect(screen.getByTestId('daily-call-bot-audio')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockUpdateParticipant).toHaveBeenCalledWith('bot-id', { setAudio: true });
      expect(mockPlay).toHaveBeenCalled();
    });
  });
});
