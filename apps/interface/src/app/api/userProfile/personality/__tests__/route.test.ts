import { NextResponse } from 'next/server';

import { PATCH } from '../route';

const mockCreateOrUpdateUserProfile = jest.fn();
const mockGetPersonalityById = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions/userProfile-actions', () => ({
  createOrUpdateUserProfile: (...args: unknown[]) => mockCreateOrUpdateUserProfile(...args),
}));

jest.mock('@nia/prism/core/actions/personality.actions', () => ({
  getPersonalityById: (...args: unknown[]) => mockGetPersonalityById(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

function request(body: Record<string, unknown>) {
  return {
    json: async () => body,
  } as any;
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    personalityId: 'personality-a',
    name: 'Caller supplied name',
    voiceId: 'voice-1',
    voiceProvider: 'cartesia',
    ...overrides,
  };
}

describe('/api/userProfile/personality', () => {
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
      _id: 'personality-a',
      tenantId: 'tenant-a',
      name: 'Tenant A Pearl',
    });
    mockCreateOrUpdateUserProfile.mockResolvedValue({
      _id: 'profile-1',
      userId: 'user-1',
      email: 'sam@example.com',
    });
  });

  it('stores a personality preference using the resolved actor identity and tenant-scoped personality', async () => {
    const response = await PATCH(request({
      tenantId: 'tenant-a',
      personalityVoiceConfig: config(),
    }));

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-a' });
    expect(mockGetPersonalityById).toHaveBeenCalledWith('personality-a', 'tenant-a');
    expect(mockCreateOrUpdateUserProfile).toHaveBeenCalledWith(
      {
        email: 'sam@example.com',
        userId: 'user-1',
        personalityVoiceConfig: expect.objectContaining({
          personalityId: 'personality-a',
          name: 'Tenant A Pearl',
          voiceId: 'voice-1',
          voiceProvider: 'cartesia',
        }),
      },
      false,
    );
  });

  it('does not write a preference when tenant resolution rejects the caller claim', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await PATCH(request({
      tenantId: 'tenant-b',
      personalityVoiceConfig: config(),
    }));

    expect(response.status).toBe(403);
    expect(mockGetPersonalityById).not.toHaveBeenCalled();
    expect(mockCreateOrUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('does not write a preference for a personality outside the resolved tenant', async () => {
    mockGetPersonalityById.mockResolvedValueOnce(undefined);

    const response = await PATCH(request({
      tenantId: 'tenant-a',
      personalityVoiceConfig: config({ personalityId: 'personality-b' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('personality_forbidden');
    expect(mockCreateOrUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects incomplete personality configs before tenant or profile side effects', async () => {
    const response = await PATCH(request({
      tenantId: 'tenant-a',
      personalityVoiceConfig: config({ voiceProvider: '' }),
    }));

    expect(response.status).toBe(400);
    expect(mockResolveInterfaceActorContext).not.toHaveBeenCalled();
    expect(mockGetPersonalityById).not.toHaveBeenCalled();
    expect(mockCreateOrUpdateUserProfile).not.toHaveBeenCalled();
  });
});
