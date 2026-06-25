const mockResolveDeleteRoomActorContext = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveDeleteRoomActorContext(...args),
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

describe('/api/voice/room/[roomName]', () => {
  const originalDailyApiKey = process.env.DAILY_API_KEY;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.DAILY_API_KEY = 'daily-test-key';
    process.env.DAILY_API_URL = 'https://daily.test/v1';
    mockResolveDeleteRoomActorContext.mockResolvedValue(actor('user-1', 'tenant-a'));
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterAll(() => {
    process.env.DAILY_API_KEY = originalDailyApiKey;
  });

  it('deletes only the exact tenant/user-scoped room owned by the actor', async () => {
    const createRoute = require('../../route');
    const { DELETE } = require('../route');
    const roomName = createRoute.getVoiceRoomName('tenant-a', 'user-1');

    const response = await DELETE(
      {
        url: 'https://app.example.com/api/voice/room/' + roomName + '?tenantId=tenant-a',
        headers: new Headers(),
      } as any,
      { params: { roomName } },
    );

    expect(response.status).toBe(200);
    expect(mockResolveDeleteRoomActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-a' });
    expect(global.fetch).toHaveBeenCalledWith(`https://daily.test/v1/rooms/${roomName}`, expect.objectContaining({
      method: 'DELETE',
    }));
  });

  it('rejects prefix collisions and legacy user-only room names', async () => {
    const { DELETE } = require('../route');

    const response = await DELETE(
      {
        url: 'https://app.example.com/api/voice/room/voice-user-1-suffix?tenantId=tenant-a',
        headers: new Headers(),
      } as any,
      { params: { roomName: 'voice-user-1-suffix' } },
    );

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not delete the same user hash from another tenant', async () => {
    const createRoute = require('../../route');
    const { DELETE } = require('../route');
    const otherTenantRoom = createRoute.getVoiceRoomName('tenant-b', 'user-1');

    const response = await DELETE(
      {
        url: 'https://app.example.com/api/voice/room/' + otherTenantRoom + '?tenantId=tenant-a',
        headers: new Headers(),
      } as any,
      { params: { roomName: otherTenantRoom } },
    );

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

export {};
