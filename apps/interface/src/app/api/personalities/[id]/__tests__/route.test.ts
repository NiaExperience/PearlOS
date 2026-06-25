import { NextResponse } from 'next/server';

import { GET } from '../route';

const mockGetPersonalityById = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions/personality.actions', () => ({
  getPersonalityById: (...args: unknown[]) => mockGetPersonalityById(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/personalities/[id]', () => {
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
    mockGetPersonalityById.mockResolvedValue({
      _id: 'personality-1',
      tenantId: 'tenant-a',
      name: 'Pearl',
      primaryPrompt: 'Tenant A Pearl',
    });
  });

  it('fetches personalities only through the resolved actor tenant', async () => {
    const response = await GET(
      { url: 'https://app.example.com/api/personalities/personality-1?tenantId=tenant-spoof' } as any,
      { params: { id: 'personality-1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockGetPersonalityById).toHaveBeenCalledWith('personality-1', 'tenant-a');
    expect(body.item).toMatchObject({ tenantId: 'tenant-a', primaryPrompt: 'Tenant A Pearl' });
  });

  it('does not fetch a personality when tenant resolution fails', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET(
      { url: 'https://app.example.com/api/personalities/personality-1?tenantId=tenant-b' } as any,
      { params: { id: 'personality-1' } },
    );

    expect(response.status).toBe(403);
    expect(mockGetPersonalityById).not.toHaveBeenCalled();
  });

  it('returns not found for a personality outside the resolved tenant', async () => {
    mockGetPersonalityById.mockResolvedValueOnce(undefined);

    const response = await GET(
      { url: 'https://app.example.com/api/personalities/personality-1?tenantId=tenant-a' } as any,
      { params: { id: 'personality-1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Not found');
  });
});
