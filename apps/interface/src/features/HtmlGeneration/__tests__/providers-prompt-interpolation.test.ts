/**
 * @jest-environment node
 */

// Test prompt interpolation with real database
// Focus: verifying appletApi functional prompt is properly retrieved and interpolated

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { FunctionalPromptActions } from '@nia/prism';
import { getLogger } from '@interface/lib/logger';

// Mock auth providers (not under test, but imported indirectly in some environments)
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next-auth/providers/google', () => ({ default: jest.fn() }));

// Global fetch mock for Anthropic (to prevent actual API calls)
global.fetch = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// OpenAI mock (to prevent actual API calls)
const mockCreate = jest.fn() as jest.MockedFunction<any>;
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } }
  }))
}));

// Import after mocks
import { generateWithAnthropic, generateWithOpenAI } from '../lib/providers';

const logger = getLogger('HtmlGenerationPromptInterpolationTest');

describe('HtmlGeneration prompt interpolation with database', () => {
  const TEST_USER_ID = 'test-interpolation-user';
  const TEST_TENANT_ID = 'test-tenant-123';
  const TEST_ASSISTANT_NAME = 'TestAssistant';

  beforeAll(async () => {
    // Set up API keys for providers
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    // Create the appletApi functional prompt in the database with template variables
    const promptTemplate = `
## API Integration Requirements

You are building an interface that will use the AppletStorage API for data persistence.

Tenant ID: {{tenantId}}
{{#assistantName}}Assistant Name: {{assistantName}}{{/assistantName}}

The AppletStorage API allows you to save and retrieve any JSON data structure your applet needs.

Use standard fetch() calls to interact with the API:
- POST /api/content/appletStorage - Create new data
- GET /api/content/appletStorage?appletId=<id> - Retrieve data
- PUT /api/content/appletStorage/<id> - Update existing data

All data must include an appletId field to identify which applet owns it.
`;

    await FunctionalPromptActions.createOrUpdate('appletApi', promptTemplate.trim(), TEST_USER_ID);
  });

  afterAll(async () => {
    // Clean up the test prompt from database
    try {
      await FunctionalPromptActions.deleteByFeatureKey('appletApi');
    } catch (error) {
      // Ignore errors during cleanup
      logger.warn('Cleanup warning', { error });
    }
  });

  describe('Prompt enhancement with interpolation', () => {
    beforeEach(() => {
      mockFetch.mockReset();
      mockCreate.mockReset();
    });

    it('should interpolate tenantId variable correctly', async () => {
      // Mock Anthropic response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          content: [{ type: 'text', text: '<html>Test</html>' }]
        })
      } as Response);

      const apiSchemaInfo = {
        contentTypes: [{
          name: 'AppletStorage',
          type: 'AppletStorage',
          description: 'Test',
          jsonSchema: {},
          sampleData: {}
        }],
        tenantId: TEST_TENANT_ID,
        assistantName: undefined
      };

      await generateWithAnthropic('Build a todo list', { apiSchemaInfo });

      // Verify the request was made
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      const enhancedPrompt = requestBody.messages[0].content;

      // Verify original prompt is present
      expect(enhancedPrompt).toContain('Build a todo list');
      
      // Verify template was interpolated
      expect(enhancedPrompt).toContain('API Integration Requirements');
      expect(enhancedPrompt).toContain(`Tenant ID: ${TEST_TENANT_ID}`);
      
      // Verify conditional block is NOT included (no assistantName)
      expect(enhancedPrompt).not.toContain('Assistant Name:');
      
      // Verify template markers were removed
      expect(enhancedPrompt).not.toContain('{{tenantId}}');
      expect(enhancedPrompt).not.toContain('{{#assistantName}}');
    });

    it('should interpolate both tenantId and assistantName when provided', async () => {
      // Mock Anthropic response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          content: [{ type: 'text', text: '<html>Test</html>' }]
        })
      } as Response);

      const apiSchemaInfo = {
        contentTypes: [{
          name: 'AppletStorage',
          type: 'AppletStorage',
          description: 'Test',
          jsonSchema: {},
          sampleData: {}
        }],
        tenantId: TEST_TENANT_ID,
        assistantName: TEST_ASSISTANT_NAME
      };

      await generateWithAnthropic('Build a calculator', { apiSchemaInfo });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      const enhancedPrompt = requestBody.messages[0].content;

      // Verify original prompt
      expect(enhancedPrompt).toContain('Build a calculator');
      
      // Verify template was interpolated
      expect(enhancedPrompt).toContain('API Integration Requirements');
      expect(enhancedPrompt).toContain(`Tenant ID: ${TEST_TENANT_ID}`);
      
      // Verify conditional block IS included (assistantName provided)
      expect(enhancedPrompt).toContain(`Assistant Name: ${TEST_ASSISTANT_NAME}`);
      
      // Verify template markers were removed
      expect(enhancedPrompt).not.toContain('{{');
      expect(enhancedPrompt).not.toContain('}}');
    });

    it('should work with OpenAI provider as well', async () => {
      // Mock OpenAI response
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '<html>OpenAI Test</html>'
          }
        }]
      });

      const apiSchemaInfo = {
        contentTypes: [{
          name: 'AppletStorage',
          type: 'AppletStorage',
          description: 'Test',
          jsonSchema: {},
          sampleData: {}
        }],
        tenantId: TEST_TENANT_ID,
        assistantName: TEST_ASSISTANT_NAME
      };

      await generateWithOpenAI('Create a game', { apiSchemaInfo });

      // Verify the request was made
      expect(mockCreate).toHaveBeenCalledTimes(1);
      
      const requestConfig = mockCreate.mock.calls[0][0];
      const userMessage = requestConfig.messages.find((m: any) => m.role === 'user');
      const enhancedPrompt = userMessage.content;

      // Verify interpolation worked
      expect(enhancedPrompt).toContain('Create a game');
      expect(enhancedPrompt).toContain('API Integration Requirements');
      expect(enhancedPrompt).toContain(`Tenant ID: ${TEST_TENANT_ID}`);
      expect(enhancedPrompt).toContain(`Assistant Name: ${TEST_ASSISTANT_NAME}`);
    });

    it('should handle empty conditional blocks correctly', async () => {
      // Mock Anthropic response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          content: [{ type: 'text', text: '<html>Test</html>' }]
        })
      } as Response);

      const apiSchemaInfo = {
        contentTypes: [{
          name: 'AppletStorage',
          type: 'AppletStorage',
          description: 'Test',
          jsonSchema: {},
          sampleData: {}
        }],
        tenantId: TEST_TENANT_ID,
        assistantName: '' // Empty string should be treated as falsy
      };

      await generateWithAnthropic('Build a form', { apiSchemaInfo });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      const enhancedPrompt = requestBody.messages[0].content;

      // Verify tenantId is interpolated
      expect(enhancedPrompt).toContain(`Tenant ID: ${TEST_TENANT_ID}`);
      
      // Verify conditional block is NOT included (empty assistantName)
      expect(enhancedPrompt).not.toContain('Assistant Name:');
    });

    it('should combine original prompt with enhanced instructions', async () => {
      // Mock Anthropic response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          content: [{ type: 'text', text: '<html>Test</html>' }]
        })
      } as Response);

      const originalPrompt = 'Create a dashboard with real-time data updates';
      const apiSchemaInfo = {
        contentTypes: [{
          name: 'AppletStorage',
          type: 'AppletStorage',
          description: 'Test',
          jsonSchema: {},
          sampleData: {}
        }],
        tenantId: TEST_TENANT_ID,
        assistantName: TEST_ASSISTANT_NAME
      };

      await generateWithAnthropic(originalPrompt, { apiSchemaInfo });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      const enhancedPrompt = requestBody.messages[0].content;

      // Verify both parts are present
      expect(enhancedPrompt).toContain(originalPrompt);
      expect(enhancedPrompt).toContain('API Integration Requirements');
      
      // Verify they are properly separated (with newlines)
      const parts = enhancedPrompt.split('\n\n');
      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0]).toContain('Create a dashboard');
      expect(enhancedPrompt).toContain('AppletStorage API');
    });

    it('should provide API usage instructions in the enhanced prompt', async () => {
      // Mock Anthropic response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          content: [{ type: 'text', text: '<html>Test</html>' }]
        })
      } as Response);

      const apiSchemaInfo = {
        contentTypes: [{
          name: 'AppletStorage',
          type: 'AppletStorage',
          description: 'Test',
          jsonSchema: {},
          sampleData: {}
        }],
        tenantId: TEST_TENANT_ID,
        assistantName: TEST_ASSISTANT_NAME
      };

      await generateWithAnthropic('Build an app', { apiSchemaInfo });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      const enhancedPrompt = requestBody.messages[0].content;

      // Verify API instructions are present
      expect(enhancedPrompt).toContain('AppletStorage API');
      expect(enhancedPrompt).toContain('POST /api/content/appletStorage');
      expect(enhancedPrompt).toContain('GET /api/content/appletStorage');
      expect(enhancedPrompt).toContain('PUT /api/content/appletStorage');
      expect(enhancedPrompt).toContain('appletId');
      expect(enhancedPrompt).toContain('fetch()');
    });
  });
});
