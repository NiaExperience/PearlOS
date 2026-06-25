import { NextResponse } from 'next/server';

import { GET } from '../route';

const mockReadFile = jest.fn();
const mockLstat = jest.fn();
const mockRealpath = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('fs/promises', () => ({
  lstat: (...args: unknown[]) => mockLstat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/tasks/artifact/[taskId]/[...path]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
    });
    mockRealpath.mockImplementation(async (input: string) => input);
    mockReadFile.mockResolvedValue(Buffer.from('<html>task output</html>'));
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task: {
            id: 'task-1',
            requester_user_id: 'user-1',
            requester_email: 'sam@example.com',
            requester_tenant_id: 'tenant-a',
            workspace_path: '/srv/pearl-user-workspaces/tenant-a/user-1/task-1',
          },
        }),
        { status: 200 },
      ),
    );
  });

  it('serves artifacts only after resolving the requester and scoping the task lookup', async () => {
    const req = {} as any;
    const response = await GET(req, {
      params: Promise.resolve({ taskId: 'task-1', path: ['index.html'] }),
    });

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ request: req });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4444/api/tasks/task-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-User-Id': 'user-1',
          'X-User-Email': 'sam@example.com',
          'X-Pearl-Tenant-Id': 'tenant-a',
        }),
      }),
    );
    expect(mockReadFile).toHaveBeenCalledWith('/srv/pearl-user-workspaces/tenant-a/user-1/task-1/index.html');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
  });

  it('does not read artifact files when the task tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET({} as any, {
      params: Promise.resolve({ taskId: 'task-1', path: ['index.html'] }),
    });

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('rejects symlinked artifact files before reading them', async () => {
    mockLstat.mockResolvedValueOnce({
      isSymbolicLink: () => true,
      isFile: () => false,
    });

    const response = await GET({} as any, {
      params: Promise.resolve({ taskId: 'task-1', path: ['index.html'] }),
    });

    expect(response.status).toBe(404);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('serves artifacts from scoped fork workspaces', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task: {
            id: 'task-1',
            requester_user_id: 'user-1',
            requester_email: 'sam@example.com',
            requester_tenant_id: 'tenant-a',
            workspace_mode: 'github_fork',
            workspace_path: '/srv/pearl-user-workspaces/tenant-a/user-1/forks/blair_pearlos-fork',
          },
        }),
        { status: 200 },
      ),
    );

    const response = await GET({} as any, {
      params: Promise.resolve({ taskId: 'task-1', path: ['dist', 'index.html'] }),
    });

    expect(response.status).toBe(200);
    expect(mockReadFile).toHaveBeenCalledWith('/srv/pearl-user-workspaces/tenant-a/user-1/forks/blair_pearlos-fork/dist/index.html');
  });

  it('rejects staging source workspaces as task artifact roots', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task: {
            id: 'task-1',
            requester_user_id: 'user-1',
            requester_email: 'sam@example.com',
            requester_tenant_id: 'tenant-a',
            workspace_mode: 'staging_source',
            workspace_path: '/workspace/nia-universal',
          },
        }),
        { status: 200 },
      ),
    );

    const response = await GET({} as any, {
      params: Promise.resolve({ taskId: 'task-1', path: ['apps', 'interface', 'package.json'] }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'invalid_workspace' });
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
