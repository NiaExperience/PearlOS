const mockResolveVoiceRoomActorContext = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveVoiceRoomActorContext(...args),
}));

jest.mock('@interface/lib/api-auth', () => ({
  isTestModeBypassAllowed: () => false,
}));

function actor(userId: string, tenantId: string) {
  return {
    ok: true,
    actor: {
      userId,
      userEmail: `${userId}@example.com`,
      userName: userId,
      tenantId,
      tenantRole: 'member',
    },
  };
}

describe('/api/voice/room', () => {
  const originalDailyApiKey = process.env.DAILY_API_KEY;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.DAILY_API_KEY = 'daily-test-key';
    process.env.DAILY_API_URL = 'https://daily.test/v1';
    mockResolveVoiceRoomActorContext.mockResolvedValue(actor('user-1', 'tenant-a'));
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'room-name', url: 'https://daily.test/room-name' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'daily-token' }), { status: 200 }));
  });

  afterAll(() => {
    process.env.DAILY_API_KEY = originalDailyApiKey;
  });

  it('rejects caller-supplied user ids that differ from the actor', async () => {
    const { POST } = require('../route');

    const response = await POST({
      json: async () => ({ tenantId: 'tenant-a', userId: 'user-2' }),
    } as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'user_forbidden' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('creates tenant-scoped room names from canonical actor identity', async () => {
    const { POST } = require('../route');

    const response = await POST({
      json: async () => ({ tenantId: 'tenant-a', userId: 'user-1' }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      roomUrl: 'https://daily.test/room-name',
      tenantId: 'tenant-a',
      token: 'daily-token',
      reused: false,
    });
    expect(body.roomName).toMatch(/^voice-[0-9a-f]{16}-[0-9a-f]{16}$/);
    expect(body.roomName).not.toBe('voice-user-1');
    const [, createInit] = (global.fetch as jest.Mock).mock.calls[1];
    expect(JSON.parse(createInit.body).name).toBe(body.roomName);
    const [, tokenInit] = (global.fetch as jest.Mock).mock.calls[2];
    expect(JSON.parse(tokenInit.body).properties).toMatchObject({
      room_name: body.roomName,
      user_id: 'user-1',
    });
  });

  it('uses different rooms for the same user in different tenants', async () => {
    const { POST } = require('../route');

    mockResolveVoiceRoomActorContext.mockResolvedValueOnce(actor('user-1', 'tenant-a'));
    const first = await POST({ json: async () => ({ tenantId: 'tenant-a' }) } as any);
    const firstBody = await first.json();

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'room-name-b', url: 'https://daily.test/room-name-b' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'daily-token-b' }), { status: 200 }));
    mockResolveVoiceRoomActorContext.mockResolvedValueOnce(actor('user-1', 'tenant-b'));
    const second = await POST({ json: async () => ({ tenantId: 'tenant-b' }) } as any);
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.roomName).not.toBe(secondBody.roomName);
  });
});

export {};
