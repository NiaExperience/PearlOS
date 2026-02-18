/**
 * Tests for enhanced applet actions
 */

import { jest } from '@jest/globals';

// Mock the dependencies
jest.mock('@nia/prism', () => ({
  Prism: {
    getInstance: jest.fn(() => ({
      create: jest.fn(),
      query: jest.fn(),
      update: jest.fn()
    }))
  }
}));

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn()
}));

jest.mock('../lib/providers', () => ({
  generateWithAnthropic: jest.fn(),
  generateWithOpenAI: jest.fn(),
  generateWithGemini: jest.fn()
}));

jest.mock('@interface/lib/bot-messaging-server', () => ({
  sendBotMessage: jest.fn()
}));

jest.mock('@nia/prism/core/actions/assistant-actions', () => ({
  getAssistantByName: jest.fn(),
  getAssistantBySubDomain: jest.fn()
}));

import { Prism } from '@nia/prism';
import { getAssistantByName, getAssistantBySubDomain } from '@nia/prism/core/actions/assistant-actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { sendBotMessage } from '@interface/lib/bot-messaging-server';

import {
  createEnhancedApplet,
  searchEnhancedApplets,
  modifyEnhancedApplet,
  getEnhancedApplet
} from '../actions/enhanced-applet-actions';
import { generateWithAnthropic, generateWithOpenAI, generateWithGemini } from '../lib/providers';
import {
  CreateHtmlGenerationRequest,
  SearchAppletsRequest,
  ModifyAppletRequest,
  EnhancedHtmlContent
} from '../types/html-generation-types';

// Type the mocked functions
const mockedGetSessionSafely = getSessionSafely as jest.MockedFunction<typeof getSessionSafely>;
const mockedPrismGetInstance = Prism.getInstance as jest.MockedFunction<typeof Prism.getInstance>;
const mockedGenerateWithAnthropic = generateWithAnthropic as jest.MockedFunction<typeof generateWithAnthropic>;
const mockedGenerateWithOpenAI = generateWithOpenAI as jest.MockedFunction<typeof generateWithOpenAI>;
const mockedGenerateWithGemini = generateWithGemini as jest.MockedFunction<typeof generateWithGemini>;
const mockedSendBotMessage = sendBotMessage as jest.MockedFunction<typeof sendBotMessage>;
const mockedGetAssistantByName = getAssistantByName as jest.MockedFunction<typeof getAssistantByName>;
const mockedGetAssistantBySubDomain = getAssistantBySubDomain as jest.MockedFunction<typeof getAssistantBySubDomain>;

const MOCK_USER_ID = '00000000-0000-0000-0000-000000000000';
const MOCK_TENANT_ID = 'tenant-00000000-0000-0000-0000-000000000000';
const MOCK_ASSISTANT_NAME = 'test-assistant';

const mockSession = {
  user: {
    id: MOCK_USER_ID,
    email: 'test@example.com'
  }
} as any; // Type as any to avoid strict Session type checking in tests

const mockPrismInstance = {
  create: jest.fn() as jest.MockedFunction<any>,
  query: jest.fn() as jest.MockedFunction<any>,
  update: jest.fn() as jest.MockedFunction<any>
};

const mockEnhancedApplet: EnhancedHtmlContent = {
  _id: 'applet123',
  title: 'Test Game',
  contentType: 'game',
  htmlContent: '<html><body>Test game content</body></html>',
  userRequest: 'create a test game',
  isAiGenerated: true,
  tenantId: MOCK_TENANT_ID,
  createdBy: MOCK_USER_ID,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  userProvidedName: undefined,
  aiSuggestedName: 'Test Game',
  nameConfirmed: true,
  searchKeywords: ['test', 'game'],
  semanticTags: ['entertainment', 'simple'],
  modificationHistory: [],
  contextSize: 1000,
  requiresAppendix: false,
  lastAccessed: new Date('2024-01-01T00:00:00Z'),
  accessCount: 1,
  modificationCount: 0
};

