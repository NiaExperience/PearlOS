/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { VoiceSessionProvider } from '@interface/contexts/voice-session-context';

// Under test
import ClientManager from '../components/ClientManager';

// Mock heavy/irrelevant child components to keep test fast and focused
jest.mock('@interface/components/assistant-canvas', () => {
  const AssistantWrapperMock = () => null;
  AssistantWrapperMock.displayName = 'AssistantWrapperMock';
  return { __esModule: true, default: AssistantWrapperMock };
});

jest.mock('@interface/components/browser-window', () => {
  const BrowserWindowMock = () => null;
  BrowserWindowMock.displayName = 'BrowserWindowMock';
  return { __esModule: true, default: BrowserWindowMock };
});

jest.mock('@interface/components/profile-dropdown', () => {
  const ProfileDropdown = () => null;
  ProfileDropdown.displayName = 'ProfileDropdownMock';
  return { __esModule: true, ProfileDropdown };
});
jest.mock('../state/store', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DailyCallStateProvider: ({ children }: { children: any }) => children,
  useDailyCallState: () => ({ roomUrl: null }),
}));

// Note: We intentionally do NOT mock DesktopBackgroundSwitcher or InitializeDesktopMode
// because we want to exercise their real behavior (initialMode seeding + event dispatch).

describe('ClientManager desktop mode initialization', () => {
  const baseProps = {
    assistantName: 'test-assistant',
    tenantId: 'tenant-1',
    isAdmin: false,
    roomUrl: '',
    seatrade: false,
    assistantFirstName: 'Testy',
    assistantFirstMessage: 'Hello world',
    themeData: {},
    voiceId: 'voice-1',
    // botPersonalityId: 'bot-personality-1',
    osPersonalityId: 'os-personality-1',
    persona: 'pearl',
    supportedFeatures: [] as string[],
    startFullScreen: false
  };

  test('seeds WORK mode when initialDesktopMode is "work"', async () => {
    render(
      <DesktopModeProvider>
        <VoiceSessionProvider>
          <ClientManager {...baseProps} initialDesktopMode="work" />
        </VoiceSessionProvider>
      </DesktopModeProvider>
    );

    const home = await screen.findByTestId('home-bg-container');
    const work = await screen.findByTestId('work-bg-container');

    // When WORK is active, work container should be at translate-x-0 and home pushed left
    // HOME is positioned at -translate-x-[200%] to avoid showing during direct transitions
    expect(work.className).toContain('translate-x-0');
    expect(home.className).toContain('-translate-x-[200%]');
  });

  test('seeds HOME mode when initialDesktopMode is "home"', async () => {
    render(
      <DesktopModeProvider>
        <VoiceSessionProvider>
          <ClientManager {...baseProps} initialDesktopMode="home" />
        </VoiceSessionProvider>
      </DesktopModeProvider>
    );

    const home = await screen.findByTestId('home-bg-container');
    const work = await screen.findByTestId('work-bg-container');

    // When HOME is active, home container should be at translate-x-0 and work pushed right
    expect(home.className).toContain('translate-x-0');
    expect(work.className).toContain('translate-x-full');
  });
});
