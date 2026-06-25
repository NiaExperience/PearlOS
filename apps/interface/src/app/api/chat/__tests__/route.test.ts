import { POST } from '../route';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

jest.mock('@interface/lib/api-auth', () => ({
  requireAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: jest.fn().mockResolvedValue({
    ok: true,
    actor: {
      userId: 'user-1',
      userEmail: 'sam@example.com',
      userName: 'Sam',
      tenantId: 'tenant-a',
      tenantRole: 'member',
    },
  }),
}));

describe('/api/chat', () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue(
      new Response('data: {"ok":true}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
  });

  afterEach(async () => {
    delete process.env.CHAT_UPLOAD_DIR;
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it('overwrites caller-supplied tenant and session identity before forwarding', async () => {
    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-a',
        tenant_id: 'tenant-spoof',
        requester_tenant_id: 'tenant-spoof',
        requester_user_id: 'user-spoof',
        requester_email: 'spoof@example.com',
        user_id: 'user-spoof',
        user_email: 'spoof@example.com',
        sessionUserId: 'user-spoof',
        sessionUserEmail: 'spoof@example.com',
        sessionUserName: 'Blair',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    } as any);

    expect(response.status).toBe(200);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).toMatchObject({
      'x-user-id': 'user-1',
      'x-user-email': 'sam@example.com',
      'x-tenant-id': 'tenant-a',
      'x-pearl-tenant-id': 'tenant-a',
      'x-user-name': 'Sam',
    });
    expect(JSON.parse(init.body)).toMatchObject({
      tenantId: 'tenant-a',
      tenant_id: 'tenant-a',
      requester_tenant_id: 'tenant-a',
      requester_user_id: 'user-1',
      requester_email: 'sam@example.com',
      user_id: 'user-1',
      user_email: 'sam@example.com',
      sessionUserId: 'user-1',
      sessionUserEmail: 'sam@example.com',
      sessionUserName: 'Sam',
    });
  });

  it('rejects non-object JSON bodies', async () => {
    const response = await POST({
      json: async () => ['not', 'an', 'object'],
    } as any);

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('preserves multimodal image content while adding scoped identity', async () => {
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    const response = await POST({
      json: async () => ({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is in this image?' },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    } as any);

    expect(response.status).toBe(200);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);

    expect(forwarded.messages[0].content).toEqual([
      { type: 'text', text: 'what is in this image?' },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ]);
    expect(forwarded.requester_user_id).toBe('user-1');
    expect(forwarded.requester_tenant_id).toBe('tenant-a');
  });

  it('recovers stored image attachments when the client sends text-only upload context', async () => {
    const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pearl-chat-upload-'));
    tempDirs.push(uploadRoot);
    process.env.CHAT_UPLOAD_DIR = uploadRoot;

    const imagePath = path.join(uploadRoot, 'user-1', '2026-06-16', 'sir.png');
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(imagePath, Buffer.from('png-bytes'));

    const response = await POST({
      json: async () => ({
        messages: [
          {
            role: 'user',
            content: [
              'Can you help me work through this SIR?',
              '[User attached a file]',
              'Filename: sir.png',
              'MIME: image/png',
              'Kind: image',
              `Stored path: ${imagePath}`,
            ].join('\n'),
          },
        ],
      }),
    } as any);

    expect(response.status).toBe(200);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);

    expect(forwarded.messages[0].content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('Can you help me work through this SIR?'),
      },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}` },
      },
    ]);
  });
});
