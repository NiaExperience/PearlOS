#!/usr/bin/env ts-node
/**
 * Environment Variable Validation Script
 * 
 * Validates that all required environment variables are set before starting the application.
 * Provides helpful error messages if variables are missing.
 * 
 * Usage: npx ts-node scripts/validate-env.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn(`⚠️  .env.local not found at ${envPath}`);
  console.warn('   Some environment variables may be missing.');
}

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  validate?: (value: string) => boolean | string;
}

const requiredVars: EnvVar[] = [
  {
    name: 'POSTGRES_HOST',
    required: true,
    description: 'PostgreSQL host address',
    defaultValue: 'localhost',
  },
  {
    name: 'POSTGRES_PORT',
    required: true,
    description: 'PostgreSQL port',
    defaultValue: '5432',
    validate: (v) => {
      const port = parseInt(v, 10);
      return port > 0 && port < 65536 || 'Must be a valid port number (1-65535)';
    },
  },
  {
    name: 'POSTGRES_DB',
    required: true,
    description: 'PostgreSQL database name',
    defaultValue: 'testdb',
  },
  {
    name: 'POSTGRES_USER',
    required: true,
    description: 'PostgreSQL username',
    defaultValue: 'postgres',
  },
  {
    name: 'POSTGRES_PASSWORD',
    required: true,
    description: 'PostgreSQL password',
  },
  {
    name: 'MESH_SHARED_SECRET',
    required: true,
    description: 'Shared secret for Mesh GraphQL API authentication',
    validate: (v) => v.length >= 16 || 'Must be at least 16 characters long',
  },
  {
    name: 'NEXTAUTH_SECRET',
    required: false,
    description: 'NextAuth.js secret (required for production)',
    validate: (v) => v.length >= 32 || 'Must be at least 32 characters long',
  },
  {
    name: 'NEXTAUTH_URL',
    required: false,
    description: 'NextAuth.js base URL',
    defaultValue: 'http://localhost:3000',
  },
  {
    name: 'MESH_ENDPOINT',
    required: false,
    description: 'Mesh GraphQL endpoint URL',
    defaultValue: 'http://localhost:2000/graphql',
    validate: (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return 'Must be a valid URL';
      }
    },
  },
];

const optionalVars: EnvVar[] = [
  {
    name: 'DISABLE_DASHBOARD_AUTH',
    required: false,
    description: 'Disable dashboard authentication for local development',
    defaultValue: 'true',
  },
  {
    name: 'USE_REDIS',
    required: false,
    description: 'Enable Redis for caching and session management',
    defaultValue: 'false',
  },
  {
    name: 'REDIS_URL',
    required: false,
    description: 'Redis connection URL (required if USE_REDIS=true)',
    defaultValue: 'redis://localhost:6379',
  },
  {
    name: 'PEARLOS_ONLY',
    required: false,
    description: 'Enable Pearlos-only mode',
    defaultValue: 'false',
  },
  {
    name: 'BOT_CONTROL_BASE_URL',
    required: false,
    description: 'Bot control API base URL',
    defaultValue: 'http://localhost:4444',
  },
];

function validateEnvVar(envVar: EnvVar): { valid: boolean; error?: string; value?: string } {
  const value = process.env[envVar.name] || envVar.defaultValue;
  
  if (envVar.required && !value) {
    return {
      valid: false,
      error: `Required environment variable ${envVar.name} is not set. ${envVar.description}`,
    };
  }

  if (value && envVar.validate) {
    const validation = envVar.validate(value);
    if (validation !== true) {
      return {
        valid: false,
        error: `Invalid value for ${envVar.name}: ${validation}`,
        value,
      };
    }
  }

  return { valid: true, value };
}

function main() {
  console.log('🔍 Validating environment variables...\n');

  let hasErrors = false;
  const results: Array<{ name: string; status: string; message: string }> = [];

  // Check required variables
  console.log('📋 Required Variables:');
  for (const envVar of requiredVars) {
    const result = validateEnvVar(envVar);
    if (result.valid) {
      const displayValue = envVar.name.includes('PASSWORD') || envVar.name.includes('SECRET')
        ? '***' 
        : result.value;
      console.log(`  ✅ ${envVar.name} = ${displayValue}`);
      results.push({ name: envVar.name, status: 'ok', message: 'Set' });
    } else {
      console.error(`  ❌ ${envVar.name}: ${result.error}`);
      results.push({ name: envVar.name, status: 'error', message: result.error || 'Missing' });
      hasErrors = true;
    }
  }

  // Check optional variables
  console.log('\n📋 Optional Variables:');
  for (const envVar of optionalVars) {
    const result = validateEnvVar(envVar);
    const displayValue = envVar.name.includes('PASSWORD') || envVar.name.includes('SECRET')
      ? '***' 
      : result.value || '(not set)';
    const status = result.value ? '✅' : '⚪';
    console.log(`  ${status} ${envVar.name} = ${displayValue}`);
    results.push({ 
      name: envVar.name, 
      status: result.value ? 'ok' : 'optional', 
      message: result.value ? 'Set' : 'Using default or not set' 
    });
  }

  // Check conditional requirements
  console.log('\n📋 Conditional Checks:');
  if (process.env.USE_REDIS === 'true' && !process.env.REDIS_URL) {
    console.error('  ❌ USE_REDIS=true but REDIS_URL is not set');
    hasErrors = true;
  } else if (process.env.USE_REDIS === 'true') {
    console.log('  ✅ Redis configuration valid');
  } else {
    console.log('  ⚪ Redis disabled (USE_REDIS=false)');
  }

  // Summary
  console.log('\n📊 Summary:');
  const requiredOk = results.filter(r => requiredVars.some(v => v.name === r.name && r.status === 'ok')).length;
  const requiredTotal = requiredVars.length;
  console.log(`  Required: ${requiredOk}/${requiredTotal} set`);
  
  if (hasErrors) {
    console.error('\n❌ Validation failed. Please fix the errors above before starting the application.');
    console.error('\n💡 Tip: Copy config/env.minimal.example to .env.local and fill in the values.');
    process.exit(1);
  } else {
    console.log('\n✅ All required environment variables are set correctly!');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

export { validateEnvVar, requiredVars, optionalVars };

