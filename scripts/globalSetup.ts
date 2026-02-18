import 'reflect-metadata';
// Use the packaged build rather than source to mirror runtime consumption.
// If the build output is missing (e.g., running tests after a clean clone), build @nia/prism on the fly.
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const prismDistIndexPath = path.resolve(__dirname, '../packages/prism/dist/index.js');
if (!fs.existsSync(prismDistIndexPath)) {
  try {
    console.log('📦 Building @nia/prism package for tests (dist missing)...');
    execSync('npm run build -w @nia/prism', { stdio: 'inherit' });
  } catch (e) {
    console.error('Failed to build @nia/prism before tests');
    throw e;
  }
}

// eslint-disable-next-line import/order
import { Prism } from '@nia/prism';
import { SUPERADMIN_USER_ID } from '@nia/prism/core/auth';
import { ToolType, ToolBaseType } from '@nia/prism/testing';

// Track if setup was successful
let setupSuccessful = false;

// Global reference to the mesh server for proper shutdown
(global as any).__meshServer = null;

// Set up minimal mock for Jest to avoid errors in testlib.ts
(global as any).jest = {
  mock: (_moduleName: string, factory: () => any) => factory(),
  fn: () => {
    const mockFn = () => undefined;
    mockFn.mockResolvedValue = () => mockFn;
    return mockFn;
  },
  requireActual: (moduleName: string) => {
    const relativePath = moduleName.startsWith('../')
      ? path.resolve(__dirname, '../packages/prism/src', moduleName.substring(3))
      : moduleName;
    return require(relativePath);
  }
} as any;

const testSessionUserId = SUPERADMIN_USER_ID;
const testUserData = {
  name: 'Admin Session User',
  email: 'admin@niaxp.com',
  _id: testSessionUserId
}

async function createAdminSessionUser(): Promise<void> {
  const testUserData = {
    name: 'Admin Session User',
    email: 'admin@niaxp.com',
    _id: testSessionUserId
  }
  const prism = await Prism.getInstance();
  const created = await prism.create('User', testUserData, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create admin session user');
  }
}


async function createDefaultTools() {
  const prism = await Prism.getInstance();
  // Create default assistant photo gallery tool
  const tool = {
    name: `${testUserData.name} Photo Gallery Tool`,
    type: ToolType.TEXT_EDITOR,
    baseType: ToolBaseType.PHOTOS,
    userId: testSessionUserId,
    async: false,
    description: `A tool for managing photo galleries`,
  };

  const created = await prism.create('Tool', tool, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create tool');
  }
}

// Cleanup if setup fails
async function cleanupOnFailure() {
  if (!setupSuccessful) {
    console.log("🧹 Cleaning up resources after setup failure...");
    try {
      const prism = await Prism.getInstance();
      await prism.disconnect();
      console.log("✅ Disconnected Prism client after setup failure");
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

// Handle unexpected termination during setup
process.on('SIGINT', async () => {
  console.log('🛑 SIGINT detected during setup, cleaning up...');
  await cleanupOnFailure();
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM detected during setup, cleaning up...');
  await cleanupOnFailure();
  process.exit(1);
});

// Main setup function
const globalSetup = async () => {
  try {
    console.log("🧪 Starting Prism Mesh Server for testing...");
    // Use port 5001 for tests to avoid conflicts with development server
    const testPort = 5001;

    // Start the server with a timeout
    const { startServer } = require('../apps/mesh/src/server');
    const server = await startServer(testPort, true); // Set testMode to true

    // Store server instance globally for proper shutdown
    (global as any).__meshServer = server;

    console.log("✅ Mesh server started successfully");

    // Initialize Prism instance
    process.env.MESH_ENDPOINT = 'http://localhost:5001/graphql'; // Default endpoint for tests
    const prism = await Prism.getInstance();
    console.log("✅ Prism instance initialized");

    // Import after Jest is mocked
    const { createPlatformContentDefinitions } = require('@nia/prism/testing');

    // Setup platform definitions
    await createPlatformContentDefinitions();
    console.log("✅ Platform content definitions created");

    // Create test user - need to await this to ensure testSessionUser is set
    await createAdminSessionUser();
    console.log("✅ Admin session user created");    // Create default tools
    await createDefaultTools();
    console.log("✅ Default tools created");

    // Ensure redis is OFF
    process.env.USE_REDIS = 'false';
    process.env.REDIS_DISABLE_AUTO_CONNECT = 'true';

    // Mark setup as successful
    setupSuccessful = true;
    console.log("🚀 Test environment setup complete");

    return true;
  } catch (error) {
    console.error('❌ Failed to start Mesh server:', error);
    await cleanupOnFailure();
    throw error; // Rethrow to ensure Jest knows setup failed
  }
};

// Export for both CommonJS and ES modules
export default globalSetup;
module.exports = globalSetup;
