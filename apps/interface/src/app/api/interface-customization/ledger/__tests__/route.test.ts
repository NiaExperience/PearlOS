const mockFindByUser = jest.fn();
const mockCreateOrUpdate = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@nia/prism/core/actions', () => ({
  UserProfileActions: {
    findByUser: (...args: unknown[]) => mockFindByUser(...args),
    createOrUpdateUserProfile: (...args: unknown[]) => mockCreateOrUpdate(...args),
  },
}));

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: (...args: unknown[]) => mockGetSession(...args),
}));

jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: {} }));

import { GET, POST } from '../route';

const SECRET = 'bot-secret';

function postReq(body: unknown, headers: Record<string, string> = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (k: string) => headerMap.get(k.toLowerCase()) ?? null },
    json: async () => body,
  } as any;
}

describe('/api/interface-customization/ledger', () => {
  const originalSecret = process.env.BOT_CONTROL_SHARED_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOT_CONTROL_SHARED_SECRET = SECRET;
    mockFindByUser.mockResolvedValue({ userProfile: { _id: 'p1', userId: 'alice-id', email: 'alice@example.com', privateMemory: {} } });
    mockCreateOrUpdate.mockResolvedValue({ _id: 'p1' });
  });

  afterAll(() => {
    process.env.BOT_CONTROL_SHARED_SECRET = originalSecret;
  });

  it('rejects POST without the bot secret', async () => {
    const res = await POST(postReq({ requester_user_id: 'alice-id', item: { id: 'x' } }));
    expect(res.status).toBe(401);
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  it('rejects POST with the wrong bot secret', async () => {
    const res = await POST(
      postReq({ requester_user_id: 'alice-id', item: { id: 'x' } }, { 'x-bot-secret': 'nope' })
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST with no requester identity', async () => {
    const res = await POST(postReq({ item: { id: 'x' } }, { 'x-bot-secret': SECRET }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_requester');
  });

  it('rejects POST with an invalid ledger item', async () => {
    const res = await POST(
      postReq({ requester_user_id: 'alice-id', item: { title: 'no id' } }, { 'x-bot-secret': SECRET })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_ledger_item');
  });

  it('upserts a ledger item scoped to the requester', async () => {
    const res = await POST(
      postReq(
        {
          requester_user_id: 'alice-id',
          requester_email: 'alice@example.com',
          item: {
            id: 'task-9-ui_manifest',
            title: 'Calmer desktop',
            kind: 'ui_manifest',
            status: 'applied',
            shareEligible: true,
          },
        },
        { authorization: `Bearer ${SECRET}` }
      )
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.item.id).toBe('task-9-ui_manifest');
    expect(json.item.shareEligible).toBe(true);

    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    const saved = mockCreateOrUpdate.mock.calls[0][0];
    expect(saved.userId).toBe('alice-id');
    const prefs = saved.privateMemory.preferences.pearlOSSettings;
    expect(prefs.personalChangeLedger).toHaveLength(1);
    expect(prefs.personalChangeLedger[0].id).toBe('task-9-ui_manifest');
  });

  it('returns the signed-in user ledger on GET', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'alice-id', email: 'alice@example.com' } });
    mockFindByUser.mockResolvedValue({
      userProfile: {
        privateMemory: {
          preferences: {
            pearlOSSettings: {
              personalChangeLedger: [
                { id: 'task-9-ui_manifest', kind: 'ui_manifest', status: 'applied' },
              ],
            },
          },
        },
      },
    });

    const res = await GET(postReq({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.ledger).toHaveLength(1);
    expect(json.ledger[0].id).toBe('task-9-ui_manifest');
  });
});
