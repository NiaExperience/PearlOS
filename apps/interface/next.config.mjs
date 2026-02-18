import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import * as dotenv from 'dotenv';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment from root .env.local
const projectRoot = resolve(__dirname, '../..');
const envPath = resolve(projectRoot, '.env.local');

// Load environment variables
const result = dotenv.config({ path: envPath });
if (result.parsed) {
  console.log(`✓ Loaded environment from ${envPath}`);
}

const nextConfig = {
  // Disable the Next.js dev indicator (black "N" circle)
  devIndicators: false,
  // Strict mode can also cause double-render, but Fast Refresh is separate
  reactStrictMode: true,
  
  env: {
    // Pass values to the client explicitly
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_TWILIO_ACCOUNT_SID: process.env.NEXT_PUBLIC_TWILIO_ACCOUNT_SID,
    NEXT_PUBLIC_TWILIO_AUTH_TOKEN: process.env.NEXT_PUBLIC_TWILIO_AUTH_TOKEN,
    NEXT_PUBLIC_DAILY_ROOM_URL: process.env.NEXT_PUBLIC_DAILY_ROOM_URL,
    // Mesh configuration for Prism
    MESH_ENDPOINT: process.env.MESH_ENDPOINT,
    MESH_SHARED_SECRET: process.env.MESH_SHARED_SECRET,
    NEXT_PUBLIC_MESH_ENDPOINT: process.env.MESH_ENDPOINT,
    NEXT_PUBLIC_MESH_SHARED_SECRET: process.env.MESH_SHARED_SECRET,
  },
  // Exclude test directories from production builds
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],

  // Add headers to fix CORS/COOP issues for OAuth popups
  async headers() {
    return [
      {
        source: '/auth/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'unsafe-none',
          },
        ],
      },
      {
        source: '/((?!api/).*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: 'http://localhost:* https://127.0.0.1:* https://*.trycloudflare.com',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
        ],
      },
    ];
  },

  async rewrites() {
    return [
      {
        source: '/gateway-ws/:path*',
        destination: 'http://localhost:4444/ws/:path*',
      },
    ];
  },

  experimental: {
    // Improve error handling for scripts
    // DEPRECATED: strictNextHead: true,
  },
  // Exclude test-e2e directory from production builds
  generateBuildId: async () => {
    if (process.env.NODE_ENV === 'production') {
      // In production, exclude test directories
      return 'production-build';
    }
    return 'development-build';
  },
  // Disable trailing slash for cleaner URLs
  trailingSlash: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Help avoid special character issues with JSON serialization
  // This helps with React Server Components
  compiler: {
    // Add proper source maps for easier debugging
    reactRemoveProperties: process.env.NODE_ENV === 'production',
    removeConsole: false,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't resolve these modules on the client side
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        os: false,
        net: false,
        tls: false,
        dns: false,
        pg: false,
        'pg-cloudflare': false,
        'pg-hstore': false,
        'pg-connection-string': false,
        'cloudflare:sockets': false,
        sequelize: false,
        mongodb: false, // Ignore mongodb (only used in archived migration folder)
      };
    }

    // Exclude migration folder from webpack compilation
    config.module.rules.push({
      test: /\.tsx?$/,
      include: /src\/migration/,
      use: 'null-loader',
    });

    // Suppress critical dependency warnings from Sequelize
    config.module = {
      ...config.module,
      exprContextCritical: false, // Turn off critical dependency warnings
    };

    // Note: Test directories are now excluded via .dockerignore
    // This is a cleaner approach that prevents test files from being included in the build context

    // Add specific ignored warnings for Sequelize and other safe dynamic imports
    config.ignoreWarnings = [
      // Ignore Sequelize critical dependency warnings (they're safe to ignore)
      /Critical dependency: the request of a dependency is an expression/,
      // Ignore specific Sequelize dialect warnings
      /Critical dependency: the request of a dependency is an expression.*sequelize/,
      /Critical dependency: the request of a dependency is an expression.*dialects/,
    ];
    
    return config;
  },
};

export default nextConfig;

