/**
 * NotionModel GraphQL Fragments
 * 
 * Reusable fragments for NotionModel operations
 */

export const notionModelFragments = {
  // Full fields for NotionModel
  full: `
    fragment FullNotionModel on NotionModel {
      block_id
      page_id
      parent_id
      type
      content
      indexer
      order
      version
    }
  `,
  
  // Extended fields including parent data
  withParent: `
    fragment NotionModelWithParent on NotionModel {
      block_id
      page_id
      parent_id
      type
      content
      indexer
      order
      version
      parentData {
        block_id
        type
        content
      }
    }
  `
};

export default notionModelFragments;
