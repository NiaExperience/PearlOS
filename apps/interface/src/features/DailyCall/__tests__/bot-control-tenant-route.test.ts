import { getSessionSafely } from '@nia/prism/core/auth';

const mockCreateBotClaimHeaders = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn(),
}));

jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: { mock: 'auth-options' } }));

jest.mock('@interface/lib/bot-auth-claims', () => ({
  createBotClaimHeaders: (...args: unknown[]) => mockCreateBotClaimHeaders(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

const mockGetSessionSafely = getSessionSafely as jest.MockedFunction<typeof getSessionSafely>;
const originalBotBase = process.env.BOT_CONTROL_BASE_URL;

function actor(tenantId: string) {
  return {
    ok: true,
    actor: {
      userId: 'user-1',
      userEmail: 'sam@example.com',
      userName: 'Sam',
      tenantId,
      tenantRole: 'member',
    },
  };
}

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    json: async () => body,
  } as any;
}

describe('bot control active tenant routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOT_CONTROL_BASE_URL = 'http://bot.example';
    process.env.BOT_CONTROL_SHARED_SECRET = 'shared-secret';
    mockCreateBotClaimHeaders.mockReturnValue({ 'x-bot-claims': 'signed' });
    mockGetSessionSafely.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'session@example.com',
        name: 'Session Sam',
        tenant_id: 'tenant-a',
      },
    } as any);
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
  });

  afterAll(() => {
    process.env.BOT_CONTROL_BASE_URL = originalBotBase;
  });

  it('joins under the requested active tenant instead of the session default tenant', async () => {
    mockResolveInterfaceActorContext.mockResolvedValue(actor('tenant-b'));
    const { POST_impl } = require('../routes/joinImpl');

    const response = await POST_impl(request({
      room_url: 'https://daily.example/room',
      tenantId: 'tenant-b',
      sessionId: 'session-1',
    }));

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-b' });
    expect(mockCreateBotClaimHeaders).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-b',
      sessionUserId: 'user-1',
      sessionUserEmail: 'sam@example.com',
      sessionUserName: 'Sam',
    }));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded).toMatchObject({
      tenantId: 'tenant-b',
      sessionUserId: 'user-1',
      sessionUserEmail: 'sam@example.com',
      sessionUserName: 'Sam',
      sessionId: 'session-1',
    });
  });

  it('ignores stale public tenant on join and resolves the authenticated actor tenant', async () => {
    mockResolveInterfaceActorContext.mockResolvedValue(actor('tenant-real'));
    const { POST_impl } = require('../routes/joinImpl');

    const response = await POST_impl(request({
      room_url: 'https://daily.example/room',
      tenantId: '00000000-0000-0000-0000-000000000001',
      sessionId: 'session-1',
    }));

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: undefined });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded.tenantId).toBe('tenant-real');
  });

  it('leaves under the requested active tenant instead of the session default tenant', async () => {
    mockResolveInterfaceActorContext.mockResolvedValue(actor('tenant-b'));
    const { POST_impl } = require('../routes/leaveImpl');

    const response = await POST_impl(request({
      room_url: 'https://daily.example/room',
      tenantId: 'tenant-b',
      sessionId: 'session-1',
    }));

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-b' });
    expect(mockCreateBotClaimHeaders).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-b',
      sessionUserId: 'user-1',
      sessionUserEmail: 'sam@example.com',
      sessionUserName: 'Sam',
    }));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded).toMatchObject({
      room_url: 'https://daily.example/room',
      tenantId: 'tenant-b',
      sessionUserId: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('ignores stale public tenant on leave and resolves the authenticated actor tenant', async () => {
    mockResolveInterfaceActorContext.mockResolvedValue(actor('tenant-real'));
    const { POST_impl } = require('../routes/leaveImpl');

    const response = await POST_impl(request({
      room_url: 'https://daily.example/room',
      tenantId: '00000000-0000-0000-0000-000000000001',
      sessionId: 'session-1',
    }));

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: undefined });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded.tenantId).toBe('tenant-real');
  });
});

export {};
