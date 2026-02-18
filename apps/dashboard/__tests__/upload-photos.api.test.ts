/**
 * @jest-environment node
 */
import { Prism } from '@nia/prism';
import { TenantActions, ToolsActions } from '@nia/prism/core/actions';
import { UserTenantRoleBlock, ToolBlock } from '@nia/prism/core/blocks';
import { DynamicContentBlock } from '@nia/prism/core/blocks';
import { validateContentData } from '@nia/prism/core/content/utils';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { createTestTenant, createTestAssistant } from '../../../packages/prism/src/testing';


// Mock the auth middleware module
// eslint-disable-next-line import/order
import { testSessionUser } from '../../../packages/prism/src/testing';
// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { POST } from '../src/app/api/upload-photos/route';

let tenantId = '';
let assistantId = '';

function PhotoDefinition(tenantId: string): DynamicContentBlock.IDynamicContent {
  return {
    tenantId: tenantId,
    name: 'Photo Dynamic Content',
    dataModel: {
      block: 'photo',
      jsonSchema: {
        additionalProperties: false,
        properties: {
          _id: {
            format: 'uuid',
            type: 'string'
          },
          album: {
            type: 'string'
          },
          assistant_id: {
            type: 'string'
          },
          imageUrls: {
            items: {
              additionalProperties: false,
              properties: {
                _id: {
                  type: 'string'
                },
                album: {
                  type: 'string'
                },
                information: {
                  additionalProperties: false,
                  properties: {
                    text: {
                      type: 'string'
                    }
                  },
                  type: 'object'
                },
                url: {
                  format: 'url',
                  type: 'string'
                }
              },
              required: [
                'url'
              ],
              type: 'object'
            },
            type: 'array'
          },
          toolId: {
            format: 'uuid',
            type: 'string'
          },
          userId: {
            format: 'uuid',
            type: 'string'
          }
        },
        required: [
          'assistant_id',
          'imageUrls',
          'userId'
        ],
        type: 'object'
      },
      indexer: [
        'userId',
        'toolId',
        'album',
        'assistant_id'
      ],
      parent: { type: 'field' as const, field: 'assistant_id' }
    },
    uiConfig: {},
    access: { allowAnonymous: true }
  };
}

