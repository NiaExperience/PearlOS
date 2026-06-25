
import { findById, remove } from '@nia/prism/core/actions/sprite-actions';
import { getTokensRedeemedByUser } from '@nia/prism/core/actions/resourceShareToken-actions';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import { ISprite } from '@nia/prism/core/blocks/sprite.block';
import { getLogger } from '@nia/prism/core/logger';
import { NextRequest, NextResponse } from 'next/server';

import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('api:summon-ai-sprite:get');

interface RouteParams {
  params: Promise<{ id: string }>;
}

function requestedTenantId(request: NextRequest): string | undefined {
  return (
    request.nextUrl?.searchParams.get('tenantId') ||
    request.nextUrl?.searchParams.get('tenant_id') ||
    undefined
  );
}

/**
 * GET /api/summon-ai-sprite/[id]
 * 
 * Returns a single sprite by ID with full data including gifData.
 * Used for the "Recall" feature to restore a previously created sprite.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId: requestedTenantId(request),
    });
    if (!actorResult.ok) return actorResult.response;

    const { id } = await params;
    const { userId, tenantId } = actorResult.actor;
    
    log.info('Fetching sprite', { spriteId: id, userId, tenantId });
    
    const sprite = await findById(id) as ISprite | null;
    
    if (!sprite) {
      return NextResponse.json({ error: 'Sprite not found' }, { status: 404 });
    }

    if (sprite.tenantId !== tenantId) {
      log.warn('Cross-tenant sprite access denied', { spriteId: id, userId, tenantId, spriteTenantId: sprite.tenantId });
      return NextResponse.json({ error: 'Sprite not found' }, { status: 404 });
    }

    // Verify ownership or shared access
    if (sprite.parent_id !== userId) {
      // Check for shared access
      const tokens = await getTokensRedeemedByUser(userId, ResourceType.Sprite);
      const hasAccess = tokens.some(t => t.resourceId === id && t.tenantId === tenantId);
      
      if (!hasAccess) {
        log.warn('Unauthorized sprite access attempt', { spriteId: id, userId, ownerId: sprite.parent_id });
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      } else {
        log.info('Shared sprite access granted', { spriteId: id, userId });
      }
    }

    log.info('Fetched sprite', { spriteId: id, name: sprite.name, tenantId });
    
    const isShared = sprite.parent_id !== userId;

    // Return full sprite data for recall
    return NextResponse.json({
      sprite: {
        _id: sprite._id,
        name: sprite.name,
        description: sprite.description,
        isShared,
        originalRequest: sprite.originalRequest,
        gifData: sprite.gifData,
        gifMimeType: sprite.gifMimeType,
        primaryPrompt: sprite.primaryPrompt,
        voiceProvider: sprite.voiceProvider,
        voiceId: sprite.voiceId,
        botConfig: sprite.botConfig ?? null,
        createdAt: sprite.createdAt,
        updatedAt: sprite.updatedAt,
      },
    });
  } catch (error) {
    log.error('Failed to fetch sprite', { error });
    return NextResponse.json(
      { error: 'Failed to fetch sprite', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/summon-ai-sprite/[id]
 *
 * Deletes a sprite owned by the authenticated user.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId: requestedTenantId(request),
    });
    if (!actorResult.ok) return actorResult.response;

    const { id } = await params;
    const { userId, tenantId } = actorResult.actor;

    log.info('Deleting sprite', { spriteId: id, userId, tenantId });

    const sprite = (await findById(id)) as ISprite | null;
    if (!sprite) {
      return NextResponse.json({ error: 'Sprite not found' }, { status: 404 });
    }

    if (sprite.tenantId !== tenantId || sprite.parent_id !== userId) {
      log.warn('Unauthorized sprite delete attempt', {
        spriteId: id,
        userId,
        tenantId,
        ownerId: sprite.parent_id,
        spriteTenantId: sprite.tenantId,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await remove(id);
    log.info('Deleted sprite', { spriteId: id, userId, tenantId });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    log.error('Failed to delete sprite', { error });
    return NextResponse.json(
      { error: 'Failed to delete sprite', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
