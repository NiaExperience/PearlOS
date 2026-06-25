import { listByUser, getSpritesSharedWithUser } from '@nia/prism/core/actions/sprite-actions';
import { getLogger } from '@nia/prism/core/logger';
import { NextRequest, NextResponse } from 'next/server';

import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('api:summon-ai-sprite:list');

/**
 * GET /api/summon-ai-sprite/list
 * 
 * Returns all sprites owned by the authenticated user.
 * Used for the "Recall" feature to restore previously created sprites.
 */
export async function GET(request: NextRequest) {
  try {
    const requestedTenantId =
      request.nextUrl.searchParams.get('tenantId') ||
      request.nextUrl.searchParams.get('tenant_id') ||
      undefined;
    const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
    if (!actorResult.ok) return actorResult.response;

    const { userId, tenantId } = actorResult.actor;
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);
    
    log.info('Listing sprites', { userId, tenantId, limit });
    
    const result = await listByUser(userId, limit, 0, tenantId);
    const sharedSprites = await getSpritesSharedWithUser(userId, tenantId);
    
    // Combine own sprites and shared sprites
    // We deduplicate by ID just in case (e.g. user shared with themselves for testing)
    const ownItems = (result.items || []) as Record<string, unknown>[];
    const sharedItems = (sharedSprites || []) as unknown as Record<string, unknown>[];
    
    const allItemsMap = new Map<string, Record<string, unknown>>();
    
    // Add own items first
    ownItems.forEach(item => {
        if (item._id) allItemsMap.set(item._id as string, item);
    });
    
    // Add shared items (if not already present)
    sharedItems.forEach(item => {
        if (item._id && !allItemsMap.has(item._id as string)) {
            item.isShared = true; 
            allItemsMap.set(item._id as string, item);
        }
    });

    const allItems = Array.from(allItemsMap.values());
    
    // Include gifData so the gallery can display sprites
    const includeGif = request.nextUrl.searchParams.get('includeGif') === '1';
    
    const sprites = allItems.map((sprite: Record<string, unknown>) => ({
      _id: sprite._id,
      name: sprite.name,
      description: sprite.description,
      originalRequest: sprite.originalRequest,
      hasGif: !!sprite.gifData,
      isShared: !!sprite.isShared,
      // Include gifData when requested (for gallery display)
      ...(includeGif && sprite.gifData ? { gifData: sprite.gifData, gifMimeType: sprite.gifMimeType || 'image/gif' } : {}),
      // Include voice configuration for Recall feature
      voiceProvider: sprite.voiceProvider,
      voiceId: sprite.voiceId,
      voiceParameters: sprite.voiceParameters,
      createdAt: sprite.createdAt,
      updatedAt: sprite.updatedAt,
    }));

    log.info('Listed sprites', { userId, tenantId, count: sprites.length });

    return NextResponse.json({
      sprites,
      total: allItems.length,
    });
  } catch (error) {
    log.error('Failed to list sprites', { error });
    return NextResponse.json(
      { error: 'Failed to list sprites', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
