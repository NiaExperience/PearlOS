/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Data Prism - Main Entry Point
 * 
 * Unified data abstraction layer that connects to the GraphQL server
 * with sophisticated business logic for multi-tenant, dynamic content management.
 * 
 * This implementation uses a standardized GraphQL client approach with
 * static queries and fragments instead of dynamic query generation.
 * 
 * Key concepts:
 * - NotionModel: The database entity with fields like block_id, page_id, type, content
 * - ContentData: The actual data contained within the content field of a NotionModel
 * - IDynamicContent: A specialized ContentData that defines the structure of other content types
 */

import { IDynamicContent } from './core/blocks/dynamicContent.block';
import { ContentData } from './core/content/types';
import { validateContentData } from './core/content/utils';
import { getLogger } from './core/logger';
import './core/email/scheduler-bootstrap';
import { PrismContentQuery, PrismContentResult } from './core/types';
import { getPlatformContentDefinition, isPlatformContentDefinition } from './core/utils/platform-definitions';
import { GraphQLClientInstance, PrismGraphQLFactory } from './data-bridge';
import { PrismGraphQLClientOptions } from './data-bridge/PrismGraphQLFactory';
import { PrismRefractory } from './refractory';

const log = getLogger('prism:core');

// Track if the process handlers are registered
let processHandlersRegistered = false;

export class Prism {
  private client: GraphQLClientInstance;
  private refractory: PrismRefractory;

  private constructor(clientOptions: PrismGraphQLClientOptions = {}) {
    // Use PrismGraphQLFactory to get a properly configured GraphQL client
    this.client = PrismGraphQLFactory.create(clientOptions);
    this.refractory = new PrismRefractory();
    
    // Register process handlers only once
    this.registerProcessHandlers();
  }

  private static instances: Record<string, Prism | undefined> = {};

  /**
   * Register process handlers to ensure proper cleanup on exit
   */
  private registerProcessHandlers() {
    if (processHandlersRegistered) {
      return;
    }
    
    // Only set up these handlers in a test environment
    if (process.env.NODE_ENV === 'test') {
      const cleanupPrism = async () => {
        try {
          let disconnected = false;
          for (const instance of Object.values(Prism.instances)) {
            if (instance) {
              await instance.disconnect();
              disconnected = true;
            }
          }
          if (disconnected) {
            log.info('Prism instances cleanup via process handler');
          }
        } catch (e) {
          // Ignore errors during cleanup
        }
      };
      
      // These handlers will work alongside the ones in globalTeardown.ts
      process.on('beforeExit', async () => {
        await cleanupPrism();
      });
      
      processHandlersRegistered = true;
    }
  }

  /**
   * Get the singleton instance of Prism
   * Creates a new instance if it doesn't exist
   */
  static async getInstance(clientOptions: PrismGraphQLClientOptions = {}): Promise<Prism> {
    const key = clientOptions.endpoint || 'default';
    if (!Prism.instances[key]) {
      Prism.instances[key] = new Prism(clientOptions);
      await Prism.instances[key].client.connect(); // Ensure the client is connected
    }
    return Prism.instances[key];
  }

  /**
   * Clear all instances and disconnect them
   * Useful for testing cleanup
   */
  static async clearInstances() {
    for (const key of Object.keys(Prism.instances)) {
      const instance = Prism.instances[key];
      if (instance) {
        await instance.disconnect();
      }
      delete Prism.instances[key];
    }
  }

  /**
   * Create new content
   * Supports using page_id as the main identification for notion blocks
   */
  async create(blockType: string, data: ContentData, tenantId?: string) : Promise<PrismContentResult> {
    // Apply business rules to the data if needed
    const processedData = this.applyBusinessRules(data, blockType, tenantId);
    // Create content using the GraphQL client
    const result = await this.client.createContent(
      blockType,
      processedData,
      tenantId || 'any'
    );
    if (!result) {
      // This typically indicates the GraphQL mutation returned null (often alongside errors).
      // Throw a clearer error instead of crashing downstream in applyBusinessLogic.
      throw new Error(`Failed to create content: createContent returned null (type=${blockType}, tenant=${tenantId || 'any'})`);
    }
    return this.applyBusinessLogic({
      total: 1,
      items: [result],
      hasMore: false
    });
  }

