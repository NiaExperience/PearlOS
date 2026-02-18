# Adding Data Sources to Mesh

This document provides guidance on how to extend the Mesh application with additional data sources beyond PostgreSQL (via PostGraphile).

## Architecture Overview

The Mesh application is designed with a modular architecture that allows for multiple data sources to be integrated into a unified GraphQL API. The core components are:

```text
/apps/mesh
  /src
    /data-sources           # All data source implementations
      /postgraphile         # PostgreSQL via PostGraphile
      /mongo                # MongoDB data source (example)
      /openai               # OpenAI data source (example)
      index.ts             # Data sources composition
    
    /schema                 # GraphQL schema definitions
      base.graphql         # Core schema types
      merged.ts            # Schema stitching logic
    
    /resolvers              # GraphQL resolvers
      index.ts             # Combined resolvers
```

## Data Source Interface

Each data source should implement a common interface to ensure consistency:

```typescript
// src/data-sources/types.ts
export interface DataSource {
  // The GraphQL schema for this data source
  schema: GraphQLSchema;
  
  // Initialize the data source
  initialize(options?: any): Promise<void>;
  
  // Cleanup resources (connections, etc.)
  cleanup(): Promise<void>;
  
  // Optional: Check if the data source is healthy
  healthCheck?(): Promise<boolean>;
}
```

## Adding a New Data Source

Follow these steps to add a new data source to Mesh:

### 1. Create a Data Source Directory

Create a new directory under `src/data-sources` for your data source:

```bash
mkdir -p src/data-sources/your-data-source
```

### 2. Implement the Core Files

Each data source should include:

#### index.ts - Main Export

```typescript
// src/data-sources/your-data-source/index.ts
import { DataSource } from '../types';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';

export class YourDataSource implements DataSource {
  private connection: any; // Your connection type
  
  constructor(private config: YourDataSourceConfig) {}
  
  get schema() {
    return makeExecutableSchema({
      typeDefs,
      resolvers
    });
  }
  
  async initialize(options = {}) {
    // Initialize connection to your data source
    this.connection = await createConnection({
      ...this.config,
      ...options
    });
    
    // Any additional setup
  }
  
  async cleanup() {
    // Clean up resources
    if (this.connection) {
      await this.connection.close();
    }
  }
  
  async healthCheck() {
    // Check if the connection is healthy
    return this.connection && this.connection.isConnected();
  }
}

// Configuration interface
export interface YourDataSourceConfig {
  // Your configuration options
  url: string;
  // Other options...
}
```

#### schema.ts - GraphQL Schema

```typescript
// src/data-sources/your-data-source/schema.ts
import { gql } from 'graphql-tag';

export const typeDefs = gql`
  # Define your types
  type YourType {
    id: ID!
    name: String!
    # Other fields...
  }
  
  # Define your queries
  extend type Query {
    yourTypeItems: [YourType!]!
    yourTypeItem(id: ID!): YourType
  }
  
  # Define your mutations
  extend type Mutation {
    createYourType(input: YourTypeInput!): YourType!
    updateYourType(id: ID!, input: YourTypeInput!): YourType!
    deleteYourType(id: ID!): Boolean!
  }
  
  # Define your inputs
  input YourTypeInput {
    name: String!
    # Other fields...
  }
`;
```

#### resolvers.ts - GraphQL Resolvers

```typescript
// src/data-sources/your-data-source/resolvers.ts
export const resolvers = {
  Query: {
    yourTypeItems: async (_, args, { dataSources }) => {
      // Implement resolver using your data source
      return dataSources.yourDataSource.getAllItems();
    },
    yourTypeItem: async (_, { id }, { dataSources }) => {
      return dataSources.yourDataSource.getItemById(id);
    }
  },
  
  Mutation: {
    createYourType: async (_, { input }, { dataSources }) => {
      return dataSources.yourDataSource.createItem(input);
    },
    updateYourType: async (_, { id, input }, { dataSources }) => {
      return dataSources.yourDataSource.updateItem(id, input);
    },
    deleteYourType: async (_, { id }, { dataSources }) => {
      return dataSources.yourDataSource.deleteItem(id);
    }
  }
};
```

#### connection.ts - Data Source Connection

```typescript
// src/data-sources/your-data-source/connection.ts
// Import your data source client
import { Client } from 'your-data-source-client';

export async function createConnection(config) {
  const client = new Client(config);
  await client.connect();
  return client;
}
```

### 3. Create a Testing Version (if applicable)

If your data source needs a mock or in-memory version for testing:

```typescript
// src/data-sources/your-data-source/testing.ts
import { YourDataSourceConfig } from './index';

export async function createTestConnection(config: Partial<YourDataSourceConfig> = {}) {
  // Create an in-memory or mock version of your data source
  const mockClient = {
    // Mock implementation
    isConnected: () => true,
    close: async () => {},
    // Other required methods...
  };
  
  return mockClient;
}
```

