#!/usr/bin/env node
/**
 * Bot Server Runner
 * 
 * Starts the bot gateway server (FastAPI) on port 4444.
 * This is the main entry point for the bot control API.
 * 
 * Usage: node scripts/run-bot-server.js
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptDir = __dirname;
const botDir = path.resolve(scriptDir, '..', 'bot');
const PORT = 4444;

/**
 * Check if a port is in use and optionally kill the process
 */
function checkPort(port, autoKill = true) {
  return new Promise((resolve, reject) => {
    // Try lsof first (Linux/macOS)
    exec(`lsof -ti:${port}`, (error, stdout) => {
      if (error) {
        // Port is not in use or lsof not available
        resolve(false);
        return;
      }
      
      const pids = stdout.trim().split('\n').filter(Boolean);
      if (pids.length === 0) {
        resolve(false);
        return;
      }
      
      console.warn(`⚠️  Port ${port} is already in use by process(es): ${pids.join(', ')}`);
      
      if (autoKill) {
        console.log(`🔄 Attempting to free port ${port}...`);
        pids.forEach(pid => {
          exec(`kill -9 ${pid}`, (killError) => {
            if (killError) {
              console.warn(`⚠️  Could not kill process ${pid}: ${killError.message}`);
            } else {
              console.log(`✅ Killed process ${pid}`);
            }
          });
        });
        
        // Wait a moment for ports to be released
        setTimeout(() => {
          exec(`lsof -ti:${port}`, (checkError) => {
            if (checkError) {
              console.log(`✅ Port ${port} is now free`);
              resolve(false);
            } else {
              console.error(`❌ Port ${port} is still in use. Please free it manually.`);
              reject(new Error(`Port ${port} is still in use`));
            }
          });
        }, 1000);
      } else {
        reject(new Error(`Port ${port} is already in use by process(es): ${pids.join(', ')}`));
      }
    });
  });
}

// Check if bot_gateway.py exists
const gatewayPath = path.join(botDir, 'bot_gateway.py');
if (!fs.existsSync(gatewayPath)) {
  console.error(`❌ Error: bot_gateway.py not found at ${gatewayPath}`);
  console.error(`   Make sure you're running this from the pipecat-daily-bot directory.`);
  process.exit(1);
}

// Check if pyproject.toml exists (indicates Poetry environment)
const pyprojectPath = path.join(botDir, 'pyproject.toml');
if (!fs.existsSync(pyprojectPath)) {
  console.error(`❌ Error: pyproject.toml not found at ${pyprojectPath}`);
  console.error(`   Make sure the bot directory is properly set up.`);
  process.exit(1);
}

// Check if poetry is available
const poetryCommand = 'poetry';
const checkPoetry = spawn(poetryCommand, ['--version'], { stdio: 'pipe' });
checkPoetry.on('error', () => {
  console.error('❌ Error: Poetry not found in PATH');
  console.error('   Please install Poetry: https://python-poetry.org/docs/#installation');
  process.exit(1);
});

checkPoetry.on('close', async (code) => {
  if (code !== 0) {
    console.error('❌ Error: Poetry command failed');
    process.exit(1);
  }

  // Check if port is available
  try {
    await checkPort(PORT, true);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.error(`   Please free port ${PORT} and try again.`);
    console.error(`   Or run: kill $(lsof -ti:${PORT})`);
    process.exit(1);
  }

  // Run uvicorn to start the bot gateway
  console.log('🚀 Starting bot gateway server...');
  console.log(`   Gateway will be available at http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop\n`);

  const uvicornProcess = spawn(poetryCommand, [
    'run',
    'uvicorn',
    'bot_gateway:app',
    '--host',
    '0.0.0.0',
    '--port',
    '4444',
    '--reload'
  ], {
    cwd: botDir,
    stdio: 'inherit',
    shell: false
  });

  uvicornProcess.on('error', (error) => {
    console.error(`❌ Error running bot gateway: ${error.message}`);
    process.exit(1);
  });

  uvicornProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n❌ Bot gateway exited with code ${code}`);
      process.exit(code);
    }
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot gateway...');
    uvicornProcess.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down bot gateway...');
    uvicornProcess.kill('SIGTERM');
  });
});

