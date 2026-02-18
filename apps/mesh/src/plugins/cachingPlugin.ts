/**
 * GraphQL Yoga caching plugin
 * 
 * This plugin provides response-level caching for GraphQL queries.
 * It complements the DataLoader caching used in resolvers.
 * 
 * Features:
 * - Caches entire GraphQL response by operation name and arguments
 * - Supports cache bypass with x-no-cache header
 * - Tracks resolver paths for fine-grained cache invalidation
 * - Integrates with CacheService for unified cache management
 */

import { CacheKeys, CacheService } from '../services/cache.service';

/**
 * Options for the caching plugin
 */
interface CachingPluginOptions {
    ttl?: number;
    includeMutations?: boolean;
    includeQueries?: boolean;
}

/**
 * Default options for the caching plugin
 */
const DEFAULT_OPTIONS: CachingPluginOptions = {
    ttl: 300, // 5 minutes in seconds
    includeMutations: false,
    includeQueries: true
};

type GraphQLRequest = {
    headers: {
        get: (name: string) => string | null;
    };
};

type ServerContext = {
    skipCache?: boolean;
    resolverPaths?: Array<{ path: string; args: any }>;
    cachedResult?: any;
};

type ResolverInfo = {
    path: {
        key: string;
        prev: any;
    };
};

/**
 * Create a GraphQL Yoga plugin for response caching
 * 
 * @param options Configuration options for the plugin
 * @returns A GraphQL Yoga plugin object with request and execution hooks
 */
export function createCachingPlugin(options: CachingPluginOptions = DEFAULT_OPTIONS) {
    const cacheService = CacheService.getInstance();
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    // Check if caching is disabled globally
    const isCachingDisabled = process.env.DISABLE_CACHE === 'true';

    if (isCachingDisabled) {
        if (process.env.DEBUG_CACHE === 'true') {
            console.log('🚫 Caching is disabled via DISABLE_CACHE environment variable');
        }
        // Return a no-op plugin when caching is disabled
        return {
            onRequest() { /* no-op */ },
            onResolverCalled() { /* no-op */ },
            async onExecute() { /* no-op */ },
            async onExecuteDone() { /* no-op */ }
        };
    }

    // Simple plugin object with hooks
    return {
        onRequest(params: { request: GraphQLRequest; serverContext: ServerContext }) {
            const { request, serverContext = {} } = params;
            // Initialize serverContext if it doesn't exist
            if (!serverContext) {
                params.serverContext = {};
            }

            // Skip caching if no-cache header is present
            const noCache = request.headers.get('x-no-cache') === 'true';
            if (noCache) {
                params.serverContext.skipCache = true;
            }
        },

        onResolverCalled(params: {
            info: ResolverInfo;
            root: any;
            args: any;
            context: any;
            serverContext: ServerContext
        }) {
            const { info, args, serverContext = {} } = params;

            // Initialize serverContext if it doesn't exist
            if (!params.serverContext) {
                params.serverContext = {};
            }

            // Initialize resolverPaths array if needed
            if (!params.serverContext.resolverPaths) {
                params.serverContext.resolverPaths = [];
            }

            // Only track top-level resolvers
            if (info.path.prev === undefined) {
                params.serverContext.resolverPaths.push({
                    path: info.path.key,
                    args
                });
            }
        },

        async onExecute(params: { args: any; serverContext: ServerContext }) {
            const { args, serverContext = {} } = params;

            // Initialize serverContext if it doesn't exist
            if (!params.serverContext) {
                params.serverContext = {};
            }

            // Skip if configured to or if mutation caching is disabled
            if (
                params.serverContext.skipCache ||
                (args.operation?.operation === 'mutation' && !mergedOptions.includeMutations) ||
                (args.operation?.operation === 'query' && !mergedOptions.includeQueries)
            ) {
                return;
            }

            // Check for cached operation result
            if (args.document && args.operationName) {
                const cacheKey = `operation:${args.operationName}:${JSON.stringify(args.variableValues || {})}`;

                try {
                    const cachedResult = await cacheService.get(cacheKey);
                    if (cachedResult) {
                        params.serverContext.cachedResult = cachedResult;
                        if (process.env.DEBUG_CACHE === 'true') {
                            console.log(`Cache hit for operation: ${args.operationName}`);
                        }
                    } else {
                        if (process.env.DEBUG_CACHE === 'true') {
                            console.log(`Cache miss for operation: ${args.operationName}`);
                        }
                    }
                } catch (error) {
                    console.error(`[CachingPlugin] Error retrieving cached operation:`, error);
                }
            }
        },

        async onExecuteDone(params: { result: any; serverContext: ServerContext }) {
            const { result, serverContext = {} } = params;

            // Initialize serverContext if it doesn't exist
            if (!params.serverContext) {
                params.serverContext = {};
            }

            // Return cached result if available
            if (params.serverContext.cachedResult) {
                Object.assign(result, params.serverContext.cachedResult);
                return;
            }

            // Skip if not configured for caching
            if (
                params.serverContext.skipCache ||
                !params.serverContext.resolverPaths ||
                params.serverContext.resolverPaths.length === 0
            ) {
                return;
            }

            // Check if this is a mutation operation
            const isMutation = params.serverContext.resolverPaths?.some(
                path => path.path.startsWith('update') ||
                    path.path.startsWith('create') ||
                    path.path.startsWith('delete')
            ) || false;

            if (isMutation) {
                if (process.env.DEBUG_CACHE === 'true') {
                    console.log(`[CachingPlugin] Detected mutation, invalidating caches`);
                }
                try {
                    // Get the mutation details
                    const path = params.serverContext.resolverPaths?.[0]?.path;
                    const args = params.serverContext.resolverPaths?.[0]?.args;

                    // Handle specific mutation types
                    if (path.includes('NotionModel')) {
                        if (args.id) {
                            await cacheService.delete(CacheKeys.blockId(args.id));
                        }

                        // For all mutations, invalidate type and parent caches
                        await cacheService.deletePattern('type:*');
                        await cacheService.deletePattern('parent:*');
                    }
                } catch (error) {
                    console.error(`[CachingPlugin] Error invalidating caches:`, error);
                }
                return;
            }

            // Cache successful query results
            if (result && !result.errors && params.serverContext.resolverPaths?.length) {
                try {
                    const path = params.serverContext.resolverPaths[0].path;
                    const args = params.serverContext.resolverPaths[0].args || {};

                    const cacheKey = `operation:${path}:${JSON.stringify(args)}`;

                    // Store in cache with configured TTL
                    await cacheService.set(cacheKey, result, mergedOptions.ttl);

                    if (process.env.DEBUG_CACHE === 'true') {
                        console.log(`Cached result for ${path} with key ${cacheKey}`);
                    }
                } catch (error) {
                    console.error(`[CachingPlugin] Error caching result:`, error);
                }
            }
        }
    };
}
