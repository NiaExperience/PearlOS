/* @jest-environment jsdom */

import { renderHook, waitFor } from '@testing-library/react';

import { useInterfaceCustomization } from '@interface/hooks/use-interface-customization';
import { INTERFACE_CUSTOMIZATION_STORAGE_KEY } from '@interface/lib/interface-customization';

const updatePearlOSPreferences = jest.fn();

let mockProfile: any;

jest.mock('@interface/contexts/user-profile-context', () => ({
  useUserProfileOptional: () => mockProfile,
}));

describe('useInterfaceCustomization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as any;
    mockProfile = {
      userProfileId: 'profile-blair-niaxp',
      loading: false,
      privateMemory: {
        preferences: {
          pearlOSSettings: {},
        },
      },
      updatePearlOSPreferences,
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets profile defaults instead of copying stale local generated icons into a new account', async () => {
    window.localStorage.setItem(INTERFACE_CUSTOMIZATION_STORAGE_KEY, JSON.stringify({
      theme: 'custom-old-theme',
      backgrounds: {
        home: '/api/pixel-art/image/missing-home.png',
        desktop: '/api/pixel-art/image/missing-desktop.png',
      },
      icons: {
        terminal: '/api/pixel-art/image/missing-terminal.png',
      },
      customThemes: [{
        id: 'custom-old-theme',
        label: 'Old Theme',
        prompt: 'Old Theme',
        backgrounds: {
          home: '/api/pixel-art/image/missing-home.png',
          desktop: '/api/pixel-art/image/missing-desktop.png',
        },
        icons: {
          terminal: '/api/pixel-art/image/missing-terminal.png',
        },
        style: {},
        createdAt: 1,
        updatedAt: 1,
        generated: true,
      }],
      updatedAt: 1,
    }));

    const { result } = renderHook(() => useInterfaceCustomization());

    await waitFor(() => {
      expect(updatePearlOSPreferences).toHaveBeenCalledWith(expect.objectContaining({
        interfaceCustomization: expect.objectContaining({
          theme: 'pixel',
          icons: {},
          customThemes: [],
        }),
      }));
    });

    expect(result.current.theme).toBe('pixel');
    expect(result.current.icons).toEqual({});
    expect(result.current.customThemes).toEqual([]);

    const saved = JSON.parse(window.localStorage.getItem(INTERFACE_CUSTOMIZATION_STORAGE_KEY) || '{}');
    expect(saved.theme).toBe('pixel');
    expect(saved.icons).toEqual({});
    expect(saved.customThemes).toEqual([]);
  });
});
