import { randomUUID } from 'crypto';

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';

import { Prism } from '../../../packages/prism/src/prism';

/**
 * Tests to validate metadata deletion workflows
 * 
 * These tests verify that deleting metadata keys works correctly through both:
 * 1. Settings UI (uses PUT with REPLACE operation)
 * 2. Bot API (uses PATCH through Mesh content API)
 */
describe('UserProfile Metadata Deletion Workflows', () => {
  let prism: Prism;
  let testUserId: string;
  let testProfileId: string;

  beforeAll(async () => {
    // Connect to test Prism instance
    prism = await Prism.getInstance();
    testUserId = randomUUID();
    
    // Create a test UserProfile with metadata
    const result = await prism.create('UserProfile', {
      first_name: 'Test User',
      email: 'test@example.com',
      userId: testUserId,
      metadata: {
        dogs: { name: 'Fido', age: 5, breed: 'Golden Retriever' },
        cats: { name: 'Whiskers', color: 'Orange' },
        birds: { name: 'Tweety', species: 'Canary' }
      }
    });
    
    testProfileId = result.items[0]._id;
    
    // eslint-disable-next-line no-console
    console.log('✅ Created test UserProfile:', testProfileId);
  });

  afterAll(async () => {
    // Cleanup: delete test profile
    if (testProfileId) {
      await prism.delete('UserProfile', testProfileId, 'any');
      // eslint-disable-next-line no-console
      console.log('🧹 Cleaned up test UserProfile:', testProfileId);
    }
  });

  test('should delete metadata key via REPLACE operation (Settings UI workflow)', async () => {
    // Simulate Settings UI workflow
    // 1. Fetch current profile
    const existing = await prism.query({
      contentType: 'UserProfile',
      where: { page_id: { eq: testProfileId } },
      limit: 1,
      tenantId: 'any'
    });
    
    expect(existing.total).toBe(1);
    const profile = existing.items[0];
    
    // Verify initial state
    expect(profile.metadata).toHaveProperty('dogs');
    expect(profile.metadata).toHaveProperty('cats');
    expect(profile.metadata).toHaveProperty('birds');
    
    // 2. User deletes "birds" key
    const updatedMetadata = { ...profile.metadata };
    delete updatedMetadata.birds;
    
    // 3. Save with REPLACE operation (simulating PUT with metadataOperation: 'REPLACE')
    const updated = await prism.update('UserProfile', testProfileId, {
      first_name: profile.first_name,
      email: profile.email,
      userId: profile.userId,
      metadata: updatedMetadata
    }, 'any');
    
    expect(updated.total).toBe(1);
    const updatedProfile = updated.items[0];
    
    // Verify birds was deleted
    expect(updatedProfile.metadata).toHaveProperty('dogs');
    expect(updatedProfile.metadata).toHaveProperty('cats');
    expect(updatedProfile.metadata).not.toHaveProperty('birds');
    
    // eslint-disable-next-line no-console
    console.log('✅ Settings UI workflow: Successfully deleted "birds" key');
  });

  test('should delete metadata key via content update (Bot API workflow)', async () => {
    // First, restore birds for this test
    await prism.update('UserProfile', testProfileId, {
      metadata: {
        dogs: { name: 'Fido', age: 5, breed: 'Golden Retriever' },
        cats: { name: 'Whiskers', color: 'Orange' },
        birds: { name: 'Tweety', species: 'Canary' }
      }
    }, 'any');
    
    // Simulate Bot API workflow
    // 1. Fetch current profile
    const existing = await prism.query({
      contentType: 'UserProfile',
      where: { page_id: { eq: testProfileId } },
      limit: 1,
      tenantId: 'any'
    });
    
    const profile = existing.items[0];
    expect(profile.metadata).toHaveProperty('birds');
    
    // 2. Bot removes "birds" key locally
    const modifiedMetadata = { ...profile.metadata };
    delete modifiedMetadata.birds;
    
    // 3. Send PATCH with modified metadata (simulating Mesh PATCH /content/UserProfile/{id})
    const updated = await prism.update('UserProfile', testProfileId, {
      metadata: modifiedMetadata
    }, 'any');
    
    expect(updated.total).toBe(1);
    const updatedProfile = updated.items[0];
    
    // Verify birds was deleted
    expect(updatedProfile.metadata).toHaveProperty('dogs');
    expect(updatedProfile.metadata).toHaveProperty('cats');
    expect(updatedProfile.metadata).not.toHaveProperty('birds');
    
    // eslint-disable-next-line no-console
    console.log('✅ Bot API workflow: Successfully deleted "birds" key');
  });

  test('should allow deleting multiple metadata keys at once', async () => {
    // Restore all keys
    await prism.update('UserProfile', testProfileId, {
      metadata: {
        dogs: { name: 'Fido', age: 5, breed: 'Golden Retriever' },
        cats: { name: 'Whiskers', color: 'Orange' },
        birds: { name: 'Tweety', species: 'Canary' }
      }
    }, 'any');
    
    // Fetch current
    const existing = await prism.query({
      contentType: 'UserProfile',
      where: { page_id: { eq: testProfileId } },
      limit: 1,
      tenantId: 'any'
    });
    
    const profile = existing.items[0];
    
    // Delete both cats and birds
    const modifiedMetadata = { ...profile.metadata };
    delete modifiedMetadata.cats;
    delete modifiedMetadata.birds;
    
    // Update
    const updated = await prism.update('UserProfile', testProfileId, {
      metadata: modifiedMetadata
    }, 'any');
    
    expect(updated.total).toBe(1);
    const updatedProfile = updated.items[0];
    
    // Verify only dogs remains
    expect(updatedProfile.metadata).toHaveProperty('dogs');
    expect(updatedProfile.metadata).not.toHaveProperty('cats');
    expect(updatedProfile.metadata).not.toHaveProperty('birds');
    
    // eslint-disable-next-line no-console
    console.log('✅ Multiple deletion: Successfully deleted "cats" and "birds" keys');
  });

  test('should preserve nested object structure when deleting sibling keys', async () => {
    // Restore all keys
    await prism.update('UserProfile', testProfileId, {
      metadata: {
        dogs: { name: 'Fido', age: 5, breed: 'Golden Retriever' },
        cats: { name: 'Whiskers', color: 'Orange' },
        birds: { name: 'Tweety', species: 'Canary' }
      }
    }, 'any');
    
    // Fetch current
    const existing = await prism.query({
      contentType: 'UserProfile',
      where: { page_id: { eq: testProfileId } },
      limit: 1,
      tenantId: 'any'
    });
    
    const profile = existing.items[0];
    
    // Delete only birds, keep full structure of dogs and cats
    const modifiedMetadata = {
      dogs: profile.metadata.dogs,
      cats: profile.metadata.cats
    };
    
    // Update
    const updated = await prism.update('UserProfile', testProfileId, {
      metadata: modifiedMetadata
    }, 'any');
    
    expect(updated.total).toBe(1);
    const updatedProfile = updated.items[0];
    
    // Verify nested structures are preserved
    expect(updatedProfile.metadata.dogs).toEqual({
      name: 'Fido',
      age: 5,
      breed: 'Golden Retriever'
    });
    expect(updatedProfile.metadata.cats).toEqual({
      name: 'Whiskers',
      color: 'Orange'
    });
    expect(updatedProfile.metadata).not.toHaveProperty('birds');
    
    // eslint-disable-next-line no-console
    console.log('✅ Nested structure: Preserved dogs and cats details while deleting birds');
  });
});
