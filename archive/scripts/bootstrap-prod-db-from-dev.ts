import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { resolve } from 'path';
import { promisify } from 'util';
import * as readline from 'readline';

import { loadEnvFromRoot } from '@nia/prism/core/config/env-loader';
import { createPlatformContentDefinitions } from '@nia/prism/core/utils/platform-definitions';

type DatabaseConfig = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

type BootstrapOptions = {
  dryRun: boolean;
  skipBackup: boolean;
  force: boolean;
  skipDefinitions: boolean;
};

const execAsync = promisify(exec);

loadEnvFromRoot(resolve(__dirname, '..', '.env.local'));

function parseArgs(): BootstrapOptions {
  const args = process.argv.slice(2);
  const options: BootstrapOptions = {
    dryRun: false,
    skipBackup: false,
    force: false,
    skipDefinitions: false,
  };

  for (const arg of args) {
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-backup':
        options.skipBackup = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--skip-definitions':
        options.skipDefinitions = true;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
        break;
    }
  }

  return options;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getDevConfig(): DatabaseConfig {
  return {
    host: requireEnv('POSTGRES_HOST'),
    port: requireEnv('POSTGRES_PORT'),
    database: requireEnv('POSTGRES_DB'),
    username: requireEnv('POSTGRES_USER'),
    password: requireEnv('POSTGRES_PASSWORD'),
  };
}

function getProdConfig(): DatabaseConfig {
  return {
    host: requireEnv('PROD_POSTGRES_HOST'),
    port: requireEnv('PROD_POSTGRES_PORT'),
    database: requireEnv('PROD_POSTGRES_DB'),
    username: requireEnv('PROD_POSTGRES_USER'),
    password: requireEnv('PROD_POSTGRES_PASSWORD'),
  };
}

async function ensureCommand(command: string): Promise<void> {
  const bin = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execAsync(`${bin} ${command}`);
  } catch {
    throw new Error(`Required command not found: ${command}`);
  }
}

async function promptForConfirmation(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string) =>
    new Promise<string>((resolveProm) => rl.question(prompt, resolveProm));

  try {
    console.log('\n🚨 You are about to OVERWRITE the production database with development data.');
    console.log('This operation is destructive and should only be run during an approved bootstrap window.\n');
    const confirmation = await question('Type "bootstrap prod" to continue: ');
    if (confirmation.trim().toLowerCase() !== 'bootstrap prod') {
      throw new Error('Confirmation phrase mismatch. Aborting.');
    }

    const doubleCheck = await question('This will DROP existing prod data. Type "I understand" to proceed: ');
    if (doubleCheck.trim().toLowerCase() !== 'i understand') {
      throw new Error('Second confirmation failed. Aborting.');
    }
  } finally {
    rl.close();
  }
}

