import { NextResponse } from 'next/server';

import * as route from '../route';
import { GET } from '../route';

const mockResolveInterfaceActorContext = jest.fn();
const mockWorkspaceEntitlementsForActor = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

jest.mock('@interface/lib/workspace-entitlements', () => ({
  workspaceEntitlementsForActor: (...args: unknown[]) => mockWorkspaceEntitlementsForActor(...args),
}));

describe('/api/workspace-entitlements', () => {
  const actor = {
    userId: 'user-1',
    userEmail: 'sam@example.com',
    userName: 'Sam',
    tenantId: 'tenant-a',
    tenantRole: 'member',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveInterfaceActorContext.mockResolvedValue({ ok: true, actor });
    mockWorkspaceEntitlementsForActor.mockResolvedValue({
      isBlair: false,
      canUseForkWorkspaces: false,
      stagingSourceToggleAvailable: false,
      stagingSourceEditsEnabled: false,
      canUseStagingSourceEdits: false,
    });
  });

  it('returns the authenticated actor entitlements', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockWorkspaceEntitlementsForActor).toHaveBeenCalledWith(actor);
    expect(body.isBlair).toBe(false);
  });

  it('never reports staging-source access as available, even for Blair', async () => {
    mockWorkspaceEntitlementsForActor.mockResolvedValueOnce({
      isBlair: true,
      canUseForkWorkspaces: true,
      stagingSourceToggleAvailable: false,
      stagingSourceEditsEnabled: false,
      canUseStagingSourceEdits: false,
    });

    const body = await (await GET()).json();

    expect(body.stagingSourceToggleAvailable).toBe(false);
    expect(body.canUseStagingSourceEdits).toBe(false);
  });

  it('exposes no write/enable endpoint for staging-source access', () => {
    // The user-facing toggle was removed; only a read-only GET remains. Core
    // PearlOS integration is handled out-of-band, not via this web route.
    expect((route as Record<string, unknown>).POST).toBeUndefined();
    expect((route as Record<string, unknown>).PUT).toBeUndefined();
    expect((route as Record<string, unknown>).PATCH).toBeUndefined();
  });

  it('returns auth failures before reading entitlements', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockWorkspaceEntitlementsForActor).not.toHaveBeenCalled();
  });
});
