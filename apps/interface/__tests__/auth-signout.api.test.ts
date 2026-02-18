import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';
import { createTestAssistant, createTestTenant } from '@nia/prism/testing/testlib';
import { AssistantBlock, TenantBlock } from '@nia/prism/core/blocks';

// Mock only external dependencies  
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// eslint-disable-next-line import/order
import { POST } from '../src/app/api/auth/signout/route';

describe('/api/auth/signout', () => {
  let testTenant: TenantBlock.ITenant;
  let testAssistant: AssistantBlock.IAssistant;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Create real test data
    const unique = uuidv4();
    testTenant = (await createTestTenant());
    testAssistant = (await createTestAssistant({
      name: `Assistant ${unique}`,
      tenantId: testTenant._id!,
      subDomain: `assistant-${unique}`,
    }));
  });

  describe('POST /api/auth/signout', () => {
    it('should handle signout request successfully', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/signout', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.redirect).toBe('/login');
    });

    it('should handle POST request without body successfully', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/signout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.redirect).toBe('/login');
    });

    it('should handle malformed JSON in signout request successfully', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/signout', {
        method: 'POST',
        body: 'invalid-json',
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.redirect).toBe('/login');
    });

    it('should handle signout request with valid JSON successfully', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/signout', {
        method: 'POST',
        body: JSON.stringify({ reason: 'user_logout' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.redirect).toBe('/login');
    });
  });
});
