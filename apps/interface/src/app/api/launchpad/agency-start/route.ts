import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import {
  estimateTenantBudgetCents,
  reserveTenantBudget,
  TenantBudgetError,
} from '@interface/lib/tenant-budget';
import {
  readProjects,
  writeProjects,
  projectBelongsToRequester,
  type LaunchpadProject,
  type LaunchpadRequester,
} from '../lib/store';
import { creationOutputPath } from '../lib/creation-artifacts';
import {
  buildTaskPrompt,
  type CreationKind,
  type AttachedNote,
  type SelectedSprite,
} from '../lib/build-task-prompt';
import { seedStudioFallbackArtifact } from '../lib/studio-fallback-artifact';

const startSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  // Studio UI may also send these inline so the dispatcher can build the
  // prompt without re-reading the project record. They override what's on
  // the project if present.
  userPrompt: z.string().optional(),
  creationType: z.enum(['APP', 'GAME', 'PEARLOS']).optional(),
  attachedNotes: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
      })
    )
    .optional(),
  selectedSprites: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
      })
    )
    .optional(),
  editingCreationId: z.string().optional(),
  editNotes: z.string().optional(),
  agents: z.array(z.string().min(1)).optional(),
  swarmCategory: z.string().min(1).optional(),
  agencyRoomSummary: z.string().min(1).optional(),
  execution_mode: z.enum(['fast_draft', 'full_build']).optional(),
});

type StartInput = z.infer<typeof startSchema>;

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_SWARM_AGENT_CAP = 6;
const OPENROUTER_MODEL_BY_AGENT: Record<string, string> = {
  opus: 'anthropic/claude-opus-4.8',
  claude: 'anthropic/claude-sonnet-4.6',
  codex: 'openai/gpt-5.3-codex',
  kimi: 'moonshotai/kimi-k2.7-code',
  gemini: 'google/gemini-3.1-pro-preview',
  deepseek: 'deepseek/deepseek-v4-pro',
  qwen: 'qwen/qwen3.7-max',
  glm: 'z-ai/glm-5.2',
  grok: 'x-ai/grok-4.3',
};
const OPENROUTER_AGENT_MATCH_ORDER = Object.keys(OPENROUTER_MODEL_BY_AGENT);

interface SwarmPlanningEntry {
  agent: string;
  model: string;
  status: 'ok' | 'failed';
  content: string;
}

interface SwarmPlanningResult {
  attempted: boolean;
  entries: SwarmPlanningEntry[];
  skippedReason?: string;
}

interface ProjectStateResult {
  persisted: boolean;
  error?: string;
}

interface StudioBuildPolicy {
  requestedExecutionMode: 'fast_draft' | 'full_build';
  executionMode: 'fast_draft' | 'full_build';
  planningEnabled: boolean;
  complexityEscalated: boolean;
  timeoutS: number;
  maxRetries: number;
}

function shouldReservePlanningBudget(planningEnabled: boolean, agents: string[]): boolean {
  return planningEnabled
    && Boolean(process.env.OPENROUTER_API_KEY)
    && planningAgents(agents).length > 0;
}

function looksComplexStudioBuild(params: {
  userPrompt: string;
  creationKind: CreationKind;
  attachedNotes?: AttachedNote[];
  selectedSprites?: SelectedSprite[];
}): boolean {
  const text = params.userPrompt.toLowerCase();
  if (params.creationKind === 'PEARLOS') return true;
  if ((params.attachedNotes?.length || 0) > 0 || (params.selectedSprites?.length || 0) > 0) {
    return true;
  }
  if (params.userPrompt.length > 180) return true;
  return /\b(crm|dashboard|tracker|client|customer|lead|contact|database|inventory|booking|schedule|invoice|quote|estimate|form|portal|admin|auth|login|api|live data|map|analytics|report|workflow|kanban|calendar|table|list)\b/.test(text);
}

