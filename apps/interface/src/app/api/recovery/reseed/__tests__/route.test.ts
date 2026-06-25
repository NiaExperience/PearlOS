import { NextResponse } from 'next/server';

import { POST } from '../route';

const mockGetAssistantBySubDomain = jest.fn();
const mockCreateAssistant = jest.fn();
const mockUpdateAssistant = jest.fn();
const mockFindOrCreateTenantForAssistant = jest.fn();
const mockCreatePersonality = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions', () => ({
  AssistantActions: {
    getAssistantBySubDomain: (...args: unknown[]) => mockGetAssistantBySubDomain(...args),
    createAssistant: (...args: unknown[]) => mockCreateAssistant(...args),
    updateAssistant: (...args: unknown[]) => mockUpdateAssistant(...args),
  },
  TenantActions: {
    findOrCreateTenantForAssistant: (...args: unknown[]) => mockFindOrCreateTenantForAssistant(...args),
  },
  PersonalityActions: {
    createPersonality: (...args: unknown[]) => mockCreatePersonality(...args),
  },
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/recovery/reseed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAssistantBySubDomain.mockResolvedValue(null);
    mockFindOrCreateTenantForAssistant.mockResolvedValue('tenant-a');
    mockCreateAssistant.mockResolvedValue({ _id: 'assistant-1', tenantId: 'tenant-a' });
    mockUpdateAssistant.mockResolvedValue({ _id: 'assistant-1' });
    mockCreatePersonality.mockResolvedValue({ _id: 'personality-1' });
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'admin-1',
        userEmail: 'admin@example.com',
        userName: 'Admin',
        tenantId: 'tenant-a',
        tenantRole: 'admin',
      },
    });
  });

  function request(body: Record<string, unknown> = {}) {
    return {
      json: async () => body,
    };
  }

  it('rejects invalid assistant names before auth or mutation', async () => {
    const response = await POST(request({ assistantName: '../pearl' }) as any);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_assistant_name');
    expect(mockResolveInterfaceActorContext).not.toHaveBeenCalled();
    expect(mockGetAssistantBySubDomain).not.toHaveBeenCalled();
  });

  it('does not look up or create assistants when the actor lacks admin scope', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await POST(request({ assistantName: 'PearlOS', tenantId: 'tenant-b' }) as any);

    expect(response.status).toBe(403);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({
      requestedTenantId: 'tenant-b',
      minimumRole: 'admin',
    });
    expect(mockGetAssistantBySubDomain).not.toHaveBeenCalled();
    expect(mockCreateAssistant).not.toHaveBeenCalled();
  });

  it('requires admin scope on an existing assistant tenant before returning it', async () => {
    mockGetAssistantBySubDomain.mockResolvedValueOnce({ _id: 'assistant-b', tenantId: 'tenant-b' });
    mockResolveInterfaceActorContext
      .mockResolvedValueOnce({
        ok: true,
        actor: {
          userId: 'admin-1',
          userEmail: 'admin@example.com',
          userName: 'Admin',
          tenantId: 'tenant-a',
          tenantRole: 'admin',
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
      });

    const response = await POST(request({ assistantName: 'acme' }) as any);

    expect(response.status).toBe(403);
    expect(mockResolveInterfaceActorContext).toHaveBeenNthCalledWith(2, {
      requestedTenantId: 'tenant-b',
      minimumRole: 'admin',
    });
    expect(mockCreateAssistant).not.toHaveBeenCalled();
    expect(mockUpdateAssistant).not.toHaveBeenCalled();
  });

  it('creates and configures a missing assistant only for an admin-scoped actor', async () => {
    const response = await POST(request({ assistantName: 'Acme_Recovery', tenantId: 'tenant-a' }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockGetAssistantBySubDomain).toHaveBeenCalledWith('acme_recovery');
    expect(mockFindOrCreateTenantForAssistant).toHaveBeenCalledWith({
      name: 'Acme_recovery',
      subDomain: 'acme_recovery',
    }, expect.any(Object));
    expect(mockCreateAssistant).toHaveBeenCalledWith({
      name: 'Acme_recovery',
      subDomain: 'acme_recovery',
      tenantId: 'tenant-a',
    });
    expect(mockUpdateAssistant).toHaveBeenCalledWith('assistant-1', expect.objectContaining({
      name: 'Acme_recovery',
      subDomain: 'acme_recovery',
      tenantId: 'tenant-a',
      voiceProvider: 'pipecat',
    }));
    expect(mockCreatePersonality).toHaveBeenCalledWith('tenant-a', expect.objectContaining({
      key: 'pearl-default',
    }));
  });
});
