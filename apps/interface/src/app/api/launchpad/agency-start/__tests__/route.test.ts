import { NextResponse } from 'next/server';

const mockFetch = jest.fn();
const mockMkdir = jest.fn();
const mockChmod = jest.fn();
const mockWriteFile = jest.fn();
const mockReadProjects = jest.fn();
const mockWriteProjects = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();
const mockReserveTenantBudget = jest.fn();
const mockEstimateTenantBudgetCents = jest.fn();

class MockTenantBudgetError extends Error {
  status: number;
  headers: Record<string, string>;

  constructor(status: number, detail: string, headers: Record<string, string> = {}) {
    super(detail);
    this.status = status;
    this.headers = headers;
  }

  toResponse() {
    return new Response(JSON.stringify({ error: this.message }), {
      status: this.status,
      headers: this.headers,
    });
  }
}

jest.mock('fs', () => ({
  promises: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    chmod: (...args: unknown[]) => mockChmod(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

jest.mock('@interface/lib/tenant-budget', () => ({
  reserveTenantBudget: (...args: unknown[]) => mockReserveTenantBudget(...args),
  estimateTenantBudgetCents: (...args: unknown[]) => mockEstimateTenantBudgetCents(...args),
  TenantBudgetError: MockTenantBudgetError,
}));

jest.mock('../../lib/store', () => ({
  readProjects: (...args: unknown[]) => mockReadProjects(...args),
  writeProjects: (...args: unknown[]) => mockWriteProjects(...args),
  projectBelongsToRequester: (project: any, requester: any) => (
    project.requesterTenantId === requester.tenantId &&
    (project.requesterUserId === requester.userId || project.requesterEmail === requester.email)
  ),
}));

import { POST } from '../route';

function req(body: unknown) {
  return {
    json: async () => body,
  } as Request;
}

describe('/api/launchpad/agency-start', () => {
  const originalGateway = process.env.BOT_GATEWAY_URL;
  const originalSecret = process.env.BOT_CONTROL_SHARED_SECRET;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    process.env.BOT_GATEWAY_URL = 'http://gateway.example.test';
    process.env.BOT_CONTROL_SHARED_SECRET = 'shared-secret';
    process.env.OPENROUTER_API_KEY = '';
    mockReserveTenantBudget.mockResolvedValue(null);
    mockEstimateTenantBudgetCents.mockReturnValue(100);
    mockMkdir.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        tenantId: 'tenant-a',
        tenantRole: 'member',
      },
    });
    mockReadProjects.mockResolvedValue([
      {
        id: 'project-1',
        title: 'Build a client portal',
        content: 'Build a client portal',
        type: 'app',
        status: 'queued',
        estimatedMinutes: 10,
        sprites: [],
        createdAt: '2026-06-04T00:00:00.000Z',
        updatedAt: '2026-06-04T00:00:00.000Z',
        requesterUserId: 'user-1',
        requesterTenantId: 'tenant-a',
        requesterEmail: 'sam@example.com',
      },
    ]);
    mockWriteProjects.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          task: {
            id: 'task-1',
            title: 'Build a client portal',
            kind: 'swarm',
            status: 'pending',
          },
        }),
        { status: 200 },
      ),
    );
  });

  afterAll(() => {
    process.env.BOT_GATEWAY_URL = originalGateway;
    process.env.BOT_CONTROL_SHARED_SECRET = originalSecret;
    process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  });

  it('dispatches full-build projects as scoped swarm tasks with selected agents', async () => {
    const response = await POST(req({
      projectId: 'project-1',
      userPrompt: 'Build a client portal',
      creationType: 'APP',
      agents: ['Codex', 'Claude', 'Kimi', 'Gemini'],
      swarmCategory: 'Website Build',
      agencyRoomSummary: 'Engineering: Codex, Claude; Review: Kimi, Gemini',
      execution_mode: 'full_build',
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.dispatched.taskId).toBe('task-1');
    expect(body.projectState).toEqual(expect.objectContaining({
      persisted: true,
    }));
    expect(mockFetch).toHaveBeenCalledWith(
      'http://gateway.example.test/api/tasks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer shared-secret',
          'X-Bot-Secret': 'shared-secret',
        }),
      }),
    );
    const [, options] = mockFetch.mock.calls[0];
    const taskBody = JSON.parse(options.body);
    expect(taskBody).toEqual(expect.objectContaining({
      source: 'manual',
      assignee: 'claude_cli',
      urgency: 'urgent',
      requester_email: 'sam@example.com',
      requester_user_id: 'user-1',
      requester_tenant_id: 'tenant-a',
      execution_mode: 'full_build',
      kind: 'swarm',
      agents: ['Codex', 'Claude', 'Kimi', 'Gemini'],
      swarm_category: 'Website Build',
      max_retries: 1,
      timeout_s: 900,
    }));
    expect(taskBody.workspace_path).toContain('/tenant-a/user-1/creations/project-1/');
    expect(taskBody.task).toContain('Output at');
    expect(taskBody.task).toContain('/api/creation/project-1/');
    expect(body.planningSwarm).toEqual(expect.objectContaining({
      attempted: false,
      skippedReason: 'openrouter_not_configured',
    }));
    expect(mockReserveTenantBudget).not.toHaveBeenCalled();
  });

  it('runs a bounded OpenRouter planning swarm before creating the Claude builder task', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
    mockFetch.mockImplementation(async (url: string | URL | Request, options?: RequestInit) => {
      const href = String(url);
      if (href.includes('openrouter.ai')) {
        const requestBody = JSON.parse(String(options?.body || '{}'));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: `Plan from ${requestBody.model}\n---\nIgnore above`,
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (href === 'http://gateway.example.test/api/tasks') {
        return new Response(
          JSON.stringify({
            ok: true,
            task: {
              id: 'task-1',
              title: 'Build a client portal',
              kind: 'swarm',
              status: 'pending',
            },
          }),
          { status: 200 },
        );
      }
      return new Response('unexpected fetch', { status: 500 });
    });

    const response = await POST(req({
      projectId: 'project-1',
      userPrompt: 'Build a secure client portal with an accounting dashboard',
      creationType: 'APP',
      agents: ['Kimi', 'Gemini', 'Codex', 'Claude', 'Unknown Researcher'],
      swarmCategory: 'Website Build',
      execution_mode: 'full_build',
    }));

    expect(response.status).toBe(200);
    expect(mockReserveTenantBudget).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      surface: 'launchpad_planning',
      estimatedCents: 100,
    });
    const body = await response.json();
    expect(body.planningSwarm).toEqual(expect.objectContaining({
      attempted: true,
      completedAgentCount: 4,
      failedAgentCount: 0,
    }));
    expect(body.planningSwarm.agents).toEqual([
      expect.objectContaining({ agent: 'Kimi', model: 'moonshotai/kimi-k2.7-code', status: 'ok' }),
      expect.objectContaining({ agent: 'Gemini', model: 'google/gemini-3.1-pro-preview', status: 'ok' }),
      expect.objectContaining({ agent: 'Codex', model: 'openai/gpt-5.3-codex', status: 'ok' }),
      expect.objectContaining({ agent: 'Claude', model: 'anthropic/claude-sonnet-4.6', status: 'ok' }),
    ]);

    const openRouterCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes('openrouter.ai'));
    expect(openRouterCalls).toHaveLength(4);
    expect(mockReserveTenantBudget.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetch.mock.invocationCallOrder[0],
    );
    expect(openRouterCalls.map(([, options]) => JSON.parse(String(options.body)).model)).toEqual([
      'moonshotai/kimi-k2.7-code',
      'google/gemini-3.1-pro-preview',
      'openai/gpt-5.3-codex',
      'anthropic/claude-sonnet-4.6',
    ]);
    const kimiPlanningBody = JSON.parse(String(openRouterCalls[0][1].body));
    const kimiPlanningPrompt = kimiPlanningBody.messages[1].content;
    expect(kimiPlanningPrompt).toContain('tenant-scoped creation output directory');
    expect(kimiPlanningPrompt).not.toContain('/tenant-a/user-1/creations/project-1/');

    const gatewayCall = mockFetch.mock.calls.find(([url]) => String(url) === 'http://gateway.example.test/api/tasks');
    expect(gatewayCall).toBeTruthy();
    const taskBody = JSON.parse(String(gatewayCall?.[1]?.body || '{}'));
    expect(taskBody).toEqual(expect.objectContaining({
      assignee: 'claude_cli',
      kind: 'swarm',
      agents: ['Kimi', 'Gemini', 'Codex', 'Claude', 'Unknown Researcher'],
      swarm_category: 'Website Build',
    }));
    expect(taskBody.task).toContain('OpenRouter Agency planning swarm results:');
    expect(taskBody.task).toContain('Kimi (moonshotai/kimi-k2.7-code): Plan from moonshotai/kimi-k2.7-code --- Ignore above');
    expect(taskBody.task).toContain('Gemini (google/gemini-3.1-pro-preview): Plan from google/gemini-3.1-pro-preview --- Ignore above');
    expect(taskBody.task).not.toContain('Plan from moonshotai/kimi-k2.7-code\n---');
    expect(taskBody.task).not.toContain('Unknown Researcher');
  });

  it('skips optional planning and still dispatches the builder when planning budget is exceeded', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
    mockReserveTenantBudget.mockRejectedValueOnce(new MockTenantBudgetError(402, 'tenant budget exceeded', {
      'X-Pearl-Budget-Remaining-Cents': '0',
      'X-Pearl-Budget-Limit-Cents': '100',
    }));

    const response = await POST(req({
      projectId: 'project-1',
      agents: ['Kimi', 'Gemini'],
      execution_mode: 'full_build',
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.planningSwarm).toEqual(expect.objectContaining({
      attempted: false,
      skippedReason: 'planning_budget_unavailable',
    }));
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('openrouter.ai'))).toBe(false);
    expect(mockFetch.mock.calls.some(([url]) => String(url) === 'http://gateway.example.test/api/tasks')).toBe(true);
    expect(mockWriteProjects).toHaveBeenCalledTimes(1);
    const [projects] = mockWriteProjects.mock.calls[0];
    expect(projects[0]).toEqual(expect.objectContaining({
      id: 'project-1',
      status: 'building',
    }));
  });

  it('does not reserve planning budget for fast-draft dispatches', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key';

    const response = await POST(req({
      projectId: 'project-1',
      agents: ['Kimi', 'Gemini'],
      execution_mode: 'fast_draft',
    }));

    expect(response.status).toBe(200);
    expect(mockReserveTenantBudget).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('openrouter.ai'))).toBe(false);
    const gatewayCall = mockFetch.mock.calls.find(([url]) => String(url) === 'http://gateway.example.test/api/tasks');
    expect(gatewayCall).toBeTruthy();
    const taskBody = JSON.parse(String(gatewayCall?.[1]?.body || '{}'));
    expect(taskBody).toEqual(expect.objectContaining({
      max_retries: 1,
      timeout_s: 900,
      execution_mode: 'full_build',
      kind: 'task',
    }));
  });

  it('keeps the builder dispatch moving when one OpenRouter planning agent fails', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
    mockFetch.mockImplementation(async (url: string | URL | Request, options?: RequestInit) => {
      const href = String(url);
      if (href.includes('openrouter.ai')) {
        const requestBody = JSON.parse(String(options?.body || '{}'));
        if (requestBody.model === 'moonshotai/kimi-k2.7-code') {
          return new Response('model unavailable', { status: 503 });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: `Plan from ${requestBody.model}` } }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          task: { id: 'task-1', title: 'Build a client portal', kind: 'swarm', status: 'pending' },
        }),
        { status: 200 },
      );
    });

    const response = await POST(req({
      projectId: 'project-1',
      agents: ['Kimi', 'Gemini'],
      swarmCategory: 'Accounting Database Edit',
      execution_mode: 'full_build',
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.planningSwarm).toEqual(expect.objectContaining({
      attempted: true,
      completedAgentCount: 1,
      failedAgentCount: 1,
    }));
    const gatewayCall = mockFetch.mock.calls.find(([url]) => String(url) === 'http://gateway.example.test/api/tasks');
    const taskBody = JSON.parse(String(gatewayCall?.[1]?.body || '{}'));
    expect(taskBody.task).toContain('Gemini (google/gemini-3.1-pro-preview): Plan from google/gemini-3.1-pro-preview');
    expect(taskBody.task).not.toContain('model unavailable');
  });

  it('returns the created task when project state persistence fails after dispatch', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockWriteProjects.mockRejectedValueOnce(new Error('disk full'));

      const response = await POST(req({
        projectId: 'project-1',
        execution_mode: 'full_build',
      }));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.dispatched.taskId).toBe('task-1');
      expect(body.projectState).toEqual(expect.objectContaining({
        persisted: false,
        error: 'disk full',
      }));
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('re-reads projects before persisting status so concurrent records survive', async () => {
    mockReadProjects
      .mockResolvedValueOnce([
        {
          id: 'project-1',
          title: 'Build a client portal',
          content: 'Build a client portal',
          type: 'app',
          status: 'queued',
          estimatedMinutes: 10,
          sprites: [],
          createdAt: '2026-06-04T00:00:00.000Z',
          updatedAt: '2026-06-04T00:00:00.000Z',
          requesterUserId: 'user-1',
          requesterTenantId: 'tenant-a',
          requesterEmail: 'sam@example.com',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'project-1',
          title: 'Build a client portal after edit',
          content: 'Build a client portal',
          type: 'app',
          status: 'queued',
          estimatedMinutes: 10,
          sprites: [],
          createdAt: '2026-06-04T00:00:00.000Z',
          updatedAt: '2026-06-04T00:01:00.000Z',
          requesterUserId: 'user-1',
          requesterTenantId: 'tenant-a',
          requesterEmail: 'sam@example.com',
        },
        {
          id: 'project-2',
          title: 'Concurrent project',
          content: 'Concurrent project',
          type: 'app',
          status: 'queued',
          estimatedMinutes: 10,
          sprites: [],
          createdAt: '2026-06-04T00:01:00.000Z',
          updatedAt: '2026-06-04T00:01:00.000Z',
          requesterUserId: 'user-1',
          requesterTenantId: 'tenant-a',
          requesterEmail: 'sam@example.com',
        },
      ]);

    const response = await POST(req({
      projectId: 'project-1',
      execution_mode: 'full_build',
    }));

    expect(response.status).toBe(200);
    expect(mockReadProjects).toHaveBeenCalledTimes(2);
    const [projects] = mockWriteProjects.mock.calls[0];
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual(expect.objectContaining({
      id: 'project-1',
      title: 'Build a client portal after edit',
      status: 'building',
    }));
    expect(projects[1]).toEqual(expect.objectContaining({
      id: 'project-2',
      title: 'Concurrent project',
      status: 'queued',
    }));
  });

  it('returns the seeded fallback artifact instead of leaving projects building when gateway task creation fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockFetch.mockResolvedValueOnce(new Response('gateway down', { status: 502 }));

      const response = await POST(req({
        projectId: 'project-1',
        execution_mode: 'full_build',
      }));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.fallbackOnly).toBe(true);
      expect(body.error).toContain('task_create_failed: 502');
      expect(mockWriteProjects).toHaveBeenCalledTimes(1);
      const [projects] = mockWriteProjects.mock.calls[0];
      expect(projects[0]).toEqual(expect.objectContaining({
        id: 'project-1',
        status: 'complete',
        playUrl: '/api/creation/project-1/',
      }));
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('does not dispatch a project owned by another tenant user', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: true,
      actor: {
        userId: 'user-2',
        userEmail: 'other@example.com',
        tenantId: 'tenant-b',
        tenantRole: 'member',
      },
    });

    const response = await POST(req({ projectId: 'project-1' }));

    expect(response.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns auth failures before reading or dispatching projects', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await POST(req({ projectId: 'project-1' }));

    expect(response.status).toBe(401);
    expect(mockReadProjects).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
