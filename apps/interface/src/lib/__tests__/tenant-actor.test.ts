import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { getServerSession } from 'next-auth';

import { createBotClaimHeaders } from '../bot-auth-claims';
import { resolveInterfaceActorContext } from '../tenant-actor';

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@nia/prism/core/actions/tenant-actions', () => ({
  getUserTenantRoles: jest.fn(),
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockGetUserTenantRoles = getUserTenantRoles as jest.MockedFunction<typeof getUserTenantRoles>;

function session(overrides: Record<string, unknown> = {}) {
  mockGetServerSession.mockResolvedValue({
    user: {
      id: 'user-1',
      email: 'USER@EXAMPLE.COM',
      name: 'Sam',
      ...overrides,
    },
  } as any);
}

function roles(...items: Array<{ tenantId: string; role: TenantRole }>) {
  mockGetUserTenantRoles.mockResolvedValue(items.map((item) => ({
    userId: 'user-1',
    tenantId: item.tenantId,
    role: item.role,
  })));
}

describe('resolveInterfaceActorContext', () => {
  const originalClaimsSecret = process.env.BOT_CONTROL_CLAIMS_SECRET;
  const originalBotSecret = process.env.BOT_CONTROL_SHARED_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BOT_CONTROL_CLAIMS_SECRET;
    process.env.BOT_CONTROL_SHARED_SECRET = 'test-bot-claims-secret';
  });

  afterAll(() => {
    if (originalClaimsSecret === undefined) {
      delete process.env.BOT_CONTROL_CLAIMS_SECRET;
    } else {
      process.env.BOT_CONTROL_CLAIMS_SECRET = originalClaimsSecret;
    }
    if (originalBotSecret === undefined) {
      delete process.env.BOT_CONTROL_SHARED_SECRET;
    } else {
      process.env.BOT_CONTROL_SHARED_SECRET = originalBotSecret;
    }
  });

  it('requires an authenticated session user with email', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any);

    const result = await resolveInterfaceActorContext();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mockGetUserTenantRoles).not.toHaveBeenCalled();
  });

  it('uses a requested tenant only when the user has membership', async () => {
    session({ tenantId: 'tenant-a' });
    roles(
      { tenantId: 'tenant-a', role: TenantRole.MEMBER },
      { tenantId: 'tenant-b', role: TenantRole.ADMIN },
    );

    const result = await resolveInterfaceActorContext({ requestedTenantId: 'tenant-b' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.tenantId).toBe('tenant-b');
      expect(result.actor.tenantRole).toBe(TenantRole.ADMIN);
      expect(result.actor.userEmail).toBe('user@example.com');
      expect(result.actor.authSource).toBe('next-auth-session');
      expect(result.actor.actorType).toBe('user');
    }
  });

  it('rejects caller-supplied tenant IDs without membership proof', async () => {
    session({ tenantId: 'tenant-a' });
    roles({ tenantId: 'tenant-a', role: TenantRole.OWNER });

    const result = await resolveInterfaceActorContext({ requestedTenantId: 'tenant-b' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('falls back to the authenticated session tenant when no request tenant is supplied', async () => {
    session({ tenant_id: 'tenant-a' });
    roles(
      { tenantId: 'tenant-b', role: TenantRole.ADMIN },
      { tenantId: 'tenant-a', role: TenantRole.MEMBER },
    );

    const result = await resolveInterfaceActorContext();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actor.tenantId).toBe('tenant-a');
  });

  it('enforces minimum tenant role', async () => {
    session();
    roles(
      { tenantId: 'tenant-member', role: TenantRole.MEMBER },
      { tenantId: 'tenant-admin', role: TenantRole.ADMIN },
    );

    const result = await resolveInterfaceActorContext({ minimumRole: TenantRole.ADMIN });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actor.tenantId).toBe('tenant-admin');
  });

  it('returns tenant_required when no allowed tenant exists', async () => {
    session();
    roles();

    const result = await resolveInterfaceActorContext();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('resolves signed service claims only when explicitly allowed', async () => {
    roles({ tenantId: 'tenant-a', role: TenantRole.ADMIN });
    const headers = new Headers(createBotClaimHeaders({
      tenantId: 'tenant-a',
      sessionUserId: 'user-1',
      sessionId: 'session-1',
      sessionUserEmail: 'USER@EXAMPLE.COM',
      sessionUserName: 'Sam',
    }));

    const result = await resolveInterfaceActorContext({
      request: { headers },
      requestedTenantId: 'tenant-a',
      allowServiceClaims: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor).toMatchObject({
        userId: 'user-1',
        userEmail: 'user@example.com',
        userName: 'Sam',
        tenantId: 'tenant-a',
        tenantRole: TenantRole.ADMIN,
        authSource: 'bot-signed-claims',
        actorType: 'service',
      });
    }
    expect(mockGetServerSession).not.toHaveBeenCalled();
    expect(mockGetUserTenantRoles).toHaveBeenCalledWith('user-1');
  });

  it('rejects signed service claims when the requested tenant does not match the claim', async () => {
    const headers = new Headers(createBotClaimHeaders({
      tenantId: 'tenant-a',
      sessionUserId: 'user-1',
      sessionId: 'session-1',
      sessionUserEmail: 'user@example.com',
    }));

    const result = await resolveInterfaceActorContext({
      request: { headers },
      requestedTenantId: 'tenant-b',
      allowServiceClaims: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(mockGetServerSession).not.toHaveBeenCalled();
    expect(mockGetUserTenantRoles).not.toHaveBeenCalled();
  });

  it('does not accept malformed service claim headers through session fallback', async () => {
    session({ tenantId: 'tenant-a' });
    roles({ tenantId: 'tenant-a', role: TenantRole.OWNER });
    const headers = new Headers({
      'x-bot-claims-ts': String(Date.now()),
      'x-bot-claims': '{"tenantId":"tenant-a"}',
      'x-bot-claims-sig': 'bad-signature',
    });

    const result = await resolveInterfaceActorContext({
      request: { headers },
      requestedTenantId: 'tenant-a',
      allowServiceClaims: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mockGetServerSession).not.toHaveBeenCalled();
  });

  it('ignores signed service claims unless the route opts in', async () => {
    session({ tenantId: 'tenant-a' });
    roles({ tenantId: 'tenant-a', role: TenantRole.OWNER });
    const headers = new Headers(createBotClaimHeaders({
      tenantId: 'tenant-a',
      sessionUserId: 'user-1',
      sessionId: 'session-1',
      sessionUserEmail: 'user@example.com',
    }));

    const result = await resolveInterfaceActorContext({
      request: { headers },
      requestedTenantId: 'tenant-a',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.authSource).toBe('next-auth-session');
      expect(result.actor.actorType).toBe('user');
    }
    expect(mockGetServerSession).toHaveBeenCalled();
  });
});
