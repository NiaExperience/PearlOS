import { findById, update } from '@nia/prism/core/actions/sprite-actions';
import { SpriteBotConfigSchema } from '@nia/prism/core/blocks/sprite.block';
import type { ISprite } from '@nia/prism/core/blocks/sprite.block';
import { getLogger } from '@nia/prism/core/logger';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';

const log = getLogger('api:summon-ai-sprite:bot-config');

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/summon-ai-sprite/[id]/bot-config
 *
 * Save or update the bot configuration for a sprite.
 * Only the sprite owner can modify bot config.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(interfaceAuthOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const userId = session.user.id;
    const body = await request.json();

    log.info('Updating bot config', { spriteId: id, userId });

    const sprite = (await findById(id)) as ISprite | null;
    if (!sprite) {
      return NextResponse.json({ error: 'Sprite not found' }, { status: 404 });
    }

    if (sprite.parent_id !== userId) {
      log.warn('Unauthorized bot config update', { spriteId: id, userId, ownerId: sprite.parent_id });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Validate the bot config
    const parsed = SpriteBotConfigSchema.safeParse(body.botConfig);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid bot config', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await update(id, { botConfig: parsed.data } as Partial<ISprite>);
    log.info('Updated bot config', { spriteId: id, botType: parsed.data.botType, toolCount: parsed.data.tools.length });

    return NextResponse.json({ ok: true, botConfig: parsed.data });
  } catch (error) {
    log.error('Failed to update bot config', { error });
    return NextResponse.json(
      { error: 'Failed to update bot config', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
