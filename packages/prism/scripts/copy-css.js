/**
 * Copy CSS assets into dist/ after TypeScript build.
 *
 * Prism exports `./core/css/*` from `dist/`, but `tsc` doesn't copy non-TS assets.
 * This script mirrors `src/core/css/<recursive>/*.css` -> `dist/core/css/<recursive>/*.css`.
 */
const path = require("path");
const fs = require("fs/promises");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const srcRoot = path.join(root, "src", "core", "css");
  const distRoot = path.join(root, "dist", "core", "css");

  if (!(await exists(srcRoot))) {
    // Nothing to copy (keep build resilient).
    return;
  }

  await ensureDir(distRoot);
  const files = (await walk(srcRoot)).filter((f) => f.endsWith(".css"));

  for (const file of files) {
    const rel = path.relative(srcRoot, file);
    const dest = path.join(distRoot, rel);
    await ensureDir(path.dirname(dest));
    await fs.copyFile(file, dest);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[prism] copy-css failed:", err);
  process.exitCode = 1;
});

