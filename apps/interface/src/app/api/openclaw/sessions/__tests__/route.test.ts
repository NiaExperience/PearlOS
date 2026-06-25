import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

const mockReadFile = jest.fn();
const mockReaddir = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

import { GET } from '../route';

function req(url: string) {
  return { url } as any;
}

describe('/api/openclaw/sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'admin-1',
        userEmail: 'admin@example.com',
        userName: 'Admin',
        tenantId: 'tenant-a',
        tenantRole: TenantRole.ADMIN,
      },
    });
    mockReaddir.mockResolvedValue(['main']);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('job-descriptions.json')) {
        return JSON.stringify({ 'deploy-task': 'Deploy task' });
      }
      return JSON.stringify({
        'agent:codex:deploy-task': {
          tenantId: 'tenant-a',
          label: 'deploy-task',
          model: 'codex',
          updatedAt: Date.now(),
          createdAt: Date.now() - 1000,
        },
        'agent:codex:other-tenant-task': {
          tenantId: 'tenant-b',
          label: 'other-tenant-task',
          model: 'codex',
          updatedAt: Date.now(),
          createdAt: Date.now() - 1000,
        },
        'agent:codex:legacy-unscoped-task': {
          label: 'legacy-unscoped-task',
          model: 'codex',
          updatedAt: Date.now(),
          createdAt: Date.now() - 1000,
        },
      });
    });
  });

  it('requires tenant admin scope and filters sessions to the resolved tenant', async () => {
    const response = await GET(req('https://app.example.com/api/openclaw/sessions?tenantId=tenant-spoof'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({
      requestedTenantId: 'tenant-spoof',
      minimumRole: TenantRole.ADMIN,
    });
    expect(mockReaddir).toHaveBeenCalled();
    expect(body.jobs).toEqual([
      expect.objectContaining({
        key: 'agent:codex:deploy-task',
        label: 'deploy-task',
        description: 'Deploy task',
        kind: 'codex',
      }),
    ]);
  });

  it('does not read session files when tenant admin scope is denied', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET(req('https://app.example.com/api/openclaw/sessions?tenantId=tenant-b'));

    expect(response.status).toBe(403);
    expect(mockReaddir).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
