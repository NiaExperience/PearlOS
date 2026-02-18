/**
 * Cleanup script for JMeter load testing
 * 
 * This script:
 * 1. Reads the tenant ID from the config file
 * 2. Deletes all 'Load' content records
 * 3. Deletes the 'Load' content type definition
 */

import { Prism } from '../../packages/prism/dist/prism.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath('file://');
const __dirname = path.dirname(__filename);

/**
 * Main cleanup function
 */
async function cleanupLoadTest() {
  console.log('Cleaning up JMeter load test environment...');
  
  // Read tenant ID from config file
  const configPath = path.join(process.cwd(), 'temp/jmeter-test-config.json');
  
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    console.error('Please run setup-jmeter-test.ts first');
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tenantId = config.tenantId;
  
  if (!tenantId) {
    console.error('No tenant ID found in config file');
    process.exit(1);
  }
  
  console.log(`Using tenant ID: ${tenantId}`);
  
  // Get Prism instance
  const prism = await Prism.getInstance();
  
  try {
    // Clean up remaining Load records
    console.log('Cleaning up remaining Load records...');
    
    let deletedCount = 0;
    let hasMore = true;
    
    // Delete records in batches to avoid overwhelming the system
    while (hasMore) {
      const remainingRecords = await prism.query({
        contentType: 'Load',
        tenantId,
        limit: 100
      });
      
      if (remainingRecords.total === 0) {
        hasMore = false;
        break;
      }
      
      for (const record of remainingRecords.items) {
        await prism.delete('Load', record._id!, tenantId);
        deletedCount++;
      }
      
      console.log(`Deleted ${deletedCount} records so far...`);
    }
    
    console.log(`Total of ${deletedCount} Load records cleaned up`);
    
    // Delete the Load content type definition
    console.log('Deleting Load content type definition...');
    const definitionResult = await prism.findDefinition('Load', tenantId);
    
    if (definitionResult.total > 0) {
      const loadDefinition = definitionResult.items[0];
      await prism.deleteDefinition(loadDefinition._id!, tenantId);
      console.log('Load content type definition deleted');
    } else {
      console.log('Load content type definition not found');
    }

    // Delete the tenant
    console.log(`Deleting tenant...`);
    const deletedTenant = await prism.delete('Tenant', tenantId, 'any');
    if (deletedTenant) {
      console.log(`Tenant deleted successfully`);
    } else {
      console.log(`Failed to delete tenant ${tenantId}`);
    }
    
    // Remove the config file
    // fs.unlinkSync(configPath);
    // console.log(`Removed config file: ${configPath}`);
    
    console.log('Cleanup completed successfully');
    
  } catch (error) {
    console.error('Error in cleanup:', error);
    process.exit(1);
  }
}

// Run the cleanup
cleanupLoadTest().catch(console.error);
