/**
 * @jest-environment jsdom
 */
import { render, waitFor } from '@testing-library/react';
import React from 'react';

import Call from '../components/Call';
import { joinRoom } from '../lib/botClient';

// Mock dependencies
global.MediaStream = jest.fn().mockImplementation(() => ({
  addTrack: jest.fn(),
  removeTrack: jest.fn(),
  getTracks: jest.fn(() => []),
}));

jest.mock('../lib/botClient', () => ({
  joinRoom: jest.fn().mockResolvedValue({ ok: true, pid: 123 }),
}));

jest.mock('@daily-co/daily-react', () => ({
  useDaily: jest.fn(() => ({
    join: jest.fn(),
    leave: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    iframe: jest.fn(() => null),
    meetingState: jest.fn(() => 'joined-meeting'),
    participants: jest.fn(() => ({ local: { session_id: 'local' } })),
    setLocalAudio: jest.fn(),
    setLocalVideo: jest.fn(),
    startScreenShare: jest.fn(),
    stopScreenShare: jest.fn(),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    load: jest.fn(),
  })),
  useScreenShare: jest.fn(() => ({
    isSharingScreen: false,
    startScreenShare: jest.fn(),
    stopScreenShare: jest.fn(),
    screens: []
  })),
  useLocalSessionId: jest.fn(() => 'local-id'),
  useVideoTrack: jest.fn(() => ({ isOff: false, track: {} })),
  useAudioTrack: jest.fn(() => ({ isOff: false, track: {} })),
  useMediaTrack: jest.fn(() => ({ isOff: false, track: {} })),
  useParticipant: jest.fn(() => ({ user_name: 'Test User', local: true })),
  useAudioLevelObserver: jest.fn(),
  useParticipantIds: jest.fn(() => ['local-id']),
  useDailyEvent: jest.fn(),
  DailyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@interface/hooks/use-resilient-session', () => ({
  useResilientSession: jest.fn(() => ({ status: 'authenticated', data: { user: { id: 'u1' } } })),
}));

jest.mock('@interface/contexts/user-profile-context', () => ({
  useUserProfile: jest.fn(() => ({
    userProfileId: 'test-profile-id',
    metadata: {},
    onboardingComplete: true,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })),
}));

jest.mock('../lib/tokenClient', () => ({
  requestDailyJoinToken: jest.fn().mockResolvedValue('mock-token'),
  clearTokenCache: jest.fn(),
}));

// Mock config to ensure BOT_CONTROL_BASE_URL is truthy so joinRoom is called
jest.mock('../lib/config', () => ({
  BOT_CONTROL_BASE_URL: 'https://mock-bot-url',
}));

jest.mock('@interface/contexts/desktop-mode-context', () => ({
  useDesktopMode: jest.fn(() => ({
    mode: 'default',
    setMode: jest.fn(),
    isDesktop: false,
  })),
}));

jest.mock('@interface/contexts/voice-session-context', () => ({
  useVoiceSessionContext: jest.fn(() => ({
    callStatus: 'idle',
    roomUrl: null,
    activeSpriteVoice: false,
    activeSpriteId: null,
  })),
}));

describe('Call Component Feature Filtering', () => {
  const defaultProps = {
    username: 'TestUser',
    roomUrl: 'https://test.daily.co/room',
    onLeave: jest.fn(),
    onProfileGate: jest.fn(),
    session: { user: { id: 'u1', name: 'Test', email: 'test@example.com' } },
    personalityId: 'mock-personality-id', // Required to trigger bot join
    supportedFeatures: [],
    assistantName: 'pearlos',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters unsupported features before calling joinRoom', async () => {
    const supportedFeatures = [
      'htmlContent', // Allowed
      'notes', // Allowed
      'browserAutomation', // Not allowed
      'googleDrive', // Not allowed
      'miniBrowser', // Not allowed
      'unknownFeature', // Not allowed
    ];

    render(<Call {...defaultProps} supportedFeatures={supportedFeatures} />);

    await waitFor(() => {
      expect(joinRoom).toHaveBeenCalled();
    });

    const callArgs = (joinRoom as jest.Mock).mock.calls[0];
    const options = callArgs[1];

    // Check allowed features are present
    expect(options.supportedFeatures).toContain('htmlContent');
    expect(options.supportedFeatures).toContain('notes');

    // Check disallowed features are absent
    expect(options.supportedFeatures).not.toContain('browserAutomation');
    expect(options.supportedFeatures).not.toContain('googleDrive');
    expect(options.supportedFeatures).not.toContain('miniBrowser');
    expect(options.supportedFeatures).not.toContain('unknownFeature');
    
    // Verify exact length to ensure no other leaks
    expect(options.supportedFeatures).toHaveLength(2);
  });

  it('passes all allowed features correctly', async () => {
    const allAllowedFeatures = [
      'htmlContent',
      'notes',
      'onboarding',
      'resourceSharing',
      'userProfile',
      'smartSilence',
      'lullDetection'
    ];

    render(<Call {...defaultProps} supportedFeatures={allAllowedFeatures} />);

    await waitFor(() => {
      expect(joinRoom).toHaveBeenCalled();
    });

    const callArgs = (joinRoom as jest.Mock).mock.calls[0];
    const options = callArgs[1];

    expect(options.supportedFeatures).toEqual(expect.arrayContaining(allAllowedFeatures));
    expect(options.supportedFeatures).toHaveLength(allAllowedFeatures.length);
  });
});
