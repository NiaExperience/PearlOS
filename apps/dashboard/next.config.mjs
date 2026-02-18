import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import * as dotenv from 'dotenv';
import webpack from 'webpack';


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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Removed deprecated/invalid keys: experimental.appDir (auto-enabled in Next 15) and srcDir (unsupported) to silence runtime warnings.
  images: {
    domains: ['images.unsplash.com', 'res.cloudinary.com'],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't resolve these modules on the client side
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        pg: false,
        'pg-cloudflare': false,
        'pg-connection-string': false,
        'cloudflare:sockets': false,
        sequelize: false,
        mongodb: false, // Ignore mongodb (only used in archived migration folder)
        // GraphQL mesh optional dependencies
        '@vue/compiler-sfc': false,
        'svelte2tsx': false,
        '@astrojs/compiler': false,
        'content-tag': false,
      };
    }

    // Exclude migration folder from webpack compilation
    config.module.rules.push({
      test: /\.tsx?$/,
      include: /src\/migration/,
      use: 'null-loader',
    });

    // Ignore optional Vue.js template engines and problematic imports for both client and server
    config.plugins.push(
      // IMPORTANT: Do NOT ignore 'react-dom/server' – Next.js App Router relies on it
      // The previous broader regex accidentally excluded it, preventing route compilation
      new webpack.IgnorePlugin({
        resourceRegExp: /^(velocityjs|ect|dustjs-linkedin|atpl|liquor|toffee|dot|bracket-template|ractive|htmling|babel-core|plates|vash|slm|marko|teacup\/lib\/express|arc-templates\/dist\/es5|dust|dustjs-helpers|eco|haml-coffee|hamlet|hamljs|handlebars|hogan\.js|jade|jazz|jqtpl|just|liquid-node|mote|mustache|nunjucks|pug|qejs|razor-tmpl|squirrelly|swig-templates|swig|templayed|then-jade|then-pug|tinyliquid|twig|twing|walrus|whiskers|coffee-script)$/,
      }),
      new webpack.IgnorePlugin({
        resourceRegExp: /^data:text/,
      })
    );
    config.resolve.alias = {
      ...config.resolve.alias,
      '@dashboard': resolve(__dirname, 'src'),
    };

    // Suppress critical dependency warnings from Sequelize
    config.module = {
      ...config.module,
      exprContextCritical: false, // Turn off critical dependency warnings
    };

    // Exclude test directories from production builds
    if (process.env.NODE_ENV === 'production') {
      // Exclude test-e2e and __tests-e2e__ pages from production builds
      config.resolve.alias = {
        ...config.resolve.alias,
        // Prevent test pages from being included in production builds
        '^/test-e2e': false,
        '^/__tests-e2e__': false,
        '^/__tests__': false,

      };
      
      // Exclude test directories from the build
      config.module.rules.push({
        test: /test-e2e|__tests-e2e__|__tests__/,
        use: 'ignore-loader',
      });
      // Globally ignore any test spec files (.test / .spec) across monorepo (including referenced packages)
      config.module.rules.push({
        test: /\.(test|spec)\.(ts|tsx|js|jsx)$/,
        use: 'ignore-loader'
      });
      // Explicitly ignore prism package tests (path contains packages/prism/__tests__)
      config.module.rules.push({
        test: /packages[\\/]+prism[\\/]+__tests__/,
        use: 'ignore-loader'
      });
    }
    
    config.ignoreWarnings = [
      // Ignore Sequelize critical dependency warnings (they're safe to ignore)
      /Critical dependency: the request of a dependency is an expression/,
      // Ignore specific Sequelize dialect warnings
      /Critical dependency: the request of a dependency is an expression.*sequelize/,
      /Critical dependency: the request of a dependency is an expression.*dialects/,
      // Ignore Vue compiler warnings from GraphQL tools
      /Critical dependency.*@vue\/compiler-sfc/,
      // Ignore GraphQL tools optional dependencies
      /Critical dependency.*@graphql-tools/,
    ];
    
    return config;
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_AWS_S3_BUCKET_NAME: process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME,
    NEXT_PUBLIC_INTERFACE_BASE_URL: process.env.NEXT_PUBLIC_INTERFACE_BASE_URL,
    // Mesh configuration for Prism
    MESH_ENDPOINT: process.env.MESH_ENDPOINT,
    MESH_SHARED_SECRET: process.env.MESH_SHARED_SECRET,
    NEXT_PUBLIC_MESH_ENDPOINT: process.env.MESH_ENDPOINT,
    NEXT_PUBLIC_MESH_SHARED_SECRET: process.env.MESH_SHARED_SECRET,
    // Set Prism config path to the source location
    PRISM_CONFIG_PATH: resolve(projectRoot, 'packages/prism/src/data-bridge'),
  },
};

export default nextConfig;