function studioBuildPolicy(params: {
  requestedExecutionMode: 'fast_draft' | 'full_build';
  userPrompt: string;
  creationKind: CreationKind;
  attachedNotes?: AttachedNote[];
  selectedSprites?: SelectedSprite[];
}): StudioBuildPolicy {
  const complexityEscalated =
    params.requestedExecutionMode === 'fast_draft' &&
    looksComplexStudioBuild(params);
  const executionMode =
    params.requestedExecutionMode === 'full_build' || complexityEscalated
      ? 'full_build'
      : 'fast_draft';

  return {
    requestedExecutionMode: params.requestedExecutionMode,
    executionMode,
    // Planning swarm calls remain opt-in through the visible Full Build mode.
    // Auto-escalated fast drafts get the longer worker budget without adding a
    // separate OpenRouter budget gate that could block the actual build.
    planningEnabled: params.requestedExecutionMode === 'full_build',
    complexityEscalated,
    timeoutS: executionMode === 'full_build' ? 900 : 420,
    maxRetries: 1,
  };
}

async function getRequesterIdentity() {
  const actorResult = await resolveInterfaceActorContext();
  if (!actorResult.ok) return actorResult;
  const actor = actorResult.actor;
  return {
    ok: true as const,
    requester: {
      userId: actor.userId,
      email: actor.userEmail,
      tenantId: actor.tenantId,
    },
  };
}

function deriveCreationKind(
  project: LaunchpadProject,
  override?: 'APP' | 'GAME' | 'PEARLOS'
): CreationKind {
  const candidate = override ?? project.creationType;
  if (candidate === 'APP' || candidate === 'GAME' || candidate === 'PEARLOS') return candidate;
  if (project.type === 'game') return 'GAME';
  if (project.type === 'pearlos') return 'PEARLOS';
  return 'APP';
}

