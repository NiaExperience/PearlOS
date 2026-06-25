import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import {
  resolveInterfaceActorContext,
  type InterfaceActorContext,
} from '@interface/lib/tenant-actor';
import {
  PERSONAL_INSTANCE_WORKSPACE_MESSAGE,
  resolveWorkspaceForActor,
  WorkspaceEntitlementError,
  type WorkspaceMode,
} from '@interface/lib/workspace-entitlements';
import { buildTaskPrompt, type CreationKind } from '../launchpad/lib/build-task-prompt';
import { creationOutputPath } from '../launchpad/lib/creation-artifacts';
import { seedStudioFallbackArtifact } from '../launchpad/lib/studio-fallback-artifact';
import { readProjects, writeProjects, type LaunchpadProject } from '../launchpad/lib/store';
import { taskArtifactUrl } from './lib/task-artifacts';
import { sanitizeTaskResultForUser } from '@interface/lib/task-result-sanitizer';

const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');
const SHARED_SECRET = process.env.BOT_CONTROL_SHARED_SECRET || '';
const USER_ROOT_BASE = '/workspace/user';
const VALID_TASK_CREATORS = new Set(['pearl', 'blair', 'claude_cli', 'system', 'agency']);

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'archived';
export type TaskUrgency = 'normal' | 'urgent';
export type TaskApprovalStatus = 'pending' | 'approved' | 'rework';

export interface AgentThought {
  agentId: string;
  thought: string;
  timestamp: string;
}

/** Per-agent activity sent by pearl-swarm-dispatch through the /api/swarm bridge. */
export interface SwarmAgentActivity {
  status?: 'running' | 'done' | 'failed' | string;
  thought?: string;
  updatedAt?: string;
}

export interface TaskRecord {
  taskId: string;
  id: string;
  title: string;
  fullTitle?: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  urgency?: TaskUrgency;
  /**
   * True only when the user explicitly promoted the task via the EMERGENCY
   * override (double-tap or long-press the play button). Distinct from
   * `urgency: 'urgent'`, which is also set by routine "start now" actions.
   */
  emergency?: boolean;
  source?: string;
  createdBy?: string;
  requesterEmail?: string;
  requesterUserId?: string;
  requesterTenantId?: string;
  createdAt: string;
  updatedAt: string;
  notes?: Array<{ ts: string; text: string; kind?: string }>;
  retryCount?: number;
  result?: string | null;
  noteFilename?: string | null;
  artifactUrl?: string | null;
  fileSpacePath?: string | null;
  /** Optional swarm category label from the backend ('Legal', 'Creative', …). */
  swarmCategory?: string;
  /** Optional list of agents working on this task (for multi-agent swarms). */
  agents?: string[];
  /**
   * 'task' = CLI task (default), 'swarm' = OpenRouter swarm tracked via
   * pearl-swarm-dispatch. Used by the widget to render swarm-specific UI.
   */
  kind?: string;
  /** Live per-agent activity for swarm tasks — populated by /api/swarm/update. */
  agentActivity?: Record<string, SwarmAgentActivity>;
  // Back-compat fields consumed by the existing PolledTaskCard
  agentName?: string;
  approvalStatus: TaskApprovalStatus;
  estimatedMinutes?: number;
  agentThoughts?: AgentThought[];
  screenshotUrl?: string | null;
  workspaceMode?: WorkspaceMode;
  workspacePath?: string | null;
  githubForkUrl?: string | null;
  workspaceIsolationNotice?: string | null;
}

function authHeaders(actor?: InterfaceActorContext): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (SHARED_SECRET) {
    h['X-Bot-Secret'] = SHARED_SECRET;
    h['Authorization'] = `Bearer ${SHARED_SECRET}`;
  }
  if (actor) {
    h['X-User-Id'] = actor.userId;
    h['X-User-Email'] = actor.userEmail;
    h['X-Pearl-Tenant-Id'] = actor.tenantId;
  }
  return h;
}

