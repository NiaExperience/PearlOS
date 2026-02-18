/** @jest-environment jsdom */
import { DEFAULT_GLOBAL_SETTINGS, GlobalSettings } from '@nia/features';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { GlobalSettingsProvider } from '@interface/providers/global-settings-provider';

import LoginForm from '../login-form';

const mockRouter = {
  back: jest.fn(),
  forward: jest.fn(),
  prefetch: jest.fn(),
  push: jest.fn(),
  refresh: jest.fn(),
  replace: jest.fn(),
};

const mockSearchParams = {
  get: jest.fn<string | null, [string]>(() => null),
};

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockRouter),
  useSearchParams: jest.fn(() => mockSearchParams),
}));

jest.mock('next-auth/react', () => ({
  signIn: jest.fn(),
  useSession: jest.fn(() => ({ data: null, status: 'unauthenticated' })),
}));

const originalFetch = global.fetch;

describe('LoginForm global settings integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.get.mockReturnValue(null);
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ allowAnonymousLogin: true }),
      })
    ) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  const renderWithSettings = (settings: Partial<GlobalSettings>) => {
    render(
      <GlobalSettingsProvider value={{ ...DEFAULT_GLOBAL_SETTINGS, ...settings }}>
        <LoginForm />
      </GlobalSettingsProvider>
    );
  };

  it('hides Google button when googleAuth is false', () => {
    renderWithSettings({ interfaceLogin: { googleAuth: false, guestLogin: true, passwordLogin: true } });

    expect(screen.queryByText(/Google/i)).not.toBeInTheDocument();
  });

  it('hides password form when passwordLogin is false', () => {
    renderWithSettings({ interfaceLogin: { googleAuth: true, guestLogin: true, passwordLogin: false } });

    expect(screen.queryByLabelText(/Email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/i)).not.toBeInTheDocument();
  });

  it('shows disabled notice when all options are off', () => {
    renderWithSettings({ interfaceLogin: { googleAuth: false, guestLogin: false, passwordLogin: false } });

    expect(screen.getByText(/Login methods are currently disabled/i)).toBeInTheDocument();
  });

  it('hides Google button when assistant supportedFeatures excludes googleAuth', async () => {
    mockSearchParams.get.mockImplementation((key: string) => {
      if (key === 'callbackUrl') {
        return '/assistant/test-assistant';
      }
      return null;
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        supportedFeatures: ['guestLogin', 'passwordLogin'],
      }),
    });

    renderWithSettings({ interfaceLogin: { googleAuth: true, guestLogin: true, passwordLogin: true } });

    await waitFor(() => {
      expect(screen.queryByText(/Google/i)).not.toBeInTheDocument();
    });
  });
});
