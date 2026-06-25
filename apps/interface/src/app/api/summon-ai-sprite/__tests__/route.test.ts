import { NextResponse } from 'next/server';

import { POST } from '../route';

const mockCreateSprite = jest.fn();
const mockGenerateSpriteImage = jest.fn();
const mockCleanSpriteBackground = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();
const mockCreateJob = jest.fn();
const mockUpdateJob = jest.fn();

jest.mock('@nia/prism/core/actions/sprite-actions', () => ({
  create: (...args: unknown[]) => mockCreateSprite(...args),
}));

jest.mock('@interface/lib/openrouter-image', () => ({
  generateSpriteImage: (...args: unknown[]) => mockGenerateSpriteImage(...args),
  getModelRankingFor: jest.fn(() => ['test-model']),
  wrapPromptForKind: jest.fn((kind: string, prompt: string) => `${kind}:${prompt}`),
}));

jest.mock('@interface/lib/sprite-postprocess', () => ({
  cleanSpriteBackground: (...args: unknown[]) => mockCleanSpriteBackground(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

jest.mock('../jobStore', () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  updateJob: (...args: unknown[]) => mockUpdateJob(...args),
}));

function request(body: Record<string, unknown>) {
  return {
    json: async () => body,
  } as any;
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

describe('/api/summon-ai-sprite', () => {
  const oldOpenRouterKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"passed":true,"score":9,"reason":"ok"}' } }],
      }),
    } as any);
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
    mockCreateJob.mockReturnValue({ jobId: 'job-1' });
    mockGenerateSpriteImage.mockResolvedValue({
      png: Buffer.from('generated-png'),
      mimeType: 'image/png',
      model: 'openrouter/test-image-model',
    });
    mockCleanSpriteBackground.mockResolvedValue(Buffer.from('clean-png'));
    mockCreateSprite.mockResolvedValue({
      _id: 'sprite-1',
      name: 'Detailed Tenant Sprite',
    });
  });

  afterAll(() => {
    if (oldOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = oldOpenRouterKey;
    }
  });

  it('persists sprites with the resolved actor identity, not caller tenant claims', async () => {
    const response = await POST(request({
      tenantId: 'tenant-spoof',
      prompt: 'Detailed tenant sprite with a silver cloak, blue lantern, bright boots, and careful pixel art shading',
    }));
    const output = await readStream(response as Response);

    expect(response.status).toBe(200);
    expect(output).toContain('"type":"result"');
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockCreateSprite).toHaveBeenCalledWith(expect.objectContaining({
      parent_id: 'user-1',
      tenantId: 'tenant-a',
      originalRequest: 'Detailed tenant sprite with a silver cloak, blue lantern, bright boots, and careful pixel art shading',
    }));
  });

  it('does not create a job or spend image generation when tenant resolution fails', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await POST(request({
      tenantId: 'tenant-b',
      prompt: 'Make a small wizard sprite',
    }));

    expect(response.status).toBe(403);
    expect(mockCreateJob).not.toHaveBeenCalled();
    expect(mockGenerateSpriteImage).not.toHaveBeenCalled();
    expect(mockCreateSprite).not.toHaveBeenCalled();
  });

  it('rejects invalid prompts before tenant, job, or model side effects', async () => {
    const response = await POST(request({
      tenantId: 'tenant-a',
      prompt: '   ',
    }));

    expect(response.status).toBe(400);
    expect(mockResolveInterfaceActorContext).not.toHaveBeenCalled();
    expect(mockCreateJob).not.toHaveBeenCalled();
    expect(mockGenerateSpriteImage).not.toHaveBeenCalled();
  });
});
