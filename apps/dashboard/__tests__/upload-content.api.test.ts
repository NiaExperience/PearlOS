/**
 * @jest-environment node
 */
import { v4 as uuidv4 } from 'uuid';
import { Activity } from '../src/types/assistant-content/activity';
import { Prism } from '@nia/prism';
import { DynamicContentBlock } from '@nia/prism/core/blocks';
import { NextRequest } from 'next/server';
import { createTestAssistant, createTestTenant } from '@nia/prism/testing';
// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { POST } from '../src/app/api/upload-content/route';

function ActivityDefinition(tenantId: string): DynamicContentBlock.IDynamicContent {
  return {
    tenantId: tenantId,
    name: 'Activity Dynamic Content',
    dataModel: {
      block: 'Activity',
      indexer: [
        'location',
        'excursion_name'
      ],
      jsonSchema: {
        additionalProperties: false,
        properties: {
          _id: {
            format: 'uuid',
            type: 'string'
          },
          category: {
            type: 'string'
          },
          client_code: {
            type: 'string'
          },
          description: {
            type: 'string'
          },
          excursion_name: {
            type: 'string'
          },
          is_active: {
            type: 'boolean'
          },
          location: {
            type: 'string'
          },
          photo_url: {
            format: 'url',
            type: 'string'
          },
          tenantId: {
            type: 'string'
          },
          time: {
            type: 'string'
          }
        },
        required: [
          'tenantId',
          'excursion_name',
          'time',
          'description',
          'location',
          'category',
          'client_code'
        ],
        type: 'object'
      }
    },
    uiConfig: {},
    access: { allowAnonymous: true }
  };
};

describe('Upload Content API Tests', () => {

  it('should upload valid activity items', async () => {
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const assistantData = {
      name: `Assistant ${uuidv4()}`,
      tenantId: tenant._id!,
    };
    const assistant = await createTestAssistant(assistantData);
    expect(assistant._id).toBeTruthy();

    const prism = await Prism.getInstance();
    const activityDefRecord = await prism.createDefinition(ActivityDefinition(tenant._id!), tenant._id!);
    expect(activityDefRecord).toBeTruthy();
    if (!activityDefRecord || activityDefRecord.total === 0 || activityDefRecord.items.length === 0) {
      throw new Error('Failed to create Activity content definition');
    }

    const activityData: Activity[] = [
      {
        tenantId: tenant._id!,
        excursion_name: 'Excursion 1',
        time: new Date().toISOString(),
        description: 'Excursion to the park',
        location: 'Central Park',
        photo_url: 'https://example.com/photo1.jpg',
        is_active: true,
        category: 'Nature',
        client_code: 'A1',
      },
      {
        tenantId: tenant._id!,
        excursion_name: 'Excursion 2',
        time: new Date().toISOString(),
        description: 'Excursion to the zoo',
        location: 'City Zoo',
        photo_url: 'https://example.com/photo2.jpg',
        is_active: false,
        category: 'Animals',
        client_code: 'A2',
      },
    ];

    const url = `http://localhost:3000/api/upload-content`;
    const req = new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify({
        contentType: 'Activity',
        collectionName: 'activities',
        data: activityData,
        assistantId: assistant._id,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const resData = await response.json() as any;
    expect(resData.success).toBe(true);
    expect(resData.insertedCount).toBe(2);
    expect(resData.errors).toHaveLength(0);
  });

  it('should return error for missing required fields', async () => {
    const url = `http://localhost:3000/api/upload-content`;
    const req = new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
    const resData = await response.json() as any;
    expect(resData.error).toMatch(/Missing required fields/);
  });

  it('should return error for unsupported content type', async () => {
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const assistantData = {
      name: `Assistant ${uuidv4()}`,
      tenantId: tenant._id!,
    };
    const assistant = await createTestAssistant(assistantData);
    expect(assistant._id).toBeTruthy();

    const url = `http://localhost:3000/api/upload-content`;
    const req = new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify({
        contentType: 'unknownType',
        collectionName: 'unknown',
        data: [{}],
        assistantId: assistant._id,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    expect(response.status).toBe(404);
    const resData = await response.json() as any;
    expect(resData.error).toMatch(/Unsupported content type/);
  });

  it('should return error for all invalid data', async () => {
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const assistantData = {
      name: `Assistant ${uuidv4()}`,
      tenantId: tenant._id!,
    };
    const assistant = await createTestAssistant(assistantData);
    expect(assistant._id).toBeTruthy();

    const prism = await Prism.getInstance();
    const activityDefRecord = await prism.createDefinition(ActivityDefinition(tenant._id!), tenant._id!);
    expect(activityDefRecord).toBeTruthy();
    if (!activityDefRecord || activityDefRecord.total === 0 || activityDefRecord.items.length === 0) {
      throw new Error('Failed to create Activity content definition');
    }
    const url = `http://localhost:3000/api/upload-content`;
    const req = new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify({
        contentType: 'Activity',
        collectionName: 'activities',
        data: [{ foo: 'bar' }],
        assistantId: assistant._id,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
    const resData = await response.json() as any;
    expect(resData.error).toMatch(/No valid items to upload/);
    expect(resData.errors.length).toBeGreaterThan(0);
  });
}); 