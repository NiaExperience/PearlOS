import DataLoader from 'dataloader';
import Redis from 'ioredis';
import NodeCache from 'node-cache';
import { Op, literal } from 'sequelize';

import { NotionModel } from '../resolvers/db';
import { INotionModel } from '../resolvers/models/notion-model';

/**
 * Cache configuration options
 */
interface CacheConfig {
    useRedis: boolean;
    redisUrl?: string;
    stdTTL: number; // Standard TTL in seconds
    checkperiod: number; // seconds
}

/**
 * Default cache configuration
 */
const DEFAULT_CACHE_CONFIG: CacheConfig = {
    useRedis: process.env.USE_REDIS === 'true',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    stdTTL: 60 * 5, // 5 minutes
    checkperiod: 60, // 1 minute
};

/**
 * Cache key generator functions for different query patterns
 */
export const CacheKeys = {
    // Key for direct block_id lookups
    blockId: (blockId: string) => `block:${blockId}`,

    // Key for page_id lookups
    pageId: (pageId: string) => `page:${pageId}`,

    // Key for parent_id lookups with optional type
    parentId: (parentId: string, type?: string) =>
        type ? `parent:${parentId}:type:${type}` : `parent:${parentId}`,

    // Key for type-based lookups
    type: (type: string) => `type:${type}`,

    // Key for DynamicContent with specific properties
    dynamicContent: (type: string, filter?: any) => {
        const filterStr = filter ? `:${JSON.stringify(filter)}` : '';
        return `dynamic:${type}${filterStr}`;
    },

    // Key for indexer-based lookups
    indexer: (path: string, value: string) => `indexer:${path}:${value}`,

    // Key for complex queries
    complexQuery: (whereClause: any, orderBy?: any, limit?: number, offset?: number) => {
        const orderStr = orderBy ? `:order:${JSON.stringify(orderBy)}` : '';
        const limitOffsetStr = (limit || offset) ? `:limit:${limit || 0}:offset:${offset || 0}` : '';
        return `query:${JSON.stringify(whereClause)}${orderStr}${limitOffsetStr}`;
    }
};

/**
 * Cache service for the NotionModel data
 * 
 * This service implements a multi-level caching strategy:
 * 1. DataLoader for batching and caching database queries
 * 2. Memory cache for fast local caching
 * 3. Optional Redis for distributed caching
 * 
 * The service uses different DataLoaders for different access patterns
 * to optimize for the various ways NotionModel data is queried.
 */
export class CacheService {
    private static instance: CacheService;
    private memoryCache: NodeCache;
    private redisClient: Redis | null = null;
    private config: CacheConfig;

    // DataLoaders for different access patterns
    private blockIdLoader: DataLoader<string, INotionModel | null>;
    private pageIdLoader: DataLoader<string, INotionModel | null>;
    private parentIdLoader: DataLoader<string, INotionModel[]>;
    private typeLoader: DataLoader<string, INotionModel[]>;
    private indexerLoader: DataLoader<{ path: string, value: string }, INotionModel[]>;

    private static sanitizeRedisUrl(redisUrl: string): string {
        try {
            const parsed = new URL(redisUrl);
            // Drop credentials
            const authless = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
            return authless;
        } catch {
            return redisUrl;
        }
    }

