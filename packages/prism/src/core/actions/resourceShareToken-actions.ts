/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';

import { Prism } from '../../prism';
import { 
  BlockType_ResourceShareToken, 
  IResourceShareToken, 
  ResourceShareRole, 
  ResourceType 
} from '../blocks/resourceShareToken.block';
import { PrismContentQuery } from '../types';

export async function createResourceShareToken(
  assistantName: string,
  resourceId: string,
  resourceType: ResourceType,
  role: ResourceShareRole,
  createdBy: string,
  tenantId: string,
  ttl: number = 86400, // Default 24 hours in seconds
  maxRedemptions?: number,
  targetMode?: string
): Promise<IResourceShareToken> {
  const prism = await Prism.getInstance();
  
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + ttl);

  const token = uuidv4(); // Simple UUID token for now, could be more complex

  const shareToken: IResourceShareToken = {
    token,
    assistantName,
    resourceId,
    resourceType,
    role,
    createdBy,
    tenantId,
    expiresAt,
    maxRedemptions,
    targetMode,
    isActive: true,
    redeemedBy: []
  };

  const result = await prism.create(BlockType_ResourceShareToken, shareToken, 'any');
  if (!result || result.items.length === 0) {
    throw new Error('Failed to create resource share token');
  }
  return result.items[0] as IResourceShareToken;
}

export async function getResourceShareToken(token: string): Promise<IResourceShareToken | null> {
  const prism = await Prism.getInstance();
  
  const query: PrismContentQuery = {
    contentType: BlockType_ResourceShareToken,
    tenantId: 'any',
    where: { indexer: { path: 'token', equals: token } }
  };

  const result = await prism.query(query);
  if (result.items.length === 0) return null;
  
  return result.items[0] as IResourceShareToken;
}

export async function validateResourceShareToken(token: string): Promise<{ valid: boolean; token?: IResourceShareToken; error?: string }> {
  const shareToken = await getResourceShareToken(token);
  
  if (!shareToken) {
    return { valid: false, error: 'Token not found' };
  }

  if (!shareToken.isActive) {
    return { valid: false, error: 'Token is inactive' };
  }

  if (new Date() > new Date(shareToken.expiresAt)) {
    return { valid: false, error: 'Token has expired' };
  }

  if (shareToken.maxRedemptions && (shareToken.redeemedBy?.length || 0) >= shareToken.maxRedemptions) {
    return { valid: false, error: 'Max redemptions reached' };
  }
  if (!shareToken.assistantName) {
    shareToken.assistantName = 'pearlos'; // Default fallback
  }

  return { valid: true, token: shareToken };
}

export async function redeemResourceShareToken(token: string, userId: string): Promise<IResourceShareToken> {
  const validation = await validateResourceShareToken(token);
  if (!validation.valid || !validation.token) {
    throw new Error(validation.error || 'Invalid token');
  }

  const shareToken = validation.token;
  
  // If user already redeemed, just return the token (idempotent)
  if (shareToken.redeemedBy?.includes(userId)) {
    return shareToken;
  }

  const prism = await Prism.getInstance();
  
  const updatedRedeemedBy = [...(shareToken.redeemedBy || []), userId];
  
  // Check if we need to deactivate after this redemption
  const isActive = shareToken.isActive;
  if (shareToken.maxRedemptions && updatedRedeemedBy.length >= shareToken.maxRedemptions) {
    // Optional: Deactivate if single use? Or just rely on the check above.
    // Let's keep it active but the check will fail.
  }

  const updates: Partial<IResourceShareToken> = {
    redeemedBy: updatedRedeemedBy,
    isActive
  };

  const result = await prism.update(BlockType_ResourceShareToken, shareToken._id!, updates, userId);
  if (!result || result.items.length === 0) {
    throw new Error('Failed to update resource share token');
  }
  return result.items[0] as IResourceShareToken;
}

export async function deactivateResourceShareToken(tokenId: string, userId: string): Promise<void> {
  const prism = await Prism.getInstance();
  await prism.update(BlockType_ResourceShareToken, tokenId, { isActive: false }, userId);
}

export async function getAllResourceShareTokens(tenantId: string = 'any'): Promise<IResourceShareToken[]> {
  const prism = await Prism.getInstance();
  
  const query: PrismContentQuery = {
    contentType: BlockType_ResourceShareToken,
    tenantId: tenantId,
    orderBy: { createdAt: 'desc' }
  };

  const result = await prism.query(query);
  return result.items as IResourceShareToken[];
}

export async function getTokensRedeemedByUser(userId: string, resourceType?: ResourceType): Promise<IResourceShareToken[]> {
  const prism = await Prism.getInstance();
  
  // Relaxed query: Fetch all tokens of the given resource type (or all tokens)
  // and accept the performance cost of in-memory filtering to ensure correctness
  // due to indexer limitations with boolean/array combinations.
  const whereCondition: any = {};
  
  if (resourceType) {
    whereCondition.indexer = { path: 'resourceType', equals: resourceType };
  }

  const query: PrismContentQuery = {
    contentType: BlockType_ResourceShareToken,
    tenantId: 'any',
    where: whereCondition,
    orderBy: { createdAt: 'desc' },
  };

  const result = await prism.query(query);
  const items = result.items as IResourceShareToken[];
  
  console.log(`[getTokensRedeemedByUser] Query found ${items.length} potnetial tokens`);

  // Strict in-memory filtering
  return items.filter(item => {
    const isRedeemed = item.redeemedBy && item.redeemedBy.includes(userId);
    const isActive = item.isActive === true;
    
    if (isRedeemed && !isActive) {
      console.log(`[getTokensRedeemedByUser] Token ${item._id} matches user but is INACTIVE`);
    }
    
    return isRedeemed && isActive;
  });
}
