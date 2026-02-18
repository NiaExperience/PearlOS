/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Standalone GraphQL Server for Nia Universal
 * 
 * This server provides a GraphQL API for Notion content
 * managed in a Postgres database.
 */

import { readFileSync, existsSync } from 'fs';
import http from 'http';
import path, { resolve } from 'path';

import { makeExecutableSchema } from '@graphql-tools/schema';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { createYoga } from 'graphql-yoga';
import swaggerUi from 'swagger-ui-express';

import contentApiRouter from './api/contentApi';
import { openapiRouter, spec } from './api/openapiSpec';
import { authMiddleware } from './middleware/auth';
// Import our plugins
import { createPerformanceMonitoringPlugin } from './plugins/performanceMonitoringPlugin';
import { initDatabase } from './resolvers/db';
import { NotionModelResolver } from './resolvers/enhanced/NotionModelResolver';

// Conditionally import the cache service and plugin
let CacheService: any;
let createCachingPlugin: any;

try {
  // Try to import the cache service and plugin
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  CacheService = require('./services/cache.service').CacheService;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  createCachingPlugin = require('./plugins/cachingPlugin').createCachingPlugin;
  console.log('✅ Cache modules loaded successfully');
} catch (error) {
  console.warn('Cache modules not available:', (error as Error).message);
  // Provide dummy implementations
  CacheService = {
    getInstance: () => ({
      clearAllCache: async () => {},
      shutdown: async () => {},
    }),
  };
  createCachingPlugin = () => ({});
}

// Load environment from root .env.local
// Note: __dirname is the directory containing this file (src/)
// We need to go up: src -> mesh -> apps -> nia-universal (root)
// But when running via ts-node from apps/mesh, __dirname might be apps/mesh
// So we use a more robust approach: find package.json to locate root
function findProjectRoot(): string {
  let dir = resolve(__dirname);
  // If __dirname is 'apps/mesh/src', go up 3 levels
  // If __dirname is 'apps/mesh' (when run from cwd), go up 2 levels
  // Most robust: look for root package.json with workspaces
  const fs = require('fs');
  for (let i = 0; i < 5; i++) {
    const pkgPath = resolve(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        // Root package.json has workspaces defined
        if (pkg.workspaces) {
          return dir;
        }
      } catch (e) {
        // Continue searching
      }
    }
    dir = resolve(dir, '..');
  }
  // Fallback: assume we're 3 levels deep from root
  return resolve(__dirname, '../../..');
}

const projectRoot = findProjectRoot();
const envPath = resolve(projectRoot, '.env.local');

// Load environment variables from root .env.local (source of truth)
// This MUST be loaded first before any other modules that might load .env files
const result = dotenv.config({ path: envPath });
if (result.parsed) {
  console.log(`✅ Loaded environment from ${envPath}`);
} else {
  console.warn(`⚠️ Could not load environment from ${envPath}`);
}

// Also load apps/mesh/.env.local if it exists (but root .env.local takes precedence)
// This ensures mesh-specific overrides work, but root values are the default
const meshEnvLocalPath = resolve(projectRoot, 'apps', 'mesh', '.env.local');
if (existsSync(meshEnvLocalPath)) {
  dotenv.config({ path: meshEnvLocalPath, override: false }); // Don't override root values
}


/**
 * Initialize and start the GraphQL server
 * @param port Port number to run the server on (overrides env var)
 * @param testMode Whether the server is running in test mode
 * @returns HTTP server instance for closing in tests
 */
