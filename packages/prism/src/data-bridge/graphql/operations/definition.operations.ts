/**
 * Definition GraphQL Operations
 * 
 * Operations for content definitions (dynamic content schemas)
 */

import { notionModelFragments } from '../fragments/notionModel.fragments';

export const definitionOperations = {
  // List all definitions
  listDefinitions: `
    ${notionModelFragments.full}
    query ListDefinitions {
      notionModel(where: { type: { eq: "DynamicContent" } }) {
        ...FullNotionModel
      }
    }
  `,
  
  // List definitions for specific tenant (includes both tenant-specific and platform-level definitions)
  listDefinitionsForTenant: `
    ${notionModelFragments.full}
    query ListDefinitionsForTenant($tenantId: String!) {
      notionModel(where: { 
        type: { eq: "DynamicContent" }, 
        OR: [
          { parent_id: { eq: $tenantId } },
          { parent_id: { eq: null } }
        ]
      }) {
        ...FullNotionModel
      }
    }
  `, 
   
  // Find definition by type
  findDefinition: `
    ${notionModelFragments.full}
    query FindDefinition($type: JSON!) {
      notionModel(
        where: { 
          type: { eq: "DynamicContent" },
          indexer: { path: "dynamicBlockType", equals: $type }
        }
      ) {
        ...FullNotionModel
      }
    }
  `,
  // Find definition by ID
  findDefinitionById: `
    ${notionModelFragments.full}
    query FindDefinitionById($page_id: String!) {
      notionModelByPageId(page_id: $page_id) {
        ...FullNotionModel
      }
    }
  `,
  // Find definition for parent
  findDefinitionForParent: `
    ${notionModelFragments.full}
    query FindDefinitionForParent($type: String!, $parent_id: String!) {
      notionModel(
        where: { 
          type: { eq: $type },
          parent_id: { eq: $parent_id }
        }
      ) {
        ...FullNotionModel
      }
    }
  `,
  // Create a new definition
  createDefinition: `
    ${notionModelFragments.full}
    mutation CreateDefinition($input: NotionModelInput!) {
      createNotionModel(input: $input) {
        ...FullNotionModel
      }
    }
  `,
  
  // Update an existing definition
  updateDefinition: `
    ${notionModelFragments.full}
    mutation UpdateDefinition($blockId: String!, $input: NotionModelInput!) {
      updateNotionModel(block_id: $blockId, input: $input) {
        ...FullNotionModel
      }
    }
  `,

  // Replace an existing definition (full replacement)
  replaceDefinition: `
    ${notionModelFragments.full}
    mutation ReplaceDefinition($blockId: String!, $input: NotionModelInput!) {
      replaceNotionModel(block_id: $blockId, input: $input) {
        ...FullNotionModel
      }
    }
  `,
  
  // Delete a definition
  deleteDefinition: `
    mutation DeleteDefinition($blockId: String!) {
      deleteNotionModel(block_id: $blockId)
    }
  `
};

export default definitionOperations;