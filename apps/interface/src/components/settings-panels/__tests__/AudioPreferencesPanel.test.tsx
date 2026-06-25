/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AudioPreferencesPanel } from '../AudioPreferencesPanel';

const mockUpdatePearlOSPreferences = jest.fn();

jest.mock('@interface/hooks/use-resilient-session', () => ({
  useResilientSession: () => ({
    data: {
      user: {
        id: 'user-123',
        email: 'blair@example.com',
      },
    },
    status: 'authenticated',
    hasError: false,
  }),
}));

jest.mock('@interface/contexts/user-profile-context', () => ({
  useUserProfileOptional: () => ({
    loading: false,
    privateMemory: {
      preferences: {
        pearlOSSettings: {
          voiceProvider: 'cartesia',
          musicEnabled: true,
        },
      },
    },
    updatePearlOSPreferences: mockUpdatePearlOSPreferences,
  }),
}));

describe('AudioPreferencesPanel', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => undefined,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: () => undefined,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    });
  });

  beforeEach(() => {
    mockUpdatePearlOSPreferences.mockClear();
    window.localStorage.clear();
  });

  it('offers only Cartesia and PocketTTS as voice providers', async () => {
    const user = userEvent.setup();
    render(<AudioPreferencesPanel />);

    await user.click(screen.getByRole('combobox', { name: 'Voice' }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Cartesia' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'PocketTTS' })).toBeInTheDocument();
    });

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Cartesia',
      'PocketTTS',
    ]);
  });

  it('persists PocketTTS selection using the profile preference key', async () => {
    const user = userEvent.setup();
    render(<AudioPreferencesPanel />);

    await user.click(screen.getByRole('combobox', { name: 'Voice' }));
    await user.click(await screen.findByRole('option', { name: 'PocketTTS' }));

    expect(window.localStorage.getItem('pearlos-voice-provider:user-123')).toBe('pockettts');
    expect(mockUpdatePearlOSPreferences).toHaveBeenCalledWith({ voiceProvider: 'pockettts' });
  });

  it('persists audio startup off to scoped local storage and profile preferences', async () => {
    const user = userEvent.setup();
    const soundtrackControl = jest.fn();
    window.addEventListener('soundtrackControl', soundtrackControl);

    render(<AudioPreferencesPanel />);

    await user.click(screen.getByRole('switch'));

    expect(window.localStorage.getItem('pearlos-music-enabled:user-123')).toBe('false');
    expect(mockUpdatePearlOSPreferences).toHaveBeenCalledWith({ musicEnabled: false });
    expect(soundtrackControl).toHaveBeenCalledWith(expect.objectContaining({
      detail: { action: 'stop', source: 'settings', persistPreference: true },
    }));

    window.removeEventListener('soundtrackControl', soundtrackControl);
  });
});
