/* @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Ensure fresh module state per test file
jest.resetModules();

// Force manual pre-join (no auto join) and ensure legacy mode calls joinRoom
jest.mock('../lib/config', () => {
  const actual = jest.requireActual('../lib/config');
  return {
    ...actual,
    BOT_AUTO_JOIN: false,
    // Provide a non-empty base URL so DailyCallView proceeds to call joinRoom
    BOT_CONTROL_BASE_URL: 'http://bot-control.local',
  };
});

import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';

// Mock user profile context to satisfy useUserProfile requirement
jest.mock('@interface/contexts/user-profile-context', () => ({
  useUserProfile: () => ({
    userProfileId: 'test-profile-id',
    metadata: {},
    onboardingComplete: false,
    overlayDismissed: false,
    loading: false,
    error: null,
    refresh: jest.fn(),
    dismissOverlay: jest.fn(),
  }),
  useUserProfileOptional: () => ({
    userProfileId: 'test-profile-id',
    metadata: {},
    onboardingComplete: false,
    overlayDismissed: false,
    loading: false,
    error: null,
    refresh: jest.fn(),
    dismissOverlay: jest.fn(),
  }),
}));

import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock Daily SDK hooks used inside DailyCallView
jest.mock('@daily-co/daily-react', () => ({
  DailyProvider: (props: any) => props.children,
  useDaily: () => ({
    leave: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    participants: () => ({ local: { session_id: 'local', tracks: {} } }),
    meetingState: () => 'new',
    on: jest.fn(),
    off: jest.fn(),
    sendAppMessage: jest.fn(),
  }),
  useDailyEvent: jest.fn(),
  useParticipantIds: () => [],
  useLocalParticipant: () => ({ video: false, audio: false }),
  useScreenShare: () => ({ screens: [], startScreenShare: jest.fn(), stopScreenShare: jest.fn() }),
  useLocalSessionId: () => 'local-session-id',
  useVideoTrack: () => ({ isOff: false, track: null }),
  useAudioTrack: () => ({ isOff: false, track: null }),
}));

// Mock the Daily JS library createCallObject used during component mount
jest.mock('@daily-co/daily-js', () => ({
  __esModule: true,
  default: {
    createCallObject: jest.fn(() => ({
      leave: jest.fn(),
      destroy: jest.fn(),
      meetingState: () => 'new',
      participants: () => ({ local: { session_id: 'local', tracks: {} } }),
      setLocalVideo: jest.fn(),
      setLocalAudio: jest.fn(),
    })),
  },
}));

// Mock publisher to avoid noise and satisfy imports
jest.mock('../events/publisher', () => ({
  emitLocalJoin: jest.fn(() => ({ username: 'alice', roomUrl: 'room', ts: 1 })),
  emitLocalLeave: jest.fn(() => ({ username: 'alice', roomUrl: 'room', ts: 2 })),
  emitCallStateChange: jest.fn(),
  emitCallError: jest.fn(),
  emitParticipantJoin: jest.fn(),
  emitParticipantLeave: jest.fn(),
  emitParticipantUpdate: jest.fn(),
}));

// Provide a stable mock for resilient session hook to avoid next-auth plumbing
jest.mock('@interface/hooks/use-resilient-session', () => ({
  useResilientSession: () => ({ data: { user: { name: 'Test User', email: 'test@example.com' } } }),
}));

// Import after mocks so they take effect
import DailyCallView from '../components/DailyCallView';

// Mock fetch globally
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const global: any;

describe('DailyCall legacy join personality selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ pid: 42 }) });
  });

  const joinViaUI = async () => {
    // Fill in pre-join name and click join
    const input = await screen.findByPlaceholderText('Enter your display name', {}, { timeout: 800 });
    fireEvent.change(input, { target: { value: 'alice' } });
    const joinBtn = screen.getByText('Join Meeting');
    fireEvent.click(joinBtn);
    // Wait for joinRoom fetch to be called
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  };

  it('uses botPersonalityId when provided (prop personalityId)', async () => {
    render(
      <DesktopModeProvider>
        <DailyCallView
          roomUrl="https://daily.test/room"
          isAdmin={false}
          assistantName={'assistant-x'}
          supportedFeatures={['dailyCall']}
          personalityId={'bot-123'}
          persona={'Pearl'}
          tenantId={'tenant-1'}
          voiceId={'voice-1'}
          onLeave={() => {}}
          updateDailyProviderState={() => {}}
        />
      </DesktopModeProvider>
    );

    await joinViaUI();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/bot/join',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String),
      })
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual(
      expect.objectContaining({
        personalityId: 'bot-123',
        persona: 'Pearl',
        tenantId: 'tenant-1',
      })
    );
  });

  it('falls back to OS personality when botPersonalityId not set (prop personalityId carries OS id)', async () => {
    render(
      <DesktopModeProvider>
        <DailyCallView
          roomUrl="https://daily.test/room-2"
          isAdmin={false}
          assistantName={'assistant-y'}
          supportedFeatures={['dailyCall']}
          // Simulating page.tsx fallback by passing OS personality id here
          personalityId={'os-abc'}
          persona={'Pearl'}
          tenantId={'tenant-2'}
          voiceId={'voice-2'}
          onLeave={() => {}}
          updateDailyProviderState={() => {}}
        />
      </DesktopModeProvider>
    );

    await joinViaUI();

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual(
      expect.objectContaining({
        personalityId: 'os-abc',
        persona: 'Pearl',
        tenantId: 'tenant-2',
      })
    );
  });
});
