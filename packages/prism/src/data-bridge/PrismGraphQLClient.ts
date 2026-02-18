/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Prism GraphQL Client
 * 
 * A standardized GraphQL client for Prism that uses static queries and fragments
 * instead of dynamic query generation. This simplifies the code and makes it more
 * maintainable while still providing the necessary abstraction layer.
 */

import { GraphQLClient } from 'graphql-request';
import { v4 as uuidv4 } from 'uuid';

// Import domain-specific operations  
import { IDynamicContent } from '../core/blocks/dynamicContent.block';
import { ContentData } from '../core/content/types';
import { buildIndexer, resolveParentId } from '../core/content/utils';
import { getLogger } from '../core/logger';
import { PrismContentResult } from '../core/types';
import { isValidUUID } from '../core/utils';
import { isPlatformContentDefinition, getPlatformContentDefinition } from '../core/utils/platform-definitions';

import { contentOperations } from './graphql/operations/content.operations';
import { definitionOperations } from './graphql/operations/definition.operations';
import { NotionModel, NotionModelInput } from './graphql/types';
import { normalizeProvider, PlatformProvider, ProviderConfig } from './provider';

const log = getLogger('prism:data:graphql-client');


const UPDATE_IF_DIFFERENT = false;

export class PrismGraphQLClient {
  private client: GraphQLClient;
  private endpoint: string;
  private isConnected: boolean = false;

