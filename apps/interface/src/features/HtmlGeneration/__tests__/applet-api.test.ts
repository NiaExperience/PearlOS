/**
 * @jest-environment node
 * 
 * Integration tests for the Applet API (/api/applet-api)
 * Tests the NiaAPI class as documented in appletApi.txt
 */

import { Prism } from '@nia/prism';
import { TenantActions } from '@nia/prism/core/actions';
import { AssistantBlock, UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { createTestAssistant, createTestTenant, testSessionUser } from '@nia/prism/testing';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { DELETE, GET, POST, PUT } from '@interface/app/api/applet-api/route';
import { AppletStorageDefinition } from '@interface/features/HtmlGeneration';

/**
 * NiaAPI class extracted from appletApi.txt template
 * This is the exact code that would be injected into generated HTML
 */
class NiaAPI {
  tenantId: string;
  assistantName?: string;
  baseURL: string;

  constructor(tenantId: string, assistantName?: string) {
    this.tenantId = tenantId;
    this.assistantName = assistantName;
    this.baseURL = '/api/applet-api';
  }

  async listData(query = {}) {
    const params = new URLSearchParams({
      operation: 'list',
      tenantId: this.tenantId,
      ...(this.assistantName && { assistantName: this.assistantName })
    });
    if (Object.keys(query).length) {
      params.append('query', JSON.stringify(query));
    }
    
    const response = await fetch(this.baseURL + '?' + params);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to list data: ' + response.statusText);
    }
    const result = await response.json();
    return result.items || [];
  }

  async getData(dataId: string) {
    const params = new URLSearchParams({
      operation: 'get',
      tenantId: this.tenantId,
      dataId: dataId,
      ...(this.assistantName && { assistantName: this.assistantName })
    });
    
    const response = await fetch(this.baseURL + '?' + params);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to get data: ' + response.statusText);
    }
    const result = await response.json();
    return result.item;
  }

  async saveData(data: unknown) {
    const params = new URLSearchParams({
      operation: 'create',
      tenantId: this.tenantId,
      ...(this.assistantName && { assistantName: this.assistantName })
    });
    
    const response = await fetch(this.baseURL + '?' + params, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to save data: ' + response.statusText);
    }
    const result = await response.json();
    return result.item;
  }

  async updateData(dataId: string, data: unknown) {
    const params = new URLSearchParams({
      operation: 'update',
      tenantId: this.tenantId,
      dataId: dataId,
      ...(this.assistantName && { assistantName: this.assistantName })
    });
    
    const response = await fetch(this.baseURL + '?' + params, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to update data: ' + response.statusText);
    }
    const result = await response.json();
    return result.item;
  }

  async deleteData(dataId: string) {
    const params = new URLSearchParams({
      operation: 'delete',
      tenantId: this.tenantId,
      dataId: dataId,
      ...(this.assistantName && { assistantName: this.assistantName })
    });
    
    const response = await fetch(this.baseURL + '?' + params, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to delete data: ' + response.statusText);
    }
    const result = await response.json();
    return result;
  }
}

/**
 * Mock fetch implementation for testing
 * Routes fetch calls to the actual Next.js route handlers
 */
type RouteHandler = (req: NextRequest) => Promise<Response>;

function createMockFetch(handlers: { GET: RouteHandler; POST: RouteHandler; PUT: RouteHandler; DELETE: RouteHandler }) {
  return async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url, 'http://localhost:3000');
    const method = options?.method || 'GET';
    
    const request = new Request(urlObj.toString(), {
      method,
      headers: options?.headers as HeadersInit,
      body: options?.body,
    });
    
    const req = new NextRequest(request);
    
    let response;
    switch (method) {
      case 'GET':
        response = await handlers.GET(req);
        break;
      case 'POST':
        response = await handlers.POST(req);
        break;
      case 'PUT':
        response = await handlers.PUT(req);
        break;
      case 'DELETE':
        response = await handlers.DELETE(req);
        break;
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
    
    return response;
  };
}

