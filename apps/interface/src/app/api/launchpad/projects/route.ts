import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { projectBelongsToRequester, readProjects, writeProjects, type LaunchpadProject } from '../lib/store';
import { creationRootsForOwner, findCreationArtifact, type CreationOwner } from '../lib/creation-artifacts';

function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase()) || 'Studio Creation';
}

async function titleFromHtml(indexPath: string, fallback: string): Promise<string> {
  try {
    const raw = await fs.readFile(indexPath, 'utf-8');
    const match = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function getRequesterIdentity(): Promise<(CreationOwner & { userId: string; email: string; tenantId: string }) | null> {
  const actorResult = await resolveInterfaceActorContext();
  if (!actorResult.ok) return null;
  const actor = actorResult.actor;
  return { userId: actor.userId, email: actor.userEmail, tenantId: actor.tenantId };
}

async function discoverCompletedCreations(existing: LaunchpadProject[], owner: CreationOwner): Promise<LaunchpadProject[]> {
  const seen = new Set(existing.map((project) => project.id));
  const restored: LaunchpadProject[] = [];

  for (const root of creationRootsForOwner(owner)) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const indexPath = path.join(root, entry.name, 'index.html');
      let stat;
      try {
        stat = await fs.stat(indexPath);
      } catch {
        continue;
      }
      const title = await titleFromHtml(indexPath, titleFromSlug(entry.name));
      const timestamp = stat.mtime.toISOString();
      seen.add(entry.name);
      restored.push({
        id: entry.name,
        title,
        content: `Restored Studio creation from ${root}/${entry.name}.`,
        type: /game|breakout|rogue/i.test(`${entry.name} ${title}`) ? 'game' : 'app',
        status: 'complete',
        estimatedMinutes: 30,
        swarmDurationMinutes: 30,
        sprites: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        buildPassCompletedAt: timestamp,
        playUrl: `/api/creation/${entry.name}/`,
        outputPath: path.join(root, entry.name) + path.sep,
        requesterUserId: owner.userId || undefined,
        requesterTenantId: owner.tenantId || undefined,
        requesterEmail: owner.email || undefined,
      });
    }
  }

  return restored;
}

async function normalizeCompletedProjects(projects: LaunchpadProject[], owner: CreationOwner): Promise<{
  projects: LaunchpadProject[];
  changed: boolean;
}> {
  let changed = false;
  const normalized: LaunchpadProject[] = [];

  for (const project of projects) {
    const creationId = project.editingCreationId || project.id;
    const artifact = await findCreationArtifact(creationId, project.outputPath, owner);
    if (artifact) {
      const next = {
        ...project,
        status: 'complete' as const,
        buildPassCompletedAt: project.buildPassCompletedAt || new Date().toISOString(),
        playUrl: artifact.playUrl,
        outputPath: artifact.outputPath,
      };
      changed ||=
        next.status !== project.status ||
        next.buildPassCompletedAt !== project.buildPassCompletedAt ||
        next.playUrl !== project.playUrl ||
        next.outputPath !== project.outputPath;
      normalized.push(next);
      continue;
    }

    if (project.status !== 'complete' && !project.buildPassCompletedAt) {
      normalized.push(project);
      continue;
    }

    changed = true;
    normalized.push({
      ...project,
      status: 'error',
      buildPassCompletedAt: undefined,
      playUrl: undefined,
      outputPath: undefined,
      updatedAt: new Date().toISOString(),
    });
  }

  return { projects: normalized, changed };
}

export async function GET() {
  try {
    const requester = await getRequesterIdentity();
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const allProjects = await readProjects();
    const projects = allProjects.filter((project) => projectBelongsToRequester(project, requester));
    const restored = await discoverCompletedCreations(projects, requester);
    const merged = restored.length ? [...restored, ...projects] : projects;
    const normalized = await normalizeCompletedProjects(merged, requester);
    if (restored.length || normalized.changed) {
      const visibleIds = new Set(projects.map((project) => project.id));
      const untouched = allProjects.filter((project) => !visibleIds.has(project.id));
      await writeProjects([...normalized.projects, ...untouched]).catch(() => {});
    }
    return NextResponse.json({ projects: normalized.projects });
  } catch {
    return NextResponse.json({ error: 'Failed to read projects' }, { status: 500 });
  }
}
