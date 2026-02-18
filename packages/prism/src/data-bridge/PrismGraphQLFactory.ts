/**
 * PrismGraphQLFactory - Creates GraphQL client instances
 * 
 * This factory enables the instantiation of PrismGraphQLClient instances
 * based on configuration or environment.
 */

import { PrismGraphQLClient } from './PrismGraphQLClient';

export interface PrismGraphQLClientOptions {
  endpoint?: string;
  headers?: Record<string, string>;
  debug?: boolean;
}

export class PrismGraphQLFactory {
  /**
   * Create a PrismGraphQLClient instance
   * 
   * @param options Optional client configuration
   * @returns A configured PrismGraphQLClient instance
   */
  static create(options: PrismGraphQLClientOptions = {}): PrismGraphQLClient {
    // Detect environment
    const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
    const isBrowser = typeof window !== 'undefined';
    
    // Set default endpoint based on environment
    const defaultEndpoint = isBrowser 
      ? (process.env.NEXT_PUBLIC_MESH_ENDPOINT || 'http://localhost:2000/graphql') 
      : (process.env.MESH_ENDPOINT || process.env.GRAPHQL_ENDPOINT || 'http://localhost:2000/graphql');
    
    // Merge with provided options
    const clientOptions: PrismGraphQLClientOptions = {
      endpoint: defaultEndpoint,
      debug: process.env.NODE_ENV === 'development',
      ...options
    };
    
    // The PrismGraphQLClient constructor reads process.env.MESH_ENDPOINT and MESH_SHARED_SECRET.
    // In browser context, expose NEXT_PUBLIC_MESH_ENDPOINT and NEXT_PUBLIC_MESH_SHARED_SECRET.
    if (typeof window !== 'undefined') {
      // @ts-ignore: allow setting for client constructor
      if (process && typeof process === 'object') {
        // patch env vars in browser if defined via NEXT_PUBLIC_*
        const env: any = (process as any).env || {};
        env.MESH_ENDPOINT = env.MESH_ENDPOINT || (process.env.NEXT_PUBLIC_MESH_ENDPOINT as any);
        env.MESH_SHARED_SECRET = env.MESH_SHARED_SECRET || (process.env.NEXT_PUBLIC_MESH_SHARED_SECRET as any);
        // @ts-ignore
        (process as any).env = env;
      }
    }
    return new PrismGraphQLClient(clientOptions.endpoint);
  }
}

export type GraphQLClientInstance = PrismGraphQLClient;

export default PrismGraphQLFactory;
