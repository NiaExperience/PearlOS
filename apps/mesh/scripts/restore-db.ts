/**
 * Database Restore Script
 * 
 * Restores NotionModel data from a backup JSON file to the database.
 */

import * as fs from 'fs';
import * as path from 'path';

import dotenv from 'dotenv';

import { createPostgresDatabase } from '../src/resolvers/database/postgres';
import { createNotionModel } from '../src/resolvers/models/notion-model';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

async function restoreDatabase() {
    try {
        // Connect to the Postgres database
        console.log('Connecting to database...');
        const sequelize = await createPostgresDatabase(
            process.env.POSTGRES_HOST || 'localhost',
            parseInt(process.env.POSTGRES_PORT || '5432'),
            process.env.POSTGRES_DB || 'testdb',
            process.env.POSTGRES_USER || 'postgres',
            process.env.POSTGRES_PASSWORD || 'password',
            { shouldLog: true }
        );
        
        // Initialize the NotionModel
        const NotionModel = createNotionModel(sequelize);
        console.log('Connection established successfully.');

        // Check if the target DB needs the notion model
        const tableExists = await sequelize.getQueryInterface().tableExists('notion_blocks');
        if (!tableExists) {
            console.log('Table notion_blocks not found. Defining schema...');
            await NotionModel.sync();
            console.log('Table notion_blocks created.');
        } else {
            console.log('Table notion_blocks already exists.');
        }

        // Define the file path for the archive
        const filePath = path.join(__dirname, '../../../scripts/db_archive.json');
        console.log(`Reading backup from ${filePath}`);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new Error(`Backup file not found at ${filePath}`);
        }

        // Read the JSON data from the file
        const jsonData = fs.readFileSync(filePath, 'utf-8');

        // Parse the JSON data
        const allData = JSON.parse(jsonData);
        console.log(`Found ${allData.length} records to restore`);

        // Insert the data into the notion_blocks table
        await NotionModel.bulkCreate(allData);

        console.log(`Successfully restored database from ${filePath}`);

        // Fix the notion_blocks sequence to prevent primary key conflicts
        console.log('Fixing notion_blocks sequence...');
        await sequelize.query(
            "SELECT setval('notion_blocks_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM notion_blocks))"
        );
        console.log('notion_blocks sequence value fixed successfully');
        
        // Close the connection
        await sequelize.close();
    } catch (error) {
        console.error('Error during database restore:', error);
        process.exit(1);
    }
}

// Execute the function
if (require.main === module) {
    restoreDatabase();
}

export { restoreDatabase };
