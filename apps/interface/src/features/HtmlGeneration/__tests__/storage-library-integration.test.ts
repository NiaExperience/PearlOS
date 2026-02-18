/**
 * @jest-environment node
 *
 * Integration test that compiles the storage library helper, wires it to the
 * /api/applet-api route handlers, and exercises CRUD against the in-memory DB.
 */

import vm from 'vm';

import { Prism } from '@nia/prism';
import { TenantActions } from '@nia/prism/core/actions';
import { AssistantBlock, UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { createTestAssistant, createTestTenant, testSessionUser } from '@nia/prism/testing';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { buildStorageLibraryCode } from '@nia/features';

import { DELETE, GET, POST, PUT } from '@interface/app/api/applet-api/route';

// Minimal mock fetch that routes requests through the Next.js handlers
function createMockFetch(handlers: { GET: any; POST: any; PUT: any; DELETE: any }) {
  return async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url, 'http://localhost:3000');
    const method = (options?.method || 'GET').toUpperCase();

    const request = new Request(urlObj.toString(), {
      method,
      headers: options?.headers as HeadersInit,
      body: options?.body
    });
    const nextReq = new NextRequest(request);

    switch (method) {
      case 'GET':
        return handlers.GET(nextReq);
      case 'POST':
        return handlers.POST(nextReq);
      case 'PUT':
        return handlers.PUT(nextReq);
      case 'DELETE':
        return handlers.DELETE(nextReq);
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  };
}

describe('Storage Library + Applet API integration', () => {
  let tenantId: string;
  let assistant: AssistantBlock.IAssistant;
  let prism: Prism;
  let originalFetch: typeof global.fetch;
  let api: any;

  beforeAll(async () => {
    prism = await Prism.getInstance();
    const tenant = await createTestTenant();
    tenantId = tenant._id!;
    assistant = await createTestAssistant({ name: `StorageLib Test ${uuidv4()}`, tenantId });

    await TenantActions.assignUserToTenant(
      testSessionUser!._id!,
      tenantId,
      UserTenantRoleBlock.TenantRole.MEMBER
    );

    originalFetch = global.fetch;
    global.fetch = createMockFetch({ GET, POST, PUT, DELETE }) as typeof global.fetch;

    // Build the library code and eval it to get NiaAPI
    const code = buildStorageLibraryCode({ tenantId, assistantName: assistant.subDomain });
    const context: any = { URLSearchParams, fetch: global.fetch, console };
    vm.createContext(context);
    vm.runInContext(`${code}; globalThis.NiaAPI = NiaAPI;`, context);
    api = new context.NiaAPI();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('creates, reads, updates, and deletes game state', async () => {
    // Create
    const created = await api.saveData({ game: 'drift-rally', score: 4200, lap: 3, perks: ['nitro'] });
    expect(created._id).toBeDefined();

    // Read by ID
    const fetched = await api.getData(created._id);
    expect(fetched.data.score).toBe(4200);

    // Update
    const updated = await api.updateData(created._id, { ...fetched.data, score: 5600, perks: ['nitro', 'drift-boost'] });
    expect(updated.data.score).toBe(5600);
    expect(updated.data.perks).toContain('drift-boost');

    // List with filter
    const listed = await api.listData({ 'data.game': { eq: 'drift-rally' } });
    expect(listed.length).toBeGreaterThanOrEqual(1);

    // Delete
    const deleted = await api.deleteData(created._id);
    expect(deleted?.success ?? true).toBeTruthy();
  });
});
