/**
 * Mock Build Pipeline — Simulates agency swarm work
 *
 * Progresses tasks through statuses with agent thought snippets,
 * respecting task dependencies. Like watching a kitchen brigade
 * work through their tickets.
 */

import type { AgencyProject, AgencyTask } from './agency-coordinator';

export type BuildPhase = 'design' | 'build' | 'test' | 'deploy';

export type TaskStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface PipelineUpdate {
  taskId: string;
  status: TaskStatus;
  thought: string;
}

/** Simulated agent thoughts during each phase */
const THOUGHT_SEQUENCES: Record<string, string[]> = {
  'Architecture & Design': [
    "Hmm, the core loop needs to feel tight. Let me map the player state machine first.",
    "Decided on a component-based architecture. Each enemy type will be a composition of behaviors.",
    "Sketching the HUD layout — keeping it minimal, 80s arcade style with a roguelike twist.",
    "Design doc is solid. Handing off to the build team.",
  ],
  'Core Implementation': [
    "Setting up the project scaffold and entry point.",
    "Player movement and shooting feel responsive now. Working on enemy spawning logic.",
    "Refactoring the collision system — quadtree for performance with lots of bullets.",
    "Hooking up the state transitions. Almost there.",
  ],
  'Sprite & Asset Pipeline': [
    "Generating the player ship sprite — thinking sleek retro fighter with glowing thrusters.",
    "Enemy variants looking good. Adding death explosion frames.",
    "Background parallax layers are rendering nicely. Dark space with nebula tones.",
    "Asset atlas packed and optimized. All sprites under budget.",
  ],
  'Game Mechanics & Physics': [
    "Bullets collide, enemies die, score increments. Basic loop is closed.",
    "Adding the roguelike upgrade system — three choices between waves.",
    "Tweaking difficulty curve. First wave should be forgiving, tenth wave brutal.",
    "Power-up drops are balanced. Time for polish.",
  ],
  'QA & Polish': [
    "Found a bug: player can clip through the right boundary. Fixing.",
    "Added screen shake on heavy hits. Feels so much better.",
    "Particle effects for explosions are gorgeous. Performance holding steady at 60fps.",
    "All tests green. This is ready to ship.",
  ],
  'UI Component Library': [
    "Defining the design tokens — colors, spacing, typography scale.",
    "Button and input components are accessible and responsive.",
    "Form validation patterns looking clean. Error states are helpful, not scary.",
    "Component library is documented and exported. Build team can import freely.",
  ],
  'Integration Testing': [
    "Writing Playwright tests for the critical user journeys.",
    "Catching a hydration mismatch in the auth flow. Fixing server-side props.",
    "Mobile viewport tests passing. Touch interactions feel natural.",
    "Coverage at 87%. Good enough for this release.",
  ],
  'Review & Integration': [
    "Reviewing the diff. Clean separation of concerns, no console logs left behind.",
    "Running the full test suite. One flaky test — rerunning.",
    "Feature flag is in place. Can roll back instantly if needed.",
    "Merged to main. Deploy pipeline is green.",
  ],
};

function getThoughtsForTask(task: AgencyTask): string[] {
  return THOUGHT_SEQUENCES[task.title] || [
    `${task.agentName} is reviewing the requirements...`,
    `${task.agentName} is implementing the core logic...`,
    `${task.agentName} is testing edge cases...`,
    `${task.agentName} is wrapping up...`,
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the mock build pipeline for a project.
 * Tasks respect dependencies. Each task runs through thoughts with simulated delays.
 */
export async function runMockBuildPipeline(
  project: AgencyProject,
  onUpdate: (taskId: string, status: TaskStatus, thought: string | null) => Promise<void>
): Promise<void> {
  const completedTasks = new Set<string>();
  const runningTasks = new Set<string>();

  // Build a dependency graph
  const pending = new Set(project.tasks.map((t) => t.taskId));

  while (pending.size > 0 || runningTasks.size > 0) {
    // Start any tasks whose dependencies are satisfied
    for (const task of project.tasks) {
      if (
        pending.has(task.taskId) &&
        !runningTasks.has(task.taskId) &&
        task.dependencies.every((dep) => completedTasks.has(dep))
      ) {
        runningTasks.add(task.taskId);
        pending.delete(task.taskId);
        // Kick off the task asynchronously
        runTask(task, onUpdate, completedTasks, runningTasks);
      }
    }

    // Wait a bit before checking again
    await sleep(800);
  }

  // The real task worker owns final completion. This pipeline is only a live
  // visual preview and must not advertise a runnable artifact by itself.
}

async function runTask(
  task: AgencyTask,
  onUpdate: (taskId: string, status: TaskStatus, thought: string | null) => Promise<void>,
  completedTasks: Set<string>,
  runningTasks: Set<string>
): Promise<void> {
  const thoughts = getThoughtsForTask(task);
  const totalDelay = task.estimatedMinutes * 300; // 300ms per simulated minute (fast for demo)
  const stepDelay = Math.max(600, Math.floor(totalDelay / thoughts.length));

  // Mark as running
  await onUpdate(task.taskId, 'running', thoughts[0]);

  for (let i = 1; i < thoughts.length; i++) {
    await sleep(stepDelay);
    const isLast = i === thoughts.length - 1;
    await onUpdate(task.taskId, isLast ? 'complete' : 'running', thoughts[i]);
  }

  // Ensure we always end on complete even if no thoughts
  if (thoughts.length <= 1) {
    await sleep(Math.max(1000, totalDelay));
    await onUpdate(task.taskId, 'complete', `${task.agentName} finished ${task.title}.`);
  }

  runningTasks.delete(task.taskId);
  completedTasks.add(task.taskId);
}
