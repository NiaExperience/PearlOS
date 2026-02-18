/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
// Mock getSessionSafely used by route implementation
jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn(async () => ({ user: { id: '11111111-1111-1111-1111-111111111111', name: 'Tester' } }))
}));
// Mock TenantActions.userHasAccess to always return true (admin) for simplicity
jest.mock('@nia/prism/core/actions', () => ({
  TenantActions: { userHasAccess: jest.fn(async () => true) }
}));
// Route imports getAssistantByName directly; mock module
const mockGetAssistantByName = jest.fn(async (name: string) => ({ _id: 'asst1', name, tenantId: '11111111-1111-1111-1111-111111111111' }));
jest.mock('@nia/prism/core/actions/assistant-actions', () => ({
  getAssistantByName: (name: string) => mockGetAssistantByName(name)
}));
// Mock organization actions for shared resources
jest.mock('@nia/prism/core/actions/organization-actions', () => ({
  getUserSharedResources: jest.fn(async () => []) // Return empty array by default
}));
// Mock underlying action layer used by route handlers
jest.mock('../actions/html-generation-actions', () => ({
  createHtmlGeneration: jest.fn(),
  getHtmlGeneration: jest.fn(),
  findHtmlContentById: jest.fn(),
  listHtmlGenerations: jest.fn()
}));

// Mock status route handlers
jest.mock('../routes/status/route', () => ({
  setGenerationStarted: jest.fn(),
  setGenerationCompleted: jest.fn(),
  setGenerationFailed: jest.fn()
}));

import { createHtmlGeneration, findHtmlContentById, getHtmlGeneration, listHtmlGenerations } from '../actions/html-generation-actions';
import { GET_impl, POST_impl } from '../routes/route';

const mockedCreate = createHtmlGeneration as jest.Mock;
const mockedGet = getHtmlGeneration as jest.Mock;
const mockedFindById = findHtmlContentById as jest.Mock;
const mockedList = listHtmlGenerations as jest.Mock;

function makeGet(url: string) { return new NextRequest(url); }
function makePost(url: string, body: any) { return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } as any); }

describe('HtmlGeneration route handlers', () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedGet.mockReset();
    mockedFindById.mockReset();
    mockedList.mockReset();
    mockGetAssistantByName.mockClear();
  });

  describe('GET_impl', () => {
    it('returns single html generation when id provided and found', async () => {
      mockedFindById.mockResolvedValueOnce({ page_id: 'abc', title: 'One', htmlContent: '<p/>', contentType: 'game' });
      const res = await GET_impl(makeGet('http://localhost/api/html-generation?id=abc&assistantName=Nia'));
      expect(mockGetAssistantByName).toHaveBeenCalledWith('Nia');
      expect(mockedFindById).toHaveBeenCalled();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.page_id).toBe('abc');
    });

    it('returns 404 when id provided but not found', async () => {
      mockedFindById.mockResolvedValueOnce(null);
      const res = await GET_impl(makeGet('http://localhost/api/html-generation?id=missing&assistantName=Nia'));
      expect(res.status).toBe(404);
    });

    it('lists html generations when no id provided with filters', async () => {
      mockedList.mockResolvedValueOnce([
        { _id: 'a1', page_id: 'a1', title: 'A1', htmlContent: '<a/>', contentType: 'game' },
        { _id: 'a2', page_id: 'a2', title: 'A2', htmlContent: '<b/>', contentType: 'game' }
      ]);
      const res = await GET_impl(makeGet('http://localhost/api/html-generation?title=Test+Title&contentType=game&limit=2&assistantName=Nia'));
      expect(mockedList).toHaveBeenCalled();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.total).toBe(2);
    });

    it('returns 500 when underlying list throws non-auth error', async () => {
      mockedList.mockRejectedValueOnce(new Error('boom'));
      const res = await GET_impl(makeGet('http://localhost/api/html-generation?assistantName=Nia'));
      expect(res.status).toBe(500);
    });

    it('maps underlying Unauthorized error to 401 (get path)', async () => {
      mockedFindById.mockRejectedValueOnce(new Error('unauthorized'));
      const res = await GET_impl(makeGet('http://localhost/api/html-generation?id=abc&assistantName=Nia'));
      expect(res.status).toBe(401);
    });

    it('maps underlying Unauthorized error to 401 (list path)', async () => {
      mockedList.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
      const res = await GET_impl(makeGet('http://localhost/api/html-generation?assistantName=Nia'));
      expect(res.status).toBe(401);
    });

    it('returns 400 when assistantName missing', async () => {
      const res = await GET_impl(makeGet('http://localhost/api/html-generation'));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.message).toMatch(/Missing assistant name/i);
    });
  });

  describe('POST_impl', () => {
    const baseBody = { title: 'My Game', description: 'Desc', userRequest: 'Make a game', contentType: 'game', features: ['score'], useOpenAI: true, assistantName: 'Nia' };

    it('creates html generation successfully', async () => {
      mockedCreate.mockResolvedValueOnce({ page_id: 'new1', title: 'My Game', htmlContent: '<html/>', contentType: 'game' });
      const res = await POST_impl(makePost('http://localhost/api/html-generation', baseBody));
      
      // Allow async generation to proceed
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify response is immediate processing status
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('processing');
      expect(json.data.jobId).toBeDefined();

      // Verify create was called with metadata including jobId
      expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
        ...baseBody,
        metadata: expect.objectContaining({
          jobId: expect.any(String)
        })
      }));
    });
  });
});
