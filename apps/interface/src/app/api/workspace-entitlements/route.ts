import { NextResponse } from 'next/server';

import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { workspaceEntitlementsForActor } from '@interface/lib/workspace-entitlements';

// Read-only entitlement lookup. PearlOS tasks always resolve to the requester's
// personal/sandbox workspace, so there is no user-facing endpoint to grant or
// toggle staging-source access. Core PearlOS integration is a separate,
// out-of-band operator process and is intentionally not reachable from here.
export async function GET() {
  const actorResult = await resolveInterfaceActorContext({ allowPersonalWorkspaceFallback: true });
  if (!actorResult.ok) return actorResult.response;

  const entitlements = await workspaceEntitlementsForActor(actorResult.actor);
  return NextResponse.json(entitlements, { headers: { 'Cache-Control': 'no-store' } });
}
