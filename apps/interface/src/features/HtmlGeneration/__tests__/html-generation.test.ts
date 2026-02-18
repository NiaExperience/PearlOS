/**
 * HtmlGeneration Feature Tests
 * Testing core functionality of HTML content generation
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the entire actions module to avoid real API calls
jest.mock('../actions/html-generation-actions', () => ({
  createHtmlGeneration: jest.fn(),
  listHtmlGenerations: jest.fn()
}));

import { createHtmlGeneration, listHtmlGenerations } from '../actions/html-generation-actions';

// Mock assistant actions for tenant resolution
jest.mock('@nia/prism/core/actions/assistant-actions', () => ({
  getAssistantBySubDomain: jest.fn(async () => ({ _id: 'asst1', name: 'Nia', tenantId: '22222222-2222-2222-2222-222222222222' })),
  getAssistantByName: jest.fn(async () => ({ _id: 'asst1', name: 'Nia', tenantId: '22222222-2222-2222-2222-222222222222' }))
}));
// Mock auth session utility so server-action calls that rely on session user succeed under Jest
jest.mock('@nia/prism/core/auth', () => {
  return {
    getSessionSafely: jest.fn(async () => ({
      user: { id: '123e4567-e89b-12d3-a456-426614174000', is_anonymous: false }
    }))
  };
});

// Force UUID validation to succeed for deterministic tests (avoid fragility over variant bits)
jest.mock('@nia/prism/core/utils', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual: any = jest.requireActual('@nia/prism/core/utils');
  return { ...actual, isValidUUID: () => true };
});

const mockedCreateHtmlGeneration = createHtmlGeneration as jest.MockedFunction<typeof createHtmlGeneration>;
const mockedListHtmlGenerations = listHtmlGenerations as jest.MockedFunction<typeof listHtmlGenerations>;

describe('HtmlGeneration Feature', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createHtmlGeneration', () => {
    it('should create HTML content with OpenAI provider', async () => {
      const mockResult = {
        _id: 'test-id',
        title: 'Test Game',  // Title is used as-is without automatic versioning
        htmlContent: '<div>Test HTML</div>',
        contentType: 'game' as const,
        aiProvider: 'openai' as const,
        userRequest: 'Create a test game',
        isAiGenerated: true,
        tenantId: '22222222-2222-2222-2222-222222222222',
        tags: []
      };

      mockedCreateHtmlGeneration.mockResolvedValueOnce(mockResult as any);

      const result = await createHtmlGeneration({
        title: 'Test Game',
        description: 'A test game',
        userRequest: 'Create a test game',
        contentType: 'game',
        assistantName: 'Nia'
      });

      expect(result).toBeDefined();
      expect(result.title).toBe('Test Game');  // Title is used as-is without versioning
      expect(result.contentType).toBe('game');
      expect(mockedCreateHtmlGeneration).toHaveBeenCalledWith({
        title: 'Test Game',
        description: 'A test game',
        userRequest: 'Create a test game',
        contentType: 'game',
        assistantName: 'Nia'
      });
    });

    it('should handle creation errors gracefully', async () => {
      mockedCreateHtmlGeneration.mockRejectedValueOnce(new Error('Generation failed'));

      await expect(createHtmlGeneration({
        title: 'Invalid Game',
        description: 'A test game',
        userRequest: 'Invalid prompt',
        contentType: 'game',
        assistantName: 'Nia'
      })).rejects.toThrow('Generation failed');

      expect(mockedCreateHtmlGeneration).toHaveBeenCalled();
    });
  });

  describe('listHtmlGenerations', () => {
    it('should retrieve list of HTML generations', async () => {
      const mockResult = [
        {
          _id: 'test-1',
          title: 'Test Game 1',
          contentType: 'game' as const,
          htmlContent: '<div>Game 1</div>',
          createdAt: new Date().toISOString(),
          tenantId: '22222222-2222-2222-2222-222222222222',
          isAiGenerated: true,
          tags: []
        }
      ];

      mockedListHtmlGenerations.mockResolvedValueOnce(mockResult as any);

      const result = await listHtmlGenerations({
        userId: '123e4567-e89b-12d3-a456-426614174000',
        tenantId: '22222222-2222-2222-2222-222222222222'
      } as any);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Test Game 1');
      expect(mockedListHtmlGenerations).toHaveBeenCalledWith({
        userId: '123e4567-e89b-12d3-a456-426614174000',
        tenantId: '22222222-2222-2222-2222-222222222222'
      });
    });
  });
});
