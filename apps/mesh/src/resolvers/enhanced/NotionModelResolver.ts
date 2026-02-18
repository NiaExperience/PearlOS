/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Enhanced NotionModelResolver with Caching - Migrated from NotionFacet
 * 
 * This resolver integrates the functionality previously in NotionFacet
 * while maintaining proper GraphQL abstractions and keeping Notion-awareness 
 * contained in this layer. It now includes a robust caching strategy.
 */

import { IResolvers } from '@graphql-tools/utils';
import { GraphQLResolveInfo } from 'graphql';
import GraphQLJSON from 'graphql-type-json';
import { Op, literal } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

import { NotionModel } from '../db';
import { INotionModel } from '../models/notion-model';

// Conditionally import the cache service - helps with tests
let CacheService: any;
let CacheKeys: any;
let cacheService: any;

try {
  // Try to import the cache service
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cacheModule = require('../../services/cache.service');
  CacheService = cacheModule.CacheService;
  CacheKeys = cacheModule.CacheKeys;
  // Get cache service instance
  cacheService = CacheService.getInstance();
  console.log('✅ Cache service initialized successfully');
} catch (error: unknown) {
  // Fallback for tests or environments without cache
  console.warn('⚠️ Cache service not available:', (error as Error).message);
  // Provide dummy implementations
  CacheKeys = {
    blockId: (id: string) => `block:${id}`,
    pageId: (id: string) => `page:${id}`,
    parentId: (id: string) => `parent:${id}`,
    type: (type: string) => `type:${type}`,
    complexQuery: () => 'query',
  };

  cacheService = {
    getByBlockId: async () => null,
    getByPageId: async () => null,
    getByParentId: async () => [],
    getByType: async () => [],
    getByIndexer: async () => [],
    getComplexQuery: async () => null,
    setComplexQuery: async () => { },
    invalidateOnCreate: async () => { },
    invalidateOnUpdate: async () => { },
    invalidateOnDelete: async () => { },
  };
}

// Parent relationship configuration
export interface DynamicContentParent {
  type: 'none' | 'id' | 'field';
  id?: string;
  field?: string;
}

/**
 * NotionModelResolver - GraphQL resolver for NotionModel with caching
 */
