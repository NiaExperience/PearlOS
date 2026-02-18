/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';

import * as UserProfileActions from '../src/core/actions/userProfile-actions';
import { BlockType_UserProfile, IUserProfile } from '../src/core/blocks/userProfile.block';
import { Prism } from '../src/prism';

// Helper to create a bare UserProfile with only email and metadata (no userId)
async function createEmailOnlyUserProfile(email: string, metadata?: Record<string, any>) {
  const prism = await Prism.getInstance();
  const res = await prism.create(BlockType_UserProfile, { email, metadata } as any);
  expect(res.total).toBe(1);
  return res.items[0] as IUserProfile & { _id: string };
}

// Minimal user object for findByUser()
function makeUser(id: string, email: string) {
  return { id, email, name: 'Test User' } as { id: string; email: string; name?: string };
}

describe('UserProfileActions.findByUser backfills userId when only email exists', () => {
  let prism: Prism | null = null;
  beforeAll(async () => {
    prism = await Prism.getInstance();
    expect(prism).not.toBeNull();
  });
  afterAll(async () => {
    if (prism) await prism.disconnect();
  });

  it('backfills userId on email-only UserProfile and can be read via findByUserId', async () => {
  const email = `test-userprofile-${uuidv4()}@example.com`;
  const metadata = { likes: ['testing'], avg_day: 'coding' } as any;

    // 1) Seed an email-only UserProfile (no userId)
    const created = await createEmailOnlyUserProfile(email, metadata);
    expect(created.email).toBe(email);
    expect((created as any).userId).toBeUndefined();

    // 2) Call findByUser with a user containing id+email
    const userId = uuidv4();
    const user = makeUser(userId, email);
    const beforeBackfill = await UserProfileActions.findByEmail(email);
    expect(beforeBackfill?.userProfile?.userId).toBeUndefined();

    const found = await UserProfileActions.findByUser(user.id, user.email);
    expect(found).not.toBeNull();
    expect(found?.userProfile.email).toBe(email);

    // 3) Verify backfill: userId is now populated on the same record
    const afterBackfillEmail = await UserProfileActions.findByEmail(email);
    expect(afterBackfillEmail?.userProfile?.userId).toBe(userId);

    const afterBackfillByUserId = await UserProfileActions.findByUserId(userId);
    expect(afterBackfillByUserId?.userProfile?.email).toBe(email);

    // Sanity: ensure record id unchanged
    const reloaded = afterBackfillEmail!.userProfile as any;
    expect(reloaded._id || reloaded.page_id).toBe(created._id || (created as any).page_id);
  });
});
