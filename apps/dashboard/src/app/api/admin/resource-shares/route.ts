/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

import { Prism } from '@nia/prism';
import { requireAuth } from '@nia/prism/core/auth';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { BlockType_ResourceShareToken, IResourceShareToken } from '@nia/prism/core/blocks/resourceShareToken.block';
import { BlockType_User } from '@nia/prism/core/blocks/user.block';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, dashboardAuthOptions);
  if (authError) return authError as NextResponse;

  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prism = await Prism.getInstance();
    const url = new URL(req.url);
    const typeFilter = url.searchParams.get('type');

    const query: any = {
      contentType: BlockType_ResourceShareToken,
      tenantId: 'any',
      orderBy: { createdAt: 'desc' as const },
      limit: 100
    };

    if (typeFilter) {
      query.filters = [
        { field: 'resourceType', operator: 'eq', value: typeFilter }
      ];
    }

    const result = await prism.query(query);
    const tokens = result.items as IResourceShareToken[];

    const { userIds, htmlGenIds, noteIds } = collectIds(tokens);
    const usersMap = await fetchUsers(prism, userIds);
    const resourcesMap = await fetchResources(prism, htmlGenIds, noteIds);

    const enrichedTokens = tokens.map(t => {
      const creator = usersMap.get(t.createdBy);
      const resource = resourcesMap.get(t.resourceId);
      const redeemers = (t.redeemedBy || []).map(uid => {
        const u = usersMap.get(uid);
        return u ? (u.name || u.email || uid) : uid;
      });

      return {
        ...t,
        creatorName: creator ? (creator.name || creator.email || t.createdBy) : t.createdBy,
        resourceName: resource ? (resource.title || resource.topic || t.resourceId) : t.resourceId,
        redeemerNames: redeemers
      };
    });
    console.log('Enriched Tokens:', enrichedTokens);

    return NextResponse.json({ success: true, tokens: enrichedTokens });
  } catch (error) {
    console.error('Error fetching resource shares:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

function collectIds(tokens: IResourceShareToken[]) {
  const userIds = new Set<string>();
  const htmlGenIds = new Set<string>();
  const noteIds = new Set<string>();

  tokens.forEach(t => {
    userIds.add(t.createdBy);
    if (t.redeemedBy) t.redeemedBy.forEach(u => userIds.add(u));
    
    if (t.resourceType === 'HtmlGeneration') htmlGenIds.add(t.resourceId);
    if (t.resourceType === 'Notes') noteIds.add(t.resourceId);
  });

  return { userIds, htmlGenIds, noteIds };
}

async function fetchUsers(prism: any, userIds: Set<string>) {
  const usersMap = new Map<string, any>();
  if (userIds.size > 0) {
    const users = await prism.query({
      contentType: BlockType_User,
      tenantId: 'any',
      where: { page_id: { in: Array.from(userIds) } },
      limit: userIds.size
    } as any);
    users.items.forEach((u: any) => usersMap.set(u._id, u));
  }
  return usersMap;
}

async function fetchResources(prism: any, htmlGenIds: Set<string>, noteIds: Set<string>) {
  const resourcesMap = new Map<string, any>();
  
  if (htmlGenIds.size > 0) {
    const htmlGens = await prism.query({
      contentType: 'HtmlGeneration',
      tenantId: 'any',
      where: { page_id: { in: Array.from(htmlGenIds) } },
      limit: htmlGenIds.size
    } as any);
    htmlGens.items.forEach((r: any) => resourcesMap.set(r._id, r));
  }
  
  if (noteIds.size > 0) {
    const notes = await prism.query({
      contentType: 'Notes',
      tenantId: 'any',
      where: { page_id: { in: Array.from(noteIds) } },
      limit: noteIds.size
    } as any);
    notes.items.forEach((r: any) => resourcesMap.set(r._id, r));
  }
  
  return resourcesMap;
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, dashboardAuthOptions);
  if (authError) return authError as NextResponse;

  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { tokenId, hardDelete } = body;

    if (!tokenId) {
      return NextResponse.json({ error: 'Token ID required' }, { status: 400 });
    }

    const prism = await Prism.getInstance();
    
    if (hardDelete) {
      await prism.delete(BlockType_ResourceShareToken, tokenId, session.user.id);
    } else {
      // Deactivate token
      await prism.update(BlockType_ResourceShareToken, tokenId, { isActive: false }, session.user.id);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error revoking token:', error);
    return NextResponse.json({ error: 'Failed to revoke token' }, { status: 500 });
  }
}
