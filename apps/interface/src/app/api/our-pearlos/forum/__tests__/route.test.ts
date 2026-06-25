import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const mockFindByUser = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@nia/prism/core/actions', () => ({
  UserProfileActions: {
    findByUser: (...args: unknown[]) => mockFindByUser(...args),
  },
}));

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: (...args: unknown[]) => mockGetSession(...args),
}));

jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: {} }));

import { GET, POST } from '../route';

let tempDir = '';

function req(body?: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body ?? {},
  } as any;
}

describe('/api/our-pearlos/forum', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'our-pearlos-forum-'));
    process.env.PEARL_OUR_PEARLOS_FORUM_FILE = path.join(tempDir, 'forum.json');
    mockGetSession.mockResolvedValue(null);
    mockFindByUser.mockResolvedValue(null);
  });

  afterEach(async () => {
    delete process.env.PEARL_OUR_PEARLOS_FORUM_FILE;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('returns an empty public forum for signed-out readers', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, signedIn: false, viewerLabel: null, topics: [] });
  });

  it('rejects signed-out posts', async () => {
    const res = await POST(req({ action: 'topic', title: 'Hello', body: 'World' }));
    expect(res.status).toBe(401);
  });

  it('creates topics with a server-derived public author label', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'blair-id', name: 'Blair Erickson', email: 'blair@niaxp.com' },
    });
    mockFindByUser.mockResolvedValue({
      userProfile: { first_name: 'Blair', publicPersona: {}, privateMemory: {} },
    });

    const res = await POST(req({
      action: 'topic',
      title: 'Small forum',
      body: 'This should be signed by the server.',
      authorLabel: 'Fake Name',
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.topic.authorLabel).toBe('Blair E.');
    expect(json.topic.authorLabel).not.toBe('Fake Name');
  });

  it('adds replies to an existing topic', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'blair-id', name: 'Blair Erickson', email: 'blair@niaxp.com' },
    });
    mockFindByUser.mockResolvedValue({
      userProfile: { first_name: 'Blair', publicPersona: {}, privateMemory: {} },
    });

    const topicRes = await POST(req({ action: 'topic', title: 'Thread', body: 'Opening post' }));
    const topic = (await topicRes.json()).topic;
    const replyRes = await POST(req({ action: 'reply', topicId: topic.id, body: 'First reply' }));
    expect(replyRes.status).toBe(200);
    const json = await replyRes.json();
    expect(json.topic.replyCount).toBe(1);
    expect(json.topic.replies[0]).toMatchObject({ body: 'First reply', authorLabel: 'Blair E.' });
  });
});
