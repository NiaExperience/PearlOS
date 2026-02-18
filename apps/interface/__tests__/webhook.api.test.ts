import { getSessionSafely } from '@nia/prism/core/auth';
import { ITenant } from '@nia/prism/core/blocks/tenant.block';
import { IUser } from '@nia/prism/core/blocks/user.block';
import { createTestTenant, createTestUser } from '@nia/prism/testing';
import { DefaultSession } from 'next-auth';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

// Mock the auth module
jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn(),
  requireAuth: jest.fn(),
}));

// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { POST } from '../src/app/api/webhook/route';


declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      sessionId: string;
      is_anonymous?: boolean;
      google_access_token?: string; // Optional, only if using Google OAuth
      mustSetPassword?: boolean;
  emailVerified?: string | Date | null;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    sessionId: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    is_anonymous?: boolean; // Custom property for anonymous users
    google_access_token?: string; // Optional, only if using Google OAuth
    mustSetPassword?: boolean;
  emailVerified?: string | Date | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    sessionId?: string;
    is_anonymous?: boolean; // Custom property for anonymous users
    google_access_token?: string; // Optional, only if using Google OAuth
  emailVerified?: string | Date | null;
  }
}

describe('Webhook API Tests', () => {
  let testTenant: ITenant | null = null;
  let testUser: IUser | null = null;

  beforeEach(async () => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Create test data using the real database
    testTenant = await createTestTenant();
    expect(testTenant._id).toBeDefined();

    testUser = await createTestUser({
      email: 'test@example.com',
      name: 'Test User',
    }, 'password123');
    expect(testUser._id).toBeDefined();

    // Mock getSessionSafely to return the test user session by default
    (getSessionSafely as jest.Mock).mockResolvedValue({
      user: {
        id: testUser._id,
        email: 'test@example.com',
        name: 'Test User',
        is_anonymous: false,
        sessionId: uuidv4()
      }
    });
  });

  afterEach(async () => {
    testUser = null;
    testTenant = null;
  });

  describe.skip('POST method', () => {

    it('should handle missing callId gracefully', async () => {
      // Create a POST request with missing callId
      const url = 'http://localhost:3000/api/webhook';
      const requestData = {
        message: {
          type: 'end-of-call-report',
          call: {
            id: 'nonexistent-call-id'
          },
          summary: 'This is a test call summary'
        }
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
      expect(data.result).toBe('Message saved');
    });
  });
}); 