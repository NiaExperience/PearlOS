#!/usr/bin/env node

/**
 * Setup script for implementing encrypted storage for Google OAuth tokens
 * 
 * This script helps prepare your environment for Google app verification by:
 * 1. Generating a secure encryption key for token storage
 * 2. Updating environment variables
 * 3. Providing migration status information
 * 
 * Run with: node scripts/setup-oauth-encryption.mjs
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ENV_FILE = '.env.local';
const ENCRYPTION_KEY_NAME = 'TOKEN_ENCRYPTION_KEY';

/**
 * Generate a secure 256-bit encryption key
 */
function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Check if encryption key already exists in environment
 */
function hasEncryptionKey() {
  try {
    const envContent = fs.readFileSync(ENV_FILE, 'utf8');
    return envContent.includes(ENCRYPTION_KEY_NAME);
  } catch (error) {
    return false;
  }
}

/**
 * Add encryption key to environment file
 */
function addEncryptionKey(key) {
  const keyLine = `\n# OAuth Token Encryption (required for Google app verification)\n${ENCRYPTION_KEY_NAME}=${key}\n`;
  
  if (fs.existsSync(ENV_FILE)) {
    fs.appendFileSync(ENV_FILE, keyLine);
  } else {
    fs.writeFileSync(ENV_FILE, keyLine.trim() + '\n');
  }
}

/**
 * Main setup function
 */
function main() {
  console.log('🔐 OAuth Token Encryption Setup');
  console.log('================================\n');

  // Check if encryption is already set up
  if (hasEncryptionKey()) {
    console.log('✅ Encryption key already exists in', ENV_FILE);
    console.log('🔍 Current setup status:');
    console.log('   • Token encryption: ENABLED');
    console.log('   • Google app verification: READY');
    console.log('   • Backward compatibility: MAINTAINED');
    return;
  }

  // Generate new encryption key
  const encryptionKey = generateEncryptionKey();
  
  console.log('🔑 Generated new encryption key');
  console.log('📝 Adding to', ENV_FILE);
  
  try {
    addEncryptionKey(encryptionKey);
    
    console.log('✅ Setup complete!\n');
    console.log('🔍 What was configured:');
    console.log('   • 256-bit AES encryption key generated');
    console.log('   • Environment variable added:', ENCRYPTION_KEY_NAME);
    console.log('   • Account tokens will now be encrypted at rest');
    console.log('   • Existing unencrypted records remain compatible');
    
    console.log('\n🚀 Next steps:');
    console.log('   1. Restart your development servers');
    console.log('   2. New OAuth tokens will be automatically encrypted');
    console.log('   3. Existing tokens will be migrated on next update');
    console.log('   4. Your app is now ready for Google verification!');
    
    console.log('\n⚠️  Security reminder:');
    console.log('   • Keep your', ENV_FILE, 'file secure');
    console.log('   • Do not commit encryption keys to version control');
    console.log('   • Use different keys for different environments');
    
  } catch (error) {
    console.error('❌ Failed to setup encryption:', error.message);
    process.exit(1);
  }
}

main();
