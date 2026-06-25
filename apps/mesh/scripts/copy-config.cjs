#!/usr/bin/env node
/**
 * Copy Mesh runtime config assets into dist/ after TypeScript build.
 *
 * Mesh needs files under `src/config/` at runtime (e.g. `.meshrc.json`, schema.graphql).
 * `tsc` does not copy these, so this script copies `src/config/**` → `dist/config/**`.
 *
 * Uses `.cjs` so the file is not excluded by repo `*.js` gitignore rules.
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(srcDir, destDir) {
  ensureDir(destDir);
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) copyRecursive(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function main() {
  const pkgRoot = path.resolve(__dirname, '..');
  const srcRoot = path.join(pkgRoot, 'src', 'config');
  const distRoot = path.join(pkgRoot, 'dist', 'config');

  if (!exists(srcRoot)) {
    console.log('[copy-config] No src/config directory found; skipping.');
    return;
  }

  try {
    fs.rmSync(distRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }

  copyRecursive(srcRoot, distRoot);
  console.log('[copy-config] Copied config to dist/config.');
}

main();