describe('Enhanced Applet Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionSafely.mockResolvedValue(mockSession);
    mockedPrismGetInstance.mockResolvedValue(mockPrismInstance as any);
    mockedGenerateWithAnthropic.mockResolvedValue('<html><body>Generated content</body></html>');
    mockedGenerateWithOpenAI.mockResolvedValue('<html><body>Generated content</body></html>');
    mockedGenerateWithGemini.mockResolvedValue('<html><body>Generated content</body></html>');
    mockedSendBotMessage.mockResolvedValue({ ok: true } as Response);
    // Mock assistant lookup to return a proper tenantId
    mockedGetAssistantByName.mockResolvedValue({
      tenantId: MOCK_TENANT_ID,
      generationModelConfig: [{ provider: 'anthropic' }]
    } as any);
    mockedGetAssistantBySubDomain.mockResolvedValue({
      tenantId: MOCK_TENANT_ID,
      generationModelConfig: [{ provider: 'anthropic' }]
    } as any);
  });

  describe('createEnhancedApplet', () => {
    const createRequest: CreateHtmlGenerationRequest = {
      title: 'Test Game',
      description: 'A simple test game',
      contentType: 'game',
      userRequest: 'create a test game',
      features: ['simple', 'interactive'],
      roomUrl: 'https://test.daily.co/room',
      assistantName: MOCK_ASSISTANT_NAME
    };

    it('should create an enhanced applet with AI-suggested name', async () => {
      mockPrismInstance.query.mockResolvedValue({ items: [] }); // No existing applets
      mockPrismInstance.create.mockResolvedValue({
        items: [{ ...mockEnhancedApplet, _id: 'new-applet-id' }]
      });

      const result = await createEnhancedApplet(createRequest);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.title).toBe('Test Game');
      expect(result.data.searchKeywords).toContain('test');
      expect(result.data.searchKeywords).toContain('game');
      expect(result.data.semanticTags).toContain('entertainment');
    });

    it('should use user-provided name when specified', async () => {
      const requestWithUserName = {
        ...createRequest,
        userProvidedName: 'My Custom Game'
      };

      mockPrismInstance.query.mockResolvedValue({ items: [] });
      mockPrismInstance.create.mockResolvedValue({
        items: [{ ...mockEnhancedApplet, title: 'My Custom Game', userProvidedName: 'My Custom Game' }]
      });

      const result = await createEnhancedApplet(requestWithUserName);

      expect(result.success).toBe(true);
      expect(result.data.title).toBe('My Custom Game');
      expect(result.data.userProvidedName).toBe('My Custom Game');
    });

    it('should return name suggestion when requested', async () => {
      const requestWithSuggestion = {
        ...createRequest,
        requestNameSuggestion: true
      };

      mockPrismInstance.query.mockResolvedValue({ items: [] });

      const result = await createEnhancedApplet(requestWithSuggestion);

      expect(result.success).toBe(true);
      expect(result.requiresNameConfirmation).toBe(true);
      expect(result.namingSuggestion).toBeDefined();
      expect(result.callId).toBeDefined();
    });

    it('should handle name conflicts by prompting user', async () => {
      const existingApplets = [
        { title: 'Test Game', _id: 'existing1', createdAt: new Date().toISOString() }
      ];
      mockPrismInstance.query.mockResolvedValue({ items: existingApplets });

      const result = await createEnhancedApplet(createRequest);

      // With version conflicts, the system asks the user what to do
      expect(result.success).toBe(false); // Requires user interaction
      expect(result.versionConflictPrompt).toBeDefined();
      expect(result.versionConflictData).toBeDefined();
      expect(result.versionConflictData?.suggestedVersionName).toContain('Test Game');
    });

    it('should generate appropriate search keywords and semantic tags', async () => {
      mockPrismInstance.query.mockResolvedValue({ items: [] });
      mockPrismInstance.create.mockResolvedValue({
        items: [mockEnhancedApplet]
      });

      const result = await createEnhancedApplet(createRequest);

      expect(result.data.searchKeywords).toEqual(expect.arrayContaining(['test', 'game']));
      expect(result.data.semanticTags).toEqual(expect.arrayContaining(['entertainment']));
    });

    it('should handle unauthorized access', async () => {
      mockedGetSessionSafely.mockResolvedValue(null);

      await expect(createEnhancedApplet(createRequest)).rejects.toThrow('Unauthorized');
    });

    it('should handle AI generation failures by using placeholder', async () => {
      mockedGenerateWithAnthropic.mockRejectedValue(new Error('AI generation failed'));
      mockPrismInstance.query.mockResolvedValue({ items: [] });
      mockPrismInstance.create.mockResolvedValue({
        items: [{ ...mockEnhancedApplet, htmlContent: '<html><body>Placeholder</body></html>' }]
      });

      const result = await createEnhancedApplet(createRequest);
      
      expect(result.success).toBe(true);
      // Should have tried to generate but failed
      expect(mockedGenerateWithAnthropic).toHaveBeenCalled();
    });

    it('should retry with different providers and send admin messages on failure/success', async () => {
      // Setup: 3 providers, first 2 fail, last one succeeds
      mockedGetAssistantByName.mockResolvedValue({
        tenantId: MOCK_TENANT_ID,
        generationModelConfig: [
          { provider: 'anthropic', model: 'claude-3' },
          { provider: 'openai', model: 'gpt-4' },
          { provider: 'gemini', model: 'gemini-pro' }
        ]
      } as any);

      mockedGenerateWithAnthropic.mockRejectedValue(new Error('Anthropic failed'));
      mockedGenerateWithOpenAI.mockRejectedValue(new Error('OpenAI failed'));
      mockedGenerateWithGemini.mockResolvedValue('<html><body>Success</body></html>');

      mockPrismInstance.query.mockResolvedValue({ items: [] });
      mockPrismInstance.create.mockResolvedValue({
        items: [{ ...mockEnhancedApplet, _id: 'new-applet-id' }]
      });

      const requestWithRoom = {
        ...createRequest,
        roomUrl: 'https://test.daily.co/room',
        assistantName: 'test-assistant'
      };

      const result = await createEnhancedApplet(requestWithRoom);

      expect(result.success).toBe(true);
      
      // Verify admin messages
      // 1. Anthropic failure
      expect(mockedSendBotMessage).toHaveBeenCalledWith(expect.objectContaining({
        message: "Had a problem generating that, trying another way...",
        roomUrl: 'https://test.daily.co/room'
      }));
      
      // 3. Gemini success
      expect(mockedSendBotMessage).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining("Generation complete"),
        roomUrl: 'https://test.daily.co/room'
      }));
      
      // Total calls: 2 failures + 1 success = 3
      expect(mockedSendBotMessage).toHaveBeenCalledTimes(3);
    });

    it('should send ultimate failure message when all providers fail', async () => {
      // Setup: 3 providers, all fail
      mockedGetAssistantByName.mockResolvedValue({
        tenantId: MOCK_TENANT_ID,
        generationModelConfig: [
          { provider: 'anthropic', model: 'claude-3' },
          { provider: 'openai', model: 'gpt-4' },
          { provider: 'gemini', model: 'gemini-pro' }
        ]
      } as any);

      mockedGenerateWithAnthropic.mockRejectedValue(new Error('Anthropic failed'));
      mockedGenerateWithOpenAI.mockRejectedValue(new Error('OpenAI failed'));
      mockedGenerateWithGemini.mockRejectedValue(new Error('Gemini failed'));

      mockPrismInstance.query.mockResolvedValue({ items: [] });
      mockPrismInstance.create.mockResolvedValue({
        items: [{ ...mockEnhancedApplet, htmlContent: '<html><body>Placeholder</body></html>' }]
      });

      const requestWithRoom = {
        ...createRequest,
        roomUrl: 'https://test.daily.co/room',
        assistantName: 'test-assistant'
      };

      // Should resolve successfully with placeholder
      const result = await createEnhancedApplet(requestWithRoom);
      expect(result.success).toBe(true);

      // Verify admin messages
      // 3 retry messages + 1 final failure message
      expect(mockedSendBotMessage).toHaveBeenCalledWith(expect.objectContaining({
        message: "Had a problem generating that, trying another way...",
        roomUrl: 'https://test.daily.co/room'
      }));

      expect(mockedSendBotMessage).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining("Generation failed, but I've created a placeholder"),
        roomUrl: 'https://test.daily.co/room'
      }));
      
      expect(mockedSendBotMessage).toHaveBeenCalledTimes(5);
    });

    it('should attach a library template appendix when library_type is provided', async () => {
      mockPrismInstance.query.mockResolvedValue({ items: [] });
      mockPrismInstance.create.mockResolvedValue({
        items: [{ ...mockEnhancedApplet, _id: 'library-applet-id' }]
      });

      const requestWithLibrary: CreateHtmlGenerationRequest = {
        ...createRequest,
        library_type: 'tool',
        library_template_id: 'counter_widget_v1',
        includeStorageLibrary: false,
        assistantName: 'assistant-abc'
      };

      const result = await createEnhancedApplet(requestWithLibrary);

      expect(result.success).toBe(true);
      const promptArg = mockedGenerateWithAnthropic.mock.calls[0][0];
      expect(promptArg).toContain('APPENDIX A - Counter Widget Starter');
      expect(promptArg).toContain('counter-widget.html');
    });

    it('should prompt for library choice when multiple templates exist', async () => {
      mockPrismInstance.query.mockResolvedValue({ items: [] });

      const requestWithMultiLibrary: CreateHtmlGenerationRequest = {
        ...createRequest,
        library_type: 'interactive',
        includeStorageLibrary: false,
        assistantName: 'assistant-abc'
      };

      const result = await createEnhancedApplet(requestWithMultiLibrary);

      expect(result.success).toBe(false);
      expect(result.requiresLibraryChoice).toBe(true);
      expect(result.libraryOptions).toBeDefined();
      expect(result.libraryOptions!.length).toBeGreaterThan(1);
      expect(mockedGenerateWithAnthropic).not.toHaveBeenCalled();
    });

    it('should honor explicit library_template_id when multiple templates exist', async () => {
      mockPrismInstance.query.mockResolvedValue({ items: [] });
      mockPrismInstance.create.mockResolvedValue({
        items: [{ ...mockEnhancedApplet, _id: 'library-applet-id', title: 'Party Pack' }]
      });

      const requestWithSelection: CreateHtmlGenerationRequest = {
        ...createRequest,
        library_type: 'interactive',
        library_template_id: 'party_pack_score',
        includeStorageLibrary: false,
        assistantName: 'assistant-abc'
      };

      const result = await createEnhancedApplet(requestWithSelection);

      expect(result.success).toBe(true);
      const promptArg = mockedGenerateWithAnthropic.mock.calls[0][0];
      expect(promptArg).toContain('APPENDIX A - Party Pack: Score Keeper');
      expect(promptArg).toContain('party-pack-score-keeper.html');
    });
  });

  describe('searchEnhancedApplets', () => {
    const searchRequest: SearchAppletsRequest = {
      query: 'test game',
      userId: 'user123',
      limit: 10,
      assistantName: MOCK_ASSISTANT_NAME
    };

    it('should search applets and return results', async () => {
      mockPrismInstance.query.mockResolvedValue({
        items: [mockEnhancedApplet]
      });

      const result = await searchEnhancedApplets(searchRequest);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].applet.title).toBe('Test Game');
      expect(result.results[0].relevanceScore).toBeGreaterThan(0);
      expect(result.searchMetadata.queryProcessed).toBe('test game');
    });

    it('should handle empty search queries', async () => {
      const emptySearchRequest = { ...searchRequest, query: '' };

      await expect(searchEnhancedApplets(emptySearchRequest)).rejects.toThrow();
    });

    it('should handle unauthorized access', async () => {
      mockedGetSessionSafely.mockResolvedValue(null);

      await expect(searchEnhancedApplets(searchRequest)).rejects.toThrow('Unauthorized');
    });

    it('should filter results by content type when specified', async () => {
      const gameApplet = { ...mockEnhancedApplet, contentType: 'game' as const };
      const appApplet = { ...mockEnhancedApplet, _id: 'app123', contentType: 'app' as const, title: 'Test App' };
      
      mockPrismInstance.query.mockResolvedValue({
        items: [gameApplet, appApplet]
      });

      const gameSearchRequest = { ...searchRequest, contentType: 'game' as const };
      const result = await searchEnhancedApplets(gameSearchRequest);

      expect(result.success).toBe(true);
      expect(result.searchMetadata.filters.contentType).toBe('game');
    });
  });

  describe('modifyEnhancedApplet', () => {
    const modifyRequest: ModifyAppletRequest & { saveChoice?: 'original' | 'new_version' } = {
      appletId: 'applet123',
      modificationRequest: 'Add a score counter',
      aiProvider: 'anthropic',
      saveChoice: 'original',  // Auto-confirm to modify existing applet
      assistantName: MOCK_ASSISTANT_NAME
    };

    it('should modify an existing applet', async () => {
      mockPrismInstance.query.mockResolvedValue({
        items: [mockEnhancedApplet]
      });
      mockPrismInstance.update.mockResolvedValue({
        items: [{ 
          ...mockEnhancedApplet, 
          modificationCount: 1,
          modificationHistory: [expect.any(Object)]
        }]
      });

      const result = await modifyEnhancedApplet(modifyRequest);

      expect(result.success).toBe(true);
      expect(result.data.modificationCount).toBe(1);
      expect(result.contextMethod).toBeOneOf(['direct', 'appendix', 'summary']);
      expect(result.changesDescription).toBeDefined();
      expect(result.modificationId).toBeDefined();
    });

    it('should handle non-existent applet', async () => {
      mockPrismInstance.query.mockResolvedValue({ items: [] });

      await expect(modifyEnhancedApplet(modifyRequest)).rejects.toThrow('Applet not found');
    });

    it('should handle unauthorized modification', async () => {
      const unauthorizedApplet = { 
        ...mockEnhancedApplet, 
        createdBy: 'different-user' 
      };
      mockPrismInstance.query.mockResolvedValue({
        items: [unauthorizedApplet]
      });

      await expect(modifyEnhancedApplet(modifyRequest)).rejects.toThrow('Unauthorized to modify this applet');
    });

    it('should track modification history', async () => {
      mockPrismInstance.query.mockResolvedValue({
        items: [mockEnhancedApplet]
      });
      mockPrismInstance.update.mockResolvedValue({
        items: [{ 
          ...mockEnhancedApplet,
          modificationHistory: [
            {
              timestamp: expect.any(Date),
              userRequest: 'Add a score counter',
              changesDescription: 'Applied user-requested modifications',
              aiProvider: 'anthropic',
              aiModel: 'default',
              contextMethod: 'direct'
            }
          ]
        }]
      });

      const result = await modifyEnhancedApplet(modifyRequest);

      expect(result.success).toBe(true);
      expect(result.data.modificationHistory).toHaveLength(1);
      expect(result.data.modificationHistory[0].userRequest).toBe('Add a score counter');
    });

    it('should use different context methods based on applet size', async () => {
      const largeApplet = {
        ...mockEnhancedApplet,
        htmlContent: 'x'.repeat(20000),
        contextSize: 20000,
        requiresAppendix: true
      };

      mockPrismInstance.query.mockResolvedValue({
        items: [largeApplet]
      });
      mockPrismInstance.update.mockResolvedValue({
        items: [largeApplet]
      });

      const result = await modifyEnhancedApplet(modifyRequest);

      expect(result.success).toBe(true);
      expect(result.contextMethod).toBeOneOf(['appendix', 'summary']);
    });
  });

  describe('getEnhancedApplet', () => {
    it('should retrieve an applet and update access tracking', async () => {
      mockPrismInstance.query.mockResolvedValue({
        items: [mockEnhancedApplet]
      });
      mockPrismInstance.update.mockResolvedValue({
        items: [{ ...mockEnhancedApplet, accessCount: 2 }]
      });

      const result = await getEnhancedApplet('applet123', MOCK_ASSISTANT_NAME);

      expect(result).toBeDefined();
      expect(result!.title).toBe('Test Game');
      expect(mockPrismInstance.update).toHaveBeenCalledWith(
        expect.any(String),
        'applet123',
        expect.objectContaining({
          accessCount: 2,
          lastAccessed: expect.any(Date)
        }),
        MOCK_TENANT_ID
      );
    });

    it('should return null for non-existent applet', async () => {
      mockPrismInstance.query.mockResolvedValue({ items: [] });

      const result = await getEnhancedApplet('nonexistent', MOCK_ASSISTANT_NAME);

      expect(result).toBeNull();
    });

    it('should handle unauthorized access', async () => {
      mockedGetSessionSafely.mockResolvedValue(null);

      await expect(getEnhancedApplet('applet123', MOCK_ASSISTANT_NAME)).rejects.toThrow('Unauthorized');
    });

    it('should gracefully handle access count update failures', async () => {
      mockPrismInstance.query.mockResolvedValue({
        items: [mockEnhancedApplet]
      });
      mockPrismInstance.update.mockRejectedValue(new Error('Update failed'));

      // Should still return the applet even if access tracking fails
      const result = await getEnhancedApplet('applet123', MOCK_ASSISTANT_NAME);

      expect(result).toBeDefined();
      expect(result!.title).toBe('Test Game');
    });
  });
});

// Custom matcher
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeOneOf(expected: any[]): R;
    }
  }
}

expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    return {
      message: () => pass 
        ? `expected ${received} not to be one of ${expected.join(', ')}`
        : `expected ${received} to be one of ${expected.join(', ')}`,
      pass,
    };
  },
});
