import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import {
  readProjects,
  writeProjects,
  SWARM_DURATION_MIN_MINUTES,
  SWARM_DURATION_MAX_MINUTES,
  SWARM_DURATION_DEFAULT_MINUTES,
  type LaunchpadProject,
} from '../lib/store';
import { creationOutputPath, isSafeCreationId } from '../lib/creation-artifacts';

const attachedNoteSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
});

const selectedSpriteSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
});

const createProjectSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  type: z.enum(['game', 'app', 'feature', 'pearlos']),
  sourceNoteId: z.string().min(1).optional(),
  documentMode: z.enum(['build', 'document']).optional(),
  swarmDurationMinutes: z
    .number()
    .int()
    .min(SWARM_DURATION_MIN_MINUTES)
    .max(SWARM_DURATION_MAX_MINUTES)
    .optional(),
  /** Studio dispatch toggle (APP/GAME/PEARLOS). Optional — falls back to type. */
  creationType: z.enum(['APP', 'GAME', 'PEARLOS']).optional(),
  attachedNotes: z.array(attachedNoteSchema).optional(),
  selectedSprites: z.array(selectedSpriteSchema).optional(),
  /** Set on EDIT dispatches — points at an existing creation to modify in place. */
  editingCreationId: z.string().min(1).refine(isSafeCreationId, 'Invalid creation id').optional(),
  editNotes: z.string().optional(),
});

type CreateProjectInput = z.infer<typeof createProjectSchema>;

function estimateMinutes({
  content,
  type,
  swarmDurationMinutes,
}: Pick<CreateProjectInput, 'content' | 'type' | 'swarmDurationMinutes'>): number {
  if (typeof swarmDurationMinutes === 'number') {
    return Math.min(
      SWARM_DURATION_MAX_MINUTES,
      Math.max(SWARM_DURATION_MIN_MINUTES, swarmDurationMinutes)
    );
  }
  const baseFromContent = Math.ceil(Math.max(1, content.length) / 600);
  const typeBoost =
    type === 'game' ? 12 : type === 'app' ? 8 : type === 'pearlos' ? 20 : 4;
  return Math.min(SWARM_DURATION_MAX_MINUTES, Math.max(5, baseFromContent + typeBoost));
}

function deriveCreationType(
  input: CreateProjectInput
): 'APP' | 'GAME' | 'PEARLOS' | undefined {
  if (input.creationType) return input.creationType;
  if (input.type === 'app') return 'APP';
  if (input.type === 'game') return 'GAME';
  if (input.type === 'pearlos') return 'PEARLOS';
  return undefined;
}

async function requireRequesterIdentity() {
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

export async function POST(request: Request) {
  if (request.method !== 'POST') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const requesterResult = await requireRequesterIdentity();
  if (!requesterResult.ok) return requesterResult.response;
  const { requester } = requesterResult;

  let payload: CreateProjectInput;
  try {
    const body = await request.json();
    payload = createProjectSchema.parse(body);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join(', ') : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const now = new Date().toISOString();
  const swarmDurationMinutes =
    payload.swarmDurationMinutes ?? SWARM_DURATION_DEFAULT_MINUTES;
  // The project id doubles as the creationId. New artifacts are written under
  // the requester's scoped Studio creations folder and served by the slug.
  const id = crypto.randomUUID();
  const creationType = deriveCreationType(payload);
  const creationId = payload.editingCreationId ?? id;
  // A PEARLOS change is a personal feature/change tracked on the Studio ledger,
  // not a playable creation served at /api/creation/. It must not pre-stamp a
  // play button or a creations output folder — those imply a launchable artifact
  // a change item never produces.
  const isPearlOsChange = creationType === 'PEARLOS';
  const outputPath = isPearlOsChange ? undefined : creationOutputPath(creationId, requester);

  const project: LaunchpadProject = {
    id,
    title: payload.title,
    content: payload.content,
    type: payload.type,
    sourceNoteId: payload.sourceNoteId,
    documentMode: payload.documentMode ?? 'build',
    status: 'queued',
    estimatedMinutes: estimateMinutes({ ...payload, swarmDurationMinutes }),
    swarmDurationMinutes,
    sprites: (payload.selectedSprites ?? [])
      .filter((sprite) => !!sprite.imageUrl)
      .map((sprite) => ({
        id: sprite.id,
        name: sprite.name,
        imageUrl: sprite.imageUrl as string,
      })),
    createdAt: now,
    updatedAt: now,
    creationType,
    attachedNotes: payload.attachedNotes,
    selectedSprites: payload.selectedSprites,
    editingCreationId: payload.editingCreationId,
    editNotes: payload.editNotes,
    requesterUserId: requester.userId,
    requesterTenantId: requester.tenantId,
    requesterEmail: requester.email,
    // Pre-stamp the canonical play URL so the UI can render it before the
    // build finishes (playable APP/GAME creations only). The static route only
    // resolves once the agent writes the artifacts. PearlOS change items get no
    // play button — they are ledger records, not launchable creations.
    ...(isPearlOsChange ? {} : { playUrl: `/api/creation/${creationId}/`, outputPath }),
  };

  const projects = await readProjects();
  projects.unshift(project);
  await writeProjects(projects);

  return NextResponse.json({ project, estimatedMinutes: project.estimatedMinutes });
}
