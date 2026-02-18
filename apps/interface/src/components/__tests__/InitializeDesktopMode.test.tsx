/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { DesktopMode, DesktopModeSwitchResponse } from '../../types/desktop-modes';
import InitializeDesktopMode from '../InitializeDesktopMode';
import DesktopBackgroundSwitcher from '../desktop-background-switcher';
import { DesktopModeProvider } from '../../contexts/desktop-mode-context';
import { DailyCallStateProvider } from '../../features/DailyCall/state/store';
import { VoiceSessionProvider } from '../../contexts/voice-session-context';

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

// Helper to capture dispatched events
function listenOnce<T>(eventName: string): Promise<CustomEvent<T>> {
  return new Promise(resolve => {
    const handler = (evt: Event) => {
      window.removeEventListener(eventName, handler as EventListener);
      resolve(evt as CustomEvent<T>);
    };
    window.addEventListener(eventName, handler as EventListener);
  });
}

describe('InitializeDesktopMode', () => {
  test('dispatches desktopModeSwitch with provided mode', async () => {
    const wait = listenOnce<DesktopModeSwitchResponse>('desktopModeSwitch');
    render(<InitializeDesktopMode mode={DesktopMode.WORK} />);
    const evt = await wait;
    expect(evt.detail).toBeTruthy();
    expect(evt.detail.mode).toBe(DesktopMode.WORK);
    expect(evt.detail.payload?.targetMode).toBe(DesktopMode.WORK);
    expect(evt.detail.action).toBe('SWITCH_DESKTOP_MODE');
    expect(evt.detail.success).toBe(true);
  });

  test('falls back to HOME when mode is undefined/null/empty', async () => {
    const wait = listenOnce<DesktopModeSwitchResponse>('desktopModeSwitch');
    render(<InitializeDesktopMode mode={undefined} />);
    const evt = await wait;
    expect(evt.detail.mode).toBe(DesktopMode.HOME);
    expect(evt.detail.payload?.targetMode).toBe(DesktopMode.HOME);
  });

  test('re-dispatches when mode prop changes', async () => {
    const first = listenOnce<DesktopModeSwitchResponse>('desktopModeSwitch');
    const { rerender } = render(<InitializeDesktopMode mode={DesktopMode.HOME} />);
    await first; // initial event

    const second = listenOnce<DesktopModeSwitchResponse>('desktopModeSwitch');
    rerender(<InitializeDesktopMode mode={DesktopMode.CREATIVE} />);
    const evt2 = await second;
    expect(evt2.detail.mode).toBe(DesktopMode.CREATIVE);
    expect(evt2.detail.payload?.targetMode).toBe(DesktopMode.CREATIVE);
  });

  test('integration: switches DesktopBackgroundSwitcher to WORK on init', async () => {
    // Render the switcher first to attach listeners, defaulting to HOME
    render(
      <DesktopModeProvider>
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <div>
              <DesktopBackgroundSwitcher supportedFeatures={[]} />
              <InitializeDesktopMode mode={DesktopMode.WORK} />
            </div>
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    const work = await screen.findByTestId('work-bg-container');
    const home = await screen.findByTestId('home-bg-container');

    await waitFor(() => {
      // Work container should be active (translate-x-0)
      expect(work.className).toMatch(/translate-x-0/);
      // Home container should slide out to the left (-translate-x-[200%] to avoid showing during direct transitions)
      expect(home.className).toMatch(/-translate-x-\[200%\]/);
    });
  });

  test('integration: falls back to HOME on undefined mode', async () => {
    render(
      <DesktopModeProvider>
        <DailyCallStateProvider>
          <VoiceSessionProvider>
            <div>
              <DesktopBackgroundSwitcher supportedFeatures={[]} initialMode={DesktopMode.WORK} />
              <InitializeDesktopMode mode={undefined} />
            </div>
          </VoiceSessionProvider>
        </DailyCallStateProvider>
      </DesktopModeProvider>
    );

    const work = await screen.findByTestId('work-bg-container');
    const home = await screen.findByTestId('home-bg-container');

    await waitFor(() => {
      // Home should be active
      expect(home.className).toMatch(/translate-x-0/);
      // Work should be off to the right
      expect(work.className).toMatch(/translate-x-full/);
    });
  });
});
