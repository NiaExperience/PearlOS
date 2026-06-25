import { NextResponse } from 'next/server';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { projectBelongsToRequester, readProjects, writeProjects, type DocumentMode, type LaunchpadProject, type ProjectStatus } from '../../lib/store';
import { findCreationArtifact } from '../../lib/creation-artifacts';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function requireRequesterIdentity() {
  const actorResult = await resolveInterfaceActorContext();
  if (!actorResult.ok) return null;
  const actor = actorResult.actor;
  return { userId: actor.userId, email: actor.userEmail, tenantId: actor.tenantId };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireRequesterIdentity();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const projects = await readProjects();
    const project = projects.find((p) => p.id === id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!projectBelongsToRequester(project, user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: 'Failed to read project' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireRequesterIdentity();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const projects = await readProjects();
    const existing = projects.find((p) => p.id === id);
    if (existing && !projectBelongsToRequester(existing, user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const filtered = projects.filter((p) => p.id !== id);
    if (filtered.length === projects.length) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    await writeProjects(filtered);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const user = await requireRequesterIdentity();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const body = await request.json();
    const projects = await readProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!projectBelongsToRequester(projects[idx], user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const nextStatus = body.status !== undefined ? (body.status as ProjectStatus) : projects[idx].status;
    // When the build pipeline reports completion, stamp buildPassCompletedAt
    // so the UI knows a real build pass produced a runnable artifact.
    const stampBuildPass =
      body.status === 'complete' && !projects[idx].buildPassCompletedAt;
    const wantsComplete =
      nextStatus === 'complete' ||
      body.status === 'complete' ||
      body.buildPassCompletedAt !== undefined ||
      stampBuildPass;

    let verifiedArtifact: Awaited<ReturnType<typeof findCreationArtifact>> = null;
    if (wantsComplete) {
      const creationId =
        typeof body.editingCreationId === 'string' && body.editingCreationId.trim()
          ? body.editingCreationId.trim()
          : projects[idx].editingCreationId || projects[idx].id;
      const outputPath = projects[idx].outputPath;
      verifiedArtifact = await findCreationArtifact(creationId, outputPath, user);
      if (!verifiedArtifact) {
        return NextResponse.json(
          {
            error: 'Creation artifact not found',
            detail: 'Studio cannot mark this project complete until index.html exists in a creation output folder.',
          },
          { status: 409 },
        );
      }
    }

    const updated: LaunchpadProject = {
      ...projects[idx],
      ...(body.status !== undefined ? { status: nextStatus } : {}),
      ...(body.sprites !== undefined ? { sprites: body.sprites } : {}),
      ...(body.title !== undefined ? { title: String(body.title) } : {}),
      ...(body.content !== undefined ? { content: String(body.content) } : {}),
      ...(body.documentMode !== undefined
        ? { documentMode: body.documentMode as DocumentMode }
        : {}),
      ...(body.buildPassCompletedAt !== undefined
        ? { buildPassCompletedAt: String(body.buildPassCompletedAt) }
        : stampBuildPass
        ? { buildPassCompletedAt: new Date().toISOString() }
        : {}),
      ...(verifiedArtifact
        ? { outputPath: verifiedArtifact.outputPath, playUrl: verifiedArtifact.playUrl }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    projects[idx] = updated;
    await writeProjects(projects);
    return NextResponse.json({ project: updated });
  } catch {
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}
