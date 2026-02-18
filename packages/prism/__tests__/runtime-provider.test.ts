/** * Runtime Provider System Tests * 
 * Tests the ability to register and use data sources at runtime using real Prism APIs
 * Validates data source registration, validation, and introspection capabilities
 */
import { Prism } from '../src/prism';
import { createTestTenant } from '../src/testing/testlib';
import { ITenant } from '../src/core/blocks/tenant.block';
import { v4 as uuidv4 } from 'uuid';

describe('Runtime Provider System', () => {
  let prism: Prism;
  let mockRefractory: any;
  let testTenant: ITenant;
  let testTenantCrm: ITenant;
  let testTenantShop: ITenant;
  let testTenantExternal: ITenant;
  let testTenantBlog: ITenant;
  let testTenantNested: ITenant;
  let testTenantWarehouse: ITenant;

  beforeEach(async () => {
    // Get real Prism instance
    prism = await Prism.getInstance();
    
    // Create valid test tenants with UUIDs
    testTenant = await createTestTenant({ name: `Test Tenant ${uuidv4()}`, domain: 'test.com' });
    testTenantCrm = await createTestTenant({ name: `CRM Tenant ${uuidv4()}`, domain: 'crm.com' });
    testTenantShop = await createTestTenant({ name: `Shop Tenant ${uuidv4()}`, domain: 'shop.com' });
    testTenantExternal = await createTestTenant({ name: `External Tenant ${uuidv4()}`, domain: 'external.com' });
    testTenantBlog = await createTestTenant({ name: `Blog Tenant ${uuidv4()}`, domain: 'blog.com' });
    testTenantNested = await createTestTenant({ name: `Nested Tenant ${uuidv4()}`, domain: 'nested.com' });
    testTenantWarehouse = await createTestTenant({ name: `Warehouse Tenant ${uuidv4()}`, domain: 'warehouse.com' });

    // Create a realistic mock refractory that returns proper data structures
    mockRefractory = {
      refractSchema: jest.fn()
    };
    
    // Only mock the refractory for schema introspection
    (prism as any).refractory = mockRefractory;
  });

  afterAll(async () => {
    if (prism) {
      await prism.disconnect();
    }
  });

  describe('Data Source Registration via Prism API', () => {
    it('registers SQL data source successfully', async () => {
      // Mock refractory to return a realistic SQL schema introspection result
      const mockSqlRefractionResult = {
        dataModel: {
          block: 'customers',
          jsonSchema: {
            type: 'object',
            title: 'Customer',
            properties: {
              id: { type: 'integer', description: 'Primary key' },
              name: { type: 'string', description: 'Customer name' },
              email: { type: 'string', format: 'email' },
              created_at: { type: 'string', format: 'date-time' },
              status: { type: 'string', enum: ['active', 'inactive'] }
            },
            required: ['id', 'name', 'email']
          }
        },
        provider: {
          type: 'sql' as const,
          connection: 'postgresql://user:pass@localhost:5432/crm',
          schema: 'public'
        },
        suggestedMappings: [
          { targetField: 'customer_id', sourceField: 'id', type: 'integer', required: true },
          { targetField: 'customer_name', sourceField: 'name', type: 'string', required: true },
          { targetField: 'email_address', sourceField: 'email', type: 'string', required: true },
          { targetField: 'created_date', sourceField: 'created_at', type: 'string', required: false },
          { targetField: 'account_status', sourceField: 'status', type: 'string', required: false }
        ]
      };

      mockRefractory.refractSchema.mockResolvedValue(mockSqlRefractionResult);

      const connectionConfig = {
        host: 'localhost',
        port: 5432,
        database: 'crm',
        username: 'app_user',
        password: 'secure_password',
        ssl: false
      };

      // Use real Prism API to register the data source
      const result = await prism.registerDataSource('sql', connectionConfig, testTenantCrm._id);

      // Verify the registration was successful
      expect(result.success).toBe(true);
      expect(result.definition).toBeDefined();
      expect(result.suggestedMappings).toHaveLength(5);
      
      // Verify the refractory was called with correct parameters
      expect(mockRefractory.refractSchema).toHaveBeenCalledWith('sql', connectionConfig);
      
      // Verify the created definition result has the expected structure
      expect(result.definition.dataModel).toBeDefined();
      expect(result.definition.dataModel.block).toBe('customers');
    });

    it('registers MongoDB data source successfully', async () => {
      const mockMongoRefractionResult = {
        dataModel: {
          block: 'products',
          jsonSchema: {
            type: 'object',
            title: 'Product',
            properties: {
              _id: { type: 'string', description: 'MongoDB ObjectId' },
              name: { type: 'string' },
              price: { type: 'number', minimum: 0 },
              category: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              inStock: { type: 'boolean' }
            },
            required: ['_id', 'name', 'price']
          }
        },
        provider: {
          type: 'mongodb' as const,
          connection: 'mongodb://localhost:27017/ecommerce',
          collection: 'products'
        },
        suggestedMappings: [
          { targetField: '_id', sourceField: '_id', type: 'string', required: true },
          { targetField: 'product_name', sourceField: 'name', type: 'string', required: true },
          { targetField: 'unit_price', sourceField: 'price', type: 'number', required: true }
        ]
      };

      mockRefractory.refractSchema.mockResolvedValue(mockMongoRefractionResult);

      const connectionConfig = {
        connectionString: 'mongodb://localhost:27017/ecommerce',
        collection: 'products'
      };

      const result = await prism.registerDataSource('mongodb', connectionConfig, testTenantShop._id);

      expect(result.success).toBe(true);
      expect(result.definition.dataModel).toBeDefined();
      expect(result.definition.dataModel.block).toBe('products');
      expect(result.suggestedMappings).toHaveLength(3);
    });

    it('registers OpenAPI data source successfully', async () => {
      const mockOpenApiRefractionResult = {
        dataModel: {
          block: 'superusers',
          jsonSchema: {
            type: 'object',
            title: 'User',
            properties: {
              id: { type: 'integer' },
              username: { type: 'string', minLength: 3, maxLength: 50 },
              email: { type: 'string', format: 'email' },
              profile: {
                type: 'object',
                properties: {
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  avatar: { type: 'string', format: 'uri' }
                }
              }
            },
            required: ['id', 'username', 'email']
          }
        },
        provider: {
          type: 'openapi' as const,
          connection: 'https://api.external-service.com',
          specUrl: 'https://api.external-service.com/openapi.json',
          basePath: '/v1'
        },
        suggestedMappings: [
          { targetField: 'user_id', sourceField: 'id', type: 'integer', required: true },
          { targetField: 'login', sourceField: 'username', type: 'string', required: true },
          { targetField: 'email_addr', sourceField: 'email', type: 'string', required: true }
        ]
      };

      mockRefractory.refractSchema.mockResolvedValue(mockOpenApiRefractionResult);

      const connectionConfig = {
        baseUrl: 'https://api.external-service.com',
        specUrl: 'https://api.external-service.com/openapi.json',
        apiKey: 'secret-api-key',
        basePath: '/v1'
      };

      const result = await prism.registerDataSource('openapi', connectionConfig, testTenantExternal._id);

      expect(result.success).toBe(true);
      expect(result.definition.dataModel).toBeDefined();
      expect(result.definition.dataModel.block).toBe('superusers');
      expect(result.suggestedMappings).toHaveLength(3);
    });

    it('registers GraphQL data source successfully', async () => {
      const mockGraphQLRefractionResult = {
        dataModel: {
          block: 'posts',
          jsonSchema: {
            type: 'object',
            title: 'Post',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              content: { type: 'string' },
              author: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' }
                }
              },
              publishedAt: { type: 'string', format: 'date-time' },
              tags: { type: 'array', items: { type: 'string' } }
            },
            required: ['id', 'title', 'content']
          }
        },
        provider: {
          type: 'graphql' as const,
          connection: 'https://api.graphql-service.com/graphql',
          basePath: '/graphql'
        },
        suggestedMappings: [
          { targetField: 'postId', sourceField: 'id', type: 'string', required: true },
          { targetField: 'postTitle', sourceField: 'title', type: 'string', required: true },
          { targetField: 'postContent', sourceField: 'content', type: 'string', required: true }
        ]
      };

      mockRefractory.refractSchema.mockResolvedValue(mockGraphQLRefractionResult);

      const connectionConfig = {
        endpoint: 'https://api.graphql-service.com/graphql',
        headers: {
          'Authorization': 'Bearer token123',
          'Content-Type': 'application/json'
        }
      };

      const result = await prism.registerDataSource('graphql', connectionConfig, testTenantBlog._id);

      expect(result.success).toBe(true);
      expect(result.definition.dataModel).toBeDefined();
      expect(result.definition.dataModel.block).toBe('posts');
      expect(result.suggestedMappings).toHaveLength(3);
    });

    it('handles registration errors gracefully', async () => {
      mockRefractory.refractSchema.mockRejectedValue(new Error('Connection timeout'));

      const connectionConfig = {
        host: 'unreachable-host',
        database: 'test'
      };

      await expect(prism.registerDataSource('sql', connectionConfig))
        .rejects.toThrow('Failed to register sql data source: Connection timeout');
    });

    it('rejects unsupported data source types', async () => {
      await expect(prism.registerDataSource('redis', {}))
        .rejects.toThrow('Unsupported source type: redis. Valid types are: sql, mongodb, openapi, graphql');
    });
  });

  describe('Data Source Validation via Prism API', () => {

    beforeEach(async () => {
        // First register a data source
      const mockRefractionResult = {
        dataModel: {
          block: 'contacts', // Make sure this matches the validation call
          jsonSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              age: { type: 'number', minimum: 0, maximum: 150 }
            },
            required: ['name', 'email']
          }
        },
        provider: { type: 'sql' as const, connection: 'test' },
        suggestedMappings: []
      };

      mockRefractory.refractSchema.mockResolvedValue(mockRefractionResult);
      const registrationResult = await prism.registerDataSource('sql', { host: 'localhost', database: 'test' }, testTenant._id);
      expect(registrationResult.success).toBe(true);
      expect(registrationResult.definition).toBeDefined();
      expect(registrationResult.definition.dataModel.block).toBe('contacts');
    });

    it('validates valid data against registered data source schema', async () => {
      // Test with valid data using real validation
      const validData = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 30
      };

      const result = await prism.validate('contacts', validData, testTenant._id);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('returns validation errors for invalid data using real validation', async () => {
      // First register a data source with strict validation rules
      const mockRefractionResult = {
        dataModel: {
          block: 'contacts',
          jsonSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1 },
              email: { type: 'string', format: 'email' },
              age: { type: 'number', minimum: 0, maximum: 150 }
            },
            required: ['name', 'email']
          }
        },
        provider: { type: 'sql' as const, connection: 'test' },
        suggestedMappings: []
      };

      mockRefractory.refractSchema.mockResolvedValue(mockRefractionResult);
      await prism.registerDataSource('sql', { host: 'localhost', database: 'test' }, testTenant._id);

      // Test with invalid data - this should trigger real validation errors
      const invalidData = {
        name: '', // Empty string violates minLength: 1
        email: 'invalid-email', // Invalid email format
        age: -5 // Below minimum value
      };

      const result = await prism.validate('contacts', invalidData, testTenant._id);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      
      // Check that we get real validation errors for the various violations
      const errorString = result.errors!.join(' ');
      expect(errorString).toMatch(/name|email|age/i); // Should mention the invalid fields
    });

    it('validates data with missing required fields', async () => {
      // Test with incomplete data missing required fields
      const incompleteData = {
        age: 25
        // Missing required 'name' and 'email' fields
      };

      const result = await prism.validate('contacts', incompleteData, testTenant._id);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      
      // Should have errors about missing required fields
      const errorString = result.errors!.join(' ');
      expect(errorString).toMatch(/name|email/i);
    });

    it('handles validation of non-existent content type', async () => {
      const result = await prism.validate('nonexistent', {}, testTenant._id);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['No definition found for content type: nonexistent']);
    });

    it('validates complex nested object structures', async () => {
      // Register a data source with nested object schema
      const mockRefractionResult = {
        dataModel: {
          block: 'users', // Make sure this matches the validation call
          jsonSchema: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              username: { type: 'string', minLength: 3, maxLength: 50 },
              profile: {
                type: 'object',
                properties: {
                  firstName: { type: 'string', minLength: 1 },
                  lastName: { type: 'string', minLength: 1 },
                  avatar: { type: 'string', format: 'uri' }
                },
                required: ['firstName', 'lastName']
              }
            },
            required: ['id', 'username', 'profile']
          }
        },
        provider: { type: 'sql' as const, connection: 'test' },
        suggestedMappings: []
      };

      mockRefractory.refractSchema.mockResolvedValue(mockRefractionResult);
      await prism.registerDataSource('sql', { host: 'localhost', database: 'test' }, testTenantNested._id);

      // Test with valid nested data
      const validNestedData = {
        id: 1,
        username: 'johndoe',
        profile: {
          firstName: 'John',
          lastName: 'Doe',
          avatar: 'https://example.com/avatar.jpg'
        }
      };

      const validResult = await prism.validate('users', validNestedData, testTenantNested._id);
      expect(validResult.valid).toBe(true);

      // Test with invalid nested data
      const invalidNestedData = {
        id: 1,
        username: 'jo', // Too short (minLength: 3)
        profile: {
          firstName: '', // Empty string violates minLength: 1
          // Missing required lastName
          avatar: 'not-a-uri' // Invalid URI format
        }
      };

      const invalidResult = await prism.validate('users', invalidNestedData, testTenantNested._id);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toBeDefined();
      expect(invalidResult.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('Data Source Introspection via Prism API', () => {
    it('returns available data source types and schemas', () => {
      const dataSources = prism.getAvailableDataSources();

      expect(dataSources).toHaveLength(4);

      const sqlSource = dataSources.find(ds => ds.type === 'sql');
      expect(sqlSource).toBeDefined();
      expect(sqlSource?.description).toBe('SQL Database (PostgreSQL, MySQL, SQLite)');
      expect(sqlSource?.configSchema.properties.host).toBeDefined();
      expect(sqlSource?.configSchema.properties.database).toBeDefined();
      expect(sqlSource?.configSchema.required).toContain('host');
      expect(sqlSource?.configSchema.required).toContain('database');

      const mongoSource = dataSources.find(ds => ds.type === 'mongodb');
      expect(mongoSource).toBeDefined();
      expect(mongoSource?.description).toBe('MongoDB Database');
      expect(mongoSource?.configSchema.properties.connectionString).toBeDefined();

      const openApiSource = dataSources.find(ds => ds.type === 'openapi');
      expect(openApiSource).toBeDefined();
      expect(openApiSource?.description).toBe('OpenAPI/REST API');

      const graphqlSource = dataSources.find(ds => ds.type === 'graphql');
      expect(graphqlSource).toBeDefined();
      expect(graphqlSource?.description).toBe('GraphQL API');
    });

    it('provides consistent schema structure for all data source types', () => {
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

  describe('End-to-End Registration and Usage Workflow', () => {

    it('complete workflow: register, validate, and introspect data source', async () => {
      // 1. Get available data source types
      const availableTypes = prism.getAvailableDataSources();
      const sqlType = availableTypes.find(t => t.type === 'sql');
      expect(sqlType).toBeDefined();

      // 2. Register a new SQL data source using the schema information
      const mockRefractionResult = {
        dataModel: {
          block: 'inventory', // Make sure this matches the validation call
          jsonSchema: {
            type: 'object',
            title: 'InventoryItem',
            properties: {
              sku: { type: 'string', minLength: 1 },
              name: { type: 'string', minLength: 1 },
              quantity: { type: 'number', minimum: 0 },
              location: { type: 'string' }
            },
            required: ['sku', 'name', 'quantity']
          }
        },
        provider: {
          type: 'sql' as const,
          connection: 'postgresql://localhost/inventory',
          schema: 'public'
        },
        suggestedMappings: [
          { sourceField: 'sku', targetField: 'item_sku', type: 'string', required: true },
          { sourceField: 'name', targetField: 'item_name', type: 'string', required: true },
          { sourceField: 'quantity', targetField: 'item_quantity', type: 'number', required: true },
          { sourceField: 'location', targetField: 'item_location', type: 'string', required: false }
        ]
      };

      mockRefractory.refractSchema.mockResolvedValue(mockRefractionResult);

      const connectionConfig = {
        host: 'localhost',
        port: 5432,
        database: 'inventory',
        username: 'inventory_user',
        password: 'inventory_pass'
      };

      const registrationResult = await prism.registerDataSource('sql', connectionConfig, testTenantWarehouse._id);
      expect(registrationResult.success).toBe(true);
      expect(registrationResult.suggestedMappings).toHaveLength(4);

      // 3. Validate valid data against the registered data source using real validation
      const validTestData = {
        sku: 'WIDGET-001',
        name: 'Super Widget',
        quantity: 100,
        location: 'Warehouse A'
      };

      const validationResult = await prism.validate('inventory', validTestData, testTenantWarehouse._id);
      expect(validationResult.valid).toBe(true);

      // 4. Test validation with invalid data to ensure real validation works
      const invalidTestData = {
        sku: '', // Empty string violates minLength: 1
        name: 'Widget',
        quantity: -10, // Negative violates minimum: 0
        location: 'Warehouse A'
      };

      const invalidValidationResult = await prism.validate('inventory', invalidTestData, testTenantWarehouse._id);
      expect(invalidValidationResult.valid).toBe(false);
      expect(invalidValidationResult.errors).toBeDefined();
      expect(invalidValidationResult.errors!.length).toBeGreaterThan(0);

      // 5. Verify the suggested mappings can guide data transformation
      const mappings = registrationResult.suggestedMappings;
      const transformedData: Record<string, any> = {};
      mappings.forEach(mapping => {
        if (mapping.sourceField in validTestData) {
          transformedData[mapping.targetField] = (validTestData as any)[mapping.sourceField];
        }
      });

      expect(transformedData.item_sku).toBe('WIDGET-001');
      expect(transformedData.item_name).toBe('Super Widget');
      expect(transformedData.item_quantity).toBe(100);
    });

    it('handles registration failure and provides meaningful error', async () => {
      mockRefractory.refractSchema.mockRejectedValue(new Error('Database connection refused'));

      const badConnectionConfig = {
        host: 'invalid-host',
        database: 'nonexistent'
      };

      await expect(prism.registerDataSource('sql', badConnectionConfig, testTenant._id))
        .rejects.toThrow('Failed to register sql data source: Database connection refused');

      // Verify that the failed registration doesn't affect subsequent operations
      const dataSources = prism.getAvailableDataSources();
      expect(dataSources).toHaveLength(4); // Should still return the standard types
    });
  });
});