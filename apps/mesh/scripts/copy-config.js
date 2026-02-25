const fs = require('fs');
const path = require('path');

const srcConfigDir = path.join(__dirname, '../src/config');
const distConfigDir = path.join(__dirname, '../dist/config');

// Ensure dist/config directory exists
if (!fs.existsSync(distConfigDir)) {
  fs.mkdirSync(distConfigDir, { recursive: true });
}

// Copy all files from src/config to dist/config
if (fs.existsSync(srcConfigDir)) {
  const files = fs.readdirSync(srcConfigDir);
  files.forEach(file => {
    const srcFile = path.join(srcConfigDir, file);
    const distFile = path.join(distConfigDir, file);
    
    // Only copy files (not directories)
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, distFile);
      console.log(`Copied ${file} to dist/config/`);
    }
  });
} else {
  console.warn(`Warning: ${srcConfigDir} does not exist`);
  process.exit(1);
}

console.log('✅ Config files copied successfully');

