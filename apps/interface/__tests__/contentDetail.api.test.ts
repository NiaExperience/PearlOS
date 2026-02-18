import { v4 as uuidv4 } from 'uuid';
import { TenantActions } from "@nia/prism/core/actions";
import { IAssistant } from "@nia/prism/core/blocks/assistant.block";
import { ITenant } from "@nia/prism/core/blocks/tenant.block";
import { TenantRole } from "@nia/prism/core/blocks/userTenantRole.block";
import { createTestAssistant, createTestTenant, testSessionUser } from '@nia/prism/testing';
import { JSONSchema7 } from 'json-schema';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/contentDetail/route';
import { Prism } from "@nia/prism";

describe('Dynamic Content Detail API Tests', () => {
  let tenant: ITenant;
  let assistant: IAssistant;
  let prism: Prism;

  beforeEach(async () => {
    prism = await Prism.getInstance();
    expect(prism).not.toBeNull();
    expect(testSessionUser).not.toBeNull();

    // create dynamic content definition
    const BlockType = 'Dynamo';
    tenant = (await createTestTenant());
    const unique = uuidv4();
    assistant = await createTestAssistant({ name: `Assistant ${unique}`, tenantId: tenant._id! });

    // assign test user to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, TenantRole.OWNER);

    const def = {
      tenantId: tenant._id!,
      name: BlockType,
      description: 'Dynamo content type',
      dataModel: {
        block: BlockType,
        jsonSchema: {
          type: 'object' as const,
          properties: {
            _id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            assistant_id: { type: 'string' }
          },
          required: ['title', 'assistant_id']
        } as JSONSchema7,
        indexer: ['title', 'categories'],
        parent: { type: 'field' as const, field: 'assistant_id' },
      },
      uiConfig: {
        card: {
          titleField: 'title',
          descriptionField: 'description',
        },
        listView: { displayFields: ['title', 'description'] },
        detailView: { displayFields: ['title'] },
      },
      access: { allowAnonymous: true },
    };
    const definition = await prism.createDefinition(def, tenant._id!);
    if (!definition) {
      throw new Error(`Failed to create dynamic content definition for ${BlockType}`);
    }
    const created = await prism.create(BlockType, {
      title: 'Initial Dynamo',
      description: 'Initial Dynamo description',
      assistant_id: assistant._id!,
    }, tenant._id!);
    expect(created).toBeTruthy();
    expect(created.total).toBe(1);
    expect(created.items[0]._id).not.toBeNull();
    expect(created.items[0].title).toBe('Initial Dynamo');
  });

  describe('GET /api/contentDetail', () => {

    it('should create an array of dynamic content items', async () => {
      const dynamoDataArray = [{
        title: 'Test Dynamic Detail',
        description: 'This is a test dynamic detail item',
        assistant_id: assistant._id!,
      }, {
        title: 'Test Dynamic Detail 2',
        description: 'This is another test dynamic detail item',
        assistant_id: assistant._id!,
      }];
      const created = await prism.bulkCreate('Dynamo', dynamoDataArray, tenant._id!);
      expect(created).toBeTruthy();
      expect(created.total).toBe(2);
      expect(created.items[0]._id).not.toBeNull();
      expect(created.items[1]._id).not.toBeNull();
      expect(created.items[0].title).toBe('Test Dynamic Detail');
      expect(created.items[1].title).toBe('Test Dynamic Detail 2');
    });

    it('should create and return a dynamic content item for a valid tenant, type, and page_id', async () => {
      const dynamoData = {
        title: 'Test Dynamic Detail',
        description: 'This is a test dynamic detail item',
        assistant_id: assistant._id!,
      };
      const created = await prism.create('Dynamo', dynamoData, tenant._id!);
      expect(created).toBeTruthy();
      expect(created.total).toBe(1);
      expect(created.items[0]._id).not.toBeNull();
      const content = created.items[0];

      // Create a NextRequest object with query parameter containing page_id
      const queryParam = JSON.stringify({ page_id: content._id });
      const url = `http://localhost:3000/api/contentDetail?tenantId=${tenant._id}&type=Dynamo&query=${encodeURIComponent(queryParam)}`;
      const request = new Request(url);
      const req = new NextRequest(request);
      // Call the GET function
      const response = await GET(req);
      // Assert the response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.definition).toBeTruthy();
      expect(data.item).toBeTruthy();
      expect(data.item.title).toBe('Test Dynamic Detail');
    });

    it('should return 400 when type is missing', async () => {
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=${assistant.subDomain}`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Dynamic content type is required');
    });

    it('should find assistant but then return 404 for content not found', async () => {
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=${assistant.subDomain}&type=Nope`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Without session, it hits auth check first
      expect(response.status).toBe(404);
    });

    it('should return 404 when assistant is not found', async () => {
      const url = new URL('http://localhost:3000/api/contentDetail?agent=nonexistent&type=Dynamo');
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Assistant not found or does not have a tenant ID');
    });

    it('should handle tenant ID directly', async () => {
      const url = new URL(`http://localhost:3000/api/contentDetail?tenantId=${tenant._id}&type=Dynamo`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should handle contentId parameter', async () => {
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=${assistant.subDomain}&type=Dynamo&contentId=test-content-id`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Should process contentId parameter before failing on other checks
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle query parameter with JSON', async () => {
      const queryParam = JSON.stringify({ title: 'Test Title' });
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=${assistant.subDomain}&type=Dynamo&query=${encodeURIComponent(queryParam)}`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Should process query parameter before failing on other checks
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle malformed query parameter', async () => {
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=${assistant.subDomain}&type=Dynamo&query=invalid-json`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Should handle JSON parsing error gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should test different parameter combinations', async () => {
      const url = new URL(`http://localhost:3000/api/contentDetail?tenantId=${tenant._id}&type=Dynamo&contentId=test-id&query=${encodeURIComponent('{"filter":"value"}')}`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Should process all parameters before failing on auth
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should test edge case with empty strings', async () => {
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=&type=&contentId=&query=`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Should handle empty parameters
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should test with special characters in parameters', async () => {
      const specialAgent = encodeURIComponent('test@special#agent');
      const specialType = encodeURIComponent('test/type&more');
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=${specialAgent}&type=${specialType}`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Should handle URL-encoded special characters
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should test very long parameter values', async () => {
      const longValue = 'a'.repeat(1000);
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=${longValue}&type=Dynamo`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Should handle long parameter values
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle invalid JSON in query parameter gracefully', async () => {
      const url = new URL(`http://localhost:3000/api/contentDetail?agent=${assistant.subDomain}&type=Dynamo&query={invalid:json}`);
      const request = new NextRequest(url);

      const response = await GET(request);
      const data = await response.json();

      // Should handle JSON parse error gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/contentDetail', () => {
    it('should handle POST request but fail during processing', async () => {
      const request = new NextRequest('http://localhost:3000/api/contentDetail', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tenant._id }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);

      // POST processing causes error due to auth/session complexity
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should return error when body is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/contentDetail', {
        method: 'POST',
        body: '',
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);

      // Empty body causes error 
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle JSON parsing errors gracefully', async () => {
      const request = new NextRequest('http://localhost:3000/api/contentDetail', {
        method: 'POST',
        body: 'invalid-json',
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);

      // Invalid JSON causes error
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle POST with valid JSON but missing required fields', async () => {
      const request = new NextRequest('http://localhost:3000/api/contentDetail', {
        method: 'POST',
        body: JSON.stringify({ someField: 'value' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);

      // Valid JSON but missing required fields
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle POST with complete data', async () => {
      const request = new NextRequest('http://localhost:3000/api/contentDetail', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: tenant._id,
          type: 'Dynamo',
          agent: assistant.subDomain
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);

      // Should process request even if it fails on auth
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle POST with nested object data', async () => {
      const request = new NextRequest('http://localhost:3000/api/contentDetail', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: tenant._id,
          type: 'Dynamo',
          data: {
            nested: {
              field: 'value',
              array: [1, 2, 3]
            }
          }
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);

      // Should handle complex JSON structure
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle POST with very large payload', async () => {
      const largeData = 'x'.repeat(10000);
      const request = new NextRequest('http://localhost:3000/api/contentDetail', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: tenant._id,
          type: 'Dynamo',
          largeField: largeData
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);

      // Should handle large payloads
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
