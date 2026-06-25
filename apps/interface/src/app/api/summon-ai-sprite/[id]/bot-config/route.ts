import { findById, update } from '@nia/prism/core/actions/sprite-actions';
import { SpriteBotConfigSchema } from '@nia/prism/core/blocks/sprite.block';
import type { ISprite } from '@nia/prism/core/blocks/sprite.block';
import { getLogger } from '@nia/prism/core/logger';
import { NextRequest, NextResponse } from 'next/server';

import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

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
    const { id } = await params;
    const body = await request.json();
    const requestedTenantId =
      request.nextUrl?.searchParams.get('tenantId') ||
      request.nextUrl?.searchParams.get('tenant_id') ||
      body?.tenantId ||
      body?.tenant_id ||
      undefined;
    const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
    if (!actorResult.ok) return actorResult.response;
    const { userId, tenantId } = actorResult.actor;

    log.info('Updating bot config', { spriteId: id, userId, tenantId });

    const sprite = (await findById(id)) as ISprite | null;
    if (!sprite) {
      return NextResponse.json({ error: 'Sprite not found' }, { status: 404 });
    }

    if (sprite.tenantId !== tenantId || sprite.parent_id !== userId) {
      log.warn('Unauthorized bot config update', {
        spriteId: id,
        userId,
        tenantId,
        ownerId: sprite.parent_id,
        spriteTenantId: sprite.tenantId,
      });
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