    private constructor(config: CacheConfig = DEFAULT_CACHE_CONFIG) {
        this.config = config;

        // Initialize memory cache
        this.memoryCache = new NodeCache({
            stdTTL: this.config.stdTTL,
            checkperiod: this.config.checkperiod,
            useClones: false,
        });

        // Initialize Redis if enabled - defer connection test to first use
        if (this.config.useRedis && this.config.redisUrl) {
            try {
                const redisOptions: {
                    maxRetriesPerRequest: number;
                    lazyConnect: boolean;
                    connectTimeout: number;
                    commandTimeout: number;
                    enableReadyCheck: boolean;
                    family: number;
                    password?: string;
                } = {
                    maxRetriesPerRequest: 0,  // Don't retry failed requests
                    lazyConnect: true,
                    connectTimeout: 500,      // Shorter timeout
                    commandTimeout: 500,      // Timeout for individual commands
                    enableReadyCheck: false,  // Skip ready check
                    family: 4,               // Force IPv4
                };

                // Add password if provided via environment variable
                if (process.env.REDIS_PASSWORD) {
                    redisOptions.password = process.env.REDIS_PASSWORD;
                }

                this.redisClient = new Redis(this.config.redisUrl, redisOptions);
                
                // Handle Redis connection errors gracefully
                this.redisClient.on('error', (error: Error) => {
                    // Don't spam logs, just disable Redis quietly
                    if (!error.message.includes('ECONNREFUSED')) {
                        console.warn('[CacheService] Redis error, using memory cache:', error.message);
                    }
                    // Force disconnect to prevent hanging connections
                    if (this.redisClient) {
                        try {
                            this.redisClient.disconnect(false);
                        } catch {
                            // Ignore disconnect errors
                        }
                        this.redisClient = null;
                    }
                });
                
                this.redisClient.on('close', () => {
                    this.redisClient = null;
                });
                
                console.log('✅ Redis cache configured (connection will be tested on first use)');
            } catch (error) {
                console.warn('[CacheService] Failed to configure Redis, using memory cache only');
                this.redisClient = null;
            }
        }
        
        if (!this.redisClient) {
            console.log('✅ Memory cache initialized');
        }

        // Initialize DataLoaders
        this.blockIdLoader = new DataLoader<string, INotionModel | null>(
            async (blockIds) => {
                if (process.env.DEBUG_CACHE === 'true') {
                    console.log(`DataLoader: Loading ${blockIds.length} blocks by block_id`);
                }
                const records = await NotionModel.findAll({
                    where: { block_id: { [Op.in]: blockIds } }
                });

                // Map results to match the order of the input ids
                return blockIds.map(id => {
                    const record = records.find(r => r.block_id === id);
                    return record ? record.toJSON() : null;
                });
            },
            {
                cache: true, // Enable in-memory caching
                maxBatchSize: 100 // Limit batch size
            }
        );

        this.pageIdLoader = new DataLoader<string, INotionModel | null>(
            async (pageIds) => {
                if (process.env.DEBUG_CACHE === 'true') {
                    console.log(`DataLoader: Loading ${pageIds.length} blocks by page_id`);
                }
                // For page_id loader, we get the first record for each page_id
                const records = await NotionModel.findAll({
                    where: { page_id: { [Op.in]: pageIds } }
                });

                // Map results to match the order of the input ids, returning the first match for each page_id
                return pageIds.map(id => {
                    const record = records.find(r => r.page_id === id);
                    return record ? record.toJSON() : null;
                });
            },
            { cache: true }
        );

        this.parentIdLoader = new DataLoader<string, INotionModel[]>(
            async (parentIds) => {
                if (process.env.DEBUG_CACHE === 'true') {
                    console.log(`DataLoader: Loading blocks for ${parentIds.length} parent_ids`);
                }
                const records = await NotionModel.findAll({
                    where: { parent_id: { [Op.in]: parentIds } }
                });

                // Group results by parent_id
                const recordsByParentId = parentIds.map(parentId => {
                    const matchingRecords = records.filter(r => r.parent_id === parentId);
                    return matchingRecords.map(r => r.toJSON());
                });

                return recordsByParentId;
            },
            { cache: true }
        );

        this.typeLoader = new DataLoader<string, INotionModel[]>(
            async (types) => {
                if (process.env.DEBUG_CACHE === 'true') {
                    console.log(`DataLoader: Loading blocks for ${types.length} types`);
                }
                const records = await NotionModel.findAll({
                    where: { type: { [Op.in]: types } }
                });

                // Group results by type
                const recordsByType = types.map(type => {
                    const matchingRecords = records.filter(r => r.type === type);
                    return matchingRecords.map(r => r.toJSON());
                });

                return recordsByType;
            },
            { cache: true }
        );

        this.indexerLoader = new DataLoader<{ path: string, value: string }, INotionModel[]>(
            async (keys) => {
                if (process.env.DEBUG_CACHE === 'true') {
                    console.log(`DataLoader: Loading blocks for ${keys.length} indexer paths`);
                }

                // This requires multiple separate queries due to how JSON path queries work
                const results = await Promise.all(
                    keys.map(async ({ path, value }) => {
                        const whereClause = {
                            [Op.and]: [
                                literal(`(indexer->>'${path}') ILIKE '%${value}%'`)
                            ]
                        };

                        const records = await NotionModel.findAll({ where: whereClause });
                        return records.map(r => r.toJSON());
                    })
                );

                return results;
            },
            {
                cache: true,
                cacheKeyFn: key => key
            }
        );
    }

