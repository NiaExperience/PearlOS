/**
 * @jest-environment node
 */

import { Prism } from '@nia/prism';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantBlock, UserBlock } from '@nia/prism/core/blocks';
import { createTestTenant, createTestUser } from '@nia/prism/testing/testlib';
import { v4 as uuidv4 } from 'uuid';

import { HtmlContent } from '@interface/features/HtmlGeneration';

import {
  createHtmlContent,
  findHtmlContentByJobId
} from '../actions/html-generation-actions';

// Mock assistant actions for tenant resolution
const mockGetAssistantBySubDomain = jest.fn();
const mockGetAssistantByName = jest.fn();
jest.mock('@nia/prism/core/actions/assistant-actions', () => ({
  getAssistantBySubDomain: (...args: any[]) => mockGetAssistantBySubDomain(...args),
  getAssistantByName: (...args: any[]) => mockGetAssistantByName(...args)
}));

// Mock AI providers
jest.mock('../lib/providers', () => ({
  generateWithAnthropic: jest.fn().mockResolvedValue('<html><body><h1>Mock AI Generated Content</h1></body></html>'),
  generateWithOpenAI: jest.fn().mockResolvedValue('<html><body><h1>Mock AI Generated Content</h1></body></html>'),
  stripCodeFences: (s: string) => s,
  getApiSchemaInfo: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn()
}));

const getSessionSafelyMock = getSessionSafely as unknown as jest.Mock;

describe.skip('HtmlGeneration Recovery (Job ID Lookup)', () => {
  let tenant: TenantBlock.ITenant & { _id: string };
  let user: UserBlock.IUser & { _id: string };
  let unique: string;

  beforeAll(async () => {
    unique = uuidv4().slice(0, 8);
    user = await createTestUser({
      name: `HG Recovery User ${unique}`,
      email: `hg.recovery.${unique}@example.com`,
      interests: ['html'],
      phone_number: '5555552222'
    } as any, 'password123') as any;
    tenant = await createTestTenant({ name: `HG Recovery Tenant ${unique}` }) as any;
    
    getSessionSafelyMock.mockResolvedValue({ user: { id: user._id } });
  });

  afterEach(() => {
    jest.clearAllMocks();
    getSessionSafelyMock.mockResolvedValue({ user: { id: user._id } });
  });

  afterAll(async () => {
    await Prism.clearInstances();
  });

  it('should find content by jobId stored in metadata using dotted notation indexer', async () => {
    const jobId = `job-${uuidv4()}`;
    const contentData: HtmlContent = {
      title: `Recovery Test ${unique}`,
      contentType: 'game',
      htmlContent: '<div>Recovery Content</div>',
      userRequest: 'Create a recovery test',
      isAiGenerated: true,
      tenantId: tenant._id,
      metadata: {
        jobId: jobId,
        otherMeta: 'test'
      }
    };

    // 1. Create content with jobId in metadata
    const created = await createHtmlContent(contentData, tenant._id);
    expect(created).toBeDefined();
    expect(created.metadata?.jobId).toBe(jobId);

    // 2. Find by Job ID
    const found = await findHtmlContentByJobId(jobId, tenant._id);
    
    expect(found).toBeDefined();
    expect(found?._id).toBe(created._id);
    expect(found?.title).toBe(contentData.title);
    expect(found?.metadata?.jobId).toBe(jobId);
  });

  it('should return null for non-existent job ID', async () => {
    const found = await findHtmlContentByJobId('non-existent-job-id', tenant._id);
    expect(found).toBeNull();
  });
});
