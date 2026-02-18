# GraphQL Caching Implementation for Mesh Server

This document provides guidance on how to use the caching implementation in the Mesh GraphQL server.

## Key Concepts

1. **Multi-level caching** approach:
   - DataLoader for batching and first-level caching
   - In-memory NodeCache for fast access
   - Optional Redis for distributed caching

2. **Cache invalidation**:
   - Automatically invalidates relevant caches on mutations
   - Supports pattern-based cache invalidation
   - Handles complex relationships (parent-child, etc.)

## Usage in Resolvers

Example of using the cache service in resolvers:

```typescript
import { CacheService } from '../services/cache.service';

// Get cache service instance
const cacheService = CacheService.getInstance();

// In a resolver method
async getNotionModelById(id: string): Promise<INotionModel | null> {
  return await cacheService.getByBlockId(id);
}

async getNotionModelsByParentId(parentId: string): Promise<INotionModel[]> {
  return await cacheService.getByParentId(parentId);
}
```

## Bypassing Cache

When testing or debugging, you can bypass the cache by:

1. Using the `x-no-cache: true` header in GraphQL requests
2. Setting `NODE_ENV=test` during development/testing

## Cache Configuration

Configuration is done via environment variables:

```sh
USE_REDIS=true
REDIS_URL=redis://localhost:6379
CACHE_TTL=300
```

## Implementation Notes

- The cache service is a singleton to ensure all resolvers use the same cache
- DataLoader batches requests within the same event loop cycle
- Cache keys are structured to match different query patterns
- Cache expiration is configurable

## Testing

When running tests, the caching implementation automatically adapts:

- For in-memory database tests, caching still works but uses test-specific loaders
- The `x-no-cache` header can be used to bypass caching in tests

## Debugging

Log messages show cache hits/misses during operation:

- "Cache hit for block_id: 12345"
- "Cache miss for complex query, executing database query"

## Performance Considerations

- DataLoader handles the N+1 query problem by batching
- Memory cache reduces database load for frequently accessed data
- Redis provides cross-instance caching for clustered deployments
