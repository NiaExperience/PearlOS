/* eslint-disable @typescript-eslint/no-explicit-any */
import express from 'express';
import { Server } from 'http';
import { ProviderConfig } from '../data-bridge/provider';

export interface MockAPIEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  handler: (req: any, res: any) => void;
}

export interface MockProviderData {
  name: string;
  baseUrl: string;
  schema: {
    contentType: string;
    fields: Record<string, { type: string; required?: boolean }>;
  };
  data: Record<string, any>[];
  endpoints: MockAPIEndpoint[];
}

/**
 * Mock External API Server for testing runtime provider creation
 * Simulates external data sources that can be registered as providers
 */
export class MockExternalAPIServer {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;
  private providers: Map<string, MockProviderData> = new Map();

  constructor(port: number = 0) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // CORS for testing
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', providers: Array.from(this.providers.keys()) });
    });

    // Provider registration endpoint
    this.app.post('/providers/:name', (req, res) => {
      const { name } = req.params;
      const providerData: MockProviderData = req.body;
      
      this.providers.set(name, {
        ...providerData,
        name,
        baseUrl: `http://localhost:${this.getPort()}/api/${name}`
      });

      // Register dynamic endpoints for this provider
      this.registerProviderEndpoints(name, providerData);
      
      res.json({ 
        success: true, 
        provider: name,
        baseUrl: `http://localhost:${this.getPort()}/api/${name}`
      });
    });

    // Provider info endpoint
    this.app.get('/providers/:name', (req, res) => {
      const { name } = req.params;
      const provider = this.providers.get(name);
      
      if (!provider) {
        return res.status(404).json({ error: 'Provider not found' });
      }
      
      res.json(provider);
    });

    // List all providers
    this.app.get('/providers', (req, res) => {
      const providerList = Array.from(this.providers.entries()).map(([name, data]) => ({
        name,
        contentType: data.schema.contentType,
        baseUrl: data.baseUrl,
        recordCount: data.data.length
      }));
      
      res.json({ providers: providerList });
    });
  }

  private registerProviderEndpoints(name: string, providerData: MockProviderData): void {
    const basePath = `/api/${name}`;
    
    // Generic CRUD endpoints
    this.app.get(`${basePath}/items`, (req, res) => {
      const provider = this.providers.get(name)!;
      const { where, limit = 100, offset = 0 } = req.query;
      
      let items = provider.data;
      
      // Simple filtering
      if (where && typeof where === 'string') {
        try {
          const filterObj = JSON.parse(where);
          items = items.filter(item => {
            return Object.entries(filterObj).every(([key, value]) => 
              item[key] === value
            );
          });
        } catch (e) {
          // Ignore invalid filter
        }
      }
      
      // Pagination
      const start = parseInt(offset as string, 10);
      const end = start + parseInt(limit as string, 10);
      const paginatedItems = items.slice(start, end);
      
      res.json({
        items: paginatedItems,
        total: items.length,
        offset: start,
        limit: parseInt(limit as string, 10)
      });
    });

    this.app.get(`${basePath}/items/:id`, (req, res) => {
      const provider = this.providers.get(name)!;
      const { id } = req.params;
      
      const item = provider.data.find(item => item._id === id || item.id === id);
      
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      
      res.json(item);
    });

    this.app.post(`${basePath}/items`, (req, res) => {
      const provider = this.providers.get(name)!;
      const newItem = {
        _id: `external_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        id: `external_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...req.body
      };
      
      provider.data.push(newItem);
      res.status(201).json(newItem);
    });

    this.app.put(`${basePath}/items/:id`, (req, res) => {
      const provider = this.providers.get(name)!;
      const { id } = req.params;
      
      const itemIndex = provider.data.findIndex(item => item._id === id || item.id === id);
      
      if (itemIndex === -1) {
        return res.status(404).json({ error: 'Item not found', id });
      }
      
      provider.data[itemIndex] = {
        ...provider.data[itemIndex],
        ...req.body,
        updatedAt: new Date().toISOString()
      };
      
      res.status(200).json(provider.data[itemIndex]);
    });

    this.app.delete(`${basePath}/items/:id`, (req, res) => {
      const provider = this.providers.get(name)!;
      const { id } = req.params;
      
      const itemIndex = provider.data.findIndex(item => item._id === id || item.id === id);
      
      if (itemIndex === -1) {
        return res.status(404).json({ error: 'Item not found', id });
      }
      
      provider.data.splice(itemIndex, 1);
      res.status(200).json({ success: true, deleted: id });
    });

    // Schema introspection endpoint
    this.app.get(`${basePath}/schema`, (req, res) => {
      const provider = this.providers.get(name)!;
      res.json(provider.schema);
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (err?: any) => {
        if (err) {
          reject(err);
        } else {
          const address = this.server!.address();
          if (address && typeof address === 'object') {
            this.port = address.port;
          }
            console.log(`🛠️ Mock External API Server started on port ${this.port}`);
          resolve();
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
            console.log('🛑 Mock External API Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }

  getBaseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Register a new provider with test data
   */
  async registerProvider(providerData: Omit<MockProviderData, 'name' | 'baseUrl'>): Promise<string> {
    const name = `test-provider-${Date.now()}`;
    
    // Normalize the data with proper IDs
    const normalizedData = providerData.data.map(item => {
      const id = item._id || item.id || `external_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      return {
        _id: id,
        id: id,
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
        ...item
      };
    });

    const response = await fetch(`${this.getBaseUrl()}/providers/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...providerData,
        data: normalizedData
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to register provider: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.provider;
  }

  /**
   * Create a ProviderConfig for testing with this mock server
   */
  createProviderConfig(providerName: string): ProviderConfig {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }

    return {
      type: 'external-api',
      connectionId: providerName,
      operationSet: 'crud',
      mapping: Object.keys(provider.schema.fields).reduce((acc, field) => {
        acc[field] = field; // Direct mapping for test
        return acc;
      }, {} as Record<string, string>),
      fragments: {
        findQuery: `query Find${provider.schema.contentType}($where: JSON) {
          find${provider.schema.contentType}(where: $where) {
            ${Object.keys(provider.schema.fields).join('\n            ')}
          }
        }`,
        createMutation: `mutation Create${provider.schema.contentType}($data: ${provider.schema.contentType}Input!) {
          create${provider.schema.contentType}(data: $data) {
            ${Object.keys(provider.schema.fields).join('\n            ')}
          }
        }`,
        updateMutation: `mutation Update${provider.schema.contentType}($id: ID!, $data: ${provider.schema.contentType}Input!) {
          update${provider.schema.contentType}(id: $id, data: $data) {
            ${Object.keys(provider.schema.fields).join('\n            ')}
          }
        }`,
        deleteMutation: `mutation Delete${provider.schema.contentType}($id: ID!) {
          delete${provider.schema.contentType}(id: $id)
        }`
      }
    };
  }

  /**
   * Seed a provider with test data
   */
  seedProvider(providerName: string, data: any[]): void {
    const provider = this.providers.get(providerName);
    if (provider) {
      provider.data = data.map(item => {
        const id = item._id || item.id || `external_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        return {
          _id: id,
          id: id,
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
          ...item
        };
      });
    }
  }

  /**
   * Get provider stats for testing
   */
  getProviderStats(providerName: string): { recordCount: number; schema: any } | null {
    const provider = this.providers.get(providerName);
    if (!provider) return null;

    return {
      recordCount: provider.data.length,
      schema: provider.schema
    };
  }

  /**
   * Clear all data for a provider
   */
  clearProvider(providerName: string): void {
    const provider = this.providers.get(providerName);
    if (provider) {
      provider.data = [];
    }
  }

  /**
   * Remove a provider completely
   */
  removeProvider(providerName: string): void {
    this.providers.delete(providerName);
  }

  /**
   * Reset all providers and data
   */
  reset(): void {
    this.providers.clear();
  }
}

export default MockExternalAPIServer;
