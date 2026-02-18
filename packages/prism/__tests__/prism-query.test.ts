/* eslint-disable @typescript-eslint/no-explicit-any */

import { v4 as uuidv4 } from 'uuid';
import { ContentData } from '../src/core/content/types';
import { PrismContentQuery } from '../src/core/types';
import { Prism } from '../src/prism';
import { createTestAssistant, createTestTenant } from '../src/testing/testlib';

describe('Dynamic Content Actions - SpeakerEx', () => {
  const speakerRaw = {
    name: 'Test Speaker',
    bio: 'A test speaker bio',
    photo: 'https://example.com/photo.jpg',
    title: 'test-spealer-title',
    session: 'test-session',
    dayTime: new Date().toISOString(),
    categories:  ['test', 'speaker']    
  };

  // Dynamic content definition for SpeakerEx
  const contentDefinition = {
    tenantId: '', // This will be set dynamically
    name: 'SpeakerEx',
    description: 'A dynamic clone of Speaker',
    dataModel: {
      block: 'SpeakerEx',
      jsonSchema: {
        type: "object",
        properties: {
          _id: { type: "string", format: "uuid" },
          assistant_id: { type: "string" },
          name: { type: "string" },
          bio: { type: "string" },
          photo: { type: "string", format: "uri" },
          title: { type: "string" },
          session: { type: "string" },
          dayTime: { type: "string" },
          categories: { 
            type: "array", 
            items: { type: "string" }
          }
        },
        required: [
          "assistant_id",
          "name",
          "bio",
          "photo",
          "title",
          "session",
          "dayTime",
          "categories"
        ],
        additionalProperties: false
      } as any,
      indexer: ['name', 'required'],
      parent: { type: 'field' as const, field: 'assistant_id' },
    },
    uiConfig: {},
    access: {},
  };

  let tenantId: string | undefined;
  let assistantId: string | undefined;
  let speakerExId: string | undefined;
  let contentDefinitionId: string | undefined;
  let prism: Prism | null = null;

  beforeEach(async () => {
    prism = await Prism.getInstance();
    expect(prism).not.toBeNull();
    if (!prism) {
      throw new Error('Test prism not initialized');
    }
    // create a tenant
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    tenantId = tenant._id!;
    // create an assistant
    const assistant = await createTestAssistant({
      name: `Assistant ${uuidv4()}`,
      tenantId: tenantId,
    });
    expect(assistant._id).toBeTruthy();
    assistantId = assistant._id;
    contentDefinition.tenantId = tenantId;

    // create a dynamic content definition for SpeakerEx
    const dynamic_result = await prism!.createDefinition(contentDefinition, tenantId);
    expect(dynamic_result).toBeTruthy();
    expect(dynamic_result.items).toBeTruthy();
    expect(dynamic_result.items.length).toBeGreaterThan(0);
    // Use 'as any' to access _id/page_id
    contentDefinitionId = (dynamic_result.items[0] as any)._id;
    expect(contentDefinitionId).toBeDefined();

    // Create a dynamic SpeakerEx
    const data : ContentData = {...speakerRaw, assistant_id: assistantId};
    const created = await prism!.create(contentDefinition.dataModel.block, data, tenantId);
    expect(created).toBeDefined();
    expect(created.total).toBe(1);
    const page = created.items[0];
    expect(page._id).toBeTruthy();
    speakerExId = (page as any)._id;
    expect(speakerExId).toBeDefined();
  });

  it('should find SpeakerEx record by name', async () => {
    // SpeakerEx
    const where = {
      parent_id: assistantId!,
      indexer: { path: "name", equals: speakerRaw.name },
    }
    const query : PrismContentQuery = {
      tenantId: tenantId!,
      contentType: contentDefinition.dataModel.block,
      where: where,
    };
    const speakerExList = await prism!.query(query);
    const items = speakerExList.items;
    const total = speakerExList.total;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(1);
    expect(total).toBe(1);
    const speakerEx = items[0];
    expect((speakerEx as any).name).toBe(speakerRaw.name);
  });

  it('should update SpeakerEx record', async () => {
    // SpeakerEx
    const result = await prism!.findDefinition(contentDefinitionId!, tenantId);
    if (!result || result.total === 0) {
      throw new Error('Dynamic content definition not found');
    }
    const config = result.items[0];
    const dataModel = config.dataModel;
    if (!dataModel) {
      throw new Error('Dynamic content data model not found');
    }

    const updatedBio = 'Updated bio';
    const inject = {bio: updatedBio, assistant_id: assistantId};
    const speakerData = { ...speakerRaw, ...inject };
    const updated = await prism!.update(dataModel.block, speakerExId!, speakerData, tenantId!);
    expect(updated).toBeDefined();
    expect(updated.total).toBe(1);
    const updatedSpeakerEx = updated.items[0];
    expect(updatedSpeakerEx).toBeDefined();
    expect(updatedSpeakerEx._id).toBe(speakerExId);
    expect(updatedSpeakerEx.name).toBe(speakerRaw.name);
    expect(updatedSpeakerEx.bio).toBe(updatedBio);
  });

  it('should delete SpeakerEx record', async () => {
    // SpeakerEx
    const result = await prism!.findDefinition(contentDefinitionId!, tenantId);
    if (!result || result.total === 0) {
      throw new Error('Dynamic content definition not found');
    }
    const config = result.items[0];
    const dataModel = config.dataModel;
    if (!dataModel) {
      throw new Error('Dynamic content data model not found');
    }
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    const deleted = await prism!.delete(dataModel.block, speakerExId!, tenantId);
    expect(deleted).toBe(true);
  });

  it('should delete the SpeakerEx dynamic content definition', async () => {
    const deleted = await prism!.deleteDefinition(contentDefinition.dataModel.block, tenantId!);
    expect(deleted).toBe(true);
  });
  
  afterAll(async () => {
    if (prism) {
      await prism.disconnect();
      prism = null;
    }
  });
});