function summarizeConfigs(dev: DatabaseConfig, prod: DatabaseConfig): void {
  const redacted = (value: string) => (value ? `******** (len=${value.length})` : '<empty>');

  console.log('\n📋 Sync configuration:');
  console.log(`   Dev source:  ${dev.username}@${dev.host}:${dev.port}/${dev.database}`);
  console.log(`   Prod target: ${prod.username}@${prod.host}:${prod.port}/${prod.database}`);
  console.log(`   Dev password:  ${redacted(dev.password)}`);
  console.log(`   Prod password: ${redacted(prod.password)}`);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function runCommand(cmd: string, password: string, options: BootstrapOptions): Promise<void> {
  if (options.dryRun) {
    console.log(`[dry-run] ${cmd}`);
    return;
  }

  const original = process.env.PGPASSWORD;
  process.env.PGPASSWORD = password;
  try {
    console.log(`Executing: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd);
    if (stdout) {
      console.log(stdout.trim());
    }
    if (stderr) {
      console.error(stderr.trim());
    }
  } finally {
    if (original === undefined) {
      delete process.env.PGPASSWORD;
    } else {
      process.env.PGPASSWORD = original;
    }
  }
}

async function createTempSqlFile(contents: string): Promise<string> {
  const file = path.join('/tmp', `bootstrap_${timestamp()}.sql`);
  await fs.promises.writeFile(file, contents, 'utf-8');
  return file;
}

async function cleanupFile(file: string): Promise<void> {
  try {
    await fs.promises.unlink(file);
  } catch {
    // ignore cleanup errors
  }
}

async function backupProd(prod: DatabaseConfig, backupFile: string, options: BootstrapOptions): Promise<void> {
  console.log('\n📦 Creating production backup...');
  const cmd = `pg_dump -h ${prod.host} -p ${prod.port} -U ${prod.username} -d ${prod.database} --no-owner --no-privileges --clean --if-exists > "${backupFile}"`;
  await runCommand(cmd, prod.password, options);
  if (!options.dryRun && !fs.existsSync(backupFile)) {
    throw new Error('Production backup failed: dump file not created.');
  }
  console.log(`✅ Production backup written to ${backupFile}`);
}

async function dumpDev(dev: DatabaseConfig, dumpFile: string, options: BootstrapOptions): Promise<void> {
  console.log('\n📤 Dumping development database...');
  const cmd = `pg_dump -h ${dev.host} -p ${dev.port} -U ${dev.username} -d ${dev.database} --no-owner --no-privileges --clean --if-exists > "${dumpFile}"`;
  await runCommand(cmd, dev.password, options);
  if (!options.dryRun && !fs.existsSync(dumpFile)) {
    throw new Error('Development dump failed: dump file not created.');
  }
  console.log(`✅ Development dump stored at ${dumpFile}`);
}

async function restoreToProd(prod: DatabaseConfig, dumpFile: string, options: BootstrapOptions): Promise<void> {
  console.log('\n🛠️  Restoring development dump into production...');
  const cmd = `psql -h ${prod.host} -p ${prod.port} -U ${prod.username} -d ${prod.database} < "${dumpFile}"`;
  await runCommand(cmd, prod.password, options);
  console.log('✅ Production restore completed.');
}

async function fixSequences(prod: DatabaseConfig, options: BootstrapOptions): Promise<void> {
  console.log('\n🔧 Fixing key sequences...');
  const sequenceSql = `
SELECT setval('notion_blocks_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM notion_blocks));
`;
  const file = await createTempSqlFile(sequenceSql);
  try {
    const cmd = `psql -h ${prod.host} -p ${prod.port} -U ${prod.username} -d ${prod.database} -f "${file}"`;
    await runCommand(cmd, prod.password, options);
    console.log('✅ Sequence fix applied.');
  } finally {
    await cleanupFile(file);
  }
}

async function refreshDefinitions(options: BootstrapOptions): Promise<void> {
  if (options.skipDefinitions) {
    console.log('\n⏭️  Skipping platform definition refresh by request.');
    return;
  }

  console.log('\n🧭 Refreshing platform content definitions via Prism...');
  try {
    if (options.dryRun) {
      console.log('[dry-run] createPlatformContentDefinitions()');
      return;
    }
    await createPlatformContentDefinitions();
    console.log('✅ Platform definitions refreshed.');
  } catch (error) {
    console.warn('⚠️ Failed to refresh platform definitions:', (error as Error).message);
  }
}

async function main() {
  const options = parseArgs();

  const devConfig = getDevConfig();
  const prodConfig = getProdConfig();

  if (devConfig.host === prodConfig.host && devConfig.database === prodConfig.database) {
    throw new Error('Source and target databases are identical. Aborting to avoid data loss.');
  }

  if (prodConfig.database.toLowerCase().includes('dev')) {
    throw new Error(`Target database name (${prodConfig.database}) appears to be non-prod. Aborting.`);
  }

  summarizeConfigs(devConfig, prodConfig);

  await ensureCommand('pg_dump');
  await ensureCommand('psql');

  if (!options.force) {
    await promptForConfirmation();
  }

  const dumpFile = path.join('/tmp', `dev_dump_${timestamp()}.sql`);
  const backupFile = path.join('/tmp', `prod_backup_${timestamp()}.sql`);

  try {
    if (!options.skipBackup) {
      await backupProd(prodConfig, backupFile, options);
    } else {
      console.log('\n⚠️  Skipping production backup (requested).');
    }

    await dumpDev(devConfig, dumpFile, options);
    await restoreToProd(prodConfig, dumpFile, options);
    await fixSequences(prodConfig, options);
    await refreshDefinitions(options);

    console.log('\n🎉 Production bootstrap from development completed successfully.');
    if (!options.dryRun && !options.skipBackup) {
      console.log(`Production backup file retained at ${backupFile}`);
    }
  } finally {
    if (!options.dryRun) {
      await cleanupFile(dumpFile);
    }
  }
}

main().catch((error) => {
  console.error('\n❌ Bootstrap failed:', error);
  process.exit(1);
});
