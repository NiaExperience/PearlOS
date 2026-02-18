/**
 * Clear Database Script
 * 
 * Clears all NotionModel data from the database.
 */

import * as path from 'path';
import { createPostgresDatabase } from '../src/resolvers/database/postgres';
import { createNotionModel } from '../src/resolvers/models/notion-model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

async function clearDatabase() {
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

        // Clear all data from the notion_blocks table
        console.log('Clearing all records from database...');
        let count = 0;
        try {
            count = await NotionModel.destroy({where: {}});
        } catch (error) {
            console.error('Error clearing database:', error);
            //
        }

        console.log(`Cleared ${count} records from the database`);
        
        // Close the connection
        await sequelize.close();
    } catch (error) {
        console.error('Error during database clear:', error);
        process.exit(1);
    }
}

// Execute the function
if (require.main === module) {
    clearDatabase();
}

export { clearDatabase };
