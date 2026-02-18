/**
 * @jest-environment node
 */

import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantBlock, UserBlock } from '@nia/prism/core/blocks';
import { createTestTenant, createTestUser } from '@nia/prism/testing/testlib';
import { v4 as uuidv4 } from 'uuid';

import { HtmlContent } from '@interface/features/HtmlGeneration';

import {
  createHtmlContent,
  createHtmlGeneration,
  deleteHtmlContent,
  findHtmlContentById,
  getHtmlGeneration,
  listHtmlContent,
  listHtmlGenerations,
  updateHtmlContent
} from '../actions/html-generation-actions';

// Mock assistant actions for tenant resolution
const mockGetAssistantBySubDomain = jest.fn();
const mockGetAssistantByName = jest.fn();
jest.mock('@nia/prism/core/actions/assistant-actions', () => ({
  getAssistantBySubDomain: (...args: any[]) => mockGetAssistantBySubDomain(...args),
  getAssistantByName: (...args: any[]) => mockGetAssistantByName(...args)
}));

// Mock AI providers to avoid external API calls during tests
jest.mock('../lib/providers', () => ({
  generateWithAnthropic: jest.fn().mockResolvedValue('<html><body><h1>Mock AI Generated Content</h1></body></html>'),
  generateWithOpenAI: jest.fn().mockResolvedValue('<html><body><h1>Mock AI Generated Content</h1></body></html>'),
  stripCodeFences: jest.fn().mockImplementation((text: string) => text),
  getApiSchemaInfo: jest.fn().mockResolvedValue(undefined)
}));


// We still mock getSessionSafely to inject our test user id, but leave Prism real.
jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn()
}));
// Mock AI providers to avoid real network latency
jest.mock('../lib/providers', () => ({
  generateWithAnthropic: jest.fn().mockResolvedValue('<!DOCTYPE html><html><head><title>Mock Anthropic</title></head><body>Anthropic Mock</body></html>'),
  generateWithOpenAI: jest.fn().mockResolvedValue('<!DOCTYPE html><html><head><title>Mock OpenAI</title></head><body>OpenAI Mock</body></html>'),
  stripCodeFences: (s: string) => s
}));
const getSessionSafelyMock = getSessionSafely as unknown as jest.Mock;

// Utility to build HtmlContent input
function makeContent(overrides: Partial<HtmlContent> = {}): HtmlContent {
  return {
    title: 'Test Game',
    contentType: 'game',
    htmlContent: '<html/>',
    createdBy: '', // replaced with session
    tenantId: '',
    isAiGenerated: true,
    userRequest: 'req',
    tags: [],
    ...overrides
  } as HtmlContent;
}

describe('HtmlGeneration actions (integration)', () => {
  let tenant: TenantBlock.ITenant & { _id: string };
  let user: UserBlock.IUser & { _id: string };
  let unique: string;

  beforeAll(async () => {
    unique = uuidv4().slice(0, 8);
    user = await createTestUser({
      name: `HG User ${unique}`,
      email: `hg.user.${unique}@example.com`,
      interests: ['html'],
      phone_number: '5555551111'
    } as any, 'password123') as any;
    tenant = await createTestTenant({ name: `HG Tenant ${unique}` }) as any;
    
    // Configure mocks to return the dynamically created tenant
    mockGetAssistantBySubDomain.mockResolvedValue({ _id: 'asst1', name: 'Nia', tenantId: tenant._id });
    mockGetAssistantByName.mockResolvedValue({ _id: 'asst1', name: 'Nia', tenantId: tenant._id });
    
    getSessionSafelyMock.mockResolvedValue({ user: { id: user._id } });
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Re-configure mocks after clearing
    mockGetAssistantBySubDomain.mockResolvedValue({ _id: 'asst1', name: 'Nia', tenantId: tenant._id });
    mockGetAssistantByName.mockResolvedValue({ _id: 'asst1', name: 'Nia', tenantId: tenant._id });
    getSessionSafelyMock.mockResolvedValue({ user: { id: user._id } });
  });

  let createdContent: HtmlContent & { _id?: string };

  it('creates html content', async () => {
    const content = await createHtmlContent(makeContent({ title: `Game ${unique}` }), tenant._id!);
    expect(content).toBeDefined();
    expect(content.title).toBe(`Game ${unique}`);
    expect((content as any).createdBy).toBe(user._id);
    createdContent = content as any;
  });

  it('finds content by id', async () => {
    const id = createdContent._id!;
    const found = await findHtmlContentById(id, tenant._id!);
    expect(found).toBeDefined();
    expect(found!.title).toBe(createdContent.title);
  });

  it('lists content for user', async () => {
    const list = await listHtmlContent(user._id!, tenant._id!, 'game');
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list.find(c => c.title === createdContent.title)).toBeTruthy();
  });

  it('updates content', async () => {
    const id = createdContent._id!;
    const updated = await updateHtmlContent(id, { title: `Updated ${unique}` }, tenant._id!);
    expect(updated.title).toBe(`Updated ${unique}`);
    createdContent = updated as any;
  });

  it('creates a generation request + lists generations', async () => {
    const gen = await createHtmlGeneration({
      prompt: 'Make a thing',
      userRequest: 'req',
      tenantId: tenant._id!,
      userId: user._id!,
      mode: 'fast',
      title: `Gen ${unique}`,
      description: 'desc',
      contentType: 'game',
      features: ['interactive', 'scoring'],
      useOpenAI: false,
      assistantName: 'Nia'
    } as any);
    expect(gen).toBeDefined();
    expect(gen.title).toBe(`Gen ${unique}`);  // Title is used as-is without versioning

    const retrieved = await getHtmlGeneration((gen as any)._id, 'Nia');
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe(`Gen ${unique}`);  // Title is used as-is without versioning

  const generations = await listHtmlGenerations({ userId: user._id!, tenantId: tenant._id!, limit: 10 } as any);
    expect(Array.isArray(generations)).toBe(true);
  }, 45000); // Increase timeout to 45 seconds

  it('deletes content', async () => {
    // Re-create content ensuring createdBy aligns with mocked session user
    const fresh = await createHtmlContent(makeContent({ title: `ToDelete ${unique}` }), tenant._id!);
    const delId = fresh._id!;
    const success = await deleteHtmlContent(delId, tenant._id!);
    expect(success).toBe(true);
  });
});