  constructor(endpoint = process.env.MESH_ENDPOINT || 'http://localhost:2000/graphql') {
    this.endpoint = endpoint;
    const secret = (typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_MESH_SHARED_SECRET || process.env.MESH_SHARED_SECRET)
      : process.env.MESH_SHARED_SECRET) || '';
    this.client = new GraphQLClient(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'x-mesh-secret': secret,
      },
    });
  }

  /**
   * Check the GraphQL client connection
   */
  async connect(): Promise<boolean> {
    try {
      if (this.isConnected) {
        return true;
      }
      // Simple check to verify connectivity
      const query = `{ __schema { queryType { name } } }`;
      await this.client.request(query);
      this.isConnected = true;
      if (process.env.MESH_SHARED_SECRET) {
        log.info('Prism GraphQL client connected (secure)', { endpoint: this.endpoint });
      }
      else {
        log.info('Prism GraphQL client connected (no shared secret configured)', { endpoint: this.endpoint });
      };
      return true;
    } catch (error) {
      log.error('Failed to connect to GraphQL server', { endpoint: this.endpoint, error });
      return false;
    }
  }

  /**
   * Disconnect the GraphQL client and cleanup resources
   */
  async disconnect(): Promise<void> {
    // Clean up TCP connections
    if (this.client) {
      try {
        // Force Node.js to close any TCP connections associated with this client
        // Create a new client with minimal configuration
        this.client = new GraphQLClient(this.endpoint, {
          headers: {
            'Content-Type': 'application/json',
          }
        });

        // Set a short timeout to ensure connections get released
        setTimeout(() => {
          try {
            // Explicitly set to null to help garbage collection
            // @ts-expect-error - We're deliberately setting to null for cleanup
            this.client = null;
          } catch (e) {
            // Ignore any errors during nullification
          }
        }, 10);

        // Use Node.js garbage collection hint
        if (global.gc) {
          try {
            global.gc();
          } catch (e) {
            // Ignore if gc is not available
          }
        }

        this.isConnected = false;
        log.info('Prism GraphQL client disconnected', { endpoint: this.endpoint });
      } catch (error) {
        log.error('Error disconnecting from GraphQL server', { endpoint: this.endpoint, error });
        // Even if there's an error, try to clean up
        // @ts-expect-error - We're deliberately setting to null for cleanup
        this.client = null;
        this.isConnected = false;
      }
    }
  }

  /**
   * Generic query method
   */
  async query<T = any, V extends Record<string, any> = Record<string, any>>(
    query: string,
    variables?: V,
    headers?: Record<string, string>
  ): Promise<T> {
    if (!this.connect()) {
      throw new Error('GraphQL Client is not connected. Call start() first.');
    }
    if (process.env.DEBUG_PRISM === 'true') {
      log.debug('Executing GraphQL query', { query, variables, headers });
    }
    return await this.client.request<T>(query, variables, headers);
  }

  // ===== CONTENT OPERATIONS =====

  /**
   * Find content by criteria using native GraphQL query variables
   * Enhanced with provider routing capability
   */
  async findContent(
    contentType: string,
    where?: Record<string, any>,
    limit?: number,
    offset?: number,
    orderBy?: Record<string, any>[],
    tenantId?: string
  ): Promise<PrismContentResult> {

    // 1. Check if this content type uses a non-default provider
    try {
      const defResult = await this.findDefinition(contentType, tenantId || 'any');
      if (defResult.total > 0) {
        const definition = defResult.items[0].content as IDynamicContent;
        const providerConfig = normalizeProvider(definition.dataModel.provider);

        // 2. Route to provider-specific handling if not nia-postgres-content
        if (providerConfig.type !== PlatformProvider) {
          return this.routeToProvider(providerConfig, contentType, where, limit, offset, orderBy);
        }
      }
    } catch (error) {
      log.warn('Could not determine provider for content type; defaulting to nia-postgres-content', { contentType, error });
    }

    // 3. Default behavior: query nia-postgres-content
    return this.findContentFromPostgres(contentType, where, limit, offset, orderBy, tenantId);
  }

  /**
   * Helper to convert dot-notation fields in a query clause to contentJsonb filters
   * Used for recursive processing of AND/OR clauses
   */
  private convertDotNotationInClause(clause: Record<string, any>): Record<string, any> {
    const converted: Record<string, any> = {};
    const dotNotationFields: Array<{ path: string; op: string; value: any }> = [];
    
    for (const [key, value] of Object.entries(clause)) {
      if (key === 'AND' || key === 'OR') {
        // Recursively process nested logical operators
        converted[key] = (value as any[]).map((nestedClause: Record<string, any>) => 
          this.convertDotNotationInClause(nestedClause)
        );
      } else if (key.includes('.')) {
        // DOT NOTATION: Collect for later conversion to a single contentJsonb filter
        const operators = value;
        for (const [op, opValue] of Object.entries(operators)) {
          dotNotationFields.push({ path: key, op, value: opValue });
        }
      } else {
        // Regular field - keep as-is
        converted[key] = value;
      }
    }
    
    // Convert all collected dot-notation fields to a single contentJsonb object
    if (dotNotationFields.length > 0) {
      // For now, we only support a single dot-notation field per clause
      // Multiple fields would require AND/OR logic
      if (dotNotationFields.length === 1) {
        const { path, op, value } = dotNotationFields[0];
        converted.contentJsonb = {
          path,
          [op]: value
        };
      } else {
        // Multiple fields - use the first one and warn
        log.warn('Multiple dot-notation fields in single clause not fully supported, using first', { dotNotationFields });
        const { path, op, value } = dotNotationFields[0];
        converted.contentJsonb = {
          path,
          [op]: value
        };
      }
    }
    
    return converted;
  }

  /**
   * Default implementation: find content from nia-postgres-content
   */
  private async findContentFromPostgres(
    contentType: string,
    where?: Record<string, any>,
    limit?: number,
    offset?: number,
    orderBy?: Record<string, any>[],
    tenantId?: string
  ): Promise<PrismContentResult> {
    // Format where clause, preserving AND/OR/indexer structures
    // and converting dot-notation fields to contentJsonb filters
    const formattedWhere: Record<string, any> = {};

    if (where) {
      const dotNotationFields: Array<{ path: string; op: string; value: any }> = [];
      
      for (const [key, value] of Object.entries(where)) {
        if (key === 'AND' || key === 'OR') {
          // Recursively process logical operators
          formattedWhere[key] = (value as any[]).map((clause: Record<string, any>) => 
            this.convertDotNotationInClause(clause)
          );
        } else if (key === 'indexer') {
          // Preserve indexer filters as-is (they're already in the correct { path, equals } format)
          formattedWhere[key] = value;
        } else if (key.includes('.')) {
          // DOT NOTATION: Collect for later conversion to a single contentJsonb filter
          const operators = value;
          for (const [op, opValue] of Object.entries(operators)) {
            dotNotationFields.push({ path: key, op, value: opValue });
          }
        } else if (typeof value === 'string') {
          // Convert direct string values to { eq: value } format for regular fields
          formattedWhere[key] = { eq: value };
        } else {
          // Keep existing filter objects as-is (including other GraphQL-compliant queries)
          formattedWhere[key] = value;
        }
      }
      
      // Convert all collected dot-notation fields to a single contentJsonb object
      if (dotNotationFields.length > 0) {
        if (dotNotationFields.length === 1) {
          const { path, op, value } = dotNotationFields[0];
          formattedWhere.contentJsonb = {
            path,
            [op]: value
          };
        } else {
          // Multiple fields - use the first one and warn
          log.warn('Multiple dot-notation fields at top level not fully supported, using first', { dotNotationFields });
          const { path, op, value } = dotNotationFields[0];
          formattedWhere.contentJsonb = {
            path,
            [op]: value
          };
        }
      }
    }

    // Build the where clause with type filter and formatted filters
    const finalWhere: Record<string, any> = {
      type: { eq: contentType },
      ...formattedWhere
    };

    try {
      if (process.env.DEBUG_PRISM === 'true') {
        log.debug('Final GraphQL query variables', { where: finalWhere, limit, offset, orderBy });
      }

      const result = await this.query(
        contentOperations.findContent,
        {
          where: finalWhere,
          limit,
          offset,
          orderBy
        }
      );

      const processedResult = {
        total: result.notionModel.length,
        items: limit ? result.notionModel.slice(0, limit) : result.notionModel,
        hasMore: (result.notionModel.length === limit) // Assume there's more if we hit the limit
      };

      return processedResult;
    } catch (error) {
      log.error('Error finding content from PostgreSQL', { contentType, error });
      return {
        total: 0,
        items: [],
        hasMore: false
      };
    }
  }

  /**
   * Route query to external provider (placeholder for future implementation)
   */
  private async routeToProvider(
    providerConfig: ProviderConfig,
    contentType: string,
    where?: Record<string, any>,
    limit?: number,
    offset?: number,
    orderBy?: Record<string, any>[]
  ): Promise<PrismContentResult> {
    // TODO: Implement provider-specific routing
    log.info('Provider routing requested', { contentType, providerConfig });

    // For now, return empty results for non-nia-postgres-content providers
    // This will be expanded in the future to handle external APIs, file systems, etc.
    return {
      total: 0,
      items: [],
      hasMore: false
    };
  }

  /**
   * Create new content
   */
  async createContent(
    contentType: string,
    data: ContentData,
    tenantId: string
  ): Promise<NotionModel> {
    // Find the content definition for the specified type with retry logic for race conditions
    const defResult = await this.findDefinition(contentType, tenantId);
    if (defResult.total === 0) {
      log.error('Content definition not found', { contentType, tenantId });
      throw new Error(`Content definition for type "${contentType}" not found.`);
    }
    // NOTE: in the client layer, we deal with NotionModel objects
    const definition = defResult.items[0].content as IDynamicContent;
    if (!definition.dataModel) {
      log.error('Content definition has no data model', { contentType, tenantId, definition });
      throw new Error(`Content definition for type "${contentType}" has no data model.`);
    }
    const page_id = data._id || uuidv4(); // Generate a new UUID if not provided
    const parent_id = resolveParentId(data, definition.dataModel);
    const indexer = buildIndexer(data, definition.dataModel.indexer || []) || {};

    const input: NotionModelInput = {
      type: contentType,
      content: data,
      page_id,
      parent_id,
      indexer
    };
    try {
      if (process.env.DEBUG_PRISM === 'true') {
        log.debug('Creating content with input', { contentType, tenantId, input });
      }
      const result = await this.query(
        contentOperations.createContent,
        { input }
      );

      return result.createNotionModel;
    } catch (error) {
      log.error('Error creating content', { contentType, tenantId, error });
      return null as unknown as NotionModel;
    }
  }

  /**
   * Create multiple content items
   */
  async bulkCreateContent(
    contentType: string,
    data: ContentData[],
    tenantId: string,
  ): Promise<PrismContentResult> {
    // Find the content definition for the specified type
    const defResult = await this.findDefinition(contentType, tenantId);
    if (defResult.total === 0) {
      log.error('Content definition not found', { contentType, tenantId });
      throw new Error(`Content definition for type "${contentType}" not found.`);
    }
    const definitionModel = defResult.items[0] as NotionModel;
    const definition = definitionModel.content as IDynamicContent;
    const input: NotionModelInput[] =
      data.map((item) => ({
        type: contentType,
        content: item,
        parent_id: resolveParentId(item, definition.dataModel),
        indexer: buildIndexer(item, definition.dataModel.indexer || []) || {}
      }));

    try {
      log.info('Executing bulk create', { contentType, tenantId, count: input.length });
      const result = await this.query(
        contentOperations.bulkCreateContent,
        { inputs: input }
      );
      log.info('Bulk create successful', { contentType, tenantId, count: result?.bulkCreateNotionModel?.length });

      // Transform the raw array response to match expected format
      const items = result.bulkCreateNotionModel || [];
      return {
        total: items.length,
        items: items.map((item: any) => ({
          ...item.content,
          _id: item.page_id,
          block_id: item.block_id,
          parent_id: item.parent_id,
          type: item.type
        })),
        hasMore: false
      };
    } catch (error) {
      log.error('Error creating multiple content', { contentType, tenantId, error });
      return { total: 0, items: [], hasMore: false };
    }
  }

  /**
   * Update content by ID
   */
  async updateContent(
    blockId: string,
    contentType: string,
    data: ContentData,
    page_id?: string,
    parent_id?: string,
    order?: number,
    tenantId: string = 'any'
  ): Promise<PrismContentResult> {

    // Find the content definition for the specified type with retry logic for race conditions
    const defResult = await this.findDefinition(contentType, tenantId);
    if (defResult.total === 0) {
      log.error('Content definition not found', { contentType, tenantId });
      throw new Error(`Content definition for type "${contentType}" not found.`);
    }
    // NOTE: in the client layer, we deal with NotionModel objects
    const definition = defResult.items[0].content as IDynamicContent;
    if (!definition.dataModel) {
      log.error('Content definition has no data model', { contentType, tenantId, definition });
      throw new Error(`Content definition for type "${contentType}" has no data model.`);
    }
    // Build the indexer from only the fields present in the update data
    // This creates a partial indexer that will be merged with the existing indexer
    const indexer = buildIndexer(data, definition.dataModel.indexer || []) || {};
    const input: NotionModelInput = {
      type: contentType,
      content: data,
      page_id,
      parent_id,
      indexer,
      order
    };

    try {
      if (!isValidUUID(blockId)) {
        throw new Error(`Invalid block ID: ${blockId}`);
      }
      const result = await this.query(
        contentOperations.updateContent,
        { blockId, input }
      );

      // Wrap the updated NotionModel in a PrismContentResult
      const updatedModel = result.updateNotionModel;
      return {
        total: 1,
        items: [updatedModel],
        hasMore: false
      };
    } catch (error) {
      log.error('Error updating content', { contentType, blockId, tenantId, error });
      return {
        total: 0,
        items: [],
        hasMore: false
      }
    }
  }

  /**
   * Replace content by ID (full replacement, no merge)
   * Completely replaces the content field, allowing fields to be removed.
   */
  async replaceContent(
    blockId: string,
    contentType: string,
    data: ContentData,
    page_id?: string,
    parent_id?: string,
    order?: number,
    tenantId: string = 'any'
  ): Promise<PrismContentResult> {

    // Find the content definition for the specified type with retry logic for race conditions
    const defResult = await this.findDefinition(contentType, tenantId);
    if (defResult.total === 0) {
      log.error('Content definition not found', { contentType, tenantId });
      throw new Error(`Content definition for type "${contentType}" not found.`);
    }
    // NOTE: in the client layer, we deal with NotionModel objects
    const definition = defResult.items[0].content as IDynamicContent;
    if (!definition.dataModel) {
      log.error('Content definition has no data model', { contentType, tenantId, definition });
      throw new Error(`Content definition for type "${contentType}" has no data model.`);
    }
    // Build the indexer
    const indexer = buildIndexer(data, definition.dataModel.indexer || []) || {};
    const input: NotionModelInput = {
      type: contentType,
      content: data,
      page_id,
      parent_id,
      indexer,
      order
    };

    try {
      if (!isValidUUID(blockId)) {
        throw new Error(`Invalid block ID: ${blockId}`);
      }
      const result = await this.query(
        contentOperations.replaceContent,
        { blockId, input }
      );

      // Wrap the replaced NotionModel in a PrismContentResult
      const replacedModel = result.replaceNotionModel;
      return {
        total: 1,
        items: [replacedModel],
        hasMore: false
      };
    } catch (error) {
      log.error('Error replacing content', { contentType, blockId, tenantId, error });
      return {
        total: 0,
        items: [],
        hasMore: false
      }
    }
  }

  /**
   * Delete content by ID
   */
  async deleteContent(blockId: string): Promise<boolean> {
    if (!isValidUUID(blockId)) {
      throw new Error(`Invalid block ID: ${blockId}`);
    }

    try {
      const result = await this.query(
        contentOperations.deleteContent,
        { blockId }
      );

      return result.deleteNotionModel;
    } catch (error) {
      log.error('Error deleting content', { blockId, error });
      return false;
    }
  }

  // ===== DEFINITION OPERATIONS =====

  /**
   * List all content definitions
   */
  async listDefinitions(tenantId: string | undefined = undefined): Promise<PrismContentResult> {
    try {
      let result: any;
      if (tenantId && tenantId !== 'any') {
        // List definitions for specific tenant
        if (!isValidUUID(tenantId)) {
          throw new Error(`Invalid tenant ID: ${tenantId}`);
        }

        result = await this.query(
          definitionOperations.listDefinitionsForTenant,
          { tenantId }
        );
      } else {
        // List all definitions (cross-tenant)
        result = await this.query(
          definitionOperations.listDefinitions,
          {}
        );
      }

      const processedResult = {
        total: result.notionModel.length,
        items: result.notionModel.map((item: NotionModel) => ({
          ...item,
          content: fixBorkedContent(item.content)
        })),
        hasMore: false // Definition list is typically small and complete
      };

      return processedResult;
    } catch (error) {
      log.error('Error listing definitions', { tenantId, error });
      return {
        total: 0,
        items: [],
        hasMore: false
      };
    }
  }

  /**
   * Find content definition by type
   */
  async findDefinition(
    definitionType: string,
    inboundTenantId: string
  ): Promise<PrismContentResult> {
    // When finding a definition, we're looking for a NotionModel with:
    // 1. type === 'DynamicContent'
    // 2. indexer.dynamicBlockType === definitionType
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(definitionType);

    if (isUuid) {
      // If it's a UUID, use findDefinitionById instead
      try {
        if (!definitionType) {
          throw new Error('DynamicContent type must have a dynamicBlockType');
        }

        const result = await this.query(
          definitionOperations.findDefinitionById,
          { page_id: definitionType }
        );

        const processedResult = {
          total: result.notionModelByPageId ? 1 : 0,
          items: result.notionModelByPageId ? [{
            ...result.notionModelByPageId,
            content: fixBorkedContent(result.notionModelByPageId.content)
          }] : [],
          hasMore: false
        };

        return processedResult;
      } catch (error) {
        log.error('Error finding definition by ID', { definitionType, error });
        return {
          total: 0,
          items: [],
          hasMore: false
        };
      }
    } else {
      // For string types, use the new typed query with corrected tenant logic
      // Correct the search.  If the requested definition type is a platform type,
      // squash tenantId.
      if (!definitionType) {
        throw new Error('DynamicContent type must have a dynamicBlockType');
      }
      if (process.env.DEBUG_PRISM === 'true') {
        log.debug('Given tenant ID for definition type', { definitionType, inboundTenantId });
      }
      let tenantId: string | undefined = inboundTenantId;
      if (isPlatformContentDefinition(definitionType)) {
        if (process.env.DEBUG_PRISM === 'true') {
          log.debug('Squashing tenant ID for platform definition type', { definitionType, tenantId });
        }
        // If it's a platform content definition, squash the tenantId
        tenantId = undefined;
      } else {
        if (!isValidUUID(tenantId)) {
          throw new Error(`Invalid tenant ID: ${tenantId}`);
        }
        if (process.env.DEBUG_PRISM === 'true') {
          log.debug('Resolved tenant ID for non-platform definition', { definitionType, tenantId });
        }
      }

      let result: any;
      if (tenantId && tenantId !== 'any') {
        // If specific tenantId is provided, search with it
        try {
          if (!isValidUUID(tenantId)) {
            throw new Error(`Invalid tenant ID: ${tenantId}`);
          }

          if (process.env.DEBUG_PRISM === 'true') {
            log.debug('Finding definition for type with tenant', { definitionType, tenantId });
          }
          result = await this.query(
            definitionOperations.findDefinition,
            {
              type: definitionType
            }
          );


          // Filter results to only include definitions for this tenant
          const filteredItems = result.notionModel
            .filter((item: NotionModel) => item.parent_id === tenantId)
            .map((item: NotionModel) => ({
              ...item,
              content: fixBorkedContent(item.content)
            }));
          const processedResult = {
            total: filteredItems.length,
            items: filteredItems,
            hasMore: false
          };
          if (process.env.DEBUG_PRISM === 'true' && filteredItems.length > 0) {
            log.debug('Found definition for type and tenant', { definitionType, tenantId, count: filteredItems.length });
          }

          return processedResult;
        } catch (error) {
          log.error('Error finding definition for tenant', { definitionType, inboundTenantId, error });
          return {
            total: 0,
            items: [],
            hasMore: false
          };
        }
      } else {
        // If no tenantId or 'any', search for platform definitions (parent_id: null)
        try {
          if (process.env.DEBUG_PRISM === 'true') {
            log.debug('Searching for platform definition without tenant', { definitionType });
          }
          result = await this.query(
            definitionOperations.findDefinition,
            {
              type: definitionType,
            }
          );
          // filter out any definitions that have parent_ids
          let filteredItems = result.notionModel
            .filter((item: NotionModel) => !item.parent_id)
            .map((item: NotionModel) => ({
              ...item,
              content: fixBorkedContent(item.content)
            }));
          const dbDefinitionPage = filteredItems.length > 0 ? (filteredItems[0] as NotionModel) : null;

          try {
            // Patch the item with the hardcoded definition if available
            const definition = getPlatformContentDefinition(definitionType);
            if (dbDefinitionPage) {
              if (!definition) {
                throw new Error(`No hardcoded definition found for platform type "${definitionType}"`);
              }
              // Only patch if the content is different
              const definitionStr = JSON.stringify(definition);
              const currentContentStr = JSON.stringify(dbDefinitionPage.content);
              if (currentContentStr !== definitionStr) {
                if (process.env.DEBUG_PRISM === 'true') {
                  log.info('Platform definition outdated; patching with hardcoded definition', { definitionType });
                }
                // Replace the content with the hardcoded definition
                dbDefinitionPage.content = definition;
                filteredItems = [dbDefinitionPage]; // Use the patched item
                // update the DB definition
                await this.replaceDefinition(dbDefinitionPage.block_id, dbDefinitionPage.content);
                if (process.env.DEBUG_PRISM === 'true') {
                  log.info('Patched platform definition', { definitionType });
                }
              }
            } else {
              // No definition found in DB, create it
              const definition = getPlatformContentDefinition(definitionType);
              if (!definition) {
                throw new Error(`No hardcoded definition found for platform type "${definitionType}"`);
              }
              if (process.env.DEBUG_PRISM === 'true') {
                log.info('Creating new platform definition', { definitionType });
              }
              const newDefModel = await this.createDefinitionDirect(definition, '');
              filteredItems = [newDefModel];
              if (process.env.DEBUG_PRISM === 'true') {
                log.info('Created platform definition', { definitionType });
              }
            }

          } catch (e) {
              log.error('Error patching platform definition', { definitionType, error: e });
            }

          const processedResult = {
            total: filteredItems.length,
            items: filteredItems,
            hasMore: false
          };
          return processedResult;
        } catch (error) {
          log.error('Error finding platform definition', { definitionType, error });
          return {
            total: 0,
            items: [],
            hasMore: false
          };
        }
      }
    }
  }

  /**
   * Create or update content definition
   * 
   * Content definitions are special NotionModels with type='DynamicContent'
   * that contain IDynamicContent objects in their content field.
   * These define the structure and behavior of other content types.
   */
  async createDefinition(definition: IDynamicContent, tenantId: string): Promise<NotionModel> {
    // For definitions, we need to create or update based on definition name
    const dynamicBlockType = definition.dataModel.block;
    if (process.env.DEBUG_PRISM === 'true') {
      log.info('Looking for existing definition', { dynamicBlockType, tenantId });
    }
    const existingDefResult = await this.findDefinition(dynamicBlockType, tenantId);

    // If the existing definition is different, update it; otherwise, create a new one
    if (existingDefResult.total > 0) {

      // Detect differences in the definition
      const existingDefModel = existingDefResult.items[0] as NotionModel;
      const existingContent = existingDefModel.content || {};
      const hasChanges = JSON.stringify(existingContent) !== JSON.stringify(definition);
      if (!hasChanges) {
        if (process.env.DEBUG_PRISM === 'true') {
          log.info('No changes detected for definition; skipping update', { dynamicBlockType });
        }
        return existingDefModel; // No changes, return existing definition
      }

      if (UPDATE_IF_DIFFERENT) {
        if (process.env.DEBUG_PRISM === 'true') {
          log.info('Updating existing definition', { dynamicBlockType });
        }
        // Update existing definition
        const parent_id = resolveParentId(definition, definition.dataModel);
        const indexer = buildIndexer(definition, definition.dataModel.indexer || []) || {};
        // Ensure dynamicBlockType is set for definition lookup (use block type, not name)
        indexer.dynamicBlockType = dynamicBlockType

        const input: NotionModelInput = {
          type: 'DynamicContent',
          content: fixBorkedContent(definition),
          parent_id,
          indexer,
        };

        try {
          if (!dynamicBlockType) {
            throw new Error('DynamicContent type must have a dynamicBlockType');
          }
          const result = await this.query(
            contentOperations.replaceContent,
            { blockId: existingDefResult.items[0].block_id, input }
          );
          // Log the result
          if (process.env.DEBUG_PRISM === 'true') {
            log.info('Updated definition', { dynamicBlockType });
          }
          return result.replaceNotionModel;
        } catch (error) {
          log.error('Error updating definition', { dynamicBlockType, error });
          return null as unknown as NotionModel;
        }
      } else {
        // do a pretty diff and log the diffs of the definition:
        if (process.env.DEBUG_PRISM === 'true') {
          log.info('Definition has been updated', { dynamicBlockType });
        }
        return existingDefModel;
      }
    }
    else {
      return await this.createDefinitionDirect(definition, tenantId);
    }
  }

  async createDefinitionDirect(definition: IDynamicContent, tenantId: string): Promise<NotionModel> {
    const dynamicBlockType = definition.dataModel.block;
    // Create new definition
    const parent_id = isPlatformContentDefinition(definition.dataModel.block) ? undefined : tenantId;
    const indexer = buildIndexer(definition, definition.dataModel.indexer || []) || {};
    // Ensure dynamicBlockType is set for definition lookup (use block type, not name)
    indexer.dynamicBlockType = dynamicBlockType;

    if (!isPlatformContentDefinition(definition.dataModel.block) && !parent_id) {
      throw new Error(`Non-platform types must provide a tenantId`);
    }

    const input: NotionModelInput = {
      type: 'DynamicContent',
      content: fixBorkedContent(definition),
      parent_id,
      indexer,
    };

    try {
      if (!dynamicBlockType) {
        throw new Error('DynamicContent type must have a dynamicBlockType');
      }
      const result = await this.query(
        definitionOperations.createDefinition,
        { input }
      );

      // Log the result
      if (parent_id) {
        if (process.env.DEBUG_PRISM === 'true') {
          log.info('Created definition for tenant', { dynamicBlockType, parentId: parent_id });
        }
      } else {
        if (process.env.DEBUG_PRISM === 'true') {
          log.info('Created platform definition', { dynamicBlockType });
        }
      }
      return result.createNotionModel;
    } catch (error) {
      log.error('Error creating definition', { dynamicBlockType, error });
      return null as unknown as NotionModel;
    }
  }

  /**
   * Delete content definition
   */
  async deleteDefinition(definitionType: string, tenantId: string = 'any'): Promise<boolean> {
    const existingDefResult = await this.findDefinition(definitionType, tenantId);

    if (existingDefResult.total > 0) {
      const existingDef = existingDefResult.items[0] as NotionModel;
      if (!definitionType) {
        throw new Error('DynamicContent type must have a dynamicBlockType');
      }
      const result = await this.query(
        definitionOperations.deleteDefinition,
        { blockId: existingDef.block_id }
      );

      return result.deleteNotionModel;
    }

    return false;
  }

  // replace definition by block ID
  async replaceDefinition(blockId: string, content: any): Promise<NotionModel> {
    try {
      if (!isValidUUID(blockId)) {
        throw new Error(`Invalid block ID: ${blockId}`);
      }
      const input: NotionModelInput = {
        type: 'DynamicContent',
        content: fixBorkedContent(content),
      };
      const result = await this.query(
        definitionOperations.replaceDefinition,
        { blockId, input }
      );

      return result.replaceNotionModel;
    } catch (error) {
      log.error('Error replacing definition', { blockId, error });
      return null as unknown as NotionModel;
    }
  }
}

