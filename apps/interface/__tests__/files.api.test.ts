/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

import { getSessionSafely } from '@nia/prism/core/auth';
import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { GET as listFilesGET } from '../src/app/api/files/route';
import { GET as searchFilesGET } from '../src/app/api/files/search/route';

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn(),
}));

jest.mock('@nia/prism/core/actions/tenant-actions', () => ({
  getUserTenantRoles: jest.fn(),
}));

const mockGetSessionSafely = getSessionSafely as jest.MockedFunction<typeof getSessionSafely>;
const mockGetUserTenantRoles = getUserTenantRoles as jest.MockedFunction<typeof getUserTenantRoles>;
const userId = 'files-test-user';
const tenantId = 'tenant-files-test';
const tenantRoot = path.join('/workspace/user', tenantId);
const userRoot = path.join(tenantRoot, userId);

async function resetFixture() {
  await fs.rm(userRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(userRoot, 'Documents', 'arcade-game', 'assets'), { recursive: true });
  await fs.mkdir(path.join(userRoot, 'Documents', 'notes'), { recursive: true });
  await fs.writeFile(path.join(userRoot, 'Documents', 'arcade-game', 'assets', 'hero.png'), 'png');
  await fs.writeFile(path.join(userRoot, 'Documents', 'arcade-game', 'assets', 'cabinet.png'), 'png');
  await fs.writeFile(path.join(userRoot, 'Documents', 'notes', 'plan.md'), '# Plan');
}

describe('/api/files FileSpace routes', () => {
  beforeEach(async () => {
    mockGetSessionSafely.mockResolvedValue({ user: { id: userId, tenantId } } as any);
    mockGetUserTenantRoles.mockResolvedValue([{ tenantId, role: 'member' }] as any);
    await resetFixture();
  });

  afterAll(async () => {
    await fs.rm(tenantRoot, { recursive: true, force: true });
  });

  it('lists only the signed-in user Documents tree using relative paths', async () => {
    const request = new NextRequest('http://localhost/api/files?path=arcade-game/assets');
    const response = await listFilesGET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.relativePath).toBe('arcade-game/assets');
    expect(data.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'hero.png', kind: 'file', path: 'arcade-game/assets/hero.png', ext: 'png' }),
      ]),
    );
  });

  it('blocks traversal outside the user file root', async () => {
    const request = new NextRequest('http://localhost/api/files?path=../../..');
    const response = await listFilesGET(request);

    expect(response.status).toBe(403);
  });

  it('finds a relevant asset folder from a natural language PNG query', async () => {
    const request = new NextRequest(
      'http://localhost/api/files/search?q=I%20need%20those%20PNGs%20I%20did%20for%20that%20arcade%20game',
    );
    const response = await searchFilesGET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.openedPath).toBe('arcade-game/assets');
    expect(data.best).toEqual(expect.objectContaining({ kind: 'folder', path: 'arcade-game/assets' }));
    expect(data.message).toContain('opened the closest folder');
  });

  it('requires an authenticated user', async () => {
    mockGetSessionSafely.mockResolvedValueOnce(null as any);
    const response = await searchFilesGET(new NextRequest('http://localhost/api/files/search?q=pngs'));

    expect(response.status).toBe(401);
  });
});