### 4. Register the Data Source

Update the main data sources index file:

```typescript
// src/data-sources/index.ts
import { DataSource } from './types';
import { PostGraphileDataSource } from './postgraphile';
import { MongoDataSource } from './mongo';
import { YourDataSource } from './your-data-source';

export async function createDataSources(config): Promise<Record<string, DataSource>> {
  // Create instances
  const postgraphile = new PostGraphileDataSource(config.postgraphile);
  const mongo = new MongoDataSource(config.mongo);
  const yourDataSource = new YourDataSource(config.yourDataSource);
  
  // Initialize data sources
  await Promise.all([
    postgraphile.initialize(),
    mongo.initialize(),
    yourDataSource.initialize()
  ]);
  
  return {
    postgraphile,
    mongo,
    yourDataSource
  };
}
```

### 5. Update Schema Stitching

Integrate your schema with the main application schema:

```typescript
// src/schema/merged.ts
import { stitchSchemas } from '@graphql-tools/stitch';
import { createDataSources } from '../data-sources';
import { baseTypeDefs } from './base';

export async function createMergedSchema(config) {
  // Get data sources
  const dataSources = await createDataSources(config);
  
  // Create merged schema
  return stitchSchemas({
    subschemas: [
      {
        schema: makeExecutableSchema({
          typeDefs: baseTypeDefs
        })
      },
      // Add each data source schema
      { schema: dataSources.postgraphile.schema },
      { schema: dataSources.mongo.schema },
      { schema: dataSources.yourDataSource.schema }
    ],
    // Add any schema transforms or type merging here
  });
}
```

## Example Data Source Implementations

### MongoDB Example

```typescript
// src/data-sources/mongo/index.ts
import { DataSource } from '../types';
import { MongoClient, Db } from 'mongodb';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';

export class MongoDataSource implements DataSource {
  private client: MongoClient;
  private db: Db;
  
  constructor(private config: MongoConfig) {}
  
  get schema() {
    return makeExecutableSchema({
      typeDefs,
      resolvers
    });
  }
  
  async initialize(options = {}) {
    this.client = new MongoClient(this.config.uri);
    await this.client.connect();
    this.db = this.client.db(this.config.dbName);
  }
  
  async cleanup() {
    if (this.client) {
      await this.client.close();
    }
  }
  
  async healthCheck() {
    if (!this.client) return false;
    try {
      await this.client.db("admin").command({ ping: 1 });
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // Helper methods for resolvers
  async findDocuments(collection, query) {
    return this.db.collection(collection).find(query).toArray();
  }
  
  async findDocument(collection, id) {
    return this.db.collection(collection).findOne({ _id: id });
  }
  
  // Additional methods as needed
}

export interface MongoConfig {
  uri: string;
  dbName: string;
}
```

### OpenAI Example

```typescript
// src/data-sources/openai/index.ts
import { DataSource } from '../types';
import { OpenAIApi, Configuration } from 'openai';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';

export class OpenAIDataSource implements DataSource {
  private client: OpenAIApi;
  
  constructor(private config: OpenAIConfig) {}
  
  get schema() {
    return makeExecutableSchema({
      typeDefs,
      resolvers
    });
  }
  
  async initialize() {
    const configuration = new Configuration({
      apiKey: this.config.apiKey,
    });
    this.client = new OpenAIApi(configuration);
  }
  
  async cleanup() {
    // No cleanup needed for REST API client
  }
  
  async healthCheck() {
    try {
      // Simple API call to check if the client is working
      await this.client.listModels();
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // Helper methods for resolvers
  async generateCompletion(prompt, options = {}) {
    const response = await this.client.createCompletion({
      model: this.config.model || 'text-davinci-003',
      prompt,
      ...options
    });
    
    return response.data.choices[0].text;
  }
  
  // Additional methods as needed
}

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
}
```

## Best Practices

When adding a new data source, follow these best practices:

### 1. Isolation

Keep your data source implementation isolated from other parts of the application. The only integration point should be through the GraphQL schema.

### 2. Error Handling

Implement proper error handling within your data source. Consider how errors from your data source should be presented to GraphQL clients.

```typescript
async findDocument(collection, id) {
  try {
    return await this.db.collection(collection).findOne({ _id: id });
  } catch (error) {
    // Transform database-specific error to a GraphQL error
    throw new Error(`Failed to fetch document: ${error.message}`);
  }
}
```

### 3. Connection Pooling

For database connections, implement proper connection pooling to handle multiple requests efficiently.

### 4. Testing Support

Always provide a testing version of your data source that can be used in automated tests without external dependencies.

### 5. Documentation

Document your data source thoroughly, including:

- Configuration options
- Available resolvers
- Schema types
- Example usage