export async function startServer(port?: number | string, testMode = false): Promise<http.Server> {
  // Port priority: explicit parameter > environment variable > default 2000
  const serverPort = port ? Number(port) : (process.env.PORT ? Number(process.env.PORT) : 2000);
  
  const app = express();
  
  // Enable CORS
  app.use(cors());

  // Shared secret authentication middleware for /graphql
  const sharedSecret = process.env.MESH_SHARED_SECRET;
  if (sharedSecret) {
    app.use('/graphql', (req, res, next) => {
      // Only enforce auth if not in test mode and secret is set
      if (!testMode && sharedSecret) {
        const clientSecret = req.headers['x-mesh-secret'];
        if (!clientSecret || clientSecret !== sharedSecret) {
          return res.status(401).json({ error: 'Unauthorized: missing or invalid mesh secret' });
        }
      }
      next();
    });
  }

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Public API documentation (no auth required)
  app.use('/docs', openapiRouter);

  // Swagger UI configuration
  const swaggerOptions = {
    customCss: `
      /* Hide default topbar */
      .swagger-ui .topbar { display: none; }
      
      /* Custom body styling with hero background */
      body {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        background-attachment: fixed;
        min-height: 100vh;
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      
      /* Main container with subtle transparency */
      .swagger-ui {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 12px;
        margin: 20px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
      }
      
      /* Enhanced title styling */
      .swagger-ui .info .title {
        color: #1e293b;
        font-size: 2.5rem;
        font-weight: 700;
        text-align: center;
        margin-bottom: 1rem;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      
      /* Enhanced description styling */
      .swagger-ui .info .description {
        font-size: 1.1rem;
        line-height: 1.6;
        color: #475569;
        text-align: left;
        max-width: 800px;
        margin: 0 auto 2rem;
        background: rgba(255, 255, 255, 0.8);
        padding: 1.5rem;
        border-radius: 8px;
        border-left: 4px solid #667eea;
      }
      
      /* Enhanced operation styling */
      .swagger-ui .opblock {
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(102, 126, 234, 0.2);
        border-radius: 8px;
        margin-bottom: 1rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        transition: all 0.3s ease;
      }
      
      .swagger-ui .opblock:hover {
        box-shadow: 0 4px 16px rgba(102, 126, 234, 0.15);
        transform: translateY(-1px);
      }
      
      /* Method badges with gradient */
      .swagger-ui .opblock.opblock-get .opblock-summary-method {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      }
      
      .swagger-ui .opblock.opblock-post .opblock-summary-method {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
      }
      
      .swagger-ui .opblock.opblock-put .opblock-summary-method {
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      }
      
      .swagger-ui .opblock.opblock-delete .opblock-summary-method {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      }
      
      /* Enhanced try it out button */
      .swagger-ui .btn.try-out__btn {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        color: white;
        border-radius: 6px;
        padding: 8px 16px;
        font-weight: 600;
        transition: all 0.3s ease;
      }
      
      .swagger-ui .btn.try-out__btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      }
      
      /* Custom scrollbar */
      .swagger-ui ::-webkit-scrollbar {
        width: 8px;
      }
      
      .swagger-ui ::-webkit-scrollbar-track {
        background: rgba(102, 126, 234, 0.1);
        border-radius: 4px;
      }
      
      .swagger-ui ::-webkit-scrollbar-thumb {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 4px;
      }
      
      /* Add subtle animation */
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .swagger-ui .info {
        animation: fadeInUp 0.6s ease-out;
      }
      
      .swagger-ui .opblock {
        animation: fadeInUp 0.6s ease-out;
        animation-fill-mode: both;
      }
      
      .swagger-ui .opblock:nth-child(1) { animation-delay: 0.1s; }
      .swagger-ui .opblock:nth-child(2) { animation-delay: 0.2s; }
      .swagger-ui .opblock:nth-child(3) { animation-delay: 0.3s; }
      .swagger-ui .opblock:nth-child(4) { animation-delay: 0.4s; }
      .swagger-ui .opblock:nth-child(5) { animation-delay: 0.5s; }
    `,
    customSiteTitle: 'Prism Mesh Content API - Nia Universal',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      url: '/docs/docs.json',
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      tryItOutEnabled: true
    }
  };

  // Serve beautiful Swagger UI at /docs
  app.use('/docs', swaggerUi.serve as any);
  app.get('/docs', swaggerUi.setup(spec, swaggerOptions) as any);

  // REST API endpoints (auth middleware required)
  app.use('/api', authMiddleware, contentApiRouter);

  // Start the server immediately to satisfy health checks
  const server = app.listen(serverPort, () => {
    if (sharedSecret) {
      console.log(`🚀 SECURE Prism Mesh Server running on http://localhost:${serverPort}/graphql`);
    } else {
      console.log(`🚀 Prism Mesh Server running on http://localhost:${serverPort}/graphql (no shared secret configured)`);
    }
    console.log(`🚀 Prism Mesh API swagger doc running on http://localhost:${serverPort}/docs`);
  });

  try {
    if (sharedSecret) {
      console.log('🔒 Configuring Prism Mesh Server...');
    } else {
      console.log('🔓 Configuring Prism Mesh Server (no shared secret configured)...');
    }
    
    console.log('⏳ Initializing database connection...');
    // Initialize database connection with test mode flag
    await initDatabase(testMode);
    console.log('✅ Database initialized');
    
    // Load schema from file
    const schemaPath = path.resolve(__dirname, 'config/schema.graphql');
    const typeDefs = readFileSync(schemaPath, 'utf-8');
    
    const relativeSchemaPath = path.relative(path.resolve(process.cwd(), '..'), schemaPath);
    console.log(`✅ Loaded platform schema from: ${relativeSchemaPath}`);

    // Create executable schema with resolvers
    const schema = makeExecutableSchema({
      typeDefs,
      resolvers: [NotionModelResolver]
    });

    // Prepare plugins array
    const plugins = [
      // Add performance monitoring plugin as the first plugin to track execution time
      createPerformanceMonitoringPlugin(),
    ];
    
    // Add caching plugin if available
    if (createCachingPlugin) {
      try {
        plugins.push(
          createCachingPlugin({
            ttl: parseInt(process.env.CACHE_TTL || '300', 10), // 5 minutes default
            includeQueries: true,
            includeMutations: false // Don't cache mutations
          })
        );
        try {
          const { backend, redisUrl } = CacheService.getInstance().getBackendInfo();
          const backendLabel = backend === 'redis'
            ? `redis (${redisUrl || 'unknown url'})`
            : 'in-memory';
          console.log(`🗄️  Added caching plugin to GraphQL server (backend: ${backendLabel})`);
        } catch (logError) {
          console.log('🗄️  Added caching plugin to GraphQL server (backend: unknown)');
          console.warn('Failed to log cache backend:', (logError as Error).message);
        }
      } catch (error) {
        console.warn('Failed to add caching plugin:', (error as Error).message);
      }
    }

    // Set up GraphQL Yoga
    const yoga = createYoga({
      schema,
      graphiql: true,
      // Enable caching plugins conditionally
      plugins,
      // Allow overriding database with in-memory version via header
      context: async ({ request }: { request: Request }) => {
        // Check if X-Use-In-Memory header is present
        const useInMemory = request.headers.get('x-use-in-memory') === 'true';
        // Only allow in-memory database in non-production environments
        if (process.env.NODE_ENV !== 'production' && useInMemory) {
          // Reinitialize with in-memory database if requested
          await initDatabase(true);
        }
        
        // Add bot control auth to context for resolvers
        const meshSecret = process.env.MESH_SHARED_SECRET;
        const botControlSecret = process.env.BOT_CONTROL_SHARED_SECRET;
        
        let serviceTrusted = false;
        if (meshSecret) {
          const provided = request.headers.get('x-mesh-secret');
          serviceTrusted = !!provided && provided === meshSecret;
        }
        
        let botControlTrusted = false;
        if (botControlSecret) {
          const provided = request.headers.get('x-bot-control-secret');
          botControlTrusted = !!provided && provided === botControlSecret;
        }
        
        return {
          serviceTrusted,
          botControlTrusted
        };
      },
    });
    
    // Mount GraphQL Yoga
    app.use('/graphql', (req, res) => {
      yoga(req, res);
    });

    return server;
  } catch (error) {
    console.error('Failed to start Prism Mesh Server:', error);
    if (!testMode) {
      // Keep the server running to allow log inspection, but log the error
      console.error('CRITICAL: Server setup failed, but process kept alive for debugging.');
    }
    throw error;
  }
}

export async function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if server is already closed or closing
    if (!server.listening) {
      console.log('🪦  Prism Mesh Server already stopped');
      resolve();
      return;
    }
    
    server.close((err) => {
      if (err) {
        // Ignore "server not running" errors - it's already closed
        if ((err as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') {
          console.log('🪦  Prism Mesh Server already stopped');
          resolve();
        } else {
          console.error('Error stopping Prism Mesh Server:', err);
          reject(err);
        }
      } else {
        console.log('🪦  Prism Mesh Server stopped successfully');
        resolve();
      }
    });
  });
}

// Start the server if this file is executed directly
if (require.main === module) {
  startServer();
}
