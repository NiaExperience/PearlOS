/**
 * Provider Configuration Types
 * 
 * Defines the provider system for multi-source data routing
 */

import { z } from 'zod';

// Platform provider constant (our core platform database)
export const PlatformProvider = 'nia-postgres-content';

// Provider configuration interface
export interface ProviderConfig {
  type: 'nia-postgres-content' | 'external-api' | 'file-system' | 'mongodb' | 'graphql-api';
  connectionId?: string;        // Reference to registered connection
  operationSet?: string;        // Which GraphQL operation set to use
  mapping?: Record<string, string>;  // Field mappings between source and NotionModel
  fragments?: {                 // Provider-specific GraphQL fragments
    findQuery: string;
    createMutation: string;
    updateMutation: string;
    deleteMutation: string;
  };
}

// Zod schema for provider configuration
export const ProviderConfigSchema = z.object({
  type: z.enum([PlatformProvider, 'external-api', 'file-system', 'mongodb', 'graphql-api']),
  connectionId: z.string().optional(),
  operationSet: z.string().optional(),
  mapping: z.record(z.string()).optional(),
  fragments: z.object({
    findQuery: z.string(),
    createMutation: z.string(),
    updateMutation: z.string(),
    deleteMutation: z.string(),
  }).optional(),
});

// Default provider configurations
export const DefaultProviderConfigs = {
  PlatformProvider: {
    type: PlatformProvider,
    operationSet: 'content.operations',
    fragments: {
      findQuery: 'findContent',
      createMutation: 'createContent',
      updateMutation: 'updateContent',
      deleteMutation: 'deleteContent'
    }
  }
} satisfies Record<string, ProviderConfig>;

// Helper function to get default provider config
export function getDefaultProviderConfig(): ProviderConfig {
  return DefaultProviderConfigs.PlatformProvider;
}

// Helper function to normalize provider to ProviderConfig
export function normalizeProvider(provider?: string | ProviderConfig): ProviderConfig {
  if (!provider) {
    return getDefaultProviderConfig();
  }
  
  if (typeof provider === 'string') {
    // Convert legacy string provider to ProviderConfig
    if (provider === PlatformProvider) {
      return DefaultProviderConfigs.PlatformProvider;
    }
    
    // For other string providers, create a basic config
    return {
      type: provider as ProviderConfig['type'],
      operationSet: `${provider}.operations`
    };
  }
  
  return provider;
}

// Type guard to check if a value is a ProviderConfig
export function isProviderConfig(value: any): value is ProviderConfig {
  return value && typeof value === 'object' && 'type' in value;
}

