
import { findById, remove } from '@nia/prism/core/actions/sprite-actions';
import { getTokensRedeemedByUser } from '@nia/prism/core/actions/resourceShareToken-actions';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import { ISprite } from '@nia/prism/core/blocks/sprite.block';
import { getLogger } from '@nia/prism/core/logger';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';

const log = getLogger('api:summon-ai-sprite:get');

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/summon-ai-sprite/[id]
 * 
 * Returns a single sprite by ID with full data including gifData.
 * Used for the "Recall" feature to restore a previously created sprite.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(interfaceAuthOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const userId = session.user.id;
    
    log.info('Fetching sprite', { spriteId: id, userId });
    
    const sprite = await findById(id) as ISprite | null;
    
    if (!sprite) {
      return NextResponse.json({ error: 'Sprite not found' }, { status: 404 });
    }

    // Verify ownership or shared access
    if (sprite.parent_id !== userId) {
      // Check for shared access
      const tokens = await getTokensRedeemedByUser(userId, ResourceType.Sprite);
      const hasAccess = tokens.some(t => t.resourceId === id);
      
      if (!hasAccess) {
        log.warn('Unauthorized sprite access attempt', { spriteId: id, userId, ownerId: sprite.parent_id });
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      } else {
        log.info('Shared sprite access granted', { spriteId: id, userId });
      }
    }

    log.info('Fetched sprite', { spriteId: id, name: sprite.name });
    
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
    const session = await getServerSession(interfaceAuthOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const userId = session.user.id;

    log.info('Deleting sprite', { spriteId: id, userId });

    const sprite = (await findById(id)) as ISprite | null;
    if (!sprite) {
      return NextResponse.json({ error: 'Sprite not found' }, { status: 404 });
    }

    if (sprite.parent_id !== userId) {
      log.warn('Unauthorized sprite delete attempt', { spriteId: id, userId, ownerId: sprite.parent_id });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await remove(id);
    log.info('Deleted sprite', { spriteId: id, userId });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    log.error('Failed to delete sprite', { error });
    return NextResponse.json(
      { error: 'Failed to delete sprite', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