export const NotionModelResolver: IResolvers = {
  JSON: GraphQLJSON,

  Query: {
    // Resolver for getting NotionModel records with filtering
    notionModel: async (
      _: any,
      args: {
        where?: any;
        orderBy?: Array<{ field: string; direction: 'ASC' | 'DESC' }>;
        limit?: number;
        offset?: number;
      },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      try {
        // First, check if we have optimized cache paths for common query patterns

        // 1. Simple type query - use DataLoader
        if (args.where?.type?.eq && Object.keys(args.where).length === 1) {
          if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache: Using type loader for ${args.where.type.eq}`);
          }
          return cacheService.getByType(args.where.type.eq);
        }

        // 2. Simple page_id query - use DataLoader
        if (args.where?.page_id?.eq && Object.keys(args.where).length === 1) {
          if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache: Using page_id loader for ${args.where.page_id.eq}`);
          }
          const model = await cacheService.getByPageId(args.where.page_id.eq);
          return model ? [model] : [];
        }

        // 3. Simple parent_id query - use DataLoader
        if (args.where?.parent_id?.eq &&
          args.where.parent_id.eq !== 'any' &&
          Object.keys(args.where).length === 1) {
          if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache: Using parent_id loader for ${args.where.parent_id.eq}`);
          }
          return cacheService.getByParentId(args.where.parent_id.eq);
        }

        // 4. Simple indexer query with a single path and value
        if (args.where?.indexer?.path &&
          (args.where.indexer.equals || args.where.indexer.contains) &&
          Object.keys(args.where).length === 1) {
          const path = args.where.indexer.path;
          const value = args.where.indexer.equals || args.where.indexer.contains;
          if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache: Using indexer loader for ${path}:${value}`);
          }
          return cacheService.getByIndexer(path, value);
        }

        // For more complex queries, check the complex query cache
        const cachedResults = await cacheService.getComplexQuery(
          args.where,
          args.orderBy,
          args.limit,
          args.offset
        );

        if (cachedResults) {
          if (process.env.DEBUG_CACHE === 'true') {
            console.log('Cache hit for complex query');
          }
          return cachedResults;
        }

        // Cache miss - execute the query and cache the results
        if (process.env.DEBUG_CACHE === 'true') {
          console.log('Cache miss for complex query, executing database query');
        }
        // Convert GraphQL filters to Sequelize where clause
        const whereClause: any = {};
        const options: any = {};

        if (args.where) {
          // Handle type filtering
          if (args.where.type) {
            if (args.where.type.eq) {
              whereClause.type = args.where.type.eq;
            }
          }

          // Handle page_id filtering
          if (args.where.page_id) {
            if (args.where.page_id.eq) {
              whereClause.page_id = args.where.page_id.eq;
            }
            if (args.where.page_id.in) {
              whereClause.page_id = {
                [Op.in]: args.where.page_id.in
              };
            }
          }

          // Handle parent_id filtering  
          if (args.where.parent_id) {
            if (args.where.parent_id.eq) {
              // Special case: 'any' means don't filter by parent_id
              if (args.where.parent_id.eq !== 'any') {
                whereClause.parent_id = args.where.parent_id.eq;
              }
            }
            if (args.where.parent_id.in) {
              whereClause.parent_id = {
                [Op.in]: args.where.parent_id.in
              };
            }
          }

          // Handle indexer JSON path filtering
          if (args.where.indexer) {
            if (args.where.indexer.path) {
              const path = args.where.indexer.path;
              const pathParts = path.split('.').map((p: string) => p.trim()).filter((p: string) => p.length > 0);
              const jsonbExpr = pathParts.reduce((acc: string, part: string) => `(${acc} -> '${part}')`, 'indexer');
              const jsonbArrayExpr = `coalesce(${jsonbExpr}, '[]'::jsonb)`;

              if (args.where.indexer.equals) {
                // For exact matches, use JSON path equality
                const value = args.where.indexer.equals;
                whereClause.indexer = {
                  [Op.contains]: {
                    [path]: value
                  }
                };
              } else if (args.where.indexer.contains) {
                // For partial matches, use JSON path with LIKE operator
                const value = args.where.indexer.contains;
                // Use Sequelize.literal for JSONB path text search
                whereClause[Op.and] = [
                  ...(whereClause[Op.and] || []),
                  literal(`(indexer->>'${path}') ILIKE '%${value}%'`)
                ];
              } else if (args.where.indexer.has) {
                const valueLiteral = JSON.stringify([args.where.indexer.has]).replace(/'/g, "''");
                whereClause[Op.and] = [
                  ...(whereClause[Op.and] || []),
                  literal(`${jsonbArrayExpr} @> '${valueLiteral}'::jsonb`)
                ];
              } else if (args.where.indexer.hasSome) {
                const values = Array.isArray(args.where.indexer.hasSome)
                  ? args.where.indexer.hasSome
                  : [args.where.indexer.hasSome];
                const checks = values.map((v: any) => `${jsonbArrayExpr} @> '${JSON.stringify([v]).replace(/'/g, "''")}'::jsonb`);
                whereClause[Op.and] = [
                  ...(whereClause[Op.and] || []),
                  literal(checks.join(' OR '))
                ];
              } else if (args.where.indexer.hasEvery) {
                const values = Array.isArray(args.where.indexer.hasEvery)
                  ? args.where.indexer.hasEvery
                  : [args.where.indexer.hasEvery];
                const checks = values.map((v: any) => `${jsonbArrayExpr} @> '${JSON.stringify([v]).replace(/'/g, "''")}'::jsonb`);
                whereClause[Op.and] = [
                  ...(whereClause[Op.and] || []),
                  literal(checks.join(' AND '))
                ];
              } else if (args.where.indexer.hasNone) {
                const values = Array.isArray(args.where.indexer.hasNone)
                  ? args.where.indexer.hasNone
                  : [args.where.indexer.hasNone];
                const checks = values.map((v: any) => `NOT (${jsonbArrayExpr} @> '${JSON.stringify([v]).replace(/'/g, "''")}'::jsonb)`);
                whereClause[Op.and] = [
                  ...(whereClause[Op.and] || []),
                  literal(checks.join(' AND '))
                ];
              } else if (args.where.indexer.hasKey) {
                const key = String(args.where.indexer.hasKey).replace(/'/g, "''");
                const existsExpr = `((jsonb_typeof(${jsonbExpr}) = 'object' AND jsonb_exists(${jsonbExpr}, '${key}')) OR (jsonb_typeof(${jsonbExpr}) = 'array' AND jsonb_exists(${jsonbExpr}, '${key}')))`;
                whereClause[Op.and] = [
                  ...(whereClause[Op.and] || []),
                  literal(existsExpr)
                ];
              } else if (args.where.indexer.hasAnyKeys) {
                const keys = Array.isArray(args.where.indexer.hasAnyKeys)
                  ? args.where.indexer.hasAnyKeys
                  : [args.where.indexer.hasAnyKeys];
                const checks = keys.map((k: string) => {
                  const safeKey = String(k).replace(/'/g, "''");
                  return `((jsonb_typeof(${jsonbExpr}) = 'object' AND jsonb_exists(${jsonbExpr}, '${safeKey}')) OR (jsonb_typeof(${jsonbExpr}) = 'array' AND jsonb_exists(${jsonbExpr}, '${safeKey}')))`;
                });
                whereClause[Op.and] = [
                  ...(whereClause[Op.and] || []),
                  literal(checks.join(' OR '))
                ];
              } else if (args.where.indexer.hasAllKeys) {
                const keys = Array.isArray(args.where.indexer.hasAllKeys)
                  ? args.where.indexer.hasAllKeys
                  : [args.where.indexer.hasAllKeys];
                const checks = keys.map((k: string) => {
                  const safeKey = String(k).replace(/'/g, "''");
                  return `((jsonb_typeof(${jsonbExpr}) = 'object' AND jsonb_exists(${jsonbExpr}, '${safeKey}')) OR (jsonb_typeof(${jsonbExpr}) = 'array' AND jsonb_exists(${jsonbExpr}, '${safeKey}')))`;
                });
                whereClause[Op.and] = [
                  ...(whereClause[Op.and] || []),
                  literal(checks.join(' AND '))
                ];
              }
            }
          }

          // Handle contentJsonb filtering (for dot-notation queries on content field)
          if (args.where.contentJsonb) {
            const jsonbFilters = Array.isArray(args.where.contentJsonb)
              ? args.where.contentJsonb
              : [args.where.contentJsonb];

            for (const filter of jsonbFilters) {
              if (filter.path) {
                const pathParts = filter.path.split('.');
                // Build proper JSONB path: 'key1'->'key2'->>'key3' for nested access
                const jsonbPathForObject = pathParts.map((p: any) => `'${p}'`).join('->');
                // For text extraction, the last part uses ->> operator
                // For path "data.level": "'data'->>'level'"
                // For path "data.user.age": "'data'->'user'->>'age'"
                let jsonbPathText: string;
                if (pathParts.length === 1) {
                  jsonbPathText = `->>'${pathParts[0]}'`;
                } else {
                  const middleParts = pathParts.slice(0, -1).map((p: any) => `'${p}'`).join('->');
                  const lastPart = pathParts[pathParts.length - 1];
                  jsonbPathText = `->${middleParts}->>'${lastPart}'`;
                }

                // Handle different operators
                if (filter.eq !== undefined) {
                  if (typeof filter.eq === 'number') {
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`(content${jsonbPathText})::numeric = ${filter.eq}`)
                    ];
                  } else if (typeof filter.eq === 'string') {
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`content${jsonbPathText} = '${filter.eq}'`)
                    ];
                  } else {
                    // JSON comparison
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`content->${jsonbPathForObject} = '${JSON.stringify(filter.eq)}'::jsonb`)
                    ];
                  }
                }

                if (filter.ne !== undefined) {
                  if (typeof filter.ne === 'number') {
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`(content${jsonbPathText})::numeric != ${filter.ne}`)
                    ];
                  } else {
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`content${jsonbPathText} != '${filter.ne}'`)
                    ];
                  }
                }

                if (filter.gt !== undefined) {
                  whereClause[Op.and] = [
                    ...(whereClause[Op.and] || []),
                    literal(`(content${jsonbPathText})::numeric > ${filter.gt}`)
                  ];
                }

                if (filter.gte !== undefined) {
                  whereClause[Op.and] = [
                    ...(whereClause[Op.and] || []),
                    literal(`(content${jsonbPathText})::numeric >= ${filter.gte}`)
                  ];
                }

                if (filter.lt !== undefined) {
                  whereClause[Op.and] = [
                    ...(whereClause[Op.and] || []),
                    literal(`(content${jsonbPathText})::numeric < ${filter.lt}`)
                  ];
                }

                if (filter.lte !== undefined) {
                  whereClause[Op.and] = [
                    ...(whereClause[Op.and] || []),
                    literal(`(content${jsonbPathText})::numeric <= ${filter.lte}`)
                  ];
                }

                if (filter.in) {
                  // Check if all values are numbers for proper casting
                  const hasNumbers = filter.in.some((v: any) => typeof v === 'number');
                  const inValues = filter.in.map((v: any) =>
                    typeof v === 'number' ? v : `'${v}'`
                  ).join(',');

                  if (hasNumbers) {
                    // Cast to numeric for numeric comparisons
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`(content${jsonbPathText})::numeric IN (${inValues})`)
                    ];
                  } else {
                    // String comparison
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`content${jsonbPathText} IN (${inValues})`)
                    ];
                  }
                }

                if (filter.contains !== undefined) {
                  if (typeof filter.contains === 'string') {
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`content${jsonbPathText} ILIKE '%${filter.contains}%'`)
                    ];
                  } else {
                    // JSON containment
                    whereClause[Op.and] = [
                      ...(whereClause[Op.and] || []),
                      literal(`content->${jsonbPathForObject} @> '${JSON.stringify(filter.contains)}'::jsonb`)
                    ];
                  }
                }
              }
            }
          }

          // Handle AND clause with multiple conditions
          if (args.where.AND && Array.isArray(args.where.AND)) {
            const andConditions: any[] = [];

            for (const andCondition of args.where.AND) {
              // Handle contentJsonb conditions within AND
              if (andCondition.contentJsonb) {
                const filter = andCondition.contentJsonb;
                if (filter.path) {
                  const pathParts = filter.path.split('.');
                  const jsonbPathForObject = pathParts.map((p: any) => `'${p}'`).join('->');
                  let jsonbPathText: string;
                  if (pathParts.length === 1) {
                    jsonbPathText = `->>'${pathParts[0]}'`;
                  } else {
                    const middleParts = pathParts.slice(0, -1).map((p: any) => `'${p}'`).join('->');
                    const lastPart = pathParts[pathParts.length - 1];
                    jsonbPathText = `->${middleParts}->>'${lastPart}'`;
                  }

                  // Handle different operators
                  if (filter.eq !== undefined) {
                    if (typeof filter.eq === 'number') {
                      andConditions.push(literal(`(content${jsonbPathText})::numeric = ${filter.eq}`));
                    } else if (typeof filter.eq === 'string') {
                      andConditions.push(literal(`content${jsonbPathText} = '${filter.eq}'`));
                    } else {
                      andConditions.push(literal(`content->${jsonbPathForObject} = '${JSON.stringify(filter.eq)}'::jsonb`));
                    }
                  }
                  if (filter.ne !== undefined) {
                    if (typeof filter.ne === 'number') {
                      andConditions.push(literal(`(content${jsonbPathText})::numeric != ${filter.ne}`));
                    } else {
                      andConditions.push(literal(`content${jsonbPathText} != '${filter.ne}'`));
                    }
                  }
                  if (filter.gt !== undefined) {
                    andConditions.push(literal(`(content${jsonbPathText})::numeric > ${filter.gt}`));
                  }
                  if (filter.gte !== undefined) {
                    andConditions.push(literal(`(content${jsonbPathText})::numeric >= ${filter.gte}`));
                  }
                  if (filter.lt !== undefined) {
                    andConditions.push(literal(`(content${jsonbPathText})::numeric < ${filter.lt}`));
                  }
                  if (filter.lte !== undefined) {
                    andConditions.push(literal(`(content${jsonbPathText})::numeric <= ${filter.lte}`));
                  }
                  if (filter.in) {
                    const hasNumbers = filter.in.some((v: any) => typeof v === 'number');
                    const inValues = filter.in.map((v: any) =>
                      typeof v === 'number' ? v : `'${v}'`
                    ).join(',');
                    if (hasNumbers) {
                      andConditions.push(literal(`(content${jsonbPathText})::numeric IN (${inValues})`));
                    } else {
                      andConditions.push(literal(`content${jsonbPathText} IN (${inValues})`));
                    }
                  }
                  if (filter.contains !== undefined) {
                    if (typeof filter.contains === 'string') {
                      andConditions.push(literal(`content${jsonbPathText} ILIKE '%${filter.contains}%'`));
                    } else {
                      andConditions.push(literal(`content->${jsonbPathForObject} @> '${JSON.stringify(filter.contains)}'::jsonb`));
                    }
                  }
                }
              }

              // Handle indexer conditions within AND
              if (andCondition.indexer) {
                if (andCondition.indexer.path) {
                  const path = andCondition.indexer.path;

                  if (andCondition.indexer.equals) {
                    // For exact matches, use JSON path equality
                    const value = andCondition.indexer.equals;
                    andConditions.push({
                      indexer: {
                        [Op.contains]: {
                          [path]: value
                        }
                      }
                    });
                  } else if (andCondition.indexer.contains) {
                    // For partial matches, use JSON path with LIKE operator
                    const value = andCondition.indexer.contains;
                    andConditions.push(
                      literal(`(indexer->>'${path}') ILIKE '%${value}%'`)
                    );
                  }
                }
              }

              // Handle other condition types within AND (type, page_id, etc.)
              if (andCondition.type?.eq) {
                andConditions.push({ type: andCondition.type.eq });
              }
              if (andCondition.page_id?.eq) {
                andConditions.push({ page_id: andCondition.page_id.eq });
              }
              if (andCondition.parent_id?.eq) {
                andConditions.push({ parent_id: andCondition.parent_id.eq });
              }
            }

            // Combine AND conditions with existing where clause
            if (andConditions.length > 0) {
              whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                ...andConditions
              ];
            }
          }

          // Handle OR clause with multiple conditions
          if (args.where.OR && Array.isArray(args.where.OR)) {
            const orConditions: any[] = [];

            for (const orCondition of args.where.OR) {
              // Handle contentJsonb conditions within OR
              if (orCondition.contentJsonb) {
                const filter = orCondition.contentJsonb;
                if (filter.path) {
                  const pathParts = filter.path.split('.');
                  const jsonbPathForObject = pathParts.map((p: any) => `'${p}'`).join('->');
                  let jsonbPathText: string;
                  if (pathParts.length === 1) {
                    jsonbPathText = `->>'${pathParts[0]}'`;
                  } else {
                    const middleParts = pathParts.slice(0, -1).map((p: any) => `'${p}'`).join('->');
                    const lastPart = pathParts[pathParts.length - 1];
                    jsonbPathText = `->${middleParts}->>'${lastPart}'`;
                  }

                  // Handle different operators
                  if (filter.eq !== undefined) {
                    if (typeof filter.eq === 'number') {
                      orConditions.push(literal(`(content${jsonbPathText})::numeric = ${filter.eq}`));
                    } else if (typeof filter.eq === 'string') {
                      orConditions.push(literal(`content${jsonbPathText} = '${filter.eq}'`));
                    } else {
                      orConditions.push(literal(`content->${jsonbPathForObject} = '${JSON.stringify(filter.eq)}'::jsonb`));
                    }
                  }
                  if (filter.ne !== undefined) {
                    if (typeof filter.ne === 'number') {
                      orConditions.push(literal(`(content${jsonbPathText})::numeric != ${filter.ne}`));
                    } else {
                      orConditions.push(literal(`content${jsonbPathText} != '${filter.ne}'`));
                    }
                  }
                  if (filter.gt !== undefined) {
                    orConditions.push(literal(`(content${jsonbPathText})::numeric > ${filter.gt}`));
                  }
                  if (filter.gte !== undefined) {
                    orConditions.push(literal(`(content${jsonbPathText})::numeric >= ${filter.gte}`));
                  }
                  if (filter.lt !== undefined) {
                    orConditions.push(literal(`(content${jsonbPathText})::numeric < ${filter.lt}`));
                  }
                  if (filter.lte !== undefined) {
                    orConditions.push(literal(`(content${jsonbPathText})::numeric <= ${filter.lte}`));
                  }
                  if (filter.in) {
                    const hasNumbers = filter.in.some((v: any) => typeof v === 'number');
                    const inValues = filter.in.map((v: any) =>
                      typeof v === 'number' ? v : `'${v}'`
                    ).join(',');
                    if (hasNumbers) {
                      orConditions.push(literal(`(content${jsonbPathText})::numeric IN (${inValues})`));
                    } else {
                      orConditions.push(literal(`content${jsonbPathText} IN (${inValues})`));
                    }
                  }
                  if (filter.contains !== undefined) {
                    if (typeof filter.contains === 'string') {
                      orConditions.push(literal(`content${jsonbPathText} ILIKE '%${filter.contains}%'`));
                    } else {
                      orConditions.push(literal(`content->${jsonbPathForObject} @> '${JSON.stringify(filter.contains)}'::jsonb`));
                    }
                  }
                }
              }

              // Handle indexer conditions within OR
              if (orCondition.indexer) {
                if (orCondition.indexer.path) {
                  const path = orCondition.indexer.path;

                  if (orCondition.indexer.equals) {
                    const value = orCondition.indexer.equals;
                    orConditions.push({
                      indexer: {
                        [Op.contains]: {
                          [path]: value
                        }
                      }
                    });
                  } else if (orCondition.indexer.contains) {
                    const value = orCondition.indexer.contains;
                    orConditions.push(
                      literal(`(indexer->>'${path}') ILIKE '%${value}%'`)
                    );
                  }
                }
              }

              // Handle other condition types within OR (type, page_id, etc.)
              if (orCondition.type?.eq) {
                orConditions.push({ type: orCondition.type.eq });
              }
              if (orCondition.page_id?.eq) {
                orConditions.push({ page_id: orCondition.page_id.eq });
              }
              if (orCondition.parent_id?.eq) {
                orConditions.push({ parent_id: orCondition.parent_id.eq });
              }
            }

            // Combine OR conditions with existing where clause
            if (orConditions.length > 0) {
              whereClause[Op.or] = orConditions;
            }
          }
        }

        // Handle ordering
        if (args.orderBy && args.orderBy.length > 0) {
          options.order = args.orderBy.map(order => [order.field, order.direction]);
        }

        // Handle pagination
        if (args.limit) options.limit = args.limit;
        if (args.offset) options.offset = args.offset;

        // Debug: Log the where clause for JSONB filters
        if (process.env.DEBUG_PRISM === 'true' && whereClause[Op.and]) {
          console.log('[JSONB Filter Debug] Generated where clause:', JSON.stringify(whereClause, null, 2));
          console.log('[JSONB Filter Debug] AND conditions:', whereClause[Op.and]);
        }

        // Query using Sequelize model
        const results = await NotionModel.findAll({
          where: whereClause,
          ...options
        });

        // Convert to JSON
        const jsonResults = results.map(result => result.toJSON());

        // Cache the results
        await cacheService.setComplexQuery(
          args.where,
          jsonResults,
          args.orderBy,
          args.limit,
          args.offset
        );

        return jsonResults;
      } catch (error) {
        console.error('Error fetching NotionModel records:', error);
        throw error;
      }
    },    // Resolver for getting a single NotionModel record by page_id
    notionModelByPageId: async (
      _: any,
      { page_id }: { page_id: string },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      try {
        // Try to get from cache first
        const cachedModel = await cacheService.getByPageId(page_id);
        if (cachedModel) {
          if (process.env.DEBUG_CACHE === 'true') {
            console.log(`Cache hit for page_id: ${page_id}`);
          }
          return cachedModel;
        }

        if (process.env.DEBUG_CACHE === 'true') {
          console.log(`Cache miss for page_id: ${page_id}`);
        }
        const result = await NotionModel.findOne({
          where: { page_id }
        });

        // If no result, return null
        if (!result) return null;

        // Convert to JSON and return
        return result.toJSON();
      } catch (error) {
        console.error(`Error fetching NotionModel with page_id ${page_id}:`, error);
        throw error;
      }
    }
  },

  Mutation: {
    // Create a new NotionModel record
    createNotionModel: async (
      _: any,
      { input }: { input: Omit<INotionModel, 'id' | 'block_id'> },
      context: any
    ) => {
      try {
        // Bot control auth: If both serviceTrusted and botControlTrusted are true,
        // bot service has tenant-wide access to create notes (bypasses user ownership checks)
        const isBotService = context?.serviceTrusted && context?.botControlTrusted;

        if (process.env.DEBUG_BOT_AUTH === 'true' && isBotService) {
          console.log(`🤖 Bot service authenticated - tenant-wide note access granted for create operation`);
        }

        if (process.env.DEBUG_CACHE === 'true') {
          console.log('🔍 [createNotionModel] Received input:', JSON.stringify(input, null, 2));
        }

        // Use a transaction to ensure data consistency
        const result = await NotionModel.sequelize!.transaction(async (transaction) => {
          const page_id = input.page_id || uuidv4();

          // Parse content if it's a JSON string, to store as actual JSONB
          let parsedContent: any;
          if (typeof input.content === 'string') {
            try {
              parsedContent = JSON.parse(input.content);
            } catch {
              // If parsing fails, keep as string
              parsedContent = input.content;
            }
          } else {
            parsedContent = input.content;
          }

          const createData = {
            ...input,
            // Generate page_id if not provided - block_id will be auto-generated by the model
            page_id: page_id,
            // Store parsed JSON for JSONB column
            content: parsedContent
          };

          if (process.env.DEBUG_CACHE === 'true') {
            console.log('🔍 [createNotionModel] Creating with data:', JSON.stringify(createData, null, 2));
          }

          const createdModel = await NotionModel.create(createData, { transaction });

          if (process.env.DEBUG_CACHE === 'true') {
            console.log('🔍 [createNotionModel] Created model:', JSON.stringify(createdModel.toJSON(), null, 2));
          }

          return createdModel;
        });

        // Convert to JSON
        const jsonResult = result.toJSON();

        // Invalidate cache
        await cacheService.invalidateOnCreate(jsonResult);

        return jsonResult;
      } catch (error) {
        console.error('Error creating NotionModel:', error);
        throw error;
      }
    },

    bulkCreateNotionModel: async (
      _: any,
      { inputs }: { inputs: Omit<INotionModel, 'id' | 'block_id'>[] },
      context: any
    ) => {
      try {
        // Use a transaction to ensure data consistency
        const results = await NotionModel.sequelize!.transaction(async (transaction) => {
          // Prepare data for bulk creation
          const objects = inputs.map(item => {
            // Parse content if it's a JSON string
            let parsedContent = item.content;
            if (typeof item.content === 'string') {
              try {
                parsedContent = JSON.parse(item.content);
              } catch {
                // If parsing fails, keep as string
              }
            }

            return {
              ...item,
              // Generate page_id if not provided - block_id will be auto-generated
              page_id: item.page_id || uuidv4(),
              // Content is now JSONB, use parsed content
              content: parsedContent
            };
          });

          // Create records using Sequelize bulk create within transaction
          return await NotionModel.bulkCreate(objects, { transaction });
        });

        // Convert to JSON
        const jsonResults = results.map(result => result.toJSON());

        // Invalidate cache for each created model
        await Promise.all(jsonResults.map(model => cacheService.invalidateOnCreate(model)));

        return jsonResults;
      } catch (error) {
        console.error('Error creating NotionModel:', error);
        throw error;
      }
    },

    // Update an existing NotionModel record
    updateNotionModel: async (
      _: any,
      { block_id, input }: { block_id: string; input: Partial<INotionModel> },
      context: any
    ) => {
      try {
        // Bot control auth: If both serviceTrusted and botControlTrusted are true,
        // bot service has tenant-wide access to update notes (bypasses user ownership checks)
        // This is used for collaborative notes where bot edits shared/work notes during calls
        const isBotService = context?.serviceTrusted && context?.botControlTrusted;

        if (process.env.DEBUG_BOT_AUTH === 'true' && isBotService) {
          console.log(`🤖 Bot service authenticated - tenant-wide note access granted for update operation`);
        }

        // Feature flag for partial updates (PostgreSQL JSONB merge)
        const usePartialUpdates = process.env.ENABLE_PARTIAL_UPDATES !== 'false';

        // pg-mem workaround: The in-memory test database doesn't support the || operator properly
        // In test mode, we fetch existing record and perform merge manually to mimic PostgreSQL behavior
        const isPgMemTestMode = process.env.NODE_ENV === 'test';

        // Use a transaction to ensure data consistency
        const updatedRecord = await NotionModel.sequelize!.transaction(async (transaction) => {
          // Build update object with JSONB merge for content field
          const updateFields: any = {};

          if (usePartialUpdates && !isPgMemTestMode) {
            // Use PostgreSQL || operator for atomic shallow merge on JSONB fields
            // Top-level fields merge, nested objects are replaced (standard JSONB behavior)
            for (const [key, value] of Object.entries(input)) {
              // Parse content/indexer if it's a JSON string, to ensure we merge objects not strings
              let parsedValue = value;
              if ((key === 'content' || key === 'indexer') && typeof value === 'string') {
                try {
                  parsedValue = JSON.parse(value);
                } catch {
                  // If parsing fails, keep as string
                }
              }

              if (key === 'content' && parsedValue !== null && parsedValue !== undefined) {
                // Escape single quotes in JSON for SQL safety
                const escapedJson = JSON.stringify(parsedValue).replace(/'/g, "''");
                if (process.env.DEBUG_PRISM === 'true') {
                  console.log('🔍 [NotionModelResolver] PostgreSQL mode - merging content:', escapedJson);
                }
                // Use PostgreSQL's || operator for JSONB merge
                // This merges incoming content with existing content atomically at top level
                // Nested objects are REPLACED, not deep merged (standard PostgreSQL behavior)
                updateFields.content = literal(`content || '${escapedJson}'::jsonb`);
              } else if (key === 'indexer' && parsedValue !== null && parsedValue !== undefined) {
                // CRITICAL: Also merge indexer field to preserve indexed fields not in the update
                // Without this, partial updates lose indexer fields (e.g., updating role loses organizationId)
                const escapedJson = JSON.stringify(parsedValue).replace(/'/g, "''");
                updateFields.indexer = literal(`indexer || '${escapedJson}'::jsonb`);
              } else {
                // Regular field updates
                updateFields[key] = value;
              }
            }
          } else if (usePartialUpdates && isPgMemTestMode) {
            // pg-mem workaround: Manually mimic PostgreSQL || operator behavior
            // Fetch existing record to perform client-side shallow merge
            const existingRecord = await NotionModel.findOne({
              where: { block_id },
              transaction
            });

            if (!existingRecord) {
              throw new Error(`NotionModel with block_id ${block_id} not found`);
            }

            // Apply updates with shallow merge for content and indexer (mimics PostgreSQL || operator)
            for (const [key, value] of Object.entries(input)) {
              // Parse content/indexer if it's a JSON string
              let parsedValue = value;
              if ((key === 'content' || key === 'indexer') && typeof value === 'string') {
                try {
                  parsedValue = JSON.parse(value);
                } catch {
                  // If parsing fails, keep as string
                }
              }

              if (key === 'content' && parsedValue !== null && parsedValue !== undefined) {
                // Shallow merge: top-level keys from value override existing, nested objects replaced
                updateFields.content = {
                  ...((existingRecord.content as unknown as object) || {}),
                  ...(parsedValue as object)
                };
              } else if (key === 'indexer' && parsedValue !== null && parsedValue !== undefined) {
                // Shallow merge for indexer too
                updateFields.indexer = {
                  ...((existingRecord.indexer as unknown as object) || {}),
                  ...(parsedValue as object)
                };
              } else {
                // Regular field updates
                updateFields[key] = value;
              }
            }
          } else {
            // Legacy behavior: full replacement
            Object.assign(updateFields, input);
          }

          // Perform atomic update with JSONB merge
          const [affectedCount] = await NotionModel.update(updateFields, {
            where: { block_id },
            transaction,
            returning: false  // We'll fetch after for cache invalidation
          });

          if (affectedCount === 0) {
            throw new Error(`NotionModel with block_id ${block_id} not found`);
          }

          // Fetch updated record for return and cache invalidation
          const record = await NotionModel.findOne({
            where: { block_id },
            transaction
          });

          if (!record) {
            throw new Error(`NotionModel with block_id ${block_id} not found after update`);
          }

          return record;
        });

        // Convert to JSON
        const jsonResult = updatedRecord.toJSON();

        // Invalidate cache
        await cacheService.invalidateOnUpdate(block_id, jsonResult);

        return jsonResult;
      } catch (error) {
        console.error(`Error updating NotionModel with block_id ${block_id}:`, error);
        throw error;
      }
    },

    // Replace a NotionModel record (full replacement - no merge)
    // This allows fields to be removed from content, critical for UX when users delete metadata
    replaceNotionModel: async (
      _: any,
      { block_id, input }: { block_id: string; input: Partial<INotionModel> },
      context: any
    ) => {
      try {
        // Bot control auth: If both serviceTrusted and botControlTrusted are true,
        // bot service has tenant-wide access to replace notes (bypasses user ownership checks)
        const isBotService = context?.serviceTrusted && context?.botControlTrusted;

        if (process.env.DEBUG_BOT_AUTH === 'true' && isBotService) {
          console.log(`🤖 Bot service authenticated - tenant-wide note access granted for replace operation`);
        }

        // Use a transaction to ensure data consistency
        const replacedRecord = await NotionModel.sequelize!.transaction(async (transaction) => {
          // Build update object with full replacement for content field
          const updateFields: any = {};

          // For replacement, we completely replace the content field
          // This allows users to remove fields (e.g., deleting metadata properties)
          if (input.content !== undefined) {
            updateFields.content = input.content;
          }

          // Handle other fields
          for (const [key, value] of Object.entries(input)) {
            if (key !== 'content') {
              updateFields[key] = value;
            }
          }

          // Perform atomic update with full replacement
          const [affectedCount] = await NotionModel.update(updateFields, {
            where: { block_id },
            transaction,
            returning: false  // We'll fetch after for cache invalidation
          });

          if (affectedCount === 0) {
            throw new Error(`NotionModel with block_id ${block_id} not found`);
          }

          // Fetch updated record for return and cache invalidation
          const record = await NotionModel.findOne({
            where: { block_id },
            transaction
          });

          if (!record) {
            throw new Error(`NotionModel with block_id ${block_id} not found after replace`);
          }

          return record;
        });

        // Convert to JSON
        const jsonResult = replacedRecord.toJSON();

        // Invalidate cache
        await cacheService.invalidateOnUpdate(block_id, jsonResult);

        return jsonResult;
      } catch (error) {
        console.error(`Error replacing NotionModel with block_id ${block_id}:`, error);
        throw error;
      }
    },

    // Delete a NotionModel record
    deleteNotionModel: async (
      _: any,
      { block_id }: { block_id: string },
      context: any
    ) => {
      try {
        // Use a transaction to ensure data consistency
        const deletionResult = await NotionModel.sequelize!.transaction(async (transaction) => {
          // First, get the record to extract content type before deletion
          const recordToDelete = await NotionModel.findOne({
            where: { block_id },
            transaction
          });

          if (!recordToDelete) {
            return { success: false, model: null };
          }

          // Store the record data for cache invalidation
          const modelData = recordToDelete.toJSON();

          // Now delete the record
          const affectedCount = await NotionModel.destroy({
            where: { block_id },
            transaction
          });

          return {
            success: affectedCount > 0,
            model: modelData
          };
        });

        // Invalidate cache if deletion was successful
        if (deletionResult.success && deletionResult.model) {
          await cacheService.invalidateOnDelete(block_id, deletionResult.model);
        }

        return deletionResult.success;
      } catch (error) {
        console.error(`Error deleting NotionModel with block_id ${block_id}:`, error);
        throw error;
      }
    }
  },

  NotionModel: {
    // Get the parent NotionModel record if available
    parentData: {
      resolve: async (
        root: INotionModel,
        _args: unknown,
        context: any
      ): Promise<INotionModel | null> => {
        if (!root.parent_id) return null;

        try {
          // Try to get from cache first
          const cachedParent = await cacheService.getByBlockId(root.parent_id);
          if (cachedParent) {
            return cachedParent;
          }

          // Cache miss, fetch from database
          const parentData = await NotionModel.findOne({
            where: { block_id: root.parent_id }
          });

          if (!parentData) return null;

          // Convert to JSON and return
          return parentData.toJSON();
        } catch (error) {
          console.error('Error fetching parent data:', error);
          return null;
        }
      }
    }
  }
};

export default NotionModelResolver;
