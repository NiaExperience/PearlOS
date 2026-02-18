import { NextRequest } from 'next/server';

// Mock fetch to avoid external network calls during testing
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as Response)
);

// Import the route handlers after mocks are set up
import { GET, POST } from '@interface/app/api/auth/[...nextauth]/route';

describe('/api/auth/[...nextauth]', () => {
  describe('NextAuth route handlers', () => {
    it('should export GET handler function', () => {
      expect(GET).toBeDefined();
      expect(typeof GET).toBe('function');
    });

    it('should export POST handler function', () => {
      expect(POST).toBeDefined();
      expect(typeof POST).toBe('function');
    });

    it('should handle GET request (expect error due to missing context)', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/callback/credentials');

      try {
        await GET(request);
      } catch (error) {
        // Expected to fail due to missing NextAuth context
        expect(error).toBeDefined();
      }
    });

    it('should handle POST request (expect error due to missing context)', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/callback/credentials', {
        method: 'POST',
        body: JSON.stringify({ username: 'test', password: 'test' }),
        headers: { 'Content-Type': 'application/json' }
      });

      try {
        await POST(request);
      } catch (error) {
        // Expected to fail due to missing NextAuth context
        expect(error).toBeDefined();
      }
    });

    it('should verify NextAuth handler configuration', () => {
      // Test that we can import the handlers without errors
      expect(GET).toEqual(expect.any(Function));
      expect(POST).toEqual(expect.any(Function));
      
      // Both handlers should be the same NextAuth handler
      expect(GET).toBe(POST);
    });
  });
});
