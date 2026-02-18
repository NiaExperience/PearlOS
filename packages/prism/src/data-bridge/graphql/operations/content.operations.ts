/**
 * Content GraphQL Operations
 * 
 * Standard GraphQL operations for NotionModel content
 */

import { notionModelFragments } from '../fragments/notionModel.fragments';

export const contentOperations = {
  // Find content with filtering, sorting, and pagination
  findContent: `
    ${notionModelFragments.full}
    query FindContent($where: NotionModelFilter, $limit: Int, $offset: Int, $orderBy: [OrderByInput!]) {
      notionModel(where: $where, limit: $limit, offset: $offset, orderBy: $orderBy) {
        ...FullNotionModel
      }
    }
  `,
  
  // Find content by block ID
  findContentById: `
    ${notionModelFragments.withParent}
    query FindContentById($pageId: String!) {
      notionModelByPageId(page_id: $pageId) {
        ...NotionModelWithParent
      }
    }
  `,
  
  // Create new content
  bulkCreateContent: `
    ${notionModelFragments.full}
    mutation BulkCreateContent($inputs: [NotionModelInput!]!) {
      bulkCreateNotionModel(inputs: $inputs) {
        ...FullNotionModel
      }
    }
  `,
  // Create new content
  createContent: `
    ${notionModelFragments.full}
    mutation CreateContent($input: NotionModelInput!) {
      createNotionModel(input: $input) {
        ...FullNotionModel
      }
    }
  `,
  
  // Update existing content
  updateContent: `
    ${notionModelFragments.full}
    mutation UpdateContent($blockId: String!, $input: NotionModelInput!) {
      updateNotionModel(block_id: $blockId, input: $input) {
        ...FullNotionModel
      }
    }
  `,
  
  // Replace existing content (full replacement, no merge)
  replaceContent: `
    ${notionModelFragments.full}
    mutation ReplaceContent($blockId: String!, $input: NotionModelInput!) {
      replaceNotionModel(block_id: $blockId, input: $input) {
        ...FullNotionModel
      }
    }
  `,
  
  // Delete content
  deleteContent: `
    mutation DeleteContent($blockId: String!) {
      deleteNotionModel(block_id: $blockId)
    }
  `
};

export default contentOperations;
