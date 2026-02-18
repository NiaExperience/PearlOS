/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Prism Core Types - Compatible with existing shared infrastructure
 */

// Re-export provider types for convenience
export type { ProviderConfig } from '../data-bridge/provider';
export { 
  getDefaultProviderConfig, 
  normalizeProvider, 
  isProviderConfig,
} from '../data-bridge/provider';

// Prism-specific types that extend the existing infrastructure
export interface PrismContentQuery {
  contentType: string;
  tenantId: string;
  userId?: string;
  where?: Record<string, any>;
  limit?: number;
  offset?: number;
  select?: string[];
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface PrismContentResult {
  items: any[];
  total: number;
  hasMore: boolean;
}

export interface PrismDataSourceConfig {
  type: 'sql' | 'mongodb' | 'openapi' | 'graphql';
  connection: string;
  schema?: string;
  collection?: string;
  specUrl?: string;
  basePath?: string;
}