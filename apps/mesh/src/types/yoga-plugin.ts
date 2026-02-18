/**
 * TypeScript declarations for graphql-yoga
 */

import type { GraphQLResolveInfo } from 'graphql';

export interface YogaPluginContext {
  skipCache?: boolean;
  resolverPaths?: { path: string; args: any }[];
  cachedResult?: any;
}

export type YogaPlugin = {
  onRequest?: (params: { request: Request; serverContext: YogaPluginContext }) => void;
  onResolverCalled?: (params: { 
    info: GraphQLResolveInfo; 
    root: any; 
    args: any; 
    context: any; 
    serverContext: YogaPluginContext 
  }) => void;
  onExecute?: (params: { 
    args: any; 
    serverContext: YogaPluginContext 
  }) => Promise<void> | void;
  onExecuteDone?: (params: { 
    result: any; 
    serverContext: YogaPluginContext 
  }) => Promise<void> | void;
};
