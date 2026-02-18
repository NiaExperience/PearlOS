#!/usr/bin/env node
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const targetDir = join(root, 'packages/features/src');

let found = [];

function walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (entry.endsWith('.js') || entry.endsWith('.js.map')) {
      found.push(full.replace(root + '/', ''));
    }
  }
}

try {
  walk(targetDir);
} catch (err) {
  // If the directory doesn't exist, nothing to guard
}

if (found.length > 0) {
  console.error('\n❌ Stale compiled JS detected in packages/features/src. These can shadow TypeScript and cause stale flag defaults.');
  for (const f of found) console.error(' -', f);
  console.error('\nFix by removing them and rebuilding:');
  console.error('  rm -f packages/features/src/**/*.js packages/features/src/**/*.js.map');
  console.error('  npm run build -w @nia/features');
  process.exit(1);
} else {
  // Be silent on success to avoid lint noise about console usage
}
