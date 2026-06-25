import { promises as fs } from 'fs';

const PROJECTS_FILE = '/tmp/pearlos-launchpad-projects.json';

export type ProjectStatus = 'queued' | 'building' | 'complete' | 'error';
export type ProjectType = 'game' | 'app' | 'feature' | 'pearlos';

/**
 * Studio dispatch creation type — uppercase variant carried on the project
 * record so the new buildTaskPrompt receives exactly what the Studio toggle
 * emitted. PEARLOS not yet wired through the prompt builder; APP and GAME
 * are the supported targets for a real build.
 */
export type CreationType = 'APP' | 'GAME' | 'PEARLOS';

export interface AttachedNoteRef {
  id: string;
  title: string;
  content: string;
}

export interface SelectedSpriteRef {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
}

export const SWARM_DURATION_MIN_MINUTES = 5;
export const SWARM_DURATION_MAX_MINUTES = 30;
export const SWARM_DURATION_DEFAULT_MINUTES = 10;

export interface ProjectSprite {
  id: string;
  name: string;
  imageUrl: string;
}

export type DocumentMode = 'build' | 'document';

export interface LaunchpadProject {
  id: string;
  title: string;
  content: string;
  type: ProjectType;
  sourceNoteId?: string;
  status: ProjectStatus;
  /**
   * Source character of the note. 'build' (default) means it's a plan to
   * build an app — the swarm is told to "Build the app it describes." A
   * 'document' note is generic content the swarm should turn into an
   * interactive presentation.
   */
  documentMode?: DocumentMode;
  estimatedMinutes: number;
  swarmDurationMinutes?: number;
  sprites: ProjectSprite[];
  createdAt: string;
  updatedAt: string;
  /**
   * Set when the build pipeline finishes a successful pass. Until this is
   * populated, the project has not produced a runnable artifact and the
   * Launch/Edit affordances stay hidden.
   */
  buildPassCompletedAt?: string;
  /**
   * Filesystem path where the build pipeline wrote this creation's static
   * artifacts. Canonical layout:
   * /srv/pearl-user-workspaces/<tenant_id>/<user_id>/creations/<creation_id>/.
   * See /workspace/user/Documents/studio-godot-hosting.md for the spec.
   */
  outputPath?: string;
  /**
   * Public URL the desktop PLAY action loads in an iframe. Pairs with
   * outputPath. Canonical shape: /api/creation/<creation_id>/.
   */
  playUrl?: string;
  /**
   * Studio toggle value (APP / GAME / PEARLOS). Carried verbatim so the
   * agency-start dispatcher can hand it to buildTaskPrompt.
   */
  creationType?: CreationType;
  /**
   * Notes the user attached on the Studio form. Surfaced into the agent
   * prompt as the "Attached notes context" block.
   */
  attachedNotes?: AttachedNoteRef[];
  /**
   * Sprites the user pulled into the project. Surfaced into the agent
   * prompt as the "Selected sprites to include" block.
   */
  selectedSprites?: SelectedSpriteRef[];
  /**
   * When set, this dispatch is an EDIT of an existing creation — the agent
   * is told to read outputPath and modify in place. The PLAY URL stays
   * /api/creation/<editingCreationId>/.
   */
  editingCreationId?: string;
  /**
   * User's free-form edit instructions; only meaningful when
   * editingCreationId is set.
   */
  editNotes?: string;
  requesterUserId?: string;
  requesterTenantId?: string;
  requesterEmail?: string;
}

export interface LaunchpadRequester {
  userId: string;
  email: string;
  tenantId: string;
}

export function projectBelongsToRequester(
  project: LaunchpadProject,
  requester: LaunchpadRequester
): boolean {
  if (!project.requesterTenantId || project.requesterTenantId !== requester.tenantId) {
    return false;
  }
  return project.requesterUserId === requester.userId || project.requesterEmail === requester.email;
}

async function readProjects(): Promise<LaunchpadProject[]> {
  try {
    await fs.access(PROJECTS_FILE);
    const raw = await fs.readFile(PROJECTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

async function writeProjects(projects: LaunchpadProject[]) {
  await fs.writeFile(PROJECTS_FILE, JSON.stringify({ projects }, null, 2), 'utf-8');
}

export { readProjects, writeProjects };
