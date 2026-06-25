import crypto from 'crypto';

import { POST } from '../route';

const mockDispatchWebhookEvent = jest.fn();
const mockTaskArtifactUrl = jest.fn();

jest.mock('@nia/prism/core/actions/webhook-actions', () => ({
  dispatchWebhookEvent: (...args: unknown[]) => mockDispatchWebhookEvent(...args),
}));

jest.mock('../../lib/task-artifacts', () => ({
  taskArtifactUrl: (...args: unknown[]) => mockTaskArtifactUrl(...args),
}));

describe('/api/tasks/webhook-event', () => {
  const originalSecret = process.env.BOT_CONTROL_SHARED_SECRET;
  const originalInterfaceUrl = process.env.NEXT_PUBLIC_INTERFACE_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOT_CONTROL_SHARED_SECRET = 'shared-secret';
    process.env.NEXT_PUBLIC_INTERFACE_URL = 'https://app.example.com';
    mockTaskArtifactUrl.mockReturnValue('/api/tasks/artifact/task-1/index.html');
    mockDispatchWebhookEvent.mockResolvedValue([
      { _id: 'delivery-1', status: 'success', responseStatus: 200 },
    ]);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task: {
              id: 'task-1',
              title: 'Build Lagoon Gems',
              status: 'completed',
              source: 'web_chat',
              kind: 'swarm',
              agents: ['Codex', 'Kimi'],
              requester_user_id: 'user-1',
              requester_tenant_id: 'tenant-a',
              workspace_path: '/srv/pearl-user-workspaces/tenant-a/user-1/task-1',
              result: 'Built the site at /srv/pearl-user-workspaces/tenant-a/user-1/task-1/index.html from /workspace/nia-universal',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterAll(() => {
    process.env.BOT_CONTROL_SHARED_SECRET = originalSecret;
    process.env.NEXT_PUBLIC_INTERFACE_URL = originalInterfaceUrl;
  });

  function signedRequest(payload: unknown) {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac('sha256', 'shared-secret')
      .update(`${timestamp}.${body}`)
      .digest('hex');
    return {
      headers: new Headers({
        Authorization: 'Bearer shared-secret',
        'X-PearlOS-Timestamp': timestamp,
        'X-PearlOS-Signature-256': `sha256=${signature}`,
      }),
      text: async () => body,
    };
  }

  it('dispatches task completion webhooks with an artifact link', async () => {
    const response = await POST(signedRequest({
        event: 'task.completed',
        task: {
          id: 'task-1',
        },
      }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deliveryCount).toBe(1);
    expect(mockDispatchWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'task.completed',
        tenantId: 'tenant-a',
        resourceId: 'task-1',
        resourceType: 'Task',
        actorUserId: 'user-1',
        metadata: expect.objectContaining({
          title: 'Build Lagoon Gems',
          status: 'completed',
          kind: 'swarm',
          result: 'Built the site at [task-workspace] from [internal-path]',
          artifactUrl: 'https://app.example.com/api/tasks/artifact/task-1/index.html',
          artifactPath: '/api/tasks/artifact/task-1/index.html',
        }),
      }),
    );
    expect(global.fetch).toHaveBeenLastCalledWith(
      'http://localhost:4444/api/tasks/task-1',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('webhook_notified_at'),
      }),
    );
  });

  it('does not mark the task notified when matching webhook deliveries fail', async () => {
    mockDispatchWebhookEvent.mockResolvedValueOnce([
      { _id: 'delivery-1', status: 'failed', responseStatus: 500 },
    ]);

    const response = await POST(signedRequest({
        event: 'task.completed',
        task: {
          id: 'task-1',
        },
      }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deliveryCount).toBe(1);
    expect(body.webhookMarkedNotified).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects calls without the shared bot secret', async () => {
    const response = await POST({
      headers: new Headers(),
      text: async () => JSON.stringify({ task: { id: 'task-1' } }),
    } as any);

    expect(response.status).toBe(401);
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
  });
});