    public getBackendInfo(): { backend: 'redis' | 'memory'; redisUrl?: string } {
        if (this.config.useRedis && this.redisClient) {
            const redisUrl = process.env.REDIS_URL || this.config.redisUrl;
            return { backend: 'redis', redisUrl: redisUrl ? CacheService.sanitizeRedisUrl(redisUrl) : undefined };
        }

        return { backend: 'memory' };
    }

    /**
     * Get singleton instance of CacheService
     */
    public static getInstance(config?: CacheConfig): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService(config);
        }
        return CacheService.instance;
    }

    /**
     * Reset singleton instance - for testing purposes only
     */
    public static async resetInstance(): Promise<void> {
        if (CacheService.instance) {
            await CacheService.instance.shutdown();
            // @ts-expect-error - Intentionally setting to null for test cleanup
            CacheService.instance = null;
        }
    }

    /**
     * Clear all cache on both memory and Redis if available
     */
    public async clearAllCache(): Promise<void> {
        console.log('Clearing all cache');

        // Clear memory cache
        this.memoryCache.flushAll();

        // Clear DataLoader caches
        this.blockIdLoader.clearAll();
        this.pageIdLoader.clearAll();
        this.parentIdLoader.clearAll();
        this.typeLoader.clearAll();
        this.indexerLoader.clearAll();

        // Clear Redis cache if available
        if (this.redisClient) {
            try {
                await this.redisClient.flushall();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                if (!errorMessage.includes('ECONNREFUSED')) {
                    console.warn('[CacheService] Redis flush failed:', errorMessage);
                }
                this.redisClient = null;
            }
        }
    }

    /**
     * Get value from cache
     */
    public async get<T>(key: string): Promise<T | null> {
        // Check if caching is disabled
        if (process.env.DISABLE_CACHE === 'true') {
            return null;
        }

        // First try memory cache
        const memValue = this.memoryCache.get<T>(key);
        if (memValue !== undefined) {
            if (process.env.DEBUG_CACHE === 'true') {
                console.log(`Cache hit for key: ${key}`);
            }
            return memValue;
        }

        // Then try Redis if available
        if (this.redisClient) {
            try {
                const redisValue = await this.redisClient.get(key);
                if (redisValue) {
                    try {
                        if (process.env.DEBUG_CACHE === 'true') {
                            console.log(`Redis cache hit for key: ${key}`);
                        }
                        const parsed = JSON.parse(redisValue) as T;
                        // Update memory cache
                        this.memoryCache.set(key, parsed);
                        return parsed;
                    } catch (error) {
                        console.error(`Error parsing Redis value for key ${key}:`, error);
                    }
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                // Don't spam logs for connection errors
                if (!errorMessage.includes('ECONNREFUSED')) {
                    console.warn(`[CacheService] Redis get failed for key ${key}:`, errorMessage);
                }
                // Force disconnect and disable Redis client
                if (this.redisClient) {
                    try {
                        this.redisClient.disconnect(false);
                    } catch {
                        // Ignore disconnect errors
                    }
                    this.redisClient = null;
                }
            }
        }

        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache miss for key: ${key}`);
        }
        return null;
    }

    /**
     * Set value in cache
     */
    public async set<T>(key: string, value: T, ttl?: number): Promise<void> {
        // Check if caching is disabled
        if (process.env.DISABLE_CACHE === 'true') {
            return;
        }

        // Set in memory cache
        this.memoryCache.set(key, value, ttl || this.config.stdTTL);

        // Set in Redis if available
        if (this.redisClient) {
            try {
                await this.redisClient.set(
                    key,
                    JSON.stringify(value),
                    'EX',
                    ttl || this.config.stdTTL
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                // Don't spam logs for connection errors  
                if (!errorMessage.includes('ECONNREFUSED')) {
                    console.warn(`[CacheService] Redis set failed for key ${key}:`, errorMessage);
                }
                // Force disconnect and disable Redis client
                if (this.redisClient) {
                    try {
                        this.redisClient.disconnect(false);
                    } catch {
                        // Ignore disconnect errors
                    }
                    this.redisClient = null;
                }
            }
        }
    }

    /**
     * Remove item from cache
     */
    public async delete(key: string): Promise<void> {
        // Check if caching is disabled
        if (process.env.DISABLE_CACHE === 'true') {
            return;
        }

        // Delete from memory cache
        this.memoryCache.del(key);

        // Delete from Redis if available
        if (this.redisClient) {
            try {
                await this.redisClient.del(key);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                if (!errorMessage.includes('ECONNREFUSED')) {
                    console.warn(`[CacheService] Redis delete failed for key ${key}:`, errorMessage);
                }
                // Force disconnect and disable Redis client
                if (this.redisClient) {
                    try {
                        this.redisClient.disconnect(false);
                    } catch {
                        // Ignore disconnect errors
                    }
                    this.redisClient = null;
                }
            }
        }
    }

    /**
     * Remove multiple items matching a pattern
     */
    public async deletePattern(pattern: string): Promise<void> {
        // Check if caching is disabled
        if (process.env.DISABLE_CACHE === 'true') {
            return;
        }

        // For memory cache, we need to iterate over all keys
        const memKeys = this.memoryCache.keys();
        const matchingMemKeys = memKeys.filter(k => k.includes(pattern));
        this.memoryCache.del(matchingMemKeys);

        // For Redis we can use the SCAN command
        if (this.redisClient) {
            try {
                let cursor = '0';
                do {
                    const [nextCursor, keys] = await this.redisClient.scan(
                        cursor,
                        'MATCH',
                        `*${pattern}*`,
                        'COUNT',
                        '100'
                    );

                    cursor = nextCursor;
                    if (keys.length > 0) {
                        await this.redisClient.del(...keys);
                    }
                } while (cursor !== '0');
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                if (!errorMessage.includes('ECONNREFUSED')) {
                    console.warn(`[CacheService] Redis pattern delete failed for pattern ${pattern}:`, errorMessage);
                }
                this.redisClient = null;
            }
        }
    }

    /**
     * Invalidate cache when a record is created
     */
    public async invalidateOnCreate(model: INotionModel): Promise<void> {
        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Invalidating cache for new record: ${model.block_id}`);
        }

        // Clear type-based caches
        await this.deletePattern(`type:${model.type}`);

        // Clear page-based caches
        if (model.page_id) {
            await this.deletePattern(`page:${model.page_id}`);
        }

        // Clear parent-based caches
        if (model.parent_id) {
            await this.deletePattern(`parent:${model.parent_id}`);
        }

        // Clear complex query caches
        await this.deletePattern('query:');

        // Clear DataLoader caches
        this.typeLoader.clear(model.type);
        if (model.page_id) {
            this.pageIdLoader.clear(model.page_id);
        }
        if (model.parent_id) {
            this.parentIdLoader.clear(model.parent_id);
        }

        // For DynamicContent types, need more specific invalidation
        if (model.type === 'DynamicContent') {
            await this.deletePattern('dynamic:');
        }
    }

    /**
     * Invalidate cache when a record is updated
     */
    public async invalidateOnUpdate(blockId: string, model: Partial<INotionModel>): Promise<void> {
        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Invalidating cache for updated record: ${blockId}`);
        }

        // First, clear the specific block cache
        await this.delete(CacheKeys.blockId(blockId));
        this.blockIdLoader.clear(blockId);

        // If type is changed, invalidate both old and new type caches
        if (model.type) {
            await this.deletePattern(`type:${model.type}`);
            this.typeLoader.clear(model.type);
        }

        // If page_id is changed, invalidate both old and new page caches
        if (model.page_id) {
            await this.deletePattern(`page:${model.page_id}`);
            this.pageIdLoader.clear(model.page_id);
        }

        // If parent_id is changed, invalidate both old and new parent caches
        if (model.parent_id) {
            await this.deletePattern(`parent:${model.parent_id}`);
            this.parentIdLoader.clear(model.parent_id);
        }

        // Clear complex query caches
        await this.deletePattern('query:');

        // For DynamicContent types, need more specific invalidation
        if (model.type === 'DynamicContent') {
            await this.deletePattern('dynamic:');
        }
    }

    /**
     * Invalidate cache when a record is deleted
     */
    public async invalidateOnDelete(blockId: string, oldModel: INotionModel): Promise<void> {
        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Invalidating cache for deleted record: ${blockId}`);
        }

        // Clear the specific block cache
        await this.delete(CacheKeys.blockId(blockId));
        this.blockIdLoader.clear(blockId);

        // Clear type-based caches
        await this.deletePattern(`type:${oldModel.type}`);
        this.typeLoader.clear(oldModel.type);

        // Clear page-based caches
        if (oldModel.page_id) {
            await this.deletePattern(`page:${oldModel.page_id}`);
            this.pageIdLoader.clear(oldModel.page_id);
        }

        // Clear parent-based caches
        if (oldModel.parent_id) {
            await this.deletePattern(`parent:${oldModel.parent_id}`);
            this.parentIdLoader.clear(oldModel.parent_id);
        }

        // Clear complex query caches
        await this.deletePattern('query:');

        // For DynamicContent types, need more specific invalidation
        if (oldModel.type === 'DynamicContent') {
            await this.deletePattern('dynamic:');
        }
    }

    /**
     * Delete a specific key from the cache (alias for delete)
     */
    public async del(key: string): Promise<void> {
        return this.delete(key);
    }

    /**
     * Get by block_id using DataLoader (efficient batching and caching)
     */
    public async getByBlockId(blockId: string): Promise<INotionModel | null> {
        // Check if caching is disabled - fall back to direct database query
        if (process.env.DISABLE_CACHE === 'true') {
            if (process.env.DEBUG_CACHE === 'true') {
                console.log(`🚫 Cache disabled - direct query for block_id: ${blockId}`);
            }
            const record = await NotionModel.findOne({ where: { block_id: blockId } });
            return record ? record.toJSON() : null;
        }

        const cacheKey = CacheKeys.blockId(blockId);
        // Try to get from cache first
        const cached = await this.get<INotionModel>(cacheKey);
        if (cached) {
            return cached;
        }

        // Not in cache, use DataLoader to load it
        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache miss for block_id: ${blockId}`);
        }
        const result = await this.blockIdLoader.load(blockId);

        // If found, cache it
        if (result) {
            await this.set(cacheKey, result);
        }

        return result;
    }

    /**
     * Get by page_id using DataLoader (efficient batching and caching)
     */
    public async getByPageId(pageId: string): Promise<INotionModel | null> {
        // Check if caching is disabled - fall back to direct database query
        if (process.env.DISABLE_CACHE === 'true') {
            if (process.env.DEBUG_CACHE === 'true') {
                console.log(`🚫 Cache disabled - direct query for page_id: ${pageId}`);
            }
            const record = await NotionModel.findOne({ where: { page_id: pageId } });
            return record ? record.toJSON() : null;
        }

        const cacheKey = CacheKeys.pageId(pageId);
        // Try to get from cache first
        const cached = await this.get<INotionModel>(cacheKey);
        if (cached) {
            return cached;
        }

        // Not in cache, use DataLoader to load it
        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache miss for page_id: ${pageId}`);
        }
        const result = await this.pageIdLoader.load(pageId);

        // If found, cache it
        if (result) {
            await this.set(cacheKey, result);
        }

        return result;
    }

    /**
     * Get by parent_id using DataLoader (efficient batching and caching)
     */
    public async getByParentId(parentId: string, type?: string): Promise<INotionModel[]> {
        // Check if caching is disabled - fall back to direct database query
        if (process.env.DISABLE_CACHE === 'true') {
            if (process.env.DEBUG_CACHE === 'true') {
                console.log(`🚫 Cache disabled - direct query for parent_id: ${parentId}${type ? ` type: ${type}` : ''}`);
            }
            const whereClause: any = { parent_id: parentId };
            if (type) {
                whereClause.type = type;
            }
            const records = await NotionModel.findAll({ where: whereClause });
            return records.map(r => r.toJSON());
        }

        const cacheKey = CacheKeys.parentId(parentId, type);
        // Try to get from cache first
        const cached = await this.get<INotionModel[]>(cacheKey);
        if (cached) {
            return cached;
        }

        // Not in cache, use DataLoader to load it
        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache miss for parent_id: ${parentId}`);
        }
        const result = await this.parentIdLoader.load(parentId);

        // If type filter is specified, filter the results
        const filteredResult = type
            ? result.filter(item => item.type === type)
            : result;

        // Cache the result
        await this.set(cacheKey, filteredResult);

        return filteredResult;
    }

    /**
     * Get by type using DataLoader (efficient batching and caching)
     */
    public async getByType(type: string): Promise<INotionModel[]> {
        // Check if caching is disabled - fall back to direct database query
        if (process.env.DISABLE_CACHE === 'true') {
            if (process.env.DEBUG_CACHE === 'true') {
                console.log(`🚫 Cache disabled - direct query for type: ${type}`);
            }
            const records = await NotionModel.findAll({ where: { type } });
            return records.map(r => r.toJSON());
        }

        const cacheKey = CacheKeys.type(type);
        // Try to get from cache first
        const cached = await this.get<INotionModel[]>(cacheKey);
        if (cached) {
            return cached;
        }

        // Not in cache, use DataLoader to load it
        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache: Using type loader for ${type}`);
        }
        const result = await this.typeLoader.load(type);

        // Cache the result
        await this.set(cacheKey, result);

        return result;
    }

    /**
     * Load a record by ID - wrapper around blockIdLoader
     */
    public async loadById(id: string): Promise<INotionModel | null> {
        return this.getByBlockId(id);
    }

    /**
     * Delete all keys matching a pattern (alias for deletePattern)
     */
    public async invalidatePatternKeys(pattern: string): Promise<void> {
        return this.deletePattern(pattern);
    }

    /**
     * Get by indexer path and value using DataLoader (efficient batching and caching)
     */
    public getByIndexer(path: string, value: string): Promise<INotionModel[]> {
        // Check if caching is disabled - fall back to direct database query
        if (process.env.DISABLE_CACHE === 'true') {
            if (process.env.DEBUG_CACHE === 'true') {
                console.log(`🚫 Cache disabled - direct query for indexer: ${path}=${value}`);
            }
            const whereClause = {
                [Op.and]: [
                    literal(`(indexer->>'${path}') ILIKE '%${value}%'`)
                ]
            };
            return NotionModel.findAll({ where: whereClause }).then(records => 
                records.map(r => r.toJSON())
            );
        }

        const cacheKey = CacheKeys.indexer(path, value);
        // Try memory cache first
        const cached = this.memoryCache.get<INotionModel[]>(cacheKey);
        if (cached !== undefined) {
            if (process.env.DEBUG_CACHE === 'true') {
                console.log(`Cache hit for indexer: ${path}=${value}`);
            }
            return Promise.resolve(cached);
        }

        if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache miss for indexer: ${path}=${value}`);
        }
        return this.indexerLoader.load({ path, value }).then(result => {
            // Cache the result
            this.memoryCache.set(cacheKey, result);
            return result;
        });
    }

    /**
     * Get/set for complex queries with full where clause
     */
    public async getComplexQuery(
        whereClause: any,
        orderBy?: any,
        limit?: number,
        offset?: number
    ): Promise<INotionModel[] | null> {
        const key = CacheKeys.complexQuery(whereClause, orderBy, limit, offset);
        return this.get<INotionModel[]>(key);
    }

    public async setComplexQuery(
        whereClause: any,
        results: INotionModel[],
        orderBy?: any,
        limit?: number,
        offset?: number,
        ttl?: number
    ): Promise<void> {
        const key = CacheKeys.complexQuery(whereClause, orderBy, limit, offset);
        await this.set(key, results, ttl);
    }

    /**
     * Shutdown the cache service
     */
    public async shutdown(): Promise<void> {
        if (this.redisClient) {
            try {
                // Force disconnect immediately in test environment
                if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
                    this.redisClient.disconnect(false);
                } else {
                    await this.redisClient.quit();
                }
            } catch (error) {
                // Force disconnect if quit fails
                try {
                    this.redisClient.disconnect(false);
                } catch {
                    // Ignore any errors during force disconnect
                }
            }
            this.redisClient = null;
        }
    }
}

export default CacheService;
