# GraphQL Caching Implementation

This document explains the caching strategy implemented in the Mesh GraphQL server for NotionModel data.

## Overview

The caching system uses a multi-level approach:

1. **DataLoader** for efficient batching and caching of frequently accessed entities
2. **In-memory cache** for fast access to recent query results
3. **Redis cache** (optional) for distributed caching in multi-instance deployments
4. **GraphQL response caching** for complete query results

## Cache Keys

Cache keys are carefully structured based on access patterns:

- `block:${block_id}` - For direct lookups by block_id
- `page:${page_id}` - For page_id lookups
- `parent:${parent_id}[:type:${type}]` - For parent_id lookups (optionally with type)
- `type:${type}` - For type-based lookups
- `dynamic:${type}[:filter]` - For DynamicContent with specific properties
- `indexer:${path}:${value}` - For indexer-based lookups
- `query:${whereClause}[:order:${orderBy}][:limit:${limit}:offset:${offset}]` - For complex queries
- `gql:${operationType}:${queryStr}:${variablesStr}` - For complete GraphQL operation caching

## Cache Invalidation

Cache invalidation occurs on mutations:

1. **Create** - Invalidates related type, page, and parent caches
2. **Update** - Invalidates specific block cache and any related caches based on changed fields
3. **Delete** - Invalidates block cache and any related caches

For DynamicContent types, more aggressive invalidation is performed.

## Configuration

Configure caching through environment variables:

- `USE_REDIS=true|false` - Enable Redis cache (default: false)
- `REDIS_URL=redis://host:port` - Redis connection URL (default: redis://localhost:6379)
- `CACHE_TTL=300` - Cache TTL in seconds (default: 300 - 5 minutes)

## Bypassing Cache

Clients can bypass the cache by including the header:

```
x-no-cache: true
```

## Implementation Details

The caching system is implemented across multiple files:

1. `services/cache.service.ts` - Core caching logic with DataLoader implementation
2. `plugins/cachingPlugin.ts` - GraphQL Yoga plugin for response-level caching
3. `resolvers/enhanced/NotionModelResolver.ts` - Integration with GraphQL resolvers

## Performance Considerations

- DataLoader prevents N+1 query problems
- In-memory cache provides fast access for frequently used data
- Redis allows for distributed caching in multi-instance deployments
- Query result caching reduces database load for identical queries

## Cache Key Selection Strategy

When selecting cache keys, the system analyzes query patterns:

1. First tries specialized DataLoader caches for common access patterns (by block_id, page_id, etc.)
2. For complex queries, generates a compound key from the query parameters
3. For complete GraphQL operations, uses the full query+variables as the key

This strategy ensures that cache keys are both specific enough to avoid collisions and general enough to provide good hit rates.
