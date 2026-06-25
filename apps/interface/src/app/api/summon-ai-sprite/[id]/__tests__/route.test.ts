import { NextResponse } from 'next/server';

import { DELETE, GET } from '../route';

const mockFindById = jest.fn();
const mockRemove = jest.fn();
const mockGetTokensRedeemedByUser = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions/sprite-actions', () => ({
  findById: (...args: unknown[]) => mockFindById(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
}));

jest.mock('@nia/prism/core/actions/resourceShareToken-actions', () => ({
  getTokensRedeemedByUser: (...args: unknown[]) => mockGetTokensRedeemedByUser(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

function request(url = 'https://app.example.com/api/summon-ai-sprite/sprite-a?tenantId=tenant-spoof') {
  return {
    nextUrl: new URL(url),
  } as any;
}

function context(id = 'sprite-a') {
  return { params: Promise.resolve({ id }) };
}

function sprite(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'sprite-a',
    parent_id: 'user-1',
    tenantId: 'tenant-a',
    name: 'Tenant Sprite',
    description: 'A tenant sprite',
    originalRequest: 'make a sprite',
    gifData: 'png-data',
    gifMimeType: 'image/png',
    primaryPrompt: 'Be helpful',
    voiceProvider: 'pocket',
    voiceId: 'alba',
    ...overrides,
  };
}

describe('/api/summon-ai-sprite/[id]', () => {
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
    mockFindById.mockResolvedValue(sprite());
    mockGetTokensRedeemedByUser.mockResolvedValue([]);
  });

  it('fetches owned sprites only through the resolved tenant', async () => {
    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(body.sprite).toMatchObject({
      _id: 'sprite-a',
      name: 'Tenant Sprite',
      isShared: false,
    });
  });

  it('does not fetch a same-user sprite from another tenant', async () => {
    mockFindById.mockResolvedValueOnce(sprite({ tenantId: 'tenant-b' }));

    const response = await GET(request('https://app.example.com/api/summon-ai-sprite/sprite-a?tenantId=tenant-a'), context());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Sprite not found');
    expect(mockGetTokensRedeemedByUser).not.toHaveBeenCalled();
  });

  it('requires redeemed shared tokens to belong to the resolved tenant', async () => {
    mockFindById.mockResolvedValueOnce(sprite({ parent_id: 'user-2' }));
    mockGetTokensRedeemedByUser.mockResolvedValueOnce([
      { resourceId: 'sprite-a', tenantId: 'tenant-b', isActive: true },
    ]);

    const response = await GET(request('https://app.example.com/api/summon-ai-sprite/sprite-a?tenantId=tenant-a'), context());

    expect(response.status).toBe(403);
  });

  it('deletes only owner sprites in the resolved tenant', async () => {
    const response = await DELETE(request('https://app.example.com/api/summon-ai-sprite/sprite-a?tenantId=tenant-a'), context());

    expect(response.status).toBe(204);
    expect(mockRemove).toHaveBeenCalledWith('sprite-a');
  });

  it('does not delete same-user sprites from another tenant', async () => {
    mockFindById.mockResolvedValueOnce(sprite({ tenantId: 'tenant-b' }));

    const response = await DELETE(request('https://app.example.com/api/summon-ai-sprite/sprite-a?tenantId=tenant-a'), context());

    expect(response.status).toBe(403);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('does not read a sprite when tenant resolution fails', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET(request('https://app.example.com/api/summon-ai-sprite/sprite-a?tenantId=tenant-b'), context());

    expect(response.status).toBe(403);
    expect(mockFindById).not.toHaveBeenCalled();
  });
});
