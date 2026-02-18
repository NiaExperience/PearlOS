import fs from 'fs';
import path from 'path';
// const fs = require('fs');
// const path = require('path');

/**
 * Recursively copies .env.example files to .env if they don't exist
 * @param {string} dir - Directory to search in
 */
const copyEnv = dir => {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    items.forEach(item => {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        copyEnv(fullPath);
      } else if (item.name === '.env.example') {
        const envPath = path.join(dir, '.env'); 
        if (!fs.existsSync(envPath)) {
          fs.copyFileSync(fullPath, envPath);
          console.log(`✓ Created ${envPath}`);
        }
      }
    });
  } catch (error) {
    console.error('\x1b[31m✗\x1b[0m Error processing', dir, ':', error.message);
  }
};

// Main directories to search in
const directories = ['apps', 'packages'];


directories.forEach(dir => {
  if (fs.existsSync(dir)) {
    copyEnv(dir);
  }
});

