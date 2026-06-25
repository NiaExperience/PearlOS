import { NextResponse } from 'next/server';

import { PUT } from '../route';

const mockFindById = jest.fn();
const mockUpdate = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions/sprite-actions', () => ({
  findById: (...args: unknown[]) => mockFindById(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

function request(body: Record<string, unknown>, url = 'https://app.example.com/api/summon-ai-sprite/sprite-a/bot-config') {
  return {
    nextUrl: new URL(url),
    json: async () => body,
  } as any;
}

function context(id = 'sprite-a') {
  return { params: Promise.resolve({ id }) };
}

function botConfig(overrides: Record<string, unknown> = {}) {
  return {
    botType: 'assistant',
    tools: ['bot_list_notes'],
    systemPrompt: 'Help with notes.',
    greeting: 'Ready.',
    behaviors: [],
    ...overrides,
  };
}

function sprite(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'sprite-a',
    parent_id: 'user-1',
    tenantId: 'tenant-a',
    name: 'Tenant Sprite',
    ...overrides,
  };
}

describe('/api/summon-ai-sprite/[id]/bot-config', () => {
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
    mockUpdate.mockResolvedValue(sprite({ botConfig: botConfig() }));
  });

  it('updates bot config only through the resolved actor tenant', async () => {
    const response = await PUT(request({
      tenantId: 'tenant-spoof',
      botConfig: botConfig(),
    }), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockUpdate).toHaveBeenCalledWith('sprite-a', { botConfig: botConfig() });
    expect(body).toMatchObject({ ok: true });
  });

  it('does not update same-user sprites from another tenant', async () => {
    mockFindById.mockResolvedValueOnce(sprite({ tenantId: 'tenant-b' }));

    const response = await PUT(request({
      tenantId: 'tenant-a',
      botConfig: botConfig(),
    }), context());

    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not update a sprite when tenant resolution fails', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await PUT(request({
      tenantId: 'tenant-b',
      botConfig: botConfig(),
    }), context());

    expect(response.status).toBe(403);
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid bot config without updating', async () => {
    const response = await PUT(request({
      tenantId: 'tenant-a',
      botConfig: botConfig({ botType: 'root' }),
    }), context());

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
