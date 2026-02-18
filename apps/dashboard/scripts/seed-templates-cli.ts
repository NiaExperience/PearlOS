#!/usr/bin/env tsx
/**
 * CLI wrapper for the seed-html-library-templates function.
 * 
 * The main logic lives in src/lib/seed-html-library-templates.ts
 * This script is a thin CLI entry point that can be run via:
 *   npm run seed:html-library
 * 
 * Note: This imports from the src/lib location which is compiled into the 
 * Next.js build. For Docker/production, use the API endpoint instead.
 */

import { seedHtmlLibraryTemplates } from '../src/lib/template-seeder';

// Re-export for backwards compatibility
export { seedHtmlLibraryTemplates };

// Main entry point when run as CLI
async function main() {
  const result = await seedHtmlLibraryTemplates();
  if (!result.success) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Seed failed', err);
  process.exit(1);
});
