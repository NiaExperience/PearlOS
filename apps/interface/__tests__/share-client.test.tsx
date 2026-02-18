/**
 * @jest-environment jsdom
 */
import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { ShareRedemptionClient } from '../src/app/share/[payload]/client';

// Mock router
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock session
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({ status: 'authenticated', data: { user: { name: 'Test User' } } })),
}));

// Mock fetch
const globalFetch = global.fetch as jest.Mock;
global.fetch = jest.fn();

describe('ShareRedemptionClient', () => {
  const originalEnv = process.env;
  const originalLocation = window.location;

  beforeAll(() => {
    // Mock window.location
    delete (window as any).location;
    window.location = {
      ...originalLocation,
      hostname: 'localhost',
      href: 'http://localhost/share/token',
    } as any;
  });

  afterAll(() => {
    process.env = originalEnv;
    window.location = originalLocation as any;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        resourceId: 'res-123',
        resourceType: 'HtmlGeneration',
        targetMode: 'creative',
        assistantName: 'pearlos',
      }),
    });
  });

  it('redirects to /pearlos when PEARLOS_ONLY is false', async () => {
    process.env.PEARLOS_ONLY = 'false';
    
    render(
      <ShareRedemptionClient 
        token="test-token"
        resourceId="res-123"
        contentType="HtmlGeneration"
        mode="creative"
        assistantName="pearlos"
      />
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringMatching(/^\/pearlos\?/)
      );
    });
  });

  it('redirects to / when PEARLOS_ONLY is true and assistant is pearlos', async () => {
    process.env.PEARLOS_ONLY = 'true';
    
    render(
      <ShareRedemptionClient 
        token="test-token"
        resourceId="res-123"
        contentType="HtmlGeneration"
        mode="creative"
        assistantName="pearlos"
      />
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringMatching(/^\/\?/)
      );
    });
  });

  it('redirects to /other when PEARLOS_ONLY is true but assistant is not pearlos', async () => {
    process.env.PEARLOS_ONLY = 'true';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        resourceId: 'res-123',
        resourceType: 'HtmlGeneration',
        targetMode: 'creative',
        assistantName: 'other',
      }),
    });

    render(
      <ShareRedemptionClient 
        token="test-token"
        resourceId="res-123"
        contentType="HtmlGeneration"
        mode="creative"
        assistantName="other"
      />
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringMatching(/^\/other\?/)
      );
    });
  });
});
