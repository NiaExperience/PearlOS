/**
 * Agency Coordinator — Kitchen Workflow
 *
 * Breaks a Launchpad project into agent tasks and coordinates
 * the mock build pipeline. Like a head chef dispatching tickets.
 */

import { runMockBuildPipeline, type BuildPhase } from './mock-build-pipeline';

export type AgentRole = 'codex' | 'opus' | 'gemma' | 'qwen' | 'claude-code';

export type AgencyProjectType = 'game' | 'app' | 'feature' | 'pearlos';

export const SWARM_DURATION_MIN_MINUTES = 5;
export const SWARM_DURATION_MAX_MINUTES = 30;
export const SWARM_DURATION_DEFAULT_MINUTES = 10;

export interface AgencyTask {
  taskId: string;
  title: string;
  description: string;
  agentName: string;
  agentRole: AgentRole;
  estimatedMinutes: number;
  phase: BuildPhase;
  dependencies: string[]; // taskIds that must complete first
}

export interface AgencyProject {
  projectId: string;
  title: string;
  type: AgencyProjectType;
  content: string;
  tasks: AgencyTask[];
  status: 'queued' | 'building' | 'complete' | 'error';
  createdAt: number;
  swarmDurationMinutes?: number;
}

export interface AgencyStartOverrides {
  agents?: string[];
  swarmCategory?: string;
  agencyRoomSummary?: string;
  executionMode?: 'fast_draft' | 'full_build';
  agencyStartPayload?: Record<string, unknown>;
}

const AGENT_CONFIG: Record<AgentRole, { name: string; colorVariant: 'code' | 'design' | 'art' | 'qa' }> = {
  'codex': { name: 'Codex', colorVariant: 'code' },
  'opus': { name: 'Claude Opus 4.6', colorVariant: 'design' },
  'gemma': { name: 'Gemma', colorVariant: 'art' },
  'qwen': { name: 'Qwen', colorVariant: 'qa' },
  'claude-code': { name: 'Claude Code', colorVariant: 'code' },
};

function clampDuration(durationMinutes?: number): number {
  if (typeof durationMinutes !== 'number' || Number.isNaN(durationMinutes)) {
    return SWARM_DURATION_DEFAULT_MINUTES;
  }
  return Math.min(
    SWARM_DURATION_MAX_MINUTES,
    Math.max(SWARM_DURATION_MIN_MINUTES, Math.round(durationMinutes))
  );
}

/**
 * Scale a baseline task duration by the user-requested total swarm budget.
 * Baseline plans add up to roughly 30 minutes; we stretch (or compress)
 * each task proportionally so the wall-clock budget matches what the
 * user picked on the slider.
 */
function scaleTaskMinutes(baseMinutes: number, durationMinutes?: number): number {
  const total = clampDuration(durationMinutes);
  const factor = total / SWARM_DURATION_DEFAULT_MINUTES;
  return Math.max(1, Math.round(baseMinutes * factor));
}

