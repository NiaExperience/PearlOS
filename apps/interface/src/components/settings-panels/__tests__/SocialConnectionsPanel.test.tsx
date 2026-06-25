/** @jest-environment jsdom */

import type { ReactElement } from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SocialConnectionsPanel } from '@interface/components/settings-panels/SocialConnectionsPanel';
import { DesktopModeProvider } from '@interface/contexts/desktop-mode-context';
import { DesktopMode } from '@interface/types/desktop-modes';

function renderWithDesktopMode(ui: ReactElement) {
  return render(<DesktopModeProvider initialMode={DesktopMode.HOME}>{ui}</DesktopModeProvider>);
}

describe('SocialConnectionsPanel', () => {
  const fetchMock = jest.fn();
  const clipboardWriteText = jest.fn();
  let discordDmLinked = false;
  let googleChatAppUrl: string | null = 'https://chat.google.com/dm/public-pearl-test';

  beforeEach(() => {
    discordDmLinked = false;
    googleChatAppUrl = 'https://chat.google.com/dm/public-pearl-test';
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/discord/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ connected: false, oauthConfigured: true }),
        } as Response;
      }
      if (url === '/api/discord/dm-link' && (!init || init.method === undefined)) {
        return {
          ok: true,
          status: 200,
          json: async () => discordDmLinked
            ? ({ linked: true, discordUserId: '123456789012345678', verifiedAt: new Date().toISOString() })
            : ({ linked: false }),
        } as Response;
      }
      if (url === '/api/discord/dm-link/request') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            code: 'D1S2C3',
            codeSent: false,
            expiresAt: new Date().toISOString(),
          }),
        } as Response;
      }
      if (url === '/api/discord/dm-link/verify') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, linked: true, discordUserId: '123456789012345678' }),
        } as Response;
      }
      if (url === '/api/discord/dm-link' && init?.method === 'DELETE') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, revoked: true }),
        } as Response;
      }
      if (url === '/api/telegram/dm-link' && (!init || init.method === undefined)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ linked: false }),
        } as Response;
      }
      if (url === '/api/telegram/dm-link/request') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            codeSent: false,
            code: 'T3L3GM',
            startToken: 'abc123token',
            deepLinkUrl: 'https://t.me/PearlOS_bot?start=verify_abc123token',
            botUsername: 'PearlOS_bot',
            expiresAt: new Date().toISOString(),
          }),
        } as Response;
      }
      if (url === '/api/telegram/dm-link/claim') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, codeSent: true, expiresAt: new Date().toISOString() }),
        } as Response;
      }
      if (url === '/api/telegram/dm-link/verify') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            linked: true,
            telegramUserId: '987654321',
            telegramUsername: 'pearl_test',
            verifiedAt: new Date().toISOString(),
          }),
        } as Response;
      }
      if (url === '/api/telegram/dm-link' && init?.method === 'DELETE') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, revoked: true }),
        } as Response;
      }
      if (url === '/api/google-chat/dm-link' && (!init || init.method === undefined)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            linked: false,
            pending: false,
            chatAppUrl: googleChatAppUrl,
            chatAppName: 'Public Pearl',
            pearlOsGoogleEmail: 'blair@example.com',
            oauthConfigured: true,
          }),
        } as Response;
      }
      if (url === '/api/google-chat/dm-link/request') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            code: 'GCHAT123',
            expiresAt: new Date().toISOString(),
            pearlOsGoogleEmail: 'blair@example.com',
            chatAppUrl: googleChatAppUrl,
            chatAppName: 'Public Pearl',
          }),
        } as Response;
      }
      if (url === '/api/google-chat/dm-link' && init?.method === 'DELETE') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, revoked: true }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('renders social platforms and coming soon section', () => {
    renderWithDesktopMode(<SocialConnectionsPanel />);

    expect(screen.getByText('Connections')).toBeInTheDocument();
    expect(screen.getByText('You can chat w Pearl in places you already use!')).toBeInTheDocument();
    expect(screen.queryByText('Bring Pearl to You.')).not.toBeInTheDocument();
    expect(screen.queryByText('Discord / Telegram.')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /discord/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /telegram/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /google chat/i })).toBeInTheDocument();
  });

  it('generates a Discord code message flow', async () => {
    const user = userEvent.setup();
    renderWithDesktopMode(<SocialConnectionsPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: /get discord code/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /get discord code/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/discord/dm-link/request',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByText('D1S2C3')).toBeInTheDocument();
    expect(screen.getByText(/send this exact code to pearl in a discord dm/i)).toBeInTheDocument();
  });

  it('refreshes after a Discord code is sent and shows linked state', async () => {
    const user = userEvent.setup();
    renderWithDesktopMode(<SocialConnectionsPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: /get discord code/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /get discord code/i }));
    discordDmLinked = true;
    await user.click(screen.getByRole('button', { name: /i sent it/i }));

    await waitFor(() => {
      expect(screen.getByText('Linked for Discord user 123456789012345678')).toBeInTheDocument();
    });
  });

  it('generates a Telegram code message flow', async () => {
    const user = userEvent.setup();
    renderWithDesktopMode(<SocialConnectionsPanel />);

    await user.click(screen.getByRole('tab', { name: /telegram/i }));
    await user.click(screen.getByRole('button', { name: /get telegram code/i }));
    expect(screen.getByText('T3L3GM')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open telegram/i })).toBeInTheDocument();
  });

  it('connects Google Chat with the same PearlOS Google account and keeps code fallback', async () => {
    const user = userEvent.setup();
    renderWithDesktopMode(<SocialConnectionsPanel />);

    await user.click(screen.getByRole('tab', { name: /google chat/i }));

    expect(await screen.findByRole('link', { name: /connect google chat/i })).toHaveAttribute(
      'href',
      '/api/google-chat/oauth/start?returnTo=/pearlos/settings',
    );
    expect(screen.getByText(/uses your pearlos google account: blair@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/private questions and task results stay in your 1:1 chat/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /use a code instead/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/google-chat/dm-link/request',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByText('GCHAT123')).toBeInTheDocument();
    expect(screen.getByText('Send this exact message to Public Pearl in a 1:1 Google Chat DM: link GCHAT123.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open pearl in google chat/i })).toHaveAttribute(
      'href',
      'https://chat.google.com/dm/public-pearl-test?text=link%20GCHAT123',
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /copy command/i })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: /copy command/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument());
  });

  it('warns when the Google Chat manual fallback has no app link', async () => {
    googleChatAppUrl = null;
    const user = userEvent.setup();
    renderWithDesktopMode(<SocialConnectionsPanel />);

    await user.click(screen.getByRole('tab', { name: /google chat/i }));
    await user.click(await screen.findByRole('button', { name: /use a code instead/i }));

    expect(screen.getByText('GCHAT123')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open pearl in google chat/i })).not.toBeInTheDocument();
    expect(screen.getByText(/missing the Google Chat app link/i)).toBeInTheDocument();
  });
});
