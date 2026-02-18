/* @jest-environment jsdom */
import { render, waitFor } from '@testing-library/react';
import React from 'react';

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

jest.mock('../events/publisher', () => ({
  emitParticipantJoin: jest.fn(),
  emitParticipantLeave: jest.fn(),
  emitCallStateChange: jest.fn(),
  emitCallError: jest.fn(),
  // New emission added in Call.tsx implementation
  emitParticipantUpdate: jest.fn(),
}));

jest.mock('../lib/tokenClient', () => ({
  requestDailyJoinToken: jest.fn().mockResolvedValue('test-token'),
  clearTokenCache: jest.fn(),
}));

jest.mock('../lib/devRoomClient', () => ({
  requestDevRoomDeletion: jest.fn().mockResolvedValue(true),
}));

// Mock Daily SDK
type DailyEventHandler = (...args: unknown[]) => void;

const mockEventHandlers: Record<string, DailyEventHandler[]> = {};
jest.mock('@daily-co/daily-react', () => ({
  useDaily: () => ({
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn(),
    participants: () => ({ local: { session_id: 'local' } }),
    meetingState: () => 'new',
    on: jest.fn(),
    off: jest.fn(),
    sendAppMessage: jest.fn(),
  }),
  useDailyEvent: (name: string, handler: DailyEventHandler) => {
    mockEventHandlers[name] = mockEventHandlers[name] || [];
    mockEventHandlers[name].push(handler);
  },
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

import Call from '../components/Call';
import { emitParticipantJoin, emitParticipantLeave, emitCallStateChange } from '../events/publisher';

function fireEvent(name: string, payload: unknown) {
  (mockEventHandlers[name] || []).forEach((h) => h(payload));
}

describe('DailyCall participant events', () => {
  test('emits participant join/leave plus call state transitions', async () => {
    render(
      <DesktopModeProvider>
        <Call
          username="alice"
          roomUrl="room"
          onLeave={() => {}}
          onProfileGate={() => {}}
          assistantName="pearlos"
        />
      </DesktopModeProvider>
    );

  await waitFor(() => expect(emitCallStateChange).toHaveBeenCalledWith('room', 'joining', 'alice'));

    // Simulate join success state change already triggered -> expecting 'joined'
  await waitFor(() => expect(emitCallStateChange).toHaveBeenCalledWith('room', 'joined', 'alice'));

    fireEvent('participant-joined', { participant: { session_id: 'p1', local: false, user_name: 'bob' } });
  await waitFor(() => expect(emitParticipantJoin).toHaveBeenCalledWith('room', 'p1', 'bob'));

    fireEvent('participant-left', { participant: { session_id: 'p1', local: false, user_name: 'bob' }, reason: 'left' });
  await waitFor(() => expect(emitParticipantLeave).toHaveBeenCalledWith('room', 'p1', 'bob', 'left'));
  });
});
