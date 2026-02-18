# GraphQL Caching Implementation

This document explains the caching strategy implemented in the Mesh GraphQL server.

## Overview

The caching implementation uses a multi-level approach:

1. **DataLoader**: For efficient batching and caching of database queries
2. **Memory Cache**: For local in-memory caching of results
3. **Redis Cache** (optional): For distributed caching across multiple server instances
4. **GraphQL Response Caching**: For caching complete GraphQL query responses

## Key Components

### CacheService (cache.service.ts)

The core caching service that provides:

- DataLoaders for different access patterns (by ID, by type, by parent, etc.)
- In-memory cache using NodeCache
- Optional Redis integration
- Cache key generation helpers
- Cache invalidation strategies

### CachingPlugin (cachingPlugin.ts)

A GraphQL Yoga plugin that:

- Tracks resolver calls and execution paths
- Caches entire GraphQL operation results
- Handles cache invalidation on mutations
- Supports cache bypass via headers

## Cache Keys

Cache keys are structured to match different query patterns:

- `block:{id}` - Direct block ID lookups
- `page:{id}` - Page ID lookups
- `parent:{id}` - Parent ID lookups
- `type:{type}` - Type-based lookups
- `operation:{name}:{args}` - GraphQL operation caching

## Configuration

The caching system can be configured via environment variables:

- `USE_REDIS`: Enable/disable Redis integration (default: false)
- `REDIS_URL`: Redis connection URL (default: redis://localhost:6379)
- `CACHE_TTL`: Default TTL in seconds (default: 300 seconds / 5 minutes)

## Usage in Resolvers

Resolvers use the CacheService for efficient data loading:

```typescript
// Example of using caching in resolvers
async getNotionModelById(id: string): Promise<INotionModel | null> {
  return await cacheService.getByBlockId(id);
}

async getNotionModelsByParentId(parentId: string): Promise<INotionModel[]> {
  return await cacheService.getByParentId(parentId);
}
```

## Cache Invalidation

The cache is automatically invalidated when mutations occur:

1. When an item is updated, its specific cache entry is invalidated
2. When an item is deleted, both its entry and parent list caches are invalidated
3. For type and content-related mutations, broader pattern-based invalidation is used

## Test Compatibility

The caching implementation is designed to work in various environments:

- Development environment: Full caching enabled
- Test environment: Conditional imports handle test scenarios
- Production environment: Full caching with optional Redis support

## Performance Considerations

- DataLoader batches database queries to reduce N+1 query problems
- Memory cache provides fast access for frequently used data
- Redis enables distributed caching for multi-instance deployments
- Response-level caching reduces computation for repeated identical queries
