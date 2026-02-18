#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the root .env file (check both .env and .env.local)
const rootEnvPath = path.join(__dirname, '..', '.env');
const rootEnvLocalPath = path.join(__dirname, '..', '.env.local');
const uiEnvPath = path.join(__dirname, '.env');

try {
  // Check if root .env or .env.local exists
  let envFile = rootEnvPath;
  if (!fs.existsSync(rootEnvPath)) {
    if (fs.existsSync(rootEnvLocalPath)) {
      envFile = rootEnvLocalPath;
    } else {
      console.log('Root .env or .env.local file not found. Please create one with your DAILY_ROOM_URL.');
    process.exit(1);
    }
  }

  // Read the root .env file
  const rootEnvContent = fs.readFileSync(envFile, 'utf8');
  
  // Extract DAILY_ROOM_URL
  const roomUrlMatch = rootEnvContent.match(/DAILY_ROOM_URL=(.+)/);
  
  if (!roomUrlMatch) {
    console.log('DAILY_ROOM_URL not found in root .env file.');
    process.exit(1);
  }

  const roomUrl = roomUrlMatch[1].trim();
  
  // Create UI .env file with the room URL
  const uiEnvContent = `DAILY_ROOM_URL=${roomUrl}\n`;
  fs.writeFileSync(uiEnvPath, uiEnvContent);
  
  console.log(`✅ UI environment configured with room URL: ${roomUrl}`);
  console.log(`📁 UI .env file created at: ${uiEnvPath}`);
  
} catch (error) {
  console.error('Error setting up UI environment:', error.message);
  process.exit(1);
}
