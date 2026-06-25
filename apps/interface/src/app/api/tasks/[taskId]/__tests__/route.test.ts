import { NextResponse } from 'next/server';

import { GET } from '../route';

const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/tasks/[taskId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        userName: 'Sam',
        tenantId: 'tenant-a',
        tenantRole: 'member',
      },
    });
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task: {
            id: 'task-1',
            title: 'Build a site',
            status: 'completed',
            requester_user_id: 'user-1',
            requester_email: 'sam@example.com',
            requester_tenant_id: 'tenant-a',
          },
        }),
        { status: 200 },
      ),
    );
  });

  it('returns a single owned task for Launchpad polling', async () => {
    const req = { headers: new Headers() } as any;
    const response = await GET(req, {
      params: Promise.resolve({ taskId: 'task-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ request: req });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-User-Id']).toBe('user-1');
    expect(init.headers['X-User-Email']).toBe('sam@example.com');
    expect(init.headers['X-Pearl-Tenant-Id']).toBe('tenant-a');
    expect(body.task.id).toBe('task-1');
    expect(body.task.status).toBe('completed');
  });

  it('does not return a task when tenant access is denied', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET({ headers: new Headers() } as any, {
      params: Promise.resolve({ taskId: 'task-1' }),
    });

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
