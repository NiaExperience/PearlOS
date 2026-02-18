/**
 * Phase 1 Integration Tests: PostgreSQL JSONB Partial Update Support
 * 
 * ⚠️  IMPORTANT: These are INTEGRATION tests that require a live Mesh server
 * 
 * Prerequisites:
 * - Mesh server running on http://localhost:2000/graphql (NOT in test mode)
 * - Real PostgreSQL database (not pg-mem)
 * - ENABLE_PARTIAL_UPDATES=true environment variable
 * - NODE_ENV should NOT be 'test' (to test optimization paths)
 * 
 * To run these tests:
 * 1. Start local Mesh server: npm run dev --workspace=mesh
 * 2. Run tests: npm run test:js -- --runTestsByPath apps/mesh/__tests__/partial-updates.test.ts
 * 
 * These tests validate the PostgreSQL || operator implementation for atomic JSONB
 * merge operations in the NotionModel resolver against a real database.
 * 
 * Implementation Note:
 * - In test environments (NODE_ENV=test), the resolver uses deep merge for all updates
 *   to ensure compatibility with Python tests via REST API
 * - In production/dev, simple updates use atomic || operator (no fetch-before-update)
 *   and nested object updates trigger deep merge
 * 
 * Coverage:
 * - Basic JSONB merge behavior
 * - Nested object handling (deep merge)
 * - Array replacement semantics
 * - Null value handling
 * - Edge cases (empty payload, special chars, unicode)
 * - PUT vs PATCH semantics
 * - Performance & atomicity
 */

import { randomUUID } from 'crypto';

import { NotesDefinition } from '../../../packages/features/src/definitions/NotesDefinition';
import { Prism } from '../../../packages/prism/src/prism';

const TEST_CONTENT_TYPE = 'Notes';
const MESH_SERVER_URL = 'http://localhost:2000/graphql';

/**
 * Check if Mesh server is available
 */
async function isMeshServerAvailable(): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 
      'Content-Type': 'application/json' 
    };
    
    // Add MESH_SHARED_SECRET if available
    if (process.env.MESH_SHARED_SECRET) {
      headers['x-mesh-secret'] = process.env.MESH_SHARED_SECRET;
    }
    
    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
    
    try {
      const response = await fetch(MESH_SERVER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: '{ __typename }' }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Server is available if request succeeds
      if (response.ok) {
        return true;
      }
      
      // Check if it's an auth error (server is running but needs secret)
      const text = await response.text();
      
      if (text.includes('Unauthorized') || text.includes('mesh secret')) {
        // eslint-disable-next-line no-console
        console.warn('⚠️  Mesh server is running but requires MESH_SHARED_SECRET');
        // eslint-disable-next-line no-console
        console.warn('   Set MESH_SHARED_SECRET environment variable');
        return false;
      }
      
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    // Connection refused, timeout, or other network error
    return false;
  }
}

/**
 * Ensures Notes definition exists before operation.
 * Mirrors the pattern from apps/interface/src/features/Notes/actions/notes-actions.ts
 */
async function ensureNotesDefinition<T>(prism: Prism, operation: () => Promise<T>, tenantId: string): Promise<T> {
  let result;
  try {
    result = await operation();
  } catch (error) {
    const msg = `Content definition for type "${NotesDefinition.dataModel.block}" not found.`;
    if (error instanceof Error && error.message.includes(msg)) {
      // Create definition and retry
      await prism.createDefinition(NotesDefinition, tenantId);
      result = await operation();
    } else {
      throw error;
    }
  }
  return result;
}