### 6. Security Considerations

Address security concerns specific to your data source:

- Prevent injection attacks
- Handle authentication and authorization
- Secure sensitive configuration (e.g., API keys)

## Testing Your Data Source

Create tests for your data source in the appropriate test directory:

```typescript
// src/__tests__/data-sources/your-data-source.test.ts
import { YourDataSource } from '../../data-sources/your-data-source';

describe('YourDataSource', () => {
  let dataSource: YourDataSource;
  
  beforeAll(async () => {
    // Create and initialize a test instance
    dataSource = new YourDataSource({
      // Test configuration
    });
    await dataSource.initialize({ useTestConnection: true });
  });
  
  afterAll(async () => {
    await dataSource.cleanup();
  });
  
  test('should retrieve items', async () => {
    // Test your data source
  });
  
  // More tests...
});
```

## Example: Adding a Redis Cache Data Source

Here's a complete example of adding a Redis cache data source:

### Directory Structure

```text
/apps/mesh/src/data-sources/redis
  index.ts         # Main export
  schema.ts        # GraphQL schema
  resolvers.ts     # GraphQL resolvers
  connection.ts    # Redis connection logic
  testing.ts       # In-memory Redis for testing
```

### Implementation

- See the example code in the dedicated example section below.

### Integration

- Update `src/data-sources/index.ts` to include the Redis data source
- Update schema stitching to include Redis schema

## Complete Redis Data Source Example

Below is a full implementation of a Redis data source:

```typescript
// src/data-sources/redis/index.ts
import { DataSource } from '../types';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import { createRedisClient } from './connection';
import Redis from 'ioredis';

export class RedisDataSource implements DataSource {
  private client: Redis;
  
  constructor(private config: RedisConfig) {}
  
  get schema() {
    return makeExecutableSchema({
      typeDefs,
      resolvers: resolvers(this)
    });
  }
  
  async initialize(options = {}) {
    this.client = await createRedisClient({
      ...this.config,
      ...options
    });
  }
  
  async cleanup() {
    if (this.client) {
      await this.client.quit();
    }
  }
  
  async healthCheck() {
    try {
      const ping = await this.client.ping();
      return ping === 'PONG';
    } catch (e) {
      return false;
    }
  }
  
  // Helper methods for resolvers
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }
  
  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    if (ttl) {
      return (await this.client.set(key, value, 'EX', ttl)) === 'OK';
    }
    return (await this.client.set(key, value)) === 'OK';
  }
  
  async del(key: string): Promise<boolean> {
    return (await this.client.del(key)) > 0;
  }
  
  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}
```

```typescript
// src/data-sources/redis/schema.ts
import { gql } from 'graphql-tag';

export const typeDefs = gql`
  type CacheItem {
    key: String!
    value: String
    ttl: Int
  }
  
  extend type Query {
    cacheItem(key: String!): CacheItem
    cacheItems(pattern: String!): [CacheItem!]!
  }
  
  extend type Mutation {
    setCacheItem(key: String!, value: String!, ttl: Int): Boolean!
    deleteCacheItem(key: String!): Boolean!
  }
`;
```

```typescript
// src/data-sources/redis/resolvers.ts
export const resolvers = (dataSource) => ({
  Query: {
    cacheItem: async (_, { key }) => {
      const value = await dataSource.get(key);
      if (value === null) return null;
      
      const ttl = await dataSource.client.ttl(key);
      
      return {
        key,
        value,
        ttl: ttl > 0 ? ttl : null
      };
    },
    cacheItems: async (_, { pattern }) => {
      const keys = await dataSource.keys(pattern);
      return Promise.all(
        keys.map(async (key) => {
          const value = await dataSource.get(key);
          const ttl = await dataSource.client.ttl(key);
          
          return {
            key,
            value,
            ttl: ttl > 0 ? ttl : null
          };
        })
      );
    }
  },
  
  Mutation: {
    setCacheItem: async (_, { key, value, ttl }) => {
      return dataSource.set(key, value, ttl);
    },
    deleteCacheItem: async (_, { key }) => {
      return dataSource.del(key);
    }
  }
});
```

```typescript
// src/data-sources/redis/connection.ts
import Redis from 'ioredis';
import { RedisConfig } from './index';

export async function createRedisClient(config: RedisConfig): Promise<Redis> {
  const client = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db || 0
  });
  
  // Verify connection
  await client.ping();
  
  return client;
}
```

```typescript
// src/data-sources/redis/testing.ts
import { RedisConfig } from './index';
import Redis from 'ioredis-mock';

export async function createTestRedisClient(config: Partial<RedisConfig> = {}): Promise<Redis> {
  // Use ioredis-mock for an in-memory Redis implementation
  return new Redis();
}
```
</details>


By following this guide, you can extend the Mesh application with any data source while maintaining a consistent and maintainable architecture.
