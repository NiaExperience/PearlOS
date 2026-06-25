import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

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

import { POST } from '../route';
import { GET as FEATURES_GET } from '../../features/route';

let storeFile: string;

function req(body: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as any;
}

function profileWithLedger(ledger: unknown[]) {
  return {
    userProfile: {
      _id: 'p-alice',
      userId: 'alice-id',
      email: 'alice@example.com',
      privateMemory: {
        preferences: { pearlOSSettings: { personalChangeLedger: ledger } },
      },
    },
  };
}

const APPLIED_ITEM = {
  id: 'task-9',
  title: 'Calmer desktop',
  kind: 'ui_manifest',
  status: 'applied',
  summary: 'Applied a calmer low-contrast theme.',
  artifactPath: '/srv/pearl-user-workspaces/tenant-a/alice/task-9/pearlos-ui-customization.json',
  shareEligible: true,
};

describe('/api/our-pearlos/share', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    storeFile = path.join(os.tmpdir(), `pearlos-shared-features-${process.pid}-${Date.now()}.json`);
    process.env.PEARL_SHARED_FEATURES_FILE = storeFile;
    await fs.rm(storeFile, { force: true });
    mockGetSession.mockResolvedValue({ user: { id: 'alice-id', email: 'alice@example.com', tenantId: 'tenant-a' } });
    mockCreateOrUpdate.mockResolvedValue({ _id: 'p-alice' });
  });

  afterEach(async () => {
    await fs.rm(storeFile, { force: true });
    delete process.env.PEARL_SHARED_FEATURES_FILE;
  });

  it('rejects an unauthenticated request', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(req({ ledgerItemId: 'task-9' }));
    expect(res.status).toBe(401);
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  it('rejects a request with no ledger item id', async () => {
    mockFindByUser.mockResolvedValue(profileWithLedger([APPLIED_ITEM]));
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_ledger_item');
  });

  it('returns 404 when the item is not in the owner ledger', async () => {
    mockFindByUser.mockResolvedValue(profileWithLedger([APPLIED_ITEM]));
    const res = await POST(req({ ledgerItemId: 'does-not-exist' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('item_not_found');
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  it('refuses to share an item that is not share-eligible', async () => {
    mockFindByUser.mockResolvedValue(
      profileWithLedger([{ id: 'task-x', kind: 'code_artifact', status: 'needs_review' }])
    );
    const res = await POST(req({ ledgerItemId: 'task-x' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_shareable');
    const onDisk = await fs.readFile(storeFile, 'utf-8').catch(() => null);
    expect(onDisk).toBeNull();
  });

  it('publishes an applied change as a public community feature and stamps the ledger', async () => {
    mockFindByUser.mockResolvedValue(profileWithLedger([APPLIED_ITEM]));
    const res = await POST(req({ ledgerItemId: 'task-9', category: 'Interface' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Public projection: discovery metadata only.
    expect(json.feature).toEqual(
      expect.objectContaining({
        id: 'shared-task-9',
        title: 'Calmer desktop',
        status: 'community',
        votable: true,
        hasVoted: false,
      })
    );
    expect(json.feature).not.toHaveProperty('artifactPath');
    expect(json.feature).not.toHaveProperty('sharedByUserId');
    expect(json.feature).not.toHaveProperty('playUrl');

    // Ledger item stamped with share metadata, persisted to the owner profile.
    expect(json.item.share).toEqual(
      expect.objectContaining({ publicFeatureId: 'shared-task-9', status: 'public' })
    );
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    const saved = mockCreateOrUpdate.mock.calls[0][0];
    const savedLedger = saved.privateMemory.preferences.pearlOSSettings.personalChangeLedger;
    expect(savedLedger[0].share.publicFeatureId).toBe('shared-task-9');

    // Durable store now carries the artifact path for later incorporation.
    const onDisk = JSON.parse(await fs.readFile(storeFile, 'utf-8'));
    expect(onDisk.features[0]).toEqual(
      expect.objectContaining({
        id: 'shared-task-9',
        sharedByUserId: 'alice-id',
        sharedByTenantId: 'tenant-a',
        artifactPath: APPLIED_ITEM.artifactPath,
      })
    );
  });

  it('does not let one user share another user\'s change (tenancy + owner-only)', async () => {
    // Bob is signed in; his own ledger does not contain Alice's item.
    mockGetSession.mockResolvedValue({ user: { id: 'bob-id', email: 'bob@example.com', tenantId: 'tenant-b' } });
    mockFindByUser.mockResolvedValue({
      userProfile: {
        _id: 'p-bob',
        userId: 'bob-id',
        email: 'bob@example.com',
        privateMemory: { preferences: { pearlOSSettings: { personalChangeLedger: [] } } },
      },
    });
    const res = await POST(req({ ledgerItemId: 'task-9' }));
    expect(res.status).toBe(404);
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  it('surfaces the shared feature in the public catalog read for everyone', async () => {
    mockFindByUser.mockResolvedValue(profileWithLedger([APPLIED_ITEM]));
    const shareRes = await POST(req({ ledgerItemId: 'task-9' }));
    expect(shareRes.status).toBe(200);

    // An unauthenticated reader still sees the published community feature.
    mockGetSession.mockResolvedValue(null);
    const featuresRes = await FEATURES_GET(req({}));
    expect(featuresRes.status).toBe(200);
    const body = await featuresRes.json();
    const community = body.catalog.community as Array<{ id: string }>;
    expect(community.some((f) => f.id === 'shared-task-9')).toBe(true);
  });
});
