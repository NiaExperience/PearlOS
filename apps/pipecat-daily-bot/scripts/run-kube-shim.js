#!/usr/bin/env node
/**
 * Local queue operator runner.
 *
 * Runs a lightweight local operator that consumes Redis queue jobs and dispatches
 * them to the local runner API (/start). This is a non-Kubernetes equivalent
 * of the production operator flow.
 *
 * Usage: node scripts/run-kube-shim.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptDir = __dirname;
const botDir = path.resolve(scriptDir, '..', 'bot');
const operatorPath = path.join(botDir, 'local_operator.py');

if (!fs.existsSync(operatorPath)) {
  console.error(`❌ Error: local_operator.py not found at ${operatorPath}`);
  process.exit(1);
}

console.log('🚀 Starting local Redis queue operator...');
console.log('   Queue consumer: bot/local_operator.py');
console.log('   Press Ctrl+C to stop\n');

const poetryProcess = spawn('poetry', ['run', 'python', 'local_operator.py'], {
  cwd: botDir,
  stdio: 'inherit',
  shell: false,
});

poetryProcess.on('error', (error) => {
  console.error(`❌ Error running local operator: ${error.message}`);
  process.exit(1);
});

poetryProcess.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`\n❌ Local operator exited with code ${code}`);
    process.exit(code);
  }
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down local queue operator...');
  poetryProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down local queue operator...');
  poetryProcess.kill('SIGTERM');
});

