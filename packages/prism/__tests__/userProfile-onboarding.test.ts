/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';

import * as UserProfileActions from '../src/core/actions/userProfile-actions';
import { Prism } from '../src/prism';

describe('UserProfileActions onboardingComplete', () => {
  let prism: Prism | null = null;
  beforeAll(async () => {
    prism = await Prism.getInstance();
    expect(prism).not.toBeNull();
  });
  afterAll(async () => {
    if (prism) await prism.disconnect();
  });

  it('can set and update onboardingComplete as a root property', async () => {
    const userId = uuidv4();
    const email = `test-onboarding-${uuidv4()}@example.com`;

    // 1. Create profile with onboardingComplete = false (default or explicit)
    const created = await UserProfileActions.createOrUpdateUserProfile({
      userId,
      email,
      onboardingComplete: false,
      metadata: { foo: 'bar' }
    });
    
    expect(created).not.toBeNull();
    expect(created.userId).toBe(userId);
    expect(created.email).toBe(email);
    // Check root property
    expect(created.onboardingComplete).toBe(false);
    // Check metadata is preserved
    expect(created.metadata).toEqual({ foo: 'bar' });

    // 2. Update to true
    const updatedTrue = await UserProfileActions.createOrUpdateUserProfile({
      userId,
      email,
      onboardingComplete: true
    });

    expect(updatedTrue.onboardingComplete).toBe(true);
    // Metadata should persist if not overwritten, or be merged depending on implementation.
    // createOrUpdateUserProfile usually merges or preserves if not passed? 
    // Let's check if metadata is still there.
    expect(updatedTrue.metadata).toEqual({ foo: 'bar' });

    // 3. Update back to false
    const updatedFalse = await UserProfileActions.createOrUpdateUserProfile({
      userId,
      email,
      onboardingComplete: false
    });

    expect(updatedFalse.onboardingComplete).toBe(false);
  });
});
