/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { VoiceSessionProvider } from '@interface/contexts/voice-session-context';
import { DailyCallStateProvider } from '@interface/features/DailyCall/state/store';

import { DesktopMode } from '../../types/desktop-modes';
import DesktopBackgroundSwitcher from '../desktop-background-switcher';

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

describe('DesktopBackgroundSwitcher initialMode', () => {
  test('renders Work background as active when initialMode is WORK', () => {
    render(
      <DesktopModeProvider
        initialMode={DesktopMode.WORK}
      >
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <DesktopBackgroundSwitcher
              supportedFeatures={[]}
            />
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    const work = screen.getByTestId('work-bg-container');
    const home = screen.getByTestId('home-bg-container');

    // Active container has translate-x-0; inactive is translated off-screen (may be -translate-x-[200%] for direct transitions)
    expect(work.className).toMatch(/translate-x-0/);
    expect(home.className).toMatch(/-translate-x-\[200%\]/);
  });

  test('renders Home background as active by default when no initialMode provided', () => {
    render(
      <DesktopModeProvider>
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <DesktopBackgroundSwitcher supportedFeatures={[]} />
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    const work = screen.getByTestId('work-bg-container');
    const home = screen.getByTestId('home-bg-container');

    expect(home.className).toMatch(/translate-x-0/);
    // WORK may be at translate-x-full or translate-x-[200%] depending on positioning logic
    expect(work.className).toMatch(/translate-x-(full|\[200%\])/);
  });
});
