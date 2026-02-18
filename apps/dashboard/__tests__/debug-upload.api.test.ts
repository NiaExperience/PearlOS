/**
 * @jest-environment node
 */
import { Prism } from '@nia/prism';
import { DynamicContentBlock } from '@nia/prism/core/blocks';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { createTestTenant, createTestAssistant } from '../../../packages/prism/src/testing';
// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { GET } from '../src/app/api/debug-upload/route';
import { Guest } from '../src/types/assistant-content/guest';
import { Speaker } from '../src/types/assistant-content/speaker';

// Mock file system operations
// We wire this up with the actual implementations because this affects all tests since
// It's declared at a file global level
jest.mock('fs/promises', () => ({
  readFile: (jest.fn() as jest.Mock).mockImplementation(jest.requireActual('fs/promises').readFile),
  readdir: (jest.fn() as jest.Mock).mockImplementation(jest.requireActual('fs/promises').readdir),
}));

// Mock the authentication system
jest.mock('@nia/prism/core/auth', () => ({
  requireTenantAdmin: jest.fn().mockResolvedValue(null), // null means auth success
}));

function SpeakerDefinition(tenantId: string): DynamicContentBlock.IDynamicContent {
  return {
    tenantId: tenantId,
    name: 'Speaker Dynamic Content',
    dataModel: {
      block: 'Speaker',
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          _id: {
            format: 'uuid',
            type: 'string'
          },
          assistant_id: {
            type: 'string'
          },
          bio: {
            type: 'string'
          },
          categories: {
            type: 'string'
          },
          company: {
            type: 'string'
          },
          dayTime: {
            type: 'string'
          },
          email: {
            format: 'email',
            type: 'string'
          },
          name: {
            type: 'string'
          },
          photo: {
            type: 'string'
          },
          session: {
            type: 'string'
          },
          tellMeMore: {
            type: 'string'
          },
          title: {
            type: 'string'
          }
        },
        required: ['name', 'assistant_id']
      },
      indexer: ['name', 'categories'],
      parent: { type: 'field' as const, field: 'assistant_id' },
    },
    uiConfig: {
      card: {
        descriptionField: 'bio',
        imageField: 'photo',
        linkField: 'tellMeMore',
        tagField: 'categories',
        titleField: 'name'
      },
      detailView: {
        displayFields: [
          'title',
          'company',
          'session',
          'dayTime'
        ]
      },
      listView: {
        displayFields: [
          'title',
          'company'
        ]
      }
    },
    access: { allowAnonymous: true }
  };
}

function GuestDefinition(tenantId: string): DynamicContentBlock.IDynamicContent {
  return {
    tenantId: tenantId,
    name: 'Guest Dynamic Content',
    dataModel: {
      block: 'Guest',
      jsonSchema: {
        additionalProperties: false,
        properties: {
          _id: {
            format: 'uuid',
            type: 'string'
          },
          assistant_id: {
            type: 'string'
          },
          chatHistory: {
            items: {
              additionalProperties: false,
              properties: {
                message: {
                  type: 'string'
                },
                metadata: {
                  additionalProperties: false,
                  properties: {},
                  type: 'object'
                },
                sender: {
                  type: 'string'
                },
                timestamp: {
                  format: 'date',
                  type: 'string'
                }
              },
              required: [
                'message',
                'sender'
              ],
              type: 'object'
            },
            type: 'array'
          },
          eventHistory: {
            items: {
              additionalProperties: false,
              properties: {
                details: {
                  items: {
                    type: 'string'
                  },
                  type: 'array'
                },
                eventType: {
                  type: 'string'
                },
                timestamp: {
                  format: 'date',
                  type: 'string'
                }
              },
              required: [
                'eventType'
              ],
              type: 'object'
            },
            type: 'array'
          },
          interests: {
            items: {
              type: 'string'
            },
            type: 'array'
          },
          messages: {
            items: {
              additionalProperties: false,
              properties: {
                content: {
                  type: 'string'
                },
                timestamp: {
                  format: 'date',
                  type: 'string'
                },
                type: {
                  type: 'string'
                }
              },
              required: [
                'content'
              ],
              type: 'object'
            },
            type: 'array'
          },
          name: {
            type: 'string'
          },
          passPhrase: {
            type: 'string'
          },
          phone_number: {
            type: 'string'
          }
        },
        required: [
          'assistant_id',
          'name',
          'phone_number',
          'passPhrase'
        ],
        type: 'object'
      },
      indexer: [
        'passPhrase',
        'phone_number'
      ],
      parent: { type: 'field' as const, field: 'assistant_id' }
    },
    uiConfig: {},
    access: { allowAnonymous: true }
  };
}

