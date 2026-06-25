const mockCreateBotClaimHeaders = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@interface/lib/bot-auth-claims', () => ({
  createBotClaimHeaders: (...args: unknown[]) => mockCreateBotClaimHeaders(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/bot/config', () => {
  const originalBotBase = process.env.BOT_CONTROL_BASE_URL;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.BOT_CONTROL_BASE_URL = 'http://bot.example';
    mockCreateBotClaimHeaders.mockReturnValue({ 'X-Claim-Test': 'signed' });
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
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterAll(() => {
    process.env.BOT_CONTROL_BASE_URL = originalBotBase;
  });

  it('forwards canonical actor identity and strips spoofed body identity fields', async () => {
    const { POST } = require('../route');

    const response = await POST({
      headers: new Headers({
        'x-user-id': 'header-user',
        'x-user-email': 'header@example.com',
        'x-user-name': 'Header Name',
      }),
      json: async () => ({
        tenantId: 'tenant-spoof',
        tenant_id: 'tenant-spoof-snake',
        requester_tenant_id: 'tenant-spoof-requester',
        requester_user_id: 'user-spoof',
        requester_email: 'spoof@example.com',
        sessionUserId: 'spoof-user',
        sessionUserEmail: 'spoof@example.com',
	        sessionUserName: 'Spoof',
	        persona: 'Pearl Press',
	        personalityId: 'pearl-press',
	        room_url: 'https://daily.example/room',
	      }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockCreateBotClaimHeaders).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      sessionUserId: 'user-1',
      sessionUserEmail: 'sam@example.com',
      sessionUserName: 'Sam',
    }));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded).toMatchObject({
      tenantId: 'tenant-a',
      sessionUserId: 'user-1',
      sessionUserEmail: 'sam@example.com',
	      sessionUserName: 'Sam',
	      persona: 'Pearl Press',
	      personalityId: 'pearl-press',
	      room_url: 'https://daily.example/room',
	    });
    expect(forwarded.tenant_id).toBeUndefined();
    expect(forwarded.requester_tenant_id).toBeUndefined();
    expect(forwarded.requester_user_id).toBeUndefined();
    expect(forwarded.requester_email).toBeUndefined();
  });
});
