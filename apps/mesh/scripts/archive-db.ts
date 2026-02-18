/**
 * Database Archive Script
 * 
 * Archives NotionModel data from the database to a backup JSON file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createPostgresDatabase } from '../src/resolvers/database/postgres';
import { createNotionModel } from '../src/resolvers/models/notion-model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

async function archiveDatabase() {
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
        console.log('Connection established successfully to', process.env.POSTGRES_DB || 'testdb', 'on', process.env.POSTGRES_HOST || 'localhost');

        // Fetch all data from the notion_blocks table
        console.log('Fetching all records from database...');
        const allData = await NotionModel.findAll({
            order: [['block_id', 'ASC']]
        });

        console.log(`Found ${allData.length} records`);

        // Convert the data to a JSON string
        const jsonData = JSON.stringify(allData, null, 2);

        // Define the file path for the archive
        const writePath = path.join(__dirname, '../../../scripts/db_archive.json');
        console.log(`Writing backup to ${writePath}`);

        // Write the JSON data to the file
        fs.writeFileSync(writePath, jsonData);

        console.log(`Successfully archived database to ${writePath}`);
        
        // Close the connection
        await sequelize.close();
    } catch (error) {
        console.error('Error during database archive:', error);
        process.exit(1);
    }
}

// Execute the function
if (require.main === module) {
    archiveDatabase();
}

export { archiveDatabase };