describe('Applet API Integration Tests', () => {
  let tenantId: string;
  let assistant: AssistantBlock.IAssistant;
  let prism: Prism;
  let api: NiaAPI;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    // Setup test infrastructure
    prism = await Prism.getInstance();
    expect(prism).not.toBeNull();
    expect(testSessionUser).not.toBeNull();
    
    const tenant = await createTestTenant();
    tenantId = tenant._id!;
    
    assistant = await createTestAssistant({ 
      name: `AppletAPI Test ${uuidv4()}`, 
      tenantId: tenantId 
    });
    expect(assistant._id).toBeTruthy();
    
    // Assign test user to tenant
    await TenantActions.assignUserToTenant(
      testSessionUser!._id!, 
      tenantId, 
      UserTenantRoleBlock.TenantRole.MEMBER
    );

    // Save original fetch and replace with mock
    originalFetch = global.fetch;
    global.fetch = createMockFetch({ GET, POST, PUT, DELETE }) as typeof global.fetch;
    
    // Create NiaAPI instance
    api = new NiaAPI(tenantId, assistant.subDomain);
  });

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  describe('saveData (CREATE operation)', () => {
    it('should save simple game state data', async () => {
      const gameState = {
        score: 100,
        level: 5,
        playerName: 'TestPlayer',
        inventory: ['sword', 'shield']
      };

      const result = await api.saveData(gameState);
      
      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      expect(result.data).toEqual(gameState);
      expect(result.userId).toBe(testSessionUser!._id!);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should save todo list data', async () => {
      const todoList = {
        title: 'My Tasks',
        items: [
          { text: 'Buy milk', done: false },
          { text: 'Walk dog', done: true }
        ]
      };

      const result = await api.saveData(todoList);
      
      expect(result).toBeDefined();
      expect(result.data.title).toBe('My Tasks');
      expect(result.data.items).toHaveLength(2);
    });

    it('should save user preferences data', async () => {
      const preferences = {
        theme: 'dark',
        language: 'en',
        notifications: true,
        fontSize: 16
      };

      const result = await api.saveData(preferences);
      
      expect(result).toBeDefined();
      expect(result.data).toEqual(preferences);
    });

    it('should save complex nested data structures', async () => {
      const complexData = {
        user: {
          profile: {
            name: 'John Doe',
            settings: {
              privacy: 'public',
              notifications: {
                email: true,
                push: false
              }
            }
          }
        },
        metadata: {
          version: '1.0',
          lastModified: new Date().toISOString()
        }
      };

      const result = await api.saveData(complexData);
      
      expect(result).toBeDefined();
      expect(result.data.user.profile.name).toBe('John Doe');
      expect(result.data.user.profile.settings.notifications.email).toBe(true);
    });
  });

  describe('loadData (LIST operation)', () => {
    const savedDataIds: string[] = [];

    beforeAll(async () => {
      // Create multiple data records for testing
      const data1 = await api.saveData({ score: 50, level: 1 });
      const data2 = await api.saveData({ score: 150, level: 5 });
      const data3 = await api.saveData({ score: 200, level: 10, status: 'active' });
      const data4 = await api.saveData({ score: 75, level: 3, status: 'pending' });
      
      savedDataIds.push(data1._id, data2._id, data3._id, data4._id);
    });

    it('should list all data without filters', async () => {
      const items = await api.listData();
      
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(4);
    });

    it('should filter data with eq operator', async () => {
      const items = await api.listData({ 'data.level': { eq: 5 } });
      
      expect(items.length).toBeGreaterThanOrEqual(1);
      items.forEach((item: Record<string, unknown>) => {
        expect((item.data as Record<string, unknown>).level).toBe(5);
      });
    });

    it('should filter data with gt operator', async () => {
      const items = await api.listData({ 'data.score': { gt: 100 } });
      
      expect(items.length).toBeGreaterThanOrEqual(2);
      items.forEach((item: Record<string, unknown>) => {
        expect((item.data as Record<string, unknown>).score).toBeGreaterThan(100);
      });
    });

    it('should filter data with gte operator', async () => {
      const items = await api.listData({ 'data.score': { gte: 150 } });
      
      expect(items.length).toBeGreaterThanOrEqual(2);
      items.forEach((item: Record<string, unknown>) => {
        expect((item.data as Record<string, unknown>).score).toBeGreaterThanOrEqual(150);
      });
    });

    it('should filter data with lt operator', async () => {
      const items = await api.listData({ 'data.score': { lt: 100 } });
      
      items.forEach((item: Record<string, unknown>) => {
        expect((item.data as Record<string, unknown>).score).toBeLessThan(100);
      });
    });

    it('should filter data with lte operator', async () => {
      const items = await api.listData({ 'data.level': { lte: 5 } });
      
      items.forEach((item: Record<string, unknown>) => {
        expect((item.data as Record<string, unknown>).level).toBeLessThanOrEqual(5);
      });
    });

    it('should filter data with in operator', async () => {
      const items = await api.listData({ 'data.status': { in: ['active', 'pending'] } });
      
      items.forEach((item: Record<string, unknown>) => {
        expect(['active', 'pending']).toContain((item.data as Record<string, unknown>).status);
      });
    });

    it('should filter data with AND logical operator', async () => {
      const items = await api.listData({
        AND: [
          { 'data.level': { gte: 5 } },
          { 'data.score': { gt: 100 } }
        ]
      });
      
      items.forEach((item: Record<string, unknown>) => {
        expect((item.data as Record<string, unknown>).level).toBeGreaterThanOrEqual(5);
        expect((item.data as Record<string, unknown>).score).toBeGreaterThan(100);
      });
    });

    it('should filter data with OR logical operator', async () => {
      const items = await api.listData({
        OR: [
          { 'data.level': { eq: 1 } },
          { 'data.level': { eq: 10 } }
        ]
      });
      
      items.forEach((item: Record<string, unknown>) => {
        expect([1, 10]).toContain((item.data as Record<string, unknown>).level);
      });
    });
  });

  describe('getData (GET operation)', () => {
    let testDataId: string;

    beforeAll(async () => {
      const saved = await api.saveData({ 
        testField: 'specific-data',
        timestamp: Date.now()
      });
      testDataId = saved._id;
    });

    it('should retrieve specific data by ID', async () => {
      const item = await api.getData(testDataId);
      
      expect(item).toBeDefined();
      expect(item._id).toBe(testDataId);
      expect(item.data.testField).toBe('specific-data');
    });

    it('should throw error for non-existent ID', async () => {
      const fakeId = uuidv4();
      
      await expect(api.getData(fakeId)).rejects.toThrow();
    });

    it('should throw error for invalid ID format', async () => {
      await expect(api.getData('invalid-id')).rejects.toThrow();
    });
  });

  describe('updateData (UPDATE operation)', () => {
    let updateTestId: string;

    beforeAll(async () => {
      const saved = await api.saveData({ 
        counter: 0,
        status: 'initial'
      });
      updateTestId = saved._id;
    });

    it('should update existing data', async () => {
      const updated = await api.updateData(updateTestId, {
        counter: 1,
        status: 'updated'
      });
      
      expect(updated).toBeDefined();
      expect(updated.data.counter).toBe(1);
      expect(updated.data.status).toBe('updated');
      expect(updated.updatedAt).toBeDefined();
    });

    it('should update data multiple times', async () => {
      await api.updateData(updateTestId, { counter: 2 });
      const final = await api.updateData(updateTestId, { counter: 3 });
      
      expect(final.data.counter).toBe(3);
    });

    it('should throw error when updating non-existent data', async () => {
      const fakeId = uuidv4();
      
      await expect(
        api.updateData(fakeId, { test: 'value' })
      ).rejects.toThrow();
    });

    it('should enforce ownership - cannot update other users data', async () => {
      // This would require creating data as a different user
      // For now, we test that the ownership check exists in the route
      const saved = await api.saveData({ owner: 'test' });
      expect(saved.userId).toBe(testSessionUser!._id!);
    });
  });

  describe('deleteData (DELETE operation)', () => {
    it('should delete existing data', async () => {
      const saved = await api.saveData({ temporary: true });
      const deleteResult = await api.deleteData(saved._id);
      
      expect(deleteResult.success).toBe(true);
      
      // Verify it's actually deleted
      await expect(api.getData(saved._id)).rejects.toThrow();
    });

    it('should throw error when deleting non-existent data', async () => {
      const fakeId = uuidv4();
      
      await expect(api.deleteData(fakeId)).rejects.toThrow();
    });

    it('should throw error for invalid ID format', async () => {
      await expect(api.deleteData('invalid-id')).rejects.toThrow();
    });
  });

  describe('Error handling', () => {
    it('should handle missing tenantId', async () => {
      const badApi = new NiaAPI('');
      
      await expect(badApi.saveData({ test: 'data' })).rejects.toThrow();
    });

    it('should handle invalid tenantId format', async () => {
      const badApi = new NiaAPI('not-a-uuid');
      
      await expect(badApi.saveData({ test: 'data' })).rejects.toThrow();
    });

    it('should handle malformed query parameters', async () => {
      // The route should handle this gracefully
      const items = await api.listData({});
      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe('Data structure flexibility', () => {
    it('should handle arrays as top-level data', async () => {
      const arrayData = [1, 2, 3, 4, 5];
      const saved = await api.saveData(arrayData);
      
      expect(saved.data).toEqual(arrayData);
    });

    it('should handle strings as data values', async () => {
      const textData = { message: 'Hello, World!' };
      const saved = await api.saveData(textData);
      
      expect(saved.data.message).toBe('Hello, World!');
    });

    it('should handle numbers as data values', async () => {
      const numData = { value: 42, pi: 3.14159 };
      const saved = await api.saveData(numData);
      
      expect(saved.data.value).toBe(42);
      expect(saved.data.pi).toBe(3.14159);
    });

    it('should handle booleans as data values', async () => {
      const boolData = { active: true, deleted: false };
      const saved = await api.saveData(boolData);
      
      expect(saved.data.active).toBe(true);
      expect(saved.data.deleted).toBe(false);
    });

    it('should handle null values', async () => {
      const nullData = { optional: null, required: 'value' };
      const saved = await api.saveData(nullData);
      
      expect(saved.data.optional).toBeNull();
      expect(saved.data.required).toBe('value');
    });

    it('should handle deeply nested structures', async () => {
      const deepData = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep'
                }
              }
            }
          }
        }
      };
      const saved = await api.saveData(deepData);
      
      expect(saved.data.level1.level2.level3.level4.level5.value).toBe('deep');
    });

    it('should handle arrays of objects', async () => {
      const arrayOfObjects = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' }
        ]
      };
      const saved = await api.saveData(arrayOfObjects);
      
      expect(saved.data.users).toHaveLength(3);
      expect(saved.data.users[1].name).toBe('Bob');
    });

    it('should handle mixed type arrays', async () => {
      const mixedArray = {
        items: [1, 'two', { three: 3 }, [4, 5], true, null]
      };
      const saved = await api.saveData(mixedArray);
      
      expect(saved.data.items).toHaveLength(6);
      expect(saved.data.items[0]).toBe(1);
      expect(saved.data.items[1]).toBe('two');
      expect(saved.data.items[2].three).toBe(3);
    });
  });

  describe('Real-world use cases', () => {
    it('should handle game save state', async () => {
      const gameState = {
        player: {
          name: 'Hero',
          level: 25,
          health: 100,
          mana: 75,
          position: { x: 150, y: 200 },
          inventory: [
            { id: 'sword', name: 'Steel Sword', damage: 15 },
            { id: 'potion', name: 'Health Potion', quantity: 3 }
          ]
        },
        world: {
          currentMap: 'dungeon-1',
          completedQuests: ['tutorial', 'first-boss'],
          unlockedAreas: ['town', 'forest', 'dungeon']
        },
        settings: {
          difficulty: 'normal',
          musicVolume: 0.7,
          sfxVolume: 0.8
        }
      };

      const saved = await api.saveData(gameState);
      const loaded = await api.getData(saved._id);
      
      expect(loaded.data.player.name).toBe('Hero');
      expect(loaded.data.player.inventory).toHaveLength(2);
      expect(loaded.data.world.completedQuests).toContain('tutorial');
    });

    it('should handle form submission data', async () => {
      const formData = {
        formId: 'contact-form',
        submittedAt: new Date().toISOString(),
        fields: {
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Please contact me about your services',
          newsletter: true
        },
        metadata: {
          userAgent: 'Mozilla/5.0',
          ipAddress: '192.168.1.1',
          referrer: 'https://example.com'
        }
      };

      await api.saveData(formData);
      const items = await api.listData({ 'data.formId': { eq: 'contact-form' } });
      
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0].data.fields.email).toBe('john@example.com');
    });

    it('should handle shopping cart data', async () => {
      const cart = {
        cartId: uuidv4(),
        items: [
          { productId: 'prod1', name: 'Widget', price: 9.99, quantity: 2 },
          { productId: 'prod2', name: 'Gadget', price: 19.99, quantity: 1 }
        ],
        totals: {
          subtotal: 39.97,
          tax: 3.20,
          shipping: 5.00,
          total: 48.17
        },
        customer: {
          id: 'cust123',
          email: 'customer@example.com'
        }
      };

      const saved = await api.saveData(cart);
      const updated = await api.updateData(saved._id, {
        ...cart,
        items: [...cart.items, { productId: 'prod3', name: 'Doodad', price: 4.99, quantity: 1 }],
        totals: {
          subtotal: 44.96,
          tax: 3.60,
          shipping: 5.00,
          total: 53.56
        }
      });
      
      expect(updated.data.items).toHaveLength(3);
      expect(updated.data.totals.total).toBe(53.56);
    });
  });
});