/** Break a project into agency tasks based on type and total swarm budget */
export function planAgencyTasks(
  projectId: string,
  title: string,
  type: AgencyProjectType,
  swarmDurationMinutes?: number
): AgencyTask[] {
  const baseId = (role: string, idx: number) => `${projectId}-${role}-${idx}`;
  const scale = (m: number) => scaleTaskMinutes(m, swarmDurationMinutes);

  // Common tasks for all project types
  const commonTasks: AgencyTask[] = [
    {
      taskId: baseId('opus', 0),
      title: 'Architecture & Design',
      description: `Claude Opus 4.6 is sketching the overall structure for "${title}". Defining components, data flow, and user interactions.`,
      agentName: AGENT_CONFIG.opus.name,
      agentRole: 'opus',
      estimatedMinutes: scale(type === 'game' ? 8 : type === 'pearlos' ? 10 : 5),
      phase: 'design',
      dependencies: [],
    },
    {
      taskId: baseId('codex', 0),
      title: 'Core Implementation',
      description: `Codex is building the main logic and wiring everything together for "${title}". Writing the heavy-lifting code.`,
      agentName: AGENT_CONFIG.codex.name,
      agentRole: 'codex',
      estimatedMinutes: scale(type === 'game' ? 15 : type === 'pearlos' ? 14 : 10),
      phase: 'build',
      dependencies: [baseId('opus', 0)],
    },
  ];

  if (type === 'game') {
    return [
      ...commonTasks,
      {
        taskId: baseId('gemma', 0),
        title: 'Sprite & Asset Pipeline',
        description: `Gemma is generating pixel-art sprites, animations, and visual assets for "${title}". Making it look alive.`,
        agentName: AGENT_CONFIG.gemma.name,
        agentRole: 'gemma',
        estimatedMinutes: scale(12),
        phase: 'build',
        dependencies: [baseId('opus', 0)],
      },
      {
        taskId: baseId('codex', 1),
        title: 'Game Mechanics & Physics',
        description: `Codex is implementing collision detection, scoring, and the roguelike progression system for "${title}".`,
        agentName: AGENT_CONFIG.codex.name,
        agentRole: 'codex',
        estimatedMinutes: scale(10),
        phase: 'build',
        dependencies: [baseId('codex', 0)],
      },
      {
        taskId: baseId('qwen', 0),
        title: 'QA & Polish',
        description: `Qwen is running playtests, fixing edge cases, and adding juice — screen shake, particle effects, and sound hooks for "${title}".`,
        agentName: AGENT_CONFIG.qwen.name,
        agentRole: 'qwen',
        estimatedMinutes: scale(6),
        phase: 'test',
        dependencies: [baseId('codex', 1), baseId('gemma', 0)],
      },
    ];
  }

  if (type === 'app') {
    return [
      ...commonTasks,
      {
        taskId: baseId('gemma', 0),
        title: 'UI Component Library',
        description: `Gemma is crafting reusable UI components, icons, and theme tokens for "${title}". Consistency is key.`,
        agentName: AGENT_CONFIG.gemma.name,
        agentRole: 'gemma',
        estimatedMinutes: scale(8),
        phase: 'build',
        dependencies: [baseId('opus', 0)],
      },
      {
        taskId: baseId('qwen', 0),
        title: 'Integration Testing',
        description: `Qwen is writing end-to-end tests and verifying all user flows in "${title}" work smoothly across devices.`,
        agentName: AGENT_CONFIG.qwen.name,
        agentRole: 'qwen',
        estimatedMinutes: scale(5),
        phase: 'test',
        dependencies: [baseId('codex', 0), baseId('gemma', 0)],
      },
    ];
  }

  if (type === 'pearlos') {
    return [
      ...commonTasks,
      {
        taskId: baseId('claude-code', 0),
        title: 'PearlOS Module Wiring',
        description: `Claude Code is integrating "${title}" into the PearlOS shell — desktop icon, window registration, and Pearl persona hooks.`,
        agentName: AGENT_CONFIG['claude-code'].name,
        agentRole: 'claude-code',
        estimatedMinutes: scale(8),
        phase: 'build',
        dependencies: [baseId('codex', 0)],
      },
      {
        taskId: baseId('gemma', 0),
        title: 'PearlOS Theming & Icons',
        description: `Gemma is crafting on-brand PearlOS visuals for "${title}" — desktop icon, window chrome, accent colors that match the OS palette.`,
        agentName: AGENT_CONFIG.gemma.name,
        agentRole: 'gemma',
        estimatedMinutes: scale(6),
        phase: 'build',
        dependencies: [baseId('opus', 0)],
      },
      {
        taskId: baseId('qwen', 0),
        title: 'PearlOS QA & Smoke Tests',
        description: `Qwen is verifying "${title}" launches cleanly from the desktop, plays nicely with Pearl, and doesn't break the OS shell.`,
        agentName: AGENT_CONFIG.qwen.name,
        agentRole: 'qwen',
        estimatedMinutes: scale(5),
        phase: 'test',
        dependencies: [baseId('claude-code', 0), baseId('gemma', 0)],
      },
    ];
  }

  // feature
  return [
    ...commonTasks,
    {
      taskId: baseId('qwen', 0),
      title: 'Review & Integration',
      description: `Qwen is reviewing the feature, checking for regressions, and merging "${title}" into the main branch.`,
      agentName: AGENT_CONFIG.qwen.name,
      agentRole: 'qwen',
      estimatedMinutes: scale(4),
      phase: 'test',
      dependencies: [baseId('codex', 0)],
    },
  ];
}

