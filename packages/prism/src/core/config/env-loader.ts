import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import * as dotenv from 'dotenv';

import { getLogger } from '../logger';

const log = getLogger('prism:config:env-loader');

/**
 * Centralized environment loader that always loads from the root .env.local file
 * This ensures all packages and apps use the same environment configuration
 */
export function loadEnvFromRoot(envPath: string = getEnvPath()): void {
  // Only load if not already loaded to avoid conflicts
  if (!process.env.NEXT_PUBLIC_MESH_SHARED_SECRET && !process.env.MESH_ENDPOINT) {
    const result = dotenv.config({ path: envPath });
    if (result.parsed) {
      log.info('Loaded environment file', { envPath });
    }
  }
}

/**
 * Get the project root directory path by searching for root package.json with workspaces
 */
export function getProjectRoot(): string {
  let dir = resolve(__dirname);
  
  // Search up the directory tree for the root package.json (the one with workspaces)
  for (let i = 0; i < 10; i++) {
    const pkgPath = resolve(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        // Root package.json has workspaces defined
        if (pkg.workspaces) {
          return dir;
        }
      } catch (e) {
        // Continue searching
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }
  
  // Fallback: assume we're in packages/prism/src/core/config, go up 5 levels
  return resolve(__dirname, '../../../../..');
}

/**
 * Get the path to the root .env.local file
 */
export function getEnvPath(): string {
  return resolve(getProjectRoot(), '.env.local');
} 