describe('Upload Photos API Tests', () => {
    beforeEach(async () => {
      //create test tenant
      const tenant = await createTestTenant();
      expect(tenant._id).toBeDefined();
      tenantId = tenant._id!;

      // Give the test user admin access to the tenant
      await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

      //create test assistant
      const assistant = await createTestAssistant({
        name: `Assistant ${uuidv4()}`,
        tenantId: tenantId
      });
      expect(assistant._id).toBeDefined();
      assistantId = assistant._id!;

      const prism = await Prism.getInstance();
      const photoDefRecord = await prism.createDefinition(PhotoDefinition(tenant._id!), tenant._id!);
      expect(photoDefRecord).toBeTruthy();
      if (!photoDefRecord || photoDefRecord.total === 0 || photoDefRecord.items.length === 0) {
        throw new Error('Failed to create Photo content definition');
      }
  });

  it('should upload photo album successfully with admin access', async () => {
    // find the default photo gallery tool
    const photoGalleryTool = await ToolsActions.getToolForUserWithBaseType(testSessionUser!._id!, ToolBlock.ToolBaseType.PHOTOS);
    expect(photoGalleryTool).not.toBeNull();
    if (!photoGalleryTool) {
      throw new Error('Photo gallery tool not found');
    }

    const photoData = {
      userId: testSessionUser!._id!,
      assistant_id: assistantId,
      toolId: photoGalleryTool._id,
      album: 'Vacation Photos',
      imageUrls: [
        { url: 'https://example.com/photo1.jpg', album: 'vacation' },
        { url: 'https://example.com/photo2.jpg', album: 'vacation' }
      ]
    }

    // validate photo data
    console.log('Validating photo album with data:', photoData);
    const dataModel = PhotoDefinition(tenantId).dataModel;
    const validate = validateContentData(photoData, dataModel);
    if (!validate.success) {
      const msg = `Photo data validation failed: ${JSON.stringify(validate.errors, null, 2)}`;
      console.error(msg);
      throw new Error(msg);
    }

    console.log('Creating photo album with data:', photoData);
    const prism = await Prism.getInstance();
    const created = await prism.create('photo', photoData, tenantId);
    if (!created || created.total === 0 || created.items.length === 0) {
      throw new Error('Failed to create photo record');
    }
    const photoId = created.items[0]._id;
    expect(photoId).toBeDefined();

    // Create a POST request
    const url = `http://localhost:3000/api/upload-photos?contentType=photo&tenantId=${tenantId}&assistantId=${assistantId}`;
    const requestData = {
      contentType: 'photo',
      photos: [
        { url: 'https://example.com/photo1.jpg', album: 'vacation' },
        { url: 'https://example.com/photo2.jpg', album: 'vacation' }
      ],
      albumName: 'Vacation Photos',
      assistantId: assistantId
    };
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    console.log('Upload Photos API response data:', data);
    expect(data.success).toBe(true);
    expect(data.photoAlbumId).toBe(photoId);
    expect(data.albumName).toBe('Vacation Photos');
    expect(data.photoCount).toBe(2);
    expect(data.message).toBe('Successfully updated photo album "Vacation Photos" with 2 photos');
  });

  it('should return 400 when photos array is missing', async () => {
    // Create a POST request without photos
    const url = `http://localhost:3000/api/upload-photos?tenantId=${tenantId}`;
    const requestData = {
      albumName: 'Vacation Photos',
      assistantId: assistantId,
      contentType: 'photo'
    };
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Photos array is required and must contain at least one photo');
  });

  it('should return 400 when photos is not an array', async () => {
    // Create a POST request with photos as string
    const url = `http://localhost:3000/api/upload-photos?tenantId=${tenantId}`;
    const requestData = {
      photos: 'not-an-array',
      albumName: 'Vacation Photos',
      assistantId: assistantId,
      contentType: 'photo'
    };
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Photos array is required and must contain at least one photo');
  });

  it('should return 400 when photos array is empty', async () => {
    // Create a POST request with empty photos array
    const url = `http://localhost:3000/api/upload-photos?tenantId=${tenantId}`;
    const requestData = {
      photos: [],
      albumName: 'Vacation Photos',
      assistantId: assistantId,
      contentType: 'photo'
    };
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Photos array is required and must contain at least one photo');
  });

  it('should return 400 when albumName is missing', async () => {
    // Create a POST request without albumName
    const url = `http://localhost:3000/api/upload-photos?tenantId=${tenantId}`;
    const requestData = {
      photos: [
        { url: 'https://example.com/photo1.jpg', album: 'vacation' }
      ],
      assistantId: assistantId,
      contentType: 'photo'
    };
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Album name is required and must be a string');
  });

  it('should return 400 when albumName is not a string', async () => {
    // Create a POST request with albumName as number
    const url = `http://localhost:3000/api/upload-photos?tenantId=${tenantId}`;
    const requestData = {
      photos: [
        { url: 'https://example.com/photo1.jpg', album: 'vacation' }
      ],
      albumName: 123,
      assistantId: assistantId,
      contentType: 'photo'
    };
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Album name is required and must be a string');
  });

  it('should return 400 when assistantId is missing', async () => {
    // Create a POST request without assistantId
    const url = `http://localhost:3000/api/upload-photos?tenantId=${tenantId}`;
    const requestData = {
      photos: [
        { url: 'https://example.com/photo1.jpg', album: 'vacation' }
      ],
      albumName: 'Vacation Photos',
      contentType: 'photo'
    };
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Assistant ID is required');
  });
}); 