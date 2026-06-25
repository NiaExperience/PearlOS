/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TerminalView from '../components/TerminalView';

jest.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture: jest.fn() }),
}));

type MockBody = Record<string, unknown>;

function response(body: MockBody, options: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function bodyFrom(init?: RequestInit): MockBody {
  return init?.body ? JSON.parse(String(init.body)) : {};
}

function postBodies(fetchMock: jest.Mock) {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).includes('/api/terminal/sessions') && call[1]?.method === 'POST')
    .map((call) => bodyFrom(call[1]));
}

function expectNoLegacyExecuteCalls(fetchMock: jest.Mock) {
  expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/terminal/execute'))).toBe(false);
}

function installFetchMock({
  entitlements = {
    isBlair: false,
    canUseForkWorkspaces: false,
    canUseStagingSourceEdits: false,
    stagingSourceEditsEnabled: false,
    stagingSourceToggleAvailable: false,
    operatorStagingSourceAvailable: false,
  },
  sessions = [],
}: {
  entitlements?: MockBody;
  sessions?: Array<{ id: string; name: string; created: string; attached: boolean }>;
} = {}) {
  const fetchMock = jest.fn((url: unknown, init?: RequestInit) => {
    const target = String(url);
    const body = bodyFrom(init);

    if (target.includes('/api/workspace-entitlements')) {
      return Promise.resolve(response(entitlements));
    }

    if (target.includes('/api/terminal/sessions') && init?.method === 'POST') {
      if (body.action === 'send') {
        const input = String(body.input || '');
        const output = input === 'pearl-codex-sandbox'
          ? 'deploy@pearl:~$ pearl-codex-sandbox\nCodex ready'
          : input === 'codex'
            ? 'root@staging:/workspace/nia-universal# codex\nHost Codex ready'
          : input === 'pearl-openclaw-sandbox'
            ? 'deploy@pearl:~$ pearl-openclaw-sandbox\nPearl OpenClaw TUI'
            : input === 'openclaw tui'
              ? 'root@staging:/workspace/nia-universal# openclaw tui\nHost OpenClaw ready'
            : input === 'pearl-claude-sandbox'
              ? 'deploy@pearl:~$ pearl-claude-sandbox\nClaude ready'
              : input === 'claude'
                ? 'root@staging:/workspace/nia-universal# claude\nHost Claude ready'
            : `deploy@pearl:~$ ${input}\nhello`;
        return Promise.resolve(response({ id: body.id, output }));
      }
      if (body.action === 'raw') {
        const sent = String(body.data || '');
        return Promise.resolve(response({
          id: body.id,
          output: sent.includes('echo hello') ? 'deploy@pearl:~$ echo hello\nhello' : 'deploy@pearl:~$',
        }));
      }
      return Promise.resolve(response({ id: body.id, output: 'deploy@pearl:~$' }));
    }

    if (target.includes('/api/terminal/sessions?id=')) {
      return Promise.resolve(response({ id: 'codex-existing', output: 'deploy@pearl:~$ pearl-codex-sandbox\nCodex ready' }));
    }

    if (target.includes('/api/terminal/sessions')) {
      return Promise.resolve(response({ sessions }));
    }

    return Promise.resolve(response({}));
  });

  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('TerminalView Mobile CLI', () => {
  beforeEach(() => {
    installFetchMock();
  });

  it('opens on the Mobile CLI launcher instead of the legacy welcome or shell', async () => {
    render(<TerminalView />);

    expect(await screen.findByRole('button', { name: /Pearl/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Codex/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Claude/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^CLI/i })).toBeInTheDocument();
    expect(screen.queryByText('Mobile CLI')).not.toBeInTheDocument();
    expect(screen.queryByText('PearlOS')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Mobile CLI input/i })).not.toBeInTheDocument();
  });

  it('starts a Codex session in the sandbox workspace', async () => {
    const fetchMock = installFetchMock();
    render(<TerminalView />);

    fireEvent.click(await screen.findByRole('button', { name: /Codex/i }));

    expect(await screen.findByText(/Codex ready/)).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: /Mobile CLI input/i });
    expect(input).toBeInTheDocument();
    expect(screen.queryByTitle('Tab')).not.toBeInTheDocument();
    fireEvent.focus(input);
    expect(screen.getByTitle('Tab')).toBeInTheDocument();
    expect(screen.getByTitle('Esc')).toBeInTheDocument();
    expect(screen.getByTitle('Ctrl+C')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/terminal/sessions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"input":"pearl-codex-sandbox"'),
      }),
    );
    expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'send', input: 'pearl-codex-sandbox', launcher: 'codex', workspaceMode: 'sandbox' }),
    ]));
    expectNoLegacyExecuteCalls(fetchMock);
  });

  it('starts Pearl through the OpenClaw TUI in the sandbox workspace', async () => {
    const fetchMock = installFetchMock();
    render(<TerminalView />);

    fireEvent.click(await screen.findByRole('button', { name: /Pearl/i }));

    expect(await screen.findByText(/Pearl OpenClaw TUI/)).toBeInTheDocument();
    expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'send', input: 'pearl-openclaw-sandbox', launcher: 'pearl', workspaceMode: 'sandbox' }),
    ]));
  });

  it('starts Claude through the sandbox wrapper', async () => {
    const fetchMock = installFetchMock();
    render(<TerminalView />);

    fireEvent.click(await screen.findByRole('button', { name: /Claude/i }));

    expect(await screen.findByText(/Claude ready/)).toBeInTheDocument();
    expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'send', input: 'pearl-claude-sandbox', launcher: 'claude', workspaceMode: 'sandbox' }),
    ]));
    expectNoLegacyExecuteCalls(fetchMock);
  });

  it('does not offer staging source as a user-selectable workspace', async () => {
    installFetchMock({
      entitlements: {
        isBlair: true,
        canUseForkWorkspaces: true,
        canUseStagingSourceEdits: false,
        stagingSourceEditsEnabled: false,
        stagingSourceToggleAvailable: false,
        operatorStagingSourceAvailable: false,
      },
    });
    render(<TerminalView />);

    expect(await screen.findByLabelText('Workspace mode')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Staging source/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Real CLI Bridge/i })).not.toBeInTheDocument();
  });

  it('keeps fork launch bodies in github_fork mode without staging source', async () => {
    const fetchMock = installFetchMock({
      entitlements: {
        isBlair: false,
        canUseForkWorkspaces: true,
        canUseStagingSourceEdits: false,
        stagingSourceEditsEnabled: false,
        stagingSourceToggleAvailable: false,
        operatorStagingSourceAvailable: false,
      },
    });
    render(<TerminalView />);

    fireEvent.change(await screen.findByLabelText('Workspace mode'), { target: { value: 'github_fork' } });
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/fork.git'), {
      target: { value: 'https://github.com/example/fork.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Codex/i }));

    await screen.findByText(/Codex ready/);
    const bodies = postBodies(fetchMock);
    expect(bodies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'create',
        workspaceMode: 'github_fork',
        githubForkUrl: 'https://github.com/example/fork.git',
      }),
      expect.objectContaining({
        action: 'send',
        input: 'pearl-codex-sandbox',
        launcher: 'codex',
        workspaceMode: 'github_fork',
        githubForkUrl: 'https://github.com/example/fork.git',
      }),
    ]));
    expect(bodies).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceMode: 'staging_source' }),
    ]));
  });

  it('keeps Blair-only staging operator sessions in operator mode after launch', async () => {
    const fetchMock = installFetchMock({
      entitlements: {
        isBlair: true,
        canUseForkWorkspaces: true,
        canUseStagingSourceEdits: true,
        stagingSourceEditsEnabled: false,
        stagingSourceToggleAvailable: false,
        operatorStagingSourceAvailable: true,
      },
    });
    render(<TerminalView />);

    expect(screen.queryByRole('button', { name: /Host Codex/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('switch', { name: /STAGING ONLY direct operator CLI/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Host Codex/i }));

    expect(await screen.findByText(/Host Codex ready/)).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: /Mobile CLI input/i });
    fireEvent.change(input, { target: { value: 'pwd' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'create', workspaceMode: 'operator_staging_source' }),
        expect.objectContaining({ action: 'send', input: 'codex', launcher: 'codex', workspaceMode: 'operator_staging_source' }),
        expect.objectContaining({ action: 'raw', data: 'pwd', key: 'Enter', workspaceMode: 'operator_staging_source' }),
      ]));
    });
    expect(postBodies(fetchMock)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'raw', data: 'pwd', key: 'Enter', workspaceMode: 'sandbox' }),
    ]));
  });

  it('starts a CLI session and sends typed commands', async () => {
    const fetchMock = installFetchMock();
    render(<TerminalView />);

    fireEvent.click(await screen.findByRole('button', { name: /^CLI/i }));
    const input = await screen.findByRole('textbox', { name: /Mobile CLI input/i });
    fireEvent.change(input, { target: { value: 'echo hello' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText(/hello/)).toBeInTheDocument();
    await waitFor(() => {
      expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: 'raw',
          data: 'echo hello',
          key: 'Enter',
          workspaceMode: 'sandbox',
        }),
      ]));
    });
    expectNoLegacyExecuteCalls(fetchMock);
  });

  it('routes focused Mobile CLI controls to tmux raw keys', async () => {
    const fetchMock = installFetchMock();
    render(<TerminalView />);

    fireEvent.click(await screen.findByRole('button', { name: /^CLI/i }));
    const input = await screen.findByRole('textbox', { name: /Mobile CLI input/i });
    fireEvent.focus(input);
    fireEvent.click(screen.getByTitle('Tab'));
    await waitFor(() => {
      expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'raw', key: 'Tab' }),
      ]));
    });

    fireEvent.focus(input);
    fireEvent.click(screen.getByTitle('Esc'));
    await waitFor(() => {
      expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'raw', key: 'Escape' }),
      ]));
    });

    fireEvent.focus(input);
    fireEvent.click(screen.getByTitle('Ctrl+C'));
    await waitFor(() => {
      expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'raw', key: 'C-c' }),
      ]));
    });
  });

  it('routes physical terminal keys to tmux raw input', async () => {
    const fetchMock = installFetchMock();
    render(<TerminalView />);

    fireEvent.click(await screen.findByRole('button', { name: /^CLI/i }));
    const input = await screen.findByRole('textbox', { name: /Mobile CLI input/i });

    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(input, { key: 'ArrowUp', code: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'c', code: 'KeyC', ctrlKey: true });

    await waitFor(() => {
      expect(postBodies(fetchMock)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'raw', data: '1', key: 'Tab' }),
        expect.objectContaining({ action: 'raw', key: 'Escape' }),
        expect.objectContaining({ action: 'raw', key: 'Up' }),
        expect.objectContaining({ action: 'raw', key: 'Down' }),
        expect.objectContaining({ action: 'raw', key: 'C-c' }),
      ]));
    });
  });

  it('does not show workspace selectors for normal sandbox users', async () => {
    render(<TerminalView />);

    expect(await screen.findByText('Sandbox workspace')).toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });

  it('renders friendly entitlement errors from the session API', async () => {
    const fetchMock = jest.fn((url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/api/workspace-entitlements')) {
        return Promise.resolve(response({
          isBlair: true,
          canUseForkWorkspaces: true,
          canUseStagingSourceEdits: false,
          stagingSourceEditsEnabled: false,
          stagingSourceToggleAvailable: false,
          operatorStagingSourceAvailable: false,
        }));
      }
      if (target.includes('/api/terminal/sessions') && init?.method === 'POST') {
        return Promise.resolve(response(
          { error: 'personal_instance_only' },
          { ok: false, status: 403, statusText: 'Forbidden' },
        ));
      }
      return Promise.resolve(response({ sessions: [] }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TerminalView />);
    fireEvent.click(await screen.findByRole('button', { name: /^CLI/i }));

    expect(await screen.findByText(/Core PearlOS integration is managed separately/i)).toBeInTheDocument();
  });

  it('can resume an existing provider session without creating main', async () => {
    const fetchMock = installFetchMock({
      sessions: [
        { id: 'main', name: 'main', created: '', attached: false },
        { id: 'codex-existing', name: 'codex-existing', created: '', attached: false },
      ],
    });
    render(<TerminalView />);

    fireEvent.click(await screen.findByRole('button', { name: /codex-existing/i }));

    expect(await screen.findByText(/Codex ready/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /main/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('listOnly=1'),
      expect.any(Object),
    );
  });

  it('stops a session through the session API', async () => {
    const fetchMock = installFetchMock();
    render(<TerminalView />);

    fireEvent.click(await screen.findByRole('button', { name: /^CLI/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Stop session/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/terminal/sessions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"action":"kill"'),
        }),
      );
    });
    expect(await screen.findByRole('button', { name: /^CLI/i })).toBeInTheDocument();
    expectNoLegacyExecuteCalls(fetchMock);
  });
});
