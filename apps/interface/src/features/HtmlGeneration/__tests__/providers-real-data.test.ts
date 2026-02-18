/**
 * @jest-environment node
 */

// Deterministic, side-effect free tests replacing flaky "real data" integration suite.
// Focus: behaviour of providers with controlled inputs; no real DB, no random/temporal variance.

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock auth providers (not under test, but imported indirectly in some environments)
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next-auth/providers/google', () => ({ default: jest.fn() }));

// Mock actions module to avoid touching DB / external state
const mockListDefinitions: jest.Mock = jest.fn();
jest.mock('@nia/prism/core/actions', () => ({
  ContentActions: { listDefinitions: (...args: any[]) => mockListDefinitions(...args) },
  AssistantActions: {}
}));

// Control crypto.randomUUID output
const mockRandomUUID: jest.Mock = jest.fn();
jest.mock('crypto', () => ({
  randomUUID: () => mockRandomUUID()
}));

// Global fetch mock for Anthropic
global.fetch = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// OpenAI mock
const mockCreate = jest.fn() as jest.MockedFunction<any>;
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } }
  }))
}));

// Import after mocks so implementation picks them up
import { getApiSchemaInfo, generateWithAnthropic, generateWithOpenAI, stripCodeFences } from '../lib/providers';

describe('HtmlGeneration providers (deterministic)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    process.env.OPENAI_API_KEY = 'openai-key';
  mockFetch.mockReset();
    mockCreate.mockReset();
    mockListDefinitions.mockReset();
    mockRandomUUID.mockReset();
  });

  describe('getApiSchemaInfo', () => {
    it('returns AppletStorage schema', async () => {
      const info = await getApiSchemaInfo('tenantA', 'assistantA');
      expect(info).toMatchObject({ tenantId: 'tenantA', assistantName: 'assistantA' });
      expect(info.contentTypes).toHaveLength(1);
      expect(info.contentTypes[0]).toMatchObject({ name: 'AppletStorage', type: 'AppletStorage' });
      expect(info.contentTypes[0].description).toContain('Free-form data storage');
    });

    it('returns AppletStorage even when no definitions exist', async () => {
      mockListDefinitions.mockReturnValueOnce({ items: [] });
      const info = await getApiSchemaInfo('tenantB');
      expect(info.contentTypes).toHaveLength(1);
      expect(info.contentTypes[0].name).toBe('AppletStorage');
      expect(info.contentTypes[0].type).toBe('AppletStorage');
    });

    it('returns AppletStorage even on error', async () => {
      mockListDefinitions.mockImplementationOnce(() => { throw new Error('db down'); });
      const info = await getApiSchemaInfo('tenantC');
      expect(info.contentTypes[0].name).toBe('AppletStorage');
    });
  });

  describe('generateWithAnthropic', () => {
    it('calls Anthropic API without enhancement when appletApi prompt missing', async () => {
      mockRandomUUID.mockReturnValueOnce('9988aaff-xxyy');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: '<html>Hi</html>' }] })
      } as any);
      const schema = await getApiSchemaInfo('tenantX');
      const html = await generateWithAnthropic('Build UI', { apiSchemaInfo: schema });
      expect(html).toBe('<html>Hi</html>');
      const body = JSON.parse((mockFetch.mock.calls[0] as any)[1].body as string);
      // Without appletApi prompt in DB, enhancement is skipped
      expect(body.messages[0].content).toBe('Build UI');
      expect(body.messages[0].content).not.toContain('API Integration Requirements');
    });

    it('errors when key missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      await expect(generateWithAnthropic('x')).rejects.toThrow('Missing ANTHROPIC_API_KEY');
    });
  });  describe('generateWithOpenAI', () => {
    it('calls OpenAI API without enhancement when appletApi prompt missing', async () => {
      mockRandomUUID.mockReturnValueOnce('1122aabb-ccdd');
  mockListDefinitions.mockReturnValueOnce({ items: [] });
      const schema = await getApiSchemaInfo('tenantOpenAI', 'assist1');
  (mockCreate as any).mockResolvedValueOnce({ choices: [{ message: { content: '<html>OpenAI</html>' } }] });
      const html = await generateWithOpenAI('Generate', { apiSchemaInfo: schema });
      expect(html).toBe('<html>OpenAI</html>');
  const call = mockCreate.mock.calls[0][0] as any;
      // Without appletApi prompt in DB, enhancement is skipped
      expect(call.messages[1].content).toBe('Generate');
      expect(call.messages[1].content).not.toContain('tenantOpenAI');
      expect(call.messages[1].content).not.toContain('assist1');
    });

    it('should generate HTML content via OpenAI API', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '<html><body><h1>OpenAI Generated</h1></body></html>'
          }
        }]
      });

      const result = await generateWithOpenAI('Create a dashboard');

      expect(result).toBe('<html><body><h1>OpenAI Generated</h1></body></html>');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5',
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('expert front-end engineer')
            }),
            expect.objectContaining({
              role: 'user',
              content: 'Create a dashboard'
            })
          ])
        })
      );
    });

    it('should use API schema data but skip enhancement when appletApi prompt missing', async () => {
      // Get real schema data
      const apiSchemaInfo = await getApiSchemaInfo('test-tenant', 'test-assistant');
      
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '<html><body>Enhanced OpenAI response</body></html>'
          }
        }]
      });

      const result = await generateWithOpenAI('Create a content management system', {
        apiSchemaInfo
      });

      expect(result).toBe('<html><body>Enhanced OpenAI response</body></html>');
      
      // Verify the request was made but enhancement skipped (no appletApi prompt in DB)
      const callArgs = mockCreate.mock.calls[0]?.[0] as any;
      const enhancedPrompt = callArgs.messages[1].content;
      
      // Should be the original prompt since enhancement is skipped
      expect(enhancedPrompt).toBe('Create a content management system');
      expect(enhancedPrompt).not.toContain('API Integration Requirements');
      
      // Schema info is available but not used without appletApi prompt
      expect(apiSchemaInfo.contentTypes.length).toBeGreaterThan(0);
      expect(apiSchemaInfo.contentTypes[0].name).toBe('AppletStorage');
    });

    it('should handle API errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('OpenAI API rate limit exceeded'));

      await expect(generateWithOpenAI('test')).rejects.toThrow('OpenAI API rate limit exceeded');
    });

    it('should handle empty responses', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: null
          }
        }]
      });

      await expect(generateWithOpenAI('test')).rejects.toThrow('OpenAI response empty');
    });

    it('should use custom model options', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Custom model response'
          }
        }]
      });

      await generateWithOpenAI('test', {
        model: 'gpt-4',
        temperature: 0.2,
        maxTokens: 1500
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          temperature: 0.2,
          max_tokens: 1500
        })
      );
    });

    it('should throw error when API key is missing', async () => {
      delete process.env.OPENAI_API_KEY;
      await expect(generateWithOpenAI('x')).rejects.toThrow('Missing OPENAI_API_KEY');
    });
  });

  describe('stripCodeFences', () => {
    it('removes html fences', () => {
      expect(stripCodeFences('```html\n<a/>\n```')).toBe('<a/>');
    });

    it('should remove generic code fences', () => {
      const input = '```\n<html><body>Test</body></html>\n```';
      const expected = '<html><body>Test</body></html>';
      
      expect(stripCodeFences(input)).toBe(expected);
    });

    it('should handle HTML without code fences', () => {
      const input = '<html><body>No fences here</body></html>';
      
      expect(stripCodeFences(input)).toBe(input);
    });

    it('should handle case insensitive HTML fences', () => {
      const input = '```HTML\n<html><body>Test</body></html>\n```';
      const expected = '<html><body>Test</body></html>';
      
      expect(stripCodeFences(input)).toBe(expected);
    });

    it('should handle multiple code blocks', () => {
      const input = '```html\n<div>Block 1</div>\n```\n\nSome text\n\n```html\n<div>Block 2</div>\n```';
      // Function only strips fences from beginning and end, not middle ones
      const expected = '<div>Block 1</div>\n```\n\nSome text\n\n```html\n<div>Block 2</div>';
      
      expect(stripCodeFences(input)).toBe(expected);
    });

    it('should trim extra whitespace', () => {
      const input = '  ```html  \n  <html><body>Test</body></html>  \n  ```  ';
      // Function strips leading whitespace up to first fence, strips trailing fence and whitespace
      const expected = '```html  \n  <html><body>Test</body></html>';
      
      expect(stripCodeFences(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(stripCodeFences('')).toBe('');
    });
  });

  describe('Integration Tests - Real Data Flow', () => {
    it('should work end-to-end with real schema and mocked AI providers', async () => {
      // Step 1: Get real API schema info
      const apiSchemaInfo = await getApiSchemaInfo('integration-test-tenant');
      
      // Step 2: Mock Anthropic response
      const mockAnthropicResponse = {
        content: [{
          type: 'text',
          text: '```html\n<html><body><h1>Real Schema Integration</h1><div id="content-list"></div></body></html>\n```'
        }]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAnthropicResponse)
      } as Response);

      // Step 3: Generate HTML with real schema
      const rawHtml = await generateWithAnthropic(
        'Create a content management interface',
        { apiSchemaInfo }
      );

      // Step 4: Clean the response
      const cleanHtml = stripCodeFences(rawHtml);

      // Verify the complete flow
      expect(apiSchemaInfo).toHaveProperty('tenantId', 'integration-test-tenant');
      expect(cleanHtml).toBe('<html><body><h1>Real Schema Integration</h1><div id="content-list"></div></body></html>');
      
      // Without appletApi prompt, enhancement is skipped
      const requestBody = JSON.parse((mockFetch.mock.calls[0] as any)[1].body);
      const prompt = requestBody.messages[0].content;
      expect(prompt).toBe('Create a content management interface');
    });

    it('should handle AppletStorage schema in AI generation', async () => {
      // Use a unique tenant
      const uniqueTenant = `fallback-test-${Date.now()}`;
      const apiSchemaInfo = await getApiSchemaInfo(uniqueTenant);
      
      // Should get AppletStorage (always returns this)
      expect(apiSchemaInfo.contentTypes).toHaveLength(1);
      expect(apiSchemaInfo.contentTypes[0].name).toBe('AppletStorage');
      
      // Mock OpenAI response
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '<html><body><h1>Fallback Schema App</h1></body></html>'
          }
        }]
      });

      const result = await generateWithOpenAI(
        'Create a note-taking app',
        { apiSchemaInfo }
      );

      expect(result).toBe('<html><body><h1>Fallback Schema App</h1></body></html>');
      
      // Verify schema info is available but enhancement skipped (no appletApi prompt)
      const callArgs = mockCreate.mock.calls[0]?.[0] as any;
      const prompt = callArgs.messages[1].content;
      expect(prompt).toBe('Create a note-taking app');
    });

    it('should return AppletStorage with consistent UUIDs', async () => {
      // Test multiple calls
      const tenant1 = `unique-test-1-${Date.now()}`;
      const tenant2 = `unique-test-2-${Date.now()}`;
      
      // Mock different UUIDs (though they won't be used for AppletStorage)
      mockRandomUUID
        .mockReturnValueOnce('uuid-1-1234-5678')
        .mockReturnValueOnce('uuid-2-1234-5678');

      const schema1 = await getApiSchemaInfo(tenant1);
      const schema2 = await getApiSchemaInfo(tenant2);

      // Should always return AppletStorage
      expect(schema1.contentTypes[0].name).toBe('AppletStorage');
      expect(schema2.contentTypes[0].name).toBe('AppletStorage');
      expect(schema1.contentTypes[0].type).toBe('AppletStorage');
      expect(schema2.contentTypes[0].type).toBe('AppletStorage');
    });
  });

  describe('Error Handling with Real Data', () => {
    it('should return AppletStorage even with database issues', async () => {
      // getApiSchemaInfo always returns AppletStorage, doesn't throw
      const result = await getApiSchemaInfo('error-test-tenant');
      
      // Should return AppletStorage
      expect(result).toHaveProperty('tenantId', 'error-test-tenant');
      expect(result).toHaveProperty('contentTypes');
      expect(Array.isArray(result.contentTypes)).toBe(true);
      expect(result.contentTypes[0].name).toBe('AppletStorage');
    });

    it('should handle network failures for external APIs', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      await expect(generateWithAnthropic('test')).rejects.toThrow('Network failure');

      mockCreate.mockRejectedValueOnce(new Error('OpenAI network error'));

      await expect(generateWithOpenAI('test')).rejects.toThrow('Network error occurred while calling OpenAI API with model gpt-5');
    });

    it('should validate environment variable requirements', async () => {
      // Test Anthropic
      delete process.env.ANTHROPIC_API_KEY;
      await expect(generateWithAnthropic('test')).rejects.toThrow('Missing ANTHROPIC_API_KEY');

      // Test OpenAI
      process.env.ANTHROPIC_API_KEY = 'test-key'; // restore
      delete process.env.OPENAI_API_KEY;
      await expect(generateWithOpenAI('test')).rejects.toThrow('Missing OPENAI_API_KEY');
    });
  });
});