  /**
   * Create new content
   * Supports using page_id as the main identification for notion blocks
   */
  async bulkCreate(blockType: string, data: ContentData[], tenantId?: string) {
    // Apply business rules to the data if needed
    const processedData = data.map(item => this.applyBusinessRules(item, blockType, tenantId));
    // Create content using the GraphQL client
    return await this.client.bulkCreateContent(
      blockType,
      processedData,
      tenantId || 'any'
    );
  }
  
  /**
   * Find content matching a query
   * Supports querying by page_id as the primary identifier
   * Enhanced with provider routing
   */
  async query(query: PrismContentQuery) {
    const result = await this.client.findContent(
      query.contentType,
      query.where,
      query.limit,
      query.offset,
      this.convertOrderBy(query.orderBy),
      query.tenantId
    );

    // Apply business logic to the results
    return this.applyBusinessLogic(result);
  }
  
  /**
   * Delete content by id
   * Uses page_id as the main identifier for notion blocks
   */
  async delete(blockType: string, pageId: string, tenantId?: string) {
    // First find the content to get its block_id
    const where: Record<string, any> = {
      type: { eq: blockType },
      page_id: { eq: pageId }
    };

    // TODO: ensure the user has permission to delete this content in the tenant
  // IMPORTANT: pass tenantId through so tenant-scoped definitions resolve correctly
  const result = await this.client.findContent(blockType, where, undefined, undefined, undefined, tenantId);
    if (result.total === 0) {
      return false; // No content found to delete
    }
    
    const blockId = result.items[0].block_id;
    return await this.client.deleteContent(blockId);
  }
  
  /**
   * Update content by id (merge semantics)
   * Uses page_id for finding the content, and block_id for the update operation when needed
   * Merges provided fields with existing content - does not remove fields.
   */
  async update(blockType: string, page_id: string, data: ContentData, tenantId?: string) : Promise<PrismContentResult> {
    // First find the content to get its block_id
    const where: Record<string, any> = {
      type: { eq: blockType },
      page_id: { eq: page_id }
    };
    
  // IMPORTANT: pass tenantId through so tenant-scoped definitions resolve correctly (avoids Invalid tenant ID: any)
  const existingResult = await this.client.findContent(blockType, where, undefined, undefined, undefined, tenantId);
    if (existingResult.total === 0) {
      throw new Error(`Content not found with id: ${page_id}`);
    }
    
    const processedData = this.applyBusinessRules(data, blockType, tenantId);
    // Extract any metadata that should be updated at the NotionModel level
    const { parent_id, order } = processedData;
    
    const blockId = existingResult.items[0].block_id;
    const result = await this.client.updateContent(
      blockId, 
      blockType, 
      processedData,
      page_id,
      parent_id,
      order,
      tenantId
    );
    // updateContent now returns PrismContentResult, so apply business logic directly to it
    return this.applyBusinessLogic(result);
  }
  
  /**
   * Replace content by id (full replacement semantics)
   * Uses page_id for finding the content, and block_id for the replace operation when needed
   * Completely replaces content - removes fields not present in the provided data.
   * Use this when users need to delete fields (e.g., removing metadata properties).
   */
  async replace(blockType: string, page_id: string, data: ContentData, tenantId?: string) : Promise<PrismContentResult> {
    // First find the content to get its block_id
    const where: Record<string, any> = {
      type: { eq: blockType },
      page_id: { eq: page_id }
    };
    
  // IMPORTANT: pass tenantId through so tenant-scoped definitions resolve correctly (avoids Invalid tenant ID: any)
  const existingResult = await this.client.findContent(blockType, where, undefined, undefined, undefined, tenantId);
    if (existingResult.total === 0) {
      throw new Error(`Content not found with id: ${page_id}`);
    }
    
    const processedData = this.applyBusinessRules(data, blockType, tenantId);
    // Extract any metadata that should be updated at the NotionModel level
    const { parent_id, order } = processedData;
    
    const blockId = existingResult.items[0].block_id;
    const result = await this.client.replaceContent(
      blockId, 
      blockType, 
      processedData,
      page_id,
      parent_id,
      order,
      tenantId
    );
    // replaceContent now returns PrismContentResult, so apply business logic directly to it
    return this.applyBusinessLogic(result);
  }
  
