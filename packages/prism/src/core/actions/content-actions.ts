'use server'

import { Prism } from '@nia/prism';
import { IDynamicContent } from '@nia/prism/core/blocks/dynamicContent.block';
import { ContentData } from '@nia/prism/core/content/types';
import { PrismContentQuery, PrismContentResult } from '@nia/prism/core/types';

/**
 * Finds a content definition by block type and optional tenant ID.
 * 
 * @param blockType - The type of content block to search for
 * @param tenantId - Optional tenant identifier to scope the search
 * @returns Promise resolving to the content definition result
 * 
 * @example
 * ```typescript
 * const definition = await findDefinition('Article', 'tenant123');
 * ```
 */
export async function findDefinition(blockType: string, tenantId?: string): Promise<PrismContentResult> {
  const prism = await Prism.getInstance();
  return await prism.findDefinition(blockType, tenantId);
}

export async function listDefinitions(tenantId?: string): Promise<PrismContentResult> {
  const prism = await Prism.getInstance();
  return await prism.listDefinitions(tenantId);
}
/**
 * Creates a new content definition in the system.
 * 
 * @param definition - The definition object containing schema and metadata
 * @param tenantId - Optional tenant identifier to scope the definition
 * @returns Promise resolving to the created dynamic content definition
 * @throws Error if creation fails or returns empty result
 * 
 * @example
 * ```typescript
 * const newDefinition = {
 *   name: 'Article',
 *   schema: { title: 'string', content: 'text' }
 * };
 * const created = await createDefinition(newDefinition, 'tenant123');
 * ```
 */
export async function createDefinition(
  definition: IDynamicContent,
  tenantId?: string
): Promise<IDynamicContent> {
  const prism = await Prism.getInstance();
  const created = await prism.createDefinition(definition, tenantId);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create dynamic content definition');
  }
  return created.items[0] as unknown as IDynamicContent;
}

  
/**
 * Searches for content using a structured query.
 * Supports filtering, pagination, and sorting of dynamic content.
 * 
 * @param query - The content query object containing search criteria
 * @returns Promise resolving to paginated content results
 * 
 * @example
 * ```typescript
 * const query = {
 *   blockType: 'Article',
 *   filters: { status: 'published' },
 *   limit: 10,
 *   offset: 0
 * };
 * const results = await findContent(query);
 * ```
 */
export async function findContent(query: PrismContentQuery): Promise<PrismContentResult> {
  const prism = await Prism.getInstance();
  return await prism.query(query);
};

/**
 * Creates a new content instance of a specified block type.
 * The content will be validated against the block type's schema definition.
 * 
 * @param blockType - The type of content block to create (must exist as a definition)
 * @param content - The actual content data conforming to the block type schema
 * @param tenantId - Optional tenant identifier to scope the content
 * @returns Promise resolving to the created dynamic content instance
 * @throws Error if creation fails or returns empty result
 * 
 * @example
 * ```typescript
 * const articleContent = {
 *   title: 'My Article',
 *   content: 'Article body text...',
 *   author: 'John Doe'
 * };
 * const created = await createContent('Article', articleContent, 'tenant123');
 * ```
 */
export async function createContent(
  blockType: any,
  content: any,
  tenantId?: string
): Promise<ContentData> {
  const prism = await Prism.getInstance();

  const created = await prism.create(blockType, content, tenantId);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create dynamic content definition');
  }
  return created.items[0] as unknown as IDynamicContent;
}

/**
 * Updates an existing content instance by its ID.
 * The content will be validated against the block type's schema definition.
 * 
 * @param blockType - The type of content block to update
 * @param contentId - The unique identifier of the content to update (page_id)
 * @param content - The updated content data conforming to the block type schema
 * @param tenantId - Optional tenant identifier to scope the content
 * @returns Promise resolving to the updated dynamic content instance
 * @throws Error if update fails or content not found
 * 
 * @example
 * ```typescript
 * const updatedContent = {
 *   title: 'Updated Article Title',
 *   content: 'Updated content...'
 * };
 * const updated = await updateContent('Article', 'content123', updatedContent, 'tenant123');
 * ```
 */
export async function updateContent(
  blockType: string,
  contentId: string,
  content: any,
  tenantId?: string
): Promise<PrismContentResult> {
  const prism = await Prism.getInstance();
  return await prism.update(blockType, contentId, content, tenantId);
}

/**
 * Deletes a content instance by its ID.
 * 
 * @param blockType - The type of content block to delete
 * @param contentId - The unique identifier of the content to delete (page_id)
 * @param tenantId - Optional tenant identifier to scope the content
 * @returns Promise resolving to boolean indicating success/failure
 * @throws Error if deletion fails
 * 
 * @example
 * ```typescript
 * const deleted = await deleteContent('Article', 'content123', 'tenant123');
 * if (deleted) {
 *   console.log('Content deleted successfully');
 * }
 * ```
 */
export async function deleteContent(
  blockType: string,
  contentId: string,
  tenantId?: string
): Promise<boolean> {
  const prism = await Prism.getInstance();
  return await prism.delete(blockType, contentId, tenantId);
}

// TODO: createBulkContent
