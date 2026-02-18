/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable import/order */
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

// Mock auth helper so we can control session presence
jest.mock('@nia/prism/core/auth', () => ({
  requireAuth: jest.fn(),
  getSessionSafely: jest.fn()
}));

// Mock actions module
jest.mock('../src/core/actions/functionalPrompt-actions', () => ({
  findByFeatureKey: jest.fn(),
  listAll: jest.fn(),
  createOrUpdate: jest.fn(),
  deleteByFeatureKey: jest.fn()
}));

import { GET_impl, POST_impl, PUT_impl, DELETE_impl } from '../src/core/routes/functionalPrompt/route';

const { requireAuth, getSessionSafely } = require('@nia/prism/core/auth');
const actions = require('../src/core/actions/functionalPrompt-actions');

describe('FunctionalPrompt Core Routes', () => {
  const mockAuthOptions = {} as any;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('GET_impl', () => {
    it('should return 403 when not authenticated', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({ status: 403 });
      const req = new NextRequest('http://localhost/api/functionalPrompt');
      
      const res = await GET_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Access Denied');
    });

    it('should return a specific prompt when featureKey is provided', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      const mockPrompt = {
        featureKey: 'test-feature',
        promptContent: 'Test content',
        lastModifiedByUserId: 'user123'
      };
      (actions.findByFeatureKey as jest.Mock).mockResolvedValue(mockPrompt);

      const req = new NextRequest('http://localhost/api/functionalPrompt?featureKey=test-feature');
      
      const res = await GET_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual(mockPrompt);
      expect(actions.findByFeatureKey).toHaveBeenCalledWith('test-feature');
    });

    it('should return null when featureKey does not exist', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (actions.findByFeatureKey as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/functionalPrompt?featureKey=non-existent');
      
      const res = await GET_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toBeNull();
    });

    it('should return all prompts when no featureKey is provided', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      const mockPrompts = {
        items: [
          { featureKey: 'feature1', promptContent: 'Content 1' },
          { featureKey: 'feature2', promptContent: 'Content 2' }
        ],
        total: 2,
        hasMore: false
      };
      (actions.listAll as jest.Mock).mockResolvedValue(mockPrompts);

      const req = new NextRequest('http://localhost/api/functionalPrompt');
      
      const res = await GET_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual(mockPrompts);
      expect(actions.listAll).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (actions.listAll as jest.Mock).mockRejectedValue(new Error('Database error'));

      const req = new NextRequest('http://localhost/api/functionalPrompt');
      
      const res = await GET_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Internal server error');
    });
  });

  describe('POST_impl', () => {
    it('should return 403 when not authenticated', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({ status: 403 });
      const req = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'POST',
        body: JSON.stringify({ featureKey: 'test', promptContent: 'content' })
      });
      
      const res = await POST_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Access Denied');
    });

    it('should create a new functional prompt', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'user123' } });
      const mockPrompt = {
        featureKey: 'new-feature',
        promptContent: 'New prompt content',
        lastModifiedByUserId: 'user123'
      };
      (actions.createOrUpdate as jest.Mock).mockResolvedValue(mockPrompt);

      const req = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'POST',
        body: JSON.stringify({
          featureKey: 'new-feature',
          promptContent: 'New prompt content'
        })
      });
      
      const res = await POST_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json).toEqual(mockPrompt);
      expect(actions.createOrUpdate).toHaveBeenCalledWith(
        'new-feature',
        'New prompt content',
        'user123'
      );
    });

    it('should use provided userId if specified', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'session-user' } });
      const mockPrompt = {
        featureKey: 'test-feature',
        promptContent: 'Test content',
        lastModifiedByUserId: 'custom-user'
      };
      (actions.createOrUpdate as jest.Mock).mockResolvedValue(mockPrompt);

      const req = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'POST',
        body: JSON.stringify({
          featureKey: 'test-feature',
          promptContent: 'Test content',
          userId: 'custom-user'
        })
      });
      
      const res = await POST_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(201);
      expect(actions.createOrUpdate).toHaveBeenCalledWith(
        'test-feature',
        'Test content',
        'custom-user'
      );
    });

    it('should return 400 when userId cannot be determined', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (getSessionSafely as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'POST',
        body: JSON.stringify({
          featureKey: 'test-feature',
          promptContent: 'Test content'
        })
      });
      
      const res = await POST_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('User ID could not be determined');
    });

    it('should validate request body and return 400 for invalid data', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'user123' } });

      const req = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'POST',
        body: JSON.stringify({
          featureKey: '', // Invalid: empty string
          promptContent: 'Test content'
        })
      });
      
      const res = await POST_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid request body');
      expect(json.details).toBeDefined();
    });

    it('should handle missing required fields', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'user123' } });

      const req = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'POST',
        body: JSON.stringify({
          featureKey: 'test-feature'
          // Missing promptContent
        })
      });
      
      const res = await POST_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid request body');
    });

    it('should handle errors from createOrUpdate action', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'user123' } });
      (actions.createOrUpdate as jest.Mock).mockRejectedValue(new Error('Database error'));

      const req = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'POST',
        body: JSON.stringify({
          featureKey: 'test-feature',
          promptContent: 'Test content'
        })
      });
      
      const res = await POST_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Internal server error');
    });
  });

  describe('PUT_impl', () => {
    it('should call POST_impl', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: 'user123' } });
      const mockPrompt = {
        featureKey: 'test-feature',
        promptContent: 'Updated content'
      };
      (actions.createOrUpdate as jest.Mock).mockResolvedValue(mockPrompt);

      const req = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'PUT',
        body: JSON.stringify({
          featureKey: 'test-feature',
          promptContent: 'Updated content'
        })
      });
      
      const res = await PUT_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json).toEqual(mockPrompt);
    });
  });

  describe('DELETE_impl', () => {
    it('should return 403 when not authenticated', async () => {
      (requireAuth as jest.Mock).mockResolvedValue({ status: 403 });
      const req = new NextRequest('http://localhost/api/functionalPrompt?featureKey=test-feature');
      
      const res = await DELETE_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Access Denied');
    });

    it('should delete a functional prompt successfully', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (actions.deleteByFeatureKey as jest.Mock).mockResolvedValue(true);

      const req = new NextRequest('http://localhost/api/functionalPrompt?featureKey=test-feature');
      
      const res = await DELETE_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.featureKey).toBe('test-feature');
      expect(actions.deleteByFeatureKey).toHaveBeenCalledWith('test-feature');
    });

    it('should return 400 when featureKey is missing', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/functionalPrompt');
      
      const res = await DELETE_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('featureKey is required');
    });

    it('should return 404 when prompt does not exist', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (actions.deleteByFeatureKey as jest.Mock).mockResolvedValue(false);

      const req = new NextRequest('http://localhost/api/functionalPrompt?featureKey=non-existent');
      
      const res = await DELETE_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('Functional prompt not found');
    });

    it('should handle errors gracefully', async () => {
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (actions.deleteByFeatureKey as jest.Mock).mockRejectedValue(new Error('Database error'));

      const req = new NextRequest('http://localhost/api/functionalPrompt?featureKey=test-feature');
      
      const res = await DELETE_impl(req, mockAuthOptions);
      
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Internal server error');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete CRUD workflow', async () => {
      const featureKey = `test-feature-${uuidv4()}`;
      const userId = uuidv4();

      // Setup mocks for authenticated user
      (requireAuth as jest.Mock).mockResolvedValue(null);
      (getSessionSafely as jest.Mock).mockResolvedValue({ user: { id: userId } });

      // 1. Create
      const createPrompt = {
        featureKey,
        promptContent: 'Initial content',
        lastModifiedByUserId: userId
      };
      (actions.createOrUpdate as jest.Mock).mockResolvedValue(createPrompt);

      const createReq = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'POST',
        body: JSON.stringify({
          featureKey,
          promptContent: 'Initial content'
        })
      });
      const createRes = await POST_impl(createReq, mockAuthOptions);
      expect(createRes.status).toBe(201);

      // 2. Read
      (actions.findByFeatureKey as jest.Mock).mockResolvedValue(createPrompt);
      const readReq = new NextRequest(`http://localhost/api/functionalPrompt?featureKey=${featureKey}`);
      const readRes = await GET_impl(readReq, mockAuthOptions);
      expect(readRes.status).toBe(200);

      // 3. Update
      const updatePrompt = {
        ...createPrompt,
        promptContent: 'Updated content',
        history: [{
          userId,
          delta: '--- old\n+++ new\n...',
          modifiedAt: new Date().toISOString()
        }]
      };
      (actions.createOrUpdate as jest.Mock).mockResolvedValue(updatePrompt);

      const updateReq = new NextRequest('http://localhost/api/functionalPrompt', {
        method: 'PUT',
        body: JSON.stringify({
          featureKey,
          promptContent: 'Updated content'
        })
      });
      const updateRes = await PUT_impl(updateReq, mockAuthOptions);
      expect(updateRes.status).toBe(201);

      // 4. Delete
      (actions.deleteByFeatureKey as jest.Mock).mockResolvedValue(true);
      const deleteReq = new NextRequest(`http://localhost/api/functionalPrompt?featureKey=${featureKey}`);
      const deleteRes = await DELETE_impl(deleteReq, mockAuthOptions);
      expect(deleteRes.status).toBe(200);
    });
  });
});
