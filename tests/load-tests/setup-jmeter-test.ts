/**
 * Setup script for JMeter load testing
 * 
 * This script:
 * 1. Creates a test tenant
 * 2. Creates a 'Load' dynamic content type definition
 * 3. Outputs the tenant ID for use by JMeter tests
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { v4 as uuidv4 } from 'uuid';

import { SUPERADMIN_USER_ID } from '../../packages/prism/dist/core/auth/index.js';
import type { IDynamicContent } from '../../packages/prism/dist/core/blocks/dynamicContent.block.js';
import { Prism } from '../../packages/prism/dist/prism.js';

const __filename = fileURLToPath('file://');
const __dirname = path.dirname(__filename);

/**
 * Create a test tenant
 */
async function createTestTenant() {
  const prism = await Prism.getInstance();
  const tenantId = uuidv4();
  
  // Create a tenant
  await prism.create('Tenant', {
    _id: tenantId,
    name: `Test Tenant ${tenantId}`,
    description: 'Test tenant for JMeter load testing',
    plan_tier: 'free',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, 'any');
  
  return { _id: tenantId };
}

async function assignUserToTenant(
  userId: string,
  tenantId: string,
  role: string
) {
  if (!userId) {
    throw new Error('User ID is required');
  }
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }
  if (!role) {
    throw new Error('Role is required');
  }
  const prism = await Prism.getInstance();
  const userTenantRole = {
    userId,
    tenantId,
    role,
  };
  const created = await prism.create('UserTenantRole', userTenantRole, tenantId);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to assign user to tenant');
  }
}

/**
 * Define the Load content type
 */
const createLoadContentDefinition = (): IDynamicContent => {
  return {
    name: 'Load',
    description: 'Dynamic content type for load testing with JMeter',
    dataModel: {
      block: 'Load',
      jsonSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          counter: { type: 'number' },
          data: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' }
        },
        required: ['title', 'counter', 'timestamp']
      },
      indexer: ['title', 'counter']
    },
    uiConfig: {
      labels: { title: 'Title', counter: 'Counter', data: 'Data', timestamp: 'Timestamp' },
      listView: { displayFields: ['title', 'counter', 'timestamp'] },
      detailView: { displayFields: ['title', 'counter', 'data', 'timestamp'] }
    },
    access: { allowAnonymous: true }
  };
};

/**
 * Main setup function
 */
async function setupLoadTest() {
  console.log('Setting up JMeter load test environment...');
  
  // Create a test tenant
  const tenant = await createTestTenant();
  const tenantId = tenant._id!;
  console.log(`Created test tenant: ${tenantId}`);

  // Give the test user admin privileges
  await assignUserToTenant(SUPERADMIN_USER_ID, tenantId, 'admin');
  console.log(`Assigned 'admin' role to test user for tenant`);

  // Get Prism instance
  const prism = await Prism.getInstance();
  
  try {
    // Create the Load content type definition
    console.log('Creating Load content type definition...');
    const loadDefinition = createLoadContentDefinition();
    const createdDef = await prism.createDefinition(loadDefinition, tenantId);
    
    if (!createdDef || createdDef.total === 0) {
      throw new Error('Failed to create Load content type definition');
    }
    
    console.log('Load content type definition created successfully');
    
    // Save tenant ID to file for JMeter to use
    const tempDir = path.join(process.cwd(), 'temp');
    const configPath = path.join(tempDir, 'jmeter-test-config.json');
    
    // Ensure the temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const config = {
      tenantId,
      setupTime: new Date().toISOString()
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Test configuration written to: ${configPath}`);
    
    console.log('Setup completed successfully. You can now run JMeter tests.');
    
  } catch (error) {
    console.error('Error in setup:', error);
    process.exit(1);
  }
}

// Run the setup
setupLoadTest().catch(console.error);
