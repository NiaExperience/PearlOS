/* eslint-disable no-console */
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { resolve } from 'path';
import { promisify } from 'util';

import { loadEnvFromRoot } from '@nia/prism/core/config/env-loader';
import { createPlatformContentDefinitions } from '@nia/prism/core/utils/platform-definitions';

import { createPostgresDatabase } from '../apps/mesh/src/resolvers/database/postgres';
import { createNotionModel } from '../apps/mesh/src/resolvers/models/notion-model';
import { startServer, stopServer } from '../apps/mesh/src/server';

const execAsync = promisify(exec);

// Load environment variables (works when executed via ts-node/register or after build)
loadEnvFromRoot(resolve(__dirname, '..', '.env.local'));

interface DatabaseConfig {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

let originalPgPassword: string | undefined;

function getSourceConfig(): DatabaseConfig {
  // Validate required environment variables for source database (prod)
  const requiredVars = [
    'AWS_PROD_POSTGRES_HOST',
    'AWS_PROD_POSTGRES_PORT',
    'AWS_PROD_POSTGRES_DB',
    'AWS_PROD_POSTGRES_USER',
    'AWS_PROD_POSTGRES_PASSWORD'
  ];
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }

  return {
    host: process.env.AWS_PROD_POSTGRES_HOST!,
    port: process.env.AWS_PROD_POSTGRES_PORT!,
    database: process.env.AWS_PROD_POSTGRES_DB!,
    username: process.env.AWS_PROD_POSTGRES_USER!,
    password: process.env.AWS_PROD_POSTGRES_PASSWORD!
  };
}

function getTargetConfig(): DatabaseConfig {
  // Validate required environment variables for target database
  const requiredVars = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'];
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }

  return {
    host: process.env.POSTGRES_HOST!,
    port: process.env.POSTGRES_PORT!,
    database: process.env.POSTGRES_DB!,
    username: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!
  };
}

async function checkCommandExists(command: string): Promise<boolean> {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
    await execAsync(checkCmd);
    return true;
  } catch {
    return false;
  }
}

async function cloneDatabase() {
  const dumpFile = path.join('/tmp', `db_dump_${Date.now()}.sql`);

  try {
    if (process.env.POSTGRES_DB === 'niadev') {
      console.warn('Skipping database clear for niadev environment. Set POSTGRES_DB to a different value to enable cloning.');
      return;
    }

    console.log('Starting production database clone process...');

    const pgDumpExists = await checkCommandExists('pg_dump');
    const psqlExists = await checkCommandExists('psql');

    if (!pgDumpExists) {
      throw new Error('pg_dump command not found. Please install PostgreSQL client tools.');
    }
    if (!psqlExists) {
      throw new Error('psql command not found. Please install PostgreSQL client tools.');
    }

    const sourceConfig = getSourceConfig();
    const targetConfig = getTargetConfig();

    console.log('Source (prod) database configuration:');
    console.log(`  Host: ${sourceConfig.host}:${sourceConfig.port}`);
    console.log(`  Database: ${sourceConfig.database}`);
    console.log(`  User: ${sourceConfig.username}`);

    console.log('Target (local) database configuration:');
    console.log(`  Host: ${targetConfig.host}:${targetConfig.port}`);
    console.log(`  Database: ${targetConfig.database}`);
    console.log(`  User: ${targetConfig.username}`);

    console.log('\nStep 1: Creating database dump from production...');

    originalPgPassword = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
    process.env.PGPASSWORD = sourceConfig.password;

    const pgDumpCmd = `pg_dump -h ${sourceConfig.host} -p ${sourceConfig.port} -U ${sourceConfig.username} -d ${sourceConfig.database} --no-owner --no-privileges --clean --if-exists > "${dumpFile}"`;

    console.log('Executing pg_dump...');
    await execAsync(pgDumpCmd);
    console.log(`Database dump created: ${dumpFile}`);

    if (!fs.existsSync(dumpFile)) {
      throw new Error('Database dump file was not created');
    }

    const stats = fs.statSync(dumpFile);
    if (stats.size === 0) {
      throw new Error('Database dump file is empty');
    }

    console.log(`Dump file size: ${stats.size} bytes`);

    console.log('\nStep 2: Restoring database dump to target...');

    process.env.PGPASSWORD = targetConfig.password;

    const psqlCmd = `psql -h ${targetConfig.host} -p ${targetConfig.port} -U ${targetConfig.username} -d ${targetConfig.database} < "${dumpFile}"`;

    console.log('Executing psql restore...');
    await execAsync(psqlCmd);

    if (originalPgPassword !== undefined) {
      process.env.PGPASSWORD = originalPgPassword;
    } else {
      delete process.env.PGPASSWORD;
    }
    console.log('Database restore completed successfully');

    console.log('\nVerifying target database schema...');
    const sequelize = await createPostgresDatabase(
      targetConfig.host,
      parseInt(targetConfig.port),
      targetConfig.database,
      targetConfig.username,
      targetConfig.password,
      { shouldLog: false }
    );

    try {
      const NotionModel = createNotionModel(sequelize);
      const tableExists = await sequelize.getQueryInterface().tableExists('notion_blocks');

      if (!tableExists) {
        console.log('Table notion_blocks not found. Defining schema...');
        await NotionModel.sync();
        console.log('Table notion_blocks created.');
      } else {
        console.log('Table notion_blocks exists.');
      }
    } finally {
      await sequelize.close();
    }

    console.log('\nStep 3: Fixing database sequences...');

    const sequenceFixQuery = `
SELECT setval('notion_blocks_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM notion_blocks));
`;

    const sequenceFixFile = path.join('/tmp', `sequence_fix_${Date.now()}.sql`);
    fs.writeFileSync(sequenceFixFile, sequenceFixQuery);

    const sequenceFixCmd = `PGPASSWORD='${targetConfig.password}' psql -h ${targetConfig.host} -p ${targetConfig.port} -U ${targetConfig.username} -d ${targetConfig.database} -f ${sequenceFixFile}`;

    console.log('Fixing notion_blocks sequence...');
    await execAsync(sequenceFixCmd);
    console.log('Database sequences fixed successfully');

    console.log('\nStep 4: Refreshing platform content definitions...');
    const server = await startServer();
    try {
      await createPlatformContentDefinitions();
      console.log('Platform content definitions refreshed.');
    } finally {
      await stopServer(server);
    }

    console.log('\nProduction database clone completed successfully.');
  } catch (error) {
    console.error('Error during database clone:', error);
    throw error;
  } finally {
    // Clean up dump and temp files
    if (fs.existsSync(dumpFile)) {
      fs.unlinkSync(dumpFile);
      console.log(`Removed temporary dump file: ${dumpFile}`);
    }
  }
}

cloneDatabase().catch(error => {
  console.error('Failed to clone production database:', error);
  process.exit(1);
});
