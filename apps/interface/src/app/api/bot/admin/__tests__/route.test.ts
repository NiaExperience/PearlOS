import { NextResponse } from 'next/server';

import { POST } from '../route';

const mockCreateBotClaimHeaders = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();
const mockSendBotMessage = jest.fn();

jest.mock('@interface/lib/bot-auth-claims', () => ({
  createBotClaimHeaders: (...args: unknown[]) => mockCreateBotClaimHeaders(...args),
}));

jest.mock('@interface/lib/bot-messaging-server', () => ({
  sendBotMessage: (...args: unknown[]) => mockSendBotMessage(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/bot/admin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockSendBotMessage.mockResolvedValue(new Response(
      JSON.stringify({ status: 'queued', message: 'ok', mode: 'queued', delivery_time: 1 }),
      { status: 200 },
    ));
  });

  it('sends bot admin messages with resolved actor identity, not caller tenant claims', async () => {
    const response = await POST({
      headers: new Headers({ 'x-session-id': 'session-1' }),
      json: async () => ({
        tenantId: 'tenant-spoof',
        message: 'hello',
        mode: 'queued',
        roomUrl: 'https://daily.example/room',
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
    expect(mockSendBotMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      senderId: 'user-1',
      senderName: 'Sam',
      roomUrl: 'https://daily.example/room',
    }));
  });

  it('does not send when the requested tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await POST({
      headers: new Headers(),
      json: async () => ({
        tenantId: 'tenant-b',
        message: 'hello',
        roomUrl: 'https://daily.example/room',
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockSendBotMessage).not.toHaveBeenCalled();
  });
});
