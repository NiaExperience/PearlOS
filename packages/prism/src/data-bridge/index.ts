/**
 * Prism Data Bridge - Unified Data Access Layer
 * Provides GraphQL client for unified data access across all sources
 *
 * Data Bridge Barrel - ensures directory import './data-bridge' works in CJS
 */
export * from './PrismGraphQLFactory';
export * from './PrismGraphQLClient';
export * from './provider';
export * from './credentials';

export { PrismGraphQLClient } from './PrismGraphQLClient';
export { PrismGraphQLFactory } from './PrismGraphQLFactory';
export type { GraphQLClientInstance } from './PrismGraphQLFactory';
export { PlatformProvider } from './provider';