/* @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Test: DailyCall prioritizes UserProfile first_name over parsed User.name
 * 
 * Scenario 1: User has profile with first_name "Bob" and User.name "Robert Smith"
 *   → Should join with "Bob" (profile first_name takes priority)
 * 
 * Scenario 2: User has no profile, only User.name "Robert Smith"
 *   → Should join with "Robert Smith" (fallback to User.name)
 */

import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { v4 as uuidv4 } from 'uuid';

import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { VoiceSessionProvider } from '@interface/contexts/voice-session-context';

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

import { DailyCallStateProvider } from '../../DailyCall/state/store';

// Must mock Daily before importing components that use it
const mockJoin = jest.fn().mockResolvedValue(undefined);
jest.mock('@daily-co/daily-react', () => ({
  useDaily: () => ({
    join: mockJoin,
    leave: jest.fn(),
    participants: () => ({ local: { session_id: 'local' } }),
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
    remoteParticipantIds: [],
    startScreenShare: jest.fn(),
    stopScreenShare: jest.fn(),
  }),
  useLocalSessionId: () => 'local-session-id',
  useVideoTrack: () => ({ isOff: false, track: null }),
  useAudioTrack: () => ({ isOff: false, track: null }),
}));

// Mock publisher
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

jest.mock('../lib/devRoomClient', () => ({
  requestDevRoomDeletion: jest.fn().mockResolvedValue(true),
}));

// Import component after mocks
import Call from '../components/Call';

describe('DailyCall profile first_name prioritization', () => {
  const assistantName = 'pearlos';
  const testUser1Id = uuidv4();
  const testUser1Email = `robert-${uuidv4()}@example.com`;
  const testUser2Id = uuidv4();
  const testUser2Email = `jennifer-${uuidv4()}@example.com`;

  const noopProfileGate = () => {};
  
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    // Save original fetch
    originalFetch = global.fetch;
  });

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('SCENARIO 1: User WITH profile - uses first_name "Bob" instead of parsed "Robert"', async () => {
    // Mock fetch to return the user profile with preferred first_name "Bob"
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/api/userProfile?userId=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            items: [{  // Changed from "data" to "items" to match Call.tsx expectation
              _id: 'profile-123',
              first_name: 'Bob',
              email: testUser1Email,
              userId: testUser1Id,
            }],
            total: 1,
            hasMore: false,
          }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    const session = {
      user: {
        id: testUser1Id,
        name: 'Robert Smith', // Full name in User record
        email: testUser1Email,
      },
    };

    render(
      <DesktopModeProvider>
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <Call
              username=""
              roomUrl="https://daily.test/room1"
              onLeave={() => {}}
              onProfileGate={noopProfileGate}
              session={session}
              assistantName={assistantName}
            />
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    // Wait for profile fetch
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/userProfile?userId=${encodeURIComponent(testUser1Id)}`)
      );
    }, { timeout: 2000 });

    // Wait for join to be called with profile first_name
    await waitFor(() => {
      expect(mockJoin).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify join was called with profile first_name "Bob" (not "Robert Smith" or "Robert")
    const joinCall = mockJoin.mock.calls[0][0];
    expect(joinCall.userName).toBe('Bob');
    expect(joinCall.userData?.sessionUserName).toBe('Bob');

    // Verify it did NOT use the parsed User.name
    expect(joinCall.userName).not.toBe('Robert Smith');
    expect(joinCall.userName).not.toBe('Robert'); // not parsed first token
  });

  test('SCENARIO 2: User WITHOUT profile - falls back to User.name "Jennifer Anderson"', async () => {
    // Mock fetch to return empty profile (no profile exists)
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/api/userProfile?userId=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            items: [], // Changed from "data" to "items" to match Call.tsx expectation
            total: 0,
            hasMore: false,
          }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    const session = {
      user: {
        id: testUser2Id,
        name: 'Jennifer Anderson', // Full name in User record
        email: testUser2Email,
      },
    };

    render(
      <DesktopModeProvider>
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <Call
              username=""
              roomUrl="https://daily.test/room2"
              onLeave={() => {}}
              onProfileGate={noopProfileGate}
              session={session}
              assistantName={assistantName}
            />
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    // Wait for profile fetch (will return empty)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/userProfile?userId=${encodeURIComponent(testUser2Id)}`)
      );
    }, { timeout: 2000 });

    // Wait for join to be called
    await waitFor(() => {
      expect(mockJoin).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify join was called with session.user.name (fallback behavior)
    const joinCall = mockJoin.mock.calls[0][0];
    expect(joinCall.userName).toBe('Jennifer Anderson');
    expect(joinCall.userData?.sessionUserName).toBe('Jennifer Anderson');
  });

  test('SCENARIO 3: User WITH profile but no session - falls back to username prop', async () => {
    // Mock fetch to return empty (no session means no profile fetch)
    render(
      <DesktopModeProvider>
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <Call
              username="alice-default"
              roomUrl="https://daily.test/room3"
              onLeave={() => {}}
              onProfileGate={noopProfileGate}
              session={null}
              assistantName={assistantName}
            />
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    // Wait for join to be called
    await waitFor(() => {
      expect(mockJoin).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify join was called with username prop (no session, no profile)
    const joinCall = mockJoin.mock.calls[0][0];
    expect(joinCall.userName).toBe('alice-default');
    
    // userData.sessionUserName is set from displayName (username prop) even without a session
    // because it represents the user's display name in the call, which can come from the username prop
    expect(joinCall.userData?.sessionUserName).toBe('alice-default');
  });

  test('SCENARIO 4: Profile fetch fails - gracefully falls back to User.name', async () => {
    // Mock fetch to fail
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/api/userProfile?userId=')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ ok: false });
    }) as any;

    const session = {
      user: {
        id: testUser1Id,
        name: 'Robert Smith',
        email: testUser1Email,
      },
    };

    render(
      <DesktopModeProvider>
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <Call
              username=""
              roomUrl="https://daily.test/room4"
              onLeave={() => {}}
              onProfileGate={noopProfileGate}
              session={session}
              assistantName={assistantName}
            />
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    // Wait for join to be called (should proceed despite fetch failure)
    await waitFor(() => {
      expect(mockJoin).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify join was called with session.user.name fallback
    const joinCall = mockJoin.mock.calls[0][0];
    expect(joinCall.userName).toBe('Robert Smith');
    expect(joinCall.userData?.sessionUserName).toBe('Robert Smith');
  });

  test('SCENARIO 5: Profile exists but first_name is empty - falls back to User.name', async () => {
    // Mock fetch to return profile with empty first_name
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/api/userProfile?userId=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            items: [{
              _id: 'profile-456',
              first_name: '   ', // Empty/whitespace only
              email: testUser2Email,
              userId: testUser2Id,
            }],
            total: 1,
            hasMore: false,
          }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    const session = {
      user: {
        id: testUser2Id,
        name: 'Jennifer Anderson',
        email: testUser2Email,
      },
    };

    render(
      <DesktopModeProvider>
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <Call
              username=""
              roomUrl="https://daily.test/room5"
              onLeave={() => {}}
              onProfileGate={noopProfileGate}
              session={session}
              assistantName={assistantName}
            />
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    // Wait for join

    // Wait for join
    await waitFor(() => {
      expect(mockJoin).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify join falls back to session.user.name (empty first_name ignored)
    const joinCall = mockJoin.mock.calls[0][0];
    expect(joinCall.userName).toBe('Jennifer Anderson');
    expect(joinCall.userData?.sessionUserName).toBe('Jennifer Anderson');
  });
});
