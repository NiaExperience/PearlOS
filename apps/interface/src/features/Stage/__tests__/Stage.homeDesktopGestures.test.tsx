/**
 * @jest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { UIProvider } from '@interface/contexts/ui-context';
import { DesktopMode } from '@interface/types/desktop-modes';

import Stage from '../Stage';

jest.mock('@interface/lib/client-logger', () => ({
  getClientLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('../ExperienceRenderer', () => ({
  __esModule: true,
  default: function MockExperienceRenderer() {
    return null;
  },
}));

jest.mock('../WonderCanvas/WonderCanvasRenderer', () => ({
  __esModule: true,
  default: function MockWonderCanvasRenderer() {
    return null;
  },
}));

jest.mock('../WonderCanvas/CanvasTaskProgress', () => ({
  __esModule: true,
  default: function MockCanvasTaskProgress() {
    return null;
  },
}));

function renderStage() {
  return render(
    <UIProvider>
      <DesktopModeProvider initialMode={DesktopMode.HOME}>
        <Stage />
      </DesktopModeProvider>
    </UIProvider>
  );
}

describe('Stage home gestures', () => {
  it('switches from Home to Desktop on a clean double click', async () => {
    const listener = jest.fn();
    window.addEventListener('desktopModeSwitch', listener as EventListener);
    renderStage();

    const stage = await screen.findByTestId('pearl-stage');
    fireEvent.doubleClick(stage);

    await waitFor(() => {
      expect(stage).toHaveAttribute('data-desktop-mode', DesktopMode.DESKTOP);
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          action: 'SWITCH_DESKTOP_MODE',
          payload: expect.objectContaining({
            targetMode: DesktopMode.DESKTOP,
            switchReason: 'home_double_click_icons',
          }),
        }),
      })
    );
    window.removeEventListener('desktopModeSwitch', listener as EventListener);
  });
});