  /**
   * Register a new data source
   * Uses the refractory to perform schema introspection and create data source definitions
   */
  async registerDataSource(sourceType: string, connectionConfig: any, tenantId?: string) {
    // Validate source type
    if (!this.refractory) {
      throw new Error('Refractory is not initialized');
    }
    const validSourceTypes = ['sql', 'mongodb', 'openapi', 'graphql'];
    if (!validSourceTypes.includes(sourceType)) {
      throw new Error(`Unsupported source type: ${sourceType}. Valid types are: ${validSourceTypes.join(', ')}`);
    }

    log.info('Finding schema for data source', { sourceType, connectionConfig });
    try {
      // Use refractory to refract the schema and get suggestions
      const refractionResult = await this.refractory.refractSchema(
        sourceType as 'sql' | 'mongodb' | 'openapi' | 'graphql',
        connectionConfig
      );
      
      log.info('Refractory produced schema', { dataModel: refractionResult.dataModel, suggestedMappings: refractionResult.suggestedMappings });
      // Create a dynamic content definition based on the refraction result
      const definition: IDynamicContent = {
        name: `${refractionResult.dataModel.block} content type`, // Use the block name as the definition name
        description: `Auto-generated definition from ${sourceType} source`,
        dataModel: refractionResult.dataModel,
        tenantId: tenantId || 'any', // TODO: lockdown platform-level content creation to nia admin user
        uiConfig: {
          labels: {},
          listView: { displayFields: [] },
          detailView: { displayFields: [] }
        },
        access: {
          allowAnonymous: true
        }
      };

      log.info('Creating definition from refracted schema', { sourceType, tenantId: definition.tenantId });
      // Create the content definition
      const createdDef = await this.createDefinition(definition, tenantId);
      if (!createdDef || createdDef.total === 0 || !createdDef.items[0]) {
        throw new Error(`Failed to create definition for ${sourceType}`);
      }
      log.info('Created definition from refracted schema', { sourceType, definitionId: createdDef.items[0]?._id });

      return {
        success: true,
        definition: createdDef.items[0],
        suggestedMappings: refractionResult.suggestedMappings
      };
    } catch (error) {
      log.error('Error registering data source', { sourceType, error });
      throw new Error(`Failed to register ${sourceType} data source: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate content data against its definition schema
   * This incorporates validation logic that was previously in the orchestrator
   */
  async validate(blockType: string, data: ContentData, tenantId?: string): Promise<{ valid: boolean; errors?: string[] }> {
    try {
      log.info('Validating content data for block type', { blockType, tenantId, data });
      // Find the content definition for this block type
      const definitionResult = await this.findDefinition(blockType, tenantId);
      if (definitionResult.total === 0) {
        return {
          valid: false,
          errors: [`No definition found for content type: ${blockType}`]
        };
      }

      const definition = definitionResult.items[0];

      const result = validateContentData(data, definition.dataModel);
      if (result.success) {
        return { valid: true };
      } else {
        return {
          valid: false,
          errors: Object.keys(result.errors || {}).map(err => `${err}: ${result.errors ? result.errors[err] : 'Unknown error'}`)
        };
      }
    } catch (error) {
      return {
        valid: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Get available data source types and their configurations
   * This provides introspection capabilities that were in the orchestrator
   */
  getAvailableDataSources(): Array<{ type: string; description: string; configSchema: any }> {
    return [
      {
        type: 'sql',
        description: 'SQL Database (PostgreSQL, MySQL, SQLite)',
        configSchema: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            port: { type: 'number' },
            database: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' },
            ssl: { type: 'boolean', default: false }
          },
          required: ['host', 'database', 'username', 'password']
        }
      },
      {
        type: 'mongodb',
        description: 'MongoDB Database',
        configSchema: {
          type: 'object',
          properties: {
            connectionString: { type: 'string' },
            collection: { type: 'string' }
          },
          required: ['connectionString', 'collection']
        }
      },
      {
        type: 'openapi',
        description: 'OpenAPI/REST API',
        configSchema: {
          type: 'object',
          properties: {
            specUrl: { type: 'string' },
            basePath: { type: 'string' },
            apiKey: { type: 'string' }
          },
          required: ['specUrl']
        }
      },
      {
        type: 'graphql',
        description: 'GraphQL API',
        configSchema: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
            headers: { type: 'object' }
          },
          required: ['endpoint']
        }
      }
    ];
  }
  
  /**
   * List all content definitions (blockTypes)
   * 
   * Returns IDynamicContent objects that define the structure and behavior
   * of other content types. These definitions are essential for introspecting
   * and working with arbitrary data structures stored in NotionModel blocks.
   */
  async listDefinitions(tenantId?: string): Promise<PrismContentResult> {
    const result = await this.client.listDefinitions(tenantId);
    
    // Apply business logic to the results
    return this.applyBusinessLogic(result);
  }
  
  /**
   * Find content definition by type/name
   * 
   * Locates a specific NotionModel with type='DynamicContent' where the content.name
   * matches the requested definitionType. These definitions contain the schema, UI config,
   * and other metadata needed to work with specific content types stored in other
   * NotionModel records. Essential for introspecting arbitrary data structures.
   */
  async findDefinition(blockType: string, tenantId: string = 'any'): Promise<PrismContentResult> {
    // Normalize empty string to 'any' for platform content lookup
    const normalizedTenantId = (!tenantId || tenantId === '' || isPlatformContentDefinition(blockType)) ? 'any' : tenantId;
    if (process.env.DEBUG_PRISM === 'true') {
      log.debug('Finding definition for blockType', { blockType, tenantId, normalizedTenantId });
    }
    let result: PrismContentResult = { total: 0, items: [], hasMore: false };
    try {
      result = await this.client.findDefinition(blockType, normalizedTenantId);
    } catch (_) {
      // Ignore errors during lookup
    }
    // Defensive guard: ensure result shape even if client returns undefined/null
    if (!result || !Array.isArray((result as any).items) || result.total === 0) {
      if (isPlatformContentDefinition(blockType)) {
        // create the content definition on the fly
        if (process.env.DEBUG_PRISM === 'true') {
          log.debug('Auto-creating platform content definition for missing type', { blockType });
        }
        const definition = getPlatformContentDefinition(blockType);
        if (definition) {
          const created = await this.client.createDefinition(definition, 'any');
          if (created && created.content) {
            if (process.env.DEBUG_PRISM === 'true') {
              log.debug('Successfully created platform content definition', { blockType });
            }
            result = { total: 1, items: [created.content], hasMore: false };
          }
          else {
            log.error('Failed to auto-create platform content definition', { blockType });
            result = { total: 0, items: [], hasMore: false } as any;
          }
        } else {
          log.error('No platform content definition found in index', { blockType });
          result = { total: 0, items: [], hasMore: false } as any;
        }
      } else {
        log.error('No content definition found', { blockType, tenantId: normalizedTenantId });
        result = { total: 0, items: [], hasMore: false } as any;
      }
    }
    
    // Apply tenant filtering if needed
    if (normalizedTenantId && normalizedTenantId !== 'any') {
      const filteredItems = result.items.filter((item: any) => {
        const content = item.content as IDynamicContent;
        return !content.tenantId || content.tenantId === normalizedTenantId;
      });
      
      result = {
        total: filteredItems.length,
        items: filteredItems,
        hasMore: result.hasMore
      };
    }
    // Apply business logic to the results
    return this.applyBusinessLogic(result);
  }
  
  /**
   * Create or update content definition
   * 
   * Stores an IDynamicContent object as the content of a NotionModel with type='DynamicContent'.
   * This is the core mechanism for defining new content types at runtime without code changes.
   * The IDynamicContent includes jsonSchema, UI preferences, and other metadata that the
   * system uses to create, display, and validate instances of this content type.
   */
  async createDefinition(definition: IDynamicContent, tenantId: string = 'any'): Promise<PrismContentResult> {
    const result = await this.client.createDefinition(definition, tenantId);
    if (!result) {
      throw new Error(`Failed to create definition for ${definition.name}`);
    }
    // Apply business logic to the results
    return this.applyBusinessLogic({
      total: 1,
      items: [result],
      hasMore: false
    });
  }
  
  /**
   * Delete content definition
   * Important for managing NotionModel block definitions
   */
  async deleteDefinition(blockType: string, tenantId: string): Promise<boolean> {
    if (process.env.DEBUG_PRISM === 'true') {
      log.debug('Deleting definition', { blockType, tenantId });
    }
    return await this.client.deleteDefinition(blockType, tenantId);
  }
  
  /**
   * Get Prism status
   */
  getStatus() {
    return {
      state: 'active',
      services: {
        graphQLClient: 'connected',
        refractory: 'initialized'
      }
    };
  }
  
  /**
   * Check if the system is ready
   * Tests the connection by trying to perform a simple query
   */
  async isReady(): Promise<boolean> {
    try {
      // Test the connection by trying to list definitions
      // This is a lightweight operation that will fail if the client isn't connected
      await this.client.listDefinitions();
      return true;
    } catch (error) {
      log.warn('Prism connection check failed', { error });
      return false;
    }
  }

  /**
   * Apply business rules to the content data before creating or updating
   * This replaces the functionality from ContentActions
   */
  private applyBusinessRules(data: ContentData, blockType: string, tenantId?: string): ContentData {
    // Placeholder for any business logic that needs to be applied    
    return data;
  }
  
  /**
   * Apply business logic to query results
   */
  private applyBusinessLogic(result: any): PrismContentResult {
    // Post-processing logic
    // Transform notion models into ContentData objects
    const rawItems = Array.isArray(result?.items) ? result.items : [];
    const safeItems = rawItems.filter(Boolean);
    const processedResult = {
      total: typeof result?.total === 'number' ? result.total : safeItems.length,
      items: safeItems.map((item: any) => {
        // Handle both string (from serialization) and object (from JSONB) content
        let content: ContentData;
        if (typeof item.content === 'string') {
          try {
            content = JSON.parse(item.content) as ContentData;
          } catch {
            // If parse fails, treat as raw content
            content = { data: item.content } as ContentData;
          }
        } else if (item.content && typeof item.content === 'object') {
          content = item.content as ContentData;
        } else {
          // Handle null/undefined content
          content = {} as ContentData;
        }
        content._id = item.page_id; // Ensure _id is set for ContentData
        return content;
      }),
      hasMore: !!result?.hasMore
    };
    return processedResult
  }
  
  /**
   * Convert order by object to GraphQL format
   */
  private convertOrderBy(orderBy?: Record<string, 'asc' | 'desc'>): { field: string, direction: 'ASC' | 'DESC' }[] {
    if (!orderBy) return [];
    
    return Object.entries(orderBy).map(([field, direction]) => ({
      field,
      direction: direction.toUpperCase() as 'ASC' | 'DESC'
    }));
  }

  /**
   * Disconnect and clean up resources
   * Call this during test teardown to prevent open handles
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
  }

}

// Export all modules for external use
export * from './core';
export * from './data-bridge';
export * from './refractory';

