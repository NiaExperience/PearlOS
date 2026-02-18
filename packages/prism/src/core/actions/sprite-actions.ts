/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prism, PrismContentQuery, PrismContentResult } from '@nia/prism';
import { ISprite, BlockType_Sprite } from '@nia/prism/core/blocks/sprite.block';

import { getLogger } from '../logger';
import { SpriteDefinition } from '../platform-definitions/Sprite.definition';

const log = getLogger('prism:actions:sprite');

/**
 * Create Sprite content definition in Prism
 */
export async function createSpriteDefinition() {
  const prism = await Prism.getInstance();
  const created = await prism.createDefinition(SpriteDefinition);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create Sprite definition');
  }
  return created.items[0];
}

/**
 * Auto-create definition if missing
 */
export async function ensureSpriteDefinition(operation: () => Promise<any>) {
  try {
    return await operation();
  } catch (error) {
    const msg = `Content definition for type "${BlockType_Sprite}" not found.`;
    if (error instanceof Error && error.message.includes(msg)) {
      log.info('Creating Sprite definition on first use');
      await createSpriteDefinition();
      return await operation();
    }
    throw error;
  }
}

/**
 * Find a Sprite by ID
 */
export async function findById(spriteId: string): Promise<ISprite | null> {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_Sprite,
    tenantId: 'any',
    where: {
      type: { eq: BlockType_Sprite },
      page_id: { eq: spriteId }
    },
    limit: 1,
  } as PrismContentQuery);

  const found: PrismContentResult = await ensureSpriteDefinition(op);
  return found?.total ? (found.items[0] as ISprite) : null;
}

/**
 * Find a Sprite by name for a specific user
 */
export async function findByName(userId: string, name: string): Promise<ISprite | null> {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_Sprite,
    tenantId: 'any',
    where: {
      type: { eq: BlockType_Sprite },
      indexer: { path: 'parent_id', equals: userId },
      and: [{ indexer: { path: 'name', equals: name } }]
    },
    limit: 1,
  } as PrismContentQuery);

  const found: PrismContentResult = await ensureSpriteDefinition(op);
  return found?.total ? (found.items[0] as ISprite) : null;
}

import { ResourceType } from '../blocks/resourceShareToken.block';
import { getTokensRedeemedByUser } from './resourceShareToken-actions';

/**
 * List all Sprites for a user
 */
export async function listByUser(userId: string, limit = 50, offset = 0): Promise<PrismContentResult> {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_Sprite,
    tenantId: 'any',
    where: {
      type: { eq: BlockType_Sprite },
      indexer: { path: 'parent_id', equals: userId }
    },
    limit,
    offset,
    orderBy: { updatedAt: 'desc' },
  } as PrismContentQuery);

  return await ensureSpriteDefinition(op);
}

/**
 * Get Sprites shared with a user via ResourceShareToken
 */
export async function getSpritesSharedWithUser(userId: string): Promise<ISprite[]> {
  try {
    const tokens = await getTokensRedeemedByUser(userId, ResourceType.Sprite);
    const resourceIds = tokens.map(t => t.resourceId);
    
    if (resourceIds.length === 0) {
      return [];
    }

    // Deduplicate IDs
    const uniqueIds = Array.from(new Set(resourceIds));

    // Fetch corresponding sprites
    // Unfortunately Prism doesn't standardly support "WHERE _id IN [...]" in all adapters yet efficiently
    // So we might need to fetch individually or use 'or' logic if supported.
    // For now, doing Promise.all for simplicity as scale is expected to be small for shared items
    // If strict on performance, we'd add 'in' operator to Prism Query impl
    
    const sprites: ISprite[] = [];
    await Promise.all(uniqueIds.map(async (id) => {
        const sprite = await findById(id);
        if (sprite) {
            sprites.push(sprite);
        }
    }));

    return sprites;
  } catch (err) {
    log.error('Failed to get shared sprites', { userId, err });
    return [];
  }
}

/**
 * Create a new Sprite
 */
export async function create(sprite: Omit<ISprite, '_id' | 'createdAt' | 'updatedAt'>): Promise<ISprite> {
  const prism = await Prism.getInstance();

  const record: ISprite = {
    ...sprite,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const createOp = async () => await prism.create(
    SpriteDefinition.dataModel.block,
    record
  );

  const result = await ensureSpriteDefinition(createOp);
  if (!result || result.total === 0 || result.items.length === 0) {
    throw new Error('Failed to create Sprite');
  }

  log.info('Created Sprite', { spriteId: result.items[0]._id, name: sprite.name, userId: sprite.parent_id });
  return result.items[0] as ISprite;
}

/**
 * Update an existing Sprite
 */
export async function update(spriteId: string, updates: Partial<ISprite>): Promise<ISprite> {
  const prism = await Prism.getInstance();

  const updatePayload = {
    ...updates,
    updatedAt: new Date().toISOString()
  };

  // Remove fields that shouldn't be updated
  delete updatePayload._id;
  delete updatePayload.createdAt;

  const updateOp = async () => await prism.update(
    SpriteDefinition.dataModel.block,
    spriteId,
    updatePayload
  );

  const result = await ensureSpriteDefinition(updateOp);
  if (!result || result.total === 0 || result.items.length === 0) {
    throw new Error('Failed to update Sprite');
  }

  log.info('Updated Sprite', { spriteId, fields: Object.keys(updates) });
  return result.items[0] as ISprite;
}

/**
 * Update conversation summary after session ends
 */
export async function updateConversationSummary(spriteId: string, summary: string): Promise<ISprite> {
  return update(spriteId, {
    lastConversationSummary: summary,
    lastConversationAt: new Date().toISOString()
  });
}

/**
 * Delete a Sprite
 */
export async function remove(spriteId: string): Promise<void> {
  const prism = await Prism.getInstance();

  const deleteOp = async () => await prism.delete(
    SpriteDefinition.dataModel.block,
    spriteId
  );

  await ensureSpriteDefinition(deleteOp);
  log.info('Deleted Sprite', { spriteId });
}

/**
 * Get most recently used Sprite for a user (for "Recall" functionality)
 */
export async function getMostRecent(userId: string): Promise<ISprite | null> {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_Sprite,
    tenantId: 'any',
    where: {
      type: { eq: BlockType_Sprite },
      indexer: { path: 'parent_id', equals: userId }
    },
    limit: 1,
    orderBy: { updatedAt: 'desc' },
  } as PrismContentQuery);

  const found: PrismContentResult = await ensureSpriteDefinition(op);
  return found?.total ? (found.items[0] as ISprite) : null;
}
