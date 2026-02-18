/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prism, PrismContentQuery, PrismContentResult } from '@nia/prism';
import { IFunctionalPrompt, IFunctionalPromptHistoryEntry, BlockType_FunctionalPrompt } from '@nia/prism/core/blocks/functionalPrompt.block';
import { createTwoFilesPatch } from 'diff';

import { FunctionalPromptDefinition } from '../platform-definitions';

export async function createFunctionalPromptDefinition() {
  const prism = await Prism.getInstance();
  const created = await prism.createDefinition(FunctionalPromptDefinition);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create FunctionalPrompt definition');
  }
  return created.items[0];
}

export async function ensureFunctionalPromptDefinition(operation: () => Promise<any>) {
  try {
    return await operation();
  } catch (error) {
    const msg = `Content definition for type "${BlockType_FunctionalPrompt}" not found.`;
    if (error instanceof Error && error.message.includes(msg)) {
      await createFunctionalPromptDefinition();
      return await operation();
    }
    throw error;
  }
}

/**
 * Generate a unified diff between two prompt contents
 */
function generateDiff(oldContent: string, newContent: string, featureKey: string): string {
  const patch = createTwoFilesPatch(
    `${featureKey}.old.txt`,
    `${featureKey}.new.txt`,
    oldContent,
    newContent,
    'Previous version',
    'Current version'
  );
  return patch;
}

/**
 * Find a FunctionalPrompt by featureKey
 */
export async function findByFeatureKey(featureKey: string): Promise<IFunctionalPrompt | null> {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_FunctionalPrompt,
    tenantId: 'any',
    where: { 
      type: { eq: BlockType_FunctionalPrompt }, 
      indexer: { path: 'featureKey', equals: featureKey } 
    },
    limit: 1,
  } as PrismContentQuery);
  
  const found: PrismContentResult = await ensureFunctionalPromptDefinition(op);
  return found?.total ? (found.items[0] as IFunctionalPrompt) : null;
}

/**
 * List all FunctionalPrompts
 */
export async function listAll(limit = 100, offset = 0): Promise<PrismContentResult> {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_FunctionalPrompt,
    tenantId: 'any',
    where: { type: { eq: BlockType_FunctionalPrompt } },
    limit,
    offset,
    orderBy: { featureKey: 'asc' },
  } as PrismContentQuery);
  
  return await ensureFunctionalPromptDefinition(op);
}

/**
 * Create or update a FunctionalPrompt
 */
export async function createOrUpdate(
  featureKey: string,
  promptContent: string,
  lastModifiedByUserId?: string
): Promise<IFunctionalPrompt> {
  const prism = await Prism.getInstance();
  
  // Check if exists
  const existing = await findByFeatureKey(featureKey);
  
  if (existing) {
    // Update path - generate diff and append to history
    const delta = generateDiff(
      existing.promptContent,
      promptContent,
      featureKey
    );
    
    const historyEntry: IFunctionalPromptHistoryEntry = {
      userId: lastModifiedByUserId || 'system',
      delta,
      modifiedAt: new Date().toISOString()
    };
    
    const updatedHistory = [...(existing.history || []), historyEntry];
    
    // Use atomic merge - only send the fields being updated
    const updatePayload = {
      promptContent,
      lastModifiedByUserId,
      history: updatedHistory,
      updatedAt: new Date().toISOString()
    };
    
    const updateOp = async () => await prism.update(
      FunctionalPromptDefinition.dataModel.block,
      existing._id!,
      updatePayload
    );
    
    const result = await ensureFunctionalPromptDefinition(updateOp);
    if (!result || result.total === 0 || result.items.length === 0) {
      throw new Error('Failed to update FunctionalPrompt');
    }
    return result.items[0] as IFunctionalPrompt;
  } else {
    // Create path - no history for initial creation
    const record: IFunctionalPrompt = {
      featureKey,
      promptContent,
      lastModifiedByUserId,
      // Don't initialize history for new records - it should be undefined until first update
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const createOp = async () => await prism.create(
      FunctionalPromptDefinition.dataModel.block,
      record
    );
    
    const result = await ensureFunctionalPromptDefinition(createOp);
    if (!result || result.total === 0 || result.items.length === 0) {
      throw new Error('Failed to create FunctionalPrompt');
    }
    return result.items[0] as IFunctionalPrompt;
  }
}

/**
 * Delete a FunctionalPrompt by featureKey
 */
export async function deleteByFeatureKey(featureKey: string): Promise<boolean> {
  const prism = await Prism.getInstance();
  const existing = await findByFeatureKey(featureKey);
  
  if (!existing || !existing._id) {
    return false;
  }
  
  const op = async () => await prism.delete(BlockType_FunctionalPrompt, existing._id!);
  const result = await ensureFunctionalPromptDefinition(op);
  return !!(result && ((result as any).total === undefined || (result as any).total >= 0));
}
