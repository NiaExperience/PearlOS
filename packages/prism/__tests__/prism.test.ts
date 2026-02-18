/**
 * Comprehensive tests for the Prism class
 * Tests all methods including previously untested ones: registerDataSource, validate, getAvailableDataSources
 */

import { v4 as uuidv4 } from 'uuid';

import { IDynamicContent } from '../src/core/blocks/dynamicContent.block';
import { Prism } from '../src/prism';
import { createTestTenant } from '../src/testing/testlib';

describe('Prism', () => {
  let prism: Prism;
  let mockRefractory: any;
  let tenantId: string;

  beforeEach(async () => {
    // Get Prism instance
    prism = await Prism.getInstance();
    tenantId = (await createTestTenant())._id!;  
    // Mock refractory
    mockRefractory = {
      refractSchema: jest.fn()
    };
    
    // Mock the private properties by directly setting them
    (prism as any).refractory = mockRefractory;
  });

  describe('registerDataSource', () => {
    it('should successfully register a SQL data source', async () => {
      const mockRefractionResult = {
        dataModel: {
          block: 'sql-source',
          jsonSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' }
            }
          }
        },
        provider: {
          type: 'sql' as const,
          connection: 'postgres://localhost:5432/testdb'
        },
        suggestedMappings: [
          { sourceField: 'id', targetField: 'user_id', type: 'string', required: true },
          { sourceField: 'name', targetField: 'user_name', type: 'string', required: false }
        ]
      };

      mockRefractory.refractSchema.mockResolvedValue(mockRefractionResult);
      const connectionConfig = {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'testuser',
        password: 'testpass'
      };

      const result = await prism.registerDataSource('sql', connectionConfig, tenantId);
      expect(mockRefractory.refractSchema).toHaveBeenCalledWith('sql', connectionConfig);
      expect(result.success).toBe(true);
      expect(result.definition).toBeDefined();
      expect(result.definition.dataModel.block).toBe('sql-source');
      expect(result.suggestedMappings).toEqual(mockRefractionResult.suggestedMappings);
    });

    it('should reject unsupported source types', async () => {
      await expect(prism.registerDataSource('unsupported', {})).rejects.toThrow(
        'Unsupported source type: unsupported. Valid types are: sql, mongodb, openapi, graphql'
      );
    });

    it('should handle refractory errors gracefully', async () => {
      mockRefractory.refractSchema.mockRejectedValue(new Error('Connection failed'));

      await expect(prism.registerDataSource('sql', {})).rejects.toThrow(
        'Failed to register sql data source: Connection failed'
      );
    });

    it('should register each valid source type', async () => {
      const mockRefractionResult = {
        dataModel: { 
          block: 'test-source',
          jsonSchema: {} 
        },
        provider: {
          type: 'sql' as const,
          connection: 'test-connection'
        },
        suggestedMappings: []
      };
      
      mockRefractory.refractSchema.mockResolvedValue(mockRefractionResult);

      const validTypes = ['sql', 'mongodb', 'openapi', 'graphql'];
      
      for (const sourceType of validTypes) {
        await prism.registerDataSource(sourceType, {}, tenantId);
        expect(mockRefractory.refractSchema).toHaveBeenCalledWith(sourceType, {});
      }
      
      expect(mockRefractory.refractSchema).toHaveBeenCalledTimes(validTypes.length);
    });
  });

  describe('validate', () => {
    it('should validate content data successfully', async () => {
      const mockDefinition: IDynamicContent = {
        name: 'testType',
        description: 'Test content type',
        dataModel: {
          block: 'testType',
          jsonSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              age: { type: 'number' }
            }
          }
        },
        tenantId: tenantId,
        uiConfig: { labels: {}, listView: { displayFields: [] }, detailView: { displayFields: [] } },
        access: { allowAnonymous: true }
      };

      const created = await prism.createDefinition(mockDefinition, tenantId);
      const testData = { title: 'Test Title', age: 25 };
      const result = await prism.validate('testType', testData, tenantId);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return validation errors when content is invalid', async () => {
      const mockDefinition: IDynamicContent = {
        name: 'testType',
        description: 'Test content type',
        dataModel: {
          block: 'testType',
          jsonSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              age: { type: 'number'}
            },
            required: ['title']
          }
        },
        tenantId: tenantId,
        uiConfig: { labels: {}, listView: { displayFields: [] }, detailView: { displayFields: [] } },
        access: { allowAnonymous: true }
      };

      const created = await prism.createDefinition(mockDefinition, tenantId);
      expect(created).toBeDefined();
      const result = await prism.validate('testType', {}, tenantId);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        "#/required: must have required property 'title'"
      ]);
    });

    it('should handle missing content definition', async () => {
      const result = await prism.validate('nonexistentType', {}, tenantId);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['No definition found for content type: nonexistentType']);
    });
  });

  describe('getAvailableDataSources', () => {
    it('should return all available data source types', () => {
      const dataSources = prism.getAvailableDataSources();

      expect(dataSources).toHaveLength(4);
      
      // Check SQL data source
      const sqlSource = dataSources.find(ds => ds.type === 'sql');
      expect(sqlSource).toBeDefined();
      expect(sqlSource?.description).toBe('SQL Database (PostgreSQL, MySQL, SQLite)');
      expect(sqlSource?.configSchema.properties).toHaveProperty('host');
      expect(sqlSource?.configSchema.properties).toHaveProperty('database');
      expect(sqlSource?.configSchema.required).toContain('host');
      expect(sqlSource?.configSchema.required).toContain('database');

      // Check MongoDB data source
      const mongoSource = dataSources.find(ds => ds.type === 'mongodb');
      expect(mongoSource).toBeDefined();
      expect(mongoSource?.description).toBe('MongoDB Database');
      expect(mongoSource?.configSchema.properties).toHaveProperty('connectionString');
      expect(mongoSource?.configSchema.required).toContain('connectionString');

      // Check OpenAPI data source
      const openApiSource = dataSources.find(ds => ds.type === 'openapi');
      expect(openApiSource).toBeDefined();
      expect(openApiSource?.description).toBe('OpenAPI/REST API');

      // Check GraphQL data source
      const graphqlSource = dataSources.find(ds => ds.type === 'graphql');
      expect(graphqlSource).toBeDefined();
      expect(graphqlSource?.description).toBe('GraphQL API');
    });

    it('should return consistent schema structures', () => {
      const dataSources = prism.getAvailableDataSources();

      dataSources.forEach(dataSource => {
        expect(dataSource).toHaveProperty('type');
        expect(dataSource).toHaveProperty('description');
        expect(dataSource).toHaveProperty('configSchema');
        expect(dataSource.configSchema).toHaveProperty('type', 'object');
        expect(dataSource.configSchema).toHaveProperty('properties');
        expect(typeof dataSource.type).toBe('string');
        expect(typeof dataSource.description).toBe('string');
      });
    });
  });

  describe('Core CRUD methods', () => {
    beforeEach(async () => {
      const mockDefinition: IDynamicContent = {
        name: 'testType',
        description: 'Test content type',
        dataModel: {
          block: 'testType',
          jsonSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              age: { type: 'number' }
            }
          },
          indexer: ['title']
        },
        tenantId: tenantId,
        uiConfig: { labels: {}, listView: { displayFields: [] }, detailView: { displayFields: [] } },
        access: { allowAnonymous: true }
      };

      const created = await prism.createDefinition(mockDefinition, tenantId);
      expect(created).toBeDefined();
      expect(created.total).toBe(1);
      expect(created.items[0].dataModel.block).toBe('testType');
    });

    it('should create content successfully', async () => {
      const result = await prism.create('testType', { title: 'Test Content' }, tenantId);
      expect(result.total).toEqual(1);
      expect(result.items[0].title).toEqual('Test Content');
    });

    it('should query content successfully', async () => {
      const query = {
        contentType: 'testType',
        tenantId: tenantId,
        where: { indexer: { path: 'title', equals: 'Test' } }
      };

      const created = await prism.create('testType', { title: 'Test' }, tenantId);
      expect(created.total).toEqual(1);
      expect(created.items[0].title).toBe('Test');
      const result = await prism.query(query);
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Test');
    });

    it('should update content successfully', async () => {
      const created = await prism.create('testType', { title: 'Test Content' }, tenantId);
      expect(created.total).toEqual(1);
      expect(created.items[0].title).toBe('Test Content');
      const updated = await prism.update('testType', created.items[0]._id, { title: 'Updated' }, tenantId);
      expect(updated.total).toEqual(1);
      expect(updated.items[0].title).toBe('Updated');
    });

    it('should delete content successfully', async () => {
      const created = await prism.create('testType', { title: 'Test Content' }, tenantId);
      expect(created.total).toEqual(1);
      expect(created.items[0].title).toBe('Test Content');
      const result = await prism.delete('testType', created.items[0]._id, tenantId);
      expect(result).toBe(true);
    });
  });

  describe('Definition management', () => {
    let definitionTenantId: string;

    beforeAll(async () => {
      // Create a shared tenant for definition tests
      definitionTenantId = (await createTestTenant())._id!;
    });

    it('should create definition successfully', async () => {
      const definition: IDynamicContent = {
        name: 'Test definition type',
        description: 'Test definition',
        dataModel: {
          block: 'testDefinition',
          jsonSchema: { type: 'object', properties: {} }
        },
        tenantId: 'test-tenant',
        uiConfig: { labels: {}, listView: { displayFields: [] }, detailView: { displayFields: [] } },
        access: { allowAnonymous: true }
      };
      const result = await prism.createDefinition(definition, definitionTenantId);
      
      expect(result).toBeDefined();
      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Test definition type');
      expect(result.items[0].dataModel.block).toBe('testDefinition');
    });

    it('should list definitions successfully', async () => {
      const result = await prism.listDefinitions(definitionTenantId);
      expect(result.total).toBeGreaterThan(0);
    });
  });

  afterAll(async () => {
    if (prism) {
      await prism.disconnect();
    }
  });
});
