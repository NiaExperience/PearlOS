/* @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */

jest.resetModules();

let mockBotAutoJoin = false;

jest.mock('../lib/config', () => {
  const actual = jest.requireActual('../lib/config');
  return {
    ...actual,
    get BOT_AUTO_JOIN() {
      return mockBotAutoJoin;
    },
  };
});

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@interface/hooks/use-resilient-session', () => ({
  useResilientSession: () => ({
    data: { user: { id: 'user-123', name: 'Test User', email: 'test@example.com' } },
    status: 'authenticated',
    hasError: false,
  }),
}));

jest.mock('@daily-co/daily-react', () => ({
  DailyProvider: (props: any) => props.children,
  useDaily: () => ({
    leave: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    participants: () => ({ local: { session_id: 'local', tracks: {} } }),
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

jest.mock('../lib/requireUserProfileGate', () => {
  const actual = jest.requireActual('../lib/requireUserProfileGate');
  return {
    ...actual,
    shouldGateDailyCall: jest.fn(),
  };
});

jest.mock('../events/publisher', () => ({
  emitLocalJoin: jest.fn(() => ({ username: 'alice', roomUrl: 'room', ts: 1 })),
  emitLocalLeave: jest.fn(() => ({ username: 'alice', roomUrl: 'room', ts: 2 })),
  emitCallStateChange: jest.fn(),
  emitCallError: jest.fn(),
  emitParticipantJoin: jest.fn(),
  emitParticipantLeave: jest.fn(),
  emitParticipantUpdate: jest.fn(),
}));

import DailyCallView from '../components/DailyCallView';
import { emitLocalJoin, emitLocalLeave } from '../events/publisher';
import { shouldGateDailyCall } from '../lib/requireUserProfileGate';

const mockGetUserMedia = jest.fn();
const originalMediaDevices = navigator.mediaDevices;

beforeAll(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      ...(originalMediaDevices ?? {}),
      getUserMedia: mockGetUserMedia,
    },
  });
});

afterAll(() => {
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
  } else {
    delete (navigator as any).mediaDevices;
  }
});

