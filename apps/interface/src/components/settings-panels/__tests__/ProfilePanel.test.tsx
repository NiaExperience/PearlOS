/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProfilePanel } from '../ProfilePanel';
import { useUserProfileMetadata } from '../useUserProfileMetadata';

jest.mock('@interface/hooks/use-resilient-session', () => ({
  useResilientSession: () => ({
    data: {
      user: {
        id: 'user-123',
        name: 'Blair Erickson',
        email: 'blair@example.com',
      },
    },
    status: 'authenticated',
  }),
}));

jest.mock('../useUserProfileMetadata', () => ({
  useUserProfileMetadata: jest.fn(),
}));

const mockUseUserProfileMetadata = useUserProfileMetadata as jest.MockedFunction<typeof useUserProfileMetadata>;

const basePrivateMemory = {
  personalNotes: 'memory_search query=raw private note\n[telegram] 2026-06-11T20:00:00Z platform tag',
  preferences: {
    pearlOSSettings: {
      theme: 'midnight',
    },
  },
  sensitiveData: {
    privateProfileText: 'Only Pearl should know this.',
    oauthToken: 'secret-token',
  },
};

function renderProfilePanel() {
  return render(<ProfilePanel buildName="PearlOS GOLDEN HORIZON v2" commitSha="test-build" />);
}

describe('ProfilePanel', () => {
  const fetchMock = jest.fn();
  const refreshMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    refreshMock.mockResolvedValue(undefined);
    global.fetch = fetchMock as unknown as typeof fetch;
    mockUseUserProfileMetadata.mockReturnValue({
      preferences: basePrivateMemory.preferences,
      publicPersona: {
        bio: 'Builder of practical software.',
        isPublic: true,
      },
      privateMemory: basePrivateMemory,
      userProfileId: 'profile-123',
      loading: false,
      error: null,
      refresh: refreshMock,
      onboardingComplete: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps account identity in the profile header instead of under public/private copy', () => {
    renderProfilePanel();

    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Blair Erickson')).toBeInTheDocument();
    expect(screen.getByText('blair@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(
      screen.queryByText('Public data is for your social Pearl profile. Private data stays with you.'),
    ).not.toBeInTheDocument();
  });

  it('uses one public/private segmented control and removes the redundant visibility switch', async () => {
    const user = userEvent.setup();
    renderProfilePanel();

    expect(screen.getByRole('tab', { name: 'Public', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Private', selected: false })).toBeInTheDocument();
    expect(screen.queryByText(/show this text on your social pearl profile/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Private' }));

    expect(screen.getByRole('tab', { name: 'Private', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Private profile')).toHaveValue('Only Pearl should know this.');
  });

  it('does not render raw private memory notes, timestamps, platform tags, or arbitrary sensitive fields', async () => {
    const user = userEvent.setup();
    renderProfilePanel();

    await user.click(screen.getByRole('tab', { name: 'Private' }));

    expect(screen.getByLabelText('Private profile')).toHaveValue('Only Pearl should know this.');
    expect(screen.queryByText(/memory_search/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-06-11T20:00:00Z/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[telegram\]/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret-token/i)).not.toBeInTheDocument();
  });

  it('saves only the edited profile text while preserving unrelated private memory keys', async () => {
    const user = userEvent.setup();
    renderProfilePanel();

    await user.clear(screen.getByLabelText('Public profile'));
    await user.type(screen.getByLabelText('Public profile'), 'Updated public bio');
    await user.click(screen.getByRole('tab', { name: 'Private' }));
    await user.clear(screen.getByLabelText('Private profile'));
    await user.type(screen.getByLabelText('Private profile'), 'Updated private profile');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/userProfile', expect.any(Object)));
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body));

    expect(body).toMatchObject({
      id: 'profile-123',
      publicPersona: {
        bio: 'Updated public bio',
        isPublic: true,
      },
      privateMemory: {
        personalNotes: basePrivateMemory.personalNotes,
        preferences: basePrivateMemory.preferences,
        sensitiveData: {
          oauthToken: 'secret-token',
          privateProfileText: 'Updated private profile',
        },
      },
    });
    expect(refreshMock).toHaveBeenCalled();
  });
});
