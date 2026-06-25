import { NextResponse } from 'next/server';

import { POST } from '../route';

const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/task-feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('does not record or mutate task feedback without an authenticated actor', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    });

    const response = await POST({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        taskId: 'task-1',
        type: 'down',
        notes: 'try again',
      }),
    } as any);

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
