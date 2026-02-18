import * as fs from 'fs';
import * as path from 'path';

import { loadEnvFromRoot } from '@nia/prism/core/config/env-loader';
import { resolve } from 'path';
import { createPostgresDatabase } from '../apps/mesh/src/resolvers/database/postgres';
import { NotionModel } from '../apps/mesh/src/resolvers/models/notion-model';

// Load environment variables
loadEnvFromRoot(resolve(__dirname, '..', '.env.local'));

async function restoreDatabase() {
    try {
        // Connect to the Postgres database
        const sequelize = await createPostgresDatabase('notion');
        if (!sequelize) {
            throw new Error('Failed to connect to the database');
        }
        console.log('Connection has been established successfully.');

        // Define the file path for the archive
        const filePath = path.join(__dirname, 'db_archive.json');

        // Read the JSON data from the file
        const jsonData = fs.readFileSync(filePath, 'utf-8');

        // Parse the JSON data
        const allData = JSON.parse(jsonData);

        // Insert the data into the notion_blocks table
        await NotionModel.bulkCreate(allData);

        console.log(`Successfully restored database from ${filePath}`);

        // Fix the notion_blocks sequence to prevent primary key conflicts
        console.log('Fixing notion_blocks sequence...');
        await sequelize.query(
            "SELECT setval('notion_blocks_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM notion_blocks))"
        );
        console.log('notion_blocks sequence value fixed successfully');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
}

// Execute the function
restoreDatabase();
