/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

describe('HtmlGeneration status GET_impl (active jobs)', () => {
  const mockSession = { user: { id: 'user-123' } } as any;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns empty list when Redis unavailable', async () => {
    jest.doMock('@nia/prism/core/auth', () => ({ getSessionSafely: jest.fn(async () => mockSession) }));

    let GET_impl: any;
    await jest.isolateModulesAsync(async () => {
      ({ GET_impl } = await import('../routes/status/route'));
    });

    const res = await GET_impl(new NextRequest('http://localhost/api/html-generation/status'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.activeJobs).toHaveLength(0);
  });
});