describe('Phase 1: Partial Update Support - PostgreSQL JSONB Merge', () => {
  let prism: Prism;
  let testTenantId: string;
  const createdNoteIds: string[] = [];
  let serverAvailable = false;

  beforeAll(async () => {
    // Check if local development Mesh server is available (not test server)
    serverAvailable = await isMeshServerAvailable();
    
    if (!serverAvailable) {
      // eslint-disable-next-line no-console
      console.warn('⚠️  Local Mesh server not available on localhost:2000');
      // eslint-disable-next-line no-console
      console.warn('   Start server with: npm run dev --workspace=mesh');
      // eslint-disable-next-line no-console
      console.warn('   These tests require a REAL PostgreSQL database, not pg-mem');
      // eslint-disable-next-line no-console
      console.warn('   Skipping integration tests...');
      return;
    }

    testTenantId = randomUUID();
    
    // CRITICAL: Connect to local development Mesh server (localhost:2000)
    // NOT the test server (localhost:5001). This ensures we test against
    // real PostgreSQL with JSONB || operator support, not pg-mem.
    // eslint-disable-next-line no-console
    console.log('🔗 Connecting to LOCAL Mesh server at', MESH_SERVER_URL);
    prism = await Prism.getInstance({ 
      endpoint: MESH_SERVER_URL 
    });
    
    // Ensure ENABLE_PARTIAL_UPDATES is enabled for these tests
    process.env.ENABLE_PARTIAL_UPDATES = 'true';
    
    // Create Notes definition for test tenant
    try {
      await prism.createDefinition(NotesDefinition, testTenantId);
      // eslint-disable-next-line no-console
      console.log('✅ Notes definition created for test tenant:', testTenantId);
    } catch (error) {
      // Ignore if already exists
      // eslint-disable-next-line no-console
      console.log('ℹ️  Notes definition already exists');
    }
  });

  afterAll(async () => {
    if (!serverAvailable) {
      return;
    }

    try {
      // Cleanup: Delete all test notes created during tests
      // eslint-disable-next-line no-console
      console.log(`🧹 Cleaning up ${createdNoteIds.length} test notes...`);
      
      // Only delete tracked notes created during this test run
      for (const noteId of createdNoteIds) {
        try {
          await prism.delete(TEST_CONTENT_TYPE, noteId, testTenantId);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(`Failed to delete note ${noteId}:`, error);
        }
      }
      
      // REMOVED: Overly aggressive "safety check" that was deleting ALL notes in tenant
      // The test now only cleans up notes it explicitly created (tracked in createdNoteIds)
      
      // Clean up the Notes definition for this test tenant
      try {
        // Delete definition by finding and removing it
        // Note: This is tenant-specific, won't affect other tenants
        await prism.deleteDefinition(TEST_CONTENT_TYPE, testTenantId);
        // eslint-disable-next-line no-console
        console.log('✅ Notes definition deleted for test tenant');
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to delete Notes definition:', error);
      }
      
      // eslint-disable-next-line no-console
      console.log('✅ Cleanup complete - no test pollution in your database');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('❌ Cleanup failed:', error);
      throw error; // Re-throw to make test suite fail if cleanup fails
    }
  });

  // Helper functions
  async function create(content: Record<string, unknown>) {
    const result = await ensureNotesDefinition(
      prism,
      () => prism.create(TEST_CONTENT_TYPE, content, testTenantId),
      testTenantId
    );
    
    // Track created note for cleanup
    if (result.items && result.items[0] && result.items[0]._id) {
      createdNoteIds.push(result.items[0]._id);
    }
    
    return result;
  }

  async function update(id: string, content: Record<string, unknown>) {
    return ensureNotesDefinition(
      prism,
      () => prism.update(TEST_CONTENT_TYPE, id, content, testTenantId),
      testTenantId
    );
  }

  describe('Basic JSONB Merge Behavior', () => {
    test('should merge partial content updates atomically', async () => {
      if (!serverAvailable) return;
      
      // Create initial record with multiple fields
      const created = await create({
        title: 'Original Title',
        description: 'Original Description',
        tags: ['tag1', 'tag2'],
        metadata: { version: 1, author: 'user1' }
      });

      expect(created.total).toBe(1);
      const initialNote = created.items[0];

      // Update only the title field
      const updated = await update(initialNote._id!, {
        title: 'Updated Title'
      });

      expect(updated.total).toBe(1);
      const updatedNote = updated.items[0];

      // Verify PostgreSQL || operator preserved all other fields
      // NOTE: Notes items have fields at top level, not under a 'content' property
      expect(updatedNote).toMatchObject({
        title: 'Updated Title',               // Changed
        description: 'Original Description',  // Preserved by ||
        tags: ['tag1', 'tag2'],               // Preserved by ||
        metadata: { version: 1, author: 'user1' }  // Preserved by ||
      });
    });

    test('should handle multiple field updates in one call', async () => {
      if (!serverAvailable) return;
      const created = await create({
        title: 'Original',
        description: 'Description',
        tags: ['tag1']
      });

      const updated = await update(created.items[0]._id!, {
        title: 'New Title',
        description: 'New Description'
      });

      expect(updated.items[0]).toMatchObject({
        title: 'New Title',
        description: 'New Description',
        tags: ['tag1']  // Preserved
      });
    });

    test('should handle nested object updates (shallow replacement)', async () => {
      if (!serverAvailable) return;
      const created = await create({
          metadata: {
            version: 1,
            author: 'user1',
            tags: ['old']
          }
        });

      // Update nested metadata object - shallow replacement (standard PostgreSQL behavior)
      const updated = await update(created.items[0]._id!, {
          metadata: { version: 2, tags: ['new'] }
        });

      // Standard shallow replacement: nested object is replaced entirely
      expect(updated.items[0].metadata).toEqual({
        version: 2,     // Updated
        tags: ['new']   // Updated
        // author is LOST - standard shallow replacement behavior
      });
      expect(updated.items[0].metadata.author).toBeUndefined();
    });
    
    test('should allow deleting keys from nested objects via shallow replacement', async () => {
      if (!serverAvailable) return;
      // Standard PostgreSQL behavior: nested objects are replaced, not deep merged
      // This means callers can delete keys by omitting them
      const created = await create({
          title: 'Document',
          metadata: {
            author: 'user1',
            version: 1,
            department: 'Engineering',
            lastModified: '2025-01-01'
          }
        });

      // Send reduced metadata object - author and lastModified will be deleted
      const updated = await update(created.items[0]._id!, {
          metadata: { 
            version: 2,
            department: 'Product'
          }
        });

      // Standard shallow replacement: nested object is replaced entirely
      expect(updated.items[0].metadata).toEqual({
        version: 2,                // ✅ Updated
        department: 'Product',     // ✅ Updated
        // author and lastModified are DELETED - standard behavior
      });
      expect(updated.items[0].metadata.author).toBeUndefined();
      expect(updated.items[0].metadata.lastModified).toBeUndefined();
      
      // Top-level title should be preserved (top-level shallow merge)
      expect(updated.items[0].title).toBe('Document');
    });

    test('should allow two-level merge for content.metadata (special case)', async () => {
      if (!serverAvailable) return;
      // Special behavior: content.metadata gets two-level merge to support key deletion
      const created = await create({
          title: 'UserProfile',
          metadata: {
            dogs: { name: 'Fido', age: 5, breed: 'Golden' },
            cats: { name: 'Whiskers', age: 3 },
            birds: { name: 'Tweety', color: 'yellow' }
          }
        });

      // Update: Keep dogs (but replace with partial), delete cats, keep birds
      const updated = await update(created.items[0]._id!, {
          metadata: {
            dogs: { name: 'Fido' },  // age and breed omitted = deleted (level 3+ replacement)
            birds: { name: 'Tweety', color: 'yellow' }  // Must send complete to keep
            // cats omitted = deleted (level 2 allows deletions)
          }
        });

      // Two-level merge behavior:
      // - Level 1 (content.*): Top-level fields like title preserved
      // - Level 2 (content.metadata.*): Keys can be added/updated/deleted
      // - Level 3+ (content.metadata.dogs.*): Objects replaced (standard shallow)
      expect(updated.items[0].title).toBe('UserProfile');  // Level 1: preserved
      expect(updated.items[0].metadata).toEqual({
        dogs: { name: 'Fido' },  // Level 3: replaced (age/breed lost)
        birds: { name: 'Tweety', color: 'yellow' }  // Level 2: preserved
        // cats deleted from level 2
      });
      expect(updated.items[0].metadata.cats).toBeUndefined();
      expect(updated.items[0].metadata.dogs.age).toBeUndefined();
      expect(updated.items[0].metadata.dogs.breed).toBeUndefined();
    });

    test('should replace arrays not merge them', async () => {
      if (!serverAvailable) return;
      const created = await create({
          tags: ['a', 'b', 'c']
        });

      const updated = await update(created.items[0]._id!, {
          tags: ['x', 'y']
        });

      // Arrays are replaced in JSONB || merge, not merged
      expect(updated.items[0].tags).toEqual(['x', 'y']);
    });

    test('should handle null values (sets to null, does not delete)', async () => {
      if (!serverAvailable) return;
      const created = await create({
          title: 'Title',
          description: 'Description'
        });

      const updated = await update(created.items[0]._id!, {
          description: null
        });

      // PostgreSQL || sets field to null (does NOT delete the key)
      expect(updated.items[0]).toMatchObject({
        title: 'Title',
        description: null  // Set to null, key still exists
      });
    });

    test('should preserve indexer fields after partial update for query lookups', async () => {
      if (!serverAvailable) return;
      
      // Create a note with indexed fields (title, mode, normalizedTitle)
      const created = await create({
        title: 'Important Document',
        normalizedTitle: 'important document',
        content: 'Original content',
        mode: 'work',
        tags: ['urgent', 'review']
      });

      expect(created.total).toBe(1);
      const noteId = created.items[0]._id!;

      // Perform partial update - only update content and tags
      // This should preserve title, normalizedTitle, and mode in the indexer
      const updated = await update(noteId, {
        content: 'Updated content',
        tags: ['urgent', 'reviewed', 'done']
      });

      expect(updated.total).toBe(1);
      expect(updated.items[0]).toMatchObject({
        title: 'Important Document',
        normalizedTitle: 'important document',
        content: 'Updated content',
        mode: 'work',
        tags: ['urgent', 'reviewed', 'done']
      });

      // CRITICAL: Verify we can still query by indexed fields after the update
      // This confirms the indexer was properly merged, not replaced
      
      // Query by title (indexed field)
      const queryByTitle = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        tenantId: testTenantId,
        where: { indexer: { path: 'title', equals: 'Important Document' } }
      });
      expect(queryByTitle.total).toBe(1);
      expect(queryByTitle.items[0]._id).toBe(noteId);

      // Query by normalizedTitle (indexed field)
      const queryByNormalizedTitle = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        tenantId: testTenantId,
        where: { indexer: { path: 'normalizedTitle', equals: 'important document' } }
      });
      expect(queryByNormalizedTitle.total).toBe(1);
      expect(queryByNormalizedTitle.items[0]._id).toBe(noteId);

      // Query by mode (indexed field)
      const queryByMode = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        tenantId: testTenantId,
        where: { indexer: { path: 'mode', equals: 'work' } }
      });
      expect(queryByMode.total).toBeGreaterThanOrEqual(1);
      const foundNote = queryByMode.items.find(item => item._id === noteId);
      expect(foundNote).toBeDefined();
      expect(foundNote!._id).toBe(noteId);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty update payload', async () => {
      if (!serverAvailable) return;
      const created = await create({
          title: 'Title',
          description: 'Description'
        });

      const updated = await update(created.items[0]._id!, {});  // Empty update

      // Content should remain unchanged
      expect(updated.items[0]).toMatchObject(created.items[0]);
    });

    // Note: System-managed fields like parent_id, order are handled by Prism/Mesh
    // and are not included in user content updates

    test('should handle deeply nested object updates (shallow replacement)', async () => {
      if (!serverAvailable) return;
      const created = await create({
          config: {
            ui: {
              theme: 'dark',
              fontSize: 14
            },
            api: {
              timeout: 5000
            }
          }
        });

      const updated = await update(created.items[0]._id!, {
          config: {
            ui: {
              theme: 'light'
            }
          }
        });

      // Standard shallow replacement: nested config object is replaced entirely
      expect(updated.items[0].config).toEqual({
        ui: { 
          theme: 'light'  // Updated
          // fontSize is LOST - shallow replacement
        }
        // api is LOST - shallow replacement
      });
      expect(updated.items[0].config.ui.fontSize).toBeUndefined();
      expect(updated.items[0].config.api).toBeUndefined();
    });

    test('should handle special characters in JSON', async () => {
      if (!serverAvailable) return;
      const created = await create({
          title: 'Normal'
        });

      const updated = await update(created.items[0]._id!, {
          description: "It's a test with 'quotes' and \"double quotes\""
        });

      expect(updated.items[0].description).toBe(
        "It's a test with 'quotes' and \"double quotes\""
      );
    });

    test('should handle unicode and emoji', async () => {
      if (!serverAvailable) return;
      const created = await create({
          title: 'Normal'
        });

      const updated = await update(created.items[0]._id!, {
          description: '🎉 Unicode test: café, naïve, 日本語'
        });

      expect(updated.items[0].description).toBe('🎉 Unicode test: café, naïve, 日本語');
    });

    test('should handle very large JSON payloads', async () => {
      if (!serverAvailable) return;
      const created = await create({
          title: 'Large Content Test'
        });

      // Create a large content update (10KB of data)
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        value: `Item ${i}`,
        nested: { data: `Nested ${i}` }
      }));

      const updated = await update(created.items[0]._id!, {
          largeData: largeArray
        });

      expect(updated.items[0].largeData).toHaveLength(1000);
      expect(updated.items[0].title).toBe('Large Content Test');
    });

    test('should handle content with backslashes', async () => {
      if (!serverAvailable) return;
      const created = await create({
          title: 'Backslash Test'
        });

      const updated = await update(created.items[0]._id!, {
          path: 'C:\\Users\\Test\\Documents'
        });

      expect(updated.items[0].path).toBe('C:\\Users\\Test\\Documents');
    });
  });

  describe('Concurrent Updates', () => {
    test('should handle concurrent updates correctly', async () => {
      if (!serverAvailable) return;
      const created = await create({
          count: 0,
          title: 'Initial',
          description: 'Description'
        });

      // Simulate concurrent updates to different fields
      const [update1, update2, update3] = await Promise.all([
        update(created.items[0]._id!, { count: 1 }),
        update(created.items[0]._id!, { title: 'Updated' }),
        update(created.items[0]._id!, { description: 'New Desc' })
      ]);

      // All updates should succeed
      expect(update1.total).toBe(1);
      expect(update2.total).toBe(1);
      expect(update3.total).toBe(1);

      // Fetch final state
      const final = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        where: { page_id: { eq: created.items[0]._id! } },
        tenantId: testTenantId,
        limit: 1
      });

      // Last write wins for each field (JSONB merge is atomic per update)
      // All fields should be present (no data loss)
      expect(final.items[0].count).toBeDefined();
      expect(final.items[0].title).toBeDefined();
      expect(final.items[0].description).toBeDefined();
    });

    test('should handle race condition on same field', async () => {
      if (!serverAvailable) return;
      const created = await create({
          counter: 0
        });

      // Multiple concurrent updates to the same field
      await Promise.all([
        update(created.items[0]._id!, { counter: 1 }),
        update(created.items[0]._id!, { counter: 2 }),
        update(created.items[0]._id!, { counter: 3 })
      ]);

      const final = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        where: { page_id: { eq: created.items[0]._id! } },
        tenantId: testTenantId,
        limit: 1
      });

      // Last write wins
      expect([1, 2, 3]).toContain(final.items[0].counter);
    });
  });

  describe('Error Handling', () => {
    test('should throw error for non-existent record', async () => {
      if (!serverAvailable) return;
      const nonExistentId = randomUUID();
      await expect(
        update(nonExistentId, { title: 'Updated' })
      ).rejects.toThrow();
    });

    test('should handle malformed JSON gracefully', async () => {
      if (!serverAvailable) return;
      const created = await create({
          title: 'Test'
        });

      // This should be handled by JSON.stringify in the resolver
      const updated = await update(created.items[0]._id!, {
          circularRef: undefined  // undefined should be handled
        });

      expect(updated.total).toBe(1);
    });
  });

  describe('Feature Flag Behavior', () => {
    test('should use JSONB merge when flag is enabled', async () => {
      if (!serverAvailable) return;
      process.env.ENABLE_PARTIAL_UPDATES = 'true';

      const created = await create({
          title: 'Original',
          description: 'Description'
        });

      const updated = await update(created.items[0]._id!, { title: 'Updated' });

      // Description should be preserved (JSONB merge behavior)
      expect(updated.items[0].description).toBe('Description');
    });
    
    test('should use atomic || operator for simple updates', async () => {
      if (!serverAvailable) return;
      process.env.ENABLE_PARTIAL_UPDATES = 'true';

      // Simple update with primitives only (no nested objects)
      const created = await create({
          title: 'Original',
          description: 'Description',
          count: 1
        });

      // This should use atomic PostgreSQL || operator (no fetch-before-update)
      const updated = await update(created.items[0]._id!, { 
        title: 'Updated',
        count: 2 
      });

      // All fields preserved via atomic JSONB merge
      expect(updated.items[0]).toMatchObject({
        title: 'Updated',
        description: 'Description',  // Preserved
        count: 2
      });
    });
    
    test('should use shallow replacement for nested object updates', async () => {
      if (!serverAvailable) return;
      process.env.ENABLE_PARTIAL_UPDATES = 'true';

      // Update with nested object uses standard shallow replacement
      const created = await create({
          config: {
            theme: 'dark',
            fontSize: 12
          },
          title: 'Test'
        });

      const updated = await update(created.items[0]._id!, { 
        config: { theme: 'light' }
      });

      // Standard shallow replacement: nested object replaced entirely
      expect(updated.items[0].config).toEqual({
        theme: 'light'   // Updated
        // fontSize is LOST - shallow replacement
      });
      expect(updated.items[0].config.fontSize).toBeUndefined();
      expect(updated.items[0].title).toBe('Test');  // Top-level fields preserved
    });

    test('should use legacy behavior when flag is disabled', async () => {
      if (!serverAvailable) return;
      process.env.ENABLE_PARTIAL_UPDATES = 'false';

      const created = await create({
          title: 'Original',
          description: 'Description'
        });

      const updated = await update(created.items[0]._id!, { title: 'Updated' });

      // With legacy behavior, description might be lost (full replacement)
      // This test documents the old behavior for comparison
      expect(updated.items[0].title).toBe('Updated');

      // Re-enable for subsequent tests
      process.env.ENABLE_PARTIAL_UPDATES = 'true';
    });
  });

  describe('Performance Validation', () => {
    test('should complete update in reasonable time', async () => {
      if (!serverAvailable) return;
      const created = await create({
          title: 'Performance Test'
        });

      const startTime = Date.now();

      await update(created.items[0]._id!, { title: 'Updated' });

      const duration = Date.now() - startTime;

      // Update should complete in less than 500ms (generous threshold for tests)
      expect(duration).toBeLessThan(500);
    });

    test('should handle bulk updates efficiently', async () => {
      if (!serverAvailable) return;
      // Create 10 notes
      const notes = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          create({
            title: `Note ${i}`,
            counter: i
          })
        )
      );

      const startTime = Date.now();

      // Update all notes concurrently
      await Promise.all(
        notes.map((note) =>
          update(note.items[0]._id!, { counter: 999 })
        )
      );

      const duration = Date.now() - startTime;

      // Should complete in less than 2 seconds
      expect(duration).toBeLessThan(2000);
    });
  });

  // REST API Base URL for PATCH and PUT tests
  const REST_API_BASE = 'http://localhost:2000/api';

  describe('REST API PATCH Endpoint', () => {
    // Helper to call REST API PATCH
    async function patchViaRest(id: string, content: Record<string, unknown>) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (process.env.MESH_SHARED_SECRET) {
        headers['x-mesh-secret'] = process.env.MESH_SHARED_SECRET;
      }

      const response = await fetch(`${REST_API_BASE}/content/${TEST_CONTENT_TYPE}/${id}?tenant=${testTenantId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ content })
      });

      if (!response.ok) {
        throw new Error(`PATCH failed: ${response.statusText}`);
      }

      return response.json();
    }

    test('should perform partial update via PATCH endpoint', async () => {
      if (!serverAvailable) return;

      // Create a note with multiple fields
      const created = await create({
        title: 'Original Title',
        content: 'Original content',
        tags: ['tag1', 'tag2'],
        metadata: {
          author: 'Alice',
          version: 1
        }
      });

      const noteId = created.items[0]._id!;

      // Partially update via PATCH - only change title
      await patchViaRest(noteId, {
        title: 'Updated Title'
      });

      // Verify other fields are preserved
      const result = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        tenantId: testTenantId,
        where: { page_id: { eq: noteId } },
        limit: 1
      });

      expect(result.items[0].title).toBe('Updated Title');
      expect(result.items[0].content).toBe('Original content');
      expect(result.items[0].tags).toEqual(['tag1', 'tag2']);
      expect(result.items[0].metadata).toEqual({
        author: 'Alice',
        version: 1
      });
    });

    test('should use shallow replacement for nested objects via PATCH', async () => {
      if (!serverAvailable) return;

      const created = await create({
        title: 'Test',
        metadata: {
          author: 'Alice',
          version: 1,
          stats: {
            views: 10,
            likes: 5
          }
        }
      });

      const noteId = created.items[0]._id!;

      // Update nested object - shallow replacement (standard behavior)
      await patchViaRest(noteId, {
        metadata: {
          stats: {
            views: 20
          }
        }
      });

      const result = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        tenantId: testTenantId,
        where: { page_id: { eq: noteId } },
        limit: 1
      });

      // Standard shallow replacement: metadata is replaced entirely
      expect(result.items[0].metadata).toEqual({
        stats: {
          views: 20
          // likes is LOST - shallow replacement of stats object
        }
        // author and version are LOST - shallow replacement of metadata object
      });
      expect(result.items[0].metadata.author).toBeUndefined();
      expect(result.items[0].metadata.version).toBeUndefined();
      expect(result.items[0].metadata.stats.likes).toBeUndefined();
    });

    test('should handle array replacement via PATCH', async () => {
      if (!serverAvailable) return;

      const created = await create({
        title: 'Test',
        tags: ['tag1', 'tag2', 'tag3']
      });

      const noteId = created.items[0]._id!;

      // PATCH with array should replace, not merge
      await patchViaRest(noteId, {
        tags: ['newTag']
      });

      const result = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        tenantId: testTenantId,
        where: { page_id: { eq: noteId } },
        limit: 1
      });

      expect(result.items[0].tags).toEqual(['newTag']);
    });

    test('PATCH should return 404 for non-existent content', async () => {
      if (!serverAvailable) return;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (process.env.MESH_SHARED_SECRET) {
        headers['x-mesh-secret'] = process.env.MESH_SHARED_SECRET;
      }

      const response = await fetch(`${REST_API_BASE}/content/${TEST_CONTENT_TYPE}/nonexistent?tenant=${testTenantId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ content: { title: 'Test' } })
      });

      expect(response.status).toBe(404);
    });
  });

  /**
   * PUT (Replace) Tests - Full replacement semantics
   * Critical for UX: Users must be able to remove fields from metadata
   */
  describe('PUT (Replace) endpoint', () => {
    test('PUT should completely replace content (remove fields)', async () => {
      if (!serverAvailable) return;

      // Create content with metadata fields
      const initialNote = {
        title: 'Profile Test',
        content: 'Test content',
        metadata: {
          phoneNumber: '555-1234',
          address: '123 Main St',
          notes: 'Some notes'
        }
      };

      const created = await create(initialNote);
      expect(created.total).toBe(1);
      const pageId = created.items[0]._id;

      // User wants to remove phoneNumber and address, keep only notes
      const replacementContent = {
        title: 'Profile Test',
        content: 'Test content',
        metadata: {
          notes: 'Updated notes only'
        }
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (process.env.MESH_SHARED_SECRET) {
        headers['x-mesh-secret'] = process.env.MESH_SHARED_SECRET;
      }

      // PUT with replacement semantics
      const response = await fetch(`${REST_API_BASE}/content/${TEST_CONTENT_TYPE}/${pageId}?tenant=${testTenantId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ content: replacementContent })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('PUT failed:', response.status, errorText);
        throw new Error(`PUT request failed: ${response.status} ${errorText}`);
      }
      
      expect(response.ok).toBe(true);
      const { data: putResult } = await response.json();
      
      // Verify: phoneNumber and address should be GONE
      expect(putResult.metadata).toEqual({
        notes: 'Updated notes only'
      });
      expect(putResult.metadata.phoneNumber).toBeUndefined();
      expect(putResult.metadata.address).toBeUndefined();

      // Double-check via fetch
      const fetchResult = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        tenantId: testTenantId,
        where: { page_id: { eq: pageId } },
        limit: 1
      });

      expect(fetchResult.items[0].metadata).toEqual({
        notes: 'Updated notes only'
      });
    });

    test('PUT should allow complete metadata removal', async () => {
      if (!serverAvailable) return;

      // Create content with metadata
      const initialNote = {
        title: 'Metadata Removal Test',
        content: 'Test content',
        metadata: {
          field1: 'value1',
          field2: 'value2'
        }
      };

      const created = await create(initialNote);
      const pageId = created.items[0]._id;

      // User wants to remove ALL metadata
      const replacementContent = {
        title: 'Metadata Removal Test',
        content: 'Test content'
        // No metadata field at all
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (process.env.MESH_SHARED_SECRET) {
        headers['x-mesh-secret'] = process.env.MESH_SHARED_SECRET;
      }

      const response = await fetch(`${REST_API_BASE}/content/${TEST_CONTENT_TYPE}/${pageId}?tenant=${testTenantId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ content: replacementContent })
      });

      expect(response.ok).toBe(true);
      const { data: putResult } = await response.json();
      
      // Verify: metadata should be completely gone
      expect(putResult.metadata).toBeUndefined();

      // Double-check via fetch
      const fetchResult = await prism.query({
        contentType: TEST_CONTENT_TYPE,
        tenantId: testTenantId,
        where: { page_id: { eq: pageId } },
        limit: 1
      });

      expect(fetchResult.items[0].metadata).toBeUndefined();
    });

    test('PATCH should preserve top-level fields (shallow merge semantics)', async () => {
      if (!serverAvailable) return;

      // Create content with multiple top-level fields
      const initialNote = {
        title: 'Merge Test',
        content: 'Test content',
        metadata: {
          field1: 'value1',
          field2: 'value2',
          field3: 'value3'
        },
        tags: ['tag1', 'tag2']
      };

      const created = await create(initialNote);
      const pageId = created.items[0]._id;

      // PATCH with title update - should preserve other top-level fields (content, metadata, tags)
      // But note: nested objects like metadata are REPLACED if you update them (shallow merge)
      const partialUpdate = {
        title: 'Updated Title'
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (process.env.MESH_SHARED_SECRET) {
        headers['x-mesh-secret'] = process.env.MESH_SHARED_SECRET;
      }

      const response = await fetch(`${REST_API_BASE}/content/${TEST_CONTENT_TYPE}/${pageId}?tenant=${testTenantId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ content: partialUpdate })
      });

      expect(response.ok).toBe(true);
      const { data: patchResult } = await response.json();
      
      // Verify: Top-level shallow merge - title updated, other fields preserved
      expect(patchResult.title).toBe('Updated Title');
      expect(patchResult.content).toBe('Test content');
      expect(patchResult.metadata).toEqual({
        field1: 'value1',
        field2: 'value2',
        field3: 'value3'
      });
      expect(patchResult.tags).toEqual(['tag1', 'tag2']);
    });
  });
});

