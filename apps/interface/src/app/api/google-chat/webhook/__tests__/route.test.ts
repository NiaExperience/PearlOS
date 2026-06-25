import { NextRequest } from 'next/server';

jest.mock('../../_lib/google-chat-link', () => ({
  consumeGoogleChatLinkCode: jest.fn(),
  extractGoogleChatLinkCode: jest.fn((text: string) => {
    const match = text.trim().toUpperCase().match(/^(?:LINK\s+)?([A-Z0-9]{6})$/);
    return match?.[1] || '';
  }),
  getGoogleChatLinkedAccountScope: jest.fn(),
  normalizeGoogleChatUserName: jest.fn((value: unknown) => (
    typeof value === 'string' && /^users\/[A-Za-z0-9._-]+$/.test(value.trim()) ? value.trim() : ''
  )),
}));

const {
  consumeGoogleChatLinkCode,
  getGoogleChatLinkedAccountScope,
} = jest.requireMock('../../_lib/google-chat-link');

const originalFetch = global.fetch;

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://app.pearlos.org/api/google-chat/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function googleChatMessageEvent(text: string) {
  return {
    type: 'MESSAGE',
    user: {
      name: 'users/111222333',
      displayName: 'Blair',
    },
    space: {
      name: 'spaces/AAA',
      displayName: 'PearlOS Test Space',
      type: 'ROOM',
    },
    message: {
      name: 'spaces/AAA/messages/msg-1',
      text,
      argumentText: text,
      thread: { name: 'spaces/AAA/threads/thread-1' },
    },
  };
}

async function importRoute() {
  return import('../route');
}

describe('/api/google-chat/webhook', () => {
  const originalEnv = {
    GOOGLE_CHAT_ENABLED: process.env.GOOGLE_CHAT_ENABLED,
    GOOGLE_CHAT_ALLOW_UNVERIFIED: process.env.GOOGLE_CHAT_ALLOW_UNVERIFIED,
    BOT_GATEWAY_URL: process.env.BOT_GATEWAY_URL,
    BOT_CONTROL_SHARED_SECRET: process.env.BOT_CONTROL_SHARED_SECRET,
    GOOGLE_CHAT_REPLY_TIMEOUT_MS: process.env.GOOGLE_CHAT_REPLY_TIMEOUT_MS,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GOOGLE_CHAT_ENABLED;
    delete process.env.GOOGLE_CHAT_ALLOW_UNVERIFIED;
    process.env.BOT_GATEWAY_URL = 'http://bot-gateway.local';
    process.env.BOT_CONTROL_SHARED_SECRET = 'shared-secret';
    process.env.GOOGLE_CHAT_REPLY_TIMEOUT_MS = '1000';
    global.fetch = jest.fn();
    consumeGoogleChatLinkCode.mockResolvedValue(null);
    getGoogleChatLinkedAccountScope.mockResolvedValue(null);
  });

  afterAll(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof originalEnv];
      } else {
        process.env[key as keyof typeof originalEnv] = value;
      }
    }
  });

  it('is disabled unless explicitly enabled for Public Pearl', async () => {
    const { GET, POST } = await importRoute();

    const getRes = await GET();
    const postRes = await POST(request(googleChatMessageEvent('hello')));

    expect(getRes.status).toBe(404);
    expect(postRes.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated Google Chat requests when enabled', async () => {
    process.env.GOOGLE_CHAT_ENABLED = '1';
    const { POST } = await importRoute();
    const res = await POST(request(googleChatMessageEvent('hello')));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('missing_google_chat_bearer_token');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('responds to add-to-space with link instructions', async () => {
    process.env.GOOGLE_CHAT_ENABLED = '1';
    process.env.GOOGLE_CHAT_ALLOW_UNVERIFIED = '1';
    const { POST } = await importRoute();

    const res = await POST(request({
      type: 'ADDED_TO_SPACE',
      space: {
        name: 'spaces/AAA',
        displayName: 'PearlOS Test Space',
      },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.text).toContain('Pearl is connected to PearlOS Test Space');
    expect(body.text).toContain('Link Google Chat');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks unlinked users before the bot gateway', async () => {
    process.env.GOOGLE_CHAT_ENABLED = '1';
    process.env.GOOGLE_CHAT_ALLOW_UNVERIFIED = '1';
    const { POST } = await importRoute();

    const res = await POST(request(googleChatMessageEvent('can you hear me?')));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.text).toContain('link Google Chat');
    expect(getGoogleChatLinkedAccountScope).toHaveBeenCalledWith('users/111222333');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('links a Google Chat identity when the user sends a valid code', async () => {
    process.env.GOOGLE_CHAT_ENABLED = '1';
    process.env.GOOGLE_CHAT_ALLOW_UNVERIFIED = '1';
    consumeGoogleChatLinkCode.mockResolvedValueOnce({
      linked: true,
      googleChatUserName: 'users/111222333',
      googleChatDisplayName: 'Blair',
      verifiedAt: '2026-06-20T00:00:00.000Z',
    });

    const { POST } = await importRoute();
    const res = await POST(request(googleChatMessageEvent('link ABC123')));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.text).toContain('Google Chat is linked');
    expect(consumeGoogleChatLinkCode).toHaveBeenCalledWith({
      code: 'ABC123',
      googleChatUserName: 'users/111222333',
      googleChatDisplayName: 'Blair',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('forwards linked message events through the bot gateway with the PearlOS user scope', async () => {
    process.env.GOOGLE_CHAT_ENABLED = '1';
    process.env.GOOGLE_CHAT_ALLOW_UNVERIFIED = '1';
    getGoogleChatLinkedAccountScope.mockResolvedValueOnce({
      googleChatUserName: 'users/111222333',
      userId: 'user-1',
      email: 'blair@example.com',
      userName: 'Blair',
      tenantId: 'tenant-public',
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"from Pearl"}}]}',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const { POST } = await importRoute();
    const res = await POST(request(googleChatMessageEvent('<users/app> can you hear me?')));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      text: 'Hello from Pearl',
      thread: { name: 'spaces/AAA/threads/thread-1' },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://bot-gateway.local/api/chat');
    expect(init.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer shared-secret',
      'X-Bot-Secret': 'shared-secret',
      'x-pearl-surface': 'google-chat',
      'x-user-id': 'user-1',
      'x-user-email': 'blair@example.com',
      'x-tenant-id': 'tenant-public',
      'x-pearl-tenant-id': 'tenant-public',
    }));
    const forwarded = JSON.parse(init.body);
    expect(forwarded.messages[1]).toEqual({
      role: 'user',
      content: 'can you hear me?',
    });
  });
});