async function createTestGuests(data: Guest[], tenantId: string, assistantId: string): Promise<Guest[]> {
  const prism = await Prism.getInstance();
  const guestDefRecord = await prism.createDefinition(GuestDefinition(tenantId), tenantId);
  if (!guestDefRecord || guestDefRecord.total === 0 || guestDefRecord.items.length === 0) {
    throw new Error('Failed to create Guest content definition');
  }
  const guestResults = await prism.bulkCreate('Guest', data, tenantId);
  if (!guestResults || guestResults.total === 0 || guestResults.items.length === 0) {
    throw new Error('Failed to create guests');
  }
  return guestResults.items as unknown as Guest[];
}

async function createTestSpeaker(data: Speaker, tenantId: string, assistantId: string) {
  const prism = await Prism.getInstance();
  const speakerDefRecord = await prism.createDefinition(SpeakerDefinition(tenantId), tenantId);
  if (!speakerDefRecord || speakerDefRecord.total === 0 || speakerDefRecord.items.length === 0) {
    throw new Error('Failed to create Speaker content definition');
  }
  const created = await prism.create('Speaker', data, tenantId);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create speakers');
  }
  return created.items[0] as unknown as Speaker;
}

let tenantId: string;
let assistantId: string;
describe('Debug Upload API Tests', () => {
  beforeEach(async () => {
    // Create real test tenant and assistant
    const tenant = await createTestTenant();
    tenantId = tenant._id!;

    const assistant = await createTestAssistant({
      name: `Assistant ${uuidv4()}`,
      tenantId: tenantId
    });
    assistantId = assistant._id!;
  });

  it('should return debug information for basic GET request', async () => {
    // Mock file system operations
    const { readdir } = require('fs/promises');
    readdir.mockResolvedValue(['upload-file1.json', 'upload-file2.json', 'other-file.txt']);

    // Create a GET request without assistantId (basic request that only checks temp files)
    const url = `http://localhost:3000/api/debug-upload?tenantId=${tenantId}`;
    const request = new Request(url, {
      method: 'GET',
    });
    const req = new NextRequest(request);

    // Call the GET function
    const response = await GET(req);

    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.timestamp).toBeDefined();
    expect(data.tempFiles).toBeDefined();
    expect(data.tempFiles).toHaveLength(2);
    expect(data.tempFiles[0].name).toBe('upload-file1.json');
    expect(data.tempFiles[1].name).toBe('upload-file2.json');
    expect(data.databaseCounts).toBeDefined();
    expect(data.sampleData).toBeNull();
  });

  it('should return debug information with assistant ID', async () => {
    // Mock file system operations
    const { readdir } = require('fs/promises');
    readdir.mockResolvedValue(['upload-file1.json']);

    // create two guests and a speaker
    const testGuests = await createTestGuests([
      {
        assistant_id: assistantId,
        phone_number: '+1234567890',
        passPhrase: 'test-passphrase',
        name: 'Guest One',
      },
      {
        assistant_id: assistantId,
        phone_number: '+0987654321',
        passPhrase: 'test-passphrase-2',
        name: 'Guest Two',
      }
    ], tenantId, assistantId);

    expect(testGuests.length).toBe(2);
    expect(testGuests[0]._id).toBeDefined();
    expect(testGuests[1]._id).toBeDefined();
    expect(testGuests[0].assistant_id).toBe(assistantId);
    expect(testGuests[1].assistant_id).toBe(assistantId);

    // create a test speaker
    const testSpeaker = await createTestSpeaker({
      assistant_id: assistantId,
      name: 'Speaker One',
      company: 'Test Company',
      title: 'Test Speaker Title',
      photo: 'https://example.com/photo.jpg',
      session: 'Test Session',
      bio: 'This is a test speaker bio.',
      dayTime: 'Morning',
      categories: ['Category1', 'Category2'],
    }, tenantId, assistantId);

    expect(testSpeaker._id).toBeDefined();
    expect(testSpeaker.assistant_id).toBe(assistantId);
    expect(testSpeaker.name).toBe('Speaker One');

    // Create a GET request with assistant ID
    const url = `http://localhost:3000/api/debug-upload?assistantId=${assistantId}&tenantId=${tenantId}`;
    const request = new Request(url, {
      method: 'GET',
    });
    const req = new NextRequest(request);

    // Call the GET function
    const response = await GET(req);

    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.timestamp).toBeDefined();
    expect(data.tempFiles).toBeDefined();
    expect(data.databaseCounts).toBeDefined();
    expect(data.databaseCounts.Guest).toBe(2);
    expect(data.databaseCounts.Speaker).toBe(1);
    expect(data.sampleDocument).toBeDefined();
    expect(data.sampleDocument.collection).toBe('guests');
    expect([testGuests[0]._id, testGuests[1]._id]).toContain(data.sampleDocument.document._id);
  });

  it('should return debug information with temp file content', async () => {
    // Mock file system operations
    const { readdir, readFile } = require('fs/promises');
    readdir.mockResolvedValue(['upload-file1.json']);
    readFile.mockResolvedValue(JSON.stringify([
      { id: 1, name: 'Item 1', type: 'test' },
      { id: 2, name: 'Item 2', type: 'test' },
      { id: 3, name: 'Item 3', type: 'test' }
    ]));

    // Create a GET request with temp file
    const url = `http://localhost:3000/api/debug-upload?tempFile=/tmp/upload-file1.json&tenantId=${tenantId}`;
    const request = new Request(url, {
      method: 'GET',
    });
    const req = new NextRequest(request);

    // Call the GET function
    const response = await GET(req);

    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.timestamp).toBeDefined();
    expect(data.tempFiles).toBeDefined();
    expect(data.sampleData).toBeDefined();
    expect(data.sampleData.totalItems).toBe(3);
    expect(data.sampleData.firstItem.id).toBe(1);
    expect(data.sampleData.lastItem.id).toBe(3);
    expect(data.sampleData.sampleStructure).toContain('id');
    expect(data.sampleData.sampleStructure).toContain('name');
    expect(data.sampleData.sampleStructure).toContain('type');
  });

  it('should handle file system errors gracefully', async () => {
    // Create a GET request
    const url = `http://localhost:3000/api/debug-upload?tenantId=${tenantId}`;
    const request = new Request(url, {
      method: 'GET',
    });
    const req = new NextRequest(request);

    // Mock file system operations to throw error
    const { readdir } = require('fs/promises');
    readdir.mockRejectedValue(new Error('Permission denied'));
    // Call the GET function
    const response = await GET(req);
    // revert the mock to the actual implementation
    readdir.mockImplementation(jest.requireActual('fs/promises').readdir),

    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.timestamp).toBeDefined();
    expect(data.tempFilesError).toBe('Permission denied');
    expect(data.databaseCounts).toBeDefined();
  });

  it('should handle temp file read errors gracefully', async () => {
    // Mock file system operations
    const { readdir, readFile } = require('fs/promises');
    readdir.mockResolvedValue(['upload-file1.json']);
    readFile.mockRejectedValue(new Error('File not found'));

    // Create a GET request with temp file
    const url = `http://localhost:3000/api/debug-upload?tempFile=/tmp/nonexistent.json&tenantId=${tenantId}`;
    const request = new Request(url, {
      method: 'GET',
    });
    const req = new NextRequest(request);

    // Call the GET function
    const response = await GET(req);

    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.timestamp).toBeDefined();
    expect(data.tempFiles).toBeDefined();
    expect(data.tempFileError).toBe('File not found');
  });

  it('should handle invalid JSON in temp file gracefully', async () => {
    // Mock file system operations
    const { readdir, readFile } = require('fs/promises');
    readdir.mockResolvedValue(['upload-file1.json']);
    readFile.mockResolvedValue('invalid json content');

    // Create a GET request with temp file
    const url = `http://localhost:3000/api/debug-upload?tempFile=/tmp/invalid.json&tenantId=${tenantId}`;
    const request = new Request(url, {
      method: 'GET',
    });
    const req = new NextRequest(request);

    // Call the GET function
    const response = await GET(req);

    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.timestamp).toBeDefined();
    expect(data.tempFiles).toBeDefined();
    expect(data.tempFileError).toBeDefined();
  });

}); 