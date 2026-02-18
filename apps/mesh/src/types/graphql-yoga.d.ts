// Add type declarations for graphql-yoga to include our custom context properties
declare module 'graphql-yoga' {
  interface ServerAdapterInitialContext {
    skipCache?: boolean;
    resolverPaths?: Array<{ path: string; args: any }>;
    graphqlCacheKey?: string;
    cachedResult?: any;
  }
  
  export interface YogaServerOptions<TServerContext = any, TUserContext = any> {
    schema?: any;
    plugins?: any[];
    graphiql?: boolean;
    context?: any;
    cors?: any;
    maskedErrors?: boolean | any;
    logging?: boolean | any;
  }
  
  export function createYoga(options: YogaServerOptions): any;
}
