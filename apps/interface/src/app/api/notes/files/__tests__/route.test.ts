import fs from 'fs';
import os from 'os';
import path from 'path';

const mockGetSessionSafely = jest.fn();
const mockGetUserTenantRoles = jest.fn();
const mockGetAssistantBySubDomain = jest.fn();
const mockGetAssistantByName = jest.fn();
const mockDbQuery = jest.fn();
const mockPoolOn = jest.fn();

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: (...args: unknown[]) => mockGetSessionSafely(...args),
}));

jest.mock('@nia/prism/core/actions/tenant-actions', () => ({
  getUserTenantRoles: (...args: unknown[]) => mockGetUserTenantRoles(...args),
}));

jest.mock('@nia/prism/core/actions', () => ({
  AssistantActions: {
    getAssistantBySubDomain: (...args: unknown[]) => mockGetAssistantBySubDomain(...args),
    getAssistantByName: (...args: unknown[]) => mockGetAssistantByName(...args),
  },
}));

jest.mock('@interface/lib/auth-config', () => ({
  interfaceAuthOptions: {},
}));

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: (...args: unknown[]) => mockDbQuery(...args),
    on: (...args: unknown[]) => mockPoolOn(...args),
  })),
}));

const testRoot = path.join(os.tmpdir(), 'pearlos-notes-files-route-test');

function request(body: Record<string, unknown>) {
  return {
    url: 'http://localhost/api/notes/files?tenantId=tenant-a',
    json: async () => body,
  } as any;
}

async function loadRoute() {
  jest.resetModules();
  process.env.PEARLOS_USER_ROOT = testRoot;
  return import('../route');
}

describe('/api/notes/files DB-backed writes', () => {
  beforeEach(() => {
    fs.rmSync(testRoot, { force: true, recursive: true });
    jest.clearAllMocks();
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'user-1' } });
    mockGetUserTenantRoles.mockResolvedValue([{ tenantId: 'tenant-a', role: 'member' }]);
    mockGetAssistantBySubDomain.mockResolvedValue(null);
    mockGetAssistantByName.mockResolvedValue(null);
  });

  afterEach(() => {
    fs.rmSync(testRoot, { force: true, recursive: true });
    delete process.env.PEARLOS_USER_ROOT;
  });

  it('patches DB notes by synthetic db id instead of treating them as missing files', async () => {
    const { PATCH } = await loadRoute();
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        block_id: 'block-1',
        content: {
          title: 'Updated Welcome',
          normalizedTitle: 'updated welcome',
          content: 'Updated body',
          mode: 'personal',
          userId: 'user-1',
          tenantId: 'tenant-a',
        },
        createdAt: '2026-06-11T20:00:00.000Z',
        updatedAt: '2026-06-11T22:00:00.000Z',
      }],
    });

    const response = await PATCH(request({
      id: 'db-block-1',
      title: 'Updated Welcome',
      content: 'Updated body',
    }));
    const body = await response.json();
    const [sql, params] = mockDbQuery.mock.calls[0];
    const updates = JSON.parse(String((params as unknown[])[0]));

    expect(response.status).toBe(200);
    expect(String(sql)).toContain('UPDATE notion_blocks');
    expect(params).toEqual([
      expect.any(String),
      'block-1',
      'user-1',
      'tenant-a',
    ]);
    expect(updates).toMatchObject({
      title: 'Updated Welcome',
      normalizedTitle: 'updated welcome',
      content: 'Updated body',
    });
    expect(body).toMatchObject({
      _id: 'db-block-1',
      title: 'Updated Welcome',
      content: 'Updated body',
      source: 'database',
      userId: 'user-1',
      tenantId: 'tenant-a',
    });
  });

  it('deletes DB notes by synthetic db id with the authenticated user and tenant guard', async () => {
    const { DELETE } = await loadRoute();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ block_id: 'block-1' }] });

    const response = await DELETE(request({ id: 'db-block-1' }));
    const body = await response.json();
    const [sql, params] = mockDbQuery.mock.calls[0];

    expect(response.status).toBe(200);
    expect(String(sql)).toContain('DELETE FROM notion_blocks');
    expect(params).toEqual(['block-1', 'user-1', 'tenant-a']);
    expect(body).toEqual({
      message: 'Note deleted',
      deletedId: 'db-block-1',
    });
  });

  it('keeps a file-backed note heading aligned when the title changes', async () => {
    const { PATCH } = await loadRoute();
    const documentsDir = path.join(testRoot, 'tenant-a', 'user-1', 'Documents');
    fs.mkdirSync(documentsDir, { recursive: true });
    fs.writeFileSync(path.join(documentsDir, 'Old-Title.md'), '# Old Title\n\nOriginal body', 'utf-8');

    const response = await PATCH(request({
      id: 'Old-Title',
      title: 'New Title',
      content: '# Old Title\n\nUpdated body',
    }));
    const body = await response.json();
    const renamedPath = path.join(documentsDir, 'New-Title.md');

    expect(response.status).toBe(200);
    expect(fs.existsSync(path.join(documentsDir, 'Old-Title.md'))).toBe(false);
    expect(fs.readFileSync(renamedPath, 'utf-8')).toBe('# New Title\n\nUpdated body');
    expect(body).toMatchObject({
      _id: 'New-Title',
      title: 'New Title',
      content: '# New Title\n\nUpdated body',
    });
  });

  it('persists file-backed work note mode across reads', async () => {
    const { GET, POST } = await loadRoute();
    mockDbQuery.mockResolvedValue({ rows: [] });

    const createResponse = await POST(request({
      title: 'Work Plan',
      content: 'Quarterly goals',
      mode: 'work',
    }));
    const created = await createResponse.json();

    const listResponse = await GET({
      url: 'http://localhost/api/notes/files?tenantId=tenant-a',
    } as any);
    const notes = await listResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created).toMatchObject({ _id: 'Work-Plan', title: 'Work Plan', mode: 'work' });
    expect(notes).toEqual([
      expect.objectContaining({ _id: 'Work-Plan', title: 'Work Plan', mode: 'work' }),
    ]);
  });
});
