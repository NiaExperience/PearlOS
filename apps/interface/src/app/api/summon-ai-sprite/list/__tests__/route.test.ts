import { NextResponse } from 'next/server';

import { GET } from '../route';

const mockListByUser = jest.fn();
const mockGetSpritesSharedWithUser = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions/sprite-actions', () => ({
  listByUser: (...args: unknown[]) => mockListByUser(...args),
  getSpritesSharedWithUser: (...args: unknown[]) => mockGetSpritesSharedWithUser(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

function request(url = 'https://app.example.com/api/summon-ai-sprite/list?tenantId=tenant-spoof&limit=20') {
  return {
    nextUrl: new URL(url),
  } as any;
}

describe('/api/summon-ai-sprite/list', () => {
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
    mockListByUser.mockResolvedValue({
      total: 1,
      items: [
        {
          _id: 'sprite-owned',
          parent_id: 'user-1',
          tenantId: 'tenant-a',
          name: 'Owned Sprite',
          gifData: 'png-data',
          gifMimeType: 'image/png',
        },
      ],
    });
    mockGetSpritesSharedWithUser.mockResolvedValue([
      {
        _id: 'sprite-shared',
        parent_id: 'user-2',
        tenantId: 'tenant-a',
        name: 'Shared Sprite',
      },
    ]);
  });

  it('lists sprites through the resolved actor tenant, not caller tenant claims', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockListByUser).toHaveBeenCalledWith('user-1', 20, 0, 'tenant-a');
    expect(mockGetSpritesSharedWithUser).toHaveBeenCalledWith('user-1', 'tenant-a');
    expect(body.sprites).toEqual([
      expect.objectContaining({ _id: 'sprite-owned', name: 'Owned Sprite' }),
      expect.objectContaining({ _id: 'sprite-shared', name: 'Shared Sprite', isShared: true }),
    ]);
    expect(body.total).toBe(2);
  });

  it('rejects tenant resolution failures before querying sprites', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET(request('https://app.example.com/api/summon-ai-sprite/list?tenantId=tenant-b'));

    expect(response.status).toBe(403);
    expect(mockListByUser).not.toHaveBeenCalled();
    expect(mockGetSpritesSharedWithUser).not.toHaveBeenCalled();
  });

  it('does not fall back to an anonymous user when actor resolution requires auth', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET(request('https://app.example.com/api/summon-ai-sprite/list?limit=20'));

    expect(response.status).toBe(401);
    expect(mockListByUser).not.toHaveBeenCalled();
  });
});
