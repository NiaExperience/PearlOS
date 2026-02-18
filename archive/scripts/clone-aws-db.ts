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
  // Validate required environment variables for source database
  const requiredVars = ['AWS_POSTGRES_HOST', 'AWS_POSTGRES_PORT', 'AWS_POSTGRES_DB', 'AWS_POSTGRES_USER', 'AWS_POSTGRES_PASSWORD'];
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }

  return {
    host: process.env.AWS_POSTGRES_HOST!,
    port: process.env.AWS_POSTGRES_PORT!,
    database: process.env.AWS_POSTGRES_DB!,
    username: process.env.AWS_POSTGRES_USER!,
    password: process.env.AWS_POSTGRES_PASSWORD!,
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
    password: process.env.POSTGRES_PASSWORD!,
  };
}

async function checkCommandExists(command: string): Promise<boolean> {
  try {
    // Use 'where' on Windows, 'which' on Unix/Linux
    const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
    await execAsync(checkCmd);
    return true;
  } catch {
    return false;
  }
}

async function cloneDatabase() {
  // Create temporary dump file name once at the top
  const dumpFile = path.join('/tmp', `db_dump_${Date.now()}.sql`);

  try {
    if (process.env.POSTGRES_DB === 'niadev') {
      console.warn('Skipping database clear for niadev environment. Set POSTGRES_DB to a different value to enable cloning.');
      return;
    }

    console.log('Starting database clone process...');

    // Check if pg_dump and psql are available
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

    console.log('Source database configuration:');
    console.log(`  Host: ${sourceConfig.host}:${sourceConfig.port}`);
    console.log(`  Database: ${sourceConfig.database}`);
    console.log(`  User: ${sourceConfig.username}`);

    console.log('Target database configuration:');
    console.log(`  Host: ${targetConfig.host}:${targetConfig.port}`);
    console.log(`  Database: ${targetConfig.database}`);
    console.log(`  User: ${targetConfig.username}`);

    console.log('\nStep 1: Creating database dump from source...');

    // Set password as environment variable to avoid shell escaping issues
    originalPgPassword = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD
    process.env.PGPASSWORD = sourceConfig.password;

    // Create pg_dump command
    const pgDumpCmd = `pg_dump -h ${sourceConfig.host} -p ${sourceConfig.port} -U ${sourceConfig.username} -d ${sourceConfig.database} --no-owner --no-privileges --clean --if-exists > "${dumpFile}"`;

    console.log('Executing pg_dump...');
    await execAsync(pgDumpCmd);
    console.log(`Database dump created: ${dumpFile}`);

    // Check if dump file was created and has content
    if (!fs.existsSync(dumpFile)) {
      throw new Error('Database dump file was not created');
    }

    const stats = fs.statSync(dumpFile);
    if (stats.size === 0) {
      throw new Error('Database dump file is empty');
    }

    console.log(`Dump file size: ${stats.size} bytes`);

    console.log('\nStep 2: Restoring database dump to target...');

    // Set password for target database
    process.env.PGPASSWORD = targetConfig.password;

    // Create psql command to restore the dump
    const psqlCmd = `psql -h ${targetConfig.host} -p ${targetConfig.port} -U ${targetConfig.username} -d ${targetConfig.database} < "${dumpFile}"`;

    console.log('Executing psql restore...');
    await execAsync(psqlCmd);

    // Restore original PGPASSWORD environment variable
    if (originalPgPassword !== undefined) {
      process.env.PGPASSWORD = originalPgPassword;
    } else {
      delete process.env.PGPASSWORD;
    }
    console.log('Database restore completed successfully');

    // Ensure the table exists (in case the source DB was empty or dump was partial)
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

    // Fix sequence values to prevent primary key conflicts
    // Reset the notion_blocks sequence to be higher than the max existing ID
    const sequenceFixQuery = `
SELECT setval('notion_blocks_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM notion_blocks));
`;

    // Write the SQL to a temporary file to avoid shell escaping issues
    const sequenceFixFile = path.join('/tmp', `sequence_fix_${Date.now()}.sql`);
    fs.writeFileSync(sequenceFixFile, sequenceFixQuery);

    const sequenceFixCmd = `PGPASSWORD='${targetConfig.password}' psql -h ${targetConfig.host} -p ${targetConfig.port} -U ${targetConfig.username} -d ${targetConfig.database} -f ${sequenceFixFile}`;

    console.log('Fixing notion_blocks sequence...');
    await execAsync(sequenceFixCmd);
    console.log('Database sequences fixed successfully');

    // Clean up the sequence fix SQL file
    fs.unlinkSync(sequenceFixFile);

    // Clean up temporary dump file
    console.log('\nStep 4: Cleaning up temporary files...');
    fs.unlinkSync(dumpFile);
    console.log(`Removed temporary dump file: ${dumpFile}`);

    // Add platform content definitions without spawning external dev process
    console.log('\nStep 5: Adding platform content definitions (in-process Mesh server)...');

    // Start an in-process Mesh server on an ephemeral port (0) in test mode
    let meshServer: import('http').Server | undefined;
    let meshPort: number | undefined;
    try {
      meshServer = await startServer(0, true); // testMode true disables strict auth
      const address = meshServer.address();
      if (typeof address === 'object' && address && 'port' in address) {
        meshPort = address.port as number;
      } else {
        meshPort = 2000; // fallback
      }
      process.env.MESH_ENDPOINT = `http://localhost:${meshPort}/graphql`;
      console.log(`✅ In-process Mesh server listening on port ${meshPort}`);

      await createPlatformContentDefinitions();
      console.log('✅ Platform content definitions created');
    } catch (defError) {
      console.error('\n❌ ERROR creating platform content definitions:');
      console.error(defError instanceof Error ? defError.message : String(defError));
      if (defError instanceof Error && defError.stack) {
        console.error('Stack trace:', defError.stack);
      }
      throw defError; // Re-throw to be caught by outer try/catch
    } finally {
      if (meshServer) {
        try {
          await stopServer(meshServer);
          console.log('🛑 In-process Mesh server stopped');
        } catch (e) {
          console.warn('Warning: failed to stop in-process Mesh server', (e as Error).message);
        }
      }
    }
    console.log('\n✅ Database clone completed successfully!');
    console.log(`Source: ${sourceConfig.database} on ${sourceConfig.host}`);
    console.log(`Target: ${targetConfig.database} on ${targetConfig.host}`);

    try {
      // No external server to stop; in-process server already stopped above.

      // Clean up temporary dump file on success too
      if (fs.existsSync(dumpFile)) {
        fs.unlinkSync(dumpFile);
        console.log(`Cleaned up temporary dump file: ${dumpFile}`);
      }

      // Restore original PGPASSWORD environment variable
      if (originalPgPassword !== undefined) {
        process.env.PGPASSWORD = originalPgPassword;
      } else {
        delete process.env.PGPASSWORD;
      }

      // Clean up temporary dump file if it exists
      if (fs.existsSync(dumpFile)) {
        fs.unlinkSync(dumpFile);
        console.log(`Cleaned up temporary dump file: ${dumpFile}`);
      }

      // Try to clean up sequence fix file
      // Look for any sequence fix files that match our pattern
      const files = fs.readdirSync('/tmp').filter(f => f.startsWith('sequence_fix_') && f.endsWith('.sql'));
      for (const file of files) {
        const filePath = path.join('/tmp', file);
        fs.unlinkSync(filePath);
        console.log(`Cleaned up temporary sequence fix file: ${filePath}`);
      }
    }
    catch (cleanupError) {
      console.warn('Warning: Could not clean up dump file:', cleanupError);
    }
    process.exit(0);
  }
  catch (error: unknown) {
    console.error('\n❌ DATABASE CLONE FAILED');
    console.error('Error:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Execute the function
cloneDatabase();