function cleanAgentName(agent: string): string {
  return agent.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function modelForAgent(agent: string): string | undefined {
  const lower = agent.toLowerCase();
  const key = OPENROUTER_AGENT_MATCH_ORDER.find((candidate) => lower.includes(candidate));
  return key ? OPENROUTER_MODEL_BY_AGENT[key] : undefined;
}

function planningAgents(agents: string[]): Array<{ agent: string; model: string }> {
  const seen = new Set<string>();
  const selected: Array<{ agent: string; model: string }> = [];
  for (const rawAgent of agents) {
    const agent = cleanAgentName(rawAgent);
    if (!agent) continue;
    const model = modelForAgent(agent);
    if (!model) continue;
    const dedupeKey = `${agent.toLowerCase()}::${model}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    selected.push({ agent, model });
    if (selected.length >= OPENROUTER_SWARM_AGENT_CAP) break;
  }
  return selected;
}

function truncateForPrompt(value: string, limit = 6000): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n\n[truncated]`;
}

function sanitizePlanningPrompt(prompt: string, outputPath: string): string {
  return prompt.split(outputPath).join('[tenant-scoped creation output directory]');
}

function truncateAgentResult(value: unknown): string {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  return text.length <= 900 ? text : `${text.slice(0, 900)}...`;
}

async function updateProjectState(params: {
  projectId: string;
  requester: LaunchpadRequester;
  patch: Partial<LaunchpadProject>;
}): Promise<ProjectStateResult> {
  try {
    const latestProjects = await readProjects();
    const latestIdx = latestProjects.findIndex((candidate) => candidate.id === params.projectId);
    if (latestIdx === -1) return { persisted: false, error: 'project_not_found' };
    const latestProject = latestProjects[latestIdx];
    if (!projectBelongsToRequester(latestProject, params.requester)) {
      return { persisted: false, error: 'project_not_in_requester_scope' };
    }
    latestProjects[latestIdx] = {
      ...latestProject,
      ...params.patch,
      updatedAt: new Date().toISOString(),
    };
    await writeProjects(latestProjects);
    return { persisted: true };
  } catch (error) {
    return { persisted: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runOpenRouterPlanningAgent(params: {
  agent: string;
  model: string;
  creationKind: CreationKind;
  prompt: string;
  outputPath: string;
  swarmCategory: string;
}): Promise<SwarmPlanningEntry> {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_INTERFACE_URL || 'https://pearlos.org',
      'X-Title': 'PearlOS Launchpad Agency Swarm',
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: 'system',
          content: [
            'You are one reviewer in a PearlOS Agency planning swarm.',
            'Give compact implementation guidance for the builder agent.',
            'Do not claim you wrote files. Do not expose secrets, internal ids, or private paths beyond the provided output target.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Agent label: ${params.agent}`,
            `Swarm category: ${params.swarmCategory}`,
            `Creation type: ${params.creationKind}`,
            'Artifact requirement: the builder must create and verify index.html and supporting assets in the tenant-scoped creation output directory.',
            '',
            truncateForPrompt(sanitizePlanningPrompt(params.prompt, params.outputPath)),
          ].join('\n'),
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenRouter ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
  const data = await response.json();
  const content = truncateAgentResult(data?.choices?.[0]?.message?.content);
  if (!content) throw new Error('OpenRouter returned no content');
  return {
    agent: params.agent,
    model: params.model,
    status: 'ok',
    content,
  };
}

async function runOpenRouterPlanningSwarm(params: {
  agents: string[];
  creationKind: CreationKind;
  prompt: string;
  outputPath: string;
  swarmCategory: string;
}): Promise<SwarmPlanningResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    return { attempted: false, entries: [], skippedReason: 'openrouter_not_configured' };
  }
  const selected = planningAgents(params.agents);
  if (!selected.length) {
    return { attempted: false, entries: [], skippedReason: 'no_agents_selected' };
  }
  const entries = await Promise.all(selected.map(async ({ agent, model }) => {
    try {
      return await runOpenRouterPlanningAgent({
        agent,
        model,
        creationKind: params.creationKind,
        prompt: params.prompt,
        outputPath: params.outputPath,
        swarmCategory: params.swarmCategory,
      });
    } catch (error) {
      return {
        agent,
        model,
        status: 'failed' as const,
        content: error instanceof Error ? error.message.slice(0, 240) : 'OpenRouter call failed',
      };
    }
  }));
  return { attempted: true, entries };
}

function appendPlanningSwarm(taskBody: string, result: SwarmPlanningResult): string {
  const okEntries = result.entries.filter((entry) => entry.status === 'ok');
  if (!result.attempted || !okEntries.length) return taskBody;
  const lines = okEntries.map((entry) => (
    `- ${entry.agent} (${entry.model}): ${entry.content}`
  ));
  return [
    taskBody,
    '---',
    'OpenRouter Agency planning swarm results:',
    ...lines,
    '',
    'Use these notes as review input only. The builder must still create and verify the requested artifact before completing the task.',
  ].join('\n');
}

export async function POST(request: Request) {
  let payload: StartInput;
  try {
    const body = await request.json();
    payload = startSchema.parse(body);
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((i) => i.message).join(', ')
      : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const requesterResult = await getRequesterIdentity();
  if (!requesterResult.ok) return requesterResult.response;
  const { requester } = requesterResult;
  const projects = await readProjects();
  const idx = projects.findIndex((p) => p.id === payload.projectId);
  if (idx === -1) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const project = projects[idx];
  if (!projectBelongsToRequester(project, requester)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Build the single task prompt for this project ──
  // The Studio dispatch contract is one project = one artifact-building task.
  // Full-build requests may add OpenRouter planning notes ahead of dispatch. The
  // request body may carry overrides (the Studio UI sends them inline so
  // edits don't have to round-trip the project record); otherwise we fall
  // back to whatever was persisted at create-project time.
  const creationKind = deriveCreationKind(project, payload.creationType);
  const userPrompt = payload.userPrompt ?? project.content ?? project.title;
  const attachedNotes: AttachedNote[] | undefined =
    payload.attachedNotes ?? project.attachedNotes;
  const selectedSprites: SelectedSprite[] | undefined =
    payload.selectedSprites ?? project.selectedSprites;
  const editingCreationId =
    payload.editingCreationId ?? project.editingCreationId;
  const editNotes = payload.editNotes ?? project.editNotes;
  const creationId = editingCreationId || project.id;
  const outputPath = creationOutputPath(creationId, requester);
  const agents = payload.agents?.length ? payload.agents.slice(0, 42) : ['Codex', 'Claude', 'Kimi', 'Gemini', 'DeepSeek'];
  const swarmCategory = payload.swarmCategory || 'Studio Dream Team';
  const requestedExecutionMode = payload.execution_mode === 'fast_draft' ? 'fast_draft' : 'full_build';
  const buildPolicy = studioBuildPolicy({
    requestedExecutionMode,
    userPrompt,
    creationKind,
    attachedNotes,
    selectedSprites,
  });
  let planningAllowed = shouldReservePlanningBudget(buildPolicy.planningEnabled, agents);
  let planningSkippedReason: string | undefined;
  if (planningAllowed) {
    try {
      const planningAgentCount = planningAgents(agents).length;
      await reserveTenantBudget({
        tenantId: requester.tenantId,
        surface: 'launchpad_planning',
        estimatedCents: estimateTenantBudgetCents('launchpad_planning', planningAgentCount * 25),
      });
    } catch (error) {
      if (error instanceof TenantBudgetError) {
        planningAllowed = false;
        planningSkippedReason = 'planning_budget_unavailable';
      } else {
        throw error;
      }
    }
  }
  try {
    await fs.mkdir(outputPath, { recursive: true });
    await fs.chmod(outputPath, 0o755).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateProjectState({
      projectId: project.id,
      requester,
      patch: { status: 'error' },
    });
    return NextResponse.json(
      { error: `Unable to prepare creation output directory: ${message}` },
      { status: 500 }
    );
  }

  const { title: taskTitle, prompt } = buildTaskPrompt({
    userPrompt,
    creationType: creationKind,
    attachedNotes,
    selectedSprites,
    creationId: project.id,
    outputPath,
    editingCreationId,
    editNotes,
  });
  const baseTaskBody = payload.agencyRoomSummary
    ? `${prompt}\n\nAgency room allocation: ${payload.agencyRoomSummary}.`
    : prompt;
  let artifactSeededAt: string | undefined;
  try {
    await seedStudioFallbackArtifact({
      creationId,
      creationKind,
      outputPath,
      title: taskTitle,
      userPrompt,
    });
    artifactSeededAt = new Date().toISOString();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateProjectState({
      projectId: project.id,
      requester,
      patch: {
        status: 'error',
        outputPath,
        lastBuildFailure: `Unable to seed runnable Studio artifact: ${message}`,
      },
    });
    return NextResponse.json(
      { error: `Unable to seed runnable Studio artifact: ${message}` },
      { status: 500 },
    );
  }

  const planningSwarm = planningAllowed
    ? await runOpenRouterPlanningSwarm({
      agents,
      creationKind,
      prompt: baseTaskBody,
      outputPath,
      swarmCategory,
    })
    : ({
      attempted: false,
      entries: [],
      skippedReason: planningSkippedReason || (
        buildPolicy.planningEnabled ? 'openrouter_not_configured' : buildPolicy.requestedExecutionMode
      ),
    } satisfies SwarmPlanningResult);
  const taskBody = appendPlanningSwarm(baseTaskBody, planningSwarm);

  // ── Dispatch a single task to the bot gateway ──
  const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');
  const SHARED_SECRET = process.env.BOT_CONTROL_SHARED_SECRET || '';

  function gwHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (SHARED_SECRET) {
      h['X-Bot-Secret'] = SHARED_SECRET;
      h['Authorization'] = `Bearer ${SHARED_SECRET}`;
    }
    return h;
  }

  const dispatched: {
    taskId?: string;
    title: string;
    error?: string;
  } = {
    title: taskTitle,
  };

  try {
    // Step 1: create the task record
    const createRes = await fetch(`${BOT_GATEWAY}/api/tasks`, {
      method: 'POST',
      headers: gwHeaders(),
      body: JSON.stringify({
        source: 'manual',
        created_by: 'pearl',
        assignee: 'claude_cli',
        status: 'pending',
        urgency: 'urgent',
        title: taskTitle,
        task: taskBody,
        requester_email: requester.email,
        requester_user_id: requester.userId,
        requester_tenant_id: requester.tenantId,
        workspace_path: outputPath,
        max_retries: buildPolicy.maxRetries,
        timeout_s: buildPolicy.timeoutS,
        execution_mode: buildPolicy.executionMode,
        kind: buildPolicy.planningEnabled ? 'swarm' : 'task',
        agents: buildPolicy.planningEnabled ? agents : [],
        swarm_category: buildPolicy.planningEnabled ? swarmCategory : 'Studio Build',
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => 'unknown_error');
      dispatched.error = `task_create_failed: ${createRes.status} ${errText}`;
      console.error(`[Launchpad] Failed to create task: ${errText}`);
    } else {
      const createData = await createRes.json();
      const taskId: string | undefined =
        createData?.task?.id || createData?.id;

      if (!taskId) {
        dispatched.error = 'no_task_id_returned';
        console.error('[Launchpad] No task ID returned from gateway');
      } else {
        dispatched.taskId = taskId;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dispatched.error = `dispatch_error: ${msg}`;
    console.error(`[Launchpad] Dispatch error: ${msg}`);
  }

  if (dispatched.error || !dispatched.taskId) {
    const projectState = await updateProjectState({
      projectId: project.id,
      requester,
      patch: {
        status: 'complete',
        outputPath,
        playUrl: `/api/creation/${encodeURIComponent(creationId)}/`,
        buildPassCompletedAt: new Date().toISOString(),
        artifactSeededAt,
        lastBuildFailure: dispatched.error || 'task_create_failed',
      },
    });
    return NextResponse.json({
      ok: true,
      fallbackOnly: true,
      error: dispatched.error || 'task_create_failed',
      projectId: project.id,
      creationId: project.id,
      editingCreationId,
      dispatched,
      projectState,
      buildPolicy,
      planningSwarm: {
        attempted: planningSwarm.attempted,
        completedAgentCount: planningSwarm.entries.filter((entry) => entry.status === 'ok').length,
        failedAgentCount: planningSwarm.entries.filter((entry) => entry.status === 'failed').length,
        skippedReason: planningSwarm.skippedReason,
        agents: planningSwarm.entries.map((entry) => ({
          agent: entry.agent,
          model: entry.model,
          status: entry.status,
        })),
      },
    });
  }

  const projectState = await updateProjectState({
    projectId: project.id,
    requester,
    patch: {
      status: 'building',
      outputPath,
      playUrl: `/api/creation/${encodeURIComponent(creationId)}/`,
      builderTaskId: dispatched.taskId,
      builderStatus: 'pending',
      builderExecutionMode: buildPolicy.executionMode,
      artifactSeededAt,
      lastBuildFailure: undefined,
    },
  });
  if (!projectState.persisted) {
    console.error(`[Launchpad] Task created but project state update failed: ${projectState.error}`);
  }

  return NextResponse.json({
    ok: true,
    projectId: project.id,
    creationId: project.id,
    editingCreationId,
    dispatched,
    projectState,
    buildPolicy,
    planningSwarm: {
      attempted: planningSwarm.attempted,
      completedAgentCount: planningSwarm.entries.filter((entry) => entry.status === 'ok').length,
      failedAgentCount: planningSwarm.entries.filter((entry) => entry.status === 'failed').length,
      skippedReason: planningSwarm.skippedReason,
      agents: planningSwarm.entries.map((entry) => ({
        agent: entry.agent,
        model: entry.model,
        status: entry.status,
      })),
    },
  });
}
