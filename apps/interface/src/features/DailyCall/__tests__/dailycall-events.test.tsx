/* @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Force BOT_AUTO_JOIN = false BEFORE importing React or component modules that pull config.
jest.resetModules();
// Mock config before any component imports so BOT_AUTO_JOIN is false (prejoin form visible)
jest.mock('../lib/config', () => {
  const actual = jest.requireActual('../lib/config');
  return { ...actual, BOT_AUTO_JOIN: false };
});
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';

import DailyCallView from '../components/DailyCallView';
import { emitLocalJoin, emitLocalLeave } from '../events/publisher';
// Provide a stable mock for resilient session hook to avoid pulling next-auth plumbing.
jest.mock('@interface/hooks/use-resilient-session', () => ({
  useResilientSession: () => ({ data: { user: { name: 'Test User', email: 'test@example.com' } } }),
}));
// Mock user profile context
jest.mock('@interface/contexts/user-profile-context', () => ({
  useUserProfile: () => ({
    profile: { id: 'test-profile', username: 'Test User', settings: {} },
    isLoading: false,
    error: null,
    mutate: jest.fn(),
    isValidating: false,
  }),
  useUserProfileOptional: () => ({
    profile: { id: 'test-profile', username: 'Test User', settings: {} },
    isLoading: false,
    error: null,
    mutate: jest.fn(),
    isValidating: false,
  }),
  UserProfileProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock Daily SDK hooks to avoid needing actual Daily provider
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
  useScreenShare: () => ({
    screens: [],
    startScreenShare: jest.fn(),
    stopScreenShare: jest.fn(),
  }),
  useLocalSessionId: () => 'local-session-id',
  useVideoTrack: () => ({ isOff: false, track: null }),
  useAudioTrack: () => ({ isOff: false, track: null }),
}));

// Mock the Daily JS library to provide createCallObject used during component mount
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

// Mock publisher to observe calls
jest.mock('../events/publisher', () => ({
  emitLocalJoin: jest.fn(() => ({ username: 'alice', roomUrl: 'room', ts: 1 })),
  emitLocalLeave: jest.fn(() => ({ username: 'alice', roomUrl: 'room', ts: 2 })),
  // Added mocks to satisfy new Call.tsx emissions introduced after test creation
  emitCallStateChange: jest.fn(),
  emitCallError: jest.fn(),
  emitParticipantJoin: jest.fn(),
  emitParticipantLeave: jest.fn(),
  emitParticipantUpdate: jest.fn(),
}));

describe('DailyCallView event emissions', () => {
  test('emits join and leave events', async () => {
    render(
      <DesktopModeProvider>
        <DailyCallView
          roomUrl="room"
          isAdmin={false}
          assistantName={"pearlos"}
          supportedFeatures={['dailyCall']}
          personalityId={"some-id"}
          persona={'Pearl'}
          tenantId={"any"}
          onLeave={() => {}}
          updateDailyProviderState={() => {}}
        />
      </DesktopModeProvider>
    );
    let input: HTMLElement | null = null;

    // Try to find the manual join form; if it does not appear we assume auto-join behavior.
    try {
      input = await screen.findByPlaceholderText('Enter your display name', {}, { timeout: 600 });
    } catch (_) {
      input = null;
    }

    if (input) {
      // Clear existing value and set new one
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.change(input, { target: { value: 'alice' } });
      const joinBtn = screen.getByText('Join Meeting');
      expect(joinBtn).not.toBeDisabled();
      fireEvent.click(joinBtn);
      // Wait for the join event after clicking the button
      await waitFor(() => expect(emitLocalJoin).toHaveBeenCalled());
    } else {
      // No manual form; wait for auto join emission
      await waitFor(() => expect(emitLocalJoin).toHaveBeenCalled());
    }

    // Ensure join event fired (covers both paths)
    await waitFor(() => expect(emitLocalJoin).toHaveBeenCalled());

    const leaveBtn = await screen.findByTitle('Leave Call');
    fireEvent.click(leaveBtn);
    await waitFor(() => expect(emitLocalLeave).toHaveBeenCalled());
  });
});
