/**
 * Tests for the enhanced API routes
 */

import { jest } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';

// Mock the enhanced actions
jest.mock('../actions/enhanced-applet-actions');

import { searchEnhancedApplets, modifyEnhancedApplet } from '../actions/enhanced-applet-actions';
import { POST_impl as modifyPOST } from '../routes/modify-applet/route';
import { GET as searchGET, POST as searchPOST } from '../routes/search-applets/route';
import { 
  SearchAppletsResponse, 
  ModifyAppletResponse,
  EnhancedHtmlContent 
} from '../types/html-generation-types';

// Type the mocked functions
const mockedSearchEnhancedApplets = searchEnhancedApplets as jest.MockedFunction<typeof searchEnhancedApplets>;
const mockedModifyEnhancedApplet = modifyEnhancedApplet as jest.MockedFunction<typeof modifyEnhancedApplet>;

const mockSearchResponse: SearchAppletsResponse = {
  success: true,
  results: [
    {
      applet: {
        _id: '1',
        title: 'Test Game',
        contentType: 'game',
        htmlContent: '<html>test</html>',
        userRequest: 'create test game',
        isAiGenerated: true,
        tenantId: 'tenant1',
        createdBy: 'user1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        userProvidedName: undefined,
        aiSuggestedName: 'Test Game',
        nameConfirmed: true,
        searchKeywords: ['test', 'game'],
        semanticTags: ['entertainment'],
        modificationHistory: [],
        contextSize: 1000,
        requiresAppendix: false,
        lastAccessed: new Date(),
        accessCount: 1,
        modificationCount: 0
      } as EnhancedHtmlContent,
      relevanceScore: 1.5,
      matchReasons: ['Exact title match'],
      contextSize: 1000,
      requiresAppendix: false
    }
  ],
  totalCount: 1,
  searchMetadata: {
    queryProcessed: 'test game',
    searchMethod: 'semantic',
    filters: {}
  }
};

const mockModifyResponse: ModifyAppletResponse = {
  success: true,
  data: {
    _id: '1',
    title: 'Test Game',
    contentType: 'game',
    htmlContent: '<html>modified test</html>',
    userRequest: 'create test game',
    isAiGenerated: true,
    tenantId: 'tenant1',
    createdBy: 'user1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T12:00:00Z',
    userProvidedName: undefined,
    aiSuggestedName: 'Test Game',
    nameConfirmed: true,
    searchKeywords: ['test', 'game'],
    semanticTags: ['entertainment'],
    modificationHistory: [],
    contextSize: 1500,
    requiresAppendix: false,
    lastAccessed: new Date(),
    accessCount: 2,
    modificationCount: 1
  } as EnhancedHtmlContent,
  contextMethod: 'direct',
  changesDescription: 'Added new features',
  modificationId: 'mod123'
};

