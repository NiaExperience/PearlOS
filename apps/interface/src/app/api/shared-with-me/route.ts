export const dynamic = 'force-dynamic';

import { getUserSharedResources } from '@nia/prism/core/actions/organization-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';
import { requireAuth } from '@nia/prism/core/auth';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import { NextRequest, NextResponse } from 'next/server';

import { findHtmlContentsByIds } from '@interface/features/HtmlGeneration/actions/html-generation-actions';
import { findNoteById } from '@interface/features/Notes';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('[api_shared_with_me]');

type SharedResource = Awaited<ReturnType<typeof getUserSharedResources>>[number];

async function ownerName(ownerId: string | undefined): Promise<string | undefined> {
  if (!ownerId) return undefined;
  try {
    const owner = await getUserById(ownerId);
    return owner?.name || owner?.email || ownerId;
  } catch {
    return ownerId;
  }
}

async function noteItems(resources: SharedResource[], tenantId: string) {
  const scopedResources = resources.filter((resource) => (resource.organization?.tenantId || tenantId) === tenantId);
  const items = await Promise.all(
    scopedResources.map(async (resource) => {
      const note = await findNoteById(resource.resourceId, tenantId).catch(() => null);
      if (!note) return null;
      const owner = await ownerName(resource.organization?.settings?.resourceOwnerUserId as string | undefined);
      return {
        resourceId: resource.resourceId,
        resourceType: ResourceType.Notes,
        title: note.title || 'Untitled Note',
        role: resource.role,
        ownerName: owner,
        organizationId: resource.organization?._id,
        sharedToAllReadOnly: Boolean(resource.organization?.sharedToAllReadOnly),
        href: `/notes?noteId=${encodeURIComponent(resource.resourceId)}`,
        updatedAt: (note as any).updatedAt || (note as any).timestamp,
      };
    })
  );
  return items.filter(Boolean);
}

async function appItems(resources: SharedResource[], tenantId: string) {
  const resourcesByTenant = new Map<string, SharedResource[]>();
  for (const resource of resources) {
    const sourceTenantId = resource.organization?.tenantId || tenantId;
    if (sourceTenantId !== tenantId) continue;
    if (!resourcesByTenant.has(sourceTenantId)) resourcesByTenant.set(sourceTenantId, []);
    resourcesByTenant.get(sourceTenantId)!.push(resource);
  }

  const items = [];
  for (const [sourceTenantId, tenantResources] of resourcesByTenant.entries()) {
    const ids = tenantResources.map((resource) => resource.resourceId);
    const applets = await findHtmlContentsByIds(ids, sourceTenantId).catch((error) => {
      log.error('Failed to fetch shared applets', { error, sourceTenantId });
      return [];
    });
    const appletMap = new Map(applets.map((item: any) => [(item as any)._id || (item as any).page_id, item]));

    for (const resource of tenantResources) {
      const applet = appletMap.get(resource.resourceId);
      if (!applet) continue;
      const owner = await ownerName(resource.organization?.settings?.resourceOwnerUserId as string | undefined);
      items.push({
        resourceId: resource.resourceId,
        resourceType: ResourceType.Apps,
        title: (applet as any).title || 'Untitled App',
        role: resource.role,
        ownerName: owner,
        organizationId: resource.organization?._id,
        sharedToAllReadOnly: Boolean(resource.organization?.sharedToAllReadOnly),
        href: `?resourceId=${encodeURIComponent(resource.resourceId)}&contentType=HtmlGeneration&source=shared-with-me`,
        updatedAt: (applet as any).updatedAt || (applet as any).createdAt,
      });
    }
  }
  return items;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  const url = new URL(req.url);
  const requestedTenantId = url.searchParams.get('tenantId') || undefined;

  const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
  if (!actorResult.ok) return actorResult.response;
  const { tenantId, userId } = actorResult.actor;

  try {
    const [notes, htmlApps, apps] = await Promise.all([
      getUserSharedResources(userId, tenantId, ResourceType.Notes),
      getUserSharedResources(userId, tenantId, ResourceType.HtmlGeneration),
      getUserSharedResources(userId, tenantId, ResourceType.Apps),
    ]);

    const mergedApps = [...htmlApps, ...apps].filter((resource, index, all) =>
      all.findIndex((candidate) => candidate.resourceId === resource.resourceId) === index
    );

    const [noteRows, appRows] = await Promise.all([
      noteItems(notes, tenantId),
      appItems(mergedApps, tenantId),
    ]);

    return NextResponse.json({
      success: true,
      items: [...noteRows, ...appRows].sort((a: any, b: any) => {
        const left = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const right = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return right - left;
      }),
    });
  } catch (error) {
    log.error('Failed to load shared resources', { error, tenantId });
    return NextResponse.json({ error: 'Failed to load shared resources' }, { status: 500 });
  }
}
