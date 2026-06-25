import { GET } from '../route';

const mockLstat = jest.fn();
const mockReadFile = jest.fn();
const mockRealpath = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();
const mockReadProjects = jest.fn();

jest.mock('fs/promises', () => ({
  lstat: (...args: unknown[]) => mockLstat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

jest.mock('../../../../launchpad/lib/store', () => ({
  readProjects: (...args: unknown[]) => mockReadProjects(...args),
  projectBelongsToRequester: (project: any, requester: any) =>
    project.requesterTenantId === requester.tenantId &&
    (project.requesterUserId === requester.userId || project.requesterEmail === requester.email),
}));

describe('/api/creation/[id]/[...path]', () => {
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
      size: 24,
      isSymbolicLink: () => false,
      isFile: () => true,
    });
    mockRealpath.mockImplementation(async (input: string) => input);
    mockReadFile.mockResolvedValue(Buffer.from('<html>creation</html>'));
    mockReadProjects.mockResolvedValue([]);
  });

  it('serves generated creations with sandbox headers after realpath checks', async () => {
    const response = await GET({} as any, {
      params: Promise.resolve({ id: 'creation-1', path: ['index.html'] }),
    });

    expect(response.status).toBe(200);
    expect(mockReadFile).toHaveBeenCalledWith(
      '/srv/pearl-user-workspaces/tenant-a/user-1/creations/creation-1/index.html',
    );
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(response.headers.get('Content-Security-Policy')).not.toContain('allow-same-origin');
  });

  it('serves an owned legacy artifact when project metadata points to that output path', async () => {
    mockLstat.mockImplementation(async (input: string) => {
      if (input.startsWith('/srv/pearl-user-workspaces/')) {
        throw new Error('missing scoped artifact');
      }
      return {
        size: 24,
        isSymbolicLink: () => false,
        isFile: () => true,
      };
    });
    mockReadProjects.mockResolvedValue([
      {
        id: 'legacy-creation',
        outputPath: '/workspace/nia-universal/creations/legacy-creation/',
        requesterUserId: 'user-1',
        requesterTenantId: 'tenant-a',
        requesterEmail: 'sam@example.com',
      },
    ]);

    const response = await GET({} as any, {
      params: Promise.resolve({ id: 'legacy-creation', path: ['index.html'] }),
    });

    expect(response.status).toBe(200);
    expect(mockReadFile).toHaveBeenCalledWith(
      '/workspace/nia-universal/creations/legacy-creation/index.html',
    );
  });

  it('does not expose legacy artifacts without an owned project record', async () => {
    mockLstat.mockRejectedValue(new Error('missing scoped artifact'));

    const response = await GET({} as any, {
      params: Promise.resolve({ id: 'legacy-creation', path: ['index.html'] }),
    });

    expect(response.status).toBe(404);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('rejects unsafe creation ids', async () => {
    const response = await GET({} as any, {
      params: Promise.resolve({ id: '..', path: ['index.html'] }),
    });

    expect(response.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('does not serve symlinked creation files', async () => {
    mockLstat.mockResolvedValueOnce({
      isSymbolicLink: () => true,
      isFile: () => false,
    });

    const response = await GET({} as any, {
      params: Promise.resolve({ id: 'creation-1', path: ['index.html'] }),
    });

    expect(response.status).toBe(404);
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