/**
 * Helper to fix "borked" content where a stringified JSON object
 * has been spread into an object with numeric keys (e.g. { "0": "{", "1": "n", ... })
 */
function fixBorkedContent(content: any): any {
  // Handle stringified JSON
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (process.env.DEBUG_PRISM === 'true') {
        log.debug('Fixed stringified content definition');
      }
      // Recursively fix in case the parsed content is also borked
      return fixBorkedContent(parsed);
    } catch (e) {
      return content;
    }
  }

  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return content;
  }

  const keys = Object.keys(content);
  if (keys.length === 0) {
    return content;
  }

  // Check if keys are numeric strings
  const numericKeys = keys.filter(k => !isNaN(parseInt(k, 10)));
  
  // If we have no numeric keys, it's a regular object
  if (numericKeys.length === 0) {
    return content;
  }

  // If we have non-numeric keys other than 'length', it's likely a real object
  const nonNumericKeys = keys.filter(k => isNaN(parseInt(k, 10)));
  const otherKeys = nonNumericKeys.filter(k => k !== 'length');
  if (otherKeys.length > 0) {
    return content;
  }

  try {
    // Sort keys numerically
    const sortedKeys = numericKeys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    
    // Verify sequence (0, 1, 2, ...)
    // We can be a bit lenient, but strictly it should be sequential.
    // If it's a spread string, it will be sequential.
    if (sortedKeys[0] !== '0') {
      return content;
    }

    // Reconstruct string
    const str = sortedKeys.map(k => content[k]).join('');
    
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(str);
      if (process.env.DEBUG_PRISM === 'true') {
        log.debug('Fixed borked content definition');
      }
      // Recursively fix in case the parsed content is also borked or stringified
      return fixBorkedContent(parsed);
    } catch (e) {
      // If not JSON, maybe it was just a string?
      // But definitions are expected to be objects.
      return content;
    }
  } catch (e) {
    return content;
  }
}