describe('DailyCallView profile gating', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  beforeEach(() => {
    mockGetUserMedia.mockReset();
    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [
        {
          stop: jest.fn(),
        },
      ],
    });
    mockBotAutoJoin = false;
  });

  test('shows profile gate modal instructing manual assistant launch and closes the call', async () => {
    (shouldGateDailyCall as jest.Mock).mockResolvedValue({
      shouldGate: true,
      reason: 'missing-first-name',
    });

    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
    const handleLeave = jest.fn();

    render(
      <DailyCallView
        roomUrl="room"
        isAdmin={false}
        assistantName="pearlos"
        supportedFeatures={['requireUserProfile', 'dailyCall']}
        personalityId="some-id"
        persona="Pearl"
        tenantId="tenant"
        onLeave={handleLeave}
        updateDailyProviderState={() => {}}
      />
    );

    const input = await screen.findByPlaceholderText('Enter your display name');
    fireEvent.change(input, { target: { value: 'Test Person' } });

    const joinBtn = screen.getByText('Join Meeting');
    fireEvent.click(joinBtn);

    await waitFor(() => expect(shouldGateDailyCall).toHaveBeenCalled());
    const gateArgs = (shouldGateDailyCall as jest.Mock).mock.calls[0][0];
    expect(gateArgs.supportedFeatures).toEqual(['requireUserProfile', 'dailyCall']);

    expect(emitLocalJoin).not.toHaveBeenCalled();

    const modalHeading = await screen.findByText('Add your preferred name');
    expect(modalHeading).toBeInTheDocument();
    expect(
      screen.getByText(
        /Launch the assistant manually and share the name you’d like us to use/i
      )
    ).toBeInTheDocument();
    const assistantEventsBeforeConfirm = dispatchSpy.mock.calls.filter(
      ([evt]) => evt instanceof Event && evt.type === 'assistant:force-start'
    );
    expect(assistantEventsBeforeConfirm).toHaveLength(0);

    const confirmButton = screen.getByTestId('profile-gate-confirm');
    expect(confirmButton).toHaveTextContent('Close Social');
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockGetUserMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(handleLeave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(emitLocalLeave).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const assistantEventsAfterConfirm = dispatchSpy.mock.calls.filter(
        ([evt]) => evt instanceof Event && evt.type === 'assistant:force-start'
      );
      expect(assistantEventsAfterConfirm).toHaveLength(0);
    });
    expect(screen.queryByText('Add your preferred name')).not.toBeInTheDocument();

    dispatchSpy.mockRestore();
  });

  test('shows fallback destructive message and still requires manual assistant launch', async () => {
    (shouldGateDailyCall as jest.Mock).mockResolvedValue({
      shouldGate: true,
      reason: 'fetch-error',
    });

    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
    const handleLeave = jest.fn();

    render(
      <DailyCallView
        roomUrl="room"
        isAdmin={false}
        assistantName="pearlos"
        supportedFeatures={['requireUserProfile', 'dailyCall']}
        personalityId="some-id"
        persona="Pearl"
        tenantId="tenant"
        onLeave={handleLeave}
        updateDailyProviderState={() => {}}
      />
    );

    const input = await screen.findByPlaceholderText('Enter your display name');
    fireEvent.change(input, { target: { value: 'Test Person' } });

    fireEvent.click(screen.getByText('Join Meeting'));

    await screen.findByText('We had trouble checking your profile');
    expect(
      screen.getByText(/Launch the assistant manually to confirm your info/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('profile-gate-confirm'));

    await waitFor(() => {
      expect(handleLeave).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => expect(emitLocalLeave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetUserMedia).toHaveBeenCalledTimes(1));

    const assistantEvents = dispatchSpy.mock.calls.filter(
      ([evt]) => evt instanceof Event && evt.type === 'assistant:force-start'
    );
    expect(assistantEvents).toHaveLength(0);
    expect(
      screen.queryByText('We had trouble checking your profile')
    ).not.toBeInTheDocument();

    dispatchSpy.mockRestore();
  });

  test('auto-join profile gate runs before admin stealth modal when gating required', async () => {
    mockBotAutoJoin = true;
    (shouldGateDailyCall as jest.Mock).mockResolvedValue({
      shouldGate: true,
      reason: 'missing-profile',
    });

    render(
      <DailyCallView
        roomUrl="room"
        isAdmin={true}
        assistantName="pearlos"
        supportedFeatures={['requireUserProfile', 'dailyCall']}
        personalityId="some-id"
        persona="Pearl"
        tenantId="tenant"
        onLeave={jest.fn()}
        updateDailyProviderState={() => {}}
      />
    );

    await waitFor(() => expect(shouldGateDailyCall).toHaveBeenCalled());

    expect(await screen.findByText('Finish setting up your profile')).toBeInTheDocument();
    expect(screen.queryByText('Join in Stealth Mode')).not.toBeInTheDocument();
  });

  test('auto-join shows stealth modal when profile gate passes', async () => {
    mockBotAutoJoin = true;
    (shouldGateDailyCall as jest.Mock).mockResolvedValue({
      shouldGate: false,
      reason: null,
    });

    render(
      <DailyCallView
        roomUrl="room"
        isAdmin={true}
        assistantName="pearlos"
        supportedFeatures={['requireUserProfile', 'dailyCall']}
        personalityId="some-id"
        persona="Pearl"
        tenantId="tenant"
        onLeave={jest.fn()}
        updateDailyProviderState={() => {}}
      />
    );

    await waitFor(() => expect(shouldGateDailyCall).toHaveBeenCalled());

    expect(await screen.findByText('Join in Stealth Mode')).toBeInTheDocument();
    expect(screen.queryByText('Finish setting up your profile')).not.toBeInTheDocument();
  });
});
