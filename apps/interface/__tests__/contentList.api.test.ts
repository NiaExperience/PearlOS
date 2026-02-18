/**
 * @jest-environment node
 */
import { v4 as uuidv4 } from 'uuid';
import { TenantActions } from '@nia/prism/core/actions';
import { AssistantBlock, DynamicContentBlock, UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { createTestAssistant, createTestTenant, testSessionUser } from '@nia/prism/testing';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/contentList/route';
import { Prism } from '@nia/prism';


describe('Content List API Tests', () => {
  let tenantId: string;
  let assistant: AssistantBlock.IAssistant;
  let prism: Prism;
  const TestTypeBlockType = 'TestType';
  const TestTypeAlphaBlockType = 'TestTypeAlpha';


  beforeEach(async () => {
    prism = await Prism.getInstance();
    expect(prism).not.toBeNull();
    expect(testSessionUser).not.toBeNull();
    const tenant = await createTestTenant();
    tenantId = tenant._id!;
    assistant = await createTestAssistant({ name: `Assistant ${uuidv4()}`, tenantId: tenantId });
    expect(assistant._id).toBeTruthy();
    // assign test user to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.OWNER);
    
    // Create mock dynamic content items
    const testTypeContentDefinition : DynamicContentBlock.IDynamicContent = 
      {
        tenantId: tenantId,
        name: 'Test Dynamic 1',
        dataModel: { 
          block: TestTypeBlockType, 
          jsonSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' }
            },
            required: ['title']
          },
          indexer: ['title']
        },
        uiConfig: {},
        access: { allowAnonymous: true },
      };
      const testTypeAlphaContentDefinition : DynamicContentBlock.IDynamicContent = 
      {
        tenantId: tenantId,
        name: 'Test Dynamic 2',
        dataModel: { 
          block: TestTypeAlphaBlockType, 
          jsonSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            },
            required: ['name']
          },
          indexer: ['name']
        },
        uiConfig: {},
        access: { allowAnonymous: true },
      };
    const testTypeData = 
      {
        title: 'TestType: title',
        assistant_id: assistant._id!,
      };
    const testTypeAlphaData =
      {
        name: 'TestTypeAlpha: name',
        assistant_id: assistant._id!,
      };

    // Definitions are created
    const testTypeDefinition = await prism.createDefinition(testTypeContentDefinition, tenant._id!);
    if (!testTypeDefinition) {
      throw new Error(`Failed to create dynamic content definition for ${testTypeContentDefinition.dataModel.block}`);
    }
    const created = await prism.create(
      testTypeContentDefinition.dataModel.block,
      testTypeData,
      tenantId
    );

    const testTypeAlphaDefinition = await prism.createDefinition(testTypeAlphaContentDefinition, tenant._id!);
    if (!testTypeAlphaDefinition) {
      throw new Error(`Failed to create dynamic content definition for ${testTypeAlphaContentDefinition.dataModel.block}`);
    }
    const createdAlpha = await prism.create(
      testTypeAlphaContentDefinition.dataModel.block,
      testTypeAlphaData,
      tenantId
    );
    
    expect(created).toBeTruthy();
    expect(created.total).toBe(1);
    const testTypeContent = created.items[0];
    expect(testTypeContent).toBeDefined();
    expect(testTypeContent._id).toBeTruthy();
    expect(testTypeContent.title).toBe('TestType: title');
    
    expect(createdAlpha).toBeDefined();
    expect(createdAlpha.total).toBe(1);
    const testTypeAlphaContent = createdAlpha.items[0];
    expect(testTypeAlphaContent).toBeDefined();
    expect(testTypeAlphaContent._id).toBeTruthy();
    expect(testTypeAlphaContent.name).toBe('TestTypeAlpha: name');
  });

  it('should return dynamic content items for a valid tenant and type', async () => {
    // Create a NextRequest object
    const url = `http://localhost:3000/api/contentList?tenantId=${tenantId}&type=${TestTypeBlockType}`;
    const request = new Request(url);
    const req = new NextRequest(request);
    // Call the GET function
    const response = await GET(req);
    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.definition).toBeTruthy();
    expect(data.items.length).toBe(1);
    expect(data.items[0].title).toBe('TestType: title');
  });

  it('should return an error if no tenant is provided', async () => {
    const url = `http://localhost:3000/api/contentList?type=${TestTypeBlockType}`;
    const request = new Request(url);
    const req = new NextRequest(request);
    const response = await GET(req);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Tenant ID or assistant name is required');
  });

  it('should return an error if no type is provided', async () => {
    const url = `http://localhost:3000/api/contentList?tenantId=${tenantId}`;
    const request = new Request(url);
    const req = new NextRequest(request);
    const response = await GET(req);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Dynamic content type is required');
  });

  it('should return an error if the tenant is not found', async () => {
    const random_uuid = '123e4567-e89b-12d3-a456-426614174000'; // Example UUID
    const url = `http://localhost:3000/api/contentList?tenantId=${random_uuid}&type=${TestTypeBlockType}`;
    const request = new Request(url);
    const req = new NextRequest(request);
    const response = await GET(req);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('Tenant not found');
  });

  it('should return an error if no content definition is found', async () => {
    const url = `http://localhost:3000/api/contentList?tenantId=${tenantId}&type=TestTypeBeta`;
    const request = new Request(url);
    const req = new NextRequest(request);
    // No content created
    const response = await GET(req);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('Content definition not found');
  });

  it('should return filtered items matching the search query', async () => {
    // Create test content items with proper setup
    const testTypeAlphaData = {
      title: 'TestType Title Alpha',
      assistant_id: assistant._id!,
    };
    
    const testTypeBetaData = {
      title: 'TestType Title Beta',
      assistant_id: assistant._id!,
    };

    // Create the items using the existing content type definition and data
    const createdAlpha = await prism.create(
      TestTypeBlockType,
      testTypeAlphaData,
      tenantId
    );
    
    const createdBeta = await prism.create(
      TestTypeBlockType,
      testTypeBetaData,
      tenantId
    );
    
    expect(createdAlpha).toBeTruthy();
    expect(createdBeta).toBeTruthy();

    // First test: Simple query without filtering to verify content exists
    const allItemsUrl = new URL(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/contentList`);
    allItemsUrl.searchParams.append('tenantId', tenantId);
    allItemsUrl.searchParams.append('type', TestTypeBlockType);

    const allItemsRequest = new Request(allItemsUrl.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const allItemsReq = new NextRequest(allItemsRequest);
    const allItemsResponse = await GET(allItemsReq);
    
    console.log('🔍 All items response status:', allItemsResponse.status);
    const allItemsData = await allItemsResponse.json();
    console.log('📊 All items found:', JSON.stringify(allItemsData, null, 2));

    // Now test with exact match filter instead of contains
    const exactMatchQuery = { indexer: { path: 'title', equals: 'TestType Title Alpha' } };

    const exactMatchUrl = new URL(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/contentList`);
    exactMatchUrl.searchParams.append('tenantId', tenantId);
    exactMatchUrl.searchParams.append('type', TestTypeBlockType);
    exactMatchUrl.searchParams.append('query', JSON.stringify(exactMatchQuery));

    const exactMatchRequest = new Request(exactMatchUrl.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const exactMatchReq = new NextRequest(exactMatchRequest);
    const exactMatchResponse = await GET(exactMatchReq);
    
    console.log('🔍 Exact match response status:', exactMatchResponse.status);
    const exactMatchData = await exactMatchResponse.json();
    console.log('📊 Exact match found:', JSON.stringify(exactMatchData, null, 2));

    // Finally test with contains filter
    const containsQuery = { indexer: { path: 'title', contains: 'Alpha' } };

    const url = new URL(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/contentList`);
    url.searchParams.append('tenantId', tenantId);
    url.searchParams.append('type', TestTypeBlockType);
    url.searchParams.append('query', JSON.stringify(containsQuery));

    const request = new Request(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const req = new NextRequest(request);
    const response = await GET(req);
    
    console.log('🔍 Contains response status:', response.status);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.definition).toBeTruthy();
    expect(data.items.length).toBe(1);
    expect(data.items[0].title).toContain('Alpha');
  });
}); 