import { NextResponse } from 'next/server';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { projectBelongsToRequester, readProjects } from '../../../lib/store';
import {
  buildSharedFeatureFromLaunchpadProject,
  readSharedFeatures,
  sharedFeatureToPublic,
  upsertSharedFeature,
  writeSharedFeatures,
} from '@interface/lib/shared-features-store';
import { decorateFeature, normalizeFeatureVotes } from '@interface/lib/our-pearlos-catalog';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function requireRequesterIdentity() {
  const actorResult = await resolveInterfaceActorContext();
  if (!actorResult.ok) return null;
  const actor = actorResult.actor;
  return { userId: actor.userId, email: actor.userEmail, tenantId: actor.tenantId };
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const requester = await requireRequesterIdentity();
    if (!requester) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const category = typeof body.category === 'string' ? body.category : undefined;

    const projects = await readProjects();
    const project = projects.find((entry) => entry.id === id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!projectBelongsToRequester(project, requester)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (project.status !== 'complete' || !project.buildPassCompletedAt || !project.playUrl) {
      return NextResponse.json({ error: 'Project is not ready to share' }, { status: 409 });
    }

    const now = Date.now();
    const owner = { userId: requester.userId || requester.email, tenantId: requester.tenantId };
    const record = buildSharedFeatureFromLaunchpadProject(project, owner, now, category);
    if (!record) return NextResponse.json({ error: 'Project is not shareable' }, { status: 409 });

    const currentShared = await readSharedFeatures();
    const upserted = upsertSharedFeature(currentShared, record, now);
    if (!upserted) return NextResponse.json({ error: 'share_conflict' }, { status: 409 });
    await writeSharedFeatures(upserted.features);

    const publicFeature = sharedFeatureToPublic(upserted.feature);
    return NextResponse.json({
      ok: true,
      feature: decorateFeature(publicFeature, normalizeFeatureVotes({}, [publicFeature.id])),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to share project' }, { status: 500 });
  }
}
