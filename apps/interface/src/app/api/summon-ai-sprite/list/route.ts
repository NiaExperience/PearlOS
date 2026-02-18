import { listByUser, getSpritesSharedWithUser } from '@nia/prism/core/actions/sprite-actions';
import { getLogger } from '@nia/prism/core/logger';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';


const log = getLogger('api:summon-ai-sprite:list');

/**
 * GET /api/summon-ai-sprite/list
 * 
 * Returns all sprites owned by the authenticated user.
 * Used for the "Recall" feature to restore previously created sprites.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(interfaceAuthOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);
    
    log.info('Listing sprites', { userId, limit });
    
    const result = await listByUser(userId, limit);
    const sharedSprites = await getSpritesSharedWithUser(userId);
    
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
    
    // Return simplified sprite data (exclude large gifData for list view)
    const sprites = allItems.map((sprite: Record<string, unknown>) => ({
      _id: sprite._id,
      name: sprite.name,
      description: sprite.description,
      originalRequest: sprite.originalRequest,
      // Include a flag if gifData exists, but not the actual data
      hasGif: !!sprite.gifData,
      isShared: !!sprite.isShared,
      // Include voice configuration for Recall feature
      voiceProvider: sprite.voiceProvider,
      voiceId: sprite.voiceId,
      voiceParameters: sprite.voiceParameters,
      createdAt: sprite.createdAt,
      updatedAt: sprite.updatedAt,
    }));

    log.info('Listed sprites', { userId, count: sprites.length });

    return NextResponse.json({
      sprites,
      total: result.total,
    });
  } catch (error) {
    log.error('Failed to list sprites', { error });
    return NextResponse.json(
      { error: 'Failed to list sprites', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