function workspaceEntitlementMessage(code: string): string {
  if (code === 'personal_instance_only' || code.startsWith('staging_source_')) {
    return PERSONAL_INSTANCE_WORKSPACE_MESSAGE;
  }
  if (code === 'github_fork_requires_advanced_access') {
    return 'GitHub fork workspaces are available to advanced users. Your sandbox is still available for PearlOS customization artifacts.';
  }
  if (code.includes('workspace') || code.includes('protected')) {
    return 'That workspace is outside your allowed scope. Use your sandbox workspace, or an authorized GitHub fork workspace.';
  }
  return 'Workspace access is not available for that request.';
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const agents = value.map((agent) => String(agent).trim()).filter(Boolean);
  return agents.length ? agents : undefined;
}

function normalizeTaskCreator(value: unknown): string {
  const creator = typeof value === 'string' ? value.trim() : '';
  return VALID_TASK_CREATORS.has(creator) ? creator : 'system';
}

function looksLikeStudioCreationTask(task: unknown, title?: unknown): boolean {
  const taskText = typeof task === 'string' ? task : '';
  const titleText = typeof title === 'string' ? title : '';
  const text = `${titleText}\n${taskText}`.toLowerCase();
  if (!text.trim()) return false;
  const hasCreationVerb = /\b(build|create|make|generate|design|develop|prototype|ship)\b/.test(text);
  const hasRunnableArtifact =
    /\b(web\s*app|single[-\s]?page|html5|canvas|game|playable|interactive|experience|demo|prototype|side[-\s]?scroll(?:er|ing)|sidescroller|platformer)\b/.test(text);
  if (!hasCreationVerb || !hasRunnableArtifact) return false;

  const hasStudioIntent =
    /\bstudio\b|\bplay\s*url\b|\bplay\s*link\b|\blink\b|\bopen\s+it\b|\brunnable\b|\bplayable\b/.test(text);
  const clearlyAppOrGame =
    /\b(web\s*app|html5|canvas|game|side[-\s]?scroll(?:er|ing)|sidescroller|platformer)\b/.test(text);
  return hasStudioIntent || clearlyAppOrGame;
}

function inferStudioCreationKind(task: string, title?: string): CreationKind {
  const text = `${title || ''}\n${task}`.toLowerCase();
  return /\b(game|playable|canvas|side[-\s]?scroll(?:er|ing)|sidescroller|platformer)\b/.test(text)
    ? 'GAME'
    : 'APP';
}

function studioProjectTitle(task: string, title?: string): string {
  const raw = (title || task || 'Studio Creation').replace(/\s+/g, ' ').trim();
  return raw.length <= 64 ? raw : `${raw.slice(0, 61)}...`;
}

async function upsertStudioCreationProject(project: LaunchpadProject) {
  const projects = await readProjects();
  const withoutCurrent = projects.filter((existing) => existing.id !== project.id);
  await writeProjects([project, ...withoutCurrent]);
}

async function prepareStudioCreationWorkspace(outputPath: string): Promise<void> {
  await fs.promises.mkdir(outputPath, { recursive: true });
}

function normalizeNotes(value: unknown): TaskRecord['notes'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      if (!text) return null;
      return {
        ts: typeof record.ts === 'string' ? record.ts : '',
        text,
        kind: typeof record.kind === 'string' ? record.kind : undefined,
      };
    })
    .filter(Boolean) as TaskRecord['notes'];
}

