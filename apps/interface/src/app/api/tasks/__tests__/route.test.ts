import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { GET, POST } from '../route';

const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/tasks', () => {
  const originalTaskRoot = process.env.PEARL_PUBLIC_TASK_ROOT;
  let tempTaskRoot: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tempTaskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-task-route-'));
    process.env.PEARL_PUBLIC_TASK_ROOT = tempTaskRoot;
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
            task: 'Build a site',
            status: 'pending',
            requester_user_id: 'user-1',
            requester_email: 'sam@example.com',
            requester_tenant_id: 'tenant-a',
          },
        }),
        { status: 200 },
      ),
    );
  });

  afterEach(() => {
    if (tempTaskRoot) {
      fs.rmSync(tempTaskRoot, { recursive: true, force: true });
    }
    if (originalTaskRoot === undefined) {
      delete process.env.PEARL_PUBLIC_TASK_ROOT;
    } else {
      process.env.PEARL_PUBLIC_TASK_ROOT = originalTaskRoot;
    }
  });

  it('creates swarm tasks with resolved actor identity, not caller tenant claims', async () => {
    const response = await POST({
      json: async () => ({
        action: 'create',
        tenantId: 'tenant-spoof',
        requester_tenant_id: 'tenant-spoof',
        task: 'Create a small website',
        kind: 'swarm',
        agents: ['Codex', 'Kimi'],
        swarmCategory: 'Creative',
        execute: true,
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded).toMatchObject({
      requester_email: 'sam@example.com',
      requester_user_id: 'user-1',
      requester_tenant_id: 'tenant-a',
      workspace_mode: 'sandbox',
      kind: 'swarm',
      agents: ['Codex', 'Kimi'],
      swarm_category: 'Creative',
    });
    expect(forwarded.workspace_isolation_notice).toContain(
      "Pearl changes only the requester's PearlOS instance",
    );
  });

  it('does not forward task creation when the requested tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await POST({
      json: async () => ({
        action: 'create',
        tenantId: 'tenant-b',
        task: 'Create a small website',
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lists only tasks scoped to the resolved actor tenant', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tasks: [
            {
              id: 'task-a',
              title: 'Tenant A task',
              status: 'completed',
              requester_user_id: 'user-1',
              requester_email: 'sam@example.com',
              requester_tenant_id: 'tenant-a',
            },
            {
              id: 'task-b',
              title: 'Tenant B task',
              status: 'completed',
              requester_user_id: 'user-1',
              requester_email: 'sam@example.com',
              requester_tenant_id: 'tenant-b',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const response = await GET({
      url: 'https://app.example.com/api/tasks?tenantId=tenant-a&status=completed',
    } as any);
    const body = await response.json();
    const target = new URL((global.fetch as jest.Mock).mock.calls[0][0]);

    expect(response.status).toBe(200);
    expect(target.searchParams.get('requester_user_id')).toBe('user-1');
    expect(target.searchParams.get('requester_email')).toBe('sam@example.com');
    expect(target.searchParams.get('requester_tenant_id')).toBe('tenant-a');
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe('task-a');
  });

  it('does not mutate a task when the actor cannot access the task tenant', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await POST({
      json: async () => ({
        action: 'cancel',
        taskId: 'task-b',
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not downgrade an already-running task when start is pressed again', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task: {
            id: 'task-1',
            title: 'Running task',
            task: 'Running task',
            status: 'in_progress',
            requester_user_id: 'user-1',
            requester_email: 'sam@example.com',
            requester_tenant_id: 'tenant-a',
          },
        }),
        { status: 200 },
      ),
    );

    const response = await POST({
      json: async () => ({
        action: 'start',
        taskId: 'task-1',
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alreadyRunning).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects normal users attempting to spoof the staging source workspace', async () => {
    const response = await POST({
      json: async () => ({
        action: 'create',
        task: 'Patch the staging source tree',
        workspace_path: '/workspace/nia-universal',
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'personal_instance_only',
      message: expect.stringContaining("Pearl changes only the requester's PearlOS instance"),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('auto-routes Blair PearlOS source tasks to the staging source workspace', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: true,
      actor: {
        userId: '00000000-0000-0000-0003-000000000020',
        userEmail: 'blair@niaxp.com',
        userName: 'Blair',
        tenantId: 'tenant-a',
        tenantRole: 'owner',
      },
    });

    const response = await POST({
      json: async () => ({
        action: 'create',
        task: 'The Pulse app globe is broken; fix the PearlOS desktop app source',
      }),
    } as any);

    expect(response.status).toBe(200);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded).toMatchObject({
      requester_email: 'blair@niaxp.com',
      requester_user_id: '00000000-0000-0000-0003-000000000020',
      workspace_mode: 'staging_source',
      workspace_path: '/workspace/nia-universal',
    });
  });

  it('routes Blair Studio app/game creation tasks to a user-scoped creation workspace', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: true,
      actor: {
        userId: '00000000-0000-0000-0003-000000000020',
        userEmail: 'blair@niaxp.com',
        userName: 'Blair',
        tenantId: 'tenant-a',
        tenantRole: 'owner',
      },
    });

    const response = await POST({
      json: async () => ({
        action: 'create',
        title: 'Build a 2D side-scrolling experience',
        task: "Build a 2D side-scrolling immersive experience. Create a web app and put a link in Studio.",
        kind: 'swarm',
        agents: ['Codex', 'Kimi'],
      }),
    } as any);

    expect(response.status).toBe(200);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded).toMatchObject({
      requester_email: 'blair@niaxp.com',
      requester_user_id: '00000000-0000-0000-0003-000000000020',
      requester_tenant_id: 'tenant-a',
      workspace_mode: 'sandbox',
      kind: 'swarm',
      agents: ['Codex', 'Kimi'],
    });
    expect(forwarded.workspace_path).toMatch(
      new RegExp(
        `^${tempTaskRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/tenant-a\\/00000000-0000-0000-0003-000000000020\\/creations\\/[a-f0-9-]+\\/$`,
      ),
    );
    expect(forwarded.workspace_path).not.toBe('/workspace/nia-universal');
    expect(fs.existsSync(forwarded.workspace_path)).toBe(true);
    expect(forwarded.task).toContain('OUTPUT TARGET');
    expect(forwarded.task).toContain('PLAY URL: /api/creation/');
  });

  it('forwards scoped GitHub fork workspaces for advanced users', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: true,
      actor: {
        userId: 'admin-id',
        userEmail: 'admin@example.com',
        userName: 'Admin',
        tenantId: 'tenant-a',
        tenantRole: 'admin',
      },
    });

    const response = await POST({
      json: async () => ({
        action: 'create',
        task: 'Implement this in my fork',
        workspaceMode: 'github_fork',
        githubForkUrl: 'https://github.com/blair/pearlos-fork.git',
      }),
    } as any);

    expect(response.status).toBe(200);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const forwarded = JSON.parse(init.body);
    expect(forwarded).toMatchObject({
      requester_email: 'admin@example.com',
      requester_user_id: 'admin-id',
      requester_tenant_id: 'tenant-a',
      requester_tenant_role: 'admin',
      workspace_mode: 'github_fork',
      github_fork_url: 'https://github.com/blair/pearlos-fork.git',
    });
    expect(forwarded.workspace_path).toBe('/srv/pearl-user-workspaces/tenant-a/admin-id/forks/blair_pearlos-fork');
  });
});
