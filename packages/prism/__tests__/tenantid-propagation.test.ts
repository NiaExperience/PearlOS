/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tenant ID Propagation Tests
 *
 * Guards against regressions where tenantId was not forwarded to underlying
 * PrismGraphQLClient.findContent / findDefinition calls inside create, query,
 * update, and delete operations. Previously, missing propagation caused
 * tenant-scoped dynamic content updates to resolve definitions with tenantId 'any'
 * and throw: "Invalid tenant ID: any".
 */
import { v4 as uuidv4 } from 'uuid';
import { Prism } from '../src/prism';
import { ContentData } from '../src/core/content/types';
import { IDynamicContent } from '../src/core/blocks/dynamicContent.block';
import { createTestTenant, createTestAssistant } from '../src/testing/testlib';

// Simple dynamic content definition used for tenant scoped testing
function buildTenantScopedDefinition(tenantId: string): IDynamicContent {
  return {
    name: 'TenantScopedThing',
    description: 'A tenant scoped test content type',
    tenantId,
    dataModel: {
      block: 'TenantScopedThing',
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          _id: { type: 'string', format: 'uuid' },
          assistant_id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['assistant_id', 'name']
      } as any,
      indexer: ['name'],
      parent: { type: 'field', field: 'assistant_id' }
    },
    uiConfig: {},
    access: {},
  };
}

// Use a known platform definition (Assistant) to assert platform squashing behaviour.
const PLATFORM_BLOCK = 'Assistant';

describe('Prism tenantId propagation (CRUD)', () => {
  let prism: Prism;
  let tenantId: string;      // real tenant
  let assistantId: string;   // parent id for content

  beforeAll(async () => {
    prism = await Prism.getInstance();
    const tenant = await createTestTenant();
    tenantId = tenant._id!;
    const assistant = await createTestAssistant({ name: `Assistant ${uuidv4()}`, tenantId });
    assistantId = assistant._id!;
  });

  afterAll(async () => {
    if (prism) {
      await prism.disconnect();
    }
  });

  it('create/query/update/delete propagate tenantId for tenant-scoped dynamic content', async () => {
    // Create tenant-scoped definition
    const def = buildTenantScopedDefinition(tenantId);
    const createdDef = await prism.createDefinition(def, tenantId);
    expect(createdDef.total).toBe(1);

    // Spy on internal client methods
    const internalClient: any = (prism as any).client;
    const findDefinitionSpy = jest.spyOn(internalClient, 'findDefinition');
    const findContentSpy = jest.spyOn(internalClient, 'findContent');

    // CREATE
    const data: ContentData = { _id: uuidv4(), assistant_id: assistantId, name: 'A1' } as any;
    const created = await prism.create(def.dataModel.block, data, tenantId);
    expect(created.total).toBe(1);

    // QUERY
    const queried = await prism.query({
      contentType: def.dataModel.block,
      tenantId,
      where: { parent_id: assistantId },
    });
    expect(queried.total).toBeGreaterThanOrEqual(1);

    const pageId = created.items[0]._id!;

    // UPDATE
    const updated = await prism.update(def.dataModel.block, pageId, { ...data, name: 'A2' }, tenantId);
    expect(updated.items[0].name).toBe('A2');

    // DELETE
    const deleted = await prism.delete(def.dataModel.block, pageId, tenantId);
    expect(deleted).toBe(true);

    // Assertions: tenantId should have been passed for all tenant-scoped operations
    // findDefinition invoked during create + createDefinition + possibly query/update flows.
    // We assert that whenever called for our custom block, it used the real tenantId (not 'any').
    const badCalls = findDefinitionSpy.mock.calls.filter((c: any[]) => c[0] === def.dataModel.block && c[1] !== tenantId);
    expect(badCalls).toHaveLength(0);

    // findContent used by query, update (lookup), delete (lookup)
    const contentLookupCalls = findContentSpy.mock.calls.filter((c: any[]) => c[0] === def.dataModel.block);
    expect(contentLookupCalls.length).toBeGreaterThanOrEqual(3); // query + update + delete
    const missingTenantCalls = contentLookupCalls.filter((c: any[]) => c[5] !== tenantId); // param order: (type, where, limit, offset, orderBy, tenantId)
    expect(missingTenantCalls).toHaveLength(0);

    findDefinitionSpy.mockRestore();
    findContentSpy.mockRestore();
  });

  it('findDefinition can be called with tenantId for platform types without breaking (non-regression)', async () => {
    const internalClient: any = (prism as any).client;
    const findDefinitionSpy = jest.spyOn(internalClient, 'findDefinition');

    // Requesting with tenantId should not throw; underlying logic may still receive tenant before squashing.
    const defResult = await prism.findDefinition(PLATFORM_BLOCK, tenantId);
    expect(defResult).toBeDefined();

    const platformCalls = findDefinitionSpy.mock.calls.filter((c: any[]) => c[0] === PLATFORM_BLOCK);
    expect(platformCalls.length).toBeGreaterThan(0);
    // Accept both UUID and 'any'/undefined since client-level squashing occurs later when needed.
    // Main regression guard is already covered in tenant-scoped CRUD test above.
    findDefinitionSpy.mockRestore();
  });
});
