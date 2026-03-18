#!/usr/bin/env node
/**
 * Cross-platform installer build orchestrator.
 *
 * High-level flow:
 * - Determine repo version from root package.json
 * - Prepare installer/work/ for the selected platform
 * - Download bundled runtimes (Node.js, Python) into installer/bundled/
 * - Create a payload directory with:
 *   - pearlos/ (repo snapshot)
 *   - bundled/ (downloaded runtimes)
 * - Delegate to platform build scripts (windows/macos/linux)
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const installerRoot = path.resolve(repoRoot, 'installer');
const bundledDir = path.resolve(installerRoot, 'bundled');
const workDir = path.resolve(installerRoot, 'work');
const distDir = path.resolve(installerRoot, 'dist');

function parseArgs(argv) {
  const args = { platform: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--platform') {
      args.platform = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith('--platform=')) {
      args.platform = token.split('=')[1];
      continue;
    }
  }
  return args;
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function die(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

async function readJson(filePath) {
  const raw = await import(pathToFileUrl(filePath));
  return raw.default ?? raw;
}

function pathToFileUrl(p) {
  const u = new URL(`file://${p}`);
  return u.href;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'pearlos-installer-builder' } }, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpsGet(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} failed: ${res.statusCode}`));
          return;
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

async function downloadToFile(url, destPath) {
  await mkdir(path.dirname(destPath), { recursive: true });
  if (existsSync(destPath)) {
    return;
  }
  log(`Downloading ${url}`);
  const res = await httpsGet(url);
  await pipeline(res, createWriteStream(destPath));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}`));
    });
  });
}

async function ensureCleanDir(dirPath) {
  await rm(dirPath, { recursive: true, force: true });
  await mkdir(dirPath, { recursive: true });
}

async function copyFile(src, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(createReadStream(src), createWriteStream(dest));
}

async function copyDir(srcDir, destDir, { shouldIgnore }) {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const srcPath = path.join(srcDir, ent.name);
    const rel = path.relative(repoRoot, srcPath);
    if (shouldIgnore(rel)) continue;
    const destPath = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      await copyDir(srcPath, destPath, { shouldIgnore });
    } else if (ent.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

function defaultIgnore(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  if (normalized === '') return false;
  const top = normalized.split('/')[0];
  const ignoredTop = new Set([
    '.git',
    'node_modules',
    'dist',
    'coverage',
    'tmp',
    'backups',
    'installer/bundled',
    'installer/dist',
    'installer/work',
    '.cursor',
  ]);
  if (ignoredTop.has(top)) return true;
  if (normalized.startsWith('installer/bundled/')) return true;
  if (normalized.startsWith('installer/dist/')) return true;
  if (normalized.startsWith('installer/work/')) return true;
  return false;
}

async function getLatestNode20Version() {
  const indexUrl = 'https://nodejs.org/dist/index.json';
  const res = await httpsGet(indexUrl);
  let body = '';
  for await (const chunk of res) body += chunk;
  const releases = JSON.parse(body);
  const v20 = releases
    .map((r) => r.version)
    .filter((v) => typeof v === 'string' && v.startsWith('v20.'))
    .sort((a, b) => (a < b ? 1 : -1));
  if (v20.length === 0) die('Could not find any Node v20 releases in index.json');
  return v20[0];
}

function nodeDownloadUrl({ nodeVersion, platform, arch }) {
  // platform: win|darwin|linux, arch: x64|arm64
  // Node filenames:
  // - win: node-vX.Y.Z-win-x64.zip
  // - mac: node-vX.Y.Z-darwin-x64.tar.gz / darwin-arm64.tar.gz
  // - linux: node-vX.Y.Z-linux-x64.tar.xz / linux-arm64.tar.xz
  const base = `https://nodejs.org/dist/${nodeVersion}`;
  if (platform === 'win') return `${base}/node-${nodeVersion}-win-${arch}.zip`;
  if (platform === 'darwin') return `${base}/node-${nodeVersion}-darwin-${arch}.tar.gz`;
  if (platform === 'linux') return `${base}/node-${nodeVersion}-linux-${arch}.tar.xz`;
  throw new Error(`Unsupported platform for nodeDownloadUrl: ${platform}`);
}

async function downloadBundledNode({ platform }) {
  const nodeVersion = process.env.PEARLOS_NODE_VERSION || (await getLatestNode20Version());
  const targets =
    platform === 'windows'
      ? [{ platform: 'win', arch: 'x64' }]
      : platform === 'macos'
        ? [
            { platform: 'darwin', arch: 'arm64' },
            { platform: 'darwin', arch: 'x64' },
          ]
        : platform === 'linux'
          ? [{ platform: 'linux', arch: 'x64' }]
          : [];

  if (targets.length === 0) throw new Error(`Unsupported platform: ${platform}`);

  const downloads = [];
  for (const t of targets) {
    const url = nodeDownloadUrl({ nodeVersion, platform: t.platform, arch: t.arch });
    const fileName = url.split('/').pop();
    const dest = path.resolve(bundledDir, 'downloads', fileName);
    downloads.push({ url, dest, target: t });
  }

  for (const d of downloads) await downloadToFile(d.url, d.dest);

  return { nodeVersion, downloads };
}

async function extractArchive(archivePath, destDir) {
  await mkdir(destDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    await run('unzip', ['-q', archivePath, '-d', destDir]);
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    await run('tar', ['-xzf', archivePath, '-C', destDir]);
    return;
  }
  if (archivePath.endsWith('.tar.xz')) {
    await run('tar', ['-xJf', archivePath, '-C', destDir]);
    return;
  }
  throw new Error(`Unknown archive type: ${archivePath}`);
}

async function preparePayload({ platform }) {
  const platformWork = path.resolve(workDir, platform);
  await ensureCleanDir(platformWork);

  const payloadRoot = path.resolve(platformWork, 'payload');
  await ensureCleanDir(payloadRoot);

  const payloadPearlOs = path.resolve(payloadRoot, 'pearlos');
  log('Copying repo snapshot into payload...');
  await copyDir(repoRoot, payloadPearlOs, { shouldIgnore: defaultIgnore });

  const payloadBundled = path.resolve(payloadRoot, 'bundled');
  await mkdir(payloadBundled, { recursive: true });

  const nodeInfo = await downloadBundledNode({ platform });
  log(`Bundled Node version: ${nodeInfo.nodeVersion}`);

  // Extract node archives into payload/bundled/node/<target>
  for (const d of nodeInfo.downloads) {
    const outDir = path.resolve(payloadBundled, 'node', `${d.target.platform}-${d.target.arch}`);
    await extractArchive(d.dest, outDir);
  }

  // Python bundling is wired for later. We keep the interface stable by
  // allowing platform scripts to inject Python bundles, or fall back to system Python.
  // If PEARLOS_PYTHON_BUNDLE_URL is provided, we download it into payload/bundled/python/.
  const pythonUrl = process.env.PEARLOS_PYTHON_BUNDLE_URL;
  if (pythonUrl) {
    const fileName = pythonUrl.split('/').pop();
    const dest = path.resolve(bundledDir, 'downloads', fileName);
    await downloadToFile(pythonUrl, dest);
    const outDir = path.resolve(payloadBundled, 'python');
    await extractArchive(dest, outDir);
  }

  return { platformWork, payloadRoot };
}

async function buildPlatform({ platform, version, payloadRoot }) {
  if (platform === 'windows') {
    const script = path.resolve(installerRoot, 'windows', 'build-windows.ps1');
    await run('powershell', ['-ExecutionPolicy', 'Bypass', '-File', script, '-Version', version, '-PayloadRoot', payloadRoot]);
    return;
  }
  if (platform === 'macos') {
    const script = path.resolve(installerRoot, 'macos', 'build-pkg.sh');
    await run('bash', [script, '--version', version, '--payload-root', payloadRoot]);
    return;
  }
  if (platform === 'linux') {
    const script = path.resolve(installerRoot, 'linux', 'build-deb.sh');
    await run('bash', [script, '--version', version, '--payload-root', payloadRoot]);
    return;
  }
  throw new Error(`Unknown platform: ${platform}`);
}

async function main() {
  const { platform } = parseArgs(process.argv);
  if (!platform) {
    die('Missing --platform (windows|macos|linux|all)');
  }

  await mkdir(bundledDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  await mkdir(distDir, { recursive: true });

  const pkgJsonPath = path.resolve(repoRoot, 'package.json');
  const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(pkgJsonPath, 'utf8'));
  const version = pkg.version || '0.0.0';

  const targets = platform === 'all' ? ['windows', 'macos', 'linux'] : [platform];
  for (const t of targets) {
    log(`\n=== Building installer for ${t} ===`);
    const { payloadRoot } = await preparePayload({ platform: t });
    await buildPlatform({ platform: t, version, payloadRoot });
  }

  log('\nDone. Artifacts are in installer/dist/');
}

main().catch((err) => {
  die(err?.stack || String(err));
});