describe('API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Search Applets Route', () => {
    describe('GET /api/search-applets', () => {
      it('should handle valid GET search requests', async () => {
        mockedSearchEnhancedApplets.mockResolvedValue(mockSearchResponse);

        const url = new URL('http://localhost/api/search-applets?query=test%20game&userId=user1&limit=10');
        const request = new NextRequest(url);

        const response = await searchGET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.results).toHaveLength(1);
        expect(data.results[0].applet.title).toBe('Test Game');
        expect(mockedSearchEnhancedApplets).toHaveBeenCalledWith({
          query: 'test game',
          userId: 'user1',
          assistantName: undefined,
          contentType: undefined,
          limit: 10,
          includeArchived: false
        });
      });

      it('should handle missing query parameter', async () => {
        const url = new URL('http://localhost/api/search-applets?userId=user1');
        const request = new NextRequest(url);

        const response = await searchGET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Search query is required');
      });

      it('should handle search errors', async () => {
        mockedSearchEnhancedApplets.mockRejectedValue(new Error('Search failed'));

        const url = new URL('http://localhost/api/search-applets?query=test&userId=user1');
        const request = new NextRequest(url);

        const response = await searchGET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Search failed');
      });

      it('should parse all query parameters correctly', async () => {
        mockedSearchEnhancedApplets.mockResolvedValue(mockSearchResponse);

        const url = new URL('http://localhost/api/search-applets?query=game&userId=user1&assistantName=assistant1&contentType=game&limit=5&includeArchived=true');
        const request = new NextRequest(url);

        await searchGET(request);

        expect(mockedSearchEnhancedApplets).toHaveBeenCalledWith({
          query: 'game',
          userId: 'user1',
          assistantName: 'assistant1',
          contentType: 'game',
          limit: 5,
          includeArchived: true
        });
      });
    });

    describe('POST /api/search-applets', () => {
      it('should handle valid POST search requests', async () => {
        mockedSearchEnhancedApplets.mockResolvedValue(mockSearchResponse);

        const requestBody = {
          query: 'test game',
          userId: 'user1',
          limit: 10
        };

        const request = new NextRequest('http://localhost/api/search-applets', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await searchPOST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.results).toHaveLength(1);
        expect(mockedSearchEnhancedApplets).toHaveBeenCalledWith({
          query: 'test game',
          userId: 'user1',
          assistantName: undefined,
          contentType: undefined,
          limit: 10,
          includeArchived: false
        });
      });

      it('should handle missing query in POST body', async () => {
        const requestBody = { userId: 'user1' };

        const request = new NextRequest('http://localhost/api/search-applets', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await searchPOST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Search query is required');
      });

      it('should handle invalid JSON in POST body', async () => {
        const request = new NextRequest('http://localhost/api/search-applets', {
          method: 'POST',
          body: 'invalid json',
          headers: { 'content-type': 'application/json' }
        });

        const response = await searchPOST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error).toContain('error'); // Should contain error message
      });
    });
  });

  describe('Modify Applet Route', () => {
    describe('POST /api/modify-applet', () => {
      it('should handle valid modification requests', async () => {
        mockedModifyEnhancedApplet.mockResolvedValue(mockModifyResponse);

        const requestBody = {
          appletId: 'applet123',
          modificationRequest: 'Add a score counter',
          aiProvider: 'anthropic'
        };

        const request = new NextRequest('http://localhost/api/modify-applet', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await modifyPOST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.title).toBe('Test Game');
        expect(data.contextMethod).toBe('direct');
        expect(mockedModifyEnhancedApplet).toHaveBeenCalledWith({
          appletId: 'applet123',
          modificationRequest: 'Add a score counter',
          aiProvider: 'anthropic',
          aiModel: 'gpt-5', // Default when not provided
          assistantName: undefined,
          roomUrl: undefined,
          sourceNoteId: undefined,
          sourceNoteTitle: undefined,
          saveChoice: "original",
          versioningPreference: "modify_existing",
        });
      });

      it('should handle missing applet ID', async () => {
        const requestBody = {
          modificationRequest: 'Add a score counter'
        };

        const request = new NextRequest('http://localhost/api/modify-applet', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await modifyPOST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Applet ID is required');
      });

      it('should handle missing modification request', async () => {
        const requestBody = {
          appletId: 'applet123'
        };

        const request = new NextRequest('http://localhost/api/modify-applet', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await modifyPOST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Modification request is required');
      });

      it('should handle invalid UUID format', async () => {
        const requestBody = {
          appletId: '!!invalid!!',  // Use special chars that don't match any valid format
          modificationRequest: 'Add a score counter'
        };

        const request = new NextRequest('http://localhost/api/modify-applet', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await modifyPOST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Invalid applet ID format');
      });

      it('should handle unauthorized errors', async () => {
        mockedModifyEnhancedApplet.mockRejectedValue(new Error('Unauthorized'));

        const requestBody = {
          appletId: '123e4567-e89b-12d3-a456-426614174000',
          modificationRequest: 'Add a score counter'
        };

        const request = new NextRequest('http://localhost/api/modify-applet', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await modifyPOST(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Unauthorized');
      });

      it('should handle not found errors', async () => {
        mockedModifyEnhancedApplet.mockRejectedValue(new Error('Applet not found'));

        const requestBody = {
          appletId: '123e4567-e89b-12d3-a456-426614174000',
          modificationRequest: 'Add a score counter'
        };

        const request = new NextRequest('http://localhost/api/modify-applet', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await modifyPOST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Applet not found');
      });

      it('should include all optional parameters when provided', async () => {
        mockedModifyEnhancedApplet.mockResolvedValue(mockModifyResponse);

        const requestBody = {
          appletId: '123e4567-e89b-12d3-a456-426614174000',
          modificationRequest: 'Add animations',
          aiProvider: 'openai',
          aiModel: 'gpt-4',
          assistantName: 'my-assistant'
        };

        const request = new NextRequest('http://localhost/api/modify-applet', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        await modifyPOST(request);

        expect(mockedModifyEnhancedApplet).toHaveBeenCalledWith({
          appletId: '123e4567-e89b-12d3-a456-426614174000',
          modificationRequest: 'Add animations',
          aiProvider: 'openai',
          aiModel: 'gpt-4',
          assistantName: 'my-assistant',
          saveChoice: "original",
          versioningPreference: "modify_existing",
        });
      });

      it('should handle generic server errors', async () => {
        mockedModifyEnhancedApplet.mockRejectedValue(new Error('Database connection failed'));

        const requestBody = {
          appletId: '123e4567-e89b-12d3-a456-426614174000',
          modificationRequest: 'Add a score counter'
        };

        const request = new NextRequest('http://localhost/api/modify-applet', {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'content-type': 'application/json' }
        });

        const response = await modifyPOST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error).toBe('Database connection failed');
      });
    });
  });
});