/** PATCH the stored project status in /tmp/pearlos-launchpad-projects.json */
async function patchProjectStatus(
  projectId: string,
  status: 'queued' | 'building' | 'complete' | 'error'
): Promise<void> {
  const response = await fetch(`/api/launchpad/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `Project status update failed (${response.status})`);
  }
}

/** Start the agency build for a project */
export async function startAgencyBuild(
  project: AgencyProject,
  startOverrides: AgencyStartOverrides = {}
): Promise<void> {
  // Enqueue exactly one real build task for this project. The staged task list
  // remains a local progress visualization; creating one queue record per
  // visual phase made simple Studio builds fan out into several worker jobs.
  const isFastDraft = (startOverrides.executionMode || 'fast_draft') === 'fast_draft';

  const dispatchPromise = fetch('/api/launchpad/agency-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: project.projectId,
      agents: startOverrides.agents,
      swarmCategory: startOverrides.swarmCategory,
      agencyRoomSummary: startOverrides.agencyRoomSummary,
      execution_mode: startOverrides.executionMode || 'fast_draft',
      ...(startOverrides.agencyStartPayload || {}),
    }),
  })
    .then((res) => res.json())
    .catch(() => ({ ok: false }));

  // Dispatch pipeline status event
  window.dispatchEvent(
    new CustomEvent('nia.pipeline.status', {
      detail: {
        id: project.projectId,
        title: project.title,
        status: 'running',
        type: project.type,
        updatedAt: Date.now(),
      },
    })
  );

  // Run the visual build pipeline in parallel with real task polling.
  // The visual pipeline is a local progress animation; actual completion
  // is determined by the real task status from the gateway.
  const mockPromise = runMockBuildPipeline(project, async () => {}).catch(() => {});

  // Poll the real task until it completes or fails, then update project status.
  const dispatchResult = await dispatchPromise;
  const taskId: string | undefined = dispatchResult?.dispatched?.taskId;
  const maxPollMs = isFastDraft ? 150_000 : 630_000; // timeout_s + 30s buffer
  const pollMs = 3_000;

  if (taskId) {
    const startedAt = Date.now();
    const poll = async () => {
      while (Date.now() - startedAt < maxPollMs) {
        try {
          const res = await fetch(`/api/tasks/${taskId}`);
          if (!res.ok) break;
          const data = await res.json();
          const status: string | undefined = data?.task?.status ?? data?.status;
          if (status === 'completed') {
            await patchProjectStatus(project.projectId, 'complete');
            window.dispatchEvent(
              new CustomEvent('nia.pipeline.status', {
                detail: {
                  id: project.projectId,
                  title: project.title,
                  status: 'completed',
                  type: project.type,
                  updatedAt: Date.now(),
                },
              })
            );
            return;
          }
          if (status === 'failed') {
            await patchProjectStatus(project.projectId, 'error');
            window.dispatchEvent(
              new CustomEvent('nia.pipeline.status', {
                detail: {
                  id: project.projectId,
                  title: project.title,
                  status: 'failed',
                  type: project.type,
                  updatedAt: Date.now(),
                },
              })
            );
            return;
          }
        } catch {
          // Gateway blip — keep polling
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      // Timed out waiting for completion
      await patchProjectStatus(project.projectId, 'error');
      window.dispatchEvent(
        new CustomEvent('nia.pipeline.status', {
          detail: {
            id: project.projectId,
            title: project.title,
            status: 'failed',
            type: project.type,
            updatedAt: Date.now(),
          },
        })
      );
    };
    poll(); // fire-and-forget — don't block the mock pipeline
  }

  // Ensure the mock pipeline completes and catch any errors
  try {
    await mockPromise;
  } catch {
    // Non-fatal; real status is tracked via the poll above
  }
}
