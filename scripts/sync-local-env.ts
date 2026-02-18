import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type EnvMap = Record<string, string>;

function readEnvFile(filePath: string): { raw: string; env: EnvMap } {
  if (!fs.existsSync(filePath)) return { raw: '', env: {} };
  const raw = fs.readFileSync(filePath, 'utf8');
  const env: EnvMap = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) env[key] = value;
  }

  return { raw, env };
}

function upsertEnvLine(raw: string, key: string, value: string): string {
  const lines = raw.split(/\r?\n/);
  const keyPrefix = `${key}=`;
  let found = false;

  const next = lines.map((line) => {
    if (line.startsWith(keyPrefix)) {
      found = true;
      return `${keyPrefix}${value}`;
    }
    return line;
  });

  if (!found) {
    // Keep a trailing newline for nicer diffs/files
    if (next.length > 0 && next[next.length - 1] !== '') next.push('');
    next.push(`${keyPrefix}${value}`);
  }

  return next.join('\n');
}

function generateSecret(): string {
  // 32 bytes -> base64 string (safe for .env usage)
  return crypto.randomBytes(32).toString('base64');
}

// Keys that MUST be synced from root to all apps
const SYNC_KEYS = [
  'MESH_SHARED_SECRET',
  'MESH_ENDPOINT',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_INTERFACE_URL',
  'NEXTAUTH_DASHBOARD_URL',
  'DISABLE_DASHBOARD_AUTH',
  'TOKEN_ENCRYPTION_KEY',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'USE_REDIS',
  'NODE_ENV',
];

function main() {
  const repoRoot = path.resolve(__dirname, '..');

  // Source of truth: root .env.local
  const rootEnvPath = path.join(repoRoot, '.env.local');
  
  if (!fs.existsSync(rootEnvPath)) {
    console.error('[env] ❌ Root .env.local not found. Run ./setup.sh first.');
    process.exit(1);
  }
  
  const root = readEnvFile(rootEnvPath);

  // Ensure MESH_SHARED_SECRET exists (generate if missing)
  const meshSecret = root.env['MESH_SHARED_SECRET'] || generateSecret();
  if (!root.env['MESH_SHARED_SECRET']) {
    root.raw = upsertEnvLine(root.raw, 'MESH_SHARED_SECRET', meshSecret);
    root.env['MESH_SHARED_SECRET'] = meshSecret;
    fs.writeFileSync(rootEnvPath, root.raw, 'utf8');
    console.log('[env] Generated new MESH_SHARED_SECRET');
  }

  // Ensure DISABLE_DASHBOARD_AUTH is set for local development
  if (!root.env['DISABLE_DASHBOARD_AUTH']) {
    root.raw = upsertEnvLine(root.raw, 'DISABLE_DASHBOARD_AUTH', 'true');
    root.env['DISABLE_DASHBOARD_AUTH'] = 'true';
    fs.writeFileSync(rootEnvPath, root.raw, 'utf8');
  }

  // Target app directories that need synced env files
  const targets = [
    { dir: path.join(repoRoot, 'apps', 'interface'), name: 'interface' },
    { dir: path.join(repoRoot, 'apps', 'dashboard'), name: 'dashboard' },
    { dir: path.join(repoRoot, 'apps', 'mesh'), name: 'mesh' },
  ];

  for (const target of targets) {
    // Sync both .env.local and .env files (some apps use .env)
    const envFiles = [
      path.join(target.dir, '.env.local'),
      path.join(target.dir, '.env')
    ];
    
    for (const targetEnvPath of envFiles) {
      // Skip if file doesn't exist and it's .env (we only create .env.local)
      if (!fs.existsSync(targetEnvPath) && targetEnvPath.endsWith('.env')) {
        continue;
      }
      
      // Create .env.local if it doesn't exist
      if (!fs.existsSync(targetEnvPath) && targetEnvPath.endsWith('.env.local')) {
      console.log(`[env] Creating ${target.name}/.env.local`);
      fs.writeFileSync(targetEnvPath, `# Auto-generated from root .env.local\n# Edit root .env.local and run: npm run sync:env\n\n`, 'utf8');
    }
    
      // If .env exists, update it too (but don't create it if it doesn't exist)
      if (fs.existsSync(targetEnvPath)) {
    let current = readEnvFile(targetEnvPath);
    let modified = false;
    
    // Sync all required keys from root
    for (const key of SYNC_KEYS) {
      const rootValue = root.env[key];
      if (rootValue && current.env[key] !== rootValue) {
        current.raw = upsertEnvLine(current.raw, key, rootValue);
        current.env[key] = rootValue;
        modified = true;
      }
    }
    
    if (modified) {
      fs.writeFileSync(targetEnvPath, current.raw, 'utf8');
          const fileName = path.basename(targetEnvPath);
          console.log(`[env] ✅ Synced ${target.name}/${fileName}`);
        }
      }
    }
  }

  console.log('[env] ✅ Environment sync complete');
}

main();


