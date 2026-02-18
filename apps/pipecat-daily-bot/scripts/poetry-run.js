#!/usr/bin/env node
/**
 * Poetry Run Wrapper
 * 
 * Wrapper script to run Poetry commands from the bot directory.
 * This ensures all Poetry commands run in the correct context (where pyproject.toml is).
 * 
 * Usage:
 *   node scripts/poetry-run.js <poetry-command> [args...]
 * 
 * Examples:
 *   node scripts/poetry-run.js run python runner_main.py
 *   node scripts/poetry-run.js install --no-root --only main
 *   node scripts/poetry-run.js run pip install -e ../../../packages/events/python
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get the bot directory (where pyproject.toml is)
const scriptDir = __dirname;
const botDir = path.resolve(scriptDir, '..', 'bot');

// Check if pyproject.toml exists
const pyprojectPath = path.join(botDir, 'pyproject.toml');
if (!fs.existsSync(pyprojectPath)) {
  console.error(`❌ Error: pyproject.toml not found at ${pyprojectPath}`);
  console.error(`   Make sure you're running this from the pipecat-daily-bot directory.`);
  process.exit(1);
}

// Get all arguments after the script name
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('❌ Error: No Poetry command provided');
  console.error('   Usage: node scripts/poetry-run.js <poetry-command> [args...]');
  console.error('   Example: node scripts/poetry-run.js run python runner_main.py');
  process.exit(1);
}

// Check if poetry is available
const poetryCommand = 'poetry';
const checkPoetry = spawn(poetryCommand, ['--version'], { stdio: 'pipe' });
checkPoetry.on('error', () => {
  console.error('❌ Error: Poetry not found in PATH');
  console.error('   Please install Poetry: https://python-poetry.org/docs/#installation');
  console.error('   Or run: curl -sSL https://install.python-poetry.org | python3 -');
  process.exit(1);
});

checkPoetry.on('close', (code) => {
  if (code !== 0) {
    console.error('❌ Error: Poetry command failed');
    process.exit(1);
  }

  // Run the poetry command in the bot directory
  const poetryProcess = spawn(poetryCommand, args, {
    cwd: botDir,
    stdio: 'inherit',
    shell: false
  });

  poetryProcess.on('error', (error) => {
    console.error(`❌ Error running Poetry: ${error.message}`);
    process.exit(1);
  });

  poetryProcess.on('close', (code) => {
    process.exit(code || 0);
  });
});