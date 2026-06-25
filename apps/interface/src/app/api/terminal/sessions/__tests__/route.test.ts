import fs from 'fs';
import os from 'os';
import path from 'path';

const mockExecFile = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

function postRequest(body: Record<string, unknown>) {
  return {
    headers: { get: () => null },
    nextUrl: { origin: 'https://pearl.example.com' },
    json: async () => body,
  } as any;
}

describe('/api/terminal/sessions sandbox workspaces', () => {
  const originalEnv = { ...process.env };
  let tmuxSessions: Set<string>;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    tmuxSessions = new Set();
    process.env = { ...originalEnv };
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        userName: 'Sam',
        tenantId: 'tenant-a',
        tenantRole: 'member',
      },
    });
    mockExecFile.mockImplementation((cmd: string, args: string[], options: unknown, callback: Function) => {
      if (cmd !== 'tmux') {
        callback(Object.assign(new Error(`unexpected command: ${cmd}`), { code: 'ENOENT' }), { stdout: '', stderr: '' });
        return;
      }
      if (args[0] === 'has-session') {
        const target = String(args[2] || '');
        callback(tmuxSessions.has(target) ? null : new Error('missing'), { stdout: '', stderr: '' });
        return;
      }
      if (args[0] === 'new-session') {
        const name = String(args[args.indexOf('-s') + 1] || '');
        if (name) tmuxSessions.add(name);
        callback(null, { stdout: '', stderr: '' });
        return;
      }
      if (args[0] === 'capture-pane') {
        callback(null, { stdout: 'bash-5.1# ', stderr: '' });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadRoute() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-sessions-'));
    process.env.PEARL_PUBLIC_TASK_ROOT = root;
    return import('../route');
  }

  it('rejects public staging_source terminal sessions before tmux launch', async () => {
    const route = await loadRoute();

    const response = await route.POST(postRequest({
      action: 'create',
      id: 'codex-test',
      workspaceMode: 'staging_source',
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('personal_instance_only');
    expect(mockExecFile).not.toHaveBeenCalledWith('tmux', expect.arrayContaining(['new-session']), expect.anything(), expect.anything());
  });

  it('creates sandbox sessions with bubblewrap and no protected-root binds', async () => {
    const route = await loadRoute();

    const response = await route.POST(postRequest({
      action: 'create',
      id: 'codex-test',
      workspaceMode: 'sandbox',
    }));

    expect(response.status).toBe(200);
    const newSessionCall = mockExecFile.mock.calls.find((call) =>
      call[0] === 'tmux' && Array.isArray(call[1]) && call[1].includes('new-session')
    );
    expect(newSessionCall).toBeTruthy();
    const args = newSessionCall?.[1] as string[];
    expect(args).toContain('bwrap');
    expect(args).toContain('--clearenv');
    expect(args).not.toContain('/workspace/nia-universal');
    expect(args).not.toContain('/home/deploy/pearlos');
    expect(args).not.toContain('/opt/pearlos');
    expect(args).not.toContain('/root/.openclaw');
  });

  it('returns a stable runtime error when tmux is missing', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _options: unknown, callback: Function) => {
      callback(Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' }), { stdout: '', stderr: '' });
    });
    const route = await loadRoute();

    const response = await route.POST(postRequest({
      action: 'create',
      id: 'codex-test',
      workspaceMode: 'sandbox',
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('terminal_runtime_unavailable');
  });

  it('returns a stable sandbox error when bubblewrap cannot create namespaces', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockExecFile.mockImplementation((cmd: string, args: string[], _options: unknown, callback: Function) => {
      if (cmd !== 'tmux') {
        callback(Object.assign(new Error(`unexpected command: ${cmd}`), { code: 'ENOENT' }), { stdout: '', stderr: '' });
        return;
      }
      if (args[0] === 'has-session') {
        const target = String(args[2] || '');
        callback(tmuxSessions.has(target) ? null : new Error('missing'), { stdout: '', stderr: '' });
        return;
      }
      if (args[0] === 'new-session') {
        callback(
          Object.assign(new Error('bwrap: Creating new namespace failed: Operation not permitted'), {
            stderr: 'bwrap: Creating new namespace failed: Operation not permitted',
          }),
          { stdout: '', stderr: 'bwrap: Creating new namespace failed: Operation not permitted' }
        );
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    const route = await loadRoute();

    const response = await route.POST(postRequest({
      action: 'create',
      id: 'codex-test',
      workspaceMode: 'sandbox',
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('terminal_sandbox_unavailable');
    errorSpy.mockRestore();
  });

  it('waits past the echoed Codex launcher command before returning startup output', async () => {
    let captureCount = 0;
    mockExecFile.mockImplementation((cmd: string, args: string[], options: unknown, callback: Function) => {
      if (cmd !== 'tmux') {
        callback(Object.assign(new Error(`unexpected command: ${cmd}`), { code: 'ENOENT' }), { stdout: '', stderr: '' });
        return;
      }
      if (args[0] === 'has-session') {
        const target = String(args[2] || '');
        callback(tmuxSessions.has(target) ? null : new Error('missing'), { stdout: '', stderr: '' });
        return;
      }
      if (args[0] === 'new-session') {
        const name = String(args[args.indexOf('-s') + 1] || '');
        if (name) tmuxSessions.add(name);
        callback(null, { stdout: '', stderr: '' });
        return;
      }
      if (args[0] === 'capture-pane') {
        captureCount += 1;
        const stdout = captureCount === 1
          ? 'bash-5.1# pearl-codex-sandbox'
          : 'bash-5.1# pearl-codex-sandbox\nCodex ready';
        callback(null, { stdout, stderr: '' });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    const route = await loadRoute();

    const response = await route.POST(postRequest({
      action: 'send',
      id: 'codex-test',
      input: 'pearl-codex-sandbox',
      launcher: 'codex',
      workspaceMode: 'sandbox',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.output).toContain('Codex ready');
    expect(captureCount).toBeGreaterThan(1);
  });
});
