import { v4 as uuidv4 } from 'uuid';
import { AssistantFeedbackBlock } from '@nia/prism/core/blocks';
import { createTestAssistant, createTestTenant } from '@nia/prism/testing';
import { NextRequest } from 'next/server';

// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { POST } from '../src/app/api/log-assistant-feedback/route';

describe('Log Assistant Feedback API Tests', () => {
  let testTenant: ReturnType<typeof createTestTenant> extends Promise<infer T> ? T : never;
  let testAssistant: ReturnType<typeof createTestAssistant> extends Promise<infer T> ? T : never;

  beforeEach(async () => {
    // Create test data using the real database
    testTenant = await createTestTenant();
    testAssistant = await createTestAssistant({
      name: `Assistant ${uuidv4()}`,
      tenantId: testTenant._id!
    });
  });

  describe('POST method', () => {
    it('should log feedback successfully when all parameters are provided', async () => {
      // Create a POST request
      const url = 'http://localhost:3000/api/log-assistant-feedback';
      const requestData = {
        description: 'This is a test feedback description',
        callId: 'test-call-id-123',
        agent: testAssistant.subDomain
      };
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      const req = new NextRequest(request);

      // Call the POST function
      const response = await POST(req);

      // Assert the response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Feedback logged successfully');
      expect(data.data).toBeDefined();
      expect(data.data.assistant_id).toBe(testAssistant._id);
      expect(data.data.call_id).toBe('test-call-id-123');
      expect(data.data.description).toBe('This is a test feedback description');
      expect(data.data.feedback_type).toBe(AssistantFeedbackBlock.FeedbackType.MISTAKE);
    });

    it('should log feedback successfully when using assistant_id instead of agent', async () => {
      // Create a POST request
      const url = 'http://localhost:3000/api/log-assistant-feedback';
      const requestData = {
        description: 'This is a test feedback description',
        callId: 'test-call-id-456',
        assistant_id: testAssistant._id
      };
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      const req = new NextRequest(request);

      // Call the POST function
      const response = await POST(req);

      // Assert the response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.assistant_id).toBe(testAssistant._id);
      expect(data.data.call_id).toBe('test-call-id-456');
    });

    it('should return 400 when agent parameter is missing', async () => {
      // Create a POST request without agent
      const url = 'http://localhost:3000/api/log-assistant-feedback';
      const requestData = {
        description: 'This is a test feedback description',
        callId: 'test-call-id-123'
      };
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      const req = new NextRequest(request);

      // Call the POST function
      const response = await POST(req);

      // Assert the response
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Assistant agent is required');
    });

    it('should return 400 when description parameter is missing', async () => {
      // Create a POST request without description
      const url = 'http://localhost:3000/api/log-assistant-feedback';
      const requestData = {
        callId: 'test-call-id-123',
        agent: 'test-assistant'
      };
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      const req = new NextRequest(request);

      // Call the POST function
      const response = await POST(req);

      // Assert the response
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Description is required');
    });

    it('should return 400 when callId parameter is missing', async () => {
      // Create a POST request without callId
      const url = 'http://localhost:3000/api/log-assistant-feedback';
      const requestData = {
        description: 'This is a test feedback description',
        agent: 'test-assistant'
      };
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      const req = new NextRequest(request);

      // Call the POST function
      const response = await POST(req);

      // Assert the response
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('callId is required');
    });

    it('should return 404 when assistant is not found', async () => {
      // Create a POST request with non-existent assistant
      const url = 'http://localhost:3000/api/log-assistant-feedback';
      const requestData = {
        description: 'This is a test feedback description',
        callId: 'test-call-id-123',
        agent: 'nonexistent-assistant'
      };
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      const req = new NextRequest(request);

      // Call the POST function
      const response = await POST(req);

      // Assert the response
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Assistant not found');
    });

    it('should handle callId with quotes and clean them', async () => {
      // Create a POST request with callId containing quotes
      const url = 'http://localhost:3000/api/log-assistant-feedback';
      const requestData = {
        description: 'This is a test feedback description',
        callId: '"test-call-id-with-quotes"',
        agent: testAssistant.subDomain
      };
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      const req = new NextRequest(request);

      // Call the POST function
      const response = await POST(req);

      // Assert the response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.call_id).toBe('test-call-id-with-quotes'); // Quotes should be removed
    });
  });
}); 