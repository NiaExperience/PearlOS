# Prism GraphQL Integration

This document explains how Prism integrates with GraphQL Mesh to provide unified data access.

## Architecture Overview

Prism serves as the data abstraction layer that connects applications to GraphQL Mesh server (`localhost:2000`, `localhost:5001` in tests), providing type-safe access to all data sources through a single GraphQL endpoint.

## GraphQL Mesh Server

### Automatic Startup

The GraphQL Mesh server starts automatically when you run:

```bash
npm run start:all
```

This launches:
- GraphQL Mesh server on port 2000 (5001 in tests)
- All applications connected to Mesh endpoint
- Full GraphQL schema with NotionModel types

### Manual Server Management

Start only the GraphQL server:

```bash
npm run --workspace=@nia/prism dev
```

### Schema Features

- **NotionModel Schema**: Primary data model with JSONFilter support
- **Multi-Field Indexer Queries**: Complex AND/OR operations
- **Tenant Isolation**: OR logic for platform + tenant data access
- **Type Safety**: Full TypeScript integration

## Prism Integration

### Singleton Pattern

Prism automatically connects to GraphQL Mesh:

```typescript
import { Prism } from '@nia/prism/prism';

// Auto-connects to GraphQL Mesh on localhost:2000 (localhost:5001 in tests)
const prism = Prism.getInstance();

// Execute GraphQL queries through Prism
const result = await prism.graphqlQuery(`
  query getContent($tenantId: String!) {
    notionModel(where: {
      tenantId: { equals: $tenantId }
    }) {
      id
      data
      indexer
    }
  }
`, { tenantId: "tenant-123" });
```

### Query Examples

**Multi-field indexer filtering:**

```typescript
const photos = await prism.graphqlQuery(`
  query getPhotos($userId: String!, $album: String!) {
    notionModel(where: {
      AND: [
        { indexer: { path: "userId", equals: $userId } },
        { indexer: { path: "album", equals: $album } }
      ]
    }) {
      id
      data
      indexer
    }
  }
`, { userId: "user123", album: "vacation" });
```

**Tenant + platform discovery:**

```typescript
const definitions = await prism.graphqlQuery(`
  query getDefinitions($tenantId: String!) {
    notionModel(where: {
      OR: [
        { tenantId: { equals: $tenantId } },
        { tenantId: { equals: "platform" } }
      ]
    }) {
      id
      tenantId
      data
    }
  }
`, { tenantId: "tenant-123" });
```

## Application Integration

### Interface App

The main user interface (`apps/interface`) uses Prism for:
- User authentication and session management
- Content retrieval with tenant isolation
- Real-time data updates through GraphQL subscriptions

### Dashboard App

The admin dashboard (`apps/dashboard`) uses Prism for:
- Multi-tenant content management
- User administration and permissions
- Content definition management
- File upload processing with indexer metadata

## Error Handling

GraphQL operations include comprehensive error handling:

```typescript
try {
  const result = await prism.graphqlQuery(query, variables);
  return result.data;
} catch (error) {
  console.error('GraphQL operation failed:', error);
  throw new Error(`Data operation failed: ${error.message}`);
}
```

## Development Workflow

1. **Start Services**: `npm run start:all` launches GraphQL Mesh and all apps
2. **Access GraphQL Playground**: Visit `http://localhost:2000/graphql` for schema exploration (`http://localhost:5001/graphql` during tests)
3. **Run Tests**: `npm test` validates all 104 tests including GraphQL operations
4. **Debug Queries**: Use browser network tab to inspect GraphQL requests/responses

## Performance Optimizations

- **Database-Level Filtering**: All queries execute filtering at the database level
- **Connection Pooling**: GraphQL Mesh manages PostgreSQL connections efficiently
- **Type Caching**: GraphQL schema types are cached for optimal performance
- **Query Optimization**: Complex queries use proper indexing for fast execution