/** Normalize a pipecat task record to the shape the interface expects. */
export function normalize(t: Record<string, unknown>): TaskRecord {
  const id = String(t.id || t.taskId || '');
  const status = (t.status as TaskStatus) || 'pending';
  const assignee = (t.assignee as string | undefined) ?? undefined;
  const rawAgents = Array.isArray(t.agents) ? (t.agents as unknown[]).map(String) : undefined;
  const swarmCategory =
    (t.swarm_category as string | undefined) ||
    (t.swarmCategory as string | undefined) ||
    (t.category as string | undefined) ||
    undefined;
  const kind = typeof t.kind === 'string' ? (t.kind as string) : undefined;
  // agent_activity (backend) → agentActivity (frontend). Snake/camel aliases
  // are accepted so the bridge and the proxy can evolve independently.
  const rawActivity =
    (t.agent_activity as Record<string, unknown> | undefined) ||
    (t.agentActivity as Record<string, unknown> | undefined) ||
    undefined;
  let agentActivity: TaskRecord['agentActivity'] = undefined;
  if (rawActivity && typeof rawActivity === 'object') {
    agentActivity = {};
    for (const [agentId, activity] of Object.entries(rawActivity)) {
      if (activity && typeof activity === 'object') {
        const a = activity as Record<string, unknown>;
        agentActivity[agentId] = {
          status: typeof a.status === 'string' ? (a.status as string) : undefined,
          thought: typeof a.thought === 'string' ? (a.thought as string) : undefined,
          updatedAt:
            typeof a.updated_at === 'string'
              ? (a.updated_at as string)
              : typeof a.updatedAt === 'string'
                ? (a.updatedAt as string)
                : undefined,
        };
      }
    }
  }
  return {
    taskId: id,
    id,
    title: (t.title as string) || (t.task as string) || id,
    fullTitle:
      (t.full_title as string | undefined) ||
      (t.fullTitle as string | undefined) ||
      (t.title as string | undefined) ||
      undefined,
    description: (t.task as string) || (t.description as string) || '',
    status,
    assignee,
    urgency: (t.urgency as TaskUrgency | undefined) ?? 'normal',
    emergency: t.emergency === true,
    source: (t.source as string | undefined) ?? undefined,
    createdBy: (t.created_by as string | undefined) ?? undefined,
    requesterEmail: (t.requester_email as string | undefined) ?? undefined,
    requesterUserId: (t.requester_user_id as string | undefined) ?? undefined,
    requesterTenantId: (t.requester_tenant_id as string | undefined) ?? undefined,
    createdAt: (t.timestamp_created as string) || (t.createdAt as string) || new Date().toISOString(),
    updatedAt: (t.timestamp_updated as string) || (t.updatedAt as string) || new Date().toISOString(),
    notes: normalizeNotes(t.notes),
    retryCount: typeof t.retry_count === 'number' ? (t.retry_count as number) : 0,
    result:
      t.result == null
        ? null
        : sanitizeTaskResultForUser(t.result, 4000),
    noteFilename:
      (t.note_filename as string | null) ??
      (t.noteFilename as string | null) ??
      null,
    artifactUrl: taskArtifactUrl(t),
    fileSpacePath: existingFileSpacePath(t),
    swarmCategory,
    agents: rawAgents,
    kind,
    agentActivity,
    agentName: assignee,
    approvalStatus: status === 'completed' ? 'pending' : 'pending',
    estimatedMinutes: 0,
    agentThoughts: [],
    screenshotUrl: null,
    workspaceMode: (t.workspace_mode as WorkspaceMode | undefined) ?? undefined,
    workspacePath: (t.workspace_path as string | null) ?? null,
    githubForkUrl: (t.github_fork_url as string | null) ?? null,
    workspaceIsolationNotice: (t.workspace_isolation_notice as string | null) ?? null,
  };
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isSafeUserId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function cleanRelativeFileSpacePath(value: string): string {
  return value
    .replace(/^\/+/, '')
    .replace(/^Documents\/?/i, '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

function existingFileSpacePath(t: Record<string, unknown>): string | null {
  const userId = cleanString(t.requester_user_id || t.requesterUserId);
  const tenantId = cleanString(t.requester_tenant_id || t.requesterTenantId);
  if (!userId || !isSafeUserId(userId)) return null;
  if (!tenantId || !isSafeUserId(tenantId) || tenantId === 'public') return null;

  const candidates = [cleanString(t.file_space_path || t.fileSpacePath)];
  const result = cleanString(t.result);
  const explicit = result.match(/\bDocuments\/([A-Za-z0-9._@+\-/ ]{1,160})/i);
  if (explicit?.[1]) candidates.push(explicit[1]);
  const fileSpaceUnder = result.match(/\bFileSpace\s+under\s+([A-Za-z0-9._@+\-/ ]{1,160})/i);
  if (fileSpaceUnder?.[1]) candidates.push(fileSpaceUnder[1]);

  for (const candidate of candidates) {
    const relative = cleanRelativeFileSpacePath(candidate);
    const safeRelative = relative || (candidate === '.' ? '.' : '');
    if (!safeRelative || safeRelative.includes('..') || safeRelative.includes('\\')) continue;
    const filesRoot = path.join(USER_ROOT_BASE, tenantId, userId, 'Documents');
    const resolved = path.resolve(filesRoot, relative);
    if (resolved !== filesRoot && !resolved.startsWith(filesRoot + path.sep)) continue;
    try {
      const filesRootReal = fs.realpathSync(filesRoot);
      const stat = fs.lstatSync(resolved);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      const realResolved = fs.realpathSync(resolved);
      if (realResolved !== filesRootReal && !realResolved.startsWith(filesRootReal + path.sep)) continue;
      return relative || '.';
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function taskTenantId(task: Record<string, unknown> | TaskRecord | null | undefined): string {
  if (!task) return '';
  return cleanString((task as any).requester_tenant_id || (task as any).requesterTenantId);
}

function taskBelongsToActor(task: Record<string, unknown> | TaskRecord | null | undefined, actor: InterfaceActorContext): boolean {
  if (!task) return false;
  // Tasks without requester identity, including miswired voice-dispatched tasks,
  // are intentionally invisible here. Voice launch must set requester email or
  // userId before task creation for the spoken user's list to include them.
  const requesterUserId = String((task as any).requester_user_id || (task as any).requesterUserId || '');
  const requesterEmail = String((task as any).requester_email || (task as any).requesterEmail || '').toLowerCase();
  const requesterTenantId = taskTenantId(task);
  const userMatches = requesterUserId === actor.userId || requesterEmail === actor.userEmail;
  return requesterTenantId === actor.tenantId && userMatches;
}

type OwnedTaskResult =
  | { ok: true; task: Record<string, unknown>; actor: InterfaceActorContext }
  | { ok: false; response: NextResponse };

async function fetchTask(taskId: string, actor: InterfaceActorContext): Promise<Record<string, unknown> | null | NextResponse> {
  const r = await fetch(`${BOT_GATEWAY}/api/tasks/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(actor),
    cache: 'no-store',
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    return NextResponse.json({ error: 'upstream_error', status: r.status, detail: txt }, { status: r.status });
  }
  const data = await r.json();
  const task = data?.task as Record<string, unknown> | undefined;
  return task || null;
}

export async function fetchOwnedTask(taskId: string, req?: NextRequest): Promise<OwnedTaskResult> {
  const actorResult = await resolveInterfaceActorContext({ request: req });
  if (!actorResult.ok) return { ok: false, response: actorResult.response };
  const fetched = await fetchTask(taskId, actorResult.actor);
  if (fetched instanceof NextResponse) return { ok: false, response: fetched };
  if (!fetched) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'task_not_found' }, { status: 404 }),
    };
  }
  if (!taskBelongsToActor(fetched, actorResult.actor)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  return { ok: true, task: fetched, actor: actorResult.actor };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId:
        url.searchParams.get('tenantId') ||
        url.searchParams.get('tenant_id') ||
        url.searchParams.get('requester_tenant_id'),
    });
    if (!actorResult.ok) {
      return actorResult.response;
    }
    const actor = actorResult.actor;
    url.searchParams.set('requester_user_id', actor.userId);
    url.searchParams.set('requester_email', actor.userEmail);
    url.searchParams.set('requester_tenant_id', actor.tenantId);
    const qs = url.searchParams.toString();
    const target = `${BOT_GATEWAY}/api/tasks${qs ? `?${qs}` : ''}`;
    const r = await fetch(target, { headers: authHeaders(), cache: 'no-store' });
    if (!r.ok) {
      return NextResponse.json({ error: 'upstream_error', status: r.status, tasks: [] }, { status: r.status });
    }
    const data = await r.json();
    const raw: Array<Record<string, unknown>> = Array.isArray(data?.tasks) ? data.tasks : [];
    const tasks = raw.filter(t => taskBelongsToActor(t, actor)).map(normalize);
    return NextResponse.json({ tasks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'proxy_failed', detail, tasks: [] }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, taskId } = body || {};
    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 });
    }

    if (action === 'create') {
      const actorResult = await resolveInterfaceActorContext({
        requestedTenantId: body?.tenantId ?? body?.tenant_id ?? body?.requester_tenant_id,
      });
      if (!actorResult.ok) return actorResult.response;
      const actor = actorResult.actor;
      const task = typeof body.task === 'string' ? body.task.trim() : '';
      if (!task) {
        return NextResponse.json({ error: 'Missing task' }, { status: 400 });
      }
      const title = typeof body.title === 'string' ? body.title.trim() : undefined;
      const explicitWorkspaceMode = body?.workspaceMode ?? body?.workspace_mode;
      const explicitWorkspacePath = body?.workspace_path;
      const shouldCreateStudioArtifact =
        !explicitWorkspaceMode &&
        !explicitWorkspacePath &&
        looksLikeStudioCreationTask(task, title);
      const studioCreation = shouldCreateStudioArtifact
        ? (() => {
            const creationId = crypto.randomUUID();
            const outputPath = creationOutputPath(creationId, {
              userId: actor.userId,
              email: actor.userEmail,
              tenantId: actor.tenantId,
            });
            const creationType = inferStudioCreationKind(task, title);
            const prompt = buildTaskPrompt({
              userPrompt: task,
              creationType,
              creationId,
              outputPath,
            });
            const now = new Date().toISOString();
            const project: LaunchpadProject = {
              id: creationId,
              title: studioProjectTitle(task, title || prompt.title),
              content: task,
              type: creationType === 'GAME' ? 'game' : 'app',
              status: 'building',
              estimatedMinutes: 15,
              swarmDurationMinutes: 15,
              sprites: [],
              createdAt: now,
              updatedAt: now,
              playUrl: `/api/creation/${creationId}/`,
              outputPath,
              creationType,
              requesterUserId: actor.userId,
              requesterTenantId: actor.tenantId,
              requesterEmail: actor.userEmail,
            };
            return { creationId, outputPath, creationType, prompt, project };
          })()
        : null;
      let workspace;
      try {
        workspace = await resolveWorkspaceForActor(actor, {
          requestedMode: explicitWorkspaceMode,
          requestedPath: studioCreation?.outputPath ?? explicitWorkspacePath,
          githubForkUrl: body?.githubForkUrl ?? body?.github_fork_url,
          taskId: body?.taskId ?? body?.id,
          purpose: 'task',
        });
      } catch (error) {
        if (error instanceof WorkspaceEntitlementError) {
          return NextResponse.json(
            {
              error: error.code,
              message: workspaceEntitlementMessage(error.code),
              workspaceIsolationNotice: PERSONAL_INSTANCE_WORKSPACE_MESSAGE,
            },
            { status: error.status },
          );
        }
        throw error;
      }
      if (studioCreation) {
        try {
          await prepareStudioCreationWorkspace(studioCreation.outputPath);
          await seedStudioFallbackArtifact({
            creationId: studioCreation.creationId,
            creationKind: studioCreation.creationType,
            outputPath: studioCreation.outputPath,
            title: studioCreation.project.title,
            userPrompt: task,
          });
          studioCreation.project.artifactSeededAt = new Date().toISOString();
        } catch (error) {
          console.error('[Tasks] Studio creation workspace preparation failed:', error);
          return NextResponse.json(
            {
              error: 'studio_creation_workspace_unavailable',
              message: 'Pearl could not prepare the playable app workspace. Try again in a minute.',
            },
            { status: 503 },
          );
        }
        await upsertStudioCreationProject(studioCreation.project).catch((error) => {
          console.error('[Tasks] Studio project pre-registration failed:', error);
        });
      }
      const dispatchTitle = title || studioCreation?.prompt.title;
      const source = 'web_chat';
      const agents = stringArray(body.agents);
      const swarmCategory =
        typeof body.swarmCategory === 'string'
          ? body.swarmCategory.trim()
          : typeof body.swarm_category === 'string'
            ? body.swarm_category.trim()
            : '';
      const kind =
        body.kind === 'swarm' || body.kind === 'task'
          ? body.kind
          : agents && agents.length > 1
            ? 'swarm'
            : undefined;
      const createResp = await fetch(`${BOT_GATEWAY}/api/tasks`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          task: studioCreation?.prompt.prompt ?? task,
          ...(dispatchTitle ? { title: dispatchTitle } : {}),
          source,
          created_by: normalizeTaskCreator(body.createdBy || body.created_by),
          requester_email: actor.userEmail,
          requester_user_id: actor.userId,
          requester_tenant_id: actor.tenantId,
          requester_tenant_role: actor.tenantRole,
          workspace_mode: workspace.mode,
          ...(workspace.workspacePath ? { workspace_path: workspace.workspacePath } : {}),
          ...(workspace.githubForkUrl ? { github_fork_url: workspace.githubForkUrl } : {}),
          ...(workspace.isolationNotice ? { workspace_isolation_notice: workspace.isolationNotice } : {}),
          staging_source_edits_enabled: workspace.canUseStagingSourceEdits,
          assignee: 'claude_cli',
          urgency: body.urgency === 'urgent' ? 'urgent' : 'normal',
          ...(typeof body.maxRetries === 'number'
            ? { max_retries: body.maxRetries }
            : typeof body.max_retries === 'number'
              ? { max_retries: body.max_retries }
              : studioCreation
                ? { max_retries: 1 }
                : {}),
          ...(typeof body.timeoutS === 'number'
            ? { timeout_s: body.timeoutS }
            : typeof body.timeout_s === 'number'
              ? { timeout_s: body.timeout_s }
              : studioCreation
                ? { timeout_s: 900 }
                : {}),
          ...(studioCreation ? { execution_mode: 'full_build' } : {}),
          ...(kind ? { kind } : {}),
          ...(agents ? { agents } : {}),
          ...(swarmCategory ? { swarm_category: swarmCategory } : {}),
        }),
      });
      if (!createResp.ok) {
        const txt = await createResp.text().catch(() => '');
        return NextResponse.json(
          { error: 'upstream_error', status: createResp.status, detail: txt },
          { status: createResp.status },
        );
      }
      const created = await createResp.json();
      const rawTask = created?.task as Record<string, unknown> | undefined;
      const createdId = String(rawTask?.id || rawTask?.taskId || '');
      return NextResponse.json({
        ok: true,
        // Execution is event-driven: the backend create event wakes the SSE
        // worker, which claims pending claude_cli tasks.
        dispatched: body.execute === true && Boolean(createdId),
        task: rawTask ? normalize(rawTask) : null,
      });
    }

    // Bulk sweep — archives every completed (and optionally cancelled) task.
    if (action === 'clear-completed') {
      const actorResult = await resolveInterfaceActorContext({
        requestedTenantId: body?.tenantId ?? body?.tenant_id ?? body?.requester_tenant_id,
      });
      if (!actorResult.ok) return actorResult.response;
      const actor = actorResult.actor;
      const includeCancelled = body.includeCancelled !== false; // default true
      const olderThanDays = typeof body.olderThanDays === 'number' ? body.olderThanDays : undefined;
      const listUrl = `${BOT_GATEWAY}/api/tasks?include_archived=true&requester_user_id=${encodeURIComponent(actor.userId)}&requester_email=${encodeURIComponent(actor.userEmail)}&requester_tenant_id=${encodeURIComponent(actor.tenantId)}`;
      const listed = await fetch(listUrl, { headers: authHeaders(), cache: 'no-store' });
      if (!listed.ok) {
        const txt = await listed.text().catch(() => '');
        return NextResponse.json({ error: 'upstream_error', status: listed.status, detail: txt }, { status: listed.status });
      }
      const listedData = await listed.json();
      const now = Date.now();
      const cutoffMs = olderThanDays !== undefined ? olderThanDays * 86400_000 : null;
      const targets = ((listedData?.tasks || []) as Record<string, unknown>[])
        .filter(t => taskBelongsToActor(t, actor))
        .filter(t => t.status === 'completed' || (includeCancelled && t.status === 'cancelled'))
        .filter(t => {
          if (cutoffMs === null) return true;
          const ref = String(t.completed_at || t.timestamp_updated || t.timestamp_created || '');
          const parsed = Date.parse(ref);
          return Number.isFinite(parsed) && now - parsed >= cutoffMs;
        });
      const archivedIds: string[] = [];
      for (const task of targets) {
        const id = String(task.id || task.taskId || '');
        if (!id) continue;
        const r = await fetch(`${BOT_GATEWAY}/api/tasks/${encodeURIComponent(id)}/archive`, {
          method: 'POST',
          headers: authHeaders(actor),
        });
        if (r.ok) archivedIds.push(id);
      }
      return NextResponse.json({
        ok: true,
        archivedCount: archivedIds.length,
        archivedIds,
      });
    }

    if (!taskId) {
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
    }
    const owned = await fetchOwnedTask(taskId, req);
    if (!owned.ok) return owned.response;
    const taskLabel =
      typeof owned.task.title === 'string' && owned.task.title.trim()
        ? owned.task.title.trim()
        : taskId;

    // Archive / restore use dedicated upstream endpoints so the backend can
    // enforce status rules (e.g. failed tasks can't be archived).
    if (action === 'archive' || action === 'restore') {
      const target = `${BOT_GATEWAY}/api/tasks/${encodeURIComponent(taskId)}/${action}`;
      const r = await fetch(target, { method: 'POST', headers: authHeaders(owned.actor) });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return NextResponse.json({ error: 'upstream_error', status: r.status, detail: txt }, { status: r.status });
      }
      const data = await r.json();
      return NextResponse.json({ ok: true, task: data?.task ? normalize(data.task) : null });
    }

    const patch: Record<string, unknown> = {};
    const ts = new Date().toISOString();
    if (action === 'update') {
      if (body.status) patch.status = body.status;
      if (body.title) patch.title = body.title;
      if (body.assignee) patch.assignee = body.assignee;
      if (body.urgency) patch.urgency = body.urgency;
      if (body.result !== undefined) patch.result = body.result;
      if (body.note) patch.note = body.note;
      if (body.noRetry === true || body.no_retry === true) patch.no_retry = true;
      if (body.suppressResultNotification === true || body.suppress_result_notification === true) {
        patch.suppress_result_notification = true;
      }
    } else if (action === 'approve') {
      patch.status = 'completed';
    } else if (action === 'reject') {
      if (owned.task.status === 'in_progress') {
        return NextResponse.json({
          ok: true,
          dispatched: true,
          alreadyRunning: true,
          task: normalize(owned.task),
        });
      }
      patch.status = 'pending';
      patch.assignee = 'claude_cli';
      patch.urgency = 'urgent';
      patch.note = body.note || 'rework requested';
    } else if (action === 'cancel') {
      patch.status = 'cancelled';
      patch.note = body.note || `cancelled from UI at ${ts}`;
    } else if (action === 'pause') {
      // Swarm PAUSE — ask the gateway to halt the running subprocess, then
      // park the task off the executable assignee so auto-execution does not
      // immediately pick it back up. START moves it back to claude_cli.
      const stopTarget = `${BOT_GATEWAY}/api/tasks/stop`;
      await fetch(stopTarget, {
        method: 'POST',
        headers: authHeaders(owned.actor),
        body: JSON.stringify({
          taskId,
          task_label: body.taskLabel ?? taskLabel,
          action: 'pause',
        }),
      }).catch(() => null);
      patch.status = 'pending';
      patch.assignee = 'pearl';
      patch.urgency = 'normal';
      patch.note = body.note || `paused from UI at ${ts}`;
    } else if (action === 'stop') {
      // STOP ends the task from the user's perspective. PAUSE is the action
      // that parks work for later without letting the auto-runner reclaim it.
      const stopTarget = `${BOT_GATEWAY}/api/tasks/stop`;
      await fetch(stopTarget, {
        method: 'POST',
        headers: authHeaders(owned.actor),
        body: JSON.stringify({
          taskId,
          task_label: body.taskLabel ?? taskLabel,
          action: 'stop',
        }),
      }).catch(() => null);
      patch.status = 'cancelled';
      patch.assignee = 'pearl';
      patch.urgency = 'normal';
      patch.note = body.note || `stopped from UI at ${ts}`;
    } else if (action === 'priority') {
      // ▲ PRIORITY — bump up in queue. Distinct from emergency which also
      // dispatches immediately; PRIORITY only changes ordering.
      patch.urgency = 'urgent';
      patch.note = body.note || `priority raised at ${ts}`;
    } else if (action === 'deprioritize') {
      // ▼ DEPRIORITY — lower in queue. Clears the emergency flag too so the
      // task drops off the priority sort.
      patch.urgency = 'normal';
      patch.emergency = false;
      patch.note = body.note || `priority lowered at ${ts}`;
    } else if (action === 'start' || action === 'emergency') {
      // PLAY button: patch metadata then kick off actual execution via the
      // SSE worker. The create/update event is the execution trigger; calling
      // the gateway /execute endpoint here would bypass the worker and can
      // double-spawn if the worker claims the same task from the stream.
      if (owned.task.status === 'in_progress') {
        return NextResponse.json({
          ok: true,
          dispatched: true,
          alreadyRunning: true,
          task: normalize(owned.task),
        });
      }
      patch.status = 'pending';
      patch.assignee = 'claude_cli';
      patch.urgency = 'urgent';
      if (action === 'emergency') {
        patch.emergency = true;
        patch.note = body.note || `EMERGENCY OVERRIDE — executing now at ${ts}`;
      } else {
        patch.note = body.note || `manual trigger — executing now at ${ts}`;
      }
      const patchTarget = `${BOT_GATEWAY}/api/tasks/${encodeURIComponent(taskId)}`;
      const patchResp = await fetch(patchTarget, {
        method: 'PATCH',
        headers: authHeaders(owned.actor),
        body: JSON.stringify(patch),
      });
      if (!patchResp.ok) {
        const txt = await patchResp.text().catch(() => '');
        return NextResponse.json(
          { error: 'upstream_error', status: patchResp.status, detail: txt },
          { status: patchResp.status },
        );
      }
      const patchData = await patchResp.json();
      return NextResponse.json({
        ok: true,
        dispatched: true,
        alreadyRunning: false,
        task: patchData?.task ? normalize(patchData.task) : null,
      });
    } else if (action === 'ask') {
      // Ask a question mid-task (like /btw). Appended as a note the agent
      // can read without interrupting the current run.
      const q = typeof body.question === 'string' ? body.question.trim() : '';
      if (!q) {
        return NextResponse.json({ error: 'Missing question' }, { status: 400 });
      }
      patch.note = `[ASK] ${q}`;
    } else if (action === 'question') {
      // User is asking Pearl about a task (not the agent doing the work).
      // The note is picked up by the task-question watcher in bot_gateway.py,
      // which generates a short reply and pushes it into the chat inbox so
      // the user sees Pearl's answer in the text chat (with an unread badge).
      const q = typeof body.question === 'string' ? body.question.trim() : '';
      if (!q) {
        return NextResponse.json({ error: 'Missing question' }, { status: 400 });
      }
      patch.note = `[QUESTION] ${q}`;
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const target = `${BOT_GATEWAY}/api/tasks/${encodeURIComponent(taskId)}`;
    const r = await fetch(target, {
      method: 'PATCH',
      headers: authHeaders(owned.actor),
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return NextResponse.json({ error: 'upstream_error', status: r.status, detail: txt }, { status: r.status });
    }
    const data = await r.json();
    return NextResponse.json({ ok: true, task: data?.task ? normalize(data.task) : null });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'proxy_failed', detail }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const taskId = url.searchParams.get('taskId') || url.searchParams.get('id');
    if (!taskId) {
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
    }
    const owned = await fetchOwnedTask(taskId, req);
    if (!owned.ok) return owned.response;
    const target = `${BOT_GATEWAY}/api/tasks/${encodeURIComponent(taskId)}`;
    const r = await fetch(target, { method: 'DELETE', headers: authHeaders(owned.actor) });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return NextResponse.json({ error: 'upstream_error', status: r.status, detail: txt }, { status: r.status });
    }
    const data = await r.json();
    return NextResponse.json({ ok: true, task: data?.task ? normalize(data.task) : null });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'proxy_failed', detail }, { status: 502 });
  }
}
